require('dotenv').config();

const logger = require('./utils/logger');
const { createAdapterWithTunnel, closeTunnel } = require('./database/adapter-factory');
const ApiClient = require('./services/api-client');
const Fetcher = require('./services/fetcher');
const endpoints = require('./endpoints/definitions');

// Office codes configuration
const OFFICE_CODES = [
  { code: 'BCTN', name: 'BCTN PEKANBARU' },
  { code: 'BCTN/JKT', name: 'BCTN JAKARTA' },
  { code: 'BCTN/JMB', name: 'BCTN JAMBI' },
  { code: 'BCTN MDN', name: 'BCTN MEDAN' },
  { code: 'BCTN/KMP', name: 'BCTN KAMPAR' },
  { code: 'BCTN/SBY', name: 'BCTN SURABAYA' },
];

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

// Truncate all jasper_* tables
async function truncateAllTables(db) {
  logger.info('Truncating all jasper_* tables before fetch...');

  let tables = [];

  if (process.env.DB_PROVIDER === 'postgres') {
    const result = await db.pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'jasper_%'`
    );
    tables = result.rows.map(r => r.table_name);
  } else {
    const [rows] = await db.pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = ? AND table_name LIKE 'jasper_%'`,
      [process.env.DB_NAME]
    );
    tables = rows.map(r => r.TABLE_NAME || r.table_name);
  }

  if (tables.length === 0) {
    logger.info('No jasper_* tables found to truncate');
    return;
  }

  logger.info(`Found ${tables.length} tables to truncate: ${tables.join(', ')}`);

  for (const table of tables) {
    if (process.env.DB_PROVIDER === 'postgres') {
      await db.pool.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY`);
    } else {
      await db.pool.query(`TRUNCATE TABLE \`${table}\``);
    }
    logger.info(`Truncated: ${table}`);
  }

  logger.info('All tables truncated successfully');
}

async function main() {
  const apiUrl = process.env.JASPER_API_URL;
  const apiKey = process.env.JASPER_API_KEY;
  const dateRangeMode = process.env.DATE_RANGE_MODE || 'static';
  const skipCleanup = process.argv.includes('--no-cleanup');

  if (!apiUrl || !apiKey) {
    logger.error('Missing JASPER_API_URL or JASPER_API_KEY in environment');
    process.exit(1);
  }

  const dateRanges = calculateDateRanges();

  logger.info('='.repeat(70));
  logger.info('Starting Jasper API Fetcher - ALL OFFICES');
  logger.info('='.repeat(70));
  logger.info(`API URL: ${apiUrl}`);
  logger.info(`Database provider: ${process.env.DB_PROVIDER || 'mysql'}`);
  logger.info(`Date Range Mode: ${dateRangeMode}`);
  logger.info(`Total date ranges: ${dateRanges.length}`);
  logger.info(`Office codes: ${OFFICE_CODES.map(o => o.code).join(', ')}`);

  const db = await createAdapterWithTunnel();
  const api = new ApiClient(apiUrl, apiKey);
  const fetcher = new Fetcher(api, db);

  const results = {
    success: [],
    failed: [],
    skipped: [],
  };

  const startTime = new Date();

  try {
    await db.connect();

    // Truncate all tables before starting (unless --no-cleanup flag)
    if (!skipCleanup) {
      await truncateAllTables(db);
    } else {
      logger.info('Skipping cleanup (--no-cleanup flag)');
    }

    // Process each office code
    for (const office of OFFICE_CODES) {
      logger.info('');
      logger.info('='.repeat(70));
      logger.info(`Processing office: ${office.code} (${office.name})`);
      logger.info('='.repeat(70));

      for (const endpoint of endpoints) {
        // For non-date endpoints, fetch once
        if (!endpoint.requiresDate) {
          const params = { ...endpoint.params, office_code: office.code };

          try {
            logger.info(`[${office.code}] Processing: ${endpoint.path} -> ${endpoint.tableName}`);
            await fetcher.fetchAndStore({ ...endpoint, params });
            results.success.push(`${office.code}:${endpoint.tableName}`);
          } catch (error) {
            logger.error(`[${office.code}] Failed: ${endpoint.tableName}`, { error: error.message });
            results.failed.push({ office: office.code, table: endpoint.tableName, error: error.message });
          }
          continue;
        }

        // For date-required endpoints, fetch each date range separately
        for (const range of dateRanges) {
          if (!range.dateFrom || !range.dateTo) {
            logger.warn(`[${office.code}] Skipping ${endpoint.tableName}: DATE_FROM and DATE_TO required`);
            results.skipped.push(`${office.code}:${endpoint.tableName}`);
            continue;
          }

          const params = {
            ...endpoint.params,
            office_code: office.code,
            date_from: range.dateFrom,
            date_to: range.dateTo,
          };

          try {
            logger.info(`[${office.code}] Processing: ${endpoint.path} -> ${endpoint.tableName} [${range.label}]`);
            await fetcher.fetchAndStore({ ...endpoint, params });
            results.success.push(`${office.code}:${endpoint.tableName}[${range.label}]`);
          } catch (error) {
            logger.error(`[${office.code}] Failed: ${endpoint.tableName} [${range.label}]`, { error: error.message });
            results.failed.push({ office: office.code, table: endpoint.tableName, range: range.label, error: error.message });
          }
        }
      }
    }

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000 / 60).toFixed(2);

    logger.info('');
    logger.info('='.repeat(70));
    logger.info('FETCH ALL OFFICES COMPLETED');
    logger.info('='.repeat(70));
    logger.info(`Duration: ${duration} minutes`);
    logger.info(`Success: ${results.success.length} operations`);
    logger.info(`Failed: ${results.failed.length} operations`);
    logger.info(`Skipped: ${results.skipped.length} operations`);

    if (results.failed.length > 0) {
      logger.error('Failed operations:', results.failed);
    }
  } catch (error) {
    logger.error('Fatal error', { error: error.message, stack: error.stack });
    process.exit(1);
  } finally {
    await db.disconnect();
    await closeTunnel();
  }
}

main();
