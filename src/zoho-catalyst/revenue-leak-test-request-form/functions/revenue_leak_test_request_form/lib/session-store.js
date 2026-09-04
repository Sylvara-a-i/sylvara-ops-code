"use strict";

const crypto = require("node:crypto");

const {
  isValidTokenHash,
  normalizeCrmModule,
  normalizeCrmRecordId,
  normalizeJourneyId,
  normalizePrefillId,
  validateOperatorHash,
} = require("./security");

const ROW_ID_PATTERN = /^[0-9]{1,30}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REVISION_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const CLAIM_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const STAGE = "form1";
const MAX_PREFILLS = 1;
const ACTIVE_STATUSES = new Set(["issued", "handle_issued", "prefilled"]);

class SessionStoreError extends Error {
  constructor(message, { publicCode = "session_store_unavailable", ambiguous = false,
    status = 503 } = {}) {
    super(message);
    this.name = "SessionStoreError";
    this.status = status;
    this.publicCode = publicCode;
    this.ambiguous = ambiguous;
  }
}

function fail(message, options) {
  throw new SessionStoreError(message, options);
}

function integer(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${name} is invalid`);
  }
  return parsed;
}

function iso(value, name, optional = false) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || !ISO_PATTERN.test(value) ||
      new Date(Date.parse(value)).toISOString() !== value) fail(`${name} is invalid`);
  return value;
}

function crmRecordVersion(value, optional = false) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value)) ||
      !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) fail("CRM_RECORD_VERSION is invalid");
  return value;
}

function unwrap(raw, table) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw[table] && typeof raw[table] === "object" ? raw[table] : raw;
}

function normalizeRow(raw, table) {
  const value = unwrap(raw, table);
  if (!value) fail("Session row is unavailable");
  const selected = {
    rowId: String(value.ROWID ?? ""),
    tokenHash: String(value.TOKEN_HASH ?? ""),
    prefillHandleHash: value.PREFILL_HANDLE_HASH ?? null,
    prefillHandleIssuedAt: value.PREFILL_HANDLE_ISSUED_AT ?? null,
    prefillHandleExpiresAt: value.PREFILL_HANDLE_EXPIRES_AT ?? null,
    prefillHandleConsumedAt: value.PREFILL_HANDLE_CONSUMED_AT ?? null,
    prefillConsumptionOwner: value.PREFILL_CONSUMPTION_OWNER ?? null,
    prefillId: value.PREFILL_ID ?? null,
    configurationRevision: value.CONFIGURATION_REVISION ?? null,
    formIdentityHash: String(value.FORM_IDENTITY_HASH ?? ""),
    recordId: String(value.CRM_LEAD_ID ?? ""),
    journeyId: String(value.INTAKE_SUBMISSION_ID ?? ""),
    status: String(value.STATUS ?? ""),
    issuedAt: String(value.ISSUED_AT ?? ""),
    expiresAt: String(value.EXPIRES_AT ?? ""),
    prefillCount: integer(value.PREFILL_COUNT, "PREFILL_COUNT", 0, MAX_PREFILLS),
    maxPrefills: integer(value.MAX_PREFILLS, "MAX_PREFILLS", MAX_PREFILLS, MAX_PREFILLS),
    sourceRevision: String(value.SOURCE_REVISION ?? ""),
    sourceEnvironment: String(value.SOURCE_ENVIRONMENT ?? ""),
    lastOutcome: String(value.LAST_OUTCOME ?? ""),
    lastPrefilledAt: value.LAST_PREFILLED_AT ?? null,
    revokedAt: value.REVOKED_AT ?? null,
    updatedAt: String(value.UPDATED_AT ?? ""),
    crmOrganizationHash: String(value.CRM_ORGANIZATION_HASH ?? ""),
    crmModule: String(value.CRM_MODULE ?? ""),
    expectedStage: String(value.EXPECTED_STAGE ?? ""),
    issuingActorHash: String(value.ISSUING_ACTOR_HASH ?? ""),
    createdAt: String(value.CREATED_AT ?? ""),
    consumedAt: value.CONSUMED_AT ?? null,
    submissionFingerprint: value.SUBMISSION_FINGERPRINT ?? null,
    submissionStartedAt: value.SUBMISSION_STARTED_AT ?? null,
    submissionClaimId: value.SUBMISSION_CLAIM_ID ?? null,
    crmRecordVersion: value.CRM_RECORD_VERSION ?? null,
    sessionVersion: integer(value.SESSION_VERSION, "SESSION_VERSION", 1),
  };
  if (!ROW_ID_PATTERN.test(selected.rowId) || !isValidTokenHash(selected.tokenHash) ||
      !REVISION_PATTERN.test(selected.sourceRevision) ||
      !SHA256_PATTERN.test(selected.formIdentityHash) ||
      selected.sourceEnvironment !== "development" ||
      !SHA256_PATTERN.test(selected.crmOrganizationHash) ||
      selected.expectedStage !== STAGE ||
      !new Set(["issued", "handle_issued", "prefilled", "submitting", "consumed", "expired", "revoked"])
        .has(selected.status)) {
    fail("Session row contains invalid state");
  }
  normalizeCrmRecordId(selected.recordId);
  normalizeCrmModule(selected.crmModule);
  normalizeJourneyId(selected.journeyId);
  validateOperatorHash(selected.issuingActorHash);
  iso(selected.issuedAt, "ISSUED_AT");
  iso(selected.expiresAt, "EXPIRES_AT");
  iso(selected.createdAt, "CREATED_AT");
  iso(selected.updatedAt, "UPDATED_AT");
  iso(selected.lastPrefilledAt, "LAST_PREFILLED_AT", true);
  iso(selected.revokedAt, "REVOKED_AT", true);
  iso(selected.consumedAt, "CONSUMED_AT", true);
  iso(selected.submissionStartedAt, "SUBMISSION_STARTED_AT", true);
  iso(selected.prefillHandleIssuedAt, "PREFILL_HANDLE_ISSUED_AT", true);
  iso(selected.prefillHandleExpiresAt, "PREFILL_HANDLE_EXPIRES_AT", true);
  iso(selected.prefillHandleConsumedAt, "PREFILL_HANDLE_CONSUMED_AT", true);
  crmRecordVersion(selected.crmRecordVersion, true);
  if (selected.prefillHandleHash !== null && !isValidTokenHash(selected.prefillHandleHash)) {
    fail("PREFILL_HANDLE_HASH is invalid");
  }
  if (selected.prefillConsumptionOwner !== null &&
      !CLAIM_ID_PATTERN.test(selected.prefillConsumptionOwner)) {
    fail("PREFILL_CONSUMPTION_OWNER is invalid");
  }
  if (selected.prefillId !== null) normalizePrefillId(selected.prefillId);
  if (selected.configurationRevision !== null &&
      !REVISION_PATTERN.test(selected.configurationRevision)) {
    fail("CONFIGURATION_REVISION is invalid");
  }
  if (new Set(["handle_issued", "prefilled", "submitting", "consumed"]).has(selected.status) &&
      (!selected.prefillHandleHash || !selected.prefillHandleIssuedAt ||
       !selected.prefillHandleExpiresAt || !selected.prefillId ||
       !selected.configurationRevision)) {
    fail("Prefill handle binding is incomplete");
  }
  if (new Set(["prefilled", "submitting", "consumed"]).has(selected.status) &&
      (!selected.prefillHandleConsumedAt || !selected.prefillConsumptionOwner ||
       !selected.crmRecordVersion)) {
    fail("Prefill completion binding is incomplete");
  }
  if (selected.status === "handle_issued" && selected.prefillConsumptionOwner !== null) {
    fail("Unconsumed prefill handle has an owner");
  }
  if (selected.submissionFingerprint !== null &&
      !FINGERPRINT_PATTERN.test(selected.submissionFingerprint)) {
    fail("SUBMISSION_FINGERPRINT is invalid");
  }
  if (selected.submissionClaimId !== null &&
      !CLAIM_ID_PATTERN.test(selected.submissionClaimId)) {
    fail("SUBMISSION_CLAIM_ID is invalid");
  }
  if (selected.status === "submitting" &&
      (!selected.submissionStartedAt || !selected.submissionFingerprint ||
       !selected.submissionClaimId || !selected.crmRecordVersion || selected.consumedAt)) {
    fail("Submitting session is incomplete");
  }
  if (selected.status === "consumed" &&
      (!selected.consumedAt || !selected.submissionFingerprint ||
       !selected.submissionClaimId || !selected.crmRecordVersion)) {
    fail("Consumed session is incomplete");
  }
  return Object.freeze(selected);
}

function validateConfig(config) {
  if (config?.sessionTableName !== "RevenueLeakTestRequestFormSessions" ||
      config?.deploymentEnvironment !== "development" ||
      !REVISION_PATTERN.test(config?.sourceRevision ?? "") ||
      !SHA256_PATTERN.test(config?.crmOrganizationHash ?? "") ||
      !Number.isSafeInteger(config?.sessionTtlSeconds) ||
      config.sessionTtlSeconds < 300 || config.sessionTtlSeconds > 3600 ||
      !Number.isSafeInteger(config?.prefillHandleTtlSeconds) ||
      config.prefillHandleTtlSeconds < 300 || config.prefillHandleTtlSeconds > 900 ||
      !SHA256_PATTERN.test(config?.formIdentityHash ?? "")) {
    fail("Session configuration is invalid", { publicCode: "configuration_invalid" });
  }
  validateOperatorHash(config.issuingActorHash);
}

function validateAdapter(adapter) {
  for (const name of [
    "findRowsByJourneyId", "findRowsByPrefillHandleHash", "findRowsByPrefillId",
    "findRowsByRowId", "findRowsByTokenHash", "insertRow", "updateRow",
  ]) {
    if (typeof adapter?.[name] !== "function") {
      fail(`Session adapter is missing ${name}`, { publicCode: "configuration_invalid" });
    }
  }
}

function same(actual, expected) {
  if (typeof expected === "number") return Number(actual) === expected;
  return actual === expected;
}

function createSessionStore(adapter, config, {
  now = Date.now, randomUUID = crypto.randomUUID,
} = {}) {
  validateAdapter(adapter);
  validateConfig(config);
  if (typeof now !== "function") fail("Session clock is invalid", {
    publicCode: "configuration_invalid",
  });
  if (typeof randomUUID !== "function") fail("Session entropy is invalid", {
    publicCode: "configuration_invalid",
  });
  const table = config.sessionTableName;

  function timestamp() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) fail("Session clock is invalid", {
      publicCode: "configuration_invalid",
    });
    return value;
  }

  async function unique(operation, allowMissing = false) {
    let rows;
    try {
      rows = await operation();
    } catch (error) {
      fail("Durable session read failed", { ambiguous: error?.ambiguous === true });
    }
    if (!Array.isArray(rows) || rows.length > 1 || (!allowMissing && rows.length !== 1)) {
      fail("Durable session identity is not unique", { ambiguous: true });
    }
    return rows.length ? normalizeRow(rows[0], table) : null;
  }

  const readByTokenHash = (tokenHash) => {
    if (!isValidTokenHash(tokenHash)) fail("Token hash is invalid", {
      publicCode: "session_input_invalid",
      status: 422,
    });
    return unique(() => adapter.findRowsByTokenHash(table, tokenHash), true);
  };
  const readByPrefillHandleHash = (handleHash) => {
    if (!isValidTokenHash(handleHash)) fail("Prefill handle hash is invalid", {
      publicCode: "session_input_invalid",
      status: 422,
    });
    return unique(() => adapter.findRowsByPrefillHandleHash(table, handleHash), true);
  };
  const readByPrefillId = (prefillId) =>
    unique(() => adapter.findRowsByPrefillId(table, normalizePrefillId(prefillId)), true);
  const readByJourneyId = (journeyId) =>
    unique(() => adapter.findRowsByJourneyId(table, normalizeJourneyId(journeyId)), true);
  const readByRowId = (rowId) => unique(() => adapter.findRowsByRowId(table, rowId));

  function stableJourneyBinding(row, requested) {
    return row.recordId === requested.recordId &&
      row.journeyId === requested.journeyId &&
      row.crmModule === requested.crmModule &&
      row.crmOrganizationHash === config.crmOrganizationHash &&
      row.expectedStage === STAGE &&
      row.sourceEnvironment === config.deploymentEnvironment &&
      row.issuingActorHash === config.issuingActorHash;
  }

  function stableRuntimeBinding(row) {
    return row.formIdentityHash === config.formIdentityHash &&
      row.sourceRevision === config.sourceRevision;
  }

  function stableBinding(row, requested) {
    return stableJourneyBinding(row, requested) && stableRuntimeBinding(row);
  }

  function isCleanIssuedForBindingMigration(row) {
    return row.status === "issued" && row.prefillCount === 0 &&
      row.prefillHandleHash === null && row.prefillHandleIssuedAt === null &&
      row.prefillHandleExpiresAt === null && row.prefillHandleConsumedAt === null &&
      row.prefillConsumptionOwner === null && row.prefillId === null &&
      row.configurationRevision === null && row.lastPrefilledAt === null &&
      row.revokedAt === null && row.consumedAt === null &&
      row.submissionFingerprint === null && row.submissionStartedAt === null &&
      row.submissionClaimId === null && row.crmRecordVersion === null;
  }

  function assertRuntimeBinding(session) {
    if (!session || session.crmOrganizationHash !== config.crmOrganizationHash
        || session.expectedStage !== STAGE
        || session.formIdentityHash !== config.formIdentityHash
        || session.sourceRevision !== config.sourceRevision
        || session.sourceEnvironment !== config.deploymentEnvironment
        || session.issuingActorHash !== config.issuingActorHash) {
      fail("Assisted session was not found", {
        publicCode: "session_not_found",
        status: 404,
      });
    }
    return session;
  }

  async function checkedUpdate(current, patch) {
    const next = { ...patch, SESSION_VERSION: current.sessionVersion + 1 };
    // Catalyst permits at most five UPDATE conditions. ROWID plus this four-field
    // fence prevents stale transitions; the exact readback below validates every
    // immutable binding and requested poststate without expanding the WHERE clause.
    const expected = {
      SESSION_VERSION: current.sessionVersion,
      STATUS: current.status,
      TOKEN_HASH: current.tokenHash,
      UPDATED_AT: current.updatedAt,
    };
    try {
      await adapter.updateRow(table, { ROWID: current.rowId, ...next }, expected);
    } catch {
      // The write may have committed despite a timeout. The single exact
      // readback below reconciles it without issuing a second mutation.
    }
    const readback = await readByRowId(current.rowId);
    if (!stableBinding(readback, current) || readback.sessionVersion !== current.sessionVersion + 1 ||
        !Object.entries(next).every(([column, value]) => {
          const property = {
            TOKEN_HASH: "tokenHash", STATUS: "status", ISSUED_AT: "issuedAt",
            EXPIRES_AT: "expiresAt", PREFILL_COUNT: "prefillCount", LAST_OUTCOME: "lastOutcome",
            PREFILL_HANDLE_HASH: "prefillHandleHash",
            PREFILL_HANDLE_ISSUED_AT: "prefillHandleIssuedAt",
            PREFILL_HANDLE_EXPIRES_AT: "prefillHandleExpiresAt",
            PREFILL_HANDLE_CONSUMED_AT: "prefillHandleConsumedAt",
            PREFILL_CONSUMPTION_OWNER: "prefillConsumptionOwner",
            PREFILL_ID: "prefillId", CONFIGURATION_REVISION: "configurationRevision",
            LAST_PREFILLED_AT: "lastPrefilledAt", REVOKED_AT: "revokedAt",
            UPDATED_AT: "updatedAt", CONSUMED_AT: "consumedAt",
            SUBMISSION_FINGERPRINT: "submissionFingerprint",
            SUBMISSION_STARTED_AT: "submissionStartedAt",
            SUBMISSION_CLAIM_ID: "submissionClaimId",
            CRM_RECORD_VERSION: "crmRecordVersion", SESSION_VERSION: "sessionVersion",
            SOURCE_REVISION: "sourceRevision", FORM_IDENTITY_HASH: "formIdentityHash",
          }[column];
          return property && same(readback[property], value);
        })) {
      fail("Durable session transition did not converge", { ambiguous: true });
    }
    return readback;
  }

  async function issue({ tokenHash, crmModule, recordId, journeyId }) {
    if (!isValidTokenHash(tokenHash)) fail("Token hash is invalid", {
      publicCode: "session_input_invalid",
      status: 422,
    });
    const requested = {
      crmModule: normalizeCrmModule(crmModule),
      recordId: normalizeCrmRecordId(recordId),
      journeyId: normalizeJourneyId(journeyId),
    };
    const existing = await readByJourneyId(requested.journeyId);
    const nowMs = timestamp();
    const issuedAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + config.sessionTtlSeconds * 1000).toISOString();
    if (existing) {
      if (!stableJourneyBinding(existing, requested)) {
        fail("Journey is already bound to different CRM context", {
          publicCode: "session_binding_conflict",
          status: 409,
        });
      }
      if (existing.status === "consumed") {
        fail("Completed journey cannot be reissued", {
          publicCode: "session_consumed",
          status: 409,
        });
      }
      if (existing.status === "submitting") {
        // Ownership may already have crossed the CRM boundary. Rotating the
        // token here could admit a conflicting second submission.
        fail("Submitting journey requires reconciliation before reissue", {
          publicCode: "submission_in_progress",
          status: 409,
          ambiguous: true,
        });
      }
      const runtimeBindingChanged = !stableRuntimeBinding(existing);
      if (runtimeBindingChanged && !isCleanIssuedForBindingMigration(existing)) {
        // A reviewed release or assisted-form cutover may adopt only a clean
        // issued row. Any downstream binding remains owned by the runtime that
        // created it and requires explicit reconciliation.
        fail("Active journey cannot move to a different runtime binding", {
          publicCode: "session_binding_conflict",
          status: 409,
        });
      }
      return checkedUpdate(existing, {
        TOKEN_HASH: tokenHash,
        STATUS: "issued",
        ISSUED_AT: issuedAt,
        EXPIRES_AT: expiresAt,
        PREFILL_COUNT: 0,
        LAST_OUTCOME: runtimeBindingChanged ?
          `binding_reissued_from_${existing.sourceRevision}` : "reissued",
        LAST_PREFILLED_AT: null,
        REVOKED_AT: null,
        CONSUMED_AT: null,
        SUBMISSION_FINGERPRINT: null,
        SUBMISSION_STARTED_AT: null,
        SUBMISSION_CLAIM_ID: null,
        CRM_RECORD_VERSION: null,
        PREFILL_HANDLE_HASH: null,
        PREFILL_HANDLE_ISSUED_AT: null,
        PREFILL_HANDLE_EXPIRES_AT: null,
        PREFILL_HANDLE_CONSUMED_AT: null,
        PREFILL_CONSUMPTION_OWNER: null,
        PREFILL_ID: null,
        CONFIGURATION_REVISION: null,
        SOURCE_REVISION: config.sourceRevision,
        FORM_IDENTITY_HASH: config.formIdentityHash,
        UPDATED_AT: issuedAt,
      });
    }
    const inserted = {
      TOKEN_HASH: tokenHash,
      CRM_LEAD_ID: requested.recordId,
      INTAKE_SUBMISSION_ID: requested.journeyId,
      STATUS: "issued",
      ISSUED_AT: issuedAt,
      EXPIRES_AT: expiresAt,
      PREFILL_COUNT: 0,
      MAX_PREFILLS,
      SOURCE_REVISION: config.sourceRevision,
      SOURCE_ENVIRONMENT: config.deploymentEnvironment,
      LAST_OUTCOME: "issued",
      LAST_PREFILLED_AT: null,
      REVOKED_AT: null,
      UPDATED_AT: issuedAt,
      CRM_ORGANIZATION_HASH: config.crmOrganizationHash,
      CRM_MODULE: requested.crmModule,
      EXPECTED_STAGE: STAGE,
      FORM_IDENTITY_HASH: config.formIdentityHash,
      ISSUING_ACTOR_HASH: config.issuingActorHash,
      CREATED_AT: issuedAt,
      CONSUMED_AT: null,
      SUBMISSION_FINGERPRINT: null,
      SUBMISSION_STARTED_AT: null,
      SUBMISSION_CLAIM_ID: null,
      CRM_RECORD_VERSION: null,
      PREFILL_HANDLE_HASH: null,
      PREFILL_HANDLE_ISSUED_AT: null,
      PREFILL_HANDLE_EXPIRES_AT: null,
      PREFILL_HANDLE_CONSUMED_AT: null,
      PREFILL_CONSUMPTION_OWNER: null,
      PREFILL_ID: null,
      CONFIGURATION_REVISION: null,
      SESSION_VERSION: 1,
    };
    try {
      await adapter.insertRow(table, inserted);
    } catch {
      // Reconcile the unique journey key; never retry an ambiguous insert.
    }
    const stored = await readByJourneyId(requested.journeyId);
    if (!stored || !stableBinding(stored, requested) || stored.tokenHash !== tokenHash ||
        stored.status !== "issued" || stored.issuedAt !== issuedAt ||
        stored.expiresAt !== expiresAt || stored.sessionVersion !== 1) {
      fail("Durable session issuance could not be verified", { ambiguous: true });
    }
    return stored;
  }

  async function assertUsable(session) {
    assertRuntimeBinding(session);
    if (!session || !ACTIVE_STATUSES.has(session.status)) {
      fail("Assisted session was not found", { publicCode: "session_not_found", status: 404 });
    }
    if (Date.parse(session.expiresAt) <= timestamp()) {
      try {
        await checkedUpdate(session, {
          STATUS: "expired",
          LAST_OUTCOME: "expired",
          REVOKED_AT: new Date(timestamp()).toISOString(),
          UPDATED_AT: new Date(timestamp()).toISOString(),
        });
      } catch {
        // Public behavior remains a generic not-found response.
      }
      fail("Assisted session was not found", { publicCode: "session_not_found", status: 404 });
    }
    return session;
  }

  async function issuePrefillHandle(session, { handleHash, prefillId }) {
    await assertUsable(session);
    if (session.status !== "issued" || !isValidTokenHash(handleHash)) {
      fail("Assisted session was not found", { publicCode: "session_not_found", status: 404 });
    }
    const selectedPrefillId = normalizePrefillId(prefillId);
    const nowMs = timestamp();
    const issuedAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(Math.min(
      Date.parse(session.expiresAt),
      nowMs + config.prefillHandleTtlSeconds * 1000,
    )).toISOString();
    return checkedUpdate(session, {
      STATUS: "handle_issued",
      PREFILL_HANDLE_HASH: handleHash,
      PREFILL_HANDLE_ISSUED_AT: issuedAt,
      PREFILL_HANDLE_EXPIRES_AT: expiresAt,
      PREFILL_HANDLE_CONSUMED_AT: null,
      PREFILL_CONSUMPTION_OWNER: null,
      PREFILL_ID: selectedPrefillId,
      CONFIGURATION_REVISION: config.sourceRevision,
      LAST_OUTCOME: "prefill_handle_issued",
      UPDATED_AT: issuedAt,
    });
  }

  async function resolvePrefillHandle(handleHash) {
    if (!isValidTokenHash(handleHash)) {
      fail("Assisted session was not found", { publicCode: "session_not_found", status: 404 });
    }
    const session = await readByPrefillHandleHash(handleHash);
    assertRuntimeBinding(session);
    if (!session || session.status !== "handle_issued" ||
        session.prefillHandleHash !== handleHash ||
        session.configurationRevision !== config.sourceRevision ||
        Date.parse(session.prefillHandleExpiresAt) <= timestamp() ||
        Date.parse(session.expiresAt) <= timestamp()) {
      fail("Assisted session was not found", { publicCode: "session_not_found", status: 404 });
    }
    return session;
  }

  async function consumePrefillHandle(session, handleHash, recordVersion) {
    assertRuntimeBinding(session);
    const selectedVersion = crmRecordVersion(recordVersion);
    await assertUsable(session);
    if (session.status !== "handle_issued" || session.prefillHandleHash !== handleHash ||
        Date.parse(session.prefillHandleExpiresAt) <= timestamp() ||
        session.prefillCount >= session.maxPrefills) {
      fail("Assisted session was not found", { publicCode: "session_not_found", status: 404 });
    }
    const selectedAt = new Date(timestamp()).toISOString();
    const consumptionOwner = randomUUID();
    if (typeof consumptionOwner !== "string" || !CLAIM_ID_PATTERN.test(consumptionOwner)) {
      fail("Session entropy is invalid", { publicCode: "configuration_invalid" });
    }
    const row = await checkedUpdate(session, {
      STATUS: "prefilled",
      PREFILL_COUNT: session.prefillCount + 1,
      PREFILL_HANDLE_CONSUMED_AT: selectedAt,
      PREFILL_CONSUMPTION_OWNER: consumptionOwner,
      CRM_RECORD_VERSION: selectedVersion,
      LAST_OUTCOME: "prefilled",
      LAST_PREFILLED_AT: selectedAt,
      UPDATED_AT: selectedAt,
    });
    return Object.freeze({ row, replayed: false });
  }

  async function beginSubmission(session, fingerprint, recordVersion = null) {
    assertRuntimeBinding(session);
    if (!FINGERPRINT_PATTERN.test(fingerprint ?? "")) {
      fail("Submission fingerprint is invalid", {
        publicCode: "session_input_invalid",
        status: 422,
      });
    }
    if (session?.status === "consumed") {
      if (session.submissionFingerprint !== fingerprint) {
        fail("Assisted session was consumed by another submission", {
          publicCode: "submission_conflict",
          status: 409,
        });
      }
      return Object.freeze({ row: session, replayed: true });
    }
    if (session?.status === "submitting") {
      if (session.submissionFingerprint !== fingerprint) {
        fail("A different submission owns this assisted session", {
          publicCode: "submission_conflict",
          status: 409,
        });
      }
      return Object.freeze({ row: session, replayed: true });
    }
    await assertUsable(session);
    if (session.status !== "prefilled" || !session.prefillHandleConsumedAt) {
      fail("Assisted session was not prepared by the approved prefill", {
        publicCode: "session_state_invalid",
        status: 409,
      });
    }
    const selectedRecordVersion = crmRecordVersion(recordVersion);
    const startedAt = new Date(timestamp()).toISOString();
    const claimId = randomUUID();
    if (typeof claimId !== "string" || !CLAIM_ID_PATTERN.test(claimId)) {
      fail("Session entropy is invalid", { publicCode: "configuration_invalid" });
    }
    const row = await checkedUpdate(session, {
      STATUS: "submitting",
      LAST_OUTCOME: "submission_started",
      SUBMISSION_STARTED_AT: startedAt,
      SUBMISSION_CLAIM_ID: claimId,
      SUBMISSION_FINGERPRINT: fingerprint,
      CRM_RECORD_VERSION: selectedRecordVersion,
      UPDATED_AT: startedAt,
    });
    return Object.freeze({ row, replayed: false });
  }

  async function consume(session, fingerprint) {
    assertRuntimeBinding(session);
    if (!FINGERPRINT_PATTERN.test(fingerprint ?? "")) {
      fail("Submission fingerprint is invalid", {
        publicCode: "session_input_invalid",
        status: 422,
      });
    }
    if (session?.status === "consumed") {
      if (session.submissionFingerprint !== fingerprint) {
        fail("Assisted session was consumed by another submission", {
          publicCode: "submission_conflict",
          status: 409,
        });
      }
      return Object.freeze({ row: session, replayed: true });
    }
    if (session?.status !== "submitting" || session.submissionFingerprint !== fingerprint) {
      fail("Submission is not durably owned by this request", {
        publicCode: "session_state_invalid",
        status: 409,
      });
    }
    const consumedAt = new Date(timestamp()).toISOString();
    const row = await checkedUpdate(session, {
      STATUS: "consumed",
      LAST_OUTCOME: "submitted",
      CONSUMED_AT: consumedAt,
      SUBMISSION_FINGERPRINT: fingerprint,
      UPDATED_AT: consumedAt,
    });
    return Object.freeze({ row, replayed: false });
  }

  return Object.freeze({
    assertRuntimeBinding,
    assertUsable,
    beginSubmission,
    consumePrefillHandle,
    consume,
    issue,
    issuePrefillHandle,
    readByJourneyId,
    readByPrefillHandleHash,
    readByPrefillId,
    readByRowId,
    readByTokenHash,
    resolvePrefillHandle,
  });
}

module.exports = { MAX_PREFILLS, SessionStoreError, createSessionStore, normalizeRow };
