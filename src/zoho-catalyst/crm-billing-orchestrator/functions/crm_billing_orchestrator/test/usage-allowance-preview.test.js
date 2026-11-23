"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { installOfflineGuard } = require("../../../../revenue-desk-release/test/helpers/offline-guard");
const guard = installOfflineGuard();
const { fixture } = require("./helpers-commercial-v2");
const { call, message, input, january, termsJson } = require("./helpers-usage-allowance");
const { POLICY_KEYS, previewUsageAllowancePeriod: preview } = require("../../../tools/preview-usage-period");
test.after(() => { assert.deepEqual(guard.blocked, []); guard.restore(); });

function assertNoncharging(result) {
  assert.equal(result.status, "held_synthetic_scenario");
  assert.equal(result.previewVersion, "1.0");
  assert.equal(result.billingAuthority, false);
  assert.equal(result.postingCapability, false);
  assert.equal(result.paidExecutionEligible, false);
  assert.equal(result.billableMinutes, null);
  assert.equal(result.chargeMinor, null);
  assert.equal(result.allowanceScenario.basis, "synthetic");
  assert.equal(result.allowanceScenario.windowVerified, false);
  for (const hold of ["synthetic_scenario_only", "commercial_acceptance_unverified",
    "usage_policy_not_implemented", "policy_bodies_unverified", "native_billing_unqualified",
    "allowance_window_unverified", "fractional_voice_rounding_unresolved",
    "late_events_and_corrections_unresolved", "sms_eligibility_unverified"]) {
    assert.ok(result.holds.includes(hold), `missing hold: ${hold}`);
  }
}

for (const [plan, voiceAllowance, smsAllowance] of [["Launch", 50, 70], ["Growth", 100, 140], ["Scale", 150, 210]]) {
  for (const [delta, expectedMinor] of [[-1, 0], [0, 0], [1, 44]]) {
    test(`${plan} synthetic allowance ${delta < 0 ? "below" : delta === 0 ? "exactly at" : "above"} boundary`, () => {
      const result = preview(input({ plan, voiceMinutes: voiceAllowance + delta, smsSegments: smsAllowance + delta }));
      const { voice, sms, usageOverageMinor } = result.allowanceScenario;
      assert.equal(voice.includedUnits, voiceAllowance);
      assert.equal(sms.includedUnits, smsAllowance);
      assert.equal(voice.remainingUnits, delta === -1 ? 1 : 0);
      assert.equal(sms.remainingUnits, delta === -1 ? 1 : 0);
      assert.equal(voice.overageUnits, delta === 1 ? 1 : 0);
      assert.equal(sms.overageUnits, delta === 1 ? 1 : 0);
      assert.equal(voice.overageMinor, delta === 1 ? 37 : 0);
      assert.equal(sms.overageMinor, delta === 1 ? 7 : 0);
      assert.equal(usageOverageMinor, expectedMinor);
      assertNoncharging(result);
    });
  }
}

test("exact-cent example independently consumes voice and SMS allowances", () => {
  const result = preview(input({ voiceMinutes: 103, smsSegments: 145 }));
  assert.equal(result.allowanceScenario.voice.overageMinor, 111);
  assert.equal(result.allowanceScenario.sms.overageMinor, 35);
  assert.equal(result.allowanceScenario.usageOverageMinor, 146);
  assertNoncharging(result);
});

test("one metric cannot consume the other metric's unused allowance", () => {
  const result = preview(input({ voiceMinutes: 0, smsSegments: 141 }));
  assert.equal(result.allowanceScenario.voice.remainingUnits, 100);
  assert.equal(result.allowanceScenario.sms.overageUnits, 1);
  assert.equal(result.allowanceScenario.usageOverageMinor, 7);
});

test("annual base terms retain separate synthetic monthly windows without pooling or carryover", () => {
  const december = { startMs: Date.UTC(2025, 11, 1), endMs: Date.UTC(2026, 0, 1) };
  const before = preview(input({ frequency: "annual", period: december, voiceMinutes: 50, smsSegments: 70 }));
  const after = preview(input({ frequency: "annual", voiceMinutes: 101, smsSegments: 141 }));
  for (const result of [before, after]) {
    assert.equal(result.commercialTermsPreview.basePeriodMonths, 12);
    assert.equal(result.commercialTermsPreview.baseChargeMinor, 216_000);
    assert.equal(result.allowanceScenario.allowancePeriodMonths, 1);
    assert.equal(result.allowanceScenario.allowanceRollover, false);
    assert.equal(result.allowanceScenario.voice.includedUnits, 100);
    assert.equal(result.allowanceScenario.sms.includedUnits, 140);
    assertNoncharging(result);
  }
  assert.equal(before.allowanceScenario.voice.remainingUnits, 50);
  assert.equal(after.allowanceScenario.voice.overageMinor, 37);
  assert.equal(after.allowanceScenario.sms.overageMinor, 7);
  assert.equal(after.allowanceScenario.usageOverageMinor, 44);
  const monthly = preview(input({ voiceMinutes: 101, smsSegments: 141 }));
  assert.deepEqual(after.allowanceScenario, monthly.allowanceScenario);
});

test("explicit February and subscription-anchor fixture windows do not establish a reset policy", () => {
  for (const period of [
    { startMs: Date.UTC(2026, 1, 1), endMs: Date.UTC(2026, 2, 1) },
    { startMs: Date.UTC(2028, 1, 1), endMs: Date.UTC(2028, 2, 1) },
    { startMs: Date.UTC(2026, 0, 15, 12), endMs: Date.UTC(2026, 1, 15, 12) },
  ]) {
    const result = preview(input({ period, frequency: "annual", voiceMinutes: 101, smsSegments: 141 }));
    assert.equal(result.allowanceScenario.usageOverageMinor, 44);
    assertNoncharging(result);
  }
});

test("an annual observation window cannot become one annual allowance bucket", () => {
  const result = preview(input({ frequency: "annual",
    period: { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2027, 0, 1) } }));
  assert.equal(result.allowanceScenario.voice.overageMinor, null);
  assert.equal(result.allowanceScenario.sms.overageMinor, null);
  assert.equal(result.allowanceScenario.usageOverageMinor, null);
  assert.ok(result.holds.includes("monthly_allowance_window_unresolved"));
  assertNoncharging(result);
});

test("complete empty fixtures show zero hypothetical usage without a zero-charge conclusion", () => {
  const p = input(); p.records = []; p.smsRecords = [];
  const result = preview(p);
  assert.equal(result.allowanceScenario.voice.observedUnits, 0);
  assert.equal(result.allowanceScenario.sms.observedUnits, 0);
  assert.equal(result.allowanceScenario.voice.remainingUnits, 100);
  assert.equal(result.allowanceScenario.sms.remainingUnits, 140);
  assert.equal(result.allowanceScenario.usageOverageMinor, 0);
  assertNoncharging(result);
});

test("explicit zero allowances do not silently receive plan defaults", () => {
  const core = fixture(); core.plans.Growth.includedVoiceMinutes = 0; core.plans.Growth.includedSmsSegments = 0;
  const result = preview(input({ core, voiceMinutes: 3, smsSegments: 5 }));
  assert.equal(result.allowanceScenario.voice.includedUnits, 0);
  assert.equal(result.allowanceScenario.sms.includedUnits, 0);
  assert.equal(result.allowanceScenario.voice.overageMinor, 111);
  assert.equal(result.allowanceScenario.sms.overageMinor, 35);
  assert.equal(result.allowanceScenario.usageOverageMinor, 146);
});

test("exact voice and SMS duplicate observations count once in every snapshot", () => {
  const p = input({ voiceMinutes: 103, smsSegments: 145 });
  p.records.push(structuredClone(p.records[0]));
  p.smsRecords.push(structuredClone(p.smsRecords[0]), structuredClone(p.smsRecords[0]));
  const result = preview(p);
  assert.equal(result.exactDuplicatesObserved, 1);
  assert.equal(result.allowanceScenario.sms.exactDuplicatesObserved, 2);
  assert.equal(result.allowanceScenario.voice.observedUnits, 103);
  assert.equal(result.allowanceScenario.sms.observedUnits, 145);
  assert.equal(result.allowanceScenario.usageOverageMinor, 146);
  p.snapshot.revision = "c".repeat(64); p.smsSnapshot.revision = "d".repeat(64);
  const replay = preview(p);
  assert.notEqual(replay.previewRevision, result.previewRevision);
  assert.deepEqual(replay.allowanceScenario, result.allowanceScenario);
});

test("contradictory revisions hold rather than choosing first, newest or most frequent evidence", () => {
  const p = input({ voiceMinutes: 103, smsSegments: 145 });
  const correctedCall = { ...p.records[0], version: 2, durationMs: 101 * 60_000 };
  const correctedSms = { ...p.smsRecords[0], version: 2, segments: 141 };
  p.records.push(correctedCall, correctedCall);
  p.smsRecords.push(correctedSms, correctedSms);
  const result = preview(p);
  assert.equal(result.allowanceScenario.voice.overageMinor, null);
  assert.equal(result.allowanceScenario.sms.overageMinor, null);
  assert.equal(result.allowanceScenario.usageOverageMinor, null);
  assert.ok(result.holds.includes("conflicting_call_evidence"));
  assert.ok(result.holds.includes("conflicting_sms_evidence"));
  p.records.reverse(); p.smsRecords.reverse();
  assert.deepEqual(preview(p), result);
  assertNoncharging(result);
});

test("a separate corrected snapshot is recomputed, never added to a prior scenario", () => {
  const p = input({ voiceMinutes: 103, smsSegments: 145 });
  const initial = preview(p);
  p.records[0].version = 2; p.records[0].durationMs = 101 * 60_000;
  p.smsRecords[0].version = 2; p.smsRecords[0].segments = 141;
  p.snapshot.revision = "c".repeat(64); p.smsSnapshot.revision = "d".repeat(64);
  const corrected = preview(p);
  assert.equal(initial.allowanceScenario.usageOverageMinor, 146);
  assert.equal(corrected.allowanceScenario.usageOverageMinor, 44);
  assert.notEqual(corrected.previewRevision, initial.previewRevision);
  assertNoncharging(corrected);
});

test("incomplete provider evidence retains known subtotals but withholds the affected amount and total", () => {
  for (const metric of ["voice", "sms"]) {
    const p = input({ voiceMinutes: 103, smsSegments: 145 });
    p[metric === "voice" ? "snapshot" : "smsSnapshot"].complete = false;
    const result = preview(p), scenario = result.allowanceScenario;
    assert.equal(scenario[metric].knownUnitsSubtotal, metric === "voice" ? 103 : 145);
    assert.equal(scenario[metric].observedUnits, null);
    assert.equal(scenario[metric].remainingUnits, null);
    assert.equal(scenario[metric].overageUnits, null);
    assert.equal(scenario[metric].overageMinor, null);
    assert.equal(scenario[metric === "voice" ? "sms" : "voice"].overageMinor, metric === "voice" ? 35 : 111);
    assert.equal(scenario.usageOverageMinor, null);
    assertNoncharging(result);
  }
});

test("an incomplete empty snapshot is not a zero-usage or zero-overage conclusion", () => {
  const p = input(); p.records = []; p.smsRecords = [];
  p.snapshot.complete = false; p.smsSnapshot.complete = false;
  const result = preview(p);
  assert.equal(result.allowanceScenario.voice.knownUnitsSubtotal, 0);
  assert.equal(result.allowanceScenario.sms.knownUnitsSubtotal, 0);
  assert.equal(result.allowanceScenario.voice.overageMinor, null);
  assert.equal(result.allowanceScenario.sms.overageMinor, null);
  assert.equal(result.allowanceScenario.usageOverageMinor, null);
});

test("unknown SMS segmentation is never inferred from one message or unused allowance", () => {
  const p = input({ voiceMinutes: 100, smsSegments: 3 });
  p.smsRecords.push(message("synthetic_unknown", null));
  const result = preview(p), sms = result.allowanceScenario.sms;
  assert.equal(sms.messagesInPeriod, 2);
  assert.equal(sms.unknownSegmentMessages, 1);
  assert.equal(sms.knownUnitsSubtotal, 3);
  assert.equal(sms.observedUnits, null);
  assert.equal(sms.remainingUnits, null);
  assert.equal(sms.overageMinor, null);
  assert.equal(result.allowanceScenario.usageOverageMinor, null);
  assert.ok(result.holds.includes("sms_segmentation_unknown"));
});

test("known multisegment SMS consumes segments, not a count of messages", () => {
  const p = input({ smsSegments: 140 });
  p.smsRecords.push(message("synthetic_multisegment", 3));
  const sms = preview(p).allowanceScenario.sms;
  assert.equal(sms.messagesInPeriod, 2);
  assert.equal(sms.observedUnits, 143);
  assert.equal(sms.overageUnits, 3);
  assert.equal(sms.overageMinor, 21);
});

test("unknown voice duration withholds allowance consumption and cannot become zero", () => {
  const p = input(); p.records = [call("synthetic_unknown", null)];
  const result = preview(p);
  assert.equal(result.unknownDurationCalls, 1);
  assert.equal(result.allowanceScenario.voice.observedUnits, null);
  assert.equal(result.allowanceScenario.voice.remainingUnits, null);
  assert.equal(result.allowanceScenario.voice.overageMinor, null);
  assert.equal(result.allowanceScenario.usageOverageMinor, null);
  assert.ok(result.holds.includes("duration_unknown"));
});

for (const [name, durations] of [["one millisecond", [1]], ["below allowance", [30_000]],
  ["above allowance", [6_030_000]], ["fractions summing to a whole minute", [30_000, 30_000]]]) {
  test(`fractional voice ${name} holds before aggregation or rounding`, () => {
    const p = input(); p.records = durations.map((duration, index) => call(`synthetic_fraction_${index}`, duration));
    const result = preview(p);
    assert.equal(result.allowanceScenario.voice.observedUnits, null);
    assert.equal(result.allowanceScenario.voice.overageMinor, null);
    assert.equal(result.allowanceScenario.usageOverageMinor, null);
    assert.ok(result.allowanceScenario.voice.holds.includes("fractional_voice_rounding_unresolved"));
  });
}

test("fractional voice remains held even when a hypothetical rate would yield exact cents", () => {
  const core = fixture(); core.plans.Growth.includedVoiceMinutes = 0; core.voiceOverageMinorPerMinute = 40;
  const p = input({ core }); p.records = [call("synthetic_half_minute", 30_000)];
  const result = preview(p);
  assert.equal(result.allowanceScenario.voice.overageMinor, null);
  assert.ok(result.holds.includes("fractional_voice_rounding_unresolved"));
});

test("half-open period boundaries include the start and exclude the exact end", () => {
  const p = input();
  p.records = [call("synthetic_start", 60_000), call("synthetic_end", 60_000, january.endMs),
    call("synthetic_previous_fraction", 30_000, january.startMs - 30_000)];
  p.smsRecords = [message("synthetic_start", 1), message("synthetic_end", null, january.endMs),
    message("synthetic_previous", null, january.startMs - 1)];
  const result = preview(p);
  assert.equal(result.callsStartedInPeriod, 1);
  assert.equal(result.callsOutsidePeriod, 2);
  assert.equal(result.allowanceScenario.voice.observedUnits, 1);
  assert.deepEqual(result.allowanceScenario.voice.holds, []);
  assert.equal(result.allowanceScenario.sms.observedUnits, 1);
  assert.equal(result.allowanceScenario.sms.messagesOutsidePeriod, 2);
  assert.deepEqual(result.allowanceScenario.sms.holds, []);
});

test("voice crossing either period edge remains unallocated even with whole-minute duration", () => {
  for (const startMs of [january.startMs - 30_000, january.endMs - 30_000]) {
    const p = input(); p.records = [call("synthetic_crossing", 60_000, startMs)];
    const result = preview(p);
    assert.equal(result.callsOverlappingPeriodBoundary, 1);
    assert.equal(result.allowanceScenario.voice.overageMinor, null);
    assert.ok(result.holds.includes("period_boundary_allocation_unresolved"));
  }
});

test("duration exceeding the source interval cannot consume allowance", () => {
  const p = input(); p.records[0].endMs = p.records[0].startMs + 60_000;
  const result = preview(p);
  assert.equal(result.allowanceScenario.voice.overageMinor, null);
  assert.ok(result.holds.includes("duration_interval_inconsistent"));
});

test("a correction moving evidence across a period does not transfer usage or clear settlement holds", () => {
  const p = input({ voiceMinutes: 103, smsSegments: 145 });
  p.records[0].version = 2; p.smsRecords[0].version = 2;
  const durationMs = p.records[0].durationMs;
  p.records[0].startMs = january.endMs; p.records[0].endMs = january.endMs + durationMs;
  p.smsRecords[0].occurredAtMs = january.endMs;
  const januaryResult = preview(p);
  p.period = { startMs: Date.UTC(2026, 1, 1), endMs: Date.UTC(2026, 2, 1) };
  const februaryResult = preview(p);
  assert.equal(januaryResult.allowanceScenario.usageOverageMinor, 0);
  assert.equal(februaryResult.allowanceScenario.usageOverageMinor, 146);
  assertNoncharging(januaryResult); assertNoncharging(februaryResult);
});

test("monetary overflow is held without unsafe integer conversion", () => {
  const core = fixture(); core.plans.Growth.includedSmsSegments = 0; core.smsOverageMinorPerSegment = 1_000_000_000;
  const result = preview(input({ core, smsSegments: 9_007_200 }));
  assert.equal(result.allowanceScenario.sms.overageMinor, null);
  assert.equal(result.allowanceScenario.usageOverageMinor, null);
  assert.ok(result.holds.includes("amount_exceeds_safe_integer"));
});

test("the sum of individually safe amounts also remains exact or held", () => {
  const core = fixture();
  core.plans.Growth.includedVoiceMinutes = 0; core.plans.Growth.includedSmsSegments = 0;
  core.voiceOverageMinorPerMinute = 1_000_000_000; core.smsOverageMinorPerSegment = 1_000_000_000;
  const result = preview(input({ core, voiceMinutes: 1, smsSegments: 9_007_199 }));
  assert.equal(result.allowanceScenario.voice.overageMinor, 1_000_000_000);
  assert.equal(result.allowanceScenario.sms.overageMinor, 9_007_199_000_000_000);
  assert.equal(result.allowanceScenario.usageOverageMinor, null);
  assert.ok(result.holds.includes("amount_exceeds_safe_integer"));
});

test("snapshot ordering is deterministic, inputs are retained, and output is deeply immutable", () => {
  const p = input(); p.records.push(call("synthetic_other_call", 60_000));
  p.smsRecords.push(message("synthetic_other_message", 1));
  const before = structuredClone(p), result = preview(p);
  assert.deepEqual(p, before);
  p.records.reverse(); p.smsRecords.reverse();
  assert.deepEqual(preview(p), result);
  for (const mutate of [
    () => { result.billingAuthority = true; },
    () => { result.postingCapability = true; },
    () => { result.period.startMs = 0; },
    () => { result.allowanceScenario.voice.overageMinor = 0; },
    () => { result.allowanceScenario.sms.holds.push("other"); },
    () => { result.holds.length = 0; },
  ]) assert.throws(mutate, TypeError);
});

test("preview identity binds SMS evidence, completeness, revision, period and selected terms", () => {
  const original = input(), initial = preview(original);
  for (const change of [
    p => { p.smsRecords[0].segments++; }, p => { p.smsRecords[0].version++; },
    p => { p.smsRecords[0].occurredAtMs++; },
    p => { p.smsRecords.push(structuredClone(p.smsRecords[0])); },
    p => { p.smsSnapshot.complete = false; }, p => { p.smsSnapshot.revision = "f".repeat(64); },
    p => { p.period.endMs--; }, p => { p.plan = "Launch"; }, p => { p.frequency = "annual"; },
  ]) {
    const p = structuredClone(original); change(p);
    assert.notEqual(preview(p).previewRevision, initial.previewRevision);
  }
});

test("policy references and proposed rounding prose cannot activate a commercial rule", () => {
  const core = fixture(), p = input();
  for (const key of POLICY_KEYS) {
    core.policyVersions[key] = `policy-v1:${"c".repeat(64)}`;
    p.policy[key] = "SYNTHETIC PROPOSED POLICY: round each call up to the next minute";
  }
  for (const plan of Object.values(core.plans)) plan.scopeVersion = `policy-v1:${"d".repeat(64)}`;
  p.commercialTermsJson = termsJson(core); p.records = [call("synthetic_fraction", 1)];
  const result = preview(p);
  assert.deepEqual(result.unresolvedPolicyChoices, []);
  assert.equal(result.allowanceScenario.voice.overageMinor, null);
  assert.ok(result.allowanceScenario.voice.holds.includes("fractional_voice_rounding_unresolved"));
  assertNoncharging(result);
});

test("malformed, ambiguous or action-bearing inputs fail closed", () => {
  for (const change of [
    p => { delete p.scenarioBasis; }, p => { p.scenarioBasis = "approved"; },
    p => { p.allowancePeriodMonths = 12; }, p => { p.allowancePeriodMonths = "1"; },
    p => { p.postingCapability = true; }, p => { p.billingAuthority = true; },
    p => { p.provider = { submit() {} }; }, p => { p.rounding = "ceil"; },
    p => { p.smsSnapshot.complete = "true"; }, p => { delete p.smsSnapshot.complete; },
    p => { p.smsSnapshot.revision = "unknown"; }, p => { p.smsSnapshot.providerUsageStatus = "pending"; },
    p => { p.smsRecords[0].segments = 1.5; }, p => { p.smsRecords[0].segments = -1; },
    p => { p.smsRecords[0].segments = -0; }, p => { p.smsRecords[0].segments = "1"; },
    p => { delete p.smsRecords[0].segments; }, p => { p.smsRecords[0].segments = 1_000_000_001; },
    p => { p.smsRecords[0].version = 0; }, p => { p.smsRecords[0].occurredAtMs = NaN; },
    p => { p.smsRecords[0].scope.accountKey = "foreign_account"; },
    p => { p.smsRecords[0].body = "SYNTHETIC MESSAGE TEXT"; },
    p => { p.smsRecords[0].messageKey = ""; }, p => { p.smsRecords = new Array(1); },
    p => { p.smsRecords.push(...Array.from({ length: 10_000 }, () => structuredClone(p.smsRecords[0]))); },
    p => { p.records[0].durationMs = -0; }, p => { p.period.startMs = Infinity; },
    p => { p.period.endMs = p.period.startMs; }, p => { p[Symbol("hidden")] = true; },
    p => { p.smsRecords.extra = true; },
    p => { p.smsRecords[0] = Object.create(p.smsRecords[0]); },
  ]) {
    const p = input(); change(p);
    assert.throws(() => preview(p), /^TypeError: Usage preview input is invalid$/);
  }
});

test("accessor-bearing evidence is rejected without executing getters", () => {
  for (const location of [p => [p, "scenarioBasis"], p => [p.scope, "accountKey"],
    p => [p.smsSnapshot, "complete"], p => [p.smsRecords, "0"],
    p => [p.smsRecords[0], "segments"], p => [p.records[0], "durationMs"],
    p => [p.policy, "rounding"]]) {
    const p = input(); let invoked = false;
    const [object, key] = location(p);
    Object.defineProperty(object, key, { enumerable: true, get() { invoked = true; return 1; } });
    assert.throws(() => preview(p), TypeError);
    assert.equal(invoked, false);
  }
});
