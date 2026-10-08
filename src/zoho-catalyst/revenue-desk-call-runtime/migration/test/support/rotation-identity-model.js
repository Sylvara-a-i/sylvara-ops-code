'use strict';

// TEST-ONLY REFERENCE MODEL. Never import from deployed adapters or export from
// the migration package. No credentials, signing, storage, SDK, randomness or IO.
// sourceVerified models a separately trusted adapter prerequisite; a Boolean is
// NOT production authorization. binding is a synthetic immutable equality marker,
// NOT integrity verification, safe payload storage, or a production fingerprint.
// The authoritative anchor includes entity/operation kind and stable business
// revision; it is independent of lookup keys and retained across retries.

const KEY_STATES = ['active', 'lookup_only', 'retired', 'compromised'];
const CLAIM_STATES = ['processing', 'succeeded', 'reconciliation_required', 'tombstone'];

function record(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return required.every((key) => Object.hasOwn(descriptors, key)) &&
    Reflect.ownKeys(descriptors).every((key) => [...required, ...optional].includes(key) &&
      Object.hasOwn(descriptors[key], 'value'));
}

function denseArray(value) {
  if (!Array.isArray(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) return false;
  for (let position = 0; position < value.length; position += 1) {
    if (!Object.hasOwn(descriptors, position) || !Object.hasOwn(descriptors[position], 'value')) return false;
  }
  return true;
}

function text(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value;
}

function scopeValid(scope) {
  return record(scope, ['tenant', 'environment']) && text(scope.tenant) && text(scope.environment);
}

function indexValid(index) {
  return record(index, ['domain', 'kid', 'status']) && text(index.domain) && text(index.kid) &&
    KEY_STATES.includes(index.status);
}

function aliasValid(alias) {
  return record(alias, ['domain', 'kid', 'digest']) && text(alias.domain) && text(alias.kid) &&
    typeof alias.digest === 'string' && /^[a-f0-9]{64}$/.test(alias.digest);
}

const scopeTuple = (scope) => [scope.tenant, scope.environment];
const anchorKey = (scope, anchor) => JSON.stringify([...scopeTuple(scope), anchor]);
const canonicalKey = (scope, canonicalId) => JSON.stringify([...scopeTuple(scope), canonicalId]);
const indexKey = (index) => JSON.stringify([index.domain, index.kid]);
const aliasKey = (scope, alias) => JSON.stringify([...scopeTuple(scope), alias.domain, alias.kid, alias.digest]);
const unique = (values) => new Set(values).size === values.length;

function stateValid(state) {
  if (!record(state, ['revision', 'claims', 'aliases', 'indexKeys']) ||
      !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      !denseArray(state.claims) || !denseArray(state.aliases) || !denseArray(state.indexKeys) ||
      !state.indexKeys.every(indexValid) || !unique(state.indexKeys.map(indexKey))) return false;
  if (!state.claims.every((claim) => record(claim, ['scope', 'anchor', 'canonicalId', 'binding', 'status']) &&
      scopeValid(claim.scope) && text(claim.anchor) && text(claim.canonicalId) && text(claim.binding) &&
      CLAIM_STATES.includes(claim.status)) ||
      !unique(state.claims.map((claim) => anchorKey(claim.scope, claim.anchor))) ||
      !unique(state.claims.map((claim) => canonicalKey(claim.scope, claim.canonicalId)))) return false;
  return state.aliases.every((alias) => {
    if (!record(alias, ['scope', 'domain', 'kid', 'digest', 'anchor', 'canonicalId']) ||
        !scopeValid(alias.scope) || !aliasValid({ domain: alias.domain, kid: alias.kid, digest: alias.digest })) return false;
    const claim = state.claims.find((item) => anchorKey(item.scope, item.anchor) === anchorKey(alias.scope, alias.anchor));
    return claim && claim.canonicalId === alias.canonicalId &&
      state.indexKeys.some((index) => indexKey(index) === indexKey(alias));
  }) && unique(state.aliases.map((alias) => aliasKey(alias.scope, alias)));
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function copyState(state) {
  return {
    revision: state.revision,
    claims: state.claims.map((claim) => ({ ...claim, scope: { ...claim.scope } })),
    aliases: state.aliases.map((alias) => ({ ...alias, scope: { ...alias.scope } })),
    indexKeys: state.indexKeys.map((index) => ({ ...index })),
  };
}

function initialState(indexKeys) {
  if (!denseArray(indexKeys) || !indexKeys.every(indexValid) || !unique(indexKeys.map(indexKey))) {
    throw new TypeError('Invalid synthetic index registry.');
  }
  return freeze({ revision: 0, claims: [], aliases: [], indexKeys: indexKeys.map((index) => ({ ...index })) });
}

function commandValid(command) {
  if (!record(command, ['type'], ['scope', 'anchor', 'binding', 'aliases', 'sourceVerified',
    'normalizedInputAvailable', 'canonicalId', 'domain', 'kid', 'status'])) return false;
  if (command.type === 'set_index_status') {
    return record(command, ['type', 'domain', 'kid', 'status', 'sourceVerified']) &&
      indexValid({ domain: command.domain, kid: command.kid, status: command.status }) &&
      typeof command.sourceVerified === 'boolean';
  }
  if (command.type === 'finish') {
    return record(command, ['type', 'scope', 'anchor', 'status', 'sourceVerified']) &&
      scopeValid(command.scope) && text(command.anchor) &&
      CLAIM_STATES.includes(command.status) && command.status !== 'processing' &&
      typeof command.sourceVerified === 'boolean';
  }
  return record(command, ['type', 'scope', 'anchor', 'binding', 'aliases', 'sourceVerified', 'normalizedInputAvailable'], ['canonicalId']) &&
    command.type === 'claim' && scopeValid(command.scope) && text(command.anchor) && text(command.binding) &&
    (!Object.hasOwn(command, 'canonicalId') || text(command.canonicalId)) &&
    denseArray(command.aliases) && command.aliases.length > 0 && command.aliases.every(aliasValid) &&
    unique(command.aliases.map((alias) => aliasKey(command.scope, alias))) &&
    typeof command.sourceVerified === 'boolean' && typeof command.normalizedInputAvailable === 'boolean';
}

function apply(state, expectedRevision, command) {
  const reject = (outcome) => ({ state, outcome });
  if (!stateValid(state) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !commandValid(command)) {
    return reject('invalid_input');
  }
  if (!command.sourceVerified) return reject('unverified_source');
  if (expectedRevision !== state.revision) return reject('stale_revision');
  const commit = (next, outcome, canonicalId) => {
    if (state.revision === Number.MAX_SAFE_INTEGER) return reject('revision_exhausted');
    next.revision += 1;
    return { state: freeze(next), outcome, ...(canonicalId === undefined ? {} : { canonicalId }) };
  };

  if (command.type === 'set_index_status') {
    const position = state.indexKeys.findIndex((index) => indexKey(index) === indexKey(command));
    if (position < 0) return reject('index_unavailable');
    const current = state.indexKeys[position].status;
    if (KEY_STATES.indexOf(command.status) < KEY_STATES.indexOf(current)) return reject('key_rollback_rejected');
    if (current === command.status) return reject('unchanged');
    const next = copyState(state);
    next.indexKeys[position].status = command.status;
    return commit(next, 'index_status_changed');
  }

  const position = state.claims.findIndex((claim) => anchorKey(claim.scope, claim.anchor) === anchorKey(command.scope, command.anchor));
  const claim = state.claims[position];
  if (command.type === 'finish') {
    if (!claim) return reject('claim_missing');
    if (claim.status !== 'processing') return reject('terminal_claim');
    const next = copyState(state);
    next.claims[position].status = command.status;
    return commit(next, command.status, claim.canonicalId);
  }

  const additions = [];
  for (const alias of command.aliases) {
    const index = state.indexKeys.find((item) => indexKey(item) === indexKey(alias));
    if (!index || index.status === 'retired' || index.status === 'compromised') return reject('index_unavailable');
    const existing = state.aliases.find((item) => aliasKey(item.scope, item) === aliasKey(command.scope, alias));
    if (existing && (existing.anchor !== command.anchor || !claim || existing.canonicalId !== claim.canonicalId)) {
      return reject('alias_conflict');
    }
    if (!existing) {
      if (index.status !== 'active') return reject('index_read_only');
      additions.push(alias);
    }
  }
  if (claim && claim.binding !== command.binding) return reject('binding_conflict');
  if (claim && command.canonicalId !== undefined && command.canonicalId !== claim.canonicalId) return reject('canonical_conflict');
  if (!claim && (!command.canonicalId || state.claims.some((item) =>
    canonicalKey(item.scope, item.canonicalId) === canonicalKey(command.scope, command.canonicalId)))) {
    return reject(command.canonicalId ? 'canonical_conflict' : 'invalid_input');
  }
  if ((!claim || additions.length > 0) && !command.normalizedInputAvailable) return reject('missing_normalized_input');
  if (claim && additions.length === 0) return { state, outcome: claim.status, canonicalId: claim.canonicalId };

  const canonicalId = claim ? claim.canonicalId : command.canonicalId;
  const next = copyState(state);
  if (!claim) next.claims.push({ scope: { ...command.scope }, anchor: command.anchor, canonicalId, binding: command.binding, status: 'processing' });
  additions.forEach((alias) => next.aliases.push({ ...alias, scope: { ...command.scope }, anchor: command.anchor, canonicalId }));
  // 'new' is a model disposition, not permission to perform a paid side effect.
  // Every retry reports durable state only; there is no lease/reclaim operation.
  return commit(next, claim ? claim.status : 'new', canonicalId);
}

module.exports = { initialState, apply };
