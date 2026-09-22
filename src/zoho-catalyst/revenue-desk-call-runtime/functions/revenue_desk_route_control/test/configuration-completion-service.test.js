'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { createStagingFixture } = require('./helpers/configuration-staging-fixture');
const { syntheticPreparationInputs } = require('../../../../revenue-desk-release/test/fixtures/free-test-preparation');
const { createConfigurationStagingService, RECEIPT_KIND, RECONCILIATION_RECEIPT_KIND, COMPLETION_RECEIPT_KIND, TRANSITION_RECEIPT_KIND }
  = require('../lib/configuration-staging-service');
const { RECONCILIATION_PROFILE, RECONCILIATION_SIGNATURE_DOMAIN, canonicalReconciliationIntent,
  successorConfigurationRow, successorDeployment, COMPLETION_PROFILE, COMPLETION_SIGNATURE_DOMAIN,
  canonicalCompletionIntent, completionConfigurationRow, completionDeployment, inactiveDeploymentFingerprint,
  TRANSITION_PROFILE, TRANSITION_SIGNATURE_DOMAIN, canonicalTransitionIntent, transitionConfigurationRow, transitionDeployment }
  = require('revenue_desk_call_gateway/lib/configuration-reconciliation');
const { configurationSnapshotFingerprint, routeFingerprint, routeFromRows } = require('revenue_desk_call_gateway/lib/approval-control');
const { loadDeployment, activeAt } = require('revenue_desk_call_gateway/lib/runtime-service');
const { createRouteControlService } = require('revenue_desk_call_gateway/lib/route-control-service');
const clone = (value) => structuredClone(value);

// Both historical partial states are produced through their actual service
// writes. No success rows, alternate journey identity or provider is seeded.
async function fixture() {
  const input = syntheticPreparationInputs()[0];
  const ids = Object.fromEntries(['leadId', 'accountId', 'contactId', 'dealId']
    .map((field) => [input.evidence.nativeConversion[field], `${input.evidence.nativeConversion[field]}00`]));
  const replace = (value) => Array.isArray(value) ? value.map(replace)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]))
      : typeof value === 'string' && Object.hasOwn(ids, value) ? ids[value] : value;
  const f = createStagingFixture(0, { preparationInput: replace(input) });
  Object.assign(f.records.deal, { Test_Start_At: null, Test_End_At: null });
  const insert = f.store.insertUnique.bind(f.store);
  f.store.insertUnique = async (table, ...args) => {
    if (table === f.config.tables.DEPLOYMENT_TABLE) throw new Error('Synthetic historical column rejection');
    return insert(table, ...args);
  };
  await assert.rejects(f.service.stage(f.request)); f.store.insertUnique = insert;
  const rows = () => f.store.rowsFor(f.config.tables.EVENT_RECEIPT_TABLE);
  const originalReceipt = rows().find((row) => row.RECEIPT_KIND === RECEIPT_KIND);
  const original = JSON.parse(originalReceipt.EVENT_DATA_JSON);
  f.advance(900_001);
  const recoveryConfig = { ...f.config, sourceRevision: 'f'.repeat(40) };
  const serviceFor = (config) => createConfigurationStagingService({ config, store: f.store, crm: f.crm,
    core: f.core, sourceReader: f.sourceReader, conversionReader: f.conversionReader, now: f.now });
  const recoveryService = serviceFor(recoveryConfig);
  const recoveryRow = successorConfigurationRow(f.request, originalReceipt.EVENT_KEY, recoveryConfig.sourceRevision);
  const recoveryDeployment = successorDeployment(f.request, originalReceipt.EVENT_KEY, recoveryConfig.sourceRevision);
  const reconciliationRequest = { profile: RECONCILIATION_PROFILE, originalRequest: clone(f.request), intent: {
    schema_version: 1, action: 'reconcile_configuration', original_claim_key: originalReceipt.EVENT_KEY,
    original_claim_fingerprint: originalReceipt.PAYLOAD_FINGERPRINT, original_request_fingerprint: original.requestFingerprint,
    original_configuration_version_id: original.configurationVersionId,
    original_configuration_fingerprint: original.configurationFingerprint, original_source_revision: f.config.sourceRevision,
    target_source_revision: recoveryConfig.sourceRevision, deployment_id: original.deploymentId,
    configuration_version_id: recoveryRow.CONFIGURATION_VERSION_ID,
    route_fingerprint: routeFingerprint(routeFromRows(recoveryDeployment, recoveryRow)), expected_receipt_version: 0,
    operator_id_hash: recoveryConfig.operatorIdHash, evidence_observed_at: new Date(f.now()).toISOString(),
    requested_at: new Date(f.now()).toISOString() }, signature: '' };
  reconciliationRequest.signature = `v1=${crypto.createHmac('sha256', f.config.operatorVerificationSecret)
    .update(RECONCILIATION_SIGNATURE_DOMAIN).update(canonicalReconciliationIntent(reconciliationRequest.intent)).digest('hex')}`;
  const record = f.crm.recordConfigurationStaging;
  f.crm.recordConfigurationStaging = async () => { throw new Error('Synthetic failure before CRM write'); };
  await assert.rejects(recoveryService.reconcile(reconciliationRequest)); f.crm.recordConfigurationStaging = record;
  const recoveryReceipt = rows().find((row) => row.RECEIPT_KIND === RECONCILIATION_RECEIPT_KIND);
  const recovery = JSON.parse(recoveryReceipt.EVENT_DATA_JSON);
  const deployment = f.store.rowsFor(f.config.tables.DEPLOYMENT_TABLE)[0];
  const historicalRows = { receipts: clone(rows()), configurations: clone(f.store.rowsFor(f.config.tables.CONFIGURATION_VERSION_TABLE)) };
  f.advance(900_001);
  const config = { ...f.config, sourceRevision: 'a'.repeat(40) };
  const configuration = completionConfigurationRow(reconciliationRequest, recoveryReceipt.EVENT_KEY, config.sourceRevision);
  const projected = completionDeployment(reconciliationRequest, recoveryReceipt.EVENT_KEY, config.sourceRevision);
  const envelope = { profile: COMPLETION_PROFILE, reconciliationRequest, intent: {
    schema_version: 1, action: 'complete_configuration', original_claim_key: originalReceipt.EVENT_KEY,
    original_claim_fingerprint: originalReceipt.PAYLOAD_FINGERPRINT,
    reconciliation_claim_key: recoveryReceipt.EVENT_KEY, reconciliation_claim_fingerprint: recoveryReceipt.PAYLOAD_FINGERPRINT,
    original_source_revision: f.config.sourceRevision,
    reconciliation_source_revision: recoveryConfig.sourceRevision, target_source_revision: config.sourceRevision,
    original_configuration_fingerprint: original.configurationFingerprint,
    reconciled_configuration_version_id: recovery.configurationVersionId,
    reconciled_configuration_fingerprint: recovery.configurationFingerprint, deployment_id: original.deploymentId,
    expected_deployment_fingerprint: inactiveDeploymentFingerprint(deployment), expected_deployment_version: 0,
    expected_receipt_version: 0, configuration_version_id: configuration.CONFIGURATION_VERSION_ID,
    configuration_fingerprint: configurationSnapshotFingerprint(configuration),
    route_fingerprint: routeFingerprint(routeFromRows(projected, configuration)), operator_id_hash: config.operatorIdHash,
    evidence_observed_at: new Date(f.now()).toISOString(), requested_at: new Date(f.now()).toISOString() }, signature: '' };
  const sign = (value = envelope, domain = COMPLETION_SIGNATURE_DOMAIN) => {
    value.signature = `v1=${crypto.createHmac('sha256', config.operatorVerificationSecret)
      .update(domain).update(canonicalCompletionIntent(value.intent)).digest('hex')}`; return value;
  };
  sign();
  return { f, config, service: serviceFor(config), serviceFor, recoveryService, envelope, sign,
    originalReceipt, recoveryReceipt, original, recovery, deployment, historicalRows };
}

function assertHistory(v) {
  assert.deepEqual(v.f.store.rowsFor(v.config.tables.EVENT_RECEIPT_TABLE)
    .filter((row) => [RECEIPT_KIND, RECONCILIATION_RECEIPT_KIND].includes(row.RECEIPT_KIND)), v.historicalRows.receipts);
  assert.deepEqual(v.f.store.rowsFor(v.config.tables.CONFIGURATION_VERSION_TABLE).slice(0, 2), v.historicalRows.configurations);
}

test('exact partial chain completes once through current source, with Catalyst BigInt readback and no clock', async () => {
  for (const bigint of [false, true]) {
    const v = await fixture(); const { f, config, service, envelope } = v;
    if (bigint) {
      const unique = f.store.unique.bind(f.store);
      f.store.unique = async (...args) => {
        const row = await unique(...args);
        if (row && args[0] === config.tables.DEPLOYMENT_TABLE) for (const field of [
          'BINDING_VERSION', 'MONITOR_AGENT_VERSION', 'CALL_LIMIT', 'COUNT_VERSION', 'HANDLED_COUNT', 'REPORT_RECONCILIATION_VERSION',
        ]) row[field] = String(row[field]);
        if (row && args[0] === config.tables.EVENT_RECEIPT_TABLE) for (const field of ['ATTEMPT_COUNT', 'RECEIPT_VERSION']) row[field] = String(row[field]);
        return row;
      };
    }
    const writes = f.store.writes.length; const result = await service.complete(envelope);
    assert.deepEqual(result, { state: 'StagedInactive', completed: true, replayed: false, approved: false, active: false,
      configurationVersionId: envelope.intent.configuration_version_id, deploymentId: envelope.intent.deployment_id });
    assert.equal(f.store.writes.length - writes, 4); assert.equal(f.stagingWrites, 1); assertHistory(v);
    const deployment = await f.store.unique(config.tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', result.deploymentId);
    const current = await f.store.unique(config.tables.CONFIGURATION_VERSION_TABLE, 'CONFIGURATION_VERSION_ID', result.configurationVersionId);
    assert.equal(deployment.SOURCE_REVISION, config.sourceRevision); assert.equal(current.SOURCE_REVISION, config.sourceRevision);
    assert.equal(deployment.TEST_STATUS, 'Ready for Approval'); assert.equal(Number(deployment.COUNT_VERSION), 0);
    for (const field of ['APPROVED_START_AT', 'ACTUAL_START_AT', 'EXPIRES_AT', 'ACTIVATION_EVENT_KEY', 'APPROVAL_EVENT_KEY']) assert.equal(deployment[field], null);
    assert.deepEqual(await service.assertApprovalSource({ dealId: f.request.dealId, journeyId: f.request.journeyId,
      deploymentId: result.deploymentId, configurationVersionId: result.configurationVersionId },
    { deployment, configurationRow: current, deal: f.records.deal }), { configurationStaged: true, priorCoreApproval: null });
    const loaded = await loadDeployment(f.store, deployment, { ...config, sharedAgentVersion: config.stagingAgentVersion,
      authorizationEventSecret: config.eventChainSecret });
    assert.equal(loaded.approvalEvidenceValidated, false); assert.equal(loaded.activationEvidenceValidated, false);
    assert.throws(() => activeAt(loaded, f.now()), { code: 'CONFIGURATION_UNAVAILABLE' });
    const receipt = f.store.rowsFor(config.tables.EVENT_RECEIPT_TABLE).find((row) => row.RECEIPT_KIND === COMPLETION_RECEIPT_KIND);
    assert.equal(receipt.STATUS, 'Completed'); assert.equal(receipt.RECEIPT_VERSION, 1);
    assert.equal(receipt.RELATED_EVENT_KEY, v.recoveryReceipt.EVENT_KEY);
    assert.ok(Buffer.byteLength(receipt.EVENT_DATA_JSON) <= 10_000);
    assert.doesNotMatch(receipt.EVENT_DATA_JSON, /v1=|synthetic-owner-signing|example\.invalid/);
    f.advance(86_400_000); const before = clone([...f.store.rows]); const beforeWrites = f.store.writes.length;
    assert.equal((await service.complete(envelope)).replayed, true);
    assert.deepEqual([...f.store.rows], before); assert.equal(f.store.writes.length, beforeWrites); assert.equal(f.stagingWrites, 1);
    await assert.rejects(v.recoveryService.reconcile(envelope.reconciliationRequest));
  }
});

test('separate internal approval follows the completed chain but cannot activate a provider or start time', async () => {
  const v = await fixture(); const { f, service, config } = v; const staged = await service.complete(v.envelope);
  let approvals = 0; let providerCalls = 0;
  f.crm.recordApproval = async (id, input) => {
    assert.equal(id, f.records.deal.id); assert.deepEqual(input.expectedDeal, f.records.deal);
    assert.equal(input.configurationStaged, true); assert.equal(input.priorCoreApproval, null); approvals += 1;
    Object.assign(f.records.deal, { Test_Status: 'Scheduled', Go_Live_Approval_Status: 'Approved',
      Go_Live_Approved_At: input.approvedAt, Approved_Deployment_Record_ID: input.deploymentId,
      Approved_Configuration_Version: input.configurationVersionId }); return clone(f.records.deal);
  };
  const provider = new Proxy({}, { get() { return async () => { providerCalls += 1; throw new Error('No provider execution'); }; } });
  const control = createRouteControlService({ config, store: f.store, crm: f.crm, provider, configurationStaging: service, now: f.now });
  const approved = await control.approve({ dealId: f.records.deal.id, journeyId: f.lineage.journeyId,
    deploymentId: staged.deploymentId, configurationVersionId: staged.configurationVersionId,
    idempotencyKey: '00000000-0000-4000-8000-000000000001' });
  assert.equal(approved.action, 'approve'); assert.equal(approvals, 1); assert.equal(providerCalls, 0);
  const deployment = await f.store.unique(config.tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', staged.deploymentId);
  assert.equal(deployment.GO_LIVE_APPROVAL_STATUS, 'Approved'); assert.equal(deployment.ACTUAL_START_AT, null);
  assert.equal(deployment.APPROVED_START_AT, null); assert.equal(deployment.EXPIRES_AT, null);
  const loaded = await loadDeployment(f.store, deployment, { ...config, sharedAgentVersion: config.stagingAgentVersion,
    authorizationEventSecret: config.eventChainSecret });
  assert.equal(loaded.approvalEvidenceValidated, true); assert.equal(loaded.activationEvidenceValidated, false);
  assert.throws(() => activeAt(loaded, f.now()), { code: 'CONFIGURATION_UNAVAILABLE' }); assertHistory(v);
});

test('wrong signature, historical chain, source drift and any advanced deployment reject before writes', async () => {
  for (const mutate of [
    (v) => { v.envelope.signature = v.envelope.reconciliationRequest.signature; },
    (v) => { v.envelope.reconciliationRequest.signature = `v1=${'0'.repeat(64)}`; },
    (v) => { v.envelope.reconciliationRequest.originalRequest.signature = `v1=${'0'.repeat(64)}`; },
    (v) => {
      v.envelope.reconciliationRequest.intent.requested_at = new Date(v.f.now()).toISOString();
      v.envelope.reconciliationRequest.signature = `v1=${crypto.createHmac('sha256', v.config.operatorVerificationSecret)
        .update(RECONCILIATION_SIGNATURE_DOMAIN)
        .update(canonicalReconciliationIntent(v.envelope.reconciliationRequest.intent)).digest('hex')}`;
    },
    (v) => { v.envelope.intent.original_claim_fingerprint = '0'.repeat(64); v.sign(); },
    (v) => { v.envelope.intent.reconciliation_claim_fingerprint = '0'.repeat(64); v.sign(); },
    (v) => { v.envelope.intent.expected_deployment_fingerprint = `deployment_${'0'.repeat(64)}`; v.sign(); },
    (v) => { v.envelope.intent.route_fingerprint = `route_${'0'.repeat(64)}`; v.sign(); },
    (v) => { v.envelope.intent.configuration_fingerprint = `config_${'0'.repeat(64)}`; v.sign(); },
    (v) => { v.envelope.intent.operator_id_hash = `operator_${'0'.repeat(64)}`; v.sign(); },
    (v) => { v.envelope.intent.original_source_revision = 'b'.repeat(40); v.sign(); },
    (v) => { v.envelope.intent.target_source_revision = 'b'.repeat(40); v.sign(); },
    (v) => { v.f.advance(300_001); }, (v) => { v.recoveryReceipt.STATUS = 'Completed'; },
    (v) => { v.originalReceipt.PAYLOAD_FINGERPRINT = '0'.repeat(64); },
    (v) => { v.recoveryReceipt.EVENT_DATA_JSON += ' '; },
    (v) => { v.f.store.rowsFor(v.config.tables.CONFIGURATION_VERSION_TABLE)[1].ACTIVATED_AT = new Date(v.f.now()).toISOString(); },
    (v) => { v.f.store.rowsFor(v.config.tables.CONFIGURATION_VERSION_TABLE)[0].CONFIGURATION_JSON += ' '; },
    (v) => { v.f.records.deal.Alert_Recipient_Email = 'other@example.invalid'; },
    (v) => { v.f.nativeConversion.accountId = '99999999999'; },
    (v) => { v.f.bundle.session.JOURNEY_BINDING_DIGEST = '0'.repeat(64); },
    (v) => { v.f.records.deal.Deployment_Record_ID = v.original.deploymentId; },
    ...['COUNT_VERSION', 'HANDLED_COUNT', 'REPORT_RECONCILIATION_VERSION'].map((field) => (v) => { v.deployment[field] = 1; }),
    ...['APPROVAL_EVENT_KEY', 'ACTIVATION_EVENT_KEY', 'STOP_REASON'].map((field) => (v) => { v.deployment[field] = 'unexpected'; }),
    ...['ACTUAL_START_AT', 'APPROVED_START_AT', 'EXPIRES_AT', 'STOPPED_AT', 'GO_LIVE_APPROVED_AT', 'UPDATED_AT']
      .map((field) => (v) => { v.deployment[field] = new Date(v.f.now()).toISOString(); }),
    (v) => { v.deployment.TEST_STATUS = 'Live'; },
    (v) => { v.deployment.COUNTED_CALL_KEYS_JSON = '["synthetic_call"]'; },
  ]) {
    const v = await fixture(); mutate(v); const before = clone([...v.f.store.rows]); const writes = v.f.store.writes.length;
    await assert.rejects(v.service.complete(v.envelope));
    assert.deepEqual([...v.f.store.rows], before); assert.equal(v.f.store.writes.length, writes); assert.equal(v.f.stagingWrites, 0);
  }
});

test('completion interruption at every write boundary stays blocked without blind retry', async () => {
  for (const boundary of ['claim_after', 'configuration_before', 'configuration_after', 'deployment_before',
    'deployment_after', 'crm_before', 'crm_after', 'receipt_before']) {
    const v = await fixture(); const { f, service, config } = v;
    const insert = f.store.insertUnique.bind(f.store); const update = f.store.conditionalUpdate.bind(f.store);
    f.store.insertUnique = async (table, ...args) => {
      const kind = table === config.tables.CONFIGURATION_VERSION_TABLE ? 'configuration' : 'claim';
      if (boundary === `${kind}_before`) throw new Error('Synthetic definite failure');
      const result = await insert(table, ...args);
      if (boundary === `${kind}_after`) throw new Error('Synthetic ambiguous insert'); return result;
    };
    f.store.conditionalUpdate = async (table, ...args) => {
      const kind = table === config.tables.DEPLOYMENT_TABLE ? 'deployment' : 'receipt';
      if (boundary === `${kind}_before`) throw new Error('Synthetic CAS conflict');
      const result = await update(table, ...args);
      if (boundary === `${kind}_after`) throw new Error('Synthetic ambiguous CAS'); return result;
    };
    const record = f.crm.recordConfigurationStaging;
    f.crm.recordConfigurationStaging = async (...args) => {
      if (boundary === 'crm_before') throw new Error('Synthetic CRM definite failure');
      const result = await record(...args); if (boundary === 'crm_after') throw new Error('Synthetic CRM ambiguous response'); return result;
    };
    await assert.rejects(service.complete(v.envelope));
    const receipt = f.store.rowsFor(config.tables.EVENT_RECEIPT_TABLE).find((row) => row.RECEIPT_KIND === COMPLETION_RECEIPT_KIND);
    assert.equal(receipt.STATUS, 'Processing'); assert.equal(receipt.RECEIPT_VERSION, 0); assert.equal(receipt.ATTEMPT_COUNT, 1);
    const before = clone([...f.store.rows]); const writes = f.store.writes.length; const crmWrites = f.stagingWrites;
    await assert.rejects(service.complete(v.envelope), { code: 'CONFIGURATION_STAGING_RECONCILIATION_REQUIRED' });
    assert.deepEqual([...f.store.rows], before); assert.equal(f.store.writes.length, writes); assert.equal(f.stagingWrites, crmWrites);
    assertHistory(v);
  }
});

test('ambiguous final completion is reconciled by read-only exact replay', async () => {
  const v = await fixture(); const update = v.f.store.conditionalUpdate.bind(v.f.store);
  v.f.store.conditionalUpdate = async (table, ...args) => {
    const result = await update(table, ...args);
    if (table === v.config.tables.EVENT_RECEIPT_TABLE) throw new Error('Synthetic lost completed response'); return result;
  };
  await assert.rejects(v.service.complete(v.envelope));
  const before = clone([...v.f.store.rows]); const writes = v.f.store.writes.length;
  assert.equal((await v.service.complete(v.envelope)).replayed, true);
  assert.deepEqual([...v.f.store.rows], before); assert.equal(v.f.store.writes.length, writes); assert.equal(v.f.stagingWrites, 1);
  assertHistory(v);
});

test('a raced deployment CAS cannot advance CRM or resume the partial completion', async () => {
  const v = await fixture(); const update = v.f.store.conditionalUpdate.bind(v.f.store);
  v.f.store.conditionalUpdate = async (table, ...args) => {
    if (table === v.config.tables.DEPLOYMENT_TABLE) v.deployment.COUNT_VERSION = 1;
    return update(table, ...args);
  };
  await assert.rejects(v.service.complete(v.envelope));
  assert.equal(v.f.stagingWrites, 0);
  assert.equal(v.deployment.ACTIVE_CONFIGURATION_VERSION_ID, v.recovery.configurationVersionId);
  const before = clone([...v.f.store.rows]); const writes = v.f.store.writes.length;
  await assert.rejects(v.service.complete(v.envelope), { code: 'CONFIGURATION_STAGING_RECONCILIATION_REQUIRED' });
  assert.deepEqual([...v.f.store.rows], before); assert.equal(v.f.store.writes.length, writes); assertHistory(v);
});

test('completed-chain approval and replay reject altered historical evidence and current configuration', async () => {
  for (const mutate of [
    (v) => { v.originalReceipt.STATUS = 'Completed'; },
    (v) => { v.recoveryReceipt.PAYLOAD_FINGERPRINT = '0'.repeat(64); },
    (v) => { v.f.store.rowsFor(v.config.tables.CONFIGURATION_VERSION_TABLE)[1].CREATED_AT = new Date(v.f.now()).toISOString(); },
    (v, state) => { state.configurationRow.SOURCE_REVISION = 'b'.repeat(40); },
    (v, state) => { state.configurationRow.CONFIGURATION_JSON += ' '; },
    (v, state) => { state.deployment.ACTIVE_CONFIGURATION_VERSION_ID = v.recovery.configurationVersionId; },
    (v) => { v.f.records.deal.Alert_Recipient_Email = 'changed@example.invalid'; },
    (v) => { v.f.bundle.session.JOURNEY_BINDING_DIGEST = '0'.repeat(64); },
  ]) {
    const v = await fixture(); const result = await v.service.complete(v.envelope);
    const state = { deployment: v.deployment, deal: v.f.records.deal,
      configurationRow: v.f.store.rowsFor(v.config.tables.CONFIGURATION_VERSION_TABLE)[2] };
    mutate(v, state); const before = clone([...v.f.store.rows]); const writes = v.f.store.writes.length;
    await assert.rejects(v.service.assertApprovalSource({ dealId: v.f.request.dealId, journeyId: v.f.request.journeyId,
      deploymentId: result.deploymentId, configurationVersionId: result.configurationVersionId }, state));
    await assert.rejects(v.service.complete(v.envelope));
    assert.deepEqual([...v.f.store.rows], before); assert.equal(v.f.store.writes.length, writes); assert.equal(v.f.stagingWrites, 1);
  }
});

test('concurrent intents and later revisions cannot create a second completion slot or CRM effect', async () => {
  const v = await fixture(); const second = clone(v.envelope); v.f.advance(1);
  second.intent.requested_at = new Date(v.f.now()).toISOString(); v.sign(second);
  const insert = v.f.store.insertUnique.bind(v.f.store); let pending = Promise.resolve();
  v.f.store.insertUnique = (...args) => { const result = pending.then(() => insert(...args)); pending = result.catch(() => {}); return result; };
  const results = await Promise.allSettled([v.service.complete(v.envelope), v.service.complete(second)]);
  assert.equal(results.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(v.f.store.rowsFor(v.config.tables.CONFIGURATION_VERSION_TABLE).length, 3);
  assert.equal(v.f.store.rowsFor(v.config.tables.DEPLOYMENT_TABLE).length, 1);
  assert.equal(v.f.store.rowsFor(v.config.tables.EVENT_RECEIPT_TABLE)
    .filter((row) => row.RECEIPT_KIND === COMPLETION_RECEIPT_KIND).length, 1); assert.equal(v.f.stagingWrites, 1);
  const config = { ...v.config, sourceRevision: 'b'.repeat(40) }; const next = clone(v.envelope);
  const row = completionConfigurationRow(next.reconciliationRequest, next.intent.reconciliation_claim_key, config.sourceRevision);
  next.intent.target_source_revision = config.sourceRevision; next.intent.configuration_fingerprint = configurationSnapshotFingerprint(row);
  next.intent.route_fingerprint = routeFingerprint(routeFromRows(completionDeployment(next.reconciliationRequest,
    next.intent.reconciliation_claim_key, config.sourceRevision), row)); v.sign(next);
  const before = clone([...v.f.store.rows]); const writes = v.f.store.writes.length;
  await assert.rejects(v.serviceFor(config).complete(next));
  assert.deepEqual([...v.f.store.rows], before); assert.equal(v.f.store.writes.length, writes); assertHistory(v);
});

async function transitionFixture() {
  const v = await fixture(); const { f } = v; await v.service.complete(v.envelope);
  const receipt = f.store.rowsFor(f.config.tables.EVENT_RECEIPT_TABLE).find((row) => row.RECEIPT_KIND === COMPLETION_RECEIPT_KIND);
  const completedRow = f.store.rowsFor(f.config.tables.CONFIGURATION_VERSION_TABLE)[2];
  const transitionConfig = { ...v.config, sourceRevision: 'b'.repeat(40) };
  const projectedRow = transitionConfigurationRow(completedRow, receipt.EVENT_KEY, transitionConfig.sourceRevision);
  const projected = transitionDeployment(v.deployment, completedRow, receipt.EVENT_KEY, transitionConfig.sourceRevision);
  const transitionRequest = { profile: TRANSITION_PROFILE, intent: { schema_version: 1, action: 'transition_configuration',
    completion_claim_key: receipt.EVENT_KEY, completion_claim_fingerprint: receipt.PAYLOAD_FINGERPRINT,
    completed_source_revision: v.config.sourceRevision, target_source_revision: transitionConfig.sourceRevision,
    completed_configuration_version_id: completedRow.CONFIGURATION_VERSION_ID,
    completed_configuration_fingerprint: configurationSnapshotFingerprint(completedRow), deployment_id: v.deployment.DEPLOYMENT_ID,
    expected_deployment_fingerprint: inactiveDeploymentFingerprint(v.deployment), expected_deployment_version: 0,
    expected_receipt_version: 1, configuration_version_id: projectedRow.CONFIGURATION_VERSION_ID,
    configuration_fingerprint: configurationSnapshotFingerprint(projectedRow), route_fingerprint: routeFingerprint(routeFromRows(projected, projectedRow)),
    operator_id_hash: transitionConfig.operatorIdHash, evidence_observed_at: new Date(f.now()).toISOString(),
    requested_at: new Date(f.now()).toISOString() }, signature: '' };
  const signTransition = (request = transitionRequest) => {
    request.signature = `v1=${crypto.createHmac('sha256', transitionConfig.operatorVerificationSecret)
      .update(TRANSITION_SIGNATURE_DOMAIN).update(canonicalTransitionIntent(request.intent)).digest('hex')}`;
    return request;
  };
  signTransition();
  return { ...v, transitionConfig, transitionService: v.serviceFor(transitionConfig), transitionRequest, signTransition,
    completedReceipt: receipt, completedRow, preTransitionRows: clone([...f.store.rows]) };
}

function assertCompletedHistory(v) {
  assertHistory(v);
  assert.deepEqual(v.f.store.rowsFor(v.config.tables.CONFIGURATION_VERSION_TABLE).slice(0, 3),
    new Map(v.preTransitionRows).get(v.config.tables.CONFIGURATION_VERSION_TABLE));
  assert.deepEqual(v.f.store.rowsFor(v.config.tables.EVENT_RECEIPT_TABLE)
    .filter((row) => row.RECEIPT_KIND !== TRANSITION_RECEIPT_KIND && row.RECEIPT_KIND !== 'authorization_event'),
  new Map(v.preTransitionRows).get(v.config.tables.EVENT_RECEIPT_TABLE));
}

test('completed release transitions once with stored BigInt strings and then approves separately without a clock', async () => {
  const v = await transitionFixture(); const { f, transitionConfig: config, transitionService: service } = v;
  const unique = f.store.unique.bind(f.store); const update = f.store.conditionalUpdate.bind(f.store);
  const storedReadback = (row) => {
    if (row) for (const field of ['BINDING_VERSION', 'MONITOR_AGENT_VERSION', 'CALL_LIMIT', 'COUNT_VERSION',
      'HANDLED_COUNT', 'REPORT_RECONCILIATION_VERSION', 'ATTEMPT_COUNT', 'RECEIPT_VERSION']) {
      if (Object.hasOwn(row, field)) row[field] = String(row[field]);
    }
    return row;
  };
  f.store.unique = async (...args) => storedReadback(await unique(...args));
  f.store.conditionalUpdate = async (...args) => storedReadback(await update(...args));
  const writes = f.store.writes.length; const crmBefore = clone(f.records);
  const result = await service.transition(v.transitionRequest);
  assert.deepEqual(result, { state: 'StagedInactive', transitioned: true, replayed: false, approved: false, active: false,
    configurationVersionId: v.transitionRequest.intent.configuration_version_id, deploymentId: v.deployment.DEPLOYMENT_ID });
  assert.equal(f.store.writes.length - writes, 4); assert.equal(f.stagingWrites, 1);
  assert.deepEqual(f.records, crmBefore); assertCompletedHistory(v);
  const nextRow = f.store.rowsFor(config.tables.CONFIGURATION_VERSION_TABLE)[3];
  const expected = JSON.parse(v.completedRow.CONFIGURATION_JSON);
  if (expected.reportBaseline) expected.reportBaseline.configurationVersionId = nextRow.CONFIGURATION_VERSION_ID;
  assert.deepEqual(JSON.parse(nextRow.CONFIGURATION_JSON), expected);
  assert.equal(nextRow.SOURCE_REVISION, config.sourceRevision);
  f.advance(900_001); const beforeReplay = clone([...f.store.rows]); const replayWrites = f.store.writes.length;
  assert.equal((await service.transition(v.transitionRequest)).replayed, true);
  assert.deepEqual([...f.store.rows], beforeReplay); assert.equal(f.store.writes.length, replayWrites);
  let approvals = 0; let providerCalls = 0;
  f.crm.recordApproval = async (_id, input) => {
    assert.equal(input.configurationStaged, true); assert.equal(input.priorCoreApproval, null); approvals += 1;
    Object.assign(f.records.deal, { Test_Status: 'Scheduled', Go_Live_Approval_Status: 'Approved',
      Go_Live_Approved_At: input.approvedAt, Approved_Deployment_Record_ID: input.deploymentId,
      Approved_Configuration_Version: input.configurationVersionId }); return clone(f.records.deal);
  };
  const control = createRouteControlService({ config, store: f.store, crm: f.crm, configurationStaging: service,
    provider: new Proxy({}, { get() { return async () => { providerCalls += 1; throw new Error('No provider execution'); }; } }), now: f.now });
  await control.approve({ dealId: f.records.deal.id, journeyId: f.lineage.journeyId, deploymentId: result.deploymentId,
    configurationVersionId: result.configurationVersionId, idempotencyKey: '00000000-0000-4000-8000-000000000002' });
  assert.equal(approvals, 1); assert.equal(providerCalls, 0);
  const deployment = await f.store.unique(config.tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', result.deploymentId);
  assert.equal(deployment.TEST_STATUS, 'Scheduled'); assert.equal(deployment.COUNT_VERSION, '1');
  for (const field of ['APPROVED_START_AT', 'ACTUAL_START_AT', 'EXPIRES_AT', 'ACTIVATION_EVENT_KEY']) assert.equal(deployment[field], null);
  const loaded = await loadDeployment(f.store, deployment, { ...config, sharedAgentVersion: config.stagingAgentVersion,
    authorizationEventSecret: config.eventChainSecret });
  assert.equal(loaded.approvalEvidenceValidated, true); assert.equal(loaded.activationEvidenceValidated, false);
  assert.throws(() => activeAt(loaded, f.now()), { code: 'CONFIGURATION_UNAVAILABLE' });
  await assert.rejects(service.transition(v.transitionRequest), { code: 'CONFIGURATION_STAGING_STATE_ADVANCED' });
  assertCompletedHistory(v);
});

test('transition rejects unauthenticated, stale, changed-source, advanced and foreign evidence before writes', async () => {
  for (const mutate of [
    (v) => { v.transitionRequest.signature = v.envelope.signature; },
    (v) => { v.transitionRequest.intent.completion_claim_fingerprint = '0'.repeat(64); v.signTransition(); },
    (v) => { v.transitionRequest.intent.completed_configuration_fingerprint = `config_${'0'.repeat(64)}`; v.signTransition(); },
    (v) => { v.transitionRequest.intent.configuration_fingerprint = `config_${'0'.repeat(64)}`; v.signTransition(); },
    (v) => { v.transitionRequest.intent.route_fingerprint = `route_${'0'.repeat(64)}`; v.signTransition(); },
    (v) => { v.transitionRequest.intent.expected_deployment_fingerprint = `deployment_${'0'.repeat(64)}`; v.signTransition(); },
    (v) => { v.transitionRequest.intent.operator_id_hash = `operator_${'0'.repeat(64)}`; v.signTransition(); },
    (v) => { v.transitionRequest.intent.completed_source_revision = 'd'.repeat(40); v.signTransition(); },
    (v) => { v.transitionRequest.intent.target_source_revision = 'd'.repeat(40); v.signTransition(); },
    (v) => { v.f.advance(300_001); },
    (v) => { v.transitionRequest.intent.requested_at = new Date(v.f.now() + 1).toISOString(); v.signTransition(); },
    (v) => { v.completedReceipt.STATUS = 'Processing'; v.completedReceipt.RECEIPT_VERSION = 0; v.completedReceipt.PROCESSED_AT = null; },
    (v) => { v.completedReceipt.PAYLOAD_FINGERPRINT = '0'.repeat(64); },
    (v) => { v.recoveryReceipt.STATUS = 'Completed'; },
    (v) => { v.originalReceipt.EVENT_DATA_JSON += ' '; },
    (v) => { v.completedRow.CONFIGURATION_JSON += ' '; },
    (v) => { v.completedRow.ACTIVATED_AT = new Date(v.f.now()).toISOString(); },
    (v) => { v.f.records.deal.Alert_Recipient_Email = 'different@example.invalid'; },
    (v) => { v.f.records.account.Phone = '+15555550123'; },
    (v) => { v.f.nativeConversion.contactId = '99999999999'; },
    (v) => { v.f.bundle.session.JOURNEY_BINDING_DIGEST = '0'.repeat(64); },
    ...['COUNT_VERSION', 'HANDLED_COUNT', 'REPORT_RECONCILIATION_VERSION'].map((field) => (v) => { v.deployment[field] = 1; }),
    ...['APPROVED_CONFIGURATION_VERSION_ID', 'APPROVAL_EVENT_KEY', 'APPROVED_ROUTE_FINGERPRINT', 'GO_LIVE_APPROVED_AT',
      'ACTIVATION_EVENT_KEY', 'APPROVED_START_AT', 'ACTUAL_START_AT', 'EXPIRES_AT', 'STOP_REASON', 'STOPPED_AT']
      .map((field) => (v) => { v.deployment[field] = 'unexpected'; }),
    (v) => { v.deployment.COUNTED_CALL_KEYS_JSON = '["synthetic_call"]'; },
    (v) => { v.deployment.REPORT_RECONCILIATION_STATUS = 'Pending'; },
    (v) => { v.f.store.rowsFor(v.config.tables.EVENT_RECEIPT_TABLE).push({ EVENT_KEY: 'synthetic_old_approval',
      DEPLOYMENT_ID: v.deployment.DEPLOYMENT_ID, RECEIPT_KIND: 'authorization_event' }); },
  ]) {
    const v = await transitionFixture(); mutate(v); const before = clone([...v.f.store.rows]); const writes = v.f.store.writes.length;
    await assert.rejects(v.transitionService.transition(v.transitionRequest));
    assert.deepEqual([...v.f.store.rows], before); assert.equal(v.f.store.writes.length, writes); assert.equal(v.f.stagingWrites, 1);
  }
});

test('interrupted transition stays claimed at every write boundary and never retries the partial state', async () => {
  for (const boundary of ['claim_after', 'configuration_before', 'configuration_after', 'deployment_before', 'deployment_after', 'receipt_before']) {
    const v = await transitionFixture(); const { f, transitionService: service, transitionConfig: config } = v;
    const insert = f.store.insertUnique.bind(f.store); const update = f.store.conditionalUpdate.bind(f.store);
    f.store.insertUnique = async (table, ...args) => {
      const kind = table === config.tables.CONFIGURATION_VERSION_TABLE ? 'configuration' : 'claim';
      if (boundary === `${kind}_before`) throw new Error('Synthetic definite insert failure');
      const result = await insert(table, ...args); if (boundary === `${kind}_after`) throw new Error('Synthetic ambiguous insert'); return result;
    };
    f.store.conditionalUpdate = async (table, ...args) => {
      const kind = table === config.tables.DEPLOYMENT_TABLE ? 'deployment' : 'receipt';
      if (boundary === `${kind}_before`) throw new Error('Synthetic CAS failure');
      const result = await update(table, ...args); if (boundary === `${kind}_after`) throw new Error('Synthetic ambiguous CAS'); return result;
    };
    await assert.rejects(service.transition(v.transitionRequest));
    const receipt = f.store.rowsFor(config.tables.EVENT_RECEIPT_TABLE).find((row) => row.RECEIPT_KIND === TRANSITION_RECEIPT_KIND);
    assert.equal(receipt.STATUS, 'Processing'); assert.equal(receipt.RECEIPT_VERSION, 0);
    const before = clone([...f.store.rows]); const writes = f.store.writes.length;
    await assert.rejects(service.transition(v.transitionRequest), { code: 'CONFIGURATION_STAGING_RECONCILIATION_REQUIRED' });
    assert.deepEqual([...f.store.rows], before); assert.equal(f.store.writes.length, writes); assert.equal(f.stagingWrites, 1); assertCompletedHistory(v);
  }
});

test('transition lost final response reconciles read-only but racing and later-release claims cannot duplicate effects', async () => {
  const v = await transitionFixture(); const { f, transitionConfig: config, transitionService: service } = v;
  const update = f.store.conditionalUpdate.bind(f.store);
  f.store.conditionalUpdate = async (table, ...args) => {
    const result = await update(table, ...args);
    if (table === config.tables.EVENT_RECEIPT_TABLE) throw new Error('Synthetic lost final response'); return result;
  };
  await assert.rejects(service.transition(v.transitionRequest));
  const before = clone([...f.store.rows]); const writes = f.store.writes.length;
  assert.equal((await service.transition(v.transitionRequest)).replayed, true);
  assert.deepEqual([...f.store.rows], before); assert.equal(f.store.writes.length, writes); assertCompletedHistory(v);
  const other = clone(v.transitionRequest); other.intent.target_source_revision = 'c'.repeat(40);
  const row = transitionConfigurationRow(v.completedRow, v.completedReceipt.EVENT_KEY, other.intent.target_source_revision);
  other.intent.configuration_fingerprint = configurationSnapshotFingerprint(row);
  other.intent.route_fingerprint = routeFingerprint(routeFromRows({ ...v.deployment, SOURCE_REVISION: 'c'.repeat(40) }, row));
  v.signTransition(other);
  await assert.rejects(v.serviceFor({ ...config, sourceRevision: 'c'.repeat(40) }).transition(other));
  assert.equal(f.store.writes.length, writes);
  const race = await transitionFixture(); const originalUpdate = race.f.store.conditionalUpdate.bind(race.f.store);
  race.f.store.conditionalUpdate = async (table, ...args) => {
    if (table === race.config.tables.DEPLOYMENT_TABLE) race.deployment.COUNT_VERSION = 1;
    return originalUpdate(table, ...args);
  };
  await assert.rejects(race.transitionService.transition(race.transitionRequest));
  assert.equal(race.deployment.ACTIVE_CONFIGURATION_VERSION_ID, race.completedRow.CONFIGURATION_VERSION_ID);
  const raceWrites = race.f.store.writes.length;
  await assert.rejects(race.transitionService.transition(race.transitionRequest));
  assert.equal(race.f.store.writes.length, raceWrites); assert.equal(race.f.stagingWrites, 1); assertCompletedHistory(race);
  const concurrent = await transitionFixture(); const second = clone(concurrent.transitionRequest); concurrent.f.advance(1);
  second.intent.requested_at = new Date(concurrent.f.now()).toISOString(); concurrent.signTransition(second);
  const insert = concurrent.f.store.insertUnique.bind(concurrent.f.store); let pending = Promise.resolve();
  concurrent.f.store.insertUnique = (...args) => { const result = pending.then(() => insert(...args)); pending = result.catch(() => {}); return result; };
  const results = await Promise.allSettled([concurrent.transitionService.transition(concurrent.transitionRequest), concurrent.transitionService.transition(second)]);
  assert.equal(results.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(concurrent.f.store.rowsFor(concurrent.config.tables.CONFIGURATION_VERSION_TABLE).length, 4);
  assert.equal(concurrent.f.store.rowsFor(concurrent.config.tables.DEPLOYMENT_TABLE).length, 1); assertCompletedHistory(concurrent);
});

test('transition replay and approval provenance reject active-pointer or deployment-key drift without writes', async () => {
  for (const mutate of [
    (v) => { v.deployment.ACTIVE_CONFIGURATION_VERSION_ID = v.completedRow.CONFIGURATION_VERSION_ID; },
    (v) => { v.deployment.DEPLOYMENT_KEY = `cfgdeployment_${'0'.repeat(64)}`; },
  ]) {
    const v = await transitionFixture(); const result = await v.transitionService.transition(v.transitionRequest);
    mutate(v); const before = clone([...v.f.store.rows]); const writes = v.f.store.writes.length;
    const state = { deployment: v.deployment, deal: v.f.records.deal,
      configurationRow: v.f.store.rowsFor(v.config.tables.CONFIGURATION_VERSION_TABLE)[3] };
    await assert.rejects(v.transitionService.transition(v.transitionRequest));
    await assert.rejects(v.transitionService.assertApprovalSource({ dealId: v.f.records.deal.id,
      journeyId: v.f.lineage.journeyId, deploymentId: result.deploymentId, configurationVersionId: result.configurationVersionId }, state));
    assert.deepEqual([...v.f.store.rows], before); assert.equal(v.f.store.writes.length, writes);
    assert.equal(v.f.stagingWrites, 1); assertCompletedHistory(v);
  }
});

test.after(() => { assert.deepEqual(guard.blocked, []); guard.restore(); });
