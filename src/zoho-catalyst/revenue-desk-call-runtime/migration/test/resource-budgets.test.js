'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  computeApprovedInputDigest, createMigrationPlan, executeFixedTargetMigration, MigrationError,
} = require('..');
const {
  assertCanonicalBounds, canonicalStringify, canonicalize, SNAPSHOT_LIMITS,
} = require('../lib/canonical');
const { validateContract } = require('../lib/contract');

const DIGEST_KEY = 'synthetic-resource-budget-test-key-0000000000000000';

function fixture() {
  return {
    contract: {
      schemaVersion: 1,
      migrationId: 'synthetic-budget-test',
      resources: [{
        id: 'items', sourceTable: 'LegacyItems', targetTable: 'CanonicalItems',
        sourceKeyColumn: 'KEY', targetKeyColumn: 'KEY', partitionColumns: ['KEY'],
        projection: { KEY: { source: 'KEY', required: true } },
      }],
    },
    privateInput: {
      schemaVersion: 1, captureId: 'synthetic-capture', capturedAt: '2026-01-01T00:00:00Z',
      sources: [{ table: 'LegacyItems', rowCount: 1, rows: [{ KEY: 'item-a' }] }],
      targets: [{ table: 'CanonicalItems', rowCount: 0, rows: [] }],
    },
    digestKey: DIGEST_KEY,
    batchSize: 1,
  };
}

function exceeds(limit) {
  return (error) => error instanceof MigrationError
    && error.code === 'MIGRATION_INPUT_LIMIT_EXCEEDED' && error.details.limit === limit;
}

function nested(depth) {
  let value = null;
  for (let index = 0; index < depth; index += 1) value = { child: value };
  return value;
}

function replaceRows(entry, rows) {
  entry.rows = rows;
  entry.rowCount = rows.length;
}

test('deep snapshots fail with a bounded error before recursion or target binding', async () => {
  const input = fixture();
  input.privateInput.sources[0].rows[0].IGNORED = nested(20_000);
  assert.throws(() => computeApprovedInputDigest(input), exceeds('maxDepth'));
  assert.throws(() => createMigrationPlan(input), exceeds('maxDepth'));
  assert.throws(() => canonicalize(input.privateInput), exceeds('maxDepth'));
  let inspected = false;
  const capability = new Proxy({}, { get() { inspected = true; throw new Error('must stay offline'); } });
  await assert.rejects(executeFixedTargetMigration({
    ...input, mode: 'apply', privateTargetBinding: capability, transport: capability, logger: capability,
  }), exceeds('maxDepth'));
  assert.equal(inspected, false);
});

test('maximum snapshot depth remains valid and one extra level fails', () => {
  const input = fixture();
  // Root=0; sources=1; table=2; rows=3; row=4; ignored value=5.
  input.privateInput.sources[0].rows[0].IGNORED = nested(SNAPSHOT_LIMITS.maxDepth - 5);
  assert.equal(createMigrationPlan(input).summary.insert, 1);
  input.privateInput.sources[0].rows[0].IGNORED = nested(SNAPSHOT_LIMITS.maxDepth - 4);
  assert.throws(() => computeApprovedInputDigest(input), exceeds('maxDepth'));
});

test('aggregate byte budget includes source and target ignored fields and escaped UTF-8', () => {
  const input = fixture();
  for (const entry of [...input.privateInput.sources, ...input.privateInput.targets]) {
    replaceRows(entry, Array.from({ length: 65 }, (_, index) => ({
      KEY: `item-${index}`, IGNORED: 'x'.repeat(64_000),
    })));
  }
  const row = input.privateInput.targets[0].rows[0];
  row.PADDING = '';
  let remaining = SNAPSHOT_LIMITS.maxBytes - assertCanonicalBounds(input.privateInput).bytes;
  for (let index = 0; remaining > SNAPSHOT_LIMITS.maxStringBytes; index += 1) {
    row[`PAD_${index}`] = 'x'.repeat(SNAPSHOT_LIMITS.maxStringBytes - 100);
    remaining = SNAPSHOT_LIMITS.maxBytes - assertCanonicalBounds(input.privateInput).bytes;
  }
  row.PADDING = 'x'.repeat(remaining);
  assert.equal(assertCanonicalBounds(input.privateInput, SNAPSHOT_LIMITS).bytes, SNAPSHOT_LIMITS.maxBytes);
  assert.match(computeApprovedInputDigest(input), /^sha256:/);
  row.PADDING += 'é';
  assert.throws(() => createMigrationPlan(input), exceeds('maxBytes'));
  // Escaping must count the serialized bytes, not only the raw UTF-8 bytes.
  const raw = '\u0000'.repeat(4);
  assert.equal(assertCanonicalBounds({ raw }).bytes, Buffer.byteLength(JSON.stringify({ raw })));
});

test('node budget counts repeated references and rejects huge sparse lengths promptly', () => {
  const input = fixture();
  const row = input.privateInput.sources[0].rows[0];
  row.IGNORED = [];
  const baseline = assertCanonicalBounds(input.privateInput).nodes;
  row.IGNORED = Array(SNAPSHOT_LIMITS.maxNodes - baseline).fill(null);
  assert.equal(assertCanonicalBounds(input.privateInput, SNAPSHOT_LIMITS).nodes, SNAPSHOT_LIMITS.maxNodes);
  assert.match(computeApprovedInputDigest(input), /^sha256:/);
  row.IGNORED.push(null);
  assert.throws(() => createMigrationPlan(input), exceeds('maxNodes'));
  row.IGNORED = new Array(2 ** 32 - 1);
  assert.throws(() => computeApprovedInputDigest(input), exceeds('maxNodes'));
  const shared = { a: null };
  assert.equal(assertCanonicalBounds([shared, shared]).nodes, 5);
});

test('aggregate fields and fields per row include ignored nested data', () => {
  const input = fixture();
  const row = input.privateInput.sources[0].rows[0];
  for (let index = 1; index < SNAPSHOT_LIMITS.maxFieldsPerObject; index += 1) row[`F_${index}`] = null;
  assert.match(computeApprovedInputDigest(input), /^sha256:/);
  row.OVER = null;
  assert.throws(() => createMigrationPlan(input), exceeds('maxFieldsPerObject'));
  delete row.OVER;
  const { privateInput } = fixture();
  privateInput.sources[0].rows[0].IGNORED = [];
  let remaining = SNAPSHOT_LIMITS.maxFields - assertCanonicalBounds(privateInput).fields;
  while (remaining > 0) {
    const count = Math.min(remaining, SNAPSHOT_LIMITS.maxFieldsPerObject);
    privateInput.sources[0].rows[0].IGNORED.push(Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`F_${index}`, null]),
    ));
    remaining -= count;
  }
  assert.match(computeApprovedInputDigest({ ...input, privateInput }), /^sha256:/);
  privateInput.sources[0].rows[0].IGNORED.push({ OVER: null });
  assert.throws(() => createMigrationPlan({ ...input, privateInput }), exceeds('maxFields'));
});

test('string budget measures UTF-8 keys and values at the exact boundary', () => {
  for (const asKey of [false, true]) {
    const input = fixture();
    const row = input.privateInput.sources[0].rows[0];
    const valid = 'é'.repeat(SNAPSHOT_LIMITS.maxStringBytes / 2);
    if (asKey) row[valid] = null;
    else row.IGNORED = valid;
    assert.match(computeApprovedInputDigest(input), /^sha256:/);
    if (asKey) row[`${valid}x`] = null;
    else row.IGNORED += 'x';
    assert.throws(() => createMigrationPlan(input), exceeds('maxStringBytes'));
  }
});

test('row count is aggregate across sources and targets even for a one-row batch', () => {
  const input = fixture();
  const rows = Array.from({ length: SNAPSHOT_LIMITS.maxRows / 2 }, (_, index) => ({ KEY: `item-${index}` }));
  replaceRows(input.privateInput.sources[0], rows);
  replaceRows(input.privateInput.targets[0], rows);
  assert.equal(createMigrationPlan(input).summary.alreadyPresent, rows.length);
  replaceRows(input.privateInput.targets[0], [...rows, { KEY: 'extra' }]);
  assert.throws(() => createMigrationPlan(input), exceeds('maxRows'));
});

test('resource, table, and projection counts are bounded before sorting', () => {
  const input = fixture();
  const template = input.contract.resources[0];
  input.contract.resources = Array.from({ length: SNAPSHOT_LIMITS.maxResources }, (_, index) => ({
    ...template, id: `items-${index}`, sourceTable: `Legacy${index}`, targetTable: `Canonical${index}`,
  }));
  input.privateInput.sources = input.contract.resources.map((resource) => ({
    table: resource.sourceTable, rowCount: 0, rows: [],
  }));
  input.privateInput.targets = input.contract.resources.map((resource) => ({
    table: resource.targetTable, rowCount: 0, rows: [],
  }));
  assert.match(computeApprovedInputDigest(input), /^sha256:/);
  input.privateInput.targets.push({ table: 'Extra', rowCount: 0, rows: [] });
  assert.throws(() => createMigrationPlan(input), exceeds('maxTables'));
  input.privateInput.targets.pop();
  input.contract.resources.push({ ...template, id: 'extra', sourceTable: 'Extra', targetTable: 'Other' });
  assert.throws(() => createMigrationPlan(input), exceeds('maxResources'));
  const other = fixture();
  for (let index = 1; index < SNAPSHOT_LIMITS.maxProjectionFields; index += 1) {
    other.contract.resources[0].projection[`FIELD_${index}`] = { constant: null };
  }
  assert.match(computeApprovedInputDigest(other), /^sha256:/);
  other.contract.resources[0].projection.EXTRA = { constant: null };
  assert.throws(() => computeApprovedInputDigest(other), exceeds('maxProjectionFields'));
});

test('constant projection amplification fails before plan materialization', () => {
  const input = fixture();
  input.contract.resources[0].projection.VALUE = { constant: 'x'.repeat(10_000) };
  replaceRows(input.privateInput.sources[0], Array.from({ length: 1_000 }, (_, index) => ({ KEY: `item-${index}` })));
  assert.throws(() => createMigrationPlan(input), exceeds('maxProjectedBytes'));
  input.contract.resources[0].projection.VALUE = { constant: null };
  for (let index = 2; index < 64; index += 1) input.contract.resources[0].projection[`F_${index}`] = { constant: null };
  replaceRows(input.privateInput.sources[0], Array.from({ length: 1_200 }, (_, index) => ({ KEY: `item-${index}` })));
  assert.throws(() => createMigrationPlan(input), exceeds('maxProjectedFields'));
});

test('cycles, non-JSON values, sparse arrays, and accessors fail closed', () => {
  const cyclic = {};
  cyclic.self = cyclic;
  let getterCalled = false;
  const accessor = { get value() { getterCalled = true; return 'private'; } };
  for (const value of [cyclic, { missing: undefined }, { number: 0.5 }, new Array(1), accessor]) {
    assert.throws(() => canonicalize(value), (error) => error.code === 'INVALID_CANONICAL_VALUE');
  }
  assert.equal(getterCalled, false);
});

test('hidden fields and custom array hooks cannot change or execute outside the approved JSON', () => {
  let calls = 0;
  const input = fixture();
  const hidden = {};
  Object.defineProperty(hidden, 'KEY', { get() { calls += 1; return 'unapproved-key'; } });
  replaceRows(input.privateInput.sources[0], [hidden]);
  assert.throws(() => createMigrationPlan(input), (error) => error.code === 'INVALID_CANONICAL_VALUE');
  for (const hook of ['map', 'entries', 'toJSON', Symbol.iterator]) {
    const other = fixture();
    Object.defineProperty(other.privateInput.sources[0].rows, hook, {
      value() { calls += 1; throw new Error('unapproved-array-hook'); },
    });
    assert.throws(() => createMigrationPlan(other), (error) => error.code === 'INVALID_CANONICAL_VALUE');
  }
  const customArray = fixture();
  Object.setPrototypeOf(customArray.privateInput.sources[0].rows, Object.create(Array.prototype));
  assert.throws(() => createMigrationPlan(customArray), (error) => error.code === 'INVALID_CANONICAL_VALUE');
  const hiddenValue = fixture();
  Object.defineProperty(hiddenValue.privateInput.sources[0].rows[0], 'IGNORED', { value: 'not-json' });
  assert.throws(() => computeApprovedInputDigest(hiddenValue), (error) => error.code === 'INVALID_CANONICAL_VALUE');
  const symbolic = fixture();
  symbolic.privateInput.sources[0].rows[0][Symbol('ignored')] = 'not-json';
  assert.throws(() => computeApprovedInputDigest(symbolic), (error) => error.code === 'INVALID_CANONICAL_VALUE');
  const proxied = fixture();
  proxied.privateInput.sources[0].rows[0] = new Proxy({}, {
    ownKeys() { calls += 1; return []; },
    get() { calls += 1; return 'not-json'; },
    getPrototypeOf() { calls += 1; return Object.prototype; },
  });
  assert.throws(() => createMigrationPlan(proxied), (error) => error.code === 'INVALID_CANONICAL_VALUE');
  assert.equal(calls, 0);
});

test('valid legacy canonical bytes and approval digests are unchanged', () => {
  const input = fixture();
  const row = Object.assign(Object.create(null), JSON.parse('{"KEY":"item-a","__proto__":{"z":1,"a":2},"9":"nine","2":"two"}'));
  replaceRows(input.privateInput.sources[0], [row, { KEY: 'item-b', Z: [false, null, 'é'] }]);
  function legacyCanonical(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(legacyCanonical);
    const result = Object.create(null);
    for (const key of Object.keys(value).sort()) result[key] = legacyCanonical(value[key]);
    return result;
  }
  const stringify = (value) => JSON.stringify(legacyCanonical(value));
  assert.equal(canonicalStringify(row), stringify(row));
  const sort = (entries) => entries.map((entry) => ({
    ...entry, rows: [...entry.rows].sort((a, b) => stringify(a) < stringify(b) ? -1 : stringify(a) > stringify(b) ? 1 : 0),
  })).sort((a, b) => a.table < b.table ? -1 : a.table > b.table ? 1 : 0);
  const envelope = {
    contract: validateContract(input.contract),
    privateInput: { ...input.privateInput, sources: sort(input.privateInput.sources), targets: sort(input.privateInput.targets) },
  };
  const expected = `sha256:${crypto.createHash('sha256').update(stringify(envelope)).digest('hex')}`;
  assert.equal(computeApprovedInputDigest(input), expected);
  input.privateInput.sources[0].rows.reverse();
  assert.equal(createMigrationPlan(input).inputDigest, expected);
});
