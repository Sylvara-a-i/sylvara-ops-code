'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { normalizeSnapshot, buildSnapshot, digest, json, regularFile, publish, MAX_BYTES } = require('../../../scripts/build-postal-snapshot');
const { readSnapshot, inventory } = require('../../../scripts/compose-postal-snapshot');
const { lookupPostalIndex, buildGeoNamesUsPostalIndex, normalizeZip } = require('../lib/offline-postal-index');

// Deliberately fictional format fixtures. No downloaded geography, customer data or native identifiers.
const readme = Buffer.from('Synthetic format fixture. Creative Commons Attribution 4.0 License. https://creativecommons.org/licenses/by/4.0/\n');
const row = (zip, city, state) => ['US', zip, city, 'Example', state, '', '', '', '', '0', '0', '1'].join('\t');
const raw = Buffer.from([
  row('00123', 'Example City', 'NY'), row('00123', 'Example Alias', 'NY'),
  row('96860', 'Example Island', 'HI'), row('96860', 'FPO AA', ''),
  row('96960', 'Example Atoll', 'MH'), row('09001', 'APO AE', ''),
].join('\n') + '\n');
function metadata(bytes = raw) {
  const retrievedAt = new Date().toISOString();
  return { schemaVersion: 1, rawSha256: digest(bytes), archiveSha256: digest(Buffer.from('synthetic-archive')),
    readmeSha256: digest(readme), sourceUrl: 'https://download.geonames.org/export/zip/US.zip',
    sourceReadmeUrl: 'https://download.geonames.org/export/zip/readme.txt', retrievedAt,
    snapshotDate: retrievedAt.slice(0, 10), expiresOn: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) };
}
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'postal-release-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('postal-release-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function inputs(root) {
  const rawFile = path.join(root, 'US.txt'), readmeFile = path.join(root, 'readme.txt'), metadataFile = path.join(root, 'metadata.json');
  fs.writeFileSync(rawFile, raw); fs.writeFileSync(readmeFile, readme); fs.writeFileSync(metadataFile, json(metadata()));
  return { rawFile, readmeFile, metadataFile };
}
function snapshot(root) {
  const outputRoot = path.join(root, 'snapshot');
  const result = buildSnapshot({ ...inputs(root), outputRoot });
  return { root: outputRoot, dataSha: result.sha256, manifestSha: result.manifestSha256 };
}
function tree(root) { return inventory(root).map(name => [name, digest(regularFile(root, name))]); }
function command(args, cwd) { return spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 120000 }); }
function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
function copyTrackedSource(repository, destination) {
  const names = git(['ls-files', '--cached', '-z', '--', 'src/zoho-catalyst/revenue-desk-call-runtime',
    'src/zoho-catalyst/revenue-desk-analytics'], repository).split('\0').filter(Boolean);
  assert.ok(names.length > 0);
  for (const name of names) {
    const bytes = regularFile(repository, name);
    const target = path.join(destination, ...name.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx' });
  }
}

test('normalization preserves strings and aliases, quarantining every row of an unresolved ZIP', () => {
  const m = metadata(), a = normalizeSnapshot(raw, readme, m), b = normalizeSnapshot(raw, readme, m);
  assert.deepEqual(a.data, b.data); assert.deepEqual(a.exclusionBytes, b.exclusionBytes); assert.deepEqual(a.manifest, b.manifest);
  assert.equal(a.manifest.excludedRows, 4); assert.equal(a.manifest.excludedZipCount, 3);
  const excluded = JSON.parse(a.exclusionBytes);
  assert.equal(excluded[0].reason, 'zip_also_has_unresolved_source_row');
  const index = buildGeoNamesUsPostalIndex({ text: a.data, expectedSha256: a.manifest.sha256,
    snapshotDate: m.snapshotDate, expiresOn: m.expiresOn });
  assert.equal(lookupPostalIndex(index, { zip5: '00123', asOf: m.snapshotDate }).relations.length, 2);
  for (const zip5 of ['96860', '96960', '09001']) assert.equal(lookupPostalIndex(index, { zip5, asOf: m.snapshotDate }).relations.length, 0);
  assert.equal(normalizeZip('00123-1234').zip5, '00123'); assert.equal(normalizeZip('00123-1234').extensionValidated, false);
  assert.equal(Object.hasOwn(a.manifest, 'approvedCoverage'), false);
});

test('structural corruption, malformed UTF-8, wrong pin, missing attribution and invalid dates fail', () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.from(row('1234', 'Example', 'NY')),
    Buffer.from('US\t12345\ttruncated\n'), Buffer.from(row('12345', 'Example', 'NY').replace('US\t', 'CA\t'))]) {
    assert.throws(() => normalizeSnapshot(bytes, readme, metadata(bytes)));
  }
  assert.throws(() => normalizeSnapshot(raw, readme, { ...metadata(), rawSha256: '0'.repeat(64) }));
  assert.throws(() => normalizeSnapshot(raw, Buffer.from('no license'), { ...metadata(), readmeSha256: digest(Buffer.from('no license')) }));
  for (const change of [{ expiresOn: '2026-02-30' }, { expiresOn: '2000-01-01' }, { snapshotDate: '2000-01-01' },
    { retrievedAt: 'yesterday' }, { sourceUrl: 'https://example.invalid/' }, { approvedCoverage: {} }]) {
    assert.throws(() => normalizeSnapshot(raw, readme, { ...metadata(), ...change }));
  }
});

test('unsupported place spelling also quarantines the otherwise valid shared ZIP', () => {
  const bytes = Buffer.from([row('00123', 'Example', 'NY'), row('00123', 'Invalid1', 'NY'), row('00234', 'Valid', 'NY')].join('\n'));
  const result = normalizeSnapshot(bytes, readme, metadata(bytes));
  assert.equal(result.manifest.excludedRows, 2); assert.equal(result.manifest.retainedRows, 1);
  assert.equal(JSON.parse(result.exclusionBytes)[1].reason, 'unsupported_place_name');
});

test('normalization cannot grow a maximum-sized input beyond the loader byte limit', () => {
  const fields = row('00123', 'Example City', 'NY').split('\t');
  fields[5] = 'x'.repeat(MAX_BYTES - Buffer.byteLength(fields.join('\t')));
  const bytes = Buffer.from(fields.join('\t')); // No final LF: normalization would add one byte.
  assert.equal(bytes.length, MAX_BYTES);
  assert.throws(() => normalizeSnapshot(bytes, readme, metadata(bytes)));
});

test('candidate publication is reproducible, pinned and never overwrites an existing destination', t => {
  const root = temp(t), source = inputs(root), outputRoot = path.join(root, 'candidate');
  const first = buildSnapshot({ ...source, outputRoot });
  const secondRoot = path.join(root, 'repeated'); buildSnapshot({ ...source, outputRoot: secondRoot });
  assert.deepEqual(tree(outputRoot), tree(secondRoot));
  assert.equal(first.installationAuthorized, false);
  assert.equal(readSnapshot(outputRoot, first.sha256, first.manifestSha256).manifest.excludedRows, 4);
  const before = tree(outputRoot);
  assert.throws(() => buildSnapshot({ ...source, outputRoot })); assert.deepEqual(tree(outputRoot), before);
});

test('wrong dataset/manifest pins, unexpected files, changed ledger and stale/future snapshots fail', t => {
  const root = temp(t), s = snapshot(root);
  assert.throws(() => readSnapshot(s.root, '0'.repeat(64), s.manifestSha));
  assert.throws(() => readSnapshot(s.root, s.dataSha, '0'.repeat(64)));
  fs.writeFileSync(path.join(s.root, 'unexpected.txt'), 'unexpected');
  assert.throws(() => readSnapshot(s.root, s.dataSha, s.manifestSha)); fs.unlinkSync(path.join(s.root, 'unexpected.txt'));
  fs.appendFileSync(path.join(s.root, 'normalization-exclusions.json'), ' ');
  assert.throws(() => readSnapshot(s.root, s.dataSha, s.manifestSha));
  for (const direction of [-1, 1]) {
    const other = path.join(root, `date-${direction}`); fs.mkdirSync(other);
    const source = inputs(other), m = JSON.parse(fs.readFileSync(source.metadataFile));
    const day = new Date(Date.now() + direction * 60 * 86400000).toISOString().slice(0, 10);
    Object.assign(m, { snapshotDate: day, expiresOn: day, retrievedAt: `${day}T00:00:00.000Z` });
    fs.writeFileSync(source.metadataFile, json(m)); const outputRoot = path.join(other, 'out');
    const candidate = buildSnapshot({ ...source, outputRoot });
    assert.throws(() => readSnapshot(outputRoot, candidate.sha256, candidate.manifestSha256));
  }
});

test('symlink paths and in-repository outputs are rejected', t => {
  const root = temp(t), source = inputs(root), link = path.join(root, 'linked');
  try { fs.symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Platform denied symlink creation.'); return; } throw error; }
  assert.throws(() => buildSnapshot({ ...source, rawFile: path.join(link, 'US.txt'), outputRoot: path.join(root, 'out') }));
  assert.throws(() => regularFile(root, '../outside.txt'));
  const inside = path.resolve(__dirname, 'must-not-create-postal-output');
  assert.throws(() => buildSnapshot({ ...source, outputRoot: inside })); assert.equal(fs.existsSync(inside), false);
});

test('interrupted publication removes only its own staging tree and preserves inputs', t => {
  const root = temp(t), input = path.join(root, 'input.txt'), output = path.join(root, 'out'); fs.writeFileSync(input, 'keep');
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error('synthetic interruption'); };
  try { assert.throws(() => publish(output, [input], staging => { fs.writeFileSync(path.join(staging, 'candidate'), 'data'); })); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(input, 'utf8'), 'keep'); assert.equal(fs.existsSync(output), false);
  assert.deepEqual(fs.readdirSync(root), ['input.txt']);
});

test('Git fixtures copy only tracked files and exclude ignored or untracked private material', t => {
  const root = temp(t), source = path.join(root, 'source'), target = path.join(root, 'copy');
  const component = 'src/zoho-catalyst/revenue-desk-call-runtime';
  fs.mkdirSync(path.join(source, component), { recursive: true });
  fs.writeFileSync(path.join(source, '.gitignore'), '.env\n*.private\n');
  fs.writeFileSync(path.join(source, component, 'tracked.txt'), 'synthetic tracked source');
  git(['init'], source); git(['add', '--', '.gitignore', `${component}/tracked.txt`], source);
  fs.writeFileSync(path.join(source, component, '.env'), 'synthetic ignored sentinel');
  fs.writeFileSync(path.join(source, component, 'snapshot.private'), 'synthetic ignored data');
  fs.writeFileSync(path.join(source, component, 'untracked.txt'), 'synthetic untracked sentinel');
  copyTrackedSource(source, target);
  assert.deepEqual(inventory(target), [`${component}/tracked.txt`]);
  git(['init'], target); git(['add', '--all'], target);
  assert.equal(git(['ls-files'], target), `${component}/tracked.txt`);
});

test('composition verifies Git source, preserves base, pins the private asset and leaves routing disabled', t => {
  const root = temp(t), repo = path.join(root, 'repo'), component = 'src/zoho-catalyst/revenue-desk-call-runtime';
  const runtimeRoot = path.resolve(__dirname, '../../..');
  // New files must be staged before this test, so only the reviewed tracked set enters its Git fixture.
  copyTrackedSource(git(['rev-parse', '--show-toplevel'], runtimeRoot), repo);
  git(['init'], repo); git(['add', '--all'], repo);
  git(['-c', 'user.name=Postal Release Test', '-c', 'user.email=postal-test@example.invalid', 'commit', '-m', 'synthetic fixture'], repo);
  const revision = git(['rev-parse', 'HEAD'], repo), base = path.join(root, 'base');
  const built = command([path.join(repo, component, 'scripts/build-release.js'), '--revision', revision, '--output', base], repo);
  assert.equal(built.status, 0, built.stderr);
  const s = snapshot(root), beforeBase = tree(base), beforeSnapshot = tree(s.root);
  const baseSha = digest(fs.readFileSync(path.join(base, 'release-manifest.json')));
  const composer = path.join(repo, component, 'scripts/compose-postal-snapshot.js');
  const args = output => [composer, '--source-revision', revision, '--runtime-artifact', base, '--base-manifest-sha256', baseSha,
    '--snapshot-artifact', s.root, '--snapshot-sha256', s.dataSha, '--snapshot-manifest-sha256', s.manifestSha, '--output', output];
  const output = path.join(root, 'composed'), result = command(args(output), repo);
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(tree(base), beforeBase); assert.deepEqual(tree(s.root), beforeSnapshot);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'composition-manifest.json')));
  assert.equal(manifest.routeEnabled, false); assert.equal(manifest.installationAuthorized, false);
  assert.equal(manifest.changedRuntimePaths.length, 3); assert.equal(manifest.snapshotSha256, s.dataSha);
  assert.equal(fs.existsSync(path.join(output, 'runtime/release-manifest.json')), false);
  assert.deepEqual(fs.readFileSync(path.join(output, 'provenance/runtime-base-release-manifest.json')),
    fs.readFileSync(path.join(base, 'release-manifest.json')));
  for (const file of manifest.files) assert.equal(digest(regularFile(output, file.path)), file.sha256);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'runtime/functions/revenue_desk_call_gateway/contracts/service-area-tool-contract.json'))).enabled, false);
  const repeated = path.join(root, 'repeated'); assert.equal(command(args(repeated), repo).status, 0); assert.deepEqual(tree(output), tree(repeated));
  assert.notEqual(command(args(output), repo).status, 0);
  const entry = path.join(base, 'functions/revenue_desk_call_gateway/index.js'), original = fs.readFileSync(entry);
  fs.appendFileSync(entry, '\n// synthetic unexpected code\n');
  const failed = path.join(root, 'failed'); assert.notEqual(command(args(failed), repo).status, 0); assert.equal(fs.existsSync(failed), false);
  fs.writeFileSync(entry, original);
  fs.writeFileSync(path.join(base, 'unexpected.txt'), 'unexpected');
  assert.notEqual(command(args(failed), repo).status, 0); fs.unlinkSync(path.join(base, 'unexpected.txt'));
  fs.writeFileSync(path.join(repo, 'dirty.txt'), 'dirty'); assert.notEqual(command(args(failed), repo).status, 0);
  assert.equal(fs.existsSync(failed), false); assert.deepEqual(tree(base), beforeBase);
});
