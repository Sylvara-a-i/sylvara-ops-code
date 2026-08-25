"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createSessionStore } = require("../lib/session-store");
const { INTAKE_ID, LEAD_ID, REVISION } = require("./helpers");

function createAdapter() {
  let row = null;
  return {
    async insertRow(table, input) {
      assert.equal(table, "RevenueLeakTestRequestFormSessions");
      assert.equal(row, null);
      row = { ROWID: "1", ...input };
      return row;
    },
    async findRowsByTokenHash(_table, tokenHash) {
      return row?.TOKEN_HASH === tokenHash
        ? [{ RevenueLeakTestRequestFormSessions: { ...row } }]
        : [];
    },
    async findRowsByRowId(_table, rowId) {
      return row?.ROWID === rowId
        ? [{ RevenueLeakTestRequestFormSessions: { ...row } }]
        : [];
    },
    async updateRow(_table, update, expected) {
      const matches = row && Object.entries(expected).every(([key, value]) => row[key] === value);
      if (matches) row = { ...row, ...update };
      return [];
    },
    current() {
      return row ? { ...row } : null;
    },
  };
}

test("live single-table schema enforces one unique prefill reservation owner", async () => {
  const adapter = createAdapter();
  let clock = Date.parse("2026-08-21T23:00:00.000Z");
  const store = createSessionStore(
    adapter,
    {
      sessionTableName: "RevenueLeakTestRequestFormSessions",
      deploymentEnvironment: "development",
      sourceRevision: REVISION,
      sessionTtlSeconds: 900,
      maxPrefills: 2,
    },
    { now: () => clock++ },
  );
  const pending = await store.createSession({
    tokenHash: "a".repeat(64),
    leadId: LEAD_ID,
    intakeSubmissionId: INTAKE_ID,
  });
  assert.deepEqual(Object.keys(adapter.current()).sort(), [
    "CRM_LEAD_ID",
    "EXPIRES_AT",
    "INTAKE_SUBMISSION_ID",
    "ISSUED_AT",
    "LAST_OUTCOME",
    "MAX_PREFILLS",
    "PREFILL_COUNT",
    "ROWID",
    "SOURCE_ENVIRONMENT",
    "SOURCE_REVISION",
    "STATUS",
    "TOKEN_HASH",
    "UPDATED_AT",
  ].sort());

  const issued = await store.markIssued(pending);
  const ownerOne = "11111111-1111-4111-8111-111111111111";
  const ownerTwo = "22222222-2222-4222-8222-222222222222";
  const reservation = await store.reservePrefill(issued, ownerOne);
  assert.equal(reservation.status, "prefilling");
  assert.equal(reservation.prefillCount, 1);

  await assert.rejects(
    () => store.reservePrefill(issued, ownerTwo),
    (error) => error.ambiguous === true,
  );
  const completed = await store.completePrefill(reservation, ownerOne);
  assert.equal(completed.status, "prefilled");
  assert.equal(completed.prefillCount, 1);
  assert.ok(completed.lastPrefilledAt);

  const second = await store.reservePrefill(completed, ownerTwo);
  const secondCompleted = await store.completePrefill(second, ownerTwo);
  assert.equal(secondCompleted.prefillCount, 2);
  await assert.rejects(
    () => store.reservePrefill(secondCompleted, "33333333-3333-4333-8333-333333333333"),
    (error) => error.publicCode === "prefill_limit_reached",
  );
  assert.equal(adapter.current().STATUS, "revoked");
  assert.ok(adapter.current().REVOKED_AT);
});
