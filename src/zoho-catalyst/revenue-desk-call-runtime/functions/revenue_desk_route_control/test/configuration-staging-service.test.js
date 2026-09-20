'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStagingFixture, SyntheticStore } = require('./helpers/configuration-staging-fixture');
const { RECEIPT_KIND } = require('../lib/configuration-staging-service');
const { createConfigurationStagingService } = require('../lib/configuration-staging-service');
const { validateConfiguration } = require('revenue_desk_call_gateway/lib/validation');
const { buildCrmPreTestSnapshot } = require('revenue_desk_call_gateway/lib/crm-report-baseline');
const { crmBaselineFixture }
  = require('../../../../revenue-desk-analytics/functions/analytics_sync/test/helpers/crm-baseline-fixture');

test('authenticated submitted setup creates immutable reviewed content and inactive deployment exactly once', async () => {
  const f = createStagingFixture();
  assert.equal(f.store.rowsFor(f.config.tables.DEPLOYMENT_TABLE).length, 0);
  assert.equal(f.store.rowsFor(f.config.tables.CONFIGURATION_VERSION_TABLE).length, 0);
  const result = await f.service.stage(f.request);
  assert.equal(result.state, 'StagedInactive'); assert.equal(result.active, false); assert.equal(result.approved, false);
  const [row] = f.store.rowsFor(f.config.tables.CONFIGURATION_VERSION_TABLE);
  assert.equal(JSON.parse(row.CONFIGURATION_JSON).approved, true);
  const [deployment] = f.store.rowsFor(f.config.tables.DEPLOYMENT_TABLE);
  assert.equal(deployment.TEST_STATUS, 'Ready for Approval');
  assert.equal(deployment.GO_LIVE_APPROVAL_STATUS, 'Pending Internal Approval');
  assert.equal(deployment.ACTUAL_START_AT, null); assert.equal(deployment.EXPIRES_AT, null);
  assert.equal(deployment.APPROVAL_EVENT_KEY, null);
  assert.equal(f.records.deal.Test_Status, 'Setup Pending'); assert.equal(f.stagingWrites, 1);
  assert.deepEqual(await f.service.assertApprovalSource({ dealId: f.request.dealId,
    journeyId: f.request.journeyId, deploymentId: deployment.DEPLOYMENT_ID,
    configurationVersionId: row.CONFIGURATION_VERSION_ID },
  { deployment, configurationRow: row, deal: f.records.deal }),
  { configurationStaged: true, priorCoreApproval: null });
  const writes = f.store.writes.length;
  const replay = await f.service.stage(f.request);
  assert.equal(replay.replayed, true); assert.equal(f.store.writes.length, writes); assert.equal(f.stagingWrites, 1);
  const receipt = f.store.rowsFor(f.config.tables.EVENT_RECEIPT_TABLE).find((r) => r.RECEIPT_KIND === RECEIPT_KIND);
  assert.equal(receipt.STATUS, 'Completed');
  assert.ok(!receipt.EVENT_DATA_JSON.includes('example.invalid'));
  assert.ok(!receipt.EVENT_DATA_JSON.includes(f.config.operatorVerificationSecret));
});

test('prior core approval remains immutable and needs separate final configuration approval', async () => {
  const f = createStagingFixture();
  await f.core.approve(f.coreApprovalCommand);
  const before = structuredClone(f.store.rowsFor(f.config.tables.EVENT_RECEIPT_TABLE));
  const approvedAt = f.records.deal.Go_Live_Approved_At;
  await f.service.stage(f.request);
  assert.deepEqual(f.store.rowsFor(f.config.tables.EVENT_RECEIPT_TABLE).filter((r) => r.RECEIPT_KIND !== RECEIPT_KIND), before);
  assert.equal(f.records.deal.Approved_Configuration_Version, f.request.form2ConfigurationVersion);
  assert.equal(f.records.deal.Go_Live_Approved_At, approvedAt);
  const [deployment] = f.store.rowsFor(f.config.tables.DEPLOYMENT_TABLE);
  const [configurationRow] = f.store.rowsFor(f.config.tables.CONFIGURATION_VERSION_TABLE);
  assert.deepEqual(await f.service.assertApprovalSource({ dealId: f.request.dealId, journeyId: f.request.journeyId,
    deploymentId: deployment.DEPLOYMENT_ID, configurationVersionId: configurationRow.CONFIGURATION_VERSION_ID },
  { deployment, configurationRow, deal: f.records.deal }),
  { configurationStaged: true, priorCoreApproval: {
    configurationVersionId: f.request.form2ConfigurationVersion, approvedAt } });
  assert.equal(deployment.APPROVAL_EVENT_KEY, null); assert.equal(deployment.ACTUAL_START_AT, null);
});

test('expired exact completed staging replays read-only after request and evidence freshness windows', async () => {
  for (const priorCoreApproval of [false, true]) {
    const f = createStagingFixture();
    if (priorCoreApproval) await f.core.approve(f.coreApprovalCommand);
    const result = await f.service.stage(f.request);
    const before = structuredClone([...f.store.rows.entries()]);
    const writes = f.store.writes.length; const crmWrites = f.stagingWrites;
    f.advance(900001);
    assert.deepEqual(await f.service.stage(f.request), { ...result, replayed: true });
    assert.equal(f.store.writes.length, writes); assert.equal(f.stagingWrites, crmWrites);
    assert.deepEqual([...f.store.rows.entries()], before);
  }
});

test('expired new staging cannot claim or write state', async () => {
  const f = createStagingFixture(); f.advance(300001);
  await assert.rejects(f.service.stage(f.request), { code: 'CONFIGURATION_STAGING_REVIEW_INVALID' });
  assert.equal(f.store.writes.length, 0); assert.equal(f.stagingWrites, 0);
});

test('expired completed replay still authenticates the exact owner request and rejects current drift', async () => {
  for (const mutate of [
    (f) => { f.request.signature = `v1=${'0'.repeat(64)}`; },
    (f) => { f.request.intent.operator_id_hash = `operator_${'9'.repeat(64)}`; f.sign(); },
    (f) => { f.request.intent.requested_at = new Date(f.now()).toISOString(); f.sign(); },
    (f) => { f.records.deal.Alert_Recipient_Email = 'changed@example.invalid'; },
    (f) => { f.records.account.Normal_Business_Hours = 'Changed schedule'; },
    (f) => { f.bundle.session.JOURNEY_BINDING_DIGEST = '0'.repeat(64); },
    (f) => { f.store.rowsFor(f.config.tables.CONFIGURATION_VERSION_TABLE)[0].CONFIGURATION_JSON += ' '; },
    (f) => { f.store.rowsFor(f.config.tables.DEPLOYMENT_TABLE)[0].TEST_STATUS = 'Live'; },
  ]) {
    const f = createStagingFixture(); await f.service.stage(f.request); f.advance(900001); mutate(f);
    const before = structuredClone([...f.store.rows.entries()]);
    const writes = f.store.writes.length; const crmWrites = f.stagingWrites;
    await assert.rejects(f.service.stage(f.request));
    assert.equal(f.store.writes.length, writes); assert.equal(f.stagingWrites, crmWrites);
    assert.deepEqual([...f.store.rows.entries()], before);
  }
});

test('expired partial staging requires reconciliation and never resumes writes', async () => {
  const f = createStagingFixture(); const insert = f.store.insertUnique.bind(f.store);
  f.store.insertUnique = async (table, ...args) => {
    if (table === f.config.tables.DEPLOYMENT_TABLE) throw new Error('synthetic interruption');
    return insert(table, ...args);
  };
  await assert.rejects(f.service.stage(f.request));
  const before = structuredClone([...f.store.rows.entries()]);
  const writes = f.store.writes.length; f.advance(900001);
  await assert.rejects(f.service.stage(f.request), { code: 'CONFIGURATION_STAGING_RECONCILIATION_REQUIRED' });
  assert.equal(f.store.writes.length, writes); assert.equal(f.stagingWrites, 0);
  assert.deepEqual([...f.store.rows.entries()], before);
});

test('ordinary approval and activation signature domains do not authorize content creation', async () => {
  for (const domain of ['revenue-desk-approval-intent-v1\0', 'revenue-desk-activation-intent-v1\0']) {
    const f = createStagingFixture(); f.sign(domain);
    await assert.rejects(f.service.stage(f.request), { code: 'INVALID_APPROVAL_SIGNATURE' });
    assert.equal(f.store.writes.length, 0);
  }
});

test('wrong owner, stale review, edited recipient or evidence and unauthorized fields fail before writes', async () => {
  const changes = [
    (f) => { f.request.intent.operator_id_hash = `operator_${'9'.repeat(64)}`; f.sign(); },
    (f) => { f.advance(300001); },
    (f) => { f.records.deal.Alert_Recipient_Email = 'changed@example.invalid'; },
    (f) => { f.bundle.session.JOURNEY_BINDING_DIGEST = '0'.repeat(64); },
    (f) => { f.request.reviewerName = 'Gabriel'; },
    (f) => { f.nativeConversion.accountId = '999999999'; },
    (f) => { f.nativeConversion.convertedAt = '2026-09-09T11:46:00.000Z'; },
    (f) => { f.records.contact.Account_Name.id = '999999999'; },
    (f) => { f.request.configurationRow.CONFIGURATION_JSON += ' '; f.sign(); },
    (f) => { f.records.deal.Approved_Test_Route = 'Both'; },
    (f) => { f.request.deployment.MONITOR_AGENT_ID = 'wrong_agent'; f.sign(); },
  ];
  for (const change of changes) {
    const f = createStagingFixture(); change(f);
    await assert.rejects(f.service.stage(f.request)); assert.equal(f.store.writes.length, 0);
  }
});

test('two businesses preserve configuration recipient number and durable claim ownership', async () => {
  const store = new SyntheticStore(); const a = createStagingFixture(0, { store }); const b = createStagingFixture(1, { store });
  await a.service.stage(a.request); await b.service.stage(b.request);
  assert.equal(store.rowsFor(a.config.tables.DEPLOYMENT_TABLE).length, 2);
  assert.notEqual(a.request.configurationRow.CONFIGURATION_JSON, b.request.configurationRow.CONFIGURATION_JSON);
  const spoof = createStagingFixture(0, { store });
  spoof.request.configurationRow = b.request.configurationRow; spoof.request.deployment = b.request.deployment; spoof.sign();
  await assert.rejects(spoof.service.stage(spoof.request));
  assert.equal(store.rowsFor(a.config.tables.CONFIGURATION_VERSION_TABLE).length, 2);
});

test('interrupted multi-table staging is visibly blocked; retry cannot spend a second write allocation', async () => {
  const f = createStagingFixture(); const insert = f.store.insertUnique.bind(f.store);
  f.store.insertUnique = async (table, ...args) => {
    if (table === f.config.tables.DEPLOYMENT_TABLE) throw new Error('synthetic interruption');
    return insert(table, ...args);
  };
  await assert.rejects(f.service.stage(f.request));
  assert.equal(f.store.rowsFor(f.config.tables.CONFIGURATION_VERSION_TABLE).length, 1);
  assert.equal(f.store.rowsFor(f.config.tables.DEPLOYMENT_TABLE).length, 0);
  assert.equal(f.stagingWrites, 0);
  const writes = f.store.writes.length;
  await assert.rejects(f.service.stage(f.request), { code: 'CONFIGURATION_STAGING_RECONCILIATION_REQUIRED' });
  assert.equal(f.store.writes.length, writes);
});

test('failed receipt CAS or changed source after creation cannot become completed evidence', async () => {
  for (const conflict of ['cas', 'source']) {
    const f = createStagingFixture();
    if (conflict === 'cas') f.store.conditionalUpdate = async (table, id) =>
      f.store.rowsFor(table).find((row) => row.ROWID === id);
    else {
      const write = f.crm.recordConfigurationStaging;
      f.crm.recordConfigurationStaging = async (...args) => {
        const result = await write(...args); f.records.account.Phone = '+19135550199'; return result;
      };
    }
    await assert.rejects(f.service.stage(f.request));
    assert.equal(f.store.rowsFor(f.config.tables.EVENT_RECEIPT_TABLE).find((r) => r.RECEIPT_KIND === RECEIPT_KIND).STATUS, 'Processing');
    assert.equal(f.store.rowsFor(f.config.tables.DEPLOYMENT_TABLE)[0].ACTUAL_START_AT, null);
  }
});

test('post-stage business edits, recipient changes and receipt tampering block later internal approval', async () => {
  for (const mutate of [
    (f) => { f.records.deal.Alert_Recipient_Email = 'other@example.invalid'; },
    (f) => { f.records.account.Normal_Business_Hours = 'Changed schedule'; },
    (f) => { f.store.rowsFor(f.config.tables.EVENT_RECEIPT_TABLE)[0].EVENT_DATA_JSON += ' '; },
  ]) {
    const f = createStagingFixture(); await f.service.stage(f.request); mutate(f);
    const [deployment] = f.store.rowsFor(f.config.tables.DEPLOYMENT_TABLE);
    const [configurationRow] = f.store.rowsFor(f.config.tables.CONFIGURATION_VERSION_TABLE);
    await assert.rejects(f.service.assertApprovalSource({ dealId: f.request.dealId, journeyId: f.request.journeyId,
      deploymentId: deployment.DEPLOYMENT_ID, configurationVersionId: configurationRow.CONFIGURATION_VERSION_ID },
    { deployment, configurationRow, deal: f.records.deal }));
  }
});

test('advanced approval, activation or stop cannot replay as inactive staging', async () => {
  for (const patch of [
    { TEST_STATUS: 'Scheduled', GO_LIVE_APPROVAL_STATUS: 'Approved' },
    { TEST_STATUS: 'Live', ACTUAL_START_AT: '2026-09-09T12:01:00.000Z' },
    { TEST_STATUS: 'Stopped', STOP_REASON: 'operator_requested' },
  ]) {
    const f = createStagingFixture(); await f.service.stage(f.request);
    Object.assign(f.store.rowsFor(f.config.tables.DEPLOYMENT_TABLE)[0], patch);
    const writes = f.store.writes.length;
    await assert.rejects(f.service.stage(f.request), { code: 'CONFIGURATION_STAGING_STATE_ADVANCED' });
    assert.equal(f.store.writes.length, writes);
  }
});

test('cross-journey deployment ID reuse rejects before writes and simultaneous same-journey staging inserts once', async () => {
  const a = createStagingFixture(0); const b = createStagingFixture(1);
  b.request.deployment.DEPLOYMENT_ID = a.request.deployment.DEPLOYMENT_ID;
  b.request.configurationRow.DEPLOYMENT_ID = a.request.deployment.DEPLOYMENT_ID;
  b.request.intent.deployment_id = a.request.deployment.DEPLOYMENT_ID; b.sign();
  await assert.rejects(b.service.stage(b.request)); assert.equal(b.store.writes.length, 0);
  const f = createStagingFixture();
  // The fake is deliberately serialized at the provider's unique insertion
  // boundary; it must not simulate non-atomic insert-if-absent semantics.
  const base = f.store.insertUnique.bind(f.store); let pending = Promise.resolve();
  f.store.insertUnique = (...args) => {
    const result = pending.then(() => base(...args)); pending = result.catch(() => {}); return result;
  };
  const results = await Promise.allSettled([f.service.stage(f.request), f.service.stage(f.request)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(f.store.rowsFor(f.config.tables.DEPLOYMENT_TABLE).length, 1);
  assert.equal(f.store.rowsFor(f.config.tables.CONFIGURATION_VERSION_TABLE).length, 1);
  assert.equal(f.stagingWrites, 1);
});

test('fresh authenticated baseline metadata and exact CRM values enter the reviewed immutable row; unknown stays unknown', async () => {
  const f = createStagingFixture(); const template = crmBaselineFixture();
  const fields = Object.keys(template.metadata.fields).filter((field) => field !== 'Approved_Test_Route');
  for (const field of fields) f.records.deal[field] = template.deal[field];
  f.records.deal.Estimated_Unanswered_Call_Rate = null;
  const relationships = { leadId: f.lineage.originalLeadId, accountId: f.records.account.id,
    contactId: f.records.contact.id, dealId: f.records.deal.id, intakeSubmissionId: f.lineage.journeyId };
  const spec = { sourcePeriod: template.context.sourcePeriod, currency: 'USD', evidenceClass: 'customer_supplied_estimate' };
  Object.assign(f.request.review, { analyticsClientKey: 'a'.repeat(64), analyticsDeploymentKey: 'b'.repeat(64), reportBaseline: spec });
  const context = { clientKey: f.request.review.analyticsClientKey, deploymentKey: f.request.review.analyticsDeploymentKey,
    configurationVersionId: f.request.configurationRow.CONFIGURATION_VERSION_ID,
    configurationVersion: f.request.form2ConfigurationVersion, environment: 'development', relationships,
    crmModifiedAt: f.records.deal.Modified_Time, approvedTestRoute: f.records.deal.Approved_Test_Route, ...spec };
  const deal = Object.fromEntries(Object.keys(template.deal).map((field) => [field, f.records.deal[field]]));
  const metadata = { ...template.metadata, observedAt: new Date(f.now()).toISOString() };
  const capture = { deal, context, metadata, evidence: { source: 'crm_selected_field_readback',
    clientKey: context.clientKey, deploymentKey: context.deploymentKey,
    configurationVersionId: context.configurationVersionId, configurationVersion: context.configurationVersion,
    environment: 'development', relationships, crmModifiedAt: context.crmModifiedAt,
    readAt: new Date(f.now()).toISOString(), capturedAt: f.request.intent.evidence_observed_at,
    sourcePeriod: spec.sourcePeriod, evidenceClass: spec.evidenceClass } };
  const baseline = buildCrmPreTestSnapshot(capture, { now: f.now() });
  f.request.configurationRow.CONFIGURATION_JSON = JSON.stringify(validateConfiguration({
    ...JSON.parse(f.request.configurationRow.CONFIGURATION_JSON), reportBaseline: baseline })); f.sign();
  let reads = 0;
  const service = createConfigurationStagingService({ config: f.config, store: f.store, crm: f.crm,
    core: f.core, sourceReader: f.sourceReader, conversionReader: f.conversionReader, now: f.now,
    metadataReader: { async readMetadata() { reads += 1; return structuredClone(metadata); } } });
  await service.stage(f.request); assert.equal(reads, 1);
  const row = f.store.rowsFor(f.config.tables.CONFIGURATION_VERSION_TABLE)[0];
  const stored = JSON.parse(row.CONFIGURATION_JSON).reportBaseline;
  assert.equal(stored.values.monthlyInboundCalls, 140);
  assert.equal(stored.values.estimatedUnansweredCallRate, null);
  assert.equal(stored.evidenceClass, 'customer_supplied_estimate');
  assert.equal(stored.provenanceStatus, 'locally_consistent_not_authenticated');
});
