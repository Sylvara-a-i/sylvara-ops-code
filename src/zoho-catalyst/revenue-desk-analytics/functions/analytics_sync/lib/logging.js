'use strict';

const ALLOWED_FIELDS = new Set([
  'event', 'state', 'mode', 'environment', 'sourceRevision', 'examined', 'claimed',
  'submitted', 'pending', 'reconciled', 'retryRequired', 'failed', 'contention',
]);

function safeFields(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (ALLOWED_FIELDS.has(key)
      && (typeof value === 'string' || typeof value === 'boolean'
        || (typeof value === 'number' && Number.isSafeInteger(value)))) result[key] = value;
  }
  return result;
}

function createSafeConsoleLogger(consoleLike) {
  function write(level, fields) {
    const method = typeof consoleLike?.[level] === 'function'
      ? consoleLike[level].bind(consoleLike) : consoleLike?.log?.bind(consoleLike);
    if (method) method(JSON.stringify(safeFields(fields)));
  }
  return Object.freeze({
    info: (fields) => write('info', fields),
    warn: (fields) => write('warn', fields),
    error: (fields) => write('error', fields),
  });
}

module.exports = { createSafeConsoleLogger, safeFields };
