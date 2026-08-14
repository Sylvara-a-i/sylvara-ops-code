"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { SESSION_STATUSES } = require("../lib/config");
const {
  STORED_FIELDS,
  SessionStoreError,
  createCatalystSessionStore,
} = require("../lib/session-store");

const TABLE = "Form2_Sessions";
const ISSUE_KEY = "e".repeat(64);
const TOKEN_HASH = "a".repeat(64);
const NOW_MS = Date.parse("2026-08-14T18:00:00.000Z");

function config(overrides = {}) {
  return {
    sessionTableName: TABLE,
    deploymentEnvironment: "development",
    sessionTtlSeconds: 3600,
    maxVerificationAttempts: 3,
    sourceRevision: "synthetic-revision-001",
    ...overrides,
  };
}

function fixture({
  nowMs = NOW_MS,
  insertFailure = "none",
  updateFailure = "none",
} = {}) {
  const calls = {
    insert: [],
    update: [],
    issueKeyQueries: [],
    tokenQueries: [],
    rowQueries: [],
  };
  const rows = [];
  let nextRowId = 1000000000001n;

  const adapter = {
    async insertRow(tableName, row) {
      calls.insert.push({ tableName, row: { ...row } });
      if (rows.some((candidate) => candidate.ISSUE_KEY === row.ISSUE_KEY)) {
        throw new Error("synthetic unique issue-key conflict");
      }
      if (insertFailure === "before") throw new Error("synthetic insert failure");
      rows.push({ ...row, ROWID: String(nextRowId++) });
      if (insertFailure === "after") throw new Error("synthetic insert timeout");
      return rows.at(-1);
    },
    async updateRow(tableName, update, expected) {
      calls.update.push({ tableName, update: { ...update }, expected: { ...expected } });
      const row = rows.find((candidate) => candidate.ROWID === String(update.ROWID));
      if (!row) throw new Error("synthetic row missing");
      if (
        row.STATUS !== expected.STATUS ||
        Number(row.ATTEMPT_COUNT) !== Number(expected.ATTEMPT_COUNT)
      ) {
        throw new Error("synthetic conditional conflict");
      }
      Object.assign(row, update);
      if (updateFailure === "after") throw new Error("synthetic update timeout");
      return row;
    },
    async findRowsByIssueKey(tableName, issueKey) {
      calls.issueKeyQueries.push({ tableName, issueKey });
      return rows
        .filter((row) => row.ISSUE_KEY === issueKey)
        .map((row) => ({ [TABLE]: { ...row } }));
    },
    async findRowsByTokenHash(tableName, tokenHash) {
      calls.tokenQueries.push({ tableName, tokenHash });
      return rows
        .filter((row) => row.TOKEN_HASH === tokenHash)
        .map((row) => ({ [TABLE]: { ...row } }));
    },
    async findRowsByRowId(tableName, rowId) {
      calls.rowQueries.push({ tableName, rowId });
      return rows
        .filter((row) => row.ROWID === String(rowId))
        .map((row) => ({ [TABLE]: { ...row } }));
    },
  };
  const clock = { nowMs };
  const store = createCatalystSessionStore(adapter, config(), {
    now: () => clock.nowMs,
  });
  return { adapter, calls, clock, rows, store };
}

function issueInput(overrides = {}) {
  return {
    issueKey: ISSUE_KEY,
    tokenHash: TOKEN_HASH,
    crmContactId: `${"1".repeat(18)}1`,
    crmAccountId: `${"1".repeat(18)}2`,
    crmDealId: `${"1".repeat(18)}3`,
    ...overrides,
  };
}

test("issues and reads back a Development session containing no raw token or PII", async () => {
  const { calls, store } = fixture();
  const issued = await store.issue(issueInput());
  assert.equal(issued.status, "issued");
  assert.equal(issued.issueKey, ISSUE_KEY);
  assert.equal(issued.tokenHash, TOKEN_HASH);
  assert.equal(issued.expiresAt, "2026-08-14T19:00:00.000Z");

  const stored = calls.insert[0].row;
  assert.deepEqual(
    Object.keys(stored).sort(),
    STORED_FIELDS.filter((field) => field !== "ROWID").sort(),
  );
  assert.equal(stored.ATTEMPT_COUNT, 0);
  assert.equal(stored.MAX_ATTEMPTS, 3);
  assert.equal(stored.SOURCE_ENVIRONMENT, "development");
  assert.doesNotMatch(JSON.stringify(stored), /email|phone|name|address|raw.token/i);
});

test("rejects PII-shaped or unstructured issue input before the adapter is called", async () => {
  const { calls, store } = fixture();
  await assert.rejects(
    store.issue({ ...issueInput(), email: "person@example.invalid" }),
    (error) => error instanceof SessionStoreError && error.publicCode === "session_input_invalid",
  );
  await assert.rejects(
    store.issue({
      ...issueInput(),
      issueRequestId: "5a1098d4-6358-4c72-9522-634344f12131",
    }),
    SessionStoreError,
  );
  await assert.rejects(
    store.issue({ ...issueInput(), issueKey: "E".repeat(64) }),
    SessionStoreError,
  );
  await assert.rejects(
    store.issue({ tokenHash: TOKEN_HASH, crmDealId: "not-a-record-id" }),
    SessionStoreError,
  );
  for (const omitted of ["crmContactId", "crmAccountId", "crmDealId"]) {
    const input = issueInput();
    delete input[omitted];
    await assert.rejects(store.issue(input), SessionStoreError);
  }
  await assert.rejects(store.issue({ tokenHash: TOKEN_HASH }), SessionStoreError);
  assert.equal(calls.insert.length, 0);
});

test("returns an identical live session for an exact issue-key retry", async () => {
  const { calls, clock, rows, store } = fixture();
  const first = await store.issue(issueInput());
  clock.nowMs += 60 * 1000;
  const retry = await store.issue(issueInput());
  assert.equal(retry.rowId, first.rowId);
  assert.equal(retry.issuedAt, first.issuedAt);
  assert.equal(rows.length, 1);
  assert.equal(calls.insert.length, 2);

  await store.verify(TOKEN_HASH);
  const verifiedRetry = await store.issue(issueInput());
  assert.equal(verifiedRetry.rowId, first.rowId);
  assert.equal(verifiedRetry.status, "verified");
});

test("fails reconciliation when an issue key is reused with a conflicting hash or CRM context", async () => {
  const { adapter, clock, store } = fixture();
  await store.issue(issueInput());
  for (const conflicting of [
    issueInput({ tokenHash: "b".repeat(64) }),
    issueInput({ crmContactId: `${"1".repeat(17)}99` }),
    issueInput({ crmAccountId: `${"1".repeat(17)}99` }),
    issueInput({ crmDealId: `${"1".repeat(17)}99` }),
  ]) {
    await assert.rejects(
      store.issue(conflicting),
      (error) => error.publicCode === "reconciliation_required",
    );
  }
  const changedRevisionStore = createCatalystSessionStore(
    adapter,
    config({ sourceRevision: "synthetic-revision-002" }),
    { now: () => clock.nowMs },
  );
  await assert.rejects(
    changedRevisionStore.issue(issueInput()),
    (error) => error.publicCode === "reconciliation_required",
  );
});

test("verifies a live session, increments its bounded attempt counter, and supports submission", async () => {
  const { calls, store } = fixture();
  const issued = await store.issue(issueInput());
  const result = await store.verify(TOKEN_HASH);
  assert.equal(result.outcome, "verified");
  assert.equal(result.session.attemptCount, 1);
  assert.equal(result.session.verifiedAt, "2026-08-14T18:00:00.000Z");
  assert.deepEqual(calls.update[0].expected, { STATUS: "issued", ATTEMPT_COUNT: 0 });

  const submitted = await store.markSubmitted(issued.rowId);
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.submittedAt, "2026-08-14T18:00:00.000Z");
  assert.equal((await store.verify(TOKEN_HASH)).outcome, "submitted");
});

test("expires an elapsed session and fails a session beyond its verification bound", async () => {
  const expiredFixture = fixture();
  await expiredFixture.store.issue(issueInput());
  expiredFixture.clock.nowMs = NOW_MS + 3600 * 1000;
  const expired = await expiredFixture.store.verify(TOKEN_HASH);
  assert.equal(expired.outcome, "expired");
  assert.equal(expired.session.expiredAt, "2026-08-14T19:00:00.000Z");

  const bounded = fixture();
  const boundedStore = createCatalystSessionStore(bounded.adapter, config({
    maxVerificationAttempts: 2,
  }), { now: () => bounded.clock.nowMs });
  await boundedStore.issue(issueInput());
  assert.equal((await boundedStore.verify(TOKEN_HASH)).session.attemptCount, 1);
  assert.equal((await boundedStore.verify(TOKEN_HASH)).session.attemptCount, 2);
  const failed = await boundedStore.verify(TOKEN_HASH);
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.session.lastOutcome, "attempt_limit_reached");

  assert.throws(
    () => createCatalystSessionStore(bounded.adapter, config({ maxVerificationAttempts: 1 })),
    SessionStoreError,
  );
});

test("supports explicit revoke, failure, and reconciliation-required terminal states", async () => {
  const revokedFixture = fixture();
  const revokedIssue = await revokedFixture.store.issue(issueInput());
  assert.equal((await revokedFixture.store.revoke(revokedIssue.rowId)).status, "revoked");

  const failedFixture = fixture();
  const failedIssue = await failedFixture.store.issue(issueInput({
    tokenHash: "b".repeat(64),
  }));
  assert.equal((await failedFixture.store.markFailed(
    failedIssue.rowId,
    "crm_read_failed",
  )).status, "failed");
  assert.equal((await failedFixture.store.markReconciliationRequired(
    failedIssue.rowId,
    "crm_outcome_unknown",
  )).status, "reconciliation_required");

  assert.deepEqual(SESSION_STATUSES, [
    "issued",
    "verified",
    "submitted",
    "expired",
    "revoked",
    "failed",
    "reconciliation_required",
  ]);
});

test("recovers only an exact durable readback after ambiguous writes", async () => {
  const ambiguousInsert = fixture({ insertFailure: "after" });
  assert.equal((await ambiguousInsert.store.issue(issueInput())).status, "issued");

  const failedInsert = fixture({ insertFailure: "before" });
  await assert.rejects(
    failedInsert.store.issue(issueInput()),
    (error) => error.publicCode === "reconciliation_required",
  );

  const ambiguousUpdate = fixture({ updateFailure: "after" });
  await ambiguousUpdate.store.issue(issueInput());
  assert.equal((await ambiguousUpdate.store.verify(TOKEN_HASH)).outcome, "verified");
});

test("fails closed on non-unique token hashes and unsafe adapter or environment contracts", async () => {
  const duplicate = fixture();
  await duplicate.store.issue(issueInput());
  duplicate.rows.push({ ...duplicate.rows[0], ROWID: "1000000000009" });
  await assert.rejects(duplicate.store.readByTokenHash(TOKEN_HASH), SessionStoreError);

  assert.throws(
    () => createCatalystSessionStore({}, config()),
    SessionStoreError,
  );
  assert.throws(
    () => createCatalystSessionStore(duplicate.adapter, config({
      deploymentEnvironment: "production",
    })),
    SessionStoreError,
  );
  assert.throws(
    () => createCatalystSessionStore(duplicate.adapter, config({ sessionTtlSeconds: 86401 })),
    SessionStoreError,
  );
});
