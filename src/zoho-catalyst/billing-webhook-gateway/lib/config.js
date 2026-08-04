"use strict";

const { parseStrictIsoTimestamp } = require("./iso-timestamp");

const KNOWN_EVENT_TYPES = Object.freeze([
  "subscription_created",
  "subscription_activation",
  "subscription_renewed",
  "subscription_unpaid",
  "subscription_cancelled",
  "subscription_deleted",
  "payment_thankyou",
  "payment_declined",
  "payment_refunded",
  "payment_voided",
]);

const RETIRED_VARIABLES = Object.freeze([
  "ACCOUNTS_ALLOWED_HOSTS",
  "ACCOUNTS_ALLOWED_HOST_SUFFIXES",
  "ALLOWED_PATHS",
  "CREATOR_ALLOWED_HOST_SUFFIXES",
  "CREATOR_ENVIRONMENT",
  "ENABLE_PING",
  "FORWARD_PARSED_BILLING",
  "OAUTH_TOKEN_SKEW_SECONDS",
  "PING_TOKEN",
  "REPLAY_CACHE_SEGMENT_ID",
  "REPLAY_KEY_PREFIX",
  "REPLAY_WINDOW_SECONDS",
  "ZOHO_ACCOUNTS_DOMAIN",
  "ZOHO_ACCOUNTS_URL",
  "ZOHO_CLIENT_ID",
  "ZOHO_CLIENT_SECRET",
  "ZOHO_REFRESH_TOKEN",
]);

const PROTECTED_CREATOR_PATHS = new Set([
  "event_id",
  "event_time",
  "event_type",
  "headers",
  "signature",
  "webhooks",
]);

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigurationError";
    this.publicCode = "configuration_invalid";
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

function parseInteger(environment, name, fallback, minimum, maximum) {
  const raw = value(environment, name);
  if (!raw) return fallback;
  if (!/^[0-9]+$/.test(raw)) {
    throw new ConfigurationError(`${name} must be an integer`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigurationError(`${name} is outside its approved range`);
  }
  return parsed;
}

function parseBoolean(environment, name, fallback) {
  const raw = value(environment, name).toLowerCase();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ConfigurationError(`${name} must be true or false`);
}

function parseCsv(environment, name, { requiredValue = false, maximum = 50 } = {}) {
  const raw = value(environment, name);
  if (!raw) {
    if (requiredValue) throw new ConfigurationError(`${name} is required`);
    return [];
  }
  const entries = raw.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => !entry) || entries.length > maximum) {
    throw new ConfigurationError(`${name} contains an invalid list`);
  }
  if (new Set(entries).size !== entries.length) {
    throw new ConfigurationError(`${name} contains duplicates`);
  }
  return entries;
}

function validateBillingSecret(secret, name, { optional = false } = {}) {
  if (!secret && optional) return "";
  if (!/^[A-Za-z0-9]{12,50}$/.test(secret)) {
    throw new ConfigurationError(`${name} must be 12-50 alphanumeric characters`);
  }
  return secret;
}

function validateOpaqueSecret(secret, name, { optional = false } = {}) {
  if (!secret && optional) return "";
  if (secret.length < 32 || secret.length > 256) {
    throw new ConfigurationError(`${name} has an invalid length`);
  }
  return secret;
}

function parseRotationExpiry(environment, previousSecret, nowMs) {
  const raw = value(environment, "BILLING_WEBHOOK_SECRET_PREVIOUS_EXPIRES_AT");
  if (!previousSecret && raw) {
    throw new ConfigurationError("Previous-secret expiry requires a previous secret");
  }
  if (previousSecret && !raw) {
    throw new ConfigurationError("Previous webhook secret requires an expiry");
  }
  if (!raw) return null;
  const expiresAt = parseStrictIsoTimestamp(raw);
  if (expiresAt === null) {
    throw new ConfigurationError(
      "Previous-secret expiry must be a valid ISO-8601 timestamp with offset",
    );
  }
  const maximumOverlapMs = 7 * 24 * 60 * 60 * 1000;
  if (expiresAt > nowMs + maximumOverlapMs) {
    throw new ConfigurationError("Previous-secret overlap may not exceed seven days");
  }
  return expiresAt;
}

function validatePath(path) {
  if (
    !/^\/[A-Za-z0-9][A-Za-z0-9/_-]{0,199}$/.test(path) ||
    path.includes("//") ||
    path.endsWith("/")
  ) {
    throw new ConfigurationError("ALLOWED_PATH must be one exact path");
  }
  return path;
}

function validateIdentifier(identifier, name) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(identifier)) {
    throw new ConfigurationError(`${name} must be a safe platform identifier`);
  }
  return identifier;
}

function validateRevision(revision) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{6,79}$/.test(revision)) {
    throw new ConfigurationError("SOURCE_REVISION has an invalid format");
  }
  return revision;
}

function validateHost(host) {
  const lowered = host.toLowerCase();
  if (
    host !== lowered ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
  ) {
    throw new ConfigurationError("Allowed hosts must be exact DNS names");
  }
  return lowered;
}

function validateEndpoint(raw, allowedHosts, name) {
  let parsed;
  try {
    parsed = new URL(raw);
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
    !allowedHosts.includes(parsed.hostname.toLowerCase())
  ) {
    throw new ConfigurationError(`${name} is outside the exact outbound allowlist`);
  }
  return parsed.href;
}

function validateFieldPath(path) {
  if (
    path.length > 120 ||
    !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/.test(path)
  ) {
    throw new ConfigurationError("CREATOR_FIELD_ALLOWLIST contains an invalid path");
  }
  const blockedSegments = new Set(["__proto__", "prototype", "constructor"]);
  const segments = path.split(".");
  if (
    segments.some((segment) => blockedSegments.has(segment)) ||
    PROTECTED_CREATOR_PATHS.has(segments[0])
  ) {
    throw new ConfigurationError("CREATOR_FIELD_ALLOWLIST contains a protected path");
  }
  return path;
}

function rejectRetiredConfiguration(environment) {
  for (const name of RETIRED_VARIABLES) {
    if (value(environment, name)) {
      throw new ConfigurationError(`${name} is retired and must be removed`);
    }
  }
  if (!parseBoolean(environment, "ENABLE_REPLAY_DEFENSE", true)) {
    throw new ConfigurationError("ENABLE_REPLAY_DEFENSE cannot disable durable claims");
  }
  if (parseBoolean(environment, "FORWARD_RAW_PAYLOAD", false)) {
    throw new ConfigurationError("FORWARD_RAW_PAYLOAD is prohibited");
  }
  if (!parseBoolean(environment, "REQUIRE_JSON", true)) {
    throw new ConfigurationError("REQUIRE_JSON cannot be disabled");
  }
  if (!parseBoolean(environment, "REQUIRE_SIGNATURE", true)) {
    throw new ConfigurationError("REQUIRE_SIGNATURE cannot be disabled");
  }
}

function loadConfig(environment = process.env, { nowMs = Date.now() } = {}) {
  rejectRetiredConfiguration(environment);

  const deploymentEnvironment = required(environment, "DEPLOYMENT_ENVIRONMENT");
  if (!new Set(["development", "production"]).has(deploymentEnvironment)) {
    throw new ConfigurationError("DEPLOYMENT_ENVIRONMENT must be development or production");
  }
  // Production is intentionally code-blocked until the exact Catalyst
  // Connection and companion Creator API contracts are proven in Development.
  if (deploymentEnvironment === "production") {
    throw new ConfigurationError(
      "Production activation is blocked in this proposed source revision",
    );
  }
  const billingSourceTier = required(environment, "BILLING_SOURCE_TIER");
  const expectedSourceTier = deploymentEnvironment === "production" ? "live" : "test";
  if (billingSourceTier !== expectedSourceTier) {
    throw new ConfigurationError("Billing source tier does not match the Catalyst environment");
  }

  const contentType = required(environment, "BILLING_CONTENT_TYPE").toLowerCase();
  if (contentType !== "application/json") {
    throw new ConfigurationError("Only an explicitly configured JSON Billing body is approved");
  }

  const signatureEncoding = required(environment, "BILLING_SIGNATURE_ENCODING").toLowerCase();
  if (!new Set(["hex", "base64"]).has(signatureEncoding)) {
    throw new ConfigurationError("BILLING_SIGNATURE_ENCODING must be verified as hex or base64");
  }

  const currentSecret = validateBillingSecret(
    required(environment, "BILLING_WEBHOOK_SECRET"),
    "BILLING_WEBHOOK_SECRET",
  );
  const previousSecret = validateBillingSecret(
    value(environment, "BILLING_WEBHOOK_SECRET_PREVIOUS"),
    "BILLING_WEBHOOK_SECRET_PREVIOUS",
    { optional: true },
  );
  const previousExpiresAt = parseRotationExpiry(environment, previousSecret, nowMs);
  const webhookSecrets = [currentSecret];
  if (previousSecret && previousExpiresAt > nowMs) webhookSecrets.push(previousSecret);

  const allowedEventTypes = parseCsv(environment, "ALLOWED_EVENT_TYPES", {
    requiredValue: true,
    maximum: KNOWN_EVENT_TYPES.length,
  });
  for (const eventType of allowedEventTypes) {
    if (!KNOWN_EVENT_TYPES.includes(eventType)) {
      throw new ConfigurationError("ALLOWED_EVENT_TYPES contains an unknown Billing event");
    }
  }

  const duplicateErrorCodes = parseCsv(environment, "DATASTORE_DUPLICATE_ERROR_CODES", {
    requiredValue: true,
    maximum: 10,
  });
  if (duplicateErrorCodes.some((code) => !/^[A-Za-z0-9_.-]{1,80}$/.test(code))) {
    throw new ConfigurationError("DATASTORE_DUPLICATE_ERROR_CODES contains an invalid code");
  }

  const deliveryMode = required(environment, "DELIVERY_MODE");
  if (!new Set(["register-only", "creator"]).has(deliveryMode)) {
    throw new ConfigurationError("DELIVERY_MODE must be register-only or creator");
  }

  const requireSharedHeader = parseBoolean(environment, "REQUIRE_SHARED_HEADER", false);
  const sharedHeaderName = value(environment, "SHARED_HEADER_NAME").toLowerCase();
  const sharedHeaderValue = value(environment, "SHARED_HEADER_VALUE");
  if (requireSharedHeader) {
    const reservedHeaders = new Set([
      "authorization",
      "connection",
      "content-length",
      "content-type",
      "host",
      "transfer-encoding",
      "x-zoho-webhook-signature",
    ]);
    if (
      !/^[a-z][a-z0-9-]{1,62}$/.test(sharedHeaderName) ||
      reservedHeaders.has(sharedHeaderName)
    ) {
      throw new ConfigurationError("SHARED_HEADER_NAME is invalid or reserved");
    }
    validateOpaqueSecret(sharedHeaderValue, "SHARED_HEADER_VALUE");
  } else if (sharedHeaderName || sharedHeaderValue) {
    throw new ConfigurationError("Shared-header values require REQUIRE_SHARED_HEADER=true");
  }

  const inboundBodyTimeoutMs = parseInteger(
    environment,
    "INBOUND_BODY_TIMEOUT_MS",
    5000,
    100,
    5000,
  );
  const platformOperationTimeoutMs = parseInteger(
    environment,
    "PLATFORM_OPERATION_TIMEOUT_MS",
    3000,
    100,
    4000,
  );
  const outboundTimeoutMs = parseInteger(
    environment,
    "OUTBOUND_TIMEOUT_MS",
    5000,
    100,
    6000,
  );
  const executionBudgetMs = parseInteger(
    environment,
    "EXECUTION_BUDGET_MS",
    25000,
    5000,
    25000,
  );
  const maximumSequentialBudget = inboundBodyTimeoutMs
    + (4 * platformOperationTimeoutMs)
    + (deliveryMode === "creator" ? outboundTimeoutMs : 0);
  if (maximumSequentialBudget > executionBudgetMs) {
    throw new ConfigurationError("Configured operation timeouts exceed the execution budget");
  }

  const config = {
    deploymentEnvironment,
    billingSourceTier,
    sourceRevision: validateRevision(required(environment, "SOURCE_REVISION")),
    allowedPath: validatePath(required(environment, "ALLOWED_PATH")),
    contentType,
    signatureEncoding,
    webhookSecrets: Object.freeze(webhookSecrets),
    eventFingerprintSecret: validateOpaqueSecret(
      required(environment, "BILLING_EVENT_FINGERPRINT_SECRET"),
      "BILLING_EVENT_FINGERPRINT_SECRET",
    ),
    billingSourceKey: validateIdentifier(
      required(environment, "BILLING_SOURCE_KEY"),
      "BILLING_SOURCE_KEY",
    ),
    allowedEventTypes: Object.freeze([...allowedEventTypes]),
    maxEventAgeSeconds: parseInteger(
      environment,
      "BILLING_MAX_EVENT_AGE_SECONDS",
      604800,
      60,
      15552000,
    ),
    maxFutureSkewSeconds: parseInteger(
      environment,
      "BILLING_MAX_FUTURE_SKEW_SECONDS",
      300,
      0,
      3600,
    ),
    maxBodyBytes: parseInteger(environment, "MAX_BODY_BYTES", 262144, 1024, 1048576),
    inboundBodyTimeoutMs,
    platformOperationTimeoutMs,
    outboundTimeoutMs,
    executionBudgetMs,
    eventInboxTable: validateIdentifier(
      required(environment, "EVENT_INBOX_TABLE"),
      "EVENT_INBOX_TABLE",
    ),
    duplicateErrorCodes: Object.freeze([...duplicateErrorCodes]),
    deliveryMode,
    requireSharedHeader,
    sharedHeaderName,
    sharedHeaderValue,
    maxOutboundBodyBytes: parseInteger(
      environment,
      "MAX_OUTBOUND_BODY_BYTES",
      65536,
      1024,
      262144,
    ),
  };

  if (deliveryMode === "creator") {
    config.creatorFieldAllowlist = Object.freeze(
      parseCsv(environment, "CREATOR_FIELD_ALLOWLIST", { maximum: 32 })
        .map(validateFieldPath),
    );
    const creatorTargetEnvironment = required(environment, "CREATOR_TARGET_ENVIRONMENT");
    const approvedCreatorTargets = deploymentEnvironment === "production"
      ? ["production"]
      : ["development", "stage"];
    if (!approvedCreatorTargets.includes(creatorTargetEnvironment)) {
      throw new ConfigurationError("Creator target is outside the approved environment mapping");
    }
    if (required(environment, "CREATOR_ENDPOINT_KIND") !== "custom-api") {
      throw new ConfigurationError("Only a Creator Custom API endpoint is supported");
    }
    const creatorHosts = parseCsv(environment, "CREATOR_ALLOWED_HOSTS", {
      requiredValue: true,
      maximum: 8,
    }).map(validateHost);
    config.creatorTargetEnvironment = creatorTargetEnvironment;
    config.creatorUrl = validateEndpoint(
      required(environment, "CREATOR_FORWARD_URL"),
      creatorHosts,
      "CREATOR_FORWARD_URL",
    );
    if (
      !/^\/creator\/custom\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_-]{1,100}$/.test(
        new URL(config.creatorUrl).pathname,
      )
    ) {
      throw new ConfigurationError("CREATOR_FORWARD_URL must be an exact Custom API endpoint");
    }
    config.creatorConnectionLinkName = validateIdentifier(
      required(environment, "CREATOR_CONNECTION_LINK_NAME"),
      "CREATOR_CONNECTION_LINK_NAME",
    );
  }

  return Object.freeze(config);
}

module.exports = {
  ConfigurationError,
  KNOWN_EVENT_TYPES,
  RETIRED_VARIABLES,
  loadConfig,
};
