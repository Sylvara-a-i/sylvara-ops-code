'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRehearsal } = require('./support/rotation-recovery-rehearsal');

const SENDER = 'revenue_desk_call_worker';
const RECEIVER = 'crm_billing_orchestrator';
const PHASES = [
  'quiesced', 'receiver_acknowledged', 'sender_acknowledged', 'ready',
  'old_acceptance_disabled', 'retired',
];
const CANARY = 'synthetic-private-canary';
const CHECKS = [
  [[SENDER, { dispatch: 'contained', inFlight: 'reconciled' }],
    [RECEIVER, { mutations: 'contained', inFlight: 'reconciled' }]],
  [[RECEIVER, { acceptance: 'new_only', readback: 'confirmed' }]],
  [[SENDER, { emission: 'new_only', readback: 'confirmed' }]],
  [[RECEIVER, { newAuthentication: 'passed', oldAuthentication: 'rejected',
    reportToPaidAuthentication: 'rejected', paidToReportAuthentication: 'rejected' }]],
  [[SENDER, { oldUse: 'disabled', readback: 'confirmed' }],
    [RECEIVER, { oldAcceptance: 'disabled', readback: 'confirmed' }]],
  [[SENDER, { oldMaterial: 'retired', revocation: 'confirmed', readback: 'confirmed' }],
    [RECEIVER, { oldMaterial: 'retired', revocation: 'confirmed', readback: 'confirmed' }]],
];

function plan(oldStatus = 'ordinary') {
  return {
    purpose: 'report_header_authentication', strategy: 'quiesced_single_key',
    epoch: 7, oldVersion: 11, newVersion: 12, oldStatus,
    consumers: [
      [SENDER, 'report_sender', 'CRM_BILLING_SHARED_HEADER_VALUE'],
      [RECEIVER, 'report_receiver', 'REPORT_SUMMARY_HEADER_VALUE'],
    ].map(([consumer, role, variable], index) => ({
      consumer, role, variable,
      oldSource: `${CANARY}-old-${index}`, newSource: `${CANARY}-new-${index}`,
      oldConfigurationGeneration: 21, newConfigurationGeneration: 22,
    })),
  };
}

function evidence(phase) {
  return {
    phase, epoch: 7,
    acknowledgements: CHECKS[PHASES.indexOf(phase)].map(([consumer, checks]) => ({
      consumer, role: consumer === SENDER ? 'report_sender' : 'report_receiver',
      version: ['quiesced', 'retired'].includes(phase) ? 11 : 12,
      source: `${CANARY}-${phase === 'quiesced' ? 'old' : 'new'}-${consumer === SENDER ? 0 : 1}`,
      epoch: 7, phase, configurationGeneration: phase === 'quiesced' ? 21 : 22,
      checks: { ...checks },
    })),
  };
}

function status(value, outcome, phase, recovery = 'clear') {
  assert.deepEqual(value, { outcome, phase, recovery, liveAuthority: false });
  assert.ok(Object.isFrozen(value));
  assert.ok(!JSON.stringify(value).includes(CANARY));
  return value;
}

function before(phase, oldStatus = 'ordinary') {
  const rehearsal = createRehearsal(plan(oldStatus));
  for (const previous of PHASES.slice(0, PHASES.indexOf(phase))) {
    status(rehearsal.advance(evidence(previous)), 'evidence_recorded', previous);
  }
  return rehearsal;
}

const previousPhase = (phase) => PHASES[PHASES.indexOf(phase) - 1] || 'planned';
const observation = (phase, outcome = 'ambiguous') => ({ phase, epoch: 7, outcome });

test('recorded failure or ambiguity at every phase holds ordinary and compromised attempts', () => {
  for (const oldStatus of ['ordinary', 'compromised']) {
    for (const phase of PHASES) {
      for (const cause of ['failed', 'ambiguous']) {
        const rehearsal = before(phase, oldStatus);
        const heldPhase = previousPhase(phase);
        status(rehearsal.observe(observation(phase, cause)), 'reconciliation_required', heldPhase, cause);
        for (const candidate of PHASES) {
          status(rehearsal.advance(evidence(candidate)), 'reconciliation_required', heldPhase, cause);
        }
        status(rehearsal.status(), 'status', heldPhase, cause);
        status(rehearsal.reconcile(evidence(phase)), 'reconciled', phase);
      }
    }
  }
});

test('rejected evidence alone is distinct from a recorded operational failure', () => {
  for (const phase of PHASES) {
    const rehearsal = before(phase);
    const failed = evidence(phase);
    const checks = failed.acknowledgements[0].checks;
    checks[Object.keys(checks)[0]] = 'failed';
    status(rehearsal.advance(failed), 'invalid_evidence', previousPhase(phase));
    status(rehearsal.reconcile(evidence(phase)), 'reconciliation_not_required', previousPhase(phase));
    status(rehearsal.observe(observation(phase, 'failed')), 'reconciliation_required', previousPhase(phase), 'failed');
    status(rehearsal.reconcile(failed), 'invalid_evidence', previousPhase(phase), 'failed');
  }
});

test('partial receiver and sender updates and lost responses require exact independent readback evidence', () => {
  for (const phase of ['receiver_acknowledged', 'sender_acknowledged']) {
    const rehearsal = before(phase);
    status(rehearsal.observe(observation(phase)), 'reconciliation_required', previousPhase(phase), 'ambiguous');
    for (const readback of ['partial', 'failed', 'unknown', 'response_lost']) {
      const partial = evidence(phase);
      partial.acknowledgements[0].checks.readback = readback;
      status(rehearsal.reconcile(partial), 'invalid_evidence', previousPhase(phase), 'ambiguous');
    }
    status(rehearsal.reconcile(evidence('retired')), 'invalid_evidence', previousPhase(phase), 'ambiguous');
    status(rehearsal.reconcile(evidence(phase)), 'reconciled', phase);
    status(rehearsal.reconcile(evidence(phase)), 'reconciliation_not_required', phase);
  }
});

test('partial two-consumer containment, disablement or revocation never completes a phase', () => {
  for (const phase of ['quiesced', 'old_acceptance_disabled', 'retired']) {
    const rehearsal = before(phase, 'compromised');
    rehearsal.observe(observation(phase));
    for (const index of [0, 1]) {
      const partial = evidence(phase);
      partial.acknowledgements.splice(index, 1);
      status(rehearsal.reconcile(partial), 'invalid_evidence', previousPhase(phase), 'ambiguous');
    }
    status(rehearsal.restart(), 'reconciliation_required', previousPhase(phase), 'ambiguous');
    status(rehearsal.reconcile(evidence(phase)), 'reconciled', phase);
  }
});

test('synthetic crash and repeated restart retain the prefix and any earlier failed hold', () => {
  for (const phase of PHASES) {
    for (const cause of ['clear', 'failed', 'ambiguous']) {
      const rehearsal = before(phase);
      if (cause !== 'clear') rehearsal.observe(observation(phase, cause));
      const held = cause === 'clear' ? 'ambiguous' : cause;
      for (let count = 0; count < 3; count += 1) {
        status(rehearsal.restart(), 'reconciliation_required', previousPhase(phase), held);
        status(rehearsal.advance(evidence(phase)), 'reconciliation_required', previousPhase(phase), held);
      }
      status(rehearsal.reconcile(evidence(phase)), 'reconciled', phase);
    }
  }
});

test('restart after a recorded success cannot replay it or silently advance the next phase', () => {
  for (const phase of PHASES.slice(0, -1)) {
    const rehearsal = before(phase);
    rehearsal.advance(evidence(phase));
    status(rehearsal.restart(), 'reconciliation_required', phase, 'ambiguous');
    status(rehearsal.reconcile(evidence(phase)), 'invalid_evidence', phase, 'ambiguous');
    status(rehearsal.reconcile(evidence(PHASES[PHASES.indexOf(phase) + 1])), 'reconciled', PHASES[PHASES.indexOf(phase) + 1]);
  }
});

test('stale phases, epochs, sources, versions, generations and missing checks cannot reconcile a hold', () => {
  for (const phase of PHASES) {
    const rehearsal = before(phase);
    rehearsal.observe(observation(phase));
    for (const other of PHASES.filter((value) => value !== phase)) {
      status(rehearsal.reconcile(evidence(other)), 'invalid_evidence', previousPhase(phase), 'ambiguous');
    }
    for (const field of ['phase', 'epoch', 'source', 'version', 'configurationGeneration', 'checks']) {
      const stale = evidence(phase);
      stale.acknowledgements[0][field] = field === 'checks' ? {} : CANARY;
      status(rehearsal.reconcile(stale), 'invalid_evidence', previousPhase(phase), 'ambiguous');
    }
  }
});

test('compromised or retired material has no restore, overlap, resume or reset operation', () => {
  for (const phase of PHASES) {
    const rehearsal = before(phase, 'compromised');
    rehearsal.observe(observation(phase, 'failed'));
    for (const forbidden of ['restore', 'rollback', 'overlap', 'resume', 'reset', 'activate']) {
      assert.equal(rehearsal[forbidden], undefined);
      status(rehearsal.reconcile({ ...evidence(phase), phase: forbidden }), 'invalid_evidence', previousPhase(phase), 'failed');
    }
    if (['receiver_acknowledged', 'sender_acknowledged'].includes(phase)) {
      for (const value of ['old_only', 'old_and_new']) {
        const invalid = evidence(phase);
        invalid.acknowledgements[0].checks[phase === 'receiver_acknowledged' ? 'acceptance' : 'emission'] = value;
        status(rehearsal.reconcile(invalid), 'invalid_evidence', previousPhase(phase), 'failed');
      }
    }
  }
  const retired = before('retired', 'compromised');
  retired.advance(evidence('retired'));
  for (const result of [retired.restart(), retired.observe(observation('retired')),
    retired.advance(evidence('quiesced')), retired.reconcile(evidence('quiesced'))]) {
    status(result, 'terminal_state', 'retired');
  }
});

test('observations reject wrong bindings, non-data fields and nested input without echoing it', () => {
  let reads = 0;
  const rehearsal = before('receiver_acknowledged');
  const accessor = observation('receiver_acknowledged');
  Object.defineProperty(accessor, 'outcome', { enumerable: true, get() { reads += 1; return CANARY; } });
  const hidden = observation('receiver_acknowledged');
  Object.defineProperty(hidden, 'outcome', { value: 'failed', enumerable: false });
  for (const invalid of [null, [], {}, accessor, hidden,
    observation('quiesced'), { ...observation('receiver_acknowledged'), epoch: 8 },
    { ...observation('receiver_acknowledged'), outcome: CANARY },
    { ...observation('receiver_acknowledged'), extra: { message: CANARY } },
    { ...observation('receiver_acknowledged'), [Symbol(CANARY)]: CANARY }]) {
    status(rehearsal.observe(invalid), 'invalid_observation', 'quiesced');
  }
  assert.equal(reads, 0);
  rehearsal.observe(observation('receiver_acknowledged', 'failed'));
  status(rehearsal.observe(observation('receiver_acknowledged')), 'reconciliation_required', 'quiesced', 'failed');
});

test('all statuses exclude accepted source canaries, nested evidence and exception text', () => {
  const throwing = new Proxy({}, { getPrototypeOf() { throw new Error(CANARY); } });
  for (const invalidPlan of [null, { ...plan(), extra: { secret: CANARY } }, throwing]) {
    const invalid = createRehearsal(invalidPlan);
    for (const result of [invalid.status(), invalid.restart(), invalid.advance(throwing),
      invalid.observe(throwing), invalid.reconcile(throwing)]) {
      status(result, 'invalid_plan', 'unavailable', 'invalid_plan');
    }
  }
  for (const operation of ['advance', 'observe', 'reconcile']) {
    const rehearsal = before('receiver_acknowledged');
    if (operation === 'reconcile') rehearsal.observe(observation('receiver_acknowledged', 'failed'));
    const held = operation === 'reconcile' ? 'failed' : 'ambiguous';
    status(rehearsal[operation](throwing), 'reconciliation_required', 'quiesced', held);
    const nested = evidence('receiver_acknowledged');
    nested.acknowledgements[0].checks.extra = { message: CANARY };
    status(rehearsal.reconcile(nested), 'invalid_evidence', 'quiesced', held);
    nested.acknowledgements[0].checks.extra = { error: new Error(CANARY), input: [CANARY] };
    status(rehearsal.reconcile(nested), 'reconciliation_required', 'quiesced', held);
    status(rehearsal.reconcile(evidence('receiver_acknowledged')), 'reconciled', 'receiver_acknowledged');
  }
});

test('caller mutation and success-shaped later observations cannot clear a recorded hold', () => {
  const inputPlan = plan();
  const rehearsal = createRehearsal(inputPlan);
  inputPlan.consumers[0].newSource = 'synthetic-changed';
  const input = evidence('quiesced');
  status(rehearsal.advance(input), 'evidence_recorded', 'quiesced');
  input.acknowledgements[0].checks.dispatch = 'active';
  const failed = observation('receiver_acknowledged', 'failed');
  rehearsal.observe(failed);
  failed.outcome = 'passed';
  status(rehearsal.observe(failed), 'invalid_observation', 'quiesced', 'failed');
  status(rehearsal.advance(evidence('receiver_acknowledged')), 'reconciliation_required', 'quiesced', 'failed');
  status(rehearsal.reconcile(evidence('receiver_acknowledged')), 'reconciled', 'receiver_acknowledged');
});

test('reentrant caller traps cannot record then erase a failure during advance or reconciliation', () => {
  for (const operation of ['advance', 'reconcile']) {
    for (const reenter of ['observe', 'restart']) {
      const rehearsal = before('quiesced');
      if (operation === 'reconcile') rehearsal.observe(observation('quiesced', 'failed'));
      let traps = 0;
      const input = new Proxy(evidence('quiesced'), {
        getPrototypeOf(target) {
          traps += 1;
          rehearsal[reenter](observation('quiesced', 'failed'));
          return Object.getPrototypeOf(target);
        },
      });
      const held = operation === 'reconcile' ? 'failed' : 'ambiguous';
      status(rehearsal[operation](input), 'reconciliation_required', 'planned', held);
      assert.equal(traps, 0);
      status(rehearsal.advance(evidence('quiesced')), 'reconciliation_required', 'planned', held);
      status(rehearsal.reconcile(evidence('quiesced')), 'reconciled', 'quiesced');
    }
  }
});

test('changing phase proxies and nested proxies cannot synthesize retirement or execute traps', () => {
  for (const path of ['envelope', 'acknowledgements', 'acknowledgement', 'checks']) {
    const rehearsal = before('quiesced');
    let reads = 0;
    const handler = {
      get(target, field) {
        reads += 1;
        if (field === 'phase') return reads === 1 ? 'quiesced' : 'retired';
        return target[field];
      },
    };
    let input = evidence('quiesced');
    if (path === 'envelope') input = new Proxy(input, handler);
    if (path === 'acknowledgements') input.acknowledgements = new Proxy(input.acknowledgements, handler);
    if (path === 'acknowledgement') input.acknowledgements[0] = new Proxy(input.acknowledgements[0], handler);
    if (path === 'checks') input.acknowledgements[0].checks = new Proxy(input.acknowledgements[0].checks, handler);
    status(rehearsal.advance(input), 'reconciliation_required', 'planned', 'ambiguous');
    status(rehearsal.restart(), 'reconciliation_required', 'planned', 'ambiguous');
    assert.equal(reads, 0);
    status(rehearsal.reconcile(evidence('quiesced')), 'reconciled', 'quiesced');
  }
});

test('cyclic, over-depth and accessor evidence is bounded without executing or exposing caller code', () => {
  let reads = 0;
  const cyclic = evidence('quiesced');
  cyclic.acknowledgements[0].checks.extra = cyclic;
  const deep = evidence('quiesced');
  deep.acknowledgements[0].checks.extra = { nested: { text: CANARY } };
  const accessor = evidence('quiesced');
  Object.defineProperty(accessor.acknowledgements[0].checks, 'dispatch', {
    enumerable: true, get() { reads += 1; throw new Error(CANARY); },
  });
  for (const input of [cyclic, deep, accessor]) {
    const rehearsal = before('quiesced');
    status(rehearsal.advance(input), 'reconciliation_required', 'planned', 'ambiguous');
    status(rehearsal.reconcile(evidence('quiesced')), 'reconciled', 'quiesced');
  }
  assert.equal(reads, 0);
});
