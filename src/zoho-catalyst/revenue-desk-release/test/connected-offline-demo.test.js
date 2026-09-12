'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('./helpers/offline-guard');
const { createOfflineHarness, runFreeTestDemo } = require('./helpers/free-test-demo');

async function guarded(callback) {
  const guard = installOfflineGuard();
  try { return await callback(guard); } finally { guard.restore(); }
}

async function settledOneCall(options = {}) {
  const h = await createOfflineHarness(options);
  const entry = await h.inbound('A');
  await h.event('A', entry.body.call_inbound.metadata, 'settled', { bookable_opportunity: true });
  h.runtime.clock.value = Date.parse('2026-08-27T12:00:01.000Z');
  await h.job({ mode: 'rebuild_report', deployment_id: 'deployment_A' });
  h.admittedMetadata = entry.body.call_inbound.metadata;
  return h;
}

async function pendingLateRevision(options = {}) {
  const h = await settledOneCall(options);
  const first = h.runtime.store.rows.get('CRMBillingOperations')[0];
  await h.dispatcher.dispatch(first.CRM_DEAL_ID, first.OPERATION_KEY);
  const original = structuredClone(first);
  await h.event('A', h.admittedMetadata, 'late_in_flight', { bookable_opportunity: true });
  await h.job({ mode: 'rebuild_report', deployment_id: 'deployment_A' });
  const revision = h.runtime.store.rows.get('CRMBillingOperations')
    .find((row) => row.CRM_DEAL_ID === original.CRM_DEAL_ID
      && row.OPERATION_KEY !== original.OPERATION_KEY);
  assert.equal(revision.STATUS, 'pending');
  return { h, original, revision };
}

test('repeatable prepared setup to gateway, worker, report and actual CRM summary handler', async () => {
  const result = await runFreeTestDemo();
  assert.deepEqual(result, await runFreeTestDemo());
  assert.equal(result.label, 'SYNTHETIC DEMONSTRATION — NO LIVE CALLS');
  assert.deepEqual(result.effects, { network: 0, provider: 0, crm: 0, email: 0, sms: 0 });
  assert.equal(result.simulatedEffects.writes, 3);
  assert.equal(result.simulatedEffects.replayed, 2);
  assert.equal(result.simulatedEffects.canonicalCalls, 32);
  assert.equal(result.checks.completedCrmSummaryRevision, true);
  assert.equal(result.checks.previousCompletedReceiptPreserved, true);
  const [a, b] = result.companies;
  for (const company of result.companies) {
    assert.equal(company.preparation.providerVerified, false);
    assert.equal(company.preparation.deploymentAuthorized, false);
    assert.equal(company.preparation.candidate.approved, false);
    assert.equal(company.report.configurationVersion, company.preparation.candidate.configurationVersion);
    assert.equal(company.crmSummary.Configuration_Version, company.report.configurationVersion);
    assert.equal(company.crmSummary.Test_Calls_Reaching_Route, company.report.callsCaptured);
    assert.equal(company.state.reconciliation, 'Completed');
    assert.ok(company.csv.startsWith('recordType,'));
    for (const preview of company.notificationPreviews) {
      assert.equal(preview.recipient, company.preparation.candidate.notificationRecipient.email);
      assert.match(preview.html, /No appointment or dispatch has been confirmed/);
    }
  }
  assert.notEqual(a.preparation.candidate.notificationRecipient.email,
    b.preparation.candidate.notificationRecipient.email);
  assert.equal(a.report.callsCaptured, 7);
  assert.equal(a.report.qualifiedOpportunities, 3);
  assert.equal(a.report.existingCustomerCalls, 1);
  assert.equal(a.report.outOfAreaOrWrongFitCalls, 1);
  assert.equal(a.report.urgentRequests, 1);
  assert.equal(a.report.metrics.spam, 1);
  assert.equal(a.report.observedWorkflowFailures, 1);
  assert.equal(b.report.callsCaptured, 25);
});

test('missing, invalid and expired authentication creates no receipt or call', () => guarded(async () => {
  const h = await createOfflineHarness();
  const payload = h.fixture.payloadInbound('A');
  for (const headers of [{ 'x-retell-signature': null }, { 'x-retell-signature': 'invalid' }]) {
    assert.notEqual((await h.invoke('/retell/inbound', payload, headers)).status, 200);
  }
  const expired = await h.fixture.invoke(h.runtime.listener, {
    url: '/retell/inbound', payload, env: h.runtime.env, processJobs: false,
    signatureTimestamp: h.runtime.clock.value - 300001,
  });
  assert.notEqual(expired.status, 200);
  assert.equal(h.runtime.store.rows.get('RevenueDeskEventReceipts').length, 0);
  assert.equal(h.runtime.store.rows.get('RevenueDeskCalls').length, 0);
}));

test('duplicate signed event has one intended effect and cannot cross company ownership', () => guarded(async () => {
  const h = await createOfflineHarness();
  const entry = await h.inbound('A');
  const payload = await h.event('A', entry.body.call_inbound.metadata, 'duplicate');
  assert.equal((await h.invoke('/retell/events', payload)).status, 200);
  while (h.runtime.jobQueue.length) await h.job(h.runtime.jobQueue.shift());
  assert.equal(h.runtime.store.rows.get('RevenueDeskCalls').length, 1);
  assert.equal(h.runtime.store.rows.get('RevenueDeskNotifications').length, 1);
  const wrong = h.fixture.eventPayload('call_analyzed', 'offline_wrong_company',
    entry.body.call_inbound.metadata, 'B');
  // Ingress acknowledges only the durable event receipt; the worker performs
  // authoritative ownership validation before any canonical call/write.
  assert.equal((await h.invoke('/retell/events', wrong)).status, 200);
  await assert.rejects(() => h.job(h.runtime.jobQueue.shift()), /Synthetic worker failed/);
  assert.equal(h.runtime.store.rows.get('RevenueDeskCalls').length, 1);
  const reporting = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/reporting');
  await assert.rejects(() => reporting.queryClientReport(h.runtime.store, h.runtime.config,
    'client_B', 'deployment_A', h.runtime.clock.value), { code: 'REPORT_OWNERSHIP_CONFLICT' });
}));

test('ambiguous CRM write is reconciled by exact readback, never blindly rewritten', () => guarded(async () => {
  const h = await settledOneCall({ ambiguousWrite: true });
  const operation = h.runtime.store.rows.get('CRMBillingOperations')[0];
  await assert.rejects(() => h.dispatcher.dispatch(operation.CRM_DEAL_ID, operation.OPERATION_KEY),
    { code: 'CRM_REPORT_DISPATCH_UNAVAILABLE' });
  assert.equal(operation.STATUS, 'reconciliation_required');
  assert.equal(h.crm.effects.writes, 1);
  const result = await h.dispatcher.dispatch(operation.CRM_DEAL_ID, operation.OPERATION_KEY);
  assert.equal(result.duplicate, true);
  assert.equal(operation.STATUS, 'completed');
  assert.equal(h.crm.effects.writes, 1);
  assert.ok(h.crm.effects.reads >= 4);
}));

test('stale operation cursor cannot steal the report write claim', () => guarded(async () => {
  const h = await settledOneCall();
  const operation = h.runtime.store.rows.get('CRMBillingOperations')[0];
  const before = structuredClone(operation);
  const first = await h.crm.operations.claimReportSummary(before, `report_claim_${'1'.repeat(32)}`,
    new Date(h.runtime.clock.value).toISOString());
  const second = await h.crm.operations.claimReportSummary(before, `report_claim_${'2'.repeat(32)}`,
    new Date(h.runtime.clock.value).toISOString());
  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  assert.equal(operation.LAST_OUTCOME, first.row.LAST_OUTCOME);
  assert.equal(h.crm.effects.writes, 0);
}));

test('late in-flight overshoot advances Completed CRM once without reopening the terminal route', () => guarded(async () => {
  const h = await createOfflineHarness();
  const entry = await h.inbound('A');
  const metadata = entry.body.call_inbound.metadata;
  for (let index = 0; index < 25; index += 1) await h.event('A', metadata, index);
  await h.job({ mode: 'rebuild_report', deployment_id: 'deployment_A' });
  await h.job({ mode: 'retry_scan' });
  assert.equal(h.crm.effects.writes, 1);
  const original = structuredClone(h.runtime.store.rows.get('CRMBillingOperations')[0]);
  const originalDeal = structuredClone(h.crm.contexts.get('400000001').deal);
  const before = await h.report('A');
  await h.event('A', metadata, 'in_flight', { bookable_opportunity: true });
  const rebuilt = await h.job({ mode: 'rebuild_report', deployment_id: 'deployment_A' });
  assert.equal(rebuilt.report.callsCaptured, 26);
  assert.equal(rebuilt.report.inFlightOvershoot, 1);
  assert.notEqual(rebuilt.report.sourceModifiedAt, before.sourceModifiedAt);
  await h.job({ mode: 'retry_scan' });
  assert.equal(h.crm.effects.writes, 2);
  const current = h.crm.contexts.get('400000001').deal;
  assert.equal(current.Test_Calls_Reaching_Route, 26);
  for (const field of ['Stage', 'Test_Status', 'Test_Start_At', 'Test_End_At', 'Test_End_Reason']) {
    assert.equal(current[field], originalDeal[field]);
  }
  const operations = h.runtime.store.rows.get('CRMBillingOperations');
  assert.equal(operations.length, 2);
  assert.ok(operations.every((row) => row.STATUS === 'completed'));
  assert.deepEqual(operations.find((row) => row.OPERATION_KEY === original.OPERATION_KEY), original);
  for (const operation of [...operations].reverse()) {
    assert.equal((await h.dispatcher.dispatch(operation.CRM_DEAL_ID, operation.OPERATION_KEY)).duplicate, true);
  }
  assert.equal(h.crm.effects.writes, 2);
  assert.equal(current.Test_Calls_Reaching_Route, 26);
  assert.deepEqual(operations.find((row) => row.OPERATION_KEY === original.OPERATION_KEY), original);
  assert.notEqual((await h.inbound('A')).body?.call_inbound?.metadata?.resolver_status, 'Resolved');
}));

test('two concurrent deliveries of a newer report produce one conditional CRM effect', () => guarded(async () => {
  const { h, revision } = await pendingLateRevision();
  const results = await Promise.allSettled([1, 2].map(() =>
    h.dispatcher.dispatch(revision.CRM_DEAL_ID, revision.OPERATION_KEY)));
  assert.ok(results.some((result) => result.status === 'fulfilled'));
  assert.equal(h.crm.effects.writes, 2);
  assert.equal((await h.dispatcher.dispatch(revision.CRM_DEAL_ID, revision.OPERATION_KEY)).duplicate, true);
  assert.equal(h.crm.effects.writes, 2);
  assert.equal(revision.STATUS, 'completed');
}));

test('ambiguous newer Completed write requires readback and never a duplicate update', () => guarded(async () => {
  const options = {};
  const { h, original, revision } = await pendingLateRevision(options);
  options.ambiguousWrite = true;
  await assert.rejects(() => h.dispatcher.dispatch(revision.CRM_DEAL_ID, revision.OPERATION_KEY),
    { code: 'CRM_REPORT_DISPATCH_UNAVAILABLE' });
  assert.equal(h.crm.effects.writes, 2);
  assert.equal(revision.STATUS, 'reconciliation_required');
  assert.equal((await h.dispatcher.dispatch(revision.CRM_DEAL_ID, revision.OPERATION_KEY)).duplicate, true);
  assert.equal(revision.STATUS, 'completed');
  assert.equal(h.crm.effects.writes, 2);
  assert.equal(h.crm.contexts.get('400000001').deal.Test_Calls_Reaching_Route, 2);
  assert.deepEqual(h.runtime.store.rows.get('CRMBillingOperations')
    .find((row) => row.OPERATION_KEY === original.OPERATION_KEY), original);
}));

test('review or paid evidence prevents every automatic Completed report revision', () => guarded(async () => {
  for (const field of ['Results_Review_At', 'Subscription_Acceptance_Status', 'Subscription_Accepted_At',
    'Subscription_Acceptance_Version', 'Subscription_Start_Date', 'Subscription_Status',
    'Billing_Customer_ID', 'Billing_Subscription_ID', 'Plan']) {
    const { h, original, revision } = await pendingLateRevision();
    h.crm.contexts.get('400000001').deal[field] = 'Synthetic protected evidence';
    await assert.rejects(() => h.dispatcher.dispatch(revision.CRM_DEAL_ID, revision.OPERATION_KEY),
      { code: 'CRM_REPORT_DISPATCH_UNAVAILABLE' });
    assert.equal(h.crm.effects.writes, 1, field);
    assert.equal(h.crm.contexts.get('400000001').deal.Test_Calls_Reaching_Route, 1, field);
    assert.equal(revision.STATUS, 'reconciliation_required', field);
    assert.deepEqual(h.runtime.store.rows.get('CRMBillingOperations')
      .find((row) => row.OPERATION_KEY === original.OPERATION_KEY), original);
  }
}));

test('missing protection evidence or a different CRM stage cannot authorize a report revision', () => guarded(async () => {
  for (const field of ['Results_Review_At', 'Subscription_Acceptance_Status', 'Subscription_Accepted_At',
    'Subscription_Acceptance_Version', 'Subscription_Start_Date', 'Subscription_Status',
    'Billing_Customer_ID', 'Billing_Subscription_ID', 'Plan', 'Stage']) {
    const { h, revision } = await pendingLateRevision();
    const deal = h.crm.contexts.get('400000001').deal;
    if (field === 'Stage') deal.Stage = 'Results Review';
    else delete deal[field];
    await assert.rejects(() => h.dispatcher.dispatch(revision.CRM_DEAL_ID, revision.OPERATION_KEY),
      { code: 'CRM_REPORT_DISPATCH_UNAVAILABLE' });
    assert.equal(h.crm.effects.writes, 1, field);
    assert.equal(deal.Test_Status, 'Completed');
    assert.equal(deal.Test_Calls_Reaching_Route, 1);
  }
}));

test('test guard blocks outbound, SDK, credential and child-process entrypoints before effects', () => guarded(async (guard) => {
  const denied = [
    () => globalThis.fetch('https://example.invalid'),
    () => require('node:https').request('https://example.invalid'),
    () => require('node:net').connect(443, 'example.invalid'),
    () => require('node:tls').connect(443, 'example.invalid'),
    () => require('node:dgram').createSocket('udp4'),
    () => require('node:dns').lookup('example.invalid'),
    () => require('node:child_process').spawn('blocked'),
    () => require('zcatalyst-sdk-node'),
    () => require('node:fs').readFileSync('.env'),
  ];
  for (const action of denied) assert.throws(action, { code: 'OFFLINE_ONLY' });
  assert.equal(guard.blocked.length, denied.length);
}));
