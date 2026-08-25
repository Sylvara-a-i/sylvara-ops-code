'use strict';

const crypto = require('node:crypto');
const { invariant } = require('./errors');
const { convergeHandoffEvidence } = require('./handoff-v2-convergence');

const EXPECTED_NOTIFICATION_FIELDS = Object.freeze([
  'caller_name',
  'confirmed_callback_number',
  'customer_type',
  'city_or_zip',
  'issue_summary',
  'urgency',
  'outcome',
  'handoff_reason',
  'handoff_state',
  'call_timestamp',
]);
const REQUIRED_MANIFEST_PROFILE = Object.freeze({
  id: 'call_gap_capture_handoff_v2',
  engagement_type: 'free_test',
  status: 'draft',
  enabled: false,
  billing_mode: 'none',
  limit_policy: 'seven_calendar_days_or_25_connected_calls_v1',
  v1_rollback_profile: 'call_gap_monitor_v1',
});
const RECIPIENT_FINGERPRINT_PATTERN = /^recipient_[a-f0-9]{64}$/;
const VERIFICATION_FINGERPRINT_PATTERN = /^[a-z][a-z0-9_]{1,31}_[a-f0-9]{64}$/;
const TARGET_FINGERPRINT_PATTERN = /^target_[a-f0-9]{64}$/;
const ROUTE_VERIFICATION_CALL_FIELDS = Object.freeze([
  'actual_call_fingerprint',
  'environment_fingerprint',
  'client_fingerprint',
  'journey_fingerprint',
  'deployment_fingerprint',
  'configuration_fingerprint',
  'number_fingerprint',
  'route_fingerprint',
  'qa_caller_fingerprint',
  'observed_at',
]);
const ROUTE_VERIFICATION_WINDOW_FIELDS = Object.freeze([
  'window_key',
  'status',
  'environment_fingerprint',
  'client_fingerprint',
  'journey_fingerprint',
  'deployment_fingerprint',
  'configuration_fingerprint',
  'number_fingerprint',
  'route_fingerprint',
  'approved_qa_caller_fingerprint',
  'issued_at',
  'expires_at',
  'closed_at',
]);
const ROUTE_VERIFICATION_RECEIPT_FIELDS = Object.freeze([
  'verification_claim_key',
  'window_key',
  'actual_call_fingerprint',
  'environment_fingerprint',
  'client_fingerprint',
  'journey_fingerprint',
  'deployment_fingerprint',
  'configuration_fingerprint',
  'number_fingerprint',
  'route_fingerprint',
  'approved_qa_caller_fingerprint',
  'issued_at',
  'expires_at',
  'consumed_at',
]);
const NON_TRANSFER_OUTCOMES = new Set([
  'spam',
  'unsupported_service',
  'out_of_area',
  'sensitive_data_ended',
  'configuration_failure',
  'caller_abandoned',
]);
const NONACTIONABLE_CALLER_INTENTS = new Set([
  'spam',
  'vendor',
  'job_applicant',
  'wrong_number',
  'sales',
]);
const HANDOFF_FACT_FIELDS = Object.freeze([
  'outcome',
  'urgency',
  'caller_intent',
  'caller_intent_authority',
  'service_eligibility',
  'service_eligibility_authority',
  'area_eligibility',
  'area_eligibility_authority',
  'handoff_reason',
  'handoff_enabled',
  'urgent_handoff_enabled',
  'existing_customer_handoff_enabled',
  'specific_person_handoff_enabled',
  'caller_transfer_consent',
  'immediate_danger',
  'destination_validity',
  'destination_fingerprint',
  'destination_authority',
  'loop_proof',
  'loop_proof_authority',
]);
const DENIED_HANDOFF_INTENTS = new Set([
  'vendor', 'spam', 'job_applicant', 'wrong_number', 'sales',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function exactIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertV2CandidateContracts(manifest, candidateContract, adapterContract) {
  invariant(isPlainObject(manifest) && isPlainObject(candidateContract)
    && isPlainObject(adapterContract),
  'V2_CONTRACT_INVALID', 'Injected v2 contracts are invalid.');
  invariant(manifest.status === 'NOT_READY' && manifest.runtime_authority === false
    && manifest.deployment_authorized === false,
  'V2_CANDIDATE_NOT_DISABLED', 'V2 candidate must remain NOT_READY and unauthorized.');
  const profile = manifest.profile;
  invariant(isPlainObject(profile)
    && Object.entries(REQUIRED_MANIFEST_PROFILE).every(([field, value]) => profile[field] === value)
    && Array.isArray(profile.traffic_environments) && profile.traffic_environments.length === 0,
  'V2_CANDIDATE_NOT_DISABLED', 'V2 profile must remain an unbound disabled draft.');
  invariant(candidateContract.retell_source_status === 'NOT_READY'
    && candidateContract.runtime_authority === false
    && candidateContract.deployment_authorized === false
    && candidateContract.capability_profile?.name === profile.id
    && candidateContract.capability_profile?.enabled === false
    && candidateContract.capability_profile?.status === 'draft'
    && candidateContract.capability_profile?.traffic_environments?.length === 0,
  'V2_CONTRACT_INVALID', 'Retell candidate is not a disabled source-only draft.');
  invariant(adapterContract.retell_source_status === 'NOT_READY'
    && adapterContract.runtime_authority === false
    && adapterContract.deployment_authorized === false
    && adapterContract.provider_parser?.implemented === false
    && adapterContract.provider_parser?.importable === false
    && isPlainObject(adapterContract.provider_parser?.field_mapping)
    && Object.keys(adapterContract.provider_parser.field_mapping).length === 0,
  'V2_PROVIDER_PARSER_FORBIDDEN', 'Provider parser must remain absent and NOT_READY.');
  invariant(exactArray(candidateContract.canonical_handoff_states,
    adapterContract.canonical_states),
  'V2_CONTRACT_INVALID', 'Retell handoff state contracts are inconsistent.');
  invariant(exactArray(candidateContract.notification_policy?.allowed_fields,
    EXPECTED_NOTIFICATION_FIELDS)
    && candidateContract.notification_policy?.owner === 'catalyst'
    && candidateContract.notification_policy?.durable_rows_per_actionable_call === 1
    && candidateContract.notification_policy?.provider_calls_in_local_mode === 0
    && candidateContract.notification_policy?.delivery_claim_allowed === false,
  'V2_CONTRACT_INVALID', 'Retell notification contract is inconsistent.');
  invariant(candidateContract.conversation_boundary?.routine_transfer_allowed === false
    && candidateContract.conversation_boundary?.sms_allowed === false
    && candidateContract.conversation_boundary?.direct_retell_email_allowed === false,
  'V2_CONTRACT_INVALID', 'Routine transfer and provider messaging must remain prohibited.');
  invariant(manifest.provider_boundary?.provider_parser_implemented === false
    && manifest.provider_boundary?.raw_provider_payload_allowed === false
    && manifest.local_execution?.required_mode === 'synthetic_local_candidate'
    && manifest.local_execution?.network_allowed === false
    && manifest.local_execution?.notification_provider_calls === 0,
  'V2_CONTRACT_INVALID', 'Gateway candidate containment is invalid.');
  invariant(manifest.route_verification?.authoritative_window_store === 'server_issued_only'
    && manifest.route_verification?.atomic_store_operation === 'consumeOpenWindow'
    && manifest.route_verification?.required_initial_window_status === 'Open'
    && manifest.route_verification?.success_window_status === 'Consumed'
    && manifest.route_verification?.success_closes_window === true
    && manifest.route_verification?.consumed_replay_behavior === 'reject'
    && manifest.route_verification?.current_time_source === 'injected_server_clock'
    && Number.isSafeInteger(manifest.route_verification?.maximum_observation_skew_seconds)
    && manifest.route_verification.maximum_observation_skew_seconds > 0
    && exactArray(manifest.route_verification?.authoritative_call_binding_fields,
      ROUTE_VERIFICATION_CALL_FIELDS),
  'V2_CONTRACT_INVALID', 'Route-verification atomic-consume contract is invalid.');
  invariant(manifest.handoff_evidence?.destination_fingerprint_only === true
    && manifest.handoff_evidence?.raw_destination_allowed === false
    && manifest.sensitive_terminal?.outcome === 'sensitive_data_ended'
    && manifest.sensitive_terminal?.notification_allowed === false
    && manifest.sensitive_terminal?.retained_caller_fields === 0,
  'V2_CONTRACT_INVALID', 'Handoff evidence or sensitive-terminal containment is invalid.');
  return Object.freeze({ manifest, candidateContract, adapterContract });
}

function handoffDecision(eligible, attemptAllowed, initialState, rejectionReason) {
  return Object.freeze({
    eligible,
    attempt_allowed: attemptAllowed,
    initial_state: initialState,
    rejection_reason: rejectionReason,
  });
}

function assertHandoffEvidence(facts, policy) {
  const evidence = policy.manifest.handoff_evidence;
  invariant(facts.caller_intent_authority === evidence.caller_intent_authority
    && facts.service_eligibility_authority === evidence.service_eligibility_authority
    && facts.area_eligibility_authority === evidence.area_eligibility_authority
    && facts.destination_authority === evidence.destination_authority
    && facts.loop_proof_authority === evidence.loop_proof_authority,
  'V2_HANDOFF_EVIDENCE_UNTRUSTED', 'Handoff evidence authority is invalid.');
  invariant(typeof facts.caller_intent === 'string' && facts.caller_intent.length > 0
    && facts.caller_intent.length <= 120,
  'V2_HANDOFF_FACTS_INVALID', 'Caller intent is invalid.');
  invariant(policy.candidateContract.analysis_field_constraints.enum_fields.outcome
    .includes(facts.outcome)
    && policy.candidateContract.analysis_field_constraints.enum_fields.urgency
      .includes(facts.urgency)
    && ['not_offered', 'accepted', 'declined'].includes(facts.caller_transfer_consent)
    && [
      'handoff_enabled', 'urgent_handoff_enabled', 'existing_customer_handoff_enabled',
      'specific_person_handoff_enabled', 'immediate_danger',
    ].every((field) => typeof facts[field] === 'boolean'),
  'V2_HANDOFF_FACTS_INVALID', 'Handoff decision values are invalid.');
  invariant(['supported', 'unsupported', 'unknown'].includes(facts.service_eligibility)
    && ['in_area', 'out_of_area', 'unknown'].includes(facts.area_eligibility)
    && ['valid', 'invalid', 'unknown', 'not_configured'].includes(
      facts.destination_validity,
    )
    && ['passed', 'failed', 'unknown', 'not_required'].includes(facts.loop_proof),
  'V2_HANDOFF_FACTS_INVALID', 'Handoff eligibility evidence is invalid.');
  invariant(facts.destination_fingerprint === null
    || (typeof facts.destination_fingerprint === 'string'
      && TARGET_FINGERPRINT_PATTERN.test(facts.destination_fingerprint)),
  'V2_HANDOFF_FACTS_INVALID', 'Destination fingerprint is invalid.');
  invariant(facts.destination_validity !== 'valid'
    || (facts.destination_fingerprint !== null && facts.loop_proof !== 'not_required'),
  'V2_HANDOFF_FACTS_INCONSISTENT', 'Valid destination evidence is incomplete.');
}

function assertHandoffClassification(facts) {
  if (DENIED_HANDOFF_INTENTS.has(facts.caller_intent)) {
    const allowedOutcome = facts.caller_intent === 'job_applicant'
      ? 'other_general_inquiry' : 'spam';
    invariant(facts.outcome === allowedOutcome,
      'V2_HANDOFF_FACTS_INCONSISTENT', 'Denied caller intent conflicts with outcome.');
    invariant(facts.handoff_reason === 'none',
      'V2_HANDOFF_FACTS_INCONSISTENT', 'Denied caller intent cannot request a handoff.');
    return;
  }
  if (['potential_job', 'urgent_potential_job', 'unsupported_service', 'out_of_area']
    .includes(facts.outcome)) {
    invariant(facts.caller_intent === 'service_request',
      'V2_HANDOFF_FACTS_INCONSISTENT', 'Service outcome conflicts with caller intent.');
  }
  if (facts.outcome === 'existing_customer') {
    invariant(facts.caller_intent === 'existing_customer',
      'V2_HANDOFF_FACTS_INCONSISTENT', 'Existing-customer outcome conflicts with caller intent.');
  }
  if (facts.handoff_reason === 'specific_person') {
    invariant(facts.caller_intent === 'person_request',
      'V2_HANDOFF_FACTS_INCONSISTENT', 'Specific-person handoff conflicts with caller intent.');
  }
  invariant((facts.service_eligibility === 'unsupported')
    === (facts.outcome === 'unsupported_service'),
  'V2_HANDOFF_FACTS_INCONSISTENT', 'Service eligibility conflicts with outcome.');
  invariant((facts.area_eligibility === 'out_of_area') === (facts.outcome === 'out_of_area'),
    'V2_HANDOFF_FACTS_INCONSISTENT', 'Area eligibility conflicts with outcome.');
  if (['unsupported_service', 'out_of_area'].includes(facts.outcome)
    || facts.immediate_danger === true) {
    invariant(facts.handoff_reason === 'none',
      'V2_HANDOFF_FACTS_INCONSISTENT', 'Ineligible call cannot request a handoff.');
  }
}

function decideHandoff(facts, policy) {
  invariant(isPlainObject(facts), 'V2_HANDOFF_FACTS_INVALID', 'Handoff facts are invalid.');
  invariant(exactArray(Object.keys(facts).sort(), [...HANDOFF_FACT_FIELDS].sort()),
    'V2_HANDOFF_FACTS_INVALID', 'Handoff fact fields are invalid.');
  const { candidateContract } = policy;
  assertHandoffEvidence(facts, policy);
  assertHandoffClassification(facts);
  const reason = facts.handoff_reason;
  invariant(candidateContract.handoff_reasons.includes(reason),
    'V2_HANDOFF_FACTS_INVALID', 'Handoff reason is invalid.');
  const deniedIntent = DENIED_HANDOFF_INTENTS.has(facts.caller_intent);
  const routine = facts.outcome === 'potential_job' && facts.urgency === 'routine';
  if (routine) {
    invariant(reason === 'none', 'V2_HANDOFF_FACTS_INCONSISTENT',
      'Routine call cannot request a handoff.');
  }
  if (deniedIntent || routine || reason === 'none' || NON_TRANSFER_OUTCOMES.has(facts.outcome)
    || facts.immediate_danger === true || facts.service_eligibility !== 'supported'
    || facts.area_eligibility !== 'in_area') {
    return handoffDecision(false, false, 'NotApplicable', 'policy_ineligible');
  }
  const allowedReasons = new Set(candidateContract.handoff_policy.allowed_reasons);
  if (!allowedReasons.has(reason)) {
    return handoffDecision(false, false, 'NotConfigured', 'reason_not_allowed');
  }
  const reasonMatchesClassification = (reason === 'urgent'
      && facts.outcome === 'urgent_potential_job' && facts.urgency === 'urgent')
    || (reason === 'existing_customer' && facts.outcome === 'existing_customer')
    || (reason === 'specific_person' && facts.caller_intent === 'person_request');
  invariant(reasonMatchesClassification, 'V2_HANDOFF_FACTS_INCONSISTENT',
    'Handoff reason conflicts with authoritative classification.');
  const reasonFlag = {
    urgent: 'urgent_handoff_enabled',
    existing_customer: 'existing_customer_handoff_enabled',
    specific_person: 'specific_person_handoff_enabled',
  }[reason];
  const enabled = facts.handoff_enabled === true && facts[reasonFlag] === true;
  if (!enabled) {
    return handoffDecision(false, false, 'NotConfigured', 'handoff_disabled');
  }
  if (facts.destination_validity !== policy.manifest.handoff_evidence
    .eligible_destination_value || facts.destination_fingerprint === null
    || facts.loop_proof !== policy.manifest.handoff_evidence.eligible_loop_proof_value) {
    return handoffDecision(false, false, 'NotConfigured', 'destination_not_safe');
  }
  if (facts.caller_transfer_consent === 'declined') {
    return handoffDecision(true, false, 'Declined', 'caller_declined');
  }
  if (facts.caller_transfer_consent !== 'accepted') {
    return handoffDecision(true, false, 'Offered', 'caller_acceptance_missing');
  }
  return handoffDecision(true, true, 'Offered', null);
}

function boundedNullableString(value, maximum, name) {
  if (value === null || value === undefined || value === '') return null;
  invariant(typeof value === 'string' && value.length <= maximum,
    'V2_NOTIFICATION_FIELD_INVALID', `${name} is invalid.`);
  return value;
}

function enumValue(value, values, name) {
  invariant(typeof value === 'string' && values.includes(value),
    'V2_NOTIFICATION_FIELD_INVALID', `${name} is invalid.`);
  return value;
}

function isSensitiveTerminal(analysis) {
  if (analysis.outcome !== 'sensitive_data_ended') return false;
  const minimized = analysis.sensitive_data_detected === true
    && analysis.caller_name === null
    && analysis.callback_number === null
    && analysis.customer_type === 'unknown'
    && analysis.caller_intent === null
    && analysis.issue_summary === null
    && analysis.city_or_zip === null
    && analysis.urgency === 'unknown'
    && analysis.specific_person_requested === null
    && analysis.bookable_opportunity === false
    && analysis.office_follow_up_required === false
    && analysis.workflow_failure_code === null
    && analysis.workflow_failure_text === null
    && analysis.handoff_reason === 'none'
    && analysis.handoff_disposition === 'not_applicable';
  invariant(minimized, 'V2_SENSITIVE_TERMINAL_NOT_MINIMIZED',
    'Sensitive-data terminal analysis is not minimized.');
  return true;
}

function assertSensitiveAnalysisConsistency(analysis) {
  invariant(isPlainObject(analysis)
    && typeof analysis.sensitive_data_detected === 'boolean',
  'V2_SENSITIVE_TERMINAL_NOT_MINIMIZED',
  'Sensitive-data analysis flag is invalid.');
  const sensitiveOutcome = analysis.outcome === 'sensitive_data_ended';
  invariant(analysis.sensitive_data_detected === sensitiveOutcome,
    'V2_SENSITIVE_TERMINAL_NOT_MINIMIZED',
    'Sensitive-data analysis must use the minimized sensitive terminal.');
  if (sensitiveOutcome) isSensitiveTerminal(analysis);
}

function assertAnalysisHandoffConsistency(analysis, facts) {
  invariant(isPlainObject(analysis), 'V2_HANDOFF_FACTS_INCONSISTENT',
    'Analysis is unavailable for handoff reconciliation.');
  invariant(analysis.outcome === facts.outcome
    && analysis.urgency === facts.urgency
    && analysis.handoff_reason === facts.handoff_reason,
  'V2_HANDOFF_FACTS_INCONSISTENT',
  'Analysis conflicts with authoritative handoff evidence.');
  if (analysis.outcome === 'sensitive_data_ended') {
    invariant(facts.handoff_reason === 'none' && facts.immediate_danger === false,
      'V2_HANDOFF_FACTS_INCONSISTENT',
      'Sensitive-data terminal cannot request a handoff.');
    return;
  }
  invariant(analysis.caller_intent === facts.caller_intent,
    'V2_HANDOFF_FACTS_INCONSISTENT',
    'Caller-intent analysis conflicts with authoritative handoff evidence.');
}

function isActionable(analysis) {
  if (NONACTIONABLE_CALLER_INTENTS.has(analysis.caller_intent)) return false;
  if (['potential_job', 'urgent_potential_job', 'existing_customer'].includes(analysis.outcome)) {
    return true;
  }
  return ['other_general_inquiry', 'unresolved'].includes(analysis.outcome)
    && analysis.office_follow_up_required === true;
}

function notificationPayload(analysis, handoffState, callTimestamp, policy) {
  invariant(isPlainObject(analysis), 'V2_NOTIFICATION_FIELD_INVALID',
    'Analysis is invalid.');
  invariant(exactArray(Object.keys(analysis).sort(),
    [...policy.candidateContract.analysis_fields].sort()),
  'V2_NOTIFICATION_FIELD_INVALID', 'Analysis field set is invalid.');
  assertSensitiveAnalysisConsistency(analysis);
  if (isSensitiveTerminal(analysis)) return null;
  if (!isActionable(analysis)) return null;
  invariant(exactIsoTimestamp(callTimestamp),
  'V2_NOTIFICATION_FIELD_INVALID', 'call_timestamp is invalid.');
  const constraints = policy.candidateContract.analysis_field_constraints;
  const stringBounds = constraints.bounded_string_maximum_characters;
  const enumFields = constraints.enum_fields;
  const payload = {
    caller_name: boundedNullableString(analysis.caller_name, stringBounds.caller_name,
      'caller_name'),
    confirmed_callback_number: boundedNullableString(analysis.callback_number,
      stringBounds.callback_number, 'confirmed_callback_number'),
    customer_type: enumValue(analysis.customer_type, enumFields.customer_type, 'customer_type'),
    city_or_zip: boundedNullableString(analysis.city_or_zip, stringBounds.city_or_zip,
      'city_or_zip'),
    issue_summary: boundedNullableString(analysis.issue_summary, stringBounds.issue_summary,
      'issue_summary'),
    urgency: enumValue(analysis.urgency, enumFields.urgency, 'urgency'),
    outcome: enumValue(analysis.outcome, enumFields.outcome, 'outcome'),
    handoff_reason: enumValue(analysis.handoff_reason, enumFields.handoff_reason,
      'handoff_reason'),
    handoff_state: enumValue(handoffState,
      policy.candidateContract.canonical_handoff_states, 'handoff_state'),
    call_timestamp: callTimestamp,
  };
  invariant(exactArray(Object.keys(payload), EXPECTED_NOTIFICATION_FIELDS),
    'V2_NOTIFICATION_FIELD_INVALID', 'Notification payload field set is invalid.');
  return Object.freeze(payload);
}

function notificationIntentKey(binding) {
  return `v2_notification_${crypto.createHash('sha256').update([
    'call-gap-capture-handoff-v2',
    binding.client_scope_key,
    binding.call_binding_key,
  ].join('\0'), 'utf8').digest('hex')}`;
}

function assertRecipientFingerprint(value, name = 'recipient_fingerprint') {
  invariant(typeof value === 'string' && RECIPIENT_FINGERPRINT_PATTERN.test(value),
    'V2_RECIPIENT_INVALID', `${name} is invalid.`);
}

function canonicalIntent(intent) {
  return stableJson(intent);
}

async function ensureNotificationIntent(input, notificationStore, policy) {
  const payload = notificationPayload(input.analysis, input.handoff_state,
    input.call_timestamp, policy);
  if (payload === null) return null;
  assertRecipientFingerprint(input.binding.recipient_fingerprint,
    'binding recipient_fingerprint');
  assertRecipientFingerprint(input.recipient_fingerprint);
  invariant(input.binding.recipient_fingerprint === input.recipient_fingerprint,
    'V2_RECIPIENT_SCOPE_MISMATCH', 'Notification recipient does not match the call binding.');
  invariant(notificationStore && typeof notificationStore.ensureOne === 'function',
    'V2_NOTIFICATION_STORE_INVALID', 'Durable notification intent store is unavailable.');
  const intent = Object.freeze({
    intent_key: notificationIntentKey(input.binding),
    call_binding_key: input.binding.call_binding_key,
    client_scope_key: input.binding.client_scope_key,
    recipient_fingerprint: input.recipient_fingerprint,
    channel: 'email',
    delivery_state: 'DryRunIntended',
    delivery_claimed: false,
    provider_calls: 0,
    payload,
  });
  const result = await notificationStore.ensureOne(intent);
  invariant(isPlainObject(result) && typeof result.inserted === 'boolean'
    && isPlainObject(result.intent)
    && canonicalIntent(result.intent) === canonicalIntent(intent),
  'V2_NOTIFICATION_IDEMPOTENCY_CONFLICT',
  'Durable notification intent conflicts with the existing call intent.');
  return Object.freeze({ intent, inserted: result.inserted });
}

function assertVerificationFingerprint(value, name) {
  invariant(typeof value === 'string' && VERIFICATION_FINGERPRINT_PATTERN.test(value),
    'V2_ROUTE_VERIFICATION_INVALID', `${name} is invalid.`);
}

function assertAuthoritativeCall(call) {
  invariant(isPlainObject(call)
    && exactArray(Object.keys(call).sort(), [...ROUTE_VERIFICATION_CALL_FIELDS].sort()),
  'V2_ROUTE_VERIFICATION_INVALID', 'Authoritative call binding is invalid.');
  for (const field of ROUTE_VERIFICATION_CALL_FIELDS.slice(0, -1)) {
    assertVerificationFingerprint(call[field], field);
  }
  invariant(exactIsoTimestamp(call.observed_at),
    'V2_ROUTE_VERIFICATION_INVALID', 'Authoritative call timestamp is invalid.');
}

function serverNow(clock) {
  invariant(clock && typeof clock.now === 'function',
    'V2_ROUTE_VERIFICATION_CLOCK_INVALID', 'Authoritative server clock is unavailable.');
  const now = clock.now();
  invariant(exactIsoTimestamp(now), 'V2_ROUTE_VERIFICATION_CLOCK_INVALID',
    'Authoritative server time is invalid.');
  return now;
}

function assertConsumedWindow(window, request, now, policy) {
  invariant(isPlainObject(window)
    && exactArray(Object.keys(window).sort(), [...ROUTE_VERIFICATION_WINDOW_FIELDS].sort()),
  'V2_ROUTE_VERIFICATION_STORE_INVALID', 'Consumed verification window is invalid.');
  invariant(window.status === policy.manifest.route_verification.success_window_status
    && window.window_key === request.window_key && window.closed_at === now,
  'V2_ROUTE_VERIFICATION_STORE_INVALID', 'Verification window did not close atomically.');
  assertVerificationFingerprint(window.window_key, 'window_key');
  for (const field of ROUTE_VERIFICATION_WINDOW_FIELDS.slice(2, -3)) {
    assertVerificationFingerprint(window[field], field);
  }
  for (const field of ['issued_at', 'expires_at', 'closed_at']) {
    invariant(exactIsoTimestamp(window[field]),
      'V2_ROUTE_VERIFICATION_STORE_INVALID', 'Verification window timestamp is invalid.');
  }
  const call = request.authoritative_call;
  for (const field of [
    'environment_fingerprint', 'client_fingerprint', 'journey_fingerprint',
    'deployment_fingerprint', 'configuration_fingerprint', 'number_fingerprint',
    'route_fingerprint',
  ]) {
    invariant(window[field] === call[field], 'V2_ROUTE_VERIFICATION_BINDING_MISMATCH',
      'Authoritative call does not match the server-issued verification window.');
  }
  invariant(window.approved_qa_caller_fingerprint === call.qa_caller_fingerprint,
    'V2_ROUTE_VERIFICATION_BINDING_MISMATCH',
    'QA caller does not match the server-issued verification window.');
  const issuedAt = Date.parse(window.issued_at);
  const expiresAt = Date.parse(window.expires_at);
  const observedAt = Date.parse(call.observed_at);
  const nowMs = Date.parse(now);
  invariant(issuedAt <= observedAt && observedAt < expiresAt
    && issuedAt <= nowMs && nowMs < expiresAt,
  'V2_ROUTE_VERIFICATION_WINDOW_CLOSED', 'Verification window is not currently open.');
}

function assertVerificationReceipt(receipt, window, request, now) {
  invariant(isPlainObject(receipt)
    && exactArray(Object.keys(receipt).sort(), [...ROUTE_VERIFICATION_RECEIPT_FIELDS].sort()),
  'V2_ROUTE_VERIFICATION_STORE_INVALID', 'Route-verification receipt is invalid.');
  for (const field of ROUTE_VERIFICATION_RECEIPT_FIELDS.slice(0, -3)) {
    assertVerificationFingerprint(receipt[field], field);
  }
  for (const field of ['issued_at', 'expires_at', 'consumed_at']) {
    invariant(exactIsoTimestamp(receipt[field]),
      'V2_ROUTE_VERIFICATION_STORE_INVALID', 'Route-verification receipt time is invalid.');
  }
  const call = request.authoritative_call;
  invariant(receipt.window_key === window.window_key
    && receipt.actual_call_fingerprint === call.actual_call_fingerprint
    && receipt.approved_qa_caller_fingerprint === window.approved_qa_caller_fingerprint
    && receipt.issued_at === window.issued_at
    && receipt.expires_at === window.expires_at
    && receipt.consumed_at === now,
  'V2_ROUTE_VERIFICATION_STORE_INVALID', 'Route-verification receipt binding is invalid.');
  for (const field of [
    'environment_fingerprint', 'client_fingerprint', 'journey_fingerprint',
    'deployment_fingerprint', 'configuration_fingerprint', 'number_fingerprint',
    'route_fingerprint',
  ]) {
    invariant(receipt[field] === call[field], 'V2_ROUTE_VERIFICATION_STORE_INVALID',
      'Route-verification receipt does not match the authoritative call.');
  }
}

async function interceptRouteVerification(routeVerification, verificationStore, clock, policy) {
  if (routeVerification === null || routeVerification === undefined) return null;
  invariant(isPlainObject(routeVerification)
    && exactArray(Object.keys(routeVerification).sort(),
      ['authoritative_call', 'disposition', 'window_key'])
    && routeVerification.disposition
      === policy.manifest.route_verification.recognized_disposition,
  'V2_ROUTE_VERIFICATION_INVALID', 'Route-verification disposition is invalid.');
  assertVerificationFingerprint(routeVerification.window_key, 'window_key');
  assertAuthoritativeCall(routeVerification.authoritative_call);
  const now = serverNow(clock);
  const observedSkewMs = Math.abs(
    Date.parse(now) - Date.parse(routeVerification.authoritative_call.observed_at),
  );
  invariant(observedSkewMs <= policy.manifest.route_verification
    .maximum_observation_skew_seconds * 1000,
  'V2_ROUTE_VERIFICATION_CALL_STALE', 'Authoritative call observation is stale.');
  invariant(verificationStore && typeof verificationStore.consumeOpenWindow === 'function',
    'V2_ROUTE_VERIFICATION_STORE_INVALID', 'Route-verification store is unavailable.');
  const consumed = await verificationStore.consumeOpenWindow({
    window_key: routeVerification.window_key,
    current_time: now,
    authoritative_call: routeVerification.authoritative_call,
  });
  invariant(isPlainObject(consumed) && consumed.consumed === true,
    'V2_ROUTE_VERIFICATION_CONSUME_REJECTED',
    'Server-issued route-verification window was not atomically consumed.');
  invariant(exactArray(Object.keys(consumed).sort(), ['consumed', 'receipt', 'window']),
    'V2_ROUTE_VERIFICATION_STORE_INVALID', 'Route-verification consume result is invalid.');
  assertConsumedWindow(consumed.window, routeVerification, now, policy);
  assertVerificationReceipt(consumed.receipt, consumed.window, routeVerification, now);
  return Object.freeze({
    disposition: 'route_verification_intercepted',
    window_consumed: true,
    receipt_recorded: true,
    start_agent: false,
    collect_agent_intake: false,
    create_transcript: false,
    create_post_call_analysis: false,
    handled_call_increment: 0,
    notification_intent_count: 0,
    notification_provider_calls: 0,
    activate_deployment: false,
    perform_operational_action: false,
  });
}

function createV2CandidateService({
  manifest,
  candidateContract,
  adapterContract,
  notificationStore,
  verificationStore,
  clock,
}) {
  const policy = assertV2CandidateContracts(manifest, candidateContract, adapterContract);
  return Object.freeze({
    async processSyntheticNormalizedCall(input) {
      invariant(isPlainObject(input)
        && input.execution_mode === policy.manifest.local_execution.required_mode,
      'V2_CANDIDATE_DISABLED', 'V2 candidate accepts synthetic local evaluation only.');

      // Verification is deliberately the first disposition. Invalid or absent normal-call facts
      // cannot fall through to intake, counting, transfer convergence, or notification creation.
      const intercepted = await interceptRouteVerification(
        input.route_verification, verificationStore, clock, policy,
      );
      if (intercepted !== null) return intercepted;

      invariant(isPlainObject(input.binding), 'V2_BINDING_INVALID', 'Call binding is invalid.');
      assertRecipientFingerprint(input.binding.recipient_fingerprint,
        'binding recipient_fingerprint');
      // Fail before handoff convergence or any durable intent when the sensitive-data flag and
      // terminal outcome disagree. A provider/model cannot preserve caller content by pairing a
      // sensitive flag with an otherwise actionable classification.
      assertSensitiveAnalysisConsistency(input.analysis);
      const handoff = decideHandoff(input.handoff_facts, policy);
      assertAnalysisHandoffConsistency(input.analysis, input.handoff_facts);
      const convergence = convergeHandoffEvidence({
        binding: {
          call_binding_key: input.binding.call_binding_key,
          client_scope_key: input.binding.client_scope_key,
          deployment_scope_key: input.binding.deployment_scope_key,
          configuration_version_key: input.binding.configuration_version_key,
        },
        initial_state: handoff.initial_state,
        prior_state: input.prior_handoff_state,
        normalized_events: input.normalized_events || [],
        authoritative_provider_state: input.authoritative_provider_state,
        model_handoff_disposition: input.analysis?.handoff_disposition,
      }, policy.adapterContract, policy.candidateContract);
      invariant(handoff.attempt_allowed
        || convergence.handoff_state === handoff.initial_state,
        'V2_UNAUTHORIZED_TRANSFER_EVIDENCE',
        'Structured transfer evidence is incompatible with the bounded handoff policy.');
      if (handoff.attempt_allowed && convergence.target_fingerprint !== null) {
        invariant(convergence.target_fingerprint
          === input.handoff_facts.destination_fingerprint,
        'V2_TARGET_FINGERPRINT_CONFLICT',
        'Transfer evidence conflicts with the authoritative destination fingerprint.');
      }
      const notification = await ensureNotificationIntent({
        analysis: input.analysis,
        handoff_state: convergence.handoff_state,
        call_timestamp: input.call_timestamp,
        binding: input.binding,
        recipient_fingerprint: input.recipient_fingerprint,
      }, notificationStore, policy);
      return Object.freeze({
        disposition: 'synthetic_candidate_evaluated',
        handoff_eligible: handoff.eligible,
        handoff_rejection_reason: handoff.rejection_reason,
        handoff_state: convergence.handoff_state,
        evidence_source: convergence.evidence_source,
        target_fingerprint: handoff.attempt_allowed
          ? input.handoff_facts.destination_fingerprint : null,
        would_increment_handled_call_count: true,
        notification_intent_count: notification === null ? 0 : 1,
        notification_intent_inserted: notification?.inserted || false,
        notification_provider_calls: 0,
        delivery_claimed: false,
      });
    },
  });
}

module.exports = Object.freeze({
  EXPECTED_NOTIFICATION_FIELDS,
  ROUTE_VERIFICATION_CALL_FIELDS,
  ROUTE_VERIFICATION_RECEIPT_FIELDS,
  ROUTE_VERIFICATION_WINDOW_FIELDS,
  assertV2CandidateContracts,
  createV2CandidateService,
  decideHandoff,
  interceptRouteVerification,
  notificationPayload,
});
