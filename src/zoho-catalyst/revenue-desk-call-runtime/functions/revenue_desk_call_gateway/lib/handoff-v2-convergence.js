'use strict';

const { invariant } = require('./errors');

const SAFE_BINDING_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const TARGET_FINGERPRINT_PATTERN = /^target_[a-f0-9]{64}$/;
const REQUIRED_EVENT_FIELDS = Object.freeze([
  'event_type',
  'event_claim_key',
  'call_binding_key',
  'client_scope_key',
  'deployment_scope_key',
  'configuration_version_key',
  'observed_order',
]);
const OPTIONAL_EVENT_FIELDS = Object.freeze([
  'failure_reason',
  'target_fingerprint',
  'model_handoff_disposition',
]);
const STATE_BY_EVENT = Object.freeze({
  transfer_started: 'Started',
  transfer_bridged: 'Bridged',
  transfer_cancelled: 'Cancelled',
  transfer_ended: 'Ended',
  transfer_failed: 'Failed',
});
// Set-based precedence makes the result independent of provider delivery order. A proven bridge
// remains the strongest fact and can never be downgraded by a delayed terminal or model signal.
const STRUCTURED_STATE_PRECEDENCE = Object.freeze([
  'Bridged',
  'Failed',
  'Ended',
  'Cancelled',
  'Started',
]);
const MODEL_DISPOSITIONS = new Set([
  'not_applicable',
  'not_configured',
  'offered_declined',
  'attempted',
  'failure_branch',
  'unknown',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertSafeBindingValue(value, name) {
  invariant(typeof value === 'string' && SAFE_BINDING_PATTERN.test(value),
    'V2_BINDING_INVALID', `${name} is invalid.`);
}

function assertBinding(binding) {
  invariant(isPlainObject(binding), 'V2_BINDING_INVALID', 'Call binding is invalid.');
  const expected = [
    'call_binding_key',
    'client_scope_key',
    'deployment_scope_key',
    'configuration_version_key',
  ];
  invariant(Object.keys(binding).length === expected.length
    && expected.every((field) => Object.hasOwn(binding, field)),
  'V2_BINDING_INVALID', 'Call binding fields are invalid.');
  for (const field of expected) assertSafeBindingValue(binding[field], field);
}

function canonicalEvent(event, allowedEventTypes, failureReasons, binding) {
  invariant(isPlainObject(event), 'V2_EVENT_INVALID', 'Normalized event is invalid.');
  const allowedFields = new Set([...REQUIRED_EVENT_FIELDS, ...OPTIONAL_EVENT_FIELDS]);
  const fields = Object.keys(event);
  invariant(REQUIRED_EVENT_FIELDS.every((field) => Object.hasOwn(event, field))
    && fields.every((field) => allowedFields.has(field)),
  'V2_EVENT_INVALID', 'Normalized event fields are invalid.');
  invariant(allowedEventTypes.has(event.event_type),
    'V2_EVENT_INVALID', 'Normalized event type is invalid.');
  assertSafeBindingValue(event.event_claim_key, 'event_claim_key');
  for (const field of [
    'call_binding_key',
    'client_scope_key',
    'deployment_scope_key',
    'configuration_version_key',
  ]) {
    assertSafeBindingValue(event[field], field);
    invariant(event[field] === binding[field], 'V2_EVENT_SCOPE_MISMATCH',
      'Normalized event ownership does not match the immutable call binding.');
  }
  invariant(Number.isSafeInteger(event.observed_order) && event.observed_order >= 0,
    'V2_EVENT_INVALID', 'Normalized event order is invalid.');
  if (Object.hasOwn(event, 'target_fingerprint')) {
    invariant(typeof event.target_fingerprint === 'string'
      && TARGET_FINGERPRINT_PATTERN.test(event.target_fingerprint),
    'V2_TARGET_FINGERPRINT_INVALID', 'Target fingerprint is invalid.');
  }
  if (event.event_type === 'transfer_failed') {
    invariant(typeof event.failure_reason === 'string'
      && failureReasons.has(event.failure_reason),
    'V2_EVENT_INVALID', 'Transfer failure reason is invalid.');
  } else {
    invariant(!Object.hasOwn(event, 'failure_reason'),
      'V2_EVENT_INVALID', 'Failure reason is allowed only for transfer_failed.');
  }
  if (Object.hasOwn(event, 'model_handoff_disposition')) {
    invariant(MODEL_DISPOSITIONS.has(event.model_handoff_disposition),
      'V2_EVENT_INVALID', 'Model handoff disposition is invalid.');
  }
  return Object.freeze(Object.fromEntries([...REQUIRED_EVENT_FIELDS, ...OPTIONAL_EVENT_FIELDS]
    .filter((field) => Object.hasOwn(event, field))
    .map((field) => [field, event[field]])));
}

function eventFingerprint(event) {
  return JSON.stringify(event);
}

function authoritativeState(value, canonicalStates) {
  if (value === null || value === undefined) return null;
  invariant(typeof value === 'string' && canonicalStates.has(value),
    'V2_AUTHORITATIVE_STATE_INVALID', 'Authoritative provider state is invalid.');
  return value;
}

function modelState(initialState, disposition) {
  invariant(MODEL_DISPOSITIONS.has(disposition),
    'V2_MODEL_DISPOSITION_INVALID', 'Model handoff disposition is invalid.');
  if (disposition === 'not_applicable') return 'NotApplicable';
  if (disposition === 'not_configured') return 'NotConfigured';
  if (disposition === 'offered_declined') return 'Declined';
  if (disposition === 'failure_branch') return 'Failed';
  // "attempted" is deliberately not promoted to Started: only normalized provider evidence may
  // establish a transfer lifecycle transition. The model can never claim a human connection.
  return initialState;
}

function convergeHandoffEvidence(input, adapterContract, candidateContract) {
  invariant(isPlainObject(input), 'V2_CONVERGENCE_INPUT_INVALID',
    'Handoff convergence input is invalid.');
  invariant(isPlainObject(adapterContract) && isPlainObject(candidateContract),
    'V2_CONTRACT_INVALID', 'Injected v2 contracts are invalid.');
  invariant(adapterContract.provider_parser?.implemented === false
    && adapterContract.provider_parser?.importable === false
    && isPlainObject(adapterContract.provider_parser?.field_mapping)
    && Object.keys(adapterContract.provider_parser.field_mapping).length === 0,
  'V2_PROVIDER_PARSER_FORBIDDEN', 'Provider parser must remain absent.');
  const canonicalStates = new Set(adapterContract.canonical_states || []);
  invariant(canonicalStates.size === 10
    && candidateContract.canonical_handoff_states?.length === canonicalStates.size
    && candidateContract.canonical_handoff_states.every((state) => canonicalStates.has(state)),
  'V2_CONTRACT_INVALID', 'Canonical handoff states are inconsistent.');
  assertBinding(input.binding);
  invariant(canonicalStates.has(input.initial_state),
    'V2_INITIAL_STATE_INVALID', 'Initial handoff state is invalid.');
  const priorState = input.prior_state ?? input.initial_state;
  invariant(canonicalStates.has(priorState),
    'V2_INITIAL_STATE_INVALID', 'Prior handoff state is invalid.');
  const allowedEventTypes = new Set(adapterContract.normalized_event_types || []);
  const failureReasons = new Set(candidateContract.handoff_failure_reasons || []);
  invariant(Array.isArray(input.normalized_events),
    'V2_EVENT_INVALID', 'Normalized events must be an array.');

  const claims = new Map();
  const states = new Set();
  let targetFingerprint = null;
  for (const eventValue of input.normalized_events) {
    const event = canonicalEvent(eventValue, allowedEventTypes, failureReasons, input.binding);
    const fingerprint = eventFingerprint(event);
    const previous = claims.get(event.event_claim_key);
    invariant(previous === undefined || previous === fingerprint,
      'V2_EVENT_REPLAY_CONFLICT', 'An event claim key was reused with different evidence.');
    if (previous !== undefined) continue;
    claims.set(event.event_claim_key, fingerprint);
    const eventState = STATE_BY_EVENT[event.event_type];
    if (eventState) states.add(eventState);
    if (event.target_fingerprint) {
      invariant(targetFingerprint === null || targetFingerprint === event.target_fingerprint,
        'V2_TARGET_FINGERPRINT_CONFLICT', 'Transfer target fingerprints conflict.');
      targetFingerprint = event.target_fingerprint;
    }
  }

  let state = priorState === 'Bridged' ? 'Bridged' : null;
  if (state === null) {
    state = STRUCTURED_STATE_PRECEDENCE.find((candidate) => states.has(candidate)) || null;
  }
  let evidenceSource = state === null ? null : 'structured_transfer_lifecycle_event';
  if (priorState === 'Bridged' && states.size === 0) evidenceSource = 'durable_prior_state';
  if (state === null) {
    state = authoritativeState(input.authoritative_provider_state, canonicalStates);
    if (state !== null) evidenceSource = 'authoritative_provider_call_field';
  }
  if (state === null) {
    state = modelState(input.initial_state, input.model_handoff_disposition || 'unknown');
    evidenceSource = state === input.initial_state ? 'unknown' : 'post_call_secondary_signal';
  }
  // A stale provider summary or post-call signal cannot downgrade durable bridged evidence.
  if (priorState === 'Bridged') state = 'Bridged';
  return Object.freeze({
    handoff_state: state,
    evidence_source: evidenceSource,
    unique_structured_event_count: claims.size,
    target_fingerprint: targetFingerprint,
  });
}

module.exports = Object.freeze({
  convergeHandoffEvidence,
  REQUIRED_EVENT_FIELDS,
  OPTIONAL_EVENT_FIELDS,
  TARGET_FINGERPRINT_PATTERN,
});
