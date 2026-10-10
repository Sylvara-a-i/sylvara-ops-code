'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCandidate, seed, columns, canonical } = require('./candidate.cjs');
const binding = { projectId: '900000001', environment: 'development', table: 'ReportCoordinatorExperimental',
  rowId: '900000002', clientId: 'synthetic-client', testId: 'synthetic-test', reportRevision: 'a'.repeat(64), sourceRevision: 'b'.repeat(64) };
const ownerA = 'a'.repeat(32), ownerB = 'b'.repeat(32), operationA = 'c'.repeat(64), operationB = 'd'.repeat(64);
const claim = (identity, ownerToken = ownerA, operation = operationA) => ({ identity, type: 'claim', ownerToken, operation, leaseMs: 10 });
const owned = (identity, state, type) => ({ identity, type, ownerToken: state.ownerToken, operation: state.operation, fence: state.fence });
function parseFields(sql) {
  const fields = {};
  for (const match of sql.matchAll(/(\w+) (?:= (NULL|\d+|'(?:[^']|'')*')|IS (NULL))/g)) {
    const value = match[2] || match[3];
    fields[match[1]] = value === 'NULL' ? null : value.startsWith("'") ? value.slice(1, -1).replaceAll("''", "'")
      : match[1] === 'ROWID' ? value : Number(value);
  }
  return fields;
}
function fixture() {
  const f = { row: columns(binding, seed(binding)), requests: [], writes: 0, loseAck: false, loseReadback: false,
    zeroAck: false, malformedAck: false, deleteBeforeUpdate: false, corruptAck: false, clock: 0, onRead: null, readLossThreshold: 0 };
  f.query = async request => {
    f.requests.push(request);
    assert.equal(request.providerQualified, false);
    assert.equal(request.retry, false);
    assert.equal(request.projectId, binding.projectId);
    if (request.kind === 'read') {
      if (f.loseReadback && f.writes > f.readLossThreshold) throw Error('synthetic-read-loss');
      if (f.onRead) f.onRead();
      return f.row ? [{ [binding.table]: structuredClone(f.row) }] : [];
    }
    assert.equal(request.kind, 'conditional_update');
    f.writes++;
    if (f.deleteBeforeUpdate) f.row = null;
    const [set, where] = request.sql.split(' WHERE ');
    const predicates = parseFields(where), patch = parseFields(set);
    assert.deepEqual(Object.keys(predicates).sort(), ['Fence', 'OwnerToken', 'ROWID', 'SeedIdentity', 'StateJson', 'Version']);
    if (!f.row || !Object.entries(predicates).every(([key, value]) => f.row[key] === value)) return [];
    f.row = { ...f.row, ...patch };
    if (f.loseAck) throw Error('synthetic-lost-ack');
    if (f.zeroAck) return [];
    if (f.malformedAck) return { unexpected: true };
    if (f.corruptAck) return [{ [binding.table]: columns(binding, seed(binding)) }];
    return [{ [binding.table]: structuredClone(f.row) }];
  };
  f.adapter = createCandidate({ binding, modelQuery: f.query, experimentalModel: true });
  f.run = command => f.adapter.execute(command, () => f.clock);
  f.state = () => JSON.parse(f.row.StateJson);
  return f;
}
async function begin(f) {
  const state = f.state();
  return f.run({ ...owned(f.adapter.identity, state, 'begin_external'), effectId: 'e'.repeat(64), contentHash: 'f'.repeat(64) });
}
const complete = (f, reference = 'synthetic-version-1') => ({ ...owned(f.adapter.identity, f.state(), 'complete'),
  modelEvidence: { independentlyVerified: true, effectId: 'e'.repeat(64), contentHash: 'f'.repeat(64), reference } });

test('default disabled and binding pins exact project, environment, row, scope and revisions', () => {
  assert.throws(() => createCandidate({ binding, modelQuery() {} }));
  for (const patch of [{ environment: 'production' }, { table: 'ReportRuns' }, { rowId: '2 OR 1=1' }, { sourceRevision: 'bad' }]) {
    assert.throws(() => createCandidate({ binding: { ...binding, ...patch }, modelQuery() {}, experimentalModel: true }));
  }
  const first = seed(binding).identity;
  for (const patch of [{ rowId: '900000003' }, { testId: 'other' }, { clientId: 'other' }, { reportRevision: 'c'.repeat(64) }]) {
    assert.notEqual(seed({ ...binding, ...patch }).identity, first);
  }
});
test('missing seed never dispatches an UPDATE or INSERT', async () => {
  const f = fixture(); f.row = null;
  assert.equal((await f.run(claim(f.adapter.identity))).status, 'held'); assert.equal(f.writes, 0);
});
test('wrong ROWID, duplicate result, cross-scope and malformed projection hold without mutation', async () => {
  for (const mutate of [f => { f.row.ROWID = '900000003'; }, f => { f.row.SeedIdentity = 'x'; },
    f => { f.row.Version = '1'; }, f => { f.row.Fence = 7; }, f => { f.row.StateJson = '{'; }]) {
    const f = fixture(); mutate(f); assert.equal((await f.run(claim(f.adapter.identity))).status, 'held'); assert.equal(f.writes, 0);
  }
  const f = fixture(); const duplicate = createCandidate({ binding, experimentalModel: true, modelQuery: async () => [{ [binding.table]: f.row }, { [binding.table]: f.row }] });
  assert.equal((await duplicate.execute(claim(duplicate.identity), () => 0)).status, 'held');
  const other = fixture(); assert.equal((await other.run({ ...claim(other.adapter.identity), identity: 'x' })).status, 'held'); assert.equal(other.writes, 0);
});
test('atomic model: concurrent competitors from one version produce one verified owner', async () => {
  const f = fixture(); const result = await Promise.all([f.run(claim(f.adapter.identity)), f.run(claim(f.adapter.identity, ownerB, operationB))]);
  assert.equal(result.filter(x => x.status === 'verified_in_model').length, 1); assert.equal(f.state().fence, 1); assert.equal(f.writes, 2);
});
test('lost acknowledgement and malformed acknowledgement recover only through exact readback', async () => {
  for (const flag of ['loseAck', 'malformedAck']) {
    const f = fixture(); f[flag] = true; const result = await f.run(claim(f.adapter.identity));
    assert.equal(result.status, 'verified_in_model'); assert.equal(result.acknowledgement, 'unknown'); assert.equal(f.writes, 1);
    assert.equal(result.externalEffectsAllowed, false);
  }
});
test('lost acknowledgement plus unreadable readback remains UNKNOWN without retry', async () => {
  const f = fixture(); f.loseAck = f.loseReadback = true;
  const result = await f.run(claim(f.adapter.identity)); assert.equal(result.status, 'unknown'); assert.equal(result.retry, false); assert.equal(f.writes, 1);
});
test('empty or contradictory acknowledgement cannot be promoted by matching readback', async () => {
  for (const flag of ['zeroAck', 'corruptAck']) {
    const f = fixture(); f[flag] = true; const result = await f.run(claim(f.adapter.identity));
    assert.equal(result.status, 'unknown'); assert.equal(f.writes, 1);
  }
});
test('deletion between read and UPDATE stays missing; no upsert or seed recreation', async () => {
  const f = fixture(); f.deleteBeforeUpdate = true;
  assert.equal((await f.run(claim(f.adapter.identity))).status, 'unknown'); assert.equal(f.row, null); assert.equal(f.writes, 1);
  assert.equal((await f.run(claim(f.adapter.identity))).status, 'held'); assert.equal(f.writes, 1);
});
test('different ROWID replacement never inherits deleted seed authority', async () => {
  const f = fixture(); f.row.ROWID = '900000003'; assert.equal((await f.run(claim(f.adapter.identity))).status, 'held'); assert.equal(f.writes, 0);
});
test('lease expiry permits fenced takeover only before any external intent', async () => {
  const f = fixture(); await f.run(claim(f.adapter.identity)); const old = f.state(); f.clock = 10;
  const result = await f.run(claim(f.adapter.identity, ownerB, operationB)); assert.equal(result.status, 'verified_in_model'); assert.equal(f.state().fence, 2);
  assert.equal((await f.run({ ...owned(f.adapter.identity, old, 'begin_external'), effectId: 'e'.repeat(64), contentHash: 'f'.repeat(64) })).reason, 'stale_owner');
  assert.equal(f.writes, 2);
});
test('precomputed stale SQL loses to takeover under atomic model', async () => {
  const f = fixture(); await f.run(claim(f.adapter.identity)); const requests = [];
  const blocked = createCandidate({ binding, experimentalModel: true, modelQuery: async request => {
    if (request.kind === 'conditional_update') { requests.push(request); return []; } return f.query(request);
  } });
  await blocked.execute({ ...owned(blocked.identity, f.state(), 'begin_external'), effectId: 'e'.repeat(64), contentHash: 'f'.repeat(64) }, () => 1);
  f.clock = 10; await f.run(claim(f.adapter.identity, ownerB, operationB));
  assert.deepEqual(await f.query(requests[0]), []); assert.equal(f.state().ownerToken, ownerB);
});
test('all non-claim transitions reject stale token, operation and fence', async () => {
  for (const type of ['begin_external', 'mark_unknown', 'complete']) for (const field of ['ownerToken', 'operation', 'fence']) {
    const f = fixture(); await f.run(claim(f.adapter.identity)); await begin(f);
    const command = complete(f); command.type = type; command[field] = field === 'fence' ? 99 : '9'.repeat(field === 'operation' ? 64 : 32);
    assert.equal((await f.run(command)).reason, 'stale_owner'); assert.equal(f.writes, 2);
  }
});
test('pending and UNKNOWN effects prohibit lease takeover, replay and new effect', async () => {
  const f = fixture(); await f.run(claim(f.adapter.identity)); await begin(f); f.clock = 100;
  assert.equal((await f.run(claim(f.adapter.identity, ownerB, operationB))).reason, 'unresolved_external_effect');
  await f.run(owned(f.adapter.identity, f.state(), 'mark_unknown'));
  assert.equal((await f.run(claim(f.adapter.identity, ownerB, operationB))).reason, 'unresolved_external_effect');
  assert.equal((await begin(f)).status, 'held'); assert.equal(f.writes, 3);
});
test('lost begin acknowledgement leaves durable pending effect, never authorizes dispatch', async () => {
  const f = fixture(); await f.run(claim(f.adapter.identity)); f.readLossThreshold = f.writes; f.loseAck = f.loseReadback = true;
  assert.equal((await begin(f)).status, 'unknown'); f.loseAck = f.loseReadback = false; f.clock = 100;
  assert.equal(f.state().status, 'external_pending'); assert.equal((await f.run(claim(f.adapter.identity, ownerB, operationB))).status, 'held'); assert.equal(f.writes, 2);
});
test('UNKNOWN settlement requires exact modeled content/effect proof and preserves immutable result', async () => {
  const f = fixture(); await f.run(claim(f.adapter.identity)); await begin(f); await f.run(owned(f.adapter.identity, f.state(), 'mark_unknown'));
  const bad = complete(f); bad.modelEvidence.contentHash = '1'.repeat(64); assert.equal((await f.run(bad)).status, 'held');
  const proof = complete(f); f.clock = 100; assert.equal((await f.run(proof)).status, 'verified_in_model');
  assert.equal((await f.run(proof)).status, 'accepted'); assert.equal((await f.run(complete(f, 'different'))).status, 'held'); assert.equal(f.writes, 4);
});
test('process restart returns committed reference without repeated update or external effects', async () => {
  const f = fixture(); await f.run(claim(f.adapter.identity)); await begin(f); await f.run(complete(f)); const writes = f.writes;
  const restarted = createCandidate({ binding, experimentalModel: true, modelQuery: f.query });
  const result = await restarted.execute(claim(restarted.identity, ownerB, operationB), () => 50);
  assert.equal(result.status, 'accepted'); assert.equal(result.externalEffectsAllowed, false); assert.equal(f.writes, writes);
});
test('late readback cannot grant fresh lease or new effect authority', async () => {
  const f = fixture(); f.onRead = () => { if (f.writes) f.clock = 10; };
  assert.equal((await f.run(claim(f.adapter.identity))).reason, 'expired_during_readback'); assert.equal(f.writes, 1);
});
test('overflow counters remain held', async () => {
  const f = fixture(); await f.run(claim(f.adapter.identity)); const state = f.state(); state.version = Number.MAX_SAFE_INTEGER; f.row = columns(binding, state); f.clock = 10;
  assert.equal((await f.run(claim(f.adapter.identity, ownerB, operationB))).reason, 'counter_exhausted'); assert.equal(f.writes, 1);
});
test('corrupt committed content identity cannot be replayed or repaired by another write', async () => {
  const f = fixture(); await f.run(claim(f.adapter.identity)); await begin(f); await f.run(complete(f));
  const state = f.state(); state.result.contentHash = '1'.repeat(64); f.row = columns(binding, state); const writes = f.writes;
  assert.equal((await f.run(claim(f.adapter.identity, ownerB, operationB))).status, 'held'); assert.equal(f.writes, writes);
});
test('counterexample: non-atomic predicate evaluation lets both contenders verify, disproving readback-only CAS', async () => {
  const f = fixture(); let releaseSecond, bothChecked; const secondGate = new Promise(resolve => { releaseSecond = resolve; });
  const checked = new Promise(resolve => { bothChecked = resolve; }); let updates = 0;
  const weakQuery = async request => {
    if (request.kind === 'read') return f.query(request);
    const [set, where] = request.sql.split(' WHERE '), predicates = parseFields(where);
    const matched = Object.entries(predicates).every(([key, value]) => f.row[key] === value);
    const index = ++updates; if (index === 2) bothChecked();
    if (index === 1) await checked; else await secondGate;
    if (!matched) return [];
    f.row = { ...f.row, ...parseFields(set) }; return [{ [binding.table]: structuredClone(f.row) }];
  };
  const model = createCandidate({ binding, experimentalModel: true, modelQuery: weakQuery });
  const first = model.execute(claim(model.identity), () => 0), second = model.execute(claim(model.identity, ownerB, operationB), () => 0);
  assert.equal((await first).status, 'verified_in_model'); releaseSecond(); assert.equal((await second).status, 'verified_in_model');
  assert.equal(f.state().fence, 1); assert.equal(f.state().ownerToken, ownerB);
  // Expected counterexample, not provider acceptance: atomic predicates remain mandatory.
});
