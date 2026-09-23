'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { createStagingFixture } = require('./helpers/configuration-staging-fixture');
const { createConfigurationStagingService, RECEIPT_KIND, RECONCILIATION_RECEIPT_KIND }
  = require('../lib/configuration-staging-service');
const { RECONCILIATION_PROFILE, RECONCILIATION_SIGNATURE_DOMAIN, canonicalReconciliationIntent,
  successorConfigurationRow, successorDeployment }
  = require('revenue_desk_call_gateway/lib/configuration-reconciliation');
const { routeFingerprint, routeFromRows } = require('revenue_desk_call_gateway/lib/approval-control');
const { loadDeployment, activeAt } = require('revenue_desk_call_gateway/lib/runtime-service');
const { createRouteControlService } = require('revenue_desk_call_gateway/lib/route-control-service');
const { validateConfiguration } = require('revenue_desk_call_gateway/lib/validation');
const { buildCrmPreTestSnapshot } = require('revenue_desk_call_gateway/lib/crm-report-baseline');
const { keyedDigest } = require('revenue_desk_call_gateway/lib/security');
const { deploymentFact } = require('revenue_desk_call_gateway/lib/analytics-outbox');
const { minimizeFact, deploymentReportBaseline }
  = require('../../../../revenue-desk-analytics/functions/analytics_sync/lib/facts');
const { crmBaselineFixture }
  = require('../../../../revenue-desk-analytics/functions/analytics_sync/test/helpers/crm-baseline-fixture');
const { syntheticPreparationInputs }
  = require('../../../../revenue-desk-release/test/fixtures/free-test-preparation');

const clone = (value) => structuredClone(value);

async function partialFixture({ priorApproval = false, reportBaseline = false, transportIds = false } = {}) {
  let preparationInput;
  if (transportIds) {
    const source = syntheticPreparationInputs()[0];
    const ids = Object.fromEntries(['leadId', 'accountId', 'contactId', 'dealId']
      .map((field) => [source.evidence.nativeConversion[field], `${source.evidence.nativeConversion[field]}00`]));
    const replace = (value) => Array.isArray(value) ? value.map(replace)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
        .map(([key, child]) => [key, replace(child)]))
        : typeof value === 'string' && Object.hasOwn(ids, value) ? ids[value] : value;
    preparationInput = replace(source);
  }
  const f = createStagingFixture(0, { preparationInput });
  if (transportIds) Object.assign(f.records.deal, { Test_Start_At: null, Test_End_At: null });
  if (reportBaseline) {
    const template = crmBaselineFixture();
    for (const field of Object.keys(template.metadata.fields).filter((key) => key !== 'Approved_Test_Route')) {
      f.records.deal[field] = template.deal[field];
    }
    f.records.deal.Estimated_Unanswered_Call_Rate = null;
    f.config.analyticsPartitionSecret = 'synthetic-reconciliation-report-partition-only';
    const candidate = JSON.parse(f.request.configurationRow.CONFIGURATION_JSON);
    const relationships = { leadId: f.lineage.originalLeadId, accountId: f.records.account.id,
      contactId: f.records.contact.id, dealId: f.records.deal.id, intakeSubmissionId: f.lineage.journeyId };
    const spec = { sourcePeriod: template.context.sourcePeriod, currency: 'USD', evidenceClass: 'customer_supplied_estimate' };
    Object.assign(f.request.review, {
      analyticsClientKey: keyedDigest(f.config.analyticsPartitionSecret, 'revenue-desk-analytics-client-v1', [candidate.clientId]),
      analyticsDeploymentKey: keyedDigest(f.config.analyticsPartitionSecret, 'revenue-desk-analytics-deployment-v1', [candidate.deploymentId]),
      reportBaseline: spec,
    });
    const context = { clientKey: f.request.review.analyticsClientKey, deploymentKey: f.request.review.analyticsDeploymentKey,
      configurationVersionId: f.request.configurationRow.CONFIGURATION_VERSION_ID,
      configurationVersion: f.request.form2ConfigurationVersion, environment: 'development', relationships,
      crmModifiedAt: f.records.deal.Modified_Time, approvedTestRoute: f.records.deal.Approved_Test_Route, ...spec };
    const metadata = { ...template.metadata, observedAt: new Date(f.now()).toISOString() };
    const capture = { deal: Object.fromEntries(Object.keys(template.deal).map((key) => [key, f.records.deal[key]])),
      context, metadata, evidence: { source: 'crm_selected_field_readback',
        clientKey: context.clientKey, deploymentKey: context.deploymentKey,
        configurationVersionId: context.configurationVersionId, configurationVersion: context.configurationVersion,
        environment: 'development', relationships, crmModifiedAt: context.crmModifiedAt,
        readAt: new Date(f.now()).toISOString(), capturedAt: f.request.intent.evidence_observed_at,
        sourcePeriod: spec.sourcePeriod, evidenceClass: spec.evidenceClass } };
    const baseline = buildCrmPreTestSnapshot(capture, { now: f.now() });
    f.request.configurationRow.CONFIGURATION_JSON = JSON.stringify(validateConfiguration({ ...candidate, reportBaseline: baseline }));
    f.sign();
    f.service = createConfigurationStagingService({ config: f.config, store: f.store, crm: f.crm,
      core: f.core, sourceReader: f.sourceReader, conversionReader: f.conversionReader, now: f.now,
      metadataReader: { async readMetadata() { return clone(metadata); } } });
  }
  if (priorApproval) await f.core.approve(f.coreApprovalCommand);
  const insert = f.store.insertUnique.bind(f.store);
  f.store.insertUnique = async (table, ...args) => {
    if (table === f.config.tables.DEPLOYMENT_TABLE) throw new Error('Synthetic required-start rejection');
    return insert(table, ...args);
  };
  await assert.rejects(f.service.stage(f.request));
  f.store.insertUnique = insert;
  const originalReceipt = f.store.rowsFor(f.config.tables.EVENT_RECEIPT_TABLE)
    .find((row) => row.RECEIPT_KIND === RECEIPT_KIND);
  const originalRow = f.store.rowsFor(f.config.tables.CONFIGURATION_VERSION_TABLE)[0];
  const original = JSON.parse(originalReceipt.EVENT_DATA_JSON);
  const preserved = { receipt: clone(originalReceipt), configuration: clone(originalRow) };
  f.advance(900_001);
  const config = { ...f.config, sourceRevision: 'f'.repeat(40) };
  const service = createConfigurationStagingService({ config, store: f.store, crm: f.crm, core: f.core,
    sourceReader: f.sourceReader, conversionReader: f.conversionReader, now: f.now });
  const configuration = successorConfigurationRow(f.request, originalReceipt.EVENT_KEY, config.sourceRevision);
  const deployment = successorDeployment(f.request, originalReceipt.EVENT_KEY, config.sourceRevision);
  const envelope = { profile: RECONCILIATION_PROFILE, originalRequest: clone(f.request),
    intent: { schema_version: 1, action: 'reconcile_configuration',
      original_claim_key: originalReceipt.EVENT_KEY,
      original_claim_fingerprint: originalReceipt.PAYLOAD_FINGERPRINT,
      original_request_fingerprint: original.requestFingerprint,
      original_configuration_version_id: original.configurationVersionId,
      original_configuration_fingerprint: original.configurationFingerprint,
      original_source_revision: f.config.sourceRevision, target_source_revision: config.sourceRevision,
      deployment_id: original.deploymentId, configuration_version_id: configuration.CONFIGURATION_VERSION_ID,
      route_fingerprint: routeFingerprint(routeFromRows(deployment, configuration)),
      expected_receipt_version: 0, operator_id_hash: config.operatorIdHash,
      evidence_observed_at: new Date(f.now()).toISOString(), requested_at: new Date(f.now()).toISOString() },
    signature: '' };
  function sign(value = envelope, domain = RECONCILIATION_SIGNATURE_DOMAIN) {
    value.signature = `v1=${crypto.createHmac('sha256', config.operatorVerificationSecret)
      .update(domain).update(canonicalReconciliationIntent(value.intent)).digest('hex')}`;
    return value;
  }
  sign();
  return { f, config, service, envelope, sign, originalReceipt, originalRow, original, preserved };
}

function assertOriginalPreserved(value) {
  assert.deepEqual(value.originalReceipt, value.preserved.receipt);
  assert.deepEqual(value.originalRow, value.preserved.configuration);
}

test('reconciliation consumes Catalyst bigint-string readback through the real route boundary', async () => {
  const fields = ['BINDING_VERSION', 'MONITOR_AGENT_VERSION', 'CALL_LIMIT'];
  for (const selected of [[], ...fields.map((field) => [field]), fields]) {
    const value = await partialFixture(); const { f, service, envelope, config } = value;
    const unique = f.store.unique.bind(f.store);
    // Fake persistence serializes selected BigInt columns as Catalyst does;
    // the staging service and route parser remain the real implementation.
    f.store.unique = async (...args) => {
      const row = await unique(...args);
      if (row && args[0] === config.tables.DEPLOYMENT_TABLE) {
        for (const field of [...selected, 'COUNT_VERSION', 'HANDLED_COUNT']) row[field] = String(row[field]);
      }
      return row;
    };
    const writes = f.store.writes.length;
    const result = await service.reconcile(envelope);
    assert.equal(result.state, 'StagedInactive'); assert.equal(result.active, false);
    assert.equal(f.store.writes.length - writes, 4); assert.equal(f.stagingWrites, 1);
    const recovery = f.store.rowsFor(config.tables.EVENT_RECEIPT_TABLE)
      .find((row) => row.RECEIPT_KIND === RECONCILIATION_RECEIPT_KIND);
    assert.equal(recovery.STATUS, 'Completed'); assert.equal(recovery.RECEIPT_VERSION, 1);
    const deployment = await f.store.unique(config.tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', result.deploymentId);
    for (const field of selected) assert.equal(typeof deployment[field], 'string');
    assert.equal(deployment.ACTUAL_START_AT, null); assert.equal(deployment.ACTIVATION_EVENT_KEY, null);
    const beforeReplay = clone([...f.store.rows.entries()]); const beforeWrites = f.store.writes.length;
    assert.equal((await service.reconcile(envelope)).replayed, true);
    assert.deepEqual([...f.store.rows.entries()], beforeReplay);
    assert.equal(f.store.writes.length, beforeWrites); assert.equal(f.stagingWrites, 1);
    assertOriginalPreserved(value);
  }
});

test('partial staging reconciles once to an inactive current-release successor and approval source', async () => {
  for (const priorApproval of [false, true]) {
    const value = await partialFixture({ priorApproval }); const { f, service, envelope, config } = value;
    const beforeWrites = f.store.writes.length;
    const result = await service.reconcile(envelope);
    assert.deepEqual(result, { state: 'StagedInactive', reconciled: true, replayed: false,
      approved: false, active: false, configurationVersionId: envelope.intent.configuration_version_id,
      deploymentId: envelope.intent.deployment_id });
    assertOriginalPreserved(value);
    assert.equal(f.store.writes.length - beforeWrites, 4); assert.equal(f.stagingWrites, 1);
    const [deployment] = f.store.rowsFor(config.tables.DEPLOYMENT_TABLE);
    const configurationRow = f.store.rowsFor(config.tables.CONFIGURATION_VERSION_TABLE)
      .find((row) => row.CONFIGURATION_VERSION_ID === result.configurationVersionId);
    assert.equal(configurationRow.SOURCE_REVISION, config.sourceRevision);
    assert.equal(configurationRow.CONFIGURATION_VERSION, value.originalRow.CONFIGURATION_VERSION);
    assert.equal(configurationRow.CONFIGURATION_JSON, value.originalRow.CONFIGURATION_JSON);
    assert.equal(configurationRow.ACTIVATED_AT, null);
    assert.equal(deployment.DEPLOYMENT_ID, value.original.deploymentId);
    assert.equal(deployment.DEPLOYMENT_KEY, value.original.deploymentKey);
    assert.equal(deployment.TEST_STATUS, 'Ready for Approval');
    assert.equal(deployment.APPROVED_START_AT, null); assert.equal(deployment.ACTUAL_START_AT, null);
    const authority = await service.assertApprovalSource({ dealId: envelope.originalRequest.dealId,
      journeyId: envelope.originalRequest.journeyId, deploymentId: result.deploymentId,
      configurationVersionId: result.configurationVersionId },
    { deployment, configurationRow, deal: f.records.deal });
    assert.deepEqual(authority, { configurationStaged: true,
      priorCoreApproval: priorApproval ? {
        configurationVersionId: value.original.priorApproval.configurationVersionId,
        approvedAt: value.original.priorApproval.approvedAt } : null });
    const loaded = await loadDeployment(f.store, deployment, { ...config,
      sharedAgentVersion: config.stagingAgentVersion, authorizationEventSecret: config.eventChainSecret });
    assert.equal(loaded.approvalEvidenceValidated, false);
    assert.equal(loaded.activationEvidenceValidated, false);
    assert.throws(() => activeAt(loaded, f.now()), { code: 'CONFIGURATION_UNAVAILABLE' });
    const [recovery] = f.store.rowsFor(config.tables.EVENT_RECEIPT_TABLE)
      .filter((row) => row.RECEIPT_KIND === RECONCILIATION_RECEIPT_KIND);
    assert.equal(recovery.STATUS, 'Completed'); assert.equal(recovery.RELATED_EVENT_KEY, value.originalReceipt.EVENT_KEY);
    assert.doesNotMatch(recovery.EVENT_DATA_JSON, /v1=|synthetic-owner-signing|example\.invalid/);
    assert.ok(Buffer.byteLength(recovery.EVENT_DATA_JSON) <= 10_000);
  }
});

test('recovered chain passes the real separate approval service without activation or a test clock', async () => {
  for (const priorApproval of [false, true]) {
    const value = await partialFixture({ priorApproval, transportIds: true });
    const { f, config, service, envelope } = value;
    const staged = await service.reconcile(envelope);
    let approvals = 0; let providerCalls = 0;
    f.crm.recordApproval = async (id, input) => {
      assert.equal(id, f.records.deal.id); assert.deepEqual(input.expectedDeal, f.records.deal);
      assert.equal(input.configurationStaged, true); assert.deepEqual(input.priorCoreApproval,
        priorApproval ? { configurationVersionId: value.original.priorApproval.configurationVersionId,
          approvedAt: value.original.priorApproval.approvedAt } : null);
      approvals += 1;
      Object.assign(f.records.deal, { Test_Status: 'Scheduled', Go_Live_Approval_Status: 'Approved',
        Go_Live_Approved_At: input.approvedAt, Approved_Deployment_Record_ID: input.deploymentId,
        Approved_Configuration_Version: input.configurationVersionId });
      return clone(f.records.deal);
    };
    const provider = new Proxy({}, { get() { return async () => {
      providerCalls += 1; throw new Error('Provider execution is prohibited in this synthetic approval');
    }; } });
    const control = createRouteControlService({ config, store: f.store, crm: f.crm, provider,
      configurationStaging: service, now: f.now });
    const approved = await control.approve({ dealId: f.records.deal.id, journeyId: f.lineage.journeyId,
      deploymentId: staged.deploymentId, configurationVersionId: staged.configurationVersionId,
      idempotencyKey: '00000000-0000-4000-8000-000000000001' });
    assert.equal(approved.action, 'approve'); assert.equal(approved.replayed, false);
    assert.equal(approvals, 1); assert.equal(providerCalls, 0);
    const deployment = await f.store.unique(config.tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', staged.deploymentId);
    assert.equal(deployment.TEST_STATUS, 'Scheduled'); assert.equal(deployment.GO_LIVE_APPROVAL_STATUS, 'Approved');
    assert.equal(deployment.APPROVED_CONFIGURATION_VERSION_ID, staged.configurationVersionId);
    for (const field of ['APPROVED_START_AT', 'ACTUAL_START_AT', 'EXPIRES_AT', 'ACTIVATION_EVENT_KEY']) {
      assert.equal(deployment[field], null);
    }
    const approval = await f.store.unique(config.tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', deployment.APPROVAL_EVENT_KEY);
    assert.equal(approval.SOURCE_REVISION, config.sourceRevision); assert.equal(approval.STATUS, 'Completed');
    assert.equal(approval.CONFIGURATION_VERSION_ID, staged.configurationVersionId);
    const configuration = await f.store.unique(config.tables.CONFIGURATION_VERSION_TABLE,
      'CONFIGURATION_VERSION_ID', staged.configurationVersionId);
    assert.equal(configuration.ACTIVATED_AT, null);
    assert.equal(f.records.deal.Test_Start_At, null); assert.equal(f.records.deal.Test_End_At, null);
    const loaded = await loadDeployment(f.store, deployment, { ...config,
      sharedAgentVersion: config.stagingAgentVersion, authorizationEventSecret: config.eventChainSecret });
    assert.equal(loaded.approvalEvidenceValidated, true); assert.equal(loaded.activationEvidenceValidated, false);
    assert.throws(() => activeAt(loaded, f.now()), { code: 'CONFIGURATION_UNAVAILABLE' });
    assertOriginalPreserved(value);
  }
});

test('recovery preserves captured CRM baseline and binds its successor through the actual analytics consumer', async () => {
  const value = await partialFixture({ reportBaseline: true }); const { f, config, service, envelope } = value;
  const staged = await service.reconcile(envelope);
  const deployment = await f.store.unique(config.tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', staged.deploymentId);
  const loaded = await loadDeployment(f.store, deployment, { ...config,
    sharedAgentVersion: config.stagingAgentVersion, authorizationEventSecret: config.eventChainSecret });
  const original = JSON.parse(value.originalRow.CONFIGURATION_JSON);
  const expected = clone(original); expected.reportBaseline.configurationVersionId = staged.configurationVersionId;
  assert.deepEqual(loaded.configuration, expected);
  assert.equal(expected.reportBaseline.values.monthlyInboundCalls, 140);
  assert.equal(expected.reportBaseline.values.estimatedUnansweredCallRate, null);
  // The real consumer correctly refuses an unstarted baseline. Only this local
  // projection simulates later completion; no persisted deployment is activated.
  assert.throws(() => deploymentFact(config, loaded, deployment), { code: 'ANALYTICS_FACT_INVALID' });
  const simulatedTerminal = { ...deployment, TEST_STATUS: 'Completed',
    ACTUAL_START_AT: new Date(f.now()).toISOString(), EXPIRES_AT: new Date(f.now() + 604_800_000).toISOString(),
    STOPPED_AT: new Date(f.now() + 604_800_000).toISOString(), STOP_REASON: 'expired',
    UPDATED_AT: new Date(f.now() + 604_800_000).toISOString() };
  const fact = minimizeFact('deployment', deploymentFact(config, loaded, simulatedTerminal));
  const reported = deploymentReportBaseline(fact);
  assert.deepEqual(reported.values, original.reportBaseline.values);
  assert.deepEqual(reported.sourcePeriod, original.reportBaseline.sourcePeriod);
  assert.equal(reported.capturedAt, original.reportBaseline.capturedAt);
  assert.equal(reported.sourceModifiedAt, original.reportBaseline.sourceModifiedAt);
  assert.equal(fact.CONFIGURATION_VERSION, staged.configurationVersionId);
  const stale = clone(loaded); stale.configuration.reportBaseline.configurationVersionId = value.original.configurationVersionId;
  assert.throws(() => deploymentFact(config, stale, simulatedTerminal), { code: 'INVALID_SCHEMA' });
  assert.equal(deployment.ACTUAL_START_AT, null); assertOriginalPreserved(value);
});

test('completed recovery replays after expiry without effects; ordinary staging never resumes original', async () => {
  const value = await partialFixture(); const { f, service, envelope } = value;
  const result = await service.reconcile(envelope);
  const before = clone([...f.store.rows.entries()]); const writes = f.store.writes.length;
  f.advance(86_400_000);
  assert.deepEqual(await service.reconcile(envelope), { ...result, replayed: true });
  await assert.rejects(f.service.stage(f.request), { code: 'CONFIGURATION_STAGING_RECONCILIATION_REQUIRED' });
  await assert.rejects(service.stage(f.request), { code: 'CONFIGURATION_STAGING_REVIEW_INVALID' });
  assert.deepEqual([...f.store.rows.entries()], before);
  assert.equal(f.store.writes.length, writes); assert.equal(f.stagingWrites, 1);
  assertOriginalPreserved(value);
});

test('wrong signature domains, source identities, expired review and original tampering reject before recovery writes', async () => {
  for (const mutate of [
    (v) => { v.envelope.signature = v.envelope.originalRequest.signature; },
    (v) => { v.sign(v.envelope, 'revenue-desk-approval-intent-v1\0'); },
    (v) => { v.envelope.originalRequest.signature = `v1=${'0'.repeat(64)}`; },
    (v) => { v.envelope.intent.original_claim_fingerprint = '0'.repeat(64); v.sign(); },
    (v) => { v.envelope.intent.original_request_fingerprint = '0'.repeat(64); v.sign(); },
    (v) => { v.envelope.intent.original_configuration_fingerprint = `config_${'0'.repeat(64)}`; v.sign(); },
    (v) => { v.envelope.intent.original_source_revision = 'd'.repeat(40); v.sign(); },
    (v) => { v.envelope.intent.target_source_revision = 'd'.repeat(40); v.sign(); },
    (v) => { v.envelope.intent.operator_id_hash = `operator_${'0'.repeat(64)}`; v.sign(); },
    (v) => { v.envelope.intent.route_fingerprint = `route_${'0'.repeat(64)}`; v.sign(); },
    (v) => { v.f.advance(300_001); },
    (v) => { v.originalReceipt.PAYLOAD_FINGERPRINT = '0'.repeat(64); },
    (v) => { v.originalReceipt.STATUS = 'Completed'; },
    (v) => { v.originalRow.DEPLOYMENT_ID = `cfgdeploy_${'9'.repeat(64)}`; },
    (v) => { v.originalRow.SOURCE_REVISION = 'd'.repeat(40); },
    (v) => { v.originalRow.ACTIVATED_AT = new Date(v.f.now()).toISOString(); },
    (v) => { v.originalRow.CONFIGURATION_JSON += ' '; },
    (v) => { v.f.records.deal.Alert_Recipient_Email = 'other@example.invalid'; },
    (v) => { v.f.records.account.Normal_Business_Hours = 'Changed'; },
    (v) => { v.f.nativeConversion.accountId = '999999999'; },
    (v) => { v.f.bundle.session.JOURNEY_BINDING_DIGEST = '0'.repeat(64); },
    (v) => { v.f.records.deal.Deployment_Record_ID = v.original.deploymentId; },
  ]) {
    const value = await partialFixture(); mutate(value);
    const before = clone([...value.f.store.rows.entries()]); const writes = value.f.store.writes.length;
    await assert.rejects(value.service.reconcile(value.envelope));
    assert.deepEqual([...value.f.store.rows.entries()], before);
    assert.equal(value.f.store.writes.length, writes); assert.equal(value.f.stagingWrites, 0);
  }
});

test('existing successor or any deployment ownership collision cannot be adopted', async () => {
  for (const collision of ['successor', 'deploymentKey', 'deploymentId', 'number']) {
    const v = await partialFixture();
    if (collision === 'successor') v.f.store.rowsFor(v.config.tables.CONFIGURATION_VERSION_TABLE).push({
      CONFIGURATION_VERSION_ID: v.envelope.intent.configuration_version_id });
    else v.f.store.rowsFor(v.config.tables.DEPLOYMENT_TABLE).push({
      DEPLOYMENT_KEY: collision === 'deploymentKey' ? v.original.deploymentKey : 'synthetic_other_key',
      DEPLOYMENT_ID: collision === 'deploymentId' ? v.original.deploymentId : 'synthetic_other_deployment',
      NUMBER_LOOKUP_HASH: collision === 'number' ? v.f.request.deployment.NUMBER_LOOKUP_HASH : 'synthetic_other_number' });
    const before = clone([...v.f.store.rows.entries()]); const writes = v.f.store.writes.length;
    await assert.rejects(v.service.reconcile(v.envelope));
    assert.deepEqual([...v.f.store.rows.entries()], before);
    assert.equal(v.f.store.writes.length, writes); assert.equal(v.f.stagingWrites, 0);
  }
});

test('interrupted recovery at each side-effect boundary is durable and never resumes', async () => {
  for (const boundary of ['claim_after', 'configuration_before', 'configuration_after',
    'deployment_before', 'deployment_after', 'crm_before', 'crm_after', 'completion_before']) {
    const v = await partialFixture(); const { f, service, envelope } = v;
    const insert = f.store.insertUnique.bind(f.store);
    f.store.insertUnique = async (table, ...args) => {
      const kind = table === v.config.tables.CONFIGURATION_VERSION_TABLE ? 'configuration'
        : table === v.config.tables.DEPLOYMENT_TABLE ? 'deployment' : 'claim';
      if (boundary === `${kind}_before`) throw new Error('Synthetic boundary rejection');
      const result = await insert(table, ...args);
      if (boundary === `${kind}_after`) throw new Error('Synthetic ambiguous insertion');
      return result;
    };
    const record = f.crm.recordConfigurationStaging;
    f.crm.recordConfigurationStaging = async (...args) => {
      if (boundary === 'crm_before') throw new Error('Synthetic CRM rejection');
      const result = await record(...args);
      if (boundary === 'crm_after') throw new Error('Synthetic ambiguous CRM write');
      return result;
    };
    if (boundary === 'completion_before') f.store.conditionalUpdate = async () => { throw new Error('Synthetic CAS rejection'); };
    await assert.rejects(service.reconcile(envelope));
    const recovery = f.store.rowsFor(v.config.tables.EVENT_RECEIPT_TABLE)
      .find((row) => row.RECEIPT_KIND === RECONCILIATION_RECEIPT_KIND);
    assert.equal(recovery.STATUS, 'Processing'); assert.equal(recovery.ATTEMPT_COUNT, 1);
    const before = clone([...f.store.rows.entries()]); const writes = f.store.writes.length; const crmWrites = f.stagingWrites;
    await assert.rejects(service.reconcile(envelope), { code: 'CONFIGURATION_STAGING_RECONCILIATION_REQUIRED' });
    assert.deepEqual([...f.store.rows.entries()], before);
    assert.equal(f.store.writes.length, writes); assert.equal(f.stagingWrites, crmWrites);
    assertOriginalPreserved(v);
  }
});

test('ambiguous completed CAS reconciles by exact read-only replay, never another intended effect', async () => {
  const v = await partialFixture(); const update = v.f.store.conditionalUpdate.bind(v.f.store);
  v.f.store.conditionalUpdate = async (...args) => { await update(...args); throw new Error('Synthetic lost completion response'); };
  await assert.rejects(v.service.reconcile(v.envelope));
  const before = clone([...v.f.store.rows.entries()]); const writes = v.f.store.writes.length;
  assert.equal((await v.service.reconcile(v.envelope)).replayed, true);
  assert.deepEqual([...v.f.store.rows.entries()], before);
  assert.equal(v.f.store.writes.length, writes); assert.equal(v.f.stagingWrites, 1);
  assertOriginalPreserved(v);
});

test('concurrent differently signed intents share one recovery allocation across releases', async () => {
  const v = await partialFixture(); const { f, envelope, service } = v;
  const second = clone(envelope); f.advance(1);
  second.intent.requested_at = new Date(f.now()).toISOString(); v.sign(second);
  const insert = f.store.insertUnique.bind(f.store); let pending = Promise.resolve();
  f.store.insertUnique = (...args) => {
    const result = pending.then(() => insert(...args)); pending = result.catch(() => {}); return result;
  };
  const results = await Promise.allSettled([service.reconcile(envelope), service.reconcile(second)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(f.store.rowsFor(v.config.tables.CONFIGURATION_VERSION_TABLE).length, 2);
  assert.equal(f.store.rowsFor(v.config.tables.DEPLOYMENT_TABLE).length, 1);
  assert.equal(f.store.rowsFor(v.config.tables.EVENT_RECEIPT_TABLE)
    .filter((row) => row.RECEIPT_KIND === RECONCILIATION_RECEIPT_KIND).length, 1);
  assert.equal(f.stagingWrites, 1); assertOriginalPreserved(v);
  const otherRevision = { ...v.config, sourceRevision: 'a'.repeat(40) };
  const otherService = createConfigurationStagingService({ config: otherRevision, store: f.store, crm: f.crm,
    core: f.core, sourceReader: f.sourceReader, conversionReader: f.conversionReader, now: f.now });
  const next = clone(envelope); next.intent.target_source_revision = otherRevision.sourceRevision;
  const row = successorConfigurationRow(next.originalRequest, next.intent.original_claim_key, otherRevision.sourceRevision);
  const deployment = successorDeployment(next.originalRequest, next.intent.original_claim_key, otherRevision.sourceRevision);
  next.intent.route_fingerprint = routeFingerprint(routeFromRows(deployment, row)); v.sign(next);
  const before = clone([...f.store.rows.entries()]); const writes = f.store.writes.length;
  await assert.rejects(otherService.reconcile(next));
  assert.deepEqual([...f.store.rows.entries()], before); assert.equal(f.store.writes.length, writes);
});

test('completed recovery approval and replay reject current drift or altered chain evidence', async () => {
  for (const [index, mutate] of [
    (v, state) => { state.configurationRow.CONFIGURATION_JSON += ' '; },
    (v, state) => { state.configurationRow.DEPLOYMENT_ID = `cfgdeploy_${'9'.repeat(64)}`; },
    (v, state) => { state.configurationRow.SOURCE_REVISION = 'a'.repeat(40); },
    (v, state) => { state.deployment.ACTIVE_CONFIGURATION_VERSION_ID = v.original.configurationVersionId; },
    (v) => { v.originalRow.CREATED_AT = new Date(v.f.now()).toISOString(); },
    (v) => { v.originalReceipt.PAYLOAD_FINGERPRINT = '0'.repeat(64); },
    (v) => { v.f.records.deal.Alert_Recipient_Email = 'changed@example.invalid'; },
    (v) => { v.f.bundle.session.JOURNEY_BINDING_DIGEST = '0'.repeat(64); },
    (v) => { v.f.store.rowsFor(v.config.tables.EVENT_RECEIPT_TABLE)
      .find((row) => row.RECEIPT_KIND === RECONCILIATION_RECEIPT_KIND).EVENT_DATA_JSON += ' '; },
  ].entries()) {
    const v = await partialFixture(); const result = await v.service.reconcile(v.envelope);
    const state = { deployment: v.f.store.rowsFor(v.config.tables.DEPLOYMENT_TABLE)[0],
      configurationRow: v.f.store.rowsFor(v.config.tables.CONFIGURATION_VERSION_TABLE)[1], deal: v.f.records.deal };
    mutate(v, state); const before = clone([...v.f.store.rows.entries()]); const writes = v.f.store.writes.length;
    await assert.rejects(v.service.assertApprovalSource({ dealId: v.f.request.dealId,
      journeyId: v.f.request.journeyId, deploymentId: result.deploymentId,
      configurationVersionId: result.configurationVersionId }, state), `Approval mutation ${index}`);
    await assert.rejects(v.service.reconcile(v.envelope), `Replay mutation ${index}`);
    assert.deepEqual([...v.f.store.rows.entries()], before); assert.equal(v.f.store.writes.length, writes);
  }
});

test.after(() => { assert.deepEqual(guard.blocked, []); guard.restore(); });
