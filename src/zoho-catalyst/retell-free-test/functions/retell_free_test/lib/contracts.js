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
const RETELL_EVENTS = freezeSet(contract.retell_events);
const NOTIFICATION_STATES = freezeSet(contract.notification_states);
const OUTBOX_STATES = freezeSet(contract.outbox_states);
const ADMISSION_STATES = freezeSet(contract.admission_states);
const ADMISSION_RECONCILIATION_STATES = freezeSet(contract.admission_reconciliation_states);
const ADMISSION_RECONCILIATION_DECISIONS = freezeSet(contract.admission_reconciliation_decisions);

function assertContract() {
  if (contract.environment !== 'development') throw new Error('Contract must be Development-only.');
  if (contract.engagement_type !== 'free_test') throw new Error('Unexpected engagement type.');
  if (contract.capability_profile !== 'call_gap_monitor_v1') throw new Error('Unexpected capability profile.');
  if (contract.resolved_status !== 'Resolved') throw new Error('Unexpected resolver status.');
  if (contract.test_duration_days !== 7 || contract.admission_limit !== 25) {
    throw new Error('Unexpected free-test duration or admission limit.');
  }
  if (COVERAGE_MODES.size !== 3 || COVERAGE_LABEL_TO_MODE.size !== 3 || COVERAGE_MODE_TO_LABEL.size !== 3) {
    throw new Error('Coverage mapping must be one-to-one across exactly three values.');
  }
  for (const mode of COVERAGE_MODES) {
    if (!COVERAGE_MODE_TO_LABEL.has(mode)) throw new Error(`Missing display label for ${mode}.`);
  }
  if (OUTCOMES.size !== contract.outcomes.length) throw new Error('Outcome values must be unique.');
  if (!NOTIFICATION_STATES.has('ReconciliationRequired')) {
    throw new Error('Notification contract must model ambiguous side effects.');
  }
  if (!OUTBOX_STATES.has('ReconciliationRequired')) {
    throw new Error('Outbox contract must model ambiguous side effects.');
  }
  if (!ADMISSION_STATES.has('ReleasedNoCall')
    || !ADMISSION_RECONCILIATION_STATES.has('ReconciliationRequired')
    || !ADMISSION_RECONCILIATION_DECISIONS.has('NoCallCreated')) {
    throw new Error('Admission reconciliation contract must remain fail closed.');
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
  RETELL_EVENTS,
  NOTIFICATION_STATES,
  OUTBOX_STATES,
  ADMISSION_STATES,
  ADMISSION_RECONCILIATION_STATES,
  ADMISSION_RECONCILIATION_DECISIONS,
});
