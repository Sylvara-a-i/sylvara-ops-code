'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('./helpers/offline-guard');
const guard = installOfflineGuard();
const { reconcileRawUsageWithBilling } = require('../lib/noncharging-usage-reconciliation');
const { runtimeFixture, invoke, payloadInbound } = require(
  '../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/test/runtime-fixture',
);
const sample = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/test/fixtures/retell-webhooks.json');
test.after(() => { assert.deepEqual(guard.blocked, []); guard.restore(); });

function row(changes = {}) {
  const call = { schemaVersion: 2, callKey: `call_${'a'.repeat(64)}`,
    clientId: 'synthetic_client', deploymentId: 'synthetic_deployment',
    configurationVersionId: 'synthetic_configuration', configurationVersion: 'v1',
    correlationId: 'synthetic_correlation', bindingId: 'synthetic_binding', bindingVersion: 1,
    engagementType: 'free_test', capabilityProfile: 'call_gap_monitor_v1',
    numberLookupHash: `num_${'e'.repeat(64)}`, coverageMode: 'AfterHoursOnly',
    startedAt: '2026-08-31T23:59:45.000Z', endedAt: '2026-09-01T00:00:15.000Z',
    durationMs: 29001, callStatus: 'ended', disconnectionReason: 'user_hangup', ...changes };
  return { CALL_KEY: call.callKey, CLIENT_ID: call.clientId, DEPLOYMENT_ID: call.deploymentId,
    CONFIGURATION_VERSION_ID: call.configurationVersionId, CONFIGURATION_VERSION: call.configurationVersion,
    CORRELATION_ID: call.correlationId, BINDING_ID: call.bindingId, BINDING_VERSION: call.bindingVersion,
    ENGAGEMENT_TYPE: call.engagementType, CAPABILITY_PROFILE: call.capabilityProfile,
    STARTED_AT: call.startedAt, ENDED_AT: call.endedAt, SOURCE_ENVIRONMENT: 'development',
    SOURCE_REVISION: 'b'.repeat(40), CANONICAL_CALL_JSON: JSON.stringify(call) };
}

function fixture(rows = [row()]) {
  const source = rows[0] ?? row();
  const scope = { environment: source.SOURCE_ENVIRONMENT, clientId: source.CLIENT_ID,
    deploymentId: source.DEPLOYMENT_ID, configurationVersionId: source.CONFIGURATION_VERSION_ID,
    configurationVersion: source.CONFIGURATION_VERSION, crmAccountId: 'synthetic_account',
    crmDealId: 'synthetic_deal', billingOrganizationId: 'synthetic_organization', billingMode: 'test' };
  const customer = { customerId: 'synthetic_customer', crmAccountId: scope.crmAccountId };
  const subscription = { subscriptionId: 'synthetic_subscription', customerId: customer.customerId,
    referenceId: 'synthetic_reference' };
  const page = (value) => [{ page: 1, hasMorePage: false, items: [structuredClone(value)] }];
  return { rows, scope, complete: true,
    effectiveMapping: { ...scope, evidenceReference: 'synthetic_effective_mapping',
      billingCustomerId: customer.customerId, billingSubscriptionId: subscription.subscriptionId,
      subscriptionReference: subscription.referenceId,
      effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: '2026-10-01T00:00:00.000Z' },
    billingSnapshot: { readStatus: 'complete',
      crm: { scope: { ...scope }, account: { id: scope.crmAccountId },
        deal: { id: scope.crmDealId, Account_Name: { id: scope.crmAccountId },
          Billing_Customer_ID: customer.customerId, Billing_Subscription_ID: subscription.subscriptionId } },
      billing: { scope: { ...scope }, customer, subscription,
        customerPages: page(customer), subscriptionPages: page(subscription) } } };
}

function noncharging(output) {
  for (const value of [output, ...output.calls]) {
    assert.equal(value.billableMinutes, null);
    assert.equal(value.chargeMinor, null);
    assert.equal(value.billingAuthority, false);
  }
  assert.equal(output.synchronizationAttempted, false);
  assert.equal(output.completeness.population, 'internal_accepted_calls');
  assert.equal(output.completeness.providerCompleteness, 'unproven');
}

test('dated raw usage links through effective evidence without rounding or period allocation', () => {
  for (const engagementType of ['free_test', 'paid_service']) {
    for (const callStatus of ['ended', 'error', 'not_connected']) {
      const input = fixture([row({ engagementType, callStatus })]);
      const before = structuredClone(input);
      const output = reconcileRawUsageWithBilling(input);
      assert.equal(output.evidenceStatus, 'linked');
      assert.deepEqual(output.holds, []);
      const call = output.calls[0];
      assert.equal(call.durationMs, 29001);
      assert.equal(call.rawDurationSeconds, 29.001, 'not the 30 seconds between timestamps');
      assert.equal(call.callStatus, callStatus);
      assert.equal(call.engagementType, engagementType);
      assert.equal(call.billingLinkStatus, 'verified');
      assert.equal(call.billingLink.attribution, 'historical');
      assert.equal(call.billingLink.billingSubscriptionId, input.effectiveMapping.billingSubscriptionId);
      assert.equal(call.billingPeriod, undefined);
      noncharging(output);
      assert.deepEqual(input, before);
    }
  }
});

for (const order of [['call_ended', 'call_analyzed'], ['call_analyzed', 'call_ended']]) {
  test(`actual durable runtime rows reconcile once after reversed/duplicate ${order.join('/')}`, async () => {
    const runtime = runtimeFixture();
    const admitted = await invoke(runtime.listener, { url: '/retell/inbound',
      payload: payloadInbound('A'), env: runtime.env });
    assert.equal(admitted.status, 200);
    const payload = (event) => ({ event, call: { ...structuredClone(sample.call),
      metadata: admitted.body.call_inbound.metadata,
      ...(event === 'call_analyzed' ? { call_analysis: {
        custom_analysis_data: structuredClone(sample.analysis),
      } } : {}),
    } });
    for (const event of [...order, ...order]) {
      const response = await invoke(runtime.listener, { url: '/retell/events',
        payload: payload(event), env: runtime.env, processJobs: false });
      assert.equal(response.status, 200);
    }
    runtime.jobQueue.reverse();
    await runtime.listener.processQueuedJobs();
    const original = structuredClone(runtime.store.rows.get('RevenueDeskCalls'));
    assert.equal(original.length, 1);
    const revision = payload('call_analyzed');
    revision.call.call_analysis.custom_analysis_data.issue_summary = 'Synthetic revised analysis';
    const revisedResponse = await invoke(runtime.listener, { url: '/retell/events', payload: revision,
      env: runtime.env });
    // Ingestion intentionally rejects changed payloads for the same event/call
    // receipt. Reconciliation does not add a new path around that contract.
    assert.equal(revisedResponse.status, 400);
    assert.equal(revisedResponse.body.code, 'DURABLE_IDEMPOTENCY_CONFLICT');
    assert.deepEqual(runtime.workerErrors, []);
    const revised = runtime.store.rows.get('RevenueDeskCalls');
    assert.equal(revised.length, 1);
    assert.deepEqual(revised, original);
    const before = structuredClone([...runtime.store.rows]);
    const input = fixture([...original, ...revised, ...original]);
    const output = reconcileRawUsageWithBilling(input);
    assert.deepEqual(output, reconcileRawUsageWithBilling({ ...input, rows: [...input.rows].reverse() }));
    assert.equal(output.evidenceStatus, 'linked');
    assert.equal(output.calls.length, 1);
    assert.equal(output.calls[0].durationMs, sample.call.duration_ms);
    assert.equal(output.calls[0].rawDurationSeconds, sample.call.duration_ms / 1000);
    assert.deepEqual([...runtime.store.rows], before);
    assert.equal(runtime.mailAccesses, 0);
    noncharging(output);
  });
}

test('analysis-only snapshot revisions keep one raw duration and historical link', () => {
  const original = row();
  const revised = row({ issueSummary: 'Synthetic revised analysis', outcome: 'different_analysis' });
  revised.SOURCE_REVISION = 'c'.repeat(40);
  revised.CALL_VERSION = 22;
  const input = fixture([original, revised, original]);
  const output = reconcileRawUsageWithBilling(input);
  assert.deepEqual(output, reconcileRawUsageWithBilling({ ...input, rows: [...input.rows].reverse() }));
  assert.equal(output.calls.length, 1);
  assert.equal(output.calls[0].durationMs, 29001);
  assert.equal(output.calls[0].billingLinkStatus, 'verified');
  assert.equal(output.calls[0].evidenceFingerprint,
    reconcileRawUsageWithBilling(fixture([original])).calls[0].evidenceFingerprint);
  noncharging(output);
});

test('malformed immutable routing cannot acquire a historical Billing relationship', () => {
  for (const changes of [{ numberLookupHash: undefined }, { coverageMode: 'nonsense' }]) {
    const output = reconcileRawUsageWithBilling(fixture([row(changes)]));
    assert.equal(output.evidenceStatus, 'held');
    assert.equal(output.calls.length, 1);
    assert.equal(output.calls[0].durationMs, null);
    assert.equal(output.calls[0].billingLinkStatus, 'not_checked');
    assert.equal(output.calls[0].billingLink, null);
    assert.ok(output.holds.includes('canonical_binding_conflict'));
    noncharging(output);
  }
});

for (const [name, changes, expectedSeconds] of [
  ['zero', { durationMs: 0 }, 0], ['missing', { durationMs: undefined }, null],
  ['historical v1', { schemaVersion: 1 }, null], ['text', { durationMs: '29001' }, null],
  ['negative', { durationMs: -1 }, null], ['overflow', { durationMs: Number.MAX_SAFE_INTEGER + 1 }, null],
]) {
  test(`${name} raw duration never becomes an invented charge or historical duration`, () => {
    const output = reconcileRawUsageWithBilling(fixture([row(changes)]));
    assert.equal(output.calls[0].rawDurationSeconds, expectedSeconds);
    assert.equal(output.calls[0].billingLinkStatus, expectedSeconds === null ? 'not_checked' : 'verified');
    assert.equal(output.evidenceStatus, expectedSeconds === null ? 'held' : 'linked');
    noncharging(output);
  });
}

for (const [name, change, status, hold] of [
  ['missing effective mapping', (i) => { delete i.effectiveMapping; }, 'conflict', 'historical_link_unresolved'],
  ['call crosses effective boundary', (i) => { i.effectiveMapping.effectiveTo = '2026-09-01T00:00:00.000Z'; }, 'conflict', 'historical_link_unresolved'],
  ['foreign mapping', (i) => { i.effectiveMapping.clientId = 'foreign'; }, 'conflict', 'historical_link_unresolved'],
  ['wrong organization', (i) => { i.billingSnapshot.billing.scope.billingOrganizationId = 'foreign'; }, 'conflict', 'scope_conflict'],
  ['wrong mode', (i) => { i.billingSnapshot.billing.scope.billingMode = 'live'; }, 'conflict', 'scope_conflict'],
  ['wrong environment', (i) => { i.billingSnapshot.crm.scope.environment = 'production'; }, 'conflict', 'scope_conflict'],
  ['wrong customer owner', (i) => { i.billingSnapshot.billing.customer.crmAccountId = 'foreign'; }, 'conflict', 'billing_relationship_conflict'],
  ['wrong subscription owner', (i) => { i.billingSnapshot.billing.subscription.customerId = 'foreign'; }, 'conflict', 'billing_relationship_conflict'],
  ['missing existing customer', (i) => { i.billingSnapshot.billing.customerPages[0].items = []; }, 'missing', 'billing_reference_missing'],
  ['duplicate reference', (i) => { i.billingSnapshot.billing.subscriptionPages[0].items.push({ ...i.billingSnapshot.billing.subscription }); }, 'conflict', 'reference_not_unique'],
  ['partial pagination', (i) => { i.billingSnapshot.billing.customerPages[0].hasMorePage = true; }, 'read_unavailable', 'pagination_incomplete'],
  ['unavailable read', (i) => { i.billingSnapshot = { readStatus: 'timeout' }; }, 'read_unavailable', 'read_unavailable'],
]) {
  test(`${name} preserves observed seconds but holds the relationship`, () => {
    const input = fixture(); change(input);
    const output = reconcileRawUsageWithBilling(input);
    assert.equal(output.evidenceStatus, 'held');
    assert.equal(output.calls[0].durationMs, 29001);
    assert.equal(output.calls[0].rawDurationSeconds, 29.001);
    assert.equal(output.calls[0].billingLinkStatus, status);
    assert.equal(output.calls[0].billingLink, null);
    assert.ok(output.holds.includes(hold));
    noncharging(output);
  });
}

test('current CRM Billing fields cannot replace or override historical mapping', () => {
  const input = fixture();
  input.billingSnapshot.crm.deal.Billing_Customer_ID = 'synthetic_new_customer';
  input.billingSnapshot.crm.deal.Billing_Subscription_ID = 'synthetic_new_subscription';
  assert.equal(reconcileRawUsageWithBilling(input).calls[0].billingLink.billingCustomerId, 'synthetic_customer');
  delete input.effectiveMapping;
  assert.equal(reconcileRawUsageWithBilling(input).calls[0].billingLink, null);
});

test('conflicting, foreign or partial raw evidence cannot produce a verified relationship', () => {
  const conflict = fixture([row(), row({ durationMs: 17 })]);
  const output = reconcileRawUsageWithBilling(conflict);
  assert.equal(output.calls.length, 1);
  assert.equal(output.calls[0].rawDurationSeconds, null);
  assert.ok(output.holds.includes('immutable_evidence_conflict'));
  for (const input of [conflict, { ...fixture(), complete: false },
    fixture([row(), row({ clientId: 'foreign', callKey: `call_${'c'.repeat(64)}` })]),
    fixture([row(), null])]) {
    const held = reconcileRawUsageWithBilling(input);
    assert.equal(held.evidenceStatus, 'held');
    assert.ok(held.holds.length);
    assert.equal(held.calls[0].billingLinkStatus, 'not_checked');
    assert.equal(held.calls[0].billingLink, null);
    noncharging(held);
  }
});

test('empty scoped evidence is not a verified relationship; invalid scope cannot assert completeness', () => {
  const empty = reconcileRawUsageWithBilling(fixture([]));
  assert.equal(empty.evidenceStatus, 'empty');
  assert.deepEqual(empty.calls, []);
  noncharging(empty);
  const invalid = reconcileRawUsageWithBilling({ rows: [], scope: {}, complete: true });
  assert.equal(invalid.evidenceStatus, 'held');
  assert.equal(invalid.completeness.scopedReadComplete, false);
  noncharging(invalid);
});

test('only allowlisted evidence leaves the pure composition; provider actions stay unused', () => {
  const input = fixture([row({ transcript: 'synthetic_private_marker', callerName: 'synthetic_private_marker' })]);
  input.billingSnapshot.billing.customer.email = 'synthetic_private_marker';
  input.effectiveMapping.privateNote = 'synthetic_private_marker';
  const attempts = [];
  for (const name of ['ensureCustomer', 'ensurePaidSubscription', 'updateDeal',
    'createInvoice', 'sendEmail', 'collectPayment', 'dispatch', 'writeUsage']) {
    input.billingSnapshot[name] = () => { attempts.push(name); throw new Error('Forbidden side effect'); };
  }
  const output = reconcileRawUsageWithBilling(input);
  assert.equal(JSON.stringify(output).includes('synthetic_private_marker'), false);
  assert.deepEqual(attempts, []);
  assert.deepEqual(Object.keys(output).sort(), ['schemaVersion', 'evidenceStatus', 'calls', 'holds',
    'completeness', 'synchronizationAttempted', 'billableMinutes', 'chargeMinor', 'billingAuthority'].sort());
  assert.deepEqual(Object.keys(output.calls[0]).sort(), ['schemaVersion', 'callKey', 'environment',
    'clientId', 'deploymentId', 'configurationVersionId', 'configurationVersion', 'canonicalSchemaVersion',
    'startedAt', 'endedAt', 'durationMs', 'callStatus', 'disconnectionReason', 'engagementType',
    'sourceRevisions', 'evidenceFingerprint', 'holds', 'rawEvidenceComplete', 'billableMinutes',
    'chargeMinor', 'billingAuthority', 'rawDurationSeconds', 'billingLinkStatus', 'billingLink'].sort());
  assert.equal(Object.isFrozen(output.calls[0].billingLink), true);
  noncharging(output);
});
