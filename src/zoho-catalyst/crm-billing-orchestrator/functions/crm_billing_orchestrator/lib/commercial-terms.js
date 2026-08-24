"use strict";

const PLAN_FREQUENCY_KEYS = Object.freeze([
  "Launch::Monthly",
  "Growth::Monthly",
  "Scale::Monthly",
]);
const TOP_LEVEL_KEYS = Object.freeze([
  "commonUsageRateMinor",
  "currency",
  "interval",
  "intervalUnit",
  "plans",
]);
const PLAN_TERM_KEYS = Object.freeze(["recurringMinor", "setupMinor"]);

function sameKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function positiveMinorUnit(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000;
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
  if (
    !sameKeys(parsed, TOP_LEVEL_KEYS) ||
    typeof parsed.currency !== "string" || !/^[A-Z]{3}$/.test(parsed.currency) ||
    parsed.interval !== 1 || parsed.intervalUnit !== "months" ||
    !positiveMinorUnit(parsed.commonUsageRateMinor) ||
    !sameKeys(parsed.plans, PLAN_FREQUENCY_KEYS)
  ) throw new TypeError("paid commercial terms are invalid");

  const plans = Object.create(null);
  for (const key of PLAN_FREQUENCY_KEYS) {
    const values = parsed.plans[key];
    if (
      !sameKeys(values, PLAN_TERM_KEYS) ||
      !positiveMinorUnit(values.recurringMinor) ||
      !positiveMinorUnit(values.setupMinor)
    ) throw new TypeError("paid commercial terms are invalid");
    const [plan, billingFrequency] = key.split("::");
    plans[key] = Object.freeze({
      plan,
      billingFrequency,
      recurringMinor: values.recurringMinor,
      setupMinor: values.setupMinor,
    });
  }
  return Object.freeze({
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
  PLAN_FREQUENCY_KEYS,
  containsCommercialTerms,
  moneyMinor,
  parsePaidCommercialTerms,
  selectCommercialTerms,
};
