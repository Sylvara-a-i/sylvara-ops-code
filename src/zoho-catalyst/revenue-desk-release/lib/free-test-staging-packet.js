'use strict';

const crypto = require('node:crypto');
const {
  canonicalApprovalIntent,
  routeFingerprint,
  routeFromRows,
} = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/approval-control');
const {
  REQUIRED_CONFIGURATION_FIELDS,
  validateConfigurationVersionRow,
} = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/configuration-version');
const { invariant }
  = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/errors');
const { prepareFreeTestConfiguration, MAX_READBACK_AGE_MS } = require('./free-test-preparation');

const PROFILE = 'free-test-configuration-staging-v1';
const SIGNATURE_DOMAIN = 'revenue-desk-configuration-staging-intent-v1\0';
const MAX_STAGING_PACKET_BYTES = 16_384;
const MAX_INTENT_AGE_MS = 5 * 60 * 1000;
const ENVELOPE_FIELDS = Object.freeze([
  'schemaVersion', 'preparation', 'preservedCoreApproval', 'request',
]);
const REQUEST_FIELDS = Object.freeze([
  'profile', 'dealId', 'journeyId', 'form2ConfigurationVersion', 'review',
  'configurationRow', 'deployment', 'intent',
]);
const ROW_FIELDS = Object.freeze([
  ...REQUIRED_CONFIGURATION_FIELDS,
  'CONFIGURATION_VERSION_ID', 'DEPLOYMENT_ID', 'CONFIGURATION_JSON',
  'STATUS', 'APPROVAL_STATUS', 'SOURCE_ENVIRONMENT',
]);
const DEPLOYMENT_FIELDS = Object.freeze([
  'CLIENT_ID', 'DEPLOYMENT_ID', 'ACTIVE_CONFIGURATION_VERSION_ID',
  'NUMBER_LOOKUP_HASH', 'BINDING_ID', 'BINDING_VERSION', 'MONITOR_AGENT_ID',
  'MONITOR_AGENT_VERSION', 'COVERAGE_MODE', 'CALL_LIMIT', 'COUNT_VERSION',
  'HANDLED_COUNT', 'SOURCE_REVISION', 'SOURCE_ENVIRONMENT',
]);
const REVIEW_FIELDS = Object.freeze([
  'callbackExpectation', 'clientId', 'configurationVersionId', 'countryCode',
  'deploymentId', 'dstPolicy', 'hoursExceptions', 'hoursSourceText',
  'notificationHandoff', 'notificationRecipientId', 'rollbackInstructions',
  'rollbackInstructionsVersion', 'serviceArea', 'serviceAreaSourceText', 'timeZone',
  'unsupportedServices', 'urgentConditions', 'urgentHandlingSourceText', 'weeklyHours',
]);
const REPORT_REVIEW_FIELDS = Object.freeze([
  'reportBaseline', 'analyticsClientKey', 'analyticsDeploymentKey',
]);
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const OPERATOR_PATTERN = /^operator_[a-f0-9]{64}$/;
const CRM_ID_PATTERN = /^[1-9][0-9]{7,29}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactObject(value, fields, code) {
  invariant(isPlainObject(value), code, 'Staging packet shape is invalid.');
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  invariant(actual.length === expected.length
    && actual.every((field, index) => field === expected[index]),
  code, 'Staging packet fields are invalid.');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function canonicalTimestamp(value, code) {
  const milliseconds = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  invariant(Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value,
    code, 'Staging packet timestamp is invalid.');
  return milliseconds;
}

function configurationDeploymentId(dealId, journeyId) {
  return `cfgdeploy_${crypto.createHash('sha256')
    .update(JSON.stringify(['development', dealId, journeyId])).digest('hex')}`;
}

function validatePreservedCoreApproval(value) {
  if (value === null) return null;
  exactObject(value, ['configurationVersionId', 'approvedAt'],
    'INVALID_STAGING_PREPARATION');
  invariant(typeof value.configurationVersionId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.configurationVersionId),
  'INVALID_STAGING_PREPARATION', 'Preserved approval identity is invalid.');
  canonicalTimestamp(value.approvedAt, 'INVALID_STAGING_PREPARATION');
  return Object.freeze({ ...value });
}

function validateContext({ expectedRevision, expectedOperatorHash, now }) {
  invariant(typeof expectedRevision === 'string' && SHA_PATTERN.test(expectedRevision)
    && typeof expectedOperatorHash === 'string' && OPERATOR_PATTERN.test(expectedOperatorHash)
    && Number.isSafeInteger(now) && now >= 0,
  'INVALID_STAGING_SIGNING_CONTEXT', 'Staging signing context is invalid.');
}

/**
 * Validate one complete, externally governed unsigned request. This helper is
 * deliberately not an evidence reader: the live controller must independently
 * re-read and authenticate every source before it creates any durable state.
 */
function validateUnsignedStagingEnvelope(envelope, {
  expectedRevision, expectedOperatorHash, now = Date.now(),
}) {
  validateContext({ expectedRevision, expectedOperatorHash, now });
  exactObject(envelope, ENVELOPE_FIELDS, 'INVALID_UNSIGNED_STAGING_ENVELOPE');
  invariant(envelope.schemaVersion === 1, 'INVALID_UNSIGNED_STAGING_ENVELOPE',
    'Unsigned staging envelope version is invalid.');
  const preparation = envelope.preparation;
  exactObject(preparation, Object.hasOwn(preparation || {}, 'reportBaseline')
    ? ['classification', 'crm', 'evidence', 'review', 'reportBaseline']
    : ['classification', 'crm', 'evidence', 'review'], 'INVALID_STAGING_PREPARATION');
  invariant(preparation.classification === 'private-preparation',
    'INVALID_STAGING_PREPARATION', 'Only governed private preparation is signable.');
  const preservedCoreApproval = validatePreservedCoreApproval(envelope.preservedCoreApproval);

  const request = envelope.request;
  exactObject(request, REQUEST_FIELDS, 'INVALID_UNSIGNED_STAGING_REQUEST');
  invariant(request.profile === PROFILE && !Object.hasOwn(request, 'signature'),
    'INVALID_UNSIGNED_STAGING_REQUEST', 'Unsigned staging request is invalid.');
  exactObject(request.review, [
    ...REVIEW_FIELDS,
    ...(Object.hasOwn(request.review || {}, 'providerTiming') ? ['providerTiming'] : []),
    ...(REPORT_REVIEW_FIELDS.some((field) => Object.hasOwn(request.review || {}, field))
      ? REPORT_REVIEW_FIELDS : []),
  ], 'INVALID_UNSIGNED_STAGING_REQUEST');
  invariant(CRM_ID_PATTERN.test(request.dealId || '')
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(request.journeyId || '')
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(request.form2ConfigurationVersion || ''),
  'INVALID_UNSIGNED_STAGING_REQUEST', 'Unsigned staging target is invalid.');
  invariant(same(request.review, preparation.review),
    'STAGING_PREPARATION_MISMATCH', 'Staging review does not match its preparation.');

  const prepared = prepareFreeTestConfiguration(preparation, {
    now, preservedCoreApproval: preservedCoreApproval || undefined,
  });
  invariant(prepared.status === 'prepared_local_only' && prepared.unresolved.length === 0
    && prepared.deploymentAuthorized === false && prepared.providerVerified === false
    && prepared.candidate?.approved === false
    && prepared.candidate.notificationRecipient?.approved === false,
  'STAGING_PREPARATION_BLOCKED', 'Staging preparation has unresolved requirements.');
  const candidate = prepared.candidate;
  const deal = preparation.crm?.deal;
  invariant(deal?.id === request.dealId && deal.Intake_Submission_ID === request.journeyId
    && deal.Configuration_Version === request.form2ConfigurationVersion
    && candidate.crmDealId === request.dealId
    && candidate.configurationVersion === request.form2ConfigurationVersion
    && candidate.deploymentId === configurationDeploymentId(request.dealId, request.journeyId),
  'STAGING_TARGET_MISMATCH', 'Staging target does not match the prepared source.');

  const row = request.configurationRow;
  const deployment = request.deployment;
  exactObject(row, ROW_FIELDS, 'INVALID_UNSIGNED_STAGING_REQUEST');
  exactObject(deployment, DEPLOYMENT_FIELDS, 'INVALID_UNSIGNED_STAGING_REQUEST');
  validateConfigurationVersionRow(row, {
    code: 'STAGING_TARGET_MISMATCH',
    expectedDeploymentId: candidate.deploymentId,
    expectedEnvironment: 'development',
    expectedSourceRevision: expectedRevision,
  });
  const approvedCandidate = {
    ...candidate,
    approved: true,
    notificationRecipient: { ...candidate.notificationRecipient, approved: true },
  };
  invariant(row.CONFIGURATION_JSON === JSON.stringify(approvedCandidate)
    && row.CONFIGURATION_VERSION_ID === request.review.configurationVersionId
    && row.CONFIGURATION_VERSION === request.form2ConfigurationVersion
    && row.STATUS === 'Active' && row.APPROVAL_STATUS === 'Approved'
    && row.DEPLOYMENT_STATUS === 'Live' && row.GO_LIVE_APPROVAL_STATUS === 'Approved'
    && row.ENGAGEMENT_TYPE === 'free_test' && row.CAPABILITY_PROFILE === 'call_gap_monitor_v1'
    && row.PLAN_TIER === 'none'
    && row.LIMIT_POLICY === 'seven_calendar_days_or_25_connected_calls_v1'
    && row.BILLING_MODE === 'none' && row.NUMBER_OWNERSHIP === 'dedicated_deployment'
    && row.ENVIRONMENT === 'development' && row.SOURCE_ENVIRONMENT === 'development'
    && !Object.hasOwn(row, 'ROWID') && !Object.hasOwn(row, 'CREATED_AT')
    && !Object.hasOwn(row, 'ACTIVATED_AT'),
  'STAGING_CONTENT_MISMATCH', 'Staging content is not the exact approved candidate.');

  invariant(deployment.CLIENT_ID === candidate.clientId
    && deployment.DEPLOYMENT_ID === candidate.deploymentId
    && deployment.ACTIVE_CONFIGURATION_VERSION_ID === row.CONFIGURATION_VERSION_ID
    && /^num_[a-f0-9]{64}$/.test(deployment.NUMBER_LOOKUP_HASH || '')
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(deployment.BINDING_ID || '')
    && Number.isSafeInteger(deployment.BINDING_VERSION) && deployment.BINDING_VERSION >= 1
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(deployment.MONITOR_AGENT_ID || '')
    && Number.isSafeInteger(deployment.MONITOR_AGENT_VERSION)
    && deployment.MONITOR_AGENT_VERSION >= 1
    && deployment.COVERAGE_MODE === candidate.coverageMode
    && deployment.CALL_LIMIT === 25 && deployment.COUNT_VERSION === 0
    && deployment.HANDLED_COUNT === 0 && deployment.SOURCE_REVISION === expectedRevision
    && deployment.SOURCE_ENVIRONMENT === 'development',
  'STAGING_TARGET_MISMATCH', 'Staging deployment is not the exact inactive target.');

  const canonicalIntent = canonicalApprovalIntent(request.intent);
  const intent = request.intent;
  const observedAt = canonicalTimestamp(intent.evidence_observed_at,
    'INVALID_STAGING_INTENT');
  const requestedAt = canonicalTimestamp(intent.requested_at, 'INVALID_STAGING_INTENT');
  invariant(intent.action === 'approve' && intent.operator_id_hash === expectedOperatorHash
    && intent.evidence_revision === expectedRevision && intent.expected_deployment_version === 0
    && intent.deployment_id === deployment.DEPLOYMENT_ID
    && intent.configuration_version_id === row.CONFIGURATION_VERSION_ID
    && intent.evidence_observed_at === preparation.evidence?.capturedAt
    && observedAt <= requestedAt && requestedAt <= now
    && now - requestedAt <= MAX_INTENT_AGE_MS && now - observedAt <= MAX_READBACK_AGE_MS,
  'INVALID_STAGING_INTENT', 'Staging intent is stale or does not match its target.');
  const expectedRouteFingerprint = routeFingerprint(routeFromRows(deployment, row));
  invariant(intent.route_fingerprint === expectedRouteFingerprint,
    'STAGING_CONTENT_MISMATCH', 'Staging intent does not bind the exact route.');

  return deepFreeze({
    packet: structuredClone(request),
    canonicalIntent,
    sourceRevision: expectedRevision,
    profile: PROFILE,
  });
}

function signFreeTestStagingPacket(envelope, {
  secret, expectedRevision, expectedOperatorHash, now = Date.now(),
}) {
  invariant(Buffer.isBuffer(secret) && secret.length >= 32 && secret.length <= 4096
    && secret.every((byte) => byte >= 0x21 && byte <= 0x7e),
  'INVALID_STAGING_SIGNING_SECRET', 'Owner signing key is invalid.');
  const validated = validateUnsignedStagingEnvelope(envelope, {
    expectedRevision, expectedOperatorHash, now,
  });
  const signature = `v1=${crypto.createHmac('sha256', secret)
    .update(SIGNATURE_DOMAIN, 'utf8').update(validated.canonicalIntent, 'utf8').digest('hex')}`;
  const packet = deepFreeze({ ...validated.packet, signature });
  const serialized = `${JSON.stringify(packet)}\n`;
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  invariant(byteLength <= MAX_STAGING_PACKET_BYTES,
    'STAGING_PACKET_TOO_LARGE', 'Signed staging packet exceeds the route body limit.');
  return deepFreeze({
    packet,
    serialized,
    byteLength,
    sha256: crypto.createHash('sha256').update(serialized, 'utf8').digest('hex'),
    sourceRevision: expectedRevision,
    profile: PROFILE,
  });
}

module.exports = Object.freeze({
  PROFILE,
  SIGNATURE_DOMAIN,
  MAX_STAGING_PACKET_BYTES,
  validateUnsignedStagingEnvelope,
  signFreeTestStagingPacket,
});
