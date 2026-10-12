'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createSyntheticJournal, createJournalController } = require('./support/rotation-journal-rehearsal');

// Synthetic metadata only. A passing journal rehearsal proves no provider
// durability, authenticated readback, IAM, protected custody or live authority.
const SENDER = 'revenue_desk_call_worker';
const RECEIVER = 'crm_billing_orchestrator';
const CANARY = 'synthetic-private-canary';
const PHASES = ['quiesced', 'receiver_acknowledged', 'sender_acknowledged',
  'ready', 'old_acceptance_disabled', 'retired'];
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

function evidence(phase, inputPlan = plan()) {
  return {
    phase, epoch: inputPlan.epoch,
    acknowledgements: CHECKS[PHASES.indexOf(phase)].map(([name, checks]) => {
      const consumer = inputPlan.consumers.find((item) => item.consumer === name);
      const configuration = phase === 'quiesced' ? 'old' : 'new';
      return {
        consumer: name, role: consumer.role,
        version: inputPlan[['quiesced', 'retired'].includes(phase) ? 'oldVersion' : 'newVersion'],
        source: consumer[`${configuration}Source`], epoch: inputPlan.epoch, phase,
        configurationGeneration: consumer[`${configuration}ConfigurationGeneration`], checks: { ...checks },
      };
    }),
  };
}

const intent = (phase, inputPlan = plan()) => ({ phase, epoch: inputPlan.epoch });
const observation = (phase, outcome = 'ambiguous', inputPlan = plan()) => ({ ...intent(phase, inputPlan), outcome });
const previousPhase = (phase) => PHASES[PHASES.indexOf(phase) - 1] || 'planned';

function status(value, outcome, phase, recovery, revision) {
  assert.deepEqual(value, { outcome, phase, recovery, revision, liveAuthority: false });
  assert.ok(Object.isFrozen(value));
  assert.ok(!JSON.stringify(value).includes(CANARY));
  return value;
}

function before(phase, inputPlan = plan()) {
  const journal = createSyntheticJournal(inputPlan);
  const controller = createJournalController(inputPlan, journal);
  for (const [index, previous] of PHASES.slice(0, PHASES.indexOf(phase)).entries()) {
    status(controller.begin(intent(previous, inputPlan)), 'intent_recorded', previousPhase(previous), 'clear', index * 2 + 1);
    status(controller.acknowledge(evidence(previous, inputPlan)), 'evidence_recorded', previous, 'clear', index * 2 + 2);
  }
  return { journal, controller, inputPlan };
}

function reconstruct(inputPlan, journal) {
  // Transfer only serialization and the expected plan to a new journal and a
  // genuinely new controller; no controller reference or state is an input.
  const restoredJournal = createSyntheticJournal(inputPlan, journal.snapshot());
  return { journal: restoredJournal, controller: createJournalController(inputPlan, restoredJournal), inputPlan };
}

function checkpoint(journal) {
  return JSON.parse(journal.snapshot().checkpoint);
}

for (const oldStatus of ['ordinary', 'compromised']) {
  test(`${oldStatus}: fresh reconstruction preserves the exact accepted prefix before intent, after intent and after acknowledgement`, () => {
    for (const phase of PHASES) {
      const inputPlan = plan(oldStatus);
      const original = before(phase, inputPlan);
      const count = PHASES.indexOf(phase);
      const clean = reconstruct(inputPlan, original.journal);
      assert.notEqual(clean.controller, original.controller);
      assert.notEqual(clean.journal, original.journal);
      status(clean.controller.status(), 'status', previousPhase(phase), 'clear', count * 2);
      assert.deepEqual(checkpoint(clean.journal).evidence, PHASES.slice(0, count).map((item) => evidence(item, inputPlan)));
      status(clean.controller.acknowledge(evidence(phase, inputPlan)), 'intent_required', previousPhase(phase), 'clear', count * 2);
      status(clean.controller.begin(intent(phase, inputPlan)), 'intent_recorded', previousPhase(phase), 'clear', count * 2 + 1);

      let pending = reconstruct(inputPlan, clean.journal);
      for (let restart = 0; restart < 3; restart += 1) {
        const snapshot = pending.journal.snapshot();
        status(pending.controller.status(), 'status', previousPhase(phase), 'ambiguous', count * 2 + 1);
        status(pending.controller.begin(intent(phase, inputPlan)), 'reconciliation_required', previousPhase(phase), 'ambiguous', count * 2 + 1);
        status(pending.controller.acknowledge(evidence(phase, inputPlan)), 'reconciliation_required', previousPhase(phase), 'ambiguous', count * 2 + 1);
        status(pending.controller.recover(), 'recovered', previousPhase(phase), 'ambiguous', count * 2 + 1);
        assert.deepEqual(pending.journal.snapshot(), snapshot);
        pending = reconstruct(inputPlan, pending.journal);
      }
      status(pending.controller.reconcile(evidence(phase, inputPlan)), 'reconciled', phase, 'clear', count * 2 + 2);
      const completed = reconstruct(inputPlan, pending.journal);
      status(completed.controller.status(), 'status', phase, 'clear', count * 2 + 2);
      assert.deepEqual(checkpoint(completed.journal).evidence, PHASES.slice(0, count + 1).map((item) => evidence(item, inputPlan)));
      assert.equal(checkpoint(completed.journal).intent, null);
      const snapshot = completed.journal.snapshot();
      status(completed.controller.acknowledge(evidence(phase, inputPlan)), phase === 'retired' ? 'terminal_state' : 'intent_required', phase, 'clear', count * 2 + 2);
      assert.deepEqual(completed.journal.snapshot(), snapshot);
    }
  });

  test(`${oldStatus}: persisted failure and ambiguity survive repeated fresh recovery at every phase`, () => {
    for (const phase of PHASES) {
      for (const cause of ['failed', 'ambiguous']) {
        const inputPlan = plan(oldStatus);
        const original = before(phase, inputPlan);
        original.controller.begin(intent(phase, inputPlan));
        const revision = PHASES.indexOf(phase) * 2 + 2;
        status(original.controller.observe(observation(phase, cause, inputPlan)), 'reconciliation_required', previousPhase(phase), cause, revision);
        let recovered = original;
        for (let restart = 0; restart < 3; restart += 1) {
          recovered = reconstruct(inputPlan, recovered.journal);
          const snapshot = recovered.journal.snapshot();
          status(recovered.controller.status(), 'status', previousPhase(phase), cause, revision);
          for (const candidate of PHASES) {
            status(recovered.controller.acknowledge(evidence(candidate, inputPlan)), 'reconciliation_required', previousPhase(phase), cause, revision);
          }
          const invalid = evidence(phase, inputPlan);
          invalid.acknowledgements[0].checks[Object.keys(invalid.acknowledgements[0].checks)[0]] = 'failed';
          status(recovered.controller.reconcile(invalid), 'invalid_evidence', previousPhase(phase), cause, revision);
          assert.deepEqual(recovered.journal.snapshot(), snapshot);
        }
        status(recovered.controller.reconcile(evidence(phase, inputPlan)), 'reconciled', phase, 'clear', revision + 1);
      }
    }
  });
}

for (const operation of ['begin', 'acknowledge', 'observe', 'reconcile']) {
  test(`${operation}: independent exact readback governs lost, dropped and committed journal writes`, () => {
    for (const phase of PHASES) {
      for (const writeFault of ['before_write', 'after_write', 'drop_write', null]) {
        for (const readFault of [null, 'unavailable', 'stale', 'stale_snapshot', 'corrupt']) {
          const { controller, journal } = before(phase);
          if (operation !== 'begin') controller.begin(intent(phase));
          if (operation === 'reconcile') controller.observe(observation(phase));
          const snapshot = journal.snapshot();
          const revision = snapshot.revision;
          if (writeFault) journal.faultNextWrite(writeFault);
          if (readFault) journal.faultNextRead(readFault);
          const input = operation === 'begin' ? intent(phase) : operation === 'observe' ? observation(phase, 'failed') : evidence(phase);
          const result = controller[operation](input);
          const committed = writeFault === 'after_write' || writeFault === null;
          const advancing = operation === 'acknowledge' || operation === 'reconcile';
          const nextPhase = committed && advancing ? phase : previousPhase(phase);
          assert.equal(journal.snapshot().revision, revision + Number(committed));
          assert.equal(checkpoint(journal).evidence.length, PHASES.indexOf(phase) + Number(committed && advancing));
          if (committed && !readFault) {
            const outcome = { begin: 'intent_recorded', acknowledge: 'evidence_recorded', observe: 'reconciliation_required', reconcile: 'reconciled' }[operation];
            status(result, outcome, nextPhase, operation === 'observe' ? 'failed' : 'clear', revision + 1);
          } else {
            const recovery = operation === 'observe' ? 'failed' : 'ambiguous';
            status(result, 'readback_required', previousPhase(phase), recovery, revision);
            const held = journal.snapshot();
            for (const method of ['begin', 'acknowledge', 'observe', 'reconcile']) {
              status(controller[method](input), 'readback_required', previousPhase(phase), recovery, revision);
            }
            assert.deepEqual(journal.snapshot(), held);
          }
          // A fresh controller sees only the committed bytes. Lost responses
          // alone never imply either an accepted acknowledgement or a failure.
          const fresh = reconstruct(plan(), journal);
          const pending = checkpoint(journal).intent;
          const recovery = pending ? pending.recovery === 'failed' ? 'failed' : 'ambiguous' : 'clear';
          status(fresh.controller.status(), 'status', nextPhase, recovery, revision + Number(committed));
          assert.equal(fresh.journal.snapshot().revision, journal.snapshot().revision);
          if (!committed) assert.deepEqual(journal.snapshot(), snapshot);
        }
      }
    }
  });
}

test('failed observations remain locally held after a lost write, and fresh recovery cannot invent an uncommitted cause', () => {
  for (const writeFault of ['before_write', 'drop_write']) {
    const { controller, journal } = before('receiver_acknowledged');
    controller.begin(intent('receiver_acknowledged'));
    journal.faultNextWrite(writeFault);
    status(controller.observe(observation('receiver_acknowledged', 'failed')), 'readback_required', 'quiesced', 'failed', 3);
    status(controller.recover(), 'recovered', 'quiesced', 'failed', 3);
    status(controller.acknowledge(evidence('receiver_acknowledged')), 'reconciliation_required', 'quiesced', 'failed', 3);
    const fresh = reconstruct(plan(), journal);
    status(fresh.controller.status(), 'status', 'quiesced', 'ambiguous', 3);
    status(fresh.controller.acknowledge(evidence('receiver_acknowledged')), 'reconciliation_required', 'quiesced', 'ambiguous', 3);
    status(controller.reconcile(evidence('receiver_acknowledged')), 'reconciled', 'receiver_acknowledged', 'clear', 4);
  }
});

for (const operation of ['begin', 'acknowledge', 'observe', 'reconcile']) {
  test(`${operation}: stale competing writers cannot overwrite a shared revision`, () => {
    for (const phase of PHASES) {
      const { journal, controller: stale } = before(phase);
      if (operation !== 'begin') stale.begin(intent(phase));
      if (operation === 'reconcile') stale.observe(observation(phase));
      const winner = createJournalController(plan(), journal);
      if (operation === 'begin') winner.begin(intent(phase));
      else if (operation === 'reconcile') winner.reconcile(evidence(phase));
      else winner.observe(observation(phase, 'failed'));
      const snapshot = journal.snapshot();
      const input = operation === 'begin' ? intent(phase) : operation === 'observe' ? observation(phase) : evidence(phase);
      const oldRevision = snapshot.revision - 1;
      status(stale[operation](input), 'stale_revision', previousPhase(phase), 'ambiguous', oldRevision);
      status(stale[operation](input), 'readback_required', previousPhase(phase), 'ambiguous', oldRevision);
      assert.deepEqual(journal.snapshot(), snapshot);
      const phaseAfter = operation === 'reconcile' ? phase : previousPhase(phase);
      const recoveryAfter = ['acknowledge', 'observe'].includes(operation) ? 'failed' : operation === 'begin' ? 'ambiguous' : 'clear';
      status(stale.recover(), 'recovered', phaseAfter, recoveryAfter, snapshot.revision);
      assert.deepEqual(journal.snapshot(), snapshot);
    }
  });
}

test('unavailable, stale and corrupt recovery reads block all mutations until fresh valid readback', () => {
  for (const readFault of ['unavailable', 'stale', 'corrupt']) {
    const { journal, controller } = before('sender_acknowledged');
    journal.faultNextRead(readFault);
    status(controller.recover(), 'journal_unavailable', 'receiver_acknowledged', 'ambiguous', 4);
    const snapshot = journal.snapshot();
    for (const method of ['begin', 'acknowledge', 'observe', 'reconcile']) {
      status(controller[method](evidence('sender_acknowledged')), 'readback_required', 'receiver_acknowledged', 'ambiguous', 4);
    }
    assert.deepEqual(journal.snapshot(), snapshot);
    status(controller.recover(), 'recovered', 'receiver_acknowledged', 'clear', 4);
    status(controller.begin(intent('sender_acknowledged')), 'intent_recorded', 'receiver_acknowledged', 'clear', 5);
  }
});

test('coherent lower revisions cannot regress a known pending, failed or accepted checkpoint', () => {
  for (const phase of PHASES) {
    for (const persisted of ['pending', 'failed', 'accepted']) {
      const { controller, journal } = before(phase);
      controller.begin(intent(phase));
      if (persisted === 'failed') controller.observe(observation(phase, 'failed'));
      if (persisted === 'accepted') controller.acknowledge(evidence(phase));
      const snapshot = journal.snapshot();
      const heldPhase = persisted === 'accepted' ? phase : previousPhase(phase);
      const heldRecovery = persisted === 'failed' ? 'failed' : 'ambiguous';
      journal.faultNextRead('stale_snapshot');
      status(controller.recover(), 'journal_unavailable', heldPhase, heldRecovery, snapshot.revision);
      for (const method of ['begin', 'acknowledge', 'observe', 'reconcile']) {
        status(controller[method](evidence(phase)), 'readback_required', heldPhase, heldRecovery, snapshot.revision);
      }
      assert.deepEqual(journal.snapshot(), snapshot);
      const recovery = persisted === 'accepted' ? 'clear' : heldRecovery;
      status(controller.recover(), 'recovered', heldPhase, recovery, snapshot.revision);
      assert.deepEqual(journal.snapshot(), snapshot);
    }
  }
});

test('fresh controllers may read a coherent old snapshot but cannot overwrite the current shared journal', () => {
  for (const phase of PHASES) {
    for (const operation of ['begin', 'observe', 'reconcile']) {
      const { controller, journal } = before(phase);
      controller.begin(intent(phase));
      if (operation === 'observe') controller.observe(observation(phase, 'failed'));
      if (operation === 'reconcile') controller.acknowledge(evidence(phase));
      const snapshot = journal.snapshot();
      journal.faultNextRead('stale_snapshot');
      const stale = createJournalController(plan(), journal);
      const oldRecovery = operation === 'begin' ? 'clear' : 'ambiguous';
      status(stale.status(), 'status', previousPhase(phase), oldRecovery, snapshot.revision - 1);
      // Reading an old intent never supplies this new controller with its own
      // acknowledged intent write, so ordinary acknowledgement remains held.
      status(stale.acknowledge(evidence(phase)), operation === 'begin' ? 'intent_required' : 'reconciliation_required',
        previousPhase(phase), oldRecovery, snapshot.revision - 1);
      const input = operation === 'begin' ? intent(phase) : operation === 'observe' ? observation(phase) : evidence(phase);
      status(stale[operation](input), 'stale_revision', previousPhase(phase), 'ambiguous', snapshot.revision - 1);
      status(stale[operation](input), 'readback_required', previousPhase(phase), 'ambiguous', snapshot.revision - 1);
      assert.deepEqual(journal.snapshot(), snapshot);
      const currentPhase = operation === 'reconcile' ? phase : previousPhase(phase);
      const currentRecovery = operation === 'begin' ? 'ambiguous' : operation === 'observe' ? 'failed' : 'clear';
      status(stale.recover(), 'recovered', currentPhase, currentRecovery, snapshot.revision);
      assert.deepEqual(journal.snapshot(), snapshot);
    }
  }
});

test('partial or corrupt serialized checkpoints are rejected without repair, bootstrap or mutation', () => {
  const { journal } = before('retired');
  const original = journal.snapshot();
  const mutations = [
    (doc) => { delete doc.evidence; },
    (doc) => { doc.extra = CANARY; },
    (doc) => { doc.schema = 2; },
    (doc) => { doc.revision += 1; },
    (doc) => { doc.evidence.splice(0, 1); },
    (doc) => { doc.evidence.push(evidence('retired'), evidence('retired')); },
    (doc) => { doc.evidence[1] = evidence('sender_acknowledged'); },
    (doc) => { doc.evidence[0].acknowledgements.pop(); },
    (doc) => { doc.evidence[1].acknowledgements[0].source = `${CANARY}-wrong`; },
    (doc) => { doc.evidence[4].acknowledgements[0].checks.readback = 'unknown'; },
    (doc) => { doc.intent = { phase: 'quiesced', epoch: 7, recovery: 'clear' }; },
    (doc) => { doc.intent = { phase: 'retired', epoch: 8, recovery: 'failed' }; },
    (doc) => { doc.intent = { phase: 'retired', epoch: 7, recovery: 'passed' }; },
    (doc) => { doc.intent = { phase: 'retired', epoch: 7, recovery: 'failed', extra: CANARY }; },
  ];
  const seeds = mutations.map((mutate) => {
    const doc = JSON.parse(original.checkpoint);
    mutate(doc);
    return { revision: original.revision, checkpoint: JSON.stringify(doc) };
  });
  seeds.push(...['{', '', 'null', '[]', original.checkpoint.slice(0, -1), ' '.repeat(32769)].map((serialized) => ({ revision: original.revision, checkpoint: serialized })));
  const tooEarly = checkpoint(journal);
  tooEarly.revision = 1;
  seeds.push({ revision: 1, checkpoint: JSON.stringify(tooEarly) });
  for (const [revision, pending] of [
    [1, null],
    [2, { phase: 'quiesced', epoch: 7, recovery: 'clear' }],
    [1, { phase: 'quiesced', epoch: 7, recovery: 'failed' }],
    [1, { phase: 'quiesced', epoch: 7, recovery: 'ambiguous' }],
  ]) {
    const impossible = checkpoint(createSyntheticJournal(plan()));
    impossible.revision = revision;
    impossible.intent = pending;
    seeds.push({ revision, checkpoint: JSON.stringify(impossible) });
  }
  for (const seed of seeds) {
    const invalidJournal = createSyntheticJournal(plan(), seed);
    const invalid = createJournalController(plan(), invalidJournal);
    status(invalid.status(), 'readback_required', 'unavailable', 'ambiguous', null);
    status(invalid.recover(), 'journal_unavailable', 'unavailable', 'ambiguous', null);
    for (const method of ['begin', 'acknowledge', 'observe', 'reconcile']) {
      status(invalid[method](evidence('retired')), 'readback_required', 'unavailable', 'ambiguous', null);
    }
    assert.deepEqual(invalidJournal.snapshot(), seed);
  }
});

test('an independently valid journal for another epoch or configuration cannot recover this plan', () => {
  for (const mutate of [
    (inputPlan) => { inputPlan.epoch += 1; },
    (inputPlan) => { inputPlan.consumers[0].newConfigurationGeneration += 1; },
    (inputPlan) => { inputPlan.consumers[1].newSource = `${CANARY}-other`; },
    (inputPlan) => { inputPlan.oldStatus = 'compromised'; },
  ]) {
    const alternate = plan();
    mutate(alternate);
    const { journal } = before('retired', alternate);
    status(reconstruct(alternate, journal).controller.status(), 'status', 'old_acceptance_disabled', 'clear', 10);
    const expectedJournal = createSyntheticJournal(plan(), journal.snapshot());
    const controller = createJournalController(plan(), expectedJournal);
    status(controller.status(), 'readback_required', 'unavailable', 'ambiguous', null);
    status(controller.begin(intent('quiesced')), 'readback_required', 'unavailable', 'ambiguous', null);
    assert.deepEqual(expectedJournal.snapshot(), journal.snapshot());
  }
});

test('reconciliation requires complete independent evidence bound to the pending phase and configuration', () => {
  for (const phase of PHASES) {
    const { journal, controller } = before(phase);
    controller.begin(intent(phase));
    controller.observe(observation(phase, 'failed'));
    const revision = journal.snapshot().revision;
    const snapshot = journal.snapshot();
    const candidates = PHASES.filter((item) => item !== phase).map((item) => evidence(item));
    for (const field of ['consumer', 'role', 'version', 'source', 'epoch', 'phase', 'configurationGeneration']) {
      const invalid = evidence(phase);
      invalid.acknowledgements[0][field] = CANARY;
      candidates.push(invalid);
    }
    for (const index of evidence(phase).acknowledgements.keys()) {
      const partial = evidence(phase);
      partial.acknowledgements.splice(index, 1);
      candidates.push(partial);
    }
    for (const check of Object.keys(evidence(phase).acknowledgements[0].checks)) {
      for (const value of ['unknown', 'response_lost', 'old_only', 'old_and_new']) {
        const invalid = evidence(phase);
        invalid.acknowledgements[0].checks[check] = value;
        candidates.push(invalid);
      }
    }
    for (const candidate of candidates) {
      status(controller.reconcile(candidate), 'invalid_evidence', previousPhase(phase), 'failed', revision);
    }
    assert.deepEqual(journal.snapshot(), snapshot);
    status(controller.reconcile(evidence(phase)), 'reconciled', phase, 'clear', revision + 1);
  }
});

test('replayed acknowledgements and intents do not duplicate acceptance or skip receiver-before-sender ordering', () => {
  for (const phase of PHASES) {
    const { journal, controller } = before(phase);
    const revision = journal.snapshot().revision;
    for (const later of PHASES.slice(PHASES.indexOf(phase) + 1)) {
      status(controller.begin(intent(later)), 'invalid_intent', previousPhase(phase), 'clear', revision);
    }
    controller.begin(intent(phase));
    status(controller.begin(intent(phase)), 'reconciliation_required', previousPhase(phase), 'clear', revision + 1);
    for (const previous of PHASES.slice(0, PHASES.indexOf(phase))) {
      status(controller.acknowledge(evidence(previous)), 'invalid_evidence', previousPhase(phase), 'clear', revision + 1);
    }
    status(controller.acknowledge(evidence(phase)), 'evidence_recorded', phase, 'clear', revision + 2);
    const snapshot = journal.snapshot();
    const result = phase === 'retired' ? 'terminal_state' : 'intent_required';
    status(controller.acknowledge(evidence(phase)), result, phase, 'clear', revision + 2);
    status(controller.reconcile(evidence(phase)), result, phase, 'clear', revision + 2);
    assert.deepEqual(journal.snapshot(), snapshot);
  }
});

test('retirement remains terminal across fresh recovery and exposes no restore, overlap or activation operation', () => {
  const inputPlan = plan('compromised');
  const { controller, journal } = before('retired', inputPlan);
  controller.begin(intent('retired'));
  controller.acknowledge(evidence('retired', inputPlan));
  const recovered = reconstruct(inputPlan, journal);
  const snapshot = recovered.journal.snapshot();
  for (const method of ['begin', 'acknowledge', 'observe', 'reconcile']) {
    status(recovered.controller[method](evidence('quiesced')), 'terminal_state', 'retired', 'clear', 12);
  }
  for (const forbidden of ['restore', 'rollback', 'overlap', 'resume', 'reset', 'activate']) {
    assert.equal(recovered.controller[forbidden], undefined);
  }
  status(recovered.controller.recover(), 'recovered', 'retired', 'clear', 12);
  assert.deepEqual(recovered.journal.snapshot(), snapshot);
  const corrupt = checkpoint(journal);
  corrupt.intent = { phase: 'retired', epoch: 7, recovery: 'failed' };
  const impossible = createSyntheticJournal(inputPlan, { revision: 12, checkpoint: JSON.stringify(corrupt) });
  status(createJournalController(inputPlan, impossible).status(), 'readback_required', 'unavailable', 'ambiguous', null);
});

test('unsafe caller metadata never executes hooks or escapes through fixed statuses', () => {
  let calls = 0;
  const handler = { get() { calls += 1; throw new Error(CANARY); }, getPrototypeOf() { calls += 1; throw new Error(CANARY); } };
  const throwing = new Proxy({}, handler);
  const journal = createSyntheticJournal(plan());
  for (const invalidPlan of [null, throwing, { ...plan(), extra: CANARY }]) {
    const invalid = createJournalController(invalidPlan, journal);
    for (const result of [invalid.status(), invalid.recover(), invalid.begin(throwing), invalid.acknowledge(throwing), invalid.observe(throwing), invalid.reconcile(throwing)]) {
      status(result, 'invalid_plan', 'unavailable', 'invalid_plan', null);
    }
  }
  const seedAccessor = {};
  Object.defineProperty(seedAccessor, 'revision', { enumerable: true, get() { calls += 1; throw new Error(CANARY); } });
  Object.defineProperty(seedAccessor, 'checkpoint', { enumerable: true, value: '{}' });
  for (const seed of [throwing, seedAccessor]) {
    assert.throws(() => createSyntheticJournal(plan(), seed), (error) => error.message === 'Invalid fixture.');
  }
  for (const operation of ['begin', 'acknowledge', 'observe', 'reconcile']) {
    const inputs = [throwing];
    const accessor = operation === 'begin' ? intent('quiesced') : operation === 'observe' ? observation('quiesced') : evidence('quiesced');
    Object.defineProperty(accessor, 'phase', { enumerable: true, get() { calls += 1; throw new Error(CANARY); } });
    inputs.push(accessor, { ...intent('quiesced'), toJSON() { calls += 1; throw new Error(CANARY); } });
    if (['acknowledge', 'reconcile'].includes(operation)) {
      for (const part of ['acknowledgements', 'acknowledgement', 'checks']) {
        const nested = evidence('quiesced');
        if (part === 'acknowledgements') nested.acknowledgements = new Proxy(nested.acknowledgements, handler);
        if (part === 'acknowledgement') nested.acknowledgements[0] = new Proxy(nested.acknowledgements[0], handler);
        if (part === 'checks') nested.acknowledgements[0].checks = new Proxy(nested.acknowledgements[0].checks, handler);
        inputs.push(nested);
      }
      const cyclic = evidence('quiesced');
      cyclic.acknowledgements[0].checks.extra = cyclic;
      inputs.push(cyclic);
    }
    for (const input of inputs) {
      const { controller, journal: fixture } = before('quiesced');
      if (operation !== 'begin') controller.begin(intent('quiesced'));
      if (operation === 'reconcile') controller.observe(observation('quiesced', 'failed'));
      const snapshot = fixture.snapshot();
      const outcome = operation === 'begin' ? 'invalid_intent' : operation === 'observe' ? 'invalid_observation' : 'reconciliation_required';
      const recovery = operation === 'reconcile' ? 'failed' : operation === 'acknowledge' ? 'ambiguous' : 'clear';
      status(controller[operation](input), outcome, 'planned', recovery, snapshot.revision);
      assert.deepEqual(fixture.snapshot(), snapshot);
    }
  }
  assert.equal(calls, 0);
});

test('caller mutation cannot change copied plans, accepted evidence or persisted failure observations', () => {
  const inputPlan = plan();
  const journal = createSyntheticJournal(inputPlan);
  const controller = createJournalController(inputPlan, journal);
  inputPlan.consumers[0].newSource = `${CANARY}-changed`;
  controller.begin(intent('quiesced'));
  const accepted = evidence('quiesced');
  controller.acknowledge(accepted);
  accepted.acknowledgements[0].checks.dispatch = 'active';
  controller.begin(intent('receiver_acknowledged'));
  const failure = observation('receiver_acknowledged', 'failed');
  controller.observe(failure);
  failure.outcome = 'passed';
  const recovered = reconstruct(plan(), journal);
  status(recovered.controller.status(), 'status', 'quiesced', 'failed', 4);
  status(recovered.controller.observe(failure), 'invalid_observation', 'quiesced', 'failed', 4);
  status(recovered.controller.observe(observation('receiver_acknowledged')), 'reconciliation_required', 'quiesced', 'failed', 5);
  status(recovered.controller.reconcile(evidence('receiver_acknowledged')), 'reconciled', 'receiver_acknowledged', 'clear', 6);
});

test('revision exhaustion fails closed without rounding or overwriting the journal', () => {
  const original = before('receiver_acknowledged').journal.snapshot();
  const doc = JSON.parse(original.checkpoint);
  doc.revision = Number.MAX_SAFE_INTEGER;
  const journal = createSyntheticJournal(plan(), { revision: doc.revision, checkpoint: JSON.stringify(doc) });
  const controller = createJournalController(plan(), journal);
  const snapshot = journal.snapshot();
  status(controller.begin(intent('receiver_acknowledged')), 'revision_exhausted', 'quiesced', 'clear', Number.MAX_SAFE_INTEGER);
  assert.deepEqual(journal.snapshot(), snapshot);
});
