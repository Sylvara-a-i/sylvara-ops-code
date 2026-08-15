"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { safeLog } = require("../lib/safe-log");

test("emits only the fixed operational allowlist", () => {
  const lines = [];
  safeLog({ info: (line) => lines.push(line) }, "info", {
    requestId: "synthetic-request",
    sourceRevision: "a".repeat(40),
    stage: "prefill",
    outcome: "completed",
    elapsedMs: 12,
    token: "must-not-appear",
    customerEmail: "must-not-appear",
  });
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    requestId: "synthetic-request",
    sourceRevision: "a".repeat(40),
    stage: "prefill",
    outcome: "completed",
    elapsedMs: 12,
  });
  assert.doesNotMatch(lines[0], /must-not-appear/);
});
