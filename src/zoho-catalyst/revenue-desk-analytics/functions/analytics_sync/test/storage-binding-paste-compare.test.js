'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const tool = require('../../../tools/compare-storage-binding-paste');
const { encodeStorageBinding } = require('../lib/report-storage-binding');
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const synthetic = name => digest('public synthetic paste comparison ' + name);

function fixture() {
  const table = (id, name, field) => ({ id, name, schemaSha256: synthetic(name + 'schema'),
    uniquenessSha256: synthetic(name + 'unique'), uniqueField: field, projectionSha256: synthetic(name + 'projection') });
  const evidence = name => ({ digest: synthetic(name), verifiedAt: 0, expiresAt: 0 });
  const binding = { schemaVersion: 6, enabled: false, environment: 'Development', sourceRevision: synthetic('source').slice(0, 40),
    projectId: '101000001', controlHost: 'synthetic.development.catalystserverless.com', tableId: '101000003', nonce: synthetic('nonce'),
    capability: { region: 'US', origin: 'https://synthetic.development.catalystserverless.com', controllerFunctionId: '101000002',
      deploymentId: 'synthetic_deployment', sdkVersion: '3.4.0', authMode: 'user', authType: 'admin', creatorPolicy: 'observed_consistent_v1',
      tables: { reportRuns: table('101000003', 'ReportRuns', 'IdempotencyKey'), eventReceipts: table('101000004', 'RevenueDeskEventReceipts', 'EVENT_KEY') },
      evidence: { ownerAuthorization: evidence('owner'), ownership: evidence('ownership'), access: evidence('access') } },
    verifiedAt: 0, expiresAt: 0, timeoutMs: 25000, singleAdmittedInvocation: true };
  const raw = JSON.stringify(binding);
  const transport = encodeStorageBinding(raw, { partSize: 400, format: 'tuple-v1' });
  assert.equal(Object.keys(transport.parts).length, 3);
  const bytes = Buffer.from(JSON.stringify(transport));
  const values = { ...transport.parts, REPORT_STORAGE_QUALIFICATION_JSON: transport.marker, REPORT_STORAGE_QUALIFICATION_SHA256: digest(raw) };
  return { transport, bytes, values, bindingSha256: digest(raw) };
}
function artifact(t) {
  const data = fixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-paste-compare-'));
  const file = path.join(dir, 'transport.json');
  fs.writeFileSync(file, data.bytes);
  // Cleanup only this one explicitly created file and its empty directory.
  t.after(() => { fs.unlinkSync(file); fs.rmdirSync(dir); });
  return { ...data, file, pins: { transportPath: file, transportSha256: digest(data.bytes), bindingSha256: data.bindingSha256 } };
}
function terminal({ paused = true } = {}) {
  const input = new EventEmitter(), signals = new EventEmitter();
  Object.assign(input, { isTTY: true, isRaw: false, readableEncoding: null, readableLength: 0, readableFlowing: paused ? false : null });
  const modes = [], output = { isTTY: true, text: '', write(value) { this.text += value; } };
  input.isPaused = () => paused;
  input.setRawMode = value => { input.isRaw = value; modes.push(value); };
  input.pause = () => { paused = true; };
  input.resume = () => { paused = false; };
  const errors = { text: '', write(value) { this.text += value; } };
  return { input, output, signals, modes, errors };
}
const args = pins => ['--transport', pins.transportPath, '--transport-sha256', pins.transportSha256, '--binding-sha256', pins.bindingSha256];
function clean(term) {
  assert.equal(term.input.isRaw, false);
  assert.equal(term.input.isPaused(), true);
  assert.equal(term.input.listenerCount('data'), 0);
  for (const event of ['error', 'end', 'close']) assert.equal(term.input.listenerCount(event), 0);
  for (const event of ['SIGINT', 'SIGTERM', 'SIGHUP']) assert.equal(term.signals.listenerCount(event), 0);
}

test('exact pinned artifact reconstructs the expected binding before comparison; key order is irrelevant', t => {
  const data = artifact(t), expected = tool.loadExpected(data.pins);
  const values = Object.fromEntries(Object.entries(data.values).reverse());
  const result = tool.comparePasted(expected, JSON.stringify(values));
  assert.equal(result.allMatch, true);
  assert.equal(result.fields.length, 5);
  assert.deepEqual(result.fields.map(field => field.key), tool.KEYS);
  const encoded = JSON.stringify(result);
  for (const value of Object.values(values)) assert.equal(encoded.includes(value), false);
});
for (const [name, edit] of [
  ['short', value => value.slice(1)], ['long', value => value + 'a'],
  ['same length corruption', value => (value[0] === 'a' ? 'b' : 'a') + value.slice(1)],
  ['leading whitespace', value => ' ' + value], ['trailing newline', value => value + '\n'],
  ['Unicode astral', value => value + '\u{1f642}'], ['Unicode combining', value => value + 'e\u0301'],
  ['embedded tab', value => value.slice(0, 1) + '\t' + value.slice(1)]
]) test('raw value comparison preserves ' + name, t => {
  const data = artifact(t), values = { ...data.values }, key = tool.KEYS[0];
  values[key] = edit(values[key]);
  const result = tool.comparePasted(tool.loadExpected(data.pins), JSON.stringify(values));
  assert.equal(result.allMatch, false);
  assert.equal(result.fields[0].observedCodeUnits, values[key].length);
  assert.equal(result.fields[0].observedUtf8Bytes, Buffer.byteLength(values[key]));
  assert.equal(result.fields[0].match, false);
  assert.equal(result.fields.slice(1).every(field => field.match), true);
});
test('marker and binding hash are compared literally and never printed', t => {
  const data = artifact(t), expected = tool.loadExpected(data.pins);
  for (const key of tool.KEYS.slice(3)) {
    const result = tool.comparePasted(expected, JSON.stringify({ ...data.values, [key]: data.values[key] + ' ' }));
    assert.equal(result.allMatch, false);
    assert.equal(result.fields.find(field => field.key === key).match, false);
  }
});
test('JSON unescaping preserves newline, CR, tabs, Unicode, and lone surrogates exactly', () => {
  const values = Object.fromEntries(tool.KEYS.map(key => [key, '\n\r\t\u{1f642}e\u0301\ud800']));
  assert.deepEqual({ ...tool.parsePasted(JSON.stringify(values)) }, values);
});
for (const name of ['missing', 'extra', 'duplicate', 'escaped duplicate', 'nonstring', 'array', 'trailing garbage', 'trailing comma', 'unescaped control', 'oversize']) {
  test('rejects ' + name + ' with a fixed error', () => {
    const values = fixture().values, key = tool.KEYS[0];
    let text;
    if (name === 'missing') { delete values[key]; text = JSON.stringify(values); }
    if (name === 'extra') text = JSON.stringify({ ...values, EXTRA: 'synthetic private-looking sentinel' });
    if (name === 'duplicate') text = JSON.stringify(values).slice(0, -1) + ',' + JSON.stringify(key) + ':"duplicate"}';
    if (name === 'escaped duplicate') text = JSON.stringify(values).slice(0, -1) + ',"\\u0052' + key.slice(1) + '":"duplicate"}';
    if (name === 'nonstring') text = JSON.stringify({ ...values, [key]: 1 });
    if (name === 'array') text = JSON.stringify(Object.values(values));
    if (name === 'trailing garbage') text = JSON.stringify(values) + 'sentinel';
    if (name === 'trailing comma') text = JSON.stringify(values).slice(0, -1) + ',}';
    if (name === 'unescaped control') text = JSON.stringify(values).replace(values[key], 'raw\nnewline');
    if (name === 'oversize') text = ' '.repeat(tool.LIMIT + 1);
    assert.throws(() => tool.parsePasted(text), { message: 'LOCAL_COMPARE_REJECTED' });
  });
}
test('artifact pin, expected binding digest, shape, and decoder failures reject before prompting', async t => {
  const data = artifact(t);
  const cases = [
    { ...data.pins, transportSha256: synthetic('wrong transport') },
    { ...data.pins, bindingSha256: synthetic('wrong binding') }
  ];
  for (const pins of cases) {
    const term = terminal();
    assert.equal(await tool.run(args(pins), term.input, term.output, term.errors, term.signals), 2);
    assert.equal(term.output.text, '');
    assert.equal(term.errors.text, 'LOCAL_COMPARE_REJECTED\n');
    assert.deepEqual(term.modes, []);
  }
  for (const modified of [
    { ...data.transport, extra: 'synthetic' },
    { ...data.transport, parts: { ...data.transport.parts, REPORT_STORAGE_QUALIFICATION_PART_3: 'extra' } },
    { ...data.transport, marker: data.transport.marker + ' ' },
    { ...data.transport, parts: { ...data.transport.parts, [tool.KEYS[0]]: 'short' } }
  ]) {
    const bytes = Buffer.from(JSON.stringify(modified)); fs.writeFileSync(data.file, bytes);
    assert.throws(() => tool.loadExpected({ ...data.pins, transportSha256: digest(bytes) }));
  }
});
test('hidden adapter preserves split UTF8 and never echoes input; restores terminal', async () => {
  const term = terminal(), text = '\ufeffsynthetic \u{1f642}\nraw spaces ';
  const pending = tool.captureHidden(term.input, term.output, term.signals), bytes = Buffer.from(text);
  for (const byte of bytes) term.input.emit('data', Buffer.from([byte]));
  term.input.emit('data', Buffer.from([4]));
  assert.equal(await pending, text);
  assert.equal(term.output.text.includes(text), false);
  assert.deepEqual(term.modes, [true, false]); clean(term);
});
test('initial readableFlowing null is paused at completion so a real CLI can exit', async () => {
  const term = terminal({ paused: false });
  assert.equal(term.input.readableFlowing, null);
  const pending = tool.captureHidden(term.input, term.output, term.signals);
  term.input.emit('data', Buffer.from('synthetic\x04'));
  assert.equal(await pending, 'synthetic'); clean(term);
});
for (const kind of ['cancel', 'overflow', 'invalid UTF8', 'data after finish', 'EOF', 'close', 'error', 'SIGINT', 'SIGTERM', 'SIGHUP']) {
  test('hidden adapter rejects ' + kind + ' and restores terminal/listeners', async () => {
    const term = terminal(), pending = tool.captureHidden(term.input, term.output, term.signals);
    const rejected = assert.rejects(pending, { message: 'LOCAL_COMPARE_REJECTED' });
    term.input.emit('data', Buffer.from('synthetic hidden sentinel'));
    if (kind === 'cancel') term.input.emit('data', Buffer.from([3]));
    if (kind === 'overflow') term.input.emit('data', Buffer.alloc(tool.LIMIT + 1, 97));
    if (kind === 'invalid UTF8') term.input.emit('data', Buffer.from([255, 4]));
    if (kind === 'data after finish') term.input.emit('data', Buffer.from([4, 97]));
    if (kind === 'EOF') term.input.emit('end');
    if (kind === 'close') term.input.emit('close');
    if (kind === 'error') term.input.emit('error', new Error('synthetic hidden exception payload'));
    if (kind.startsWith('SIG')) term.signals.emit(kind);
    await rejected; clean(term);
    assert.equal(term.output.text.includes('sentinel'), false);
    assert.equal(term.output.text.includes('payload'), false);
  });
}
test('capture hard bound includes exact-limit success and limit-plus-one rejection', async () => {
  for (const size of [tool.LIMIT, tool.LIMIT + 1]) {
    const term = terminal(), pending = tool.captureHidden(term.input, term.output, term.signals);
    const expectation = size > tool.LIMIT ? assert.rejects(pending) : pending;
    term.input.emit('data', Buffer.alloc(size, 97));
    if (size <= tool.LIMIT) term.input.emit('data', Buffer.from([4]));
    const text = await expectation;
    if (size <= tool.LIMIT) assert.equal(text.length, tool.LIMIT);
    clean(term);
  }
});
test('raw-mode and prompt failures attempt cleanup and print no exception', async () => {
  for (const failure of ['raw', 'prompt', 'resume']) {
    const term = terminal();
    if (failure === 'raw') { const original = term.input.setRawMode; term.input.setRawMode = value => { original(value); if (value) throw new Error('hidden raw'); }; }
    if (failure === 'prompt') term.output.write = () => { throw new Error('hidden output'); };
    if (failure === 'resume') term.input.resume = () => { throw new Error('hidden resume'); };
    await assert.rejects(tool.captureHidden(term.input, term.output, term.signals), { message: 'LOCAL_COMPARE_REJECTED' });
    clean(term);
  }
});
test('TTY, unshared input and raw-mode checks reject before prompts', async () => {
  for (const kind of ['input', 'output', 'raw', 'listener', 'readable listener', 'encoding', 'buffer']) {
    const term = terminal();
    if (kind === 'input') term.input.isTTY = false;
    if (kind === 'output') term.output.isTTY = false;
    if (kind === 'raw') term.input.isRaw = true;
    if (kind === 'listener') term.input.on('data', () => {});
    if (kind === 'readable listener') term.input.on('readable', () => { assert.fail('must not consume input'); });
    if (kind === 'encoding') term.input.readableEncoding = 'utf8';
    if (kind === 'buffer') term.input.readableLength = 1;
    await assert.rejects(tool.captureHidden(term.input, term.output, term.signals));
    assert.equal(term.output.text, ''); assert.deepEqual(term.modes, []);
  }
});
test('interactive run emits only lengths/matches and fixed labels; no argv/env input fallback', async t => {
  const data = artifact(t), term = terminal();
  const pending = tool.run(args(data.pins), term.input, term.output, term.errors, term.signals);
  term.input.emit('data', Buffer.from(JSON.stringify(data.values)));
  term.input.emit('data', Buffer.from([4]));
  assert.equal(await pending, 0); clean(term);
  for (const value of Object.values(data.values)) assert.equal(term.output.text.includes(value), false);
  assert.equal(term.errors.text, '');
  const result = JSON.parse(term.output.text.trim().split('\n').at(-1));
  assert.equal(result.allMatch, true);
  const redirected = terminal(); redirected.input.isTTY = false;
  assert.equal(await tool.run(args(data.pins), redirected.input, redirected.output, redirected.errors, redirected.signals), 2);
  assert.equal(redirected.output.text, '');
  const extra = terminal();
  assert.equal(await tool.run([...args(data.pins), '--paste', 'synthetic'], extra.input, extra.output, extra.errors, extra.signals), 2);
  assert.equal(extra.output.text, '');
});
test('artifact drift during capture rejects without reporting matches', async t => {
  const data = artifact(t), term = terminal();
  const pending = tool.run(args(data.pins), term.input, term.output, term.errors, term.signals);
  fs.appendFileSync(data.file, ' ');
  term.input.emit('data', Buffer.from(JSON.stringify(data.values) + '\x04'));
  assert.equal(await pending, 2); clean(term);
  assert.equal(term.output.text.includes('allMatch'), false);
  assert.equal(term.errors.text, 'LOCAL_COMPARE_REJECTED\n');
});
