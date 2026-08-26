'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const adapterContract = require('../../../../../retell/agents/7-day-free-test/v2/contracts/transfer-adapter-contract.json');
const candidateContract = require('../../../../../retell/agents/7-day-free-test/v2/contracts/candidate-contract.json');
const { canonicalizeHandoffEvents } = require('../lib/handoff-v2-convergence');
const {
  MAX_RAW_EVENT_BYTES,
  normalizeRetellTransferEvent,
  targetFingerprint,
  transferConfigurationFingerprint,
  fingerprintHmacKeyVerificationTag,
} = require('../lib/retell-handoff-v2-parser');

const DESTINATION = Object.freeze({ number: '+15555550101', extension: '12#' });
const SYNTHETIC_FINGERPRINT_BYTES = crypto.createHash('sha256')
  .update('synthetic-retell-fingerprint-key-a', 'utf8').digest();
const SYNTHETIC_ROTATED_FINGERPRINT_BYTES = crypto.createHash('sha256')
  .update('synthetic-retell-fingerprint-key-b', 'utf8').digest();
const TARGET = targetFingerprint(DESTINATION, SYNTHETIC_FINGERPRINT_BYTES);
const TRANSFER_CONFIGURATION = transferConfigurationFingerprint(
  DESTINATION,
  warmTransferOption(),
  SYNTHETIC_FINGERPRINT_BYTES,
);

function verifiedBinding(overrides = {}, fingerprintBytes = SYNTHETIC_FINGERPRINT_BYTES) {
  const binding = {
    provider_call_id: 'call_synthetic_001',
    provider_agent_id: 'agent_synthetic_001',
    call_binding_key: 'call_binding_synthetic_001',
    client_scope_key: 'client_synthetic_001',
    deployment_scope_key: 'deployment_synthetic_001',
    configuration_version_key: 'configuration_synthetic_001',
    authorized_target_fingerprint: TARGET,
    authorized_transfer_configuration_fingerprint: TRANSFER_CONFIGURATION,
    ...overrides,
  };
  return {
    ...binding,
    fingerprint_hmac_key_verification_tag:
      overrides.fingerprint_hmac_key_verification_tag
      || fingerprintHmacKeyVerificationTag(binding, fingerprintBytes),
  };
}

function retellCall(overrides = {}) {
  return {
    call_id: 'call_synthetic_001',
    agent_id: 'agent_synthetic_001',
    start_timestamp: 1_788_000_000_000,
    call_status: 'ongoing',
    synthetic_provider_field: { may_be_omitted: true },
    ...overrides,
  };
}

function warmTransferOption(overrides = {}) {
  return {
    type: 'warm_transfer',
    showTransfereeAsCaller: false,
    publicHandoffOption: {
      type: 'static_message',
      message: 'Synthetic transfer handoff.',
    },
    agentDetectionTimeoutMs: 30_000,
    onHoldMusic: { type: 'default' },
    enableBridgeAudioCue: true,
    ...overrides,
  };
}

function rawEvent(event = 'transfer_started', overrides = {}) {
  if (event === 'transfer_ended') {
    return { event, call: retellCall(), ...overrides };
  }
  return {
    event,
    call: retellCall(),
    transfer_destination: { ...DESTINATION },
    transfer_option: warmTransferOption(),
    ...overrides,
  };
}

function normalize(
  raw_event,
  binding = verifiedBinding(),
  fingerprint_hmac_key = SYNTHETIC_FINGERPRINT_BYTES,
) {
  return normalizeRetellTransferEvent({
    raw_event,
    verified_provider_binding: binding,
    fingerprint_hmac_key,
  });
}

function assertCode(code, operation) {
  assert.throws(operation, (error) => error && error.code === code);
}

test('normalizes only the four verified transfer events into the existing minimal envelope', () => {
  for (const eventType of [
    'transfer_started', 'transfer_bridged', 'transfer_cancelled', 'transfer_ended',
  ]) {
    const result = normalize(rawEvent(eventType));
    const expectedFields = [
      'event_type',
      'event_claim_key',
      'call_binding_key',
      'client_scope_key',
      'deployment_scope_key',
      'configuration_version_key',
      'transfer_configuration_fingerprint',
      'observed_order',
      ...(eventType === 'transfer_ended' ? [] : ['target_fingerprint']),
    ];
    assert.deepEqual(Object.keys(result), expectedFields);
    assert.equal(result.event_type, eventType);
    assert.match(result.event_claim_key, /^retell_[a-f0-9]{64}$/);
    assert.equal(result.observed_order, 1_788_000_000_000);
    assert.equal(result.call_binding_key, 'call_binding_synthetic_001');
    assert.equal(result.client_scope_key, 'client_synthetic_001');
    assert.equal(result.deployment_scope_key, 'deployment_synthetic_001');
    assert.equal(result.configuration_version_key, 'configuration_synthetic_001');
    assert.equal(result.transfer_configuration_fingerprint, TRANSFER_CONFIGURATION);
    if (eventType === 'transfer_ended') {
      assert.equal(Object.hasOwn(result, 'target_fingerprint'), false);
    } else {
      assert.equal(result.target_fingerprint, TARGET);
    }
    assert.equal(Object.isFrozen(result), true);
  }
});

test('derives deterministic keyed target, configuration, and claim fingerprints without retention', () => {
  assert.match(TARGET, /^target_[a-f0-9]{64}$/);
  assert.match(TRANSFER_CONFIGURATION, /^transfer_config_[a-f0-9]{64}$/);
  assert.equal(TARGET, targetFingerprint({ ...DESTINATION }, SYNTHETIC_FINGERPRINT_BYTES));
  assert.notEqual(TARGET, targetFingerprint(
    { ...DESTINATION, extension: '13#' }, SYNTHETIC_FINGERPRINT_BYTES,
  ));
  assert.notEqual(TARGET, targetFingerprint(
    { number: '+15555550102', extension: '12#' }, SYNTHETIC_FINGERPRINT_BYTES,
  ));

  const source = rawEvent('transfer_started');
  const first = normalize(source);
  const replay = normalize(structuredClone(source));
  const later = normalize(rawEvent('transfer_started', {
    call: retellCall({ start_timestamp: 1_788_000_000_001 }),
  }));
  assert.equal(first.event_claim_key, replay.event_claim_key);
  assert.notEqual(first.event_claim_key, later.event_claim_key);
  assert.equal(JSON.stringify(source).includes('+15555550101'), true);
  assert.equal(JSON.stringify(first).includes('+15555550101'), false);
  assert.equal(JSON.stringify(first).includes('Synthetic transfer handoff.'), false);
  assert.equal(JSON.stringify(first).includes('synthetic_provider_field'), false);
  assert.equal(Object.hasOwn(first, 'fingerprint_hmac_key'), false);
  assert.equal(Object.hasOwn(first, 'authorized_transfer_configuration_fingerprint'), false);
  assert.equal(first.transfer_configuration_fingerprint, TRANSFER_CONFIGURATION);
});

test('requires one exact private HMAC key and fails closed across key rotation', () => {
  const source = rawEvent('transfer_started');
  assertCode('V2_RETELL_PARSER_INPUT_INVALID', () => normalizeRetellTransferEvent({
    raw_event: source,
    verified_provider_binding: verifiedBinding(),
  }));
  for (const fingerprint_hmac_key of [
    null,
    'not-a-buffer',
    Buffer.alloc(31),
    Buffer.alloc(33),
    new Uint8Array(32),
  ]) {
    assertCode('V2_RETELL_HMAC_KEY_INVALID', () => normalize(
      source, verifiedBinding(), fingerprint_hmac_key,
    ));
  }

  const rotatedTarget = targetFingerprint(DESTINATION, SYNTHETIC_ROTATED_FINGERPRINT_BYTES);
  const rotatedConfiguration = transferConfigurationFingerprint(
    DESTINATION, warmTransferOption(), SYNTHETIC_ROTATED_FINGERPRINT_BYTES,
  );
  const rotatedBinding = verifiedBinding({
    authorized_target_fingerprint: rotatedTarget,
    authorized_transfer_configuration_fingerprint: rotatedConfiguration,
  }, SYNTHETIC_ROTATED_FINGERPRINT_BYTES);
  const before = normalize(source);
  const after = normalize(source, rotatedBinding, SYNTHETIC_ROTATED_FINGERPRINT_BYTES);
  assert.notEqual(before.target_fingerprint, after.target_fingerprint);
  assert.notEqual(before.event_claim_key, after.event_claim_key);
  assert.notEqual(TRANSFER_CONFIGURATION, rotatedConfiguration);
  assertCode('V2_RETELL_HMAC_KEY_MISMATCH', () => normalize(
    source, rotatedBinding, SYNTHETIC_FINGERPRINT_BYTES,
  ));
  assertCode('V2_RETELL_HMAC_KEY_MISMATCH', () => normalize(
    rawEvent('transfer_ended'), verifiedBinding(), SYNTHETIC_ROTATED_FINGERPRINT_BYTES,
  ));
  assertCode('V2_RETELL_HMAC_KEY_MISMATCH', () => normalize(
    rawEvent('transfer_ended'),
    verifiedBinding({ fingerprint_hmac_key_verification_tag: `hmac_key_${'0'.repeat(64)}` }),
  ));
});

test('does not regress to a target digest computable from public destination guesses', () => {
  const legacyPublicDigest = `target_${crypto.createHash('sha256').update([
    'retell-warm-transfer-destination-v1',
    DESTINATION.number,
    DESTINATION.extension,
  ].join('\0'), 'utf8').digest('hex')}`;
  assert.notEqual(TARGET, legacyPublicDigest);

  const publicGuessKey = crypto.createHash('sha256')
    .update('public-dictionary-guess', 'utf8').digest();
  for (const number of ['+15555550100', '+15555550101', '+15555550102']) {
    assert.notEqual(TARGET, targetFingerprint(
      { number, extension: DESTINATION.extension }, publicGuessKey,
    ));
  }
});

test('produces normalized events accepted by the canonical convergence boundary', () => {
  const binding = verifiedBinding();
  const event = normalize(rawEvent('transfer_bridged'), binding);
  const canonical = canonicalizeHandoffEvents({
    binding: {
      call_binding_key: binding.call_binding_key,
      client_scope_key: binding.client_scope_key,
      deployment_scope_key: binding.deployment_scope_key,
      configuration_version_key: binding.configuration_version_key,
      transfer_configuration_fingerprint:
        binding.authorized_transfer_configuration_fingerprint,
    },
    normalized_events: [event],
  }, adapterContract, candidateContract);
  assert.deepEqual(canonical, [event]);
});

test('rejects unsupported event names, casing, and non-exact top-level envelopes', () => {
  for (const eventType of ['Transfer_Started', 'transfer_failed', 'call_ended', '', null]) {
    assertCode('V2_RETELL_EVENT_UNSUPPORTED', () => normalize(rawEvent(eventType)));
  }
  assertCode('V2_RETELL_EVENT_INVALID', () => normalize({
    ...rawEvent('transfer_started'),
    extra_top_level_field: true,
  }));
  assertCode('V2_RETELL_EVENT_INVALID', () => normalize({
    event: 'transfer_started',
    call: retellCall(),
  }));
  assertCode('V2_RETELL_EVENT_INVALID', () => normalize({
    ...rawEvent('transfer_ended'),
    transfer_destination: { ...DESTINATION },
  }));
});

test('rejects unverified call, agent, binding, timestamp, and target evidence', () => {
  assertCode('V2_RETELL_SCOPE_MISMATCH', () => normalize(rawEvent('transfer_started', {
    call: retellCall({ call_id: 'call_different' }),
  })));
  assertCode('V2_RETELL_SCOPE_MISMATCH', () => normalize(rawEvent('transfer_started', {
    call: retellCall({ agent_id: 'agent_different' }),
  })));
  for (const start_timestamp of [-1, 1.5, '1788000000000', Number.MAX_SAFE_INTEGER + 1]) {
    assertCode('V2_RETELL_EVENT_INVALID', () => normalize(rawEvent('transfer_started', {
      call: retellCall({ start_timestamp }),
    })));
  }
  assertCode('V2_RETELL_BINDING_INVALID', () => normalize(
    rawEvent('transfer_started'),
    { ...verifiedBinding(), unexpected: true },
  ));
  assertCode('V2_RETELL_TARGET_MISMATCH', () => normalize(
    rawEvent('transfer_started'),
    verifiedBinding({ authorized_target_fingerprint: targetFingerprint({
      number: '+15555550103',
    }, SYNTHETIC_FINGERPRINT_BYTES) }),
  ));
  assertCode('V2_RETELL_BINDING_INVALID', () => normalize(
    rawEvent('transfer_started'),
    verifiedBinding({ authorized_transfer_configuration_fingerprint: 'configuration_invalid' }),
  ));
});

test('requires an exact E.164 destination shape and a bounded optional extension', () => {
  for (const transfer_destination of [
    {},
    { number: '5555550101' },
    { number: '+05555550101' },
    { number: '+15555550101', extension: '' },
    { number: '+15555550101', extension: 'A12' },
    { number: '+15555550101', extension: '1'.repeat(33) },
    { number: '+15555550101', type: 'predefined' },
  ]) {
    assertCode('V2_RETELL_TARGET_INVALID', () => normalize(rawEvent('transfer_started', {
      transfer_destination,
    })));
  }
});

test('validates every field in the exact documented warm-transfer webhook allowlist', () => {
  const validKnownBoundaries = [
    { agentDetectionTimeoutMs: 10_000 },
    { agentDetectionTimeoutMs: 300_000 },
    { showTransfereeAsCaller: true },
    { enableBridgeAudioCue: false },
  ];
  for (const override of validKnownBoundaries) {
    const transferOption = warmTransferOption(override);
    const binding = verifiedBinding({
      authorized_transfer_configuration_fingerprint: transferConfigurationFingerprint(
        DESTINATION, transferOption, SYNTHETIC_FINGERPRINT_BYTES,
      ),
    });
    assert.doesNotThrow(() => normalize(rawEvent('transfer_started', {
      transfer_option: transferOption,
    }), binding));
  }

  const invalidOptions = [
    warmTransferOption({ type: 'cold_transfer' }),
    warmTransferOption({ showTransfereeAsCaller: 'false' }),
    warmTransferOption({ enableBridgeAudioCue: 1 }),
    warmTransferOption({ agentDetectionTimeoutMs: 9_999 }),
    warmTransferOption({ agentDetectionTimeoutMs: 300_001 }),
    warmTransferOption({ publicHandoffOption: { type: 'dynamic', message: 'Synthetic.' } }),
    warmTransferOption({ publicHandoffOption: { type: 'static_message', message: ' ' } }),
    warmTransferOption({ publicHandoffOption: {
      type: 'static_message', message: 'x'.repeat(1_001),
    } }),
    warmTransferOption({ onHoldMusic: { type: 'custom' } }),
  ];
  for (const transfer_option of invalidOptions) {
    assertCode('V2_RETELL_OPTION_INVALID', () => normalize(rawEvent('transfer_started', {
      transfer_option,
    })));
  }
});

test('binds the documented camelCase transfer configuration and rejects Draft aliases', () => {
  const changedOption = warmTransferOption({ enableBridgeAudioCue: false });
  assertCode('V2_RETELL_CONFIGURATION_MISMATCH', () => normalize(rawEvent(
    'transfer_started', { transfer_option: changedOption },
  )));

  for (const [field, value] of [
    ['opt_out_human_detection', true],
    ['agent_detection_timeout_ms', 'malformed'],
    ['enable_bridge_audio_cue', true],
    ['optOutHumanDetection', true],
  ]) {
    assertCode('V2_RETELL_OPTION_ALIAS_FORBIDDEN', () => normalize(rawEvent(
      'transfer_started', { transfer_option: warmTransferOption({ [field]: value }) },
    )));
  }

  for (const [field, value] of [
    ['transferRingDurationMs', 30_000],
    ['futureProviderMetadata', { synthetic: true }],
  ]) {
    assertCode('V2_RETELL_OPTION_FIELD_UNSUPPORTED', () => normalize(rawEvent(
      'transfer_started', { transfer_option: warmTransferOption({ [field]: value }) },
    )));
  }
});

test('rejects nonplain, non-JSON, and oversized raw evidence before normalization', () => {
  assertCode('V2_RETELL_PARSER_INPUT_INVALID', () => normalizeRetellTransferEvent({
    raw_event: rawEvent('transfer_started'),
    verified_provider_binding: verifiedBinding(),
    fingerprint_hmac_key: SYNTHETIC_FINGERPRINT_BYTES,
    extra: true,
  }));
  assertCode('V2_RETELL_EVENT_INVALID', () => normalize(rawEvent('transfer_started', {
    call: new Date(),
  })));
  assertCode('V2_RETELL_EVENT_INVALID', () => normalize(rawEvent('transfer_started', {
    call: retellCall({ non_json: undefined }),
  })));
  assertCode('V2_RETELL_EVENT_OVERSIZE', () => normalize(rawEvent('transfer_started', {
    call: retellCall({ oversized: 'x'.repeat(MAX_RAW_EVENT_BYTES) }),
  })));
});

test('never fabricates a failure event or failure subtype from cancellation or ending', () => {
  const cancelled = normalize(rawEvent('transfer_cancelled'));
  const ended = normalize(rawEvent('transfer_ended'));
  assert.equal(cancelled.event_type, 'transfer_cancelled');
  assert.equal(ended.event_type, 'transfer_ended');
  assert.equal(Object.hasOwn(cancelled, 'failure_reason'), false);
  assert.equal(Object.hasOwn(ended, 'failure_reason'), false);
  assertCode('V2_RETELL_EVENT_UNSUPPORTED', () => normalize(rawEvent('transfer_failed')));
});
