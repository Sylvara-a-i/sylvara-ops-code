'use strict';

const { validateSourceRevision, integer } = require('./validation');
const { invariant } = require('./errors');
const { ARTIFACT_SOURCE_REVISION, assertArtifactSourceRevision } = require('./source-revision');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WORKER_JOB_POOL_NAME = 'RevenueDeskCallJobs';
const WORKER_TARGET_NAME = 'revenue_desk_call_worker';

const TABLE_VARIABLES = Object.freeze([
  'DEPLOYMENT_TABLE',
  'CONFIGURATION_VERSION_TABLE',
  'EVENT_RECEIPT_TABLE',
  'CANONICAL_CALL_TABLE',
  'NOTIFICATION_TABLE',
  'ANALYTICS_OUTBOX_TABLE',
  'OPERATION_TABLE',
]);

const APPROVED_TABLES = Object.freeze({
  DEPLOYMENT_TABLE: 'RevenueDeskDeployments',
  CONFIGURATION_VERSION_TABLE: 'RevenueDeskConfigurationVersions',
  EVENT_RECEIPT_TABLE: 'RevenueDeskEventReceipts',
  CANONICAL_CALL_TABLE: 'RevenueDeskCalls',
  NOTIFICATION_TABLE: 'RevenueDeskNotifications',
  ANALYTICS_OUTBOX_TABLE: 'AnalyticsSyncOutbox',
  OPERATION_TABLE: 'CRMBillingOperations',
});

function required(env, name, options = {}) {
  const value = env[name];
  invariant(typeof value === 'string' && value.length > 0,
    'INVALID_RUNTIME_CONFIGURATION', `${name} is required.`, { httpStatus: 503 });
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
  invariant(pattern.test(value), 'INVALID_RUNTIME_CONFIGURATION',
    `${name} ${message}.`, { httpStatus: 503 });
  return value;
}

function runtimeSecret(env, name, options) {
  const value = required(env, name, { ...options, trim: false });
  invariant(!/^<[^<>]+>$/.test(value)
    && !/^(?:change[-_ ]?me|replace[-_ ]?me|placeholder)$/i.test(value),
  'INVALID_RUNTIME_CONFIGURATION', `${name} contains a public placeholder.`, { httpStatus: 503 });
  return value;
}

function runtimeHost(env, environment) {
  const host = required(env, 'REVENUE_DESK_RUNTIME_HOST', { maximum: 253 }).toLowerCase();
  invariant(!/^<.*>$/.test(host)
    && /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(host),
  'INVALID_RUNTIME_CONFIGURATION', 'REVENUE_DESK_RUNTIME_HOST is invalid.', { httpStatus: 503 });
  const catalystHost = /(?:^|\.)(?:catalystserverless|zohocatalyst)\.(?:com|in|eu|ca|com\.au)$/.test(host);
  const runtimeHost = host.includes('.development.');
  invariant(catalystHost
    && (environment === 'development' ? runtimeHost : !runtimeHost),
  'INVALID_RUNTIME_CONFIGURATION',
  'REVENUE_DESK_RUNTIME_HOST does not match the configured Catalyst environment.',
  { httpStatus: 503 });
  return host;
}

function loadCrmDispatcherConfig(env) {
  const host = required(env, 'CRM_BILLING_ORCHESTRATOR_HOST', { maximum: 253 }).toLowerCase();
  const rawUrl = runtimeSecret(env, 'CRM_BILLING_ORCHESTRATOR_URL', {
    minimum: 12, maximum: 2048,
  });
  let endpoint;
  try { endpoint = new URL(rawUrl); } catch (_) { endpoint = null; }
  invariant(endpoint && endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password
    && !endpoint.port && !endpoint.search && !endpoint.hash && endpoint.hostname === host
    && endpoint.pathname.startsWith('/') && endpoint.pathname.length > 1
    && /(?:^|\.)development\.(?:catalystserverless|zohocatalyst)\.(?:com|in|eu|ca|com\.au)$/.test(host),
  'INVALID_RUNTIME_CONFIGURATION', 'CRM Billing dispatcher endpoint is invalid.',
  { httpStatus: 503 });
  const sharedHeaderName = required(env, 'CRM_BILLING_SHARED_HEADER_NAME', {
    maximum: 80,
  }).toLowerCase();
  invariant(/^x-[a-z0-9-]{1,77}$/.test(sharedHeaderName)
    && !new Set(['x-zcfkey', 'x-api-key']).has(sharedHeaderName),
  'INVALID_RUNTIME_CONFIGURATION', 'CRM Billing shared header name is invalid.',
  { httpStatus: 503 });
  const apiGatewayKey = runtimeSecret(env, 'CRM_BILLING_API_GATEWAY_KEY', {
    minimum: 16, maximum: 4096,
  });
  const sharedHeaderValue = runtimeSecret(env, 'CRM_BILLING_SHARED_HEADER_VALUE', {
    minimum: 32, maximum: 4096,
  });
  invariant(apiGatewayKey !== sharedHeaderValue,
    'INVALID_RUNTIME_CONFIGURATION', 'CRM Billing dispatcher secrets must be distinct.',
    { httpStatus: 503 });
  return Object.freeze({
    crmBillingOrchestratorHost: host,
    crmBillingOrchestratorUrl: endpoint.toString(),
    crmBillingApiGatewayKey: apiGatewayKey,
    crmBillingSharedHeaderName: sharedHeaderName,
    crmBillingSharedHeaderValue: sharedHeaderValue,
    crmBillingDispatchTimeoutMs: integer(
      Number(required(env, 'CRM_BILLING_DISPATCH_TIMEOUT_MS', { maximum: 10 })),
      'CRM_BILLING_DISPATCH_TIMEOUT_MS', 250, 5000,
    ),
  });
}

function loadIdentityConfig(env, options = {}) {
  const environment = required(env, 'DEPLOYMENT_ENVIRONMENT', { maximum: 20 });
  invariant(environment === 'development' || environment === 'production',
    'INVALID_RUNTIME_CONFIGURATION', 'DEPLOYMENT_ENVIRONMENT is invalid.', { httpStatus: 503 });
  const deploymentMode = required(env, 'DEPLOYMENT_MODE', { maximum: 20 });
  invariant((environment === 'development' && deploymentMode === 'active')
    || (environment === 'production' && deploymentMode === 'dark'),
  'INVALID_RUNTIME_CONFIGURATION', 'DEPLOYMENT_MODE is invalid for this environment.',
  { httpStatus: 503 });
  const configuredRevision = validateSourceRevision(
    required(env, 'SOURCE_REVISION', { maximum: 40 }),
  );
  const sourceRevision = assertArtifactSourceRevision(
    configuredRevision,
    options.artifactSourceRevision === undefined
      ? ARTIFACT_SOURCE_REVISION : options.artifactSourceRevision,
  );
  return Object.freeze({ environment, deploymentMode, sourceRevision });
}

function loadSharedConfig(env, options = {}) {
  const identity = loadIdentityConfig(env, options);
  invariant(identity.environment === 'development' && identity.deploymentMode === 'active',
    'PRODUCTION_DARK', 'Production runtime is dark and has no traffic configuration.',
    { httpStatus: 503 });
  invariant(required(env, 'ZOHO_CATALYST_ZCQL_PARSER', { maximum: 2 }) === 'V2',
    'INVALID_RUNTIME_CONFIGURATION', 'Catalyst ZCQL V2 must be enabled.', { httpStatus: 503 });
  const eventSecret = patterned(
    runtimeSecret(env, 'EVENT_HMAC_SECRET', { minimum: 32, maximum: 4096 }),
    'EVENT_HMAC_SECRET', /^\S{32,4096}$/, 'must be 32-4096 non-whitespace characters',
  );
  const analyticsPartitionSecret = patterned(
    runtimeSecret(env, 'ANALYTICS_PARTITION_HMAC_SECRET', { minimum: 32, maximum: 256 }),
    'ANALYTICS_PARTITION_HMAC_SECRET', /^\S{32,256}$/,
    'must be 32-256 non-whitespace characters',
  );
  invariant(analyticsPartitionSecret !== eventSecret,
    'INVALID_RUNTIME_CONFIGURATION',
    'Analytics partition and runtime event secrets must be distinct.', { httpStatus: 503 });
  const tables = {};
  for (const variable of TABLE_VARIABLES) {
    const table = required(env, variable, { maximum: 128 });
    invariant(!/^<.*>$/.test(table), 'INVALID_RUNTIME_CONFIGURATION',
      `${variable} still contains a placeholder.`, { httpStatus: 503 });
    tables[variable] = patterned(table, variable, /^[A-Za-z][A-Za-z0-9_]{0,63}$/,
      'must be a Catalyst table API name');
    invariant(table === APPROVED_TABLES[variable], 'INVALID_RUNTIME_CONFIGURATION',
      `${variable} must use the canonical Revenue Desk table name.`, { httpStatus: 503 });
  }
  invariant(new Set(Object.values(tables)).size === TABLE_VARIABLES.length,
    'INVALID_RUNTIME_CONFIGURATION', 'Each durable entity must use a distinct table.',
    { httpStatus: 503 });
  const mailMode = required(env, 'REVENUE_DESK_NOTIFICATION_MODE', { maximum: 30 });
  invariant(new Set(['dry_run', 'send_development']).has(mailMode)
    && identity.environment === 'development',
  'PRODUCTION_BLOCKED', 'Catalyst Mail mode is not approved for this environment.',
  { httpStatus: 503 });
  const mailFrom = required(env, 'REVENUE_DESK_MAIL_FROM', { maximum: 254 });
  invariant(EMAIL_PATTERN.test(mailFrom), 'INVALID_RUNTIME_CONFIGURATION',
    'REVENUE_DESK_MAIL_FROM must be a valid configured Catalyst Mail sender.',
    { httpStatus: 503 });
  return Object.freeze({
    ...identity,
    eventSecret,
    analyticsPartitionSecret,
    sharedAgentId: patterned(
      required(env, 'RETELL_SHARED_AGENT_ID', { minimum: 8, maximum: 128, trim: false }),
      'RETELL_SHARED_AGENT_ID', /^[A-Za-z0-9_-]{8,128}$/, 'has an invalid format',
    ),
    sharedAgentVersion: integer(
      Number(required(env, 'RETELL_SHARED_AGENT_VERSION', { maximum: 10 })),
      'RETELL_SHARED_AGENT_VERSION', 0, 100_000,
    ),
    projectId: patterned(
      required(env, 'REVENUE_DESK_PROJECT_ID', { maximum: 30 }),
      'REVENUE_DESK_PROJECT_ID', /^[0-9]{1,30}$/,
      'must be the exact numeric Catalyst project ID',
    ),
    platformTimeoutMs: integer(
      Number(required(env, 'PLATFORM_OPERATION_TIMEOUT_MS', { maximum: 10 })),
      'PLATFORM_OPERATION_TIMEOUT_MS', 250, 5000,
    ),
    mailMode,
    mailFrom,
    mailTimeoutMs: integer(
      Number(required(env, 'REVENUE_DESK_MAIL_TIMEOUT_MS', { maximum: 10 })),
      'REVENUE_DESK_MAIL_TIMEOUT_MS', 250, 5000,
    ),
    notificationMaxAttempts: exactInteger(env, 'REVENUE_DESK_NOTIFICATION_MAX_ATTEMPTS', 3),
    tables: Object.freeze(tables),
  });
}

function loadConfig(env = process.env, options = {}) {
  const identity = loadIdentityConfig(env, options);
  if (identity.deploymentMode === 'dark') return identity;
  const shared = loadSharedConfig(env, options);
  const retellVerificationKey = patterned(
    runtimeSecret(env, 'RETELL_WEBHOOK_API_KEY', { minimum: 24, maximum: 4096 }),
    'RETELL_WEBHOOK_API_KEY', /^\S{24,4096}$/,
    'must be 24-4096 non-whitespace characters',
  );
  const numberSecret = patterned(
    runtimeSecret(env, 'NUMBER_LOOKUP_HMAC_SECRET', { minimum: 32, maximum: 4096 }),
    'NUMBER_LOOKUP_HMAC_SECRET', /^\S{32,4096}$/,
    'must be 32-4096 non-whitespace characters',
  );
  const readinessToken = patterned(
    runtimeSecret(env, 'INTERNAL_READINESS_TOKEN', { minimum: 32, maximum: 256 }),
    'INTERNAL_READINESS_TOKEN', /^\S{32,256}$/,
    'must be 32-256 non-whitespace characters',
  );
  invariant(new Set([
    retellVerificationKey, shared.eventSecret, shared.analyticsPartitionSecret,
    numberSecret, readinessToken,
  ]).size === 5,
  'INVALID_RUNTIME_CONFIGURATION', 'Webhook and keyed-identifier secrets must be distinct.',
  { httpStatus: 503 });
  const inboundPath = required(env, 'RETELL_INBOUND_PATH', { maximum: 80 });
  const eventsPath = required(env, 'RETELL_EVENTS_PATH', { maximum: 80 });
  const readinessPath = required(env, 'INTERNAL_READINESS_PATH', { maximum: 80 });
  invariant(inboundPath === '/retell/inbound' && eventsPath === '/retell/events'
    && readinessPath === '/internal/readiness',
  'INVALID_RUNTIME_CONFIGURATION', 'Webhook paths must match the reviewed contract.',
  { httpStatus: 503 });
  return Object.freeze({
    ...shared,
    retellVerificationKey,
    numberSecret,
    readinessToken,
    inboundPath,
    eventsPath,
    readinessPath,
    runtimeHost: runtimeHost(env, shared.environment),
    workerJobPoolName: WORKER_JOB_POOL_NAME,
    workerTargetName: WORKER_TARGET_NAME,
    maxSignatureAgeMs: exactInteger(env, 'RETELL_SIGNATURE_MAX_AGE_MS', 300_000),
    maxRequestBodyBytes: integer(
      Number(required(env, 'MAX_WEBHOOK_BYTES', { maximum: 10 })),
      'MAX_WEBHOOK_BYTES', 1024, 262_144,
    ),
    inboundBodyTimeoutMs: integer(
      Number(required(env, 'INBOUND_BODY_TIMEOUT_MS', { maximum: 10 })),
      'INBOUND_BODY_TIMEOUT_MS', 250, 5000,
    ),
  });
}

function loadJobConfig(env = process.env, options = {}) {
  const identity = loadIdentityConfig(env, options);
  if (identity.deploymentMode === 'dark') return identity;
  const shared = loadSharedConfig(env, options);
  return Object.freeze({
    ...shared,
    ...loadCrmDispatcherConfig(env),
    workerJobPoolId: patterned(
      required(env, 'REVENUE_DESK_WORKER_JOB_POOL_ID', { maximum: 30 }),
      'REVENUE_DESK_WORKER_JOB_POOL_ID', /^[0-9]{1,30}$/,
      'must be the exact numeric Function Job pool ID',
    ),
    workerJobPoolName: WORKER_JOB_POOL_NAME,
    workerTargetName: WORKER_TARGET_NAME,
  });
}

module.exports = {
  loadConfig,
  loadJobConfig,
  loadIdentityConfig,
  TABLE_VARIABLES,
  APPROVED_TABLES,
  WORKER_JOB_POOL_NAME,
  WORKER_TARGET_NAME,
};
