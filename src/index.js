require('dotenv').config();

const logger = require('./utils/logger');
const { createAdapterWithTunnel, closeTunnel } = require('./database/adapter-factory');
const ApiClient = require('./services/api-client');
const Fetcher = require('./services/fetcher');
const endpoints = require('./endpoints/definitions');

// Format date as YYYY-MM-DD in local timezone
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Generate month ranges for a given year
function getMonthRanges(year) {
  const ranges = [];
  for (let month = 0; month < 12; month++) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    ranges.push({
      dateFrom: formatDate(firstDay),
      dateTo: formatDate(lastDay),
      label: `${year}-${String(month + 1).padStart(2, '0')}`,
    });
  }
  return ranges;
}

// Calculate date ranges based on DATE_RANGE_MODE
function calculateDateRanges() {
  const mode = process.env.DATE_RANGE_MODE || 'static';
  const now = new Date();

  if (mode === 'yearly_by_month') {
    const year = parseInt(process.env.DATE_RANGE_YEAR || now.getFullYear(), 10);
    return getMonthRanges(year);
  }

  if (mode === 'previous_year_by_month') {
    return getMonthRanges(now.getFullYear() - 1);
  }

  if (mode === 'previous_month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    return [{
      dateFrom: formatDate(firstDay),
      dateTo: formatDate(lastDay),
      label: 'previous_month',
    }];
  }

  if (mode === 'current_month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    return [{
      dateFrom: formatDate(firstDay),
      dateTo: formatDate(now),
      label: 'current_month',
    }];
  }

  if (mode === 'ytd_by_month') {
    const ranges = [];
    for (let month = 0; month <= now.getMonth(); month++) {
      const firstDay = new Date(now.getFullYear(), month, 1);
      const lastDay = month === now.getMonth() ? now : new Date(now.getFullYear(), month + 1, 0);
      ranges.push({
        dateFrom: formatDate(firstDay),
        dateTo: formatDate(lastDay),
        label: `${now.getFullYear()}-${String(month + 1).padStart(2, '0')}`,
      });
    }
    return ranges;
  }

  if (mode === 'last_n_days') {
    const days = parseInt(process.env.DATE_RANGE_DAYS || '30', 10);
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);
    return [{
      dateFrom: formatDate(startDate),
      dateTo: formatDate(now),
      label: `last_${days}_days`,
    }];
  }

  // Static mode
  return [{
    dateFrom: process.env.DATE_FROM,
    dateTo: process.env.DATE_TO,
    label: 'static',
  }];
}

async function main() {
  const apiUrl = process.env.JASPER_API_URL;
  const apiKey = process.env.JASPER_API_KEY;
  const officeCode = process.env.OFFICE_CODE;
  const dateRangeMode = process.env.DATE_RANGE_MODE || 'static';

  if (!apiUrl || !apiKey) {
    logger.error('Missing JASPER_API_URL or JASPER_API_KEY in environment');
    process.exit(1);
  }

  const dateRanges = calculateDateRanges();

  logger.info('Starting Jasper API Fetcher');
  logger.info(`API URL: ${apiUrl}`);
  logger.info(`Database provider: ${process.env.DB_PROVIDER || 'mysql'}`);
  if (officeCode) logger.info(`Office Code: ${officeCode}`);
  logger.info(`Date Range Mode: ${dateRangeMode}`);
  logger.info(`Total date ranges to process: ${dateRanges.length}`);

  const db = await createAdapterWithTunnel();
  const api = new ApiClient(apiUrl, apiKey);
  const fetcher = new Fetcher(api, db);

  try {
    await db.connect();

    const endpointsToFetch = process.argv[2]
      ? endpoints.filter((e) => e.tableName.includes(process.argv[2]))
      : endpoints;

    logger.info(`Fetching ${endpointsToFetch.length} endpoints`);

    for (const endpoint of endpointsToFetch) {
      // For non-date endpoints, fetch once
      if (!endpoint.requiresDate) {
        const params = { ...endpoint.params };
        if (officeCode) params.office_code = officeCode;

        logger.info(`Processing: ${endpoint.path} -> ${endpoint.tableName}`);
        await fetcher.fetchAndStore({ ...endpoint, params });
        continue;
      }

      // For date-required endpoints, fetch each date range separately
      for (const range of dateRanges) {
        if (!range.dateFrom || !range.dateTo) {
          logger.warn(`Skipping ${endpoint.tableName}: DATE_FROM and DATE_TO required`);
          continue;
        }

        const params = { ...endpoint.params };
        if (officeCode) params.office_code = officeCode;
        params.date_from = range.dateFrom;
        params.date_to = range.dateTo;

        logger.info(`Processing: ${endpoint.path} -> ${endpoint.tableName} [${range.label}] (${range.dateFrom} to ${range.dateTo})`);

        try {
          await fetcher.fetchAndStore({ ...endpoint, params });
        } catch (error) {
          logger.error(`Failed for ${endpoint.tableName} [${range.label}]`, { error: error.message });
        }
      }
    }

    logger.info('All endpoints processed successfully');
  } catch (error) {
    logger.error('Fatal error', { error: error.message, stack: error.stack });
    process.exit(1);
  } finally {
    await db.disconnect();
    await closeTunnel();
  }
}

main();
