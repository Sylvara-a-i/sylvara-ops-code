"use strict";

const { SESSION_STATUSES } = require("./config");

const STATUS_SET = new Set(SESSION_STATUSES);
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const ISSUE_KEY_PATTERN = /^[a-f0-9]{64}$/;
const RECORD_ID_PATTERN = /^[0-9]{10,30}$/;
const ROW_ID_PATTERN = /^[0-9]{1,30}$/;
const OUTCOME_PATTERN = /^[a-z0-9_]{1,80}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const ISSUE_INPUT_KEYS = new Set([
  "issueKey",
  "tokenHash",
  "crmContactId",
  "crmAccountId",
  "crmDealId",
]);

const STORED_FIELDS = Object.freeze([
  "ROWID",
  "ISSUE_KEY",
  "TOKEN_HASH",
  "CRM_CONTACT_ID",
  "CRM_ACCOUNT_ID",
  "CRM_DEAL_ID",
  "STATUS",
  "ISSUED_AT",
  "EXPIRES_AT",
  "ATTEMPT_COUNT",
  "MAX_ATTEMPTS",
  "SOURCE_REVISION",
  "SOURCE_ENVIRONMENT",
  "LAST_OUTCOME",
  "VERIFIED_AT",
  "SUBMITTED_AT",
  "EXPIRED_AT",
  "REVOKED_AT",
  "FAILED_AT",
  "UPDATED_AT",
]);

class SessionStoreError extends Error {
  constructor(message, publicCode = "session_store_unavailable") {
    super(message);
    this.name = "SessionStoreError";
    this.publicCode = publicCode;
  }
}

function validateAdapter(adapter) {
  for (const method of [
    "insertRow",
    "updateRow",
    "findRowsByIssueKey",
    "findRowsByTokenHash",
    "findRowsByRowId",
  ]) {
    if (typeof adapter?.[method] !== "function") {
      throw new SessionStoreError(`Session adapter is missing ${method}`);
    }
  }
}

function validateConfig(config) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(config?.sessionTableName ?? "")) {
    throw new SessionStoreError("Session table configuration is invalid");
  }
  if (
    config?.deploymentEnvironment !== "development" ||
    !Number.isSafeInteger(config?.sessionTtlSeconds) ||
    config.sessionTtlSeconds < 300 ||
    config.sessionTtlSeconds > 86400 ||
    !Number.isSafeInteger(config?.maxVerificationAttempts) ||
    config.maxVerificationAttempts < 2 ||
    config.maxVerificationAttempts > 10 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{6,79}$/.test(config?.sourceRevision ?? "")
  ) {
    throw new SessionStoreError("Session lifecycle configuration is invalid");
  }
}

function validateRowId(rowId) {
  if (typeof rowId === "number" && !Number.isSafeInteger(rowId)) {
    throw new SessionStoreError("Session row identifier is invalid");
  }
  const normalized = String(rowId ?? "");
  if (!ROW_ID_PATTERN.test(normalized)) {
    throw new SessionStoreError("Session row identifier is invalid");
  }
  return normalized;
}

function optionalRecordId(value, name) {
  const normalized = String(value ?? "");
  if (normalized && !RECORD_ID_PATTERN.test(normalized)) {
    throw new SessionStoreError(`${name} must be a CRM record ID`, "session_input_invalid");
  }
  return normalized;
}

function parseIso(value, name) {
  if (typeof value !== "string" || !ISO_PATTERN.test(value)) {
    throw new SessionStoreError(`${name} is invalid`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new SessionStoreError(`${name} is invalid`);
  }
  return parsed;
}

function integerField(value, name, minimum, maximum) {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new SessionStoreError(`${name} is invalid`);
  }
  return parsed;
}

function unwrapRow(row, tableName) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const nested = row[tableName];
  return nested && typeof nested === "object" && !Array.isArray(nested) ? nested : row;
}

function normalizeRow(rawRow, tableName) {
  const row = unwrapRow(rawRow, tableName);
  if (!row) throw new SessionStoreError("Session row is incomplete");

  const normalized = {
    rowId: validateRowId(row.ROWID),
    issueKey: String(row.ISSUE_KEY ?? ""),
    tokenHash: String(row.TOKEN_HASH ?? ""),
    crmContactId: optionalRecordId(row.CRM_CONTACT_ID, "CRM_CONTACT_ID"),
    crmAccountId: optionalRecordId(row.CRM_ACCOUNT_ID, "CRM_ACCOUNT_ID"),
    crmDealId: optionalRecordId(row.CRM_DEAL_ID, "CRM_DEAL_ID"),
    status: String(row.STATUS ?? ""),
    issuedAt: String(row.ISSUED_AT ?? ""),
    expiresAt: String(row.EXPIRES_AT ?? ""),
    attemptCount: integerField(row.ATTEMPT_COUNT, "ATTEMPT_COUNT", 0, 10),
    maxAttempts: integerField(row.MAX_ATTEMPTS, "MAX_ATTEMPTS", 2, 10),
    sourceRevision: String(row.SOURCE_REVISION ?? ""),
    sourceEnvironment: String(row.SOURCE_ENVIRONMENT ?? ""),
    lastOutcome: String(row.LAST_OUTCOME ?? ""),
    verifiedAt: String(row.VERIFIED_AT ?? ""),
    submittedAt: String(row.SUBMITTED_AT ?? ""),
    expiredAt: String(row.EXPIRED_AT ?? ""),
    revokedAt: String(row.REVOKED_AT ?? ""),
    failedAt: String(row.FAILED_AT ?? ""),
    updatedAt: String(row.UPDATED_AT ?? ""),
  };

  if (
    !ISSUE_KEY_PATTERN.test(normalized.issueKey) ||
    !TOKEN_HASH_PATTERN.test(normalized.tokenHash) ||
    !STATUS_SET.has(normalized.status) ||
    !OUTCOME_PATTERN.test(normalized.lastOutcome) ||
    normalized.sourceEnvironment !== "development" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{6,79}$/.test(normalized.sourceRevision)
  ) {
    throw new SessionStoreError("Session row contains invalid operational metadata");
  }
  parseIso(normalized.issuedAt, "ISSUED_AT");
  parseIso(normalized.expiresAt, "EXPIRES_AT");
  if (!normalized.crmContactId || !normalized.crmAccountId || !normalized.crmDealId) {
    throw new SessionStoreError("Session row is not bound to Contact, Account, and Deal records");
  }
  return Object.freeze(normalized);
}

function validateIssueInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SessionStoreError("Session input is invalid", "session_input_invalid");
  }
  for (const key of Object.keys(input)) {
    if (!ISSUE_INPUT_KEYS.has(key)) {
      throw new SessionStoreError(
        "Session input contains a prohibited field",
        "session_input_invalid",
      );
    }
  }
  if (!ISSUE_KEY_PATTERN.test(input.issueKey ?? "")) {
    throw new SessionStoreError("Issue key is invalid", "session_input_invalid");
  }
  if (!TOKEN_HASH_PATTERN.test(input.tokenHash ?? "")) {
    throw new SessionStoreError("Token hash is invalid", "session_input_invalid");
  }
  const ids = {
    crmContactId: optionalRecordId(input.crmContactId, "crmContactId"),
    crmAccountId: optionalRecordId(input.crmAccountId, "crmAccountId"),
    crmDealId: optionalRecordId(input.crmDealId, "crmDealId"),
  };
  if (!ids.crmContactId || !ids.crmAccountId || !ids.crmDealId) {
    throw new SessionStoreError(
      "CRM Contact, Account, and Deal record IDs are required",
      "session_input_invalid",
    );
  }
  return ids;
}

function validateNow(now) {
  const nowMs = now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new SessionStoreError("Session clock is invalid");
  }
  return nowMs;
}

function createCatalystSessionStore(adapter, config, { now = Date.now } = {}) {
  validateAdapter(adapter);
  validateConfig(config);
  if (typeof now !== "function") throw new SessionStoreError("Session clock is invalid");
  const tableName = config.sessionTableName;

  async function queryExactlyOne(query, notFoundAllowed = false) {
    let rows;
    try {
      rows = await query();
    } catch {
      throw new SessionStoreError("Could not read the durable session state");
    }
    if (!Array.isArray(rows) || rows.length > 1 || (!notFoundAllowed && rows.length !== 1)) {
      throw new SessionStoreError("Durable session readback was not unique");
    }
    return rows.length === 0 ? null : normalizeRow(rows[0], tableName);
  }

  async function readByTokenHash(tokenHash) {
    if (!TOKEN_HASH_PATTERN.test(tokenHash ?? "")) {
      throw new SessionStoreError("Token hash is invalid", "session_input_invalid");
    }
    return queryExactlyOne(
      () => adapter.findRowsByTokenHash(tableName, tokenHash),
      true,
    );
  }

  async function readByIssueKey(issueKey) {
    if (!ISSUE_KEY_PATTERN.test(issueKey ?? "")) {
      throw new SessionStoreError("Issue key is invalid", "session_input_invalid");
    }
    return queryExactlyOne(
      () => adapter.findRowsByIssueKey(tableName, issueKey),
      true,
    );
  }

  async function readByRowId(rowId) {
    const validated = validateRowId(rowId);
    return queryExactlyOne(() => adapter.findRowsByRowId(tableName, validated));
  }

  function exactIssueMatch(session, expected, nowMs) {
    return (
      session.issueKey === expected.ISSUE_KEY &&
      session.tokenHash === expected.TOKEN_HASH &&
      session.crmContactId === expected.CRM_CONTACT_ID &&
      session.crmAccountId === expected.CRM_ACCOUNT_ID &&
      session.crmDealId === expected.CRM_DEAL_ID &&
      session.sourceRevision === expected.SOURCE_REVISION &&
      session.sourceEnvironment === expected.SOURCE_ENVIRONMENT &&
      new Set(["issued", "verified"]).has(session.status) &&
      parseIso(session.expiresAt, "EXPIRES_AT") > nowMs
    );
  }

  async function issue(input) {
    const ids = validateIssueInput(input);
    const nowMs = validateNow(now);
    const row = {
      ISSUE_KEY: input.issueKey,
      TOKEN_HASH: input.tokenHash,
      CRM_CONTACT_ID: ids.crmContactId,
      CRM_ACCOUNT_ID: ids.crmAccountId,
      CRM_DEAL_ID: ids.crmDealId,
      STATUS: "issued",
      ISSUED_AT: new Date(nowMs).toISOString(),
      EXPIRES_AT: new Date(nowMs + config.sessionTtlSeconds * 1000).toISOString(),
      ATTEMPT_COUNT: 0,
      MAX_ATTEMPTS: config.maxVerificationAttempts,
      SOURCE_REVISION: config.sourceRevision,
      SOURCE_ENVIRONMENT: "development",
      LAST_OUTCOME: "issued",
      VERIFIED_AT: "",
      SUBMITTED_AT: "",
      EXPIRED_AT: "",
      REVOKED_AT: "",
      FAILED_AT: "",
      UPDATED_AT: new Date(nowMs).toISOString(),
    };

    try {
      await adapter.insertRow(tableName, row);
    } catch {
      // Insert failures can be ambiguous, so the issue-key readback below is
      // authoritative. Never retry a potentially successful insert blindly.
    }
    const readback = await readByIssueKey(input.issueKey);
    if (!readback || !exactIssueMatch(readback, row, nowMs)) {
      throw new SessionStoreError(
        "Session issuance requires operator reconciliation",
        "reconciliation_required",
      );
    }
    return readback;
  }

  async function writeAndReadBack(current, patch) {
    const update = { ROWID: current.rowId, ...patch };
    try {
      await adapter.updateRow(tableName, update, {
        STATUS: current.status,
        ATTEMPT_COUNT: current.attemptCount,
      });
    } catch {
      // A conditional-write failure or timeout is resolved only by readback.
    }
    const readback = await readByRowId(current.rowId);
    for (const [field, expected] of Object.entries(patch)) {
      const property = {
        STATUS: "status",
        ATTEMPT_COUNT: "attemptCount",
        LAST_OUTCOME: "lastOutcome",
        VERIFIED_AT: "verifiedAt",
        SUBMITTED_AT: "submittedAt",
        EXPIRED_AT: "expiredAt",
        REVOKED_AT: "revokedAt",
        FAILED_AT: "failedAt",
        UPDATED_AT: "updatedAt",
      }[field];
      if (!property || String(readback[property]) !== String(expected)) {
        throw new SessionStoreError(
          "Session state requires operator reconciliation",
          "reconciliation_required",
        );
      }
    }
    return readback;
  }

  async function transition(rowId, targetStatus, outcome, allowedFrom, timestampField) {
    if (!STATUS_SET.has(targetStatus) || !OUTCOME_PATTERN.test(outcome ?? "")) {
      throw new SessionStoreError("Session transition input is invalid", "session_input_invalid");
    }
    const current = await readByRowId(rowId);
    if (current.status === targetStatus) return current;
    if (!allowedFrom.has(current.status)) {
      throw new SessionStoreError("Session transition is not allowed", "session_state_invalid");
    }
    const timestamp = new Date(validateNow(now)).toISOString();
    const patch = {
      STATUS: targetStatus,
      LAST_OUTCOME: outcome,
      UPDATED_AT: timestamp,
    };
    if (timestampField) patch[timestampField] = timestamp;
    return writeAndReadBack(current, patch);
  }

  async function verify(tokenHash) {
    const current = await readByTokenHash(tokenHash);
    if (!current) return Object.freeze({ outcome: "not_found", session: null });
    if (!new Set(["issued", "verified"]).has(current.status)) {
      return Object.freeze({ outcome: current.status, session: current });
    }

    const nowMs = validateNow(now);
    if (parseIso(current.expiresAt, "EXPIRES_AT") <= nowMs) {
      const expired = await transition(
        current.rowId,
        "expired",
        "ttl_elapsed",
        new Set(["issued", "verified"]),
        "EXPIRED_AT",
      );
      return Object.freeze({ outcome: "expired", session: expired });
    }
    if (current.attemptCount >= current.maxAttempts) {
      const failed = await transition(
        current.rowId,
        "failed",
        "attempt_limit_reached",
        new Set(["issued", "verified"]),
        "FAILED_AT",
      );
      return Object.freeze({ outcome: "failed", session: failed });
    }

    const timestamp = new Date(nowMs).toISOString();
    const verified = await writeAndReadBack(current, {
      STATUS: "verified",
      ATTEMPT_COUNT: current.attemptCount + 1,
      LAST_OUTCOME: "verified",
      VERIFIED_AT: current.verifiedAt || timestamp,
      UPDATED_AT: timestamp,
    });
    return Object.freeze({ outcome: "verified", session: verified });
  }

  const markSubmitted = (rowId) => transition(
    rowId,
    "submitted",
    "submitted",
    new Set(["verified"]),
    "SUBMITTED_AT",
  );
  const revoke = (rowId) => transition(
    rowId,
    "revoked",
    "revoked",
    new Set(["issued", "verified"]),
    "REVOKED_AT",
  );
  const markFailed = (rowId, outcome = "processing_failed") => transition(
    rowId,
    "failed",
    outcome,
    new Set(["issued", "verified"]),
    "FAILED_AT",
  );
  const markReconciliationRequired = (rowId, outcome = "outcome_unknown") => transition(
    rowId,
    "reconciliation_required",
    outcome,
    new Set(["issued", "verified", "failed"]),
    "FAILED_AT",
  );

  return Object.freeze({
    issue,
    markFailed,
    markReconciliationRequired,
    markSubmitted,
    readByIssueKey,
    readByRowId,
    readByTokenHash,
    revoke,
    verify,
  });
}

module.exports = {
  ISSUE_INPUT_KEYS,
  STORED_FIELDS,
  SessionStoreError,
  createCatalystSessionStore,
};
