'use strict';

const { performance } = require('node:perf_hooks');

// Private preparation seam, deliberately unwired. The injected readers must be
// reviewed, fixed-origin/organization GET-only adapters. Their names alone do
// not establish their permission, caller identity, scope or cancellation.
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const METHODS = ['readOrganization', 'readCustomerPage', 'readCustomer', 'readSubscriptionPage', 'readSubscription'];
const DEFAULTS = Object.freeze({ perPage: 100, maxPages: 5, maxItems: 250, maxReads: 300, timeoutMs: 3000 });
const CEILINGS = Object.freeze({ perPage: 200, maxPages: 25, maxItems: 1000, maxReads: 1100, timeoutMs: 3000 });
const BASE_HOLDS = ['execution_boundary_unqualified', 'snapshot_consistency_unqualified',
  'historical_mapping_not_established'];
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plain = (object) => object !== null && typeof object === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(object));

class HeldRead extends Error {
  constructor(code, status = 'read_unavailable') { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new HeldRead(code, status); };
function exactKeys(value, keys) {
  return plain(value) && Reflect.ownKeys(value).every((key) => keys.includes(key));
}
function id(value) {
  if (typeof value !== 'string' || !ID.test(value)) fail('malformed_identity');
  return value;
}
function nullableId(value) { return value === '' ? null : id(value); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function customer(row) {
  if (!plain(row) || typeof row.is_linked_with_zohocrm !== 'boolean') fail('customer_linkage_unread');
  const result = { customerId: id(row.customer_id), crmAccountId: nullableId(row.zcrm_account_id),
    crmContactId: nullableId(row.zcrm_contact_id), linkedWithCrm: row.is_linked_with_zohocrm };
  if (result.linkedWithCrm !== Boolean(result.crmAccountId || result.crmContactId)) {
    fail('customer_linkage_conflict', 'conflict');
  }
  return result;
}
function subscription(row) {
  if (!plain(row)) fail('malformed_subscription');
  return { subscriptionId: id(row.subscription_id), customerId: id(row.customer_id),
    referenceId: nullableId(row.reference_id) };
}
function same(left, right) { return Object.keys(left).every((key) => left[key] === right[key]); }

/**
 * Collect bounded current Billing observations, never a qualified snapshot.
 * Accepts parsed native API response bodies, not connector transport envelopes.
 * No CRM writes, financial writes, credentials, network library, persistence,
 * production wiring or historical inference exists in this module.
 */
async function collectBillingReadEvidence(input) {
  const counts = { reads: 0, organizations: 0, customerPages: 0, subscriptionPages: 0, customers: 0, subscriptions: 0 };
  const finish = (status, hold, observation = null) => freeze({ schemaVersion: 1, status,
    readStatus: 'incomplete', holds: [...BASE_HOLDS, ...(hold ? [hold] : [])],
    observation, historicalMapping: null, billableMinutes: null, chargeMinor: null,
    billingAuthority: false, counts: { ...counts } });
  let stopped = false;
  let timer;
  const controller = new AbortController();
  try {
    if (!exactKeys(input, ['target', 'reads', 'limits'])
      || !exactKeys(input.target, ['crmAccountId', 'subscriptionReference', 'billingOrganizationId', 'billingMode'])
      || !exactKeys(input.reads, METHODS)
      || METHODS.some((method) => typeof input.reads[method] !== 'function')
      || (input.limits !== undefined && !exactKeys(input.limits, Object.keys(DEFAULTS)))) {
      fail('invalid_collector_input');
    }
    // Capture all caller-owned inputs before the first await. No input field is
    // interpreted as attestation of an execution identity or historical owner.
    const target = Object.freeze({ crmAccountId: id(input.target.crmAccountId),
      subscriptionReference: id(input.target.subscriptionReference),
      billingOrganizationId: id(input.target.billingOrganizationId), billingMode: input.target.billingMode });
    if (!['test', 'live'].includes(target.billingMode)) fail('invalid_collector_input');
    const readers = Object.freeze(Object.fromEntries(METHODS.map((name) => [name, input.reads[name]])));
    const limits = Object.freeze({ ...DEFAULTS, ...input.limits });
    if (Object.entries(limits).some(([key, value]) => !Number.isSafeInteger(value)
      || value < 1 || value > CEILINGS[key])) fail('invalid_collector_limits');
    const deadlineAt = performance.now() + limits.timeoutMs;
    const expired = () => stopped || performance.now() >= deadlineAt;
    const checkpoint = () => {
      if (expired()) { stopped = true; controller.abort(); fail('read_deadline_exceeded'); }
    };

    const read = async (method, args) => {
      checkpoint();
      if (counts.reads >= limits.maxReads) fail('read_budget_exceeded');
      counts.reads += 1;
      let response;
      try { response = await readers[method](Object.freeze({ ...args, signal: controller.signal })); }
      catch { fail(expired() ? 'read_deadline_exceeded' : 'provider_read_failed'); }
      checkpoint();
      if (!plain(response) || response.code !== 0) fail('provider_response_unqualified');
      return response;
    };
    const customerDetail = async (customerId) => {
      const response = await read('readCustomer', { customerId });
      const detail = customer(response.customer);
      if (detail.customerId !== customerId) fail('customer_detail_conflict', 'conflict');
      return detail;
    };
    const organizationDetail = async () => {
      const response = await read('readOrganization', {});
      counts.organizations += 1;
      const native = response.organization;
      if (!plain(native) || typeof native.organization_id !== 'string'
        || !ID.test(native.organization_id) || !['test', 'live'].includes(native.mode)) {
        fail('organization_identity_unread');
      }
      if (native.organization_id !== target.billingOrganizationId || native.mode !== target.billingMode) {
        fail('organization_identity_conflict', 'conflict');
      }
      // Only the provider-observed destination and mode are retained. This is
      // not caller authentication, a consistent snapshot or usage entitlement.
      return { organizationId: native.organization_id, mode: native.mode };
    };
    const collect = async (kind) => {
      const customers = kind === 'customers';
      const result = [];
      const seen = new Set();
      const key = customers ? 'customer_id' : 'subscription_id';
      for (let page = 1; page <= limits.maxPages; page += 1) {
        const response = await read(customers ? 'readCustomerPage' : 'readSubscriptionPage', {
          page, perPage: limits.perPage, ...(!customers ? { filterBy: 'SubscriptionStatus.All' } : {}) });
        counts[customers ? 'customerPages' : 'subscriptionPages'] += 1;
        const context = response.page_context;
        if (!plain(context) || context.page !== page || context.per_page !== limits.perPage
          || typeof context.has_more_page !== 'boolean' || !Array.isArray(response[kind])
          || response[kind].length > limits.perPage) fail('page_unqualified');
        // Capture only allowlisted primitive fields before any detail await.
        const listed = response[kind].map((row) => {
          if (!plain(row)) fail('malformed_list_item');
          const selectedId = id(row[key]);
          if (seen.has(selectedId)) fail('duplicate_list_identity', 'conflict');
          seen.add(selectedId);
          if (counts.customers + counts.subscriptions >= limits.maxItems) fail('item_budget_exceeded');
          counts[kind] += 1;
          if (!customers) return subscription(row);
          const optional = {};
          for (const field of ['zcrm_account_id', 'zcrm_contact_id', 'is_linked_with_zohocrm']) {
            if (own(row, field)) optional[field] = row[field];
          }
          return { customerId: selectedId, optional };
        });
        // The final page marker is an observation, never atomicity evidence.
        const hasMore = context.has_more_page;
        if (hasMore && listed.length === 0) fail('empty_continuation_page');
        for (const item of listed) {
          if (!customers) { result.push(item); continue; }
          const detail = await customerDetail(item.customerId);
          const fields = { zcrm_account_id: detail.crmAccountId || '',
            zcrm_contact_id: detail.crmContactId || '', is_linked_with_zohocrm: detail.linkedWithCrm };
          if (Object.keys(item.optional).some((field) => item.optional[field] !== fields[field])) {
            fail('customer_list_detail_conflict', 'conflict');
          }
          result.push(detail);
        }
        if (!hasMore) return result;
      }
      fail('page_budget_exceeded');
    };
    const work = async () => {
      const organization = await organizationDetail();
      const customers = await collect('customers');
      const subscriptions = await collect('subscriptions');
      const matchingCustomers = customers.filter((item) => item.crmAccountId === target.crmAccountId);
      const matchingSubscriptions = subscriptions.filter((item) => item.referenceId === target.subscriptionReference);
      if (matchingCustomers.length > 1 || matchingSubscriptions.length > 1) {
        fail('ambiguous_current_relationship', 'conflict');
      }
      const observation = { kind: 'current_only', requestedTarget: target,
        sweepEnded: true, atomicSnapshotEstablished: false, organization, customers, subscriptions,
        selectedCustomer: null, selectedSubscription: null };
      if (!matchingCustomers.length || !matchingSubscriptions.length) {
        await organizationDetail();
        checkpoint();
        return finish('missing', 'current_relationship_missing', observation);
      }
      const selectedCustomer = matchingCustomers[0];
      const selectedSubscription = matchingSubscriptions[0];
      if (selectedSubscription.customerId !== selectedCustomer.customerId) {
        fail('subscription_customer_conflict', 'conflict');
      }
      const response = await read('readSubscription', { subscriptionId: selectedSubscription.subscriptionId });
      const subDetail = subscription(response.subscription);
      if (!same(selectedSubscription, subDetail)) fail('selected_detail_changed', 'conflict');
      const custDetail = await customerDetail(selectedCustomer.customerId);
      if (!same(selectedCustomer, custDetail)) {
        fail('selected_detail_changed', 'conflict');
      }
      observation.selectedCustomer = custDetail;
      observation.selectedSubscription = subDetail;
      await organizationDetail();
      checkpoint();
      return finish('held_evidence_only', null, observation);
    };
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        stopped = true;
        controller.abort();
        resolve(finish('read_unavailable', 'read_deadline_exceeded'));
      }, limits.timeoutMs);
    });
    return await Promise.race([work(), deadline]);
  } catch (error) {
    return finish(error instanceof HeldRead ? error.status : 'read_unavailable',
      error instanceof HeldRead ? error.code : 'collector_read_failed');
  } finally {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
  }
}

module.exports = { collectBillingReadEvidence };
