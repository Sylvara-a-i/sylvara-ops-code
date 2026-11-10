"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { installOfflineGuard } = require("../../../../revenue-desk-release/test/helpers/offline-guard");
const guard = installOfflineGuard();
const { fixture } = require("./helpers-commercial-v2");
const { deriveCommercialTermsV2Version: derive } = require("../lib/commercial-terms-v2");
const { POLICY_KEYS, previewUsagePeriod, previewUsagePeriodV2: preview,
  deriveUsagePolicyReviewContractV2: review } = require("../../../tools/preview-usage-period");
test.after(() => { assert.deepEqual(guard.blocked, []); guard.restore(); });
const scope = { accountKey: "synthetic_account", subscriptionKey: "synthetic_subscription", configurationVersion: "synthetic_config" };
const termsJson = core => JSON.stringify({ termsVersion: derive(core), ...core });
const policy = () => Object.fromEntries(POLICY_KEYS.map(key => [key, null]));
const call = (callKey, durationMs = 6_000_001, startMs = 1000) => ({
  scope: { ...scope }, callKey, version: 1, startMs, endMs: startMs + durationMs, durationMs,
});
function input(records = [call("synthetic_call")]) {
  return { scope: { ...scope }, period: { startMs: 1000, endMs: 10_000_000 },
    snapshot: { revision: "a".repeat(64), complete: true },
    commercialTermsJson: termsJson(fixture()), plan: "Growth", frequency: "annual",
    policy: policy(), records };
}

test("annual v2 preview composes actual raw evidence with a separate monthly allowance quote", () => {
  const result = preview(input());
  assert.equal(result.schemaVersion, 2);
  assert.match(result.previewRevision, /^usage-preview-v2:[a-f0-9]{64}$/);
  assert.match(result.commercialTermsVersion, /^terms-v2:[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(result, "commercialAcceptanceVersion"), false);
  assert.equal(result.knownStartedCallDurationMsSubtotal, 6_000_001);
  assert.equal(result.commercialTermsPreview.basePeriodMonths, 12);
  assert.equal(result.commercialTermsPreview.allowancePeriodMonths, 1);
  assert.equal(result.commercialTermsPreview.includedVoiceMinutes, 100);
  // Raw duration exceeds the quoted allowance but is not approved billable usage.
  assert.equal(result.billableMinutes, null); assert.equal(result.chargeMinor, null);
  assert.equal(result.billingAuthority, false);
  assert.equal(result.commercialTermsPreview.paidExecutionEligible, false);
  assert.deepEqual(result.unresolvedPolicyChoices, POLICY_KEYS);
  assert.ok(result.holds.includes("commercial_policy_references_missing"));
});

test("v2 preview identity binds plan, frequency, allowance, policy text and raw evidence", () => {
  const original = input(); const base = preview(original);
  const changes = [
    p => { p.plan = "Launch"; }, p => { p.frequency = "monthly"; },
    p => { const core = fixture(); core.plans.Growth.includedVoiceMinutes++; p.commercialTermsJson = termsJson(core); },
    ...POLICY_KEYS.map(key => p => { p.policy[key] = "SYNTHETIC POLICY REVIEW TEXT"; }),
    p => { p.records[0].durationMs++; },
  ];
  for (const change of changes) {
    const changed = structuredClone(original); change(changed);
    assert.notEqual(preview(changed).previewRevision, base.previewRevision);
    assert.equal(preview(changed).billingAuthority, false);
  }
});

test("the commercial and prose policy surfaces use the same explicit policy names", () => {
  assert.deepEqual(Object.keys(fixture().policyVersions), POLICY_KEYS);
  const p = input(); const reviewed = review(p.commercialTermsJson, p.plan, p.frequency, p.policy);
  assert.equal(reviewed.policyImplemented, false); assert.equal(reviewed.billingAuthority, false);
  assert.deepEqual(reviewed.unresolvedPolicyChoices, POLICY_KEYS);
});

test("all supplied references and policy text still require approval, implementation and native qualification", () => {
  const p = input(); const core = fixture();
  for (const key of POLICY_KEYS) {
    core.policyVersions[key] = `policy-v1:${"b".repeat(64)}`;
    p.policy[key] = "SYNTHETIC POLICY REVIEW TEXT";
  }
  for (const plan of Object.values(core.plans)) plan.scopeVersion = `policy-v1:${"c".repeat(64)}`;
  p.commercialTermsJson = termsJson(core);
  const result = preview(p);
  assert.deepEqual(result.unresolvedPolicyChoices, []);
  assert.deepEqual(result.commercialTermsPreview.missingPolicyReferences, []);
  assert.deepEqual(result.holds, ["commercial_acceptance_unverified", "native_billing_unqualified",
    "policy_bodies_unverified", "usage_policy_not_implemented"]);
  assert.equal(result.billableMinutes, null); assert.equal(result.chargeMinor, null);
  assert.equal(result.billingAuthority, false);
});

test("v2 reuses exact duplicate and conflict handling instead of inventing a new meter", () => {
  const a = call("synthetic_a"), b = call("synthetic_b", 90_001);
  const result = preview(input([a, a, b]));
  assert.deepEqual(preview(input([b, a, a])), result);
  assert.equal(result.uniqueCallKeys, 2); assert.equal(result.exactDuplicatesObserved, 1);
  assert.equal(result.knownStartedCallDurationMsSubtotal, 6_090_002);
  const corrected = { ...a, version: 2, durationMs: 1 };
  const conflict = preview(input([a, corrected]));
  assert.deepEqual(conflict, preview(input([corrected, a])));
  assert.ok(conflict.holds.includes("conflicting_call_evidence"));
  assert.equal(conflict.knownStartedCallDurationMsSubtotal, 0);
  assert.equal(conflict.durationSubtotalIsPartial, true);
  assert.equal(conflict.chargeMinor, null);
});

test("unknown duration, incomplete snapshots and period boundaries remain explicit holds", () => {
  const unknown = { ...call("synthetic_unknown"), durationMs: null };
  const spanning = call("synthetic_boundary", 2000, 9_999_000);
  const p = input([unknown, spanning]); p.snapshot.complete = false;
  const result = preview(p);
  assert.equal(result.unknownDurationCalls, 1); assert.equal(result.durationSubtotalIsPartial, true);
  assert.equal(result.callsOverlappingPeriodBoundary, 1);
  for (const hold of ["duration_unknown", "source_incomplete", "period_boundary_allocation_unresolved"]) {
    assert.ok(result.holds.includes(hold));
  }
  assert.equal(result.billableMinutes, null); assert.equal(result.chargeMinor, null);
});

test("empty observations cannot be interpreted as free usage or consumed allowances", () => {
  const p = input([]); const before = structuredClone(p); const result = preview(p);
  assert.deepEqual(p, before); assert.equal(result.uniqueCallKeys, 0);
  assert.equal(result.knownStartedCallDurationMsSubtotal, 0);
  assert.equal(result.billableMinutes, null); assert.equal(result.chargeMinor, null);
  assert.equal(Object.hasOwn(result, "remainingVoiceMinutes"), false);
  assert.equal(Object.hasOwn(result, "overageMinutes"), false);
});

test("v2 requires an explicit exact plan/frequency and cannot silently fall back to v1", () => {
  for (const change of [
    p => { delete p.plan; }, p => { delete p.frequency; }, p => { p.plan = "Option 2"; },
    p => { p.frequency = "Yearly"; }, p => { p.activate = true; },
    p => { p.records[0].scope.accountKey = "foreign_account"; },
    p => { p.records[0].transcript = "SYNTHETIC PRIVATE CONTENT"; },
    p => { delete p.policy.rounding; },
  ]) { const p = input(); change(p); assert.throws(() => preview(p), TypeError); }
  const p = input(); delete p.plan; delete p.frequency;
  assert.throws(() => previewUsagePeriod(p), /paid commercial terms are invalid/);
});


test("invoice lifecycle metadata cannot authorize or redefine a raw usage preview", () => {
  // Synthetic observations, not a claimed native schema or provider enum mapping.
  for (const observation of [
    { usageKey: "synthetic_usage", invoiceKey: "synthetic_invoice", status: "invoiced" },
    { usageKey: "synthetic_usage", invoiceKey: "synthetic_invoice", status: "pending_after_void" },
    { usageKey: "synthetic_usage", invoiceKey: "synthetic_replacement", status: "regenerated" },
  ]) {
    for (const place of [p => p, p => p.snapshot, p => p.records[0]]) {
      const p = input(); place(p).providerUsageObservation = observation;
      const before = structuredClone(p);
      assert.throws(() => preview(p), /^TypeError: Usage preview input is invalid$/);
      assert.deepEqual(p, before);
    }
  }
});

test("same source call replayed in revised snapshots retains one raw duration and no billing authority", () => {
  const sourceCall = call("synthetic_stable_call", 60_001);
  const original = structuredClone(sourceCall);
  const previews = [];
  for (const [revision, copies] of [["a", 1], ["b", 2], ["c", 3]]) {
    const p = input(Array.from({ length: copies }, () => structuredClone(sourceCall)));
    p.snapshot.revision = revision.repeat(64);
    const result = preview(p); previews.push(result);
    assert.equal(result.uniqueCallKeys, 1);
    assert.equal(result.exactDuplicatesObserved, copies - 1);
    assert.equal(result.knownStartedCallDurationMsSubtotal, sourceCall.durationMs);
    assert.equal(result.status, "held_evidence_only");
    assert.equal(result.billableMinutes, null); assert.equal(result.chargeMinor, null);
    assert.equal(result.billingAuthority, false);
    assert.ok(result.holds.includes("native_billing_unqualified"));
    assert.ok(result.holds.includes("usage_policy_not_implemented"));
    assert.deepEqual(p.records, Array.from({ length: copies }, () => original));
  }
  assert.equal(new Set(previews.map(p => p.previewRevision)).size, 3);
  // Preview revisions identify observations, not distinct usage or submission keys.
  assert.deepEqual(sourceCall, original);
});

test("a late observed prior-period call stays in its event-time window without settlement authority", () => {
  const lateCall = call("synthetic_late_call", 100, 1200);
  const original = structuredClone(lateCall);
  const priorBefore = input([]); priorBefore.period = { startMs: 1000, endMs: 2000 };
  const priorAfter = structuredClone(priorBefore);
  priorAfter.records = [lateCall]; priorAfter.snapshot.revision = "b".repeat(64);
  const current = structuredClone(priorAfter); current.period = { startMs: 2000, endMs: 3000 };
  const before = preview(priorBefore), after = preview(priorAfter), now = preview(current);
  assert.notEqual(before.previewRevision, after.previewRevision);
  assert.equal(after.callsStartedInPeriod, 1);
  assert.equal(after.knownStartedCallDurationMsSubtotal, 100);
  assert.equal(now.callsStartedInPeriod, 0); assert.equal(now.callsOutsidePeriod, 1);
  assert.equal(now.knownStartedCallDurationMsSubtotal, 0);
  for (const result of [before, after, now]) {
    assert.equal(result.billableMinutes, null); assert.equal(result.chargeMinor, null);
    assert.equal(result.billingAuthority, false);
    assert.ok(result.unresolvedPolicyChoices.includes("lateEventsAndCorrections"));
    assert.ok(result.holds.includes("usage_policy_not_implemented"));
  }
  assert.deepEqual(lateCall, original);
});
