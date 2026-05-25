/**
 * Centralized Logger
 * Structured JSON output in production; human-friendly in development.
 * Attaches requestId for distributed tracing.
 */

const isProd = process.env.NODE_ENV === 'production';
const LOG_LEVEL = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[LOG_LEVEL] ?? LEVELS.info;

const shouldLog = (level) => (LEVELS[level] ?? 0) <= currentLevel;

const formatProd = (level, message, meta = {}) => {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...meta,
  });
};

const formatDev = (level, message, meta = {}) => {
  const icons = { error: '❌', warn: '⚠️ ', info: 'ℹ️ ', debug: '🐛' };
  const icon = icons[level] || '  ';
  const ts = new Date().toISOString().slice(11, 23);
  const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  return `${icon} [${ts}] ${message}${metaStr}`;
};

const format = isProd ? formatProd : formatDev;

const log = (level, message, meta = {}) => {
  if (!shouldLog(level)) return;
  const output = format(level, message, meta);
  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
};

const logger = {
  error: (msg, meta) => log('error', msg, meta),
  warn:  (msg, meta) => log('warn',  msg, meta),
  info:  (msg, meta) => log('info',  msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),

  /** Create a child logger that always includes the given context fields */
  child: (context = {}) => ({
    error: (msg, meta) => log('error', msg, { ...context, ...meta }),
    warn:  (msg, meta) => log('warn',  msg, { ...context, ...meta }),
    info:  (msg, meta) => log('info',  msg, { ...context, ...meta }),
    debug: (msg, meta) => log('debug', msg, { ...context, ...meta }),
  }),

  /** Create a request-scoped child logger */
  forRequest: (req) => logger.child({
    requestId: req?.requestId,
    method: req?.method,
    url: req?.originalUrl,
  }),
};

module.exports = logger;
