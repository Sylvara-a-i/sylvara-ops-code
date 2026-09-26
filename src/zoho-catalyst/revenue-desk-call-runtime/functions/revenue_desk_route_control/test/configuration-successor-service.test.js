'use strict';

// Synthetic Demo — No Live Calls. Every adapter is an in-memory fake.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createStagingFixture } = require('./helpers/configuration-staging-fixture');
const { PROFILE, SIGNATURE_DOMAIN, QA_SCOPE, successorPlanDigest, successorIdentity,
  canonicalSuccessorIntent, projectInactiveSuccessor }
  = require('revenue_desk_call_gateway/lib/configuration-successor');
const { configurationSnapshotFingerprint, routeFingerprint, routeFromRows }
  = require('revenue_desk_call_gateway/lib/approval-control');
const { inactiveDeploymentFingerprint } = require('revenue_desk_call_gateway/lib/configuration-reconciliation');
const { numberLookupKey } = require('revenue_desk_call_gateway/lib/security');
const { createConfigurationSuccessorService, historyDigest, sourceSnapshotDigest }
  = require('../lib/configuration-successor-service');
const { validateUnsignedSuccessorEnvelope, signFreeTestSuccessorPacket }
  = require('../../../../revenue-desk-release/lib/free-test-staging-packet');
const clone = (value) => structuredClone(value);

function fixture() {
  const f = createStagingFixture();
  const beforeId = `cfgtransitioned_${'b'.repeat(64)}`;
  const at = new Date(f.now() - 1000).toISOString();
  const old = { ...clone(f.request.configurationRow), CONFIGURATION_VERSION_ID: beforeId,
    ROWID: '21', CREATED_AT: at, ACTIVATED_AT: null };
  const content = JSON.parse(old.CONFIGURATION_JSON);
  content.notificationHandoff = { schemaVersion: 1, timeZone: 'America/Chicago', channel: 'email',
    recipientId: content.notificationRecipient.recipientId, monitored: true,
    acknowledgedAt: at, acknowledgmentReference: 'synthetic_monitoring_v1' };
  old.CONFIGURATION_JSON = JSON.stringify(content);
  const before = { ...clone(f.request.deployment), ROWID: '22', DEPLOYMENT_KEY: `cfgdeployment_${'d'.repeat(64)}`,
    ACTIVE_CONFIGURATION_VERSION_ID: beforeId, TEST_STATUS: 'Scheduled', GO_LIVE_APPROVAL_STATUS: 'Approved',
    APPROVED_CONFIGURATION_VERSION_ID: beforeId, APPROVAL_EVENT_KEY: `approval_${'a'.repeat(64)}`,
    APPROVED_ROUTE_FINGERPRINT: null, GO_LIVE_APPROVED_AT: at, COUNT_VERSION: 1,
    ACTIVATION_EVENT_KEY: null, APPROVED_START_AT: null, ACTUAL_START_AT: null, EXPIRES_AT: null,
    COUNTED_CALL_KEYS_JSON: '[]', STOP_REASON: null, STOPPED_AT: null,
    REPORT_RECONCILIATION_STATUS: 'NotRequired', REPORT_RECONCILIATION_VERSION: 0, UPDATED_AT: at };
  before.APPROVED_ROUTE_FINGERPRINT = routeFingerprint(routeFromRows(before, old));
  Object.assign(f.records.deal, { Stage: 'Setup and QA', Test_Status: 'Scheduled',
    Go_Live_Approval_Status: 'Approved', Go_Live_Approved_At: at,
    Approved_Configuration_Version: beforeId, Approved_Deployment_Record_ID: before.DEPLOYMENT_ID,
    Deployment_Record_ID: before.DEPLOYMENT_ID });
  const history = [{ ROWID: '23', EVENT_KEY: before.APPROVAL_EVENT_KEY, RECEIPT_KIND: 'authorization_event',
    EVENT_TYPE: 'approve', CONFIGURATION_VERSION_ID: beforeId, DEPLOYMENT_ID: before.DEPLOYMENT_ID,
    STATUS: 'Completed', RECEIPT_VERSION: 1, ATTEMPT_COUNT: 0, SOURCE_REVISION: old.SOURCE_REVISION,
    SOURCE_ENVIRONMENT: 'development', EVENT_DATA_JSON: '{"historical":"not authenticated with an old key"}',
    PAYLOAD_FINGERPRINT: '1'.repeat(64), RECEIVED_AT: at, PROCESSED_AT: at }];
  f.store.rowsFor(f.config.tables.CONFIGURATION_VERSION_TABLE).push(old);
  f.store.rowsFor(f.config.tables.DEPLOYMENT_TABLE).push(before);
  f.store.rowsFor(f.config.tables.EVENT_RECEIPT_TABLE).push(...history);
  const config = { ...f.config, sourceRevision: 'f'.repeat(40), retellRouteMode: 'disabled',
    numberSecret: 'synthetic-replacement-number-secret'.repeat(2),
    eventChainSecret: 'synthetic-replacement-event-secret'.repeat(2),
    operatorVerificationSecret: 'synthetic-replacement-owner-secret'.repeat(2),
    tables: { ...f.config.tables, CANONICAL_CALL_TABLE: 'RevenueDeskCalls', NOTIFICATION_TABLE: 'RevenueDeskNotifications' } };
  f.store.rowsFor(config.tables.CANONICAL_CALL_TABLE); f.store.rowsFor(config.tables.NOTIFICATION_TABLE);
  const plan = { schema_version: 1, action: 'succeed_inactive_configuration', deployment_id: before.DEPLOYMENT_ID,
    deal_id: f.records.deal.id, journey_id: f.records.deal.Intake_Submission_ID,
    predecessor_configuration_id: beforeId, predecessor_revision: old.SOURCE_REVISION,
    target_revision: config.sourceRevision, predecessor_configuration_fingerprint: configurationSnapshotFingerprint(old),
    predecessor_deployment_fingerprint: inactiveDeploymentFingerprint(before), historical_receipts_digest: historyDigest(history),
    historical_receipt_keys: history.map((row) => row.EVENT_KEY),
    source_snapshot_digest: sourceSnapshotDigest(f.records, f.lineage, f.nativeConversion, f.bundle),
    credential_transition_digest: '4'.repeat(64), independent_authorization_reference: 'synthetic_owner_authorization_1',
    qa_scope: QA_SCOPE, qa_retention_reference: 'synthetic_retention_policy_1', maximum_call_duration_ms: 175000,
    new_number_lookup_hash: numberLookupKey(config.numberSecret, config.retellPhoneNumber),
    new_analytics_client_key: '5'.repeat(64), new_analytics_deployment_key: '6'.repeat(64),
    operator_id_hash: config.operatorIdHash };
  const request = { profile: PROFILE, intent: { plan, requested_at: new Date(f.now()).toISOString() }, signature: '' };
  function sign() {
    config.successorAuthorizationSha256 = successorPlanDigest(plan);
    request.signature = `v1=${crypto.createHmac('sha256', config.operatorVerificationSecret)
      .update(SIGNATURE_DOMAIN).update(canonicalSuccessorIntent(request.intent)).digest('hex')}`;
  }
  sign();
  let crmWrites = 0;
  f.crm.recordConfigurationSuccessor = async (_id, { expectedDeal }) => {
    assert.deepEqual(expectedDeal, f.records.deal); crmWrites += 1;
    Object.assign(f.records.deal, { Test_Status: 'Setup Pending', Go_Live_Approval_Status: 'Not Ready',
      Go_Live_Approved_At: null, Approved_Deployment_Record_ID: null, Approved_Configuration_Version: null });
    return clone(f.records.deal);
  };
  const serviceFor = (overrides = {}) => createConfigurationSuccessorService({ config: { ...config, ...overrides },
    store: f.store, crm: f.crm, sourceReader: f.sourceReader, conversionReader: f.conversionReader,
    evidenceStore: { readBundle: async () => clone(f.bundle) }, now: f.now });
  return { f, config, plan, request, old, before, history, sign, serviceFor, get crmWrites() { return crmWrites; } };
}

test('fresh pinned authorization succeeds inactive once; predecessors and capacity remain unchanged', async () => {
  const v = fixture(); const old = clone(v.old); const history = clone(v.history);
  const service = v.serviceFor(); const result = await service.succeed(v.request);
  assert.equal(result.state, 'SuccessorInactive'); assert.equal(result.replayed, false);
  assert.equal(v.before.COUNT_VERSION, 2); assert.equal(v.before.HANDLED_COUNT, 0);
  assert.equal(v.before.GO_LIVE_APPROVAL_STATUS, 'Pending Internal Approval');
  assert.equal(v.before.TEST_STATUS, 'Ready for Approval'); assert.equal(v.before.APPROVAL_EVENT_KEY, null);
  assert.equal(v.before.ACTUAL_START_AT, null); assert.equal(v.before.EXPIRES_AT, null);
  assert.equal(v.crmWrites, 1); assert.deepEqual(v.old, old); assert.deepEqual(v.history, history);
  const writes = v.f.store.writes.length;
  v.f.advance(600000);
  assert.equal((await service.succeed(v.request)).replayed, true);
  assert.equal(v.f.store.writes.length, writes); assert.equal(v.crmWrites, 1);
  const evidence = await service.assertApprovalSource(result, { deal: clone(v.f.records.deal) });
  assert.deepEqual(evidence, { configurationStaged: true, priorCoreApproval: null });
  assert.deepEqual(await service.partitionAuthorizationHistory(result, v.history), []);
});

test('successor refuses changed owner pin, fields, source, recipients, work and active state before writes', async () => {
  for (const mutate of [
    (v) => { v.config.successorAuthorizationSha256 = null; },
    (v) => { v.config.successorAuthorizationSha256 = '0'.repeat(64); },
    (v) => { v.config.retellRouteMode = 'isolated_test'; },
    (v) => { v.config.sourceRevision = 'a'.repeat(40); },
    (v) => { v.config.numberSecret = 'other-synthetic-number-secret'.repeat(2); },
    (v) => { v.request.signature = `v1=${'0'.repeat(64)}`; },
    (v) => { v.plan.maximum_call_duration_ms = 180000; },
    (v) => { v.plan.qa_scope = 'customer'; },
    (v) => { v.plan.qa_retention_reference = ''; },
    (v) => { v.plan.arbitrary = true; },
    (v) => { v.f.advance(300001); },
    (v) => { v.before.HANDLED_COUNT = 1; },
    (v) => { v.before.ACTUAL_START_AT = new Date(v.f.now()).toISOString(); },
    (v) => { v.before.COUNT_VERSION = 2; },
    (v) => { v.f.records.deal.Alert_Recipient_Email = 'wrong@example.invalid'; },
    (v) => { v.f.records.account.Account_Name = 'OTHER SYNTHETIC BUSINESS'; },
    (v) => { v.f.records.deal.Test_Scope_Accepted = false; },
    (v) => { v.f.nativeConversion.accountId = '999999999'; },
    (v) => { v.f.bundle.session.CRM_DEAL_ID = '999999999'; },
    (v) => { v.f.bundle.proof.STATUS = 'revoked'; },
    (v) => { v.history[0].EVENT_DATA_JSON = '{}'; },
    (v) => { v.f.store.rowsFor(v.config.tables.CANONICAL_CALL_TABLE).push({ DEPLOYMENT_ID: v.plan.deployment_id }); },
    (v) => { v.f.store.rowsFor(v.config.tables.NOTIFICATION_TABLE).push({ DEPLOYMENT_ID: v.plan.deployment_id }); },
  ]) {
    const v = fixture(); mutate(v); const before = clone([...v.f.store.rows]);
    await assert.rejects(v.serviceFor().succeed(v.request));
    assert.equal(v.f.store.writes.length, 0); assert.equal(v.crmWrites, 0); assert.deepEqual([...v.f.store.rows], before);
  }
});

test('successor changes only baseline ownership, preserving unknowns and excluding provider bookkeeping', () => {
  const v = fixture(); const json = JSON.parse(v.old.CONFIGURATION_JSON);
  json.reportBaseline = { schemaVersion: 1, clientKey: 'a'.repeat(64), deploymentKey: 'b'.repeat(64),
    configurationVersionId: v.old.CONFIGURATION_VERSION_ID, configurationVersion: json.configurationVersion,
    environment: 'development', coverageMode: json.coverageMode,
    capturedAt: '2026-08-19T12:00:00.000Z', sourceModifiedAt: '2026-08-19T11:55:00.000Z',
    sourcePeriod: { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
    evidenceClass: 'customer_supplied_estimate', provenanceStatus: 'locally_consistent_not_authenticated',
    comparisonStatus: 'context_only_not_before_after_proof', currency: null,
    values: { currentCallHandling: 'Voicemail', monthlyInboundCalls: null, monthlyInboundCallBand: null,
      afterHoursCallBand: null, afterHoursCallShare: null, estimatedUnansweredCallRate: null,
      averageJobValueMinorUnits: null, averageJobValueBand: null, currentMonthlyAnsweringCostMinorUnits: null } };
  v.old.CONFIGURATION_JSON = JSON.stringify(json);
  v.old.providerOnlyMetadata = 'not part of the immutable schema';
  v.plan.predecessor_configuration_fingerprint = configurationSnapshotFingerprint(v.old);
  v.before.APPROVED_ROUTE_FINGERPRINT = routeFingerprint(routeFromRows(v.before, v.old));
  v.plan.predecessor_deployment_fingerprint = inactiveDeploymentFingerprint(v.before);
  const before = clone(v.old);
  const projected = projectInactiveSuccessor(v.plan, v.old, v.before, new Date(v.f.now()).toISOString());
  const after = JSON.parse(projected.configurationRow.CONFIGURATION_JSON);
  assert.deepEqual(after, { ...json, reportBaseline: { ...json.reportBaseline,
    configurationVersionId: successorIdentity(v.plan).configurationVersionId,
    clientKey: v.plan.new_analytics_client_key, deploymentKey: v.plan.new_analytics_deployment_key } });
  assert.deepEqual(v.old, before);
  assert.equal(Object.hasOwn(projected.configurationRow, 'ROWID'), false);
  assert.equal(Object.hasOwn(projected.configurationRow, 'providerOnlyMetadata'), false);
  assert.throws(() => projectInactiveSuccessor({ ...v.plan, new_analytics_deployment_key: v.plan.new_analytics_client_key },
    v.old, v.before, new Date(v.f.now()).toISOString()), { code: 'INVALID_SCHEMA' });
});

test('successor enters existing separate approval path without accepting the historical key or resetting version', async () => {
  const { createRouteControlService } = require('revenue_desk_call_gateway/lib/route-control-service');
  const v = fixture();
  v.f.records.deal.Test_Phone_Number = v.config.retellPhoneNumber;
  v.plan.source_snapshot_digest = sourceSnapshotDigest(v.f.records, v.f.lineage, v.f.nativeConversion, v.f.bundle);
  v.sign();
  const successor = v.serviceFor(); const result = await successor.succeed(v.request);
  v.f.crm.recordApproval = async (_id, { configurationStaged, approvedAt, configurationVersionId, deploymentId }) => {
    assert.equal(configurationStaged, true);
    Object.assign(v.f.records.deal, { Test_Status: 'Scheduled', Go_Live_Approval_Status: 'Approved',
      Go_Live_Approved_At: approvedAt, Approved_Configuration_Version: configurationVersionId,
      Approved_Deployment_Record_ID: deploymentId });
    return clone(v.f.records.deal);
  };
  const service = createRouteControlService({ config: v.config, store: v.f.store, crm: v.f.crm,
    provider: new Proxy({}, { get() { throw new Error('provider access prohibited'); } }),
    configurationStaging: successor, now: v.f.now });
  const command = { dealId: result.dealId, journeyId: result.journeyId, deploymentId: result.deploymentId,
    configurationVersionId: result.configurationVersionId, idempotencyKey: '00000000-0000-4000-8000-000000000001' };
  const approved = await service.approve(command);
  assert.equal(approved.deployment.COUNT_VERSION, 3); assert.equal(approved.deployment.TEST_STATUS, 'Scheduled');
  assert.equal(approved.deployment.ACTUAL_START_AT, null); assert.equal(approved.deployment.EXPIRES_AT, null);
  assert.equal(v.history[0].CONFIGURATION_VERSION_ID, v.plan.predecessor_configuration_id);
  const writes = v.f.store.writes.length;
  assert.equal((await service.approve(command)).replayed, true); assert.equal(v.f.store.writes.length, writes);
  const rows = v.f.store.rowsFor(v.config.tables.EVENT_RECEIPT_TABLE).filter((row) => row.RECEIPT_KIND === 'authorization_event');
  assert.equal(rows.length, 2); assert.equal((await successor.partitionAuthorizationHistory(command, rows)).length, 1);
  // Existing future call receipts stay in their own verification path, not in
  // the authorization chain; history is not silently deleted or re-signed.
  for (let index = 0; index < 110; index += 1) v.f.store.rowsFor(v.config.tables.EVENT_RECEIPT_TABLE).push({ EVENT_KEY: `synthetic_future_event_${index}`,
    CONFIGURATION_VERSION_ID: command.configurationVersionId, DEPLOYMENT_ID: command.deploymentId,
    RECEIPT_KIND: 'provider_event' });
  assert.equal((await successor.partitionAuthorizationHistory(command, rows)).length, 1);
  // Existing fake-adapter lifecycle proves downstream compatibility. These are
  // local state assertions, not a hosted rehearsal, call or provider operation.
  let verified = 0; let disabled = 0;
  v.f.crm.recordActivation = async (_id, { activatedAt }) => {
    Object.assign(v.f.records.deal, { Stage: 'Test Live', Test_Status: 'Live', Test_Start_At: activatedAt });
    return clone(v.f.records.deal);
  };
  v.f.crm.recordRollback = async (_id, { stoppedAt, reason }) => {
    Object.assign(v.f.records.deal, { Stage: 'Closed Lost', Test_Status: 'Rolled Back',
      Test_End_At: stoppedAt, Test_End_Reason: reason, Rollback_Completed_At: stoppedAt });
    return clone(v.f.records.deal);
  };
  v.f.store.mutate = async (table, key, value, version, transform) => {
    const current = await v.f.store.unique(table, key, value); const patch = await transform(current);
    if (!patch) return current;
    return v.f.store.conditionalUpdate(table, current.ROWID, { ...patch, [version]: Number(current[version]) + 1 },
      { [version]: current[version] });
  };
  const lifecycle = createRouteControlService({ config: { ...v.config, retellRouteMode: 'isolated_test' },
    store: v.f.store, crm: v.f.crm, configurationStaging: successor, now: v.f.now,
    provider: { async verifyActiveRoute({ deployment, configurationVersion, routeFingerprint: fingerprint }) {
      verified += 1; return { status: 'route_active', deploymentId: deployment.DEPLOYMENT_ID,
        configurationVersionId: configurationVersion.CONFIGURATION_VERSION_ID, routeFingerprint: fingerprint,
        readbackFingerprint: `readback_${'6'.repeat(64)}`, observedAt: new Date(v.f.now()).toISOString() };
    }, async disableRoute() { disabled += 1; return { status: 'route_inactive', instructions: 'Synthetic adapter only' }; } } });
  const activated = await lifecycle.activate({ ...command, idempotencyKey: '00000000-0000-4000-8000-000000000002' });
  assert.equal(activated.deployment.TEST_STATUS, 'Live'); assert.ok(verified > 0);
  const stopped = await lifecycle.rollback({ ...command, idempotencyKey: '00000000-0000-4000-8000-000000000003',
    reason: 'operator_requested' });
  assert.equal(stopped.deployment.TEST_STATUS, 'Stopped'); assert.equal(disabled, 1);
  assert.equal(v.before.HANDLED_COUNT, 0); assert.ok(v.before.COUNT_VERSION > 3);
  assert.equal(v.history[0].CONFIGURATION_VERSION_ID, v.plan.predecessor_configuration_id);
});

test('partial successor claims block retries at each boundary; complete lost response reconciles without writes', async () => {
  for (const boundary of ['claim', 'configuration', 'deployment', 'crm', 'complete']) {
    const v = fixture(); const insert = v.f.store.insertUnique.bind(v.f.store);
    const update = v.f.store.conditionalUpdate.bind(v.f.store);
    v.f.store.insertUnique = async (table, ...args) => {
      const result = await insert(table, ...args);
      if ((boundary === 'claim' && table === v.config.tables.EVENT_RECEIPT_TABLE)
        || (boundary === 'configuration' && table === v.config.tables.CONFIGURATION_VERSION_TABLE)) throw new Error('synthetic lost response');
      return result;
    };
    v.f.store.conditionalUpdate = async (table, ...args) => {
      const result = await update(table, ...args);
      if ((boundary === 'deployment' && table === v.config.tables.DEPLOYMENT_TABLE)
        || (boundary === 'complete' && table === v.config.tables.EVENT_RECEIPT_TABLE)) throw new Error('synthetic lost response');
      return result;
    };
    if (boundary === 'crm') v.f.crm.recordConfigurationSuccessor = async () => { throw new Error('synthetic CRM ambiguity'); };
    const service = v.serviceFor(); await assert.rejects(service.succeed(v.request));
    const before = clone([...v.f.store.rows]); const writes = v.f.store.writes.length;
    if (boundary === 'complete') assert.equal((await service.succeed(v.request)).replayed, true);
    else await assert.rejects(service.succeed(v.request));
    assert.deepEqual([...v.f.store.rows], before); assert.equal(v.f.store.writes.length, writes);
  }
});

test('rekey or changed target release cannot mint a second successor; CAS races fail closed', async () => {
  const v = fixture(); await v.serviceFor().succeed(v.request);
  const id = successorIdentity(v.plan); const writes = v.f.store.writes.length;
  v.config.eventChainSecret = 'second-synthetic-chain-secret'.repeat(2);
  v.config.sourceRevision = 'c'.repeat(40); v.plan.target_revision = v.config.sourceRevision; v.sign();
  assert.deepEqual(successorIdentity(v.plan), id);
  await assert.rejects(v.serviceFor().succeed(v.request)); assert.equal(v.f.store.writes.length, writes);
  const race = fixture(); const update = race.f.store.conditionalUpdate.bind(race.f.store);
  race.f.store.conditionalUpdate = async (table, ...args) => {
    if (table === race.config.tables.DEPLOYMENT_TABLE) race.before.COUNT_VERSION += 1;
    return update(table, ...args);
  };
  await assert.rejects(race.serviceFor().succeed(race.request)); assert.equal(race.crmWrites, 0);
  assert.equal(race.before.ACTIVE_CONFIGURATION_VERSION_ID, race.plan.predecessor_configuration_id);
});

test('existing private signer supports the bounded successor without re-verifying old keys', () => {
  const v = fixture(); const envelope = { schemaVersion: 1, predecessorConfigurationRow: clone(v.old),
    predecessorDeployment: clone(v.before), request: { profile: PROFILE, intent: clone(v.request.intent) } };
  const context = { expectedRevision: v.config.sourceRevision, expectedOperatorHash: v.config.operatorIdHash,
    maxBodyBytes: 4096, now: v.f.now() };
  assert.equal(validateUnsignedSuccessorEnvelope(envelope, context).durableEvidenceAuthenticated, false);
  const signed = signFreeTestSuccessorPacket(envelope, { ...context, secret: Buffer.from(v.config.operatorVerificationSecret) });
  assert.deepEqual(signed.packet, v.request); assert.ok(signed.byteLength <= 4096);
  assert.throws(() => validateUnsignedSuccessorEnvelope(envelope, { ...context, maxBodyBytes: 512 }));
  assert.throws(() => projectInactiveSuccessor({ ...v.plan, predecessor_configuration_id: 'cfgsuccessor_' + 'a'.repeat(64) },
    v.old, v.before, new Date(v.f.now()).toISOString()));
});
