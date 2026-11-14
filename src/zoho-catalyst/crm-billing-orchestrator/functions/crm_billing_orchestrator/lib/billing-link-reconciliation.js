'use strict';

const { performance } = require('node:perf_hooks');

// Deliberately independent of lifecycle-handler and the write-capable clients.
// These are normalized read snapshots, not assumed live provider response shapes.
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const id = (value) => typeof value === 'string' && ID.test(value);
const iso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const SCOPE_FIELDS = ['environment', 'clientId', 'deploymentId', 'configurationVersionId',
  'configurationVersion', 'crmAccountId', 'crmDealId', 'billingOrganizationId', 'billingMode'];

function result(status, reason, link = null) {
  return Object.freeze({ schemaVersion: 1, status, holds: Object.freeze(reason ? [reason] : []),
    link: link && Object.freeze(link), billableMinutes: null, chargeMinor: null, billingAuthority: false });
}

function validScope(scope) {
  return object(scope) && SCOPE_FIELDS.every((key) => id(scope[key]))
    && ['development', 'production'].includes(scope.environment)
    && ['test', 'live'].includes(scope.billingMode);
}

function sameScope(expected, observed) {
  return object(observed) && SCOPE_FIELDS.every((key) => observed[key] === expected[key]);
}

function exactMatch(pages, referenceField, reference) {
  if (!Array.isArray(pages) || !pages.length || pages.length > 25) {
    return { failure: result('read_unavailable', 'pagination_incomplete') };
  }
  const matches = [];
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (!object(page) || page.page !== index + 1
      || page.hasMorePage !== (index < pages.length - 1)
      || !Array.isArray(page.items) || page.items.some((item) => !object(item)
        || !id(item[referenceField]) || !id(item.customerId)
        || (referenceField === 'referenceId' && !id(item.subscriptionId)))) {
      return { failure: result('read_unavailable', 'pagination_incomplete') };
    }
    // As in billing-client: a contains-search is never an exact identity proof.
    matches.push(...page.items.filter((item) => item[referenceField] === reference));
  }
  if (matches.length > 1) return { failure: result('conflict', 'reference_not_unique') };
  return { match: matches[0] ?? null };
}

/** Read-only relationship proof; never verifies commercial terms or entitlement.
 * attribution.kind must explicitly distinguish a present link from historical usage.
 */
function reconcileBillingLink({ scope, snapshot, attribution } = {}) {
  if (!validScope(scope)) return result('conflict', 'scope_invalid');
  if (!object(attribution) || !['current', 'historical'].includes(attribution.kind)) {
    return result('conflict', 'attribution_required');
  }
  let effectiveMapping = null;
  if (attribution.kind === 'historical') {
    const mapping = attribution.mapping;
    if (!sameScope(scope, mapping) || !id(mapping.evidenceReference)
      || !id(mapping.billingCustomerId) || !id(mapping.billingSubscriptionId)
      || !id(mapping.subscriptionReference) || !iso(mapping.effectiveFrom) || !iso(mapping.effectiveTo)
      || mapping.effectiveFrom >= mapping.effectiveTo || !iso(attribution.startedAt)
      || !iso(attribution.endedAt) || attribution.startedAt > attribution.endedAt
      || attribution.startedAt < mapping.effectiveFrom || attribution.startedAt >= mapping.effectiveTo
      || attribution.endedAt > mapping.effectiveTo) {
      return result('conflict', 'historical_link_unresolved');
    }
    effectiveMapping = mapping;
  }
  if (!object(snapshot) || snapshot.readStatus !== 'complete') {
    return result('read_unavailable', 'read_unavailable');
  }
  // Each independently read system must attest the full requested scope. This
  // prevents combining CRM evidence from one tenant with another Billing org.
  if (!sameScope(scope, snapshot.crm?.scope) || !sameScope(scope, snapshot.billing?.scope)) {
    return result('conflict', 'scope_conflict');
  }
  const { account, deal } = snapshot.crm;
  if (account === null || deal === null) return result('missing', 'crm_relationship_missing');
  if (!object(account) || !object(deal)) return result('read_unavailable', 'crm_read_incomplete');
  if (account.id !== scope.crmAccountId || deal.id !== scope.crmDealId
    || deal.Account_Name?.id !== account.id) return result('conflict', 'crm_relationship_conflict');
  // Current mutable Deal fields are never used to backfill historical ownership.
  const customerId = effectiveMapping?.billingCustomerId ?? deal.Billing_Customer_ID;
  const subscriptionId = effectiveMapping?.billingSubscriptionId ?? deal.Billing_Subscription_ID;
  const reference = effectiveMapping?.subscriptionReference ?? attribution.subscriptionReference;
  if (!id(reference)) return result('missing', 'subscription_reference_missing');
  for (const value of [customerId, subscriptionId]) {
    if (value === undefined) return result('read_unavailable', 'crm_read_incomplete');
    if (value === null || value === '') return result('missing', 'billing_ids_missing');
    if (!id(value)) return result('conflict', 'billing_ids_invalid');
  }
  const billing = snapshot.billing;
  const customers = exactMatch(billing.customerPages, 'crmAccountId', scope.crmAccountId);
  if (customers.failure) return customers.failure;
  const subscriptions = exactMatch(billing.subscriptionPages, 'referenceId', reference);
  if (subscriptions.failure) return subscriptions.failure;
  if (!customers.match || !subscriptions.match) return result('missing', 'billing_reference_missing');
  if (customers.match.customerId !== customerId || subscriptions.match.subscriptionId !== subscriptionId
    || subscriptions.match.customerId !== customerId) return result('conflict', 'billing_reference_conflict');
  // Independently read detail records must agree with both exact-reference lists.
  if (billing.customer === null || billing.subscription === null) return result('missing', 'billing_record_missing');
  if (!object(billing.customer) || !object(billing.subscription)) {
    return result('read_unavailable', 'billing_read_incomplete');
  }
  if (billing.customer.customerId !== customerId || billing.customer.crmAccountId !== scope.crmAccountId
    || billing.subscription.subscriptionId !== subscriptionId
    || billing.subscription.customerId !== customerId || billing.subscription.referenceId !== reference) {
    return result('conflict', 'billing_relationship_conflict');
  }
  return result('verified', null, { ...Object.fromEntries(SCOPE_FIELDS.map((key) => [key, scope[key]])),
    billingCustomerId: customerId, billingSubscriptionId: subscriptionId,
    attribution: attribution.kind,
    effectiveFrom: effectiveMapping?.effectiveFrom ?? null, effectiveTo: effectiveMapping?.effectiveTo ?? null });
}

/** Inject only a bounded, read-only snapshot reader. No credentials/SDK/write
 * authority are created here. The reader owns transport bounds, pagination and
 * attestation, and must propagate the shared signal for cooperative cancellation.
 */
async function readBillingLink({ scope, attribution, readSnapshot, timeoutMs = 3000 } = {}) {
  // Reject unresolved history before even asking for a present-day snapshot.
  const preflight = reconcileBillingLink({ scope, attribution });
  if (preflight.status !== 'read_unavailable') return preflight;
  if (typeof readSnapshot !== 'function') return result('read_unavailable', 'read_unavailable');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3000) {
    return result('conflict', 'read_deadline_invalid');
  }
  const controller = new AbortController();
  const deadlineAt = performance.now() + timeoutMs;
  let timer;
  let output;
  try {
    // Capture the request before awaiting; later caller/reader mutation must not
    // retarget the relationship being checked. A timed-out read is never retried.
    const selectedScope = Object.freeze(Object.fromEntries(SCOPE_FIELDS.map((key) => [key, scope[key]])));
    const selectedAttribution = structuredClone(attribution);
    const checkpoint = () => {
      if (controller.signal.aborted || performance.now() >= deadlineAt) {
        throw new Error('read_deadline_exceeded');
      }
    };
    const work = async () => {
      checkpoint();
      const snapshot = await readSnapshot(Object.freeze({ scope: selectedScope,
        attribution: structuredClone(selectedAttribution), signal: controller.signal }));
      // A timer alone cannot reject a synchronous or microtask-only dependency
      // before it returns. Never accept a snapshot or result after the deadline.
      checkpoint();
      const output = reconcileBillingLink({ scope: selectedScope, attribution: selectedAttribution, snapshot });
      checkpoint();
      return output;
    };
    output = await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('read_deadline_exceeded'));
      }, Math.max(0, deadlineAt - performance.now()));
    })]);
  } catch {
    // Do not expose dependency messages, response bodies, identifiers or URLs.
    output = result('read_unavailable', 'read_unavailable');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  // Promise settlement and synchronous abort listeners can consume time after
  // work's last checkpoint. Include them before selecting the final outcome.
  return performance.now() >= deadlineAt ? result('read_unavailable', 'read_unavailable') : output;
}

module.exports = { reconcileBillingLink, readBillingLink };
