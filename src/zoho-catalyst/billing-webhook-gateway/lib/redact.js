"use strict";

function boundedInteger(value, maximum = 3600000) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0
    ? Math.min(number, maximum)
    : 0;
}

function safeLog(logger, level, event) {
  const method = level === "error" ? "error" : "info";
  const record = {
    request_id: String(event.requestId ?? "unknown").slice(0, 64),
    source_revision: String(event.sourceRevision ?? "unknown").slice(0, 80),
    stage: String(event.stage ?? "unknown").slice(0, 40),
    outcome: String(event.outcome ?? "unknown").slice(0, 40),
    elapsed_ms: boundedInteger(event.elapsedMs),
  };
  logger[method](JSON.stringify(record));
}

function publicError(status, code) {
  return {
    status,
    body: {
      ok: false,
      code,
    },
  };
}

module.exports = { publicError, safeLog };
