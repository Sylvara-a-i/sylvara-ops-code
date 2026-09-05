"use strict";

const crypto = require("node:crypto");
const { sanitizeProviderDiagnostic } = require("./connection-boundary");
const { buildCrmPatch, normalizeFormData } = require("./form-contract");
const { withOperationTimeout } = require("./operation-timeout");
const {
  constantTimeEqual, normalizeConfigurationRevision, normalizeCrmModule, normalizeCrmRecordId,
  normalizeJourneyId, normalizePrefillId, normalizeSubmissionId, submissionFingerprint,
} = require("./security");

const MANIFEST_KEYS = ["schemaVersion", "mode", "originalSourceRevision", "claimBindingSha256",
  "assistedConstantsSha256", "originalSessionVersion", "originalUpdatedAt", "originalLastOutcome"];
const BODY_KEYS = ["prefillId", "configurationRevision", "submissionId", "formData"];
const CONSTANT_KEYS = ["entryOffer", "intakeFormVersion", "leadStatus", "sourcePage",
  "submissionChannel"];
const DIAGNOSTIC_STAGES = new Set(["writer_credentials", "writer_organization", "crm_write",
  "crm_readback"]);
const SAFE_ERRORS = new Set(["configuration_invalid", "request_invalid", "form_data_invalid",
  "session_not_found", "session_state_invalid", "submission_conflict", "record_stale",
  "context_conflict", "context_not_found", "reconciliation_required", "connection_unavailable",
  "connection_organization_mismatch", "crm_dependency_failed", "crm_rejected", "dependency_timeout",
  "recovery_unavailable", "recovery_binding_mismatch", "recovery_attempt_reserved"]);

class RecoveryError extends Error {
  constructor(publicCode, status = 503, ambiguous = false) {
    super("The bounded assisted recovery stopped without completion");
    this.name = "RecoveryError";
    this.publicCode = publicCode;
    this.status = status;
    this.ambiguous = ambiguous;
  }
}

function fail(code, status = 503, ambiguous = false) {
  throw new RecoveryError(code, status, ambiguous);
}

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactKeys(value, keys) {
  return plain(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key =>
    Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"));
}

function canonicalTime(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}

function isCurrentReservation(value, sourceRevision) {
  return typeof value === "string" && new RegExp(
    `^r1_${sourceRevision}_[a-f0-9]{12}4[a-f0-9]{3}[89ab][a-f0-9]{15}$`,
  ).test(value);
}

function isApprovedPredecessor(value, sourceRevision) {
  return value === "submission_started" || (typeof value === "string" &&
    /^r1_[a-f0-9]{40}_[a-f0-9]{12}4[a-f0-9]{3}[89ab][a-f0-9]{15}$/.test(value) &&
    !isCurrentReservation(value, sourceRevision));
}

// Both packets are flat normalized objects. All fields are included; sorting
// makes key order immaterial without dropping a timestamp, version, or binding.
function packetSha256(packet) {
  if (!plain(packet)) fail("configuration_invalid");
  const keys = Reflect.ownKeys(packet);
  if (!keys.length || keys.some(key => typeof key !== "string" ||
      ["__proto__", "constructor", "prototype"].includes(key) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(packet, key), "value"))) {
    fail("configuration_invalid");
  }
  const sorted = {};
  for (const key of keys.sort()) {
    const value = packet[key];
    if (!(value === null || typeof value === "string" || typeof value === "boolean" ||
        (typeof value === "number" && Number.isSafeInteger(value)))) fail("configuration_invalid");
    sorted[key] = value;
  }
  return crypto.createHash("sha256").update(JSON.stringify(sorted), "utf8").digest("hex");
}

function recoveryClaimBindingSha256(session) {
  return packetSha256(session);
}

function assistedConstantsSha256(constants) {
  if (!exactKeys(constants, CONSTANT_KEYS) ||
      CONSTANT_KEYS.some(key => typeof constants[key] !== "string" || !constants[key])) {
    fail("configuration_invalid");
  }
  return packetSha256(constants);
}

function validateConfiguration(config, store, crm) {
  const manifest = config?.recoveryManifest;
  if (config?.deploymentEnvironment !== "development" || config?.deploymentMode !== "active" ||
      !exactKeys(manifest, MANIFEST_KEYS) || manifest.schemaVersion !== 1 ||
      !new Set(["inspect", "complete"]).has(manifest.mode) ||
      !/^[a-f0-9]{40}$/.test(manifest.originalSourceRevision ?? "") ||
      !/^[a-f0-9]{40}$/.test(config.sourceRevision ?? "") ||
      manifest.originalSourceRevision === config.sourceRevision ||
      !/^[a-f0-9]{64}$/.test(manifest.claimBindingSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(manifest.assistedConstantsSha256 ?? "") ||
      !Number.isSafeInteger(manifest.originalSessionVersion) || manifest.originalSessionVersion < 1 ||
      manifest.originalSessionVersion > Number.MAX_SAFE_INTEGER - 2 ||
      !canonicalTime(manifest.originalUpdatedAt) ||
      !isApprovedPredecessor(manifest.originalLastOutcome, config.sourceRevision) ||
      !Number.isSafeInteger(config.platformOperationTimeoutMs) || config.platformOperationTimeoutMs < 1 ||
      config.platformOperationTimeoutMs > 30000 ||
      !constantTimeEqual(assistedConstantsSha256(config.assistedConstants), manifest.assistedConstantsSha256) ||
      !["readByPrefillId", "assertRuntimeBinding", "reserveRecoveryAttempt", "consume"]
        .every(key => typeof store?.[key] === "function") ||
      !["getRecord", "assertJourney", "recordVersion", "recordMatches", "preflightAssistedWrite",
        "completeAssistedSubmission"].every(key => typeof crm?.[key] === "function")) {
    fail("recovery_unavailable");
  }
  return manifest;
}

function assertClaim(session, prefillId, config, store) {
  const manifest = config.recoveryManifest;
  if (!session || session.status !== "submitting" || session.prefillId !== prefillId ||
      session.sourceRevision !== manifest.originalSourceRevision ||
      session.configurationRevision !== manifest.originalSourceRevision ||
      session.sourceEnvironment !== "development" || session.expectedStage !== "form1" ||
      session.crmOrganizationHash !== config.crmOrganizationHash ||
      session.formIdentityHash !== config.formIdentityHash || session.issuingActorHash !== config.issuingActorHash ||
      session.consumedAt !== null || !session.submissionClaimId || !session.submissionStartedAt) {
    fail("recovery_binding_mismatch", 409);
  }
  normalizeCrmModule(session.crmModule);
  normalizeCrmRecordId(session.recordId);
  normalizeJourneyId(session.journeyId);
  store.assertRuntimeBinding(session);
  const reserved = isCurrentReservation(session.lastOutcome, config.sourceRevision);
  if (reserved && (session.sessionVersion !== manifest.originalSessionVersion + 1 ||
      !canonicalTime(session.updatedAt) || session.updatedAt < manifest.originalUpdatedAt)) {
    fail("recovery_binding_mismatch", 409);
  }
  // Only the three reservation fields may differ from the complete approved
  // prestate. A separately approved follow-on pins the prior reservation itself
  // in that packet; it never clears a marker or rewrites the original claim.
  // Terminal replay never receives this normalization.
  const original = reserved ? { ...session, sessionVersion: manifest.originalSessionVersion,
    updatedAt: manifest.originalUpdatedAt, lastOutcome: manifest.originalLastOutcome } : session;
  if (original.sessionVersion !== manifest.originalSessionVersion ||
      original.updatedAt !== manifest.originalUpdatedAt || original.lastOutcome !== manifest.originalLastOutcome ||
      !constantTimeEqual(recoveryClaimBindingSha256(original), manifest.claimBindingSha256)) {
    fail("recovery_binding_mismatch", 409);
  }
  return reserved;
}

function assertRecordIdentity(record, session, crm) {
  if (!record || record.id !== session.recordId) fail("context_conflict", 409);
  crm.assertJourney(record, session.journeyId);
}

function sanitizedError(error) {
  if (error instanceof RecoveryError) return error;
  const safe = new RecoveryError(SAFE_ERRORS.has(error?.publicCode) ? error.publicCode : "recovery_unavailable",
    [404, 409, 422, 502, 503].includes(error?.status) ? error.status : 503, error?.ambiguous === true);
  if (DIAGNOSTIC_STAGES.has(error?.diagnostic?.stage)) {
    safe.diagnostic = Object.freeze({ stage: error.diagnostic.stage,
      ...sanitizeProviderDiagnostic(error.diagnostic) });
  }
  return safe;
}

/** Authenticated original Submission envelope only; no launcher/reset/new claim is exposed. */
async function recoverAssistedSubmission(body, dependencies) {
  try {
    const { config, recoverySessionStore: store, crmClient: crm } = dependencies ?? {};
    const manifest = validateConfiguration(config, store, crm);
    const bounded = (operation, ambiguous = false) => withOperationTimeout(operation,
      config.platformOperationTimeoutMs, { ambiguous });
    if (!exactKeys(body, BODY_KEYS)) fail("request_invalid", 422);
    const prefillId = normalizePrefillId(body.prefillId);
    const revision = normalizeConfigurationRevision(body.configurationRevision);
    const submissionId = normalizeSubmissionId(body.submissionId);
    if (revision !== manifest.originalSourceRevision) fail("recovery_binding_mismatch", 409);
    const normalized = normalizeFormData(body.formData);
    let session = await bounded(() => store.readByPrefillId(prefillId));
    const reserved = assertClaim(session, prefillId, config, store);
    const fingerprint = submissionFingerprint(submissionId, prefillId, revision, normalized, config.tokenPepper);
    if (!constantTimeEqual(fingerprint, session.submissionFingerprint)) fail("submission_conflict", 409);
    const patch = buildCrmPatch(body.formData, config.assistedConstants, {
      journeyId: session.journeyId, submittedAt: session.submissionStartedAt,
    });
    let record = await bounded(() => crm.getRecord(session.crmModule, session.recordId));
    assertRecordIdentity(record, session, crm);
    let poststateMatches = crm.recordMatches(record, patch);
    const originalVersionMatches = crm.recordVersion(record) === session.crmRecordVersion;
    if (manifest.mode === "inspect") {
      await bounded(() => crm.preflightAssistedWrite());
      // Do not acknowledge the Forms entry as delivered on a read-only inspection.
      return Object.freeze({ status: 503, stage: "submission", outcome: "recovery_inspected",
        body: Object.freeze({ ok: false, inspected: true, poststateMatches, originalVersionMatches,
          recoveryReady: poststateMatches || (!reserved && originalVersionMatches) }) });
    }
    const alreadyPersisted = poststateMatches;
    if (!poststateMatches) {
      if (reserved) fail("recovery_attempt_reserved", 503, true);
      if (!originalVersionMatches) fail("record_stale", 409);
      await bounded(() => crm.preflightAssistedWrite());
      const reservation = await bounded(() => store.reserveRecoveryAttempt(session, config.sourceRevision,
        manifest.originalLastOutcome), true);
      session = reservation?.row;
      const hasReservation = assertClaim(session, prefillId, config, store);
      if (typeof reservation.acquired !== "boolean" || (reservation.acquired && !hasReservation)) {
        fail("recovery_binding_mismatch", 409);
      }
      if (reservation.acquired === true) {
        // Only the durable reservation winner may reach the existing one-PUT
        // boundary. Ambiguity is reconciled there by readback, never PUT retry.
        const completed = await bounded(() => crm.completeAssistedSubmission(session.crmModule,
          record, patch, session.crmRecordVersion), true);
        record = completed?.record;
      } else {
        // A loser/ambiguous reservation/restart is permanently read-only for CRM.
        record = await bounded(() => crm.getRecord(session.crmModule, session.recordId));
      }
      assertRecordIdentity(record, session, crm);
      poststateMatches = crm.recordMatches(record, patch);
      if (!poststateMatches) fail("reconciliation_required", 503, true);
    }
    const consumed = await bounded(() => store.consume(session, fingerprint), true);
    const row = consumed?.row;
    if (!row || !canonicalTime(row.consumedAt) || row.consumedAt < session.updatedAt) {
      fail("reconciliation_required", 503, true);
    }
    // A pre-existing exact CRM poststate needs no new reservation. Retain its
    // approved predecessor marker too, rather than losing prior attempt evidence.
    const terminalOutcome = session.lastOutcome === "submission_started" ? "submitted" : session.lastOutcome;
    const expected = { ...session, status: "consumed", lastOutcome: terminalOutcome,
      sessionVersion: session.sessionVersion + 1, consumedAt: row.consumedAt, updatedAt: row.consumedAt };
    if (!constantTimeEqual(recoveryClaimBindingSha256(row), recoveryClaimBindingSha256(expected))) {
      fail("reconciliation_required", 503, true);
    }
    return Object.freeze({ status: 200, stage: "submission", outcome: "recovery_completed",
      body: Object.freeze({ ok: true, recovered: true, replayed: alreadyPersisted }) });
  } catch (error) {
    throw sanitizedError(error);
  }
}

module.exports = { RecoveryError, assistedConstantsSha256, recoverAssistedSubmission,
  recoveryClaimBindingSha256 };
