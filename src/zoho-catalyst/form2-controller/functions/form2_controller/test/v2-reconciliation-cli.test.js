"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const script = path.resolve(__dirname, "../../../scripts/reconcile-development-v2-v3.js");

function row(index, status) {
  return { reference: index.toString(16).padStart(64, "0"), status };
}

function input() {
  return JSON.stringify({
    legacySessions: [row(1, "expired")],
    targetSessions: [row(1, "expired")],
    legacyPrefills: [row(2, "ready")],
    targetPrefills: [row(2, "ready")],
    legacySubmissions: [],
    targetSubmissions: [],
    destinationCounts: { sessions: 0, prefills: 0, submissions: 0, proofs: 0 },
  });
}

test("the reconciliation CLI emits only sanitized counts and one opaque digest", () => {
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    input: input(),
    timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.strategy, "additive-v3-zero-promotion");
  assert.match(output.sourceReferenceDigest, /^[a-f0-9]{64}$/);
  assert.equal(output.counts.promoted_sessions, 0);
  assert.equal(result.stdout.includes("reference"), false);
  assert.equal(result.stdout.includes("email"), false);
});

test("the reconciliation CLI rejects arguments and nonempty v3 destinations", () => {
  const argument = spawnSync(process.execPath, [script, "--apply"], {
    encoding: "utf8",
    input: input(),
    timeout: 5_000,
  });
  assert.notEqual(argument.status, 0);
  assert.match(argument.stderr, /read-only and accepts no arguments/);

  const nonempty = JSON.parse(input());
  nonempty.destinationCounts.proofs = 1;
  const rejected = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    input: JSON.stringify(nonempty),
    timeout: 5_000,
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /destinations must be empty/);
});
