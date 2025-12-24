const MySQLAdapter = require('./mysql-adapter');
const PostgresAdapter = require('./postgres-adapter');
const dbConfig = require('../config/database');
const { createSSHTunnel, closeSSHTunnel } = require('../utils/ssh-tunnel');
const logger = require('../utils/logger');

let tunnelInfo = null;

async function createAdapterWithTunnel(provider = dbConfig.provider) {
  // Check if SSH tunnel is enabled
  if (process.env.SSH_TUNNEL_ENABLED === 'true') {
    tunnelInfo = await createSSHTunnel();
  }

  const config = provider.toLowerCase() === 'mysql' ? { ...dbConfig.mysql } : { ...dbConfig.postgres };

  // Override host/port if tunnel is active
  if (tunnelInfo) {
    config.host = tunnelInfo.host;
    config.port = tunnelInfo.port;
    logger.info(`Database will connect via SSH tunnel: ${config.host}:${config.port}`);
  }

  switch (provider.toLowerCase()) {
    case 'mysql':
      return new MySQLAdapter(config);
    case 'postgres':
    case 'postgresql':
      return new PostgresAdapter(config);
    default:
      throw new Error(`Unknown database provider: ${provider}`);
  }
}

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

async function closeTunnel() {
  await closeSSHTunnel();
  tunnelInfo = null;
}

module.exports = { createAdapter, createAdapterWithTunnel, closeTunnel };
