'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RECONCILIATION_PROFILE, RECONCILIATION_SIGNATURE_DOMAIN, canonicalReconciliationIntent,
  successorConfigurationVersionId, successorConfigurationRow, successorDeployment,
  COMPLETION_PROFILE, COMPLETION_SIGNATURE_DOMAIN, canonicalCompletionIntent,
  completionConfigurationVersionId, completionConfigurationRow, completionDeployment,
} = require('../lib/configuration-reconciliation');

const originalClaim = `cfgstage_${'a'.repeat(64)}`;
const oldRevision = 'b'.repeat(40);
const newRevision = 'c'.repeat(40);

function originalRequest({ baseline = true } = {}) {
  const candidate = { clientId: 'synthetic_recovery_client', configurationVersion: 'synthetic_form2_v1',
    ...(baseline ? { reportBaseline: { configurationVersionId: 'synthetic_original_configuration',
      capturedAt: '2026-09-01T12:00:00.000Z', sourceModifiedAt: '2026-08-30T12:00:00.000Z',
      sourcePeriod: { start: '2026-08-01T00:00:00.000Z', end: '2026-09-01T00:00:00.000Z' },
      values: { currentCallHandling: 'Voicemail', monthlyInboundCalls: null } } } : {}) };
  return { configurationRow: { CONFIGURATION_VERSION_ID: 'synthetic_original_configuration',
    DEPLOYMENT_ID: `cfgdeploy_${'d'.repeat(64)}`, SOURCE_REVISION: oldRevision,
    CONFIGURATION_JSON: JSON.stringify(candidate) },
  deployment: { DEPLOYMENT_ID: `cfgdeploy_${'d'.repeat(64)}`, SOURCE_REVISION: oldRevision,
    ACTIVE_CONFIGURATION_VERSION_ID: 'synthetic_original_configuration', CLIENT_ID: candidate.clientId } };
}

function intent() {
  return { schema_version: 1, action: 'reconcile_configuration', original_claim_key: originalClaim,
    original_claim_fingerprint: 'e'.repeat(64), original_request_fingerprint: 'f'.repeat(64),
    original_configuration_version_id: 'synthetic_original_configuration',
    original_configuration_fingerprint: `config_${'1'.repeat(64)}`, original_source_revision: oldRevision,
    target_source_revision: newRevision, deployment_id: `cfgdeploy_${'d'.repeat(64)}`,
    configuration_version_id: successorConfigurationVersionId(originalClaim, 'synthetic_original_configuration'),
    route_fingerprint: `route_${'2'.repeat(64)}`, expected_receipt_version: 0,
    operator_id_hash: `operator_${'3'.repeat(64)}`,
    evidence_observed_at: '2026-09-02T12:00:00.000Z', requested_at: '2026-09-02T12:01:00.000Z' };
}

test('successor identity is stable across release attempts and isolated by original claim/configuration', () => {
  const request = originalRequest();
  const first = successorConfigurationRow(request, originalClaim, newRevision);
  const second = successorConfigurationRow(request, originalClaim, 'e'.repeat(40));
  assert.equal(first.CONFIGURATION_VERSION_ID, second.CONFIGURATION_VERSION_ID);
  assert.notEqual(first.CONFIGURATION_VERSION_ID,
    successorConfigurationVersionId(`cfgstage_${'0'.repeat(64)}`, 'synthetic_original_configuration'));
  assert.notEqual(first.CONFIGURATION_VERSION_ID,
    successorConfigurationVersionId(originalClaim, 'synthetic_other_configuration'));
});

test('successor changes only release/physical references and preserves historical baseline facts', () => {
  const request = originalRequest(); const before = structuredClone(request);
  const row = successorConfigurationRow(request, originalClaim, newRevision);
  const deployment = successorDeployment(request, originalClaim, newRevision);
  const originalJson = JSON.parse(request.configurationRow.CONFIGURATION_JSON);
  const expectedJson = structuredClone(originalJson);
  expectedJson.reportBaseline.configurationVersionId = row.CONFIGURATION_VERSION_ID;
  assert.deepEqual(row, { ...request.configurationRow, SOURCE_REVISION: newRevision,
    CONFIGURATION_VERSION_ID: successorConfigurationVersionId(originalClaim, 'synthetic_original_configuration'),
    CONFIGURATION_JSON: JSON.stringify(expectedJson) });
  assert.deepEqual(deployment, { ...request.deployment, SOURCE_REVISION: newRevision,
    ACTIVE_CONFIGURATION_VERSION_ID: row.CONFIGURATION_VERSION_ID });
  assert.deepEqual(request, before);
  assert.equal(JSON.parse(row.CONFIGURATION_JSON).reportBaseline.values.monthlyInboundCalls, null);
  assert.ok(Object.isFrozen(row)); assert.ok(Object.isFrozen(deployment));
  const withoutBaseline = originalRequest({ baseline: false });
  assert.equal(successorConfigurationRow(withoutBaseline, originalClaim, newRevision).CONFIGURATION_JSON,
    withoutBaseline.configurationRow.CONFIGURATION_JSON);
});

test('successor rejects conflicting baseline ownership, malformed/noncanonical payloads and deployment bindings', () => {
  for (const change of [
    (request) => { request.configurationRow.CONFIGURATION_JSON = '{'; },
    (request) => { request.configurationRow.CONFIGURATION_JSON += ' '; },
    (request) => { request.configurationRow.CONFIGURATION_JSON = '{"reportBaseline":null}'; },
    (request) => { request.configurationRow.CONFIGURATION_JSON = '{"reportBaseline":{"configurationVersionId":"other"}}'; },
    (request) => { request.deployment.SOURCE_REVISION = newRevision; },
    (request) => { request.deployment.ACTIVE_CONFIGURATION_VERSION_ID = 'other'; },
    (request) => { request.deployment.DEPLOYMENT_ID = 'other'; },
  ]) {
    const request = originalRequest(); change(request);
    assert.throws(() => successorDeployment(request, originalClaim, newRevision),
      { code: 'CONFIGURATION_STAGING_REVIEW_INVALID' });
  }
});

test('reconciliation intent has a separate action/domain and one exact canonical field/type contract', () => {
  const value = intent();
  assert.equal(RECONCILIATION_PROFILE, 'free-test-configuration-reconciliation-v1');
  assert.notEqual(RECONCILIATION_SIGNATURE_DOMAIN, 'revenue-desk-configuration-staging-intent-v1\0');
  assert.equal(canonicalReconciliationIntent(value), canonicalReconciliationIntent(
    Object.fromEntries(Object.entries(value).reverse())));
  for (const mutate of [
    (next) => { next.extra = true; }, (next) => { delete next.original_claim_fingerprint; },
    (next) => { next.action = 'approve'; }, (next) => { next.expected_receipt_version = '0'; },
    (next) => { next.configuration_version_id = 'another_version'; },
    (next) => { next.requested_at = '2026-09-02T11:59:00.000Z'; },
    (next) => { next.evidence_observed_at = '2026-09-02T12:00:00Z'; },
    (next) => { next.original_source_revision = 'unknown'; },
    (next) => { next.original_configuration_fingerprint = '1'.repeat(64); },
    (next) => { next.original_claim_fingerprint = null; },
  ]) {
    const next = structuredClone(value); mutate(next);
    assert.throws(() => canonicalReconciliationIntent(next), { code: 'CONFIGURATION_STAGING_REVIEW_INVALID' });
  }
});

test('completion preserves both historical snapshots and uses one release-independent successor identity', () => {
  const recovery = { profile: RECONCILIATION_PROFILE, originalRequest: originalRequest(), intent: intent() };
  const before = structuredClone(recovery); const key = `cfgreconcile_${'4'.repeat(64)}`;
  const row = completionConfigurationRow(recovery, key, '5'.repeat(40));
  const projected = completionDeployment(recovery, key, '5'.repeat(40));
  assert.equal(COMPLETION_PROFILE, 'free-test-configuration-completion-v1');
  assert.notEqual(COMPLETION_SIGNATURE_DOMAIN, RECONCILIATION_SIGNATURE_DOMAIN);
  assert.equal(row.CONFIGURATION_VERSION_ID,
    completionConfigurationRow(recovery, key, '6'.repeat(40)).CONFIGURATION_VERSION_ID);
  assert.equal(row.CONFIGURATION_VERSION_ID, completionConfigurationVersionId(key, recovery.intent.configuration_version_id));
  assert.notEqual(row.CONFIGURATION_VERSION_ID,
    completionConfigurationVersionId(`cfgreconcile_${'7'.repeat(64)}`, recovery.intent.configuration_version_id));
  const expected = JSON.parse(recovery.originalRequest.configurationRow.CONFIGURATION_JSON);
  expected.reportBaseline.configurationVersionId = row.CONFIGURATION_VERSION_ID;
  assert.deepEqual(JSON.parse(row.CONFIGURATION_JSON), expected);
  assert.equal(projected.ACTIVE_CONFIGURATION_VERSION_ID, row.CONFIGURATION_VERSION_ID);
  assert.equal(projected.SOURCE_REVISION, '5'.repeat(40));
  assert.equal(projected.DEPLOYMENT_ID, recovery.originalRequest.deployment.DEPLOYMENT_ID);
  assert.deepEqual(recovery, before);
});

test('completion intent rejects coercion, missing chain evidence, wrong identity and ambiguous timestamps', () => {
  const recovery = intent(); const key = `cfgreconcile_${'4'.repeat(64)}`;
  const value = { schema_version: 1, action: 'complete_configuration', original_claim_key: originalClaim,
    original_claim_fingerprint: '1'.repeat(64), reconciliation_claim_key: key,
    reconciliation_claim_fingerprint: '2'.repeat(64),
    original_source_revision: oldRevision, reconciliation_source_revision: newRevision, target_source_revision: '5'.repeat(40),
    original_configuration_fingerprint: `config_${'6'.repeat(64)}`,
    reconciled_configuration_version_id: recovery.configuration_version_id,
    reconciled_configuration_fingerprint: `config_${'7'.repeat(64)}`, deployment_id: recovery.deployment_id,
    expected_deployment_fingerprint: `deployment_${'8'.repeat(64)}`, expected_deployment_version: 0,
    expected_receipt_version: 0, configuration_version_id: completionConfigurationVersionId(key, recovery.configuration_version_id),
    configuration_fingerprint: `config_${'9'.repeat(64)}`, route_fingerprint: recovery.route_fingerprint,
    operator_id_hash: recovery.operator_id_hash, evidence_observed_at: recovery.evidence_observed_at,
    requested_at: recovery.requested_at };
  assert.equal(canonicalCompletionIntent(value), canonicalCompletionIntent(Object.fromEntries(Object.entries(value).reverse())));
  for (const mutate of [
    (next) => { next.extra = true; }, (next) => { delete next.reconciliation_claim_fingerprint; },
    (next) => { next.expected_deployment_version = '0'; }, (next) => { next.expected_receipt_version = 1; },
    (next) => { next.target_source_revision = newRevision; }, (next) => { next.action = 'approve'; },
    (next) => { next.configuration_version_id = recovery.configuration_version_id; },
    (next) => { next.requested_at = '2026-09-02T11:59:00.000Z'; },
    (next) => { next.evidence_observed_at = '2026-09-02T12:00:00Z'; },
  ]) {
    const next = structuredClone(value); mutate(next);
    assert.throws(() => canonicalCompletionIntent(next), { code: 'CONFIGURATION_STAGING_REVIEW_INVALID' });
  }
});
