'use strict';

const { invariant } = require('./errors');
const { ARTIFACT_SOURCE_REVISION } = require('./source-revision');

const REVISION_PATTERN = /^[a-f0-9]{40}$/;
const PLATFORM_ID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;
const CONNECTION_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;
const TABLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const ANALYTICS_HOSTS = new Set([
  'analyticsapi.zoho.com',
  'analyticsapi.zoho.eu',
  'analyticsapi.zoho.in',
  'analyticsapi.zoho.com.au',
  'analyticsapi.zoho.jp',
  'analyticsapi.zoho.ca',
  'analyticsapi.zoho.com.cn',
  'analyticsapi.zoho.sa',
]);
const RECORD_TYPES = Object.freeze([
  'deployment', 'call', 'daily_metric', 'final_test_result', 'conversion_status',
]);
const TARGET_TABLE_NAMES = Object.freeze({
  deployment: 'RevenueDeskAnalyticsDeploymentFacts',
  call: 'RevenueDeskAnalyticsCallFacts',
  daily_metric: 'RevenueDeskAnalyticsDailyMetricFacts',
  final_test_result: 'RevenueDeskAnalyticsFinalTestResultFacts',
  conversion_status: 'RevenueDeskAnalyticsConversionStatusFacts',
});

function required(environment, name) {
  const value = environment[name];
  invariant(typeof value === 'string' && value.trim() !== '', 'CONFIG_MISSING',
    `Required runtime variable ${name} is missing.`);
  return value.trim();
}

function boundedInteger(environment, name, fallback, minimum, maximum) {
  const raw = environment[name] === undefined || environment[name] === ''
    ? String(fallback) : String(environment[name]);
  invariant(/^\d+$/.test(raw), 'CONFIG_INVALID', `${name} must be a bounded integer.`);
  const value = Number(raw);
  invariant(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    'CONFIG_INVALID', `${name} is outside the approved bound.`);
  return value;
}

function parseRetryDelays(environment, maximumAttempts) {
  const values = (environment.ANALYTICS_RETRY_DELAYS_SECONDS || '60,300,1800')
    .split(',').map((value) => value.trim());
  invariant(values.length >= 1 && values.length <= maximumAttempts,
    'CONFIG_INVALID', 'Analytics retry delay count is invalid.');
  const parsed = values.map((value) => {
    invariant(/^\d+$/.test(value), 'CONFIG_INVALID', 'Analytics retry delays are invalid.');
    const seconds = Number(value);
    invariant(Number.isSafeInteger(seconds) && seconds >= 10 && seconds <= 86400,
      'CONFIG_INVALID', 'Analytics retry delay is outside the approved bound.');
    return seconds * 1000;
  });
  invariant(parsed.every((value, index) => index === 0 || value > parsed[index - 1]),
    'CONFIG_INVALID', 'Analytics retry delays must increase strictly.');
  return Object.freeze(parsed);
}

function analyticsHost(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    invariant(false, 'CONFIG_INVALID', 'Analytics API base URL is invalid.');
  }
  invariant(parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port
    && parsed.pathname === '/' && parsed.search === '' && parsed.hash === ''
    && ANALYTICS_HOSTS.has(parsed.hostname),
  'CONFIG_INVALID', 'Analytics API base URL must be a regional Zoho Analytics HTTPS origin.');
  return parsed.origin;
}

function parseTargets(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    invariant(false, 'CONFIG_INVALID', 'Analytics target map is invalid JSON.');
  }
  invariant(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...RECORD_TYPES].sort().join(','),
  'CONFIG_INVALID', 'Analytics target map must contain exactly the approved record types.');
  const targets = {};
  for (const recordType of RECORD_TYPES) {
    const target = value[recordType];
    invariant(target && typeof target === 'object' && !Array.isArray(target)
      && Object.keys(target).sort().join(',') === 'table,view_id'
      && TABLE_PATTERN.test(target.table) && target.table === TARGET_TABLE_NAMES[recordType]
      && /^\d{3,30}$/.test(String(target.view_id)),
    'CONFIG_INVALID', 'Analytics target binding is invalid.');
    targets[recordType] = Object.freeze({ table: target.table, viewId: String(target.view_id) });
  }
  invariant(new Set(Object.values(targets).map((target) => target.viewId)).size
    === RECORD_TYPES.length, 'CONFIG_INVALID',
  'Analytics target view IDs must be unique across the approved record types.');
  return Object.freeze(targets);
}

function loadConfig(environment = process.env, artifactRevision = ARTIFACT_SOURCE_REVISION) {
  const runtimeEnvironment = required(environment, 'DEPLOYMENT_ENVIRONMENT');
  invariant(runtimeEnvironment === 'development' || runtimeEnvironment === 'production',
    'CONFIG_INVALID', 'Deployment environment must be development or production.');
  const catalystEnvironment = runtimeEnvironment === 'production' ? 'Production' : 'Development';
  const sourceRevision = required(environment, 'SOURCE_REVISION');
  invariant(REVISION_PATTERN.test(sourceRevision), 'CONFIG_INVALID', 'Source revision is invalid.');
  invariant(REVISION_PATTERN.test(artifactRevision), 'CONFIG_INVALID',
    'Analytics function artifact is not stamped with an approved source revision.');
  invariant(sourceRevision === artifactRevision, 'SOURCE_REVISION_MISMATCH',
    'SOURCE_REVISION does not match the stamped Analytics function artifact.');
  const mode = required(environment, 'ANALYTICS_SYNC_MODE');
  invariant(new Set(['disabled', 'readiness', 'active']).has(mode),
    'CONFIG_INVALID', 'Analytics sync mode is invalid.');
  invariant(runtimeEnvironment !== 'production' || mode !== 'active', 'PRODUCTION_BLOCKED',
    'Production Analytics writes are code-blocked.');
  const expectedProjectId = required(environment, 'EXPECTED_CATALYST_PROJECT_ID');
  const jobPoolId = required(environment, 'ANALYTICS_JOB_POOL_ID');
  invariant(PLATFORM_ID_PATTERN.test(expectedProjectId) && PLATFORM_ID_PATTERN.test(jobPoolId),
    'CONFIG_INVALID', 'Catalyst project or Job pool identity is invalid.');
  const identity = {
    environment: runtimeEnvironment,
    catalystEnvironment,
    sourceRevision,
    mode,
    expectedProjectId,
    jobPoolId,
  };
  // Production is intentionally dark. Return before parsing any Data Store, Connection,
  // provider, retry, or timeout setting so a dark deployment has no active-system dependency.
  if (runtimeEnvironment === 'production') {
    return Object.freeze({ ...identity, tables: null, provider: null });
  }
  const checkpointTable = required(environment, 'ANALYTICS_CHECKPOINT_TABLE');
  const outboxTable = required(environment, 'ANALYTICS_OUTBOX_TABLE');
  invariant(checkpointTable === 'AnalyticsSyncCheckpoints'
    && outboxTable === 'AnalyticsSyncOutbox', 'CONFIG_INVALID',
  'Analytics tables must use the canonical names.');
  const maxAttempts = boundedInteger(environment, 'ANALYTICS_MAX_ATTEMPTS', 4, 1, 8);
  const base = {
    ...identity,
    tables: Object.freeze({ checkpoint: checkpointTable, outbox: outboxTable }),
    maxBatchSize: boundedInteger(environment, 'ANALYTICS_MAX_BATCH_SIZE', 25, 1, 100),
    maxRollupCalls: boundedInteger(environment, 'ANALYTICS_MAX_ROLLUP_CALLS', 250, 1, 1000),
    leaseMs: boundedInteger(environment, 'ANALYTICS_LEASE_SECONDS', 120, 30, 600) * 1000,
    maxAttempts,
    maxPollCount: boundedInteger(environment, 'ANALYTICS_MAX_POLL_COUNT', 20, 1, 60),
    retryDelaysMs: parseRetryDelays(environment, maxAttempts),
    pollDelayMs: boundedInteger(environment, 'ANALYTICS_POLL_DELAY_SECONDS', 30, 10, 300) * 1000,
    staleAfterMs: boundedInteger(environment, 'ANALYTICS_STALE_AFTER_SECONDS', 7200, 300, 86400) * 1000,
    platformTimeoutMs: boundedInteger(environment, 'PLATFORM_OPERATION_TIMEOUT_MS', 10000, 1000, 30000),
    analyticsTimeoutMs: boundedInteger(environment, 'ANALYTICS_OPERATION_TIMEOUT_MS', 20000, 1000, 60000),
    responseMaxBytes: boundedInteger(environment, 'ANALYTICS_RESPONSE_MAX_BYTES', 1048576, 1024, 5242880),
  };
  if (mode !== 'active') return Object.freeze({ ...base, provider: null });
  invariant(runtimeEnvironment === 'development', 'PRODUCTION_BLOCKED',
    'Only Development may activate Analytics synchronization.');
  const readConnection = required(environment, 'ANALYTICS_READ_CONNECTION_LINK_NAME');
  const writeConnection = required(environment, 'ANALYTICS_WRITE_CONNECTION_LINK_NAME');
  invariant(CONNECTION_PATTERN.test(readConnection) && CONNECTION_PATTERN.test(writeConnection)
    && readConnection !== writeConnection, 'CONFIG_INVALID',
  'Analytics read and write Connections must be separate valid link names.');
  const organizationId = required(environment, 'ANALYTICS_ORGANIZATION_ID');
  const workspaceId = required(environment, 'ANALYTICS_WORKSPACE_ID');
  invariant(/^\d{3,30}$/.test(organizationId) && /^\d{3,30}$/.test(workspaceId),
    'CONFIG_INVALID', 'Analytics organization or workspace identity is invalid.');
  return Object.freeze({
    ...base,
    provider: Object.freeze({
      readConnection,
      writeConnection,
      apiBaseUrl: analyticsHost(required(environment, 'ANALYTICS_API_BASE_URL')),
      organizationId,
      workspaceId,
      targets: parseTargets(required(environment, 'ANALYTICS_TARGETS_JSON')),
      migrationEvidenceDigest: (() => {
        const digest = required(environment, 'ANALYTICS_MIGRATION_EVIDENCE_DIGEST');
        invariant(/^[a-f0-9]{64}$/.test(digest) && !/^0{64}$/.test(digest),
          'CONFIG_INVALID', 'Analytics migration evidence digest is invalid.');
        return digest;
      })(),
    }),
  });
}

module.exports = {
  ANALYTICS_HOSTS,
  loadConfig,
  RECORD_TYPES,
  REVISION_PATTERN,
  TABLE_PATTERN,
  TARGET_TABLE_NAMES,
};
