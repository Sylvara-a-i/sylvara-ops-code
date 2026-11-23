"use strict";

const { fixture } = require("./helpers-commercial-v2");
const { deriveCommercialTermsV2Version } = require("../lib/commercial-terms-v2");
const { POLICY_KEYS } = require("../../../tools/preview-usage-period");

const scope = Object.freeze({ accountKey: "synthetic_account", subscriptionKey: "synthetic_subscription",
  configurationVersion: "synthetic_configuration" });
const january = Object.freeze({ startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 1, 1) });
const termsJson = core => JSON.stringify({ termsVersion: deriveCommercialTermsV2Version(core), ...core });

function call(callKey, durationMs, startMs = january.startMs) {
  return { scope: { ...scope }, callKey, version: 1, startMs,
    endMs: startMs + (durationMs ?? 60_000), durationMs };
}

function message(messageKey, segments, occurredAtMs = january.startMs) {
  return { scope: { ...scope }, messageKey, version: 1, occurredAtMs, segments };
}

function input({ plan = "Growth", frequency = "monthly", voiceMinutes = 100, smsSegments = 140,
  period = january, core = fixture() } = {}) {
  return { scope: { ...scope }, period: { ...period },
    snapshot: { revision: "a".repeat(64), complete: true },
    commercialTermsJson: termsJson(core), plan, frequency,
    policy: Object.fromEntries(POLICY_KEYS.map(key => [key, null])),
    records: [call("synthetic_call", voiceMinutes * 60_000, period.startMs)],
    scenarioBasis: "synthetic", allowancePeriodMonths: 1,
    smsSnapshot: { revision: "b".repeat(64), complete: true },
    smsRecords: [message("synthetic_message", smsSegments, period.startMs)] };
}

module.exports = { call, message, input, january, scope, termsJson };
