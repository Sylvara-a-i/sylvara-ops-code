'use strict';

// TEST ONLY: an in-memory failure latch around the existing metadata model.
// No adapter, IO, credentials, persistence, retry, restore or live authority.
const { initialState, apply } = require('./rotation-rollout-model');
const { types: { isProxy } } = require('node:util');

// Phase names locate observations only. The existing model owns every evidence
// check and transition, including containment, single-key order and retirement.
const PHASES = [
  'quiesced', 'receiver_acknowledged', 'sender_acknowledged', 'ready',
  'old_acceptance_disabled', 'retired',
];

// Bound the metadata graph before delegating schema validation. Proxy traps can
// reenter this rehearsal or change a value between the model's check and copy.
// Never invoke them, accessors, or functions; valid model inputs fit four levels.
function inert(value, depth = 0) {
  if (value === null || typeof value !== 'object') return typeof value !== 'function';
  if (depth > 4 || isProxy(value)) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(fields).every((key) => Object.hasOwn(fields[key], 'value') &&
    inert(fields[key].value, depth + 1));
}

function observationOutcome(value, state) {
  if (!value || typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
  const fields = Object.getOwnPropertyDescriptors(value);
  const valid = Reflect.ownKeys(fields).length === 3 && ['phase', 'epoch', 'outcome'].every((key) =>
    Object.hasOwn(fields, key) && Object.hasOwn(fields[key], 'value') && fields[key].enumerable) &&
    fields.phase.value === PHASES[state.revision] && fields.epoch.value === state.plan.epoch &&
    ['failed', 'ambiguous'].includes(fields.outcome.value);
  return valid ? fields.outcome.value : null;
}

function createRehearsal(plan) {
  let state;
  let recovery = 'clear';
  try {
    if (!inert(plan)) throw new TypeError('Invalid synthetic metadata.');
    state = initialState(plan);
  } catch {
    recovery = 'invalid_plan';
  }

  // Never return the underlying plan, evidence, inputs or exception text. Even
  // accepted synthetic source labels could carry caller-controlled text.
  const result = (outcome) => Object.freeze({
    outcome, phase: state && ['planned', ...PHASES].includes(state.phase) ? state.phase : 'unavailable',
    recovery, liveAuthority: false,
  });
  const blocked = () => !state ? 'invalid_plan' : state.phase === 'retired' ? 'terminal_state' : null;

  function advance(evidence, reconciling) {
    const reason = blocked();
    if (reason) return result(reason);
    if (!reconciling && recovery !== 'clear') return result('reconciliation_required');
    if (reconciling && recovery === 'clear') return result('reconciliation_not_required');
    try {
      if (!inert(evidence)) throw new TypeError('Invalid synthetic metadata.');
      const next = apply(state, state.revision, evidence);
      if (next.outcome !== 'evidence_recorded') return result('invalid_evidence');
      state = next.state;
      recovery = 'clear';
      return result(reconciling ? 'reconciled' : 'evidence_recorded');
    } catch {
      // An interrupted observation is unknown, never proof that nothing happened.
      // Preserve any existing failed/ambiguous hold until explicit reconciliation.
      if (recovery === 'clear') recovery = 'ambiguous';
      return result('reconciliation_required');
    }
  }

  return Object.freeze({
    status: () => result(state ? 'status' : 'invalid_plan'),
    advance: (evidence) => advance(evidence, false),
    reconcile: (evidence) => advance(evidence, true),
    observe(value) {
      const reason = blocked();
      if (reason) return result(reason);
      try {
        if (isProxy(value)) throw new TypeError('Invalid synthetic metadata.');
        const outcome = observationOutcome(value, state);
        if (!outcome) return result('invalid_observation');
        if (recovery === 'clear') recovery = outcome;
        return result('reconciliation_required');
      } catch {
        if (recovery === 'clear') recovery = 'ambiguous';
        return result('reconciliation_required');
      }
    },
    restart() {
      const reason = blocked();
      if (reason) return result(reason);
      // Synthetic crash/restart signal only: retain this in-memory prefix, mark
      // the next phase unknown, and require readback evidence. No durability claim.
      if (recovery === 'clear') recovery = 'ambiguous';
      return result('reconciliation_required');
    },
  });
}

module.exports = { createRehearsal };
