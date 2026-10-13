"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { SYNTHETIC_COMMERCIAL_TERMS } = require("./helpers");
const { derivePaidCommercialTermsAcceptanceVersion } = require("../lib/commercial-terms");
const { POLICY_KEYS, deriveUsagePolicyReviewContract, previewUsagePeriod } = require("../../../tools/preview-usage-period");
const scope = { accountKey: "synthetic_account", subscriptionKey: "synthetic_subscription", configurationVersion: "synthetic_config" };
const policy = () => Object.fromEntries(POLICY_KEYS.map(key => [key, null]));
const call = (callKey, startMs = 1000, durationMs = 60001) => ({
  scope: { ...scope }, callKey, version: 1, startMs, endMs: startMs + 100, durationMs,
});
function input(records = [call("synthetic_call")]) {
  return { scope: { ...scope }, period: { startMs: 1000, endMs: 10000 },
    snapshot: { revision: "a".repeat(64), complete: true },
    commercialTermsJson: JSON.stringify(SYNTHETIC_COMMERCIAL_TERMS), policy: policy(), records };
}

test("missing policy choices cannot yield billable minutes or money from verified duration", () => {
  const p = previewUsagePeriod(input());
  assert.equal(p.knownStartedCallDurationMsSubtotal, 60001);
  assert.equal(p.billableMinutes, null); assert.equal(p.chargeMinor, null);
  assert.equal(p.billingAuthority, false); assert.equal(p.status, "held_evidence_only");
  assert.deepEqual(p.unresolvedPolicyChoices, POLICY_KEYS);
  assert.ok(p.holds.includes("usage_policy_choices_unresolved"));
});

test("policy review identity binds every explicit choice and all existing price-bearing terms", () => {
  const base = input();
  const derive = p => deriveUsagePolicyReviewContract(p.commercialTermsJson, p.policy);
  const original = derive(base);
  for (const key of POLICY_KEYS) {
    const changed = structuredClone(base); changed.policy[key] = "SYNTHETIC REVIEW TEXT ONLY";
    assert.notEqual(derive(changed).reviewVersion, original.reviewVersion);
  }
  const terms = structuredClone(SYNTHETIC_COMMERCIAL_TERMS);
  delete terms.acceptanceVersion; terms.commonUsageRateMinor++;
  terms.acceptanceVersion = derivePaidCommercialTermsAcceptanceVersion(terms);
  assert.notEqual(derive({ ...base, commercialTermsJson: JSON.stringify(terms) }).reviewVersion, original.reviewVersion);
  const reordered = { ...base, policy: Object.fromEntries(Object.entries(base.policy).reverse()) };
  assert.deepEqual(derive(reordered), original);
  assert.equal(original.policyImplemented, false);
});

test("all supplied policy prose remains non-executable and cannot create acceptance authority", () => {
  const p = input(); for (const key of POLICY_KEYS) p.policy[key] = "SYNTHETIC REVIEW TEXT ONLY";
  const result = previewUsagePeriod(p);
  assert.deepEqual(result.unresolvedPolicyChoices, []);
  assert.deepEqual(result.holds, ["usage_policy_not_implemented"]);
  assert.equal(result.chargeMinor, null);
});

test("exact duplicates are deduplicated while permutations preserve the whole preview", () => {
  const a = call("synthetic_a"), b = call("synthetic_b", 2000, 90001);
  const result = previewUsagePeriod(input([a, a, b]));
  assert.deepEqual(previewUsagePeriod(input([b, a, a])), result);
  assert.equal(result.uniqueCallKeys, 2); assert.equal(result.exactDuplicatesObserved, 1);
  assert.equal(result.knownStartedCallDurationMsSubtotal, 150002);
  assert.notEqual(previewUsagePeriod(input([a, b])).previewRevision, result.previewRevision);
});

test("conflicting duplicates and revisions never select arbitrary duration", () => {
  const a = call("synthetic_a"), correction = { ...a, version: 2, durationMs: 1 };
  const result = previewUsagePeriod(input([a, a, correction]));
  assert.deepEqual(previewUsagePeriod(input([correction, a, a])), result);
  assert.ok(result.holds.includes("conflicting_call_evidence"));
  assert.equal(result.knownStartedCallDurationMsSubtotal, 0);
  assert.equal(result.durationSubtotalIsPartial, true);
  const corrected = input([correction]); corrected.snapshot.revision = "b".repeat(64);
  assert.notEqual(previewUsagePeriod(corrected).previewRevision, result.previewRevision);
  assert.equal(previewUsagePeriod(corrected).chargeMinor, null);
});

test("half-open period edges and spanning calls remain descriptive with allocation held", () => {
  const rows = [call("at_start"), call("at_end", 10000), call("before", 500),
    { ...call("spans_start", 900), endMs: 1100 }, { ...call("spans_end", 9900), endMs: 10100 }];
  const p = previewUsagePeriod(input(rows));
  assert.equal(p.callsStartedInPeriod, 2); assert.equal(p.callsOutsidePeriod, 2);
  assert.equal(p.callsOverlappingPeriodBoundary, 2);
  assert.ok(p.holds.includes("period_boundary_allocation_unresolved"));
});

test("unknown duration and incomplete snapshots show explicit partial subtotals", () => {
  const p = input([call("known", 1000, 0), call("unknown", 2000, null)]);
  p.snapshot.complete = false;
  const result = previewUsagePeriod(p);
  assert.equal(result.unknownDurationCalls, 1); assert.equal(result.knownStartedCallDurationMsSubtotal, 0);
  assert.equal(result.sourceComplete, false); assert.equal(result.durationSubtotalIsPartial, true);
  assert.ok(result.holds.includes("duration_unknown")); assert.ok(result.holds.includes("source_incomplete"));
});

test("invalid/mixed scope, scalar coercion, raw extra fields and malformed policy fail closed", () => {
  for (const mutate of [
    p => { p.records[0].scope.accountKey = "different_account"; },
    p => { p.records[0].callKey = 1; }, p => { p.records[0].durationMs = "60000"; },
    p => { p.records[0].durationMs = NaN; }, p => { p.records[0].endMs = 0; },
    p => { p.records[0].transcript = "SYNTHETIC PRIVATE CONTENT"; },
    p => { delete p.policy.rounding; }, p => { p.policy.rounding = ""; },
    p => { p.period.endMs = p.period.startMs; }, p => { p.snapshot.revision = "unknown"; },
  ]) {
    const p = input(); mutate(p);
    assert.throws(() => previewUsagePeriod(p), /^TypeError: Usage preview input is invalid$/);
  }
});

test("preview does not mutate caller evidence and empty sample cannot imply free usage", () => {
  const p = input([]), original = structuredClone(p); const result = previewUsagePeriod(p);
  assert.deepEqual(p, original); assert.equal(result.callsStartedInPeriod, 0);
  assert.equal(result.chargeMinor, null); assert.equal(result.billingAuthority, false);
});
