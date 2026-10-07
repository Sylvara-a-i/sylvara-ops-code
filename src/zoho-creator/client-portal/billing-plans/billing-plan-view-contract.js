"use strict";

function deny() { throw new TypeError("Invalid billing catalog view evidence"); }

function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) deny();
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) deny();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) deny();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
  }
}

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) deny();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) deny();
  return ms;
}

function dataArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1) deny();
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
  }
}

function minor(value) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0))) deny();
}

// Structural validation only: a passed object is neither authentication nor
// proof of catalog provenance. A separately verified server producer is required.
function prepareBillingPlanView(evidence, policy) {
  record(policy, ["expectedEnvironment", "asOf", "maxAgeMs"]);
  if (!["development", "stage", "production"].includes(policy.expectedEnvironment) ||
      !Number.isSafeInteger(policy.maxAgeMs) || policy.maxAgeMs < 0) deny();
  const asOf = timestamp(policy.asOf);
  record(evidence, ["environment", "observedAt", "complete", "plans"]);
  if (evidence.environment !== policy.expectedEnvironment || evidence.complete !== true) deny();
  const observed = timestamp(evidence.observedAt);
  if (observed > asOf || asOf - observed > policy.maxAgeMs) deny();
  dataArray(evidence.plans);
  const identities = new Set();
  const intervalsByLabel = new Map();
  const currencyExponents = new Map();
  const plans = evidence.plans.map((plan) => {
    record(plan, ["label", "catalogStatus", "recurringMinor", "setupMinor", "amountUnit", "interval", "currency"]);
    if (typeof plan.label !== "string" || plan.label !== plan.label.trim() ||
        !/^[A-Za-z0-9][A-Za-z0-9 &()/.-]{0,79}$/.test(plan.label) ||
        !["active", "inactive", "unavailable"].includes(plan.catalogStatus)) deny();
    minor(plan.recurringMinor);
    minor(plan.setupMinor);
    if (plan.amountUnit !== null && plan.amountUnit !== "minor") deny();
    // Unknown unit must not carry a raw provider amount disguised as minor units.
    if (plan.amountUnit === null && (plan.recurringMinor !== null || plan.setupMinor !== null)) deny();
    let interval = null;
    if (plan.interval !== null) {
      record(plan.interval, ["count", "unit"]);
      if (!Number.isSafeInteger(plan.interval.count) || plan.interval.count < 1 ||
          !["months", "years"].includes(plan.interval.unit)) deny();
      interval = Object.freeze({ count: plan.interval.count, unit: plan.interval.unit });
    }
    let currency = null;
    if (plan.currency !== null) {
      record(plan.currency, ["code", "minorUnitExponent", "source"]);
      if (typeof plan.currency.code !== "string" || !/^[A-Z]{3}$/.test(plan.currency.code) ||
          !Number.isSafeInteger(plan.currency.minorUnitExponent) || plan.currency.minorUnitExponent < 0 ||
          plan.currency.minorUnitExponent > 4 ||
          !["plan-response", "verified-catalog-metadata"].includes(plan.currency.source)) deny();
      currency = Object.freeze({ code: plan.currency.code, minorUnitExponent: plan.currency.minorUnitExponent, source: plan.currency.source });
      if (currencyExponents.has(currency.code) &&
          currencyExponents.get(currency.code) !== currency.minorUnitExponent) deny();
      currencyExponents.set(currency.code, currency.minorUnitExponent);
    }
    // Label plus exact interval is the sanitized identity, never a provider ID.
    const identity = JSON.stringify([plan.label.toLowerCase(), interval]);
    if (identities.has(identity)) deny();
    identities.add(identity);
    const label = plan.label.toLowerCase();
    // An unknown interval cannot disambiguate another observation of that label.
    if (intervalsByLabel.has(label) && (interval === null || intervalsByLabel.get(label) === null)) deny();
    intervalsByLabel.set(label, interval);
    const moneyAvailable = currency !== null && plan.amountUnit === "minor";
    return Object.freeze({
      label: plan.label, catalogStatus: plan.catalogStatus,
      recurringMinor: moneyAvailable ? plan.recurringMinor : null,
      setupMinor: moneyAvailable ? plan.setupMinor : null,
      amountUnit: moneyAvailable ? "minor" : null, interval, currency,
    });
  });
  return Object.freeze({
    environment: evidence.environment, observedAt: evidence.observedAt,
    catalogStatus: plans.length ? "available" : "unavailable",
    plans: Object.freeze(plans),
    // Catalog state never establishes customer subscription or entitlement.
    customer: Object.freeze({ subscription: null, entitlement: null, termStart: null, termEnd: null, usage: null }),
  });
}

module.exports = { prepareBillingPlanView };
