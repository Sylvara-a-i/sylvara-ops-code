'use strict';

class MigrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function invariant(condition, code, message, details) {
  if (!condition) throw new MigrationError(code, message, details);
}

module.exports = { MigrationError, invariant };
