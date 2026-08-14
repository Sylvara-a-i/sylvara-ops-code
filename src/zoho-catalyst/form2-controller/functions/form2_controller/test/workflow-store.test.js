"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  PREFILL_STORED_FIELDS,
  SUBMISSION_STORED_FIELDS,
  WorkflowStoreError,
  createWorkflowStore,
} = require("../lib/workflow-store");

const PREFILL_TABLE = "Form2_Prefill_Revisions";
const SUBMISSION_TABLE = "Form2_Submission_Receipts";
const NOW_MS = Date.parse("2026-08-14T18:00:00.000Z");
const UUIDS = Object.freeze([
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004",
  "00000000-0000-4000-8000-000000000005",
]);

function config(overrides = {}) {
  return {
    prefillTableName: PREFILL_TABLE,
    submissionTableName: SUBMISSION_TABLE,
    sourceRevision: "synthetic-revision-001",
    deploymentEnvironment: "development",
    platformOperationTimeoutMs: 5000,
    maxSubmissionAttempts: 3,
    tokenPepper: "synthetic-pepper-value-32-bytes-minimum-do-not-use",
    ...overrides,
  };
}

function prefillBinding(overrides = {}) {
  return {
    sessionRowId: "9000000000001",
    sessionAttemptCount: 1,
    crmContactId: `${"1".repeat(18)}1`,
    crmAccountId: `${"1".repeat(18)}2`,
    crmDealId: `${"1".repeat(18)}3`,
    contactModifiedTime: "2026-08-14T12:01:02-05:00",
    accountModifiedTime: "2026-08-14T12:02:03-05:00",
    dealModifiedTime: "2026-08-14T12:03:04-05:00",
    snapshotFingerprint: "a".repeat(64),
    ...overrides,
  };
}

function submissionClaim(prefillId = UUIDS[0], overrides = {}) {
  return {
    submissionId: "FORM-ENTRY-0001",
    prefillId,
    sessionRowId: "9000000000001",
    ...overrides,
  };
}

function fixture({
  insertFailure = {},
  updateFailure = {},
  uuids = UUIDS,
  nowMs = NOW_MS,
  configOverrides = {},
} = {}) {
  const tables = {
    [PREFILL_TABLE]: [],
    [SUBMISSION_TABLE]: [],
  };
  const calls = {
    events: [],
    insert: [],
    update: [],
    prefillQueries: [],
    submissionQueries: [],
    rowQueries: [],
  };
  const nextRowId = {
    [PREFILL_TABLE]: 7000000000001n,
    [SUBMISSION_TABLE]: 8000000000001n,
  };
  const uuidQueue = [...uuids];
  const clock = { nowMs };

  function rowsFor(tableName) {
    if (!Object.hasOwn(tables, tableName)) throw new Error("synthetic table missing");
    return tables[tableName];
  }

  const adapter = {
    async insertRow(tableName, row) {
      calls.events.push(`insert:${tableName}`);
      calls.insert.push({ tableName, row: { ...row } });
      if (insertFailure[tableName] === "before") {
        throw new Error("synthetic insert failure");
      }
      const uniqueField = tableName === PREFILL_TABLE ? "PREFILL_KEY" : "SUBMISSION_KEY";
      if (rowsFor(tableName).some((candidate) => candidate[uniqueField] === row[uniqueField])) {
        throw new Error("synthetic unique-key conflict");
      }
      const stored = { ...row, ROWID: String(nextRowId[tableName]++) };
      rowsFor(tableName).push(stored);
      if (insertFailure[tableName] === "after") {
        throw new Error("synthetic post-commit timeout");
      }
      return { ...stored };
    },

    async updateRow(tableName, update, expected) {
      calls.events.push(`update:${tableName}`);
      calls.update.push({
        tableName,
        update: { ...update },
        expected: { ...expected },
      });
      if (updateFailure[tableName] === "before") {
        throw new Error("synthetic update failure");
      }
      const row = rowsFor(tableName).find(
        (candidate) => candidate.ROWID === String(update.ROWID),
      );
      if (!row) throw new Error("synthetic row missing");
      if (
        Object.entries(expected).some(
          ([field, value]) => String(row[field]) !== String(value),
        )
      ) {
        throw new Error("synthetic conditional conflict");
      }
      if (updateFailure[tableName] === "competitor") {
        Object.assign(row, {
          STATUS: "processing",
          LEASE_OWNER: UUIDS[4],
          LEASE_EXPIRES_AT: update.LEASE_EXPIRES_AT,
          ATTEMPT_COUNT: update.ATTEMPT_COUNT,
          CLAIMED_AT: update.CLAIMED_AT,
          SUCCEEDED_AT: "",
          FAILED_AT: "",
          RECONCILIATION_REQUIRED_AT: "",
          UPDATED_AT: update.UPDATED_AT,
          LAST_OUTCOME: "processing",
        });
        throw new Error("synthetic competing retry won");
      }
      Object.assign(row, update);
      if (updateFailure[tableName] === "after") {
        throw new Error("synthetic post-commit update timeout");
      }
      return { ...row };
    },

    async findRowsByPrefillKey(tableName, prefillKey) {
      calls.events.push(`find-prefill:${tableName}`);
      calls.prefillQueries.push({ tableName, prefillKey });
      return rowsFor(tableName)
        .filter((row) => row.PREFILL_KEY === prefillKey)
        .map((row) => ({ [tableName]: { ...row } }));
    },

    async findRowsBySubmissionKey(tableName, submissionKey) {
      calls.events.push(`find-submission:${tableName}`);
      calls.submissionQueries.push({ tableName, submissionKey });
      return rowsFor(tableName)
        .filter((row) => row.SUBMISSION_KEY === submissionKey)
        .map((row) => ({ [tableName]: { ...row } }));
    },

    async findRowsByRowId(tableName, rowId) {
      calls.events.push(`find-row:${tableName}`);
      calls.rowQueries.push({ tableName, rowId: String(rowId) });
      return rowsFor(tableName)
        .filter((row) => row.ROWID === String(rowId))
        .map((row) => ({ [tableName]: { ...row } }));
    },
  };

  const store = createWorkflowStore(adapter, config(configOverrides), {
    now: () => clock.nowMs,
    randomUUID: () => {
      const uuid = uuidQueue.shift();
      if (!uuid) throw new Error("synthetic UUID queue exhausted");
      return uuid;
    },
  });
  return { adapter, calls, clock, store, tables };
}

test("mints a unique prefill revision and stores no raw identifier, payload, or PII", async () => {
  const { calls, store } = fixture();
  const minted = await store.mintPrefill(prefillBinding());
  assert.match(
    minted.prefillId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(minted.revision.status, "ready");
  assert.equal(minted.revision.sessionRowId, "9000000000001");
  assert.equal(minted.revision.sessionAttemptCount, 1);

  const stored = calls.insert[0].row;
  assert.deepEqual(
    Object.keys(stored).sort(),
    PREFILL_STORED_FIELDS.filter((field) => field !== "ROWID").sort(),
  );
  assert.match(stored.PREFILL_KEY, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.PREFILL_KEY, minted.prefillId);
  assert.equal(stored.SNAPSHOT_FINGERPRINT, "a".repeat(64));
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(minted.prefillId, "i"));
  assert.doesNotMatch(
    JSON.stringify(stored),
    /email|phone|first.name|last.name|address|raw.payload|submission.id/i,
  );
});

test("concurrent exact mints coalesce on one durable session verification attempt", async () => {
  const { calls, clock, store, tables } = fixture();
  const first = await store.mintPrefill(prefillBinding());
  clock.nowMs += 1000;
  const concurrent = await Promise.all(
    Array.from({ length: 20 }, () => store.mintPrefill(prefillBinding())),
  );

  assert.equal(tables[PREFILL_TABLE].length, 1);
  assert.equal(calls.insert.filter(({ tableName }) => tableName === PREFILL_TABLE).length, 21);
  for (const result of concurrent) {
    assert.equal(result.prefillId, first.prefillId);
    assert.equal(result.revision.rowId, first.revision.rowId);
    assert.equal(result.revision.issuedAt, "2026-08-14T18:00:00.000Z");
    assert.equal(result.revision.sessionAttemptCount, 1);
  }

  const nextAttempt = await store.mintPrefill(prefillBinding({ sessionAttemptCount: 2 }));
  assert.notEqual(nextAttempt.prefillId, first.prefillId);
  assert.notEqual(nextAttempt.revision.prefillKey, first.revision.prefillKey);
  assert.equal(tables[PREFILL_TABLE].length, 2);
});

test("same-attempt binding mismatches and terminal revisions fail closed", async () => {
  const conflict = fixture();
  await conflict.store.mintPrefill(prefillBinding());
  await assert.rejects(
    conflict.store.mintPrefill(prefillBinding({ snapshotFingerprint: "b".repeat(64) })),
    (error) => error.publicCode === "prefill_conflict",
  );

  const consumedFixture = fixture();
  const consumedMint = await consumedFixture.store.mintPrefill(prefillBinding());
  const consumed = await consumedFixture.store.consumePrefill({
    ...prefillBinding(),
    prefillId: consumedMint.prefillId,
  });
  assert.equal(consumed.consumptionOwner, UUIDS[0]);
  await assert.rejects(
    consumedFixture.store.mintPrefill(prefillBinding()),
    (error) => error.publicCode === "prefill_consumed",
  );

  await consumedFixture.store.markPrefillReconciliationRequired({
    rowId: consumed.rowId,
    consumptionOwner: consumed.consumptionOwner,
  });
  await assert.rejects(
    consumedFixture.store.mintPrefill(prefillBinding()),
    (error) => error.publicCode === "reconciliation_required",
  );
});

test("rejects unstructured, stale, and PII-shaped prefill inputs before writes", async () => {
  const { calls, store } = fixture();
  await assert.rejects(
    store.mintPrefill({ ...prefillBinding(), email: "person@example.invalid" }),
    (error) => error instanceof WorkflowStoreError && error.publicCode === "workflow_input_invalid",
  );
  await assert.rejects(
    store.mintPrefill(prefillBinding({ snapshotFingerprint: "not-a-fingerprint" })),
    WorkflowStoreError,
  );
  await assert.rejects(
    store.mintPrefill(prefillBinding({ dealModifiedTime: "yesterday" })),
    WorkflowStoreError,
  );
  await assert.rejects(
    store.mintPrefill(prefillBinding({ sessionAttemptCount: 0 })),
    WorkflowStoreError,
  );
  await assert.rejects(
    store.mintPrefill(prefillBinding({ sessionAttemptCount: 11 })),
    WorkflowStoreError,
  );
  assert.equal(calls.insert.length, 0);

  const minted = await store.mintPrefill(prefillBinding());
  await assert.rejects(
    store.consumePrefill({
      ...prefillBinding({ dealModifiedTime: "2026-08-14T12:03:05-05:00" }),
      prefillId: minted.prefillId,
    }),
    (error) => error.publicCode === "prefill_stale",
  );
  assert.equal(calls.update.length, 0);
});

test("consumes a matching prefill revision once and rejects a replay", async () => {
  const { calls, store } = fixture();
  const minted = await store.mintPrefill(prefillBinding());
  const consumed = await store.consumePrefill({
    ...prefillBinding(),
    prefillId: minted.prefillId,
  });
  assert.equal(consumed.status, "submitted");
  assert.equal(consumed.consumptionOwner, UUIDS[0]);
  assert.equal(consumed.submittedAt, "2026-08-14T18:00:00.000Z");
  assert.deepEqual(calls.update[0].expected, {
    STATUS: "ready",
    PREFILL_KEY: minted.revision.prefillKey,
    SESSION_ROW_ID: "9000000000001",
  });

  await assert.rejects(
    store.consumePrefill({ ...prefillBinding(), prefillId: minted.prefillId }),
    (error) => error.publicCode === "prefill_consumed",
  );
  assert.equal(calls.update.length, 1);
});

test("uses exact readback for ambiguous prefill inserts and updates", async () => {
  const insertAfter = fixture({
    insertFailure: { [PREFILL_TABLE]: "after" },
  });
  assert.equal((await insertAfter.store.mintPrefill(prefillBinding())).revision.status, "ready");

  const insertBefore = fixture({
    insertFailure: { [PREFILL_TABLE]: "before" },
  });
  await assert.rejects(
    insertBefore.store.mintPrefill(prefillBinding()),
    (error) => error.publicCode === "reconciliation_required",
  );

  const updateAfter = fixture({
    updateFailure: { [PREFILL_TABLE]: "after" },
  });
  const minted = await updateAfter.store.mintPrefill(prefillBinding());
  assert.equal((await updateAfter.store.consumePrefill({
    ...prefillBinding(),
    prefillId: minted.prefillId,
  })).status, "submitted");

  const updateBefore = fixture({
    updateFailure: { [PREFILL_TABLE]: "before" },
  });
  const unconsumed = await updateBefore.store.mintPrefill(prefillBinding());
  await assert.rejects(
    updateBefore.store.consumePrefill({
      ...prefillBinding(),
      prefillId: unconsumed.prefillId,
    }),
    (error) => error.publicCode === "reconciliation_required",
  );
});

test("marks an owned consumed prefill as reconciliation-required", async () => {
  const { store } = fixture();
  const minted = await store.mintPrefill(prefillBinding());
  const consumed = await store.consumePrefill({
    ...prefillBinding(),
    prefillId: minted.prefillId,
  });
  const reconciled = await store.markPrefillReconciliationRequired({
    rowId: consumed.rowId,
    consumptionOwner: consumed.consumptionOwner,
  });
  assert.equal(reconciled.status, "reconciliation_required");
  assert.equal(reconciled.lastOutcome, "crm_outcome_unknown");
  await assert.rejects(
    store.consumePrefill({ ...prefillBinding(), prefillId: minted.prefillId }),
    (error) => error.publicCode === "reconciliation_required",
  );
});

test("claims a submission by unique insert before any read and stores only derived identities", async () => {
  const { calls, store } = fixture();
  const result = await store.claimSubmission(submissionClaim(UUIDS[4]));
  assert.equal(result.outcome, "claimed");
  assert.equal(result.receipt.status, "processing");
  assert.equal(result.receipt.leaseOwner, UUIDS[0]);
  assert.equal(result.receipt.attemptCount, 1);
  assert.equal(result.receipt.leaseExpiresAt, "2026-08-14T18:00:30.000Z");
  assert.deepEqual(calls.events.slice(0, 2), [
    `insert:${SUBMISSION_TABLE}`,
    `find-submission:${SUBMISSION_TABLE}`,
  ]);

  const stored = calls.insert[0].row;
  assert.deepEqual(
    Object.keys(stored).sort(),
    SUBMISSION_STORED_FIELDS.filter((field) => field !== "ROWID").sort(),
  );
  assert.match(stored.SUBMISSION_KEY, /^[a-f0-9]{64}$/);
  assert.match(stored.PREFILL_KEY, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(stored), /FORM-ENTRY-0001/);
  assert.doesNotMatch(JSON.stringify(stored), new RegExp(UUIDS[4], "i"));
  assert.doesNotMatch(JSON.stringify(stored), /email|phone|name|raw.payload/i);
});

test("returns succeeded for an exact completed duplicate without reprocessing", async () => {
  const { calls, store } = fixture();
  const first = await store.claimSubmission(submissionClaim());
  await store.markSubmissionSucceeded({
    rowId: first.receipt.rowId,
    leaseOwner: first.receipt.leaseOwner,
  });
  const duplicate = await store.claimSubmission(submissionClaim());
  assert.equal(duplicate.outcome, "succeeded");
  assert.equal(duplicate.receipt.status, "succeeded");
  assert.equal(calls.insert.filter(({ tableName }) => tableName === SUBMISSION_TABLE).length, 2);
});

test("returns unresolved for exact in-flight or failed duplicates and conflicts on rebinding", async () => {
  const inFlight = fixture();
  await inFlight.store.claimSubmission(submissionClaim());
  inFlight.clock.nowMs += 3600 * 1000;
  assert.equal((await inFlight.store.claimSubmission(submissionClaim())).outcome, "unresolved");

  const failed = fixture();
  const first = await failed.store.claimSubmission(submissionClaim());
  await failed.store.markSubmissionFailed({
    rowId: first.receipt.rowId,
    leaseOwner: first.receipt.leaseOwner,
  }, "crm_validation_failed");
  const failedDuplicate = await failed.store.claimSubmission(submissionClaim());
  assert.equal(failedDuplicate.outcome, "unresolved");
  assert.equal(failedDuplicate.receipt.status, "failed");

  await assert.rejects(
    failed.store.claimSubmission(submissionClaim(UUIDS[2])),
    (error) => error.publicCode === "submission_conflict",
  );
  await assert.rejects(
    failed.store.claimSubmission(submissionClaim(UUIDS[0], {
      sessionRowId: "9000000000002",
    })),
    (error) => error.publicCode === "submission_conflict",
  );
});

test("atomically reclaims only retryable precommit failures with a fresh bounded attempt", async () => {
  const updateModes = {};
  const { calls, clock, store } = fixture({ updateFailure: updateModes });
  const first = await store.claimSubmission(submissionClaim());
  clock.nowMs += 1000;
  await store.markSubmissionFailed({
    rowId: first.receipt.rowId,
    leaseOwner: first.receipt.leaseOwner,
  }, "retryable_precommit");

  clock.nowMs += 1000;
  updateModes[SUBMISSION_TABLE] = "after";
  const retry = await store.claimSubmission(submissionClaim());
  assert.equal(retry.outcome, "claimed");
  assert.equal(retry.receipt.status, "processing");
  assert.equal(retry.receipt.leaseOwner, UUIDS[1]);
  assert.equal(retry.receipt.attemptCount, 2);
  assert.equal(retry.receipt.claimedAt, "2026-08-14T18:00:02.000Z");
  assert.equal(retry.receipt.leaseExpiresAt, "2026-08-14T18:00:32.000Z");
  assert.equal(retry.receipt.failedAt, "");
  assert.equal(retry.receipt.succeededAt, "");
  assert.equal(retry.receipt.reconciliationRequiredAt, "");
  assert.deepEqual(calls.update.at(-1).expected, {
    STATUS: "failed",
    LEASE_OWNER: UUIDS[0],
    ATTEMPT_COUNT: 1,
    LAST_OUTCOME: "retryable_precommit",
  });
});

test("does not reclaim a retryable failure after the configured attempt ceiling", async () => {
  const { clock, store } = fixture({
    configOverrides: { maxSubmissionAttempts: 2 },
  });
  const first = await store.claimSubmission(submissionClaim());
  await store.markSubmissionFailed({
    rowId: first.receipt.rowId,
    leaseOwner: first.receipt.leaseOwner,
  }, "retryable_precommit");

  clock.nowMs += 1000;
  const second = await store.claimSubmission(submissionClaim());
  assert.equal(second.outcome, "claimed");
  assert.equal(second.receipt.attemptCount, 2);
  await store.markSubmissionFailed({
    rowId: second.receipt.rowId,
    leaseOwner: second.receipt.leaseOwner,
  }, "retryable_precommit");

  clock.nowMs += 1000;
  const exhausted = await store.claimSubmission(submissionClaim());
  assert.equal(exhausted.outcome, "unresolved");
  assert.equal(exhausted.receipt.status, "failed");
  assert.equal(exhausted.receipt.attemptCount, 2);
  assert.equal(exhausted.receipt.lastOutcome, "retryable_precommit");
});

test("a concurrent retry or lost conditional write never grants the losing lease", async () => {
  const competingModes = {};
  const competing = fixture({ updateFailure: competingModes });
  const first = await competing.store.claimSubmission(submissionClaim());
  await competing.store.markSubmissionFailed({
    rowId: first.receipt.rowId,
    leaseOwner: first.receipt.leaseOwner,
  }, "retryable_precommit");
  competing.clock.nowMs += 1000;
  competingModes[SUBMISSION_TABLE] = "competitor";
  const loser = await competing.store.claimSubmission(submissionClaim());
  assert.equal(loser.outcome, "unresolved");
  assert.equal(loser.receipt.status, "processing");
  assert.equal(loser.receipt.leaseOwner, UUIDS[4]);
  assert.notEqual(loser.receipt.leaseOwner, UUIDS[1]);

  const lostModes = {};
  const lost = fixture({ updateFailure: lostModes });
  const lostFirst = await lost.store.claimSubmission(submissionClaim());
  await lost.store.markSubmissionFailed({
    rowId: lostFirst.receipt.rowId,
    leaseOwner: lostFirst.receipt.leaseOwner,
  }, "retryable_precommit");
  lost.clock.nowMs += 1000;
  lostModes[SUBMISSION_TABLE] = "before";
  const notReclaimed = await lost.store.claimSubmission(submissionClaim());
  assert.equal(notReclaimed.outcome, "unresolved");
  assert.equal(notReclaimed.receipt.status, "failed");
  assert.equal(notReclaimed.receipt.leaseOwner, UUIDS[0]);
});

test("never auto-reclaims reconciliation-required or non-retryable failure states", async () => {
  const reconciled = fixture();
  const claim = await reconciled.store.claimSubmission(submissionClaim());
  await reconciled.store.markSubmissionReconciliationRequired({
    rowId: claim.receipt.rowId,
    leaseOwner: claim.receipt.leaseOwner,
  });
  assert.equal(
    (await reconciled.store.claimSubmission(submissionClaim())).outcome,
    "unresolved",
  );

  const nonRetryable = fixture();
  const failed = await nonRetryable.store.claimSubmission(submissionClaim());
  await nonRetryable.store.markSubmissionFailed({
    rowId: failed.receipt.rowId,
    leaseOwner: failed.receipt.leaseOwner,
  }, "validation_failed");
  const duplicate = await nonRetryable.store.claimSubmission(submissionClaim());
  assert.equal(duplicate.outcome, "unresolved");
  assert.equal(duplicate.receipt.lastOutcome, "validation_failed");
});

test("uses exact readback after ambiguous submission insert and transition writes", async () => {
  const insertAfter = fixture({
    insertFailure: { [SUBMISSION_TABLE]: "after" },
  });
  assert.equal((await insertAfter.store.claimSubmission(submissionClaim())).outcome, "claimed");

  const insertBefore = fixture({
    insertFailure: { [SUBMISSION_TABLE]: "before" },
  });
  await assert.rejects(
    insertBefore.store.claimSubmission(submissionClaim()),
    (error) => error.publicCode === "reconciliation_required",
  );

  const updateAfter = fixture({
    updateFailure: { [SUBMISSION_TABLE]: "after" },
  });
  const claimed = await updateAfter.store.claimSubmission(submissionClaim());
  assert.equal((await updateAfter.store.markSubmissionSucceeded({
    rowId: claimed.receipt.rowId,
    leaseOwner: claimed.receipt.leaseOwner,
  })).status, "succeeded");

  const updateBefore = fixture({
    updateFailure: { [SUBMISSION_TABLE]: "before" },
  });
  const unknown = await updateBefore.store.claimSubmission(submissionClaim());
  await assert.rejects(
    updateBefore.store.markSubmissionSucceeded({
      rowId: unknown.receipt.rowId,
      leaseOwner: unknown.receipt.leaseOwner,
    }),
    (error) => error.publicCode === "reconciliation_required",
  );
});

test("fails closed on multiple key rows, unknown states, and lease mismatches", async () => {
  const duplicatePrefill = fixture();
  const minted = await duplicatePrefill.store.mintPrefill(prefillBinding());
  duplicatePrefill.tables[PREFILL_TABLE].push({
    ...duplicatePrefill.tables[PREFILL_TABLE][0],
    ROWID: "7000000000099",
  });
  await assert.rejects(
    duplicatePrefill.store.readPrefill({
      prefillId: minted.prefillId,
      sessionRowId: prefillBinding().sessionRowId,
    }),
    WorkflowStoreError,
  );

  const unknown = fixture();
  await unknown.store.claimSubmission(submissionClaim());
  unknown.tables[SUBMISSION_TABLE][0].STATUS = "mystery";
  await assert.rejects(
    unknown.store.readSubmission({ submissionId: "FORM-ENTRY-0001" }),
    WorkflowStoreError,
  );

  const lease = fixture();
  const claimed = await lease.store.claimSubmission(submissionClaim());
  await assert.rejects(
    lease.store.markSubmissionSucceeded({
      rowId: claimed.receipt.rowId,
      leaseOwner: UUIDS[4],
    }),
    (error) => error.publicCode === "submission_conflict",
  );
});

test("rejects unsafe adapter, Production, malformed identities, and raw-payload keys", async () => {
  assert.throws(() => createWorkflowStore({}, config()), WorkflowStoreError);
  const validFixture = fixture();
  assert.throws(
    () => createWorkflowStore(validFixture.adapter, config({
      deploymentEnvironment: "production",
    })),
    WorkflowStoreError,
  );
  assert.throws(
    () => createWorkflowStore(validFixture.adapter, config({ maxSubmissionAttempts: 0 })),
    WorkflowStoreError,
  );
  assert.throws(
    () => createWorkflowStore(validFixture.adapter, config({ maxSubmissionAttempts: 11 })),
    WorkflowStoreError,
  );
  const missingAttempts = config();
  delete missingAttempts.maxSubmissionAttempts;
  assert.throws(
    () => createWorkflowStore(validFixture.adapter, missingAttempts),
    WorkflowStoreError,
  );
  await assert.rejects(
    validFixture.store.claimSubmission({
      ...submissionClaim(),
      payload: { arbitrary: "data" },
    }),
    (error) => error.publicCode === "workflow_input_invalid",
  );
  await assert.rejects(
    validFixture.store.claimSubmission(submissionClaim(UUIDS[0], {
      submissionId: "person@example.invalid/unsafe",
    })),
    WorkflowStoreError,
  );
  assert.equal(validFixture.calls.insert.length, 0);
});
