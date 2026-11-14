'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { BillingReadAdapterError, createBillingReadAdapter } = require('../lib/billing-read-adapter');
const { collectBillingReadEvidence } = require('../lib/billing-read-collector');
test.after(() => { assert.deepEqual(guard.blocked, []); guard.restore(); });

// Deliberately short synthetic identifiers satisfy the native numeric ID shape.
const ORGANIZATION = '80000001';
const CUSTOMER = '80000002';
const SUBSCRIPTION = '80000003';
const ACCOUNT = '80000004';
const TOKEN = 'Zoho-oauthtoken synthetic_read_only_authorization';
const signal = () => new AbortController().signal;
const tick = () => new Promise(resolve => setImmediate(resolve));
const unavailable = error => error instanceof BillingReadAdapterError
  && error.publicCode === 'billing_read_unavailable'
  && error.message === 'Billing read evidence is unavailable';

function fixture() {
  const calls = [], authorizations = [];
  const configuration = { billingOrganizationId: ORGANIZATION };
  const customer = { customer_id: CUSTOMER, zcrm_account_id: ACCOUNT, zcrm_contact_id: '',
    is_linked_with_zohocrm: true, email: 'private@example.invalid' };
  const subscription = { subscription_id: SUBSCRIPTION, customer_id: CUSTOMER,
    reference_id: 'synthetic_reference', amount: 999 };
  const dependencies = {
    readAuthorizationProvider: async request => { authorizations.push(request); return TOKEN; },
    fetchImpl: async (raw, options) => {
      calls.push({ raw, options });
      const url = new URL(raw); let body;
      if (url.pathname.endsWith(`/organizations/${ORGANIZATION}`)) body = { organization: { organization_id: ORGANIZATION, mode: 'test', email: 'private@example.invalid' } };
      else if (url.pathname.endsWith('/customers')) body = { customers: [{ customer_id: CUSTOMER }] };
      else if (url.pathname.endsWith(`/customers/${CUSTOMER}`)) body = { customer };
      else if (url.pathname.endsWith('/subscriptions')) body = { subscriptions: [subscription] };
      else if (url.pathname.endsWith(`/subscriptions/${SUBSCRIPTION}`)) body = { subscription };
      else assert.fail('Unexpected endpoint');
      if (url.search) body.page_context = { page: Number(url.searchParams.get('page')),
        per_page: Number(url.searchParams.get('per_page')), has_more_page: false };
      return Response.json({ code: 0, ...body });
    },
  };
  return { configuration, dependencies, calls, authorizations, customer, subscription,
    create: () => createBillingReadAdapter(configuration, dependencies) };
}

test('exactly five fixed GET readers translate native query/header names and all-status filters', async () => {
  const f = fixture(); const reads = f.create();
  assert.deepEqual(Object.keys(reads), ['readOrganization', 'readCustomerPage', 'readCustomer', 'readSubscriptionPage', 'readSubscription']);
  assert.equal(Object.isFrozen(reads), true);
  await reads.readOrganization({ signal: signal() });
  await reads.readCustomerPage({ page: 1, perPage: 100, signal: signal() });
  await reads.readCustomer({ customerId: CUSTOMER, signal: signal() });
  await reads.readSubscriptionPage({ page: 2, perPage: 200, filterBy: 'SubscriptionStatus.All', signal: signal() });
  await reads.readSubscription({ subscriptionId: SUBSCRIPTION, signal: signal() });
  assert.deepEqual(f.calls.map(call => call.raw), [
    `https://www.zohoapis.com/billing/v1/organizations/${ORGANIZATION}`,
    'https://www.zohoapis.com/billing/v1/customers?filter_by=Status.All&page=1&per_page=100',
    `https://www.zohoapis.com/billing/v1/customers/${CUSTOMER}`,
    'https://www.zohoapis.com/billing/v1/subscriptions?filter_by=SubscriptionStatus.All&page=2&per_page=200',
    `https://www.zohoapis.com/billing/v1/subscriptions/${SUBSCRIPTION}`,
  ]);
  for (const { options } of f.calls) {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, { Accept: 'application/json', Authorization: TOKEN,
      'X-com-zoho-subscriptions-organizationid': ORGANIZATION });
  }
  assert.equal(f.authorizations.length, 5);
  assert.ok(f.authorizations.every(request => request.signal instanceof AbortSignal && request.signal.aborted));
});

test('adapter feeds collector end-to-end without resolving any execution or historical holds', async () => {
  const f = fixture();
  const output = await collectBillingReadEvidence({ reads: f.create(),
    target: { crmAccountId: ACCOUNT, subscriptionReference: 'synthetic_reference',
      billingOrganizationId: ORGANIZATION, billingMode: 'test' } });
  assert.equal(output.status, 'held_evidence_only');
  assert.equal(output.readStatus, 'incomplete'); assert.equal(output.historicalMapping, null);
  assert.equal(output.billingAuthority, false); assert.equal(output.billableMinutes, null);
  assert.equal(output.chargeMinor, null); assert.equal(output.observation.atomicSnapshotEstablished, false);
  assert.equal(output.observation.selectedCustomer.customerId, CUSTOMER);
  assert.deepEqual(output.holds, ['execution_boundary_unqualified', 'snapshot_consistency_unqualified',
    'historical_mapping_not_established']);
  assert.equal(f.calls.length, 7);
  assert.doesNotMatch(JSON.stringify(output), /private@|amount|Authorization|oauthtoken/);
});

test('organization request cannot override the captured fixed destination', () => {
  const f = fixture(); const reads = f.create();
  for (const extra of [{ organizationId: '80000009' }, { billingOrganizationId: '80000009' },
    { path: '/customers' }, { method: 'POST' }]) {
    assert.throws(() => reads.readOrganization({ signal: signal(), ...extra }),
      error => error.publicCode === 'billing_read_request_invalid');
  }
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.authorizations, []);
});

test('native wrong-mode organization stops adapter/collector before customer or subscription reads', async () => {
  const f = fixture();
  f.dependencies.fetchImpl = async (raw, options) => {
    f.calls.push({ raw, options });
    assert.equal(new URL(raw).pathname, `/billing/v1/organizations/${ORGANIZATION}`);
    return Response.json({ code: 0, organization: { organization_id: ORGANIZATION, mode: 'live' } });
  };
  const result = await collectBillingReadEvidence({ reads: f.create(),
    target: { crmAccountId: ACCOUNT, subscriptionReference: 'synthetic_reference',
      billingOrganizationId: ORGANIZATION, billingMode: 'test' } });
  assert.equal(result.status, 'conflict');
  assert.ok(result.holds.includes('organization_identity_conflict'));
  assert.equal(result.observation, null);
  assert.equal(result.billingAuthority, false);
  assert.equal(f.calls.length, 1);
});

for (const [name, change] of [
  ['origin override', f => { f.configuration.billingApiBaseUrl = 'https://foreign.invalid'; }],
  ['organization coercion', f => { f.configuration.billingOrganizationId = 80000001; }],
  ['organization injection', f => { f.configuration.billingOrganizationId = '80000001/../other'; }],
  ['timeout above ceiling', f => { f.configuration.timeoutMs = 3001; }],
  ['unbounded bytes', f => { f.configuration.maximumBytes = Infinity; }],
  ['fractional bytes', f => { f.configuration.maximumBytes = 2.5; }],
  ['write-capable dependency', f => { f.dependencies.writeAuthorizationProvider = async () => TOKEN; }],
  ['implicit network dependency', f => { delete f.dependencies.fetchImpl; }],
]) {
  test(`${name} is rejected before any external dependency`, () => {
    const f = fixture(); change(f);
    assert.throws(f.create, error => error.publicCode === 'billing_read_configuration_invalid');
    assert.equal(f.calls.length, 0); assert.equal(f.authorizations.length, 0);
  });
}

test('request overrides, missing signals and invalid pagination cannot escape fixed endpoint', () => {
  const f = fixture(); const reads = f.create();
  for (const request of [
    { customerId: CUSTOMER }, { customerId: '../subscriptions', signal: signal() },
    { customerId: CUSTOMER, signal: signal(), method: 'POST' },
    { customerId: CUSTOMER, signal: signal(), headers: {} },
    { customerId: CUSTOMER, signal: signal(), billingOrganizationId: '80000009' },
  ]) assert.throws(() => reads.readCustomer(request), error => error.publicCode === 'billing_read_request_invalid');
  for (const request of [
    { page: 0, perPage: 100 }, { page: 26, perPage: 100 }, { page: 1, perPage: 201 },
    { page: 1, perPage: 100, filterBy: 'Status.Active' },
  ]) assert.throws(() => reads.readCustomerPage({ ...request, signal: signal() }),
    error => error.publicCode === 'billing_read_request_invalid');
  assert.throws(() => reads.readSubscriptionPage({ page: 1, perPage: 100,
    filterBy: 'SubscriptionStatus.Active', signal: signal() }), error => error.publicCode === 'billing_read_request_invalid');
  assert.equal(f.calls.length, 0); assert.equal(f.authorizations.length, 0);
});

test('captured organization/dependencies and request identity cannot be mutated during authorization', async () => {
  const f = fixture(); let release;
  f.dependencies.readAuthorizationProvider = () => new Promise(resolve => { release = resolve; });
  const reads = f.create(); const request = { customerId: CUSTOMER, signal: signal() };
  const pending = reads.readCustomer(request);
  f.configuration.billingOrganizationId = '80000009'; request.customerId = '80000009';
  f.dependencies.fetchImpl = () => assert.fail('Replaced transport must not run');
  release(TOKEN); await pending;
  assert.ok(f.calls[0].raw.endsWith(CUSTOMER));
  assert.equal(f.calls[0].options.headers['X-com-zoho-subscriptions-organizationid'], ORGANIZATION);
});

test('pre-aborted caller performs no authorization or HTTP dispatch', async () => {
  const f = fixture(); const caller = new AbortController(); caller.abort();
  await assert.rejects(f.create().readCustomer({ customerId: CUSTOMER, signal: caller.signal }), unavailable);
  assert.equal(f.calls.length, 0); assert.equal(f.authorizations.length, 0);
});

for (const kind of ['deadline', 'caller']) {
  test(`${kind} cancels hung authorization; its late result cannot dispatch`, async () => {
    const f = fixture(); f.configuration.timeoutMs = kind === 'deadline' ? 5 : 1000;
    const caller = new AbortController(); let release, authSignal;
    f.dependencies.readAuthorizationProvider = request => { authSignal = request.signal;
      return new Promise(resolve => { release = resolve; }); };
    const pending = f.create().readCustomer({ customerId: CUSTOMER, signal: caller.signal });
    if (kind === 'caller') caller.abort();
    await assert.rejects(pending, unavailable); assert.equal(authSignal.aborted, true);
    release(TOKEN); await tick(); assert.equal(f.calls.length, 0);
  });
}

test('slow immediate authorization cannot outrun the total monotonic deadline', async () => {
  const f = fixture(); f.configuration.timeoutMs = 1;
  f.dependencies.readAuthorizationProvider = () => {
    const until = performance.now() + 5; while (performance.now() < until) {}
    return TOKEN;
  };
  await assert.rejects(f.create().readCustomer({ customerId: CUSTOMER, signal: signal() }), unavailable);
  assert.equal(f.calls.length, 0);
});

test('collector cancellation reaches an adapter-stalled body, with no following reader', async () => {
  const f = fixture(); let release, cancelled = 0, dispatched = 0, transportSignal;
  f.dependencies.fetchImpl = async (_url, options) => {
    dispatched += 1; transportSignal = options.signal;
    return { status: 200, headers: new Headers(), body: { getReader: () => ({
      read: () => new Promise(resolve => { release = resolve; }),
      cancel: () => { cancelled += 1; return new Promise(() => {}); }, releaseLock() {},
    }) } };
  };
  const output = await collectBillingReadEvidence({ reads: f.create(), limits: { timeoutMs: 20 },
    target: { crmAccountId: ACCOUNT, subscriptionReference: 'synthetic_reference',
      billingOrganizationId: ORGANIZATION, billingMode: 'test' } });
  assert.equal(output.readStatus, 'incomplete'); assert.equal(output.observation, null);
  assert.ok(output.holds.includes('read_deadline_exceeded'));
  assert.equal(transportSignal.aborted, true); assert.equal(cancelled, 1);
  release({ done: false, value: Buffer.from('{}') }); await tick();
  assert.equal(dispatched, 1);
});

test('stream and declared byte budgets abort without returning raw data', async () => {
  for (const declared of [false, true]) {
    const f = fixture(); f.configuration.maximumBytes = 64; let cancels = 0, reads = 0;
    f.dependencies.fetchImpl = async () => ({ status: 200,
      headers: new Headers(declared ? { 'content-length': '65' } : {}),
      body: { cancel: () => { cancels += 1; }, getReader: () => ({
        read: async () => { reads += 1; return { done: false, value: Buffer.alloc(65) }; },
        cancel: () => { cancels += 1; }, releaseLock() {},
      }) },
    });
    await assert.rejects(f.create().readCustomer({ customerId: CUSTOMER, signal: signal() }), unavailable);
    assert.equal(cancels, 1); assert.equal(reads, declared ? 0 : 1);
  }
});

for (const [name, response] of [
  ['unauthorized', () => Response.json({ token: TOKEN }, { status: 401 })],
  ['rate limited', () => Response.json({ token: TOKEN }, { status: 429 })],
  ['server error', () => Response.json({ token: TOKEN }, { status: 503 })],
  ['redirect', () => Response.json({}, { status: 302 })],
  ['nonzero code', () => Response.json({ code: 57, customer: {}, message: TOKEN })],
  ['missing envelope', () => Response.json({ customer: {} })],
  ['wrong member', () => Response.json({ code: 0, subscriptions: [] })],
  ['invalid JSON', () => new Response('{bad')],
]) {
  test(`${name} is sanitized and never retried`, async () => {
    const f = fixture(); let attempts = 0;
    f.dependencies.fetchImpl = async () => { attempts += 1; return response(); };
    await assert.rejects(f.create().readCustomer({ customerId: CUSTOMER, signal: signal() }), unavailable);
    assert.equal(attempts, 1); assert.equal(f.authorizations.length, 1);
  });
}

test('authorization failures never reach HTTP and never leak underlying errors', async () => {
  for (const mode of ['throw', 'malformed']) {
    const f = fixture(); let attempts = 0;
    f.dependencies.readAuthorizationProvider = async () => {
      attempts += 1; if (mode === 'throw') throw new Error('PRIVATE_SENTINEL');
      return 'PRIVATE_SENTINEL';
    };
    await assert.rejects(f.create().readCustomer({ customerId: CUSTOMER, signal: signal() }), unavailable);
    assert.equal(attempts, 1); assert.equal(f.calls.length, 0);
  }
});
