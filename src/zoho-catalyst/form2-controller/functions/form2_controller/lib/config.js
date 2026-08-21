"use strict";

const { brotliDecompressSync } = require("node:zlib");

const {
  isApprovedCrmApiHostname,
  isApprovedFormsPublicHostname,
} = require("./destinations");
const { ARTIFACT_SOURCE_REVISION } = require("./source-revision");

const PRIVATE_CHOICE_LIMITS = Object.freeze({
  // Covers the reviewed 207-choice provider catalog plus bounded growth. Any
  // increase beyond 256 requires a source change and contract review.
  phoneSystemProviders: 256,
  fieldTeamSizeBands: 20,
});

const SESSION_STATUSES = Object.freeze([
  "issuing",
  "issued",
  "verified",
  "submitting",
  "submitted",
  "expired",
  "revoked",
  "failed",
  "reconciliation_required",
]);
const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40}$/;
const COMPRESSED_CHOICE_PREFIX = "br:";
const MAX_COMPRESSED_CHOICE_CHARS = 4096;
const MAX_DECOMPRESSED_CHOICE_BYTES = 32768;

const NUMERIC_LIMITS = Object.freeze({
  SESSION_TTL_SECONDS: Object.freeze({ fallback: 3600, minimum: 300, maximum: 86400 }),
  // Two attempts preserve one bounded retry if prefill persistence fails after
  // the first successful verification transition.
  MAX_VERIFICATION_ATTEMPTS: Object.freeze({ fallback: 3, minimum: 2, maximum: 10 }),
  MAX_SUBMISSION_ATTEMPTS: Object.freeze({ fallback: 3, minimum: 1, maximum: 10 }),
  MAX_BODY_BYTES: Object.freeze({ fallback: 32768, minimum: 1024, maximum: 262144 }),
  INBOUND_BODY_TIMEOUT_MS: Object.freeze({ fallback: 5000, minimum: 250, maximum: 15000 }),
  OUTBOUND_TIMEOUT_MS: Object.freeze({ fallback: 5000, minimum: 250, maximum: 15000 }),
  OUTBOUND_MAX_BYTES: Object.freeze({ fallback: 131072, minimum: 1024, maximum: 524288 }),
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
    this.publicCode = "configuration_invalid";
  }
}

function readRequired(environment, name) {
  const raw = environment[name];
  if (typeof raw !== "string" || raw.length === 0) {
    throw new ConfigurationError(`${name} is required`);
  }
  if (raw !== raw.trim()) {
    throw new ConfigurationError(`${name} may not contain surrounding whitespace`);
  }
  return raw;
}

function parseBoundedInteger(environment, name) {
  const limits = NUMERIC_LIMITS[name];
  const raw = environment[name];
  if (raw === undefined || raw === "") return limits.fallback;
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) {
    throw new ConfigurationError(`${name} must be a positive base-10 integer`);
  }
  const parsed = Number(raw);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < limits.minimum ||
    parsed > limits.maximum
  ) {
    throw new ConfigurationError(`${name} is outside its approved range`);
  }
  return parsed;
}

function validateIdentifier(value, name) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)) {
    throw new ConfigurationError(`${name} must be a safe platform identifier`);
  }
  return value;
}

function validateConnectionLinkName(value, name) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(value)) {
    throw new ConfigurationError(`${name} must be a safe Catalyst Connection link name`);
  }
  return value;
}

function validatePath(value, name) {
  if (
    !/^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,198}[A-Za-z0-9_-]$/.test(value) ||
    value.includes("//") ||
    value.endsWith("/")
  ) {
    throw new ConfigurationError(`${name} must be one exact non-root route path`);
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
  const length = Buffer.byteLength(value, "utf8");
  if (length < 32 || length > 256 || !/^[\x21-\x7e]+$/.test(value)) {
    throw new ConfigurationError(`${name} must be 32-256 printable ASCII bytes`);
  }
  return value;
}

function parseHttpsUrl(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationError(`${name} must be an absolute HTTPS URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    parsed.hostname !== parsed.hostname.toLowerCase() ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(parsed.hostname)
  ) {
    throw new ConfigurationError(`${name} must use one exact HTTPS host and path`);
  }
  return parsed;
}

function validatePublicFormUrl(value) {
  const parsed = parseHttpsUrl(value, "FORM2_PUBLIC_URL");
  if (
    !isApprovedFormsPublicHostname(parsed.hostname) ||
    parsed.pathname === "/" ||
    parsed.pathname.includes("//")
  ) {
    throw new ConfigurationError(
      "FORM2_PUBLIC_URL must use the exact approved US Zoho Forms host and form path",
    );
  }
  return value;
}

function validateCrmApiBaseUrl(value) {
  const parsed = parseHttpsUrl(value, "CRM_API_BASE_URL");
  if (
    !isApprovedCrmApiHostname(parsed.hostname) ||
    parsed.pathname !== "/crm/v8"
  ) {
    throw new ConfigurationError(
      "CRM_API_BASE_URL must be the exact approved US Zoho CRM V8 base URL",
    );
  }
  return value;
}

function validateRevision(value, name) {
  if (!SOURCE_REVISION_PATTERN.test(value)) {
    throw new ConfigurationError(
      `${name} must be a lowercase 40-character Git commit`,
    );
  }
  return value;
}

function validateFormVersion(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(value)) {
    throw new ConfigurationError("FORM2_FORM_VERSION has an invalid format");
  }
  return value;
}

function validateBoundedBusinessValue(value, name) {
  if (
    [...value].length > 120 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new ConfigurationError(`${name} is invalid`);
  }
  return value;
}

function readPrivateChoicePayload(environment, name, { allowCompressed = false } = {}) {
  const raw = readRequired(environment, name);
  if (!raw.startsWith(COMPRESSED_CHOICE_PREFIX)) return raw;
  if (!allowCompressed) {
    throw new ConfigurationError(`${name} may not use compressed encoding`);
  }

  const encoded = raw.slice(COMPRESSED_CHOICE_PREFIX.length);
  if (
    encoded.length < 1 ||
    encoded.length > MAX_COMPRESSED_CHOICE_CHARS ||
    !/^[A-Za-z0-9_-]+$/.test(encoded)
  ) {
    throw new ConfigurationError(`${name} has invalid compressed encoding`);
  }

  const compressed = Buffer.from(encoded, "base64url");
  if (
    compressed.length < 1 ||
    compressed.toString("base64url") !== encoded
  ) {
    throw new ConfigurationError(`${name} has non-canonical compressed encoding`);
  }

  let decoded;
  try {
    decoded = brotliDecompressSync(compressed, {
      maxOutputLength: MAX_DECOMPRESSED_CHOICE_BYTES,
    });
  } catch {
    throw new ConfigurationError(`${name} compressed payload is invalid or too large`);
  }

  const text = decoded.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(decoded)) {
    throw new ConfigurationError(`${name} compressed payload must be UTF-8 text`);
  }
  return text;
}

function parsePrivateChoiceList(
  environment,
  name,
  maximumChoices,
  { allowCompressed = false } = {},
) {
  if (!Number.isSafeInteger(maximumChoices) || maximumChoices < 1) {
    throw new ConfigurationError(`${name} choice limit is invalid`);
  }
  const raw = readPrivateChoicePayload(environment, name, { allowCompressed });
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigurationError(`${name} must be a JSON array`);
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > maximumChoices) {
    throw new ConfigurationError(`${name} must contain 1-${maximumChoices} choices`);
  }
  const choices = parsed.map((entry) => {
    if (typeof entry !== "string" || !entry || entry !== entry.trim()) {
      throw new ConfigurationError(`${name} contains an invalid choice`);
    }
    return validateBoundedBusinessValue(entry, name);
  });
  assertUnique(choices, `${name} contains duplicate choices`);
  return Object.freeze(choices);
}

function assertUnique(values, message) {
  if (new Set(values).size !== values.length) {
    throw new ConfigurationError(message);
  }
}

function loadConfig(environment = process.env, artifactRevision = ARTIFACT_SOURCE_REVISION) {
  const deploymentEnvironment = readRequired(environment, "DEPLOYMENT_ENVIRONMENT");
  // Production remains impossible in code until Development acceptance evidence,
  // connection scopes, rollback, and an explicit source change are reviewed.
  if (deploymentEnvironment !== "development") {
    throw new ConfigurationError(
      "DEPLOYMENT_ENVIRONMENT must be development; production activation is code-blocked",
    );
  }

  const sessionTableName = validateIdentifier(
    readRequired(environment, "SESSION_TABLE_NAME"),
    "SESSION_TABLE_NAME",
  );
  const prefillTableName = validateIdentifier(
    readRequired(environment, "PREFILL_TABLE_NAME"),
    "PREFILL_TABLE_NAME",
  );
  const submissionTableName = validateIdentifier(
    readRequired(environment, "SUBMISSION_TABLE_NAME"),
    "SUBMISSION_TABLE_NAME",
  );
  assertUnique(
    [sessionTableName, prefillTableName, submissionTableName],
    "Session, prefill, and submission table names must be different",
  );

  const issuePath = validatePath(readRequired(environment, "ISSUE_PATH"), "ISSUE_PATH");
  const prefillPath = validatePath(readRequired(environment, "PREFILL_PATH"), "PREFILL_PATH");
  const submissionPath = validatePath(
    readRequired(environment, "SUBMISSION_PATH"),
    "SUBMISSION_PATH",
  );
  assertUnique(
    [issuePath, prefillPath, submissionPath],
    "ISSUE_PATH, PREFILL_PATH, and SUBMISSION_PATH must be unique",
  );

  const issueHeaderName = validateHeaderName(
    readRequired(environment, "ISSUE_HEADER_NAME"),
    "ISSUE_HEADER_NAME",
  );
  const formsHeaderName = validateHeaderName(
    readRequired(environment, "FORMS_HEADER_NAME"),
    "FORMS_HEADER_NAME",
  );
  assertUnique(
    [issueHeaderName, formsHeaderName],
    "ISSUE_HEADER_NAME and FORMS_HEADER_NAME must be different",
  );

  const tokenPepper = validateSecret(
    readRequired(environment, "TOKEN_PEPPER"),
    "TOKEN_PEPPER",
  );
  const issueHeaderSecret = validateSecret(
    readRequired(environment, "ISSUE_HEADER_SECRET"),
    "ISSUE_HEADER_SECRET",
  );
  const prefillHeaderSecret = validateSecret(
    readRequired(environment, "PREFILL_HEADER_SECRET"),
    "PREFILL_HEADER_SECRET",
  );
  const submissionHeaderSecret = validateSecret(
    readRequired(environment, "SUBMISSION_HEADER_SECRET"),
    "SUBMISSION_HEADER_SECRET",
  );
  assertUnique(
    [tokenPepper, issueHeaderSecret, prefillHeaderSecret, submissionHeaderSecret],
    "TOKEN_PEPPER and route secrets must be independently generated",
  );

  const crmReadConnectionLinkName = validateConnectionLinkName(
    readRequired(environment, "CRM_READ_CONNECTION_LINK_NAME"),
    "CRM_READ_CONNECTION_LINK_NAME",
  );
  const crmWriteConnectionLinkName = validateConnectionLinkName(
    readRequired(environment, "CRM_WRITE_CONNECTION_LINK_NAME"),
    "CRM_WRITE_CONNECTION_LINK_NAME",
  );
  assertUnique(
    [crmReadConnectionLinkName, crmWriteConnectionLinkName],
    "CRM read and write Connections must use different link names",
  );

  const form2AccessStatuses = Object.freeze({
    initial: validateBoundedBusinessValue(
      readRequired(environment, "FORM2_ACCESS_STATUS_INITIAL_VALUE"),
      "FORM2_ACCESS_STATUS_INITIAL_VALUE",
    ),
    issued: validateBoundedBusinessValue(
      readRequired(environment, "FORM2_ACCESS_STATUS_ISSUED_VALUE"),
      "FORM2_ACCESS_STATUS_ISSUED_VALUE",
    ),
    verified: validateBoundedBusinessValue(
      readRequired(environment, "FORM2_ACCESS_STATUS_VERIFIED_VALUE"),
      "FORM2_ACCESS_STATUS_VERIFIED_VALUE",
    ),
    submitted: validateBoundedBusinessValue(
      readRequired(environment, "FORM2_ACCESS_STATUS_SUBMITTED_VALUE"),
      "FORM2_ACCESS_STATUS_SUBMITTED_VALUE",
    ),
    expired: validateBoundedBusinessValue(
      readRequired(environment, "FORM2_ACCESS_STATUS_EXPIRED_VALUE"),
      "FORM2_ACCESS_STATUS_EXPIRED_VALUE",
    ),
  });
  assertUnique(
    Object.values(form2AccessStatuses),
    "Form 2 setup-access status values must be different",
  );

  const sourceRevision = validateRevision(
    readRequired(environment, "SOURCE_REVISION"),
    "SOURCE_REVISION",
  );
  const builtRevision = validateRevision(
    artifactRevision,
    "Artifact source revision",
  );
  if (sourceRevision !== builtRevision) {
    throw new ConfigurationError(
      "SOURCE_REVISION does not match the deployed artifact source revision",
    );
  }

  const config = {
    deploymentEnvironment,
    sessionTableName,
    prefillTableName,
    submissionTableName,
    issuePath,
    prefillPath,
    submissionPath,
    issueHeaderName,
    formsHeaderName,
    tokenPepper,
    issueHeaderSecret,
    prefillHeaderSecret,
    submissionHeaderSecret,
    form2PublicUrl: validatePublicFormUrl(readRequired(environment, "FORM2_PUBLIC_URL")),
    form2TokenFieldAlias: validateIdentifier(
      readRequired(environment, "FORM2_TOKEN_FIELD_ALIAS"),
      "FORM2_TOKEN_FIELD_ALIAS",
    ),
    form2FormVersion: validateFormVersion(
      readRequired(environment, "FORM2_FORM_VERSION"),
    ),
    form2EntryOfferValue: validateBoundedBusinessValue(
      readRequired(environment, "FORM2_ENTRY_OFFER_VALUE"),
      "FORM2_ENTRY_OFFER_VALUE",
    ),
    form2PhoneSystemProviders: parsePrivateChoiceList(
      environment,
      "FORM2_PHONE_SYSTEM_PROVIDERS",
      PRIVATE_CHOICE_LIMITS.phoneSystemProviders,
      { allowCompressed: true },
    ),
    form2FieldTeamSizeBands: parsePrivateChoiceList(
      environment,
      "FORM2_FIELD_TEAM_SIZE_BANDS",
      PRIVATE_CHOICE_LIMITS.fieldTeamSizeBands,
    ),
    form2AccessStatuses,
    crmApiBaseUrl: validateCrmApiBaseUrl(readRequired(environment, "CRM_API_BASE_URL")),
    crmReadConnectionLinkName,
    crmWriteConnectionLinkName,
    sessionTtlSeconds: parseBoundedInteger(environment, "SESSION_TTL_SECONDS"),
    maxVerificationAttempts: parseBoundedInteger(
      environment,
      "MAX_VERIFICATION_ATTEMPTS",
    ),
    maxSubmissionAttempts: parseBoundedInteger(environment, "MAX_SUBMISSION_ATTEMPTS"),
    maxBodyBytes: parseBoundedInteger(environment, "MAX_BODY_BYTES"),
    inboundBodyTimeoutMs: parseBoundedInteger(environment, "INBOUND_BODY_TIMEOUT_MS"),
    outboundTimeoutMs: parseBoundedInteger(environment, "OUTBOUND_TIMEOUT_MS"),
    outboundMaxBytes: parseBoundedInteger(environment, "OUTBOUND_MAX_BYTES"),
    platformOperationTimeoutMs: parseBoundedInteger(
      environment,
      "PLATFORM_OPERATION_TIMEOUT_MS",
    ),
    sourceRevision,
  };

  return Object.freeze(config);
}

module.exports = {
  ConfigurationError,
  NUMERIC_LIMITS,
  PRIVATE_CHOICE_LIMITS,
  SESSION_STATUSES,
  SOURCE_REVISION_PATTERN,
  loadConfig,
};
