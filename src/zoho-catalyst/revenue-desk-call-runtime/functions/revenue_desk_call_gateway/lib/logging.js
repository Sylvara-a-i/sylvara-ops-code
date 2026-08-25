'use strict';

const TEXT_FIELDS = Object.freeze({
  event: /^[a-z][a-z0-9_]{0,63}$/,
  correlationId: /^corr_[a-f0-9]{32}$/,
  errorCode: /^[A-Z][A-Z0-9_]{0,63}$/,
  route: /^(?:inbound|events|readiness|unknown)$/,
  eventType: /^(?:call_ended|call_analyzed)$/,
  state: /^[A-Za-z][A-Za-z0-9]{0,39}$/,
});
const COUNT_FIELDS = Object.freeze(new Set([
  'eventCount', 'notificationCount', 'reconciliationRequired',
]));

function safeRecord(record) {
  const safe = {};
  if (record && typeof record === 'object' && !Array.isArray(record)) {
    for (const [name, pattern] of Object.entries(TEXT_FIELDS)) {
      if (typeof record[name] === 'string' && pattern.test(record[name])) safe[name] = record[name];
    }
    if (Number.isInteger(record.status) && record.status >= 100 && record.status <= 599) {
      safe.status = record.status;
    }
    for (const name of COUNT_FIELDS) {
      if (Number.isSafeInteger(record[name]) && record[name] >= 0 && record[name] <= 100_000) {
        safe[name] = record[name];
      }
    }
  }
  if (!safe.event) safe.event = 'runtime_log';
  return safe;
}

/**
 * Emits one-line JSON containing only reviewed opaque identifiers and bounded
 * operational fields. Arbitrary payload, caller, recipient, and header fields
 * are discarded before the console boundary.
 */
function createSafeConsoleLogger(consoleLike = console) {
  function write(level, record) {
    const output = JSON.stringify({ level, ...safeRecord(record) });
    const sink = typeof consoleLike[level] === 'function' ? consoleLike[level]
      : typeof consoleLike.log === 'function' ? consoleLike.log : null;
    if (sink) sink.call(consoleLike, output);
  }
  return Object.freeze({
    info(record) { write('info', record); },
    warn(record) { write('warn', record); },
    error(record) { write('error', record); },
  });
}

module.exports = { createSafeConsoleLogger, safeRecord };
