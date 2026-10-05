'use strict';
// Off-path experiment. Injected in-memory query model only; no SDK or transport.
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])));
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const token = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...names].sort().join(',');
const text = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const held = reason => ({ status: 'held', reason, retry: false, externalEffectsAllowed: false });
const unknown = reason => ({ status: 'unknown', reason, retry: false, externalEffectsAllowed: false });
const STATE_KEYS = ['schema', 'identity', 'version', 'fence', 'status', 'ownerToken', 'operation', 'leaseUntil', 'effect', 'result'];
const BINDING_KEYS = ['projectId', 'environment', 'table', 'rowId', 'clientId', 'testId', 'reportRevision', 'sourceRevision'];
function bindingIdentity(binding) {
  if (!keys(binding, BINDING_KEYS) || !/^[1-9][0-9]{0,24}$/.test(binding.projectId)
    || binding.environment !== 'development' || binding.table !== 'ReportCoordinatorExperimental'
    || !/^[1-9][0-9]{0,24}$/.test(binding.rowId) || !text(binding.clientId) || !text(binding.testId)
    || !hex(binding.reportRevision) || !hex(binding.sourceRevision)) throw Error('MODEL_BINDING_HELD');
  return hash(canonical(binding));
}
function seed(binding) {
  return { schema: 1, identity: bindingIdentity(binding), version: 1, fence: 0, status: 'seeded',
    ownerToken: null, operation: null, leaseUntil: 0, effect: null, result: null };
}
function valid(state, identity) {
  if (!keys(state, STATE_KEYS) || state.schema !== 1 || state.identity !== identity
    || !count(state.version) || state.version < 1 || !count(state.fence) || state.version <= state.fence || !count(state.leaseUntil)
    || !['seeded', 'owned', 'external_pending', 'external_unknown', 'committed'].includes(state.status)) return false;
  if (state.status === 'seeded') return state.version === 1 && state.fence === 0 && state.ownerToken === null && state.operation === null
    && state.leaseUntil === 0 && state.effect === null && state.result === null;
  if (!token(state.ownerToken) || !hex(state.operation) || state.fence < 1 || state.leaseUntil < 1) return false;
  if (state.status === 'owned') return state.effect === null && state.result === null;
  if (!keys(state.effect, ['id', 'contentHash']) || !hex(state.effect.id) || !hex(state.effect.contentHash)) return false;
  if (state.status !== 'committed') return state.result === null;
  return keys(state.result, ['effectId', 'contentHash', 'reference']) && state.result.effectId === state.effect.id
    && state.result.contentHash === state.effect.contentHash && text(state.result.reference);
}
function transition(current, command, identity, now) {
  if (!valid(current, identity)) return held('missing_or_invalid_seed');
  if (!command || command.identity !== identity || !count(now)) return held('identity_or_clock');
  if (command.type === 'claim' && current.status === 'committed') return { status: 'accepted', record: structuredClone(current), externalEffectsAllowed: false };
  if (current.version === Number.MAX_SAFE_INTEGER || current.fence === Number.MAX_SAFE_INTEGER) return held('counter_exhausted');
  const next = { ...structuredClone(current), version: current.version + 1 };
  if (command.type === 'claim') {
    if (['external_pending', 'external_unknown'].includes(current.status)) return held('unresolved_external_effect');
    if (!token(command.ownerToken) || !hex(command.operation) || !count(command.leaseMs)
      || command.leaseMs < 1 || command.leaseMs > 60000 || !count(now + command.leaseMs)) return held('invalid_claim');
    if (current.status === 'owned' && (now < current.leaseUntil || command.ownerToken === current.ownerToken)) return held('busy_or_reused_token');
    return { status: 'write', next: { ...next, status: 'owned', fence: current.fence + 1,
      ownerToken: command.ownerToken, operation: command.operation, leaseUntil: now + command.leaseMs } };
  }
  if (command.ownerToken !== current.ownerToken || command.operation !== current.operation || command.fence !== current.fence) return held('stale_owner');
  if (command.type === 'begin_external') {
    if (current.status !== 'owned' || now >= current.leaseUntil || !hex(command.effectId) || !hex(command.contentHash)) return held('external_intent_held');
    return { status: 'write', next: { ...next, status: 'external_pending', effect: { id: command.effectId, contentHash: command.contentHash } } };
  }
  if (command.type === 'mark_unknown') {
    if (current.status !== 'external_pending') return held('unknown_transition_held');
    return { status: 'write', next: { ...next, status: 'external_unknown' } };
  }
  if (command.type === 'complete') {
    // Synthetic assertion only; real stored-content evidence needs independent qualification.
    const proof = command.modelEvidence;
    if (!keys(proof, ['independentlyVerified', 'effectId', 'contentHash', 'reference']) || proof.independentlyVerified !== true
      || !current.effect || proof.effectId !== current.effect.id || proof.contentHash !== current.effect.contentHash || !text(proof.reference)) return held('unverified_result');
    const result = { effectId: proof.effectId, contentHash: proof.contentHash, reference: proof.reference };
    if (current.status === 'committed') return canonical(current.result) === canonical(result)
      ? { status: 'accepted', record: structuredClone(current), externalEffectsAllowed: false } : held('conflicting_result');
    if (!['external_pending', 'external_unknown'].includes(current.status)) return held('result_transition_held');
    return { status: 'write', next: { ...next, status: 'committed', result } };
  }
  return held('unsupported_transition');
}
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
function columns(binding, state) {
  return { ROWID: binding.rowId, SeedIdentity: state.identity, Version: state.version,
    OwnerToken: state.ownerToken, Fence: state.fence, StateJson: canonical(state) };
}
function decode(result, binding, identity) {
  if (!Array.isArray(result) || result.length !== 1) throw Error('MODEL_ROW_HELD');
  const row = result[0]?.[binding.table];
  if (!keys(row, ['ROWID', 'SeedIdentity', 'Version', 'OwnerToken', 'Fence', 'StateJson'])
    || String(row.ROWID) !== binding.rowId || row.SeedIdentity !== identity || !count(row.Version)
    || !count(row.Fence) || typeof row.StateJson !== 'string' || Buffer.byteLength(row.StateJson) > 9500) throw Error('MODEL_ROW_HELD');
  const state = JSON.parse(row.StateJson);
  if (!valid(state, identity) || canonical(state) !== row.StateJson || state.version !== row.Version
    || state.fence !== row.Fence || state.ownerToken !== row.OwnerToken) throw Error('MODEL_ROW_HELD');
  return state;
}
function createCandidate({ binding, modelQuery, experimentalModel = false } = {}) {
  if (experimentalModel !== true || typeof modelQuery !== 'function') throw Error('MODEL_ONLY_DISABLED');
  binding = Object.freeze(structuredClone(binding));
  const identity = bindingIdentity(binding);
  const readSql = `SELECT ROWID, SeedIdentity, Version, OwnerToken, Fence, StateJson FROM ${binding.table} WHERE ROWID = ${binding.rowId} LIMIT 2`;
  async function dispatch(kind, sql) { return modelQuery(Object.freeze({ kind, sql, projectId: binding.projectId,
    environment: binding.environment, retry: false, providerQualified: false })); }
  async function read() { return decode(await dispatch('read', readSql), binding, identity); }
  async function execute(command, clock) {
    let current;
    try { current = await read(); } catch { return held('seed_read_unknown_or_missing'); }
    let now;
    try { now = clock(); } catch { return held('clock_required'); }
    const plan = transition(current, command, identity, now);
    if (plan.status !== 'write') return plan;
    const next = plan.next, row = columns(binding, next), old = columns(binding, current);
    const render = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : quote(value);
    const set = Object.entries(row).filter(([key]) => key !== 'ROWID').map(([key, value]) => `${key} = ${render(value)}`).join(', ');
    const predicate = Object.entries(old).map(([key, value]) => value === null ? `${key} IS NULL`
      : `${key} = ${key === 'ROWID' ? value : render(value)}`).join(' AND ');
    const sql = `UPDATE ${binding.table} SET ${set} WHERE ${predicate}`;
    let ack = 'unknown';
    try {
      const response = await dispatch('conditional_update', sql);
      if (Array.isArray(response) && response.length === 0) ack = 'zero_match_shape';
      else ack = canonical(decode(response, binding, identity)) === canonical(next) ? 'acknowledged' : 'contradictory';
    } catch { /* Could have committed. Never redispatch the update. */ }
    let after;
    try { after = await read(); } catch { return unknown('write_readback_unknown_or_seed_missing'); }
    if (canonical(after) !== canonical(next)) return ack === 'zero_match_shape'
      ? held('not_owner_or_no_change') : unknown('write_not_verified');
    if (ack === 'zero_match_shape' || ack === 'contradictory') return unknown('contradictory_update_response');
    let finished;
    try { finished = clock(); } catch { return unknown('clock_readback_unknown'); }
    if (!count(finished) || finished < now) return held('clock_regressed');
    if (['claim', 'begin_external'].includes(command.type) && finished >= after.leaseUntil) return held('expired_during_readback');
    return { status: 'verified_in_model', record: after, acknowledgement: ack, retry: false,
      providerQualified: false, externalEffectsAllowed: false };
  }
  return Object.freeze({ identity, read, execute, providerQualified: false, externalEffectsAllowed: false });
}
module.exports = { createCandidate, seed, transition, columns, canonical, hash };
