'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { installOfflineGuard } = require('./helpers/offline-guard');
const guard = installOfflineGuard();
const { createStagingFixture }
  = require('../../revenue-desk-call-runtime/functions/revenue_desk_route_control/test/helpers/configuration-staging-fixture');
const { syntheticPreparationInputs } = require('./fixtures/free-test-preparation');
const { canonicalApprovalIntent, configurationSnapshotFingerprint, routeFingerprint, routeFromRows }
  = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/approval-control');
const { PROFILE, SIGNATURE_DOMAIN, MAX_STAGING_PACKET_BYTES, MAX_SECRET_UTF8_BYTES,
  BINDINGS_PROFILE, MAX_BINDING_SECRET_BYTES, validateStagingBindingInput, deriveStagingBindings,
  validateUnsignedStagingEnvelope, signFreeTestStagingPacket,
  RECONCILIATION_PROFILE, validateUnsignedReconciliationEnvelope, signFreeTestReconciliationPacket,
  COMPLETION_PROFILE, validateUnsignedCompletionEnvelope, signFreeTestCompletionPacket }
  = require('../lib/free-test-staging-packet');
const { canonicalReconciliationIntent, RECONCILIATION_SIGNATURE_DOMAIN,
  successorConfigurationRow, successorDeployment, COMPLETION_SIGNATURE_DOMAIN, canonicalCompletionIntent,
  completionConfigurationRow, completionDeployment, inactiveDeploymentFingerprint }
  = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/configuration-reconciliation');

// Only synthetic fixtures and fake keys enter this suite. A signed packet is
// exercised against the existing controller with in-memory adapters, never I/O.
function fixture(index = 0) {
  const liveShape = createStagingFixture(index);
  const preparation = syntheticPreparationInputs()[index];
  preparation.classification = 'private-preparation';
  preparation.review = structuredClone(liveShape.request.review);
  const request = structuredClone(liveShape.request);
  delete request.signature;
  return { liveShape, envelope: { schemaVersion: 1, preparation, preservedCoreApproval: null, request },
    options: { expectedRevision: liveShape.config.sourceRevision,
      expectedOperatorHash: liveShape.config.operatorIdHash, now: liveShape.now(), maxBodyBytes: 16384 } };
}

function sign(f) {
  const secret = Buffer.from(f.liveShape.config.operatorVerificationSecret, 'ascii');
  try { return signFreeTestStagingPacket(f.envelope, { ...f.options, secret }); }
  finally { secret.fill(0); }
}

async function reconciliationFixture() {
  const f = fixture(); const originalRequest = structuredClone(sign(f).packet);
  const insert = f.liveShape.store.insertUnique.bind(f.liveShape.store);
  f.liveShape.store.insertUnique = async (table, ...args) => {
    if (table === f.liveShape.config.tables.DEPLOYMENT_TABLE) throw new Error('Synthetic schema interruption');
    return insert(table, ...args);
  };
  await assert.rejects(f.liveShape.service.stage(originalRequest));
  f.liveShape.store.insertUnique = insert;
  const [receipt] = f.liveShape.store.rowsFor(f.liveShape.config.tables.EVENT_RECEIPT_TABLE);
  const data = JSON.parse(receipt.EVENT_DATA_JSON);
  const targetRevision = 'f'.repeat(40);
  const now = f.options.now + 86_400_000;
  const row = successorConfigurationRow(originalRequest, receipt.EVENT_KEY, targetRevision);
  const deployment = successorDeployment(originalRequest, receipt.EVENT_KEY, targetRevision);
  const intent = { schema_version: 1, action: 'reconcile_configuration',
    original_claim_key: receipt.EVENT_KEY, original_claim_fingerprint: receipt.PAYLOAD_FINGERPRINT,
    original_request_fingerprint: data.requestFingerprint,
    original_configuration_version_id: originalRequest.configurationRow.CONFIGURATION_VERSION_ID,
    original_configuration_fingerprint: configurationSnapshotFingerprint(originalRequest.configurationRow),
    original_source_revision: f.options.expectedRevision, target_source_revision: targetRevision,
    deployment_id: originalRequest.deployment.DEPLOYMENT_ID,
    configuration_version_id: row.CONFIGURATION_VERSION_ID,
    route_fingerprint: routeFingerprint(routeFromRows(deployment, row)), expected_receipt_version: 0,
    operator_id_hash: f.options.expectedOperatorHash,
    evidence_observed_at: new Date(now).toISOString(), requested_at: new Date(now).toISOString() };
  return { original: f, envelope: { schemaVersion: 1, originalEnvelope: structuredClone(f.envelope),
    request: { profile: RECONCILIATION_PROFILE, originalRequest, intent } },
  options: { ...f.options, expectedRevision: targetRevision, now } };
}

function signReconciliation(f, secretText = f.original.liveShape.config.operatorVerificationSecret) {
  const secret = Buffer.from(secretText, 'utf8');
  try { return signFreeTestReconciliationPacket(f.envelope, { ...f.options, secret }); }
  finally { secret.fill(0); }
}

async function completionFixture() {
  const prior = await reconciliationFixture(); const runtime = prior.original.liveShape;
  const { createConfigurationStagingService, RECONCILIATION_RECEIPT_KIND }
    = require('../../revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/configuration-staging-service');
  const reconciliationRequest = structuredClone(signReconciliation(prior).packet);
  runtime.advance(prior.options.now - runtime.now());
  const serviceAt = (sourceRevision) => createConfigurationStagingService({
    config: { ...runtime.config, sourceRevision }, store: runtime.store, crm: runtime.crm,
    core: runtime.core, sourceReader: runtime.sourceReader, conversionReader: runtime.conversionReader, now: runtime.now });
  const record = runtime.crm.recordConfigurationStaging;
  runtime.crm.recordConfigurationStaging = async () => { throw new Error('Synthetic interrupted recovery before CRM'); };
  await assert.rejects(serviceAt(prior.options.expectedRevision).reconcile(reconciliationRequest));
  runtime.crm.recordConfigurationStaging = record;
  const receipt = runtime.store.rowsFor(runtime.config.tables.EVENT_RECEIPT_TABLE)
    .find((row) => row.RECEIPT_KIND === RECONCILIATION_RECEIPT_KIND);
  const data = JSON.parse(receipt.EVENT_DATA_JSON);
  const deployment = runtime.store.rowsFor(runtime.config.tables.DEPLOYMENT_TABLE)[0];
  const targetRevision = 'd'.repeat(40); const now = runtime.now() + 86_400_000;
  const row = completionConfigurationRow(reconciliationRequest, receipt.EVENT_KEY, targetRevision);
  const projected = completionDeployment(reconciliationRequest, receipt.EVENT_KEY, targetRevision);
  const previous = reconciliationRequest.intent;
  const intent = { schema_version: 1, action: 'complete_configuration',
    original_claim_key: previous.original_claim_key, original_claim_fingerprint: previous.original_claim_fingerprint,
    reconciliation_claim_key: receipt.EVENT_KEY, reconciliation_claim_fingerprint: receipt.PAYLOAD_FINGERPRINT,
    original_source_revision: previous.original_source_revision,
    reconciliation_source_revision: previous.target_source_revision, target_source_revision: targetRevision,
    original_configuration_fingerprint: previous.original_configuration_fingerprint,
    reconciled_configuration_version_id: previous.configuration_version_id,
    reconciled_configuration_fingerprint: data.configurationFingerprint, deployment_id: previous.deployment_id,
    expected_deployment_fingerprint: inactiveDeploymentFingerprint(deployment), expected_deployment_version: 0,
    expected_receipt_version: 0, configuration_version_id: row.CONFIGURATION_VERSION_ID,
    configuration_fingerprint: configurationSnapshotFingerprint(row),
    route_fingerprint: routeFingerprint(routeFromRows(projected, row)), operator_id_hash: prior.options.expectedOperatorHash,
    evidence_observed_at: new Date(now).toISOString(), requested_at: new Date(now).toISOString() };
  return { prior, runtime, service: serviceAt(targetRevision),
    envelope: { schemaVersion: 1, reconciliationEnvelope: structuredClone(prior.envelope),
      request: { profile: COMPLETION_PROFILE, reconciliationRequest, intent } },
    options: { ...prior.options, expectedRevision: targetRevision, now } };
}

function signCompletion(f, secretText = f.runtime.config.operatorVerificationSecret) {
  const secret = Buffer.from(secretText, 'utf8');
  try { return signFreeTestCompletionPacket(f.envelope, { ...f.options, secret }); }
  finally { secret.fill(0); }
}

test('completion signs only fresh intent and preserves both historical signed requests', async () => {
  const f = await completionFixture(); const before = structuredClone(f.envelope);
  const validated = validateUnsignedCompletionEnvelope(f.envelope, f.options);
  assert.equal(validated.profile, COMPLETION_PROFILE); assert.equal(validated.durableEvidenceAuthenticated, false);
  const signed = signCompletion(f);
  assert.deepEqual(signed.packet.reconciliationRequest, before.request.reconciliationRequest);
  assert.deepEqual(f.envelope, before);
  assert.equal(Object.isFrozen(signed.packet.reconciliationRequest.originalRequest), true);
  assert.equal(signed.packet.signature, `v1=${crypto.createHmac('sha256', f.runtime.config.operatorVerificationSecret)
    .update(COMPLETION_SIGNATURE_DOMAIN).update(canonicalCompletionIntent(before.request.intent)).digest('hex')}`);
  assert.equal(signed.profile, COMPLETION_PROFILE); assert.equal(signed.sourceRevision, f.options.expectedRevision);
  assert.equal(signed.byteLength, Buffer.byteLength(signed.serialized));
  assert.equal(signed.sha256, crypto.createHash('sha256').update(signed.serialized).digest('hex'));
  assert.equal(signed.serialized.includes(f.runtime.config.operatorVerificationSecret), false);
  assert.equal(Object.hasOwn(signed.packet, 'reconciliationEnvelope'), false);
});

test('completion signer verifies both historical HMACs and their distinct domains', async () => {
  for (const layer of ['original', 'reconciliation']) {
    for (const wrong of ['key', 'domain']) {
      const f = await completionFixture(); const request = f.envelope.request.reconciliationRequest;
      const selected = layer === 'original' ? request.originalRequest : request;
      const intent = layer === 'original' ? canonicalApprovalIntent(selected.intent) : canonicalReconciliationIntent(selected.intent);
      const correctDomain = layer === 'original' ? SIGNATURE_DOMAIN : RECONCILIATION_SIGNATURE_DOMAIN;
      selected.signature = `v1=${crypto.createHmac('sha256', wrong === 'key'
        ? 'synthetic_wrong_key_'.repeat(3) : f.runtime.config.operatorVerificationSecret)
        .update(wrong === 'domain' ? COMPLETION_SIGNATURE_DOMAIN : correctDomain).update(intent).digest('hex')}`;
      if (layer === 'original') f.envelope.reconciliationEnvelope.request.originalRequest.signature = selected.signature;
      assert.equal(validateUnsignedCompletionEnvelope(f.envelope, f.options).durableEvidenceAuthenticated, false);
      assert.throws(() => signCompletion(f), { code: 'INVALID_APPROVAL_SIGNATURE' });
    }
  }
  const f = await completionFixture();
  assert.throws(() => signCompletion(f, 'synthetic_wrong_key_'.repeat(3)), { code: 'INVALID_APPROVAL_SIGNATURE' });
});

test('completion rejects historical drift, wrong revision, malformed counters and stale intent before signing', async () => {
  for (const mutate of [
    (f) => { f.envelope.extra = true; },
    (f) => { f.envelope.request.signature = 'not unsigned'; },
    (f) => { f.envelope.request.reconciliationRequest.originalRequest.review.callbackExpectation = 'Changed'; },
    (f) => { f.envelope.request.reconciliationRequest.intent.requested_at = new Date(f.options.now).toISOString(); },
    (f) => { f.options.expectedRevision = 'c'.repeat(40); },
    (f) => { f.options.expectedOperatorHash = `operator_${'9'.repeat(64)}`; },
    (f) => { f.envelope.request.intent.target_source_revision = f.envelope.request.intent.reconciliation_source_revision; },
    (f) => { f.envelope.request.intent.expected_receipt_version = '0'; },
    (f) => { f.envelope.request.intent.expected_deployment_version = 1; },
    (f) => { f.envelope.request.intent.route_fingerprint = `route_${'0'.repeat(64)}`; },
    (f) => { f.envelope.request.intent.configuration_fingerprint = `config_${'0'.repeat(64)}`; },
    (f) => { f.envelope.request.intent.configuration_version_id = 'replacement_identity'; },
    (f) => { f.options.now += 300001; },
    (f) => { f.envelope.request.intent.evidence_observed_at = new Date(f.options.now - 900001).toISOString(); },
    (f) => { f.envelope.request.intent.requested_at = new Date(f.options.now + 1).toISOString(); },
  ]) {
    const f = await completionFixture(); mutate(f);
    assert.throws(() => validateUnsignedCompletionEnvelope(f.envelope, f.options));
  }
});

test('completion counts both preserved signatures in the exact pre-key size bound', async () => {
  const f = await completionFixture(); const signed = signCompletion(f);
  assert.ok(signed.byteLength > signReconciliation(f.prior).byteLength);
  assert.equal(validateUnsignedCompletionEnvelope(f.envelope,
    { ...f.options, maxBodyBytes: signed.byteLength }).maxBodyBytes, signed.byteLength);
  assert.throws(() => validateUnsignedCompletionEnvelope(f.envelope,
    { ...f.options, maxBodyBytes: signed.byteLength - 1 }), { code: 'STAGING_PACKET_TOO_LARGE' });
  f.options.now += 300000; assert.equal(signCompletion(f).profile, COMPLETION_PROFILE);
  f.options.now += 1; assert.throws(() => signCompletion(f), { code: 'INVALID_STAGING_INTENT' });
});

test('completion signature roundtrips through the real controller with historical preservation and no replay effects', async () => {
  const f = await completionFixture(); const runtime = f.runtime;
  const historical = structuredClone({ receipts: runtime.store.rowsFor(runtime.config.tables.EVENT_RECEIPT_TABLE),
    configurations: runtime.store.rowsFor(runtime.config.tables.CONFIGURATION_VERSION_TABLE) });
  const signed = signCompletion(f); runtime.advance(f.options.now - runtime.now());
  const result = await f.service.complete(signed.packet);
  assert.equal(result.state, 'StagedInactive'); assert.equal(result.completed, true);
  assert.equal(result.approved, false); assert.equal(result.active, false);
  assert.deepEqual(runtime.store.rowsFor(runtime.config.tables.EVENT_RECEIPT_TABLE).slice(0, 2), historical.receipts);
  assert.deepEqual(runtime.store.rowsFor(runtime.config.tables.CONFIGURATION_VERSION_TABLE).slice(0, 2), historical.configurations);
  const [deployment] = runtime.store.rowsFor(runtime.config.tables.DEPLOYMENT_TABLE);
  assert.equal(deployment.SOURCE_REVISION, f.options.expectedRevision);
  assert.equal(deployment.ACTUAL_START_AT, null); assert.equal(deployment.APPROVAL_EVENT_KEY, null);
  assert.equal(runtime.stagingWrites, 1);
  const before = structuredClone([...runtime.store.rows.entries()]); const writes = runtime.store.writes.length;
  runtime.advance(86_400_000);
  assert.deepEqual(await f.service.complete(signed.packet), { ...result, replayed: true });
  assert.deepEqual([...runtime.store.rows.entries()], before);
  assert.equal(runtime.store.writes.length, writes); assert.equal(runtime.stagingWrites, 1);
});

test('completion signer does not authenticate operator-supplied durable fingerprints', async () => {
  const f = await completionFixture();
  f.envelope.request.intent.reconciliation_claim_fingerprint = '0'.repeat(64);
  assert.equal(validateUnsignedCompletionEnvelope(f.envelope, f.options).durableEvidenceAuthenticated, false);
  const signed = signCompletion(f); f.runtime.advance(f.options.now - f.runtime.now());
  const before = structuredClone([...f.runtime.store.rows.entries()]); const writes = f.runtime.store.writes.length;
  await assert.rejects(f.service.complete(signed.packet));
  assert.deepEqual([...f.runtime.store.rows.entries()], before);
  assert.equal(f.runtime.store.writes.length, writes); assert.equal(f.runtime.stagingWrites, 0);
});

test('reconciliation signs fresh owner intent while preserving historical preparation and original signature', async () => {
  const f = await reconciliationFixture(); const before = structuredClone(f.envelope);
  const validated = validateUnsignedReconciliationEnvelope(f.envelope, f.options);
  assert.equal(validated.durableEvidenceAuthenticated, false);
  assert.equal(validated.profile, RECONCILIATION_PROFILE);
  const signed = signReconciliation(f);
  assert.equal(signed.profile, RECONCILIATION_PROFILE);
  assert.deepEqual(signed.packet.originalRequest, before.request.originalRequest);
  assert.deepEqual(f.envelope, before); assert.equal(Object.isFrozen(signed.packet.originalRequest), true);
  assert.equal(signed.packet.signature, `v1=${crypto.createHmac('sha256',
    f.original.liveShape.config.operatorVerificationSecret).update(RECONCILIATION_SIGNATURE_DOMAIN)
    .update(canonicalReconciliationIntent(f.envelope.request.intent)).digest('hex')}`);
  assert.equal(signed.byteLength, Buffer.byteLength(signed.serialized));
  assert.equal(signed.sha256, crypto.createHash('sha256').update(signed.serialized).digest('hex'));
  assert.equal(Object.hasOwn(signed.packet, 'originalEnvelope'), false);
  assert.equal(signed.serialized.includes(f.original.liveShape.config.operatorVerificationSecret), false);
  assert.throws(() => validateUnsignedStagingEnvelope(f.envelope.originalEnvelope,
    { ...f.original.options, now: f.options.now }), { code: 'STAGING_PREPARATION_BLOCKED' });
});

test('private reconciliation signer roundtrips through the real service without approving or starting the test', async () => {
  const { createConfigurationStagingService }
    = require('../../revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/configuration-staging-service');
  const { loadDeployment, activeAt }
    = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/runtime-service');
  const f = await reconciliationFixture(); const runtime = f.original.liveShape;
  const config = { ...runtime.config, sourceRevision: f.options.expectedRevision };
  runtime.advance(f.options.now - runtime.now());
  const service = createConfigurationStagingService({ config, store: runtime.store, crm: runtime.crm,
    core: runtime.core, sourceReader: runtime.sourceReader, conversionReader: runtime.conversionReader,
    now: runtime.now });
  const [originalReceipt] = runtime.store.rowsFor(config.tables.EVENT_RECEIPT_TABLE);
  const [originalConfiguration] = runtime.store.rowsFor(config.tables.CONFIGURATION_VERSION_TABLE);
  const preserved = structuredClone({ originalReceipt, originalConfiguration });
  const signed = signReconciliation(f);
  const result = await service.reconcile(signed.packet);
  assert.equal(result.state, 'StagedInactive'); assert.equal(result.reconciled, true);
  assert.equal(result.approved, false); assert.equal(result.active, false); assert.equal(result.replayed, false);
  assert.deepEqual({ originalReceipt, originalConfiguration }, preserved);
  const [deployment] = runtime.store.rowsFor(config.tables.DEPLOYMENT_TABLE);
  assert.equal(deployment.TEST_STATUS, 'Ready for Approval');
  assert.equal(deployment.APPROVED_START_AT, null); assert.equal(deployment.ACTUAL_START_AT, null);
  const loaded = await loadDeployment(runtime.store, deployment, { ...config,
    sharedAgentVersion: config.stagingAgentVersion, authorizationEventSecret: config.eventChainSecret });
  assert.equal(loaded.approvalEvidenceValidated, false); assert.equal(loaded.activationEvidenceValidated, false);
  assert.throws(() => activeAt(loaded, runtime.now()), { code: 'CONFIGURATION_UNAVAILABLE' });
  const writes = runtime.store.writes.length;
  runtime.advance(86_400_000);
  assert.deepEqual(await service.reconcile(signed.packet), { ...result, replayed: true });
  assert.equal(runtime.store.writes.length, writes); assert.equal(runtime.stagingWrites, 1);
  assert.deepEqual({ originalReceipt, originalConfiguration }, preserved);
});

test('offline signature cannot substitute for server authentication of the preserved durable claim', async () => {
  const { createConfigurationStagingService }
    = require('../../revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/configuration-staging-service');
  const f = await reconciliationFixture(); const runtime = f.original.liveShape;
  runtime.advance(f.options.now - runtime.now());
  const service = createConfigurationStagingService({
    config: { ...runtime.config, sourceRevision: f.options.expectedRevision },
    store: runtime.store, crm: runtime.crm, core: runtime.core, sourceReader: runtime.sourceReader,
    conversionReader: runtime.conversionReader, now: runtime.now });
  f.envelope.request.intent.original_claim_fingerprint = '0'.repeat(64);
  assert.equal(validateUnsignedReconciliationEnvelope(f.envelope, f.options).durableEvidenceAuthenticated, false);
  const signed = signReconciliation(f); const writes = runtime.store.writes.length;
  await assert.rejects(service.reconcile(signed.packet));
  assert.equal(runtime.store.writes.length, writes); assert.equal(runtime.stagingWrites, 0);
  assert.equal(runtime.store.rowsFor(runtime.config.tables.DEPLOYMENT_TABLE).length, 0);
});

test('reconciliation rejects historical-content drift, wrong current owner/revision and stale new intent', async () => {
  for (const mutate of [
    (f) => { f.envelope.extra = true; },
    (f) => { f.envelope.request.signature = 'not unsigned'; },
    (f) => { f.envelope.request.originalRequest.signature = 'invalid'; },
    (f) => { f.envelope.request.originalRequest.review.callbackExpectation = 'Changed promise'; },
    (f) => { f.envelope.originalEnvelope.request.profile = RECONCILIATION_PROFILE; },
    (f) => { f.options.expectedRevision = 'd'.repeat(40); },
    (f) => { f.options.expectedOperatorHash = `operator_${'9'.repeat(64)}`; },
    (f) => { f.options.now += 300001; },
    (f) => { f.envelope.request.intent.evidence_observed_at = new Date(f.options.now - 900001).toISOString(); },
    (f) => { f.envelope.request.intent.requested_at = new Date(f.options.now + 1).toISOString(); },
    (f) => { f.envelope.request.intent.original_configuration_fingerprint = `config_${'0'.repeat(64)}`; },
    (f) => { f.envelope.request.intent.deployment_id = `cfgdeploy_${'0'.repeat(64)}`; },
    (f) => { f.envelope.request.intent.route_fingerprint = `route_${'0'.repeat(64)}`; },
    (f) => { f.envelope.request.intent.configuration_version_id = 'replacement_identity'; },
  ]) {
    const f = await reconciliationFixture(); mutate(f);
    assert.throws(() => validateUnsignedReconciliationEnvelope(f.envelope, f.options));
  }
});

test('reconciliation checks original HMAC only with private key and rejects wrong key or foreign signature domain', async () => {
  for (const domain of [SIGNATURE_DOMAIN, RECONCILIATION_SIGNATURE_DOMAIN,
    'revenue-desk-approval-intent-v1\0']) {
    const f = await reconciliationFixture();
    f.envelope.request.originalRequest.signature = `v1=${crypto.createHmac('sha256', domain === SIGNATURE_DOMAIN
      ? 'synthetic_wrong_key_'.repeat(3) : f.original.liveShape.config.operatorVerificationSecret)
      .update(domain).update(canonicalApprovalIntent(f.envelope.request.originalRequest.intent)).digest('hex')}`;
    assert.equal(validateUnsignedReconciliationEnvelope(f.envelope, f.options).durableEvidenceAuthenticated, false);
    assert.throws(() => signReconciliation(f), { code: 'INVALID_APPROVAL_SIGNATURE' });
  }
  const f = await reconciliationFixture();
  assert.throws(() => signReconciliation(f, 'synthetic_wrong_key_'.repeat(3)), { code: 'INVALID_APPROVAL_SIGNATURE' });
});

test('reconciliation includes nested original signature in exact pre-key byte limit without truncation', async () => {
  const f = await reconciliationFixture(); const signed = signReconciliation(f);
  assert.ok(signed.byteLength > sign(f.original).byteLength);
  assert.equal(validateUnsignedReconciliationEnvelope(f.envelope,
    { ...f.options, maxBodyBytes: signed.byteLength }).maxBodyBytes, signed.byteLength);
  assert.throws(() => validateUnsignedReconciliationEnvelope(f.envelope,
    { ...f.options, maxBodyBytes: signed.byteLength - 1 }), { code: 'STAGING_PACKET_TOO_LARGE' });
  f.options.now += 300000;
  assert.equal(signReconciliation(f).profile, RECONCILIATION_PROFILE);
  f.options.now += 1;
  assert.throws(() => signReconciliation(f), { code: 'INVALID_STAGING_INTENT' });
});

function assertNoSyntheticPrivateValues(error, f) {
  const exposed = `${error?.message || ''}\n${error?.stack || ''}`;
  for (const value of [f.liveShape.config.operatorVerificationSecret,
    f.envelope.preparation.crm.deal.Alert_Recipient_Email,
    f.envelope.preparation.crm.account.Account_Name,
    f.envelope.request.intent.operator_id_hash]) {
    assert.equal(exposed.includes(value), false);
  }
}

function bindingFixture() {
  return { input: { schemaVersion: 1, environment: 'development', crmOrganizationId: '900000001',
    operatorIdentity: 'synthetic_operator', testPhoneNumber: '+12025550101',
    clientId: 'synthetic_client_a', deploymentId: `cfgdeploy_${'a'.repeat(64)}` },
  secrets: { numberSecret: 'synthetic_number_'.repeat(3), eventChainSecret: 'synthetic_event_'.repeat(3),
    analyticsPartitionSecret: 'synthetic_analytics_'.repeat(3) } };
}

function deriveFixture(f, serialized = JSON.stringify(f.secrets)) {
  const protectedInput = Buffer.from(serialized, 'utf8');
  try { return deriveStagingBindings(f.input, { protectedInput }); }
  finally { protectedInput.fill(0); }
}

test('private bindings reproduce installed domain contracts without signing or credentials in output', () => {
  const { keyedDigest, numberLookupKey }
    = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/security');
  const f = bindingFixture(); const before = structuredClone(f); const result = deriveFixture(f);
  assert.equal(result.profile, BINDINGS_PROFILE);
  assert.deepEqual(result.bindings.input, f.input);
  assert.equal(result.bindings.inputSha256,
    crypto.createHash('sha256').update(JSON.stringify(f.input)).digest('hex'));
  assert.equal(result.bindings.NUMBER_LOOKUP_HASH, numberLookupKey(f.secrets.numberSecret, f.input.testPhoneNumber));
  assert.equal(result.bindings.expectedOperatorHash, `operator_${keyedDigest(f.secrets.eventChainSecret,
    'revenue-desk-route-control-operator-v1', [f.input.crmOrganizationId, f.input.operatorIdentity])}`);
  assert.equal(result.bindings.analyticsClientKey, keyedDigest(f.secrets.analyticsPartitionSecret,
    'revenue-desk-analytics-client-v1', [f.input.clientId]));
  assert.equal(result.bindings.analyticsDeploymentKey, keyedDigest(f.secrets.analyticsPartitionSecret,
    'revenue-desk-analytics-deployment-v1', [f.input.deploymentId]));
  assert.equal(result.sha256, crypto.createHash('sha256').update(result.serialized).digest('hex'));
  assert.equal(result.byteLength, Buffer.byteLength(result.serialized, 'utf8'));
  assert.equal(result.serialized, `${JSON.stringify(result.bindings)}\n`);
  assert.equal(Object.isFrozen(result.bindings.input), true); assert.deepEqual(f, before);
  assert.deepEqual(Object.keys(result.bindings), ['schemaVersion', 'profile', 'input', 'inputSha256',
    'NUMBER_LOOKUP_HASH', 'expectedOperatorHash', 'analyticsClientKey', 'analyticsDeploymentKey']);
  for (const secret of Object.values(f.secrets)) assert.equal(result.serialized.includes(secret), false);
});

test('binding preflight rejects invalid or expanded targets without protected input', () => {
  for (const patch of [{ schemaVersion: 2 }, { environment: 'production' }, { crmOrganizationId: 900000001 },
    { crmOrganizationId: '0900000001' }, { operatorIdentity: 'ab' }, { operatorIdentity: '<operator>' },
    { operatorIdentity: 'a'.repeat(257) }, { testPhoneNumber: '(202) 555-0101' },
    { testPhoneNumber: '+4402025550101' }, { testPhoneNumber: '+12021550101' },
    { clientId: 'invalid client' }, { deploymentId: 'caller_selected' }, { extra: true }]) {
    const f = bindingFixture(); Object.assign(f.input, patch);
    assert.throws(() => validateStagingBindingInput(f.input), { code: 'INVALID_STAGING_BINDING_INPUT' });
  }
  for (const key of Object.keys(bindingFixture().input)) {
    const f = bindingFixture(); delete f.input[key];
    assert.throws(() => validateStagingBindingInput(f.input));
  }
});

test('binding keys are isolated by exact number, organization, operator, client and deployment inputs', () => {
  const base = bindingFixture(); const original = deriveFixture(base).bindings;
  const cases = [['testPhoneNumber', '+12025550102', 'NUMBER_LOOKUP_HASH'],
    ['crmOrganizationId', '900000002', 'expectedOperatorHash'],
    ['operatorIdentity', 'synthetic_operator_b', 'expectedOperatorHash'],
    ['clientId', 'synthetic_client_b', 'analyticsClientKey'],
    ['deploymentId', `cfgdeploy_${'b'.repeat(64)}`, 'analyticsDeploymentKey']];
  for (const [field, value, binding] of cases) {
    const f = bindingFixture(); f.input[field] = value;
    const changed = deriveFixture(f).bindings;
    assert.notEqual(changed.inputSha256, original.inputSha256);
    for (const key of ['NUMBER_LOOKUP_HASH', 'expectedOperatorHash', 'analyticsClientKey', 'analyticsDeploymentKey']) {
      if (key === binding) assert.notEqual(changed[key], original[key]);
      else assert.equal(changed[key], original[key]);
    }
  }
});

test('protected binding envelope accepts serializer escapes and runtime-supported exact key bytes', () => {
  for (const text of [' ' + 'x'.repeat(30) + ' ', 'x'.repeat(31) + '\n',
    '\ufeff' + 'x'.repeat(31), '漢'.repeat(4096), '😀'.repeat(2048), '"\\'.repeat(16)]) {
    const f = bindingFixture(); f.secrets.numberSecret = text;
    const ordinary = deriveFixture(f);
    const escaped = JSON.stringify(f.secrets, null, 2).replaceAll('x', '\\u0078').replaceAll('/', '\\/');
    assert.deepEqual(deriveFixture(f, escaped), ordinary);
  }
  const f = bindingFixture(); f.input.operatorIdentity = ' synthetic_operator ';
  assert.notEqual(deriveFixture(f).bindings.expectedOperatorHash,
    deriveFixture(bindingFixture()).bindings.expectedOperatorHash);
});

test('binding secret envelopes reject invalid, duplicated, reused and oversized keys with coarse diagnostics', () => {
  const f = bindingFixture(); const valid = JSON.stringify(f.secrets);
  const inputs = [null, valid, Buffer.alloc(MAX_BINDING_SECRET_BYTES + 1), Buffer.from([0xff]),
    Buffer.from('\ufeff' + valid), Buffer.from(valid + ' trailing'),
    Buffer.from(valid.replace('"numberSecret":', '"numberSecret":0,"numberSecret":')),
    Buffer.from(valid.replace('"numberSecret":', '"numberSecret":"SYNTHETIC_PRIVATE_SENTINEL","numberSecret":'))];
  for (const patch of [{ numberSecret: 'a'.repeat(31) }, { numberSecret: 'a'.repeat(4097) },
    { eventChainSecret: '<' + 'x'.repeat(32) + '>' }, { eventChainSecret: f.secrets.numberSecret },
    { analyticsPartitionSecret: f.secrets.eventChainSecret }, { analyticsPartitionSecret: 'a'.repeat(257) },
    { analyticsPartitionSecret: ' ' + 'a'.repeat(31) }, { extra: 'SYNTHETIC_PRIVATE_SENTINEL' },
    { numberSecret: { nested: 'SYNTHETIC_PRIVATE_SENTINEL' } }]) {
    inputs.push(Buffer.from(JSON.stringify({ ...f.secrets, ...patch })));
  }
  for (const protectedInput of inputs) {
    try {
      assert.throws(() => deriveStagingBindings(f.input, { protectedInput }), (error) => {
        assert.equal(error.code, 'INVALID_STAGING_BINDING_SECRETS');
        for (const value of [...Object.values(f.secrets), 'SYNTHETIC_PRIVATE_SENTINEL']) {
          assert.equal(`${error.message}${error.stack}`.includes(value), false);
        }
        return true;
      });
    } finally { if (Buffer.isBuffer(protectedInput)) protectedInput.fill(0); }
  }
});

test('owner packet signs the exact existing staging domain and stages inactive through fake adapters', async () => {
  const f = fixture(); const before = structuredClone(f.envelope);
  const result = sign(f);
  assert.equal(PROFILE, f.envelope.request.profile);
  assert.equal(SIGNATURE_DOMAIN, 'revenue-desk-configuration-staging-intent-v1\0');
  assert.equal(MAX_STAGING_PACKET_BYTES, 16384);
  assert.equal(result.serialized, `${JSON.stringify(result.packet)}\n`);
  assert.equal(result.byteLength, Buffer.byteLength(result.serialized, 'utf8'));
  assert.equal(result.sha256, crypto.createHash('sha256').update(result.serialized).digest('hex'));
  assert.equal(result.packet.signature, f.liveShape.request.signature);
  assert.deepEqual(f.envelope, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.packet), true);
  const outcome = await f.liveShape.service.stage(result.packet);
  assert.equal(outcome.state, 'StagedInactive');
  assert.equal(outcome.active, false); assert.equal(outcome.approved, false);
  const deployment = f.liveShape.store.rowsFor(f.liveShape.config.tables.DEPLOYMENT_TABLE)[0];
  assert.equal(deployment.ACTUAL_START_AT, null); assert.equal(deployment.EXPIRES_AT, null);
  const writes = f.liveShape.store.writes.length;
  assert.equal((await f.liveShape.service.stage(result.packet)).replayed, true);
  assert.equal(f.liveShape.store.writes.length, writes);
});

test('unsigned validation never adds a signature or mutates the reviewed envelope', () => {
  const f = fixture(); const before = structuredClone(f.envelope);
  const result = validateUnsignedStagingEnvelope(f.envelope, f.options);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.hasOwn(result.packet, 'signature'), false);
  assert.equal(result.canonicalIntent, canonicalApprovalIntent(f.envelope.request.intent));
  assert.deepEqual(f.envelope, before);
});

test('ordinary approval and activation signatures cannot authorize the staged packet', async () => {
  for (const domain of ['revenue-desk-approval-intent-v1\0', 'revenue-desk-activation-intent-v1\0']) {
    const f = fixture(); const request = structuredClone(sign(f).packet);
    request.signature = `v1=${crypto.createHmac('sha256', f.liveShape.config.operatorVerificationSecret)
      .update(domain).update(canonicalApprovalIntent(request.intent)).digest('hex')}`;
    await assert.rejects(f.liveShape.service.stage(request), { code: 'INVALID_APPROVAL_SIGNATURE' });
    assert.equal(f.liveShape.store.writes.length, 0);
  }
});

test('post-sign edits to content, intent, target and recipient reject without a write', async () => {
  for (const mutate of [
    (r) => { r.configurationRow.CONFIGURATION_JSON += ' '; },
    (r) => { r.intent.event_id = `approval_${'a'.repeat(64)}`; },
    (r) => { r.intent.operator_id_hash = `operator_${'b'.repeat(64)}`; },
    (r) => { r.deployment.MONITOR_AGENT_ID = 'synthetic_wrong_agent'; },
    (r) => { r.dealId = '400000009'; },
    (r) => { r.review.notificationRecipientId = 'synthetic_wrong_recipient'; },
  ]) {
    const f = fixture(); const request = structuredClone(sign(f).packet); mutate(request);
    await assert.rejects(f.liveShape.service.stage(request));
    assert.equal(f.liveShape.store.writes.length, 0);
  }
});

test('different businesses cannot exchange preparation, request or owner context', () => {
  const a = fixture(0); const b = fixture(1);
  assert.notEqual(sign(a).sha256, sign(b).sha256);
  for (const key of ['preparation', 'request']) {
    const f = fixture(0); f.envelope[key] = b.envelope[key];
    assert.throws(() => sign(f));
  }
  assert.throws(() => validateUnsignedStagingEnvelope(a.envelope,
    { ...a.options, expectedOperatorHash: `operator_${'9'.repeat(64)}` }));
  assert.throws(() => validateUnsignedStagingEnvelope(a.envelope,
    { ...a.options, expectedRevision: 'f'.repeat(40) }));
});

test('rejects stale, future, noncanonical and mismatched timestamp evidence', () => {
  const changes = [
    (f) => { f.options.now += 300001; },
    (f) => { f.envelope.request.intent.requested_at = new Date(f.options.now + 1).toISOString(); },
    (f) => { f.envelope.request.intent.evidence_observed_at = new Date(f.options.now + 1).toISOString(); },
    (f) => { f.envelope.request.intent.evidence_observed_at = new Date(f.options.now - 900001).toISOString();
      f.envelope.preparation.evidence.capturedAt = f.envelope.request.intent.evidence_observed_at; },
    (f) => { f.envelope.request.intent.evidence_observed_at = new Date(f.options.now - 1).toISOString(); },
    (f) => { f.envelope.request.intent.requested_at = '2026-09-09T12:00:00Z'; },
    (f) => { f.options.now = Number.NaN; },
  ];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => sign(f)); }
});

test('freshness boundary is inclusive only for a matching reviewed snapshot', () => {
  const f = fixture(); f.options.now += 300000;
  assert.match(sign(f).packet.signature, /^v1=[a-f0-9]{64}$/);
  f.options.now += 1; assert.throws(() => sign(f));
});

test('missing monitoring acknowledgment, invalid phone and unresolved timing block signing', () => {
  for (const change of [
    (f) => { delete f.envelope.preparation.review.notificationHandoff; },
    (f) => { f.envelope.preparation.review.notificationHandoff.monitored = false; },
    (f) => { f.envelope.preparation.crm.account.Phone = '(913) 555-0101'; },
    (f) => { f.envelope.preparation.crm.deal.Approved_Test_Route = 'Both';
      f.envelope.preparation.crm.deal.No_Answer_Delay = 'Four Rings'; },
    (f) => { f.envelope.preparation.evidence.proof.STATUS = 'verified'; },
  ]) {
    const f = fixture(); change(f); f.envelope.request.review = structuredClone(f.envelope.preparation.review);
    assert.throws(() => sign(f));
  }
});

test('a preserved core approval must match the previously approved source and is not recreated', async () => {
  const f = fixture();
  await f.liveShape.core.approve(f.liveShape.coreApprovalCommand);
  f.envelope.preparation.crm = structuredClone(f.liveShape.records);
  f.envelope.preservedCoreApproval = {
    configurationVersionId: f.liveShape.records.deal.Approved_Configuration_Version,
    approvedAt: f.liveShape.records.deal.Go_Live_Approved_At,
  };
  const result = sign(f);
  assert.equal((await f.liveShape.service.stage(result.packet)).state, 'StagedInactive');
  assert.equal(f.liveShape.records.deal.Go_Live_Approved_At, f.envelope.preservedCoreApproval.approvedAt);
  for (const replacement of [null, {}, { ...f.envelope.preservedCoreApproval, extra: true },
    { ...f.envelope.preservedCoreApproval, configurationVersionId: 'wrong_synthetic_version' },
    { ...f.envelope.preservedCoreApproval, approvedAt: '2026-09-09T11:59:59.000Z' }]) {
    const changed = { ...f.envelope, preservedCoreApproval: replacement };
    assert.throws(() => validateUnsignedStagingEnvelope(changed, f.options));
  }
});

test('extra unsigned request, row, deployment and intent fields are rejected', () => {
  for (const target of [[], ['request'], ['request', 'configurationRow'], ['request', 'deployment'], ['request', 'intent']]) {
    const f = fixture(); let selected = f.envelope;
    for (const key of target) selected = selected[key];
    selected.unsafeExtra = 'SYNTHETIC_PRIVATE_SENTINEL';
    assert.throws(() => sign(f));
  }
  for (const change of [
    (f) => { f.envelope.request.signature = ''; },
    (f) => { f.envelope.request.operatorVerificationSecret = f.liveShape.config.operatorVerificationSecret; },
    (f) => { f.envelope.preparation.classification = 'synthetic-demonstration'; },
    (f) => { f.envelope.schemaVersion = 2; },
  ]) { const f = fixture(); change(f); assert.throws(() => sign(f)); }
});

test('review rejects unsigned operational extras and partial reporting bindings even on both copies', () => {
  for (const patch of [{ liveEmailEnabled: true }, { operatorVerificationSecret: 'synthetic-key' },
    { analyticsClientKey: 'a'.repeat(64) }, { analyticsDeploymentKey: 'b'.repeat(64) },
    { reportBaseline: { sourcePeriod: {}, currency: 'USD', evidenceClass: 'customer_supplied_estimate' } }]) {
    const f = fixture(); Object.assign(f.envelope.preparation.review, patch);
    f.envelope.request.review = structuredClone(f.envelope.preparation.review);
    assert.throws(() => sign(f));
  }
});

test('source target, owner, counters and approved candidate bytes must match exactly', () => {
  const changes = [
    (f) => { f.envelope.request.profile = 'caller_selected'; },
    (f) => { f.envelope.request.intent.action = 'revoke'; },
    (f) => { f.envelope.request.intent.expected_deployment_version = 1; },
    (f) => { f.envelope.request.deployment.HANDLED_COUNT = 1; },
    (f) => { f.envelope.request.deployment.CALL_LIMIT = 26; },
    (f) => { f.envelope.request.deployment.SOURCE_ENVIRONMENT = 'production'; },
    (f) => { f.envelope.request.configurationRow.STATUS = 'Draft'; },
    (f) => { f.envelope.request.configurationRow.CONFIGURATION_JSON += ' '; },
    (f) => { f.envelope.request.intent.route_fingerprint = `route_${'0'.repeat(64)}`; },
    (f) => { f.envelope.request.form2ConfigurationVersion = 'synthetic_wrong_version'; },
    (f) => { f.envelope.request.deployment.DEPLOYMENT_ID = 'caller_selected_deployment'; },
    (f) => { f.envelope.request.review.callbackExpectation = 'Edited callback promise'; },
  ];
  for (const change of changes) { const f = fixture(); change(f); assert.throws(() => sign(f)); }
});

test('internally recomputed route cannot bypass preparation-to-content comparison', () => {
  const f = fixture();
  const content = JSON.parse(f.envelope.request.configurationRow.CONFIGURATION_JSON);
  content.notificationRecipient.email = 'edited@example.invalid';
  f.envelope.request.configurationRow.CONFIGURATION_JSON = JSON.stringify(content);
  f.envelope.request.intent.route_fingerprint = routeFingerprint(routeFromRows(
    f.envelope.request.deployment, f.envelope.request.configurationRow));
  assert.throws(() => sign(f));
});

test('internally consistent route cannot sign a journey identifier rejected by the controller', () => {
  const f = fixture(); const journey = 'synthetic invalid journey';
  const deploymentId = `cfgdeploy_${crypto.createHash('sha256')
    .update(JSON.stringify(['development', f.envelope.request.dealId, journey])).digest('hex')}`;
  f.envelope.request.journeyId = journey;
  f.envelope.preparation.crm.deal.Intake_Submission_ID = journey;
  f.envelope.preparation.evidence.nativeConversion.intakeSubmissionId = journey;
  f.envelope.preparation.review.deploymentId = deploymentId;
  f.envelope.request.review = structuredClone(f.envelope.preparation.review);
  const { prepareFreeTestConfiguration } = require('../lib/free-test-preparation');
  const candidate = prepareFreeTestConfiguration(f.envelope.preparation, { now: f.options.now }).candidate;
  assert.ok(candidate);
  f.envelope.request.configurationRow.DEPLOYMENT_ID = deploymentId;
  f.envelope.request.configurationRow.CONFIGURATION_JSON = JSON.stringify({ ...candidate, approved: true,
    notificationRecipient: { ...candidate.notificationRecipient, approved: true } });
  f.envelope.request.deployment.DEPLOYMENT_ID = deploymentId;
  f.envelope.request.intent.deployment_id = deploymentId;
  f.envelope.request.intent.route_fingerprint = routeFingerprint(routeFromRows(
    f.envelope.request.deployment, f.envelope.request.configurationRow));
  assert.throws(() => sign(f));
});

test('secret requires a bounded valid UTF-8 buffer and never enters returned packet or error text', () => {
  const f = fixture();
  for (const secret of [null, 'synthetic-text-is-not-a-buffer', Buffer.alloc(31, 65),
    Buffer.alloc(4097, 65), Buffer.alloc(MAX_SECRET_UTF8_BYTES + 1, 65),
    Buffer.from([0xed, 0xa0, 0x80]), Buffer.alloc(32, 128), Buffer.alloc(32, 0xe1)]) {
    try {
      assert.throws(() => signFreeTestStagingPacket(f.envelope, { ...f.options, secret }),
        (error) => { assertNoSyntheticPrivateValues(error, f); return true; });
    } finally { if (Buffer.isBuffer(secret)) secret.fill(0); }
  }
  for (const length of [32, 4096]) {
    const secret = Buffer.alloc(length, 65);
    try {
      const result = signFreeTestStagingPacket(f.envelope, { ...f.options, secret });
      assert.equal(result.serialized.includes('A'.repeat(32)), false);
      assert.equal(result.serialized.includes(f.liveShape.config.operatorVerificationSecret), false);
    } finally { secret.fill(0); }
  }
});

test('runtime-supported whitespace, BMP and supplementary secrets produce the exact runtime HMAC', async () => {
  for (const text of [' ' + 'x'.repeat(30) + ' ', 'x'.repeat(16) + '\t' + 'y'.repeat(16),
    'x'.repeat(31) + '\n', 'é'.repeat(32), '漢'.repeat(4096), '😀'.repeat(16), '😀'.repeat(2048)]) {
    const f = fixture(); const secret = Buffer.from(text, 'utf8');
    const runtimeSignature = `v1=${crypto.createHmac('sha256', text)
      .update(SIGNATURE_DOMAIN).update(canonicalApprovalIntent(f.envelope.request.intent)).digest('hex')}`;
    try {
      const result = signFreeTestStagingPacket(f.envelope, { ...f.options, secret });
      assert.equal(result.packet.signature, runtimeSignature);
      assert.equal(result.serialized.includes(text), false);
      f.liveShape.config.operatorVerificationSecret = text;
      assert.equal((await f.liveShape.service.stage(result.packet)).state, 'StagedInactive');
    } finally { secret.fill(0); }
  }
  for (const text of ['😀'.repeat(15), '漢'.repeat(4097), '😀'.repeat(2049)]) {
    const f = fixture(); const secret = Buffer.from(text, 'utf8');
    try { assert.throws(() => signFreeTestStagingPacket(f.envelope, { ...f.options, secret })); }
    finally { secret.fill(0); }
  }
});

test('invalid JSON contents and private values are not interpolated in thrown diagnostics', () => {
  const f = fixture();
  f.envelope.request.configurationRow.CONFIGURATION_JSON
    = `{"private":"${f.envelope.preparation.crm.deal.Alert_Recipient_Email}`;
  assert.throws(() => sign(f), (error) => { assertNoSyntheticPrivateValues(error, f); return true; });
});

test('packet byte ceiling is enforced without truncating a private field', () => {
  const f = fixture();
  f.envelope.preparation.review.rollbackInstructions = 'é'.repeat(MAX_STAGING_PACKET_BYTES);
  f.envelope.request.review = structuredClone(f.envelope.preparation.review);
  assert.throws(() => sign(f));
  assert.equal(f.envelope.request.review.rollbackInstructions.length, MAX_STAGING_PACKET_BYTES);
});

test('individually valid multibyte fields cannot exceed the complete serialized packet budget', () => {
  const f = fixture();
  const review = f.envelope.preparation.review;
  // These lists satisfy individual item/count limits and remain valid runtime
  // configuration text, but appear in both the reviewed input and final packet.
  review.unsupportedServices = Array.from({ length: 20 }, (_, i) => `synthetic_${i}_${'é'.repeat(95)}`);
  review.urgentConditions = Array.from({ length: 15 }, (_, i) => `synthetic_${i}_${'é'.repeat(95)}`);
  f.envelope.request.review = structuredClone(review);
  const { prepareFreeTestConfiguration } = require('../lib/free-test-preparation');
  const prepared = prepareFreeTestConfiguration(f.envelope.preparation, { now: f.options.now });
  assert.equal(prepared.status, 'prepared_local_only'); assert.deepEqual(prepared.unresolved, []);
  const candidate = prepared.candidate;
  f.envelope.request.configurationRow.CONFIGURATION_JSON = JSON.stringify({ ...candidate, approved: true,
    notificationRecipient: { ...candidate.notificationRecipient, approved: true } });
  f.envelope.request.intent.route_fingerprint = routeFingerprint(routeFromRows(
    f.envelope.request.deployment, f.envelope.request.configurationRow));
  const unsignedBytes = Buffer.byteLength(JSON.stringify(f.envelope.request), 'utf8');
  assert.ok(unsignedBytes > MAX_STAGING_PACKET_BYTES);
  assert.throws(() => sign(f));
});

test('module has no live client, file access, environment key loading or diagnostics', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/free-test-staging-packet.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:node:)?(?:fs|https?|net|tls|child_process|zcatalyst|retell)/);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|setInterval)\s*\(|process\.env|console\./);
  assert.deepEqual(guard.blocked, []);
});
test('owner packet rejects the reviewed 4096-byte limit before key entry for a larger valid request', () => {
  const f = fixture();
  const projected = Buffer.byteLength(`${JSON.stringify({
    ...f.envelope.request, signature: `v1=${'0'.repeat(64)}`,
  })}\n`, 'utf8');
  assert.ok(projected > 4096);
  assert.throws(() => validateUnsignedStagingEnvelope(f.envelope, {
    ...f.options, maxBodyBytes: 4096,
  }), { code: 'STAGING_PACKET_TOO_LARGE' });
  assert.equal(f.liveShape.store.writes.length, 0);
});

test('owner packet requires an explicit valid observed body limit instead of assuming the ceiling', () => {
  const f = fixture();
  for (const maxBodyBytes of [undefined, null, 511, 16385, 6000.5, '16384']) {
    assert.throws(() => validateUnsignedStagingEnvelope(f.envelope, {
      ...f.options, maxBodyBytes,
    }), { code: 'INVALID_STAGING_SIGNING_CONTEXT' });
  }
});

test('owner packet obeys exact UTF-8 body-byte boundaries including signature and newline', () => {
  const f = fixture();
  const signed = sign(f);
  assert.equal(validateUnsignedStagingEnvelope(f.envelope, {
    ...f.options, maxBodyBytes: signed.byteLength,
  }).maxBodyBytes, signed.byteLength);
  assert.throws(() => validateUnsignedStagingEnvelope(f.envelope, {
    ...f.options, maxBodyBytes: signed.byteLength - 1,
  }), { code: 'STAGING_PACKET_TOO_LARGE' });
  const secret = Buffer.from(f.liveShape.config.operatorVerificationSecret, 'utf8');
  try {
    assert.equal(signFreeTestStagingPacket(f.envelope, {
      ...f.options, secret, maxBodyBytes: signed.byteLength,
    }).maxBodyBytes, signed.byteLength);
  } finally { secret.fill(0); }
});

test('synthetic controller HTTP boundary and signer enforce the same selected byte budget', async () => {
  const { readBody } = require('../../revenue-desk-call-runtime/functions/revenue_desk_route_control/lib/http-boundary');
  const f = fixture(); const signed = sign(f);
  const request = { headers: { 'content-type': 'application/json',
    'content-length': String(signed.byteLength) }, rawBody: Buffer.from(signed.serialized) };
  await assert.rejects(readBody(request, 4096), (error) => error.httpStatus === 413);
  assert.deepEqual(await readBody(request, signed.byteLength), signed.packet);
  assert.throws(() => validateUnsignedStagingEnvelope(f.envelope, {
    ...f.options, maxBodyBytes: 4096,
  }), { code: 'STAGING_PACKET_TOO_LARGE' });
  assert.equal(f.liveShape.store.writes.length, 0);
});
