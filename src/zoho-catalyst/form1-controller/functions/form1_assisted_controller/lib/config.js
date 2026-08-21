"use strict";

const {
  isApprovedCrmApiHostname,
  isApprovedFormsPublicHostname,
} = require("./destinations");

const NUMERIC_LIMITS = Object.freeze({
  SESSION_TTL_SECONDS: Object.freeze({ fallback: 900, minimum: 300, maximum: 3600 }),
  MAX_PREFILLS: Object.freeze({ fallback: 20, minimum: 2, maximum: 100 }),
  MAX_BODY_BYTES: Object.freeze({ fallback: 4096, minimum: 512, maximum: 32768 }),
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

function readRequired(environment, name) {
  const value = environment?.[name];
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new ConfigurationError(`${name} is required without surrounding whitespace`);
  }
  return value;
}

function readBoundedText(environment, name, maximum = 200) {
  const value = readRequired(environment, name);
  if (
    [...value].length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ) {
    throw new ConfigurationError(`${name} is outside its approved text boundary`);
  }
  return value;
}

function readBoundedInteger(environment, name) {
  const limit = NUMERIC_LIMITS[name];
  const raw = environment?.[name];
  if (raw === undefined || raw === "") return limit.fallback;
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) {
    throw new ConfigurationError(`${name} must be a positive base-10 integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < limit.minimum || value > limit.maximum) {
    throw new ConfigurationError(`${name} is outside its approved range`);
  }
  return value;
}

function validateIdentifier(value, name, maximum = 64) {
  const pattern = new RegExp(`^[A-Za-z][A-Za-z0-9_]{0,${maximum - 1}}$`);
  if (!pattern.test(value)) {
    throw new ConfigurationError(`${name} is not a safe Catalyst identifier`);
  }
  return value;
}

function validatePath(value, name) {
  if (
    !/^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,198}[A-Za-z0-9_-]$/.test(value) ||
    value.includes("//") ||
    value.endsWith("/")
  ) {
    throw new ConfigurationError(`${name} must be one exact non-root path`);
  }
  return value;
}

function validateHeaderName(value, name) {
  if (!/^x-[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value)) {
    throw new ConfigurationError(`${name} must be a lowercase x- custom header name`);
  }
  return value;
}

function validateSecret(value, name) {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < 32 || bytes > 256 || !/^[\x21-\x7e]+$/.test(value)) {
    throw new ConfigurationError(`${name} must be 32-256 printable ASCII bytes`);
  }
  return value;
}

function validateRevision(value) {
  if (!/^[a-f0-9]{40}$/.test(value)) {
    throw new ConfigurationError("SOURCE_REVISION must be a lowercase 40-character Git commit");
  }
  return value;
}

function parseHttpsUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError(`${name} must be an absolute HTTPS URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.hostname !== url.hostname.toLowerCase()
  ) {
    throw new ConfigurationError(`${name} must use one exact HTTPS host and path`);
  }
  return url;
}

function validateFormUrl(value) {
  const url = parseHttpsUrl(value, "FORM1_PUBLIC_URL");
  if (
    !isApprovedFormsPublicHostname(url.hostname) ||
    url.pathname === "/" ||
    url.pathname.includes("//")
  ) {
    throw new ConfigurationError("FORM1_PUBLIC_URL is not the approved US Zoho Forms permalink");
  }
  return url.toString();
}

function validateCrmBase(value) {
  const url = parseHttpsUrl(value, "CRM_API_BASE_URL");
  if (!isApprovedCrmApiHostname(url.hostname) || url.pathname !== "/crm/v8") {
    throw new ConfigurationError("CRM_API_BASE_URL is not the approved US Zoho CRM V8 base");
  }
  return `${url.origin}${url.pathname}`;
}

function loadConfig(environment = process.env, artifactRevision) {
  const deploymentEnvironment = readRequired(environment, "DEPLOYMENT_ENVIRONMENT");
  // Production activation requires separate acceptance evidence and a reviewed
  // source change. An environment variable alone cannot lift this gate.
  if (deploymentEnvironment !== "development") {
    throw new ConfigurationError("DEPLOYMENT_ENVIRONMENT must be development");
  }

  const issuePath = validatePath(readRequired(environment, "ISSUE_PATH"), "ISSUE_PATH");
  const prefillPath = validatePath(readRequired(environment, "PREFILL_PATH"), "PREFILL_PATH");
  if (issuePath === prefillPath) {
    throw new ConfigurationError("ISSUE_PATH and PREFILL_PATH must be different");
  }

  const issueHeaderName = validateHeaderName(
    readRequired(environment, "ISSUE_HEADER_NAME"),
    "ISSUE_HEADER_NAME",
  );
  const prefillHeaderName = validateHeaderName(
    readRequired(environment, "PREFILL_HEADER_NAME"),
    "PREFILL_HEADER_NAME",
  );
  if (issueHeaderName === prefillHeaderName) {
    throw new ConfigurationError("Issue and prefill header names must be different");
  }

  const tokenPepper = validateSecret(readRequired(environment, "TOKEN_PEPPER"), "TOKEN_PEPPER");
  const issueHeaderSecret = validateSecret(
    readRequired(environment, "ISSUE_HEADER_SECRET"),
    "ISSUE_HEADER_SECRET",
  );
  const prefillHeaderSecret = validateSecret(
    readRequired(environment, "PREFILL_HEADER_SECRET"),
    "PREFILL_HEADER_SECRET",
  );
  if (new Set([tokenPepper, issueHeaderSecret, prefillHeaderSecret]).size !== 3) {
    throw new ConfigurationError("Token pepper and route secrets must be independently generated");
  }

  const form1TokenFieldAlias = readRequired(environment, "FORM1_TOKEN_FIELD_ALIAS");
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(form1TokenFieldAlias)) {
    throw new ConfigurationError("FORM1_TOKEN_FIELD_ALIAS is invalid");
  }

  const crmReadConnectionLinkName = validateIdentifier(
    readRequired(environment, "CRM_READ_CONNECTION_LINK_NAME"),
    "CRM_READ_CONNECTION_LINK_NAME",
    100,
  );
  const crmWriteConnectionLinkName = validateIdentifier(
    readRequired(environment, "CRM_WRITE_CONNECTION_LINK_NAME"),
    "CRM_WRITE_CONNECTION_LINK_NAME",
    100,
  );
  if (crmReadConnectionLinkName === crmWriteConnectionLinkName) {
    throw new ConfigurationError("CRM read and update Connections must use different link names");
  }
  const sourceRevision = validateRevision(readRequired(environment, "SOURCE_REVISION"));
  const stampedRevision = validateRevision(artifactRevision);
  if (sourceRevision !== stampedRevision) {
    throw new ConfigurationError("SOURCE_REVISION does not match the stamped function artifact");
  }

  return Object.freeze({
    assistedConstants: Object.freeze({
      assistedBy: readBoundedText(environment, "FORM1_ASSISTED_BY_VALUE", 100),
      entryOffer: readBoundedText(environment, "FORM1_ENTRY_OFFER_VALUE", 100),
      intakeFormVersion: readBoundedText(environment, "FORM1_INTAKE_FORM_VERSION", 30),
      leadSource: readBoundedText(environment, "FORM1_LEAD_SOURCE_VALUE", 100),
      leadStatus: readBoundedText(environment, "FORM1_LEAD_STATUS_VALUE", 100),
      sourcePage: readBoundedText(environment, "FORM1_SOURCE_PAGE_VALUE", 100),
      submissionChannel: readBoundedText(
        environment,
        "FORM1_SUBMISSION_CHANNEL_VALUE",
        100,
      ),
    }),
    crmApiBaseUrl: validateCrmBase(readRequired(environment, "CRM_API_BASE_URL")),
    crmReadConnectionLinkName,
    crmWriteConnectionLinkName,
    deploymentEnvironment,
    form1PublicUrl: validateFormUrl(readRequired(environment, "FORM1_PUBLIC_URL")),
    form1TokenFieldAlias,
    inboundBodyTimeoutMs: readBoundedInteger(environment, "INBOUND_BODY_TIMEOUT_MS"),
    issueHeaderName,
    issueHeaderSecret,
    issuePath,
    maxBodyBytes: readBoundedInteger(environment, "MAX_BODY_BYTES"),
    maxPrefills: readBoundedInteger(environment, "MAX_PREFILLS"),
    outboundMaxBytes: readBoundedInteger(environment, "OUTBOUND_MAX_BYTES"),
    outboundTimeoutMs: readBoundedInteger(environment, "OUTBOUND_TIMEOUT_MS"),
    platformOperationTimeoutMs: readBoundedInteger(
      environment,
      "PLATFORM_OPERATION_TIMEOUT_MS",
    ),
    prefillHeaderName,
    prefillHeaderSecret,
    prefillPath,
    sessionTableName: validateIdentifier(
      readRequired(environment, "SESSION_TABLE_NAME"),
      "SESSION_TABLE_NAME",
    ),
    sessionTtlSeconds: readBoundedInteger(environment, "SESSION_TTL_SECONDS"),
    sourceRevision,
    tokenPepper,
  });
}

module.exports = { ConfigurationError, loadConfig };
