const MySQLAdapter = require('./mysql-adapter');
const PostgresAdapter = require('./postgres-adapter');
const dbConfig = require('../config/database');

function createAdapter(provider = dbConfig.provider) {
  switch (provider.toLowerCase()) {
    case 'mysql':
      return new MySQLAdapter(dbConfig.mysql);
    case 'postgres':
    case 'postgresql':
      return new PostgresAdapter(dbConfig.postgres);
    default:
      throw new Error(`Unknown database provider: ${provider}`);
  }
}

module.exports = { createAdapter };
