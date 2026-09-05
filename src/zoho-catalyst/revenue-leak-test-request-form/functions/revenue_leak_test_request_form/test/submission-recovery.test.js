"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const { buildCrmPatch, normalizeFormData } = require("../lib/form-contract");
const { createSessionStore } = require("../lib/session-store");
const { submissionFingerprint } = require("../lib/security");
const { RecoveryError, assistedConstantsSha256, recoveryClaimBindingSha256,
  recoverAssistedSubmission } = require("../lib/submission-recovery");
const { REVISION, environment } = require("./helpers");

const CURRENT_REVISION = "a".repeat(40);
const PREDECESSOR_REVISION = "b".repeat(40);
const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const PREFILL_ID = "11111111-1111-4111-8111-111111111111";
const RECORD_ID = "4000000001";
const VERSION = "2026-09-01T11:59:00+00:00";

function formData() {
  return { firstName: "ZZZ", lastName: "Synthetic", company: "ZZZ SYNTHETIC Plumbing",
    decisionMakerRole: "Owner", jobTitle: "", email: "synthetic@example.invalid",
    mobilePhone: "+15555550101", companyPhone: "+15555550102", currentCallHandling: "Voicemail",
    preferredTestRoute: "After Hours", phoneSystemProvider: "Synthetic Provider",
    primaryServiceArea: "ZZZ SYNTHETIC", fieldTeamSizeBand: "1-5", additionalNotes: "",
    contactConsent: true, leadSource: "Other", sourcePage: "", utmSource: "synthetic",
    utmMedium: "", utmCampaign: "", utmTerm: "", utmContent: "" };
}

async function fixture(mode = "complete", predecessorRevision = null) {
  const originalConfig = loadConfig(environment(), REVISION);
  let raw;
  let clock = NOW;
  let owner = 1;
  const faults = {};
  const events = [];
  const selected = (key, value) => raw?.[key] === value ? [{ ...raw }] : [];
  const adapter = {
    findRowsByJourneyId: async (_table, value) => selected("INTAKE_SUBMISSION_ID", value),
    findRowsByPrefillHandleHash: async (_table, value) => selected("PREFILL_HANDLE_HASH", value),
    findRowsByPrefillId: async (_table, value) => selected("PREFILL_ID", value),
    findRowsByRowId: async (_table, value) => selected("ROWID", value),
    findRowsByTokenHash: async (_table, value) => selected("TOKEN_HASH", value),
    async insertRow(_table, row) { raw = { ROWID: "1", ...row }; },
    async updateRow(_table, patch, expected) {
      const recovery = String(patch.LAST_OUTCOME ?? "").startsWith("r1_");
      if (recovery && faults.reserveBefore) throw new Error("private reservation transport");
      if (raw.ROWID === patch.ROWID && Object.entries(expected).every(([key, value]) => raw[key] === value)) {
        Object.assign(raw, patch);
      }
      if (recovery && faults.reserveAfter) throw new Error("private reservation transport");
      return [];
    },
  };
  const store = createSessionStore(adapter, originalConfig, { now: () => clock,
    randomUUID: () => `00000000-0000-4000-8000-${String(owner++).padStart(12, "0")}` });
  const issued = await store.issue({ tokenHash: "b".repeat(64), crmModule: "Leads",
    recordId: RECORD_ID, journeyId: "journey_synthetic_recovery" });
  const handle = await store.issuePrefillHandle(issued, { handleHash: "c".repeat(64), prefillId: PREFILL_ID });
  const prefilled = await store.consumePrefillHandle(handle, "c".repeat(64), VERSION);
  const body = { prefillId: PREFILL_ID, configurationRevision: REVISION,
    submissionId: "synthetic-original-entry", formData: formData() };
  const fingerprint = submissionFingerprint(body.submissionId, PREFILL_ID, REVISION,
    normalizeFormData(body.formData), originalConfig.tokenPepper);
  await store.beginSubmission(prefilled.row, fingerprint, VERSION);
  // Represent the persisted initial recovery checkpoint without changing its claim.
  raw.SESSION_VERSION = 17;
  const initialClaim = await store.readByPrefillId(PREFILL_ID);
  let original = initialClaim;
  clock += 1000;
  if (predecessorRevision) {
    original = (await store.reserveRecoveryAttempt(initialClaim, predecessorRevision)).row;
    clock += 1000;
  }
  const config = { ...originalConfig, sourceRevision: CURRENT_REVISION, platformOperationTimeoutMs: 100,
    recoveryManifest: { schemaVersion: 1, mode, originalSourceRevision: REVISION,
      claimBindingSha256: recoveryClaimBindingSha256(original),
      assistedConstantsSha256: assistedConstantsSha256(originalConfig.assistedConstants),
      originalSessionVersion: original.sessionVersion, originalUpdatedAt: original.updatedAt,
      originalLastOutcome: original.lastOutcome } };
  const patch = buildCrmPatch(body.formData, config.assistedConstants,
    { journeyId: original.journeyId, submittedAt: original.submissionStartedAt });
  let record = { id: RECORD_ID, Intake_Submission_ID: original.journeyId, Modified_Time: VERSION };
  const crm = {
    async getRecord(module, id) {
      events.push("read"); assert.equal(module, "Leads"); assert.equal(id, RECORD_ID);
      return { ...record };
    },
    assertJourney(row, journey) { assert.equal(row.Intake_Submission_ID, journey); },
    recordVersion: row => row.Modified_Time,
    recordMatches: (row, expected) => Object.entries(expected).every(([key, value]) => row?.[key] === value),
    async preflightAssistedWrite() {
      events.push("preflight");
      if (faults.preflight) throw faults.preflight;
      return { ok: true };
    },
    async completeAssistedSubmission(module, row, expected, version) {
      events.push("put"); assert.equal(module, "Leads"); assert.equal(version, VERSION);
      assert.equal(row.Modified_Time, VERSION);
      if (faults.write === "reject") throw Object.assign(new Error("private payload"),
        { publicCode: "reconciliation_required", status: 503, ambiguous: true });
      Object.assign(record, expected, { Modified_Time: "2026-09-01T12:01:00+00:00" });
      if (faults.write === "timeout") return new Promise(() => {});
      if (faults.write === "bad_readback") return { record: { ...record, Company: "mismatch" } };
      return { record: { ...record }, replayed: faults.write === "reconciled" };
    },
  };
  const recoveryStore = {
    readByPrefillId: (...args) => store.readByPrefillId(...args),
    assertRuntimeBinding: (...args) => store.assertRuntimeBinding(...args),
    reserveRecoveryAttempt: async (...args) => { events.push("reserve"); return store.reserveRecoveryAttempt(...args); },
    consume: async (...args) => {
      events.push("consume");
      const result = await store.consume(...args);
      if (faults.consume) return new Promise(() => {});
      return result;
    },
  };
  const deps = { config, recoverySessionStore: recoveryStore, crmClient: crm };
  return { body, config, deps, initialClaim, original, patch, faults, events, store,
    run: () => recoverAssistedSubmission(body, deps),
    raw: () => raw, record: () => record, setRecord: next => { record = next; } };
}

test("complete packet hashes include every key and ignore only object key order", async () => {
  const f = await fixture();
  const reversed = Object.fromEntries(Object.entries(f.original).reverse());
  assert.equal(recoveryClaimBindingSha256(reversed), recoveryClaimBindingSha256(f.original));
  for (const [key, value] of Object.entries(f.original)) {
    const changed = value === null ? "changed" : typeof value === "number" ? value + 1 : `${value}x`;
    assert.notEqual(recoveryClaimBindingSha256({ ...f.original, [key]: changed }),
      recoveryClaimBindingSha256(f.original), key);
  }
});

test("inspect returns retryable 503 and does not reserve, write, or consume", async () => {
  const f = await fixture("inspect");
  const before = { ...f.raw() };
  const result = await f.run();
  assert.equal(result.status, 503); assert.equal(result.body.ok, false);
  assert.equal(result.body.recoveryReady, true);
  assert.deepEqual(f.events, ["read", "preflight"]); assert.deepEqual(f.raw(), before);
});

test("exact completion reserves once, writes once, and preserves original immutable claim", async () => {
  const f = await fixture();
  const result = await f.run();
  assert.equal(result.status, 200); assert.equal(result.body.ok, true);
  assert.deepEqual(f.events, ["read", "preflight", "reserve", "put", "consume"]);
  const consumed = await f.store.readByPrefillId(PREFILL_ID);
  for (const [key, value] of Object.entries(f.original)) {
    if (!["status", "lastOutcome", "sessionVersion", "updatedAt", "consumedAt"].includes(key)) {
      assert.deepEqual(consumed[key], value, key);
    }
  }
  assert.match(consumed.lastOutcome, new RegExp(`^r1_${CURRENT_REVISION}_[a-f0-9]{32}$`));
  assert.equal(consumed.sessionVersion, f.original.sessionVersion + 2);
  await assert.rejects(f.run(), error => error.publicCode === "recovery_binding_mismatch");
  assert.equal(f.events.filter(event => event === "put").length, 1);
});

test("already-written full poststate consumes without PUT despite changed CRM version", async () => {
  const f = await fixture();
  f.setRecord({ ...f.record(), ...f.patch, Modified_Time: "2026-09-01T12:02:00+00:00" });
  const result = await f.run();
  assert.equal(result.status, 200); assert.equal(result.body.replayed, true);
  assert.deepEqual(f.events, ["read", "consume"]);
});

test("stale nonmatching CRM state cannot reserve or PUT", async () => {
  const f = await fixture();
  f.setRecord({ ...f.record(), Modified_Time: "2026-09-01T12:02:00+00:00" });
  await assert.rejects(f.run(), error => error.publicCode === "record_stale");
  assert.deepEqual(f.events, ["read"]);
});

test("concurrent completion at identical clock authorizes at most one CRM PUT", async () => {
  const f = await fixture();
  await Promise.allSettled([f.run(), f.run()]);
  assert.equal(f.events.filter(event => event === "put").length, 1);
  assert.equal(f.raw().STATUS, "consumed");
});

test("ambiguous before/after-commit reservations never grant PUT", async () => {
  for (const fault of ["reserveBefore", "reserveAfter"]) {
    const f = await fixture(); f.faults[fault] = true;
    await assert.rejects(f.run());
    assert.equal(f.events.includes("put"), false); assert.equal(f.events.includes("consume"), false);
    if (fault === "reserveAfter") {
      f.faults.reserveAfter = false;
      await assert.rejects(f.run(), error => error.publicCode === "recovery_attempt_reserved");
      assert.equal(f.events.includes("put"), false);
    }
  }
});

test("reserved restart before PUT is reconcile-only and inspection is not ready", async () => {
  const f = await fixture();
  await f.store.reserveRecoveryAttempt(f.original, CURRENT_REVISION);
  await assert.rejects(f.run(), error => error.publicCode === "recovery_attempt_reserved");
  f.config.recoveryManifest.mode = "inspect";
  assert.equal((await f.run()).body.recoveryReady, false);
  assert.equal(f.events.includes("put"), false);
});

test("reservation restores only three operational fields; immutable and marker tampering rejected", async () => {
  for (const [key, value] of [["SOURCE_REVISION", "d".repeat(40)],
    ["CRM_RECORD_VERSION", "2026-09-01T11:58:00+00:00"],
    ["SUBMISSION_FINGERPRINT", "e".repeat(64)],
    ["LAST_OUTCOME", `r1_${"f".repeat(40)}_${"1".repeat(32)}`],
    ["LAST_OUTCOME", `r1_${CURRENT_REVISION}_${"0".repeat(32)}`], ["SESSION_VERSION", 99]]) {
    const f = await fixture(); await f.store.reserveRecoveryAttempt(f.original, CURRENT_REVISION);
    f.setRecord({ ...f.record(), ...f.patch, Modified_Time: "2026-09-01T12:02:00+00:00" });
    f.raw()[key] = value;
    await assert.rejects(f.run()); assert.deepEqual(f.events, []);
  }
});

test("original payload/identity/pepper/constants/manifest/environment mismatch cannot reach CRM", async () => {
  for (const mutate of [f => { f.body.submissionId = "other-entry"; },
    f => { f.body.formData.company = "ZZZ CHANGED"; }, f => { f.config.tokenPepper = "q".repeat(43); },
    f => { f.config.assistedConstants = { ...f.config.assistedConstants, entryOffer: "Changed" }; },
    f => { f.config.recoveryManifest = null; }, f => { f.config.deploymentEnvironment = "production"; },
    f => { f.config.recoveryManifest.extra = true; }, f => { f.body.recordId = RECORD_ID; }]) {
    const f = await fixture(); mutate(f);
    await assert.rejects(f.run()); assert.deepEqual(f.events, []);
  }
});

test("write timeout is ambiguous, never retried; later exact poststate permits consume only", async () => {
  const f = await fixture(); f.config.platformOperationTimeoutMs = 5; f.faults.write = "timeout";
  await assert.rejects(f.run(), error => error.ambiguous === true);
  assert.equal(f.events.filter(event => event === "put").length, 1);
  assert.equal(f.events.includes("consume"), false);
  f.faults.write = null;
  assert.equal((await f.run()).status, 200);
  assert.equal(f.events.filter(event => event === "put").length, 1);
});

test("ambiguous or invalid write readback never consumes and cannot authorize another PUT", async () => {
  for (const fault of ["reject", "bad_readback"]) {
    const f = await fixture(); f.faults.write = fault;
    await assert.rejects(f.run()); assert.equal(f.events.includes("consume"), false);
    if (fault === "reject") await assert.rejects(f.run());
    else assert.equal((await f.run()).status, 200);
    assert.equal(f.events.filter(event => event === "put").length, 1);
  }
});

test("consume commit timeout retains original terminal evidence and never another PUT", async () => {
  const f = await fixture(); f.config.platformOperationTimeoutMs = 5; f.faults.consume = true;
  await assert.rejects(f.run(), error => error.ambiguous === true);
  assert.equal(f.raw().STATUS, "consumed");
  await assert.rejects(f.run(), error => error.publicCode === "recovery_binding_mismatch");
  assert.equal(f.events.filter(event => event === "put").length, 1);
});

test("dependency failures emit only sanitized reusable diagnostics", async () => {
  const f = await fixture("inspect");
  f.faults.preflight = Object.assign(new Error("private-token-and-payload"), {
    status: 503, publicCode: "connection_unavailable", diagnostic: {
      stage: "writer_credentials", httpStatus: 405, providerCode: "INVALID_REQUEST_METHOD",
      payload: "private-token-and-payload", message: "private-token-and-payload" } });
  await assert.rejects(f.run(), error => {
    assert.ok(error instanceof RecoveryError);
    assert.equal(error.diagnostic.httpStatus, 405);
    assert.ok(!JSON.stringify(error).includes("private-token-and-payload"));
    assert.ok(!error.message.includes("private-token-and-payload"));
    return true;
  });
  assert.equal(f.events.includes("reserve"), false);
});

test("approved follow-on pins the full prior reservation and inspects without changing it", async () => {
  const f = await fixture("inspect", PREDECESSOR_REVISION);
  const before = { ...f.raw() };
  assert.equal(f.initialClaim.sessionVersion, 17);
  assert.equal(f.original.sessionVersion, 18);
  assert.equal(f.config.recoveryManifest.originalLastOutcome, f.original.lastOutcome);
  assert.equal(f.config.recoveryManifest.claimBindingSha256, recoveryClaimBindingSha256(f.original));
  const result = await f.run();
  assert.equal(result.status, 503); assert.equal(result.body.recoveryReady, true);
  assert.deepEqual(f.events, ["read", "preflight"]); assert.deepEqual(f.raw(), before);
});

test("follow-on uses a distinct one-shot reservation and preserves the initial claim", async () => {
  const f = await fixture("complete", PREDECESSOR_REVISION);
  const priorPacket = { ...f.config.recoveryManifest };
  assert.equal((await f.run()).status, 200);
  const row = await f.store.readByPrefillId(PREFILL_ID);
  assert.equal(row.sessionVersion, 20);
  assert.match(row.lastOutcome, new RegExp(`^r1_${CURRENT_REVISION}_`));
  assert.notEqual(row.lastOutcome, f.original.lastOutcome);
  assert.deepEqual(f.config.recoveryManifest, priorPacket);
  for (const [key, value] of Object.entries(f.initialClaim)) {
    if (!["status", "lastOutcome", "sessionVersion", "updatedAt", "consumedAt"].includes(key)) {
      assert.deepEqual(row[key], value, key);
    }
  }
  assert.deepEqual(f.events, ["read", "preflight", "reserve", "put", "consume"]);
  await assert.rejects(f.run(), error => error.publicCode === "recovery_binding_mismatch");
  assert.equal(f.events.filter(event => event === "put").length, 1);
});

test("already-written follow-on poststate consumes while preserving its predecessor marker", async () => {
  const f = await fixture("complete", PREDECESSOR_REVISION);
  f.setRecord({ ...f.record(), ...f.patch, Modified_Time: "2026-09-01T12:02:00+00:00" });
  assert.equal((await f.run()).status, 200);
  assert.equal(f.raw().LAST_OUTCOME, f.original.lastOutcome);
  assert.equal(f.raw().SESSION_VERSION, 19);
  assert.deepEqual(f.events, ["read", "consume"]);
});

test("follow-on refuses malformed, current-artifact, wrong, or altered predecessor packets", async () => {
  const uuid = "00000000000040008000000000000001";
  for (const mutate of [
    f => { f.config.recoveryManifest.originalLastOutcome = `r1_${PREDECESSOR_REVISION}_${"0".repeat(32)}`; },
    f => { f.config.recoveryManifest.originalLastOutcome = `r1_${CURRENT_REVISION}_${uuid}`; },
    f => { f.config.recoveryManifest.originalLastOutcome = `r1_${"c".repeat(40)}_${uuid}`; },
    f => { f.config.recoveryManifest.claimBindingSha256 = recoveryClaimBindingSha256(f.initialClaim); },
    f => { f.raw().LAST_OUTCOME = `r1_${PREDECESSOR_REVISION}_${uuid}`; },
    f => { f.raw().SUBMISSION_CLAIM_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; },
    f => { f.raw().SUBMISSION_STARTED_AT = "2026-09-01T12:00:00.001Z"; },
    f => { f.raw().SESSION_VERSION = 19; },
    f => { f.body.formData.email = "other@example.invalid"; },
  ]) {
    const f = await fixture("complete", PREDECESSOR_REVISION);
    f.setRecord({ ...f.record(), ...f.patch, Modified_Time: "2026-09-01T12:02:00+00:00" });
    mutate(f);
    await assert.rejects(f.run());
    assert.deepEqual(f.events, []);
  }
});

test("concurrent follow-on requests at the same clock permit only one conditional PUT", async () => {
  const f = await fixture("complete", PREDECESSOR_REVISION);
  await Promise.allSettled([f.run(), f.run(), f.run()]);
  assert.equal(f.events.filter(event => event === "put").length, 1);
  assert.equal(f.raw().STATUS, "consumed");
  assert.equal(f.raw().SESSION_VERSION, 20);
});

test("ambiguous follow-on reservation never grants a write or erases predecessor evidence", async () => {
  for (const fault of ["reserveBefore", "reserveAfter"]) {
    const f = await fixture("complete", PREDECESSOR_REVISION); f.faults[fault] = true;
    await assert.rejects(f.run());
    assert.equal(f.events.includes("put"), false); assert.equal(f.events.includes("consume"), false);
    assert.equal(f.config.recoveryManifest.originalLastOutcome, f.original.lastOutcome);
    if (fault === "reserveBefore") {
      assert.equal(f.raw().LAST_OUTCOME, f.original.lastOutcome);
      assert.equal(f.raw().SESSION_VERSION, 18);
    } else {
      f.faults.reserveAfter = false;
      await assert.rejects(f.run(), error => error.publicCode === "recovery_attempt_reserved");
      assert.equal(f.raw().SESSION_VERSION, 19);
      assert.equal(f.events.includes("put"), false);
    }
  }
});

test("follow-on write ambiguity remains permanently no-PUT on restart", async () => {
  for (const fault of ["reject", "timeout"]) {
    const f = await fixture("complete", PREDECESSOR_REVISION);
    f.config.platformOperationTimeoutMs = 5; f.faults.write = fault;
    await assert.rejects(f.run(), error => error.ambiguous === true);
    if (fault === "reject") await assert.rejects(f.run(), error => error.publicCode === "recovery_attempt_reserved");
    else assert.equal((await f.run()).status, 200);
    assert.equal(f.events.filter(event => event === "put").length, 1);
  }
});
