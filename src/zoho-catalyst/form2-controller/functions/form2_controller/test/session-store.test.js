"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { SESSION_STATUSES } = require("../lib/config");
const {
  STORED_FIELDS,
  SessionStoreError,
  createCatalystSessionStore,
} = require("../lib/session-store");

const TABLE = "Form2_Sessions";
const ISSUE_REQUEST_KEY = "b".repeat(64);
const TOKEN_HASH = "a".repeat(64);
const NOW_MS = Date.parse("2026-08-14T18:00:00.000Z");
const SUBMISSION_FINGERPRINT = "f".repeat(64);

function dealIssuanceKey(kind, input = issueInput()) {
  return crypto
    .createHash("sha256")
    .update(`sylvara-form2:development:deal-${kind}\0`, "utf8")
    .update(input.crmDealId, "utf8")
    .update(kind === "generation" ? `\0${input.issueRequestKey}` : "", "utf8")
    .digest("hex");
}

function config(overrides = {}) {
  return {
    sessionTableName: TABLE,
    deploymentEnvironment: "development",
    sessionTtlSeconds: 3600,
    verifiedSessionTtlSeconds: 1800,
    maxVerificationAttempts: 3,
    sourceRevision: "a".repeat(40),
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
    dealKeyQueries: [],
    issueRequestKeyQueries: [],
    tokenQueries: [],
    rowQueries: [],
  };
  const rows = [];
  let nextRowId = 1000000000001n;

  const adapter = {
    async insertRow(tableName, row) {
      calls.insert.push({ tableName, row: { ...row } });
      if (rows.some((candidate) =>
        candidate.ISSUE_REQUEST_KEY === row.ISSUE_REQUEST_KEY ||
        candidate.DEAL_ISSUANCE_KEY === row.DEAL_ISSUANCE_KEY)) {
        throw new Error("synthetic unique session-key conflict");
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
      for (const [field, value] of Object.entries(expected)) {
        if (String(row[field]) !== String(value)) {
          throw new Error("synthetic conditional conflict");
        }
      }
      Object.assign(row, update);
      if (updateFailure === "after") throw new Error("synthetic update timeout");
      return row;
    },
    async findRowsByDealIssuanceKey(tableName, dealKey) {
      calls.dealKeyQueries.push({ tableName, dealKey });
      return rows
        .filter((row) => row.DEAL_ISSUANCE_KEY === dealKey)
        .map((row) => ({ [TABLE]: { ...row } }));
    },
    async findRowsByTokenHash(tableName, tokenHash) {
      calls.tokenQueries.push({ tableName, tokenHash });
      return rows
        .filter((row) => row.ACCESS_TOKEN_HASH === tokenHash)
        .map((row) => ({ [TABLE]: { ...row } }));
    },
    async findRowsByIssueRequestKey(tableName, issueRequestKey) {
      calls.issueRequestKeyQueries.push({ tableName, issueRequestKey });
      return rows
        .filter((row) => row.ISSUE_REQUEST_KEY === issueRequestKey)
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
    issueRequestKey: ISSUE_REQUEST_KEY,
    tokenHash: TOKEN_HASH,
    crmContactId: `${"1".repeat(18)}1`,
    crmAccountId: `${"1".repeat(18)}2`,
    crmDealId: `${"1".repeat(18)}3`,
    ...overrides,
  };
}

test("issues and reads back a Development session containing no raw token or form payload", async () => {
  const { calls, store } = fixture();
  const issuing = await store.issue(issueInput());
  assert.equal(issuing.status, "issuing");
  assert.equal(issuing.issueRequestKey, ISSUE_REQUEST_KEY);
  assert.equal(issuing.tokenHash, TOKEN_HASH);
  assert.equal(issuing.expiresAt, "2026-08-14T19:00:00.000Z");
  assert.equal(
    (await store.readByRowId(issuing.rowId)).dealIssuanceKey,
    dealIssuanceKey("active"),
  );
  const issued = await store.markIssued(issuing.rowId);
  assert.equal(issued.status, "issued");

  const stored = calls.insert[0].row;
  assert.deepEqual(
    Object.keys(stored).sort(),
    STORED_FIELDS.filter((field) => field !== "ROWID").sort(),
  );
  assert.equal(stored.ATTEMPT_COUNT, 0);
  assert.equal(stored.MAX_ATTEMPTS, 3);
  assert.equal(stored.SOURCE_ENVIRONMENT, "development");
  assert.equal(stored.DEAL_ISSUANCE_KEY, dealIssuanceKey("active"));
  assert.equal(Object.hasOwn(stored, "ISSUE_KEY"), false);
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
    store.issue({ ...issueInput(), issueKey: "e".repeat(64) }),
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

test("returns an identical live session for an exact deterministic-token retry", async () => {
  const { calls, clock, rows, store } = fixture();
  const first = await store.issue(issueInput());
  await store.markIssued(first.rowId);
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

test("fails reconciliation when the token or CRM context conflicts with the active generation", async () => {
  const { store } = fixture();
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
});

test("recovers an exact active issuance retry across source revisions", async () => {
  const { adapter, clock, rows, store } = fixture();
  const first = await store.issue(issueInput());
  await store.markIssued(first.rowId);

  const changedRevisionStore = createCatalystSessionStore(
    adapter,
    config({ sourceRevision: "b".repeat(40) }),
    { now: () => clock.nowMs },
  );
  const retry = await changedRevisionStore.issue(issueInput());

  assert.equal(retry.rowId, first.rowId);
  assert.equal(retry.status, "issued");
  assert.equal(retry.sourceRevision, "a".repeat(40));
  assert.equal(rows.length, 1);
});

test("verifies a live session, increments its bounded attempt counter, and supports submission", async () => {
  const { calls, clock, store } = fixture();
  const issued = await store.issue(issueInput());
  await store.markIssued(issued.rowId);
  const result = await store.verify(TOKEN_HASH);
  assert.equal(result.outcome, "verified");
  assert.equal(result.session.attemptCount, 1);
  assert.equal(result.session.verifiedAt, "2026-08-14T18:00:00.000Z");
  assert.equal(result.session.expiresAt, "2026-08-14T18:30:00.000Z");
  assert.deepEqual(calls.update[1].expected, { STATUS: "issued", ATTEMPT_COUNT: 0 });

  const firstVerifiedExpiry = result.session.expiresAt;
  clock.nowMs += 5 * 60 * 1000;
  const retried = await store.verify(TOKEN_HASH);
  assert.equal(retried.session.attemptCount, 2);
  assert.equal(retried.session.verifiedAt, result.session.verifiedAt);
  assert.equal(retried.session.expiresAt, firstVerifiedExpiry);

  const submitting = await store.beginSubmission(issued.rowId, SUBMISSION_FINGERPRINT);
  assert.equal(submitting.status, "submitting");
  assert.equal(submitting.lastOutcome, `submitting_${SUBMISSION_FINGERPRINT}`);
  const submitted = await store.markSubmitted(issued.rowId, SUBMISSION_FINGERPRINT);
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.submittedAt, "2026-08-14T18:05:00.000Z");
  assert.equal((await store.verify(TOKEN_HASH)).outcome, "submitted");
});

test("submission ownership is fingerprint-bound, releasable precommit, and mismatch-reconcilable", async () => {
  const selected = fixture();
  const issued = await selected.store.issue(issueInput());
  await selected.store.markIssued(issued.rowId);
  await selected.store.verify(TOKEN_HASH);

  const submitting = await selected.store.beginSubmission(
    issued.rowId,
    SUBMISSION_FINGERPRINT,
  );
  assert.equal(
    (await selected.store.beginSubmission(issued.rowId, SUBMISSION_FINGERPRINT)).rowId,
    submitting.rowId,
  );
  await assert.rejects(
    selected.store.beginSubmission(issued.rowId, "b".repeat(64)),
    (error) => error.publicCode === "submission_conflict",
  );

  const released = await selected.store.releaseSubmission(
    issued.rowId,
    SUBMISSION_FINGERPRINT,
  );
  assert.equal(released.status, "verified");
  assert.equal(released.lastOutcome, "submission_released");

  await selected.store.beginSubmission(issued.rowId, SUBMISSION_FINGERPRINT);
  const submitted = await selected.store.markSubmitted(
    issued.rowId,
    SUBMISSION_FINGERPRINT,
  );
  const reconciliation = await selected.store.markSubmittedReconciliationRequired(
    submitted.rowId,
  );
  assert.equal(reconciliation.status, "reconciliation_required");
  assert.equal(reconciliation.lastOutcome, "succeeded_receipt_crm_mismatch");
  assert.equal(
    (await selected.store.readActiveByCrmDealId(issueInput().crmDealId)).rowId,
    submitted.rowId,
  );
});

test("expires an elapsed session and fails a session beyond its verification bound", async () => {
  const expiredFixture = fixture();
  const expiring = await expiredFixture.store.issue(issueInput());
  await expiredFixture.store.markIssued(expiring.rowId);
  expiredFixture.clock.nowMs = NOW_MS + 3600 * 1000;
  const expired = await expiredFixture.store.verify(TOKEN_HASH);
  assert.equal(expired.outcome, "expired");
  assert.equal(expired.session.expiredAt, "2026-08-14T19:00:00.000Z");
  assert.equal(expired.session.lastOutcome, "crm_expiry_pending");
  const reconciliation = await expiredFixture.store.markExpiryReconciliationRequired(
    expired.session.rowId,
    "crm_expiry_outcome_unknown",
  );
  assert.equal(reconciliation.status, "reconciliation_required");

  const synchronizedFixture = fixture();
  const synchronizedIssue = await synchronizedFixture.store.issue(issueInput());
  await synchronizedFixture.store.markIssued(synchronizedIssue.rowId);
  synchronizedFixture.clock.nowMs = NOW_MS + 3600 * 1000;
  const pending = await synchronizedFixture.store.verify(TOKEN_HASH);
  const synchronized = await synchronizedFixture.store.markExpirySynced(
    pending.session.rowId,
  );
  assert.equal(synchronized.status, "expired");
  assert.equal(synchronized.lastOutcome, "crm_expiry_synced");
  assert.equal(synchronized.dealIssuanceKey, dealIssuanceKey("generation"));
  assert.equal(
    (await synchronizedFixture.store.readByRowId(synchronized.rowId)).dealIssuanceKey,
    dealIssuanceKey("generation"),
  );
  assert.equal(await synchronizedFixture.store.readActiveByCrmDealId(
    issueInput().crmDealId,
  ), null);
  assert.equal(
    (await synchronizedFixture.store.markExpirySynced(pending.session.rowId)).lastOutcome,
    "crm_expiry_synced",
  );
  await assert.rejects(
    synchronizedFixture.store.markExpiryReconciliationRequired(pending.session.rowId),
    (error) => error.publicCode === "session_state_invalid",
  );

  const bounded = fixture();
  const boundedStore = createCatalystSessionStore(bounded.adapter, config({
    maxVerificationAttempts: 2,
  }), { now: () => bounded.clock.nowMs });
  const boundedIssue = await boundedStore.issue(issueInput());
  await boundedStore.markIssued(boundedIssue.rowId);
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

test("the unique active Deal key blocks competitors and is freed only by synchronized expiry", async () => {
  const selected = fixture();
  const first = await selected.store.issue(issueInput());
  await selected.store.markIssued(first.rowId);

  const competing = issueInput({
    issueRequestKey: "e".repeat(64),
    tokenHash: "d".repeat(64),
  });
  await assert.rejects(
    selected.store.issue(competing),
    (error) => error.publicCode === "reconciliation_required",
  );

  selected.clock.nowMs = NOW_MS + 3600 * 1000;
  const expired = await selected.store.verify(TOKEN_HASH);
  await assert.rejects(
    selected.store.issue(competing),
    (error) => error.publicCode === "reconciliation_required",
  );
  await selected.store.markExpirySynced(expired.session.rowId);

  const replacement = await selected.store.issue(competing);
  assert.equal(replacement.status, "issuing");
  assert.equal(replacement.dealIssuanceKey, dealIssuanceKey("active", competing));
  assert.equal(selected.rows.length, 2);
});

test("a stale issuing row retains its active key until synchronized expiry", async () => {
  const selected = fixture();
  const issuing = await selected.store.issue(issueInput());
  await assert.rejects(
    selected.store.markIssuingExpiryPending(issuing.rowId),
    (error) => error.publicCode === "session_state_invalid",
  );

  selected.clock.nowMs = NOW_MS + 3600 * 1000;
  const pending = await selected.store.markIssuingExpiryPending(issuing.rowId);
  assert.equal(pending.status, "expired");
  assert.equal(pending.lastOutcome, "issuing_expiry_pending");
  assert.equal(pending.dealIssuanceKey, dealIssuanceKey("active"));
  assert.equal(
    (await selected.store.readActiveByCrmDealId(issueInput().crmDealId)).rowId,
    issuing.rowId,
  );

  const synchronized = await selected.store.markExpirySynced(issuing.rowId);
  assert.equal(synchronized.lastOutcome, "crm_expiry_synced");
  assert.equal(synchronized.dealIssuanceKey, dealIssuanceKey("generation"));
  assert.equal(
    await selected.store.readActiveByCrmDealId(issueInput().crmDealId),
    null,
  );
});

test("supports explicit revoke, failure, and reconciliation-required terminal states", async () => {
  const revokedFixture = fixture();
  const revokedIssue = await revokedFixture.store.issue(issueInput());
  await revokedFixture.store.markIssued(revokedIssue.rowId);
  assert.equal((await revokedFixture.store.revoke(revokedIssue.rowId)).status, "revoked");
  assert.equal(
    (await revokedFixture.store.readActiveByCrmDealId(issueInput().crmDealId)).rowId,
    revokedIssue.rowId,
  );

  const failedFixture = fixture();
  const failedIssue = await failedFixture.store.issue(issueInput({
    tokenHash: "b".repeat(64),
  }));
  await failedFixture.store.markIssued(failedIssue.rowId);
  assert.equal((await failedFixture.store.markFailed(
    failedIssue.rowId,
    "crm_read_failed",
  )).status, "failed");
  assert.equal((await failedFixture.store.markReconciliationRequired(
    failedIssue.rowId,
    "crm_outcome_unknown",
  )).status, "reconciliation_required");
  assert.equal(
    (await failedFixture.store.readActiveByCrmDealId(issueInput().crmDealId)).rowId,
    failedIssue.rowId,
  );

  assert.deepEqual(SESSION_STATUSES, [
    "issuing",
    "issued",
    "verified",
    "submitting",
    "submitted",
    "expired",
    "revoked",
    "failed",
    "reconciliation_required",
  ]);
});

test("recovers only an exact durable readback after ambiguous writes", async () => {
  const ambiguousInsert = fixture({ insertFailure: "after" });
  const recoveredInsert = await ambiguousInsert.store.issue(issueInput());
  assert.equal(recoveredInsert.status, "issuing");
  assert.equal((await ambiguousInsert.store.markIssued(recoveredInsert.rowId)).status, "issued");

  const failedInsert = fixture({ insertFailure: "before" });
  await assert.rejects(
    failedInsert.store.issue(issueInput()),
    (error) => error.publicCode === "reconciliation_required",
  );

  const ambiguousUpdate = fixture({ updateFailure: "after" });
  const ambiguousIssue = await ambiguousUpdate.store.issue(issueInput());
  await ambiguousUpdate.store.markIssued(ambiguousIssue.rowId);
  assert.equal((await ambiguousUpdate.store.verify(TOKEN_HASH)).outcome, "verified");
});

test("an uncommitted ambiguous submission release reports reconciliation_required", async () => {
  const selected = fixture();
  const issued = await selected.store.issue(issueInput());
  await selected.store.markIssued(issued.rowId);
  await selected.store.verify(TOKEN_HASH);
  await selected.store.beginSubmission(issued.rowId, SUBMISSION_FINGERPRINT);
  const originalUpdate = selected.adapter.updateRow.bind(selected.adapter);
  selected.adapter.updateRow = async (tableName, update, expected) => {
    if (update.LAST_OUTCOME === "submission_released") {
      throw new Error("synthetic release failed before commit");
    }
    return originalUpdate(tableName, update, expected);
  };

  await assert.rejects(
    selected.store.releaseSubmission(issued.rowId, SUBMISSION_FINGERPRINT),
    (error) =>
      error instanceof SessionStoreError &&
      error.publicCode === "reconciliation_required",
  );
  assert.equal((await selected.store.readByRowId(issued.rowId)).status, "submitting");
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
  for (const verifiedSessionTtlSeconds of [1799, 1801, undefined]) {
    assert.throws(
      () => createCatalystSessionStore(
        duplicate.adapter,
        config({ verifiedSessionTtlSeconds }),
      ),
      SessionStoreError,
    );
  }
});
