"use strict";

const crypto = require("node:crypto");

// Offline v1-product preparation only. The existing paid configuration parser
// deliberately accepts terms-v1, not this format. A digest is not acceptance,
// payment, native catalog qualification, or authority to execute a paid action.
const VERSION = /^terms-v2:[a-f0-9]{64}$/;
const REFERENCE = /^policy-v1:[a-f0-9]{64}$/;
const PLAN_NAMES = Object.freeze(["Launch", "Growth", "Scale"]);
const POLICY_NAMES = Object.freeze([
  "connectedTimeDefinition", "rounding", "exclusions", "periodAttribution",
  "lateEventsAndCorrections", "usageLimits", "disputes",
]);
const PLAN_KEYS = Object.freeze([
  "monthlyBaseMinor", "annualBaseMinor", "setupMinor", "includedVoiceMinutes",
  "includedSmsSegments", "scopeVersion",
]);
const REFUND_KEYS = Object.freeze([
  "unusedWholeMonthsRefundable", "currentMonthRefundable", "completedSetupRefundable",
]);
const CORE_KEYS = Object.freeze([
  "currency", "annualTermMonths", "annualBaseDiscountBasisPoints",
  "allowancePeriodMonths", "allowanceRollover", "voiceOverageMinorPerMinute",
  "smsOverageMinorPerSegment", "annualRefund", "policyVersions", "plans",
]);
const candidates = new WeakSet();
const invalid = () => { throw new TypeError("commercial terms v2 are invalid"); };

function exactRecord(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => !keys.includes(key)
    || !Object.hasOwn(descriptors[key], "value") || !descriptors[key].enumerable)) invalid();
}

function integer(value, minimum = 0, maximum = 1_000_000_000) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0)
    || value < minimum || value > maximum) invalid();
  return value;
}

function policyReference(value) {
  if (value !== null && (typeof value !== "string" || !REFERENCE.test(value))) invalid();
  return value;
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function normalizeCore(value) {
  exactRecord(value, CORE_KEYS);
  if (value.currency !== "USD" || value.annualTermMonths !== 12
    || value.allowancePeriodMonths !== 1 || value.allowanceRollover !== false) invalid();
  const discount = integer(value.annualBaseDiscountBasisPoints, 0, 9999);
  exactRecord(value.annualRefund, REFUND_KEYS);
  const annualRefund = Object.fromEntries(REFUND_KEYS.map((key) => {
    if (typeof value.annualRefund[key] !== "boolean") invalid();
    return [key, value.annualRefund[key]];
  }));
  exactRecord(value.policyVersions, POLICY_NAMES);
  const policyVersions = Object.fromEntries(POLICY_NAMES.map((key) =>
    [key, policyReference(value.policyVersions[key])]));
  exactRecord(value.plans, PLAN_NAMES);
  const plans = Object.fromEntries(PLAN_NAMES.map((name) => {
    const plan = value.plans[name];
    exactRecord(plan, PLAN_KEYS);
    const monthlyBaseMinor = integer(plan.monthlyBaseMinor, 1);
    const annualBaseMinor = integer(plan.annualBaseMinor, 1);
    // Verify the explicit annual quote exactly. Never introduce an implicit
    // fractional-cent rounding rule or apply the base discount to usage/setup.
    const discounted = BigInt(monthlyBaseMinor) * 12n * BigInt(10_000 - discount);
    if (discounted % 10_000n !== 0n || discounted / 10_000n !== BigInt(annualBaseMinor)) invalid();
    return [name, {
      monthlyBaseMinor, annualBaseMinor,
      setupMinor: integer(plan.setupMinor),
      includedVoiceMinutes: integer(plan.includedVoiceMinutes),
      includedSmsSegments: integer(plan.includedSmsSegments),
      scopeVersion: policyReference(plan.scopeVersion),
    }];
  }));
  return {
    currency: value.currency,
    annualTermMonths: value.annualTermMonths,
    annualBaseDiscountBasisPoints: discount,
    allowancePeriodMonths: value.allowancePeriodMonths,
    allowanceRollover: value.allowanceRollover,
    voiceOverageMinorPerMinute: integer(value.voiceOverageMinorPerMinute, 1),
    smsOverageMinorPerSegment: integer(value.smsOverageMinorPerSegment, 1),
    annualRefund, policyVersions, plans,
  };
}

function versionFor(normalized) {
  return `terms-v2:${crypto.createHash("sha256")
    .update(JSON.stringify(normalized), "utf8").digest("hex")}`;
}

/** A content identifier for an offline candidate, never an acceptance grant. */
function deriveCommercialTermsV2Version(value) {
  return versionFor(normalizeCore(value));
}

/**
 * Parse a private candidate containing its exact termsVersion. Null policy/scope
 * references remain explicit holds. Supplied references are content identifiers,
 * not proof that their bodies, approval or installed provider behavior are valid.
 */
function parseCommercialTermsV2(raw) {
  if (typeof raw !== "string" || raw.length < 2 || Buffer.byteLength(raw, "utf8") > 16_384) invalid();
  let value;
  try { value = JSON.parse(raw); } catch { invalid(); }
  exactRecord(value, ["termsVersion", ...CORE_KEYS]);
  if (typeof value.termsVersion !== "string" || !VERSION.test(value.termsVersion)) invalid();
  const core = Object.fromEntries(CORE_KEYS.map((key) => [key, value[key]]));
  const terms = normalizeCore(core);
  if (value.termsVersion !== versionFor(terms)) invalid();
  const missingPolicyReferences = [
    ...POLICY_NAMES.filter((key) => terms.policyVersions[key] === null),
    ...PLAN_NAMES.filter((name) => terms.plans[name].scopeVersion === null)
      .map((name) => `${name}.scopeVersion`),
  ];
  const candidate = freeze({
    termsVersion: value.termsVersion, terms, missingPolicyReferences,
    holds: ["commercial_acceptance_unverified", "policy_bodies_unverified", "native_billing_unqualified"],
    paidExecutionEligible: false, billingAuthority: false,
  });
  // This local brand prevents forged/lookalike objects from being selected. It
  // is only a parser type boundary, not authenticated provenance or authority.
  candidates.add(candidate);
  return candidate;
}

/** Select a preview without multiplying monthly usage allowances by annual term. */
function selectCommercialTermsV2(candidate, planName, frequency) {
  if (!candidates.has(candidate) || !PLAN_NAMES.includes(planName)
    || !["monthly", "annual"].includes(frequency)) invalid();
  const { terms } = candidate;
  const plan = terms.plans[planName];
  return freeze({
    termsVersion: candidate.termsVersion, plan: planName, frequency,
    currency: terms.currency,
    baseChargeMinor: frequency === "annual" ? plan.annualBaseMinor : plan.monthlyBaseMinor,
    basePeriodMonths: frequency === "annual" ? terms.annualTermMonths : 1,
    setupMinor: plan.setupMinor,
    allowancePeriodMonths: terms.allowancePeriodMonths,
    allowanceRollover: terms.allowanceRollover,
    includedVoiceMinutes: plan.includedVoiceMinutes,
    includedSmsSegments: plan.includedSmsSegments,
    voiceOverageMinorPerMinute: terms.voiceOverageMinorPerMinute,
    smsOverageMinorPerSegment: terms.smsOverageMinorPerSegment,
    annualRefund: terms.annualRefund,
    policyVersions: terms.policyVersions,
    scopeVersion: plan.scopeVersion,
    missingPolicyReferences: candidate.missingPolicyReferences,
    holds: candidate.holds,
    paidExecutionEligible: false, billingAuthority: false,
  });
}

module.exports = {
  deriveCommercialTermsV2Version, parseCommercialTermsV2, selectCommercialTermsV2,
};
