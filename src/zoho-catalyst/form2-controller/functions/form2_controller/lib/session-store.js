"use strict";

const crypto = require("node:crypto");
const { SESSION_STATUSES, SOURCE_REVISION_PATTERN } = require("./config");

const STATUS_SET = new Set(SESSION_STATUSES);
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const SUBMISSION_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const RECORD_ID_PATTERN = /^[0-9]{10,30}$/;
const ROW_ID_PATTERN = /^[0-9]{1,30}$/;
const OUTCOME_PATTERN = /^[a-z0-9_]{1,80}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const ISSUE_INPUT_KEYS = new Set([
  "tokenHash",
  "crmContactId",
  "crmAccountId",
  "crmDealId",
]);

const STORED_FIELDS = Object.freeze([
  "ROWID",
  "TOKEN_HASH",
  "CRM_CONTACT_ID",
  "CRM_ACCOUNT_ID",
  "CRM_DEAL_ID",
  "DEAL_ISSUANCE_KEY",
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
    "findRowsByDealIssuanceKey",
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
    config?.verifiedSessionTtlSeconds !== 1800 ||
    !Number.isSafeInteger(config?.maxVerificationAttempts) ||
    config.maxVerificationAttempts < 2 ||
    config.maxVerificationAttempts > 10 ||
    !SOURCE_REVISION_PATTERN.test(config?.sourceRevision ?? "")
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
    tokenHash: String(row.TOKEN_HASH ?? ""),
    crmContactId: optionalRecordId(row.CRM_CONTACT_ID, "CRM_CONTACT_ID"),
    crmAccountId: optionalRecordId(row.CRM_ACCOUNT_ID, "CRM_ACCOUNT_ID"),
    crmDealId: optionalRecordId(row.CRM_DEAL_ID, "CRM_DEAL_ID"),
    dealIssuanceKey: String(row.DEAL_ISSUANCE_KEY ?? ""),
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
    !TOKEN_HASH_PATTERN.test(normalized.tokenHash) ||
    !TOKEN_HASH_PATTERN.test(normalized.dealIssuanceKey) ||
    !STATUS_SET.has(normalized.status) ||
    !OUTCOME_PATTERN.test(normalized.lastOutcome) ||
    normalized.sourceEnvironment !== "development" ||
    !SOURCE_REVISION_PATTERN.test(normalized.sourceRevision)
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

function sameSessionIdentity(left, right) {
  return Boolean(left && right) &&
    String(left.rowId) === String(right.rowId) &&
    left.tokenHash === right.tokenHash &&
    left.crmContactId === right.crmContactId &&
    left.crmAccountId === right.crmAccountId &&
    left.crmDealId === right.crmDealId;
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

  function deriveDealIssuanceKey(kind, crmDealId, generationTokenHash = "") {
    if (!new Set(["active", "generation"]).has(kind)) {
      throw new SessionStoreError("Deal issuance key domain is invalid");
    }
    const validatedDealId = optionalRecordId(crmDealId, "crmDealId");
    if (
      !validatedDealId ||
      (kind === "generation" && !TOKEN_HASH_PATTERN.test(generationTokenHash))
    ) {
      throw new SessionStoreError("Deal issuance key input is invalid", "session_input_invalid");
    }
    try {
      return crypto
        .createHash("sha256")
        .update(`sylvara-form2:${config.deploymentEnvironment}:deal-${kind}\0`, "utf8")
        .update(validatedDealId, "utf8")
        .update(kind === "generation" ? `\0${generationTokenHash}` : "", "utf8")
        .digest("hex");
    } catch {
      throw new SessionStoreError("Deal issuance key derivation failed");
    }
  }

  function assertDealIssuanceKey(row) {
    const released = row.status === "expired" && row.lastOutcome === "crm_expiry_synced";
    const expected = deriveDealIssuanceKey(
      released ? "generation" : "active",
      row.crmDealId,
      row.tokenHash,
    );
    if (row.dealIssuanceKey !== expected) {
      throw new SessionStoreError("Session row has an invalid Deal issuance lock");
    }
    return row;
  }

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
    return rows.length === 0
      ? null
      : assertDealIssuanceKey(normalizeRow(rows[0], tableName));
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

  async function readByRowId(rowId) {
    const validated = validateRowId(rowId);
    return queryExactlyOne(() => adapter.findRowsByRowId(tableName, validated));
  }

  async function readByDealIssuanceKey(dealIssuanceKey) {
    if (!TOKEN_HASH_PATTERN.test(dealIssuanceKey ?? "")) {
      throw new SessionStoreError("Deal issuance key is invalid", "session_input_invalid");
    }
    return queryExactlyOne(
      () => adapter.findRowsByDealIssuanceKey(tableName, dealIssuanceKey),
      true,
    );
  }

  async function readActiveByCrmDealId(crmDealId) {
    return readByDealIssuanceKey(deriveDealIssuanceKey("active", crmDealId));
  }

  function exactIssueMatch(session, expected, nowMs) {
    return (
      session.tokenHash === expected.TOKEN_HASH &&
      session.crmContactId === expected.CRM_CONTACT_ID &&
      session.crmAccountId === expected.CRM_ACCOUNT_ID &&
      session.crmDealId === expected.CRM_DEAL_ID &&
      // The stored revision is creation provenance, not issuance identity. An
      // active deterministic-token retry must survive a controller deployment.
      session.sourceEnvironment === expected.SOURCE_ENVIRONMENT &&
      session.dealIssuanceKey === expected.DEAL_ISSUANCE_KEY &&
      new Set(["issuing", "issued", "verified"]).has(session.status) &&
      parseIso(session.expiresAt, "EXPIRES_AT") > nowMs
    );
  }

  async function issue(input) {
    const ids = validateIssueInput(input);
    const nowMs = validateNow(now);
    const row = {
      TOKEN_HASH: input.tokenHash,
      CRM_CONTACT_ID: ids.crmContactId,
      CRM_ACCOUNT_ID: ids.crmAccountId,
      CRM_DEAL_ID: ids.crmDealId,
      DEAL_ISSUANCE_KEY: deriveDealIssuanceKey("active", ids.crmDealId),
      STATUS: "issuing",
      ISSUED_AT: new Date(nowMs).toISOString(),
      EXPIRES_AT: new Date(nowMs + config.sessionTtlSeconds * 1000).toISOString(),
      ATTEMPT_COUNT: 0,
      MAX_ATTEMPTS: config.maxVerificationAttempts,
      SOURCE_REVISION: config.sourceRevision,
      SOURCE_ENVIRONMENT: "development",
      LAST_OUTCOME: "issuing",
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
      // Insert failures can be ambiguous, so the active-Deal readback below is
      // authoritative. Never retry a potentially successful insert blindly.
    }
    const readback = await readByDealIssuanceKey(row.DEAL_ISSUANCE_KEY);
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
        EXPIRES_AT: "expiresAt",
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

  async function markExpirySynced(rowId) {
    const current = await readByRowId(rowId);
    if (current.status === "expired" && current.lastOutcome === "crm_expiry_synced") {
      return current;
    }
    if (
      current.status !== "expired" ||
      !new Set(["crm_expiry_pending", "issuing_expiry_pending"]).has(current.lastOutcome)
    ) {
      throw new SessionStoreError(
        "Session expiry synchronization is not allowed",
        "session_state_invalid",
      );
    }
    const timestamp = new Date(validateNow(now)).toISOString();
    const releasedDealIssuanceKey = deriveDealIssuanceKey(
      "generation",
      current.crmDealId,
      current.tokenHash,
    );
    try {
      await adapter.updateRow(tableName, {
        ROWID: current.rowId,
        DEAL_ISSUANCE_KEY: releasedDealIssuanceKey,
        LAST_OUTCOME: "crm_expiry_synced",
        UPDATED_AT: timestamp,
      }, {
        DEAL_ISSUANCE_KEY: current.dealIssuanceKey,
        STATUS: "expired",
        LAST_OUTCOME: current.lastOutcome,
        ATTEMPT_COUNT: current.attemptCount,
      });
    } catch {
      // Resolve a lost conditional response only through the durable row.
    }
    const readback = await readByRowId(current.rowId);
    if (
      !sameSessionIdentity(current, readback) ||
      readback.dealIssuanceKey !== releasedDealIssuanceKey ||
      readback.status !== "expired" ||
      readback.lastOutcome !== "crm_expiry_synced" ||
      readback.updatedAt !== timestamp
    ) {
      throw new SessionStoreError(
        "Session expiry synchronization requires operator reconciliation",
        "reconciliation_required",
      );
    }
    return readback;
  }

  async function markIssuingExpiryPending(rowId) {
    const current = await readByRowId(rowId);
    if (
      current.status === "expired" &&
      new Set(["issuing_expiry_pending", "crm_expiry_synced"]).has(current.lastOutcome)
    ) {
      return current;
    }
    if (current.status !== "issuing" || current.lastOutcome !== "issuing") {
      throw new SessionStoreError(
        "Stale issuing expiry is not allowed",
        "session_state_invalid",
      );
    }
    const nowMs = validateNow(now);
    if (parseIso(current.expiresAt, "EXPIRES_AT") > nowMs) {
      throw new SessionStoreError(
        "Issuing session has not elapsed",
        "session_state_invalid",
      );
    }
    const timestamp = new Date(nowMs).toISOString();
    try {
      await adapter.updateRow(tableName, {
        ROWID: current.rowId,
        STATUS: "expired",
        LAST_OUTCOME: "issuing_expiry_pending",
        EXPIRED_AT: timestamp,
        UPDATED_AT: timestamp,
      }, {
        DEAL_ISSUANCE_KEY: current.dealIssuanceKey,
        STATUS: "issuing",
        LAST_OUTCOME: "issuing",
        ATTEMPT_COUNT: current.attemptCount,
      });
    } catch {
      // Exact readback below resolves a concurrent finalizer or lost response.
    }
    const readback = await readByRowId(current.rowId);
    if (
      sameSessionIdentity(current, readback) &&
      readback.status === "expired" &&
      readback.lastOutcome === "crm_expiry_synced"
    ) {
      return readback;
    }
    if (
      !sameSessionIdentity(current, readback) ||
      readback.status !== "expired" ||
      readback.lastOutcome !== "issuing_expiry_pending" ||
      readback.expiredAt !== timestamp ||
      readback.updatedAt !== timestamp ||
      readback.dealIssuanceKey !== current.dealIssuanceKey
    ) {
      throw new SessionStoreError(
        "Stale issuing expiry requires operator reconciliation",
        "reconciliation_required",
      );
    }
    return readback;
  }

  async function markExpiryReconciliationRequired(
    rowId,
    outcome = "crm_expiry_outcome_unknown",
  ) {
    if (!OUTCOME_PATTERN.test(outcome)) {
      throw new SessionStoreError("Session transition input is invalid", "session_input_invalid");
    }
    const current = await readByRowId(rowId);
    if (current.status === "reconciliation_required") return current;
    if (
      current.status !== "expired" ||
      !new Set(["crm_expiry_pending", "issuing_expiry_pending"]).has(current.lastOutcome)
    ) {
      throw new SessionStoreError(
        "Session expiry reconciliation is not allowed",
        "session_state_invalid",
      );
    }
    const timestamp = new Date(validateNow(now)).toISOString();
    try {
      await adapter.updateRow(tableName, {
        ROWID: current.rowId,
        STATUS: "reconciliation_required",
        LAST_OUTCOME: outcome,
        FAILED_AT: timestamp,
        UPDATED_AT: timestamp,
      }, {
        STATUS: "expired",
        LAST_OUTCOME: current.lastOutcome,
        ATTEMPT_COUNT: current.attemptCount,
      });
    } catch {
      // Resolve a lost conditional response only through the durable row.
    }
    const readback = await readByRowId(current.rowId);
    if (
      !sameSessionIdentity(current, readback) ||
      readback.status !== "reconciliation_required" ||
      readback.lastOutcome !== outcome ||
      readback.failedAt !== timestamp ||
      readback.updatedAt !== timestamp
    ) {
      throw new SessionStoreError(
        "Session expiry reconciliation requires operator review",
        "reconciliation_required",
      );
    }
    return readback;
  }

  async function beginSubmission(rowId, submissionFingerprint) {
    if (!SUBMISSION_FINGERPRINT_PATTERN.test(submissionFingerprint ?? "")) {
      throw new SessionStoreError(
        "Submission fingerprint is invalid",
        "session_input_invalid",
      );
    }
    const current = await readByRowId(rowId);
    const outcome = `submitting_${submissionFingerprint}`;
    if (current.status === "submitting") {
      if (current.lastOutcome === outcome) return current;
      throw new SessionStoreError(
        "A different submission already owns this session",
        "submission_conflict",
      );
    }
    if (current.status !== "verified") {
      throw new SessionStoreError("Session submission is not allowed", "session_state_invalid");
    }
    const timestamp = new Date(validateNow(now)).toISOString();
    try {
      await adapter.updateRow(tableName, {
        ROWID: current.rowId,
        STATUS: "submitting",
        LAST_OUTCOME: outcome,
        UPDATED_AT: timestamp,
      }, {
        STATUS: "verified",
        ATTEMPT_COUNT: current.attemptCount,
      });
    } catch {
      // Exact readback below identifies the winning fingerprint.
    }
    const readback = await readByRowId(current.rowId);
    if (
      sameSessionIdentity(current, readback) &&
      readback.status === "submitting" &&
      readback.lastOutcome === outcome &&
      readback.updatedAt === timestamp
    ) {
      return readback;
    }
    if (readback.status === "submitting" && readback.lastOutcome !== outcome) {
      throw new SessionStoreError(
        "A different submission already owns this session",
        "submission_conflict",
      );
    }
    throw new SessionStoreError(
      "Session submission ownership requires reconciliation",
      "reconciliation_required",
    );
  }

  async function releaseSubmission(rowId, submissionFingerprint) {
    if (!SUBMISSION_FINGERPRINT_PATTERN.test(submissionFingerprint ?? "")) {
      throw new SessionStoreError(
        "Submission fingerprint is invalid",
        "session_input_invalid",
      );
    }
    const current = await readByRowId(rowId);
    const expectedOutcome = `submitting_${submissionFingerprint}`;
    if (current.status === "verified" && current.lastOutcome === "submission_released") {
      return current;
    }
    if (current.status !== "submitting" || current.lastOutcome !== expectedOutcome) {
      throw new SessionStoreError("Session submission release is not allowed", "session_state_invalid");
    }
    const timestamp = new Date(validateNow(now)).toISOString();
    try {
      await adapter.updateRow(tableName, {
        ROWID: current.rowId,
        STATUS: "verified",
        LAST_OUTCOME: "submission_released",
        UPDATED_AT: timestamp,
      }, {
        STATUS: "submitting",
        LAST_OUTCOME: expectedOutcome,
        ATTEMPT_COUNT: current.attemptCount,
      });
    } catch {
      // Exact readback below resolves an ambiguous release.
    }
    const readback = await readByRowId(current.rowId);
    if (
      !sameSessionIdentity(current, readback) ||
      readback.status !== "verified" ||
      readback.lastOutcome !== "submission_released" ||
      readback.updatedAt !== timestamp
    ) {
      throw new SessionStoreError(
        "Session submission release requires reconciliation",
        "reconciliation_required",
      );
    }
    return readback;
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
        "crm_expiry_pending",
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
    const expiresAt = current.status === "issued"
      ? new Date(nowMs + config.verifiedSessionTtlSeconds * 1000).toISOString()
      : current.expiresAt;
    const verified = await writeAndReadBack(current, {
      STATUS: "verified",
      ATTEMPT_COUNT: current.attemptCount + 1,
      LAST_OUTCOME: "verified",
      EXPIRES_AT: expiresAt,
      VERIFIED_AT: current.verifiedAt || timestamp,
      UPDATED_AT: timestamp,
    });
    return Object.freeze({ outcome: "verified", session: verified });
  }

  async function markSubmitted(rowId, submissionFingerprint) {
    if (!SUBMISSION_FINGERPRINT_PATTERN.test(submissionFingerprint ?? "")) {
      throw new SessionStoreError(
        "Submission fingerprint is invalid",
        "session_input_invalid",
      );
    }
    const current = await readByRowId(rowId);
    if (current.status === "submitted") return current;
    const expectedOutcome = `submitting_${submissionFingerprint}`;
    if (
      current.status !== "verified" &&
      !(current.status === "submitting" && current.lastOutcome === expectedOutcome)
    ) {
      throw new SessionStoreError("Session submission is not allowed", "session_state_invalid");
    }
    const timestamp = new Date(validateNow(now)).toISOString();
    try {
      await adapter.updateRow(tableName, {
        ROWID: current.rowId,
        STATUS: "submitted",
        LAST_OUTCOME: "submitted",
        SUBMITTED_AT: timestamp,
        UPDATED_AT: timestamp,
      }, {
        STATUS: current.status,
        LAST_OUTCOME: current.lastOutcome,
        ATTEMPT_COUNT: current.attemptCount,
      });
    } catch {
      // Only an exact durable submitted row can recover a lost response.
    }
    const readback = await readByRowId(current.rowId);
    if (
      !sameSessionIdentity(current, readback) ||
      readback.status !== "submitted" ||
      readback.lastOutcome !== "submitted" ||
      readback.submittedAt !== timestamp ||
      readback.updatedAt !== timestamp
    ) {
      throw new SessionStoreError(
        "Session submission completion requires reconciliation",
        "reconciliation_required",
      );
    }
    return readback;
  }

  async function markSubmittedReconciliationRequired(
    rowId,
    outcome = "succeeded_receipt_crm_mismatch",
  ) {
    if (!OUTCOME_PATTERN.test(outcome)) {
      throw new SessionStoreError("Session transition input is invalid", "session_input_invalid");
    }
    const current = await readByRowId(rowId);
    if (current.status === "reconciliation_required" && current.lastOutcome === outcome) {
      return current;
    }
    if (current.status !== "submitted") {
      throw new SessionStoreError(
        "Submitted session reconciliation is not allowed",
        "session_state_invalid",
      );
    }
    const timestamp = new Date(validateNow(now)).toISOString();
    return writeAndReadBack(current, {
      STATUS: "reconciliation_required",
      LAST_OUTCOME: outcome,
      FAILED_AT: timestamp,
      UPDATED_AT: timestamp,
    });
  }
  const markIssued = (rowId) => transition(
    rowId,
    "issued",
    "issued",
    new Set(["issuing"]),
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
    new Set(["issued", "verified", "submitting"]),
    "FAILED_AT",
  );
  const markReconciliationRequired = (rowId, outcome = "outcome_unknown") => transition(
    rowId,
    "reconciliation_required",
    outcome,
    new Set(["issuing", "issued", "verified", "submitting", "failed"]),
    "FAILED_AT",
  );

  return Object.freeze({
    beginSubmission,
    issue,
    markExpiryReconciliationRequired,
    markExpirySynced,
    markFailed,
    markIssued,
    markIssuingExpiryPending,
    markReconciliationRequired,
    markSubmitted,
    markSubmittedReconciliationRequired,
    readActiveByCrmDealId,
    readByDealIssuanceKey,
    readByRowId,
    readByTokenHash,
    releaseSubmission,
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
