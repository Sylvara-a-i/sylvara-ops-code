'use strict';

const crypto = require('node:crypto');
const { CONTRACT, COVERAGE_MODES } = require('./contracts');
const { validateConfigurationVersionRow } = require('./configuration-version');
const { invariant } = require('./errors');
const { keyedDigest } = require('./security');
const {
  authorizationReceiptFingerprint,
  serializeAuthorizationReceiptData,
} = require('./authorization-receipt');

const INTENT_FIELDS = Object.freeze([
  'schema_version', 'event_id', 'action', 'deployment_id', 'configuration_version_id',
  'route_fingerprint', 'evidence_revision', 'evidence_observed_at', 'requested_at',
  'operator_id_hash', 'expected_deployment_version',
]);
const ACTIVATION_INTENT_FIELDS = Object.freeze([
  'schema_version', 'event_id', 'action', 'deployment_id', 'configuration_version_id',
  'approval_event_key', 'route_fingerprint', 'route_readback_fingerprint',
  'route_observed_at', 'evidence_revision', 'evidence_observed_at', 'requested_at',
  'operator_id_hash', 'expected_deployment_version',
]);
const ROUTE_FIELDS = Object.freeze([
  'client_id', 'deployment_id', 'configuration_version_id',
  'configuration_snapshot_fingerprint',
  'number_lookup_hash', 'binding_id',
  'binding_version', 'monitor_agent_id', 'monitor_agent_version', 'coverage_mode',
  'call_limit', 'source_revision', 'environment',
]);
const EVIDENCE_FIELDS = Object.freeze([
  'status', 'deployment_id', 'configuration_version_id', 'route_fingerprint',
  'source_revision', 'deployment_version', 'observed_at', 'handled_count',
]);
const ACTIVATION_EVIDENCE_FIELDS = Object.freeze([
  'status', 'deployment_id', 'configuration_version_id', 'approval_event_key',
  'route_fingerprint', 'route_readback_fingerprint', 'source_revision',
  'deployment_version', 'observed_at',
]);
const SIGNATURE_PATTERN = /^v1=([a-f0-9]{64})$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const APPROVAL_EVENT_PATTERN = /^approval_[a-f0-9]{64}$/;
const ACTIVATION_EVENT_PATTERN = /^activation_[a-f0-9]{64}$/;
const OPERATOR_HASH_PATTERN = /^operator_[a-f0-9]{64}$/;
const ROUTE_FINGERPRINT_PATTERN = /^route_[a-f0-9]{64}$/;
const CONFIGURATION_FINGERPRINT_PATTERN = /^config_[a-f0-9]{64}$/;
const ROUTE_READBACK_PATTERN = /^readback_[a-f0-9]{64}$/;
const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40}$/;
const CLOCK_SKEW_MS = 30_000;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactObject(value, fields, code, label) {
  invariant(isPlainObject(value), code, `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  invariant(actual.length === expected.length
    && actual.every((field, index) => field === expected[index]),
  code, `${label} fields are invalid.`);
}

function boundedString(value, pattern, code, label) {
  invariant(typeof value === 'string' && pattern.test(value), code, `${label} is invalid.`);
  return value;
}

function canonicalInteger(value, minimum, code, label) {
  invariant(Number.isSafeInteger(value) && value >= minimum, code, `${label} is invalid.`);
  return value;
}

function canonicalTimestamp(value, code, label) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  invariant(Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
    code, `${label} is invalid.`);
  return parsed;
}

function canonicalObject(value, fields) {
  const ordered = {};
  for (const field of fields) ordered[field] = value[field];
  return JSON.stringify(ordered);
}

function validateIntent(intent) {
  const code = 'INVALID_APPROVAL_INTENT';
  exactObject(intent, INTENT_FIELDS, code, 'Approval intent');
  invariant(intent.schema_version === 1, code, 'Approval intent schema is invalid.');
  boundedString(intent.event_id, APPROVAL_EVENT_PATTERN, code, 'Approval event ID');
  invariant(intent.action === 'approve' || intent.action === 'revoke',
    code, 'Approval action is invalid.');
  boundedString(intent.deployment_id, OPAQUE_ID_PATTERN, code, 'Deployment ID');
  boundedString(intent.configuration_version_id, OPAQUE_ID_PATTERN, code,
    'Configuration-version ID');
  boundedString(intent.route_fingerprint, ROUTE_FINGERPRINT_PATTERN, code,
    'Route fingerprint');
  boundedString(intent.evidence_revision, SOURCE_REVISION_PATTERN, code,
    'Evidence revision');
  canonicalTimestamp(intent.evidence_observed_at, code, 'Evidence timestamp');
  canonicalTimestamp(intent.requested_at, code, 'Intent timestamp');
  boundedString(intent.operator_id_hash, OPERATOR_HASH_PATTERN, code, 'Operator hash');
  canonicalInteger(intent.expected_deployment_version, 0, code, 'Expected deployment version');
  return Object.freeze({ ...intent });
}

function canonicalApprovalIntent(intent) {
  return canonicalObject(validateIntent(intent), INTENT_FIELDS);
}

function validateActivationIntent(intent) {
  const code = 'INVALID_ACTIVATION_INTENT';
  exactObject(intent, ACTIVATION_INTENT_FIELDS, code, 'Activation intent');
  invariant(intent.schema_version === 1 && intent.action === 'activate', code,
    'Activation intent schema or action is invalid.');
  boundedString(intent.event_id, ACTIVATION_EVENT_PATTERN, code, 'Activation event ID');
  boundedString(intent.deployment_id, OPAQUE_ID_PATTERN, code, 'Deployment ID');
  boundedString(intent.configuration_version_id, OPAQUE_ID_PATTERN, code,
    'Configuration-version ID');
  boundedString(intent.approval_event_key, APPROVAL_EVENT_PATTERN, code,
    'Approval event key');
  boundedString(intent.route_fingerprint, ROUTE_FINGERPRINT_PATTERN, code,
    'Route fingerprint');
  boundedString(intent.route_readback_fingerprint, ROUTE_READBACK_PATTERN, code,
    'Route-readback fingerprint');
  canonicalTimestamp(intent.route_observed_at, code, 'Route-readback timestamp');
  boundedString(intent.evidence_revision, SOURCE_REVISION_PATTERN, code,
    'Evidence revision');
  canonicalTimestamp(intent.evidence_observed_at, code, 'Evidence timestamp');
  canonicalTimestamp(intent.requested_at, code, 'Intent timestamp');
  boundedString(intent.operator_id_hash, OPERATOR_HASH_PATTERN, code, 'Operator hash');
  canonicalInteger(intent.expected_deployment_version, 0, code,
    'Expected deployment version');
  return Object.freeze({ ...intent });
}

function canonicalActivationIntent(intent) {
  return canonicalObject(validateActivationIntent(intent), ACTIVATION_INTENT_FIELDS);
}

function approvalIntentSignature(intent, secret) {
  invariant(typeof secret === 'string' && secret.length >= 32,
    'INVALID_APPROVAL_CONFIGURATION', 'Operator-verification key is unavailable.');
  const canonical = canonicalApprovalIntent(intent);
  return `v1=${crypto.createHmac('sha256', secret)
    .update('revenue-desk-approval-intent-v1\0', 'utf8')
    .update(canonical, 'utf8').digest('hex')}`;
}

function activationIntentSignature(intent, secret) {
  invariant(typeof secret === 'string' && secret.length >= 32,
    'INVALID_APPROVAL_CONFIGURATION', 'Operator-verification key is unavailable.');
  const canonical = canonicalActivationIntent(intent);
  return `v1=${crypto.createHmac('sha256', secret)
    .update('revenue-desk-activation-intent-v1\0', 'utf8')
    .update(canonical, 'utf8').digest('hex')}`;
}

function verifySignedApprovalIntent({
  intent, signature, secret, nowMs, maxAgeMs = 300_000,
}) {
  const validated = validateIntent(intent);
  canonicalInteger(nowMs, 0, 'INVALID_APPROVAL_CONFIGURATION', 'Current time');
  canonicalInteger(maxAgeMs, 1, 'INVALID_APPROVAL_CONFIGURATION', 'Intent freshness window');
  invariant(maxAgeMs <= 900_000, 'INVALID_APPROVAL_CONFIGURATION',
    'Intent freshness window is too broad.');
  const requestedAt = canonicalTimestamp(validated.requested_at,
    'INVALID_APPROVAL_INTENT', 'Intent timestamp');
  invariant(requestedAt <= nowMs + CLOCK_SKEW_MS && nowMs - requestedAt <= maxAgeMs,
    'STALE_APPROVAL_INTENT', 'Approval intent is outside the accepted freshness window.');
  invariant(typeof signature === 'string' && SIGNATURE_PATTERN.test(signature),
    'INVALID_APPROVAL_SIGNATURE', 'Approval signature format is invalid.');
  const expected = Buffer.from(approvalIntentSignature(validated, secret).slice(3), 'hex');
  const supplied = Buffer.from(SIGNATURE_PATTERN.exec(signature)[1], 'hex');
  invariant(supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected),
    'INVALID_APPROVAL_SIGNATURE', 'Approval signature did not verify.');
  return validated;
}

function verifySignedActivationIntent({
  intent, signature, secret, nowMs, maxAgeMs = 300_000,
}) {
  const validated = validateActivationIntent(intent);
  canonicalInteger(nowMs, 0, 'INVALID_APPROVAL_CONFIGURATION', 'Current time');
  canonicalInteger(maxAgeMs, 1, 'INVALID_APPROVAL_CONFIGURATION', 'Intent freshness window');
  invariant(maxAgeMs <= 900_000, 'INVALID_APPROVAL_CONFIGURATION',
    'Intent freshness window is too broad.');
  const requestedAt = canonicalTimestamp(validated.requested_at,
    'INVALID_ACTIVATION_INTENT', 'Intent timestamp');
  invariant(requestedAt <= nowMs + CLOCK_SKEW_MS && nowMs - requestedAt <= maxAgeMs,
    'STALE_ACTIVATION_INTENT', 'Activation intent is outside the accepted freshness window.');
  invariant(typeof signature === 'string' && SIGNATURE_PATTERN.test(signature),
    'INVALID_APPROVAL_SIGNATURE', 'Activation signature format is invalid.');
  const expected = Buffer.from(activationIntentSignature(validated, secret).slice(3), 'hex');
  const supplied = Buffer.from(SIGNATURE_PATTERN.exec(signature)[1], 'hex');
  invariant(supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected),
    'INVALID_APPROVAL_SIGNATURE', 'Activation signature did not verify.');
  return validated;
}

function validateRoute(route) {
  const code = 'INVALID_ROUTE_FINGERPRINT_INPUT';
  exactObject(route, ROUTE_FIELDS, code, 'Route');
  boundedString(route.client_id, OPAQUE_ID_PATTERN, code, 'Client ID');
  boundedString(route.deployment_id, OPAQUE_ID_PATTERN, code, 'Deployment ID');
  boundedString(route.configuration_version_id, OPAQUE_ID_PATTERN, code,
    'Configuration-version ID');
  boundedString(route.configuration_snapshot_fingerprint, CONFIGURATION_FINGERPRINT_PATTERN,
    code, 'Configuration snapshot fingerprint');
  boundedString(route.number_lookup_hash, /^num_[a-f0-9]{64}$/, code, 'Number lookup hash');
  boundedString(route.binding_id, OPAQUE_ID_PATTERN, code, 'Binding ID');
  canonicalInteger(route.binding_version, 1, code, 'Binding version');
  boundedString(route.monitor_agent_id, OPAQUE_ID_PATTERN, code, 'Monitor-agent ID');
  canonicalInteger(route.monitor_agent_version, 1, code, 'Monitor-agent version');
  invariant(COVERAGE_MODES.has(route.coverage_mode), code, 'Coverage mode is invalid.');
  canonicalInteger(route.call_limit, 1, code, 'Call limit');
  boundedString(route.source_revision, SOURCE_REVISION_PATTERN, code, 'Source revision');
  invariant(route.environment === 'development' || route.environment === 'production',
    code, 'Route environment is invalid.');
  return Object.freeze({ ...route });
}

function configurationSnapshotFingerprint(configurationVersion) {
  const code = 'INVALID_ROUTE_FINGERPRINT_INPUT';
  const validated = validateConfigurationVersionRow(configurationVersion, { code });
  const snapshot = {
    engagement_type: validated.engagementType,
    capability_profile: validated.capabilityProfile,
    plan_tier: validated.planTier,
    configuration_version: validated.configurationVersion,
    deployment_status: validated.deploymentStatus,
    go_live_approval_status: validated.goLiveApprovalStatus,
    limit_policy: validated.limitPolicy,
    billing_mode: validated.billingMode,
    number_ownership: validated.numberOwnership,
    environment: validated.environment,
    source_revision: validated.sourceRevision,
    configuration_json: validated.configurationJson,
    status: configurationVersion.STATUS,
    approval_status: configurationVersion.APPROVAL_STATUS,
  };
  invariant(Object.values(snapshot).every((value) => typeof value === 'string')
    && Buffer.byteLength(snapshot.configuration_json, 'utf8') <= 10_000,
  code, 'Configuration-version snapshot is invalid.');
  return `config_${crypto.createHash('sha256')
    .update('revenue-desk-configuration-authorization-v2\0', 'utf8')
    .update(JSON.stringify(snapshot), 'utf8').digest('hex')}`;
}

function routeFingerprint(route) {
  const validated = validateRoute(route);
  const canonical = canonicalObject(validated, ROUTE_FIELDS);
  return `route_${crypto.createHash('sha256')
    .update('revenue-desk-route-authorization-v1\0', 'utf8')
    .update(canonical, 'utf8').digest('hex')}`;
}

function routeFromRows(deployment, configurationVersion) {
  invariant(isPlainObject(deployment) && isPlainObject(configurationVersion),
    'APPROVAL_PRECONDITION_FAILED', 'Deployment and configuration version are required.');
  return {
    client_id: deployment.CLIENT_ID,
    deployment_id: deployment.DEPLOYMENT_ID,
    configuration_version_id: configurationVersion.CONFIGURATION_VERSION_ID,
    configuration_snapshot_fingerprint: configurationSnapshotFingerprint(configurationVersion),
    number_lookup_hash: deployment.NUMBER_LOOKUP_HASH,
    binding_id: deployment.BINDING_ID,
    binding_version: deployment.BINDING_VERSION,
    monitor_agent_id: deployment.MONITOR_AGENT_ID,
    monitor_agent_version: deployment.MONITOR_AGENT_VERSION,
    coverage_mode: deployment.COVERAGE_MODE,
    call_limit: deployment.CALL_LIMIT,
    source_revision: deployment.SOURCE_REVISION,
    environment: deployment.SOURCE_ENVIRONMENT,
  };
}

function validateEvidence(evidence) {
  const code = 'INVALID_APPROVAL_EVIDENCE';
  exactObject(evidence, EVIDENCE_FIELDS, code, 'Approval evidence');
  invariant(evidence.status === 'ready', code, 'Approval evidence is not ready.');
  boundedString(evidence.deployment_id, OPAQUE_ID_PATTERN, code, 'Evidence deployment ID');
  boundedString(evidence.configuration_version_id, OPAQUE_ID_PATTERN, code,
    'Evidence configuration-version ID');
  boundedString(evidence.route_fingerprint, ROUTE_FINGERPRINT_PATTERN, code,
    'Evidence route fingerprint');
  boundedString(evidence.source_revision, SOURCE_REVISION_PATTERN, code, 'Evidence revision');
  canonicalInteger(evidence.deployment_version, 0, code, 'Evidence deployment version');
  canonicalTimestamp(evidence.observed_at, code, 'Evidence timestamp');
  canonicalInteger(evidence.handled_count, 0, code, 'Evidence handled count');
  return Object.freeze({ ...evidence });
}

function validateActivationEvidence(evidence) {
  const code = 'INVALID_ACTIVATION_EVIDENCE';
  exactObject(evidence, ACTIVATION_EVIDENCE_FIELDS, code, 'Activation evidence');
  invariant(evidence.status === 'route_active', code,
    'Activation evidence does not prove an active route.');
  boundedString(evidence.deployment_id, OPAQUE_ID_PATTERN, code, 'Evidence deployment ID');
  boundedString(evidence.configuration_version_id, OPAQUE_ID_PATTERN, code,
    'Evidence configuration-version ID');
  boundedString(evidence.approval_event_key, APPROVAL_EVENT_PATTERN, code,
    'Evidence approval event key');
  boundedString(evidence.route_fingerprint, ROUTE_FINGERPRINT_PATTERN, code,
    'Evidence route fingerprint');
  boundedString(evidence.route_readback_fingerprint, ROUTE_READBACK_PATTERN, code,
    'Evidence route-readback fingerprint');
  boundedString(evidence.source_revision, SOURCE_REVISION_PATTERN, code,
    'Evidence revision');
  canonicalInteger(evidence.deployment_version, 0, code, 'Evidence deployment version');
  canonicalTimestamp(evidence.observed_at, code, 'Evidence timestamp');
  return Object.freeze({ ...evidence });
}

function validateApprovalRows(deployment, configurationVersion, intent, expectedRoute) {
  invariant(isPlainObject(deployment) && isPlainObject(configurationVersion),
    'APPROVAL_PRECONDITION_FAILED', 'Approval rows are unavailable.');
  const version = validateConfigurationVersionRow(configurationVersion, {
    code: 'APPROVAL_PRECONDITION_FAILED',
    expectedDeploymentId: intent.deployment_id,
    expectedEnvironment: deployment.SOURCE_ENVIRONMENT,
    expectedSourceRevision: intent.evidence_revision,
  });
  invariant(deployment.DEPLOYMENT_ID === intent.deployment_id
    && deployment.ACTIVE_CONFIGURATION_VERSION_ID === intent.configuration_version_id
    && configurationVersion.CONFIGURATION_VERSION_ID === intent.configuration_version_id
    && configurationVersion.DEPLOYMENT_ID === intent.deployment_id,
  'APPROVAL_PRECONDITION_FAILED', 'Approval is not bound to the active configuration version.');
  invariant(deployment.SOURCE_ENVIRONMENT === configurationVersion.SOURCE_ENVIRONMENT
    && deployment.SOURCE_ENVIRONMENT === expectedRoute.environment,
  'APPROVAL_PRECONDITION_FAILED', 'Approval environment binding is invalid.');
  invariant(deployment.SOURCE_REVISION === configurationVersion.SOURCE_REVISION
    && deployment.SOURCE_REVISION === intent.evidence_revision,
  'APPROVAL_PRECONDITION_FAILED', 'Approval source revision is inconsistent.');
  invariant(deployment.COUNT_VERSION === intent.expected_deployment_version,
    'APPROVAL_CONCURRENT_CHANGE', 'Deployment changed after operator review.');
  const profile = version.profile;
  invariant(version.engagementType === 'free_test'
    && version.deploymentStatus === CONTRACT.active_test_status
    && version.goLiveApprovalStatus === CONTRACT.approved_go_live_status
    && profile?.engagement_type === 'free_test'
    && profile.enabled === true && profile.status === 'active'
    && profile.traffic_environments.includes('development'),
  'APPROVAL_PRECONDITION_FAILED', 'Only the active Development free-test capability can be approved.');
  invariant(configurationVersion.STATUS === 'Active'
    && configurationVersion.APPROVAL_STATUS === 'Approved',
  'APPROVAL_PRECONDITION_FAILED', 'Configuration version is not immutable and approved.');
  if (intent.action === 'approve') {
    invariant(deployment.SOURCE_ENVIRONMENT === 'development',
      'PRODUCTION_DARK', 'Production activation is prohibited.');
    invariant(deployment.TEST_STATUS === 'Ready for Approval'
      && deployment.GO_LIVE_APPROVAL_STATUS === 'Pending Internal Approval'
      && (deployment.APPROVED_CONFIGURATION_VERSION_ID === null
        || deployment.APPROVED_CONFIGURATION_VERSION_ID === undefined)
      && (deployment.APPROVAL_EVENT_KEY === null
        || deployment.APPROVAL_EVENT_KEY === undefined)
      && (deployment.APPROVED_ROUTE_FINGERPRINT === null
        || deployment.APPROVED_ROUTE_FINGERPRINT === undefined)
      && (deployment.GO_LIVE_APPROVED_AT === null
        || deployment.GO_LIVE_APPROVED_AT === undefined)
      && (deployment.ACTIVATION_EVENT_KEY === null
        || deployment.ACTIVATION_EVENT_KEY === undefined)
      && (deployment.ACTUAL_START_AT === null || deployment.ACTUAL_START_AT === undefined)
      && (deployment.EXPIRES_AT === null || deployment.EXPIRES_AT === undefined)
      && (deployment.STOPPED_AT === null || deployment.STOPPED_AT === undefined)
      && (deployment.STOP_REASON === null || deployment.STOP_REASON === undefined),
    'APPROVAL_PRECONDITION_FAILED', 'Deployment is not awaiting approval.');
  } else {
    invariant(deployment.GO_LIVE_APPROVAL_STATUS === 'Approved'
      && (deployment.TEST_STATUS === 'Scheduled' || deployment.TEST_STATUS === 'Live'),
    'APPROVAL_PRECONDITION_FAILED', 'Deployment is not currently approved or active.');
  }
}

function intentFingerprint(secret, intent) {
  return keyedDigest(secret, 'revenue-desk-approval-intent-fingerprint-v1',
    [canonicalApprovalIntent(intent)]);
}

function existingApprovalEvent(events, intent, fingerprint) {
  invariant(Array.isArray(events) && events.length <= 10_000,
    'INVALID_APPROVAL_EVENT_HISTORY', 'Approval event history is invalid.');
  const matches = events.filter((event) => event?.AUTHORIZATION_EVENT_ID === intent.event_id);
  invariant(matches.length <= 1, 'APPROVAL_EVENT_HISTORY_CONFLICT',
    'Approval event identity is not unique.');
  if (matches.length === 0) return null;
  const [match] = matches;
  invariant(match.INTENT_FINGERPRINT === fingerprint
    && match.ACTION === intent.action
    && match.DEPLOYMENT_ID === intent.deployment_id
    && match.CONFIGURATION_VERSION_ID === intent.configuration_version_id
    && match.ROUTE_FINGERPRINT === intent.route_fingerprint,
  'APPROVAL_IDEMPOTENCY_CONFLICT', 'Approval event ID was reused for different intent.');
  return match;
}

function evaluateApprovalTransition({
  intent, signature, operatorVerificationSecret, eventChainSecret,
  deployment, configurationVersion, evidence, existingEvents = [], nowMs,
  maxIntentAgeMs = 300_000, maxEvidenceAgeMs = 900_000,
}) {
  const approvedIntent = verifySignedApprovalIntent({
    intent, signature, secret: operatorVerificationSecret, nowMs, maxAgeMs: maxIntentAgeMs,
  });
  const fingerprint = intentFingerprint(eventChainSecret, approvedIntent);
  const replay = existingApprovalEvent(existingEvents, approvedIntent, fingerprint);
  if (replay) return Object.freeze({ replayed: true, event: Object.freeze({ ...replay }),
    deploymentPatch: null, capacityDecision: Object.freeze({ status: 'unchanged' }) });

  const route = routeFromRows(deployment, configurationVersion);
  const expectedRouteFingerprint = routeFingerprint(route);
  invariant(expectedRouteFingerprint === approvedIntent.route_fingerprint,
    'ROUTE_FINGERPRINT_MISMATCH', 'Approved route does not match current deployment state.');
  validateApprovalRows(deployment, configurationVersion, approvedIntent, route);
  const approvedEvidence = validateEvidence(evidence);
  canonicalInteger(maxEvidenceAgeMs, 1, 'INVALID_APPROVAL_CONFIGURATION',
    'Evidence freshness window');
  invariant(maxEvidenceAgeMs <= 3_600_000, 'INVALID_APPROVAL_CONFIGURATION',
    'Evidence freshness window is too broad.');
  const evidenceAt = canonicalTimestamp(approvedEvidence.observed_at,
    'INVALID_APPROVAL_EVIDENCE', 'Evidence timestamp');
  invariant(evidenceAt <= nowMs + CLOCK_SKEW_MS && nowMs - evidenceAt <= maxEvidenceAgeMs
    && approvedEvidence.observed_at === approvedIntent.evidence_observed_at,
  'STALE_APPROVAL_EVIDENCE', 'Approval evidence is stale or was not the signed evidence.');
  invariant(approvedEvidence.deployment_id === approvedIntent.deployment_id
    && approvedEvidence.configuration_version_id === approvedIntent.configuration_version_id
    && approvedEvidence.route_fingerprint === expectedRouteFingerprint
    && approvedEvidence.source_revision === approvedIntent.evidence_revision
    && approvedEvidence.deployment_version === approvedIntent.expected_deployment_version
    && approvedEvidence.handled_count === deployment.HANDLED_COUNT,
  'APPROVAL_PRECONDITION_FAILED', 'Approval evidence does not match current route state.');
  const remaining = deployment.CALL_LIMIT - approvedEvidence.handled_count;
  invariant(approvedIntent.action === 'revoke' || remaining > 0,
    'CAPACITY_UNAVAILABLE', 'No route capacity remains for approval.');

  const decidedAt = new Date(nowMs).toISOString();
  const previousEventHash = existingEvents.length === 0 ? 'genesis'
    : existingEvents[existingEvents.length - 1]?.EVENT_HASH;
  invariant(previousEventHash === 'genesis' || /^[a-f0-9]{64}$/.test(previousEventHash),
    'INVALID_APPROVAL_EVENT_HISTORY', 'Approval event chain is invalid.');
  const decision = approvedIntent.action === 'approve' ? 'Approved' : 'Revoked';
  const event = {
    AUTHORIZATION_EVENT_ID: approvedIntent.event_id,
    EVENT_SCHEMA_VERSION: 1,
    ACTION: approvedIntent.action,
    DECISION: decision,
    DEPLOYMENT_ID: approvedIntent.deployment_id,
    CONFIGURATION_VERSION_ID: approvedIntent.configuration_version_id,
    ROUTE_FINGERPRINT: expectedRouteFingerprint,
    OPERATOR_ID_HASH: approvedIntent.operator_id_hash,
    INTENT_FINGERPRINT: fingerprint,
    EVIDENCE_REVISION: approvedIntent.evidence_revision,
    EVIDENCE_OBSERVED_AT: approvedIntent.evidence_observed_at,
    EXPECTED_DEPLOYMENT_VERSION: approvedIntent.expected_deployment_version,
    CAPACITY_REMAINING_AT_DECISION: Math.max(remaining, 0),
    PREVIOUS_EVENT_HASH: previousEventHash,
    DECIDED_AT: decidedAt,
  };
  event.EVENT_HASH = keyedDigest(eventChainSecret, 'revenue-desk-authorization-event-v1',
    Object.keys(event).map((key) => event[key]));
  const deploymentPatch = approvedIntent.action === 'approve' ? {
    GO_LIVE_APPROVAL_STATUS: CONTRACT.approved_go_live_status,
    TEST_STATUS: 'Scheduled',
    APPROVED_CONFIGURATION_VERSION_ID: approvedIntent.configuration_version_id,
    APPROVAL_EVENT_KEY: approvedIntent.event_id,
    APPROVED_ROUTE_FINGERPRINT: expectedRouteFingerprint,
    GO_LIVE_APPROVED_AT: decidedAt,
    UPDATED_AT: decidedAt,
  } : {
    GO_LIVE_APPROVAL_STATUS: 'Revoked',
    TEST_STATUS: 'Stopped',
    STOP_REASON: 'sylvara_stopped',
    STOPPED_AT: decidedAt,
    UPDATED_AT: decidedAt,
  };
  return Object.freeze({
    replayed: false,
    event: Object.freeze(event),
    deploymentPatch: Object.freeze(deploymentPatch),
    capacityDecision: Object.freeze({
      status: approvedIntent.action === 'approve' ? 'available' : 'revoked',
      remaining: Math.max(remaining, 0),
    }),
  });
}

function activationIntentFingerprint(secret, intent) {
  return keyedDigest(secret, 'revenue-desk-activation-intent-fingerprint-v1',
    [canonicalActivationIntent(intent)]);
}

function evaluateActivationTransition({
  intent, signature, operatorVerificationSecret, eventChainSecret,
  deployment, configurationVersion, evidence, existingEvents = [], nowMs,
  maxIntentAgeMs = 300_000, maxEvidenceAgeMs = 900_000,
}) {
  const activationIntent = verifySignedActivationIntent({
    intent, signature, secret: operatorVerificationSecret, nowMs, maxAgeMs: maxIntentAgeMs,
  });
  const fingerprint = activationIntentFingerprint(eventChainSecret, activationIntent);
  const replay = existingApprovalEvent(existingEvents, activationIntent, fingerprint);
  if (replay) return Object.freeze({ replayed: true, event: Object.freeze({ ...replay }),
    deploymentPatch: null });

  const route = routeFromRows(deployment, configurationVersion);
  const expectedRouteFingerprint = routeFingerprint(route);
  invariant(expectedRouteFingerprint === activationIntent.route_fingerprint,
    'ROUTE_FINGERPRINT_MISMATCH', 'Activated route does not match current deployment state.');
  invariant(isPlainObject(deployment) && isPlainObject(configurationVersion)
    && deployment.SOURCE_ENVIRONMENT === 'development'
    && configurationVersion.SOURCE_ENVIRONMENT === 'development',
  'PRODUCTION_DARK', 'Production activation is prohibited.');
  invariant(deployment.DEPLOYMENT_ID === activationIntent.deployment_id
    && deployment.ACTIVE_CONFIGURATION_VERSION_ID === activationIntent.configuration_version_id
    && deployment.APPROVED_CONFIGURATION_VERSION_ID === activationIntent.configuration_version_id
    && configurationVersion.CONFIGURATION_VERSION_ID === activationIntent.configuration_version_id
    && configurationVersion.DEPLOYMENT_ID === activationIntent.deployment_id
    && deployment.APPROVAL_EVENT_KEY === activationIntent.approval_event_key
    && deployment.APPROVED_ROUTE_FINGERPRINT === expectedRouteFingerprint
    && (deployment.ACTIVATION_EVENT_KEY === null
      || deployment.ACTIVATION_EVENT_KEY === undefined)
    && (deployment.ACTUAL_START_AT === null || deployment.ACTUAL_START_AT === undefined)
    && (deployment.EXPIRES_AT === null || deployment.EXPIRES_AT === undefined)
    && deployment.SOURCE_REVISION === activationIntent.evidence_revision
    && configurationVersion.SOURCE_REVISION === activationIntent.evidence_revision
    && deployment.COUNT_VERSION === activationIntent.expected_deployment_version,
  'ACTIVATION_PRECONDITION_FAILED',
  'Activation is not bound to the currently approved deployment and configuration version.');
  const version = validateConfigurationVersionRow(configurationVersion, {
    code: 'ACTIVATION_PRECONDITION_FAILED',
    expectedDeploymentId: activationIntent.deployment_id,
    expectedEnvironment: 'development',
    expectedSourceRevision: activationIntent.evidence_revision,
  });
  const approvedAt = canonicalTimestamp(deployment.GO_LIVE_APPROVED_AT,
    'ACTIVATION_PRECONDITION_FAILED', 'Approval timestamp');
  invariant(approvedAt <= nowMs + CLOCK_SKEW_MS,
    'ACTIVATION_PRECONDITION_FAILED', 'Approval timestamp is in the future.');
  const profile = version.profile;
  invariant(version.engagementType === 'free_test'
    && version.deploymentStatus === CONTRACT.active_test_status
    && version.goLiveApprovalStatus === CONTRACT.approved_go_live_status
    && profile?.engagement_type === 'free_test'
    && profile.enabled === true && profile.status === 'active'
    && profile.traffic_environments.includes('development')
    && configurationVersion.STATUS === 'Active'
    && configurationVersion.APPROVAL_STATUS === 'Approved'
    && deployment.TEST_STATUS === 'Scheduled'
    && deployment.GO_LIVE_APPROVAL_STATUS === 'Approved'
    && (deployment.STOPPED_AT === null || deployment.STOPPED_AT === undefined)
    && (deployment.STOP_REASON === null || deployment.STOP_REASON === undefined),
  'ACTIVATION_PRECONDITION_FAILED', 'Deployment is not awaiting route activation.');

  const activationEvidence = validateActivationEvidence(evidence);
  canonicalInteger(maxEvidenceAgeMs, 1, 'INVALID_APPROVAL_CONFIGURATION',
    'Activation-evidence freshness window');
  invariant(maxEvidenceAgeMs <= 3_600_000, 'INVALID_APPROVAL_CONFIGURATION',
    'Activation-evidence freshness window is too broad.');
  const evidenceAt = canonicalTimestamp(activationEvidence.observed_at,
    'INVALID_ACTIVATION_EVIDENCE', 'Evidence timestamp');
  const routeObservedAt = canonicalTimestamp(activationIntent.route_observed_at,
    'INVALID_ACTIVATION_INTENT', 'Route-readback timestamp');
  invariant(evidenceAt <= nowMs + CLOCK_SKEW_MS && nowMs - evidenceAt <= maxEvidenceAgeMs
    && routeObservedAt === evidenceAt
    && activationIntent.evidence_observed_at === activationEvidence.observed_at,
  'STALE_ACTIVATION_EVIDENCE', 'Route-activation evidence is stale or was not signed.');
  invariant(activationEvidence.deployment_id === activationIntent.deployment_id
    && activationEvidence.configuration_version_id === activationIntent.configuration_version_id
    && activationEvidence.approval_event_key === activationIntent.approval_event_key
    && activationEvidence.route_fingerprint === expectedRouteFingerprint
    && activationEvidence.route_readback_fingerprint
      === activationIntent.route_readback_fingerprint
    && activationEvidence.source_revision === activationIntent.evidence_revision
    && activationEvidence.deployment_version === activationIntent.expected_deployment_version,
  'ACTIVATION_PRECONDITION_FAILED', 'Activation evidence does not match the approved route.');
  invariant(deployment.HANDLED_COUNT < deployment.CALL_LIMIT,
    'CAPACITY_UNAVAILABLE', 'No route capacity remains for activation.');

  const decidedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + CONTRACT.test_duration_days * 86_400_000).toISOString();
  const previousEventHash = existingEvents.length === 0 ? 'genesis'
    : existingEvents[existingEvents.length - 1]?.EVENT_HASH;
  invariant(previousEventHash === 'genesis' || /^[a-f0-9]{64}$/.test(previousEventHash),
    'INVALID_APPROVAL_EVENT_HISTORY', 'Authorization event chain is invalid.');
  const event = {
    AUTHORIZATION_EVENT_ID: activationIntent.event_id,
    EVENT_SCHEMA_VERSION: 1,
    ACTION: 'activate',
    DECISION: 'Activated',
    DEPLOYMENT_ID: activationIntent.deployment_id,
    CONFIGURATION_VERSION_ID: activationIntent.configuration_version_id,
    ROUTE_FINGERPRINT: expectedRouteFingerprint,
    ROUTE_READBACK_FINGERPRINT: activationIntent.route_readback_fingerprint,
    ROUTE_OBSERVED_AT: activationIntent.route_observed_at,
    APPROVAL_EVENT_KEY: activationIntent.approval_event_key,
    OPERATOR_ID_HASH: activationIntent.operator_id_hash,
    INTENT_FINGERPRINT: fingerprint,
    EVIDENCE_REVISION: activationIntent.evidence_revision,
    EVIDENCE_OBSERVED_AT: activationIntent.evidence_observed_at,
    EXPECTED_DEPLOYMENT_VERSION: activationIntent.expected_deployment_version,
    PREVIOUS_EVENT_HASH: previousEventHash,
    ACTUAL_START_AT: decidedAt,
    EXPIRES_AT: expiresAt,
    DECIDED_AT: decidedAt,
  };
  event.EVENT_HASH = keyedDigest(eventChainSecret, 'revenue-desk-authorization-event-v1',
    Object.keys(event).map((key) => event[key]));
  return Object.freeze({
    replayed: false,
    event: Object.freeze(event),
    deploymentPatch: Object.freeze({
      TEST_STATUS: CONTRACT.active_test_status,
      ACTIVATION_EVENT_KEY: activationIntent.event_id,
      ACTUAL_START_AT: decidedAt,
      EXPIRES_AT: expiresAt,
      UPDATED_AT: decidedAt,
    }),
  });
}

function authorizationReceiptRow(event, { sourceRevision, environment, controlBinding }) {
  invariant(isPlainObject(event)
    && (APPROVAL_EVENT_PATTERN.test(event.AUTHORIZATION_EVENT_ID || '')
      || ACTIVATION_EVENT_PATTERN.test(event.AUTHORIZATION_EVENT_ID || ''))
    && /^[a-f0-9]{64}$/.test(event.INTENT_FINGERPRINT || '')
    && /^[a-f0-9]{64}$/.test(event.EVENT_HASH || '')
    && new Set(['Approved', 'Activated', 'Revoked']).has(event.DECISION),
  'INVALID_APPROVAL_EVENT', 'Authorization event is invalid.');
  boundedString(sourceRevision, SOURCE_REVISION_PATTERN,
    'INVALID_APPROVAL_EVENT', 'Source revision');
  invariant(environment === 'development', 'PRODUCTION_DARK',
    'Production authorization persistence is prohibited.');
  canonicalTimestamp(event.DECIDED_AT, 'INVALID_APPROVAL_EVENT', 'Decision timestamp');
  const eventData = {
    schemaVersion: 1,
    action: event.ACTION,
    decision: event.DECISION,
    configurationVersionId: event.CONFIGURATION_VERSION_ID,
    routeFingerprint: event.ROUTE_FINGERPRINT,
    operatorIdHash: event.OPERATOR_ID_HASH,
    intentFingerprint: event.INTENT_FINGERPRINT,
    evidenceRevision: event.EVIDENCE_REVISION,
    evidenceObservedAt: event.EVIDENCE_OBSERVED_AT,
    expectedDeploymentVersion: event.EXPECTED_DEPLOYMENT_VERSION,
    capacityRemainingAtDecision: event.CAPACITY_REMAINING_AT_DECISION ?? null,
    previousEventHash: event.PREVIOUS_EVENT_HASH,
    eventHash: event.EVENT_HASH,
    decidedAt: event.DECIDED_AT,
    approvalEventKey: event.APPROVAL_EVENT_KEY ?? null,
    routeReadbackFingerprint: event.ROUTE_READBACK_FINGERPRINT ?? null,
    routeObservedAt: event.ROUTE_OBSERVED_AT ?? null,
    actualStartAt: event.ACTUAL_START_AT ?? null,
    expiresAt: event.EXPIRES_AT ?? null,
    controlBinding,
  };
  const serializedEvent = serializeAuthorizationReceiptData(eventData, {
    code: 'INVALID_APPROVAL_EVENT',
    message: 'Authorization receipt payload is invalid.',
  });
  const receiptFingerprint = authorizationReceiptFingerprint(serializedEvent);
  return Object.freeze({
    EVENT_KEY: event.AUTHORIZATION_EVENT_ID,
    RECEIPT_KIND: 'authorization_event',
    CALL_KEY: null,
    PAYLOAD_FINGERPRINT: receiptFingerprint,
    EVENT_TYPE: event.ACTION,
    EVENT_DATA_JSON: serializedEvent,
    CORRELATION_ID: null,
    DEPLOYMENT_ID: event.DEPLOYMENT_ID,
    CONFIGURATION_VERSION_ID: event.CONFIGURATION_VERSION_ID,
    ROUTE_FINGERPRINT: event.ROUTE_FINGERPRINT,
    ROUTE_READBACK_FINGERPRINT: event.ROUTE_READBACK_FINGERPRINT ?? null,
    RELATED_EVENT_KEY: event.APPROVAL_EVENT_KEY ?? null,
    STATUS: 'Completed',
    RECEIPT_VERSION: 1,
    ATTEMPT_COUNT: 0,
    LEASE_TOKEN: null,
    LEASE_EXPIRES_AT: null,
    JOB_REFERENCE: null,
    ENQUEUED_AT: null,
    NEXT_ATTEMPT_AT: null,
    LAST_ERROR_CODE: null,
    RECEIVED_AT: event.DECIDED_AT,
    PROCESSED_AT: event.DECIDED_AT,
    SOURCE_REVISION: sourceRevision,
    SOURCE_ENVIRONMENT: environment,
  });
}

module.exports = Object.freeze({
  INTENT_FIELDS,
  ACTIVATION_INTENT_FIELDS,
  ROUTE_FIELDS,
  EVIDENCE_FIELDS,
  ACTIVATION_EVIDENCE_FIELDS,
  canonicalApprovalIntent,
  canonicalActivationIntent,
  approvalIntentSignature,
  activationIntentSignature,
  verifySignedApprovalIntent,
  verifySignedActivationIntent,
  routeFingerprint,
  configurationSnapshotFingerprint,
  routeFromRows,
  evaluateApprovalTransition,
  evaluateActivationTransition,
  authorizationReceiptRow,
});
