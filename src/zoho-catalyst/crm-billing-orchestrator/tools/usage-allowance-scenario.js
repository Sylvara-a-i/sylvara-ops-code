"use strict";

// Offline scenario arithmetic, not a meter or an implementation of policy prose.
// The caller composes this with the existing v2 evidence preview and its holds.
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const IDENTIFIER = /^[a-zA-Z0-9_-]{1,100}$/;
const SCOPE_KEYS = ["accountKey", "subscriptionKey", "configurationVersion"];
const fail = () => { throw new TypeError("Usage preview input is invalid"); };

function exact(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some(key => !keys.includes(key)
    || !Object.hasOwn(descriptors[key], "value") || !descriptors[key].enumerable)) fail();
}

function integer(value, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0 && value <= maximum;
}

function validateSnapshot(snapshot) {
  exact(snapshot, ["revision", "complete"]);
  if (typeof snapshot.revision !== "string" || !/^[a-f0-9]{64}$/.test(snapshot.revision)
    || typeof snapshot.complete !== "boolean") fail();
}

function validateScope(value, scope) {
  exact(value, SCOPE_KEYS);
  if (SCOPE_KEYS.some(key => typeof value[key] !== "string"
    || !IDENTIFIER.test(value[key]) || value[key] !== scope[key])) fail();
}

function validateRecords(records, keys) {
  if (!Array.isArray(records) || records.length > 10000) fail();
  // Sparse arrays, accessors, symbols and extra properties are not evidence.
  const descriptors = Object.getOwnPropertyDescriptors(records);
  if (Reflect.ownKeys(descriptors).length !== records.length + 1) fail();
  for (let index = 0; index < records.length; index++) {
    if (!descriptors[index] || !Object.hasOwn(descriptors[index], "value")) fail();
    exact(descriptors[index].value, keys);
  }
}

function validateScenarioInput(input, policyKeys) {
  exact(input, ["scope", "period", "snapshot", "commercialTermsJson", "plan", "frequency",
    "policy", "records", "scenarioBasis", "allowancePeriodMonths", "smsSnapshot", "smsRecords"]);
  if (input.scenarioBasis !== "synthetic" || input.allowancePeriodMonths !== 1) fail();
  validateScope(input.scope, input.scope);
  exact(input.period, ["startMs", "endMs"]);
  if (!integer(input.period.startMs) || !integer(input.period.endMs)
    || input.period.endMs <= input.period.startMs) fail();
  validateSnapshot(input.snapshot);
  validateSnapshot(input.smsSnapshot);
  exact(input.policy, policyKeys);
  validateRecords(input.records, ["scope", "callKey", "version", "startMs", "endMs", "durationMs"]);
  for (const row of input.records) {
    validateScope(row.scope, input.scope);
    if (!integer(row.version) || row.version < 1 || !integer(row.startMs) || !integer(row.endMs)
      || (row.durationMs !== null && !integer(row.durationMs, 86_400_000))) fail();
  }
  validateRecords(input.smsRecords, ["scope", "messageKey", "version", "occurredAtMs", "segments"]);
  for (const row of input.smsRecords) {
    validateScope(row.scope, input.scope);
    if (typeof row.messageKey !== "string" || !IDENTIFIER.test(row.messageKey)
      || !integer(row.version) || row.version < 1 || !integer(row.occurredAtMs)
      || (row.segments !== null && !integer(row.segments, 1_000_000_000))) fail();
  }
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function exactUnits(knownUnitsSubtotal, includedUnits, rateMinor, holds) {
  let observedUnits = null, remainingUnits = null, overageUnits = null, overageMinor = null;
  if (holds.size === 0) {
    observedUnits = knownUnitsSubtotal;
    remainingUnits = Math.max(0, includedUnits - observedUnits);
    overageUnits = Math.max(0, observedUnits - includedUnits);
    const amount = BigInt(overageUnits) * BigInt(rateMinor);
    if (amount > MAX_SAFE) holds.add("amount_exceeds_safe_integer");
    else overageMinor = Number(amount);
  }
  return { includedUnits, rateMinor, knownUnitsSubtotal, observedUnits,
    remainingUnits, overageUnits, overageMinor, holds: [...holds].sort() };
}

function previewAllowanceScenario(input, evidence) {
  const { period, smsSnapshot, smsRecords } = input;
  const terms = evidence.commercialTermsPreview;
  const windowHolds = [];
  // This bounds a supplied hypothetical monthly window; it does not choose or
  // verify a real reset anchor, timezone, month-end convention or proration rule.
  const days = (period.endMs - period.startMs) / 86_400_000;
  if (days < 27 || days > 32) windowHolds.push("monthly_allowance_window_unresolved");
  const voiceHolds = new Set(windowHolds);
  for (const hold of ["source_incomplete", "duration_unknown", "conflicting_call_evidence",
    "period_boundary_allocation_unresolved"]) {
    if (evidence.holds.includes(hold)) voiceHolds.add(hold);
  }
  // Even two fractional calls that sum to a whole minute require a rounding /
  // aggregation decision. Exact cents do not settle that commercial question.
  for (const row of input.records) {
    const startsInside = row.startMs >= period.startMs && row.startMs < period.endMs;
    const overlaps = row.startMs < period.endMs && row.endMs > period.startMs;
    if (!startsInside && !overlaps) continue;
    if (row.durationMs !== null && row.durationMs % 60_000 !== 0) {
      voiceHolds.add("fractional_voice_rounding_unresolved");
    }
    if (row.durationMs !== null && row.durationMs > row.endMs - row.startMs) {
      voiceHolds.add("duration_interval_inconsistent");
    }
  }
  const duration = evidence.knownStartedCallDurationMsSubtotal;
  const voice = exactUnits(duration % 60_000 === 0 ? duration / 60_000 : null,
    terms.includedVoiceMinutes, terms.voiceOverageMinorPerMinute, voiceHolds);
  voice.unit = "whole_minute_scenario";
  voice.knownDurationMsSubtotal = duration;

  const smsHolds = new Set(windowHolds), byKey = new Map(), canonicalRows = [];
  if (!smsSnapshot.complete) smsHolds.add("sms_source_incomplete");
  for (const row of smsRecords) {
    const canonical = JSON.stringify([row.messageKey, row.version, row.occurredAtMs, row.segments]);
    canonicalRows.push(canonical);
    if (byKey.has(row.messageKey) && byKey.get(row.messageKey) !== canonical) {
      byKey.set(row.messageKey, null);
      smsHolds.add("conflicting_sms_evidence");
    } else if (!byKey.has(row.messageKey)) byKey.set(row.messageKey, canonical);
  }
  let knownSegments = 0, messagesInPeriod = 0, messagesOutsidePeriod = 0, unknownSegments = 0;
  for (const canonical of byKey.values()) {
    if (canonical === null) continue;
    const [, , occurredAtMs, segments] = JSON.parse(canonical);
    if (occurredAtMs < period.startMs || occurredAtMs >= period.endMs) {
      messagesOutsidePeriod++; continue;
    }
    messagesInPeriod++;
    if (segments === null) { unknownSegments++; smsHolds.add("sms_segmentation_unknown"); }
    else knownSegments += segments;
  }
  const sms = exactUnits(knownSegments, terms.includedSmsSegments, terms.smsOverageMinorPerSegment, smsHolds);
  Object.assign(sms, { unit: "segment_scenario", sourceComplete: smsSnapshot.complete,
    uniqueMessageKeys: byKey.size, exactDuplicatesObserved: smsRecords.length - new Set(canonicalRows).size,
    messagesInPeriod, messagesOutsidePeriod, unknownSegmentMessages: unknownSegments });
  const holds = new Set([...voice.holds, ...sms.holds]);
  let usageOverageMinor = null;
  if (voice.overageMinor !== null && sms.overageMinor !== null) {
    const amount = BigInt(voice.overageMinor) + BigInt(sms.overageMinor);
    if (amount > MAX_SAFE) holds.add("amount_exceeds_safe_integer");
    else usageOverageMinor = Number(amount);
  }
  return { scenario: { basis: "synthetic", allowancePeriodMonths: 1, allowanceRollover: false,
    windowVerified: false, voice, sms, usageOverageMinor, holds: [...holds].sort() },
  canonicalSmsRows: [...new Set(canonicalRows)].sort() };
}

module.exports = { validateScenarioInput, previewAllowanceScenario, freeze };
