const logger = require('../utils/logger');
const SchemaHandler = require('./schema-handler');

class Fetcher {
  constructor(apiClient, dbAdapter) {
    this.api = apiClient;
    this.db = dbAdapter;
    this.schema = new SchemaHandler(dbAdapter);
  }

  async fetchPaginated(endpoint, params = {}, tableName, onPageFetched = null) {
    const allData = [];
    let pageNumber = 1;
    let hasMore = true;
    let totalFetched = 0;
    const connectionCheckInterval = 50; // Check connection every 50 pages

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

      const pageData = Array.isArray(data) ? data : [data];
      totalFetched += pageData.length;

      logger.info(`Page ${pageNumber}: fetched ${pageData.length} records from ${endpoint}`);

      // If callback provided, process page immediately (streaming mode)
      if (onPageFetched) {
        await onPageFetched(pageData, pageNumber);
      } else {
        // Batch mode - collect all data
        allData.push(...pageData);
      }

      if (isPaginated) {
        // Handle pagination - current_page can be string or number
        const currentPage = parseInt(response.current_page, 10) || pageNumber;
        const totalCount = parseInt(response.count, 10) || 0;
        const pageSize = pageData.length;

        if (totalCount > 0 && pageSize > 0) {
          const totalPages = Math.ceil(totalCount / pageSize);
          hasMore = currentPage < totalPages && pageSize > 0;
        } else {
          // No count info - keep fetching until empty response
          hasMore = pageData.length > 0;
        }
      }

      pageNumber++;

      // Periodically check database connection health
      if (onPageFetched && pageNumber % connectionCheckInterval === 0) {
        await this.db.ensureConnected();
      }

      if (pageNumber > 1000) {
        logger.warn(`Pagination limit reached for ${endpoint}`);
        break;
      }
    }

    // Final connection check after fetching completes
    if (onPageFetched) {
      await this.db.ensureConnected();
      logger.info('Database connection verified after fetch');
    }

    logger.info(`Fetched total ${totalFetched} records from ${endpoint}`);
    return onPageFetched ? totalFetched : allData;
  }

  async fetchAndStore(endpointConfig) {
    const { path, tableName, params = {}, nestedTables = [] } = endpointConfig;
    const batchSize = 100;
    let tableCreated = false;
    let totalStored = 0;
    const allNestedData = [];

    try {
      // Streaming mode: process each page as it arrives to reduce memory usage
      const onPageFetched = async (pageData, pageNumber) => {
        if (!pageData.length) return;

        const flattenedData = pageData.map((row) => this.schema.flattenRow(row));

        // Create table on first batch
        if (!tableCreated) {
          await this.schema.ensureTable(tableName, flattenedData[0]);
          tableCreated = true;
        }

        // Insert this page's data immediately
        let pageInserted = 0;
        for (let i = 0; i < flattenedData.length; i += batchSize) {
          const batch = flattenedData.slice(i, i + batchSize);
          await this.db.insertBatch(tableName, batch);
          pageInserted += batch.length;
        }
        totalStored += flattenedData.length;
        logger.info(`Page ${pageNumber}: inserted ${pageInserted} records into ${tableName} (total: ${totalStored})`);

        // Collect nested data for later processing
        for (const nested of nestedTables) {
          const { nestedKey, parentKey } = nested;
          const extracted = this.schema.extractNestedData(pageData, parentKey, nestedKey);
          if (extracted.length) {
            allNestedData.push({ nested, data: extracted });
          }
        }
      };

      await this.fetchPaginated(path, params, tableName, onPageFetched);

      if (totalStored === 0) {
        logger.info(`No data to store for ${tableName}`);
        return;
      }

      // Process nested tables after main table is complete
      for (const { nested, data } of allNestedData) {
        const { childTable } = nested;
        const flattenedNested = data.map((row) => this.schema.flattenRow(row));

        if (flattenedNested.length) {
          await this.schema.ensureTable(childTable, flattenedNested[0]);

          for (let i = 0; i < flattenedNested.length; i += batchSize) {
            const batch = flattenedNested.slice(i, i + batchSize);
            await this.db.insertBatch(childTable, batch);
          }
        }
      }

      logger.info(`Completed storing ${totalStored} records for ${tableName}`);
    } catch (error) {
      logger.error(`Failed to fetch/store ${tableName}`, { error: error.message });
      throw error;
    }
  }
}

module.exports = Fetcher;
