'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { reconcileBillingLink, readBillingLink } = require('../lib/billing-link-reconciliation');
test.after(() => { assert.deepEqual(guard.blocked, []); guard.restore(); });

function fixture() {
  const scope = { environment: 'development', clientId: 'synthetic_client', deploymentId: 'synthetic_deployment',
    configurationVersionId: 'synthetic_configuration', configurationVersion: 'v1',
    crmAccountId: 'synthetic_account', crmDealId: 'synthetic_deal',
    billingOrganizationId: 'synthetic_organization', billingMode: 'test' };
  const customer = { customerId: 'synthetic_customer', crmAccountId: scope.crmAccountId };
  const subscription = { subscriptionId: 'synthetic_subscription', customerId: customer.customerId,
    referenceId: 'synthetic_reference' };
  const page = (item) => [{ page: 1, hasMorePage: false, items: [structuredClone(item)] }];
  return { scope, attribution: { kind: 'current', subscriptionReference: subscription.referenceId },
    snapshot: { readStatus: 'complete',
      crm: { scope: { ...scope }, account: { id: scope.crmAccountId },
        deal: { id: scope.crmDealId, Account_Name: { id: scope.crmAccountId },
          Billing_Customer_ID: customer.customerId, Billing_Subscription_ID: subscription.subscriptionId } },
      billing: { scope: { ...scope }, customer, subscription,
        customerPages: page(customer), subscriptionPages: page(subscription) } } };
}

function noncharging(output) {
  assert.equal(output.billableMinutes, null);
  assert.equal(output.chargeMinor, null);
  assert.equal(output.billingAuthority, false);
}

test('complete exact relationship read verifies only a link, in pinned test or live mode', () => {
  for (const mode of ['test', 'live']) {
    const input = fixture();
    input.scope.billingMode = input.snapshot.crm.scope.billingMode = input.snapshot.billing.scope.billingMode = mode;
    const before = structuredClone(input);
    const output = reconcileBillingLink(input);
    assert.equal(output.status, 'verified');
    assert.deepEqual(output.holds, []);
    assert.equal(output.link.billingCustomerId, 'synthetic_customer');
    noncharging(output);
    assert.deepEqual(input, before);
  }
});

for (const system of ['crm', 'billing']) {
  for (const key of Object.keys(fixture().scope)) {
    test(`${system} evidence from wrong ${key} is held`, () => {
      const input = fixture();
      input.snapshot[system].scope[key] = 'foreign';
      const output = reconcileBillingLink(input);
      assert.equal(output.status, 'conflict');
      assert.equal(output.link, null);
      noncharging(output);
    });
  }
}

for (const [name, change] of [
  ['account', (s) => { s.crm.account.id = 'wrong'; }],
  ['deal', (s) => { s.crm.deal.id = 'wrong'; }],
  ['deal account', (s) => { s.crm.deal.Account_Name.id = 'wrong'; }],
  ['CRM customer ID', (s) => { s.crm.deal.Billing_Customer_ID = 'wrong'; }],
  ['CRM subscription ID', (s) => { s.crm.deal.Billing_Subscription_ID = 'wrong'; }],
  ['detail customer', (s) => { s.billing.customer.customerId = 'wrong'; }],
  ['detail CRM account', (s) => { s.billing.customer.crmAccountId = 'wrong'; }],
  ['detail subscription', (s) => { s.billing.subscription.subscriptionId = 'wrong'; }],
  ['subscription owner', (s) => { s.billing.subscription.customerId = 'wrong'; }],
  ['detail reference', (s) => { s.billing.subscription.referenceId = 'wrong'; }],
  ['list subscription owner', (s) => { s.billing.subscriptionPages[0].items[0].customerId = 'wrong'; }],
]) {
  test(`mismatched ${name} conflicts`, () => {
    const input = fixture(); change(input.snapshot);
    const output = reconcileBillingLink(input);
    assert.equal(output.status, 'conflict');
    assert.equal(output.link, null);
  });
}

for (const pages of ['customerPages', 'subscriptionPages']) {
  test(`${pages} duplicates, missing matches and incomplete pagination fail closed`, () => {
    const input = fixture();
    const original = input.snapshot.billing[pages][0];
    input.snapshot.billing[pages].push({ ...structuredClone(original), page: 2 });
    original.hasMorePage = true;
    assert.equal(reconcileBillingLink(input).status, 'conflict');
    input.snapshot.billing[pages][1].items = [];
    assert.equal(reconcileBillingLink(input).status, 'verified');
    input.snapshot.billing[pages][1].hasMorePage = true;
    assert.equal(reconcileBillingLink(input).status, 'read_unavailable');
    input.snapshot.billing[pages][1].hasMorePage = false;
    input.snapshot.billing[pages][1].page = 3;
    assert.equal(reconcileBillingLink(input).status, 'read_unavailable');
    input.snapshot.billing[pages] = [{ page: 1, hasMorePage: false, items: [] }];
    assert.equal(reconcileBillingLink(input).status, 'missing');
    delete input.snapshot.billing[pages][0].hasMorePage;
    assert.equal(reconcileBillingLink(input).status, 'read_unavailable');
    const malformed = fixture();
    malformed.snapshot.billing[pages][0].items.push({ customerId: 'unresolved_reference' });
    assert.equal(reconcileBillingLink(malformed).status, 'read_unavailable');
  });
}

test('substring matches are post-filtered and bounded pages must be complete', () => {
  const input = fixture();
  input.snapshot.billing.subscriptionPages[0].items.unshift({ subscriptionId: 'synthetic_unrelated',
    customerId: 'synthetic_customer', referenceId: 'synthetic_reference_suffix' });
  assert.equal(reconcileBillingLink(input).status, 'verified');
  input.snapshot.billing.subscriptionPages[0].items.pop();
  assert.equal(reconcileBillingLink(input).status, 'missing');
  input.snapshot.billing.subscriptionPages = Array.from({ length: 26 }, (_, i) => ({
    page: i + 1, hasMorePage: i < 25, items: [],
  }));
  assert.equal(reconcileBillingLink(input).status, 'read_unavailable');
});

test('missing IDs are distinct from unobserved fields and empty Billing inventory is missing', () => {
  const input = fixture();
  input.snapshot.billing.customerPages[0].items = [];
  input.snapshot.billing.subscriptionPages[0].items = [];
  assert.equal(reconcileBillingLink(input).status, 'missing');
  for (const key of ['Billing_Customer_ID', 'Billing_Subscription_ID']) {
    const missing = fixture();
    missing.snapshot.crm.deal[key] = null;
    assert.equal(reconcileBillingLink(missing).status, 'missing');
    delete missing.snapshot.crm.deal[key];
    assert.equal(reconcileBillingLink(missing).status, 'read_unavailable');
  }
  delete input.attribution.subscriptionReference;
  assert.deepEqual(reconcileBillingLink(input).holds, ['subscription_reference_missing']);
});

function historical(input) {
  input.attribution = { kind: 'historical', startedAt: '2026-08-31T23:59:45.000Z',
    endedAt: '2026-09-01T00:00:15.000Z', mapping: { ...input.scope,
      evidenceReference: 'synthetic_effective_mapping', billingCustomerId: 'synthetic_customer',
      billingSubscriptionId: 'synthetic_subscription', subscriptionReference: 'synthetic_reference',
      effectiveFrom: '2026-08-01T00:00:00.000Z', effectiveTo: '2026-10-01T00:00:00.000Z' } };
  return input;
}

test('history requires an explicit mapping covering the whole call; current fields cannot backfill it', async () => {
  const input = historical(fixture());
  input.snapshot.crm.deal.Billing_Customer_ID = 'current_customer';
  input.snapshot.crm.deal.Billing_Subscription_ID = 'current_subscription';
  assert.equal(reconcileBillingLink(input).status, 'verified');
  input.attribution.mapping.effectiveTo = '2026-09-01T00:00:00.000Z';
  assert.deepEqual(reconcileBillingLink(input).holds, ['historical_link_unresolved']);
  delete input.attribution.mapping;
  let reads = 0;
  const unresolved = await readBillingLink({ ...input, readSnapshot: async () => { reads += 1; return input.snapshot; } });
  assert.deepEqual(unresolved.holds, ['historical_link_unresolved']);
  assert.equal(reads, 0);
});

for (const key of [...Object.keys(fixture().scope), 'effectiveFrom', 'effectiveTo', 'evidenceReference',
  'billingCustomerId', 'billingSubscriptionId', 'subscriptionReference']) {
  test(`missing historical mapping ${key} remains unresolved`, () => {
    const input = historical(fixture()); delete input.attribution.mapping[key];
    assert.deepEqual(reconcileBillingLink(input).holds, ['historical_link_unresolved']);
  });
}

test('read failures redact messages and never call writes, commercial checks or lifecycle reconciliation', async () => {
  const input = fixture();
  const writes = [];
  const forbidden = ['ensureCustomer', 'ensurePaidSubscription', 'reconcile', 'verifyPaidSubscription',
    'providerWrite', 'crmWrite', 'invoice', 'email', 'payment', 'dispatch'];
  const dependencies = Object.fromEntries(forbidden.map((name) => [name, () => {
    writes.push(name); throw new Error('write forbidden');
  }]));
  for (const readSnapshot of [async () => input.snapshot,
    async () => { throw new Error('timeout synthetic-private-marker'); },
    async () => ({ readStatus: 'partial' })]) {
    const output = await readBillingLink({ ...input, ...dependencies, readSnapshot });
    noncharging(output);
    assert.equal(JSON.stringify(output).includes('synthetic-private-marker'), false);
  }
  assert.equal((await readBillingLink({ ...input,
    readSnapshot: async () => { throw new Error('timeout'); } })).status, 'read_unavailable');
  assert.deepEqual(writes, []);
});

test('link output excludes customer details, provider bodies and arbitrary properties', () => {
  const input = fixture();
  input.snapshot.billing.customer.email = 'synthetic-private-marker';
  input.snapshot.billing.subscription.fullJSON = 'synthetic-private-marker';
  input.snapshot.crm.account.Account_Name = 'synthetic-private-marker';
  const output = reconcileBillingLink(input);
  assert.equal(output.status, 'verified');
  assert.equal(JSON.stringify(output).includes('synthetic-private-marker'), false);
  assert.deepEqual(Object.keys(output).sort(), ['schemaVersion', 'status', 'holds', 'link',
    'billableMinutes', 'chargeMinor', 'billingAuthority'].sort());
  assert.deepEqual(Object.keys(output.link).sort(), [...Object.keys(input.scope),
    'billingCustomerId', 'billingSubscriptionId', 'attribution', 'effectiveFrom', 'effectiveTo'].sort());
});

test('a hanging reader hits the deadline with no retry and late results cannot verify', async () => {
  const input = fixture();
  let reads = 0;
  let finishRead;
  const output = await readBillingLink({ ...input, timeoutMs: 5, readSnapshot: () => {
    reads += 1;
    return new Promise((resolve) => { finishRead = resolve; });
  } });
  assert.equal(output.status, 'read_unavailable');
  finishRead(input.snapshot);
  await Promise.resolve();
  assert.equal(output.status, 'read_unavailable');
  assert.equal(reads, 1);
  noncharging(output);
});

test('the reader cannot retarget requested attribution during the await', async () => {
  const input = fixture();
  const output = await readBillingLink({ ...input, readSnapshot: async (request) => {
    request.attribution.subscriptionReference = 'wrong';
    input.scope.crmAccountId = 'wrong';
    return input.snapshot;
  } });
  assert.equal(output.status, 'verified');
  assert.equal(output.link.crmAccountId, 'synthetic_account');
});
