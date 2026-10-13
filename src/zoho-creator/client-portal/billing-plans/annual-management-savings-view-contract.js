"use strict";

const { prepareBillingPlanView } = require("./billing-plan-view-contract");

function deny() { throw new TypeError("Invalid annual management savings evidence"); }

function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) deny();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) deny();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
  }
}

function id(value) {
  if (typeof value !== "string" || !value || value !== value.trim() ||
      /[\u0000-\u0020\u007f]/.test(value)) deny();
}

// The server producer must independently establish equivalent management scope,
// stable row identities and provenance in ONE fresh snapshot. Matching IDs and
// an equivalent flag only check consistency; they cannot prove these facts.
function prepareAnnualManagementSavingsView(evidence, policy) {
  record(evidence, ["environment", "observedAt", "complete", "pairing", "monthly", "annual"]);
  const rows = [];
  for (const row of [evidence.monthly, evidence.annual]) {
    if (row !== null) {
      record(row, ["planId", "plan"]);
      id(row.planId);
      rows.push(row.plan);
    }
  }
  const pairing = evidence.pairing;
  if (pairing !== null) {
    record(pairing, ["monthlyPlanId", "annualPlanId", "equivalent", "scope"]);
    id(pairing.monthlyPlanId); id(pairing.annualPlanId);
    if (![true, false, null].includes(pairing.equivalent) ||
        !["management-fee-only", null].includes(pairing.scope)) deny();
  }
  // Reuse the strict catalog contract without changing its signature or output.
  // Freshness/complete/environment cover the pairing and both rows together.
  const catalog = prepareBillingPlanView({
    environment: evidence.environment, observedAt: evidence.observedAt,
    complete: evidence.complete, plans: rows,
  }, policy);
  const view = (comparison) => Object.freeze({
    environment: catalog.environment, observedAt: catalog.observedAt, comparison,
  });
  if (pairing === null || evidence.monthly === null || evidence.annual === null ||
      pairing.equivalent !== true || pairing.scope !== "management-fee-only" ||
      pairing.monthlyPlanId === pairing.annualPlanId ||
      pairing.monthlyPlanId !== evidence.monthly.planId ||
      pairing.annualPlanId !== evidence.annual.planId) return view(null);

  const [monthly, annual] = catalog.plans;
  if (monthly.catalogStatus !== "active" || annual.catalogStatus !== "active" ||
      monthly.interval === null || monthly.interval.count !== 1 || monthly.interval.unit !== "months" ||
      annual.interval === null || annual.interval.count !== 1 || annual.interval.unit !== "years" ||
      monthly.currency === null || annual.currency === null ||
      monthly.currency.code !== annual.currency.code ||
      monthly.currency.minorUnitExponent !== annual.currency.minorUnitExponent ||
      monthly.recurringMinor === null || annual.recurringMinor === null ||
      monthly.recurringMinor <= 0 || annual.recurringMinor <= 0 ||
      monthly.recurringMinor > Math.floor(Number.MAX_SAFE_INTEGER / 12)) return view(null);

  const monthlyAnnualizedMinor = monthly.recurringMinor * 12;
  const savingsMinor = monthlyAnnualizedMinor - annual.recurringMinor;
  if (savingsMinor <= 0) return view(null);
  // Exact integer division floors to 0.01 percentage points. BigInt prevents
  // the percentage numerator overflowing even when all money amounts are safe.
  const savingsPercentHundredths = Number(BigInt(savingsMinor) * 10000n / BigInt(monthlyAnnualizedMinor));
  return view(Object.freeze({
    monthlyLabel: monthly.label, annualLabel: annual.label,
    monthlyAnnualizedMinor, annualRecurringMinor: annual.recurringMinor, savingsMinor,
    amountUnit: "minor",
    currency: Object.freeze({ code: monthly.currency.code, minorUnitExponent: monthly.currency.minorUnitExponent }),
    basisMonths: 12, scope: "management-fee-only",
    savingsPercentHundredths, percentageRounding: "floor",
  }));
}

module.exports = { prepareAnnualManagementSavingsView };
