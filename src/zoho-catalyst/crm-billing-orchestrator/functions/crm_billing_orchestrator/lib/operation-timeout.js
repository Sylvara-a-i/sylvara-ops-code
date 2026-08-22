"use strict";

class OperationTimeoutError extends Error {
  constructor(message, { ambiguous = false } = {}) {
    super(message);
    this.name = "OperationTimeoutError";
    this.publicCode = "dependency_timeout";
    this.ambiguous = ambiguous;
  }
}

async function withOperationTimeout(operation, timeoutMs, { ambiguous = false } = {}) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(
          new OperationTimeoutError("Platform operation timed out", { ambiguous }),
        ), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { OperationTimeoutError, withOperationTimeout };

