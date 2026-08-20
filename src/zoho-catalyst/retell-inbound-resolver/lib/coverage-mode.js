"use strict";

const contract = require("../contracts/coverage-mode-contract.json");

class CoverageModeContractError extends Error {
  constructor(code) {
    super("Coverage-mode contract validation failed");
    this.name = "CoverageModeContractError";
    this.code = code;
  }
}

function fail(code) {
  throw new CoverageModeContractError(code);
}

function assertExactString(value, code) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    fail(code);
  }
  return value;
}

function assertUniqueStrings(values, code) {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => {
      try {
        assertExactString(value, code);
        return false;
      } catch {
        return true;
      }
    }) ||
    new Set(values).size !== values.length
  ) {
    fail(code);
  }
}

function buildContractState(source) {
  if (
    !source ||
    source.schema_version !== 1 ||
    source.decision_status !== "approved" ||
    source.deployment_authorized !== false
  ) {
    fail("coverage_contract_invalid");
  }

  assertUniqueStrings(source.canonical_coverage_modes, "coverage_contract_invalid");
  assertUniqueStrings(source.coverage_triggers, "coverage_contract_invalid");

  const canonicalModes = new Set(source.canonical_coverage_modes);
  const coverageTriggers = new Set(source.coverage_triggers);
  const displayLabelMap = new Map();

  if (!Array.isArray(source.display_label_mappings)) {
    fail("coverage_contract_invalid");
  }
  for (const mapping of source.display_label_mappings) {
    if (!mapping || Object.keys(mapping).sort().join(",") !== "coverage_mode,display_label") {
      fail("coverage_contract_invalid");
    }
    const label = assertExactString(mapping.display_label, "coverage_contract_invalid");
    const mode = assertExactString(mapping.coverage_mode, "coverage_contract_invalid");
    if (!canonicalModes.has(mode) || displayLabelMap.has(label)) {
      fail("coverage_contract_invalid");
    }
    displayLabelMap.set(label, mode);
  }

  const compatibility = source.compatible_triggers_by_coverage_mode;
  if (
    !compatibility ||
    Object.keys(compatibility).length !== canonicalModes.size ||
    Object.keys(compatibility).some((mode) => !canonicalModes.has(mode))
  ) {
    fail("coverage_contract_invalid");
  }
  const compatibleTriggersByMode = new Map();
  for (const mode of canonicalModes) {
    const triggers = compatibility[mode];
    assertUniqueStrings(triggers, "coverage_contract_invalid");
    if (triggers.some((trigger) => !coverageTriggers.has(trigger))) {
      fail("coverage_contract_invalid");
    }
    compatibleTriggersByMode.set(mode, new Set(triggers));
  }

  return Object.freeze({
    canonicalModes,
    coverageTriggers,
    displayLabelMap,
    compatibleTriggersByMode,
  });
}

const state = buildContractState(contract);

function mapCoverageModeDisplayLabel(value) {
  const label = assertExactString(value, "coverage_mode_display_label_invalid");
  const mode = state.displayLabelMap.get(label);
  if (!mode) fail("coverage_mode_display_label_unsupported");
  return mode;
}

function assertCanonicalCoverageMode(value) {
  const mode = assertExactString(value, "coverage_mode_invalid");
  if (!state.canonicalModes.has(mode)) fail("coverage_mode_unsupported");
  return mode;
}

function normalizeCoverageMode(value) {
  const input = assertExactString(value, "coverage_mode_invalid");
  if (state.canonicalModes.has(input)) return input;
  const mapped = state.displayLabelMap.get(input);
  if (!mapped) fail("coverage_mode_unsupported");
  return mapped;
}

function assertCoverageTriggerCompatibility(coverageMode, coverageTrigger) {
  const canonicalMode = assertCanonicalCoverageMode(coverageMode);
  const trigger = assertExactString(coverageTrigger, "coverage_trigger_invalid");
  if (
    !state.coverageTriggers.has(trigger) ||
    !state.compatibleTriggersByMode.get(canonicalMode).has(trigger)
  ) {
    fail("coverage_trigger_incompatible");
  }
  return Object.freeze({ coverageMode: canonicalMode, coverageTrigger: trigger });
}

function isCoverageTriggerCompatible(coverageMode, coverageTrigger) {
  try {
    assertCoverageTriggerCompatibility(coverageMode, coverageTrigger);
    return true;
  } catch (error) {
    if (error instanceof CoverageModeContractError) return false;
    throw error;
  }
}

module.exports = Object.freeze({
  CoverageModeContractError,
  assertCanonicalCoverageMode,
  assertCoverageTriggerCompatibility,
  contract,
  isCoverageTriggerCompatible,
  mapCoverageModeDisplayLabel,
  normalizeCoverageMode,
});
