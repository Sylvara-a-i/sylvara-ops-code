'use strict';

// TEST ONLY. A serialized synthetic journal and fresh controllers, without IO,
// provider adapters, credentials or live authority. Atomic CAS is an assumption
// of this in-memory fixture, not evidence of provider durability or custody.
const { initialState, apply } = require('./rotation-rollout-model');
const { types: { isProxy }, isDeepStrictEqual } = require('node:util');

const PHASES = ['quiesced', 'receiver_acknowledged', 'sender_acknowledged',
  'ready', 'old_acceptance_disabled', 'retired'];
const cells = new WeakMap();
const MAX_CHECKPOINT = 32768;

// Inspect bounded plain data before serialization or model validation. Never
// execute caller hooks, including toJSON, accessors, proxy traps or iterators.
function copyData(value) {
  let remaining = 1024;
  function inspect(item, depth) {
    if (--remaining < 0 || depth > 9) throw new Error('Invalid metadata.');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string' && item.length <= 256) return;
    if (typeof item === 'number' && Number.isSafeInteger(item)) return;
    if (!item || typeof item !== 'object' || isProxy(item)) throw new Error('Invalid metadata.');
    const array = Array.isArray(item);
    if (array ? Object.getPrototypeOf(item) !== Array.prototype :
      ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error('Invalid metadata.');
    const fields = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(fields);
    if (keys.length > 32 || (array && (item.length > 16 || keys.length !== item.length + 1))) {
      throw new Error('Invalid metadata.');
    }
    for (const key of keys) {
      const field = fields[key];
      if (typeof key !== 'string' || !Object.hasOwn(field, 'value') ||
        (!field.enumerable && !(array && key === 'length'))) throw new Error('Invalid metadata.');
      if (array && key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)) throw new Error('Invalid metadata.');
      inspect(field.value, depth + 1);
    }
  }
  inspect(value, 0);
  return JSON.parse(JSON.stringify(value));
}

const exactFields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

function decode(plan, snapshot) {
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 ||
    typeof snapshot.checkpoint !== 'string' || snapshot.checkpoint.length > MAX_CHECKPOINT) {
    throw new Error('Invalid journal.');
  }
  const doc = copyData(JSON.parse(snapshot.checkpoint));
  if (!exactFields(doc, ['schema', 'revision', 'plan', 'evidence', 'intent']) ||
    doc.schema !== 1 || doc.revision !== snapshot.revision || !isDeepStrictEqual(doc.plan, plan) ||
    !Array.isArray(doc.evidence) || doc.evidence.length > PHASES.length) throw new Error('Invalid journal.');
  let state = initialState(plan);
  // The existing rollout validator alone owns evidence acceptance and ordering.
  for (const evidence of doc.evidence) {
    const next = apply(state, state.revision, evidence);
    if (next.outcome !== 'evidence_recorded') throw new Error('Invalid journal.');
    state = next.state;
  }
  if (doc.intent !== null && (!exactFields(doc.intent, ['phase', 'epoch', 'recovery']) ||
    state.phase === 'retired' || doc.intent.phase !== PHASES[state.revision] ||
    doc.intent.epoch !== plan.epoch || !['clear', 'failed', 'ambiguous'].includes(doc.intent.recovery))) {
    throw new Error('Invalid journal.');
  }
  // Every accepted step required an intent and acknowledgement write. Additional
  // revisions may record failure observations; no revision arithmetic may wrap.
  const intentWrites = doc.intent ? (doc.intent.recovery === 'clear' ? 1 : 2) : 0;
  if (doc.revision < state.revision * 2 + intentWrites ||
    (state.revision === 0 && (!doc.intent || doc.intent.recovery === 'clear') &&
      doc.revision !== intentWrites)) throw new Error('Invalid journal.');
  return { doc, state };
}

function read(cell) {
  const fault = cell.readFault;
  cell.readFault = null;
  if (fault === 'unavailable') throw new Error('Synthetic read unavailable.');
  // A coherent older snapshot must exercise revision fencing, independently of
  // the existing torn-envelope fault (old bytes paired with the current revision).
  if (fault === 'stale_snapshot') return { revision: cell.previousRevision, checkpoint: cell.previous };
  return { revision: cell.revision, checkpoint: fault === 'corrupt' ? '{' :
    fault === 'stale' ? cell.previous : cell.checkpoint };
}

function compareAndSwap(cell, expected, checkpoint) {
  if (cell.revision !== expected) return false;
  const fault = cell.writeFault;
  cell.writeFault = null;
  if (fault === 'before_write') throw new Error('Synthetic write unavailable.');
  if (fault === 'drop_write') return true; // success-shaped response without storage
  cell.previousRevision = cell.revision;
  cell.previous = cell.checkpoint;
  cell.checkpoint = checkpoint;
  cell.revision += 1;
  // Trusted test scheduling only: let a competing controller commit before the
  // original controller reads back. Clear first so the competing write cannot
  // recursively invoke the same schedule. No metadata field is executable.
  const afterCommit = cell.afterCommit;
  cell.afterCommit = null;
  if (afterCommit) afterCommit();
  if (fault === 'after_write') throw new Error('Synthetic response lost.');
  return true;
}

function createSyntheticJournal(plan, seed) {
  const initial = initialState(copyData(plan));
  let snapshot = {
    revision: 0, checkpoint: JSON.stringify({ schema: 1, revision: 0, plan: initial.plan, evidence: [], intent: null }),
  };
  // Deliberately allow malformed serialized checkpoints as corruption fixtures.
  // The controller must reject them, not repair or silently bootstrap them.
  if (seed !== undefined) {
    if (!seed || typeof seed !== 'object' || isProxy(seed) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(seed))) throw new Error('Invalid fixture.');
    const fields = Object.getOwnPropertyDescriptors(seed);
    if (Reflect.ownKeys(fields).length !== 2 || !['revision', 'checkpoint'].every((key) =>
      Object.hasOwn(fields, key) && Object.hasOwn(fields[key], 'value') && fields[key].enumerable)) {
      throw new Error('Invalid fixture.');
    }
    snapshot = { revision: fields.revision.value, checkpoint: fields.checkpoint.value };
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 ||
      typeof snapshot.checkpoint !== 'string') throw new Error('Invalid fixture.');
  }
  const cell = { ...snapshot, previous: null, previousRevision: null, writeFault: null, readFault: null, afterCommit: null };
  const journal = Object.freeze({
    snapshot: () => Object.freeze({ revision: cell.revision, checkpoint: cell.checkpoint }),
    afterNextCommit(callback) {
      if (typeof callback !== 'function' || isProxy(callback)) throw new Error('Invalid fixture schedule.');
      cell.afterCommit = callback;
    },
    faultNextWrite(fault) {
      if (!['before_write', 'after_write', 'drop_write'].includes(fault)) throw new Error('Invalid fixture fault.');
      cell.writeFault = fault;
    },
    faultNextRead(fault) {
      if (!['unavailable', 'corrupt', 'stale', 'stale_snapshot'].includes(fault)) throw new Error('Invalid fixture fault.');
      cell.readFault = fault;
    },
  });
  cells.set(journal, cell);
  return journal;
}

function createJournalController(inputPlan, journal) {
  let plan;
  let state;
  let doc;
  let recovery = 'invalid_plan';
  let needsReadback = true;
  const cell = cells.get(journal);
  try { plan = initialState(copyData(inputPlan)).plan; } catch { /* fixed status only */ }

  const result = (outcome) => Object.freeze({ outcome, phase: state ? state.phase : 'unavailable',
    recovery, revision: doc ? doc.revision : null, liveAuthority: false });
  function recover() {
    if (!plan) return result('invalid_plan');
    try {
      const loaded = decode(plan, read(cell));
      if (doc && loaded.doc.revision < doc.revision) throw new Error('Stale journal.');
      const failedIntent = recovery === 'failed' && doc && doc.intent && loaded.doc.intent &&
        isDeepStrictEqual(doc.evidence, loaded.doc.evidence) &&
        doc.intent.phase === loaded.doc.intent.phase;
      state = loaded.state;
      doc = loaded.doc;
      recovery = doc.intent ? (failedIntent || doc.intent.recovery === 'failed' ? 'failed' : 'ambiguous') : 'clear';
      needsReadback = false;
      return result('recovered');
    } catch {
      needsReadback = true;
      if (recovery !== 'failed') recovery = 'ambiguous';
      return result('journal_unavailable');
    }
  }

  const blocked = () => !plan ? 'invalid_plan' : needsReadback ? 'readback_required' :
    state.phase === 'retired' ? 'terminal_state' : null;

  function persist(candidate, outcome) {
    if (doc.revision === Number.MAX_SAFE_INTEGER) return result('revision_exhausted');
    candidate.revision = doc.revision + 1;
    const checkpoint = JSON.stringify(candidate);
    try {
      const written = compareAndSwap(cell, doc.revision, checkpoint);
      if (!written) {
        needsReadback = true;
        if (recovery !== 'failed') recovery = 'ambiguous';
        return result('stale_revision');
      }
    } catch { /* A lost response proves neither success nor failure. Read separately. */ }
    try {
      const snapshot = read(cell);
      if (snapshot.revision !== candidate.revision || snapshot.checkpoint !== checkpoint) {
        throw new Error('Unconfirmed write.');
      }
      const loaded = decode(plan, snapshot);
      state = loaded.state;
      doc = loaded.doc;
      recovery = doc.intent ? doc.intent.recovery : 'clear';
      return result(outcome);
    } catch {
      needsReadback = true;
      if (recovery !== 'failed') recovery = 'ambiguous';
      return result('readback_required');
    }
  }

  function binding(value, fields) {
    return exactFields(value, fields) && value.phase === PHASES[state.revision] && value.epoch === plan.epoch;
  }

  function acknowledge(input, reconciling) {
    const reason = blocked();
    if (reason) return result(reason);
    if (!doc.intent) return result('intent_required');
    if (!reconciling && recovery !== 'clear') return result('reconciliation_required');
    if (reconciling && recovery === 'clear') return result('reconciliation_not_required');
    try {
      const evidence = copyData(input);
      const next = apply(state, state.revision, evidence);
      if (next.outcome !== 'evidence_recorded') return result('invalid_evidence');
      return persist({ ...doc, evidence: next.state.evidence, intent: null }, reconciling ? 'reconciled' : 'evidence_recorded');
    } catch {
      // Uninspectable acknowledgement leaves the already-recorded intent held.
      recovery = recovery === 'failed' ? 'failed' : 'ambiguous';
      return result('reconciliation_required');
    }
  }

  if (plan) recover();
  return Object.freeze({
    status: () => result(!plan ? 'invalid_plan' : needsReadback ? 'readback_required' : 'status'),
    recover,
    begin(input) {
      const reason = blocked();
      if (reason) return result(reason);
      if (doc.intent) return result('reconciliation_required');
      let intent;
      try { intent = copyData(input); } catch { return result('invalid_intent'); }
      if (!binding(intent, ['phase', 'epoch'])) return result('invalid_intent');
      return persist({ ...doc, intent: { ...intent, recovery: 'clear' } }, 'intent_recorded');
    },
    acknowledge: (evidence) => acknowledge(evidence, false),
    reconcile: (evidence) => acknowledge(evidence, true),
    observe(input) {
      const reason = blocked();
      if (reason) return result(reason);
      if (!doc.intent) return result('intent_required');
      let observation;
      try { observation = copyData(input); } catch { return result('invalid_observation'); }
      if (!binding(observation, ['phase', 'epoch', 'outcome']) ||
        !['failed', 'ambiguous'].includes(observation.outcome)) return result('invalid_observation');
      const held = recovery === 'failed' ? 'failed' : observation.outcome;
      // Retain the local failed hold even if recording it loses its response.
      recovery = held;
      return persist({ ...doc, intent: { ...doc.intent, recovery: held } }, 'reconciliation_required');
    },
  });
}

module.exports = { createSyntheticJournal, createJournalController };
