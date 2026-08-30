'use strict';

const crypto = require('node:crypto');
const { invariant } = require('./errors');
const { keyedDigest } = require('./security');

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ROW_ID = /^\d{1,30}$/;
const OUTBOX_IMMUTABLE = Object.freeze([
  'OUTBOX_KEY', 'ROW_SCHEMA_VERSION', 'RECORD_TYPE',
  'RECORD_KEY', 'CLIENT_KEY',
  'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION', 'ENGAGEMENT_TYPE', 'ENVIRONMENT',
  'SOURCE_DATE_UTC', 'PAYLOAD_JSON', 'PAYLOAD_HASH', 'METRIC_VERSION',
  'SOURCE_MODIFIED_AT', 'SOURCE_REVISION',
]);

const FACT_TIMESTAMP_FIELDS = Object.freeze({
  call: Object.freeze({
    required: Object.freeze(['SOURCE_MODIFIED_AT', 'STARTED_AT']),
    optional: Object.freeze(['ENDED_AT']),
  }),
  deployment: Object.freeze({
    required: Object.freeze(['SOURCE_MODIFIED_AT', 'ACTUAL_START_AT', 'EXPIRES_AT']),
    optional: Object.freeze(['STOPPED_AT']),
  }),
  final_test_result: Object.freeze({
    required: Object.freeze(['SOURCE_MODIFIED_AT', 'TEST_STARTED_AT', 'TEST_ENDED_AT']),
    optional: Object.freeze([]),
  }),
});

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value) {
  const ordered = {};
  for (const key of Object.keys(value).sort()) ordered[key] = value[key];
  return JSON.stringify(ordered);
}

function utcTimestamp(value, field) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  invariant(typeof value === 'string' && ISO_UTC.test(value) && Number.isFinite(parsed),
    'ANALYTICS_FACT_INVALID',
    `Analytics fact ${field} is not an authoritative timestamp.`);
  const normalized = new Date(parsed).toISOString();
  const canonicalInput = value.includes('.') ? value : `${value.slice(0, -1)}.000Z`;
  invariant(normalized === canonicalInput, 'ANALYTICS_FACT_INVALID',
    `Analytics fact ${field} is not an authoritative timestamp.`);
  return normalized;
}

function normalizeFactTimestamps(recordType, fact) {
  const fields = FACT_TIMESTAMP_FIELDS[recordType];
  invariant(fields && fact && typeof fact === 'object' && !Array.isArray(fact),
    'ANALYTICS_FACT_INVALID', 'Runtime outbox fact is invalid.');
  const normalized = { ...fact };
  for (const field of fields.required) {
    invariant(Object.hasOwn(fact, field), 'ANALYTICS_FACT_INVALID',
      `Analytics fact ${field} is required.`);
    normalized[field] = utcTimestamp(fact[field], field);
  }
  for (const field of fields.optional) {
    if (fact[field] !== null && fact[field] !== undefined) {
      normalized[field] = utcTimestamp(fact[field], field);
    }
  }
  return Object.freeze(normalized);
}

function outboxKeyFromNormalized(recordType, fact) {
  return sha256([
    'analytics-provider-version-v1', recordType, fact.ENVIRONMENT,
    fact.CLIENT_KEY, fact.DEPLOYMENT_KEY, fact.RECORD_KEY, fact.SOURCE_MODIFIED_AT,
  ].join('\0'));
}

function outboxKey(recordType, fact) {
  return outboxKeyFromNormalized(recordType, normalizeFactTimestamps(recordType, fact));
}

function safeEnum(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function opaqueKeys(config, clientId, deploymentId) {
  return {
    CLIENT_KEY: keyedDigest(
      config.analyticsPartitionSecret, 'revenue-desk-analytics-client-v1', [clientId],
    ),
    DEPLOYMENT_KEY: keyedDigest(
      config.analyticsPartitionSecret, 'revenue-desk-analytics-deployment-v1', [deploymentId],
    ),
  };
}

function commonFact(config, row, recordKey) {
  return {
    SCHEMA_VERSION: 1,
    METRIC_VERSION: 'revenue_desk_runtime_v1',
    RECORD_KEY: recordKey,
    ...opaqueKeys(config, row.CLIENT_ID, row.DEPLOYMENT_ID),
    CONFIGURATION_VERSION: row.CONFIGURATION_VERSION_ID,
    ENGAGEMENT_TYPE: row.ENGAGEMENT_TYPE,
    ENVIRONMENT: row.SOURCE_ENVIRONMENT,
    SOURCE_MODIFIED_AT: row.UPDATED_AT,
    SOURCE_REVISION: row.SOURCE_REVISION,
  };
}

function callFact(config, row, canonical) {
  const callKey = /^call_([a-f0-9]{64})$/.exec(row.CALL_KEY)?.[1];
  invariant(callKey, 'ANALYTICS_FACT_INVALID', 'Canonical call key is invalid.');
  const fact = {
    ...commonFact(config, row, callKey),
    CALL_KEY: callKey,
    STARTED_AT: canonical.startedAt,
    CALL_STATUS: safeEnum(canonical.callStatus),
    OUTCOME: safeEnum(canonical.outcome),
    HANDLED_RECORDED: row.HANDLED_RECORDED === true,
  };
  if (canonical.endedAt) fact.ENDED_AT = canonical.endedAt;
  if (Number.isSafeInteger(canonical.durationMs) && canonical.durationMs % 1000 === 0) {
    fact.DURATION_SECONDS = canonical.durationMs / 1000;
  }
  for (const [field, value] of [
    ['URGENCY_CLASS', canonical.urgency],
    ['COVERAGE_MODE', canonical.coverageMode],
    ['WORKFLOW_FAILURE_CODE', canonical.workflowFailureCode],
    ['NOTIFICATION_STATE', row.NOTIFICATION_STATE],
    ['VALUE_EVIDENCE_CLASS', canonical.value?.evidenceClass],
  ]) if (typeof value === 'string' && value.length > 0) fact[field] = safeEnum(value);
  if (typeof canonical.value?.currency === 'string') {
    fact.VALUE_CURRENCY = canonical.value.currency;
  }
  for (const [field, value] of [
    ['BOOKABLE_OPPORTUNITY', canonical.bookableOpportunity],
    ['OFFICE_FOLLOW_UP_REQUIRED', canonical.officeFollowUpRequired],
  ]) if (typeof value === 'boolean') fact[field] = value;
  if (Number.isSafeInteger(canonical.value?.valueMinorUnits)
    && canonical.value.valueMinorUnits >= 0) fact.VALUE_MINOR_UNITS = canonical.value.valueMinorUnits;
  return Object.freeze(fact);
}

function deploymentFact(config, deployment, row) {
  // The registry gates whether a profile may run now; immutable version rows own historical
  // plan, limit, and billing attribution so later registry edits cannot rewrite old facts.
  invariant(typeof deployment.planTier === 'string'
    && typeof deployment.limitPolicy === 'string'
    && typeof deployment.billingMode === 'string'
    && typeof deployment.numberOwnership === 'string'
    && deployment.environment === row.SOURCE_ENVIRONMENT,
  'ANALYTICS_FACT_INVALID', 'Immutable deployment configuration is unavailable.');
  const recordKey = opaqueKeys(config, row.CLIENT_ID, row.DEPLOYMENT_ID).DEPLOYMENT_KEY;
  return Object.freeze({
    ...commonFact(config, {
      ...row,
      CONFIGURATION_VERSION_ID: deployment.configurationVersionId,
      ENGAGEMENT_TYPE: deployment.engagementType,
    }, recordKey),
    CAPABILITY_PROFILE: safeEnum(deployment.capabilityProfile),
    PLAN_TIER: safeEnum(deployment.planTier),
    DEPLOYMENT_STATUS: safeEnum(row.TEST_STATUS),
    GO_LIVE_APPROVAL_STATUS: safeEnum(row.GO_LIVE_APPROVAL_STATUS),
    LIMIT_POLICY: safeEnum(deployment.limitPolicy),
    BILLING_MODE: safeEnum(deployment.billingMode),
    COVERAGE_MODE: safeEnum(deployment.coverageMode),
    HANDLED_COUNT: Number(row.HANDLED_COUNT),
    CALL_LIMIT: Number(row.CALL_LIMIT),
    ACTUAL_START_AT: row.ACTUAL_START_AT,
    EXPIRES_AT: row.EXPIRES_AT,
    ...(row.STOPPED_AT ? { STOPPED_AT: row.STOPPED_AT } : {}),
    ...(row.STOP_REASON ? { STOP_REASON: safeEnum(row.STOP_REASON) } : {}),
  });
}

function finalTestResultFact(config, deployment, row, report) {
  invariant(deployment.engagementType === 'free_test'
    && report.engagementType === deployment.engagementType
    && report.deploymentId === deployment.deploymentId
    && report.clientId === deployment.clientId
    && report.configurationVersionId === deployment.configurationVersionId
    && report.configurationVersion === deployment.configurationVersion
    && report.capabilityProfile === deployment.capabilityProfile,
  'ANALYTICS_FACT_INVALID', 'Final test report ownership is not authoritative.');
  invariant(typeof report.testEnd === 'string' && typeof report.testEndReason === 'string'
    && typeof report.sourceModifiedAt === 'string'
    && Number.isFinite(Date.parse(report.sourceModifiedAt)),
    'ANALYTICS_FACT_INVALID', 'Final test result requires a terminal report.');
  const recordKey = opaqueKeys(config, row.CLIENT_ID, row.DEPLOYMENT_ID).DEPLOYMENT_KEY;
  const fact = {
    ...commonFact(config, {
      ...row,
      CONFIGURATION_VERSION_ID: deployment.configurationVersionId,
      ENGAGEMENT_TYPE: deployment.engagementType,
      UPDATED_AT: report.sourceModifiedAt,
    }, recordKey),
    METRIC_VERSION: 'revenue_desk_final_test_v1',
    TEST_STARTED_AT: report.testStart,
    TEST_ENDED_AT: report.testEnd,
    TEST_END_REASON: safeEnum(report.testEndReason),
    CALLS_CAPTURED: report.callsCaptured,
    CALL_LIMIT: report.callLimit,
    QUALIFIED_OPPORTUNITIES: report.qualifiedOpportunities,
    URGENT_REQUESTS: report.urgentRequests,
    EXISTING_CUSTOMER_CALLS: report.existingCustomerCalls,
    WRONG_FIT_CALLS: report.outOfAreaOrWrongFitCalls,
    DURATION_EVIDENCE_COMPLETE: report.durationEvidenceComplete,
    ANALYSIS_EVIDENCE_COMPLETE: report.structuredAnalysisComplete,
  };
  if (Number.isSafeInteger(report.bookableOpportunities)) {
    fact.BOOKABLE_OPPORTUNITIES = report.bookableOpportunities;
  }
  if (Number.isSafeInteger(report.officeFollowUpCalls)) {
    fact.OFFICE_FOLLOW_UP_CALLS = report.officeFollowUpCalls;
  }
  return Object.freeze(fact);
}

function createOutboxRow(recordType, fact, createdAt) {
  const normalizedFact = normalizeFactTimestamps(recordType, fact);
  const normalizedCreatedAt = utcTimestamp(createdAt, 'CREATED_AT');
  const payloadJson = canonicalJson(normalizedFact);
  invariant(Buffer.byteLength(payloadJson, 'utf8') <= 9000,
    'ANALYTICS_FACT_INVALID', 'Runtime outbox fact exceeds the bounded size.');
  const sourceDate = (recordType === 'call'
    ? normalizedFact.STARTED_AT : normalizedFact.SOURCE_MODIFIED_AT)
    .slice(0, 10);
  return Object.freeze({
    OUTBOX_KEY: outboxKeyFromNormalized(recordType, normalizedFact),
    ROW_SCHEMA_VERSION: 2, RECORD_TYPE: recordType, RECORD_KEY: normalizedFact.RECORD_KEY,
    CLIENT_KEY: normalizedFact.CLIENT_KEY, DEPLOYMENT_KEY: normalizedFact.DEPLOYMENT_KEY,
    CONFIGURATION_VERSION: normalizedFact.CONFIGURATION_VERSION,
    ENGAGEMENT_TYPE: normalizedFact.ENGAGEMENT_TYPE, ENVIRONMENT: normalizedFact.ENVIRONMENT,
    PAYLOAD_JSON: payloadJson, PAYLOAD_HASH: sha256(payloadJson),
    METRIC_VERSION: normalizedFact.METRIC_VERSION,
    SOURCE_MODIFIED_AT: normalizedFact.SOURCE_MODIFIED_AT,
    SOURCE_DATE_UTC: sourceDate,
    SYNC_STATUS: 'Pending', BATCH_KEY: null, ATTEMPT_COUNT: 0, CLAIM_COUNT: 0, POLL_COUNT: 0,
    NEXT_ATTEMPT_AT: normalizedCreatedAt, LEASE_OWNER: null, LEASE_TOKEN: null,
    LEASE_EXPIRES_AT: null, FENCE_VERSION: 0, PROVIDER_JOB_ID: null, PROVIDER_STATE: null,
    EXPECTED_ROW_COUNT: null, ACCEPTED_ROW_COUNT: null, REJECTED_ROW_COUNT: null,
    READBACK_JOB_ID: null, READBACK_ROW_COUNT: null, READBACK_WATERMARK: null,
    LAST_ERROR_CODE: null, LAST_ATTEMPT_AT: null, SUBMITTED_AT: null, RECONCILED_AT: null,
    CREATED_AT: normalizedCreatedAt, UPDATED_AT: normalizedCreatedAt,
    SOURCE_REVISION: normalizedFact.SOURCE_REVISION,
  });
}

function sameImmutable(actual, expected) {
  return OUTBOX_IMMUTABLE.every((column) => (
    String(actual?.[column]) === String(expected[column])
  ));
}

function sameRowId(left, right) {
  return ROW_ID.test(String(left?.ROWID))
    && ROW_ID.test(String(right?.ROWID))
    && String(left.ROWID) === String(right.ROWID);
}

async function readOutboxOwnership(store, table, expected) {
  let exactOwner = await store.unique(table, 'OUTBOX_KEY', expected.OUTBOX_KEY);
  let identityOwner = await store.uniqueOutboxProviderIdentity(table, expected);
  // One bounded reread tolerates a concurrent unique-key winner landing between
  // the exact-key and provider-identity reads without weakening either binding.
  if (Boolean(exactOwner) !== Boolean(identityOwner)) {
    if (!exactOwner) exactOwner = await store.unique(table, 'OUTBOX_KEY', expected.OUTBOX_KEY);
    if (!identityOwner) identityOwner = await store.uniqueOutboxProviderIdentity(table, expected);
  }
  for (const owner of [exactOwner, identityOwner].filter(Boolean)) {
    invariant(sameImmutable(owner, expected), 'DURABLE_IDEMPOTENCY_CONFLICT',
      'Analytics outbox durable binding conflicts.', { httpStatus: 409 });
  }
  if (!exactOwner && !identityOwner) return null;
  invariant(exactOwner && identityOwner && sameRowId(exactOwner, identityOwner),
    'DURABLE_IDEMPOTENCY_CONFLICT',
    'Analytics outbox identities resolve to different durable rows.', { httpStatus: 409 });
  return exactOwner;
}

async function ensureOutboxRow(store, config, recordType, fact, createdAt) {
  const expected = createOutboxRow(recordType, fact, createdAt);
  const table = config.tables.ANALYTICS_OUTBOX_TABLE;
  const existing = await readOutboxOwnership(store, table, expected);
  if (existing) return Object.freeze({ row: existing, inserted: false });

  let insertResult = null;
  let insertError = null;
  try {
    insertResult = await store.insertUnique(table, 'OUTBOX_KEY', expected, OUTBOX_IMMUTABLE);
  } catch (error) {
    insertError = error;
  }
  const readback = await readOutboxOwnership(store, table, expected);
  if (!readback) {
    if (insertError) throw insertError;
    invariant(false, 'DURABLE_IDEMPOTENCY_CONFLICT',
      'Analytics outbox insert could not be read back.', { httpStatus: 503 });
  }
  return Object.freeze({
    row: readback,
    inserted: insertError === null && insertResult?.inserted === true,
  });
}

module.exports = Object.freeze({
  OUTBOX_IMMUTABLE, canonicalJson, createOutboxRow, callFact, deploymentFact,
  finalTestResultFact,
  ensureOutboxRow, normalizeFactTimestamps, outboxKey, sha256,
});
