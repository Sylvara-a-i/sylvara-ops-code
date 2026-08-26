'use strict';

const crypto = require('node:crypto');
const { invariant } = require('./errors');

const SUPPORTED_TRANSFER_EVENTS = Object.freeze([
  'transfer_started',
  'transfer_bridged',
  'transfer_cancelled',
  'transfer_ended',
]);
const TARGET_BEARING_EVENTS = new Set(SUPPORTED_TRANSFER_EVENTS.slice(0, 3));
const VERIFIED_BINDING_FIELDS = Object.freeze([
  'provider_call_id',
  'provider_agent_id',
  'call_binding_key',
  'client_scope_key',
  'deployment_scope_key',
  'configuration_version_key',
  'authorized_target_fingerprint',
  'authorized_transfer_configuration_fingerprint',
  'fingerprint_hmac_key_verification_tag',
]);
const NORMALIZED_BINDING_FIELDS = Object.freeze([
  'call_binding_key',
  'client_scope_key',
  'deployment_scope_key',
  'configuration_version_key',
]);
const KNOWN_WARM_TRANSFER_OPTION_FIELDS = Object.freeze([
  'type',
  'showTransfereeAsCaller',
  'publicHandoffOption',
  'agentDetectionTimeoutMs',
  'onHoldMusic',
  'enableBridgeAudioCue',
]);
const FORBIDDEN_WEBHOOK_OPTION_ALIASES = Object.freeze([
  'show_transferee_as_caller',
  'public_handoff_option',
  'agent_detection_timeout_ms',
  'on_hold_music',
  'enable_bridge_audio_cue',
  'opt_out_human_detection',
  'optOutHumanDetection',
]);
const SAFE_BINDING_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const TARGET_FINGERPRINT_PATTERN = /^target_[a-f0-9]{64}$/;
const TRANSFER_CONFIGURATION_FINGERPRINT_PATTERN = /^transfer_config_[a-f0-9]{64}$/;
const HMAC_KEY_VERIFICATION_TAG_PATTERN = /^hmac_key_[a-f0-9]{64}$/;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const EXTENSION_PATTERN = /^[0-9*#]{1,32}$/;
const MAX_RAW_EVENT_BYTES = 262_144;
const MAX_RAW_EVENT_NODES = 4_096;
const MAX_RAW_EVENT_DEPTH = 24;
const MAX_PUBLIC_HANDOFF_MESSAGE_CHARACTERS = 1_000;
const FINGERPRINT_HMAC_KEY_BYTES = 32;
const TARGET_HMAC_DOMAIN = 'sylvara.retell.handoff-v2.target.v1';
const TRANSFER_CONFIGURATION_HMAC_DOMAIN = 'sylvara.retell.handoff-v2.configuration.v1';
const EVENT_CLAIM_HMAC_DOMAIN = 'sylvara.retell.handoff-v2.event-claim.v1';
const KEY_VERIFICATION_HMAC_DOMAIN = 'sylvara.retell.handoff-v2.key-verification.v1';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactFields(value, requiredFields, optionalFields, code, message) {
  invariant(isPlainObject(value), code, message);
  const allowed = new Set([...requiredFields, ...optionalFields]);
  const fields = Object.keys(value);
  invariant(requiredFields.every((field) => Object.hasOwn(value, field))
    && fields.every((field) => allowed.has(field))
    && fields.length >= requiredFields.length
    && fields.length <= requiredFields.length + optionalFields.length,
  code, message);
}

function appendBounded(text, state) {
  state.bytes += Buffer.byteLength(text, 'utf8');
  invariant(state.bytes <= MAX_RAW_EVENT_BYTES, 'V2_RETELL_EVENT_OVERSIZE',
    'Retell transfer event exceeds the size limit.');
  return text;
}

function stableJson(value, state = { nodes: 0, bytes: 0 }, depth = 0) {
  invariant(depth <= MAX_RAW_EVENT_DEPTH, 'V2_RETELL_EVENT_OVERSIZE',
    'Retell transfer event exceeds the structural limit.');
  state.nodes += 1;
  invariant(state.nodes <= MAX_RAW_EVENT_NODES, 'V2_RETELL_EVENT_OVERSIZE',
    'Retell transfer event exceeds the structural limit.');

  if (value === null || typeof value === 'boolean') {
    return appendBounded(JSON.stringify(value), state);
  }
  if (typeof value === 'number') {
    invariant(Number.isFinite(value), 'V2_RETELL_EVENT_INVALID',
      'Retell transfer event contains a non-JSON number.');
    return appendBounded(JSON.stringify(value), state);
  }
  if (typeof value === 'string') {
    invariant(value.length <= MAX_RAW_EVENT_BYTES, 'V2_RETELL_EVENT_OVERSIZE',
      'Retell transfer event exceeds the size limit.');
    return appendBounded(JSON.stringify(value), state);
  }
  if (Array.isArray(value)) {
    const arrayKeys = Object.keys(value);
    invariant(Object.getOwnPropertySymbols(value).length === 0
      && arrayKeys.length === value.length
      && arrayKeys.every((key, index) => key === String(index)),
    'V2_RETELL_EVENT_INVALID', 'Retell transfer event contains a non-JSON array.');
    appendBounded('[', state);
    const items = value.map((item, index) => {
      if (index > 0) appendBounded(',', state);
      return stableJson(item, state, depth + 1);
    });
    appendBounded(']', state);
    return `[${items.join(',')}]`;
  }
  invariant(isPlainObject(value), 'V2_RETELL_EVENT_INVALID',
    'Retell transfer event must contain JSON-compatible plain values.');
  invariant(Object.getOwnPropertySymbols(value).length === 0,
    'V2_RETELL_EVENT_INVALID', 'Retell transfer event contains a non-JSON object.');
  appendBounded('{', state);
  const properties = Object.keys(value).sort().map((key, index) => {
    if (index > 0) appendBounded(',', state);
    const prefix = `${JSON.stringify(key)}:`;
    appendBounded(prefix, state);
    return `${prefix}${stableJson(value[key], state, depth + 1)}`;
  });
  appendBounded('}', state);
  return `{${properties.join(',')}}`;
}

function assertBoundedRawEvent(rawEvent) {
  let serialized;
  try {
    serialized = stableJson(rawEvent);
  } catch (error) {
    if (error && typeof error === 'object' && typeof error.code === 'string') throw error;
    invariant(false, 'V2_RETELL_EVENT_INVALID', 'Retell transfer event is not serializable.');
  }
  invariant(Buffer.byteLength(serialized, 'utf8') <= MAX_RAW_EVENT_BYTES,
    'V2_RETELL_EVENT_OVERSIZE', 'Retell transfer event exceeds the size limit.');
}

function assertSafeBindingValue(value, field) {
  invariant(typeof value === 'string' && SAFE_BINDING_PATTERN.test(value),
    'V2_RETELL_BINDING_INVALID', `${field} is invalid.`);
}

function assertFingerprintHmacKey(key) {
  invariant(Buffer.isBuffer(key) && key.length === FINGERPRINT_HMAC_KEY_BYTES,
    'V2_RETELL_HMAC_KEY_INVALID',
    'Retell fingerprint HMAC key must be an injected 32-byte private Buffer.');
}

function hmacHex(key, domain, fields) {
  assertFingerprintHmacKey(key);
  return crypto.createHmac('sha256', key)
    .update(JSON.stringify([domain, ...fields]), 'utf8')
    .digest('hex');
}

function safeFingerprintEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function fingerprintHmacKeyVerificationTag(binding, fingerprintHmacKey) {
  invariant(isPlainObject(binding), 'V2_RETELL_BINDING_INVALID',
    'Verified Retell binding is invalid.');
  const fields = VERIFIED_BINDING_FIELDS.slice(0, -1);
  invariant(fields.every((field) => typeof binding[field] === 'string'),
    'V2_RETELL_BINDING_INVALID', 'Verified Retell binding is incomplete.');
  return `hmac_key_${hmacHex(fingerprintHmacKey, KEY_VERIFICATION_HMAC_DOMAIN,
    fields.map((field) => binding[field]))}`;
}

function assertVerifiedBinding(binding, fingerprintHmacKey) {
  assertExactFields(binding, VERIFIED_BINDING_FIELDS, [], 'V2_RETELL_BINDING_INVALID',
    'Verified Retell binding fields are invalid.');
  for (const field of VERIFIED_BINDING_FIELDS.slice(0, 6)) {
    assertSafeBindingValue(binding[field], field);
  }
  invariant(typeof binding.authorized_target_fingerprint === 'string'
    && TARGET_FINGERPRINT_PATTERN.test(binding.authorized_target_fingerprint),
  'V2_RETELL_BINDING_INVALID', 'authorized_target_fingerprint is invalid.');
  invariant(typeof binding.authorized_transfer_configuration_fingerprint === 'string'
    && TRANSFER_CONFIGURATION_FINGERPRINT_PATTERN
      .test(binding.authorized_transfer_configuration_fingerprint),
  'V2_RETELL_BINDING_INVALID',
  'authorized_transfer_configuration_fingerprint is invalid.');
  invariant(typeof binding.fingerprint_hmac_key_verification_tag === 'string'
    && HMAC_KEY_VERIFICATION_TAG_PATTERN
      .test(binding.fingerprint_hmac_key_verification_tag),
  'V2_RETELL_BINDING_INVALID', 'fingerprint_hmac_key_verification_tag is invalid.');
  const expectedKeyTag = fingerprintHmacKeyVerificationTag(binding, fingerprintHmacKey);
  invariant(safeFingerprintEqual(binding.fingerprint_hmac_key_verification_tag, expectedKeyTag),
    'V2_RETELL_HMAC_KEY_MISMATCH',
    'Retell fingerprint HMAC key does not match the verified provider binding.');
}

function assertRetellCall(call, binding) {
  invariant(isPlainObject(call), 'V2_RETELL_EVENT_INVALID',
    'Retell call evidence must be a plain object.');
  for (const field of ['call_id', 'agent_id', 'start_timestamp']) {
    invariant(Object.hasOwn(call, field), 'V2_RETELL_EVENT_INVALID',
      `Retell call evidence is missing ${field}.`);
  }
  assertSafeBindingValue(call.call_id, 'call_id');
  assertSafeBindingValue(call.agent_id, 'agent_id');
  invariant(call.call_id === binding.provider_call_id
    && call.agent_id === binding.provider_agent_id,
  'V2_RETELL_SCOPE_MISMATCH', 'Retell call evidence does not match the verified provider binding.');
  invariant(Number.isSafeInteger(call.start_timestamp) && call.start_timestamp >= 0,
    'V2_RETELL_EVENT_INVALID', 'Retell call start_timestamp is invalid.');
}

function assertDestination(destination) {
  assertExactFields(destination, ['number'], ['extension'], 'V2_RETELL_TARGET_INVALID',
    'Retell transfer destination fields are invalid.');
  invariant(typeof destination.number === 'string' && E164_PATTERN.test(destination.number),
    'V2_RETELL_TARGET_INVALID', 'Retell transfer destination must contain a valid E.164 number.');
  if (Object.hasOwn(destination, 'extension')) {
    invariant(typeof destination.extension === 'string'
      && EXTENSION_PATTERN.test(destination.extension),
    'V2_RETELL_TARGET_INVALID', 'Retell transfer extension is invalid.');
  }
}

function assertWarmTransferOption(option) {
  invariant(isPlainObject(option), 'V2_RETELL_OPTION_INVALID',
    'Retell transfer_option must be a plain object.');
  invariant(Object.hasOwn(option, 'type') && option.type === 'warm_transfer',
    'V2_RETELL_OPTION_INVALID', 'Only warm_transfer provider evidence is supported.');
  invariant(FORBIDDEN_WEBHOOK_OPTION_ALIASES.every((field) => !Object.hasOwn(option, field)),
    'V2_RETELL_OPTION_ALIAS_FORBIDDEN',
    'Draft or security-configuration aliases are forbidden in the webhook transfer option.');
  assertExactFields(option, ['type'], KNOWN_WARM_TRANSFER_OPTION_FIELDS.slice(1),
    'V2_RETELL_OPTION_FIELD_UNSUPPORTED',
    'Retell transfer_option contains a field outside the reviewed webhook allowlist.');

  if (Object.hasOwn(option, 'showTransfereeAsCaller')) {
    invariant(typeof option.showTransfereeAsCaller === 'boolean',
      'V2_RETELL_OPTION_INVALID', 'showTransfereeAsCaller must be a boolean.');
  }
  if (Object.hasOwn(option, 'publicHandoffOption')) {
    assertExactFields(option.publicHandoffOption, ['type', 'message'], [],
      'V2_RETELL_OPTION_INVALID', 'publicHandoffOption fields are invalid.');
    invariant(option.publicHandoffOption.type === 'static_message'
      && typeof option.publicHandoffOption.message === 'string'
      && option.publicHandoffOption.message.trim().length > 0
      && option.publicHandoffOption.message.length <= MAX_PUBLIC_HANDOFF_MESSAGE_CHARACTERS,
    'V2_RETELL_OPTION_INVALID', 'publicHandoffOption is invalid.');
  }
  if (Object.hasOwn(option, 'agentDetectionTimeoutMs')) {
    invariant(Number.isSafeInteger(option.agentDetectionTimeoutMs)
      && option.agentDetectionTimeoutMs >= 10_000
      && option.agentDetectionTimeoutMs <= 300_000,
    'V2_RETELL_OPTION_INVALID', 'agentDetectionTimeoutMs is outside the supported range.');
  }
  if (Object.hasOwn(option, 'onHoldMusic')) {
    assertExactFields(option.onHoldMusic, ['type'], [], 'V2_RETELL_OPTION_INVALID',
      'onHoldMusic fields are invalid.');
    invariant(option.onHoldMusic.type === 'default', 'V2_RETELL_OPTION_INVALID',
      'Only the documented default on-hold music shape is accepted.');
  }
  if (Object.hasOwn(option, 'enableBridgeAudioCue')) {
    invariant(typeof option.enableBridgeAudioCue === 'boolean',
      'V2_RETELL_OPTION_INVALID', 'enableBridgeAudioCue must be a boolean.');
  }
  return Object.freeze({
    type: option.type,
    showTransfereeAsCaller: Object.hasOwn(option, 'showTransfereeAsCaller')
      ? option.showTransfereeAsCaller : null,
    publicHandoffOption: Object.hasOwn(option, 'publicHandoffOption')
      ? Object.freeze({ ...option.publicHandoffOption }) : null,
    agentDetectionTimeoutMs: Object.hasOwn(option, 'agentDetectionTimeoutMs')
      ? option.agentDetectionTimeoutMs : null,
    onHoldMusic: Object.hasOwn(option, 'onHoldMusic')
      ? Object.freeze({ ...option.onHoldMusic }) : null,
    enableBridgeAudioCue: Object.hasOwn(option, 'enableBridgeAudioCue')
      ? option.enableBridgeAudioCue : null,
  });
}

function targetFingerprint(destination, fingerprintHmacKey) {
  assertDestination(destination);
  const extension = Object.hasOwn(destination, 'extension') ? destination.extension : '';
  const digest = hmacHex(fingerprintHmacKey, TARGET_HMAC_DOMAIN, [
    destination.number,
    extension,
  ]);
  return `target_${digest}`;
}

function transferConfigurationFingerprint(destination, option, fingerprintHmacKey) {
  assertBoundedRawEvent({ transfer_destination: destination, transfer_option: option });
  const destinationFingerprint = targetFingerprint(destination, fingerprintHmacKey);
  const canonicalOption = assertWarmTransferOption(option);
  const digest = hmacHex(fingerprintHmacKey, TRANSFER_CONFIGURATION_HMAC_DOMAIN, [
    destinationFingerprint,
    JSON.stringify(canonicalOption),
  ]);
  return `transfer_config_${digest}`;
}

function eventClaimKey(
  eventType,
  call,
  fingerprint,
  transferConfigurationFingerprintValue,
  fingerprintHmacKey,
) {
  const digest = hmacHex(fingerprintHmacKey, EVENT_CLAIM_HMAC_DOMAIN, [
    eventType,
    call.call_id,
    String(call.start_timestamp),
    fingerprint || '',
    transferConfigurationFingerprintValue,
  ]);
  return `retell_${digest}`;
}

/**
 * Minimizes a verified Retell transfer webhook into the provider-neutral v2 event envelope.
 * This pure source-only parser is deliberately not connected to the live gateway or a Retell
 * Draft. Unknown top-level and transfer-option fields fail closed. Variable fields inside
 * Retell's documented full call object remain bounded but are never copied to the result.
 */
function normalizeRetellTransferEvent(input) {
  assertExactFields(input,
    ['raw_event', 'verified_provider_binding', 'fingerprint_hmac_key'], [],
    'V2_RETELL_PARSER_INPUT_INVALID', 'Retell parser input fields are invalid.');
  const {
    raw_event: rawEvent,
    verified_provider_binding: binding,
    fingerprint_hmac_key: fingerprintHmacKey,
  } = input;
  assertFingerprintHmacKey(fingerprintHmacKey);
  assertVerifiedBinding(binding, fingerprintHmacKey);
  assertBoundedRawEvent(rawEvent);
  invariant(isPlainObject(rawEvent) && typeof rawEvent.event === 'string'
    && SUPPORTED_TRANSFER_EVENTS.includes(rawEvent.event),
  'V2_RETELL_EVENT_UNSUPPORTED', 'Retell transfer event type is unsupported.');

  const targetBearing = TARGET_BEARING_EVENTS.has(rawEvent.event);
  assertExactFields(
    rawEvent,
    targetBearing
      ? ['event', 'call', 'transfer_destination', 'transfer_option']
      : ['event', 'call'],
    [],
    'V2_RETELL_EVENT_INVALID',
    'Retell transfer event envelope fields are invalid.',
  );
  assertRetellCall(rawEvent.call, binding);

  let fingerprint = null;
  if (targetBearing) {
    fingerprint = targetFingerprint(rawEvent.transfer_destination, fingerprintHmacKey);
    invariant(safeFingerprintEqual(fingerprint, binding.authorized_target_fingerprint),
      'V2_RETELL_TARGET_MISMATCH',
      'Retell transfer destination does not match the authorized target fingerprint.');
    const configurationFingerprint = transferConfigurationFingerprint(
      rawEvent.transfer_destination,
      rawEvent.transfer_option,
      fingerprintHmacKey,
    );
    invariant(safeFingerprintEqual(configurationFingerprint,
      binding.authorized_transfer_configuration_fingerprint),
    'V2_RETELL_CONFIGURATION_MISMATCH',
    'Retell transfer option does not match the authorized transfer configuration fingerprint.');
  }

  const normalized = {
    event_type: rawEvent.event,
    event_claim_key: eventClaimKey(
      rawEvent.event,
      rawEvent.call,
      fingerprint,
      binding.authorized_transfer_configuration_fingerprint,
      fingerprintHmacKey,
    ),
    ...Object.fromEntries(NORMALIZED_BINDING_FIELDS.map((field) => [field, binding[field]])),
    transfer_configuration_fingerprint:
      binding.authorized_transfer_configuration_fingerprint,
    observed_order: rawEvent.call.start_timestamp,
    ...(fingerprint === null ? {} : { target_fingerprint: fingerprint }),
  };
  return Object.freeze(normalized);
}

module.exports = Object.freeze({
  normalizeRetellTransferEvent,
  targetFingerprint,
  transferConfigurationFingerprint,
  fingerprintHmacKeyVerificationTag,
  SUPPORTED_TRANSFER_EVENTS,
  VERIFIED_BINDING_FIELDS,
  KNOWN_WARM_TRANSFER_OPTION_FIELDS,
  FORBIDDEN_WEBHOOK_OPTION_ALIASES,
  MAX_RAW_EVENT_BYTES,
  FINGERPRINT_HMAC_KEY_BYTES,
});
