'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { normalizeCity, buildGeoNamesUsPostalIndex } = require('../functions/revenue_desk_call_gateway/lib/offline-postal-index');

const MAX_BYTES = 16 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const FILES = Object.freeze(['contracts/postal-snapshot.json', 'data/us-postal.txt',
  'GEONAMES-README.txt', 'normalization-exclusions.json', 'snapshot-artifact.json']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw new Error('Postal snapshot preparation failed validation.'); };
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function directory(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail();
  const absolute = path.resolve(root);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
  }
  return absolute;
}
function regularFile(root, relative, maximum = MAX_BYTES) {
  directory(root);
  if (typeof relative !== 'string' || !relative.split('/').every(part => /^[A-Za-z0-9._-]+$/.test(part)
    && part !== '.' && part !== '..')) fail();
  const file = path.join(root, ...relative.split('/'));
  directory(path.dirname(file));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum) fail();
  const bytes = fs.readFileSync(file);
  if (bytes.length !== stat.size) fail();
  return bytes;
}
function put(root, relative, bytes) {
  if (!relative.split('/').every(part => /^[A-Za-z0-9._-]+$/.test(part) && part !== '.' && part !== '..')) fail();
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' });
}
function json(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
function repositoryRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: __dirname, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function publish(outputRoot, inputs, write) {
  const repo = directory(repositoryRoot());
  if (typeof outputRoot !== 'string' || !path.isAbsolute(outputRoot)) fail();
  const output = path.resolve(outputRoot), parent = directory(path.dirname(output));
  if (inside(repo, output) || fs.existsSync(output)) fail();
  for (const input of inputs) {
    const resolved = path.resolve(input);
    if (inside(repo, resolved) || inside(output, resolved) || inside(resolved, output)) fail();
  }
  const staging = fs.mkdtempSync(path.join(parent, '.postal-candidate-'));
  try {
    const result = write(staging);
    if (fs.existsSync(output)) fail();
    fs.renameSync(staging, output);
    return { ...result, outputRoot: output, installationAuthorized: false };
  } catch (error) {
    // Only remove the exact temporary directory created above, inside the checked parent.
    if (inside(parent, staging) && path.dirname(staging) === parent
      && path.basename(staging).startsWith('.postal-candidate-')) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function validateMetadata(metadata) {
  const fields = ['schemaVersion', 'rawSha256', 'archiveSha256', 'readmeSha256', 'sourceUrl',
    'sourceReadmeUrl', 'retrievedAt', 'snapshotDate', 'expiresOn'];
  if (!metadata || Object.getPrototypeOf(metadata) !== Object.prototype
    || Object.keys(metadata).length !== fields.length || !fields.every(key => Object.hasOwn(metadata, key))
    || metadata.schemaVersion !== 1 || !['rawSha256', 'archiveSha256', 'readmeSha256'].every(key => SHA.test(metadata[key]))
    || metadata.sourceUrl !== 'https://download.geonames.org/export/zip/US.zip'
    || metadata.sourceReadmeUrl !== 'https://download.geonames.org/export/zip/readme.txt'
    || !date(metadata.snapshotDate) || !date(metadata.expiresOn) || metadata.expiresOn < metadata.snapshotDate
    || typeof metadata.retrievedAt !== 'string' || !Number.isFinite(Date.parse(metadata.retrievedAt))
    || new Date(metadata.retrievedAt).toISOString() !== metadata.retrievedAt
    || metadata.retrievedAt.slice(0, 10) !== metadata.snapshotDate) fail();
}

function normalizeSnapshot(raw, readme, metadata) {
  validateMetadata(metadata);
  if (!Buffer.isBuffer(raw) || !raw.length || raw.length > MAX_BYTES
    || !Buffer.isBuffer(readme) || !readme.length || readme.length > 64 * 1024
    || digest(raw) !== metadata.rawSha256 || digest(readme) !== metadata.readmeSha256) fail();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const text = decoder.decode(raw), license = decoder.decode(readme);
  if (!/Creative Commons Attribution 4\.0 License/i.test(license)
    || !license.includes('https://creativecommons.org/licenses/by/4.0/')) fail();
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (!lines.length || lines.length > 1000000) fail();
  const parsed = lines.map((line, index) => {
    const fields = line.split('\t');
    if (fields.length !== 12 || fields[0] !== 'US' || !/^\d{5}$/.test(fields[1]) || line.includes('\r')) fail();
    const stateValid = Boolean(normalizeCity('Example', fields[4]));
    const reason = fields[4] === '' ? 'missing_state_code' : !stateValid
      ? 'state_code_outside_current_supported_set' : !normalizeCity(fields[2], fields[4]) ? 'unsupported_place_name' : null;
    return { line, fields, row: index + 1, reason };
  });
  const excludedZips = new Set(parsed.filter(row => row.reason).map(row => row.fields[1]));
  const exclusions = [], retained = [];
  for (const { line, fields, row, reason } of parsed) {
    if (excludedZips.has(fields[1])) exclusions.push({ row, zip5: fields[1], city: fields[2], state: fields[4],
      reason: reason || 'zip_also_has_unresolved_source_row' });
    else retained.push(line);
  }
  if (!retained.length) fail();
  const data = Buffer.from(`${retained.join('\n')}\n`), sha256 = digest(data), exclusionBytes = json(exclusions);
  if (data.length > MAX_BYTES || exclusionBytes.length > MAX_BYTES) fail();
  const manifest = { schemaVersion: 1, format: 'geonames_us_tsv', sha256,
    snapshotDate: metadata.snapshotDate, expiresOn: metadata.expiresOn,
    sourceUrl: metadata.sourceUrl, sourceReadmeUrl: metadata.sourceReadmeUrl, retrievedAt: metadata.retrievedAt,
    archiveSha256: metadata.archiveSha256, rawUsTxtSha256: metadata.rawSha256, readmeSha256: metadata.readmeSha256,
    license: 'Creative Commons Attribution 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'GeoNames, https://www.geonames.org/; transformed into postal relations; CC BY 4.0.',
    transformation: 'Preserve valid fields and LF line endings. Exclude every row of each ZIP with an unsupported city/state row. No geography or approved coverage is inferred.',
    sourceRows: parsed.length, retainedRows: retained.length, excludedRows: exclusions.length,
    excludedZipCount: excludedZips.size, exclusionsSha256: digest(exclusionBytes), qualificationOnly: true,
    snapshotDateMeaning: 'Retrieval date, not proof of geographic currency.',
    freshnessPolicy: 'Explicit operator-supplied qualification window; not automatic renewal or activation authority.' };
  const index = buildGeoNamesUsPostalIndex({ text: data, expectedSha256: sha256,
    snapshotDate: manifest.snapshotDate, expiresOn: manifest.expiresOn });
  if (index.status !== 'ready') fail();
  return { data, manifest, exclusionBytes, readme, relationCount: index.provenance.relationCount };
}
function buildSnapshot({ rawFile, readmeFile, metadataFile, outputRoot } = {}) {
  if (![rawFile, readmeFile, metadataFile].every(file => typeof file === 'string' && path.isAbsolute(file))) fail();
  const read = (file, max) => regularFile(path.dirname(file), path.basename(file), max);
  const raw = read(rawFile, MAX_BYTES), readme = read(readmeFile, 64 * 1024), metadataBytes = read(metadataFile, 4096);
  const prepared = normalizeSnapshot(raw, readme, JSON.parse(metadataBytes));
  return publish(outputRoot, [rawFile, readmeFile, metadataFile], staging => {
    const contents = new Map([['contracts/postal-snapshot.json', json(prepared.manifest)],
      ['data/us-postal.txt', prepared.data], ['GEONAMES-README.txt', readme],
      ['normalization-exclusions.json', prepared.exclusionBytes]]);
    const artifact = { schemaVersion: 1, status: 'unapproved_postal_candidate', installationAuthorized: false,
      sourceAuthenticity: 'Operator-supplied acquisition metadata; checksum verification is not source authentication.',
      metadataSha256: digest(metadataBytes), relationCount: prepared.relationCount,
      files: [...contents].map(([file, bytes]) => ({ path: file, bytes: bytes.length, sha256: digest(bytes) })) };
    for (const [file, bytes] of contents) put(staging, file, bytes);
    put(staging, 'snapshot-artifact.json', json(artifact));
    for (const [file, original] of [[rawFile, raw], [readmeFile, readme], [metadataFile, metadataBytes]]) {
      if (!read(file, file === rawFile ? MAX_BYTES : 64 * 1024).equals(original)) fail();
    }
    return { sha256: prepared.manifest.sha256, manifestSha256: digest(contents.get('contracts/postal-snapshot.json')) };
  });
}
function argumentsFor(names) {
  const args = process.argv.slice(2), value = {};
  if (args.length !== names.length * 2) fail();
  for (let i = 0; i < args.length; i += 2) {
    if (!names.includes(args[i]) || Object.hasOwn(value, args[i]) || !args[i + 1]) fail();
    value[args[i]] = args[i + 1];
  }
  return value;
}
if (require.main === module) {
  try {
    const a = argumentsFor(['--raw', '--readme', '--metadata', '--output']);
    process.stdout.write(`${JSON.stringify(buildSnapshot({ rawFile: a['--raw'], readmeFile: a['--readme'],
      metadataFile: a['--metadata'], outputRoot: a['--output'] }))}\n`);
  } catch { process.stderr.write('Postal snapshot preparation failed validation.\n'); process.exitCode = 1; }
}
module.exports = { buildSnapshot, normalizeSnapshot, directory, regularFile, put, publish, json, digest,
  repositoryRoot, argumentsFor, FILES, MAX_BYTES, SHA };
