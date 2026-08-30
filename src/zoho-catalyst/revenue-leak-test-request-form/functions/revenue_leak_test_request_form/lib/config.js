"use strict";

const { validateOperatorHash, validateSecret } = require("./security");

const FORM1_SESSION_TABLE_NAME = "RevenueLeakTestRequestFormSessions";
const CRM_API_BASE_URL = "https://www.zohoapis.com/crm/v8";
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const NUMERIC_LIMITS = Object.freeze({
  SESSION_TTL_SECONDS: Object.freeze({ fallback: 1800, minimum: 300, maximum: 3600 }),
  MAX_BODY_BYTES: Object.freeze({ fallback: 32768, minimum: 1024, maximum: 262144 }),
  INBOUND_BODY_TIMEOUT_MS: Object.freeze({ fallback: 5000, minimum: 250, maximum: 15000 }),
  OUTBOUND_TIMEOUT_MS: Object.freeze({ fallback: 5000, minimum: 250, maximum: 15000 }),
  OUTBOUND_MAX_BYTES: Object.freeze({ fallback: 131072, minimum: 4096, maximum: 524288 }),
  PLATFORM_OPERATION_TIMEOUT_MS: Object.freeze({
    fallback: 5000,
    minimum: 250,
    maximum: 15000,
  }),
});

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigurationError";
    this.status = 503;
    this.publicCode = "configuration_invalid";
  }
}

function required(environment, name) {
  const value = environment?.[name];
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new ConfigurationError(`${name} is required without surrounding whitespace`);
  }
  return value;
}

function reviewedDefault(environment, name, fallback) {
  return environment?.[name] === undefined ? fallback : required(environment, name);
}

function boundedInteger(environment, name) {
  const limits = NUMERIC_LIMITS[name];
  const raw = environment?.[name];
  if (raw === undefined || raw === "") return limits.fallback;
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) {
    throw new ConfigurationError(`${name} must be a positive base-10 integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < limits.minimum || value > limits.maximum) {
    throw new ConfigurationError(`${name} is outside its approved range`);
  }
  return value;
}

function identifier(value, name, maximum = 100) {
  const pattern = new RegExp(`^[A-Za-z][A-Za-z0-9_]{0,${maximum - 1}}$`);
  if (!pattern.test(value)) throw new ConfigurationError(`${name} is invalid`);
  return value;
}

function pathValue(value, name) {
  if (!/^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,198}[A-Za-z0-9_-]$/.test(value) ||
      value.includes("//") || value.endsWith("/")) {
    throw new ConfigurationError(`${name} must be one exact non-root path`);
  }
  return value;
}

function headerName(value, name) {
  if (!/^x-[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value)) {
    throw new ConfigurationError(`${name} must be a lowercase x- custom header name`);
  }
  return value;
}

function revision(value) {
  if (!/^[a-f0-9]{40}$/.test(value)) {
    throw new ConfigurationError("SOURCE_REVISION must be a lowercase 40-character Git commit");
  }
  return value;
}

function sha256(value, name) {
  if (!SHA256_HEX_PATTERN.test(value)) {
    throw new ConfigurationError(`${name} must be one lowercase SHA-256 digest`);
  }
  return value;
}

function formUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError("FORM1_PUBLIC_URL must be one exact HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.search || url.hash || url.hostname !== "forms.zohopublic.com" ||
      url.pathname === "/" || url.pathname.includes("//")) {
    throw new ConfigurationError("FORM1_PUBLIC_URL must be the exact US Zoho Forms permalink");
  }
  return url.toString();
}

function boundedText(environment, name, maximum) {
  const value = required(environment, name);
  if ([...value].length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ConfigurationError(`${name} is invalid`);
  }
  return value;
}

function loadConfig(environment = process.env, artifactRevision) {
  const deploymentEnvironment = required(environment, "DEPLOYMENT_ENVIRONMENT");
  const deploymentMode = required(environment, "DEPLOYMENT_MODE");
  if (!((deploymentEnvironment === "development" && deploymentMode === "active") ||
        (deploymentEnvironment === "production" && deploymentMode === "dark"))) {
    throw new ConfigurationError(
      "DEPLOYMENT_ENVIRONMENT and DEPLOYMENT_MODE must be development/active or production/dark",
    );
  }
  const sourceRevision = revision(required(environment, "SOURCE_REVISION"));
  if (sourceRevision !== revision(artifactRevision)) {
    throw new ConfigurationError("SOURCE_REVISION does not match the stamped function artifact");
  }
  if (deploymentMode === "dark") {
    return Object.freeze({
      darkMode: true,
      deploymentEnvironment,
      deploymentMode,
      sourceRevision,
    });
  }

  const paths = {
    issue: pathValue(required(environment, "ISSUE_PATH"), "ISSUE_PATH"),
    prefill: pathValue(required(environment, "PREFILL_PATH"), "PREFILL_PATH"),
    submission: pathValue(required(environment, "SUBMISSION_PATH"), "SUBMISSION_PATH"),
  };
  if (new Set(Object.values(paths)).size !== 3) {
    throw new ConfigurationError("Form 1 route paths must be different");
  }
  const headers = {
    issue: headerName(required(environment, "ISSUE_HEADER_NAME"), "ISSUE_HEADER_NAME"),
    prefill: headerName(required(environment, "PREFILL_HEADER_NAME"), "PREFILL_HEADER_NAME"),
    submission: headerName(required(environment, "SUBMISSION_HEADER_NAME"), "SUBMISSION_HEADER_NAME"),
  };
  if (new Set(Object.values(headers)).size !== 3) {
    throw new ConfigurationError("Form 1 route header names must be different");
  }
  let secrets;
  try {
    secrets = {
      issue: validateSecret(required(environment, "ISSUE_HEADER_SECRET"), "ISSUE_HEADER_SECRET"),
      prefill: validateSecret(required(environment, "PREFILL_HEADER_SECRET"), "PREFILL_HEADER_SECRET"),
      submission: validateSecret(
        required(environment, "SUBMISSION_HEADER_SECRET"),
        "SUBMISSION_HEADER_SECRET",
      ),
      tokenPepper: validateSecret(required(environment, "TOKEN_PEPPER"), "TOKEN_PEPPER"),
    };
    validateOperatorHash(required(environment, "ISSUING_ACTOR_HASH"));
  } catch (error) {
    throw new ConfigurationError(error.message);
  }
  if (new Set(Object.values(secrets)).size !== 4) {
    throw new ConfigurationError("Form 1 route secrets and token pepper must be different");
  }
  const readConnection = identifier(
    required(environment, "CRM_READ_CONNECTION_LINK_NAME"),
    "CRM_READ_CONNECTION_LINK_NAME",
  );
  const writeConnection = identifier(
    required(environment, "CRM_WRITE_CONNECTION_LINK_NAME"),
    "CRM_WRITE_CONNECTION_LINK_NAME",
  );
  if (readConnection === writeConnection) {
    throw new ConfigurationError("CRM read and write Connections must be different");
  }
  const selectedTable = identifier(
    reviewedDefault(environment, "SESSION_TABLE_NAME", FORM1_SESSION_TABLE_NAME),
    "SESSION_TABLE_NAME",
    64,
  );
  if (selectedTable !== FORM1_SESSION_TABLE_NAME) {
    throw new ConfigurationError(`SESSION_TABLE_NAME must be ${FORM1_SESSION_TABLE_NAME}`);
  }
  if (reviewedDefault(environment, "CRM_API_BASE_URL", CRM_API_BASE_URL) !== CRM_API_BASE_URL) {
    throw new ConfigurationError("CRM_API_BASE_URL must be the exact reviewed Zoho CRM v8 base");
  }
  const tokenAlias = identifier(required(environment, "FORM1_TOKEN_FIELD_ALIAS"),
    "FORM1_TOKEN_FIELD_ALIAS", 64);
  return Object.freeze({
    assistedConstants: Object.freeze({
      entryOffer: boundedText(environment, "FORM1_ENTRY_OFFER_VALUE", 100),
      intakeFormVersion: boundedText(environment, "FORM1_INTAKE_FORM_VERSION", 30),
      leadStatus: boundedText(environment, "FORM1_LEAD_STATUS_VALUE", 100),
      sourcePage: boundedText(environment, "FORM1_SOURCE_PAGE_VALUE", 100),
      submissionChannel: boundedText(environment, "FORM1_SUBMISSION_CHANNEL_VALUE", 100),
    }),
    crmApiBaseUrl: CRM_API_BASE_URL,
    crmOrganizationHash: sha256(
      required(environment, "CRM_ORGANIZATION_ID_SHA256"),
      "CRM_ORGANIZATION_ID_SHA256",
    ),
    crmReadConnectionLinkName: readConnection,
    crmWriteConnectionLinkName: writeConnection,
    darkMode: false,
    deploymentEnvironment,
    deploymentMode,
    expectedCatalystProjectIdSha256: sha256(
      required(environment, "EXPECTED_CATALYST_PROJECT_ID_SHA256"),
      "EXPECTED_CATALYST_PROJECT_ID_SHA256",
    ),
    form1PublicUrl: formUrl(required(environment, "FORM1_PUBLIC_URL")),
    form1TokenFieldAlias: tokenAlias,
    inboundBodyTimeoutMs: boundedInteger(environment, "INBOUND_BODY_TIMEOUT_MS"),
    issueHeaderName: headers.issue,
    issueHeaderSecret: secrets.issue,
    issuePath: paths.issue,
    issuingActorHash: required(environment, "ISSUING_ACTOR_HASH"),
    maxBodyBytes: boundedInteger(environment, "MAX_BODY_BYTES"),
    outboundMaxBytes: boundedInteger(environment, "OUTBOUND_MAX_BYTES"),
    outboundTimeoutMs: boundedInteger(environment, "OUTBOUND_TIMEOUT_MS"),
    platformOperationTimeoutMs: boundedInteger(environment, "PLATFORM_OPERATION_TIMEOUT_MS"),
    prefillHeaderName: headers.prefill,
    prefillHeaderSecret: secrets.prefill,
    prefillPath: paths.prefill,
    sessionTableName: selectedTable,
    sessionTtlSeconds: boundedInteger(environment, "SESSION_TTL_SECONDS"),
    sourceRevision,
    submissionHeaderName: headers.submission,
    submissionHeaderSecret: secrets.submission,
    submissionPath: paths.submission,
    tokenPepper: secrets.tokenPepper,
  });
}

module.exports = {
  CRM_API_BASE_URL,
  ConfigurationError,
  FORM1_SESSION_TABLE_NAME,
  loadConfig,
};
