"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const { createSessionStore } = require("../lib/session-store");
const { REVISION, environment } = require("./helpers");

const NOW = "2026-08-29T12:00:00.123Z";
const RECOVERY_REVISION = "b".repeat(40);
const UUID = "00000000-0000-4000-8000-000000000001";

function fixture() {
  const config = loadConfig(environment(), REVISION);
  const raw = {
    ROWID: "1", TOKEN_HASH: "a".repeat(64), CRM_LEAD_ID: "4000000001",
    INTAKE_SUBMISSION_ID: "journey_recovery_synthetic_001", STATUS: "submitting",
    ISSUED_AT: NOW, EXPIRES_AT: "2026-08-29T12:10:00.123Z", CREATED_AT: NOW, UPDATED_AT: NOW,
    PREFILL_COUNT: 1, MAX_PREFILLS: 1, SOURCE_REVISION: REVISION,
    SOURCE_ENVIRONMENT: "development", LAST_OUTCOME: "submission_started", LAST_PREFILLED_AT: NOW,
    CRM_ORGANIZATION_HASH: config.crmOrganizationHash, CRM_MODULE: "Leads", EXPECTED_STAGE: "form1",
    FORM_IDENTITY_HASH: config.formIdentityHash, ISSUING_ACTOR_HASH: config.issuingActorHash,
    PREFILL_HANDLE_HASH: "c".repeat(64), PREFILL_HANDLE_ISSUED_AT: NOW,
    PREFILL_HANDLE_EXPIRES_AT: "2026-08-29T12:05:00.123Z", PREFILL_HANDLE_CONSUMED_AT: NOW,
    PREFILL_CONSUMPTION_OWNER: UUID, PREFILL_ID: UUID, CONFIGURATION_REVISION: REVISION,
    SUBMISSION_STARTED_AT: NOW, SUBMISSION_CLAIM_ID: UUID, SUBMISSION_FINGERPRINT: "d".repeat(64),
    CRM_RECORD_VERSION: "2026-08-29T11:59:00+00:00", SESSION_VERSION: 17, CONSUMED_AT: null,
  };
  let mode = "success";
  let updates = 0;
  let failRead = false;
  let sequence = 2;
  const read = async () => {
    if (failRead) { failRead = false; throw new Error("synthetic read failure"); }
    return [{ ...raw }];
  };
  const adapter = {
    findRowsByJourneyId: read, findRowsByPrefillHandleHash: read, findRowsByPrefillId: read,
    findRowsByRowId: read, findRowsByTokenHash: read,
    insertRow: async () => assert.fail("recovery must never insert a session"),
    async updateRow(_table, update, expected) {
      updates += 1;
      assert.deepEqual(Object.keys(expected), ["SESSION_VERSION", "STATUS", "TOKEN_HASH", "UPDATED_AT"]);
      if (mode === "before_commit") throw new Error("synthetic update failure");
      if (Object.entries(expected).every(([key, value]) => raw[key] === value)) {
        Object.assign(raw, update);
      }
      if (mode === "after_commit") throw new Error("synthetic acknowledgement loss");
      if (mode === "readback_failure") failRead = true;
    },
  };
  const makeStore = () => createSessionStore(adapter, config, {
    now: () => Date.parse(NOW) + 1000,
    randomUUID: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
  });
  return {
    raw, store: makeStore(), restart: makeStore,
    setMode(value) { mode = value; },
    updateCount: () => updates,
  };
}

test("concurrent recovery reservation has exactly one owner and preserves the original claim", async () => {
  const selected = fixture();
  const original = await selected.store.readByRowId("1");
  const results = await Promise.all([
    selected.store.reserveRecoveryAttempt(original, RECOVERY_REVISION),
    selected.store.reserveRecoveryAttempt(original, RECOVERY_REVISION),
  ]);
  assert.equal(results.filter(({ acquired }) => acquired).length, 1);
  const row = await selected.store.readByRowId("1");
  assert.equal(row.lastOutcome.length, 76);
  assert.equal(row.lastOutcome.startsWith(`r1_${RECOVERY_REVISION}_`), true);
  assert.equal(row.sessionVersion, 18);
  for (const [key, value] of Object.entries(original)) {
    if (!["lastOutcome", "sessionVersion", "updatedAt"].includes(key)) assert.deepEqual(row[key], value);
  }
  const updates = selected.updateCount();
  const restarted = selected.restart();
  assert.equal((await restarted.reserveRecoveryAttempt(row, RECOVERY_REVISION)).acquired, false);
  assert.equal(selected.updateCount(), updates);
});

test("reservation ambiguity before or after commit never grants a CRM write attempt", async () => {
  for (const mode of ["before_commit", "after_commit"]) {
    const selected = fixture();
    const original = await selected.store.readByRowId("1");
    selected.setMode(mode);
    const result = await selected.store.reserveRecoveryAttempt(original, RECOVERY_REVISION);
    assert.equal(result.acquired, false);
    assert.equal(selected.updateCount(), 1);
    assert.equal(result.row.sessionVersion, mode === "after_commit" ? 18 : 17);
    if (mode === "after_commit") {
      selected.setMode("success");
      const restarted = selected.restart();
      assert.equal((await restarted.reserveRecoveryAttempt(result.row, RECOVERY_REVISION)).acquired, false);
      assert.equal(selected.updateCount(), 1);
    }
  }
});

test("failed reservation readback remains reserved but cannot authorize a restarted caller", async () => {
  const selected = fixture();
  const original = await selected.store.readByRowId("1");
  selected.setMode("readback_failure");
  await assert.rejects(() => selected.store.reserveRecoveryAttempt(original, RECOVERY_REVISION),
    { ambiguous: true });
  selected.setMode("success");
  const restarted = selected.restart();
  const row = await restarted.readByRowId("1");
  assert.equal((await restarted.reserveRecoveryAttempt(row, RECOVERY_REVISION)).acquired, false);
  assert.equal(selected.updateCount(), 1);
});

test("another recovery mode or artifact cannot acquire the original claim", async () => {
  for (const marker of ["another_mode", `r1_${"e".repeat(40)}_${UUID.replaceAll("-", "")}`]) {
    const selected = fixture();
    selected.raw.LAST_OUTCOME = marker;
    const row = await selected.store.readByRowId("1");
    await assert.rejects(() => selected.store.reserveRecoveryAttempt(row, RECOVERY_REVISION),
      { publicCode: "session_state_invalid" });
    assert.equal(selected.updateCount(), 0);
  }
});

test("exact separately approved predecessor reserves once without replacing the original claim", async () => {
  const selected = fixture();
  const original = await selected.store.readByRowId("1");
  const prior = (await selected.store.reserveRecoveryAttempt(original, "e".repeat(40))).row;
  assert.equal(prior.sessionVersion, 18);
  const results = await Promise.all([
    selected.store.reserveRecoveryAttempt(prior, RECOVERY_REVISION, prior.lastOutcome),
    selected.restart().reserveRecoveryAttempt(prior, RECOVERY_REVISION, prior.lastOutcome),
  ]);
  assert.equal(results.filter(({ acquired }) => acquired).length, 1);
  const row = await selected.store.readByRowId("1");
  assert.equal(row.sessionVersion, 19);
  assert.equal(row.lastOutcome.startsWith(`r1_${RECOVERY_REVISION}_`), true);
  assert.notEqual(row.lastOutcome, prior.lastOutcome);
  for (const [key, value] of Object.entries(original)) {
    if (!["lastOutcome", "sessionVersion", "updatedAt"].includes(key)) assert.deepEqual(row[key], value);
  }
  const updates = selected.updateCount();
  assert.equal((await selected.restart().reserveRecoveryAttempt(
    row, RECOVERY_REVISION, prior.lastOutcome,
  )).acquired, false);
  assert.equal(selected.updateCount(), updates);
});

test("follow-on reservation rejects absent, mismatched, malformed, and current-artifact approval", async () => {
  const selected = fixture();
  const original = await selected.store.readByRowId("1");
  const prior = (await selected.store.reserveRecoveryAttempt(original, "e".repeat(40))).row;
  const updates = selected.updateCount();
  for (const approved of [undefined, null, [prior.lastOutcome], "submitted", "r1_arbitrary",
    `r1_${"e".repeat(40)}_${UUID.replaceAll("-", "")}`,
    `r1_${RECOVERY_REVISION}_${UUID.replaceAll("-", "")}`,
  ]) {
    await assert.rejects(() => selected.store.reserveRecoveryAttempt(prior, RECOVERY_REVISION, approved));
  }
  assert.equal(selected.updateCount(), updates);
  assert.deepEqual(await selected.store.readByRowId("1"), prior);
});

test("follow-on reservation ambiguity never grants a second-artifact write attempt", async () => {
  for (const mode of ["before_commit", "after_commit", "readback_failure"]) {
    const selected = fixture();
    const original = await selected.store.readByRowId("1");
    const prior = (await selected.store.reserveRecoveryAttempt(original, "e".repeat(40))).row;
    selected.setMode(mode);
    if (mode === "readback_failure") {
      await assert.rejects(() => selected.store.reserveRecoveryAttempt(
        prior, RECOVERY_REVISION, prior.lastOutcome,
      ), { ambiguous: true });
    } else {
      assert.equal((await selected.store.reserveRecoveryAttempt(
        prior, RECOVERY_REVISION, prior.lastOutcome,
      )).acquired, false);
    }
    assert.equal(selected.updateCount(), 2);
    selected.setMode("success");
    const row = await selected.store.readByRowId("1");
    assert.equal(row.sessionVersion, mode === "before_commit" ? 18 : 19);
    if (mode !== "before_commit") {
      assert.equal((await selected.restart().reserveRecoveryAttempt(
        row, RECOVERY_REVISION, prior.lastOutcome,
      )).acquired, false);
      assert.equal(selected.updateCount(), 2);
    }
    for (const [key, value] of Object.entries(original)) {
      if (!["lastOutcome", "sessionVersion", "updatedAt"].includes(key)) assert.deepEqual(row[key], value);
    }
  }
});

test("consume preserves only a valid recovery marker and its original claim evidence", async () => {
  for (const reserve of [true, false]) {
    const selected = fixture();
    const original = await selected.store.readByRowId("1");
    const prepared = reserve
      ? (await selected.store.reserveRecoveryAttempt(original, RECOVERY_REVISION)).row
      : original;
    const result = await selected.store.consume(prepared, original.submissionFingerprint);
    assert.equal(result.row.status, "consumed");
    assert.equal(result.row.lastOutcome, reserve ? prepared.lastOutcome : "submitted");
    assert.equal(result.row.submissionClaimId, original.submissionClaimId);
    assert.equal(result.row.submissionStartedAt, original.submissionStartedAt);
    assert.equal(result.row.submissionFingerprint, original.submissionFingerprint);
    assert.equal(result.row.sourceRevision, original.sourceRevision);
    assert.equal(result.row.configurationRevision, original.configurationRevision);
  }
  const selected = fixture();
  selected.raw.LAST_OUTCOME = "r1_arbitrary_marker";
  const original = await selected.store.readByRowId("1");
  const result = await selected.store.consume(original, original.submissionFingerprint);
  assert.equal(result.row.lastOutcome, "submitted");
});

test("consume readback ambiguity closes from the terminal row without another mutation", async () => {
  const selected = fixture();
  const original = await selected.store.readByRowId("1");
  const reserved = await selected.store.reserveRecoveryAttempt(original, RECOVERY_REVISION);
  selected.setMode("readback_failure");
  await assert.rejects(() => selected.store.consume(reserved.row, original.submissionFingerprint));
  selected.setMode("success");
  const restarted = selected.restart();
  const terminal = await restarted.readByRowId("1");
  const updates = selected.updateCount();
  assert.equal(terminal.status, "consumed");
  assert.equal(terminal.lastOutcome, reserved.row.lastOutcome);
  assert.equal(terminal.submissionClaimId, original.submissionClaimId);
  assert.equal((await restarted.consume(terminal, original.submissionFingerprint)).replayed, true);
  assert.equal(selected.updateCount(), updates);
});
