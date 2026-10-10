"use strict";

// Offline evidence arithmetic only. Nothing imports this from an executable route.
const crypto = require("node:crypto");
const { parsePaidCommercialTerms } = require("../functions/crm_billing_orchestrator/lib/commercial-terms");

const POLICY_KEYS = Object.freeze([
  "connectedTimeDefinition", "rounding", "exclusions", "periodAttribution",
  "lateEventsAndCorrections", "usageLimits", "disputes",
]);
const SCOPE_KEYS = ["accountKey", "subscriptionKey", "configurationVersion"];
const IDENTIFIER = /^[a-zA-Z0-9_-]{1,100}$/;
const HASH = /^[a-f0-9]{64}$/;
function exact(value, keys) {
  return value && Object.getPrototypeOf(value) === Object.prototype
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function fail() { throw new TypeError("Usage preview input is invalid"); }
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function scopeTuple(scope) {
  if (!exact(scope, SCOPE_KEYS) || SCOPE_KEYS.some(key => typeof scope[key] !== "string"
    || !IDENTIFIER.test(scope[key]))) fail();
  return SCOPE_KEYS.map(key => scope[key]);
}

/** A review identity is not proof of acceptance, implementation or billing authority. */
function deriveUsagePolicyReviewContract(commercialTermsJson, policy) {
  const terms = parsePaidCommercialTerms(commercialTermsJson);
  if (!exact(policy, POLICY_KEYS) || POLICY_KEYS.some(key => policy[key] !== null
    && (typeof policy[key] !== "string" || policy[key].trim() !== policy[key]
      || policy[key].length < 1 || policy[key].length > 1000
      || /[\u0000-\u001f\u007f]/.test(policy[key])))) fail();
  const rules = POLICY_KEYS.map(key => [key, policy[key]]);
  return Object.freeze({
    reviewVersion: `usage-policy-review-v1:${hash([terms.acceptanceVersion, rules])}`,
    commercialAcceptanceVersion: terms.acceptanceVersion,
    currency: terms.currency,
    connectedMinuteRateMinor: terms.commonUsageRateMinor,
    unresolvedPolicyChoices: Object.freeze(POLICY_KEYS.filter(key => policy[key] === null)),
    policyImplemented: false,
    billingAuthority: false,
  });
}

/**
 * Preview an explicitly supplied immutable projection, never fetch or mutate it.
 * Start-in-period duration is descriptive evidence, NOT a billable attribution rule.
 * Cross-boundary calls, missing duration and conflicting duplicates remain visible.
 */
function previewUsagePeriod(input) {
  if (!exact(input, ["scope", "period", "snapshot", "commercialTermsJson", "policy", "records"])) fail();
  const scope = scopeTuple(input.scope), { period, snapshot, records } = input;
  if (!exact(period, ["startMs", "endMs"]) || !integer(period.startMs)
    || !integer(period.endMs) || period.startMs >= period.endMs
    || !exact(snapshot, ["revision", "complete"]) || typeof snapshot.revision !== "string"
    || !HASH.test(snapshot.revision)
    || typeof snapshot.complete !== "boolean" || !Array.isArray(records) || records.length > 10000) fail();
  const policy = deriveUsagePolicyReviewContract(input.commercialTermsJson, input.policy);
  const rows = [], byKey = new Map(), holds = new Set(["usage_policy_not_implemented"]);
  if (!snapshot.complete) holds.add("source_incomplete");
  if (policy.unresolvedPolicyChoices.length) holds.add("usage_policy_choices_unresolved");
  for (const record of records) {
    if (!exact(record, ["scope", "callKey", "version", "startMs", "endMs", "durationMs"])
      || typeof record.callKey !== "string" || !IDENTIFIER.test(record.callKey)
      || !integer(record.version) || record.version < 1
      || !integer(record.startMs) || !integer(record.endMs) || record.endMs < record.startMs
      || (record.durationMs !== null && (!integer(record.durationMs) || record.durationMs > 86400000))) fail();
    if (JSON.stringify(scopeTuple(record.scope)) !== JSON.stringify(scope)) fail();
    const row = [record.callKey, record.version, record.startMs, record.endMs, record.durationMs];
    const previous = byKey.get(record.callKey);
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(row)) {
        // Do not choose a revision or arbitrary first value from contradictory evidence.
        holds.add("conflicting_call_evidence");
        byKey.set(record.callKey, null);
      }
    } else if (byKey.has(record.callKey)) holds.add("conflicting_call_evidence");
    else byKey.set(record.callKey, row);
    rows.push(row);
  }
  const sorted = [...new Set(rows.map(row => JSON.stringify(row)))].sort();
  let startedCalls = 0, overlappingCalls = 0, outsideCalls = 0, unknownDurations = 0;
  let duration = 0n;
  for (const row of byKey.values()) {
    if (row === null) continue;
    const [, , start, end, durationMs] = row;
    const startsInside = start >= period.startMs && start < period.endMs;
    const overlaps = start < period.endMs && end > period.startMs;
    if (!startsInside && !overlaps) { outsideCalls++; continue; }
    if (overlaps && (start < period.startMs || end > period.endMs)) {
      overlappingCalls++; holds.add("period_boundary_allocation_unresolved");
    }
    if (!startsInside) continue;
    startedCalls++;
    if (durationMs === null) { unknownDurations++; holds.add("duration_unknown"); }
    else duration += BigInt(durationMs);
  }
  if (duration > BigInt(Number.MAX_SAFE_INTEGER)) fail();
  return Object.freeze({
    status: "held_evidence_only",
    previewRevision: `usage-preview-v1:${hash([scope, [period.startMs, period.endMs],
      snapshot.revision, snapshot.complete, policy.reviewVersion, sorted, records.length - sorted.length])}`,
    policyReviewVersion: policy.reviewVersion,
    commercialAcceptanceVersion: policy.commercialAcceptanceVersion,
    currency: policy.currency,
    connectedMinuteRateMinor: policy.connectedMinuteRateMinor,
    sourceComplete: snapshot.complete,
    uniqueCallKeys: byKey.size,
    exactDuplicatesObserved: records.length - sorted.length,
    callsStartedInPeriod: startedCalls,
    callsOverlappingPeriodBoundary: overlappingCalls,
    callsOutsidePeriod: outsideCalls,
    unknownDurationCalls: unknownDurations,
    knownStartedCallDurationMsSubtotal: Number(duration),
    durationSubtotalIsPartial: !snapshot.complete || unknownDurations > 0
      || holds.has("conflicting_call_evidence"),
    holds: Object.freeze([...holds].sort()),
    unresolvedPolicyChoices: policy.unresolvedPolicyChoices,
    billableMinutes: null,
    chargeMinor: null,
    billingAuthority: false,
  });
}

module.exports = { POLICY_KEYS, deriveUsagePolicyReviewContract, previewUsagePeriod };
