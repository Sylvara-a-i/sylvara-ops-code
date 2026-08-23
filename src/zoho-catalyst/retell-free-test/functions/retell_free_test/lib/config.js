'use strict';

const { validateSourceRevision, integer } = require('./validation');
const { invariant } = require('./errors');

const TABLE_VARIABLES = Object.freeze([
  'DEPLOYMENT_TABLE',
  'CONFIGURATION_TABLE',
  'NUMBER_ASSIGNMENT_TABLE',
  'ADMISSION_SLOT_TABLE',
  'ADMISSION_RECORD_TABLE',
  'EVENT_RECEIPT_TABLE',
  'CANONICAL_CALL_TABLE',
  'NOTIFICATION_TABLE',
  'REPORTING_OUTBOX_TABLE',
]);

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

function loadConfig(env = process.env) {
  const environment = required(env, 'DEPLOYMENT_ENVIRONMENT', { maximum: 20 });
  invariant(environment === 'development', 'PRODUCTION_BLOCKED', 'This package may run only in Development.', { httpStatus: 503 });
  const sourceRevision = validateSourceRevision(required(env, 'SOURCE_REVISION', { maximum: 40 }));
  const retellVerificationKey = patterned(
    required(env, 'RETELL_WEBHOOK_API_KEY', { minimum: 24, maximum: 4096, trim: false }),
    'RETELL_WEBHOOK_API_KEY',
    /^\S{24,4096}$/,
    'must be 24-4096 non-whitespace characters',
  );
  const admissionSecret = required(env, 'ADMISSION_HMAC_SECRET', { minimum: 32, maximum: 4096, trim: false });
  const eventSecret = required(env, 'EVENT_HMAC_SECRET', { minimum: 32, maximum: 4096, trim: false });
  const numberSecret = required(env, 'NUMBER_LOOKUP_HMAC_SECRET', { minimum: 32, maximum: 4096, trim: false });
  for (const [name, secret] of [
    ['ADMISSION_HMAC_SECRET', admissionSecret],
    ['EVENT_HMAC_SECRET', eventSecret],
    ['NUMBER_LOOKUP_HMAC_SECRET', numberSecret],
  ]) patterned(secret, name, /^\S{32,4096}$/, 'must be 32-4096 non-whitespace characters');
  invariant(new Set([retellVerificationKey, admissionSecret, eventSecret, numberSecret]).size === 4,
    'INVALID_RUNTIME_CONFIGURATION', 'Webhook and keyed-identifier secrets must be distinct.', { httpStatus: 503 });
  const tables = {};
  for (const variable of TABLE_VARIABLES) {
    const table = required(env, variable, { maximum: 128 });
    invariant(!/^<.*>$/.test(table), 'INVALID_RUNTIME_CONFIGURATION', `${variable} still contains a placeholder.`, { httpStatus: 503 });
    tables[variable] = patterned(table, variable, /^[A-Za-z][A-Za-z0-9_]{0,63}$/, 'must be a Catalyst table API name');
  }
  invariant(new Set(Object.values(tables)).size === TABLE_VARIABLES.length,
    'INVALID_RUNTIME_CONFIGURATION', 'Each durable entity must use a distinct table.', { httpStatus: 503 });
  const inboundPath = required(env, 'RETELL_INBOUND_PATH', { maximum: 80 });
  const eventsPath = required(env, 'RETELL_EVENTS_PATH', { maximum: 80 });
  invariant(inboundPath === '/retell/inbound' && eventsPath === '/retell/events',
    'INVALID_RUNTIME_CONFIGURATION', 'Webhook paths must match the reviewed contract.', { httpStatus: 503 });
  const notificationMode = required(env, 'NOTIFICATION_MODE', { maximum: 30 });
  const analyticsMode = required(env, 'ANALYTICS_MODE', { maximum: 30 });
  const crmMode = required(env, 'CRM_SUMMARY_MODE', { maximum: 30 });
  invariant(notificationMode === 'synthetic', 'PRODUCTION_BLOCKED', 'Only the synthetic notification adapter is supported.', { httpStatus: 503 });
  invariant(analyticsMode === 'synthetic', 'PRODUCTION_BLOCKED', 'Only the synthetic Analytics adapter is supported.', { httpStatus: 503 });
  invariant(crmMode === 'disabled', 'PRODUCTION_BLOCKED', 'CRM summary writes must remain disabled.', { httpStatus: 503 });
  return Object.freeze({
    environment,
    sourceRevision,
    retellVerificationKey,
    admissionSecret,
    eventSecret,
    numberSecret,
    sharedAgentId: patterned(
      required(env, 'RETELL_SHARED_AGENT_ID', { minimum: 8, maximum: 128, trim: false }),
      'RETELL_SHARED_AGENT_ID',
      /^[A-Za-z0-9_-]{8,128}$/,
      'has an invalid format',
    ),
    sharedAgentVersion: integer(Number(required(env, 'RETELL_SHARED_AGENT_VERSION', { maximum: 10 })), 'RETELL_SHARED_AGENT_VERSION', 0, 100_000),
    inboundPath,
    eventsPath,
    maxSignatureAgeMs: exactInteger(env, 'RETELL_SIGNATURE_MAX_AGE_MS', 300_000),
    maxRequestBodyBytes: integer(Number(required(env, 'MAX_WEBHOOK_BYTES', { maximum: 10 })), 'MAX_WEBHOOK_BYTES', 1024, 262_144),
    inboundBodyTimeoutMs: integer(Number(required(env, 'INBOUND_BODY_TIMEOUT_MS', { maximum: 10 })), 'INBOUND_BODY_TIMEOUT_MS', 250, 5000),
    platformTimeoutMs: integer(Number(required(env, 'PLATFORM_OPERATION_TIMEOUT_MS', { maximum: 10 })), 'PLATFORM_OPERATION_TIMEOUT_MS', 250, 5000),
    notificationMaxAttempts: integer(Number(required(env, 'NOTIFICATION_MAX_ATTEMPTS', { maximum: 3 })), 'NOTIFICATION_MAX_ATTEMPTS', 3, 3),
    notificationMode,
    analyticsMode,
    crmMode,
    tables: Object.freeze(tables),
  });
}

module.exports = { loadConfig, TABLE_VARIABLES };
