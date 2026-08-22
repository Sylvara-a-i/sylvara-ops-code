"use strict";

const LEVELS = new Set(["info", "error"]);
const STAGES = new Set(["request", "crm_read", "claim", "billing", "crm_write", "readback"]);
const TOKEN = /^[a-z0-9_]{1,80}$/;
const REVISION = /^(?:[a-f0-9]{40}|unavailable)$/;
const REQUEST_ID = /^[0-9a-f-]{36}$/i;

function safeLog(logger, level, event) {
  if (!LEVELS.has(level) || typeof logger?.[level] !== "function") return;
  const keys = Object.keys(event ?? {}).sort();
  const expected = ["action", "elapsedMs", "outcome", "requestId", "sourceRevision", "stage"];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) return;
  if (
    !REQUEST_ID.test(event.requestId) ||
    !REVISION.test(event.sourceRevision) ||
    !STAGES.has(event.stage) ||
    !TOKEN.test(event.action) ||
    !TOKEN.test(event.outcome) ||
    !Number.isSafeInteger(event.elapsedMs) ||
    event.elapsedMs < 0 ||
    event.elapsedMs > 120000
  ) return;
  logger[level](JSON.stringify(event));
}

module.exports = { safeLog };

