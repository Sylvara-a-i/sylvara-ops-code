'use strict';

const { validateSourceRevision, integer } = require('./validation');
const { invariant } = require('./errors');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TABLE_VARIABLES = Object.freeze([
  'DEPLOYMENT_TABLE',
  'EVENT_RECEIPT_TABLE',
  'CANONICAL_CALL_TABLE',
  'NOTIFICATION_TABLE',
]);

const APPROVED_TABLES = Object.freeze({
  DEPLOYMENT_TABLE: 'FreeTestDeployments',
  EVENT_RECEIPT_TABLE: 'FreeTestRetellEventReceipts',
  CANONICAL_CALL_TABLE: 'FreeTestCalls',
  NOTIFICATION_TABLE: 'FreeTestNotifications',
});

function required(env, name, options = {}) {
  const value = env[name];
  invariant(typeof value === 'string' && value.length > 0, 'INVALID_RUNTIME_CONFIGURATION', `${name} is required.`, { httpStatus: 503 });
  const normalized = options.trim === false ? value : value.trim();
  const minimum = options.minimum || 1;
  const maximum = options.maximum || 500;
  invariant(normalized.length >= minimum && normalized.length <= maximum,
    'INVALID_RUNTIME_CONFIGURATION', `${name} has an invalid length.`, { httpStatus: 503 });
  return normalized;
}

function exactInteger(env, name, expected) {
  const parsed = Number(required(env, name, { maximum: 10 }));
  integer(parsed, name, expected, expected);
  return parsed;
}

function patterned(value, name, pattern, message) {
  invariant(pattern.test(value), 'INVALID_RUNTIME_CONFIGURATION', `${name} ${message}.`, { httpStatus: 503 });
  return value;
}

function runtimeSecret(env, name, options) {
  const value = required(env, name, { ...options, trim: false });
  invariant(!/^<[^<>]+>$/.test(value)
    && !/^(?:change[-_ ]?me|replace[-_ ]?me|placeholder)$/i.test(value),
  'INVALID_RUNTIME_CONFIGURATION', `${name} contains a public placeholder.`, { httpStatus: 503 });
  return value;
}

function loadSharedConfig(env) {
  const environment = required(env, 'DEPLOYMENT_ENVIRONMENT', { maximum: 20 });
  invariant(environment === 'development', 'PRODUCTION_BLOCKED', 'This package may run only in Development.', { httpStatus: 503 });
  invariant(required(env, 'ZOHO_CATALYST_ZCQL_PARSER', { maximum: 2 }) === 'V2',
    'INVALID_RUNTIME_CONFIGURATION', 'Catalyst ZCQL V2 must be enabled.', { httpStatus: 503 });
  const sourceRevision = validateSourceRevision(required(env, 'SOURCE_REVISION', { maximum: 40 }));
  const eventSecret = patterned(
    runtimeSecret(env, 'EVENT_HMAC_SECRET', { minimum: 32, maximum: 4096 }),
    'EVENT_HMAC_SECRET', /^\S{32,4096}$/, 'must be 32-4096 non-whitespace characters',
  );
  const tables = {};
  for (const variable of TABLE_VARIABLES) {
    const table = required(env, variable, { maximum: 128 });
    invariant(!/^<.*>$/.test(table), 'INVALID_RUNTIME_CONFIGURATION', `${variable} still contains a placeholder.`, { httpStatus: 503 });
    tables[variable] = patterned(table, variable, /^[A-Za-z][A-Za-z0-9_]{0,63}$/, 'must be a Catalyst table API name');
    invariant(table === APPROVED_TABLES[variable], 'INVALID_RUNTIME_CONFIGURATION',
      `${variable} must use the reviewed Development MVP table name.`, { httpStatus: 503 });
  }
  invariant(new Set(Object.values(tables)).size === TABLE_VARIABLES.length,
    'INVALID_RUNTIME_CONFIGURATION', 'Each durable entity must use a distinct table.', { httpStatus: 503 });
  const mailMode = required(env, 'FREE_TEST_NOTIFICATION_MODE', { maximum: 30 });
  invariant(new Set(['dry_run', 'send_development']).has(mailMode), 'PRODUCTION_BLOCKED',
    'Catalyst Mail mode is not approved for Development.', { httpStatus: 503 });
  const mailFrom = required(env, 'FREE_TEST_MAIL_FROM', { maximum: 254 });
  invariant(EMAIL_PATTERN.test(mailFrom), 'INVALID_RUNTIME_CONFIGURATION',
    'FREE_TEST_MAIL_FROM must be a valid configured Catalyst Mail sender.', { httpStatus: 503 });
  return Object.freeze({
    environment,
    sourceRevision,
    eventSecret,
    sharedAgentId: patterned(
      required(env, 'RETELL_SHARED_AGENT_ID', { minimum: 8, maximum: 128, trim: false }),
      'RETELL_SHARED_AGENT_ID',
      /^[A-Za-z0-9_-]{8,128}$/,
      'has an invalid format',
    ),
    sharedAgentVersion: integer(Number(required(env, 'RETELL_SHARED_AGENT_VERSION', { maximum: 10 })), 'RETELL_SHARED_AGENT_VERSION', 0, 100_000),
    developmentProjectId: patterned(
      required(env, 'FREE_TEST_DEVELOPMENT_PROJECT_ID', { maximum: 30 }),
      'FREE_TEST_DEVELOPMENT_PROJECT_ID',
      /^[0-9]{1,30}$/,
      'must be the exact numeric Catalyst Development project ID',
    ),
    platformTimeoutMs: integer(Number(required(env, 'PLATFORM_OPERATION_TIMEOUT_MS', { maximum: 10 })), 'PLATFORM_OPERATION_TIMEOUT_MS', 250, 5000),
    mailMode,
    mailFrom,
    mailTimeoutMs: integer(Number(required(env, 'FREE_TEST_MAIL_TIMEOUT_MS', { maximum: 10 })),
      'FREE_TEST_MAIL_TIMEOUT_MS', 250, 5000),
    notificationMaxAttempts: exactInteger(env, 'FREE_TEST_NOTIFICATION_MAX_ATTEMPTS', 3),
    tables: Object.freeze(tables),
  });
}

function loadConfig(env = process.env) {
  const shared = loadSharedConfig(env);
  const retellVerificationKey = patterned(
    runtimeSecret(env, 'RETELL_WEBHOOK_API_KEY', { minimum: 24, maximum: 4096 }),
    'RETELL_WEBHOOK_API_KEY',
    /^\S{24,4096}$/,
    'must be 24-4096 non-whitespace characters',
  );
  const numberSecret = patterned(
    runtimeSecret(env, 'NUMBER_LOOKUP_HMAC_SECRET', { minimum: 32, maximum: 4096 }),
    'NUMBER_LOOKUP_HMAC_SECRET', /^\S{32,4096}$/, 'must be 32-4096 non-whitespace characters',
  );
  const readinessToken = patterned(
    runtimeSecret(env, 'INTERNAL_READINESS_TOKEN', { minimum: 32, maximum: 256 }),
    'INTERNAL_READINESS_TOKEN', /^\S{32,256}$/, 'must be 32-256 non-whitespace characters',
  );
  invariant(new Set([retellVerificationKey, shared.eventSecret, numberSecret, readinessToken]).size === 4,
    'INVALID_RUNTIME_CONFIGURATION', 'Webhook and keyed-identifier secrets must be distinct.', { httpStatus: 503 });
  const inboundPath = required(env, 'RETELL_INBOUND_PATH', { maximum: 80 });
  const eventsPath = required(env, 'RETELL_EVENTS_PATH', { maximum: 80 });
  const readinessPath = required(env, 'INTERNAL_READINESS_PATH', { maximum: 80 });
  invariant(inboundPath === '/retell/inbound' && eventsPath === '/retell/events'
    && readinessPath === '/internal/readiness',
    'INVALID_RUNTIME_CONFIGURATION', 'Webhook paths must match the reviewed contract.', { httpStatus: 503 });
  const developmentHost = required(env, 'FREE_TEST_DEVELOPMENT_HOST', { maximum: 253 }).toLowerCase();
  invariant(!/^<.*>$/.test(developmentHost)
    && /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\.development\.(?:catalystserverless|zohocatalyst)\.(?:com|in|eu|ca|com\.au)$/.test(developmentHost),
  'INVALID_RUNTIME_CONFIGURATION', 'FREE_TEST_DEVELOPMENT_HOST must be the exact private Development Advanced I/O host.', { httpStatus: 503 });
  return Object.freeze({
    ...shared,
    retellVerificationKey,
    numberSecret,
    readinessToken,
    inboundPath,
    eventsPath,
    readinessPath,
    developmentHost,
    maxSignatureAgeMs: exactInteger(env, 'RETELL_SIGNATURE_MAX_AGE_MS', 300_000),
    maxRequestBodyBytes: integer(Number(required(env, 'MAX_WEBHOOK_BYTES', { maximum: 10 })), 'MAX_WEBHOOK_BYTES', 1024, 262_144),
    inboundBodyTimeoutMs: integer(Number(required(env, 'INBOUND_BODY_TIMEOUT_MS', { maximum: 10 })), 'INBOUND_BODY_TIMEOUT_MS', 250, 5000),
  });
}

function loadJobConfig(env = process.env) {
  const shared = loadSharedConfig(env);
  return Object.freeze({
    ...shared,
    retryJobPoolId: patterned(
      required(env, 'FREE_TEST_RETRY_JOB_POOL_ID', { maximum: 30 }),
      'FREE_TEST_RETRY_JOB_POOL_ID',
      /^[0-9]{1,30}$/,
      'must be the exact numeric Development Function Job pool ID',
    ),
  });
}

module.exports = { loadConfig, loadJobConfig, TABLE_VARIABLES, APPROVED_TABLES };
