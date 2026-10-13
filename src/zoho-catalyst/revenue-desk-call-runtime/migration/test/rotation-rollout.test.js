'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { initialState, apply } = require('./support/rotation-rollout-model');

// Invented metadata only: these fixtures cannot authenticate, change a
// configuration, prove a live observation, or authorize a provider operation.
const SENDER = 'revenue_desk_call_worker';
const RECEIVER = 'crm_billing_orchestrator';
const PHASES = [
  'quiesced', 'receiver_acknowledged', 'sender_acknowledged', 'ready',
  'old_acceptance_disabled', 'retired',
];

function plan(oldStatus = 'ordinary') {
  return {
    purpose: 'report_header_authentication', strategy: 'quiesced_single_key',
    epoch: 7, oldVersion: 11, newVersion: 12, oldStatus,
    consumers: [
      { consumer: SENDER, role: 'report_sender', variable: 'CRM_BILLING_SHARED_HEADER_VALUE',
        oldSource: 'synthetic-sender-old', newSource: 'synthetic-sender-new',
        oldConfigurationGeneration: 21, newConfigurationGeneration: 22 },
      { consumer: RECEIVER, role: 'report_receiver', variable: 'REPORT_SUMMARY_HEADER_VALUE',
        oldSource: 'synthetic-receiver-old', newSource: 'synthetic-receiver-new',
        oldConfigurationGeneration: 31, newConfigurationGeneration: 32 },
    ],
  };
}

function ack(consumer, phase, checks) {
  const sender = consumer === SENDER;
  const oldConfiguration = phase === 'quiesced';
  return {
    consumer, role: sender ? 'report_sender' : 'report_receiver',
    version: ['quiesced', 'retired'].includes(phase) ? 11 : 12,
    source: `synthetic-${sender ? 'sender' : 'receiver'}-${oldConfiguration ? 'old' : 'new'}`,
    epoch: 7, phase,
    configurationGeneration: (sender ? 21 : 31) + (oldConfiguration ? 0 : 1),
    checks,
  };
}

function evidence(phase) {
  const checks = {
    quiesced: [
      [SENDER, { dispatch: 'contained', inFlight: 'reconciled' }],
      [RECEIVER, { mutations: 'contained', inFlight: 'reconciled' }],
    ],
    receiver_acknowledged: [[RECEIVER, { acceptance: 'new_only', readback: 'confirmed' }]],
    sender_acknowledged: [[SENDER, { emission: 'new_only', readback: 'confirmed' }]],
    ready: [[RECEIVER, {
      newAuthentication: 'passed', oldAuthentication: 'rejected',
      reportToPaidAuthentication: 'rejected', paidToReportAuthentication: 'rejected',
    }]],
    old_acceptance_disabled: [
      [SENDER, { oldUse: 'disabled', readback: 'confirmed' }],
      [RECEIVER, { oldAcceptance: 'disabled', readback: 'confirmed' }],
    ],
    retired: [
      [SENDER, { oldMaterial: 'retired', revocation: 'confirmed', readback: 'confirmed' }],
      [RECEIVER, { oldMaterial: 'retired', revocation: 'confirmed', readback: 'confirmed' }],
    ],
  };
  return { phase, epoch: 7, acknowledgements: checks[phase].map(([consumer, values]) => ack(consumer, phase, values)) };
}

function accepted(state, command) {
  const before = structuredClone(state);
  const commandBefore = structuredClone(command);
  const result = apply(state, state.revision, command);
  assert.equal(result.outcome, 'evidence_recorded');
  assert.equal(result.liveAuthority, false);
  assert.deepEqual(Object.keys(result).sort(), ['liveAuthority', 'outcome', 'state']);
  assert.notStrictEqual(result.state, state);
  assert.deepEqual(state, before, 'accepted evidence must not mutate the previous state');
  assert.deepEqual(command, commandBefore, 'accepted evidence must not mutate caller input');
  assert.equal(result.state.revision, state.revision + 1);
  assert.equal(result.state.phase, command.phase);
  return result.state;
}

function beforePhase(phase, oldStatus = 'ordinary') {
  let state = initialState(plan(oldStatus));
  for (const next of PHASES.slice(0, PHASES.indexOf(phase))) state = accepted(state, evidence(next));
  return state;
}

function rejected(state, command, outcome = 'invalid_evidence', revision = state.revision) {
  const before = structuredClone(state);
  const result = apply(state, revision, command);
  assert.equal(result.outcome, outcome);
  assert.strictEqual(result.state, state, 'rejection must return the identical state');
  assert.deepEqual(state, before, 'rejection must leave all state unchanged');
  assert.equal(result.liveAuthority, false);
  assert.deepEqual(Object.keys(result).sort(), ['liveAuthority', 'outcome', 'state']);
  return result;
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(assertDeepFrozen);
}

test('ordinary and compromised plans complete the same contained single-key evidence sequence', () => {
  for (const oldStatus of ['ordinary', 'compromised']) {
    let state = initialState(plan(oldStatus));
    assert.equal(state.phase, 'planned');
    for (const phase of PHASES) {
      state = accepted(state, evidence(phase));
      assertDeepFrozen(state);
    }
    assert.equal(state.phase, 'retired');
    assert.equal(state.evidence.length, 6);
    rejected(state, evidence('retired'), 'terminal_state');
    rejected(state, { phase: 'activate' }, 'terminal_state');
  }
});

test('readiness precedes explicit old-use disablement and retirement and grants no activation', () => {
  const ready = accepted(beforePhase('ready'), evidence('ready'));
  assert.equal(ready.phase, 'ready');
  assert.equal(ready.evidence.length, 4);
  assert.equal(ready.evidence.some((entry) => entry.phase === 'retired'), false);
  rejected(ready, evidence('retired'));
  const disabled = accepted(ready, evidence('old_acceptance_disabled'));
  assert.equal(disabled.phase, 'old_acceptance_disabled');
  const retired = accepted(disabled, evidence('retired'));
  assert.equal(ready.phase, 'ready', 'later evidence cannot retroactively retire an earlier state');
  assert.equal(retired.phase, 'retired');
});

test('both consumers must report contained dispatch or mutations and reconciled in-flight outcomes', () => {
  const state = initialState(plan());
  for (let consumer = 0; consumer < 2; consumer += 1) {
    for (const value of ['processing', 'unknown', 'failed', 'partially_reconciled']) {
      const command = evidence('quiesced');
      command.acknowledgements[consumer].checks.inFlight = value;
      rejected(state, command);
    }
    const command = evidence('quiesced');
    command.acknowledgements[consumer].checks[consumer === 0 ? 'dispatch' : 'mutations'] = 'active';
    rejected(state, command);
  }
});

test('receiver new-only acknowledgement must precede sender new-only acknowledgement', () => {
  const quiesced = beforePhase('receiver_acknowledged');
  rejected(quiesced, evidence('sender_acknowledged'));
  for (const phase of ['receiver_acknowledged', 'sender_acknowledged']) {
    const state = beforePhase(phase);
    const field = phase === 'receiver_acknowledged' ? 'acceptance' : 'emission';
    for (const value of ['old_only', 'old_and_new', 'unknown']) {
      const command = evidence(phase);
      command.acknowledgements[0].checks[field] = value;
      rejected(state, command);
    }
  }
});

test('readiness requires new authentication, old rejection, and both cross-purpose rejections', () => {
  const state = beforePhase('ready');
  for (const field of ['newAuthentication', 'oldAuthentication', 'reportToPaidAuthentication', 'paidToReportAuthentication']) {
    const missing = evidence('ready');
    delete missing.acknowledgements[0].checks[field];
    rejected(state, missing);
    for (const value of ['unknown', 'failed', 'ambiguous', field === 'newAuthentication' ? 'rejected' : 'passed']) {
      const command = evidence('ready');
      command.acknowledgements[0].checks[field] = value;
      rejected(state, command);
    }
  }
});

test('every stage rejects missing, duplicate, conflicting, and unknown-consumer acknowledgements atomically', () => {
  for (const phase of PHASES) {
    const state = beforePhase(phase);
    const omitted = evidence(phase);
    omitted.acknowledgements.pop();
    rejected(state, omitted);
    const duplicate = evidence(phase);
    duplicate.acknowledgements.push(structuredClone(duplicate.acknowledgements[0]));
    rejected(state, duplicate);
    const conflict = structuredClone(duplicate);
    conflict.acknowledgements.at(-1).version += 1;
    rejected(state, conflict);
    const unknown = evidence(phase);
    unknown.acknowledgements[0].consumer = 'synthetic-unregistered-consumer';
    rejected(state, unknown);
    if (evidence(phase).acknowledgements.length === 2) {
      const replacement = evidence(phase);
      replacement.acknowledgements[1] = structuredClone(replacement.acknowledgements[0]);
      rejected(state, replacement);
      replacement.acknowledgements[1].source = 'synthetic-conflicting-source';
      rejected(state, replacement);
    }
  }
});

test('every acknowledgement binds its exact role, version, source, epoch, phase, and configuration generation', () => {
  for (const phase of PHASES) {
    const state = beforePhase(phase);
    for (let index = 0; index < evidence(phase).acknowledgements.length; index += 1) {
      const original = evidence(phase).acknowledgements[index];
      const mutations = {
        role: original.role === 'report_sender' ? 'report_receiver' : 'report_sender',
        version: original.version === 11 ? 12 : 11,
        source: 'synthetic-stale-source', epoch: 6, phase: 'planned',
        configurationGeneration: original.configurationGeneration - 1,
      };
      for (const [field, value] of Object.entries(mutations)) {
        const command = evidence(phase);
        command.acknowledgements[index][field] = value;
        rejected(state, command);
        const missing = evidence(phase);
        delete missing.acknowledgements[index][field];
        rejected(state, missing);
      }
    }
    const wrongEpoch = evidence(phase);
    wrongEpoch.epoch = 8;
    rejected(state, wrongEpoch);
    const stalePhase = evidence(phase);
    stalePhase.phase = 'planned';
    rejected(state, stalePhase);
  }
});

test('missing, failed, contradictory, and extra checks never partly advance a stage', () => {
  for (const phase of PHASES) {
    const state = beforePhase(phase);
    for (let index = 0; index < evidence(phase).acknowledgements.length; index += 1) {
      for (const field of Object.keys(evidence(phase).acknowledgements[index].checks)) {
        for (const value of [undefined, null, false, 'failed', ['passed', 'failed']]) {
          const command = evidence(phase);
          command.acknowledgements[index].checks[field] = value;
          rejected(state, command);
        }
        const missing = evidence(phase);
        delete missing.acknowledgements[index].checks[field];
        rejected(state, missing);
      }
      const contradictory = evidence(phase);
      contradictory.acknowledgements[index].checks.conflictingReadback = true;
      rejected(state, contradictory);
    }
  }
});

test('retirement requires explicit old material revocation on both new configuration generations', () => {
  const state = beforePhase('retired');
  for (let index = 0; index < 2; index += 1) {
    for (const revocation of ['pending', 'ambiguous', 'requested', 'not_required', 'failed']) {
      const command = evidence('retired');
      command.acknowledgements[index].checks.revocation = revocation;
      rejected(state, command);
    }
    const oldConfiguration = evidence('retired');
    oldConfiguration.acknowledgements[index].source = plan().consumers[index].oldSource;
    oldConfiguration.acknowledgements[index].configurationGeneration -= 1;
    rejected(state, oldConfiguration);
    const newMaterial = evidence('retired');
    newMaterial.acknowledgements[index].version = 12;
    rejected(state, newMaterial);
  }
});

test('compromised-old overlap, rollback, resume, and activation have no accepted command or strategy', () => {
  for (const strategy of ['overlap', 'dual_key', 'rollback', 'activate']) {
    assert.throws(() => initialState({ ...plan('compromised'), strategy }), TypeError);
  }
  for (const phase of PHASES) {
    const state = beforePhase(phase, 'compromised');
    for (const forbidden of ['activate', 'resume', 'rollback', 'overlap']) {
      rejected(state, { ...evidence(phase), phase: forbidden });
      rejected(state, { ...evidence(phase), [forbidden]: true });
    }
  }
  const receiver = beforePhase('receiver_acknowledged', 'compromised');
  const overlap = evidence('receiver_acknowledged');
  overlap.acknowledgements[0].checks.acceptance = 'old_and_new';
  rejected(receiver, overlap);
  const sender = beforePhase('sender_acknowledged', 'compromised');
  const rollback = evidence('sender_acknowledged');
  rollback.acknowledgements[0].checks.emission = 'old_only';
  rejected(sender, rollback);
});

test('all earlier or later stages and replayed acknowledgements reject without changing state', () => {
  for (const phase of PHASES) {
    const state = beforePhase(phase);
    for (const other of PHASES.filter((candidate) => candidate !== phase)) rejected(state, evidence(other));
  }
});

test('revision checks reject stale concurrent evidence and malformed revisions', () => {
  const initial = initialState(plan());
  const command = evidence('quiesced');
  const advanced = accepted(initial, command);
  rejected(advanced, command, 'stale_revision', initial.revision);
  for (const revision of [null, undefined, '1', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    // Call directly for undefined so the helper default cannot replace it.
    const result = apply(advanced, revision, evidence('receiver_acknowledged'));
    assert.equal(result.outcome, 'invalid_input');
    assert.strictEqual(result.state, advanced);
    assert.equal(result.liveAuthority, false);
  }
  rejected(advanced, evidence('receiver_acknowledged'), 'stale_revision', 2);
});

test('plans exclude unknown or identity-coupled roles and bind the report-only pair exactly', () => {
  for (let index = 0; index < 2; index += 1) {
    for (const role of ['canonical_claim', 'lookup_index', 'paid_sender', 'paid_receiver', 'report_sender_and_identity']) {
      const invalid = plan();
      invalid.consumers[index].role = role;
      assert.throws(() => initialState(invalid), TypeError);
    }
    for (const variable of ['SYNTHETIC_IDENTITY_HMAC_KEY', 'SYNTHETIC_PAID_HEADER_VALUE', plan().consumers[1 - index].variable]) {
      const invalid = plan();
      invalid.consumers[index].variable = variable;
      assert.throws(() => initialState(invalid), TypeError);
    }
  }
  const duplicate = plan();
  duplicate.consumers[1] = structuredClone(duplicate.consumers[0]);
  assert.throws(() => initialState(duplicate), TypeError);
  const unknown = plan();
  unknown.consumers[0].consumer = 'synthetic-unregistered-consumer';
  assert.throws(() => initialState(unknown), TypeError);
});

test('malformed plans, non-increasing versions or configuration generations, and extra fields fail closed', () => {
  for (const invalid of [null, {}, [], { ...plan(), purpose: 'identity_rotation' },
    { ...plan(), oldStatus: 'unknown' }, { ...plan(), consumers: [] }, { ...plan(), activate: true }]) {
    assert.throws(() => initialState(invalid), TypeError);
  }
  for (const field of Object.keys(plan())) {
    const missing = plan();
    delete missing[field];
    assert.throws(() => initialState(missing), TypeError);
  }
  for (const field of ['epoch', 'oldVersion', 'newVersion']) {
    for (const value of [0, -1, 1.5, '7', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => initialState({ ...plan(), [field]: value }), TypeError);
    }
  }
  for (const newVersion of [10, 11]) assert.throws(() => initialState({ ...plan(), newVersion }), TypeError);
  for (const field of Object.keys(plan().consumers[0])) {
    const missing = plan();
    delete missing.consumers[0][field];
    assert.throws(() => initialState(missing), TypeError);
  }
  for (const field of ['oldSource', 'newSource']) {
    for (const value of ['', 'unclassified-source', null]) {
      const invalid = plan();
      invalid.consumers[0][field] = value;
      assert.throws(() => initialState(invalid), TypeError);
    }
  }
  for (const generation of [0, 20, 21, '22', 22.5, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = plan();
    invalid.consumers[0].newConfigurationGeneration = generation;
    assert.throws(() => initialState(invalid), TypeError);
  }
});

test('forged phase, revision, missing prefix, or altered historical evidence cannot bypass prior stages', () => {
  const ready = beforePhase('old_acceptance_disabled');
  for (const invalid of [
    { ...ready, revision: 6, phase: 'retired' },
    { ...ready, phase: 'retired' },
    { ...ready, evidence: [] },
    { ...ready, evidence: ready.evidence.slice(1) },
    { ...ready, liveAuthority: true },
  ]) rejected(invalid, evidence('old_acceptance_disabled'), 'invalid_input');
  for (let index = 0; index < ready.evidence.length; index += 1) {
    const invalid = structuredClone(ready);
    invalid.evidence[index].acknowledgements[0].epoch = 6;
    rejected(invalid, evidence('old_acceptance_disabled'), 'invalid_input');
  }
  const changedPlan = structuredClone(ready);
  changedPlan.plan.consumers[0].newConfigurationGeneration += 1;
  rejected(changedPlan, evidence('old_acceptance_disabled'), 'invalid_input');
  for (const invalid of [null, {}, [], { ...ready, revision: -1 }]) {
    rejected(invalid, evidence('old_acceptance_disabled'), 'invalid_input', 4);
  }
});

test('malformed evidence, sparse acknowledgement arrays, and extra properties fail closed', () => {
  const state = initialState(plan());
  for (const command of [null, {}, [], { ...evidence('quiesced'), extra: true },
    { ...evidence('quiesced'), acknowledgements: new Array(2) },
    { ...evidence('quiesced'), acknowledgements: [null, null] }]) rejected(state, command);
  for (const field of ['phase', 'epoch', 'acknowledgements']) {
    const command = evidence('quiesced');
    delete command[field];
    rejected(state, command);
  }
  const extraAck = evidence('quiesced');
  extraAck.acknowledgements[0].activate = true;
  rejected(state, extraAck);
  const extraArray = evidence('quiesced');
  extraArray.acknowledgements.extra = true;
  rejected(state, extraArray);
  const sparsePlan = plan();
  sparsePlan.consumers = new Array(2);
  assert.throws(() => initialState(sparsePlan), TypeError);
  rejected({ ...state, evidence: new Array(1), revision: 1, phase: 'quiesced' }, evidence('receiver_acknowledged'), 'invalid_input');
});

test('accessor metadata is rejected without evaluating caller getters', () => {
  let getterCalls = 0;
  const accessor = { enumerable: true, get() { getterCalls += 1; return 'synthetic-untrusted'; } };
  const invalidPlan = plan();
  Object.defineProperty(invalidPlan.consumers[0], 'newSource', accessor);
  assert.throws(() => initialState(invalidPlan), TypeError);
  const state = initialState(plan());
  for (const path of ['phase', 'ack', 'check', 'array']) {
    const command = evidence('quiesced');
    if (path === 'phase') Object.defineProperty(command, 'phase', accessor);
    if (path === 'ack') Object.defineProperty(command.acknowledgements[0], 'source', accessor);
    if (path === 'check') Object.defineProperty(command.acknowledgements[0].checks, 'inFlight', accessor);
    if (path === 'array') Object.defineProperty(command.acknowledgements, '0', accessor);
    rejected(state, command);
  }
  const invalidState = { ...state };
  Object.defineProperty(invalidState, 'phase', accessor);
  const result = apply(invalidState, 0, evidence('quiesced'));
  assert.equal(result.outcome, 'invalid_input');
  assert.strictEqual(result.state, invalidState);
  assert.equal(result.liveAuthority, false);
  assert.equal(getterCalls, 0);
});

test('nonenumerable metadata and altered array prototypes cannot bypass validation or copying', () => {
  const hiddenPlan = plan();
  Object.defineProperty(hiddenPlan, 'epoch', { value: 7, enumerable: false });
  assert.throws(() => initialState(hiddenPlan), TypeError);
  const state = initialState(plan());
  for (const target of ['envelope', 'ack', 'check', 'array']) {
    const command = evidence('quiesced');
    if (target === 'envelope') Object.defineProperty(command, 'epoch', { value: 7, enumerable: false });
    if (target === 'ack') Object.defineProperty(command.acknowledgements[0], 'epoch', { value: 7, enumerable: false });
    if (target === 'check') Object.defineProperty(command.acknowledgements[0].checks, 'inFlight', { value: 'reconciled', enumerable: false });
    if (target === 'array') Object.defineProperty(command.acknowledgements, '0', { value: command.acknowledgements[0], enumerable: false });
    rejected(state, command);
  }
  let methodCalls = 0;
  class CallerArray extends Array {
    every() { methodCalls += 1; return true; }
    map() { methodCalls += 1; return []; }
  }
  for (const convert of [
    (values) => CallerArray.from(values),
    (values) => Object.setPrototypeOf(values, { ...Array.prototype, every() { methodCalls += 1; return true; } }),
  ]) {
    const invalidPlan = plan();
    invalidPlan.consumers = convert(invalidPlan.consumers);
    assert.throws(() => initialState(invalidPlan), TypeError);
    const command = evidence('quiesced');
    command.acknowledgements = convert(command.acknowledgements);
    rejected(state, command);
  }
  assert.equal(methodCalls, 0);
});

test('accepted plans and evidence are recursively copied and frozen without freezing caller inputs', () => {
  const inputPlan = plan();
  const originalPlan = structuredClone(inputPlan);
  const initial = initialState(inputPlan);
  assertDeepFrozen(initial);
  assert.deepEqual(inputPlan, originalPlan);
  assert.equal(Object.isFrozen(inputPlan), false);
  assert.equal(Object.isFrozen(inputPlan.consumers[0]), false);
  inputPlan.consumers[0].newSource = 'synthetic-mutated-input';
  assert.equal(initial.plan.consumers[0].newSource, 'synthetic-sender-new');
  const command = evidence('quiesced');
  const quiesced = accepted(initial, command);
  assert.equal(Object.isFrozen(command.acknowledgements[0].checks), false);
  command.acknowledgements[0].checks.inFlight = 'unreconciled';
  assert.equal(quiesced.evidence[0].acknowledgements[0].checks.inFlight, 'reconciled');
  const next = accepted(quiesced, evidence('receiver_acknowledged'));
  assert.notStrictEqual(next.plan, quiesced.plan);
  assert.notStrictEqual(next.evidence[0], quiesced.evidence[0]);
  assert.notStrictEqual(next.evidence[0].acknowledgements[0].checks, quiesced.evidence[0].acknowledgements[0].checks);
  assertDeepFrozen(next);
  assert.throws(() => { next.plan.consumers[0].role = 'canonical_claim'; }, TypeError);
  assert.throws(() => { next.evidence[0].acknowledgements[0].checks.dispatch = 'active'; }, TypeError);
});
