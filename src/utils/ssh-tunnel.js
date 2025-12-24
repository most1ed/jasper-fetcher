const { createTunnel } = require('tunnel-ssh');
const logger = require('./logger');

let activeTunnel = null;
let tunnelServer = null;

async function createSSHTunnel() {
  const sshEnabled = process.env.SSH_TUNNEL_ENABLED === 'true';

  if (!sshEnabled) {
    return null;
  }

  const sshHost = process.env.SSH_HOST;
  const sshPort = parseInt(process.env.SSH_PORT || '22', 10);
  const sshUser = process.env.SSH_USER;
  const sshPassword = process.env.SSH_PASSWORD;
  const sshPrivateKey = process.env.SSH_PRIVATE_KEY;

  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = parseInt(process.env.DB_PORT || '3306', 10);
  const localPort = parseInt(process.env.SSH_LOCAL_PORT || '33306', 10);

  if (!sshHost || !sshUser) {
    logger.error('SSH_HOST and SSH_USER are required for SSH tunnel');
    return null;
  }

  const tunnelOptions = {
    autoClose: false,
  };

  const serverOptions = {
    port: localPort,
  };

  const sshOptions = {
    host: sshHost,
    port: sshPort,
    username: sshUser,
  };

  // Use password or private key
  if (sshPassword) {
    sshOptions.password = sshPassword;
  } else if (sshPrivateKey) {
    const fs = require('fs');
    sshOptions.privateKey = fs.readFileSync(sshPrivateKey);
  }

  const forwardOptions = {
    srcAddr: '127.0.0.1',
    srcPort: localPort,
    dstAddr: dbHost,
    dstPort: dbPort,
  };

  logger.info(`Creating SSH tunnel: ${sshUser}@${sshHost}:${sshPort} -> ${dbHost}:${dbPort} (local:${localPort})`);

  try {
    const [server, client] = await createTunnel(
      tunnelOptions,
      serverOptions,
      sshOptions,
      forwardOptions
    );

    tunnelServer = server;
    activeTunnel = client;

    logger.info(`SSH tunnel established on localhost:${localPort}`);

    return {
      host: '127.0.0.1',
      port: localPort,
    };
  } catch (error) {
    logger.error('Failed to create SSH tunnel', { error: error.message });
    throw error;
  }
}

async function closeSSHTunnel() {
  if (tunnelServer) {
    tunnelServer.close();
    logger.info('SSH tunnel closed');
  }
  if (activeTunnel) {
    activeTunnel.end();
  }
  tunnelServer = null;
  activeTunnel = null;
}

module.exports = { createSSHTunnel, closeSSHTunnel };
