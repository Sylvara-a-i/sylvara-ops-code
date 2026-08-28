"use strict";

const crypto = require("node:crypto");

const PLAN_FREQUENCY_KEYS = Object.freeze([
  "Launch::Monthly",
  "Growth::Monthly",
  "Scale::Monthly",
]);
const TOP_LEVEL_KEYS = Object.freeze([
  "acceptanceVersion",
  "commonUsageRateMinor",
  "currency",
  "interval",
  "intervalUnit",
  "plans",
]);
const COMMERCIAL_TERM_KEYS = Object.freeze([
  "commonUsageRateMinor",
  "currency",
  "interval",
  "intervalUnit",
  "plans",
]);
const PLAN_TERM_KEYS = Object.freeze(["recurringMinor", "setupMinor"]);
const ACCEPTANCE_VERSION = /^terms-v1:[a-f0-9]{64}$/;

function sameKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function positiveMinorUnit(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000;
}

function validateCommercialTermsShape(value) {
  if (
    !sameKeys(value, COMMERCIAL_TERM_KEYS) ||
    value.currency !== "USD" ||
    value.interval !== 1 || value.intervalUnit !== "months" ||
    !positiveMinorUnit(value.commonUsageRateMinor) ||
    !sameKeys(value.plans, PLAN_FREQUENCY_KEYS)
  ) throw new TypeError("paid commercial terms are invalid");

  for (const key of PLAN_FREQUENCY_KEYS) {
    const plan = value.plans[key];
    if (
      !sameKeys(plan, PLAN_TERM_KEYS) ||
      !positiveMinorUnit(plan.recurringMinor) ||
      !positiveMinorUnit(plan.setupMinor)
    ) throw new TypeError("paid commercial terms are invalid");
  }
  return value;
}

/**
 * Derive the CRM-safe acceptance identifier from every price-bearing term.
 * A fixed tuple order makes the digest independent of JSON property ordering.
 */
function derivePaidCommercialTermsAcceptanceVersion(value) {
  const contract = validateCommercialTermsShape(value);
  const canonical = JSON.stringify([
    ["currency", contract.currency],
    ["interval", contract.interval],
    ["intervalUnit", contract.intervalUnit],
    ["commonUsageRateMinor", contract.commonUsageRateMinor],
    ["plans", PLAN_FREQUENCY_KEYS.map((key) => [
      key,
      contract.plans[key].recurringMinor,
      contract.plans[key].setupMinor,
    ])],
  ]);
  return `terms-v1:${crypto.createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/**
 * Parse the private paid commercial contract without retaining its source JSON.
 * The exact shape prevents an unnoticed plan, frequency, currency, interval, or
 * price from entering the paid conversion boundary.
 */
function parsePaidCommercialTerms(raw) {
  if (typeof raw !== "string" || raw.length < 2 || raw.length > 4096) {
    throw new TypeError("paid commercial terms are invalid");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError("paid commercial terms are invalid");
  }
  if (!sameKeys(parsed, TOP_LEVEL_KEYS) || !ACCEPTANCE_VERSION.test(parsed.acceptanceVersion)) {
    throw new TypeError("paid commercial terms are invalid");
  }
  const commercialTerms = validateCommercialTermsShape({
    currency: parsed.currency,
    interval: parsed.interval,
    intervalUnit: parsed.intervalUnit,
    commonUsageRateMinor: parsed.commonUsageRateMinor,
    plans: parsed.plans,
  });
  if (parsed.acceptanceVersion !== derivePaidCommercialTermsAcceptanceVersion(commercialTerms)) {
    throw new TypeError("paid commercial terms are invalid");
  }

  const plans = Object.create(null);
  for (const key of PLAN_FREQUENCY_KEYS) {
    const values = commercialTerms.plans[key];
    const [plan, billingFrequency] = key.split("::");
    plans[key] = Object.freeze({
      plan,
      billingFrequency,
      recurringMinor: values.recurringMinor,
      setupMinor: values.setupMinor,
    });
  }
  return Object.freeze({
    acceptanceVersion: parsed.acceptanceVersion,
    currency: parsed.currency,
    interval: parsed.interval,
    intervalUnit: parsed.intervalUnit,
    commonUsageRateMinor: parsed.commonUsageRateMinor,
    plans: Object.freeze(plans),
  });
}

function selectCommercialTerms(contract, plan, billingFrequency) {
  return contract?.plans?.[`${plan}::${billingFrequency}`] ?? null;
}

function containsCommercialTerms(contract, candidate) {
  if (!candidate || typeof candidate !== "object") return false;
  const configured = selectCommercialTerms(
    contract,
    candidate.plan,
    candidate.billingFrequency,
  );
  return Boolean(configured) &&
    candidate.recurringMinor === configured.recurringMinor &&
    candidate.setupMinor === configured.setupMinor &&
    Object.keys(candidate).length === 4;
}

function moneyMinor(value) {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(raw)) {
    return null;
  }
  const [whole, fraction = ""] = raw.split(".");
  const result = (Number(whole) * 100) + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

module.exports = {
  ACCEPTANCE_VERSION,
  PLAN_FREQUENCY_KEYS,
  containsCommercialTerms,
  derivePaidCommercialTermsAcceptanceVersion,
  moneyMinor,
  parsePaidCommercialTerms,
  selectCommercialTerms,
};
