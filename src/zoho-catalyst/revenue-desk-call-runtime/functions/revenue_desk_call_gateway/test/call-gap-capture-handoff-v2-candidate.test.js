'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const manifest = require('../contracts/call-gap-capture-handoff-v2.proposed.json');
const candidateContract = require('../../../../../retell/agents/7-day-free-test/v2/contracts/candidate-contract.json');
const adapterContract = require('../../../../../retell/agents/7-day-free-test/v2/contracts/transfer-adapter-contract.json');
const {
  EXPECTED_NOTIFICATION_FIELDS,
  assertV2CandidateContracts,
  createV2CandidateService,
  decideHandoff,
  notificationPayload,
} = require('../lib/call-gap-capture-handoff-v2-candidate');
const { convergeHandoffEvidence } = require('../lib/handoff-v2-convergence');

function digest(prefix, value) {
  return `${prefix}_${crypto.createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function binding(client = 'alpha') {
  return {
    call_binding_key: `call_${client}`,
    client_scope_key: `client_${client}`,
    deployment_scope_key: `deployment_${client}`,
    configuration_version_key: `configuration_${client}`,
    recipient_fingerprint: digest('recipient', `recipient-${client}`),
  };
}

function event(bound, eventType, claim, order, overrides = {}) {
  return {
    event_type: eventType,
    event_claim_key: claim,
    call_binding_key: bound.call_binding_key,
    client_scope_key: bound.client_scope_key,
    deployment_scope_key: bound.deployment_scope_key,
    configuration_version_key: bound.configuration_version_key,
    observed_order: order,
    ...overrides,
  };
}

function analysis(overrides = {}) {
  return {
    outcome: 'potential_job',
    coverage_trigger: 'AfterHours',
    caller_name: 'Synthetic Caller',
    callback_number: '+15555550100',
    customer_type: 'new',
    caller_intent: 'service_request',
    issue_summary: 'Synthetic service request.',
    city_or_zip: '00000',
    urgency: 'routine',
    specific_person_requested: null,
    sensitive_data_detected: false,
    bookable_opportunity: true,
    office_follow_up_required: true,
    workflow_failure_code: null,
    workflow_failure_text: null,
    handoff_reason: 'none',
    handoff_disposition: 'not_applicable',
    ...overrides,
  };
}

function handoffFacts(overrides = {}) {
  return {
    outcome: 'potential_job',
    urgency: 'routine',
    caller_intent: 'service_request',
    caller_intent_authority: 'structured_call_classification',
    service_eligibility: 'supported',
    service_eligibility_authority: 'immutable_client_configuration',
    area_eligibility: 'in_area',
    area_eligibility_authority: 'immutable_client_configuration',
    handoff_reason: 'none',
    handoff_enabled: false,
    urgent_handoff_enabled: false,
    existing_customer_handoff_enabled: false,
    specific_person_handoff_enabled: false,
    caller_transfer_consent: 'not_offered',
    immediate_danger: false,
    destination_validity: 'not_configured',
    destination_fingerprint: null,
    destination_authority: 'immutable_client_configuration',
    loop_proof: 'not_required',
    loop_proof_authority: 'server_route_graph',
    ...overrides,
  };
}

function eligibleUrgentHandoffFacts(target, overrides = {}) {
  return handoffFacts({
    outcome: 'urgent_potential_job',
    urgency: 'urgent',
    handoff_reason: 'urgent',
    handoff_enabled: true,
    urgent_handoff_enabled: true,
    caller_transfer_consent: 'accepted',
    destination_validity: 'valid',
    destination_fingerprint: target,
    loop_proof: 'passed',
    ...overrides,
  });
}

function minimizedSensitiveTerminalAnalysis(overrides = {}) {
  return analysis({
    outcome: 'sensitive_data_ended',
    caller_name: null,
    callback_number: null,
    customer_type: 'unknown',
    caller_intent: null,
    issue_summary: null,
    city_or_zip: null,
    urgency: 'unknown',
    specific_person_requested: null,
    sensitive_data_detected: true,
    bookable_opportunity: false,
    office_follow_up_required: false,
    workflow_failure_code: null,
    workflow_failure_text: null,
    handoff_reason: 'none',
    handoff_disposition: 'not_applicable',
    ...overrides,
  });
}

class MemoryNotificationStore {
  constructor() {
    this.rows = new Map();
    this.callCount = 0;
  }

  async ensureOne(intent) {
    this.callCount += 1;
    const existing = this.rows.get(intent.intent_key);
    if (existing) return { inserted: false, intent: existing };
    const stored = structuredClone(intent);
    this.rows.set(intent.intent_key, stored);
    return { inserted: true, intent: stored };
  }
}

class MemoryVerificationStore {
  constructor(windows = []) {
    this.windows = new Map(windows.map((window) => [window.window_key,
      structuredClone(window)]));
    this.receipts = new Map();
    this.callCount = 0;
  }

  async consumeOpenWindow(request) {
    this.callCount += 1;
    const window = this.windows.get(request.window_key);
    if (!window || window.status !== 'Open') return { consumed: false };
    const call = request.authoritative_call;
    const matches = [
      'environment_fingerprint', 'client_fingerprint', 'journey_fingerprint',
      'deployment_fingerprint', 'configuration_fingerprint', 'number_fingerprint',
      'route_fingerprint',
    ].every((field) => window[field] === call[field])
      && window.approved_qa_caller_fingerprint === call.qa_caller_fingerprint;
    const nowMs = Date.parse(request.current_time);
    const observedMs = Date.parse(call.observed_at);
    const issuedMs = Date.parse(window.issued_at);
    const expiresMs = Date.parse(window.expires_at);
    if (!matches || nowMs < issuedMs || nowMs >= expiresMs
      || observedMs < issuedMs || observedMs >= expiresMs) return { consumed: false };

    // This compare-and-set and receipt creation are one adapter operation. No preflight read can
    // race another caller into consuming the same server-issued window.
    const closed = { ...window, status: 'Consumed', closed_at: request.current_time };
    this.windows.set(request.window_key, closed);
    const receipt = {
      verification_claim_key: digest('claim', [
        request.window_key, call.actual_call_fingerprint,
      ].join('\0')),
      window_key: request.window_key,
      actual_call_fingerprint: call.actual_call_fingerprint,
      environment_fingerprint: call.environment_fingerprint,
      client_fingerprint: call.client_fingerprint,
      journey_fingerprint: call.journey_fingerprint,
      deployment_fingerprint: call.deployment_fingerprint,
      configuration_fingerprint: call.configuration_fingerprint,
      number_fingerprint: call.number_fingerprint,
      route_fingerprint: call.route_fingerprint,
      approved_qa_caller_fingerprint: call.qa_caller_fingerprint,
      issued_at: window.issued_at,
      expires_at: window.expires_at,
      consumed_at: request.current_time,
    };
    this.receipts.set(receipt.verification_claim_key, structuredClone(receipt));
    return { consumed: true, window: structuredClone(closed), receipt };
  }
}

function service(stores = {}) {
  return createV2CandidateService({
    manifest,
    candidateContract,
    adapterContract,
    notificationStore: stores.notificationStore || new MemoryNotificationStore(),
    verificationStore: stores.verificationStore || new MemoryVerificationStore(),
    clock: stores.clock || { now: () => '2026-08-25T18:00:30.000Z' },
  });
}

function routineInput(overrides = {}) {
  const bound = binding('alpha');
  return {
    execution_mode: 'synthetic_local_candidate',
    route_verification: null,
    binding: bound,
    recipient_fingerprint: bound.recipient_fingerprint,
    handoff_facts: handoffFacts(),
    analysis: analysis(),
    normalized_events: [],
    call_timestamp: '2026-08-25T18:00:00.000Z',
    ...overrides,
  };
}

function verificationWindow(overrides = {}) {
  return {
    window_key: digest('window', 'verification-one'),
    status: 'Open',
    environment_fingerprint: digest('environment', 'development'),
    client_fingerprint: digest('client', 'alpha'),
    journey_fingerprint: digest('journey', 'alpha'),
    deployment_fingerprint: digest('deployment', 'alpha'),
    configuration_fingerprint: digest('configuration', 'alpha'),
    number_fingerprint: digest('number', 'alpha'),
    route_fingerprint: digest('route', 'alpha'),
    approved_qa_caller_fingerprint: digest('qa_caller', 'authorized'),
    issued_at: '2026-08-25T18:00:00.000Z',
    expires_at: '2026-08-25T18:01:00.000Z',
    closed_at: null,
    ...overrides,
  };
}

function authoritativeVerificationCall(window, overrides = {}) {
  return {
    actual_call_fingerprint: digest('call', 'verification-call-one'),
    environment_fingerprint: window.environment_fingerprint,
    client_fingerprint: window.client_fingerprint,
    journey_fingerprint: window.journey_fingerprint,
    deployment_fingerprint: window.deployment_fingerprint,
    configuration_fingerprint: window.configuration_fingerprint,
    number_fingerprint: window.number_fingerprint,
    route_fingerprint: window.route_fingerprint,
    qa_caller_fingerprint: window.approved_qa_caller_fingerprint,
    observed_at: '2026-08-25T18:00:20.000Z',
    ...overrides,
  };
}

function verificationInput(window, call = authoritativeVerificationCall(window)) {
  return {
    execution_mode: 'synthetic_local_candidate',
    route_verification: {
      disposition: 'verified_qa_route',
      window_key: window.window_key,
      authoritative_call: call,
    },
  };
}

test('v2 candidate reuses the public Retell contracts but remains disabled and unwired', () => {
  assert.doesNotThrow(() => assertV2CandidateContracts(
    manifest, candidateContract, adapterContract,
  ));
  assert.equal(manifest.profile.enabled, false);
  assert.deepEqual(manifest.profile.traffic_environments, []);
  assert.equal(manifest.provider_boundary.provider_parser_implemented, false);
  assert.equal(adapterContract.provider_parser.implemented, false);
  assert.equal(adapterContract.provider_parser.importable, false);
  assert.deepEqual(adapterContract.provider_parser.field_mapping, {});
  assert.equal(candidateContract.retell_source_status, 'NOT_READY');
  assert.deepEqual(candidateContract.notification_policy.allowed_fields,
    EXPECTED_NOTIFICATION_FIELDS);
  assert.equal(manifest.route_verification.atomic_store_operation, 'consumeOpenWindow');
  assert.equal(manifest.route_verification.consumed_replay_behavior, 'reject');
  assert.equal(manifest.route_verification.current_time_source, 'injected_server_clock');
  assert.equal(manifest.handoff_evidence.destination_fingerprint_only, true);
  assert.equal(manifest.sensitive_terminal.notification_allowed, false);

  const gatewayRoot = path.resolve(__dirname, '..');
  for (const relative of ['index.js', path.join('lib', 'runtime-boundary.js'),
    path.join('lib', 'runtime-service.js'), path.join('lib', 'job-handler.js')]) {
    assert.doesNotMatch(fs.readFileSync(path.join(gatewayRoot, relative), 'utf8'),
      /call-gap-capture-handoff-v2-candidate|handoff-v2-convergence/);
  }
  const activeRegistry = require('../contracts/capability-profiles.json');
  assert.deepEqual(activeRegistry.profiles.find(({ id }) => id === 'call_gap_monitor_v1'), {
    id: 'call_gap_monitor_v1',
    engagement_type: 'free_test',
    plan_tier: 'none',
    status: 'active',
    enabled: true,
    limit_policy: 'seven_calendar_days_or_25_connected_calls_v1',
    billing_mode: 'none',
    traffic_environments: ['development'],
  });
  assert.equal(activeRegistry.profiles.some(({ id }) => id === 'call_gap_capture_handoff_v2'),
    false, 'the source-only candidate must not enter the active runtime registry');
});

test('handoff convergence is replay-safe, reorder-safe, scoped, and never downgrades Bridged', () => {
  const bound = binding('alpha');
  const normalizedBinding = {
    call_binding_key: bound.call_binding_key,
    client_scope_key: bound.client_scope_key,
    deployment_scope_key: bound.deployment_scope_key,
    configuration_version_key: bound.configuration_version_key,
  };
  const target = digest('target', 'approved-direct-human');
  const started = event(bound, 'transfer_started', 'event_started', 1,
    { target_fingerprint: target });
  const bridged = event(bound, 'transfer_bridged', 'event_bridged', 2,
    { target_fingerprint: target });
  const cancelled = event(bound, 'transfer_cancelled', 'event_cancelled', 3,
    { target_fingerprint: target });
  const base = {
    binding: normalizedBinding,
    initial_state: 'Offered',
    prior_state: 'Offered',
    authoritative_provider_state: 'Failed',
    model_handoff_disposition: 'failure_branch',
  };
  const ordered = convergeHandoffEvidence({
    ...base,
    normalized_events: [started, bridged, bridged, cancelled],
  }, adapterContract, candidateContract);
  const reordered = convergeHandoffEvidence({
    ...base,
    normalized_events: [cancelled, bridged, started, bridged],
  }, adapterContract, candidateContract);
  assert.deepEqual(ordered, reordered);
  assert.deepEqual(ordered, {
    handoff_state: 'Bridged',
    evidence_source: 'structured_transfer_lifecycle_event',
    unique_structured_event_count: 3,
    target_fingerprint: target,
  });
  assert.equal(convergeHandoffEvidence({
    ...base,
    prior_state: 'Bridged',
    normalized_events: [cancelled],
  }, adapterContract, candidateContract).handoff_state, 'Bridged');

  assert.throws(() => convergeHandoffEvidence({
    ...base,
    normalized_events: [started, { ...bridged, event_claim_key: 'event_started' }],
  }, adapterContract, candidateContract), { code: 'V2_EVENT_REPLAY_CONFLICT' });
  assert.throws(() => convergeHandoffEvidence({
    ...base,
    normalized_events: [{ ...started, client_scope_key: 'client_beta' }],
  }, adapterContract, candidateContract), { code: 'V2_EVENT_SCOPE_MISMATCH' });
  assert.throws(() => convergeHandoffEvidence({
    ...base,
    normalized_events: [{ ...started, destination_number: '+15555550199' }],
  }, adapterContract, candidateContract), { code: 'V2_EVENT_INVALID' });
});

test('structured evidence outranks authoritative summaries and model signals cannot claim success', () => {
  const bound = binding('alpha');
  const normalizedBinding = {
    call_binding_key: bound.call_binding_key,
    client_scope_key: bound.client_scope_key,
    deployment_scope_key: bound.deployment_scope_key,
    configuration_version_key: bound.configuration_version_key,
  };
  const failed = event(bound, 'transfer_failed', 'event_failed', 2,
    { failure_reason: 'no_answer', target_fingerprint: digest('target', 'approved') });
  assert.equal(convergeHandoffEvidence({
    binding: normalizedBinding,
    initial_state: 'Offered',
    normalized_events: [failed],
    authoritative_provider_state: 'Bridged',
    model_handoff_disposition: 'attempted',
  }, adapterContract, candidateContract).handoff_state, 'Failed');
  const modelOnly = convergeHandoffEvidence({
    binding: normalizedBinding,
    initial_state: 'Offered',
    normalized_events: [],
    model_handoff_disposition: 'attempted',
  }, adapterContract, candidateContract);
  assert.equal(modelOnly.handoff_state, 'Offered');
  assert.equal(modelOnly.evidence_source, 'unknown');
});

test('routine calls never transfer and create exactly one bounded durable email intent', async () => {
  const notificationStore = new MemoryNotificationStore();
  const runtime = service({ notificationStore });
  const input = routineInput({
    handoff_facts: handoffFacts({
      handoff_enabled: true,
      urgent_handoff_enabled: true,
      caller_transfer_consent: 'accepted',
    }),
  });
  const first = await runtime.processSyntheticNormalizedCall(input);
  const replay = await runtime.processSyntheticNormalizedCall(input);
  assert.equal(first.handoff_eligible, false);
  assert.equal(first.handoff_state, 'NotApplicable');
  assert.equal(first.notification_intent_count, 1);
  assert.equal(first.notification_intent_inserted, true);
  assert.equal(replay.notification_intent_inserted, false);
  assert.equal(notificationStore.rows.size, 1);
  assert.equal(notificationStore.callCount, 2);
  const [intent] = notificationStore.rows.values();
  assert.equal(intent.channel, 'email');
  assert.equal(intent.delivery_state, 'DryRunIntended');
  assert.equal(intent.delivery_claimed, false);
  assert.equal(intent.provider_calls, 0);
  assert.deepEqual(Object.keys(intent.payload), EXPECTED_NOTIFICATION_FIELDS);
  assert.equal(intent.payload.confirmed_callback_number, '+15555550100');
  for (const prohibited of [
    'transcript', 'recording', 'full_address', 'sensitive_data', 'handoff_number',
    'recipient_address', 'provider_call_id', 'private_deployment_id', 'revenue_estimate',
  ]) assert.equal(Object.hasOwn(intent.payload, prohibited), false);
});

test('every actionable transfer disposition still converges on one notification intent', async () => {
  const notificationStore = new MemoryNotificationStore();
  const runtime = service({ notificationStore });
  const bound = binding('urgent');
  const target = digest('target', 'urgent-direct-human');
  const input = routineInput({
    binding: bound,
    recipient_fingerprint: bound.recipient_fingerprint,
    handoff_facts: handoffFacts({
      outcome: 'urgent_potential_job', urgency: 'urgent', handoff_reason: 'urgent',
      handoff_enabled: true, urgent_handoff_enabled: true,
      caller_transfer_consent: 'accepted',
      destination_validity: 'valid', destination_fingerprint: target,
      loop_proof: 'passed',
    }),
    analysis: analysis({
      outcome: 'urgent_potential_job', urgency: 'urgent', handoff_reason: 'urgent',
      handoff_disposition: 'attempted',
    }),
    normalized_events: [
      event(bound, 'transfer_started', 'urgent_started', 1, { target_fingerprint: target }),
      event(bound, 'transfer_bridged', 'urgent_bridged', 2, { target_fingerprint: target }),
    ],
  });
  const result = await runtime.processSyntheticNormalizedCall(input);
  assert.equal(result.handoff_eligible, true);
  assert.equal(result.handoff_state, 'Bridged');
  assert.equal(result.target_fingerprint, target);
  assert.equal(result.notification_intent_count, 1);
  assert.equal(notificationStore.rows.size, 1);
});

test('nonactionable and cross-client recipient cases fail closed without a send path', async () => {
  const notificationStore = new MemoryNotificationStore();
  const runtime = service({ notificationStore });
  const nonactionable = routineInput({
    handoff_facts: handoffFacts({ outcome: 'spam', caller_intent: 'spam' }),
    analysis: analysis({
      outcome: 'spam', caller_intent: 'spam', office_follow_up_required: false,
      bookable_opportunity: false,
    }),
  });
  const result = await runtime.processSyntheticNormalizedCall(nonactionable);
  assert.equal(result.notification_intent_count, 0);
  assert.equal(notificationStore.callCount, 0);
  assert.equal(result.notification_provider_calls, 0);

  await assert.rejects(() => runtime.processSyntheticNormalizedCall(routineInput({
    recipient_fingerprint: digest('recipient', 'beta'),
  })), { code: 'V2_RECIPIENT_SCOPE_MISMATCH' });
  assert.equal(notificationStore.rows.size, 0);
  assert.equal(typeof runtime.send, 'undefined');
  assert.equal(typeof runtime.sendSms, 'undefined');

  await assert.rejects(() => runtime.processSyntheticNormalizedCall(routineInput({
    analysis: analysis({ handoff_disposition: 'failure_branch' }),
  })), { code: 'V2_UNAUTHORIZED_TRANSFER_EVIDENCE' });
});

test('handoff rejects untrusted or inconsistent intent, service, area, and routine evidence', () => {
  const policy = assertV2CandidateContracts(manifest, candidateContract, adapterContract);
  const target = digest('target', 'authoritative-destination');
  for (const [field, value] of [
    ['caller_intent_authority', 'model_guess'],
    ['service_eligibility_authority', 'caller_claim'],
    ['area_eligibility_authority', 'caller_claim'],
    ['destination_authority', 'browser_input'],
    ['loop_proof_authority', 'unchecked'],
  ]) {
    assert.throws(() => decideHandoff(eligibleUrgentHandoffFacts(target, {
      [field]: value,
    }), policy), { code: 'V2_HANDOFF_EVIDENCE_UNTRUSTED' }, field);
  }

  for (const callerIntent of ['vendor', 'spam', 'job_applicant', 'wrong_number', 'sales']) {
    assert.throws(() => decideHandoff(eligibleUrgentHandoffFacts(target, {
      caller_intent: callerIntent,
    }), policy), { code: 'V2_HANDOFF_FACTS_INCONSISTENT' }, callerIntent);
  }
  assert.throws(() => decideHandoff(handoffFacts({
    handoff_reason: 'urgent', handoff_enabled: true, urgent_handoff_enabled: true,
  }), policy), { code: 'V2_HANDOFF_FACTS_INCONSISTENT' });
  assert.throws(() => decideHandoff(eligibleUrgentHandoffFacts(target, {
    service_eligibility: 'unsupported',
  }), policy), { code: 'V2_HANDOFF_FACTS_INCONSISTENT' });
  assert.throws(() => decideHandoff(eligibleUrgentHandoffFacts(target, {
    area_eligibility: 'out_of_area',
  }), policy), { code: 'V2_HANDOFF_FACTS_INCONSISTENT' });
  assert.throws(() => decideHandoff(eligibleUrgentHandoffFacts(target, {
    immediate_danger: 'false',
  }), policy), { code: 'V2_HANDOFF_FACTS_INVALID' });
  assert.throws(() => decideHandoff(handoffFacts({
    caller_intent: 'vendor', outcome: 'spam', handoff_reason: 'urgent',
  }), policy), { code: 'V2_HANDOFF_FACTS_INCONSISTENT' });
});

test('denied intents, unsupported/out-of-area calls, and immediate danger never transfer', () => {
  const policy = assertV2CandidateContracts(manifest, candidateContract, adapterContract);
  const deniedCases = [
    ['vendor', 'spam'],
    ['spam', 'spam'],
    ['wrong_number', 'spam'],
    ['sales', 'spam'],
    ['job_applicant', 'other_general_inquiry'],
  ];
  for (const [callerIntent, outcome] of deniedCases) {
    const decision = decideHandoff(handoffFacts({
      caller_intent: callerIntent, outcome,
    }), policy);
    assert.equal(decision.attempt_allowed, false, callerIntent);
    assert.equal(decision.initial_state, 'NotApplicable', callerIntent);
  }

  for (const facts of [
    handoffFacts({
      outcome: 'unsupported_service', service_eligibility: 'unsupported',
    }),
    handoffFacts({
      outcome: 'out_of_area', area_eligibility: 'out_of_area',
    }),
    handoffFacts({
      outcome: 'unresolved', urgency: 'immediate_danger', immediate_danger: true,
    }),
  ]) {
    const decision = decideHandoff(facts, policy);
    assert.equal(decision.attempt_allowed, false);
    assert.equal(decision.initial_state, 'NotApplicable');
  }
});

test('invalid, missing, looping, or conflicting destinations fail closed before notification', async () => {
  const policy = assertV2CandidateContracts(manifest, candidateContract, adapterContract);
  const approvedTarget = digest('target', 'approved-destination');
  for (const overrides of [
    { destination_validity: 'invalid', destination_fingerprint: null, loop_proof: 'not_required' },
    { destination_validity: 'unknown', destination_fingerprint: null, loop_proof: 'unknown' },
    { destination_validity: 'valid', destination_fingerprint: approvedTarget,
      loop_proof: 'failed' },
  ]) {
    const decision = decideHandoff(eligibleUrgentHandoffFacts(approvedTarget, overrides), policy);
    assert.equal(decision.attempt_allowed, false);
    assert.equal(decision.initial_state, 'NotConfigured');
    assert.equal(decision.rejection_reason, 'destination_not_safe');
  }
  assert.throws(() => decideHandoff(eligibleUrgentHandoffFacts(approvedTarget, {
    destination_fingerprint: '+15555550199',
  }), policy), { code: 'V2_HANDOFF_FACTS_INVALID' });

  const bound = binding('target-conflict');
  const notificationStore = new MemoryNotificationStore();
  await assert.rejects(() => service({ notificationStore }).processSyntheticNormalizedCall(
    routineInput({
      binding: bound,
      recipient_fingerprint: bound.recipient_fingerprint,
      handoff_facts: eligibleUrgentHandoffFacts(approvedTarget),
      analysis: analysis({
        outcome: 'urgent_potential_job', urgency: 'urgent', handoff_reason: 'urgent',
        handoff_disposition: 'attempted',
      }),
      normalized_events: [event(bound, 'transfer_started', 'conflicting_target', 1, {
        target_fingerprint: digest('target', 'different-destination'),
      })],
    }),
  ), { code: 'V2_TARGET_FINGERPRINT_CONFLICT' });
  assert.equal(notificationStore.callCount, 0);
});

test('sensitive-data terminal is minimized and can never create notification content', async () => {
  const notificationStore = new MemoryNotificationStore();
  const sensitiveFacts = handoffFacts({
    outcome: 'sensitive_data_ended',
    urgency: 'unknown',
    caller_intent: 'sensitive_data_attempt',
  });
  const input = routineInput({
    handoff_facts: sensitiveFacts,
    analysis: minimizedSensitiveTerminalAnalysis(),
  });
  const result = await service({ notificationStore }).processSyntheticNormalizedCall(input);
  assert.equal(result.handoff_eligible, false);
  assert.equal(result.notification_intent_count, 0);
  assert.equal(notificationStore.callCount, 0);

  await assert.rejects(() => service({ notificationStore })
    .processSyntheticNormalizedCall({
      ...input,
      analysis: minimizedSensitiveTerminalAnalysis({
        caller_name: 'Must Not Survive',
        issue_summary: 'Must not enter a notification.',
      }),
    }), { code: 'V2_SENSITIVE_TERMINAL_NOT_MINIMIZED' });
  assert.equal(notificationStore.callCount, 0);

  // A hostile actionable classification cannot retain content merely by setting the
  // sensitive-data flag; the flag and minimized terminal outcome are one contract.
  await assert.rejects(() => service({ notificationStore })
    .processSyntheticNormalizedCall(routineInput({
      analysis: analysis({
        sensitive_data_detected: true,
        issue_summary: 'Synthetic content that must never be persisted.',
      }),
    })), { code: 'V2_SENSITIVE_TERMINAL_NOT_MINIMIZED' });
  await assert.rejects(() => service({ notificationStore })
    .processSyntheticNormalizedCall({
      ...input,
      analysis: minimizedSensitiveTerminalAnalysis({ sensitive_data_detected: false }),
    }), { code: 'V2_SENSITIVE_TERMINAL_NOT_MINIMIZED' });
  assert.equal(notificationStore.callCount, 0);
});

test('route verification atomically consumes and closes one authoritative open window', async () => {
  const notificationStore = new MemoryNotificationStore();
  const window = verificationWindow();
  const verificationStore = new MemoryVerificationStore([window]);
  const runtime = service({ notificationStore, verificationStore });
  const verificationOnly = verificationInput(window);
  const result = await runtime.processSyntheticNormalizedCall(verificationOnly);
  assert.deepEqual(result, {
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
  assert.equal(verificationStore.windows.get(window.window_key).status, 'Consumed');
  assert.equal(verificationStore.windows.get(window.window_key).closed_at,
    '2026-08-25T18:00:30.000Z');
  assert.equal(verificationStore.receipts.size, 1);
  assert.equal(notificationStore.callCount, 0);

  // Even byte-identical replay is rejected; verification receipts are not idempotent entry
  // tickets and a consumed window can never succeed twice.
  await assert.rejects(() => runtime.processSyntheticNormalizedCall(verificationOnly),
    { code: 'V2_ROUTE_VERIFICATION_CONSUME_REJECTED' });
});

test('route verification rejects every actual-call and server-window binding mismatch', async () => {
  const mismatchFields = [
    'environment_fingerprint', 'client_fingerprint', 'journey_fingerprint',
    'deployment_fingerprint', 'configuration_fingerprint', 'number_fingerprint',
    'route_fingerprint', 'qa_caller_fingerprint',
  ];
  for (const field of mismatchFields) {
    const window = verificationWindow();
    const store = new MemoryVerificationStore([window]);
    const call = authoritativeVerificationCall(window, {
      [field]: digest(field.replace(/_fingerprint$/, ''), `hostile-${field}`),
    });
    await assert.rejects(() => service({ verificationStore: store })
      .processSyntheticNormalizedCall(verificationInput(window, call)),
    { code: 'V2_ROUTE_VERIFICATION_CONSUME_REJECTED' }, field);
    assert.equal(store.windows.get(window.window_key).status, 'Open', field);
    assert.equal(store.receipts.size, 0, field);
  }

  const missingWindow = verificationWindow();
  await assert.rejects(() => service().processSyntheticNormalizedCall(
    verificationInput(missingWindow),
  ), { code: 'V2_ROUTE_VERIFICATION_CONSUME_REJECTED' });
});

test('route verification requires canonical current time, fresh call evidence, and open bounds', async () => {
  const window = verificationWindow();
  const invalidClockStore = new MemoryVerificationStore([window]);
  await assert.rejects(() => service({
    verificationStore: invalidClockStore,
    clock: { now: () => 'not-a-canonical-time' },
  }).processSyntheticNormalizedCall(verificationInput(window)),
  { code: 'V2_ROUTE_VERIFICATION_CLOCK_INVALID' });
  assert.equal(invalidClockStore.callCount, 0);

  const staleStore = new MemoryVerificationStore([window]);
  await assert.rejects(() => service({
    verificationStore: staleStore,
    clock: { now: () => '2026-08-25T18:00:55.000Z' },
  }).processSyntheticNormalizedCall(verificationInput(window,
    authoritativeVerificationCall(window, { observed_at: '2026-08-25T18:00:20.000Z' }))),
  { code: 'V2_ROUTE_VERIFICATION_CALL_STALE' });
  assert.equal(staleStore.callCount, 0);

  const expiredStore = new MemoryVerificationStore([window]);
  await assert.rejects(() => service({
    verificationStore: expiredStore,
    clock: { now: () => '2026-08-25T18:01:00.000Z' },
  }).processSyntheticNormalizedCall(verificationInput(window,
    authoritativeVerificationCall(window, { observed_at: '2026-08-25T18:00:50.000Z' }))),
  { code: 'V2_ROUTE_VERIFICATION_CONSUME_REJECTED' });
  assert.equal(expiredStore.windows.get(window.window_key).status, 'Open');
});

test('concurrent route-verification attempts yield one consume and one rejected replay', async () => {
  const window = verificationWindow();
  const store = new MemoryVerificationStore([window]);
  const runtime = service({ verificationStore: store });
  const input = verificationInput(window);
  const results = await Promise.allSettled([
    runtime.processSyntheticNormalizedCall(input),
    runtime.processSyntheticNormalizedCall(input),
  ]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejected = results.find(({ status }) => status === 'rejected');
  assert.equal(rejected.reason.code, 'V2_ROUTE_VERIFICATION_CONSUME_REJECTED');
  assert.equal(store.receipts.size, 1);
  assert.equal(store.windows.get(window.window_key).status, 'Consumed');
});

test('route verification and v2 evaluation reject unrecognized or nonlocal entry modes', async () => {
  const window = verificationWindow();
  await assert.rejects(() => service({
    verificationStore: new MemoryVerificationStore([window]),
  }).processSyntheticNormalizedCall({
    ...verificationInput(window),
    route_verification: {
      ...verificationInput(window).route_verification,
      disposition: 'caller_claimed_verified',
    },
  }), { code: 'V2_ROUTE_VERIFICATION_INVALID' });
  await assert.rejects(() => service().processSyntheticNormalizedCall({
    ...routineInput(), execution_mode: 'development',
  }), { code: 'V2_CANDIDATE_DISABLED' });
});

test('candidate evaluation makes zero network calls', async () => {
  let attempts = 0;
  const blocked = () => {
    attempts += 1;
    throw new Error('network disabled in v2 candidate test');
  };
  const originals = {
    netConnect: net.connect,
    netCreateConnection: net.createConnection,
    httpRequest: http.request,
    httpsRequest: https.request,
    fetch: global.fetch,
  };
  net.connect = blocked;
  net.createConnection = blocked;
  http.request = blocked;
  https.request = blocked;
  global.fetch = blocked;
  try {
    const result = await service().processSyntheticNormalizedCall(routineInput());
    assert.equal(result.notification_provider_calls, 0);
  } finally {
    net.connect = originals.netConnect;
    net.createConnection = originals.netCreateConnection;
    http.request = originals.httpRequest;
    https.request = originals.httpsRequest;
    global.fetch = originals.fetch;
  }
  assert.equal(attempts, 0);
  assert.deepEqual(candidateContract.local_test_boundary.guarded_node_surfaces, [
    'net.connect', 'net.createConnection', 'http.request', 'https.request',
    'global.fetch', 'undici.request',
  ]);
});

test('notification projection rejects invalid fields and remains the exact public ten-field map', () => {
  const policy = assertV2CandidateContracts(manifest, candidateContract, adapterContract);
  assert.deepEqual(Object.keys(notificationPayload(
    analysis(), 'NotApplicable', '2026-08-25T18:00:00.000Z', policy,
  )), EXPECTED_NOTIFICATION_FIELDS);
  assert.throws(() => notificationPayload(
    analysis({ customer_type: 'invented' }),
    'NotApplicable',
    '2026-08-25T18:00:00.000Z',
    policy,
  ), { code: 'V2_NOTIFICATION_FIELD_INVALID' });
  assert.throws(() => notificationPayload(
    { ...analysis(), transcript: 'prohibited' },
    'NotApplicable',
    '2026-08-25T18:00:00.000Z',
    policy,
  ), { code: 'V2_NOTIFICATION_FIELD_INVALID' });
  assert.throws(() => decideHandoff({
    ...handoffFacts(), handoff_number: '+15555550199',
  }, policy), { code: 'V2_HANDOFF_FACTS_INVALID' });
  assert.deepEqual(decideHandoff(handoffFacts({
    handoff_enabled: true,
    urgent_handoff_enabled: true,
    caller_transfer_consent: 'accepted',
  }), policy), {
    eligible: false,
    attempt_allowed: false,
    initial_state: 'NotApplicable',
    rejection_reason: 'policy_ineligible',
  });
});
