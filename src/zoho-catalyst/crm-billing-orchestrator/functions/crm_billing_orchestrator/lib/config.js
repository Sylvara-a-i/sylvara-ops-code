"use strict";

const { ARTIFACT_SOURCE_REVISION } = require("./source-revision");

const REVISION = /^[a-f0-9]{40}$/;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const PLAN_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

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

function requiredInteger(environment, name, minimum, maximum) {
  required(environment, name);
  return integer(environment, name, null, minimum, maximum);
}

function identifier(environment, name) {
  const result = required(environment, name);
  if (!IDENTIFIER.test(result)) throw new ConfigurationError(`${name} is invalid`);
  return result;
}

function planCode(environment, name) {
  const result = required(environment, name);
  if (!PLAN_CODE.test(result)) throw new ConfigurationError(`${name} is invalid`);
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
  if (entries.length < 1 || entries.length > 20) {
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
  return Object.freeze(result);
}

function loadConfig(environment = process.env, { artifactRevision = ARTIFACT_SOURCE_REVISION } = {}) {
  const deploymentEnvironment = required(environment, "DEPLOYMENT_ENVIRONMENT");
  if (deploymentEnvironment !== "development") {
    throw new ConfigurationError("Production activation is blocked in this source revision");
  }
  const sourceRevision = required(environment, "SOURCE_REVISION");
  if (!REVISION.test(sourceRevision) || !REVISION.test(artifactRevision) || sourceRevision !== artifactRevision) {
    throw new ConfigurationError("SOURCE_REVISION does not match the immutable artifact");
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
  return Object.freeze({
    deploymentEnvironment,
    sourceRevision,
    allowedPath: exactPath(environment),
    sharedHeaderName: headerName,
    sharedHeaderValue: secret(environment, "SHARED_HEADER_VALUE"),
    crmApiBaseUrl: apiBase(environment, "CRM_API_BASE_URL", "/crm/v8"),
    billingApiBaseUrl: apiBase(environment, "BILLING_API_BASE_URL", "/billing/v1"),
    billingOrganizationId: organizationId,
    crmReadConnectionLinkName: identifier(environment, "CRM_READ_CONNECTION_LINK_NAME"),
    crmWriteConnectionLinkName: identifier(environment, "CRM_WRITE_CONNECTION_LINK_NAME"),
    billingReadConnectionLinkName: identifier(environment, "BILLING_READ_CONNECTION_LINK_NAME"),
    billingWriteConnectionLinkName: identifier(environment, "BILLING_WRITE_CONNECTION_LINK_NAME"),
    operationTable: identifier(environment, "OPERATION_TABLE"),
    duplicateErrorCodes: duplicateCodes(environment),
    idempotencyPepper: secret(environment, "IDEMPOTENCY_PEPPER"),
    evaluationPlanCode: planCode(environment, "EVALUATION_PLAN_CODE"),
    paidPlanCodeMap: paidPlanMap(environment),
    paidAcceptanceValue: boundedText(environment, "PAID_ACCEPTANCE_VALUE"),
    freeTestEntryOfferValue: boundedText(environment, "FREE_TEST_ENTRY_OFFER_VALUE"),
    initialSaleTypeValue: boundedText(environment, "INITIAL_SALE_TYPE_VALUE"),
    testLiveStageValue: boundedText(environment, "TEST_LIVE_STAGE_VALUE"),
    resultsReviewStageValue: boundedText(environment, "RESULTS_REVIEW_STAGE_VALUE"),
    subscriptionProposedStageValue: boundedText(environment, "SUBSCRIPTION_PROPOSED_STAGE_VALUE"),
    closedLostStageValue: boundedText(environment, "CLOSED_LOST_STAGE_VALUE"),
    goLiveApprovedValue: boundedText(environment, "GO_LIVE_APPROVED_VALUE"),
    testCompletedStatusValue: boundedText(environment, "TEST_COMPLETED_STATUS_VALUE"),
    paidReadyStatusValue: boundedText(environment, "PAID_READY_STATUS_VALUE"),
    freeTestDurationDays: requiredInteger(environment, "FREE_TEST_DURATION_DAYS", 1, 30),
    freeTestCallLimit: requiredInteger(environment, "FREE_TEST_CALL_LIMIT", 1, 1000),
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

module.exports = { ConfigurationError, REVISION, loadConfig };
