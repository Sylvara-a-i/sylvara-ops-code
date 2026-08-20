"use strict";

const SAFE_KEYS = Object.freeze([
  "requestId",
  "sourceRevision",
  "stage",
  "outcome",
  "elapsedMs",
]);

function safeLog(logger, level, event) {
  const clean = Object.create(null);
  for (const key of SAFE_KEYS) {
    if (event[key] !== undefined) clean[key] = event[key];
  }
  const method = typeof logger?.[level] === "function" ? logger[level] : logger?.log;
  if (typeof method === "function") method.call(logger, JSON.stringify(clean));
}

module.exports = { safeLog };
