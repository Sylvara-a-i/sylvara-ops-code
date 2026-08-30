"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const {
  derivePaidCommercialTermsAcceptanceVersion,
  parsePaidCommercialTerms,
} = require("../lib/commercial-terms");
const { SYNTHETIC_COMMERCIAL_TERMS } = require("./helpers");

function core(value = SYNTHETIC_COMMERCIAL_TERMS) {
  const { acceptanceVersion: _acceptanceVersion, ...commercialTerms } = value;
  return structuredClone(commercialTerms);
}

test("commercial acceptance version is the canonical digest of every private term", () => {
  const terms = core();
  const canonical = JSON.stringify([
    ["currency", terms.currency],
    ["interval", terms.interval],
    ["intervalUnit", terms.intervalUnit],
    ["commonUsageRateMinor", terms.commonUsageRateMinor],
    ["plans", ["Launch::Monthly", "Growth::Monthly", "Scale::Monthly"].map((key) => [
      key,
      terms.plans[key].recurringMinor,
      terms.plans[key].setupMinor,
    ])],
  ]);
  const expected = `terms-v1:${crypto.createHash("sha256")
    .update(canonical, "utf8").digest("hex")}`;
  assert.equal(derivePaidCommercialTermsAcceptanceVersion(terms), expected);
  assert.equal(SYNTHETIC_COMMERCIAL_TERMS.acceptanceVersion, expected);
  assert.match(expected, /^terms-v1:[a-f0-9]{64}$/);

  const reordered = {
    plans: {
      "Scale::Monthly": {
        setupMinor: terms.plans["Scale::Monthly"].setupMinor,
        recurringMinor: terms.plans["Scale::Monthly"].recurringMinor,
      },
      "Growth::Monthly": terms.plans["Growth::Monthly"],
      "Launch::Monthly": terms.plans["Launch::Monthly"],
    },
    intervalUnit: terms.intervalUnit,
    interval: terms.interval,
    currency: terms.currency,
    commonUsageRateMinor: terms.commonUsageRateMinor,
  };
  assert.equal(derivePaidCommercialTermsAcceptanceVersion(reordered), expected);
});

test("a reused or mismatched acceptance label cannot authorize changed terms", () => {
  const wrongCurrency = core();
  wrongCurrency.currency = "CAD";
  assert.throws(
    () => derivePaidCommercialTermsAcceptanceVersion(wrongCurrency),
    /paid commercial terms are invalid/,
  );
  assert.throws(() => parsePaidCommercialTerms(JSON.stringify({
    acceptanceVersion: SYNTHETIC_COMMERCIAL_TERMS.acceptanceVersion,
    ...wrongCurrency,
  })), /paid commercial terms are invalid/);

  const mutations = [
    (terms) => { terms.commonUsageRateMinor += 1; },
    (terms) => { terms.plans["Launch::Monthly"].recurringMinor += 1; },
    (terms) => { terms.plans["Launch::Monthly"].setupMinor += 1; },
    (terms) => { terms.plans["Growth::Monthly"].recurringMinor += 1; },
    (terms) => { terms.plans["Growth::Monthly"].setupMinor += 1; },
    (terms) => { terms.plans["Scale::Monthly"].recurringMinor += 1; },
    (terms) => { terms.plans["Scale::Monthly"].setupMinor += 1; },
  ];
  for (const mutate of mutations) {
    const changed = core();
    mutate(changed);
    assert.notEqual(
      derivePaidCommercialTermsAcceptanceVersion(changed),
      SYNTHETIC_COMMERCIAL_TERMS.acceptanceVersion,
    );
    assert.throws(() => parsePaidCommercialTerms(JSON.stringify({
      acceptanceVersion: SYNTHETIC_COMMERCIAL_TERMS.acceptanceVersion,
      ...changed,
    })), /paid commercial terms are invalid/);
  }

  const intentionallyChanged = core();
  intentionallyChanged.commonUsageRateMinor += 1;
  const replacementVersion = derivePaidCommercialTermsAcceptanceVersion(intentionallyChanged);
  assert.equal(parsePaidCommercialTerms(JSON.stringify({
    acceptanceVersion: replacementVersion,
    ...intentionallyChanged,
  })).acceptanceVersion, replacementVersion);
});
