'use strict';

const contract = require('../contracts/free-test-contract.json');

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
const VALUE_EVIDENCE_CLASSES = freezeSet(contract.value_evidence_classes);
const MVP_REPORT_VALUE_EVIDENCE_CLASSES = freezeSet(contract.mvp_report_value_evidence_classes);
const MVP_REPORT_VALUE_EVIDENCE_SOURCES = freezeSet(contract.mvp_report_value_evidence_sources);
const RETELL_CUSTOM_ANALYSIS_FIELDS = freezeSet(contract.retell_custom_analysis_fields);
const OPTIONAL_VALUE_EVIDENCE_FIELDS = freezeSet(contract.optional_value_evidence_fields);
const RETELL_EVENTS = freezeSet(contract.retell_events);
const NOTIFICATION_STATES = freezeSet(contract.notification_states);

function assertContract() {
  if (contract.environment !== 'development') throw new Error('Contract must be Development-only.');
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
  VALUE_EVIDENCE_CLASSES,
  MVP_REPORT_VALUE_EVIDENCE_CLASSES,
  MVP_REPORT_VALUE_EVIDENCE_SOURCES,
  RETELL_CUSTOM_ANALYSIS_FIELDS,
  OPTIONAL_VALUE_EVIDENCE_FIELDS,
  RETELL_EVENTS,
  NOTIFICATION_STATES,
});
