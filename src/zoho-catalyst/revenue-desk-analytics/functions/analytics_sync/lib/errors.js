'use strict';

class AnalyticsSyncError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AnalyticsSyncError';
    this.code = code;
    this.retryable = options.retryable === true;
    this.ambiguous = options.ambiguous === true;
  }
}

function invariant(condition, code, message, options) {
  if (!condition) throw new AnalyticsSyncError(code, message, options);
}

function classified(error, fallbackCode = 'ANALYTICS_SYNC_UNKNOWN') {
  if (error instanceof AnalyticsSyncError) return error;
  return new AnalyticsSyncError(fallbackCode, 'Analytics synchronization failed with an unknown outcome.', {
    cause: error,
    ambiguous: true,
  });
}

module.exports = { AnalyticsSyncError, invariant, classified };
