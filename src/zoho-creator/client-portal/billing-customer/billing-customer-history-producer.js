"use strict";

const { prepareBillingCustomerHistoryView: project } = require("./billing-customer-view-contract");

function invalid() { throw new TypeError("Invalid billing history producer evidence"); }

function record(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const keys = Reflect.ownKeys(value);
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      keys.some((key) => ![...required, ...optional].includes(key))) invalid();
  for (const key of keys) {
    if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value")) invalid();
  }
}

function array(value, limit) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) invalid();
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) invalid();
  }
}

// Called only after shape validation; preserve non-enumerable data fields and
// sever caller references before the first await. This does not create trust.
function snapshot(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(snapshot));
  return Object.freeze(Object.fromEntries(Reflect.ownKeys(value).map((key) => [key, snapshot(value[key])])));
}

function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) invalid();
  return ms;
}

function currency(value, currencies) {
  if (value === null) return null;
  record(value, ["code", "minorUnitExponent", "source"]);
  if (!["invoice-response", "verified-invoice-metadata"].includes(value.source) ||
      !currencies.some((c) => c.code === value.code && c.minorUnitExponent === value.minorUnitExponent)) invalid();
  return snapshot(value);
}

function amount(value, unit, exponent) {
  if (value === null || value === undefined) return null;
  if (unit === "minor" && typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) invalid();
    return value;
  }
  if (typeof value !== "string" || value.length > 40 ||
      !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) invalid();
  const [whole, fraction = ""] = value.split(".");
  if (unit === "minor" && fraction.length) invalid();
  const places = unit === "minor" ? 0 : exponent;
  if (/[^0]/.test(fraction.slice(places))) invalid();
  const result = BigInt(whole) * (10n ** BigInt(places)) +
    BigInt(fraction.slice(0, places).padEnd(places, "0") || "0");
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  return Number(result);
}

function money(value, currencies) {
  const unknown = { totalMinor: null, balanceMinor: null, amountUnit: null, currency: null };
  if (value === null || value === undefined) return unknown;
  record(value, ["unit", "currency"], ["total", "balance"]);
  if (![null, "minor", "major"].includes(value.unit)) invalid();
  const c = currency(value.currency, currencies);
  if (value.unit === null) {
    if (value.total != null || value.balance != null) invalid();
    return { ...unknown, currency: c };
  }
  // Without currency there is no exponent or display authority. Do not assume
  // USD, coerce a floating-point amount, or label it as a known zero.
  if (c === null) return unknown;
  return { totalMinor: amount(value.total, value.unit, c.minorUnitExponent),
    balanceMinor: amount(value.balance, value.unit, c.minorUnitExponent), amountUnit: "minor", currency: c };
}

function normalize(item, resource, binding, currencies) {
  const fields = resource === "subscriptions"
    ? ["organizationId", "subscriptionId", "customerId", "planCode", "planLabel"]
    : ["organizationId", "invoiceId", "customerId", "number"];
  const optional = resource === "subscriptions"
    ? ["status", "termStart", "termEnd", "nextBillingOn"]
    : ["status", "issuedOn", "dueOn", "money"];
  record(item, fields, optional);
  if (item.organizationId !== binding.organizationId || item.customerId !== binding.customerId) invalid();
  // Explicit known statuses are checked by the existing view; unfamiliar values
  // fail the collection instead of being interpreted as paid/active.
  if (resource === "subscriptions") return {
    subscriptionId: item.subscriptionId, customerId: item.customerId,
    planCode: item.planCode, planLabel: item.planLabel, status: item.status ?? "unknown",
    termStart: item.termStart ?? null, termEnd: item.termEnd ?? null, nextBillingOn: item.nextBillingOn ?? null,
  };
  return { invoiceId: item.invoiceId, customerId: item.customerId, number: item.number,
    status: item.status ?? "unknown", issuedOn: item.issuedOn ?? null, dueOn: item.dueOn ?? null,
    money: money(item.money, currencies) };
}

function outcome(state, reason = null) { return Object.freeze({ state, reason }); }

// Offline protocol only. `get` must be supplied by a trusted composition root;
// there are no URLs, credentials, provider clients, retries or writer methods.
// Neither request selectors nor provider envelopes can populate `trusted`.
async function produceBillingCustomerHistory(input, trusted, policy, get, limits) {
  // Let the existing contract validate authority before touching transport.
  record(policy, ["expectedEnvironment", "expectedOrganizationId", "asOf", "maxAgeMs", "featureCode", "featurePolicyRevision"]);
  const empty = { environment: policy.expectedEnvironment, organizationId: policy.expectedOrganizationId,
    observedAt: policy.asOf, complete: true, customer: null,
    subscriptions: null, invoices: null, payments: null, integrations: null };
  project(input, trusted, empty, policy);
  record(limits, ["maxPages", "pageSize", "currencies"]);
  if (typeof get !== "function" || !Number.isSafeInteger(limits.maxPages) || limits.maxPages < 1 || limits.maxPages > 100 ||
      !Number.isSafeInteger(limits.pageSize) || limits.pageSize < 1 || limits.pageSize > 200) invalid();
  array(limits.currencies, 100);
  const codes = new Set();
  for (const c of limits.currencies) {
    record(c, ["code", "minorUnitExponent"]);
    if (typeof c.code !== "string" || !/^[A-Z]{3}$/.test(c.code) || codes.has(c.code) ||
        !Number.isSafeInteger(c.minorUnitExponent) || c.minorUnitExponent < 0 || c.minorUnitExponent > 4) invalid();
    codes.add(c.code);
  }
  input = snapshot(input); trusted = snapshot(trusted); policy = snapshot(policy); limits = snapshot(limits);
  const evidence = { ...empty };
  const outcomes = { customer: outcome("unknown", "unmapped"),
    subscriptions: outcome("unknown", "customer-unavailable"), invoices: outcome("unknown", "customer-unavailable"),
    payments: outcome("unknown", "not-requested"), integrations: outcome("unknown", "not-requested") };
  const finish = () => Object.freeze({ view: project(input, trusted, evidence, policy), outcomes: Object.freeze(outcomes) });
  const binding = trusted.billingBinding;
  if (binding === null) return finish();

  async function read(resource, cursor) {
    let response;
    try {
      response = await get(Object.freeze({ method: "GET", resource, environment: policy.expectedEnvironment,
        organizationId: binding.organizationId, customerId: binding.customerId, cursor, pageSize: limits.pageSize }));
    } catch {
      return { failure: outcome("error", "transport-error") };
    }
    try {
      // Validate descriptors before reading state, including error envelopes.
      record(response, ["state", "environment", "organizationId", "customerId", "observedAt"],
        resource === "customer" ? ["customer"] : ["items", "nextCursor"]);
      if (response.environment !== policy.expectedEnvironment || response.organizationId !== binding.organizationId ||
          response.customerId !== binding.customerId) invalid();
      const observed = instant(response.observedAt), asOf = instant(policy.asOf);
      if (observed > asOf || asOf - observed > policy.maxAgeMs) invalid();
      if (["missing", "unknown", "error"].includes(response.state)) {
        record(response, ["state", "environment", "organizationId", "customerId", "observedAt"]);
        return { failure: outcome(response.state) };
      }
      if (response.state !== "available") invalid();
      record(response, ["state", "environment", "organizationId", "customerId", "observedAt",
        ...(resource === "customer" ? ["customer"] : ["items", "nextCursor"])]);
      // Validate and detach in this continuation. Returning the provider object
      // across another await would let a queued mutation bypass these checks.
      if (resource === "customer") {
        record(response.customer, ["customerId", "crmAccountId"]);
        const customer = { customerId: response.customer.customerId, crmAccountId: response.customer.crmAccountId };
        project(input, trusted, { ...evidence, customer, observedAt: response.observedAt }, policy);
        return { response: snapshot({ customer, observedAt: response.observedAt }) };
      }
      array(response.items, limits.pageSize);
      const nextCursor = response.nextCursor;
      if (nextCursor !== null && (typeof nextCursor !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(nextCursor) ||
          response.items.length === 0)) invalid();
      const items = response.items.map((item) => normalize(item, resource, binding, limits.currencies));
      project(input, trusted, { ...evidence, [resource]: { complete: true, items }, observedAt: response.observedAt }, policy);
      return { response: snapshot({ items, nextCursor, observedAt: response.observedAt }) };
    } catch {
      return { failure: outcome("error", "invalid-evidence") };
    }
  }

  const customerRead = await read("customer", null);
  if (customerRead.failure) { outcomes.customer = customerRead.failure; return finish(); }
  try {
    record(customerRead.response.customer, ["customerId", "crmAccountId"]);
    const customer = customerRead.response.customer;
    const candidate = { ...evidence, customer: { customerId: customer.customerId, crmAccountId: customer.crmAccountId },
      observedAt: customerRead.response.observedAt };
    project(input, trusted, candidate, policy);
    Object.assign(evidence, candidate);
    outcomes.customer = outcome("complete");
  } catch {
    outcomes.customer = outcome("error", "invalid-evidence");
    return finish();
  }

  for (const resource of ["subscriptions", "invoices"]) {
    const items = [], cursors = new Set(), ids = new Set();
    let cursor = null, observedAt = evidence.observedAt;
    for (let page = 0; page < limits.maxPages; page++) {
      cursors.add(cursor);
      const result = await read(resource, cursor);
      if (result.failure) { outcomes[resource] = result.failure; break; }
      try {
        const response = result.response;
        array(response.items, limits.pageSize);
        const next = response.nextCursor;
        if (next !== null && (typeof next !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(next) ||
            cursors.has(next) || response.items.length === 0)) invalid();
        for (const item of response.items) {
          const key = resource === "subscriptions" ? item.subscriptionId : item.invoiceId;
          if (ids.has(key)) invalid();
          ids.add(key); items.push(item);
        }
        if (response.observedAt < observedAt) observedAt = response.observedAt;
        // Reuse all existing semantic checks, including duplicate IDs, dates,
        // currency sources and cross-invoice exponent consistency, on each page.
        const candidate = { ...evidence, observedAt, [resource]: { complete: true, items } };
        project(input, trusted, candidate, policy);
        if (next === null) {
          Object.assign(evidence, candidate);
          outcomes[resource] = outcome("complete");
          break;
        }
        cursor = next;
        outcomes[resource] = outcome("error", "page-limit");
      } catch {
        outcomes[resource] = outcome("error", "invalid-evidence");
        break;
      }
    }
  }
  return finish();
}

module.exports = { produceBillingCustomerHistory };
