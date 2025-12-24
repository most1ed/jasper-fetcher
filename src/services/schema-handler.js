const logger = require('../utils/logger');

class SchemaHandler {
  constructor(dbAdapter) {
    this.db = dbAdapter;
  }

  async ensureTable(tableName, sampleRow) {
    if (!sampleRow) return;

    const exists = await this.db.tableExists(tableName);
    if (!exists) {
      await this.db.createTable(tableName, sampleRow);
    } else {
      await this.db.addMissingColumns(tableName, sampleRow);
    }
  }

  extractNestedData(rows, parentKey, nestedKey) {
    const nestedRows = [];
    for (const row of rows) {
      const nested = row[nestedKey];
      if (Array.isArray(nested)) {
        for (const item of nested) {
          nestedRows.push({
            ...item,
            [`_parent_${parentKey}`]: row[parentKey],
          });
        }
      }
    }
    return nestedRows;
  }

  flattenRow(row, prefix = '') {
    const result = {};
    for (const [key, value] of Object.entries(row)) {
      const newKey = prefix ? `${prefix}_${key}` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(result, this.flattenRow(value, newKey));
      } else if (!Array.isArray(value)) {
        result[newKey] = value;
      }
    }
    return result;
  }
}

module.exports = SchemaHandler;
