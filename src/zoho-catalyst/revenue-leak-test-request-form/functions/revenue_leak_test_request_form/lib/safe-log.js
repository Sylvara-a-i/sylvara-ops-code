"use strict";

const SAFE_KEYS = Object.freeze(["requestId", "stage", "outcome", "elapsedMs"]);

function safeLog(logger, level, event) {
  const safe = Object.create(null);
  for (const key of SAFE_KEYS) {
    if (event?.[key] !== undefined) safe[key] = event[key];
  }
  const method = typeof logger?.[level] === "function" ? logger[level] : logger?.log;
  if (typeof method === "function") method.call(logger, JSON.stringify(safe));
}

module.exports = { safeLog };
