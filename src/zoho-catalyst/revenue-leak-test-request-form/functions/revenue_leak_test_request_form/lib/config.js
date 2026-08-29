"use strict";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

const FORBIDDEN_LEGACY_VARIABLES = Object.freeze([
  "CRM_API_BASE_URL",
  "CRM_READ_CONNECTION_LINK_NAME",
  "CRM_WRITE_CONNECTION_LINK_NAME",
  "FORM1_ENTRY_OFFER_VALUE",
  "FORM1_INTAKE_FORM_VERSION",
  "FORM1_LEAD_STATUS_VALUE",
  "FORM1_PUBLIC_URL",
  "FORM1_SOURCE_PAGE_VALUE",
  "FORM1_SUBMISSION_CHANNEL_VALUE",
  "FORM1_TOKEN_FIELD_ALIAS",
  "INBOUND_BODY_TIMEOUT_MS",
  "MAX_BODY_BYTES",
  "MAX_PREFILLS",
  "OUTBOUND_MAX_BYTES",
  "OUTBOUND_TIMEOUT_MS",
  "PLATFORM_OPERATION_TIMEOUT_MS",
  "SESSION_TABLE_NAME",
  "SESSION_TTL_SECONDS",
  "TOKEN_PEPPER",
]);

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

function validateProjectIdDigest(value) {
  if (!SHA256_HEX_PATTERN.test(value)) {
    throw new ConfigurationError(
      "EXPECTED_CATALYST_PROJECT_ID_SHA256 must be one lowercase SHA-256 digest",
    );
  }
  return value;
}

function rejectLegacyCapabilities(environment) {
  const present = FORBIDDEN_LEGACY_VARIABLES.filter((name) =>
    Object.prototype.hasOwnProperty.call(environment ?? {}, name));
  if (present.length > 0) {
    // Do not include private values in this configuration error. The variable
    // name is enough for an operator to remove the obsolete capability.
    throw new ConfigurationError(`Legacy Form 1 capability variable is forbidden: ${present[0]}`);
  }
}

function loadConfig(environment = process.env, artifactRevision) {
  const deploymentEnvironment = readRequired(environment, "DEPLOYMENT_ENVIRONMENT");
  const deploymentMode = readRequired(environment, "DEPLOYMENT_MODE");
  if (
    !(
      (deploymentEnvironment === "development" && deploymentMode === "contained") ||
      (deploymentEnvironment === "production" && deploymentMode === "dark")
    )
  ) {
    throw new ConfigurationError(
      "DEPLOYMENT_ENVIRONMENT and DEPLOYMENT_MODE must be development/contained or production/dark",
    );
  }

  const sourceRevision = validateRevision(readRequired(environment, "SOURCE_REVISION"));
  const stampedRevision = validateRevision(artifactRevision);
  if (sourceRevision !== stampedRevision) {
    throw new ConfigurationError("SOURCE_REVISION does not match the stamped function artifact");
  }

  // The previous artifact carried token, form, CRM, Connection, and Data Store
  // capabilities. Their presence would make a containment deployment
  // ambiguous, so the corrected artifact rejects them instead of ignoring
  // potentially live credentials. This check applies before the dark-mode
  // return so Production cannot retain a stale capability map silently.
  rejectLegacyCapabilities(environment);

  // Dark Production proves only that the reviewed artifact can be installed.
  // It intentionally loads no routes, secrets, project binding, or payload.
  if (deploymentMode === "dark") {
    return Object.freeze({
      darkMode: true,
      deploymentEnvironment,
      deploymentMode,
      sourceRevision,
    });
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

  const issueHeaderSecret = validateSecret(
    readRequired(environment, "ISSUE_HEADER_SECRET"),
    "ISSUE_HEADER_SECRET",
  );
  const prefillHeaderSecret = validateSecret(
    readRequired(environment, "PREFILL_HEADER_SECRET"),
    "PREFILL_HEADER_SECRET",
  );
  if (issueHeaderSecret === prefillHeaderSecret) {
    throw new ConfigurationError("Issue and prefill route secrets must be independently generated");
  }

  return Object.freeze({
    darkMode: false,
    deploymentEnvironment,
    deploymentMode,
    expectedCatalystProjectIdSha256: validateProjectIdDigest(
      readRequired(environment, "EXPECTED_CATALYST_PROJECT_ID_SHA256"),
    ),
    issueHeaderName,
    issueHeaderSecret,
    issuePath,
    prefillHeaderName,
    prefillHeaderSecret,
    prefillPath,
    sourceRevision,
  });
}

module.exports = {
  ConfigurationError,
  FORBIDDEN_LEGACY_VARIABLES,
  loadConfig,
};
