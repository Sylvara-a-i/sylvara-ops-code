"use strict";

const crypto = require("node:crypto");
const { withOperationTimeout } = require("./operation-timeout");

const RECORD_TYPE = "conversion_status";
const HASH = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_ENUM = /^[a-z][a-z0-9_]{0,63}$/;
const REVISION = /^[a-f0-9]{40}$/;
const OUTBOX_IMMUTABLE = Object.freeze([
  "OUTBOX_KEY", "PROVIDER_VERSION_KEY", "ROW_SCHEMA_VERSION", "RECORD_TYPE",
  "RECORD_KEY", "CLIENT_KEY", "DEPLOYMENT_KEY", "CONFIGURATION_VERSION",
  "ENGAGEMENT_TYPE", "ENVIRONMENT", "SOURCE_DATE_UTC", "PAYLOAD_JSON",
  "PAYLOAD_HASH", "METRIC_VERSION", "SOURCE_MODIFIED_AT", "SOURCE_REVISION",
]);
const FACT_FIELDS = Object.freeze([
  "SCHEMA_VERSION", "METRIC_VERSION", "RECORD_KEY", "CLIENT_KEY", "DEPLOYMENT_KEY",
  "CONFIGURATION_VERSION", "ENGAGEMENT_TYPE", "ENVIRONMENT", "SOURCE_MODIFIED_AT",
  "SOURCE_REVISION", "CRM_CONVERSION_STATUS", "BILLING_CONVERSION_STATUS",
  "RESULTS_REVIEW_STATUS", "PAID_ACCEPTANCE_STATUS", "TARGET_ENGAGEMENT_TYPE",
]);

class AnalyticsOutboxError extends Error {
  constructor(message, publicCode = "reconciliation_required") {
    super(message);
    this.name = "AnalyticsOutboxError";
    this.publicCode = publicCode;
    this.status = 503;
    this.ambiguous = true;
  }
}

function fail(message, publicCode) {
  throw new AnalyticsOutboxError(message, publicCode);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function keyedDigest(secret, domain, value) {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    fail("Analytics partition key is unavailable", "configuration_invalid");
  }
  return crypto.createHmac("sha256", secret)
    .update(domain, "utf8").update("\0", "utf8").update(String(value), "utf8")
    .digest("hex");
}

function canonicalJson(value) {
  const ordered = {};
  for (const key of Object.keys(value).sort()) ordered[key] = value[key];
  return JSON.stringify(ordered);
}

function safeEnum(value, field) {
  const normalized = String(value ?? "").replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  if (!SAFE_ENUM.test(normalized)) fail(`${field} is outside the Analytics enum contract`);
  return normalized;
}

function utcTimestamp(value, field) {
  const parsed = new Date(value);
  if (typeof value !== "string" || !Number.isFinite(parsed.getTime())) {
    fail(`${field} is not an authoritative timestamp`);
  }
  return parsed.toISOString();
}

function conversionStatusFact(config, evidence) {
  const { deal, accountId, deploymentId, configurationVersion, billingStatus } = evidence ?? {};
  if (!deal || typeof deal !== "object" || Array.isArray(deal)
    || !/^[1-9][0-9]{7,29}$/.test(String(deal.id ?? ""))
    || !/^[1-9][0-9]{7,29}$/.test(String(accountId ?? ""))
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(String(deploymentId ?? ""))
    || !IDENTIFIER.test(String(configurationVersion ?? ""))
    || deal.Subscription_Status !== billingStatus
    || !Object.values(config.paidSubscriptionStatusMap ?? {}).includes(billingStatus)
    || deal.Billing_Automation_Status !== "Paid Verified"
    || deal.Test_Status !== config.testCompletedStatusValue
    || deal.Subscription_Acceptance_Status !== config.paidAcceptanceValue) {
    fail("Conversion evidence is not an authoritative accepted-state readback");
  }
  const fact = {
    SCHEMA_VERSION: 1,
    METRIC_VERSION: "revenue_desk_conversion_v2",
    RECORD_KEY: keyedDigest(
      config.analyticsPartitionSecret, "revenue-desk-analytics-conversion-v2", deal.id,
    ),
    CLIENT_KEY: keyedDigest(
      config.analyticsPartitionSecret, "revenue-desk-analytics-client-v1", accountId,
    ),
    DEPLOYMENT_KEY: keyedDigest(
      config.analyticsPartitionSecret, "revenue-desk-analytics-deployment-v1", deploymentId,
    ),
    CONFIGURATION_VERSION: configurationVersion,
    // The common partition records the engagement that produced the evidence. The target
    // engagement remains a separate field so free-test conversion rows stay in free-test views.
    ENGAGEMENT_TYPE: "free_test",
    ENVIRONMENT: config.deploymentEnvironment,
    SOURCE_MODIFIED_AT: utcTimestamp(deal.Modified_Time, "CRM Modified_Time"),
    SOURCE_REVISION: config.sourceRevision,
    CRM_CONVERSION_STATUS: safeEnum(deal.Billing_Automation_Status, "CRM conversion status"),
    BILLING_CONVERSION_STATUS: safeEnum(deal.Subscription_Status, "Billing conversion status"),
    RESULTS_REVIEW_STATUS: safeEnum(deal.Test_Status, "Results review status"),
    PAID_ACCEPTANCE_STATUS: safeEnum(
      deal.Subscription_Acceptance_Status, "Paid acceptance status",
    ),
    TARGET_ENGAGEMENT_TYPE: "paid_service",
  };
  if (!REVISION.test(fact.SOURCE_REVISION)
    || fact.ENVIRONMENT !== "development"
    || Object.keys(fact).length !== FACT_FIELDS.length
    || !FACT_FIELDS.every((field) => Object.hasOwn(fact, field))
    || ![fact.RECORD_KEY, fact.CLIENT_KEY, fact.DEPLOYMENT_KEY].every((value) => HASH.test(value))) {
    fail("Conversion fact is outside the Analytics v2 contract");
  }
  return Object.freeze(fact);
}

function providerVersionKey(fact) {
  return sha256([
    "analytics-provider-version-v1", RECORD_TYPE, fact.ENVIRONMENT,
    fact.CLIENT_KEY, fact.DEPLOYMENT_KEY, fact.RECORD_KEY, fact.SOURCE_MODIFIED_AT,
  ].join("\0"));
}

function createOutboxRow(fact, createdAt) {
  const created = utcTimestamp(createdAt, "Analytics outbox creation time");
  const payloadJson = canonicalJson(fact);
  if (Buffer.byteLength(payloadJson, "utf8") > 9000) {
    fail("Conversion fact exceeds the bounded Analytics payload");
  }
  return Object.freeze({
    OUTBOX_KEY: sha256(`analytics-outbox-v2\0${RECORD_TYPE}\0${payloadJson}`),
    PROVIDER_VERSION_KEY: providerVersionKey(fact),
    ROW_SCHEMA_VERSION: 2,
    RECORD_TYPE,
    RECORD_KEY: fact.RECORD_KEY,
    CLIENT_KEY: fact.CLIENT_KEY,
    DEPLOYMENT_KEY: fact.DEPLOYMENT_KEY,
    CONFIGURATION_VERSION: fact.CONFIGURATION_VERSION,
    ENGAGEMENT_TYPE: fact.ENGAGEMENT_TYPE,
    ENVIRONMENT: fact.ENVIRONMENT,
    SOURCE_DATE_UTC: fact.SOURCE_MODIFIED_AT.slice(0, 10),
    PAYLOAD_JSON: payloadJson,
    PAYLOAD_HASH: sha256(payloadJson),
    METRIC_VERSION: fact.METRIC_VERSION,
    SOURCE_MODIFIED_AT: fact.SOURCE_MODIFIED_AT,
    SYNC_STATUS: "Pending",
    BATCH_KEY: null,
    ATTEMPT_COUNT: 0,
    CLAIM_COUNT: 0,
    POLL_COUNT: 0,
    NEXT_ATTEMPT_AT: created,
    LEASE_OWNER: null,
    LEASE_TOKEN: null,
    LEASE_EXPIRES_AT: null,
    FENCE_VERSION: 0,
    PROVIDER_JOB_ID: null,
    PROVIDER_STATE: null,
    EXPECTED_ROW_COUNT: null,
    ACCEPTED_ROW_COUNT: null,
    REJECTED_ROW_COUNT: null,
    READBACK_JOB_ID: null,
    READBACK_ROW_COUNT: null,
    READBACK_WATERMARK: null,
    LAST_ERROR_CODE: null,
    LAST_ATTEMPT_AT: null,
    SUBMITTED_AT: null,
    RECONCILED_AT: null,
    CREATED_AT: created,
    UPDATED_AT: created,
    SOURCE_REVISION: fact.SOURCE_REVISION,
  });
}

function unwrap(row, tableName) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return row[tableName] && typeof row[tableName] === "object" ? row[tableName] : row;
}

function samePrimitive(actual, expected) {
  if (typeof expected === "number") return Number(actual) === expected;
  if (typeof expected === "boolean") return String(actual).toLowerCase() === String(expected);
  return actual === expected;
}

function createAnalyticsOutboxStore(app, config) {
  if (typeof app?.datastore !== "function" || typeof app?.zcql !== "function") {
    fail("Catalyst Analytics outbox interfaces are unavailable", "configuration_invalid");
  }
  const table = app.datastore().table(config.analyticsOutboxTable);

  async function readByProviderVersionKey(key) {
    if (!HASH.test(key)) fail("Analytics provider-version key is invalid");
    let result;
    try {
      result = await withOperationTimeout(
        () => app.zcql().executeZCQLQuery(
          `SELECT * FROM ${config.analyticsOutboxTable} WHERE PROVIDER_VERSION_KEY = '${key}'`,
        ),
        config.platformOperationTimeoutMs,
      );
    } catch {
      fail("Analytics outbox readback failed");
    }
    if (!Array.isArray(result) || result.length > 1) {
      fail("Analytics provider version is not unique");
    }
    return result.length ? unwrap(result[0], config.analyticsOutboxTable) : null;
  }

  async function ensureConversionStatus(evidence, createdAt) {
    const fact = conversionStatusFact(config, evidence);
    const expected = createOutboxRow(fact, createdAt);
    let insertError = null;
    try {
      await withOperationTimeout(
        () => table.insertRow(expected), config.platformOperationTimeoutMs, { ambiguous: true },
      );
    } catch (error) {
      insertError = error;
    }
    const row = await readByProviderVersionKey(expected.PROVIDER_VERSION_KEY);
    if (!row) {
      fail(insertError ? "Analytics outbox insert outcome is unknown" : "Analytics outbox readback is missing");
    }
    if (!OUTBOX_IMMUTABLE.every((column) => samePrimitive(row[column], expected[column]))) {
      fail("Analytics provider version is bound to a conflicting payload");
    }
    return Object.freeze({ row, inserted: insertError === null });
  }

  return Object.freeze({ ensureConversionStatus, readByProviderVersionKey });
}

module.exports = Object.freeze({
  AnalyticsOutboxError,
  OUTBOX_IMMUTABLE,
  canonicalJson,
  conversionStatusFact,
  createAnalyticsOutboxStore,
  createOutboxRow,
  providerVersionKey,
  sha256,
});
