'use strict';

// Synthetic constructor inputs only. No saved configuration, provider or ledger.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });
const { bindingDiagnosticError, storageBindingFailureDiagnostic: diagnostic }
  = require('../lib/report-storage-binding-diagnostic');
const { encodeStorageBinding: encode, decodeStorageBinding: decode,
  preflightStorageEnvironment: preflight, JSON_KEY, HASH_KEY, PART_PREFIX }
  = require('../lib/report-storage-binding');
const { createProtectedStorageQualification: create }
  = require('../lib/report-storage-qualification');
const { validateDormantBinding, activateDormantBinding }
  = require('../lib/report-storage-activation');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const HELD = 'REPORT_STORAGE_QUALIFICATION_HELD';
const REASONS = [
  'environment_shape', 'marker_missing', 'marker_type', 'inline_shape', 'marker_syntax',
  'marker_bounds', 'part_count', 'part_missing', 'part_type', 'part_length', 'part_ascii',
  'wire_length', 'base64_syntax', 'base64_canonical', 'inflate_failed', 'inflate_consumption',
  'tuple_length', 'tuple_utf8', 'tuple_json', 'tuple_canonical', 'tuple_shape',
  'tuple_scalar_type', 'tuple_scalar_bounds', 'tuple_schema', 'raw_bounds', 'raw_length',
  'raw_type_or_size', 'pin_syntax', 'pin_mismatch', 'binding_json', 'binding_fields',
  'binding_schema', 'binding_enabled', 'binding_environment', 'single_admission_flag',
  'config_environment_mismatch', 'raw_environment_mismatch', 'config_source_mismatch',
  'raw_source_mismatch', 'source_syntax', 'project_id_syntax', 'project_digest_mismatch',
  'sdk_project_mismatch', 'sdk_environment_mismatch', 'control_host_mismatch',
  'table_id_syntax', 'nonce_syntax', 'verified_at', 'expires_at', 'legacy_expiry',
  'timeout', 'clock_type', 'transport_factory_type', 'dormant_fields', 'dormant_shape',
  'dormant_times', 'dormant_source', 'dormant_project_or_table', 'dormant_host',
  'dormant_nonce', 'capability_fields', 'evidence_roles', 'evidence_fields',
  'evidence_digest', 'evidence_times', 'unclassified',
];

function binding() {
  const table = (id, name, uniqueField) => ({ id, name, schemaSha256: 'c'.repeat(64),
    uniquenessSha256: 'd'.repeat(64), uniqueField, projectionSha256: 'e'.repeat(64) });
  return { schemaVersion: 6, enabled: false, environment: 'development',
    sourceRevision: 'a'.repeat(40), projectId: '123456789', controlHost: 'synthetic.invalid',
    tableId: '123456788', nonce: 'b'.repeat(32),
    capability: { region: 'US', origin: 'https://api.catalyst.zoho.com',
      controllerFunctionId: '123456786', deploymentId: 'synthetic_controller', sdkVersion: '3.4.0',
      authMode: 'user', authType: 'admin', creatorPolicy: 'observed_consistent_v1',
      tables: { reportRuns: table('123456788', 'ReportRuns', 'IdempotencyKey'),
        eventReceipts: table('123456787', 'RevenueDeskEventReceipts', 'EVENT_KEY') },
      evidence: Object.fromEntries(['ownerAuthorization', 'ownership', 'access'].map(role =>
        [role, { digest: sha('synthetic-' + role), verifiedAt: 0, expiresAt: 0 }])) },
    verifiedAt: 0, expiresAt: 0, timeoutMs: 25000, singleAdmittedInvocation: true };
}
function leaves(value) {
  return Object.values(value).flatMap(item => item && typeof item === 'object' ? leaves(item) : [item]);
}
function transport(raw = JSON.stringify(binding())) {
  const encoded = encode(raw, { format: 'tuple-v1', partSize: 400 });
  return { ...encoded.parts, [JSON_KEY]: encoded.marker };
}
function frame(bytes, { compressed = zlib.deflateRawSync(bytes),
  tupleLength = bytes.length, rawLength = JSON.stringify(binding()).length } = {}) {
  const wire = compressed.toString('base64'), environment = {};
  for (let i = 0; i < Math.ceil(wire.length / 400); i++) {
    environment[PART_PREFIX + i] = wire.slice(i * 400, (i + 1) * 400);
  }
  environment[JSON_KEY] = `tuple-v1:400:${Math.ceil(wire.length / 400)}:${wire.length}:${tupleLength}:${rawLength}`;
  return environment;
}
function tupleFrame(mutate, options) {
  const values = leaves(binding()); mutate(values);
  return frame(Buffer.from(JSON.stringify(values)), options);
}
function fixture(mutate = () => {}, format = 'inline') {
  const b = binding(), calls = { clock: 0, transport: 0 };
  const f = { b, calls, config: { environment: 'development', sourceRevision: b.sourceRevision,
    controlHost: b.controlHost, expectedProjectIdSha256: sha(b.projectId), operatorIdHash: 'synthetic_operator' },
  app: { config: { projectId: b.projectId, environment: 'development' } },
  environment: { SOURCE_REVISION: b.sourceRevision, DEPLOYMENT_ENVIRONMENT: 'development',
    REPORT_CONTROLLER_FUNCTION_ID: b.capability.controllerFunctionId,
    REPORT_DEPLOYMENT_ID: b.capability.deploymentId }, options: {} };
  mutate(f);
  const raw = f.raw === undefined ? JSON.stringify(b) : f.raw;
  const packed = format === 'inline' ? { [JSON_KEY]: raw } : format === 'tuple-v1'
    ? transport(raw) : (() => { const e = encode(raw); return { ...e.parts, [JSON_KEY]: e.marker }; })();
  f.environment = { ...packed, [HASH_KEY]: sha(raw), ...f.environment };
  f.make = () => create({ environment: f.environment,
    now() { calls.clock++; return 1800000000000; },
    transportFactory() { calls.transport++; throw new Error('synthetic forbidden transport'); },
    ...f.options })(f.app, f.config);
  return f;
}
function rejects(fn, reason, details) {
  let error;
  try { fn(); } catch (caught) { error = caught; }
  assert.ok(error, 'expected the original rejection');
  assert.equal(error.code, HELD);
  assert.equal(error.message, HELD);
  assert.deepEqual(diagnostic(error), reason === undefined ? undefined
    : { schemaVersion: details ? 2 : 1, firstFailure: reason, ...details });
  return error;
}

test('only issued errors carry the closed frozen 66-reason projection', () => {
  assert.equal(new Set(REASONS).size, 66);
  for (const reason of REASONS) {
    const error = bindingDiagnosticError(reason), projection = diagnostic(error);
    assert.equal(error.code, HELD); assert.equal(error.message, HELD);
    assert.deepEqual(projection, { schemaVersion: 1, firstFailure: reason });
    assert.ok(Object.isFrozen(projection));
    assert.throws(() => { projection.firstFailure = 'synthetic-private-value'; }, TypeError);
    assert.equal(diagnostic(error).firstFailure, reason);
    assert.equal(diagnostic(Object.create(error)), undefined);
    assert.equal(diagnostic(new Proxy(error, {})), undefined);
  }
});
test('unknown reasons never coerce values or confer free-text log authority', () => {
  let reads = 0;
  const hostile = new Proxy({}, { get() { reads++; throw new Error('synthetic private value'); } });
  for (const reason of [undefined, null, 1, 1n, false, Symbol('synthetic'), hostile,
    'synthetic-private-value', 'marker_missing\n', new String('marker_missing')]) {
    const error = bindingDiagnosticError(reason);
    assert.deepEqual(diagnostic(error), { schemaVersion: 1, firstFailure: 'unclassified' });
    assert.equal(error.message, HELD); assert.equal(error.code, HELD);
  }
  assert.equal(reads, 0);
});
test('unissued hostile errors cannot expose properties through the projection reader', () => {
  let reads = 0;
  const error = new Error('synthetic-private-message');
  for (const key of ['code', 'message', 'stack', 'bindingFailure', 'firstFailure', 'schemaVersion']) {
    Object.defineProperty(error, key, { configurable: true, get() { reads++; throw new Error('synthetic getter'); } });
  }
  const proxy = new Proxy(error, { get() { reads++; throw new Error('synthetic proxy'); },
    ownKeys() { reads++; throw new Error('synthetic own keys'); } });
  for (const value of [error, proxy, undefined, null, 1, 'marker_missing', Symbol('synthetic')]) {
    assert.equal(diagnostic(value), undefined);
  }
  assert.equal(reads, 0);
});
test('a recorder failure retains the held rejection without a guessed detail', () => {
  const set = WeakMap.prototype.set; let error;
  try {
    WeakMap.prototype.set = function () { throw new Error('synthetic recorder failure'); };
    error = bindingDiagnosticError('part_length', 0, 400, 399);
  } finally { WeakMap.prototype.set = set; }
  assert.equal(error.code, HELD); assert.equal(error.message, HELD);
  assert.equal(diagnostic(error), undefined);
});

test('only part_length can issue bounded frozen version two observations', () => {
  for (const [partIndex, expectedCodeUnits, observed, observedCodeUnits] of [
    [0, 400, 399, 399], [2, 76, 0, 0], [40, 1, 4096, 4096],
    [0, 400, 4097, 'above_limit'], [0, 400, Number.MAX_SAFE_INTEGER, 'above_limit'],
  ]) {
    const error = bindingDiagnosticError('part_length', partIndex, expectedCodeUnits, observed);
    const projection = diagnostic(error);
    assert.deepEqual(projection, { schemaVersion: 2, firstFailure: 'part_length',
      partIndex, expectedCodeUnits, observedCodeUnits });
    assert.equal(error.code, HELD); assert.equal(error.message, HELD);
    assert.ok(Object.isFrozen(projection));
    assert.throws(() => { projection.observedCodeUnits = 'SYNTHETIC_PRIVATE_VALUE'; }, TypeError);
    assert.equal(diagnostic(Object.assign(new Error(HELD), error)), undefined);
    assert.equal(diagnostic(Object.create(error)), undefined);
    assert.equal(diagnostic(new Proxy(error, {})), undefined);
  }
  for (const reason of REASONS.filter(value => value !== 'part_length')) {
    assert.deepEqual(diagnostic(bindingDiagnosticError(reason, 0, 400, 399)),
      { schemaVersion: 1, firstFailure: reason });
  }
});

test('invalid length observations fall back to the original enum without coercion', () => {
  let reads = 0;
  const hostile = new Proxy({}, { get() { reads++; throw new Error('SYNTHETIC_PRIVATE_VALUE'); },
    ownKeys() { reads++; throw new Error('SYNTHETIC_PRIVATE_VALUE'); } });
  const invalid = [undefined, null, false, '1', 1n, Symbol('synthetic'), new Number(1), hostile,
    -0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];
  for (const position of [0, 1, 2]) for (const value of invalid) {
    const args = [0, 400, 399]; args[position] = value;
    assert.deepEqual(diagnostic(bindingDiagnosticError('part_length', ...args)),
      { schemaVersion: 1, firstFailure: 'part_length' });
  }
  for (const args of [[41, 400, 399], [0, 0, 399], [0, 401, 399], [0, 400, 400]]) {
    assert.deepEqual(diagnostic(bindingDiagnosticError('part_length', ...args)),
      { schemaVersion: 1, firstFailure: 'part_length' });
  }
  assert.equal(reads, 0);
});

test('a length diagnostic lookup failure remains absent without changing the held error', () => {
  const error = bindingDiagnosticError('part_length', 0, 400, 399), get = WeakMap.prototype.get;
  try {
    WeakMap.prototype.get = function () { throw new Error('SYNTHETIC_PRIVATE_VALUE'); };
    assert.equal(diagnostic(error), undefined);
  } finally { WeakMap.prototype.get = get; }
  assert.equal(error.code, HELD); assert.equal(error.message, HELD);
});

function lengthFixture(size = 400, length = 876) {
  const encoded = encode('A'.repeat(length), { partSize: size });
  return { ...encoded.parts, [JSON_KEY]: encoded.marker };
}

test('each three-part short or long failure reports the first index and marker expectation', () => {
  for (const prefix of ['parts-v1', 'tuple-v1']) for (const index of [0, 1, 2]) {
    const expectedCodeUnits = [400, 400, 76][index];
    for (const observedCodeUnits of [0, expectedCodeUnits - 1, expectedCodeUnits + 1]) {
      const environment = lengthFixture();
      if (prefix === 'tuple-v1') environment[JSON_KEY] = 'tuple-v1:400:3:876:10:10';
      environment[PART_PREFIX + index] = 'A'.repeat(observedCodeUnits);
      if (index < 2) environment[PART_PREFIX + (index + 1)] = '';
      rejects(() => decode(environment), 'part_length', { partIndex: index, expectedCodeUnits, observedCodeUnits });
    }
  }
  assert.equal(decode(lengthFixture()), 'A'.repeat(876));
});

test('part expectations come from the effective marker rather than fixed fixture sizes', () => {
  for (const [size, length, index, expectedCodeUnits] of [[100, 201, 2, 1], [200, 410, 2, 10], [400, 1200, 2, 400]]) {
    const environment = lengthFixture(size, length);
    environment[PART_PREFIX + index] = '';
    rejects(() => decode(environment), 'part_length', { partIndex: index, expectedCodeUnits, observedCodeUnits: 0 });
  }
  const changedMarker = lengthFixture(); changedMarker[JSON_KEY] = 'parts-v1:400:3:875';
  rejects(() => decode(changedMarker), 'part_length', { partIndex: 2, expectedCodeUnits: 75, observedCodeUnits: 76 });
});

test('missing, nonstring and non-ASCII parts retain precedence without length details', () => {
  const missing = lengthFixture(); delete missing[PART_PREFIX + '1'];
  rejects(() => decode(missing), 'part_count');
  missing[PART_PREFIX + 'extra'] = 'A';
  rejects(() => decode(missing), 'part_missing');
  const wrongType = lengthFixture(); wrongType[PART_PREFIX + '0'] = null;
  rejects(() => decode(wrongType), 'part_type');
  const earlierAscii = lengthFixture(); earlierAscii[PART_PREFIX + '0'] = '\t' + 'A'.repeat(399);
  earlierAscii[PART_PREFIX + '1'] = '';
  rejects(() => decode(earlierAscii), 'part_ascii');
});

test('length diagnostics count UTF-16 code units and never trim whitespace', () => {
  for (const [part, observedCodeUnits] of [['\u00e9', 1], ['\ud83d\ude00', 2], ['\r\n', 2], ['\t', 1], [' ', 1]]) {
    const environment = lengthFixture(); environment[PART_PREFIX + '0'] = part;
    rejects(() => decode(environment), 'part_length', { partIndex: 0, expectedCodeUnits: 400, observedCodeUnits });
  }
  for (const part of ['\u00e9' + 'A'.repeat(399), '\ud83d\ude00' + 'A'.repeat(398), '\n' + 'A'.repeat(399)]) {
    const environment = lengthFixture(); environment[PART_PREFIX + '0'] = part;
    rejects(() => decode(environment), 'part_ascii');
  }
});

test('oversize observed lengths are bounded without retaining part contents', () => {
  for (const [length, observedCodeUnits] of [[4096, 4096], [4097, 'above_limit'], [8192, 'above_limit']]) {
    const environment = lengthFixture(); environment[PART_PREFIX + '0'] = 'A'.repeat(length);
    rejects(() => decode(environment), 'part_length', { partIndex: 0, expectedCodeUnits: 400, observedCodeUnits });
  }
});

test('the failing part is read once and later values are not inspected for logging', () => {
  const environment = lengthFixture(), privateValue = 'SYNTHETIC_PRIVATE_VALUE';
  let partReads = 0, laterReads = 0;
  Object.defineProperty(environment, PART_PREFIX + '0', { enumerable: true,
    get() { partReads++; return privateValue; } });
  for (const key of [PART_PREFIX + '1', PART_PREFIX + '2', HASH_KEY, 'UNRELATED_SYNTHETIC_FIELD']) {
    Object.defineProperty(environment, key, { enumerable: true,
      get() { laterReads++; throw new Error(privateValue); } });
  }
  const error = rejects(() => decode(environment), 'part_length', {
    partIndex: 0, expectedCodeUnits: 400, observedCodeUnits: privateValue.length });
  assert.equal(partReads, 1); assert.equal(laterReads, 0);
  assert.equal(JSON.stringify([diagnostic(error), error]).includes(privateValue), false);
  assert.deepEqual(Object.keys(error), ['code']);
});

const transportCases = [
  ['environment_shape', () => null],
  ['marker_missing', () => ({})],
  ['marker_type', () => ({ [JSON_KEY]: 1 })],
  ['inline_shape', () => ({ [JSON_KEY]: '{}', [PART_PREFIX + '0']: 'x' })],
  ['marker_syntax', () => ({ [JSON_KEY]: 'tuple-v1:300:1:4:1:1' })],
  ['marker_bounds', () => ({ [JSON_KEY]: 'tuple-v1:400:11:4097:1:1' })],
  ['part_count', () => ({ ...transport(), [PART_PREFIX + 'extra']: 'x' })],
  ['part_missing', () => { const e = transport(); e[PART_PREFIX + 'other'] = e[PART_PREFIX + '0']; delete e[PART_PREFIX + '0']; return e; }],
  ['part_type', () => ({ ...transport(), [PART_PREFIX + '0']: null })],
  ['part_length', () => ({ [JSON_KEY]: 'parts-v1:400:1:4', [PART_PREFIX + '0']: 'A' }),
    { partIndex: 0, expectedCodeUnits: 4, observedCodeUnits: 1 }],
  ['part_ascii', () => ({ ...transport(), [PART_PREFIX + '0']: '\t' + transport()[PART_PREFIX + '0'].slice(1) })],
  ['base64_syntax', () => ({ [JSON_KEY]: 'tuple-v1:400:1:4:1:1', [PART_PREFIX + '0']: '!!!!' })],
  ['base64_canonical', () => ({ [JSON_KEY]: 'tuple-v1:400:1:4:1:1', [PART_PREFIX + '0']: 'Zh==' })],
  ['inflate_failed', () => ({ [JSON_KEY]: 'tuple-v1:400:1:4:1:1', [PART_PREFIX + '0']: 'AA==' })],
  ['inflate_consumption', () => { const bytes = Buffer.from(JSON.stringify(leaves(binding()))); return frame(bytes, { compressed: Buffer.concat([zlib.deflateRawSync(bytes), Buffer.from('synthetic trailing bytes')]) }); }],
  ['tuple_length', () => { const bytes = Buffer.from(JSON.stringify(leaves(binding()))); return frame(bytes, { tupleLength: bytes.length + 1 }); }],
  ['tuple_utf8', () => frame(Buffer.from([0xff]))],
  ['tuple_json', () => frame(Buffer.from('!'))],
  ['tuple_canonical', () => frame(Buffer.from(' ' + JSON.stringify(leaves(binding()))))],
  ['tuple_shape', () => frame(Buffer.from('[]'))],
  ['tuple_scalar_type', () => tupleFrame(values => { values[1] = null; })],
  ['tuple_scalar_bounds', () => tupleFrame(values => { values[37] = -1; })],
  ['tuple_schema', () => tupleFrame(values => { values[0] = 8; })],
  ['raw_bounds', () => tupleFrame(values => { values[5] = 'café.invalid'; })],
  ['raw_length', () => tupleFrame(() => {}, { rawLength: JSON.stringify(binding()).length + 1 })],
];
for (const [reason, input, details] of transportCases) test('decoder first failure: ' + reason, () => {
  rejects(() => decode(input()), reason, details);
});
test('tuple numeric bounds reject fractional and unsafe integers at the scalar branch', () => {
  for (const value of [0.5, Number.MAX_SAFE_INTEGER + 1]) {
    rejects(() => decode(tupleFrame(values => { values[37] = value; })), 'tuple_scalar_bounds');
  }
});
test('marker bounds remain before part count and part validation remains in original order', () => {
  rejects(() => decode({ [JSON_KEY]: 'tuple-v1:400:11:4097:1:1', [PART_PREFIX + '0']: null }), 'marker_bounds');
  rejects(() => decode({ [JSON_KEY]: 'parts-v1:400:1:4', [PART_PREFIX + '0']: '\t' }),
    'part_length', { partIndex: 0, expectedCodeUnits: 4, observedCodeUnits: 1 });
});
test('inline, multipart and tuple bytes remain unchanged for all supported schemas', () => {
  for (const schemaVersion of [3, 4, 5, 6, 7]) {
    const b = binding(); b.schemaVersion = schemaVersion; b.enabled = ![6, 7].includes(schemaVersion);
    const raw = JSON.stringify(b);
    assert.equal(decode({ [JSON_KEY]: raw }), raw);
    for (const format of ['json', 'tuple-v1']) for (const partSize of [100, 200, 400]) {
      const e = encode(raw, { format, partSize });
      assert.equal(decode({ ...e.parts, [JSON_KEY]: e.marker }), raw);
    }
  }
});
test('the original non-m marker anchors reject terminal line terminators without trimming', () => {
  for (const ending of ['\n', '\r', '\r\n']) {
    const e = transport(); e[JSON_KEY] += ending;
    rejects(() => decode(e), 'marker_syntax');
  }
});
test('marker read and own-key enumeration precede marker-type validation', () => {
  const sentinel = new Error('synthetic enumeration failure'), seen = [];
  const environment = new Proxy({ [JSON_KEY]: null }, {
    get(target, key) { seen.push('get:' + key); return Reflect.get(target, key); },
    ownKeys() { seen.push('ownKeys'); throw sentinel; },
  });
  assert.throws(() => decode(environment), error => error === sentinel);
  assert.deepEqual(seen, ['get:' + JSON_KEY, 'ownKeys']); assert.equal(diagnostic(sentinel), undefined);
});
test('a missing own part is still read before its ownership check', () => {
  const environment = transport(), first = environment[PART_PREFIX + '0'], seen = [];
  delete environment[PART_PREFIX + '0']; environment[PART_PREFIX + 'other'] = 'x';
  Object.setPrototypeOf(environment, { get [PART_PREFIX + '0']() { seen.push('get'); return first; } });
  const proxy = new Proxy(environment, { getOwnPropertyDescriptor(target, key) {
    if (key === PART_PREFIX + '0') seen.push('hasOwn'); return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  rejects(() => decode(proxy), 'part_missing'); assert.deepEqual(seen, ['get', 'hasOwn']);
});
test('enumerable count and own-part presence retain their original distinct semantics', () => {
  const raw = JSON.stringify(binding()), environment = transport(raw), first = environment[PART_PREFIX + '0'];
  Object.defineProperty(environment, PART_PREFIX + '0', { value: first, enumerable: false });
  environment[PART_PREFIX + 'extra'] = 'synthetic unconsumed extra';
  assert.equal(decode(environment), raw);
});
test('escaping part getters retain their original exception and no diagnostic authority', () => {
  const environment = transport(), sentinel = new Error('synthetic part getter'), seen = [];
  Object.defineProperty(environment, PART_PREFIX + '0', { enumerable: true, get() { seen.push('part'); throw sentinel; } });
  Object.defineProperty(environment, HASH_KEY, { enumerable: true, get() { seen.push('pin'); throw new Error('late pin read'); } });
  assert.throws(() => decode(environment), error => error === sentinel);
  assert.deepEqual(seen, ['part']); assert.equal(diagnostic(sentinel), undefined);
});

const constructorCases = [
  ['pin_syntax', f => { f.environment[HASH_KEY] = 'invalid'; }],
  ['pin_mismatch', f => { f.environment[HASH_KEY] = 'f'.repeat(64); }],
  ['binding_json', f => { f.raw = '{'; }],
  ['binding_fields', f => { f.b.extra = true; }],
  ['binding_schema', f => { f.b.schemaVersion = 8; }],
  ['binding_enabled', f => { f.b.enabled = true; }],
  ['binding_environment', f => { f.b.environment = 'production'; }],
  ['single_admission_flag', f => { f.b.singleAdmittedInvocation = false; }],
  ['config_environment_mismatch', f => { f.config.environment = 'production'; }],
  ['raw_environment_mismatch', f => { f.environment.DEPLOYMENT_ENVIRONMENT += ' '; }],
  ['config_source_mismatch', f => { f.config.sourceRevision = 'c'.repeat(40); }],
  ['raw_source_mismatch', f => { f.environment.SOURCE_REVISION += ' '; }],
  ['source_syntax', f => { f.b.sourceRevision = f.config.sourceRevision = f.environment.SOURCE_REVISION = 'g'.repeat(40); }],
  ['project_id_syntax', f => { f.b.projectId = 'invalid'; }],
  ['project_digest_mismatch', f => { f.config.expectedProjectIdSha256 = 'f'.repeat(64); }],
  ['sdk_project_mismatch', f => { f.app.config.projectId = '123456780'; }],
  ['sdk_environment_mismatch', f => { f.app.config.environment = 'production'; }],
  ['control_host_mismatch', f => { f.config.controlHost = 'other.invalid'; }],
  ['table_id_syntax', f => { f.b.tableId = 'invalid'; }],
  ['nonce_syntax', f => { f.b.nonce = 'invalid'; }],
  ['verified_at', f => { f.b.verifiedAt = -1; }],
  ['expires_at', f => { f.b.expiresAt = 'invalid'; }],
  ['legacy_expiry', f => { Object.assign(f.b, { schemaVersion: 3, enabled: true, verifiedAt: 1, expiresAt: 0 }); }],
  ['timeout', f => { f.b.timeoutMs = 0; }],
  ['clock_type', f => { f.options.now = null; }],
  ['transport_factory_type', f => { f.options.transportFactory = null; }],
  ['dormant_times', f => { f.b.verifiedAt = 1; }],
  ['dormant_project_or_table', f => { f.b.tableId = 123456788; }],
  ['dormant_host', f => { f.b.controlHost = f.config.controlHost = 'INVALID_host'; }],
  ['dormant_nonce', f => { f.b.nonce = ['b'.repeat(32)]; }],
  ['capability_fields', f => { f.b.capability.extra = true; }],
  ['evidence_roles', f => { f.b.capability.evidence.extra = {}; }],
  ['evidence_fields', f => { f.b.capability.evidence.access.extra = true; }],
  ['evidence_digest', f => { f.b.capability.evidence.access.digest = 'invalid'; }],
  ['evidence_times', f => { f.b.capability.evidence.access.verifiedAt = 1; }],
];
for (const [reason, mutate] of constructorCases) test('constructor first failure: ' + reason, () => {
  const f = fixture(mutate); rejects(f.make, reason);
  assert.deepEqual(f.calls, { clock: 0, transport: 0 });
});
test('valid dormant construction does not start a clock, transport, timer or filesystem access', () => {
  for (const format of ['inline', 'json', 'tuple-v1']) {
    const f = fixture(() => {}, format), originals = [];
    const deny = () => { throw new Error('synthetic forbidden constructor boundary'); };
    const replace = (object, key) => { originals.push([object, key, object[key]]); object[key] = deny; };
    try {
      for (const key of ['setTimeout', 'setInterval', 'setImmediate']) replace(globalThis, key);
      for (const key of ['readFileSync', 'writeFileSync', 'openSync']) replace(require('node:fs'), key);
      const handler = f.make(); assert.equal(typeof handler.handle, 'function');
    } finally { for (const [object, key, value] of originals.reverse()) object[key] = value; }
    assert.deepEqual(f.calls, { clock: 0, transport: 0 });
  }
});
test('earlier factory predicates suppress later getters and preserve the first rejection', () => {
  const f = fixture(x => { x.environment[HASH_KEY] = 'invalid'; x.config.environment = 'production'; });
  let reads = 0;
  Object.defineProperty(f.config, 'environment', { get() { reads++; throw new Error('synthetic late getter'); } });
  rejects(f.make, 'pin_syntax'); assert.equal(reads, 0);
  const both = fixture(x => { x.environment.DEPLOYMENT_ENVIRONMENT += ' '; x.config.sourceRevision = 'c'.repeat(40); });
  rejects(both.make, 'raw_environment_mismatch');
  rejects(fixture(x => { x.b.extra = true; x.b.enabled = true; }).make, 'binding_fields');
});
test('constructor raw descriptor reads and repeated SDK config reads retain their order', () => {
  const f = fixture(), seen = [];
  const observed = (object, prefix) => new Proxy(object, { get(target, key) {
    seen.push(prefix + key); return Reflect.get(target, key);
  } });
  f.config = observed(f.config, 'config.');
  f.app = observed({ config: observed(f.app.config, 'sdkConfig.') }, 'app.');
  f.environment = observed(f.environment, 'env.');
  f.make();
  assert.deepEqual(seen, ['env.' + JSON_KEY, 'env.' + HASH_KEY, 'config.environment',
    'env.DEPLOYMENT_ENVIRONMENT', 'config.sourceRevision', 'env.SOURCE_REVISION',
    'config.expectedProjectIdSha256', 'app.config', 'sdkConfig.projectId', 'app.config',
    'sdkConfig.environment', 'config.controlHost']);
});
test('escaping raw descriptor getters remain unissued original exceptions', () => {
  const f = fixture(), sentinel = new Error('synthetic raw source getter'); let reads = 0;
  Object.defineProperty(f.environment, 'SOURCE_REVISION', { get() { reads++; throw sentinel; } });
  assert.throws(f.make, error => error === sentinel);
  assert.equal(reads, 1); assert.equal(diagnostic(sentinel), undefined);
});
test('coercing pin syntax retains one conversion and exact pin mismatch behavior', () => {
  const f = fixture(); let conversions = 0;
  f.environment[HASH_KEY] = { toString() { conversions++; return sha(JSON.stringify(f.b)); } };
  rejects(f.make, 'pin_mismatch'); assert.equal(conversions, 1);
});
test('nonstring project IDs preserve the earlier fact error without guessed classification', () => {
  const f = fixture(x => { x.b.projectId = 123456789; });
  assert.throws(f.make, error => error.code === 'FACT_INVALID' && diagnostic(error) === undefined);
});
test('encoder, preflight and direct dormant or activation helpers gain no binding log authority', () => {
  rejects(() => encode(''), undefined);
  const invalid = binding(); invalid.capability.evidence.access.digest = 'invalid';
  rejects(() => validateDormantBinding(invalid), undefined);
  rejects(() => activateDormantBinding(invalid, 'a'.repeat(64), null, 1800000000000), undefined);
  rejects(() => preflight({ baseline: { serializedBytes: 2, entryCount: 0, controlledEntries: [] },
    transport: { parts: {}, marker: 'tuple-v1:invalid' }, bindingSha256: 'a'.repeat(64),
    descriptorPins: { REPORT_CONTROLLER_FUNCTION_ID: '123456786', REPORT_DEPLOYMENT_ID: 'synthetic_controller' } }), undefined);
});
test('legacy context failure is unclassified by the dormant construction diagnostic', () => {
  const f = fixture(x => {
    Object.assign(x.b, { schemaVersion: 3, enabled: true, verifiedAt: 1800000000000, expiresAt: 1800000060000 });
    for (const evidence of Object.values(x.b.capability.evidence)) Object.assign(evidence,
      { verifiedAt: x.b.verifiedAt, expiresAt: x.b.expiresAt });
    x.environment.REPORT_DEPLOYMENT_ID = 'synthetic_mismatch';
  });
  rejects(f.make, undefined); assert.equal(f.calls.transport, 0);
});
test('a handler activation failure does not acquire a constructor binding projection', async () => {
  const f = fixture(), handler = f.make();
  await assert.rejects(handler.handle({ profile: 'report_storage_qualification_v1', action: 'qualify_storage' },
    { actor: { kind: 'internal_controller', identity: f.config.operatorIdHash } }),
  error => error.code === HELD && diagnostic(error) === undefined);
  assert.equal(f.calls.transport, 0);
});

// These guards remain defensive, not synthetic runtime coverage claims:
// - marker count > MAX_PARTS is masked by the marker regex's maximum of 41;
// - wire_length follows exact ASCII part lengths and their arithmetic sum;
// - tuple string >4096 is masked by the earlier <=4096-byte tuple bound;
// - fromTuple's final index is fixed by its 41-scalar shape;
// - raw_type_or_size is masked by ordinary decoder return bounds;
// - dormant_fields/shape/source repeat guarantees on parsed JSON already checked
//   by the constructor (tuple reconstruction masks further nested field shapes).
