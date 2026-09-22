'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RECONCILIATION_PROFILE, RECONCILIATION_SIGNATURE_DOMAIN, canonicalReconciliationIntent,
  successorConfigurationVersionId, successorConfigurationRow, successorDeployment,
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
