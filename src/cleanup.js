require('dotenv').config();

const logger = require('./utils/logger');
const { createAdapterWithTunnel, closeTunnel } = require('./database/adapter-factory');

async function cleanup() {
  const mode = process.argv[2] || 'truncate'; // truncate or drop
  const targetTable = process.argv[3]; // Optional: specific table name

  logger.info('Jasper Data Cleanup');
  logger.info(`Mode: ${mode}`);
  logger.info(`Database: ${process.env.DB_NAME}`);
  if (targetTable) logger.info(`Target table: ${targetTable}`);

  const db = await createAdapterWithTunnel();

  try {
    await db.connect();

    let tables = [];

    if (targetTable) {
      // Target specific table
      const tableName = targetTable.startsWith('jasper_') ? targetTable : `jasper_${targetTable}`;
      tables = [tableName];
    } else {
      // Get all jasper_* tables
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
    }

    if (tables.length === 0) {
      logger.info('No jasper_* tables found');
      return;
    }

    logger.info(`Found ${tables.length} table(s): ${tables.join(', ')}`);

    for (const table of tables) {
      if (mode === 'drop') {
        if (process.env.DB_PROVIDER === 'postgres') {
          await db.pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
        } else {
          await db.pool.query(`DROP TABLE IF EXISTS \`${table}\``);
        }
        logger.info(`Dropped: ${table}`);
      } else {
        // truncate
        if (process.env.DB_PROVIDER === 'postgres') {
          await db.pool.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY`);
        } else {
          await db.pool.query(`TRUNCATE TABLE \`${table}\``);
        }
        logger.info(`Truncated: ${table}`);
      }
    }

    logger.info(`Cleanup completed: ${tables.length} table(s) ${mode === 'drop' ? 'dropped' : 'truncated'}`);
  } catch (error) {
    logger.error('Cleanup failed', { error: error.message });
    process.exit(1);
  } finally {
    await db.disconnect();
    await closeTunnel();
  }
}

cleanup();
