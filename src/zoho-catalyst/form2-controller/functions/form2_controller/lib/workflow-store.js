"use strict";

const crypto = require("node:crypto");

const PREFILL_STATUSES = Object.freeze([
  "ready",
  "submitted",
  "reconciliation_required",
]);
const SUBMISSION_STATUSES = Object.freeze([
  "processing",
  "succeeded",
  "failed",
  "reconciliation_required",
]);

const PREFILL_STORED_FIELDS = Object.freeze([
  "ROWID",
  "PREFILL_KEY",
  "SESSION_ROW_ID",
  "SESSION_ATTEMPT_COUNT",
  "CRM_CONTACT_ID",
  "CRM_ACCOUNT_ID",
  "CRM_DEAL_ID",
  "CONTACT_MODIFIED_TIME",
  "ACCOUNT_MODIFIED_TIME",
  "DEAL_MODIFIED_TIME",
  "SNAPSHOT_FINGERPRINT",
  "STATUS",
  "CONSUMPTION_OWNER",
  "ISSUED_AT",
  "SUBMITTED_AT",
  "RECONCILIATION_REQUIRED_AT",
  "UPDATED_AT",
  "SOURCE_REVISION",
  "SOURCE_ENVIRONMENT",
  "LAST_OUTCOME",
]);

const SUBMISSION_STORED_FIELDS = Object.freeze([
  "ROWID",
  "SUBMISSION_KEY",
  "PREFILL_KEY",
  "SESSION_ROW_ID",
  "STATUS",
  "LEASE_OWNER",
  "LEASE_EXPIRES_AT",
  "ATTEMPT_COUNT",
  "CLAIMED_AT",
  "SUCCEEDED_AT",
  "FAILED_AT",
  "RECONCILIATION_REQUIRED_AT",
  "UPDATED_AT",
  "SOURCE_REVISION",
  "SOURCE_ENVIRONMENT",
  "LAST_OUTCOME",
]);

const PREFILL_STATUS_SET = new Set(PREFILL_STATUSES);
const SUBMISSION_STATUS_SET = new Set(SUBMISSION_STATUSES);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const RECORD_ID_PATTERN = /^[0-9]{10,30}$/;
const ROW_ID_PATTERN = /^[0-9]{1,30}$/;
const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{6,79}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODIFIED_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SUBMISSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const OUTCOME_PATTERN = /^[a-z0-9_]{1,80}$/;

const PREFILL_BINDING_KEYS = new Set([
  "sessionRowId",
  "sessionAttemptCount",
  "crmContactId",
  "crmAccountId",
  "crmDealId",
  "contactModifiedTime",
  "accountModifiedTime",
  "dealModifiedTime",
  "snapshotFingerprint",
]);
const PREFILL_CONSUME_KEYS = new Set([...PREFILL_BINDING_KEYS, "prefillId"]);
const PREFILL_READ_KEYS = new Set(["prefillId", "sessionRowId"]);
const SUBMISSION_CLAIM_KEYS = new Set(["submissionId", "prefillId", "sessionRowId"]);
const CLAIM_REFERENCE_KEYS = new Set(["rowId", "leaseOwner"]);
const PREFILL_REFERENCE_KEYS = new Set(["rowId", "consumptionOwner"]);

class WorkflowStoreError extends Error {
  constructor(message, publicCode = "workflow_store_unavailable") {
    super(message);
    this.name = "WorkflowStoreError";
    this.publicCode = publicCode;
  }
}

/*
 * The adapter is deliberately small and datastore-specific. The two key
 * columns MUST be declared unique in Catalyst Data Store. insertRow therefore
 * is the first operation for every claim; callers must not implement a
 * select-then-insert sequence around this store.
 *
 * Required adapter methods:
 *   insertRow(tableName, row)
 *   updateRow(tableName, rowWithROWID, expectedFieldValues)
 *   findRowsByPrefillKey(tableName, sha256Key)
 *   findRowsBySubmissionKey(tableName, sha256Key)
 *   findRowsByRowId(tableName, rowId)
 */
function validateAdapter(adapter) {
  for (const method of [
    "insertRow",
    "updateRow",
    "findRowsByPrefillKey",
    "findRowsBySubmissionKey",
    "findRowsByRowId",
  ]) {
    if (typeof adapter?.[method] !== "function") {
      throw new WorkflowStoreError(`Workflow adapter is missing ${method}`);
    }
  }
}

function validateConfig(config) {
  const safeTable = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
  const pepper = config?.tokenPepper;
  if (
    !safeTable.test(config?.prefillTableName ?? "") ||
    !safeTable.test(config?.submissionTableName ?? "") ||
    config.prefillTableName === config.submissionTableName ||
    config?.deploymentEnvironment !== "development" ||
    !REVISION_PATTERN.test(config?.sourceRevision ?? "") ||
    typeof pepper !== "string" ||
    Buffer.byteLength(pepper, "utf8") < 32 ||
    Buffer.byteLength(pepper, "utf8") > 256 ||
    !/^[\x21-\x7e]+$/.test(pepper) ||
    !Number.isSafeInteger(config?.platformOperationTimeoutMs) ||
    config.platformOperationTimeoutMs < 250 ||
    config.platformOperationTimeoutMs > 15000 ||
    !Number.isSafeInteger(config?.maxSubmissionAttempts) ||
    config.maxSubmissionAttempts < 1 ||
    config.maxSubmissionAttempts > 10
  ) {
    throw new WorkflowStoreError("Workflow store configuration is invalid");
  }
}

function assertExactKeys(value, allowed, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkflowStoreError(message, "workflow_input_invalid");
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new WorkflowStoreError(message, "workflow_input_invalid");
    }
  }
}

function validateRowId(value, publicCode = "workflow_input_invalid") {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new WorkflowStoreError("Workflow row identifier is invalid", publicCode);
  }
  const normalized = String(value ?? "");
  if (!ROW_ID_PATTERN.test(normalized)) {
    throw new WorkflowStoreError("Workflow row identifier is invalid", publicCode);
  }
  return normalized;
}

function validateRecordId(value, name) {
  const normalized = String(value ?? "");
  if (!RECORD_ID_PATTERN.test(normalized)) {
    throw new WorkflowStoreError(`${name} is invalid`, "workflow_input_invalid");
  }
  return normalized;
}

function validateUuid(value, name, publicCode = "workflow_input_invalid") {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new WorkflowStoreError(`${name} is invalid`, publicCode);
  }
  return value.toLowerCase();
}

function validateModifiedTime(value, name) {
  if (
    typeof value !== "string" ||
    !MODIFIED_TIME_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new WorkflowStoreError(`${name} is invalid`, "workflow_input_invalid");
  }
  // Preserve the exact CRM representation; equality is an optimistic-lock
  // boundary and not merely a comparison of equivalent instants.
  return value;
}

function validateFingerprint(value) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new WorkflowStoreError(
      "The allowlisted snapshot fingerprint is invalid",
      "workflow_input_invalid",
    );
  }
  return value;
}

function validateSubmissionId(value) {
  if (typeof value !== "string" || !SUBMISSION_ID_PATTERN.test(value)) {
    throw new WorkflowStoreError(
      "The Forms submission identifier is invalid",
      "workflow_input_invalid",
    );
  }
  return value;
}

function validateIso(value, name, { allowEmpty = false } = {}) {
  if (allowEmpty && value === "") return "";
  if (typeof value !== "string" || !ISO_PATTERN.test(value)) {
    throw new WorkflowStoreError(`${name} is invalid`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new WorkflowStoreError(`${name} is invalid`);
  }
  return value;
}

function validateNow(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new WorkflowStoreError("Workflow clock is invalid");
  }
  return value;
}

function safeInteger(value, name, minimum, maximum) {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new WorkflowStoreError(`${name} is invalid`);
  }
  return parsed;
}

function unwrapRow(row, tableName) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const nested = row[tableName];
  return nested && typeof nested === "object" && !Array.isArray(nested) ? nested : row;
}

function normalizePrefillRow(rawRow, tableName) {
  const row = unwrapRow(rawRow, tableName);
  if (!row) throw new WorkflowStoreError("Prefill revision row is incomplete");
  const normalized = {
    rowId: validateRowId(row.ROWID, "workflow_store_unavailable"),
    prefillKey: String(row.PREFILL_KEY ?? ""),
    sessionRowId: validateRowId(row.SESSION_ROW_ID, "workflow_store_unavailable"),
    sessionAttemptCount: safeInteger(
      row.SESSION_ATTEMPT_COUNT,
      "SESSION_ATTEMPT_COUNT",
      1,
      10,
    ),
    crmContactId: validateRecordId(row.CRM_CONTACT_ID, "CRM_CONTACT_ID"),
    crmAccountId: validateRecordId(row.CRM_ACCOUNT_ID, "CRM_ACCOUNT_ID"),
    crmDealId: validateRecordId(row.CRM_DEAL_ID, "CRM_DEAL_ID"),
    contactModifiedTime: String(row.CONTACT_MODIFIED_TIME ?? ""),
    accountModifiedTime: String(row.ACCOUNT_MODIFIED_TIME ?? ""),
    dealModifiedTime: String(row.DEAL_MODIFIED_TIME ?? ""),
    snapshotFingerprint: String(row.SNAPSHOT_FINGERPRINT ?? ""),
    status: String(row.STATUS ?? ""),
    consumptionOwner: String(row.CONSUMPTION_OWNER ?? ""),
    issuedAt: String(row.ISSUED_AT ?? ""),
    submittedAt: String(row.SUBMITTED_AT ?? ""),
    reconciliationRequiredAt: String(row.RECONCILIATION_REQUIRED_AT ?? ""),
    updatedAt: String(row.UPDATED_AT ?? ""),
    sourceRevision: String(row.SOURCE_REVISION ?? ""),
    sourceEnvironment: String(row.SOURCE_ENVIRONMENT ?? ""),
    lastOutcome: String(row.LAST_OUTCOME ?? ""),
  };

  if (
    !HASH_PATTERN.test(normalized.prefillKey) ||
    !PREFILL_STATUS_SET.has(normalized.status) ||
    !HASH_PATTERN.test(normalized.snapshotFingerprint) ||
    !REVISION_PATTERN.test(normalized.sourceRevision) ||
    normalized.sourceEnvironment !== "development" ||
    !OUTCOME_PATTERN.test(normalized.lastOutcome)
  ) {
    throw new WorkflowStoreError("Prefill revision row has invalid operational metadata");
  }
  validateModifiedTime(normalized.contactModifiedTime, "CONTACT_MODIFIED_TIME");
  validateModifiedTime(normalized.accountModifiedTime, "ACCOUNT_MODIFIED_TIME");
  validateModifiedTime(normalized.dealModifiedTime, "DEAL_MODIFIED_TIME");
  validateIso(normalized.issuedAt, "ISSUED_AT");
  validateIso(normalized.updatedAt, "UPDATED_AT");
  validateIso(normalized.submittedAt, "SUBMITTED_AT", { allowEmpty: true });
  validateIso(normalized.reconciliationRequiredAt, "RECONCILIATION_REQUIRED_AT", {
    allowEmpty: true,
  });

  if (normalized.status === "ready") {
    if (normalized.consumptionOwner || normalized.submittedAt || normalized.reconciliationRequiredAt) {
      throw new WorkflowStoreError("Ready prefill revision contains terminal metadata");
    }
  } else {
    validateUuid(normalized.consumptionOwner, "CONSUMPTION_OWNER", "workflow_store_unavailable");
    validateIso(normalized.submittedAt, "SUBMITTED_AT");
    if (
      normalized.status === "reconciliation_required" &&
      !normalized.reconciliationRequiredAt
    ) {
      throw new WorkflowStoreError("Prefill reconciliation timestamp is missing");
    }
  }
  return Object.freeze(normalized);
}

function normalizeSubmissionRow(rawRow, tableName) {
  const row = unwrapRow(rawRow, tableName);
  if (!row) throw new WorkflowStoreError("Submission receipt row is incomplete");
  const normalized = {
    rowId: validateRowId(row.ROWID, "workflow_store_unavailable"),
    submissionKey: String(row.SUBMISSION_KEY ?? ""),
    prefillKey: String(row.PREFILL_KEY ?? ""),
    sessionRowId: validateRowId(row.SESSION_ROW_ID, "workflow_store_unavailable"),
    status: String(row.STATUS ?? ""),
    leaseOwner: String(row.LEASE_OWNER ?? ""),
    leaseExpiresAt: String(row.LEASE_EXPIRES_AT ?? ""),
    attemptCount: safeInteger(row.ATTEMPT_COUNT, "ATTEMPT_COUNT", 1, 10),
    claimedAt: String(row.CLAIMED_AT ?? ""),
    succeededAt: String(row.SUCCEEDED_AT ?? ""),
    failedAt: String(row.FAILED_AT ?? ""),
    reconciliationRequiredAt: String(row.RECONCILIATION_REQUIRED_AT ?? ""),
    updatedAt: String(row.UPDATED_AT ?? ""),
    sourceRevision: String(row.SOURCE_REVISION ?? ""),
    sourceEnvironment: String(row.SOURCE_ENVIRONMENT ?? ""),
    lastOutcome: String(row.LAST_OUTCOME ?? ""),
  };

  if (
    !HASH_PATTERN.test(normalized.submissionKey) ||
    !HASH_PATTERN.test(normalized.prefillKey) ||
    !SUBMISSION_STATUS_SET.has(normalized.status) ||
    !REVISION_PATTERN.test(normalized.sourceRevision) ||
    normalized.sourceEnvironment !== "development" ||
    !OUTCOME_PATTERN.test(normalized.lastOutcome)
  ) {
    throw new WorkflowStoreError("Submission receipt row has invalid operational metadata");
  }
  validateUuid(normalized.leaseOwner, "LEASE_OWNER", "workflow_store_unavailable");
  validateIso(normalized.leaseExpiresAt, "LEASE_EXPIRES_AT");
  validateIso(normalized.claimedAt, "CLAIMED_AT");
  validateIso(normalized.updatedAt, "UPDATED_AT");
  validateIso(normalized.succeededAt, "SUCCEEDED_AT", { allowEmpty: true });
  validateIso(normalized.failedAt, "FAILED_AT", { allowEmpty: true });
  validateIso(normalized.reconciliationRequiredAt, "RECONCILIATION_REQUIRED_AT", {
    allowEmpty: true,
  });

  const requiredTimestamp = {
    succeeded: normalized.succeededAt,
    failed: normalized.failedAt,
    reconciliation_required: normalized.reconciliationRequiredAt,
  }[normalized.status];
  if (normalized.status !== "processing" && !requiredTimestamp) {
    throw new WorkflowStoreError("Submission receipt terminal timestamp is missing");
  }
  return Object.freeze(normalized);
}

function validatePrefillBinding(input, allowedKeys = PREFILL_BINDING_KEYS) {
  assertExactKeys(input, allowedKeys, "Prefill binding is invalid");
  return {
    sessionRowId: validateRowId(input.sessionRowId),
    sessionAttemptCount: safeInteger(
      input.sessionAttemptCount,
      "sessionAttemptCount",
      1,
      10,
    ),
    crmContactId: validateRecordId(input.crmContactId, "crmContactId"),
    crmAccountId: validateRecordId(input.crmAccountId, "crmAccountId"),
    crmDealId: validateRecordId(input.crmDealId, "crmDealId"),
    contactModifiedTime: validateModifiedTime(input.contactModifiedTime, "contactModifiedTime"),
    accountModifiedTime: validateModifiedTime(input.accountModifiedTime, "accountModifiedTime"),
    dealModifiedTime: validateModifiedTime(input.dealModifiedTime, "dealModifiedTime"),
    snapshotFingerprint: validateFingerprint(input.snapshotFingerprint),
  };
}

function samePrefillBinding(row, binding) {
  return (
    row.sessionRowId === binding.sessionRowId &&
    row.sessionAttemptCount === binding.sessionAttemptCount &&
    row.crmContactId === binding.crmContactId &&
    row.crmAccountId === binding.crmAccountId &&
    row.crmDealId === binding.crmDealId &&
    row.contactModifiedTime === binding.contactModifiedTime &&
    row.accountModifiedTime === binding.accountModifiedTime &&
    row.dealModifiedTime === binding.dealModifiedTime &&
    row.snapshotFingerprint === binding.snapshotFingerprint
  );
}

function createWorkflowStore(
  adapter,
  config,
  {
    now = Date.now,
    randomUUID = crypto.randomUUID,
    hashIdentifier,
  } = {},
) {
  validateAdapter(adapter);
  validateConfig(config);
  if (typeof now !== "function" || typeof randomUUID !== "function") {
    throw new WorkflowStoreError("Workflow entropy or clock provider is invalid");
  }
  if (hashIdentifier !== undefined && typeof hashIdentifier !== "function") {
    throw new WorkflowStoreError("Workflow identifier hash provider is invalid");
  }

  const prefillTable = config.prefillTableName;
  const submissionTable = config.submissionTableName;
  const leaseDurationMs = Math.max(30000, config.platformOperationTimeoutMs * 4);

  function deriveKey(kind, rawIdentifier) {
    let key;
    try {
      key = hashIdentifier
        ? hashIdentifier(kind, rawIdentifier)
        : crypto
          .createHmac("sha256", config.tokenPepper)
          .update(`sylvara-form2:${config.deploymentEnvironment}:${kind}\0`, "utf8")
          .update(rawIdentifier, "utf8")
          .digest("hex");
    } catch {
      throw new WorkflowStoreError("Workflow identifier derivation failed");
    }
    if (typeof key !== "string" || !HASH_PATTERN.test(key)) {
      throw new WorkflowStoreError("Workflow identifier derivation returned an invalid key");
    }
    return key;
  }

  function derivePrefillId(sessionRowId, sessionAttemptCount) {
    let bytes;
    try {
      bytes = crypto
        .createHmac("sha256", config.tokenPepper)
        .update(
          `sylvara-form2:${config.deploymentEnvironment}:prefill-id\0`,
          "utf8",
        )
        .update(sessionRowId, "utf8")
        .update("\0", "utf8")
        .update(String(sessionAttemptCount), "utf8")
        .digest()
        .subarray(0, 16);
    } catch {
      throw new WorkflowStoreError("Prefill identifier derivation failed");
    }
    // Preserve an opaque 128-bit UUID representation while setting the UUID
    // version and variant bits. Its value is deterministic only for the
    // server-held pepper, durable session row, and verification attempt.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return validateUuid(
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
      "prefill identifier",
      "workflow_store_unavailable",
    );
  }

  function mintUuid(name) {
    let value;
    try {
      value = randomUUID();
    } catch {
      throw new WorkflowStoreError(`Could not generate ${name}`);
    }
    return validateUuid(value, name, "workflow_store_unavailable");
  }

  async function queryUnique(query, normalize, notFoundAllowed, description) {
    let rows;
    try {
      rows = await query();
    } catch {
      throw new WorkflowStoreError(`Could not read ${description}`);
    }
    if (
      !Array.isArray(rows) ||
      rows.length > 1 ||
      (!notFoundAllowed && rows.length !== 1)
    ) {
      throw new WorkflowStoreError(`${description} readback was not unique`);
    }
    return rows.length === 0 ? null : normalize(rows[0]);
  }

  const readPrefillByKey = (prefillKey, notFoundAllowed = true) => queryUnique(
    () => adapter.findRowsByPrefillKey(prefillTable, prefillKey),
    (row) => normalizePrefillRow(row, prefillTable),
    notFoundAllowed,
    "the durable prefill revision",
  );

  const readPrefillByRowId = (rowId) => queryUnique(
    () => adapter.findRowsByRowId(prefillTable, validateRowId(rowId)),
    (row) => normalizePrefillRow(row, prefillTable),
    false,
    "the durable prefill revision",
  );

  const readSubmissionByKey = (submissionKey, notFoundAllowed = true) => queryUnique(
    () => adapter.findRowsBySubmissionKey(submissionTable, submissionKey),
    (row) => normalizeSubmissionRow(row, submissionTable),
    notFoundAllowed,
    "the durable submission receipt",
  );

  const readSubmissionByRowId = (rowId) => queryUnique(
    () => adapter.findRowsByRowId(submissionTable, validateRowId(rowId)),
    (row) => normalizeSubmissionRow(row, submissionTable),
    false,
    "the durable submission receipt",
  );

  async function mintPrefill(input) {
    const binding = validatePrefillBinding(input);
    const prefillId = derivePrefillId(
      binding.sessionRowId,
      binding.sessionAttemptCount,
    );
    const prefillKey = deriveKey("prefill", prefillId);
    const timestamp = new Date(validateNow(now)).toISOString();
    const row = {
      PREFILL_KEY: prefillKey,
      SESSION_ROW_ID: binding.sessionRowId,
      SESSION_ATTEMPT_COUNT: binding.sessionAttemptCount,
      CRM_CONTACT_ID: binding.crmContactId,
      CRM_ACCOUNT_ID: binding.crmAccountId,
      CRM_DEAL_ID: binding.crmDealId,
      CONTACT_MODIFIED_TIME: binding.contactModifiedTime,
      ACCOUNT_MODIFIED_TIME: binding.accountModifiedTime,
      DEAL_MODIFIED_TIME: binding.dealModifiedTime,
      SNAPSHOT_FINGERPRINT: binding.snapshotFingerprint,
      STATUS: "ready",
      CONSUMPTION_OWNER: "",
      ISSUED_AT: timestamp,
      SUBMITTED_AT: "",
      RECONCILIATION_REQUIRED_AT: "",
      UPDATED_AT: timestamp,
      SOURCE_REVISION: config.sourceRevision,
      SOURCE_ENVIRONMENT: config.deploymentEnvironment,
      LAST_OUTCOME: "ready",
    };

    try {
      await adapter.insertRow(prefillTable, row);
    } catch {
      // The insert may have committed before a timeout. A unique-key readback
      // is authoritative; blindly retrying could mint conflicting revisions.
    }
    const readback = await readPrefillByKey(prefillKey);
    if (!readback) {
      throw new WorkflowStoreError(
        "Prefill revision issuance requires operator reconciliation",
        "reconciliation_required",
      );
    }
    if (
      !samePrefillBinding(readback, binding) ||
      readback.prefillKey !== prefillKey ||
      readback.sourceRevision !== config.sourceRevision ||
      readback.sourceEnvironment !== config.deploymentEnvironment
    ) {
      throw new WorkflowStoreError(
        "Prefill attempt is bound to a different revision",
        "prefill_conflict",
      );
    }
    if (readback.status === "submitted") {
      throw new WorkflowStoreError(
        "Prefill attempt was already consumed",
        "prefill_consumed",
      );
    }
    if (readback.status === "reconciliation_required") {
      throw new WorkflowStoreError(
        "Prefill attempt requires operator reconciliation",
        "reconciliation_required",
      );
    }
    if (readback.status !== "ready" || readback.lastOutcome !== "ready") {
      throw new WorkflowStoreError("Prefill attempt has an unknown state");
    }
    return Object.freeze({ prefillId, revision: readback });
  }

  async function readPrefill(input) {
    assertExactKeys(input, PREFILL_READ_KEYS, "Prefill lookup is invalid");
    const prefillId = validateUuid(input.prefillId, "prefillId");
    const sessionRowId = validateRowId(input.sessionRowId);
    const row = await readPrefillByKey(deriveKey("prefill", prefillId));
    if (!row) return null;
    if (row.sessionRowId !== sessionRowId) {
      throw new WorkflowStoreError("Prefill context does not match", "prefill_context_invalid");
    }
    return row;
  }

  async function consumePrefill(input) {
    const binding = validatePrefillBinding(input, PREFILL_CONSUME_KEYS);
    const prefillId = validateUuid(input.prefillId, "prefillId");
    const prefillKey = deriveKey("prefill", prefillId);
    const current = await readPrefillByKey(prefillKey);
    if (!current) {
      throw new WorkflowStoreError("Prefill revision was not found", "prefill_not_found");
    }
    if (current.sessionRowId !== binding.sessionRowId) {
      throw new WorkflowStoreError("Prefill context does not match", "prefill_context_invalid");
    }
    if (!samePrefillBinding(current, binding)) {
      throw new WorkflowStoreError("Prefill revision is stale", "prefill_stale");
    }
    if (current.status === "submitted") {
      throw new WorkflowStoreError("Prefill revision was already consumed", "prefill_consumed");
    }
    if (current.status === "reconciliation_required") {
      throw new WorkflowStoreError(
        "Prefill revision requires operator reconciliation",
        "reconciliation_required",
      );
    }
    if (current.status !== "ready") {
      throw new WorkflowStoreError("Prefill revision has an unknown state");
    }

    const timestamp = new Date(validateNow(now)).toISOString();
    const consumptionOwner = mintUuid("prefill consumption owner");
    const patch = {
      STATUS: "submitted",
      CONSUMPTION_OWNER: consumptionOwner,
      SUBMITTED_AT: timestamp,
      UPDATED_AT: timestamp,
      LAST_OUTCOME: "submitted",
    };
    try {
      await adapter.updateRow(prefillTable, { ROWID: current.rowId, ...patch }, {
        STATUS: "ready",
        PREFILL_KEY: current.prefillKey,
        SESSION_ROW_ID: current.sessionRowId,
      });
    } catch {
      // Conditional conflicts and timeouts are resolved by exact readback.
    }
    const readback = await readPrefillByRowId(current.rowId);
    if (
      readback.status === "submitted" &&
      readback.consumptionOwner !== consumptionOwner
    ) {
      throw new WorkflowStoreError("Prefill revision was already consumed", "prefill_consumed");
    }
    if (
      readback.status !== "submitted" ||
      readback.consumptionOwner !== consumptionOwner ||
      readback.submittedAt !== timestamp ||
      readback.updatedAt !== timestamp ||
      readback.lastOutcome !== "submitted"
    ) {
      throw new WorkflowStoreError(
        "Prefill consumption requires operator reconciliation",
        "reconciliation_required",
      );
    }
    return readback;
  }

  async function markPrefillReconciliationRequired(reference, outcome = "crm_outcome_unknown") {
    assertExactKeys(reference, PREFILL_REFERENCE_KEYS, "Prefill claim reference is invalid");
    if (!OUTCOME_PATTERN.test(outcome ?? "")) {
      throw new WorkflowStoreError("Prefill outcome is invalid", "workflow_input_invalid");
    }
    const rowId = validateRowId(reference.rowId);
    const consumptionOwner = validateUuid(reference.consumptionOwner, "consumptionOwner");
    const current = await readPrefillByRowId(rowId);
    if (current.consumptionOwner !== consumptionOwner) {
      throw new WorkflowStoreError("Prefill claim does not match", "prefill_context_invalid");
    }
    if (current.status === "reconciliation_required") return current;
    if (current.status !== "submitted") {
      throw new WorkflowStoreError("Prefill claim is not reconcilable", "prefill_context_invalid");
    }
    const timestamp = new Date(validateNow(now)).toISOString();
    const patch = {
      STATUS: "reconciliation_required",
      RECONCILIATION_REQUIRED_AT: timestamp,
      UPDATED_AT: timestamp,
      LAST_OUTCOME: outcome,
    };
    try {
      await adapter.updateRow(prefillTable, { ROWID: rowId, ...patch }, {
        STATUS: "submitted",
        CONSUMPTION_OWNER: consumptionOwner,
      });
    } catch {
      // Exact readback below resolves an ambiguous conditional update.
    }
    const readback = await readPrefillByRowId(rowId);
    if (
      readback.status !== "reconciliation_required" ||
      readback.consumptionOwner !== consumptionOwner ||
      readback.reconciliationRequiredAt !== timestamp ||
      readback.updatedAt !== timestamp ||
      readback.lastOutcome !== outcome
    ) {
      throw new WorkflowStoreError(
        "Prefill state requires operator reconciliation",
        "reconciliation_required",
      );
    }
    return readback;
  }

  async function readSubmission(input) {
    assertExactKeys(input, new Set(["submissionId"]), "Submission lookup is invalid");
    const submissionId = validateSubmissionId(input.submissionId);
    return readSubmissionByKey(deriveKey("submission", submissionId));
  }

  async function claimSubmission(input) {
    assertExactKeys(input, SUBMISSION_CLAIM_KEYS, "Submission claim is invalid");
    const submissionId = validateSubmissionId(input.submissionId);
    const prefillId = validateUuid(input.prefillId, "prefillId");
    const sessionRowId = validateRowId(input.sessionRowId);
    const submissionKey = deriveKey("submission", submissionId);
    const prefillKey = deriveKey("prefill", prefillId);
    const leaseOwner = mintUuid("submission lease owner");
    const nowMs = validateNow(now);
    const timestamp = new Date(nowMs).toISOString();
    const row = {
      SUBMISSION_KEY: submissionKey,
      PREFILL_KEY: prefillKey,
      SESSION_ROW_ID: sessionRowId,
      STATUS: "processing",
      LEASE_OWNER: leaseOwner,
      LEASE_EXPIRES_AT: new Date(nowMs + leaseDurationMs).toISOString(),
      ATTEMPT_COUNT: 1,
      CLAIMED_AT: timestamp,
      SUCCEEDED_AT: "",
      FAILED_AT: "",
      RECONCILIATION_REQUIRED_AT: "",
      UPDATED_AT: timestamp,
      SOURCE_REVISION: config.sourceRevision,
      SOURCE_ENVIRONMENT: config.deploymentEnvironment,
      LAST_OUTCOME: "processing",
    };

    // This unique insert is intentionally attempted before any submission-key
    // lookup. It is the concurrency boundary for an immutable Forms identity.
    try {
      await adapter.insertRow(submissionTable, row);
    } catch {
      // Duplicate-key errors and post-commit timeouts share one readback path.
    }
    const readback = await readSubmissionByKey(submissionKey);
    if (!readback) {
      throw new WorkflowStoreError(
        "Submission claim requires operator reconciliation",
        "reconciliation_required",
      );
    }
    if (
      readback.prefillKey !== prefillKey ||
      readback.sessionRowId !== sessionRowId
    ) {
      throw new WorkflowStoreError(
        "Submission identity is bound to a different workflow",
        "submission_conflict",
      );
    }
    if (readback.status === "succeeded") {
      return Object.freeze({ outcome: "succeeded", receipt: readback });
    }
    if (
      readback.status === "processing" &&
      readback.leaseOwner === leaseOwner &&
      readback.leaseExpiresAt === row.LEASE_EXPIRES_AT &&
      readback.claimedAt === timestamp &&
      readback.updatedAt === timestamp &&
      readback.attemptCount === 1 &&
      readback.sourceRevision === config.sourceRevision
    ) {
      return Object.freeze({ outcome: "claimed", receipt: readback });
    }
    if (
      readback.status === "failed" &&
      readback.lastOutcome === "retryable_precommit" &&
      readback.attemptCount < config.maxSubmissionAttempts
    ) {
      const patch = {
        STATUS: "processing",
        LEASE_OWNER: leaseOwner,
        LEASE_EXPIRES_AT: row.LEASE_EXPIRES_AT,
        ATTEMPT_COUNT: readback.attemptCount + 1,
        CLAIMED_AT: timestamp,
        SUCCEEDED_AT: "",
        FAILED_AT: "",
        RECONCILIATION_REQUIRED_AT: "",
        UPDATED_AT: timestamp,
        LAST_OUTCOME: "processing",
      };
      try {
        await adapter.updateRow(submissionTable, { ROWID: readback.rowId, ...patch }, {
          STATUS: "failed",
          LEASE_OWNER: readback.leaseOwner,
          ATTEMPT_COUNT: readback.attemptCount,
          LAST_OUTCOME: "retryable_precommit",
        });
      } catch {
        // A competing retry or a post-commit timeout is distinguished only by
        // the fresh lease owner and the exact durable readback below.
      }
      const reclaimed = await readSubmissionByKey(submissionKey);
      if (
        reclaimed.prefillKey !== prefillKey ||
        reclaimed.sessionRowId !== sessionRowId
      ) {
        throw new WorkflowStoreError(
          "Submission identity is bound to a different workflow",
          "submission_conflict",
        );
      }
      if (reclaimed.status === "succeeded") {
        return Object.freeze({ outcome: "succeeded", receipt: reclaimed });
      }
      if (
        reclaimed.status === "processing" &&
        reclaimed.leaseOwner === leaseOwner &&
        reclaimed.leaseExpiresAt === patch.LEASE_EXPIRES_AT &&
        reclaimed.attemptCount === patch.ATTEMPT_COUNT &&
        reclaimed.claimedAt === patch.CLAIMED_AT &&
        reclaimed.succeededAt === "" &&
        reclaimed.failedAt === "" &&
        reclaimed.reconciliationRequiredAt === "" &&
        reclaimed.updatedAt === patch.UPDATED_AT &&
        reclaimed.lastOutcome === "processing"
      ) {
        return Object.freeze({ outcome: "claimed", receipt: reclaimed });
      }
      return Object.freeze({ outcome: "unresolved", receipt: reclaimed });
    }
    if (new Set(["processing", "failed", "reconciliation_required"]).has(readback.status)) {
      return Object.freeze({ outcome: "unresolved", receipt: readback });
    }
    throw new WorkflowStoreError("Submission receipt has an unknown state");
  }

  function validateClaimReference(reference) {
    assertExactKeys(reference, CLAIM_REFERENCE_KEYS, "Submission claim reference is invalid");
    return {
      rowId: validateRowId(reference.rowId),
      leaseOwner: validateUuid(reference.leaseOwner, "leaseOwner"),
    };
  }

  async function transitionSubmission(reference, targetStatus, outcome, timestampField, allowedFrom) {
    const validated = validateClaimReference(reference);
    if (!SUBMISSION_STATUS_SET.has(targetStatus) || !OUTCOME_PATTERN.test(outcome ?? "")) {
      throw new WorkflowStoreError("Submission transition is invalid", "workflow_input_invalid");
    }
    const current = await readSubmissionByRowId(validated.rowId);
    if (current.leaseOwner !== validated.leaseOwner) {
      throw new WorkflowStoreError("Submission lease does not match", "submission_conflict");
    }
    if (current.status === targetStatus) return current;
    if (!allowedFrom.has(current.status)) {
      throw new WorkflowStoreError("Submission result is unresolved", "submission_unresolved");
    }

    const timestamp = new Date(validateNow(now)).toISOString();
    const patch = {
      STATUS: targetStatus,
      [timestampField]: timestamp,
      UPDATED_AT: timestamp,
      LAST_OUTCOME: outcome,
    };
    try {
      await adapter.updateRow(submissionTable, { ROWID: current.rowId, ...patch }, {
        STATUS: current.status,
        LEASE_OWNER: current.leaseOwner,
        ATTEMPT_COUNT: current.attemptCount,
      });
    } catch {
      // Never retry an ambiguous result write; compare the durable row instead.
    }
    const readback = await readSubmissionByRowId(current.rowId);
    if (
      readback.status !== targetStatus ||
      readback.leaseOwner !== current.leaseOwner ||
      readback[timestampField === "SUCCEEDED_AT"
        ? "succeededAt"
        : timestampField === "FAILED_AT"
          ? "failedAt"
          : "reconciliationRequiredAt"] !== timestamp ||
      readback.updatedAt !== timestamp ||
      readback.lastOutcome !== outcome
    ) {
      throw new WorkflowStoreError(
        "Submission result requires operator reconciliation",
        "reconciliation_required",
      );
    }
    return readback;
  }

  const markSubmissionSucceeded = (reference) => transitionSubmission(
    reference,
    "succeeded",
    "succeeded",
    "SUCCEEDED_AT",
    new Set(["processing"]),
  );
  const markSubmissionFailed = (reference, outcome = "processing_failed") => transitionSubmission(
    reference,
    "failed",
    outcome,
    "FAILED_AT",
    new Set(["processing"]),
  );
  const markSubmissionReconciliationRequired = (
    reference,
    outcome = "crm_outcome_unknown",
  ) => transitionSubmission(
    reference,
    "reconciliation_required",
    outcome,
    "RECONCILIATION_REQUIRED_AT",
    new Set(["processing", "failed"]),
  );

  return Object.freeze({
    claimSubmission,
    consumePrefill,
    markPrefillReconciliationRequired,
    markSubmissionFailed,
    markSubmissionReconciliationRequired,
    markSubmissionSucceeded,
    mintPrefill,
    readPrefill,
    readSubmission,
  });
}

module.exports = {
  PREFILL_STATUSES,
  PREFILL_STORED_FIELDS,
  SUBMISSION_STATUSES,
  SUBMISSION_STORED_FIELDS,
  WorkflowStoreError,
  createWorkflowStore,
};
