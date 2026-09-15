'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { installOfflineGuard } = require('./helpers/offline-guard');
const guard = installOfflineGuard();
const { createFreeTestConfigurationReview } = require('../lib/free-test-configuration-review');
const { prepareFreeTestConfiguration } = require('../lib/free-test-preparation');
const { approvalIntentSignature, canonicalApprovalIntent, evaluateApprovalTransition,
  routeFingerprint, routeFromRows }
  = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/approval-control');
const { SYNTHETIC_NOW, syntheticPreparationInputs } = require('./fixtures/free-test-preparation');

const context = Object.freeze({ environment: 'development', sourceRevision: 'e'.repeat(40),
  operatorIdHash: `operator_${'a'.repeat(64)}`,
  operatorVerificationSecret: 'synthetic-only-review-material-not-a-live-secret', now: () => SYNTHETIC_NOW });

function sign(request) {
  request.signature = approvalIntentSignature(request.intent, context.operatorVerificationSecret);
  return request;
}

function fixture(index = 0) {
  const input = syntheticPreparationInputs()[index];
  input.review.configurationVersionId = `synthetic_config_row_${index}`;
  const candidate = prepareFreeTestConfiguration(input, { now: SYNTHETIC_NOW }).candidate;
  const configurationRow = {
    CONFIGURATION_VERSION_ID: input.review.configurationVersionId,
    DEPLOYMENT_ID: candidate.deploymentId, CONFIGURATION_VERSION: candidate.configurationVersion,
    CONFIGURATION_JSON: JSON.stringify(candidate), ENGAGEMENT_TYPE: 'free_test',
    CAPABILITY_PROFILE: 'call_gap_monitor_v1', PLAN_TIER: 'none',
    DEPLOYMENT_STATUS: 'Setup Pending', GO_LIVE_APPROVAL_STATUS: 'Not Ready',
    LIMIT_POLICY: 'seven_calendar_days_or_25_connected_calls_v1', BILLING_MODE: 'none',
    NUMBER_OWNERSHIP: 'dedicated_deployment', ENVIRONMENT: 'development',
    SOURCE_REVISION: context.sourceRevision, SOURCE_ENVIRONMENT: 'development',
    STATUS: 'Draft', APPROVAL_STATUS: 'Pending',
  };
  const deployment = {
    CLIENT_ID: candidate.clientId, DEPLOYMENT_ID: candidate.deploymentId,
    ACTIVE_CONFIGURATION_VERSION_ID: configurationRow.CONFIGURATION_VERSION_ID,
    NUMBER_LOOKUP_HASH: `num_${String(index + 1).repeat(64)}`,
    BINDING_ID: `synthetic_binding_${index}`, BINDING_VERSION: 1,
    MONITOR_AGENT_ID: 'synthetic_agent_not_provider_verified', MONITOR_AGENT_VERSION: 1,
    COVERAGE_MODE: 'AfterHoursOnly', CALL_LIMIT: 25, COUNT_VERSION: 0, HANDLED_COUNT: 0,
    SOURCE_REVISION: context.sourceRevision, SOURCE_ENVIRONMENT: 'development',
    TEST_STATUS: 'Setup Pending', GO_LIVE_APPROVAL_STATUS: 'Not Ready',
  };
  const intent = {
    schema_version: 1, event_id: `approval_${'b'.repeat(64)}`, action: 'approve',
    deployment_id: candidate.deploymentId,
    configuration_version_id: configurationRow.CONFIGURATION_VERSION_ID,
    route_fingerprint: routeFingerprint(routeFromRows(deployment, configurationRow)),
    evidence_revision: context.sourceRevision, evidence_observed_at: input.evidence.capturedAt,
    requested_at: new Date(SYNTHETIC_NOW).toISOString(), operator_id_hash: context.operatorIdHash,
    expected_deployment_version: 0,
  };
  return sign({ input, configurationRow, deployment, intent, signature: '' });
}

test('exact owner-signed content review preserves unapproved inputs and grants no execution', () => {
  const review = createFreeTestConfigurationReview(context);
  const request = fixture();
  const before = structuredClone(request);
  const result = review(request);
  assert.equal(result.status, 'signed_content_review_verified_local_only');
  assert.match(result.configurationFingerprint, /^config_[a-f0-9]{64}$/);
  assert.equal(result.routeFingerprint, request.intent.route_fingerprint);
  assert.equal(result.evidenceRevision, context.sourceRevision);
  assert.equal(result.sourceEvidenceStatus, 'locally_consistent_not_authenticated');
  for (const key of ['creationAuthorized', 'promotionAuthorized', 'deploymentAuthorized', 'providerVerified']) {
    assert.equal(result[key], false);
  }
  assert.deepEqual(result.unresolved, ['AUTHENTICATED_CONFIGURATION_CREATION_PROMOTION_REQUIRED']);
  assert.deepEqual(review(request), result); // Pure replay is not a consumed write allocation.
  assert.deepEqual(request, before);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(request.input.crm.deal.Alert_Recipient_Email));
  assert.ok(!serialized.includes(context.operatorVerificationSecret));
  assert.ok(!serialized.includes(request.input.crm.account.Account_Name));
});

test('request-supplied reviewer names, keys or unsigned owner assertions cannot authenticate', () => {
  const review = createFreeTestConfigurationReview(context);
  for (const field of ['reviewerName', 'operatorVerificationSecret', 'operatorIdHash', 'verified']) {
    const request = fixture(); request[field] = field === 'reviewerName' ? 'Gabriel' : true;
    assert.throws(() => review(request), { code: 'INVALID_CONFIGURATION_REVIEW' });
  }
  const wrongOwner = fixture();
  wrongOwner.intent.operator_id_hash = `operator_${'c'.repeat(64)}`;
  sign(wrongOwner);
  assert.throws(() => review(wrongOwner), { code: 'CONFIGURATION_REVIEW_OWNER_MISMATCH' });
  const missing = fixture(); missing.signature = undefined;
  assert.throws(() => review(missing), { code: 'INVALID_APPROVAL_SIGNATURE' });
  const wrongSignature = fixture(); wrongSignature.signature = `v1=${'0'.repeat(64)}`;
  assert.throws(() => review(wrongSignature), { code: 'INVALID_APPROVAL_SIGNATURE' });
  const tampered = fixture(); tampered.intent.event_id = `approval_${'d'.repeat(64)}`;
  assert.throws(() => review(tampered), { code: 'INVALID_APPROVAL_SIGNATURE' });
});

test('server context is fixed, Development-only and cannot be selected by the request', () => {
  for (const patch of [{ environment: 'production' }, { operatorIdHash: 'Gabriel' },
    { sourceRevision: 'current' }, { operatorVerificationSecret: 'short' }]) {
    assert.throws(() => createFreeTestConfigurationReview({ ...context, ...patch }),
      { code: 'INVALID_CONFIGURATION_REVIEW_CONTEXT' });
  }
  const options = { ...context };
  const review = createFreeTestConfigurationReview(options);
  options.operatorIdHash = `operator_${'c'.repeat(64)}`;
  assert.equal(review(fixture()).status, 'signed_content_review_verified_local_only');
});

test('changed recipient, complete content, draft bytes or source evidence invalidates exact review', () => {
  const review = createFreeTestConfigurationReview(context);
  const mutations = [
    (r) => { r.input.crm.deal.Alert_Recipient_Email = 'different@example.invalid'; },
    (r) => { r.input.crm.deal.Alert_Recipient_Name = 'Another synthetic owner'; },
    (r) => { r.input.review.callbackExpectation = 'A different reviewable callback description'; },
    (r) => { r.input.review.notificationHandoff.acknowledgmentReference = 'another_ack'; },
    (r) => { r.configurationRow.CONFIGURATION_JSON += ' '; },
    (r) => { r.configurationRow.extra = 'not-covered'; },
    (r) => { r.configurationRow.ROWID = '100'; },
    (r) => { r.configurationRow.STATUS = 'Active'; },
    (r) => { r.configurationRow.APPROVAL_STATUS = 'Approved'; },
    (r) => { r.configurationRow.DEPLOYMENT_STATUS = 'Live'; },
    (r) => { r.configurationRow.GO_LIVE_APPROVAL_STATUS = 'Approved'; },
    (r) => { const v = JSON.parse(r.configurationRow.CONFIGURATION_JSON);
      v.approved = true; v.notificationRecipient.approved = true;
      r.configurationRow.CONFIGURATION_JSON = JSON.stringify(v); },
  ];
  for (const mutate of mutations) {
    const request = fixture(); mutate(request);
    assert.throws(() => review(request), { code: 'CONFIGURATION_REVIEW_CONTENT_MISMATCH' });
  }
  // Even internally consistent new contents need a new exact review, not the old signature.
  const changed = fixture(); changed.input.crm.deal.Alert_Recipient_Email = 'new@example.invalid';
  changed.configurationRow.CONFIGURATION_JSON = JSON.stringify(
    prepareFreeTestConfiguration(changed.input, { now: SYNTHETIC_NOW }).candidate);
  assert.throws(() => review(changed), { code: 'CONFIGURATION_REVIEW_CONTENT_MISMATCH' });
});

test('cross-client, changed route, revision, version, active and stopped state are rejected', () => {
  const review = createFreeTestConfigurationReview(context);
  const a = fixture(0); const b = fixture(1);
  assert.notEqual(review(a).configurationFingerprint, review(b).configurationFingerprint);
  for (const key of ['input', 'configurationRow', 'deployment']) {
    const request = fixture(); request[key] = b[key];
    assert.throws(() => review(request));
  }
  for (const [field, value] of [['CLIENT_ID', 'another_client'], ['COUNT_VERSION', 1],
    ['SOURCE_REVISION', 'f'.repeat(40)], ['SOURCE_ENVIRONMENT', 'production'], ['CALL_LIMIT', 26],
    ['HANDLED_COUNT', 1], ['TEST_STATUS', 'Live'], ['TEST_STATUS', 'Stopped'],
    ['ACTUAL_START_AT', new Date(SYNTHETIC_NOW).toISOString()],
    ['APPROVED_CONFIGURATION_VERSION_ID', 'previous_configuration']]) {
    const request = fixture(); request.deployment[field] = value;
    assert.throws(() => review(request), { code: 'CONFIGURATION_REVIEW_TARGET_MISMATCH' });
  }
  const route = fixture(); route.deployment.BINDING_VERSION = 2;
  assert.throws(() => review(route), { code: 'CONFIGURATION_REVIEW_CONTENT_MISMATCH' });
  const revision = fixture(); revision.intent.evidence_revision = 'f'.repeat(40); sign(revision);
  assert.throws(() => review(revision), { code: 'CONFIGURATION_REVIEW_OWNER_MISMATCH' });
  const revoke = fixture(); revoke.intent.action = 'revoke'; sign(revoke);
  assert.throws(() => review(revoke), { code: 'CONFIGURATION_REVIEW_OWNER_MISMATCH' });
});

test('expired/future/mismatched evidence and unresolved preparation cannot be reviewed', () => {
  const review = createFreeTestConfigurationReview(context);
  const expired = fixture();
  expired.intent.requested_at = new Date(SYNTHETIC_NOW - 300001).toISOString(); sign(expired);
  assert.throws(() => review(expired), { code: 'STALE_APPROVAL_INTENT' });
  for (const patch of [{ requested_at: new Date(SYNTHETIC_NOW + 1).toISOString() },
    { evidence_observed_at: new Date(SYNTHETIC_NOW - 900001).toISOString() },
    { evidence_observed_at: new Date(SYNTHETIC_NOW + 1).toISOString() },
    { evidence_observed_at: new Date(SYNTHETIC_NOW - 1).toISOString() }]) {
    const request = fixture(); Object.assign(request.intent, patch); sign(request);
    assert.throws(() => review(request), { code: 'CONFIGURATION_REVIEW_EVIDENCE_STALE' });
  }
  for (const mutate of [
    (r) => { r.input.crm.deal.Approved_Test_Route = 'Both'; r.input.crm.deal.No_Answer_Delay = 25; },
    (r) => { delete r.input.review.notificationHandoff; },
    (r) => { r.input.review.notificationHandoff.monitored = false; },
    (r) => { r.input.crm.account.Phone = '(913) 555-0101'; },
    (r) => { r.input.evidence.proof.STATUS = 'verified'; },
  ]) {
    const request = fixture(); mutate(request);
    assert.throws(() => review(request), { code: 'CONFIGURATION_REVIEW_PREPARATION_BLOCKED' });
  }
});

test('rule has no signer, SDK, credentials, I/O or writer and offline boundaries remain untouched', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/free-test-configuration-review.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:node:|zcatalyst|https?|net|tls|child_process)/);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|setInterval|setTimeout)\s*\(|process\.env|console\./);
  assert.doesNotMatch(source, /\b(?:insertUnique|conditionalUpdate|approvalIntentSignature)\s*\(/);
  assert.deepEqual(guard.blocked, []);
});

test('content-review signature cannot authorize a promoted row or cross HMAC domains', () => {
  const request = fixture();
  assert.equal(createFreeTestConfigurationReview(context)(request).creationAuthorized, false);
  const existingApprovalInput = {
    intent: request.intent, signature: request.signature,
    operatorVerificationSecret: context.operatorVerificationSecret,
    eventChainSecret: 'synthetic-only-event-chain-material-not-live',
    deployment: request.deployment, configurationVersion: request.configurationRow,
    evidence: {}, nowMs: SYNTHETIC_NOW,
  };
  assert.throws(() => evaluateApprovalTransition(existingApprovalInput),
    { code: 'APPROVAL_PRECONDITION_FAILED' });
  const promoted = structuredClone(request.configurationRow);
  promoted.STATUS = 'Active'; promoted.APPROVAL_STATUS = 'Approved';
  promoted.DEPLOYMENT_STATUS = 'Live'; promoted.GO_LIVE_APPROVAL_STATUS = 'Approved';
  const values = JSON.parse(promoted.CONFIGURATION_JSON);
  values.approved = true; values.notificationRecipient.approved = true;
  promoted.CONFIGURATION_JSON = JSON.stringify(values);
  assert.throws(() => evaluateApprovalTransition({ ...existingApprovalInput,
    configurationVersion: promoted, deployment: { ...request.deployment,
      TEST_STATUS: 'Ready for Approval', GO_LIVE_APPROVAL_STATUS: 'Pending Internal Approval' } }),
  { code: 'ROUTE_FINGERPRINT_MISMATCH' });

  // The same canonical intent bytes under another existing HMAC domain are
  // not an approval signature, even though the configured key is the same.
  const wrongDomain = fixture();
  wrongDomain.signature = `v1=${crypto.createHmac('sha256', context.operatorVerificationSecret)
    .update('revenue-desk-activation-intent-v1\0', 'utf8')
    .update(canonicalApprovalIntent(wrongDomain.intent), 'utf8').digest('hex')}`;
  assert.throws(() => createFreeTestConfigurationReview(context)(wrongDomain),
    { code: 'INVALID_APPROVAL_SIGNATURE' });
});
