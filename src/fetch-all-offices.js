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

// Tables to skip (shared across all offices, not office-specific)
const SKIP_TABLES = ['jasper_item', 'jasper_item_group'];

// Format date as YYYY-MM-DD in local timezone
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Fixed date range configuration (not from .env)
const DATE_RANGE_START = { year: 2024, month: 1 };  // January 2024
const DATE_RANGE_END = { year: 2026, month: 1 };    // January 2026

// Generate month ranges from start to end (inclusive)
function calculateDateRanges() {
  const ranges = [];
  let year = DATE_RANGE_START.year;
  let month = DATE_RANGE_START.month - 1; // 0-indexed

  while (year < DATE_RANGE_END.year || (year === DATE_RANGE_END.year && month < DATE_RANGE_END.month)) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    ranges.push({
      dateFrom: formatDate(firstDay),
      dateTo: formatDate(lastDay),
      label: `${year}-${String(month + 1).padStart(2, '0')}`,
    });

    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }

  return ranges;
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
  logger.info(`Date range: ${DATE_RANGE_START.year}-${String(DATE_RANGE_START.month).padStart(2, '0')} to ${DATE_RANGE_END.year}-${String(DATE_RANGE_END.month).padStart(2, '0')} (${dateRanges.length} months)`);
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
        // Skip shared tables (item, item_group - not office-specific)
        if (SKIP_TABLES.includes(endpoint.tableName)) {
          logger.info(`[${office.code}] Skipping ${endpoint.tableName} (shared data)`);
          continue;
        }

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
