const logger = require('../utils/logger');
const SchemaHandler = require('./schema-handler');

class Fetcher {
  constructor(apiClient, dbAdapter) {
    this.api = apiClient;
    this.db = dbAdapter;
    this.schema = new SchemaHandler(dbAdapter);
  }

  async fetchPaginated(endpoint, params = {}, tableName) {
    const allData = [];
    let pageNumber = 1;
    let hasMore = true;

    logger.info(`Starting paginated fetch for ${endpoint}`);

    while (hasMore) {
      const response = await this.api.getWithRetry(endpoint, {
        ...params,
        page_number: String(pageNumber),
      });

      if (!response) {
        logger.warn(`No JSON response for ${endpoint}, skipping`);
        return [];
      }

      // Handle two response formats:
      // 1. Paginated: { status, data: [], current_page, count }
      // 2. Direct array: [ ... ]
      let data;
      let isPaginated = false;

      if (Array.isArray(response)) {
        // Direct array response (reports)
        data = response;
        hasMore = false; // No pagination for direct arrays
      } else if (response.data !== undefined) {
        // Wrapped response with pagination
        data = response.data;
        isPaginated = true;
      } else {
        // Single object response
        data = response;
        hasMore = false;
      }

      if (!data || (Array.isArray(data) && data.length === 0)) {
        hasMore = false;
        continue;
      }

      if (Array.isArray(data)) {
        allData.push(...data);
      } else if (typeof data === 'object') {
        allData.push(data);
      }

      logger.info(`Page ${pageNumber}: fetched ${Array.isArray(data) ? data.length : 1} records from ${endpoint}`);

      if (isPaginated) {
        // Handle pagination - current_page can be string or number
        const currentPage = parseInt(response.current_page, 10) || pageNumber;
        const totalCount = parseInt(response.count, 10) || 0;
        const pageSize = Array.isArray(data) ? data.length : 1;

        if (totalCount > 0 && pageSize > 0) {
          const totalPages = Math.ceil(totalCount / pageSize);
          hasMore = currentPage < totalPages && pageSize > 0;
        } else {
          // No count info - keep fetching until empty response
          hasMore = Array.isArray(data) && data.length > 0;
        }
      }

      pageNumber++;

      if (pageNumber > 1000) {
        logger.warn(`Pagination limit reached for ${endpoint}`);
        break;
      }
    }

    logger.info(`Fetched total ${allData.length} records from ${endpoint}`);
    return allData;
  }

  async fetchAndStore(endpointConfig) {
    const { path, tableName, params = {}, nestedTables = [] } = endpointConfig;

    try {
      const data = await this.fetchPaginated(path, params, tableName);

      if (!data.length) {
        logger.info(`No data to store for ${tableName}`);
        return;
      }

      const flattenedData = data.map((row) => this.schema.flattenRow(row));
      await this.schema.ensureTable(tableName, flattenedData[0]);

      const batchSize = 100;
      for (let i = 0; i < flattenedData.length; i += batchSize) {
        const batch = flattenedData.slice(i, i + batchSize);
        await this.db.insertBatch(tableName, batch);
      }

      for (const nested of nestedTables) {
        const { sourceKey, nestedKey, childTable, parentKey } = nested;
        const nestedData = this.schema.extractNestedData(data, parentKey, nestedKey);

        if (nestedData.length) {
          const flattenedNested = nestedData.map((row) => this.schema.flattenRow(row));
          await this.schema.ensureTable(childTable, flattenedNested[0]);

          for (let i = 0; i < flattenedNested.length; i += batchSize) {
            const batch = flattenedNested.slice(i, i + batchSize);
            await this.db.insertBatch(childTable, batch);
          }
        }
      }

      logger.info(`Completed storing data for ${tableName}`);
    } catch (error) {
      logger.error(`Failed to fetch/store ${tableName}`, { error: error.message });
      throw error;
    }
  }
}

module.exports = Fetcher;
