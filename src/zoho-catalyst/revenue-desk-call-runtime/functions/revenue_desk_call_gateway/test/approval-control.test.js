'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  approvalIntentSignature,
  activationIntentSignature,
  canonicalApprovalIntent,
  canonicalActivationIntent,
  routeFingerprint,
  routeFromRows,
  evaluateApprovalTransition,
  evaluateActivationTransition,
  authorizationReceiptRow,
} = require('../lib/approval-control');

const APPROVAL_NOW = Date.parse('2026-08-24T18:00:00.000Z');
const ACTIVATION_NOW = Date.parse('2026-08-24T18:05:00.000Z');
const SEVEN_DAYS_MS = 7 * 86_400_000;

function syntheticKey(label) {
  return crypto.createHash('sha256').update(`public-test-fixture:${label}`).digest('hex');
}

const OPERATOR_KEY = syntheticKey('operator');
const EVENT_KEY = syntheticKey('event-chain');

function rows(overrides = {}) {
  const deployment = {
    CLIENT_ID: 'client_synthetic',
    DEPLOYMENT_ID: 'deployment_synthetic',
    ACTIVE_CONFIGURATION_VERSION_ID: 'configuration_version_synthetic_v1',
    APPROVED_CONFIGURATION_VERSION_ID: null,
    APPROVAL_EVENT_KEY: null,
    APPROVED_ROUTE_FINGERPRINT: null,
    ACTIVATION_EVENT_KEY: null,
    GO_LIVE_APPROVED_AT: null,
    ACTUAL_START_AT: null,
    EXPIRES_AT: null,
    NUMBER_LOOKUP_HASH: `num_${'1'.repeat(64)}`,
    BINDING_ID: 'binding_synthetic',
    BINDING_VERSION: 2,
    MONITOR_AGENT_ID: 'agent_synthetic',
    MONITOR_AGENT_VERSION: 7,
    COVERAGE_MODE: 'AfterHoursOnly',
    CALL_LIMIT: 25,
    HANDLED_COUNT: 2,
    COUNT_VERSION: 4,
    TEST_STATUS: 'Ready for Approval',
    GO_LIVE_APPROVAL_STATUS: 'Pending Internal Approval',
    STOP_REASON: null,
    STOPPED_AT: null,
    SOURCE_REVISION: 'a'.repeat(40),
    SOURCE_ENVIRONMENT: 'development',
    ...overrides.deployment,
  };
  const configurationVersion = {
    CONFIGURATION_VERSION_ID: 'configuration_version_synthetic_v1',
    DEPLOYMENT_ID: 'deployment_synthetic',
    CONFIGURATION_VERSION: 'configuration_synthetic_v1',
    CONFIGURATION_JSON: JSON.stringify({ companyName: 'Synthetic Plumbing' }),
    ENGAGEMENT_TYPE: 'free_test',
    CAPABILITY_PROFILE: 'call_gap_monitor_v1',
    PLAN_TIER: 'none',
    DEPLOYMENT_STATUS: 'Live',
    GO_LIVE_APPROVAL_STATUS: 'Approved',
    LIMIT_POLICY: 'seven_calendar_days_or_25_connected_calls_v1',
    BILLING_MODE: 'none',
    NUMBER_OWNERSHIP: 'dedicated_deployment',
    ENVIRONMENT: 'development',
    STATUS: 'Active',
    APPROVAL_STATUS: 'Approved',
    SOURCE_REVISION: 'a'.repeat(40),
    SOURCE_ENVIRONMENT: 'development',
    ...overrides.configurationVersion,
  };
  return { deployment, configurationVersion };
}

function receiptControlBinding(event) {
  return {
    schemaVersion: 1,
    action: event.ACTION === 'activate' ? 'activate' : 'approve',
    dealId: '400000001',
    journeyId: 'journey_synthetic',
    deploymentId: event.DEPLOYMENT_ID,
    configurationVersionId: event.CONFIGURATION_VERSION_ID,
    idempotencyKey: event.ACTION === 'activate'
      ? '00000000-0000-4000-8000-000000000002'
      : '00000000-0000-4000-8000-000000000001',
    reason: null,
    deploymentControlPrestateDigest: null,
    deploymentControlPoststateDigest: null,
  };
}

function approvalFixture(action = 'approve', overrides = {}) {
  const { deployment, configurationVersion } = rows(overrides);
  if (action === 'revoke') {
    deployment.TEST_STATUS = 'Scheduled';
    deployment.GO_LIVE_APPROVAL_STATUS = 'Approved';
    deployment.APPROVED_CONFIGURATION_VERSION_ID = configurationVersion.CONFIGURATION_VERSION_ID;
    deployment.APPROVAL_EVENT_KEY = `approval_${'2'.repeat(64)}`;
    deployment.APPROVED_ROUTE_FINGERPRINT = routeFingerprint(
      routeFromRows(deployment, configurationVersion),
    );
    deployment.GO_LIVE_APPROVED_AT = new Date(APPROVAL_NOW).toISOString();
  }
  const fingerprint = routeFingerprint(routeFromRows(deployment, configurationVersion));
  const evidenceObservedAt = new Date(APPROVAL_NOW - 60_000).toISOString();
  const intent = {
    schema_version: 1,
    event_id: `approval_${(action === 'approve' ? '2' : '3').repeat(64)}`,
    action,
    deployment_id: deployment.DEPLOYMENT_ID,
    configuration_version_id: configurationVersion.CONFIGURATION_VERSION_ID,
    route_fingerprint: fingerprint,
    evidence_revision: deployment.SOURCE_REVISION,
    evidence_observed_at: evidenceObservedAt,
    requested_at: new Date(APPROVAL_NOW - 10_000).toISOString(),
    operator_id_hash: `operator_${'4'.repeat(64)}`,
    expected_deployment_version: deployment.COUNT_VERSION,
  };
  const evidence = {
    status: 'ready',
    deployment_id: deployment.DEPLOYMENT_ID,
    configuration_version_id: configurationVersion.CONFIGURATION_VERSION_ID,
    route_fingerprint: fingerprint,
    source_revision: deployment.SOURCE_REVISION,
    deployment_version: deployment.COUNT_VERSION,
    observed_at: evidenceObservedAt,
    handled_count: deployment.HANDLED_COUNT,
  };
  return {
    intent,
    signature: approvalIntentSignature(intent, OPERATOR_KEY),
    operatorVerificationSecret: OPERATOR_KEY,
    eventChainSecret: EVENT_KEY,
    deployment,
    configurationVersion,
    evidence,
    nowMs: APPROVAL_NOW,
  };
}

function activationFixture(overrides = {}) {
  const approval = approvalFixture();
  const approvalResult = evaluateApprovalTransition(approval);
  const deployment = {
    ...approval.deployment,
    ...approvalResult.deploymentPatch,
    COUNT_VERSION: approval.deployment.COUNT_VERSION + 1,
    ...overrides.deployment,
  };
  const configurationVersion = {
    ...approval.configurationVersion,
    ...overrides.configurationVersion,
  };
  const route = routeFromRows(deployment, configurationVersion);
  const fingerprint = routeFingerprint(route);
  const observedAt = new Date(ACTIVATION_NOW - 60_000).toISOString();
  const intent = {
    schema_version: 1,
    event_id: `activation_${'5'.repeat(64)}`,
    action: 'activate',
    deployment_id: deployment.DEPLOYMENT_ID,
    configuration_version_id: configurationVersion.CONFIGURATION_VERSION_ID,
    approval_event_key: deployment.APPROVAL_EVENT_KEY,
    route_fingerprint: fingerprint,
    route_readback_fingerprint: `readback_${'6'.repeat(64)}`,
    route_observed_at: observedAt,
    evidence_revision: deployment.SOURCE_REVISION,
    evidence_observed_at: observedAt,
    requested_at: new Date(ACTIVATION_NOW - 10_000).toISOString(),
    operator_id_hash: `operator_${'4'.repeat(64)}`,
    expected_deployment_version: deployment.COUNT_VERSION,
  };
  const evidence = {
    status: 'route_active',
    deployment_id: deployment.DEPLOYMENT_ID,
    configuration_version_id: configurationVersion.CONFIGURATION_VERSION_ID,
    approval_event_key: deployment.APPROVAL_EVENT_KEY,
    route_fingerprint: fingerprint,
    route_readback_fingerprint: intent.route_readback_fingerprint,
    source_revision: deployment.SOURCE_REVISION,
    deployment_version: deployment.COUNT_VERSION,
    observed_at: observedAt,
  };
  return {
    intent,
    signature: activationIntentSignature(intent, OPERATOR_KEY),
    operatorVerificationSecret: OPERATOR_KEY,
    eventChainSecret: EVENT_KEY,
    deployment,
    configurationVersion,
    evidence,
    existingEvents: [approvalResult.event],
    nowMs: ACTIVATION_NOW,
    approvalResult,
  };
}

test('approval binds the reviewed version and route without activating or starting the clock', () => {
  const fixture = approvalFixture();
  assert.equal(canonicalApprovalIntent(fixture.intent), JSON.stringify(fixture.intent));
  const result = evaluateApprovalTransition(fixture);

  assert.equal(result.replayed, false);
  assert.equal(result.event.DECISION, 'Approved');
  assert.equal(result.event.CONFIGURATION_VERSION_ID,
    fixture.configurationVersion.CONFIGURATION_VERSION_ID);
  assert.equal(result.event.ROUTE_FINGERPRINT, fixture.intent.route_fingerprint);
  assert.match(result.event.EVENT_HASH, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.deploymentPatch, {
    GO_LIVE_APPROVAL_STATUS: 'Approved',
    TEST_STATUS: 'Scheduled',
    APPROVED_CONFIGURATION_VERSION_ID: fixture.intent.configuration_version_id,
    APPROVAL_EVENT_KEY: fixture.intent.event_id,
    APPROVED_ROUTE_FINGERPRINT: fixture.intent.route_fingerprint,
    GO_LIVE_APPROVED_AT: new Date(APPROVAL_NOW).toISOString(),
    UPDATED_AT: new Date(APPROVAL_NOW).toISOString(),
  });
  assert.equal(result.deploymentPatch.ACTUAL_START_AT, undefined);
  assert.equal(result.deploymentPatch.EXPIRES_AT, undefined);
  assert.deepEqual(result.capacityDecision, { status: 'available', remaining: 23 });

  const receipt = authorizationReceiptRow(result.event, {
    sourceRevision: fixture.deployment.SOURCE_REVISION,
    environment: 'development',
    controlBinding: receiptControlBinding(result.event),
  });
  assert.equal(receipt.CONFIGURATION_VERSION_ID, fixture.intent.configuration_version_id);
  assert.equal(receipt.ROUTE_FINGERPRINT, fixture.intent.route_fingerprint);
  assert.equal(receipt.RELATED_EVENT_KEY, null);
});

test('activation requires route readback and starts an exact seven-day interval at activation', () => {
  const fixture = activationFixture();
  assert.equal(canonicalActivationIntent(fixture.intent), JSON.stringify(fixture.intent));
  const result = evaluateActivationTransition(fixture);

  assert.equal(result.event.DECISION, 'Activated');
  assert.equal(result.event.APPROVAL_EVENT_KEY, fixture.deployment.APPROVAL_EVENT_KEY);
  assert.equal(result.event.ROUTE_READBACK_FINGERPRINT,
    fixture.intent.route_readback_fingerprint);
  assert.deepEqual(result.deploymentPatch, {
    TEST_STATUS: 'Live',
    ACTIVATION_EVENT_KEY: fixture.intent.event_id,
    ACTUAL_START_AT: new Date(ACTIVATION_NOW).toISOString(),
    EXPIRES_AT: new Date(ACTIVATION_NOW + SEVEN_DAYS_MS).toISOString(),
    UPDATED_AT: new Date(ACTIVATION_NOW).toISOString(),
  });
  assert.equal(Date.parse(result.deploymentPatch.EXPIRES_AT)
    - Date.parse(result.deploymentPatch.ACTUAL_START_AT), SEVEN_DAYS_MS);

  const receipt = authorizationReceiptRow(result.event, {
    sourceRevision: fixture.deployment.SOURCE_REVISION,
    environment: 'development',
    controlBinding: receiptControlBinding(result.event),
  });
  assert.equal(receipt.RELATED_EVENT_KEY, fixture.deployment.APPROVAL_EVENT_KEY);
  assert.equal(JSON.parse(receipt.EVENT_DATA_JSON).actualStartAt,
    result.deploymentPatch.ACTUAL_START_AT);
});

test('approve, activate, and revoke events replay exactly and reject event-key reuse', () => {
  const approve = approvalFixture();
  const approved = evaluateApprovalTransition(approve);
  const approveReplay = evaluateApprovalTransition({ ...approve, existingEvents: [approved.event] });
  assert.equal(approveReplay.replayed, true);
  assert.equal(approveReplay.deploymentPatch, null);

  const activate = activationFixture();
  const activated = evaluateActivationTransition(activate);
  const activationReplay = evaluateActivationTransition({
    ...activate,
    existingEvents: [...activate.existingEvents, activated.event],
  });
  assert.equal(activationReplay.replayed, true);
  assert.equal(activationReplay.deploymentPatch, null);

  const conflicting = structuredClone(approve);
  conflicting.intent.action = 'revoke';
  conflicting.signature = approvalIntentSignature(conflicting.intent, OPERATOR_KEY);
  assert.throws(() => evaluateApprovalTransition({
    ...conflicting, existingEvents: [approved.event],
  }), { code: 'APPROVAL_IDEMPOTENCY_CONFLICT' });

  const revoke = approvalFixture('revoke');
  const revoked = evaluateApprovalTransition({ ...revoke, existingEvents: [approved.event] });
  assert.equal(revoked.event.DECISION, 'Revoked');
  assert.equal(revoked.event.PREVIOUS_EVENT_HASH, approved.event.EVENT_HASH);
  assert.equal(revoked.deploymentPatch.TEST_STATUS, 'Stopped');
  assert.equal(revoked.deploymentPatch.GO_LIVE_APPROVAL_STATUS, 'Revoked');
});

test('approval and activation fail closed on invalid signature, stale state, capacity, or Production', () => {
  const approve = approvalFixture();
  assert.throws(() => evaluateApprovalTransition({
    ...approve, signature: `v1=${'0'.repeat(64)}`,
  }), { code: 'INVALID_APPROVAL_SIGNATURE' });
  assert.throws(() => evaluateApprovalTransition({
    ...approve, deployment: { ...approve.deployment, COUNT_VERSION: 5 },
  }), { code: 'APPROVAL_CONCURRENT_CHANGE' });
  assert.throws(() => evaluateApprovalTransition({
    ...approve, deployment: { ...approve.deployment, BINDING_VERSION: 3 },
  }), { code: 'ROUTE_FINGERPRINT_MISMATCH' });
  assert.throws(() => evaluateApprovalTransition({
    ...approve, nowMs: APPROVAL_NOW + 1_000_000,
  }), { code: 'STALE_APPROVAL_INTENT' });
  assert.throws(() => evaluateApprovalTransition({
    ...approve, deployment: { ...approve.deployment, ACTIVATION_EVENT_KEY: `activation_${'f'.repeat(64)}` },
  }), { code: 'APPROVAL_PRECONDITION_FAILED' });
  assert.throws(() => evaluateApprovalTransition({
    ...approve,
    deployment: { ...approve.deployment, HANDLED_COUNT: 25 },
    evidence: { ...approve.evidence, handled_count: 25 },
  }), { code: 'CAPACITY_UNAVAILABLE' });

  const production = approvalFixture('approve', {
    deployment: { SOURCE_ENVIRONMENT: 'production' },
    configurationVersion: { ENVIRONMENT: 'production', SOURCE_ENVIRONMENT: 'production' },
  });
  assert.throws(() => evaluateApprovalTransition(production), { code: 'PRODUCTION_DARK' });

  const activate = activationFixture();
  assert.throws(() => evaluateActivationTransition({
    ...activate,
    evidence: { ...activate.evidence, status: 'ready' },
  }), { code: 'INVALID_ACTIVATION_EVIDENCE' });
  assert.throws(() => evaluateActivationTransition({
    ...activate,
    deployment: { ...activate.deployment, HANDLED_COUNT: 25 },
  }), { code: 'CAPACITY_UNAVAILABLE' });
});

test('any governed configuration, route, source, or readback change invalidates activation', () => {
  const cases = [
    (fixture) => { fixture.deployment.ACTIVE_CONFIGURATION_VERSION_ID = 'configuration_changed'; },
    (fixture) => { fixture.deployment.APPROVED_CONFIGURATION_VERSION_ID = 'configuration_changed'; },
    (fixture) => { fixture.deployment.ACTUAL_START_AT = new Date(ACTIVATION_NOW).toISOString(); },
    (fixture) => { fixture.configurationVersion.CONFIGURATION_JSON = JSON.stringify({ changed: true }); },
    (fixture) => { fixture.configurationVersion.PLAN_TIER = 'Launch'; },
    (fixture) => { fixture.configurationVersion.DEPLOYMENT_STATUS = 'Paused'; },
    (fixture) => { fixture.configurationVersion.GO_LIVE_APPROVAL_STATUS = 'Blocked'; },
    (fixture) => { fixture.configurationVersion.LIMIT_POLICY = 'disabled'; },
    (fixture) => { fixture.configurationVersion.BILLING_MODE = 'disabled'; },
    (fixture) => { fixture.configurationVersion.NUMBER_OWNERSHIP = 'client_owned'; },
    (fixture) => { fixture.configurationVersion.ENVIRONMENT = 'production'; },
    (fixture) => { fixture.deployment.BINDING_VERSION += 1; },
    (fixture) => { fixture.deployment.MONITOR_AGENT_VERSION += 1; },
    (fixture) => { fixture.deployment.COVERAGE_MODE = 'NoAnswerOverflowOnly'; },
    (fixture) => { fixture.deployment.SOURCE_REVISION = 'b'.repeat(40); },
    (fixture) => { fixture.evidence.route_readback_fingerprint = `readback_${'7'.repeat(64)}`; },
  ];

  for (const mutate of cases) {
    const fixture = activationFixture();
    mutate(fixture);
    assert.throws(() => evaluateActivationTransition(fixture));
  }

  const stale = activationFixture();
  stale.nowMs = ACTIVATION_NOW + 1_000_000;
  assert.throws(() => evaluateActivationTransition(stale), { code: 'STALE_ACTIVATION_INTENT' });
});
