"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { installOfflineGuard } = require("../../../../revenue-desk-release/test/helpers/offline-guard");
const guard = installOfflineGuard();
const {
  deriveCommercialTermsV2Version: derive,
  parseCommercialTermsV2: parse,
  selectCommercialTermsV2: select,
} = require("../lib/commercial-terms-v2");
const { parsePaidCommercialTerms } = require("../lib/commercial-terms");
const { loadConfig } = require("../lib/config");
const { baseEnvironment, REVISION, DEVELOPMENT_ZAID_HMAC_SHA256 } = require("./helpers");
const PROOF = { artifactRevision: REVISION,
  artifactDevelopmentZaidHmacSha256: DEVELOPMENT_ZAID_HMAC_SHA256 };
test.after(() => { assert.deepEqual(guard.blocked, []); guard.restore(); });
const error = /commercial terms v2 are invalid/;
const reference = character => `policy-v1:${character.repeat(64)}`;

const { fixture } = require("./helpers-commercial-v2");
const serialize = core => JSON.stringify({ termsVersion: derive(core), ...core });
const candidate = () => parse(serialize(fixture()));

function reorder(value) {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)]));
}

test("v2 content version is stable across every object property order", () => {
  const core = fixture();
  assert.match(derive(core), /^terms-v2:[a-f0-9]{64}$/);
  assert.equal(derive(reorder(core)), derive(core));
  assert.deepEqual(parse(serialize(reorder(core))), parse(serialize(core)));
});

for (const plan of ["Launch", "Growth", "Scale"]) {
  test(`${plan} monthly and annual previews preserve monthly allowances and undiscounted setup/usage`, () => {
    const core = fixture(); const parsed = parse(serialize(core));
    const monthly = select(parsed, plan, "monthly");
    const annual = select(parsed, plan, "annual");
    assert.equal(monthly.baseChargeMinor, core.plans[plan].monthlyBaseMinor);
    assert.equal(monthly.basePeriodMonths, 1);
    assert.equal(annual.baseChargeMinor, core.plans[plan].annualBaseMinor);
    assert.equal(annual.basePeriodMonths, 12);
    for (const selected of [monthly, annual]) {
      assert.equal(selected.allowancePeriodMonths, 1);
      assert.equal(selected.allowanceRollover, false);
      assert.equal(selected.includedVoiceMinutes, core.plans[plan].includedVoiceMinutes);
      assert.equal(selected.includedSmsSegments, core.plans[plan].includedSmsSegments);
      assert.equal(selected.setupMinor, core.plans[plan].setupMinor);
      assert.equal(selected.voiceOverageMinorPerMinute, core.voiceOverageMinorPerMinute);
      assert.equal(selected.smsOverageMinorPerSegment, core.smsOverageMinorPerSegment);
      assert.equal(selected.billingAuthority, false);
      assert.equal(selected.paidExecutionEligible, false);
    }
  });
}

const mutations = [
  ["voice overage", core => { core.voiceOverageMinorPerMinute += 1; }],
  ["SMS overage", core => { core.smsOverageMinorPerSegment += 1; }],
  ["annual discount", core => {
    core.annualBaseDiscountBasisPoints = 2000;
    for (const plan of Object.values(core.plans)) plan.annualBaseMinor = plan.monthlyBaseMinor * 12 * 0.8;
  }],
  ...["unusedWholeMonthsRefundable", "currentMonthRefundable", "completedSetupRefundable"]
    .map(key => [`refund ${key}`, core => { core.annualRefund[key] = !core.annualRefund[key]; }]),
  ...["connectedTimeDefinition", "rounding", "exclusions", "periodAttribution",
    "lateEventsAndCorrections", "usageLimits", "disputes"]
    .map(key => [`policy ${key}`, core => { core.policyVersions[key] = reference("a"); }]),
  ...["Launch", "Growth", "Scale"].flatMap(name => [
    [`${name} base quote`, core => { core.plans[name].monthlyBaseMinor += 10_000; core.plans[name].annualBaseMinor += 108_000; }],
    ...["setupMinor", "includedVoiceMinutes", "includedSmsSegments"]
      .map(key => [`${name} ${key}`, core => { core.plans[name][key] += 1; }]),
    [`${name} scope`, core => { core.plans[name].scopeVersion = reference("b"); }],
  ]),
];
for (const [name, change] of mutations) {
  test(`changing ${name} invalidates the old content version`, () => {
    const core = fixture(); const oldVersion = derive(core); change(core);
    assert.notEqual(derive(core), oldVersion);
    assert.throws(() => parse(JSON.stringify({ termsVersion: oldVersion, ...core })), error);
    assert.equal(parse(serialize(core)).termsVersion, derive(core));
  });
}

const invalidCoreChanges = [
  ["currency", core => { core.currency = "CAD"; }],
  ["annual term", core => { core.annualTermMonths = 24; }],
  ["allowance annualization", core => { core.allowancePeriodMonths = 12; }],
  ["rollover", core => { core.allowanceRollover = true; }],
  ["fractional discount", core => { core.annualBaseDiscountBasisPoints = 1000.5; }],
  ["negative discount", core => { core.annualBaseDiscountBasisPoints = -1; }],
  ["full discount", core => { core.annualBaseDiscountBasisPoints = 10_000; }],
  ["annual mismatch", core => { core.plans.Launch.annualBaseMinor += 1; }],
  ["implicit cent rounding", core => { core.plans.Launch.monthlyBaseMinor = 101; core.plans.Launch.annualBaseMinor = 1091; }],
  ["coerced amount", core => { core.plans.Launch.setupMinor = "12300"; }],
  ["fractional amount", core => { core.plans.Launch.setupMinor = 12.5; }],
  ["unsafe amount", core => { core.plans.Launch.setupMinor = Number.MAX_SAFE_INTEGER + 1; }],
  ["unbounded amount", core => { core.plans.Launch.setupMinor = 1_000_000_001; }],
  ["negative zero", core => { core.plans.Launch.setupMinor = -0; }],
  ["negative allowance", core => { core.plans.Launch.includedVoiceMinutes = -1; }],
  ["fractional SMS segment", core => { core.plans.Launch.includedSmsSegments = 0.5; }],
  ["zero voice rate", core => { core.voiceOverageMinorPerMinute = 0; }],
  ["infinite SMS rate", core => { core.smsOverageMinorPerSegment = Infinity; }],
  ["unknown root key", core => { core.execute = true; }],
  ["unknown plan", core => { core.plans.Enterprise = core.plans.Launch; }],
  ["unknown plan key", core => { core.plans.Launch.unlimited = true; }],
  ["unknown refund key", core => { core.annualRefund.all = true; }],
  ["unknown policy key", core => { core.policyVersions.approved = true; }],
  ["omitted plan", core => { delete core.plans.Scale; }],
  ["omitted allowance", core => { delete core.plans.Launch.includedVoiceMinutes; }],
  ["omitted policy", core => { delete core.policyVersions.rounding; }],
  ["malformed policy", core => { core.policyVersions.rounding = "approved"; }],
  ["malformed scope", core => { core.plans.Launch.scopeVersion = reference("g"); }],
  ["nonboolean refund", core => { core.annualRefund.currentMonthRefundable = "false"; }],
  ["array plans", core => { core.plans = []; }],
  ["inherited plans", core => { core.plans = Object.create(core.plans); }],
  ["symbol key", core => { core[Symbol("hidden")] = true; }],
  ["nonenumerable key", core => { Object.defineProperty(core, "currency", { value: "USD", enumerable: false }); }],
];
for (const [name, change] of invalidCoreChanges) {
  test(`${name} is invalid before a content version can be generated`, () => {
    const core = fixture(); change(core);
    assert.throws(() => derive(core), error);
  });
}

test("accessors are rejected without invoking their getters", () => {
  for (const location of ["root", "plan", "policy", "refund"]) {
    const core = fixture(); let called = false;
    const [object, key] = location === "root" ? [core, "currency"]
      : location === "plan" ? [core.plans.Launch, "setupMinor"]
      : location === "policy" ? [core.policyVersions, "rounding"]
      : [core.annualRefund, "currentMonthRefundable"];
    Object.defineProperty(object, key, { enumerable: true, get() { called = true; return "unsafe"; } });
    assert.throws(() => derive(core), error); assert.equal(called, false);
  }
});

test("explicit zero setup and allowances are retained without introducing defaults", () => {
  const core = fixture(); Object.assign(core.plans.Launch, {
    setupMinor: 0, includedVoiceMinutes: 0, includedSmsSegments: 0,
  });
  const selected = select(parse(serialize(core)), "Launch", "annual");
  assert.equal(selected.setupMinor, 0); assert.equal(selected.includedVoiceMinutes, 0);
  assert.equal(selected.includedSmsSegments, 0);
});

test("explicit missing policies stay held, and complete references still confer no authority", () => {
  const initial = candidate(); assert.equal(initial.missingPolicyReferences.length, 10);
  const core = fixture();
  for (const name of Object.keys(core.policyVersions)) core.policyVersions[name] = reference("a");
  for (const plan of Object.values(core.plans)) plan.scopeVersion = reference("b");
  const parsed = parse(serialize(core)); assert.deepEqual(parsed.missingPolicyReferences, []);
  for (const output of [parsed, select(parsed, "Growth", "annual")]) {
    assert.equal(output.billingAuthority, false); assert.equal(output.paidExecutionEligible, false);
    assert.deepEqual(output.holds, ["commercial_acceptance_unverified", "policy_bodies_unverified", "native_billing_unqualified"]);
  }
});

test("parsed inputs and selected previews are deeply frozen and do not retain caller objects", () => {
  const core = fixture(); const parsed = parse(serialize(core)); const selected = select(parsed, "Growth", "annual");
  core.plans.Growth.includedVoiceMinutes += 999;
  assert.equal(selected.includedVoiceMinutes, 100);
  for (const mutate of [
    () => { parsed.terms.plans.Growth.setupMinor = 1; },
    () => { selected.policyVersions.rounding = reference("a"); },
    () => { selected.holds.push("other"); },
    () => { selected.annualRefund.currentMonthRefundable = true; },
    () => { selected.billingAuthority = true; },
  ]) assert.throws(mutate, TypeError);
});

test("selection rejects forged/deserialized candidates and unknown plan/frequency labels", () => {
  const parsed = candidate();
  for (const [input, plan, frequency] of [
    [{}, "Launch", "monthly"], [structuredClone(parsed), "Launch", "monthly"],
    [parsed, "Enterprise", "monthly"], [parsed, "Option 1", "monthly"],
    [parsed, "Launch", "yearly"], [parsed, "Launch", "Annual"],
  ]) assert.throws(() => select(input, plan, frequency), error);
});

test("invalid JSON, size, shape and version produce only sanitized errors", () => {
  const core = fixture();
  for (const raw of [null, 1, "", "{", "[]", "null", "{}", " ".repeat(16_385),
    JSON.stringify({ termsVersion: `terms-v2:${"0".repeat(64)}`, ...core }),
    JSON.stringify({ termsVersion: `terms-v1:${"0".repeat(64)}`, ...core }),
    JSON.stringify({ termsVersion: derive(core), ...core, privateLabel: "do-not-log" }),
  ]) assert.throws(() => parse(raw), exception => exception instanceof TypeError
    && exception.message === "commercial terms v2 are invalid");
});

test("v2 cannot enter the existing paid configuration or terms-v1 acceptance path", () => {
  const raw = serialize(fixture());
  assert.throws(() => parsePaidCommercialTerms(raw), /paid commercial terms are invalid/);
  assert.throws(() => loadConfig(baseEnvironment({ PAID_COMMERCIAL_TERMS_JSON: raw }), PROOF),
    /PAID_COMMERCIAL_TERMS_JSON/);
  // Report-only startup remains independent of any commercial candidate.
  const reportOnly = loadConfig(baseEnvironment({
    ENABLE_PAID_SUBSCRIPTION_PREPARATION: "false", PAID_COMMERCIAL_TERMS_JSON: raw,
  }), PROOF);
  assert.equal(reportOnly.enablePaidSubscriptionPreparation, false);
});
