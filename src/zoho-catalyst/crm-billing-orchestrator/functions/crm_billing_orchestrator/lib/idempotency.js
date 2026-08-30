"use strict";

const crypto = require("node:crypto");
const { ACTIONS } = require("./action-contract");
const { withOperationTimeout } = require("./operation-timeout");

const HASH = /^[a-f0-9]{64}$/;
const ROW_ID = /^[0-9]{1,30}$/;
const RECORD_ID = /^[1-9][0-9]{7,29}$/;
const OUTCOME = /^[a-z0-9_]{1,80}$/;
const ACTION_SET = new Set(ACTIONS);
const TEST_CUSTOMER_PROVISIONING_ACTION = "provision_test_customer";
const REPORT_SUMMARY_ACTION = "sync_report_summary";
const REPORT_CLAIM = /^report_claim_[a-f0-9]{32}$/;
const REPORT_WRITE_STARTED = /^report_write_started_[a-f0-9]{32}$/;
const REPORT_STATUS_SET = new Set([
  "pending", "processing", "reconciliation_required", "completed",
]);
const REPORT_RECONCILIATION_OUTCOMES = new Set([
  "report_binding_stale",
  "report_revision_protected",
  "report_summary_readback_required",
  "report_test_status_conflict",
]);
const CLAIM_ACTION_SET = new Set([...ACTIONS, TEST_CUSTOMER_PROVISIONING_ACTION]);
const IDEMPOTENCY_DOMAIN = "sylvara.crm-billing.idempotency.v1";

class IdempotencyError extends Error {
  constructor(message, publicCode = "idempotency_unavailable") {
    super(message);
    this.name = "IdempotencyError";
    this.publicCode = publicCode;
    this.status = 503;
  }
}

function extractErrorCode(error) {
  return [
    error?.code,
    error?.statusCode,
    error?.status,
    error?.data?.code,
    error?.response?.data?.code,
  ].find((candidate) => candidate !== undefined && candidate !== null);
}

function unwrap(row, tableName) {
  if (!row || typeof row !== "object") return null;
  return row[tableName] && typeof row[tableName] === "object" ? row[tableName] : row;
}

function rowId(value) {
  const normalized = String(value ?? "");
  if (!ROW_ID.test(normalized)) throw new IdempotencyError("Operation row identifier is invalid");
  return normalized;
}

function safeHashEqual(left, right) {
  return HASH.test(left) && HASH.test(right) && crypto.timingSafeEqual(
    Buffer.from(left, "hex"),
    Buffer.from(right, "hex"),
  );
}

function isReportSummaryPreWrite(operation) {
  return operation?.STATUS === "processing"
    && REPORT_CLAIM.test(String(operation?.LAST_OUTCOME ?? ""));
}

function sameReportOperationIdentity(expected, actual) {
  return Boolean(actual)
    && String(actual.ROWID ?? "") === String(expected.ROWID ?? "")
    && safeHashEqual(String(actual.OPERATION_KEY ?? ""), String(expected.OPERATION_KEY ?? ""))
    && safeHashEqual(
      String(actual.OPERATION_FINGERPRINT ?? ""),
      String(expected.OPERATION_FINGERPRINT ?? ""),
    )
    && actual.ACTION === REPORT_SUMMARY_ACTION
    && actual.CRM_DEAL_ID === expected.CRM_DEAL_ID
    && actual.SOURCE_REVISION === expected.SOURCE_REVISION
    && actual.SOURCE_ENVIRONMENT === expected.SOURCE_ENVIRONMENT
    && actual.OPERATION_PAYLOAD_JSON === expected.OPERATION_PAYLOAD_JSON;
}

function canonicalMaterial(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IdempotencyError("Operation identity material is invalid", "operation_invalid");
  }
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  if (
    entries.length < 1 || entries.length > 20 ||
    entries.some(([key, candidate]) => (
      !/^[a-z][a-zA-Z0-9]{0,39}$/.test(key) ||
      !["string", "number", "boolean"].includes(typeof candidate) ||
      (typeof candidate === "string" && (candidate.length > 200 || /[\u0000-\u001f\u007f]/.test(candidate))) ||
      (typeof candidate === "number" && !Number.isSafeInteger(candidate))
    ))
  ) throw new IdempotencyError("Operation identity material is invalid", "operation_invalid");
  return JSON.stringify(entries);
}

function deriveScopedIdentity(config, action, scopeId, material, referencePrefix = null) {
  if (!CLAIM_ACTION_SET.has(action) || !RECORD_ID.test(scopeId)) {
    throw new IdempotencyError("Operation identity input is invalid", "operation_invalid");
  }
  const canonical = canonicalMaterial(material);
  // The durable key and Billing reference intentionally exclude mutable acceptance and
  // commercial fields. Those fields live in the immutable fingerprint, so a changed
  // acceptance conflicts with the same unique operation instead of creating a second reference.
  const stableIdentity = `${config.deploymentEnvironment}\0${scopeId}\0${action}`;
  const key = crypto.createHmac("sha256", config.idempotencyPepper)
    .update(`${IDEMPOTENCY_DOMAIN}\0operation\0${stableIdentity}`)
    .digest("hex");
  const fingerprint = crypto.createHmac("sha256", config.idempotencyPepper)
    .update(`${IDEMPOTENCY_DOMAIN}\0fingerprint\0${stableIdentity}\0${canonical}`)
    .digest("hex");
  return Object.freeze({
    operationKey: key,
    operationFingerprint: fingerprint,
    billingReference: referencePrefix ? `${referencePrefix}${key.slice(0, 32)}` : null,
  });
}

function deriveOperationIdentity(config, action, dealId, material) {
  if (!ACTION_SET.has(action)) {
    throw new IdempotencyError("Operation identity input is invalid", "operation_invalid");
  }
  const referencePrefix = action === "prepare_paid_subscription" ? "syl-paid-" : null;
  return deriveScopedIdentity(config, action, dealId, material, referencePrefix);
}

function deriveTestCustomerProvisioningIdentity(config, crmAccountId) {
  return deriveScopedIdentity(
    config,
    TEST_CUSTOMER_PROVISIONING_ACTION,
    crmAccountId,
    {
      accountId: crmAccountId,
      billingOrganizationId: config.billingOrganizationId,
      customerProvisioningMode: config.customerProvisioningMode,
    },
  );
}

function createOperationStore(app, config) {
  if (typeof app?.datastore !== "function" || typeof app?.zcql !== "function") {
    throw new IdempotencyError("Catalyst Data Store is unavailable");
  }
  const table = app.datastore().table(config.operationTable);

  async function query(statement) {
    let result;
    try {
      result = await withOperationTimeout(
        () => app.zcql().executeZCQLQuery(statement),
        config.platformOperationTimeoutMs,
      );
    } catch {
      throw new IdempotencyError("Operation readback failed");
    }
    if (!Array.isArray(result) || result.length > 1) {
      throw new IdempotencyError("Operation readback is not unique", "reconciliation_required");
    }
    return result.length ? unwrap(result[0], config.operationTable) : null;
  }

  async function readByKey(operationKey) {
    if (!HASH.test(operationKey)) throw new IdempotencyError("Operation key is invalid");
    return query(
      `SELECT ROWID, OPERATION_KEY, OPERATION_FINGERPRINT, ACTION, CRM_DEAL_ID, STATUS, SOURCE_REVISION, SOURCE_ENVIRONMENT, LAST_OUTCOME, OPERATION_PAYLOAD_JSON, OPERATION_VERSION, CREATED_AT, UPDATED_AT FROM ${config.operationTable} WHERE OPERATION_KEY = '${operationKey}'`,
    );
  }

  async function readByRowId(selectedRowId) {
    const normalized = rowId(selectedRowId);
    return query(
      `SELECT ROWID, STATUS, LAST_OUTCOME, OPERATION_VERSION, UPDATED_AT FROM ${config.operationTable} WHERE ROWID = ${normalized}`,
    );
  }

  async function claimReportSummary(operation, claimToken, claimedAt) {
    const normalized = rowId(operation?.ROWID);
    const version = Number(operation?.OPERATION_VERSION);
    const pending = operation?.STATUS === "pending"
      && operation?.LAST_OUTCOME === "terminal_report_ready";
    const reclaimable = isReportSummaryPreWrite(operation);
    if (
      operation?.ACTION !== REPORT_SUMMARY_ACTION || (!pending && !reclaimable) ||
      !HASH.test(String(operation?.OPERATION_KEY ?? "")) ||
      !HASH.test(String(operation?.OPERATION_FINGERPRINT ?? "")) ||
      !Number.isSafeInteger(version) || version < 1 || !REPORT_CLAIM.test(claimToken) ||
      typeof claimedAt !== "string" || new Date(claimedAt).toISOString() !== claimedAt
    ) throw new IdempotencyError("Report-summary claim input is invalid", "operation_invalid");
    const nextVersion = version + 1;
    const statement = `UPDATE ${config.operationTable} SET STATUS = 'processing', LAST_OUTCOME = '${claimToken}', OPERATION_VERSION = ${nextVersion}, UPDATED_AT = '${claimedAt}' WHERE ROWID = ${normalized} AND STATUS = '${operation.STATUS}' AND LAST_OUTCOME = '${operation.LAST_OUTCOME}' AND OPERATION_VERSION = ${version}`;
    try {
      await withOperationTimeout(
        () => app.zcql().executeZCQLQuery(statement),
        config.platformOperationTimeoutMs,
        { ambiguous: true },
      );
    } catch {
      // The exact token/version readback below determines whether this caller owns the claim.
    }
    const readback = await readByKey(operation.OPERATION_KEY);
    const claimed = Boolean(readback
      && readback.STATUS === "processing"
      && Number(readback.OPERATION_VERSION) === nextVersion
      && readback.LAST_OUTCOME === claimToken
      && readback.UPDATED_AT === claimedAt
      && safeHashEqual(String(readback.OPERATION_FINGERPRINT ?? ""), operation.OPERATION_FINGERPRINT));
    return Object.freeze({ claimed, row: readback });
  }

  async function beginReportSummaryWrite(operation, claimToken, startedAt) {
    const normalized = rowId(operation?.ROWID);
    const version = Number(operation?.OPERATION_VERSION);
    if (
      operation?.ACTION !== REPORT_SUMMARY_ACTION || !isReportSummaryPreWrite(operation) ||
      operation.LAST_OUTCOME !== claimToken ||
      !HASH.test(String(operation?.OPERATION_KEY ?? "")) ||
      !HASH.test(String(operation?.OPERATION_FINGERPRINT ?? "")) ||
      !Number.isSafeInteger(version) || version < 2 || !REPORT_CLAIM.test(claimToken) ||
      typeof startedAt !== "string" || new Date(startedAt).toISOString() !== startedAt
    ) throw new IdempotencyError(
      "Report-summary write-start input is invalid", "operation_invalid",
    );
    const writeStarted = claimToken.replace("report_claim_", "report_write_started_");
    if (!REPORT_WRITE_STARTED.test(writeStarted)) {
      throw new IdempotencyError("Report-summary write-start input is invalid", "operation_invalid");
    }
    const nextVersion = version + 1;
    const statement = `UPDATE ${config.operationTable} SET LAST_OUTCOME = '${writeStarted}', OPERATION_VERSION = ${nextVersion}, UPDATED_AT = '${startedAt}' WHERE ROWID = ${normalized} AND STATUS = 'processing' AND LAST_OUTCOME = '${claimToken}' AND OPERATION_VERSION = ${version}`;
    try {
      await withOperationTimeout(
        () => app.zcql().executeZCQLQuery(statement),
        config.platformOperationTimeoutMs,
        { ambiguous: true },
      );
    } catch {
      // A caller may enter CRM only after exact write-start readback proves ownership.
    }
    const readback = await readByKey(operation.OPERATION_KEY);
    const started = Boolean(readback
      && readback.STATUS === "processing"
      && Number(readback.OPERATION_VERSION) === nextVersion
      && readback.LAST_OUTCOME === writeStarted
      && readback.UPDATED_AT === startedAt
      && safeHashEqual(String(readback.OPERATION_FINGERPRINT ?? ""), operation.OPERATION_FINGERPRINT));
    return Object.freeze({ started, row: readback });
  }

  async function transitionReportSummary(operation, status, lastOutcome, transitionedAt) {
    const normalized = rowId(operation?.ROWID);
    const validTarget = status === "completed"
      ? lastOutcome === "report_summary_readback_confirmed"
      : status === "reconciliation_required"
        && REPORT_RECONCILIATION_OUTCOMES.has(lastOutcome);
    if (
      operation?.ACTION !== REPORT_SUMMARY_ACTION || !REPORT_STATUS_SET.has(operation?.STATUS) ||
      !OUTCOME.test(String(operation?.LAST_OUTCOME ?? "")) || !validTarget ||
      !HASH.test(String(operation?.OPERATION_KEY ?? "")) ||
      !HASH.test(String(operation?.OPERATION_FINGERPRINT ?? "")) ||
      !Number.isSafeInteger(Number(operation?.OPERATION_VERSION)) ||
      Number(operation.OPERATION_VERSION) < 1 ||
      typeof transitionedAt !== "string" || new Date(transitionedAt).toISOString() !== transitionedAt
    ) throw new IdempotencyError(
      "Report-summary transition input is invalid", "operation_invalid",
    );

    let cursor = operation;
    // One retry tolerates a concurrent cursor-only version advance. Any semantic
    // status/outcome change belongs to another invocation and must never be overwritten.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!sameReportOperationIdentity(operation, cursor)) {
        throw new IdempotencyError(
          "Report-summary transition identity changed", "reconciliation_required",
        );
      }
      const version = Number(cursor.OPERATION_VERSION);
      if (!Number.isSafeInteger(version) || version < 1
        || !REPORT_STATUS_SET.has(cursor.STATUS)
        || !OUTCOME.test(String(cursor.LAST_OUTCOME ?? ""))) {
        throw new IdempotencyError(
          "Report-summary transition cursor is invalid", "reconciliation_required",
        );
      }
      const nextVersion = version + 1;
      const statement = `UPDATE ${config.operationTable} SET STATUS = '${status}', LAST_OUTCOME = '${lastOutcome}', OPERATION_VERSION = ${nextVersion}, UPDATED_AT = '${transitionedAt}' WHERE ROWID = ${normalized} AND STATUS = '${cursor.STATUS}' AND LAST_OUTCOME = '${cursor.LAST_OUTCOME}' AND OPERATION_VERSION = ${version}`;
      try {
        await withOperationTimeout(
          () => app.zcql().executeZCQLQuery(statement),
          config.platformOperationTimeoutMs,
          { ambiguous: true },
        );
      } catch {
        // Exact semantic/version readback below resolves an uncertain CAS result.
      }
      const readback = await readByKey(operation.OPERATION_KEY);
      if (!sameReportOperationIdentity(operation, readback)) {
        throw new IdempotencyError(
          "Report-summary transition readback identity changed", "reconciliation_required",
        );
      }
      const readbackVersion = Number(readback.OPERATION_VERSION);
      if (!Number.isSafeInteger(readbackVersion) || readbackVersion < version) {
        throw new IdempotencyError(
          "Report-summary transition readback version is invalid", "reconciliation_required",
        );
      }
      if (
        readback.STATUS === status && readback.LAST_OUTCOME === lastOutcome &&
        readbackVersion >= nextVersion
      ) return Object.freeze({ transitioned: true, row: readback });
      const semanticCursorUnchanged = readback.STATUS === cursor.STATUS
        && readback.LAST_OUTCOME === cursor.LAST_OUTCOME;
      if (semanticCursorUnchanged && attempt === 0) {
        cursor = readback;
        continue;
      }
      return Object.freeze({ transitioned: false, row: readback });
    }
    throw new IdempotencyError(
      "Report-summary transition did not converge", "reconciliation_required",
    );
  }

  async function claim({ operationKey, operationFingerprint, action, scopeId }) {
    if (
      !HASH.test(operationKey) || !HASH.test(operationFingerprint) ||
      !CLAIM_ACTION_SET.has(action) || !RECORD_ID.test(scopeId)
    ) throw new IdempotencyError("Operation claim input is invalid");
    let insertError = null;
    try {
      const inserted = await withOperationTimeout(() => table.insertRow({
        OPERATION_KEY: operationKey,
        OPERATION_FINGERPRINT: operationFingerprint,
        ACTION: action,
        // CRM_DEAL_ID is a legacy physical column; internal Account-scoped claims store Account ID.
        CRM_DEAL_ID: scopeId,
        STATUS: "processing",
        SOURCE_REVISION: config.sourceRevision,
        SOURCE_ENVIRONMENT: config.deploymentEnvironment,
        LAST_OUTCOME: "claimed",
      }), config.platformOperationTimeoutMs, { ambiguous: true });
      return Object.freeze({ outcome: "claimed", rowId: rowId(inserted?.ROWID) });
    } catch (error) {
      insertError = error;
    }
    const existing = await readByKey(operationKey);
    if (!existing) {
      const code = String(extractErrorCode(insertError) ?? "");
      if (!config.duplicateErrorCodes.includes(code)) {
        throw new IdempotencyError("Operation claim failed or timed out");
      }
      throw new IdempotencyError("Duplicate operation claim has no readback", "reconciliation_required");
    }
    const matches = (
      safeHashEqual(String(existing.OPERATION_FINGERPRINT ?? ""), operationFingerprint) &&
      existing.ACTION === action && String(existing.CRM_DEAL_ID ?? "") === scopeId
    );
    if (!matches) return Object.freeze({ outcome: "duplicate-conflict", rowId: rowId(existing.ROWID) });
    return Object.freeze({
      outcome: existing.STATUS === "completed" ? "duplicate-completed" : "duplicate-unresolved",
      rowId: rowId(existing.ROWID),
      status: existing.STATUS,
      lastOutcome: existing.LAST_OUTCOME,
      sourceEnvironment: existing.SOURCE_ENVIRONMENT,
      sourceRevision: existing.SOURCE_REVISION,
    });
  }

  async function mark(selectedRowId, status, lastOutcome) {
    const normalized = rowId(selectedRowId);
    if (!new Set(["completed", "failed", "reconciliation_required"]).has(status)) {
      throw new IdempotencyError("Operation status is invalid");
    }
    if (!OUTCOME.test(lastOutcome)) throw new IdempotencyError("Operation outcome is invalid");
    try {
      await withOperationTimeout(() => table.updateRow({
        ROWID: normalized,
        STATUS: status,
        LAST_OUTCOME: lastOutcome,
      }), config.platformOperationTimeoutMs, { ambiguous: true });
    } catch {
      // The exact row readback below is authoritative after an uncertain update.
    }
    const readback = await readByRowId(normalized);
    if (!readback || readback.STATUS !== status || readback.LAST_OUTCOME !== lastOutcome) {
      throw new IdempotencyError("Operation result readback does not match", "reconciliation_required");
    }
    return Object.freeze({ rowId: normalized, status, lastOutcome });
  }

  return Object.freeze({
    beginReportSummaryWrite,
    claim,
    claimReportSummary,
    mark,
    readByKey,
    readByRowId,
    transitionReportSummary,
  });
}

module.exports = {
  IdempotencyError,
  TEST_CUSTOMER_PROVISIONING_ACTION,
  createOperationStore,
  deriveOperationIdentity,
  deriveTestCustomerProvisioningIdentity,
  isReportSummaryPreWrite,
};
