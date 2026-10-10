'use strict';

// TEST-ONLY metadata reference model for the report header pair. Never import
// from runtime adapters or export from the migration package. No credential
// material, authentication, generation, IO, persistence or activation exists here.
// Acknowledgements are invented evidence, not authenticated attestations. Epoch,
// source and configuration generations model freshness; they do not prove it.
const CONSUMERS = {
  revenue_desk_call_worker: { role: 'report_sender', variable: 'CRM_BILLING_SHARED_HEADER_VALUE' },
  crm_billing_orchestrator: { role: 'report_receiver', variable: 'REPORT_SUMMARY_HEADER_VALUE' },
};
const SENDER = 'revenue_desk_call_worker';
const RECEIVER = 'crm_billing_orchestrator';

// Each step consumes a complete, exact acknowledgement set atomically. The
// receiver is new-only before the sender switches; dispatch stays contained.
// Readiness does not assert retirement, resume dispatch or authorize a cutover.
// Ordinary and compromised old versions both use this strict path: neither has
// an overlap or rollback step. Retirement names the old version at the new config.
const STEPS = [
  { phase: 'quiesced', version: 'old', checks: {
    [SENDER]: { dispatch: 'contained', inFlight: 'reconciled' },
    [RECEIVER]: { mutations: 'contained', inFlight: 'reconciled' },
  } },
  { phase: 'receiver_acknowledged', version: 'new', checks: {
    [RECEIVER]: { acceptance: 'new_only', readback: 'confirmed' },
  } },
  { phase: 'sender_acknowledged', version: 'new', checks: {
    [SENDER]: { emission: 'new_only', readback: 'confirmed' },
  } },
  { phase: 'ready', version: 'new', checks: {
    [RECEIVER]: {
      newAuthentication: 'passed', oldAuthentication: 'rejected',
      reportToPaidAuthentication: 'rejected', paidToReportAuthentication: 'rejected',
    },
  } },
  { phase: 'old_acceptance_disabled', version: 'new', checks: {
    [SENDER]: { oldUse: 'disabled', readback: 'confirmed' },
    [RECEIVER]: { oldAcceptance: 'disabled', readback: 'confirmed' },
  } },
  { phase: 'retired', version: 'old', targetConfiguration: true, checks: {
    [SENDER]: { oldMaterial: 'retired', revocation: 'confirmed', readback: 'confirmed' },
    [RECEIVER]: { oldMaterial: 'retired', revocation: 'confirmed', readback: 'confirmed' },
  } },
];

function record(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === fields.length && fields.every((field) =>
    Object.hasOwn(descriptors, field) && Object.hasOwn(descriptors[field], 'value') && descriptors[field].enumerable);
}

function denseArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (!Object.hasOwn(descriptors, i) || !Object.hasOwn(descriptors[i], 'value') || !descriptors[i].enumerable) return false;
  }
  return true;
}

const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const syntheticSource = (value) => typeof value === 'string' && /^synthetic-[a-z0-9-]{1,80}$/.test(value);

function planValid(plan) {
  if (!record(plan, ['purpose', 'strategy', 'epoch', 'oldVersion', 'newVersion', 'oldStatus', 'consumers']) ||
      plan.purpose !== 'report_header_authentication' || plan.strategy !== 'quiesced_single_key' ||
      !positiveInteger(plan.epoch) || !positiveInteger(plan.oldVersion) || !positiveInteger(plan.newVersion) ||
      plan.newVersion <= plan.oldVersion || !['ordinary', 'compromised'].includes(plan.oldStatus) ||
      !denseArray(plan.consumers) || plan.consumers.length !== 2) return false;
  const seen = new Set();
  return plan.consumers.every((consumer) => {
    if (!record(consumer, ['consumer', 'role', 'variable', 'oldSource', 'newSource',
      'oldConfigurationGeneration', 'newConfigurationGeneration']) ||
        typeof consumer.consumer !== 'string' || !Object.hasOwn(CONSUMERS, consumer.consumer) ||
        seen.has(consumer.consumer)) return false;
    seen.add(consumer.consumer);
    const expected = CONSUMERS[consumer.consumer];
    return consumer.role === expected.role && consumer.variable === expected.variable &&
      syntheticSource(consumer.oldSource) && syntheticSource(consumer.newSource) &&
      positiveInteger(consumer.oldConfigurationGeneration) && positiveInteger(consumer.newConfigurationGeneration) &&
      consumer.newConfigurationGeneration > consumer.oldConfigurationGeneration;
  });
}

function evidenceValid(plan, step, evidence) {
  if (!record(evidence, ['phase', 'epoch', 'acknowledgements']) || evidence.phase !== step.phase ||
      evidence.epoch !== plan.epoch || !denseArray(evidence.acknowledgements) ||
      evidence.acknowledgements.length !== Object.keys(step.checks).length) return false;
  const seen = new Set();
  return evidence.acknowledgements.every((ack) => {
    if (!record(ack, ['consumer', 'role', 'version', 'source', 'epoch', 'phase',
      'configurationGeneration', 'checks']) || typeof ack.consumer !== 'string' ||
        !Object.hasOwn(step.checks, ack.consumer) || seen.has(ack.consumer)) return false;
    seen.add(ack.consumer);
    const consumer = plan.consumers.find((item) => item.consumer === ack.consumer);
    const configuration = step.targetConfiguration ? 'new' : step.version;
    const expectedChecks = step.checks[ack.consumer];
    return ack.role === consumer.role && ack.version === plan[`${step.version}Version`] &&
      ack.source === consumer[`${configuration}Source`] && ack.epoch === plan.epoch &&
      ack.phase === step.phase && ack.configurationGeneration === consumer[`${configuration}ConfigurationGeneration`] &&
      record(ack.checks, Object.keys(expectedChecks)) &&
      Object.keys(expectedChecks).every((key) => ack.checks[key] === expectedChecks[key]);
  });
}

function stateValid(state) {
  if (!record(state, ['revision', 'phase', 'plan', 'evidence']) || !planValid(state.plan) ||
      !denseArray(state.evidence) || state.evidence.length > STEPS.length ||
      state.revision !== state.evidence.length ||
      state.phase !== (state.revision === 0 ? 'planned' : STEPS[state.revision - 1].phase)) return false;
  // Revalidate the whole prefix: a claimed ready/retired phase without its exact
  // preceding evidence must not bypass containment, acknowledgements or checks.
  return state.evidence.every((entry, index) => evidenceValid(state.plan, STEPS[index], entry));
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

const copyEvidence = (evidence) => ({
  ...evidence, acknowledgements: evidence.acknowledgements.map((ack) => ({ ...ack, checks: { ...ack.checks } })),
});

function initialState(plan) {
  if (!planValid(plan)) throw new TypeError('Invalid synthetic report rollout plan.');
  return freeze({
    revision: 0, phase: 'planned',
    plan: { ...plan, consumers: plan.consumers.map((consumer) => ({ ...consumer })) }, evidence: [],
  });
}

function apply(state, expectedRevision, evidence) {
  // Every outcome, including rejection and retirement, explicitly grants no
  // authority. There is no activate/resume/rollback or credential-write command.
  const result = (next, outcome) => ({ state: next, outcome, liveAuthority: false });
  if (!stateValid(state) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    return result(state, 'invalid_input');
  }
  if (expectedRevision !== state.revision) return result(state, 'stale_revision');
  if (state.revision === STEPS.length) return result(state, 'terminal_state');
  if (!evidenceValid(state.plan, STEPS[state.revision], evidence)) return result(state, 'invalid_evidence');
  return result(freeze({
    revision: state.revision + 1, phase: evidence.phase,
    plan: { ...state.plan, consumers: state.plan.consumers.map((consumer) => ({ ...consumer })) },
    evidence: [...state.evidence.map(copyEvidence), copyEvidence(evidence)],
  }), 'evidence_recorded');
}

module.exports = { initialState, apply };
