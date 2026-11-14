'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { collectBillingReadEvidence } = require('../lib/billing-read-collector');
const { reconcileBillingLink } = require('../lib/billing-link-reconciliation');
test.after(() => { assert.deepEqual(guard.blocked, []); guard.restore(); });

function fixture() {
  const calls = [];
  const details = {
    synthetic_customer: { customer_id: 'synthetic_customer', zcrm_account_id: 'synthetic_account',
      zcrm_contact_id: 'synthetic_contact', is_linked_with_zohocrm: true,
      email: 'private@example.invalid', card: { secret: 'DO_NOT_RETURN' } },
    synthetic_unlinked: { customer_id: 'synthetic_unlinked', zcrm_account_id: '',
      zcrm_contact_id: '', is_linked_with_zohocrm: false },
    synthetic_contact_only: { customer_id: 'synthetic_contact_only', zcrm_account_id: '',
      zcrm_contact_id: 'synthetic_account', is_linked_with_zohocrm: true },
  };
  const sub = { subscription_id: 'synthetic_subscription', customer_id: 'synthetic_customer',
    reference_id: 'synthetic_reference', amount: 999, status: 'active', plan: { secret: 'DO_NOT_RETURN' } };
  const page = (key, items, request, more = false) => ({ code: 0, [key]: items,
    page_context: { page: request.page, per_page: request.perPage, has_more_page: more } });
  const input = {
    target: { crmAccountId: 'synthetic_account', subscriptionReference: 'synthetic_reference',
      billingOrganizationId: 'synthetic_organization', billingMode: 'test' },
    reads: {
      readOrganization: async (request) => { calls.push(['organization', request]);
        return { code: 0, organization: { organization_id: 'synthetic_organization', mode: 'test' } }; },
      readCustomerPage: async (request) => {
        calls.push(['customers', request]);
        return page('customers', Object.keys(details).map((customer_id) => ({ customer_id })), request);
      },
      readCustomer: async (request) => { calls.push(['customer', request]);
        return { code: 0, customer: { ...details[request.customerId] } }; },
      readSubscriptionPage: async (request) => { calls.push(['subscriptions', request]);
        return page('subscriptions', [{ ...sub }], request); },
      readSubscription: async (request) => { calls.push(['subscription', request]);
        return { code: 0, subscription: { ...sub } }; },
    },
  };
  return { input, calls, details, sub, page };
}
function noncharging(result) {
  assert.equal(result.readStatus, 'incomplete');
  assert.equal(result.historicalMapping, null);
  assert.equal(result.billableMinutes, null);
  assert.equal(result.chargeMinor, null);
  assert.equal(result.billingAuthority, false);
  assert.ok(result.holds.includes('historical_mapping_not_established'));
  assert.ok(result.holds.includes('execution_boundary_unqualified'));
  assert.ok(result.holds.includes('snapshot_consistency_unqualified'));
}
async function expectHold(f, reason, status = 'read_unavailable') {
  const result = await collectBillingReadEvidence(f.input);
  noncharging(result);
  assert.equal(result.status, status);
  assert.ok(result.holds.includes(reason), JSON.stringify(result));
  assert.equal(result.observation, null);
  return result;
}

test('hydrates every customer; separates Account, Contact and explicitly unlinked identities', async () => {
  const f = fixture();
  const result = await collectBillingReadEvidence(f.input);
  noncharging(result);
  assert.equal(result.status, 'held_evidence_only');
  assert.equal(result.observation.kind, 'current_only');
  assert.equal(result.observation.sweepEnded, true);
  assert.equal(result.observation.atomicSnapshotEstablished, false);
  assert.equal(result.observation.customers.length, 3);
  assert.equal(result.observation.selectedCustomer.customerId, 'synthetic_customer');
  assert.equal(result.observation.customers[1].crmAccountId, null);
  assert.equal(result.observation.customers[2].crmContactId, 'synthetic_account');
  assert.equal(result.counts.reads, 9);
  assert.deepEqual(f.calls.map(([name]) => name), ['organization', 'customers', 'customer', 'customer', 'customer',
    'subscriptions', 'subscription', 'customer', 'organization']);
  assert.equal(f.calls[5][1].filterBy, 'SubscriptionStatus.All');
  assert.equal(f.calls.every(([, request]) => Object.isFrozen(request)), true);
  assert.equal(f.calls.every(([, request]) => request.signal === f.calls[0][1].signal), true);
  assert.equal(f.calls[0][1].signal.aborted, true);
  assert.ok(Object.isFrozen(result.observation.customers[0]));
  assert.doesNotMatch(JSON.stringify(result), /private@|DO_NOT_RETURN|amount|active|plan/);
  assert.deepEqual(result.observation.organization, { organizationId: 'synthetic_organization', mode: 'test' });
  assert.equal(result.counts.organizations, 2);
});

for (const [name, body, hold, status] of [
  ['wrong organization', { organization_id: 'foreign', mode: 'test' }, 'organization_identity_conflict', 'conflict'],
  ['wrong mode', { organization_id: 'synthetic_organization', mode: 'live' }, 'organization_identity_conflict', 'conflict'],
  ['missing organization', undefined, 'organization_identity_unread'],
  ['missing mode', { organization_id: 'synthetic_organization' }, 'organization_identity_unread'],
  ['missing identity', { mode: 'test' }, 'organization_identity_unread'],
  ['coerced identity', { organization_id: 80000001, mode: 'test' }, 'organization_identity_unread'],
  ['unknown mode', { organization_id: 'synthetic_organization', mode: 'sandbox' }, 'organization_identity_unread'],
]) {
  test(`${name} stops before reading relationships`, async () => {
    const f = fixture(); let attempts = 0;
    f.input.reads.readOrganization = async () => { attempts += 1;
      return { code: 0, organization: body, secret: 'DO_NOT_RETURN' }; };
    const result = await expectHold(f, hold, status);
    assert.equal(attempts, 1);
    assert.equal(result.counts.reads, 1);
    assert.deepEqual(f.calls, []);
    assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RETURN/);
  });
}

for (const field of ['billingOrganizationId', 'billingMode', 'readOrganization']) {
  test(`missing ${field} rejects the old unqualified input before I/O`, async () => {
    const f = fixture();
    if (field === 'readOrganization') delete f.input.reads[field];
    else delete f.input.target[field];
    const result = await collectBillingReadEvidence(f.input);
    noncharging(result);
    assert.equal(result.observation, null);
    assert.equal(result.counts.reads, 0);
    assert.deepEqual(f.calls, []);
  });
}

for (const missing of [false, true]) {
  test(`closing organization read holds changed mode, missing inventory=${missing}`, async () => {
    const f = fixture(); let count = 0;
    f.input.reads.readOrganization = async () => ({ code: 0, organization: {
      organization_id: 'synthetic_organization', mode: ++count === 1 ? 'test' : 'live' } });
    if (missing) f.input.reads.readSubscriptionPage = async r => f.page('subscriptions', [], r);
    await expectHold(f, 'organization_identity_conflict', 'conflict');
    assert.equal(count, 2);
  });
}

for (const missing of [false, true]) {
  for (const failure of ['transport', 'malformed']) {
    test(`closing organization ${failure} failure discards observations, missing inventory=${missing}`, async () => {
      const f = fixture(); let attempts = 0;
      f.input.reads.readOrganization = async () => {
        attempts += 1;
        if (attempts === 1) return { code: 0,
          organization: { organization_id: 'synthetic_organization', mode: 'test' } };
        if (failure === 'transport') throw new Error('DO_NOT_RETURN private@example.invalid');
        return { code: 0, organization: { mode: 'test', email: 'DO_NOT_RETURN' } };
      };
      if (missing) f.input.reads.readSubscriptionPage = async r => f.page('subscriptions', [], r);
      const result = await expectHold(f, failure === 'transport' ? 'provider_read_failed' : 'organization_identity_unread');
      assert.equal(attempts, 2, 'closing failure is never retried');
      assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RETURN|private@/);
    });
  }
}

test('closing organization read consumes the same bounded read budget', async () => {
  const f = fixture(); f.input.limits = { maxReads: 8 };
  const result = await expectHold(f, 'read_budget_exceeded');
  assert.equal(result.counts.reads, 8);
  assert.equal(result.counts.organizations, 1);
});

test('organization preflight timeout aborts and late success cannot start relationship reads', async () => {
  const f = fixture(); f.input.limits = { timeoutMs: 5 }; let release, request;
  f.input.reads.readOrganization = r => { request = r; return new Promise(resolve => { release = resolve; }); };
  const result = await expectHold(f, 'read_deadline_exceeded');
  assert.equal(request.signal.aborted, true);
  release({ code: 0, organization: { organization_id: 'synthetic_organization', mode: 'test' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, []);
  assert.equal(result.counts.reads, 1);
});

test('organization target and response are captured before later awaits and private metadata is omitted', async () => {
  const f = fixture(); let count = 0;
  const body = { organization_id: 'synthetic_organization', mode: 'test', email: 'DO_NOT_RETURN' };
  f.input.reads.readOrganization = async () => {
    count += 1;
    f.input.target.billingOrganizationId = 'foreign'; f.input.target.billingMode = 'live';
    return { code: 0, organization: count === 1 ? body : { organization_id: 'synthetic_organization', mode: 'test' } };
  };
  const readPage = f.input.reads.readCustomerPage;
  f.input.reads.readCustomerPage = async r => { body.organization_id = 'foreign'; return readPage(r); };
  const result = await collectBillingReadEvidence(f.input);
  assert.equal(result.status, 'held_evidence_only');
  assert.deepEqual(result.observation.organization, { organizationId: 'synthetic_organization', mode: 'test' });
  assert.ok(Object.isFrozen(result.observation.organization));
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_RETURN|foreign/);
});

test('exact reference match ignores substrings and explicit unrelated empty references', async () => {
  const f = fixture();
  f.input.reads.readSubscriptionPage = async (r) => f.page('subscriptions', [
    { ...f.sub, subscription_id: 'synthetic_suffix', reference_id: 'synthetic_reference_suffix' },
    { ...f.sub, subscription_id: 'synthetic_empty', reference_id: '' }, f.sub], r);
  const result = await collectBillingReadEvidence(f.input);
  assert.equal(result.status, 'held_evidence_only');
  assert.equal(result.observation.selectedSubscription.subscriptionId, 'synthetic_subscription');
});

test('bounded sequential pagination hydrates identities across all observed pages', async () => {
  const f = fixture(); f.input.limits = { perPage: 2 };
  const ids = Object.keys(f.details);
  f.input.reads.readCustomerPage = async (r) => {
    f.calls.push(['customers', r]);
    return f.page('customers', ids.slice((r.page - 1) * 2, r.page * 2).map((customer_id) => ({ customer_id })), r, r.page === 1);
  };
  const result = await collectBillingReadEvidence(f.input);
  assert.equal(result.status, 'held_evidence_only');
  assert.equal(result.counts.customerPages, 2);
  assert.deepEqual(f.calls.filter(([name]) => name === 'customers').map(([, r]) => r.page), [1, 2]);
});

for (const [name, change, hold, status] of [
  ['missing account field', (f) => { delete f.details.synthetic_customer.zcrm_account_id; }, 'malformed_identity'],
  ['missing contact field', (f) => { delete f.details.synthetic_customer.zcrm_contact_id; }, 'malformed_identity'],
  ['missing linked flag', (f) => { delete f.details.synthetic_customer.is_linked_with_zohocrm; }, 'customer_linkage_unread'],
  ['false linked flag with account', (f) => { f.details.synthetic_customer.is_linked_with_zohocrm = false; }, 'customer_linkage_conflict', 'conflict'],
  ['true linked flag without identities', (f) => { f.details.synthetic_unlinked.is_linked_with_zohocrm = true; }, 'customer_linkage_conflict', 'conflict'],
  ['duplicate target account', (f) => { f.details.synthetic_contact_only.zcrm_account_id = 'synthetic_account'; }, 'ambiguous_current_relationship', 'conflict'],
  ['wrong detail customer', (f) => { f.details.synthetic_customer.customer_id = 'foreign'; }, 'customer_detail_conflict', 'conflict'],
  ['missing subscription reference', (f) => { delete f.sub.reference_id; }, 'malformed_identity'],
  ['foreign subscription owner', (f) => { f.sub.customer_id = 'synthetic_unlinked'; }, 'subscription_customer_conflict', 'conflict'],
]) {
  test(`${name} fails closed`, async () => { const f = fixture(); change(f); await expectHold(f, hold, status); });
}

for (const [name, patch] of [
  ['no page context', (r) => { delete r.page_context; }],
  ['missing terminal marker', (r) => { delete r.page_context.has_more_page; }],
  ['string terminal marker', (r) => { r.page_context.has_more_page = 'false'; }],
  ['wrong page', (r) => { r.page_context.page = 2; }],
  ['wrong page size', (r) => { r.page_context.per_page = 10; }],
  ['no item array', (r) => { delete r.customers; }],
]) {
  test(`${name} cannot count as complete pagination`, async () => {
    const f = fixture(); const original = f.input.reads.readCustomerPage;
    f.input.reads.readCustomerPage = async (args) => { const response = await original(args); patch(response); return response; };
    await expectHold(f, 'page_unqualified');
    assert.equal(f.calls.length, 2);
  });
}

test('duplicate IDs, even across pages, are not deduplicated into completeness', async () => {
  const f = fixture();
  f.input.reads.readCustomerPage = async (r) => f.page('customers', [{ customer_id: 'synthetic_customer' }], r, r.page === 1);
  await expectHold(f, 'duplicate_list_identity', 'conflict');
});

test('duplicate exact subscription references cannot select the first match', async () => {
  const f = fixture();
  f.input.reads.readSubscriptionPage = async (r) => f.page('subscriptions', [f.sub,
    { ...f.sub, subscription_id: 'synthetic_second' }], r);
  await expectHold(f, 'ambiguous_current_relationship', 'conflict');
});

test('optional customer linkage in list must agree with independently read detail', async () => {
  const f = fixture();
  f.input.reads.readCustomerPage = async (r) => f.page('customers', [
    { customer_id: 'synthetic_customer', zcrm_account_id: 'foreign' }], r);
  await expectHold(f, 'customer_list_detail_conflict', 'conflict');
});

test('selected customer is independently reread; movement during sweep fails closed', async () => {
  const f = fixture(); let selectedReads = 0;
  const original = f.input.reads.readCustomer;
  f.input.reads.readCustomer = async (r) => {
    const response = await original(r);
    if (r.customerId === 'synthetic_customer' && ++selectedReads > 1) response.customer.zcrm_account_id = 'foreign';
    return response;
  };
  await expectHold(f, 'selected_detail_changed', 'conflict');
});

test('selected subscription detail must agree with list', async () => {
  const f = fixture();
  f.input.reads.readSubscription = async () => ({ code: 0, subscription: { ...f.sub, reference_id: 'foreign' } });
  await expectHold(f, 'selected_detail_changed', 'conflict');
});

test('empty current inventory is missing, never history or permission to create', async () => {
  const f = fixture();
  f.input.reads.readSubscriptionPage = async (r) => f.page('subscriptions', [], r);
  const result = await collectBillingReadEvidence(f.input);
  noncharging(result);
  assert.equal(result.status, 'missing');
  assert.equal(result.observation.selectedCustomer, null);
  assert.equal(result.observation.selectedSubscription, null);
  assert.equal(f.calls.some(([name]) => name === 'subscription'), false);
});

for (const [name, limits, hold] of [
  ['item', { maxItems: 2 }, 'item_budget_exceeded'],
  ['read', { maxReads: 1 }, 'read_budget_exceeded'],
  ['page', { maxPages: 1 }, 'page_budget_exceeded'],
]) {
  test(`${name} budget stops without promoting partial evidence`, async () => {
    const f = fixture(); f.input.limits = limits;
    if (name === 'page') f.input.reads.readCustomerPage = async (r) => f.page('customers', [{ customer_id: 'synthetic_customer' }], r, true);
    await expectHold(f, hold);
    if (name === 'read') assert.equal(f.calls.length, 1);
  });
}

test('oversized array and empty continuation are rejected', async () => {
  const f = fixture(); f.input.limits = { perPage: 2 };
  await expectHold(f, 'page_unqualified');
  const g = fixture(); g.input.reads.readCustomerPage = async (r) => g.page('customers', [], r, true);
  await expectHold(g, 'empty_continuation_page');
});

for (const limits of [{ perPage: 201 }, { maxPages: 26 }, { maxItems: 1001 }, { maxReads: 1101 },
  { timeoutMs: 3001 }, { timeoutMs: 0 }, { maxPages: 1.5 }, { maxPages: Infinity }, { arbitrary: true }]) {
  test(`invalid or unbounded limits are rejected: ${JSON.stringify(limits)}`, async () => {
    const f = fixture(); f.input.limits = limits;
    const result = await collectBillingReadEvidence(f.input);
    assert.equal(result.status, 'read_unavailable');
    assert.equal(f.calls.length, 0);
  });
}

test('provider failures are sanitized, are not retried, and do not return partial evidence', async () => {
  for (const behavior of ['throw', 'code']) {
    const f = fixture(); let attempts = 0;
    f.input.reads.readCustomer = async () => {
      attempts += 1;
      if (behavior === 'throw') throw new Error('SECRET_URL_TOKEN private@example.invalid');
      return { code: 57, message: 'SECRET_URL_TOKEN private@example.invalid' };
    };
    const result = await collectBillingReadEvidence(f.input);
    noncharging(result);
    assert.equal(result.status, 'read_unavailable');
    assert.equal(result.observation, null);
    assert.equal(attempts, 1);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|private@/);
  }
});

test('deadline aborts shared signal and late resolution never launches subsequent reads', async () => {
  const f = fixture(); f.input.limits = { timeoutMs: 5 };
  let release; let request;
  f.input.reads.readCustomerPage = (r) => { request = r; return new Promise((resolve) => { release = resolve; }); };
  const result = await collectBillingReadEvidence(f.input);
  noncharging(result);
  assert.ok(result.holds.includes('read_deadline_exceeded'));
  assert.equal(request.signal.aborted, true);
  release(f.page('customers', [{ customer_id: 'synthetic_customer' }], request));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(f.calls.map(([name]) => name), ['organization']);
  assert.equal(result.counts.reads, 2);
});

test('caller mutation cannot retarget reads, change limits or replace captured methods', async () => {
  const f = fixture(); const original = f.input.reads.readCustomerPage;
  f.input.reads.readCustomerPage = async (r) => {
    f.input.target.crmAccountId = 'foreign'; f.input.target.subscriptionReference = 'foreign';
    f.input.limits = { maxReads: 1 };
    f.input.reads.readSubscription = () => { throw new Error('replacement must not run'); };
    return original(r);
  };
  const result = await collectBillingReadEvidence(f.input);
  assert.equal(result.status, 'held_evidence_only');
  assert.equal(result.observation.requestedTarget.crmAccountId, 'synthetic_account');
});

test('an immediate but slow reader cannot outrun the timer through microtask scheduling', async () => {
  const f = fixture(); f.input.limits = { timeoutMs: 1 };
  f.input.reads.readCustomerPage = (request) => {
    const end = performance.now() + 5;
    while (performance.now() < end) { /* Synthetic synchronous work; no I/O. */ }
    return f.page('customers', [{ customer_id: 'synthetic_customer' }], request);
  };
  const result = await collectBillingReadEvidence(f.input);
  noncharging(result);
  assert.ok(result.holds.includes('read_deadline_exceeded'));
  assert.equal(result.counts.reads, 2);
  assert.equal(f.calls.length, 1);
});

test('historical inputs, unqualified scope and mixed write clients cannot extend the seam', async () => {
  for (const field of ['historicalMapping', 'scope', 'readStatus', 'billingAuthority']) {
    const f = fixture(); f.input[field] = true;
    await expectHold(f, 'invalid_collector_input'); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.input.reads.createSubscription = () => { throw new Error('write must not run'); };
  await expectHold(f, 'invalid_collector_input'); assert.equal(f.calls.length, 0);
});

test('observations cannot satisfy existing reconciliation or establish historical mapping', async () => {
  const f = fixture(); const snapshot = await collectBillingReadEvidence(f.input);
  const scope = { environment: 'development', clientId: 'synthetic_client', deploymentId: 'synthetic_deployment',
    configurationVersionId: 'synthetic_configuration', configurationVersion: 'v1',
    crmAccountId: 'synthetic_account', crmDealId: 'synthetic_deal',
    billingOrganizationId: 'synthetic_organization', billingMode: 'test' };
  const current = reconcileBillingLink({ scope, snapshot,
    attribution: { kind: 'current', subscriptionReference: 'synthetic_reference' } });
  assert.notEqual(current.status, 'verified');
  const historical = reconcileBillingLink({ scope, snapshot,
    attribution: { kind: 'historical', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z' } });
  assert.notEqual(historical.status, 'verified');
  assert.equal(historical.billingAuthority, false);
});
