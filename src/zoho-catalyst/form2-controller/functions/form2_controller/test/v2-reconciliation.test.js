"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { reconcileV2 } = require("../lib/v2-reconciliation");

function row(index, status) {
  return { reference: index.toString(16).padStart(64, "0"), status };
}

function fixture() {
  const legacySessions = [
    row(1, "expired"),
    row(2, "expired"),
    row(3, "reconciliation_required"),
    row(4, "verified"),
  ];
  const targetSessions = [
    row(1, "expired"),
    row(2, "expired"),
    row(3, "reconciliation_required"),
    row(4, "issued"),
  ];
  const legacyPrefills = Array.from({ length: 21 }, (_, index) => row(100 + index, "ready"));
  const targetPrefills = legacyPrefills.slice(0, 13).map((entry) => ({ ...entry }));
  return {
    legacySessions,
    targetSessions,
    legacyPrefills,
    targetPrefills,
    legacySubmissions: [],
    targetSubmissions: [],
    destinationCounts: { sessions: 0, prefills: 0, submissions: 0, proofs: 0 },
  };
}

test("current sanitized v2 disposition yields zero promotion and exact quarantine counts", () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const result = reconcileV2(input);
  assert.deepEqual(result.counts, {
    promoted_sessions: 0,
    promoted_prefills: 0,
    promoted_submissions: 0,
    retained_terminal_sessions: 2,
    quarantined_reconciliation_sessions: 1,
    quarantined_state_conflicts: 1,
    quarantined_missing_prefills: 8,
    retained_v2_prefills: 13,
    retained_v2_submissions: 0,
  });
  assert.match(result.sourceReferenceDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(input), before, "reconciliation must not mutate v2 evidence");
});

test("reconciliation aborts when any additive v3 destination is nonempty", () => {
  const input = fixture();
  input.destinationCounts.proofs = 1;
  assert.throws(() => reconcileV2(input), /must be empty/);
});

test("state disagreement is quarantined and never chooses the more advanced state", () => {
  const input = fixture();
  input.legacySessions = [row(9, "submitted")];
  input.targetSessions = [row(9, "issued")];
  input.legacyPrefills = [];
  input.targetPrefills = [];
  const result = reconcileV2(input);
  assert.equal(result.counts.quarantined_state_conflicts, 1);
  assert.equal(result.counts.retained_terminal_sessions, 0);
  assert.equal(result.counts.promoted_sessions, 0);
});

test("duplicate or unsafe source references fail closed", () => {
  const input = fixture();
  input.targetSessions.push({ ...input.targetSessions[0] });
  assert.throws(() => reconcileV2(input), /unique/);
  const unsafe = fixture();
  unsafe.targetSessions[0].reference = "crm-record-id";
  assert.throws(() => reconcileV2(unsafe), /unsafe/);
  const duplicatePrefill = fixture();
  duplicatePrefill.targetPrefills.push({ ...duplicatePrefill.targetPrefills[0] });
  assert.throws(() => reconcileV2(duplicatePrefill), /unique/);
  const wrongDestination = fixture();
  wrongDestination.destinationCounts = { a: 0, b: 0, c: 0, d: 0 };
  assert.throws(() => reconcileV2(wrongDestination), /must be empty/);
});
