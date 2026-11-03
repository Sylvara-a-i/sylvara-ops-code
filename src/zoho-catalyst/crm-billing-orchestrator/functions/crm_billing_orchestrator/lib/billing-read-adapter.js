'use strict';

const { performance } = require('node:perf_hooks');
const { requestJson } = require('./http');

// Matches the existing approved US API boundary. No caller-supplied origin,
// path, headers, credential link, HTTP method or write-capable client is accepted.
const API_BASE = 'https://www.zohoapis.com/billing/v1';
const RECORD_ID = /^[1-9][0-9]{7,29}$/;
const AUTHORIZATION = /^Zoho-oauthtoken [A-Za-z0-9._-]{16,4096}$/;
const plain = (value) => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactKeys = (value, keys) => plain(value)
  && Reflect.ownKeys(value).every((key) => keys.includes(key));
const boundedInteger = (value, minimum, maximum) => Number.isSafeInteger(value)
  && value >= minimum && value <= maximum;

class BillingReadAdapterError extends Error {
  constructor(code = 'billing_read_unavailable') {
    super('Billing read evidence is unavailable');
    this.name = 'BillingReadAdapterError';
    this.publicCode = code;
  }
}
const fail = (code) => { throw new BillingReadAdapterError(code); };
function recordId(value) {
  if (typeof value !== 'string' || !RECORD_ID.test(value)) fail('billing_read_request_invalid');
  return value;
}

/**
 * Four fixed GET readers for collectBillingReadEvidence. Deliberately unwired.
 * A configured organization is a request destination, not verified caller/tenant
 * identity, Billing mode, snapshot consistency or historical ownership.
 * Both dependencies must be supplied explicitly; no SDK or credential discovery.
 */
function createBillingReadAdapter(configuration, dependencies) {
  if (!exactKeys(configuration, ['billingOrganizationId', 'timeoutMs', 'maximumBytes'])
    || typeof configuration.billingOrganizationId !== 'string'
    || !RECORD_ID.test(configuration.billingOrganizationId)
    || !exactKeys(dependencies, ['readAuthorizationProvider', 'fetchImpl'])
    || typeof dependencies.readAuthorizationProvider !== 'function'
    || typeof dependencies.fetchImpl !== 'function') fail('billing_read_configuration_invalid');
  const binding = Object.freeze({ billingOrganizationId: configuration.billingOrganizationId,
    timeoutMs: configuration.timeoutMs === undefined ? 3000 : configuration.timeoutMs,
    maximumBytes: configuration.maximumBytes === undefined ? 262144 : configuration.maximumBytes });
  if (!boundedInteger(binding.timeoutMs, 1, 3000)
    || !boundedInteger(binding.maximumBytes, 1, 524288)) fail('billing_read_configuration_invalid');
  const authorize = dependencies.readAuthorizationProvider;
  const fetchImpl = dependencies.fetchImpl;

  function signalFor(request, keys) {
    if (!exactKeys(request, [...keys, 'signal']) || !(request.signal instanceof AbortSignal)) {
      fail('billing_read_request_invalid');
    }
    return request.signal;
  }
  async function get(path, member, callerSignal, query = null) {
    if (callerSignal.aborted) fail();
    const url = new URL(`${API_BASE}${path}`);
    if (query) for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const controller = new AbortController();
    const expiresAt = performance.now() + binding.timeoutMs;
    let rejectCancelled;
    const cancellation = new Promise((_, reject) => { rejectCancelled = reject; });
    const cancel = () => {
      controller.abort();
      rejectCancelled(new BillingReadAdapterError());
    };
    const active = () => {
      if (controller.signal.aborted || performance.now() >= expiresAt) fail();
    };
    callerSignal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, binding.timeoutMs);
    const run = async () => {
      active();
      const token = await authorize(Object.freeze({ signal: controller.signal }));
      active();
      if (typeof token !== 'string' || !AUTHORIZATION.test(token)) fail();
      // The same deadline covers authorization, headers, bounded body decoding
      // and validation. The parent signal aborts the actual transport/body too.
      const remainingMs = Math.max(1, Math.floor(expiresAt - performance.now()));
      const response = await requestJson(url.toString(), {
        method: 'GET', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: token,
          'X-com-zoho-subscriptions-organizationid': binding.billingOrganizationId },
      }, { timeoutMs: remainingMs, maximumBytes: binding.maximumBytes, sideEffecting: false }, fetchImpl);
      active();
      const body = response.json;
      if (response.status !== 200 || !plain(body) || body.code !== 0
        || (member.endsWith('s') ? !Array.isArray(body[member]) : !plain(body[member]))) fail();
      return body;
    };
    try { return await Promise.race([run(), cancellation]); }
    catch { throw new BillingReadAdapterError(); }
    finally {
      clearTimeout(timer);
      callerSignal.removeEventListener('abort', cancel);
      controller.abort();
    }
  }
  function pageQuery(request, subscriptions) {
    if (!boundedInteger(request.page, 1, 25) || !boundedInteger(request.perPage, 1, 200)
      || (subscriptions && request.filterBy !== 'SubscriptionStatus.All')) {
      fail('billing_read_request_invalid');
    }
    // 200 is this adapter's local ceiling, not a claimed provider maximum.
    return { filter_by: subscriptions ? 'SubscriptionStatus.All' : 'Status.All',
      page: request.page, per_page: request.perPage };
  }
  return Object.freeze({
    readCustomerPage(request) {
      const signal = signalFor(request, ['page', 'perPage']);
      return get('/customers', 'customers', signal, pageQuery(request, false));
    },
    readCustomer(request) {
      const signal = signalFor(request, ['customerId']);
      return get(`/customers/${recordId(request.customerId)}`, 'customer', signal);
    },
    readSubscriptionPage(request) {
      const signal = signalFor(request, ['page', 'perPage', 'filterBy']);
      return get('/subscriptions', 'subscriptions', signal, pageQuery(request, true));
    },
    readSubscription(request) {
      const signal = signalFor(request, ['subscriptionId']);
      return get(`/subscriptions/${recordId(request.subscriptionId)}`, 'subscription', signal);
    },
  });
}

module.exports = { BillingReadAdapterError, createBillingReadAdapter };
