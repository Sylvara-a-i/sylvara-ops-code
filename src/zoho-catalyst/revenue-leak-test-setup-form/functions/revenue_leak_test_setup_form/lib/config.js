"use strict";

const { brotliDecompressSync } = require("node:zlib");

const {
  isApprovedCatalystDevelopmentHostname,
  isApprovedCrmApiHostname,
  isArtifactBoundFormUrl,
} = require("./destinations");
const { ARTIFACT_FORM_DESTINATION_SHA256 } = require("./form-destination");
const { ARTIFACT_SOURCE_REVISION } = require("./source-revision");

const PRIVATE_CHOICE_LIMITS = Object.freeze({
  // Covers the reviewed 208-choice provider catalog plus bounded growth. Any
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
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const COMPRESSED_CHOICE_PREFIX = "br:";
const MAX_COMPRESSED_CHOICE_CHARS = 4096;
const MAX_DECOMPRESSED_CHOICE_BYTES = 32768;
const FORM2_SESSION_TABLE_NAME = "Form2SessionsV3Runtime";
const FORM2_PREFILL_TABLE_NAME = "Form2PrefillsV3";
const FORM2_SUBMISSION_TABLE_NAME = "Form2SubmissionsV3";
const FORM2_PROOF_TABLE_NAME = "Form2VerificationProofsV3";
const CRM_API_BASE_URL = "https://www.zohoapis.com/crm/v8";
const FORM2_PROOF_TEMPLATE_VERSION = "email-otp-v1";
const MAX_PROOF_ALLOWED_RECIPIENT_DIGESTS = 16;

const NUMERIC_LIMITS = Object.freeze({
  // Invitation lifetime. The first successful verification replaces this
  // deadline with the fixed post-verification lifetime below.
  SESSION_TTL_SECONDS: Object.freeze({ fallback: 3600, minimum: 300, maximum: 86400 }),
  // This is intentionally exact rather than merely bounded. Changing the
  // verified-session lifetime requires a reviewed source change.
  VERIFIED_SESSION_TTL_SECONDS: Object.freeze({
    fallback: 1800,
    minimum: 1800,
    maximum: 1800,
  }),
  // Two attempts preserve one bounded retry if prefill persistence fails after
  // the first successful verification transition.
  MAX_VERIFICATION_ATTEMPTS: Object.freeze({ fallback: 3, minimum: 2, maximum: 10 }),
  FORM2_PROOF_TTL_SECONDS: Object.freeze({ fallback: 600, minimum: 300, maximum: 900 }),
  FORM2_PROOF_MAX_ATTEMPTS: Object.freeze({ fallback: 5, minimum: 2, maximum: 10 }),
  FORM2_PROOF_MAX_SENDS: Object.freeze({ fallback: 3, minimum: 1, maximum: 5 }),
  FORM2_PROOF_RESEND_COOLDOWN_SECONDS: Object.freeze({
    fallback: 60,
    minimum: 30,
    maximum: 300,
  }),
  FORM2_PROOF_SEND_LEASE_SECONDS: Object.freeze({
    fallback: 30,
    minimum: 10,
    maximum: 120,
  }),
  FORM2_MAIL_TIMEOUT_MS: Object.freeze({ fallback: 5000, minimum: 250, maximum: 15000 }),
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

function readReviewedDefault(environment, name, fallback) {
  if (environment[name] === undefined) return fallback;
  return readRequired(environment, name);
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

function validateReviewedTable(value, name, expected) {
  const selected = validateIdentifier(value, name);
  if (selected !== expected) {
    throw new ConfigurationError(`${name} must be the reviewed ${expected} table`);
  }
  return selected;
}

function validateSessionV3Table(value) {
  return validateReviewedTable(value, "SESSION_TABLE_NAME", FORM2_SESSION_TABLE_NAME);
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
  if (typeof value !== "string") {
    throw new ConfigurationError(`${name} must be an absolute HTTPS URL`);
  }
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
    value !== parsed.href ||
    value.includes("?") ||
    value.includes("#") ||
    parsed.search ||
    parsed.hash ||
    parsed.hostname !== parsed.hostname.toLowerCase() ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(parsed.hostname)
  ) {
    throw new ConfigurationError(`${name} must use one exact HTTPS host and path`);
  }
  return parsed;
}

function validatePublicFormUrl(value, artifactFormDestinationSha256) {
  const parsed = parseHttpsUrl(value, "FORM2_PUBLIC_URL");
  if (
    !isArtifactBoundFormUrl(parsed.href, artifactFormDestinationSha256)
  ) {
    throw new ConfigurationError(
      "FORM2_PUBLIC_URL does not match the exact form bound to this artifact",
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

function validateProjectIdDigest(value) {
  if (!SHA256_HEX_PATTERN.test(value)) {
    throw new ConfigurationError(
      "EXPECTED_CATALYST_PROJECT_ID_SHA256 must be one lowercase SHA-256 digest",
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

function validateTemplateVersion(value) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    throw new ConfigurationError("FORM2_PROOF_TEMPLATE_VERSION has an invalid format");
  }
  if (value !== FORM2_PROOF_TEMPLATE_VERSION) {
    throw new ConfigurationError(
      `FORM2_PROOF_TEMPLATE_VERSION must equal ${FORM2_PROOF_TEMPLATE_VERSION}`,
    );
  }
  return value;
}

function validateEmailAddress(value, name) {
  if (
    value.length > 254 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f\s]/.test(value) ||
    !/^[^@]+@[^@]+\.[^@]+$/.test(value)
  ) {
    throw new ConfigurationError(`${name} must be one bounded email address`);
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

function parseProofRecipientDigestAllowlist(environment) {
  const name = "FORM2_PROOF_ALLOWED_RECIPIENT_DIGESTS";
  let parsed;
  try {
    // Stub mode is the Development containment default. Send mode still fails
    // closed below unless an explicit non-empty digest allowlist is configured.
    parsed = JSON.parse(readReviewedDefault(environment, name, "[]"));
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError(`${name} must be a JSON array`);
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_PROOF_ALLOWED_RECIPIENT_DIGESTS) {
    throw new ConfigurationError(
      `${name} must contain at most ${MAX_PROOF_ALLOWED_RECIPIENT_DIGESTS} digests`,
    );
  }
  if (parsed.some((entry) => typeof entry !== "string" || !/^[a-f0-9]{64}$/.test(entry))) {
    throw new ConfigurationError(`${name} contains an invalid digest`);
  }
  assertUnique(parsed, `${name} contains duplicate digests`);
  return Object.freeze(parsed);
}

function assertUnique(values, message) {
  if (new Set(values).size !== values.length) {
    throw new ConfigurationError(message);
  }
}

function loadConfig(
  environment = process.env,
  artifactRevision = ARTIFACT_SOURCE_REVISION,
  artifactFormDestinationSha256 = ARTIFACT_FORM_DESTINATION_SHA256,
) {
  const deploymentEnvironment = readRequired(environment, "DEPLOYMENT_ENVIRONMENT");
  const deploymentMode = readRequired(environment, "DEPLOYMENT_MODE");
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

  // Dark Production intentionally has no form route, store, mail, CRM, or secret
  // dependency. A deployed artifact therefore cannot become active through variables.
  if (deploymentMode === "dark") {
    return Object.freeze({
      darkMode: true,
      deploymentEnvironment,
      deploymentMode,
      sourceRevision,
    });
  }

  const sessionTableName = validateSessionV3Table(
    readReviewedDefault(environment, "SESSION_TABLE_NAME", FORM2_SESSION_TABLE_NAME),
  );
  const prefillTableName = validateReviewedTable(
    readReviewedDefault(environment, "PREFILL_TABLE_NAME", FORM2_PREFILL_TABLE_NAME),
    "PREFILL_TABLE_NAME",
    FORM2_PREFILL_TABLE_NAME,
  );
  const submissionTableName = validateReviewedTable(
    readReviewedDefault(environment, "SUBMISSION_TABLE_NAME", FORM2_SUBMISSION_TABLE_NAME),
    "SUBMISSION_TABLE_NAME",
    FORM2_SUBMISSION_TABLE_NAME,
  );
  const proofTableName = validateReviewedTable(
    readReviewedDefault(environment, "FORM2_PROOF_TABLE_NAME", FORM2_PROOF_TABLE_NAME),
    "FORM2_PROOF_TABLE_NAME",
    FORM2_PROOF_TABLE_NAME,
  );
  assertUnique(
    [sessionTableName, prefillTableName, submissionTableName, proofTableName],
    "Session, prefill, submission, and proof table names must be different",
  );

  const issuePath = validatePath(readRequired(environment, "ISSUE_PATH"), "ISSUE_PATH");
  const prefillPath = validatePath(readRequired(environment, "PREFILL_PATH"), "PREFILL_PATH");
  const submissionPath = validatePath(
    readRequired(environment, "SUBMISSION_PATH"),
    "SUBMISSION_PATH",
  );
  const accessPath = validatePath(
    readRequired(environment, "FORM2_ACCESS_PATH"),
    "FORM2_ACCESS_PATH",
  );
  const otpRequestPath = validatePath(
    readRequired(environment, "FORM2_OTP_REQUEST_PATH"),
    "FORM2_OTP_REQUEST_PATH",
  );
  const otpVerifyPath = validatePath(
    readRequired(environment, "FORM2_OTP_VERIFY_PATH"),
    "FORM2_OTP_VERIFY_PATH",
  );
  assertUnique(
    [issuePath, accessPath, otpRequestPath, otpVerifyPath, prefillPath, submissionPath],
    "Every Form 2 route path must be unique",
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
  const workflowKeyMaterial = validateSecret(
    readRequired(environment, "WORKFLOW_HMAC_SECRET"),
    "WORKFLOW_HMAC_SECRET",
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
  const proofHmacMaterial = validateSecret(
    readRequired(environment, "FORM2_PROOF_HMAC_SECRET"),
    "FORM2_PROOF_HMAC_SECRET",
  );
  assertUnique(
    [
      tokenPepper,
      workflowKeyMaterial,
      issueHeaderSecret,
      prefillHeaderSecret,
      submissionHeaderSecret,
      proofHmacMaterial,
    ],
    "Token, workflow, proof, and route secrets must be independently generated",
  );

  const proofMode = readRequired(environment, "FORM2_PROOF_MODE");
  if (!new Set(["stub", "send_development"]).has(proofMode)) {
    throw new ConfigurationError("FORM2_PROOF_MODE must be stub or send_development");
  }
  const proofAllowedRecipientDigests = parseProofRecipientDigestAllowlist(environment);
  if (proofMode === "send_development" && proofAllowedRecipientDigests.length === 0) {
    throw new ConfigurationError(
      "FORM2_PROOF_ALLOWED_RECIPIENT_DIGESTS must approve at least one Development recipient before sending",
    );
  }

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

  const config = {
    darkMode: false,
    deploymentEnvironment,
    deploymentMode,
    expectedCatalystProjectIdSha256: validateProjectIdDigest(
      readRequired(environment, "EXPECTED_CATALYST_PROJECT_ID_SHA256"),
    ),
    sessionTableName,
    prefillTableName,
    submissionTableName,
    proofTableName,
    issuePath,
    accessPath,
    otpRequestPath,
    otpVerifyPath,
    prefillPath,
    submissionPath,
    issueHeaderName,
    formsHeaderName,
    tokenPepper,
    workflowKeyMaterial,
    issueHeaderSecret,
    prefillHeaderSecret,
    submissionHeaderSecret,
    proofHmacSecret: proofHmacMaterial,
    proofMode,
    form2ProofAllowedRecipientDigests: proofAllowedRecipientDigests,
    form2AccessPublicUrl: (() => {
      const value = readRequired(environment, "FORM2_ACCESS_PUBLIC_URL");
      const parsed = parseHttpsUrl(value, "FORM2_ACCESS_PUBLIC_URL");
      if (
        !isApprovedCatalystDevelopmentHostname(parsed.hostname) ||
        parsed.pathname !== accessPath
      ) {
        throw new ConfigurationError(
          "FORM2_ACCESS_PUBLIC_URL must use an approved Catalyst Development host and path",
        );
      }
      return value;
    })(),
    form2MailFrom: validateEmailAddress(
      readRequired(environment, "FORM2_MAIL_FROM"),
      "FORM2_MAIL_FROM",
    ),
    form2ProofTemplateVersion: validateTemplateVersion(
      readReviewedDefault(
        environment,
        "FORM2_PROOF_TEMPLATE_VERSION",
        FORM2_PROOF_TEMPLATE_VERSION,
      ),
    ),
    form2PublicUrl: validatePublicFormUrl(
      readRequired(environment, "FORM2_PUBLIC_URL"),
      artifactFormDestinationSha256,
    ),
    form2DestinationSha256: artifactFormDestinationSha256,
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
    crmApiBaseUrl: validateCrmApiBaseUrl(
      readReviewedDefault(environment, "CRM_API_BASE_URL", CRM_API_BASE_URL),
    ),
    crmReadConnectionLinkName,
    crmWriteConnectionLinkName,
    sessionTtlSeconds: parseBoundedInteger(environment, "SESSION_TTL_SECONDS"),
    verifiedSessionTtlSeconds: parseBoundedInteger(
      environment,
      "VERIFIED_SESSION_TTL_SECONDS",
    ),
    maxVerificationAttempts: parseBoundedInteger(
      environment,
      "MAX_VERIFICATION_ATTEMPTS",
    ),
    form2ProofTtlSeconds: parseBoundedInteger(environment, "FORM2_PROOF_TTL_SECONDS"),
    form2ProofMaxAttempts: parseBoundedInteger(
      environment,
      "FORM2_PROOF_MAX_ATTEMPTS",
    ),
    form2ProofMaxSends: parseBoundedInteger(environment, "FORM2_PROOF_MAX_SENDS"),
    form2ProofResendCooldownSeconds: parseBoundedInteger(
      environment,
      "FORM2_PROOF_RESEND_COOLDOWN_SECONDS",
    ),
    form2ProofSendLeaseSeconds: parseBoundedInteger(
      environment,
      "FORM2_PROOF_SEND_LEASE_SECONDS",
    ),
    form2MailTimeoutMs: parseBoundedInteger(environment, "FORM2_MAIL_TIMEOUT_MS"),
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
  FORM2_PREFILL_TABLE_NAME,
  FORM2_PROOF_TABLE_NAME,
  FORM2_SESSION_TABLE_NAME,
  FORM2_SUBMISSION_TABLE_NAME,
  ConfigurationError,
  NUMERIC_LIMITS,
  PRIVATE_CHOICE_LIMITS,
  SESSION_STATUSES,
  SOURCE_REVISION_PATTERN,
  loadConfig,
};
