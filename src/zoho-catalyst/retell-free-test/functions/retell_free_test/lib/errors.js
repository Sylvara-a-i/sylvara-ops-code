'use strict';

class FreeTestError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'FreeTestError';
    this.code = code;
    this.httpStatus = options.httpStatus || 400;
    this.retryable = Boolean(options.retryable);
    this.ambiguous = Boolean(options.ambiguous);
    this.safeDetails = options.safeDetails || undefined;
  }
}

function invariant(condition, code, message, options) {
  if (!condition) throw new FreeTestError(code, message, options);
}

module.exports = { FreeTestError, invariant };
