const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL] || LOG_LEVELS.INFO;

function formatTime() {
  return new Date().toISOString();
}

function log(level, message, data = null) {
  if (LOG_LEVELS[level] < currentLevel) return;

  const prefix = `[${formatTime()}] [${level}]`;
  if (data) {
    console.log(prefix, message, JSON.stringify(data, null, 2));
  } else {
    console.log(prefix, message);
  }
}

module.exports = {
  debug: (msg, data) => log('DEBUG', msg, data),
  info: (msg, data) => log('INFO', msg, data),
  warn: (msg, data) => log('WARN', msg, data),
  error: (msg, data) => log('ERROR', msg, data),
};
