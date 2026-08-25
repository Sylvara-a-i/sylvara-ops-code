"use strict";

const {
  isValidTokenHash,
  normalizeIntakeSubmissionId,
  normalizeLeadId,
} = require("./security");

// These states fit the already-provisioned single-table contract. REVOKED_AT
// records both TTL expiry and the bounded-prefill circuit breaker.
const SESSION_STATUSES = Object.freeze([
  "issuing",
  "issued",
  "prefilling",
  "prefilled",
  "expired",
  "revoked",
  "failed",
  "reconciliation_required",
]);
const STATUS_SET = new Set(SESSION_STATUSES);
const ROW_ID_PATTERN = /^[0-9]{1,30}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OUTCOME_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const REVISION_PATTERN = /^[a-f0-9]{40}$/;
const RESERVATION_OWNER_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class SessionStoreError extends Error {
  constructor(message, { publicCode = "session_store_unavailable", ambiguous = false } = {}) {
    super(message);
    this.name = "SessionStoreError";
    this.status = 503;
    this.publicCode = publicCode;
    this.ambiguous = ambiguous;
  }
}

function validateAdapter(adapter) {
  for (const method of ["findRowsByRowId", "findRowsByTokenHash", "insertRow", "updateRow"]) {
    if (typeof adapter?.[method] !== "function") {
      throw new SessionStoreError(`Session adapter is missing ${method}`, {
        publicCode: "configuration_invalid",
      });
    }
  }
}

function validateConfig(config) {
  if (
    !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(config?.sessionTableName ?? "") ||
    config?.deploymentEnvironment !== "development" ||
    !REVISION_PATTERN.test(config?.sourceRevision ?? "") ||
    !Number.isSafeInteger(config?.sessionTtlSeconds) ||
    config.sessionTtlSeconds < 300 ||
    config.sessionTtlSeconds > 3600 ||
    !Number.isSafeInteger(config?.maxPrefills) ||
    config.maxPrefills < 2 ||
    config.maxPrefills > 100
  ) {
    throw new SessionStoreError("Session configuration is invalid", {
      publicCode: "configuration_invalid",
    });
  }
}

function validateRowId(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new SessionStoreError("Session ROWID is invalid");
  }
  const normalized = String(value ?? "");
  if (!ROW_ID_PATTERN.test(normalized)) throw new SessionStoreError("Session ROWID is invalid");
  return normalized;
}

function parseIso(value, field, { optional = false } = {}) {
  if (optional && value === "") return null;
  if (typeof value !== "string" || !ISO_PATTERN.test(value)) {
    throw new SessionStoreError(`${field} is invalid`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new SessionStoreError(`${field} is invalid`);
  }
  return milliseconds;
}

function boundedInteger(value, field, minimum, maximum) {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new SessionStoreError(`${field} is invalid`);
  }
  return parsed;
}

function unwrapRow(raw, tableName) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const nested = raw[tableName];
  return nested && typeof nested === "object" && !Array.isArray(nested) ? nested : raw;
}

function normalizeRow(raw, tableName) {
  const row = unwrapRow(raw, tableName);
  if (!row) throw new SessionStoreError("Session row is incomplete");
  const normalized = {
    rowId: validateRowId(row.ROWID),
    tokenHash: String(row.TOKEN_HASH ?? ""),
    leadId: normalizeLeadId(String(row.CRM_LEAD_ID ?? "")),
    intakeSubmissionId: normalizeIntakeSubmissionId(String(row.INTAKE_SUBMISSION_ID ?? "")),
    status: String(row.STATUS ?? ""),
    issuedAt: String(row.ISSUED_AT ?? ""),
    expiresAt: String(row.EXPIRES_AT ?? ""),
    prefillCount: boundedInteger(row.PREFILL_COUNT, "PREFILL_COUNT", 0, 100),
    maxPrefills: boundedInteger(row.MAX_PREFILLS, "MAX_PREFILLS", 2, 100),
    sourceRevision: String(row.SOURCE_REVISION ?? ""),
    sourceEnvironment: String(row.SOURCE_ENVIRONMENT ?? ""),
    lastOutcome: String(row.LAST_OUTCOME ?? ""),
    lastPrefilledAt: String(row.LAST_PREFILLED_AT ?? ""),
    revokedAt: String(row.REVOKED_AT ?? ""),
    updatedAt: String(row.UPDATED_AT ?? ""),
  };
  if (
    !isValidTokenHash(normalized.tokenHash) ||
    !STATUS_SET.has(normalized.status) ||
    !REVISION_PATTERN.test(normalized.sourceRevision) ||
    normalized.sourceEnvironment !== "development" ||
    !OUTCOME_PATTERN.test(normalized.lastOutcome) ||
    normalized.prefillCount > normalized.maxPrefills
  ) {
    throw new SessionStoreError("Session row contains invalid state");
  }
  parseIso(normalized.issuedAt, "ISSUED_AT");
  parseIso(normalized.expiresAt, "EXPIRES_AT");
  parseIso(normalized.updatedAt, "UPDATED_AT");
  parseIso(normalized.lastPrefilledAt, "LAST_PREFILLED_AT", { optional: true });
  parseIso(normalized.revokedAt, "REVOKED_AT", { optional: true });
  return Object.freeze(normalized);
}

function sameIdentity(left, right) {
  return Boolean(left && right) &&
    String(left.rowId) === String(right.rowId) &&
    left.tokenHash === right.tokenHash &&
    left.leadId === right.leadId &&
    left.intakeSubmissionId === right.intakeSubmissionId &&
    left.issuedAt === right.issuedAt &&
    left.expiresAt === right.expiresAt &&
    left.maxPrefills === right.maxPrefills &&
    left.sourceRevision === right.sourceRevision &&
    left.sourceEnvironment === right.sourceEnvironment;
}

function reservationOutcome(owner) {
  if (typeof owner !== "string" || !RESERVATION_OWNER_PATTERN.test(owner)) {
    throw new SessionStoreError("Prefill reservation owner is invalid", {
      publicCode: "session_input_invalid",
    });
  }
  return `prefill_reserved_${owner.replaceAll("-", "")}`;
}

function createSessionStore(adapter, config, { now = Date.now } = {}) {
  validateAdapter(adapter);
  validateConfig(config);
  if (typeof now !== "function") {
    throw new SessionStoreError("Session clock is invalid", { publicCode: "configuration_invalid" });
  }
  const tableName = config.sessionTableName;

  function nowMilliseconds() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new SessionStoreError("Session clock is invalid", {
        publicCode: "configuration_invalid",
      });
    }
    return value;
  }

  async function queryExactlyOne(operation, { allowNotFound = false } = {}) {
    let rows;
    try {
      rows = await operation();
    } catch (error) {
      throw new SessionStoreError("Durable session read failed", {
        ambiguous: error?.ambiguous === true,
      });
    }
    if (!Array.isArray(rows) || rows.length > 1 || (!allowNotFound && rows.length !== 1)) {
      throw new SessionStoreError("Durable session readback was not unique");
    }
    return rows.length ? normalizeRow(rows[0], tableName) : null;
  }

  async function readByTokenHash(tokenHash) {
    if (!isValidTokenHash(tokenHash)) {
      throw new SessionStoreError("Token hash is invalid", {
        publicCode: "session_input_invalid",
      });
    }
    return queryExactlyOne(
      () => adapter.findRowsByTokenHash(tableName, tokenHash),
      { allowNotFound: true },
    );
  }

  async function readByRowId(rowId) {
    return queryExactlyOne(() => adapter.findRowsByRowId(tableName, validateRowId(rowId)));
  }

  async function createSession({ tokenHash, leadId, intakeSubmissionId }) {
    if (!isValidTokenHash(tokenHash)) {
      throw new SessionStoreError("Token hash is invalid", { publicCode: "session_input_invalid" });
    }
    const normalizedLeadId = normalizeLeadId(leadId);
    const normalizedIntakeId = normalizeIntakeSubmissionId(intakeSubmissionId);
    const issuedAtMs = nowMilliseconds();
    const issuedAt = new Date(issuedAtMs).toISOString();
    const expiresAt = new Date(issuedAtMs + config.sessionTtlSeconds * 1000).toISOString();
    const row = {
      TOKEN_HASH: tokenHash,
      CRM_LEAD_ID: normalizedLeadId,
      INTAKE_SUBMISSION_ID: normalizedIntakeId,
      STATUS: "issuing",
      ISSUED_AT: issuedAt,
      EXPIRES_AT: expiresAt,
      PREFILL_COUNT: 0,
      MAX_PREFILLS: config.maxPrefills,
      SOURCE_REVISION: config.sourceRevision,
      SOURCE_ENVIRONMENT: config.deploymentEnvironment,
      LAST_OUTCOME: "crm_update_pending",
      UPDATED_AT: issuedAt,
    };
    let insertError = null;
    try {
      await adapter.insertRow(tableName, row);
    } catch (error) {
      insertError = error;
    }

    // Catalyst insert timeouts are outcome-ambiguous. Querying the unique hash
    // makes a successful insert authoritative without ever retrying the write.
    let stored = null;
    try {
      stored = await readByTokenHash(tokenHash);
    } catch (readError) {
      throw new SessionStoreError("Durable session creation could not be reconciled", {
        ambiguous: Boolean(insertError?.ambiguous || readError?.ambiguous),
      });
    }
    if (
      !stored ||
      stored.leadId !== normalizedLeadId ||
      stored.intakeSubmissionId !== normalizedIntakeId ||
      stored.status !== "issuing" ||
      stored.issuedAt !== issuedAt ||
      stored.expiresAt !== expiresAt ||
      stored.prefillCount !== 0 ||
      stored.maxPrefills !== config.maxPrefills ||
      stored.sourceRevision !== config.sourceRevision ||
      stored.sourceEnvironment !== config.deploymentEnvironment
    ) {
      throw new SessionStoreError("Durable session creation could not be verified", {
        ambiguous: true,
      });
    }
    return stored;
  }

  async function transition(session, allowedFrom, nextStatus, changes, verify) {
    if (!allowedFrom.has(session?.status) || !STATUS_SET.has(nextStatus)) {
      throw new SessionStoreError("Session transition is invalid", {
        publicCode: "session_state_invalid",
      });
    }
    const timestamp = new Date(nowMilliseconds()).toISOString();
    const update = {
      ROWID: validateRowId(session.rowId),
      STATUS: nextStatus,
      UPDATED_AT: timestamp,
      ...changes(timestamp),
    };
    try {
      await adapter.updateRow(tableName, update, {
        STATUS: session.status,
        PREFILL_COUNT: session.prefillCount,
        UPDATED_AT: session.updatedAt,
      });
    } catch (error) {
      if (error?.publicCode === "datastore_input_invalid") throw error;
    }
    const readback = await readByRowId(session.rowId);
    if (
      !sameIdentity(session, readback) ||
      readback.status !== nextStatus ||
      (typeof verify === "function" && !verify(readback, session))
    ) {
      throw new SessionStoreError("Session transition could not be verified", {
        ambiguous: true,
      });
    }
    return readback;
  }

  function markIssued(session) {
    return transition(
      session,
      new Set(["issuing"]),
      "issued",
      () => ({ LAST_OUTCOME: "issued" }),
      (readback, original) => readback.prefillCount === original.prefillCount,
    );
  }

  function markFailed(session) {
    return transition(
      session,
      new Set(["issuing"]),
      "failed",
      () => ({ LAST_OUTCOME: "crm_update_failed" }),
      (readback, original) => readback.prefillCount === original.prefillCount,
    );
  }

  function markReconciliationRequired(session) {
    return transition(
      session,
      new Set(["issuing"]),
      "reconciliation_required",
      () => ({ LAST_OUTCOME: "crm_update_unresolved" }),
      (readback, original) => readback.prefillCount === original.prefillCount,
    );
  }

  async function revokeForLimit(session) {
    if (session.status === "revoked") return session;
    return transition(
      session,
      new Set(["issued", "prefilled"]),
      "revoked",
      (timestamp) => ({
        LAST_OUTCOME: "prefill_limit_reached",
        REVOKED_AT: timestamp,
      }),
      (readback, original) => readback.prefillCount === original.prefillCount,
    );
  }

  async function reservePrefill(session, owner) {
    if (!new Set(["issued", "prefilled"]).has(session?.status)) {
      throw new SessionStoreError("Session is not prefillable", {
        publicCode: "session_state_invalid",
      });
    }
    if (session.prefillCount >= session.maxPrefills) {
      await revokeForLimit(session);
      throw new SessionStoreError("Session prefill limit reached", {
        publicCode: "prefill_limit_reached",
      });
    }
    const nextCount = session.prefillCount + 1;
    return transition(
      session,
      new Set(["issued", "prefilled"]),
      "prefilling",
      () => ({
        PREFILL_COUNT: nextCount,
        LAST_OUTCOME: reservationOutcome(owner),
      }),
      (readback, original) => (
        readback.prefillCount === nextCount &&
        readback.prefillCount <= original.maxPrefills &&
        readback.lastOutcome === reservationOutcome(owner)
      ),
    );
  }

  function assertReservation(session, owner) {
    if (
      session?.status !== "prefilling" ||
      session.lastOutcome !== reservationOutcome(owner) ||
      session.prefillCount < 1 ||
      session.prefillCount > session.maxPrefills
    ) {
      throw new SessionStoreError("Prefill reservation does not match", {
        publicCode: "session_state_invalid",
        ambiguous: true,
      });
    }
  }

  async function completePrefill(session, owner) {
    assertReservation(session, owner);
    return transition(
      session,
      new Set(["prefilling"]),
      "prefilled",
      (timestamp) => ({ LAST_PREFILLED_AT: timestamp, LAST_OUTCOME: "prefilled" }),
      (readback, original) => (
        readback.prefillCount === original.prefillCount && Boolean(readback.lastPrefilledAt)
      ),
    );
  }

  async function cancelPrefill(session, owner) {
    assertReservation(session, owner);
    const priorStatus = session.prefillCount === 1 ? "issued" : "prefilled";
    return transition(
      session,
      new Set(["prefilling"]),
      priorStatus,
      () => ({ LAST_OUTCOME: "prefill_dependency_failed" }),
      (readback, original) => readback.prefillCount === original.prefillCount,
    );
  }

  async function markExpired(session) {
    if (session?.status === "expired") return session;
    return transition(
      session,
      new Set(["issued", "prefilled"]),
      "expired",
      (timestamp) => ({ LAST_OUTCOME: "expired", REVOKED_AT: timestamp }),
      (readback, original) => (
        readback.prefillCount === original.prefillCount && Boolean(readback.revokedAt)
      ),
    );
  }

  return Object.freeze({
    cancelPrefill,
    completePrefill,
    createSession,
    markExpired,
    markFailed,
    markIssued,
    markReconciliationRequired,
    readByRowId,
    readByTokenHash,
    reservePrefill,
  });
}

module.exports = { SESSION_STATUSES, SessionStoreError, createSessionStore };
