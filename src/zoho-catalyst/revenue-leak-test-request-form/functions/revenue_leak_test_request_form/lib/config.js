"use strict";

const crypto = require("node:crypto");
const { normalizeApprovedCatalystDevelopmentGatewayUrl } = require("./destinations");
const { validateOperatorHash, validateSecret } = require("./security");

const FORM1_SESSION_TABLE_NAME = "RevenueLeakTestRequestFormSessions";
const CRM_API_BASE_URL = "https://www.zohoapis.com/crm/v8";
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const RECOVERY_MARKER_PATTERN = /^r1_[a-f0-9]{40}_[a-f0-9]{12}4[a-f0-9]{3}[89ab][a-f0-9]{15}$/;
const NUMERIC_LIMITS = Object.freeze({
  SESSION_TTL_SECONDS: Object.freeze({ fallback: 1800, minimum: 300, maximum: 3600 }),
  PREFILL_HANDLE_TTL_SECONDS: Object.freeze({ fallback: 600, minimum: 300, maximum: 900 }),
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

function recoveryManifest(environment, sourceRevision) {
  const raw = environment?.FORM1_RECOVERY_MANIFEST_JSON;
  if (raw === undefined || raw === "") return null;
  let value;
  try {
    if (typeof raw !== "string" || raw.length > 1536) throw new Error();
    value = JSON.parse(raw);
    // Compact exact JSON rejects duplicate keys and ambiguous configuration.
    // Values identify one approved claim privately; they never enter logs.
    const keys = ["schemaVersion", "mode", "originalSourceRevision", "claimBindingSha256",
      "assistedConstantsSha256", "originalSessionVersion", "originalUpdatedAt", "originalLastOutcome"];
    const priorOutcome = value?.originalLastOutcome;
    // A separately approved follow-on hashes the complete prior reserved row;
    // the current artifact's own reservation never becomes fresh write authority.
    const approvedOutcome = priorOutcome === "submission_started" ||
      (typeof priorOutcome === "string" && RECOVERY_MARKER_PATTERN.test(priorOutcome) &&
        !priorOutcome.startsWith(`r1_${sourceRevision}_`));
    if (!value || Array.isArray(value) || typeof value !== "object" ||
        JSON.stringify(value) !== raw || Object.keys(value).length !== keys.length ||
        !keys.every(key => Object.hasOwn(value, key)) || value.schemaVersion !== 1 ||
        !["inspect", "complete"].includes(value.mode) ||
        !/^[a-f0-9]{40}$/.test(value.originalSourceRevision) ||
        value.originalSourceRevision === sourceRevision ||
        !SHA256_HEX_PATTERN.test(value.claimBindingSha256) ||
        !SHA256_HEX_PATTERN.test(value.assistedConstantsSha256) ||
        !Number.isSafeInteger(value.originalSessionVersion) || value.originalSessionVersion < 1 ||
        value.originalSessionVersion > Number.MAX_SAFE_INTEGER - 2 ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.originalUpdatedAt) ||
        new Date(value.originalUpdatedAt).toISOString() !== value.originalUpdatedAt ||
        !approvedOutcome) throw new Error();
  } catch {
    throw new ConfigurationError("FORM1_RECOVERY_MANIFEST_JSON is invalid");
  }
  return Object.freeze(value);
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

  if (required(environment, "ZOHO_CATALYST_ZCQL_PARSER") !== "V2") {
    throw new ConfigurationError("ZOHO_CATALYST_ZCQL_PARSER must equal V2");
  }

  const paths = {
    issue: pathValue(required(environment, "ISSUE_PATH"), "ISSUE_PATH"),
    access: pathValue(required(environment, "ACCESS_PATH"), "ACCESS_PATH"),
    exchange: pathValue(required(environment, "EXCHANGE_PATH"), "EXCHANGE_PATH"),
    prefill: pathValue(required(environment, "PREFILL_PATH"), "PREFILL_PATH"),
    submission: pathValue(required(environment, "SUBMISSION_PATH"), "SUBMISSION_PATH"),
  };
  if (new Set(Object.values(paths)).size !== 5) {
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
      prefillHandlePepper: validateSecret(
        required(environment, "PREFILL_HANDLE_PEPPER"),
        "PREFILL_HANDLE_PEPPER",
      ),
    };
    validateOperatorHash(required(environment, "ISSUING_ACTOR_HASH"));
  } catch (error) {
    throw new ConfigurationError(error.message);
  }
  if (new Set(Object.values(secrets)).size !== 5) {
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
  const prefillHandleAlias = identifier(
    required(environment, "FORM1_PREFILL_HANDLE_FIELD_ALIAS"),
    "FORM1_PREFILL_HANDLE_FIELD_ALIAS",
    64,
  );
  const selectedFormUrl = formUrl(required(environment, "FORM1_PUBLIC_URL"));
  return Object.freeze({
    accessPath: paths.access,
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
    exchangePath: paths.exchange,
    form1AccessPublicUrl: (() => {
      const value = required(environment, "FORM1_ACCESS_PUBLIC_URL");
      const normalized = normalizeApprovedCatalystDevelopmentGatewayUrl(value);
      if (!normalized) {
        throw new ConfigurationError(
          "FORM1_ACCESS_PUBLIC_URL must be one exact Catalyst Development Gateway source URL",
        );
      }
      return normalized;
    })(),
    form1PublicUrl: selectedFormUrl,
    form1PrefillHandleFieldAlias: prefillHandleAlias,
    formIdentityHash: crypto.createHash("sha256").update(selectedFormUrl, "utf8").digest("hex"),
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
    prefillHandlePepper: secrets.prefillHandlePepper,
    prefillHandleTtlSeconds: boundedInteger(environment, "PREFILL_HANDLE_TTL_SECONDS"),
    prefillPath: paths.prefill,
    recoveryManifest: recoveryManifest(environment, sourceRevision),
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
