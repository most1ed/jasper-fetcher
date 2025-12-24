require('dotenv').config();

const cron = require('node-cron');
const logger = require('./utils/logger');
const { createAdapter } = require('./database/adapter-factory');
const ApiClient = require('./services/api-client');
const Fetcher = require('./services/fetcher');
const endpoints = require('./endpoints/definitions');

// Generate month ranges for a given year
function getMonthRanges(year) {
  const ranges = [];
  for (let month = 0; month < 12; month++) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    ranges.push({
      dateFrom: firstDay.toISOString().split('T')[0],
      dateTo: lastDay.toISOString().split('T')[0],
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
      dateFrom: firstDay.toISOString().split('T')[0],
      dateTo: lastDay.toISOString().split('T')[0],
      label: 'previous_month',
    }];
  }

  if (mode === 'current_month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    return [{
      dateFrom: firstDay.toISOString().split('T')[0],
      dateTo: now.toISOString().split('T')[0],
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
        dateFrom: firstDay.toISOString().split('T')[0],
        dateTo: lastDay.toISOString().split('T')[0],
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
      dateFrom: startDate.toISOString().split('T')[0],
      dateTo: now.toISOString().split('T')[0],
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

  // Calculate date range dynamically
  const { dateFrom, dateTo } = calculateDateRange();

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
  logger.info(`Date Range: ${dateFrom} to ${dateTo} (mode: ${process.env.DATE_RANGE_MODE || 'static'})`);

  const db = createAdapter();
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
      const params = { ...endpoint.params };

      if (officeCode) {
        params.office_code = officeCode;
      }

      // Add date params for report endpoints
      if (endpoint.requiresDate) {
        if (!dateFrom || !dateTo) {
          logger.warn(`Skipping ${endpoint.tableName}: DATE_FROM and DATE_TO required`);
          results.skipped.push(endpoint.tableName);
          continue;
        }
        params.date_from = dateFrom;
        params.date_to = dateTo;
      }

      try {
        logger.info(`Processing: ${endpoint.path} -> ${endpoint.tableName}`);
        await fetcher.fetchAndStore({ ...endpoint, params });
        results.success.push(endpoint.tableName);
      } catch (error) {
        logger.error(`Failed: ${endpoint.tableName}`, { error: error.message });
        results.failed.push({ table: endpoint.tableName, error: error.message });
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
