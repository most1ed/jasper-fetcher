const { Pool } = require('pg');
const logger = require('../utils/logger');

class PostgresAdapter {
  constructor(config) {
    this.config = config;
    this.pool = null;
  }

  async connect() {
    this.pool = new Pool(this.config);
    logger.info('PostgreSQL connection pool created');
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      logger.info('PostgreSQL connection pool closed');
    }
  }

  async ping() {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (err) {
      logger.warn('PostgreSQL connection check failed', { error: err.message });
      return false;
    }
  }

  async ensureConnected() {
    if (!this.pool) {
      await this.connect();
      return;
    }
    const isAlive = await this.ping();
    if (!isAlive) {
      logger.info('Reconnecting to PostgreSQL...');
      try {
        await this.pool.end();
      } catch (e) {
        // ignore
      }
      await this.connect();
    }
  }

  async getColumns(tableName) {
    try {
      const result = await this.pool.query(
        `SELECT column_name as name, data_type as type
         FROM information_schema.columns
         WHERE table_name = $1`,
        [tableName]
      );
      return result.rows;
    } catch (err) {
      return [];
    }
  }

  async tableExists(tableName) {
    const result = await this.pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name = $1`,
      [tableName]
    );
    return result.rows.length > 0;
  }

  inferColumnType(value) {
    if (value === null || value === undefined) return 'TEXT';
    if (typeof value === 'boolean') return 'BOOLEAN';
    if (typeof value === 'number') {
      // Always use NUMERIC to handle both integers and decimals safely
      return 'NUMERIC(20,6)';
    }
    if (value instanceof Date) return 'TIMESTAMP';
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'DATE';
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) return 'TIMESTAMP';
      if (value.length > 255) return 'TEXT';
      return 'VARCHAR(255)';
    }
    if (typeof value === 'object') return 'JSONB';
    return 'TEXT';
  }

  async createTable(tableName, sampleRow) {
    const columns = Object.entries(sampleRow)
      .filter(([key, val]) => typeof val !== 'object' || val === null)
      .map(([key, val]) => {
        const type = this.inferColumnType(val);
        return `"${key}" ${type}`;
      });

    columns.unshift('"_id" BIGSERIAL PRIMARY KEY');
    columns.push('"_fetched_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

    const sql = `CREATE TABLE IF NOT EXISTS "${tableName}" (${columns.join(', ')})`;
    logger.debug('Creating table', { sql });
    await this.pool.query(sql);
    logger.info(`Table ${tableName} created`);
  }

  async addMissingColumns(tableName, sampleRow) {
    const existingColumns = await this.getColumns(tableName);
    const existingNames = new Set(existingColumns.map((c) => c.name.toLowerCase()));

    for (const [key, val] of Object.entries(sampleRow)) {
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) continue;
      if (Array.isArray(val)) continue;

      if (!existingNames.has(key.toLowerCase())) {
        const type = this.inferColumnType(val);
        const sql = `ALTER TABLE "${tableName}" ADD COLUMN "${key}" ${type}`;
        logger.info(`Adding column ${key} to ${tableName}`);
        await this.pool.query(sql);
      }
    }
  }

  async insertBatch(tableName, rows) {
    if (!rows.length) return;

    const columns = Object.keys(rows[0]).filter((key) => {
      const val = rows[0][key];
      return !(typeof val === 'object' && val !== null);
    });

    let paramIndex = 1;
    const placeholders = rows
      .map(() => `(${columns.map(() => `$${paramIndex++}`).join(', ')})`)
      .join(', ');

    const values = rows.flatMap((row) =>
      columns.map((col) => {
        const val = row[col];
        if (val === undefined) return null;
        return val;
      })
    );

    const sql = `INSERT INTO "${tableName}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES ${placeholders}`;
    await this.pool.query(sql, values);
    logger.info(`Inserted ${rows.length} rows into ${tableName}`);
  }

  async truncateTable(tableName) {
    await this.pool.query(`TRUNCATE TABLE "${tableName}" RESTART IDENTITY`);
    logger.info(`Truncated table ${tableName}`);
  }
}

module.exports = PostgresAdapter;
