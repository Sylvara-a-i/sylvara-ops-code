"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { safeLog } = require("../lib/redact");

test("runtime logging emits only the fixed sanitized schema", () => {
  const output = [];
  const logger = {
    info(line) { output.push(line); },
    error(line) { output.push(line); },
  };
  safeLog(logger, "error", {
    requestId: "request_sample_001",
    sourceRevision: "test-revision-001",
    stage: "delivery",
    outcome: "reconciliation_required",
    elapsedMs: 42,
    retryCount: 0,
    rawBody: "person@example.invalid",
    signature: "<synthetic-signature-value>",
    endpoint: "https://private.example.invalid/path",
  });
  const parsed = JSON.parse(output[0]);
  assert.deepEqual(Object.keys(parsed), [
    "request_id",
    "source_revision",
    "stage",
    "outcome",
    "elapsed_ms",
  ]);
  assert.doesNotMatch(output[0], /person@|signature|private\.example|retry_count/);
});
