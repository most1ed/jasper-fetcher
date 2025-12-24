require('dotenv').config();

const cron = require('node-cron');
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
// Returns array of date ranges (for month-by-month processing)
function calculateDateRanges() {
  const mode = process.env.DATE_RANGE_MODE || 'static';
  const now = new Date();

  if (mode === 'yearly_by_month') {
    // Fetch entire year, split by month
    const year = parseInt(process.env.DATE_RANGE_YEAR || now.getFullYear(), 10);
    return getMonthRanges(year);
  }

  if (mode === 'previous_year_by_month') {
    // Fetch previous year, split by month
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
    // Year to date, split by month
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

  // Static mode: use .env values
  return [{
    dateFrom: process.env.DATE_FROM,
    dateTo: process.env.DATE_TO,
    label: 'static',
  }];
}

async function runFetchJob() {
  const apiUrl = process.env.JASPER_API_URL;
  const apiKey = process.env.JASPER_API_KEY;
  const officeCode = process.env.OFFICE_CODE;

  const dateRangeMode = process.env.DATE_RANGE_MODE || 'static';
  const dateRanges = calculateDateRanges();

  if (!apiUrl || !apiKey) {
    logger.error('Missing JASPER_API_URL or JASPER_API_KEY in environment');
    return;
  }

  const startTime = new Date();
  logger.info('='.repeat(60));
  logger.info(`Starting scheduled fetch job at ${startTime.toISOString()}`);
  logger.info(`API URL: ${apiUrl}`);
  logger.info(`Database provider: ${process.env.DB_PROVIDER || 'mysql'}`);
  if (officeCode) logger.info(`Office Code: ${officeCode}`);
  logger.info(`Date Range Mode: ${dateRangeMode}`);
  logger.info(`Total date ranges to process: ${dateRanges.length}`);

  const db = await createAdapterWithTunnel();
  const api = new ApiClient(apiUrl, apiKey);
  const fetcher = new Fetcher(api, db);

  const results = {
    success: [],
    failed: [],
    skipped: [],
  };

  try {
    await db.connect();

    for (const endpoint of endpoints) {
      // For non-date endpoints, fetch once
      if (!endpoint.requiresDate) {
        const params = { ...endpoint.params };
        if (officeCode) params.office_code = officeCode;

        try {
          logger.info(`Processing: ${endpoint.path} -> ${endpoint.tableName}`);
          await fetcher.fetchAndStore({ ...endpoint, params });
          results.success.push(endpoint.tableName);
        } catch (error) {
          logger.error(`Failed: ${endpoint.tableName}`, { error: error.message });
          results.failed.push({ table: endpoint.tableName, error: error.message });
        }
        continue;
      }

      // For date-required endpoints, fetch each date range separately
      for (const range of dateRanges) {
        if (!range.dateFrom || !range.dateTo) {
          logger.warn(`Skipping ${endpoint.tableName}: DATE_FROM and DATE_TO required`);
          results.skipped.push(endpoint.tableName);
          continue;
        }

        const params = { ...endpoint.params };
        if (officeCode) params.office_code = officeCode;
        params.date_from = range.dateFrom;
        params.date_to = range.dateTo;

        try {
          logger.info(`Processing: ${endpoint.path} -> ${endpoint.tableName} [${range.label}] (${range.dateFrom} to ${range.dateTo})`);
          await fetcher.fetchAndStore({ ...endpoint, params });
          results.success.push(`${endpoint.tableName}[${range.label}]`);
        } catch (error) {
          logger.error(`Failed: ${endpoint.tableName} [${range.label}]`, { error: error.message });
          results.failed.push({ table: endpoint.tableName, range: range.label, error: error.message });
        }
      }
    }

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000 / 60).toFixed(2);

    logger.info('='.repeat(60));
    logger.info(`Scheduled job completed in ${duration} minutes`);
    logger.info(`Success: ${results.success.length} endpoints`);
    logger.info(`Failed: ${results.failed.length} endpoints`);
    logger.info(`Skipped: ${results.skipped.length} endpoints`);

    if (results.failed.length > 0) {
      logger.error('Failed endpoints:', results.failed);
    }
  } catch (error) {
    logger.error('Fatal error in scheduled job', { error: error.message });
  } finally {
    await db.disconnect();
    await closeTunnel();
  }

  return results;
}

// Schedule configuration
const SCHEDULE = process.env.CRON_SCHEDULE || '0 0 1 * *'; // Default: 1st of every month at midnight

logger.info('Jasper API Fetcher Scheduler');
logger.info(`Schedule: ${SCHEDULE}`);
logger.info('Press Ctrl+C to stop');
logger.info('='.repeat(60));

// Validate cron expression
if (!cron.validate(SCHEDULE)) {
  logger.error(`Invalid cron schedule: ${SCHEDULE}`);
  process.exit(1);
}

// Schedule the job
cron.schedule(SCHEDULE, async () => {
  logger.info('Cron job triggered');
  await runFetchJob();
});

// Run immediately if --now flag is passed
if (process.argv.includes('--now')) {
  logger.info('Running job immediately (--now flag detected)');
  runFetchJob().then(() => {
    logger.info('Immediate job completed');
  });
}

// Keep the process running
process.on('SIGINT', () => {
  logger.info('Scheduler stopped');
  process.exit(0);
});
