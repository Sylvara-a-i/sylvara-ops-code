'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSyntheticJournal, createJournalController } = require('./support/rotation-journal-rehearsal');
const { createSyntheticRotationProvider, createFixedTargetRotationJournal } = require('./support/rotation-provider-rehearsal');

// Synthetic identities and evidence only. These tests do not establish provider
// durability, authenticated identity, credential custody or live authority.
const TARGET = Object.freeze({ organizationId: 'synthetic-org-a', projectId: 'synthetic-project-a',
  environment: 'synthetic', journalId: 'synthetic-journal-a' });
const SENDER = 'revenue_desk_call_worker';
const RECEIVER = 'crm_billing_orchestrator';
const CANARY = 'synthetic-private-canary';
const PHASES = ['quiesced', 'receiver_acknowledged', 'sender_acknowledged', 'ready', 'old_acceptance_disabled', 'retired'];
const CHECKS = [
  [[SENDER, { dispatch: 'contained', inFlight: 'reconciled' }], [RECEIVER, { mutations: 'contained', inFlight: 'reconciled' }]],
  [[RECEIVER, { acceptance: 'new_only', readback: 'confirmed' }]],
  [[SENDER, { emission: 'new_only', readback: 'confirmed' }]],
  [[RECEIVER, { newAuthentication: 'passed', oldAuthentication: 'rejected',
    reportToPaidAuthentication: 'rejected', paidToReportAuthentication: 'rejected' }]],
  [[SENDER, { oldUse: 'disabled', readback: 'confirmed' }], [RECEIVER, { oldAcceptance: 'disabled', readback: 'confirmed' }]],
  [[SENDER, { oldMaterial: 'retired', revocation: 'confirmed', readback: 'confirmed' }],
    [RECEIVER, { oldMaterial: 'retired', revocation: 'confirmed', readback: 'confirmed' }]],
];

function plan(oldStatus = 'ordinary') {
  return { purpose: 'report_header_authentication', strategy: 'quiesced_single_key',
    epoch: 7, oldVersion: 11, newVersion: 12, oldStatus,
    consumers: [[SENDER, 'report_sender', 'CRM_BILLING_SHARED_HEADER_VALUE'],
      [RECEIVER, 'report_receiver', 'REPORT_SUMMARY_HEADER_VALUE']].map(([consumer, role, variable], index) => ({
      consumer, role, variable, oldSource: `${CANARY}-old-${index}`, newSource: `${CANARY}-new-${index}`,
      oldConfigurationGeneration: 21, newConfigurationGeneration: 22,
    })),
  };
}

function evidence(phase) {
  return { phase, epoch: 7, acknowledgements: CHECKS[PHASES.indexOf(phase)].map(([consumer, checks]) => ({
    consumer, role: consumer === SENDER ? 'report_sender' : 'report_receiver',
    version: ['quiesced', 'retired'].includes(phase) ? 11 : 12,
    source: `${CANARY}-${phase === 'quiesced' ? 'old' : 'new'}-${consumer === SENDER ? 0 : 1}`,
    epoch: 7, phase, configurationGeneration: phase === 'quiesced' ? 21 : 22, checks: { ...checks },
  })) };
}

const intent = (phase) => ({ phase, epoch: 7 });
const observation = (phase, outcome = 'ambiguous') => ({ ...intent(phase), outcome });
const previousPhase = (phase) => PHASES[PHASES.indexOf(phase) - 1] || 'planned';
const connect = (provider, inputPlan = plan(), target = TARGET) =>
  createJournalController(inputPlan, createFixedTargetRotationJournal(target, provider.connect()));

function status(value, outcome, phase, recovery, revision) {
  assert.deepEqual(value, { outcome, phase, recovery, revision, liveAuthority: false });
  assert.ok(Object.isFrozen(value));
  for (const hidden of [CANARY, TARGET.organizationId, TARGET.projectId, TARGET.journalId]) {
    assert.ok(!JSON.stringify(value).includes(hidden));
  }
}

function fixture(phase = 'quiesced', inputPlan = plan(), target = TARGET) {
  const seedJournal = createSyntheticJournal(inputPlan);
  const seedController = createJournalController(inputPlan, seedJournal);
  for (const previous of PHASES.slice(0, PHASES.indexOf(phase))) {
    seedController.begin(intent(previous));
    seedController.acknowledge(evidence(previous));
  }
  const provider = createSyntheticRotationProvider(target, seedJournal.snapshot());
  return { provider, controller: connect(provider, inputPlan, target) };
}

test('fixed-target factories reject unsafe identities and unsealed or mixed authorities before accessing storage', () => {
  const seed = createSyntheticJournal(plan()).snapshot();
  const provider = createSyntheticRotationProvider(TARGET, seed);
  const other = createSyntheticRotationProvider(TARGET, seed);
  const planes = provider.connect();
  const otherPlanes = other.connect();
  const reconnected = provider.connect();
  assert.ok(Object.isFrozen(planes));
  assert.notEqual(planes.audit, planes.changes);
  assert.notEqual(planes.audit, reconnected.audit);
  assert.ok(Object.isFrozen(createFixedTargetRotationJournal(TARGET, { audit: planes.audit, changes: reconnected.changes })));
  let hooks = 0;
  const proxy = new Proxy({}, { getPrototypeOf() { hooks += 1; throw new Error(CANARY); } });
  const accessor = { ...TARGET };
  Object.defineProperty(accessor, 'journalId', { enumerable: true, get() { hooks += 1; throw new Error(CANARY); } });
  const rejected = (error) => error instanceof Error && !error.message.includes(CANARY);
  for (const target of [null, {}, proxy, accessor, { ...TARGET, extra: CANARY },
    { ...TARGET, environment: 'Production' }, { ...TARGET, journalId: 'unbound' },
    { ...TARGET, organizationId: `synthetic-${'a'.repeat(81)}` },
    ...Object.keys(TARGET).map((field) => ({ ...TARGET, [field]: null }))]) {
    assert.throws(() => createSyntheticRotationProvider(target, seed), rejected);
    assert.throws(() => createFixedTargetRotationJournal(target, planes), rejected);
  }
  for (const forged of [null, proxy, {}, { audit: {}, changes: {} },
    { audit: planes.audit, changes: planes.audit },
    { audit: planes.audit, changes: otherPlanes.changes },
    { audit: otherPlanes.audit, changes: planes.changes }]) {
    assert.throws(() => createFixedTargetRotationJournal(TARGET, forged), rejected);
  }
  assert.equal(hooks, 0);
  assert.deepEqual(provider.counts(), { reads: 0, writes: 0, commits: 0 });
  assert.deepEqual(other.counts(), { reads: 0, writes: 0, commits: 0 });
});

test('operation-time identity checks reject retargeting without changing the original fixed target', () => {
  for (const field of ['organizationId', 'projectId', 'journalId']) {
    const expected = { ...TARGET };
    const { provider } = fixture();
    const controller = connect(provider, plan(), expected);
    expected[field] = 'synthetic-caller-mutated';
    provider.retarget({ ...TARGET, [field]: 'synthetic-other' });
    const snapshot = provider.snapshot();
    status(controller.begin(intent('quiesced')), 'readback_required', 'planned', 'ambiguous', 0);
    status(controller.recover(), 'journal_unavailable', 'planned', 'ambiguous', 0);
    status(controller.begin(intent('quiesced')), 'readback_required', 'planned', 'ambiguous', 0);
    assert.equal(provider.counts().commits, 0);
    assert.deepEqual(provider.snapshot(), snapshot);
    provider.retarget(TARGET);
    status(controller.recover(), 'recovered', 'planned', 'clear', 0);
    status(controller.begin(intent('quiesced')), 'intent_recorded', 'planned', 'clear', 1);
    assert.equal(provider.counts().commits, 1);
  }
  const first = fixture();
  const second = fixture('quiesced', plan(), { ...TARGET, journalId: 'synthetic-journal-b' });
  first.controller.begin(intent('quiesced'));
  assert.equal(first.provider.snapshot().revision, 1);
  assert.equal(second.provider.snapshot().revision, 0);
  assert.equal(second.provider.counts().commits, 0);
});

test('fresh connections to the same provider reconstruct every prefix, pending intent, failure and terminal retirement', () => {
  for (const oldStatus of ['ordinary', 'compromised']) {
    const inputPlan = plan(oldStatus);
    const { provider, controller: initial } = fixture('quiesced', inputPlan);
    let controller = initial;
    for (const [index, phase] of PHASES.entries()) {
      const revision = index * 3;
      status(controller.begin(intent(phase)), 'intent_recorded', previousPhase(phase), 'clear', revision + 1);
      const pending = connect(provider, inputPlan);
      assert.notEqual(pending, controller);
      status(pending.status(), 'status', previousPhase(phase), 'ambiguous', revision + 1);
      status(pending.acknowledge(evidence(phase)), 'reconciliation_required', previousPhase(phase), 'ambiguous', revision + 1);
      status(pending.observe(observation(phase, 'failed')), 'reconciliation_required', previousPhase(phase), 'failed', revision + 2);
      const failed = connect(provider, inputPlan);
      status(failed.status(), 'status', previousPhase(phase), 'failed', revision + 2);
      const partial = evidence(phase);
      partial.acknowledgements.pop();
      status(failed.reconcile(partial), 'invalid_evidence', previousPhase(phase), 'failed', revision + 2);
      status(failed.reconcile(evidence(phase)), 'reconciled', phase, 'clear', revision + 3);
      controller = connect(provider, inputPlan);
      status(controller.status(), 'status', phase, 'clear', revision + 3);
      assert.deepEqual(JSON.parse(provider.snapshot().checkpoint).evidence,
        PHASES.slice(0, index + 1).map((item) => evidence(item)));
    }
    const counts = provider.counts();
    assert.equal(counts.writes, 18);
    assert.equal(counts.commits, 18);
    for (const method of ['begin', 'acknowledge', 'observe', 'reconcile']) {
      status(controller[method](evidence('quiesced')), 'terminal_state', 'retired', 'clear', 18);
    }
    assert.deepEqual(provider.counts(), counts);
  }
});

test('malformed audit envelopes and executable fields hold recovery without invoking caller hooks', () => {
  let hooks = 0;
  const throwing = new Proxy({}, { getPrototypeOf() { hooks += 1; throw new Error(CANARY); } });
  const seed = createSyntheticJournal(plan()).snapshot();
  const valid = { target: TARGET, ...seed };
  const accessor = { ...valid };
  Object.defineProperty(accessor, 'checkpoint', { enumerable: true, get() { hooks += 1; throw new Error(CANARY); } });
  for (const response of [null, [], {}, throwing, accessor,
    { ...valid, target: throwing },
    ...Object.keys(TARGET).map((field) => ({ ...valid, target: { ...TARGET, [field]: 'synthetic-wrong' } })),
    { ...valid, extra: CANARY }, { ...valid, revision: '0' }, { ...valid, revision: -1 },
    { ...valid, revision: 1 }, { ...valid, checkpoint: '{' }, { ...valid, checkpoint: ' '.repeat(32769) },
    { ...valid, toJSON() { hooks += 1; throw new Error(CANARY); } }]) {
    const { provider, controller } = fixture();
    provider.overrideNextRead(response);
    status(controller.recover(), 'journal_unavailable', 'planned', 'ambiguous', 0);
    const counts = provider.counts();
    status(controller.begin(intent('quiesced')), 'readback_required', 'planned', 'ambiguous', 0);
    assert.deepEqual(provider.counts(), counts);
    assert.deepEqual(provider.snapshot(), seed);
    status(controller.recover(), 'recovered', 'planned', 'clear', 0);
  }
  assert.equal(hooks, 0);
});

test('CAS responses never replace exact independent readback or trigger automatic retries', () => {
  for (const writeFault of ['before_write', 'after_write', 'drop_write', 'invalid_response']) {
    for (const readFault of [null, 'wrong_target']) {
      const { provider, controller } = fixture('receiver_acknowledged');
      const committed = ['after_write', 'invalid_response'].includes(writeFault);
      provider.faultNextWrite(writeFault);
      if (readFault) provider.faultNextRead(readFault);
      const result = controller.begin(intent('receiver_acknowledged'));
      assert.deepEqual(provider.counts(), { reads: 2, writes: 1, commits: Number(committed) });
      if (committed && !readFault) status(result, 'intent_recorded', 'quiesced', 'clear', 3);
      else {
        status(result, 'readback_required', 'quiesced', 'ambiguous', 2);
        const counts = provider.counts();
        status(controller.begin(intent('receiver_acknowledged')), 'readback_required', 'quiesced', 'ambiguous', 2);
        assert.deepEqual(provider.counts(), counts);
      }
      status(connect(provider).status(), 'status', 'quiesced', committed ? 'ambiguous' : 'clear', committed ? 3 : 2);
      assert.equal(provider.counts().writes, 1);
      assert.equal(provider.snapshot().revision, committed ? 3 : 2);
    }
  }
});

test('separate provider connections share the revision fence for every controller mutation', () => {
  const phase = 'receiver_acknowledged';
  for (const operation of ['begin', 'acknowledge', 'observe', 'reconcile']) {
    const { provider, controller: stale } = fixture(phase);
    if (operation !== 'begin') stale.begin(intent(phase));
    if (operation === 'reconcile') stale.observe(observation(phase));
    const winner = connect(provider);
    if (operation === 'begin') winner.begin(intent(phase));
    else if (operation === 'reconcile') winner.reconcile(evidence(phase));
    else winner.observe(observation(phase, 'failed'));
    const snapshot = provider.snapshot();
    const counts = provider.counts();
    const input = operation === 'begin' ? intent(phase) : operation === 'observe' ? observation(phase) : evidence(phase);
    status(stale[operation](input), 'stale_revision', 'quiesced', 'ambiguous', snapshot.revision - 1);
    assert.deepEqual(provider.counts(), { ...counts, writes: counts.writes + 1 });
    status(stale[operation](input), 'readback_required', 'quiesced', 'ambiguous', snapshot.revision - 1);
    assert.deepEqual(provider.snapshot(), snapshot);
    const recovery = operation === 'begin' ? 'ambiguous' : operation === 'reconcile' ? 'clear' : 'failed';
    status(stale.recover(), 'recovered', operation === 'reconcile' ? phase : 'quiesced', recovery, snapshot.revision);
    assert.equal(provider.counts().writes, counts.writes + 1);
  }
});

test('invalid and older audit reads cannot regress known state, while fresh stale connections remain CAS-fenced', () => {
  for (const fault of ['unavailable', 'corrupt', 'stale', 'stale_snapshot', 'wrong_target']) {
    const { provider, controller } = fixture('receiver_acknowledged');
    controller.begin(intent('receiver_acknowledged'));
    const snapshot = provider.snapshot();
    provider.faultNextRead(fault);
    status(controller.recover(), 'journal_unavailable', 'quiesced', 'ambiguous', 3);
    status(controller.acknowledge(evidence('receiver_acknowledged')), 'readback_required', 'quiesced', 'ambiguous', 3);
    assert.deepEqual(provider.snapshot(), snapshot);
    status(controller.recover(), 'recovered', 'quiesced', 'ambiguous', 3);
    assert.equal(provider.counts().writes, 1);
  }
  const { provider, controller } = fixture('receiver_acknowledged');
  controller.begin(intent('receiver_acknowledged'));
  provider.faultNextRead('stale_snapshot');
  const stale = connect(provider);
  status(stale.status(), 'status', 'quiesced', 'clear', 2);
  status(stale.begin(intent('receiver_acknowledged')), 'stale_revision', 'quiesced', 'ambiguous', 2);
  status(stale.recover(), 'recovered', 'quiesced', 'ambiguous', 3);
  assert.deepEqual(provider.counts(), { reads: 4, writes: 2, commits: 1 });
});

test('a competing failure between commit and audit read survives current or historical exact readback', () => {
  for (const historical of [false, true]) {
    for (const lostResponse of [false, true]) {
      const { provider, controller } = fixture('receiver_acknowledged');
      let calls = 0;
      let observed;
      let snapshot;
      provider.afterNextCommit(() => {
        calls += 1;
        observed = connect(provider).observe(observation('receiver_acknowledged', 'failed'));
        snapshot = provider.snapshot();
        if (historical) provider.faultNextRead('stale_snapshot');
      });
      if (lostResponse) provider.faultNextWrite('after_write');
      const result = controller.begin(intent('receiver_acknowledged'));
      // The controller catches ambiguous transport errors, so assertions belong
      // outside the trusted scheduling callback rather than inside that catch.
      assert.equal(calls, 1);
      status(observed, 'reconciliation_required', 'quiesced', 'failed', 4);
      if (historical) {
        status(result, 'intent_recorded', 'quiesced', 'clear', 3);
        status(controller.acknowledge(evidence('receiver_acknowledged')), 'stale_revision', 'quiesced', 'ambiguous', 3);
      } else status(result, 'readback_required', 'quiesced', 'ambiguous', 2);
      const counts = provider.counts();
      status(controller.acknowledge(evidence('receiver_acknowledged')), 'readback_required', 'quiesced', 'ambiguous', historical ? 3 : 2);
      assert.deepEqual(provider.counts(), counts);
      assert.deepEqual(provider.snapshot(), snapshot);
      status(controller.recover(), 'recovered', 'quiesced', 'failed', 4);
      status(connect(provider).status(), 'status', 'quiesced', 'failed', 4);
      assert.equal(provider.counts().writes, historical ? 3 : 2);
      assert.equal(provider.counts().commits, 2);
      assert.equal(calls, 1);
    }
  }
});
