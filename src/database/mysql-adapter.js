const mysql = require('mysql2/promise');
const logger = require('../utils/logger');

class MySQLAdapter {
  constructor(config) {
    this.config = config;
    this.pool = null;
  }

  async connect() {
    this.pool = mysql.createPool({
      ...this.config,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
    logger.info('MySQL connection pool created');
  }

  async disconnect() {
    if (this.pool) {
      await this.pool.end();
      logger.info('MySQL connection pool closed');
    }
  }

  async ping() {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (err) {
      logger.warn('MySQL connection check failed', { error: err.message });
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
      logger.info('Reconnecting to MySQL...');
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
      const [rows] = await this.pool.query(
        `SELECT COLUMN_NAME as name, DATA_TYPE as type
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [this.config.database, tableName]
      );
      return rows;
    } catch (err) {
      return [];
    }
  }

  async tableExists(tableName) {
    const [rows] = await this.pool.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [this.config.database, tableName]
    );
    return rows.length > 0;
  }

  inferColumnType(value) {
    if (value === null || value === undefined) return 'TEXT';
    if (typeof value === 'boolean') return 'TINYINT(1)';
    if (typeof value === 'number') {
      // Always use DECIMAL to handle both integers and decimals safely
      return 'DECIMAL(20,6)';
    }
    if (value instanceof Date) return 'DATETIME';
    if (typeof value === 'string') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'DATE';
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) return 'DATETIME';
      if (value.length > 255) return 'TEXT';
      return 'VARCHAR(255)';
    }
    if (typeof value === 'object') return 'JSON';
    return 'TEXT';
  }

  async createTable(tableName, sampleRow) {
    const columns = Object.entries(sampleRow)
      .filter(([key, val]) => typeof val !== 'object' || val === null)
      .map(([key, val]) => {
        const type = this.inferColumnType(val);
        return `\`${key}\` ${type}`;
      });

    columns.unshift('`_id` BIGINT AUTO_INCREMENT PRIMARY KEY');
    columns.push('`_fetched_at` DATETIME DEFAULT CURRENT_TIMESTAMP');

    const sql = `CREATE TABLE IF NOT EXISTS \`${tableName}\` (${columns.join(', ')})`;
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
        const sql = `ALTER TABLE \`${tableName}\` ADD COLUMN \`${key}\` ${type}`;
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

    const placeholders = rows.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    const values = rows.flatMap((row) =>
      columns.map((col) => {
        const val = row[col];
        if (val === undefined) return null;
        return val;
      })
    );

    const sql = `INSERT INTO \`${tableName}\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES ${placeholders}`;
    await this.pool.query(sql, values);
    logger.info(`Inserted ${rows.length} rows into ${tableName}`);
  }

  async truncateTable(tableName) {
    await this.pool.query(`TRUNCATE TABLE \`${tableName}\``);
    logger.info(`Truncated table ${tableName}`);
  }
}

module.exports = MySQLAdapter;
