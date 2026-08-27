'use strict';

const contract = require('../contracts/revenue-desk-call-contract.json');
const capabilityRegistry = require('../contracts/capability-profiles.json');

function freezeSet(values) {
  return Object.freeze(new Set(values));
}

function freezeMap(entries) {
  return Object.freeze(new Map(entries));
}

const COVERAGE_MODES = freezeSet(contract.canonical_coverage_modes);
const COVERAGE_LABEL_TO_MODE = freezeMap(
  contract.display_label_mappings.map(({ display_label: label, coverage_mode: mode }) => [label, mode]),
);
const COVERAGE_MODE_TO_LABEL = freezeMap(
  contract.display_label_mappings.map(({ display_label: label, coverage_mode: mode }) => [mode, label]),
);
const CRM_TEST_STATUSES = freezeSet(contract.crm_test_statuses);
const CRM_APPROVAL_STATUSES = freezeSet(contract.crm_go_live_approval_statuses);
const STOP_REASON_TO_CRM = freezeMap(
  contract.stop_reason_mappings.map(({ internal, crm_test_end_reason: reason }) => [internal, reason]),
);
const CRM_STOP_REASON_TO_INTERNAL = freezeMap(
  contract.stop_reason_mappings.map(({ internal, crm_test_end_reason: reason }) => [reason, internal]),
);
const OUTCOME_TO_LABEL = freezeMap(contract.outcomes.map(({ value, label }) => [value, label]));
const OUTCOMES = freezeSet(contract.outcomes.map(({ value }) => value));
const COVERAGE_TRIGGERS = freezeSet(contract.coverage_triggers);
const COVERAGE_TRIGGER_COMPATIBILITY = freezeMap(
  Object.entries(contract.compatible_triggers_by_coverage_mode || {})
    .map(([mode, triggers]) => [mode, freezeSet(triggers)]),
);
const UNKNOWN_COVERAGE_TRIGGER_POLICY = Object.freeze({
  ...(contract.unknown_coverage_trigger_policy || {}),
});
const VALUE_EVIDENCE_CLASSES = freezeSet(contract.value_evidence_classes);
const MVP_REPORT_VALUE_EVIDENCE_CLASSES = freezeSet(contract.mvp_report_value_evidence_classes);
const MVP_REPORT_VALUE_EVIDENCE_SOURCES = freezeSet(contract.mvp_report_value_evidence_sources);
const RETELL_CUSTOM_ANALYSIS_FIELDS = freezeSet(contract.retell_custom_analysis_fields);
const RETELL_LIVE_SHARED_AGENT_ANALYSIS_FIELDS = freezeSet(
  contract.retell_live_shared_agent_analysis_fields,
);
const RETELL_REQUIRED_RUNTIME_ANALYSIS_FIELDS = freezeSet(
  contract.retell_required_runtime_analysis_fields,
);
const RETELL_CONVERSATION_VARIABLE_FIELDS = freezeSet(
  contract.retell_conversation_variable_fields,
);
const CUSTOMER_TYPES = freezeSet(contract.customer_types);
const URGENCIES = freezeSet(contract.urgencies);
const OPTIONAL_VALUE_EVIDENCE_FIELDS = freezeSet(contract.optional_value_evidence_fields);
const RETELL_EVENTS = freezeSet(contract.retell_events);
const NOTIFICATION_STATES = freezeSet(contract.notification_states);
const ENGAGEMENT_TYPES = freezeSet(capabilityRegistry.engagement_types);
const CAPABILITY_PROFILES = freezeMap(
  capabilityRegistry.profiles.map((profile) => [profile.id, Object.freeze({ ...profile,
    traffic_environments: Object.freeze([...profile.traffic_environments]) })]),
);

function assertContract() {
  if (contract.environment !== 'development') throw new Error('Contract must be Development-only.');
  if (contract.production_mode !== 'dark_readiness_only') {
    throw new Error('Production must remain dark readiness only.');
  }
  if (contract.engagement_type !== 'free_test') throw new Error('Unexpected engagement type.');
  if (contract.capability_profile !== 'call_gap_monitor_v1') throw new Error('Unexpected capability profile.');
  if (contract.resolved_status !== 'Resolved') throw new Error('Unexpected resolver status.');
  if (contract.test_duration_days !== 7 || contract.handled_call_limit !== 25) {
    throw new Error('Unexpected free-test duration or handled-call limit.');
  }
  if (contract.canonical_call_schema_version !== 2
    || contract.legacy_canonical_call_schema_versions.length !== 1
    || contract.legacy_canonical_call_schema_versions[0] !== 1) {
    throw new Error('Unexpected canonical call schema compatibility contract.');
  }
  if (COVERAGE_MODES.size !== 3 || COVERAGE_LABEL_TO_MODE.size !== 3 || COVERAGE_MODE_TO_LABEL.size !== 3) {
    throw new Error('Coverage mapping must be one-to-one across exactly three values.');
  }
  for (const mode of COVERAGE_MODES) {
    if (!COVERAGE_MODE_TO_LABEL.has(mode)) throw new Error(`Missing display label for ${mode}.`);
  }
  if (COVERAGE_TRIGGERS.size !== 3
    || !COVERAGE_TRIGGERS.has('AfterHours')
    || !COVERAGE_TRIGGERS.has('NoAnswerOverflow')
    || !COVERAGE_TRIGGERS.has('Unknown')
    || COVERAGE_TRIGGER_COMPATIBILITY.size !== COVERAGE_MODES.size
    || [...COVERAGE_TRIGGER_COMPATIBILITY.keys()].some((mode) => !COVERAGE_MODES.has(mode))) {
    throw new Error('Coverage-trigger compatibility must cover the canonical contract exactly.');
  }
  const classifiedTriggers = new Set([...COVERAGE_TRIGGERS]
    .filter((trigger) => trigger !== UNKNOWN_COVERAGE_TRIGGER_POLICY.value));
  for (const mode of COVERAGE_MODES) {
    const compatible = COVERAGE_TRIGGER_COMPATIBILITY.get(mode);
    if (!compatible || compatible.size === 0
      || [...compatible].some((trigger) => !classifiedTriggers.has(trigger))) {
      throw new Error(`Coverage-trigger compatibility is invalid for ${mode}.`);
    }
  }
  if (UNKNOWN_COVERAGE_TRIGGER_POLICY.value !== 'Unknown'
    || UNKNOWN_COVERAGE_TRIGGER_POLICY.allowed_for_all_canonical_coverage_modes !== true
    || typeof UNKNOWN_COVERAGE_TRIGGER_POLICY.meaning !== 'string'
    || !UNKNOWN_COVERAGE_TRIGGER_POLICY.meaning) {
    throw new Error('Unknown coverage-trigger handling must be explicit and fail closed by mode.');
  }
  if (contract.coverage_validation?.case_sensitive !== true
    || contract.coverage_validation.trim_inputs !== false
    || contract.coverage_validation.unknown_mode_values_fail_closed !== true
    || contract.coverage_validation.coverage_trigger_is_separate_from_coverage_mode !== true) {
    throw new Error('Coverage-mode and trigger validation must remain exact and fail closed.');
  }
  if (OUTCOMES.size !== contract.outcomes.length) throw new Error('Outcome values must be unique.');
  if (RETELL_CUSTOM_ANALYSIS_FIELDS.size !== 15
    || !RETELL_CUSTOM_ANALYSIS_FIELDS.has('bookable_opportunity')
    || !RETELL_CUSTOM_ANALYSIS_FIELDS.has('office_follow_up_required')
    || !RETELL_CUSTOM_ANALYSIS_FIELDS.has('workflow_failure_code')
    || !RETELL_CUSTOM_ANALYSIS_FIELDS.has('workflow_failure_text')) {
    throw new Error('Unexpected Retell structured analysis surface.');
  }
  if (contract.retell_custom_analysis_readback?.runtime_supported_field_count !== 15
    || contract.retell_custom_analysis_readback.live_shared_agent_field_count !== 11
    || contract.retell_custom_analysis_readback.status !== 'pending_retell_agent_qa') {
    throw new Error('Unexpected Retell analysis readback status.');
  }
  if (RETELL_LIVE_SHARED_AGENT_ANALYSIS_FIELDS.size !== 11
    || [...RETELL_LIVE_SHARED_AGENT_ANALYSIS_FIELDS]
      .some((field) => !RETELL_CUSTOM_ANALYSIS_FIELDS.has(field))
    || RETELL_REQUIRED_RUNTIME_ANALYSIS_FIELDS.size !== 5
    || [...RETELL_REQUIRED_RUNTIME_ANALYSIS_FIELDS]
      .some((field) => !RETELL_LIVE_SHARED_AGENT_ANALYSIS_FIELDS.has(field))) {
    throw new Error('Unexpected live or required Retell analysis field contract.');
  }
  if (RETELL_CONVERSATION_VARIABLE_FIELDS.size !== 15
    || !RETELL_CONVERSATION_VARIABLE_FIELDS.has('configuration_version')
    || !RETELL_CONVERSATION_VARIABLE_FIELDS.has('services_handled_json')
    || RETELL_CONVERSATION_VARIABLE_FIELDS.has('configuration_version_id')
    || RETELL_CONVERSATION_VARIABLE_FIELDS.has('ownership_token')) {
    throw new Error('Unexpected Retell conversation-variable allowlist.');
  }
  if (CUSTOMER_TYPES.size !== 3 || !CUSTOMER_TYPES.has('unknown')
    || URGENCIES.size !== 4 || !URGENCIES.has('immediate_danger')) {
    throw new Error('Unexpected Retell customer or urgency enum contract.');
  }
  if (OPTIONAL_VALUE_EVIDENCE_FIELDS.size !== 5
    || !OPTIONAL_VALUE_EVIDENCE_FIELDS.has('value_evidence_class')) {
    throw new Error('Unexpected optional value-evidence surface.');
  }
  if (MVP_REPORT_VALUE_EVIDENCE_CLASSES.size !== 2
    || !MVP_REPORT_VALUE_EVIDENCE_CLASSES.has('unknown')
    || !MVP_REPORT_VALUE_EVIDENCE_CLASSES.has('customer_supplied_estimate')
    || MVP_REPORT_VALUE_EVIDENCE_SOURCES.size !== 1
    || !MVP_REPORT_VALUE_EVIDENCE_SOURCES.has('retell')) {
    throw new Error('Unexpected MVP report value-evidence authority.');
  }
  if (contract.reporting?.monthly_connected_minutes_methodology_id
      !== 'retell_duration_elapsed_calendar_run_rate_v1'
    || contract.reporting.monthly_min_calendar_days !== 28
    || contract.reporting.monthly_max_calendar_days !== 31
    || !contract.reporting.in_flight_overshoot_methodology
      .startsWith('max(handled_call_count - call_limit, 0)')) {
    throw new Error('Unexpected connected-minute reporting methodology.');
  }
  if (!NOTIFICATION_STATES.has('ReconciliationRequired')
    || !NOTIFICATION_STATES.has('DryRunRecorded')) {
    throw new Error('Notification contract must model ambiguity and Development dry-run containment.');
  }
  if (ENGAGEMENT_TYPES.size !== 2 || !ENGAGEMENT_TYPES.has('free_test')
    || !ENGAGEMENT_TYPES.has('paid_service')) {
    throw new Error('Unexpected engagement-type registry.');
  }
  const free = CAPABILITY_PROFILES.get('call_gap_monitor_v1');
  if (!free || free.engagement_type !== 'free_test' || free.status !== 'active'
    || free.enabled !== true || free.traffic_environments.length !== 1
    || free.traffic_environments[0] !== 'development' || free.plan_tier !== 'none'
    || free.limit_policy !== 'seven_calendar_days_or_25_connected_calls_v1'
    || free.billing_mode !== 'none') {
    throw new Error('Free-test capability profile must be active only in Development.');
  }
  for (const profile of CAPABILITY_PROFILES.values()) {
    if (profile.engagement_type === 'paid_service'
      && (profile.status !== 'draft' || profile.enabled !== false
        || profile.traffic_environments.length !== 0 || profile.limit_policy !== 'disabled'
        || profile.billing_mode !== 'disabled'
        || !['Launch', 'Growth', 'Scale'].includes(profile.plan_tier))) {
      throw new Error('Paid capability profiles must remain disabled drafts.');
    }
  }
  if (capabilityRegistry.production_traffic_enabled !== false
    || capabilityRegistry.unknown_or_disabled_behavior !== 'fail_closed') {
    throw new Error('Capability registry must fail closed with no Production traffic.');
  }
}

assertContract();

module.exports = Object.freeze({
  CONTRACT: Object.freeze(contract),
  COVERAGE_MODES,
  COVERAGE_LABEL_TO_MODE,
  COVERAGE_MODE_TO_LABEL,
  CRM_TEST_STATUSES,
  CRM_APPROVAL_STATUSES,
  STOP_REASON_TO_CRM,
  CRM_STOP_REASON_TO_INTERNAL,
  OUTCOME_TO_LABEL,
  OUTCOMES,
  COVERAGE_TRIGGERS,
  COVERAGE_TRIGGER_COMPATIBILITY,
  UNKNOWN_COVERAGE_TRIGGER_POLICY,
  VALUE_EVIDENCE_CLASSES,
  MVP_REPORT_VALUE_EVIDENCE_CLASSES,
  MVP_REPORT_VALUE_EVIDENCE_SOURCES,
  RETELL_CUSTOM_ANALYSIS_FIELDS,
  RETELL_LIVE_SHARED_AGENT_ANALYSIS_FIELDS,
  RETELL_REQUIRED_RUNTIME_ANALYSIS_FIELDS,
  RETELL_CONVERSATION_VARIABLE_FIELDS,
  CUSTOMER_TYPES,
  URGENCIES,
  OPTIONAL_VALUE_EVIDENCE_FIELDS,
  RETELL_EVENTS,
  NOTIFICATION_STATES,
  ENGAGEMENT_TYPES,
  CAPABILITY_PROFILES,
});
