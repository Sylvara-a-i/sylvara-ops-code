"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CoverageModeContractError,
  assertCanonicalCoverageMode,
  assertCoverageTriggerCompatibility,
  contract,
  isCoverageTriggerCompatible,
  mapCoverageModeDisplayLabel,
  normalizeCoverageMode,
} = require("../lib/coverage-mode");

const CANONICAL_MODES = Object.freeze([
  "AfterHoursOnly",
  "NoAnswerOverflowOnly",
  "AfterHoursAndOverflow",
]);

test("the machine-readable contract exposes exactly three canonical modes", () => {
  assert.deepEqual(contract.canonical_coverage_modes, CANONICAL_MODES);
  assert.deepEqual(contract.coverage_triggers, ["AfterHours", "NoAnswerOverflow"]);
  assert.equal(contract.validation.coverage_trigger_is_separate_from_coverage_mode, true);
  assert.equal(contract.deployment_authorized, false);
});

test("approved CRM labels map to one canonical value", () => {
  const cases = new Map([
    ["After Hours Only", "AfterHoursOnly"],
    ["No Answer / Overflow Only", "NoAnswerOverflowOnly"],
    ["After Hours + Overflow", "AfterHoursAndOverflow"],
  ]);
  for (const [label, expected] of cases) {
    assert.equal(mapCoverageModeDisplayLabel(label), expected);
    assert.equal(normalizeCoverageMode(label), expected);
  }
});

test("canonical values normalize idempotently and display labels are not canonical", () => {
  for (const mode of CANONICAL_MODES) {
    assert.equal(assertCanonicalCoverageMode(mode), mode);
    assert.equal(normalizeCoverageMode(mode), mode);
  }
  assert.throws(
    () => assertCanonicalCoverageMode("After Hours Only"),
    CoverageModeContractError,
  );
});

test("unknown, blank, malformed, partial, and trigger-as-mode inputs fail closed", () => {
  const invalid = [
    undefined,
    null,
    "",
    " ",
    "\tAfterHoursOnly",
    "AfterHoursOnly ",
    "afterhoursonly",
    "AfterHours",
    "NoAnswerOverflow",
    "AfterHoursAnd",
    "After Hours+Overflow",
    "No Answer/Overflow Only",
    "No Answer  / Overflow Only",
    "Unknown",
  ];
  for (const value of invalid) {
    assert.throws(() => normalizeCoverageMode(value), CoverageModeContractError);
  }
});

test("coverage mode and per-call trigger compatibility is exact", () => {
  const cases = [
    ["AfterHoursOnly", "AfterHours", true],
    ["AfterHoursOnly", "NoAnswerOverflow", false],
    ["NoAnswerOverflowOnly", "NoAnswerOverflow", true],
    ["NoAnswerOverflowOnly", "AfterHours", false],
    ["AfterHoursAndOverflow", "AfterHours", true],
    ["AfterHoursAndOverflow", "NoAnswerOverflow", true],
  ];
  for (const [mode, trigger, expected] of cases) {
    assert.equal(isCoverageTriggerCompatible(mode, trigger), expected);
    if (expected) {
      assert.deepEqual(assertCoverageTriggerCompatibility(mode, trigger), {
        coverageMode: mode,
        coverageTrigger: trigger,
      });
    } else {
      assert.throws(
        () => assertCoverageTriggerCompatibility(mode, trigger),
        CoverageModeContractError,
      );
    }
  }
});

test("trigger validation rejects every missing, unknown, or wrong-domain value", () => {
  for (const trigger of [
    undefined,
    null,
    "",
    " ",
    "Unknown",
    "afterhours",
    "AfterHoursOnly",
    "NoAnswerOverflowOnly",
    "AfterHoursAndOverflow",
  ]) {
    assert.equal(isCoverageTriggerCompatible("AfterHoursOnly", trigger), false);
  }
  assert.equal(isCoverageTriggerCompatible("Unknown", "AfterHours"), false);
  assert.equal(isCoverageTriggerCompatible("After Hours Only", "AfterHours"), false);
});
