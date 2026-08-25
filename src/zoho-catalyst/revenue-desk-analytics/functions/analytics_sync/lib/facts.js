'use strict';

const crypto = require('node:crypto');
const { invariant } = require('./errors');
const { RECORD_TYPES, REVISION_PATTERN } = require('./config');

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_ENUM = /^[a-z][a-z0-9_]{0,63}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const DATE_UTC = /^\d{4}-\d{2}-\d{2}$/;
const FORBIDDEN_KEY = /(phone|email|name|address|transcript|recording|audio|secret|token|prompt|summary|payload|url)/i;
const LEASE_PROOF_COLUMN = 'LEASE_' + 'TOKEN';
const COMMON = Object.freeze({
  SCHEMA_VERSION: 'one', METRIC_VERSION: 'identifier', RECORD_KEY: 'hash', CLIENT_KEY: 'hash',
  DEPLOYMENT_KEY: 'hash', CONFIGURATION_VERSION: 'identifier', ENGAGEMENT_TYPE: 'engagement',
  ENVIRONMENT: 'environment', SOURCE_MODIFIED_AT: 'time', SOURCE_REVISION: 'revision',
});
const TYPE_FIELDS = Object.freeze({
  deployment: Object.freeze({
    CAPABILITY_PROFILE: 'enum', PLAN_TIER: 'enum', DEPLOYMENT_STATUS: 'enum',
    GO_LIVE_APPROVAL_STATUS: 'enum', LIMIT_POLICY: 'enum', BILLING_MODE: 'enum',
    COVERAGE_MODE: 'optional_enum', HANDLED_COUNT: 'nonnegative', CALL_LIMIT: 'positive',
    ACTUAL_START_AT: 'time', EXPIRES_AT: 'time', STOPPED_AT: 'optional_time',
    STOP_REASON: 'optional_enum',
  }),
  call: Object.freeze({
    CALL_KEY: 'hash', STARTED_AT: 'time', ENDED_AT: 'optional_time',
    DURATION_SECONDS: 'optional_nonnegative', CALL_STATUS: 'enum', OUTCOME: 'enum',
    URGENCY_CLASS: 'optional_enum', COVERAGE_MODE: 'optional_enum', HANDLED_RECORDED: 'boolean',
    BOOKABLE_OPPORTUNITY: 'optional_boolean', OFFICE_FOLLOW_UP_REQUIRED: 'optional_boolean',
    WORKFLOW_FAILURE_CODE: 'optional_enum', NOTIFICATION_STATE: 'optional_enum',
    VALUE_EVIDENCE_CLASS: 'optional_enum', VALUE_MINOR_UNITS: 'optional_nonnegative',
    VALUE_CURRENCY: 'optional_currency',
  }),
  daily_metric: Object.freeze({
    REPORTING_DATE_UTC: 'date', TOTAL_CALLS_HANDLED: 'nonnegative',
    QUALIFIED_OPPORTUNITIES: 'nonnegative', URGENT_REQUESTS: 'nonnegative',
    EXISTING_CUSTOMER_CALLS: 'nonnegative', WRONG_FIT_CALLS: 'nonnegative',
    SPAM_CALLS: 'nonnegative', UNRESOLVED_CALLS: 'nonnegative',
    BOOKABLE_OPPORTUNITIES: 'optional_nonnegative', OFFICE_FOLLOW_UP_CALLS: 'optional_nonnegative',
  }),
  final_test_result: Object.freeze({
    TEST_STARTED_AT: 'time', TEST_ENDED_AT: 'time', TEST_END_REASON: 'enum',
    CALLS_CAPTURED: 'nonnegative', CALL_LIMIT: 'positive', QUALIFIED_OPPORTUNITIES: 'nonnegative',
    URGENT_REQUESTS: 'nonnegative', EXISTING_CUSTOMER_CALLS: 'nonnegative',
    WRONG_FIT_CALLS: 'nonnegative', BOOKABLE_OPPORTUNITIES: 'optional_nonnegative',
    OFFICE_FOLLOW_UP_CALLS: 'optional_nonnegative', DURATION_EVIDENCE_COMPLETE: 'boolean',
    ANALYSIS_EVIDENCE_COMPLETE: 'boolean',
  }),
  conversion_status: Object.freeze({
    CRM_CONVERSION_STATUS: 'enum', BILLING_CONVERSION_STATUS: 'enum',
    RESULTS_REVIEW_STATUS: 'enum', PAID_ACCEPTANCE_STATUS: 'enum',
    TARGET_ENGAGEMENT_TYPE: 'engagement',
  }),
});

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value) {
  invariant(value && typeof value === 'object' && !Array.isArray(value),
    'FACT_INVALID', 'Analytics fact must be a flat object.');
  const ordered = {};
  for (const key of Object.keys(value).sort()) ordered[key] = value[key];
  return JSON.stringify(ordered);
}

function present(value) {
  return value !== null && value !== undefined;
}

function validateValue(kind, value, field) {
  const optional = kind.startsWith('optional_');
  const base = optional ? kind.slice('optional_'.length) : kind;
  if (!present(value)) {
    invariant(optional, 'FACT_INVALID', `Analytics fact field ${field} is required.`);
    return null;
  }
  if (base === 'one') invariant(value === 1, 'FACT_INVALID', `${field} must equal 1.`);
  else if (base === 'hash') invariant(typeof value === 'string' && HASH_PATTERN.test(value),
    'FACT_INVALID', `${field} must be an opaque SHA-256 key.`);
  else if (base === 'identifier') invariant(typeof value === 'string' && SAFE_IDENTIFIER.test(value),
    'FACT_INVALID', `${field} is not a safe identifier.`);
  else if (base === 'enum') invariant(typeof value === 'string' && SAFE_ENUM.test(value),
    'FACT_INVALID', `${field} is not a safe enum.`);
  else if (base === 'engagement') invariant(value === 'free_test' || value === 'paid_service',
    'FACT_INVALID', 'Engagement type is invalid.');
  else if (base === 'environment') invariant(value === 'development' || value === 'production',
    'FACT_INVALID', 'Fact environment is invalid.');
  else if (base === 'revision') invariant(typeof value === 'string' && REVISION_PATTERN.test(value),
    'FACT_INVALID', 'Fact source revision is invalid.');
  else if (base === 'time') invariant(typeof value === 'string' && ISO_UTC.test(value)
    && Number.isFinite(Date.parse(value)), 'FACT_INVALID', `${field} is not a UTC timestamp.`);
  else if (base === 'date') invariant(typeof value === 'string' && DATE_UTC.test(value),
    'FACT_INVALID', `${field} is not a UTC date.`);
  else if (base === 'boolean') invariant(typeof value === 'boolean',
    'FACT_INVALID', `${field} must be Boolean.`);
  else if (base === 'nonnegative') invariant(Number.isSafeInteger(value) && value >= 0,
    'FACT_INVALID', `${field} must be a nonnegative integer.`);
  else if (base === 'positive') invariant(Number.isSafeInteger(value) && value > 0,
    'FACT_INVALID', `${field} must be a positive integer.`);
  else if (base === 'currency') invariant(typeof value === 'string' && /^[A-Z]{3}$/.test(value),
    'FACT_INVALID', `${field} must be an ISO currency code.`);
  else invariant(false, 'FACT_INVALID', `Unknown fact validator for ${field}.`);
  return value;
}

function minimizeFact(recordType, candidate) {
  invariant(RECORD_TYPES.includes(recordType), 'FACT_INVALID', 'Analytics record type is invalid.');
  invariant(candidate && typeof candidate === 'object' && !Array.isArray(candidate),
    'FACT_INVALID', 'Analytics fact must be an object.');
  const contract = { ...COMMON, ...TYPE_FIELDS[recordType] };
  const keys = Object.keys(candidate);
  invariant(keys.every((key) => Object.hasOwn(contract, key) && !FORBIDDEN_KEY.test(key)),
    'FACT_PRIVACY_VIOLATION', 'Analytics fact contains an unapproved or sensitive field.');
  const result = {};
  for (const [field, kind] of Object.entries(contract)) {
    const value = validateValue(kind, candidate[field], field);
    if (value !== null) result[field] = value;
  }
  if (recordType === 'call') invariant(result.CALL_KEY === result.RECORD_KEY,
    'FACT_INVALID', 'Call record key must equal the opaque call key.');
  if (recordType === 'conversion_status') invariant(
    result.ENGAGEMENT_TYPE === 'free_test' && result.TARGET_ENGAGEMENT_TYPE === 'paid_service',
    'FACT_INVALID',
    'Conversion status must preserve the free-test origin and identify paid service as the target.',
  );
  invariant(result.SOURCE_MODIFIED_AT >= (result.STARTED_AT || result.ACTUAL_START_AT
    || result.TEST_STARTED_AT || `${result.REPORTING_DATE_UTC || '0000-00-00'}T00:00:00Z`),
  'FACT_INVALID', 'Fact source watermark precedes its source record.');
  const encoded = canonicalJson(result);
  invariant(Buffer.byteLength(encoded, 'utf8') <= 9000,
    'FACT_INVALID', 'Analytics fact exceeds the approved size.');
  return Object.freeze(result);
}

function outboxKey(recordType, fact) {
  const minimized = minimizeFact(recordType, fact);
  return sha256(`analytics-outbox-v2\0${recordType}\0${canonicalJson(minimized)}`);
}

function providerVersionKeyFromMinimized(recordType, fact) {
  return sha256([
    'analytics-provider-version-v1', recordType, fact.ENVIRONMENT,
    fact.CLIENT_KEY, fact.DEPLOYMENT_KEY, fact.RECORD_KEY, fact.SOURCE_MODIFIED_AT,
  ].join('\0'));
}

function providerVersionKey(recordType, fact) {
  return providerVersionKeyFromMinimized(recordType, minimizeFact(recordType, fact));
}

function sourceDateUtc(recordType, fact) {
  if (recordType === 'call') return fact.STARTED_AT.slice(0, 10);
  if (recordType === 'daily_metric') return fact.REPORTING_DATE_UTC;
  return fact.SOURCE_MODIFIED_AT.slice(0, 10);
}

function createOutboxRow(recordType, fact, createdAt) {
  const minimized = minimizeFact(recordType, fact);
  validateValue('time', createdAt, 'CREATED_AT');
  const payloadJson = canonicalJson(minimized);
  return Object.freeze({
    OUTBOX_KEY: sha256(`analytics-outbox-v2\0${recordType}\0${payloadJson}`),
    PROVIDER_VERSION_KEY: providerVersionKeyFromMinimized(recordType, minimized),
    ROW_SCHEMA_VERSION: 2,
    RECORD_TYPE: recordType,
    RECORD_KEY: minimized.RECORD_KEY,
    CLIENT_KEY: minimized.CLIENT_KEY,
    DEPLOYMENT_KEY: minimized.DEPLOYMENT_KEY,
    CONFIGURATION_VERSION: minimized.CONFIGURATION_VERSION,
    ENGAGEMENT_TYPE: minimized.ENGAGEMENT_TYPE,
    ENVIRONMENT: minimized.ENVIRONMENT,
    PAYLOAD_JSON: payloadJson,
    PAYLOAD_HASH: sha256(payloadJson),
    METRIC_VERSION: minimized.METRIC_VERSION,
    SOURCE_MODIFIED_AT: minimized.SOURCE_MODIFIED_AT,
    SOURCE_DATE_UTC: sourceDateUtc(recordType, minimized),
    SYNC_STATUS: 'Pending',
    BATCH_KEY: null,
    ATTEMPT_COUNT: 0,
    CLAIM_COUNT: 0,
    POLL_COUNT: 0,
    NEXT_ATTEMPT_AT: createdAt,
    LEASE_OWNER: null,
    [LEASE_PROOF_COLUMN]: null,
    LEASE_EXPIRES_AT: null,
    FENCE_VERSION: 0,
    PROVIDER_JOB_ID: null,
    PROVIDER_STATE: null,
    EXPECTED_ROW_COUNT: null,
    ACCEPTED_ROW_COUNT: null,
    REJECTED_ROW_COUNT: null,
    READBACK_JOB_ID: null,
    READBACK_ROW_COUNT: null,
    READBACK_WATERMARK: null,
    LAST_ERROR_CODE: null,
    LAST_ATTEMPT_AT: null,
    SUBMITTED_AT: null,
    RECONCILED_AT: null,
    CREATED_AT: createdAt,
    UPDATED_AT: createdAt,
    SOURCE_REVISION: minimized.SOURCE_REVISION,
  });
}

function integer(value, field) {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  invariant(Number.isSafeInteger(parsed) && parsed >= 0, 'OUTBOX_INVALID', `${field} is invalid.`);
  return parsed;
}

function parseOutboxRow(row, environment) {
  invariant(row && typeof row === 'object' && !Array.isArray(row),
    'OUTBOX_INVALID', 'Analytics outbox row is invalid.');
  invariant(row.ENVIRONMENT === environment, 'ENVIRONMENT_CONFLICT',
    'Analytics outbox row crosses environment isolation.');
  let candidate;
  try {
    candidate = JSON.parse(row.PAYLOAD_JSON);
  } catch {
    invariant(false, 'OUTBOX_INVALID', 'Analytics outbox payload is invalid JSON.');
  }
  const fact = minimizeFact(row.RECORD_TYPE, candidate);
  const payloadJson = canonicalJson(fact);
  invariant(row.PAYLOAD_JSON === payloadJson && row.PAYLOAD_HASH === sha256(payloadJson)
    && row.OUTBOX_KEY === sha256(`analytics-outbox-v2\0${row.RECORD_TYPE}\0${payloadJson}`),
  'DURABLE_IDEMPOTENCY_CONFLICT', 'Analytics outbox payload binding conflicts.');
  invariant(row.PROVIDER_VERSION_KEY
    === providerVersionKeyFromMinimized(row.RECORD_TYPE, fact),
  'DURABLE_IDEMPOTENCY_CONFLICT', 'Analytics provider-version binding conflicts.');
  for (const [column, field] of [
    ['RECORD_KEY', 'RECORD_KEY'], ['CLIENT_KEY', 'CLIENT_KEY'],
    ['DEPLOYMENT_KEY', 'DEPLOYMENT_KEY'], ['CONFIGURATION_VERSION', 'CONFIGURATION_VERSION'],
    ['ENGAGEMENT_TYPE', 'ENGAGEMENT_TYPE'], ['ENVIRONMENT', 'ENVIRONMENT'],
    ['METRIC_VERSION', 'METRIC_VERSION'], ['SOURCE_MODIFIED_AT', 'SOURCE_MODIFIED_AT'],
    ['SOURCE_REVISION', 'SOURCE_REVISION'],
  ]) invariant(row[column] === fact[field], 'DURABLE_IDEMPOTENCY_CONFLICT',
    'Analytics outbox ownership binding conflicts.');
  invariant(row.SOURCE_DATE_UTC === sourceDateUtc(row.RECORD_TYPE, fact),
    'DURABLE_IDEMPOTENCY_CONFLICT', 'Analytics outbox source-date binding conflicts.');
  invariant(Number(row.ROW_SCHEMA_VERSION) === 2, 'LEGACY_ROW_BLOCKED',
    'Analytics sync may claim only additive v2 outbox rows.');
  for (const field of ['NEXT_ATTEMPT_AT', 'CREATED_AT', 'UPDATED_AT']) {
    validateValue('time', row[field], field);
  }
  const statuses = new Set([
    'Pending', 'Claimed', 'Submitted', 'RetryRequired', 'ReconciliationRequired',
    'CheckpointPending', 'Succeeded', 'TerminalFailure',
  ]);
  invariant(statuses.has(row.SYNC_STATUS), 'OUTBOX_INVALID',
    'Analytics outbox sync status is invalid.');
  const optionalInteger = (column) => row[column] === null || row[column] === undefined
    ? null : integer(row[column], column);
  return Object.freeze({
    ...row,
    ATTEMPT_COUNT: integer(row.ATTEMPT_COUNT, 'ATTEMPT_COUNT'),
    CLAIM_COUNT: integer(row.CLAIM_COUNT, 'CLAIM_COUNT'),
    POLL_COUNT: integer(row.POLL_COUNT, 'POLL_COUNT'),
    FENCE_VERSION: integer(row.FENCE_VERSION, 'FENCE_VERSION'),
    EXPECTED_ROW_COUNT: optionalInteger('EXPECTED_ROW_COUNT'),
    ACCEPTED_ROW_COUNT: optionalInteger('ACCEPTED_ROW_COUNT'),
    REJECTED_ROW_COUNT: optionalInteger('REJECTED_ROW_COUNT'),
    READBACK_ROW_COUNT: optionalInteger('READBACK_ROW_COUNT'),
    fact,
  });
}

function targetRow(parsed) {
  return Object.freeze({ ...parsed.fact, PAYLOAD_HASH: parsed.PAYLOAD_HASH });
}

function makeBatchKey(rows) {
  invariant(Array.isArray(rows) && rows.length > 0, 'OUTBOX_INVALID', 'Analytics batch is empty.');
  const first = rows[0];
  const keys = rows.map((row) => row.OUTBOX_KEY).sort();
  const ordinal = Math.max(...rows.map((row) => Number(row.ATTEMPT_COUNT))) + 1;
  return sha256(`analytics-batch-v1\0${first.ENVIRONMENT}\0${first.RECORD_TYPE}\0${ordinal}\0${keys.join(',')}`);
}

function checkpointKey(row) {
  return sha256(['analytics-checkpoint-v2', row.ENVIRONMENT, row.RECORD_TYPE,
    row.CLIENT_KEY, row.DEPLOYMENT_KEY].join('\0'));
}

function checkpointRow(last, targetTableAlias, nowIso, staleAfterIso) {
  return Object.freeze({
    CHECKPOINT_KEY: checkpointKey(last),
    ROW_SCHEMA_VERSION: 2,
    RECORD_TYPE: last.RECORD_TYPE,
    TARGET_TABLE_ALIAS: targetTableAlias,
    CLIENT_KEY: last.CLIENT_KEY,
    DEPLOYMENT_KEY: last.DEPLOYMENT_KEY,
    ENVIRONMENT: last.ENVIRONMENT,
    LAST_SOURCE_MODIFIED_AT: last.SOURCE_MODIFIED_AT,
    LAST_RECORD_KEY: last.RECORD_KEY,
    PROVIDER_WATERMARK: last.SOURCE_MODIFIED_AT,
    LAST_PROVIDER_JOB_ID: last.PROVIDER_JOB_ID,
    LAST_ACCEPTED_ROW_COUNT: last.ACCEPTED_ROW_COUNT,
    LAST_REJECTED_ROW_COUNT: last.REJECTED_ROW_COUNT,
    STATUS: 'Healthy',
    STALE_AFTER_AT: staleAfterIso,
    LAST_ERROR_CODE: null,
    LAST_SYNC_AT: nowIso,
    LAST_RECONCILED_AT: nowIso,
    CREATED_AT: nowIso,
    UPDATED_AT: nowIso,
    SOURCE_REVISION: last.SOURCE_REVISION,
    METRIC_VERSION: last.METRIC_VERSION,
  });
}

function compareWatermark(left, right) {
  return left.SOURCE_MODIFIED_AT.localeCompare(right.SOURCE_MODIFIED_AT)
    || left.RECORD_KEY.localeCompare(right.RECORD_KEY);
}

module.exports = {
  canonicalJson, checkpointKey, checkpointRow, compareWatermark, createOutboxRow,
  makeBatchKey, minimizeFact, outboxKey, parseOutboxRow, providerVersionKey,
  sha256, sourceDateUtc, targetRow,
};
