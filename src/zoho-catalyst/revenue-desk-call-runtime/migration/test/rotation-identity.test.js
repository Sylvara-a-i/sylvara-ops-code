'use strict';

const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const test = require('node:test');
const { initialState, apply } = require('./support/rotation-identity-model');

// Fully invented fixtures only. This HMAC helper creates lookup aliases for the
// tests; the model does not implement production normalization or key custody.
const SCOPE = { tenant: 'synthetic-tenant-a', environment: 'synthetic-development' };
const DOMAIN = 'synthetic-report-operation-lookup-v1';
const OTHER_DOMAIN = 'synthetic-call-lookup-v1';
const ANCHOR = 'report:synthetic-deal-a:business-revision-1';
const CANONICAL = 'historical-opaque-operation-a';

function alias(kid = 'index-old', input = 'synthetic-normalized-operation-a', domain = DOMAIN, scope = SCOPE) {
  return {
    domain, kid,
    digest: createHmac('sha256', 'synthetic-only-hmac-material-000000000000-' + kid)
      .update(JSON.stringify([scope.tenant, scope.environment, domain, input])).digest('hex'),
  };
}

function empty() {
  return initialState([
    { domain: DOMAIN, kid: 'index-old', status: 'active' },
    { domain: DOMAIN, kid: 'index-new', status: 'active' },
    { domain: OTHER_DOMAIN, kid: 'index-old', status: 'active' },
  ]);
}

function claim(overrides = {}) {
  return {
    type: 'claim', scope: { ...SCOPE }, anchor: ANCHOR, canonicalId: CANONICAL,
    binding: 'synthetic-immutable-binding-a', aliases: [alias()],
    sourceVerified: true, normalizedInputAvailable: true, ...overrides,
  };
}

function retry(overrides = {}) {
  const { canonicalId, ...command } = claim(overrides);
  return command;
}

function finish(status, overrides = {}) {
  return { type: 'finish', scope: { ...SCOPE }, anchor: ANCHOR, status, sourceVerified: true, ...overrides };
}

function keyStatus(status, overrides = {}) {
  return { type: 'set_index_status', domain: DOMAIN, kid: 'index-old', status, sourceVerified: true, ...overrides };
}

const run = (state, command) => apply(state, state.revision, command);

function rejected(state, command, outcome, revision = state.revision) {
  const before = structuredClone(state);
  const result = apply(state, revision, command);
  assert.equal(result.outcome, outcome);
  assert.strictEqual(result.state, state);
  assert.deepEqual(state, before, 'rejection must not partly mutate any state');
  assert.equal(Object.hasOwn(result, 'canonicalId'), false);
  return result;
}

test('test-only interface returns immutable copies and preserves historical opaque ID', () => {
  const state = empty();
  const command = claim();
  const commandBefore = structuredClone(command);
  const result = run(state, command);
  assert.equal(result.outcome, 'new');
  assert.equal(result.canonicalId, CANONICAL);
  assert.equal(result.state.claims[0].status, 'processing');
  assert.equal(result.state.revision, 1);
  assert.deepEqual(state, empty());
  assert.deepEqual(command, commandBefore);
  assert.equal(Object.isFrozen(command.scope), false);
  assert.ok(Object.isFrozen(result.state.claims[0]));
  assert.throws(() => { result.state.claims[0].canonicalId = 'other'; }, TypeError);
  assert.equal(Object.hasOwn(result, 'sideEffectAuthorized'), false);
  assert.equal(Object.hasOwn(require('..'), 'initialState'), false);
});

test('sequential old/new indexes converge; exact alias replay needs no normalized input', () => {
  const first = run(empty(), claim());
  const second = run(first.state, retry({ aliases: [alias('index-new')] }));
  assert.equal(second.outcome, 'processing');
  assert.equal(second.canonicalId, CANONICAL);
  assert.equal(second.state.claims.length, 1);
  assert.equal(second.state.aliases.length, 2);
  for (const kid of ['index-old', 'index-new']) {
    const replay = run(second.state, retry({ aliases: [alias(kid)], normalizedInputAvailable: false }));
    assert.equal(replay.canonicalId, CANONICAL);
    assert.equal(replay.outcome, 'processing');
    assert.strictEqual(replay.state, second.state);
  }
});

test('auth signing-key changes are outside durable state; untrusted sources fail closed', () => {
  const first = run(empty(), claim());
  // Authentication is deliberately NOT implemented. These booleans represent
  // independently verified old/new authenticators at the adapter boundary.
  for (const independentlyVerifiedKey of ['synthetic-signing-old', 'synthetic-signing-new']) {
    assert.ok(independentlyVerifiedKey);
    const replay = run(first.state, retry({ sourceVerified: true }));
    assert.strictEqual(replay.state, first.state);
    assert.equal(replay.canonicalId, CANONICAL);
  }
  for (const command of [claim(), retry(), finish('succeeded'), keyStatus('retired')]) {
    // Includes unavailable/rejected signing keys and compromised-source attempts.
    rejected(first.state, { ...command, sourceVerified: false }, 'unverified_source');
  }
  rejected(first.state, retry({ scope: { ...SCOPE, tenant: 'synthetic-other-tenant' }, sourceVerified: false }), 'unverified_source');
});

test('disjoint concurrent aliases serialize under CAS and converge after reload', () => {
  for (const [firstKid, secondKid] of [['index-old', 'index-new'], ['index-new', 'index-old']]) {
    const state = empty();
    const winner = run(state, claim({ aliases: [alias(firstKid)] }));
    const competing = claim({ aliases: [alias(secondKid)], canonicalId: 'synthetic-competing-candidate' });
    rejected(winner.state, competing, 'stale_revision', state.revision);
    rejected(winner.state, competing, 'canonical_conflict');
    const reloaded = run(winner.state, retry({ aliases: [alias(secondKid)] }));
    assert.equal(reloaded.outcome, 'processing');
    assert.equal(reloaded.canonicalId, CANONICAL);
    assert.equal(reloaded.state.claims.length, 1);
    assert.equal(reloaded.state.aliases.length, 2);
    assert.equal(reloaded.state.revision, 2);
  }
});

test('alias namespace includes version, domain and tenant/environment scope', () => {
  const first = run(empty(), claim());
  const sameDigest = alias().digest;
  const versioned = run(first.state, retry({ aliases: [{ ...alias('index-new'), digest: sameDigest }] }));
  assert.equal(versioned.state.aliases.length, 2);
  assert.equal(versioned.state.claims.length, 1, 'version alone cannot create a second claim');
  const otherDomain = run(versioned.state, claim({
    anchor: 'call:synthetic-call-a:business-revision-1', canonicalId: 'synthetic-call-id',
    aliases: [{ ...alias('index-old', undefined, OTHER_DOMAIN), digest: sameDigest }],
  }));
  assert.equal(otherDomain.outcome, 'new');
  assert.equal(otherDomain.state.claims.length, 2);
  let state = otherDomain.state;
  for (const scope of [
    { ...SCOPE, tenant: 'synthetic-tenant-b' },
    { ...SCOPE, environment: 'synthetic-production' },
  ]) {
    // Identical alias bytes cannot resolve or modify another scope's claim.
    rejected(state, retry({ scope, normalizedInputAvailable: false }), 'invalid_input');
    const scoped = run(state, claim({ scope }));
    assert.equal(scoped.outcome, 'new');
    state = scoped.state;
  }
  assert.equal(state.claims.length, 4);
});

test('alias conflict and changed binding reject all additions without partial mutation', () => {
  const first = run(empty(), claim());
  const other = run(first.state, claim({
    anchor: 'report:synthetic-deal-b:business-revision-1', canonicalId: 'synthetic-operation-b',
    aliases: [alias('index-old', 'synthetic-normalized-operation-b')],
  }));
  rejected(other.state, retry({
    aliases: [alias('index-new'), alias('index-old', 'synthetic-normalized-operation-b')],
  }), 'alias_conflict');
  rejected(other.state, claim({
    anchor: 'report:synthetic-deal-c:business-revision-1', canonicalId: 'synthetic-operation-c',
  }), 'alias_conflict');
  rejected(first.state, retry({ aliases: [alias('index-new')], binding: 'synthetic-changed-payload' }), 'binding_conflict');
  rejected(first.state, claim({ canonicalId: 'synthetic-regenerated-on-retry' }), 'canonical_conflict');
  rejected(first.state, claim({
    anchor: 'report:synthetic-deal-b:business-revision-1', aliases: [alias('index-new', 'synthetic-b')],
  }), 'canonical_conflict');
});

test('missing normalized source can resolve an exact alias but cannot allocate or reindex', () => {
  rejected(empty(), claim({ normalizedInputAvailable: false }), 'missing_normalized_input');
  const first = run(empty(), claim());
  rejected(first.state, retry({ aliases: [alias('index-new')], normalizedInputAvailable: false }), 'missing_normalized_input');
  rejected(first.state, retry({
    aliases: [alias(), alias('index-new')], normalizedInputAvailable: false,
  }), 'missing_normalized_input');
  const replay = run(first.state, retry({ normalizedInputAvailable: false }));
  assert.equal(replay.outcome, 'processing');
  assert.equal(replay.canonicalId, CANONICAL);
});

test('lookup-only key resolves existing aliases but never allocates an alias or claim', () => {
  const first = run(empty(), claim());
  const state = run(first.state, keyStatus('lookup_only')).state;
  assert.equal(run(state, retry({ normalizedInputAvailable: false })).outcome, 'processing');
  rejected(state, claim({
    anchor: 'report:synthetic-deal-b:business-revision-1', canonicalId: 'synthetic-operation-b',
    aliases: [alias('index-old', 'synthetic-normalized-operation-b')],
  }), 'index_read_only');
  rejected(state, retry({ aliases: [alias('index-old', 'synthetic-other-input')] }), 'index_read_only');
  const next = run(state, retry({ aliases: [alias(), alias('index-new')] }));
  assert.equal(next.state.claims.length, 1);
  assert.equal(next.state.aliases.length, 2);
  rejected(next.state, keyStatus('active'), 'key_rollback_rejected');
});

test('terminal outcomes and delayed replays retain one claim and never grant a resumed write', () => {
  for (const status of ['succeeded', 'reconciliation_required', 'tombstone']) {
    const first = run(empty(), claim());
    const terminal = run(first.state, finish(status));
    assert.equal(terminal.outcome, status);
    rejected(terminal.state, finish('succeeded'), 'terminal_claim');
    rejected(terminal.state, { ...finish(status), status: 'processing' }, 'invalid_input');
    const replay = run(terminal.state, retry({ normalizedInputAvailable: false }));
    assert.equal(replay.outcome, status);
    assert.strictEqual(replay.state, terminal.state);
    const aliasAdded = run(terminal.state, retry({ aliases: [alias('index-new')] }));
    assert.equal(aliasAdded.outcome, status);
    assert.equal(aliasAdded.canonicalId, CANONICAL);
    assert.equal(aliasAdded.state.claims.length, 1);
    assert.equal(aliasAdded.state.claims[0].status, status);
    assert.equal(Object.hasOwn(aliasAdded, 'sideEffectAuthorized'), false);
  }
});

test('retirement preserves claims/tombstones; trusted active index survives compromise', () => {
  for (const status of ['retired', 'compromised']) {
    const first = run(empty(), claim());
    const tombstone = run(first.state, finish('tombstone')).state;
    const retired = run(tombstone, keyStatus(status)).state;
    assert.deepEqual(retired.claims, tombstone.claims);
    assert.deepEqual(retired.aliases, tombstone.aliases);
    rejected(retired, retry({ normalizedInputAvailable: false }), 'index_unavailable');
    rejected(retired, retry({ aliases: [alias(), alias('index-new')] }), 'index_unavailable');
    rejected(retired, keyStatus('active'), 'key_rollback_rejected');
    rejected(retired, keyStatus('lookup_only'), 'key_rollback_rejected');
    rejected(retired, retry({ aliases: [alias('index-new')], sourceVerified: false }), 'unverified_source');
    const restoredLookup = run(retired, retry({ aliases: [alias('index-new')] }));
    assert.equal(restoredLookup.outcome, 'tombstone');
    assert.equal(restoredLookup.canonicalId, CANONICAL);
    assert.equal(restoredLookup.state.claims.length, 1);
    assert.equal(restoredLookup.state.aliases.length, 2);
    rejected(restoredLookup.state, finish('succeeded'), 'terminal_claim');
    // Simulates a stale pre-retirement writer, not a restore of trusted storage.
    rejected(restoredLookup.state, keyStatus('active'), 'stale_revision', tombstone.revision);
    if (status === 'compromised') rejected(restoredLookup.state, keyStatus('retired'), 'key_rollback_rejected');
  }
});

test('finish uses CAS and exact scoped anchor; no implicit claim or reclaim exists', () => {
  rejected(empty(), finish('succeeded'), 'claim_missing');
  const first = run(empty(), claim());
  rejected(first.state, finish('succeeded'), 'stale_revision', 0);
  rejected(first.state, finish('succeeded', { scope: { ...SCOPE, tenant: 'synthetic-other-tenant' } }), 'claim_missing');
  rejected(first.state, { type: 'reclaim', sourceVerified: true }, 'invalid_input');
  assert.equal(run(first.state, finish('reconciliation_required')).state.claims[0].status, 'reconciliation_required');
});

test('malformed/missing inputs, unknown index and invalid registry fail closed', () => {
  const state = empty();
  for (const command of [
    null, {}, claim({ scope: null }), claim({ scope: { tenant: SCOPE.tenant } }),
    claim({ scope: { ...SCOPE, extra: true } }), claim({ anchor: '' }),
    claim({ binding: '' }), claim({ canonicalId: undefined }), retry(),
    claim({ aliases: [] }), claim({ aliases: [null] }), claim({ aliases: [alias(), alias()] }),
    claim({ aliases: [{ ...alias(), digest: 'not-an-hmac' }] }),
    claim({ aliases: [{ ...alias(), rawInput: 'synthetic-only' }] }),
    claim({ sourceVerified: 'true' }), claim({ normalizedInputAvailable: undefined }),
    claim({ unknownField: true }), keyStatus('unknown'),
  ]) rejected(state, command, 'invalid_input');
  rejected(state, claim({ aliases: [alias('unregistered-key')] }), 'index_unavailable');
  rejected(state, keyStatus('retired', { kid: 'unregistered-key' }), 'index_unavailable');
  rejected(state, claim(), 'invalid_input', -1);
  rejected(state, claim(), 'invalid_input', 0.5);
  rejected(state, claim(), 'stale_revision', 1);
  for (const registry of [null, [{}], [
    { domain: DOMAIN, kid: 'duplicate', status: 'active' },
    { domain: DOMAIN, kid: 'duplicate', status: 'retired' },
  ]]) assert.throws(() => initialState(registry), TypeError);
  const malformedState = { ...state, claims: [{ canonicalId: 'unbound' }] };
  rejected(malformedState, claim(), 'invalid_input');
  const exhausted = { ...state, revision: Number.MAX_SAFE_INTEGER };
  rejected(exhausted, claim(), 'revision_exhausted');
});

test('sparse arrays and accessors fail closed without invoking caller code', () => {
  const state = empty();
  assert.throws(() => initialState(new Array(1)), TypeError);
  rejected(state, claim({ aliases: new Array(1) }), 'invalid_input');
  for (const field of ['claims', 'aliases', 'indexKeys']) {
    rejected({ ...state, [field]: new Array(1) }, claim(), 'invalid_input');
  }
  let getterCalls = 0;
  const accessorCommand = { get type() { getterCalls += 1; return 'claim'; } };
  rejected(state, accessorCommand, 'invalid_input');
  const aliases = [];
  Object.defineProperty(aliases, '0', { enumerable: true, get() { getterCalls += 1; return alias(); } });
  rejected(state, claim({ aliases }), 'invalid_input');
  assert.equal(getterCalls, 0);
});

test('exact raw-byte integrity cannot be reconstructed by normalized JSON reserialization', () => {
  const originalSyntheticBytes = '{ "synthetic": true, "value": 1 }';
  const reserialized = JSON.stringify(JSON.parse(originalSyntheticBytes));
  const rawMac = (bytes) => createHmac('sha256', 'synthetic-only-raw-byte-test-material-000000')
    .update(bytes).digest('hex');
  assert.deepEqual(JSON.parse(originalSyntheticBytes), JSON.parse(reserialized));
  assert.notEqual(rawMac(originalSyntheticBytes), rawMac(reserialized));
  // This demonstrates an input distinction, NOT signature verification. The
  // model flag only represents availability of the input required by its
  // modeled index. Actual exact-byte integrity needs its own reviewed adapter
  // contract and cannot use normalizedInputAvailable as proof of raw bytes.
  const first = run(empty(), claim());
  rejected(first.state, retry({
    aliases: [alias('index-new')], normalizedInputAvailable: false,
  }), 'missing_normalized_input');
});
