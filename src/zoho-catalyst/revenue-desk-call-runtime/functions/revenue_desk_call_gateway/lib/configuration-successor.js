'use strict';

const crypto = require('node:crypto');
const { invariant } = require('./errors');
const { inactiveDeploymentFingerprint } = require('./configuration-reconciliation');
const { configurationSnapshotFingerprint, routeFingerprint, routeFromRows } = require('./approval-control');
const { validateConfigurationVersionRow } = require('./configuration-version');
const { validateConfiguration } = require('./validation');

const PROFILE = 'free-test-inactive-successor-v1';
const SIGNATURE_DOMAIN = 'revenue-desk-inactive-successor-intent-v1\0';
const QA_SCOPE = 'sole-informed-owner-internal-qa-v1';
const HASH = /^[a-f0-9]{64}$/;
const CONFIGURATION_COLUMNS = Object.freeze([
  'DEPLOYMENT_ID', 'CONFIGURATION_VERSION', 'ENGAGEMENT_TYPE', 'CAPABILITY_PROFILE',
  'PLAN_TIER', 'DEPLOYMENT_STATUS', 'GO_LIVE_APPROVAL_STATUS', 'LIMIT_POLICY',
  'BILLING_MODE', 'NUMBER_OWNERSHIP', 'ENVIRONMENT', 'SOURCE_ENVIRONMENT', 'STATUS', 'APPROVAL_STATUS',
]);
const FIELDS = Object.freeze([
  'schema_version', 'action', 'deployment_id', 'deal_id', 'journey_id',
  'predecessor_configuration_id', 'predecessor_revision', 'target_revision',
  'predecessor_configuration_fingerprint', 'predecessor_deployment_fingerprint',
  'historical_receipts_digest', 'historical_receipt_keys', 'source_snapshot_digest', 'credential_transition_digest',
  'independent_authorization_reference', 'qa_scope', 'qa_retention_reference',
  'maximum_call_duration_ms', 'new_number_lookup_hash', 'new_analytics_client_key',
  'new_analytics_deployment_key', 'operator_id_hash',
]);

function requireSuccessor(ok, code = 'CONFIGURATION_SUCCESSOR_INVALID') {
  invariant(ok, code, 'Inactive successor evidence is incomplete or changed.', { httpStatus: 409 });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, canonical(value[key])]));
  return value === undefined ? null : value;
}
function evidenceDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

/** A fresh owner authorization anchors independently reconciled records, not old MACs.
 * This pin hashes a nonsecret authorization document, never a credential value.
 */
function canonicalSuccessorPlan(plan) {
  requireSuccessor(plan && Object.getPrototypeOf(plan) === Object.prototype
    && Object.keys(plan).sort().join(',') === [...FIELDS].sort().join(','));
  requireSuccessor(plan.schema_version === 1 && plan.action === 'succeed_inactive_configuration'
    && /^cfgdeploy_[a-f0-9]{64}$/.test(plan.deployment_id || '')
    && /^[1-9][0-9]{7,29}$/.test(plan.deal_id || '')
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(plan.journey_id || '')
    && /^cfgtransitioned_[a-f0-9]{64}$/.test(plan.predecessor_configuration_id || '')
    && ['predecessor_revision', 'target_revision'].every((key) => /^[a-f0-9]{40}$/.test(plan[key] || ''))
    && plan.predecessor_revision !== plan.target_revision
    && /^config_[a-f0-9]{64}$/.test(plan.predecessor_configuration_fingerprint || '')
    && /^deployment_[a-f0-9]{64}$/.test(plan.predecessor_deployment_fingerprint || '')
    && ['historical_receipts_digest', 'source_snapshot_digest', 'credential_transition_digest',
      'new_analytics_client_key', 'new_analytics_deployment_key']
      .every((key) => typeof plan[key] === 'string' && HASH.test(plan[key]))
    && /^num_[a-f0-9]{64}$/.test(plan.new_number_lookup_hash || '')
    && Array.isArray(plan.historical_receipt_keys) && plan.historical_receipt_keys.length >= 1
    && plan.historical_receipt_keys.length <= 12
    && new Set(plan.historical_receipt_keys).size === plan.historical_receipt_keys.length
    && plan.historical_receipt_keys.every((key) => typeof key === 'string'
      && /^(?:cfgstage|cfgreconcile|cfgcomplete|cfgtransition|approval)_[a-f0-9]{64}$/.test(key))
    && ['independent_authorization_reference', 'qa_retention_reference'].every((key) =>
      typeof plan[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(plan[key]))
    && plan.qa_scope === QA_SCOPE && plan.maximum_call_duration_ms === 175_000
    && /^operator_[a-f0-9]{64}$/.test(plan.operator_id_hash || ''));
  return JSON.stringify(Object.fromEntries(FIELDS.map((key) => [key, plan[key]])));
}

function successorPlanDigest(plan) {
  return crypto.createHash('sha256').update(canonicalSuccessorPlan(plan)).digest('hex');
}

/** Stable through rekeys/releases: a changed credential cannot mint another attempt. */
function successorIdentity(plan) {
  canonicalSuccessorPlan(plan);
  const id = evidenceDigest([PROFILE, plan.deployment_id, plan.predecessor_configuration_id]);
  return Object.freeze({ claimKey: `cfgsuccessor_${id}`, configurationVersionId: `cfgsuccessor_${id}` });
}

function canonicalSuccessorIntent(intent) {
  requireSuccessor(intent && Object.keys(intent).sort().join(',') === 'plan,requested_at');
  canonicalSuccessorPlan(intent.plan);
  const at = Date.parse(intent.requested_at);
  requireSuccessor(typeof intent.requested_at === 'string' && Number.isFinite(at)
    && new Date(at).toISOString() === intent.requested_at);
  return JSON.stringify({ plan: JSON.parse(canonicalSuccessorPlan(intent.plan)), requested_at: intent.requested_at });
}

function verifySuccessorIntent(request, config, nowMs, { replay = false } = {}) {
  requireSuccessor(request && Object.keys(request).sort().join(',') === 'intent,profile,signature'
    && request.profile === PROFILE && config.environment === 'development'
    && config.retellRouteMode === 'disabled');
  const text = canonicalSuccessorIntent(request.intent);
  requireSuccessor(HASH.test(config.successorAuthorizationSha256 || '')
    && successorPlanDigest(request.intent.plan) === config.successorAuthorizationSha256
    && request.intent.plan.target_revision === config.sourceRevision
    && request.intent.plan.operator_id_hash === config.operatorIdHash
    && typeof config.operatorVerificationSecret === 'string' && config.operatorVerificationSecret.length >= 32
    && /^v1=[a-f0-9]{64}$/.test(request.signature || ''));
  const expected = crypto.createHmac('sha256', config.operatorVerificationSecret)
    .update(SIGNATURE_DOMAIN).update(text).digest();
  requireSuccessor(crypto.timingSafeEqual(expected, Buffer.from(request.signature.slice(3), 'hex')),
    'INVALID_APPROVAL_SIGNATURE');
  const requestedAt = Date.parse(request.intent.requested_at);
  requireSuccessor(Number.isSafeInteger(nowMs) && requestedAt <= nowMs
    && (replay || nowMs - requestedAt <= 300_000));
}

/** Pure bounded projection; it cannot reapprove, activate, reset capacity or write history. */
function projectInactiveSuccessor(plan, previous, deployment, changedAt) {
  canonicalSuccessorPlan(plan);
  validateConfigurationVersionRow(previous, { expectedDeploymentId: plan.deployment_id,
    expectedEnvironment: 'development', expectedSourceRevision: plan.predecessor_revision });
  requireSuccessor(previous.CONFIGURATION_VERSION_ID === plan.predecessor_configuration_id
    && previous.ACTIVATED_AT === null && previous.STATUS === 'Active' && previous.APPROVAL_STATUS === 'Approved'
    && previous.ENGAGEMENT_TYPE === 'free_test' && previous.BILLING_MODE === 'none'
    && configurationSnapshotFingerprint(previous) === plan.predecessor_configuration_fingerprint
    && inactiveDeploymentFingerprint(deployment) === plan.predecessor_deployment_fingerprint
    && deployment.ACTIVE_CONFIGURATION_VERSION_ID === previous.CONFIGURATION_VERSION_ID
    && deployment.DEPLOYMENT_ID === plan.deployment_id && deployment.SOURCE_REVISION === plan.predecessor_revision
    && deployment.SOURCE_ENVIRONMENT === 'development'
    && deployment.TEST_STATUS === 'Scheduled' && deployment.GO_LIVE_APPROVAL_STATUS === 'Approved'
    && deployment.APPROVED_CONFIGURATION_VERSION_ID === previous.CONFIGURATION_VERSION_ID
    && /^approval_[a-f0-9]{64}$/.test(deployment.APPROVAL_EVENT_KEY || '')
    && deployment.APPROVED_ROUTE_FINGERPRINT === routeFingerprint(routeFromRows(deployment, previous))
    && Number(deployment.COUNT_VERSION) === 1 && Number(deployment.HANDLED_COUNT) === 0
    && Number(deployment.CALL_LIMIT) === 25 && Number(deployment.REPORT_RECONCILIATION_VERSION) === 0
    && deployment.COUNTED_CALL_KEYS_JSON === '[]' && deployment.REPORT_RECONCILIATION_STATUS === 'NotRequired'
    && ['ACTIVATION_EVENT_KEY', 'APPROVED_START_AT', 'ACTUAL_START_AT', 'EXPIRES_AT', 'STOP_REASON', 'STOPPED_AT']
      .every((field) => deployment[field] === null)
    && Number.isFinite(Date.parse(deployment.GO_LIVE_APPROVED_AT))
    && Date.parse(changedAt) >= Date.parse(deployment.GO_LIVE_APPROVED_AT)
    && new Date(Date.parse(changedAt)).toISOString() === changedAt
    && Number.isSafeInteger(Number(deployment.BINDING_VERSION)) && Number(deployment.BINDING_VERSION) >= 1
    && Number(deployment.BINDING_VERSION) < Number.MAX_SAFE_INTEGER
    && plan.new_number_lookup_hash !== deployment.NUMBER_LOOKUP_HASH);
  const id = successorIdentity(plan).configurationVersionId;
  const json = JSON.parse(previous.CONFIGURATION_JSON);
  validateConfiguration(json);
  requireSuccessor(json.crmDealId === plan.deal_id && json.clientId === deployment.CLIENT_ID
    && json.deploymentId === deployment.DEPLOYMENT_ID && json.configurationVersion === previous.CONFIGURATION_VERSION);
  // The baseline's factual provenance and unknowns do not change. Only the new
  // execution namespace and physical configuration reference may change.
  if (json.reportBaseline !== undefined) {
    requireSuccessor(json.reportBaseline.configurationVersionId === previous.CONFIGURATION_VERSION_ID
      && HASH.test(json.reportBaseline.clientKey || '') && HASH.test(json.reportBaseline.deploymentKey || '')
      && json.reportBaseline.clientKey !== plan.new_analytics_client_key
      && json.reportBaseline.deploymentKey !== plan.new_analytics_deployment_key);
    Object.assign(json.reportBaseline, { configurationVersionId: id,
      clientKey: plan.new_analytics_client_key, deploymentKey: plan.new_analytics_deployment_key });
  }
  validateConfiguration(json);
  // Never copy provider bookkeeping or unknown columns into the new immutable row.
  const immutable = Object.fromEntries(CONFIGURATION_COLUMNS.map((key) => [key, previous[key]]));
  const configurationRow = { ...immutable, CONFIGURATION_VERSION_ID: id,
    SOURCE_REVISION: plan.target_revision, CONFIGURATION_JSON: JSON.stringify(json), CREATED_AT: changedAt, ACTIVATED_AT: null };
  validateConfigurationVersionRow(configurationRow, { expectedSourceRevision: plan.target_revision });
  const deploymentPatch = { ACTIVE_CONFIGURATION_VERSION_ID: id, SOURCE_REVISION: plan.target_revision,
    NUMBER_LOOKUP_HASH: plan.new_number_lookup_hash, BINDING_VERSION: Number(deployment.BINDING_VERSION) + 1,
    COUNT_VERSION: Number(deployment.COUNT_VERSION) + 1,
    TEST_STATUS: 'Ready for Approval', GO_LIVE_APPROVAL_STATUS: 'Pending Internal Approval',
    APPROVED_CONFIGURATION_VERSION_ID: null, APPROVAL_EVENT_KEY: null, APPROVED_ROUTE_FINGERPRINT: null,
    GO_LIVE_APPROVED_AT: null, UPDATED_AT: changedAt };
  return Object.freeze({ configurationRow: Object.freeze(configurationRow),
    deploymentPatch: Object.freeze(deploymentPatch), deployment: Object.freeze({ ...deployment, ...deploymentPatch }) });
}

module.exports = Object.freeze({ PROFILE, SIGNATURE_DOMAIN, QA_SCOPE, requireSuccessor, canonical,
  evidenceDigest, canonicalSuccessorPlan, successorPlanDigest, successorIdentity,
  canonicalSuccessorIntent, verifySuccessorIntent, projectInactiveSuccessor });
