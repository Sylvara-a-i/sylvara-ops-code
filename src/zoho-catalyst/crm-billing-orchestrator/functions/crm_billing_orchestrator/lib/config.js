"use strict";

const {
  ARTIFACT_DEVELOPMENT_ZAID_HMAC_SHA256,
  ARTIFACT_SOURCE_REVISION,
} = require("./source-revision");
const {
  PLAN_FREQUENCY_KEYS,
  parsePaidCommercialTerms,
} = require("./commercial-terms");

const REVISION = /^[a-f0-9]{40}$/;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const PLAN_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const CUSTOMER_PROVISIONING_MODES = new Set(["test_direct_customer"]);
const OPERATION_TABLE_NAME = "CRMBillingOperations";
const ANALYTICS_OUTBOX_TABLE_NAME = "AnalyticsSyncOutbox";

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigurationError";
    this.publicCode = "configuration_invalid";
    this.status = 503;
  }
}

function value(environment, name) {
  return String(environment[name] ?? "").trim();
}

function required(environment, name) {
  const result = value(environment, name);
  if (!result) throw new ConfigurationError(`${name} is required`);
  return result;
}

function boundedText(environment, name, maximum = 160) {
  const result = required(environment, name);
  if (result.length > maximum || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new ConfigurationError(`${name} is invalid`);
  }
  return result;
}

function integer(environment, name, fallback, minimum, maximum) {
  const raw = value(environment, name);
  if (!raw) return fallback;
  if (!/^[0-9]+$/.test(raw)) throw new ConfigurationError(`${name} must be an integer`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigurationError(`${name} is outside the approved range`);
  }
  return parsed;
}

function requiredBoolean(environment, name) {
  const result = required(environment, name);
  if (!new Set(["true", "false"]).has(result)) {
    throw new ConfigurationError(`${name} must be true or false`);
  }
  return result === "true";
}

function customerProvisioningMode(environment) {
  const result = required(environment, "CUSTOMER_PROVISIONING_MODE");
  if (!CUSTOMER_PROVISIONING_MODES.has(result)) {
    throw new ConfigurationError("CUSTOMER_PROVISIONING_MODE is invalid");
  }
  return result;
}

function identifier(environment, name) {
  const result = required(environment, name);
  if (!IDENTIFIER.test(result)) throw new ConfigurationError(`${name} is invalid`);
  return result;
}

function operationTable(environment) {
  const selected = identifier(environment, "OPERATION_TABLE");
  if (selected !== OPERATION_TABLE_NAME) {
    throw new ConfigurationError(
      `OPERATION_TABLE must be the canonical ${OPERATION_TABLE_NAME} table`,
    );
  }
  return selected;
}

function analyticsOutboxTable(environment) {
  const selected = identifier(environment, "ANALYTICS_OUTBOX_TABLE");
  if (selected !== ANALYTICS_OUTBOX_TABLE_NAME) {
    throw new ConfigurationError(
      `ANALYTICS_OUTBOX_TABLE must be the canonical ${ANALYTICS_OUTBOX_TABLE_NAME} table`,
    );
  }
  return selected;
}

function planCode(environment, name) {
  const result = required(environment, name);
  if (!PLAN_CODE.test(result)) throw new ConfigurationError(`${name} is invalid`);
  return result;
}

function billingRecordId(environment, name) {
  const result = required(environment, name);
  if (!/^[1-9][0-9]{7,29}$/.test(result)) {
    throw new ConfigurationError(`${name} is invalid`);
  }
  return result;
}

function apiBase(environment, name, pathname) {
  let parsed;
  try {
    parsed = new URL(required(environment, name));
  } catch {
    throw new ConfigurationError(`${name} is invalid`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "www.zohoapis.com" ||
    parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash ||
    parsed.pathname !== pathname
  ) throw new ConfigurationError(`${name} is outside the approved US API boundary`);
  return `${parsed.origin}${parsed.pathname}`;
}

function exactPath(environment) {
  const result = required(environment, "ALLOWED_PATH");
  if (
    !/^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,159}$/.test(result) ||
    result.includes("//") || result.endsWith("/")
  ) throw new ConfigurationError("ALLOWED_PATH is invalid");
  return result;
}

function developmentFunctionHost(environment) {
  const result = required(environment, "DEVELOPMENT_FUNCTION_HOST").toLowerCase();
  if (
    result.length > 253 ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.development\.catalystserverless\.com$/.test(result)
  ) throw new ConfigurationError("DEVELOPMENT_FUNCTION_HOST is invalid");
  return result;
}

function secret(environment, name) {
  const result = required(environment, name);
  if (Buffer.byteLength(result, "utf8") < 32 || Buffer.byteLength(result, "utf8") > 256) {
    throw new ConfigurationError(`${name} has an invalid length`);
  }
  return result;
}

function duplicateCodes(environment) {
  const entries = required(environment, "DATASTORE_DUPLICATE_ERROR_CODES")
    .split(",").map((entry) => entry.trim());
  if (
    entries.length < 1 || entries.length > 10 ||
    entries.some((entry) => !/^[A-Za-z0-9_.-]{1,80}$/.test(entry)) ||
    new Set(entries).size !== entries.length
  ) throw new ConfigurationError("DATASTORE_DUPLICATE_ERROR_CODES is invalid");
  return Object.freeze(entries);
}

function paidPlanMap(environment) {
  let parsed;
  try {
    parsed = JSON.parse(required(environment, "PAID_PLAN_CODE_MAP"));
  } catch {
    throw new ConfigurationError("PAID_PLAN_CODE_MAP must be JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigurationError("PAID_PLAN_CODE_MAP must be an object");
  }
  const entries = Object.entries(parsed);
  const expectedKeys = [...PLAN_FREQUENCY_KEYS].sort();
  if (JSON.stringify(entries.map(([key]) => key).sort()) !== JSON.stringify(expectedKeys)) {
    throw new ConfigurationError("PAID_PLAN_CODE_MAP has an invalid size");
  }
  const result = Object.create(null);
  for (const [crmValue, code] of entries) {
    const dimensions = crmValue.split("::");
    if (
      dimensions.length !== 2 || dimensions.some((dimension) => !dimension || dimension.length > 120) ||
      crmValue.length > 241 || /[\u0000-\u001f\u007f]/.test(crmValue) ||
      typeof code !== "string" || !PLAN_CODE.test(code)
    ) throw new ConfigurationError("PAID_PLAN_CODE_MAP contains an invalid mapping");
    result[crmValue] = code;
  }
  if (new Set(Object.values(result)).size !== Object.values(result).length) {
    throw new ConfigurationError("PAID_PLAN_CODE_MAP plan codes must be unique");
  }
  return Object.freeze(result);
}

function paidSubscriptionStatusMap(environment) {
  let parsed;
  try {
    parsed = JSON.parse(required(environment, "PAID_SUBSCRIPTION_STATUS_MAP"));
  } catch {
    throw new ConfigurationError("PAID_SUBSCRIPTION_STATUS_MAP must be JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigurationError("PAID_SUBSCRIPTION_STATUS_MAP must be an object");
  }
  const entries = Object.entries(parsed);
  const expectedKeys = ["future", "live"];
  if (
    JSON.stringify(entries.map(([key]) => key).sort()) !== JSON.stringify(expectedKeys) ||
    entries.some(([, value]) => (
      typeof value !== "string" || !value || value.length > 120 ||
      /[\u0000-\u001f\u007f]/.test(value)
    )) ||
    new Set(entries.map(([, value]) => value)).size !== entries.length
  ) throw new ConfigurationError("PAID_SUBSCRIPTION_STATUS_MAP is invalid");
  return Object.freeze(Object.fromEntries(entries));
}

function loadConfig(environment = process.env, {
  artifactRevision = ARTIFACT_SOURCE_REVISION,
  artifactDevelopmentZaidHmacSha256 = ARTIFACT_DEVELOPMENT_ZAID_HMAC_SHA256,
} = {}) {
  const deploymentEnvironment = required(environment, "DEPLOYMENT_ENVIRONMENT");
  const deploymentMode = required(environment, "DEPLOYMENT_MODE");
  if (
    !(
      (deploymentEnvironment === "development" && deploymentMode === "active") ||
      (deploymentEnvironment === "production" && deploymentMode === "dark")
    )
  ) {
    throw new ConfigurationError(
      "DEPLOYMENT_ENVIRONMENT and DEPLOYMENT_MODE must be development/active or production/dark",
    );
  }
  const sourceRevision = required(environment, "SOURCE_REVISION");
  if (!REVISION.test(sourceRevision) || !REVISION.test(artifactRevision) || sourceRevision !== artifactRevision) {
    throw new ConfigurationError("SOURCE_REVISION does not match the immutable artifact");
  }
  // Dark Production is installation evidence only. It loads no route, credential,
  // organization, catalog, Connection, operation table, or mutation capability.
  if (deploymentMode === "dark") {
    return Object.freeze({
      darkMode: true,
      deploymentEnvironment,
      deploymentMode,
      sourceRevision,
    });
  }
  const headerName = required(environment, "SHARED_HEADER_NAME").toLowerCase();
  if (
    !/^x-[a-z0-9][a-z0-9-]{2,61}$/.test(headerName) ||
    new Set(["x-zc-environment", "x-com-zoho-subscriptions-organizationid"]).has(headerName)
  ) throw new ConfigurationError("SHARED_HEADER_NAME is invalid or reserved");
  const organizationId = required(environment, "BILLING_ORGANIZATION_ID");
  if (!/^[1-9][0-9]{7,29}$/.test(organizationId)) {
    throw new ConfigurationError("BILLING_ORGANIZATION_ID is invalid");
  }
  const enablePaidSubscriptionPreparation = requiredBoolean(
    environment,
    "ENABLE_PAID_SUBSCRIPTION_PREPARATION",
  );
  const selectedCustomerProvisioningMode = customerProvisioningMode(environment);
  const enableTestDirectCustomerProvisioning = requiredBoolean(
    environment,
    "ENABLE_TEST_DIRECT_CUSTOMER_PROVISIONING",
  );
  if (!enableTestDirectCustomerProvisioning) {
    throw new ConfigurationError(
      "Paid conversion requires the exact Development TEST customer gate",
    );
  }
  let paidCommercialTerms;
  try {
    paidCommercialTerms = parsePaidCommercialTerms(required(
      environment,
      "PAID_COMMERCIAL_TERMS_JSON",
    ));
  } catch {
    throw new ConfigurationError("PAID_COMMERCIAL_TERMS_JSON is invalid");
  }
  const idempotencyPepper = secret(environment, "IDEMPOTENCY_PEPPER");
  const analyticsPartitionSecret = secret(environment, "ANALYTICS_PARTITION_HMAC_SECRET");
  const sharedHeaderValue = secret(environment, "SHARED_HEADER_VALUE");
  const reportSummaryHeaderValue = secret(environment, "REPORT_SUMMARY_HEADER_VALUE");
  if (analyticsPartitionSecret === idempotencyPepper) {
    throw new ConfigurationError("Analytics partition and operation identity secrets must differ");
  }
  if (sharedHeaderValue === reportSummaryHeaderValue) {
    throw new ConfigurationError("Paid and report-summary caller secrets must differ");
  }
  return Object.freeze({
    darkMode: false,
    deploymentEnvironment,
    deploymentMode,
    sourceRevision,
    artifactDevelopmentZaidHmacSha256,
    developmentFunctionHost: developmentFunctionHost(environment),
    developmentRuntimeProof: secret(environment, "DEVELOPMENT_RUNTIME_PROOF"),
    allowedPath: exactPath(environment),
    sharedHeaderName: headerName,
    sharedHeaderValue,
    reportSummaryHeaderValue,
    crmApiBaseUrl: apiBase(environment, "CRM_API_BASE_URL", "/crm/v8"),
    billingApiBaseUrl: apiBase(environment, "BILLING_API_BASE_URL", "/billing/v1"),
    billingOrganizationId: organizationId,
    customerProvisioningMode: selectedCustomerProvisioningMode,
    enableTestDirectCustomerProvisioning,
    crmReadConnectionLinkName: identifier(environment, "CRM_READ_CONNECTION_LINK_NAME"),
    crmWriteConnectionLinkName: identifier(environment, "CRM_WRITE_CONNECTION_LINK_NAME"),
    billingReadConnectionLinkName: identifier(environment, "BILLING_READ_CONNECTION_LINK_NAME"),
    billingWriteConnectionLinkName: identifier(environment, "BILLING_WRITE_CONNECTION_LINK_NAME"),
    operationTable: operationTable(environment),
    analyticsOutboxTable: analyticsOutboxTable(environment),
    duplicateErrorCodes: duplicateCodes(environment),
    idempotencyPepper,
    analyticsPartitionSecret,
    enablePaidSubscriptionPreparation,
    paidCommercialTerms,
    paidPlanCodeMap: paidPlanMap(environment),
    paidUsageAddonCode: planCode(environment, "PAID_USAGE_ADDON_CODE"),
    paidUsageAddonUnit: boundedText(environment, "PAID_USAGE_ADDON_UNIT", 100),
    paidUsageAddonProductId: billingRecordId(environment, "PAID_USAGE_ADDON_PRODUCT_ID"),
    paidSubscriptionStatusMap: paidSubscriptionStatusMap(environment),
    paidAcceptanceValue: boundedText(environment, "PAID_ACCEPTANCE_VALUE"),
    revenueDeskPipelineValue: boundedText(environment, "REVENUE_DESK_PIPELINE_VALUE"),
    freeTestEntryOfferValue: boundedText(environment, "FREE_TEST_ENTRY_OFFER_VALUE"),
    initialSaleTypeValue: boundedText(environment, "INITIAL_SALE_TYPE_VALUE"),
    subscriptionProposedStageValue: boundedText(environment, "SUBSCRIPTION_PROPOSED_STAGE_VALUE"),
    closedWonStageValue: boundedText(environment, "CLOSED_WON_STAGE_VALUE"),
    testCompletedStatusValue: boundedText(environment, "TEST_COMPLETED_STATUS_VALUE"),
    maxBodyBytes: integer(environment, "MAX_BODY_BYTES", 2048, 256, 8192),
    outboundTimeoutMs: integer(environment, "OUTBOUND_TIMEOUT_MS", 5000, 250, 10000),
    outboundMaxBytes: integer(environment, "OUTBOUND_MAX_BYTES", 262144, 4096, 524288),
    platformOperationTimeoutMs: integer(
      environment,
      "PLATFORM_OPERATION_TIMEOUT_MS",
      3000,
      250,
      5000,
    ),
  });
}

module.exports = {
  ANALYTICS_OUTBOX_TABLE_NAME, ConfigurationError, OPERATION_TABLE_NAME, REVISION, loadConfig,
};
