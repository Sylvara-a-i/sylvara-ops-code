'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readTree, readBlob, writeCoreBridges, stampSource, validateArtifact,
  SOURCE_STAMP_PATH, ANALYTICS_STAMP_PATH, CONTROL_ANALYTICS_STAMP_PATH } = require('./build-release');
const { directory, regularFile, put, publish, json, digest, argumentsFor, FILES, SHA } = require('./build-postal-snapshot');
const { loadPostalSnapshot } = require('../functions/revenue_desk_call_gateway/lib/postal-index-loader');
const { lookupPostalIndex } = require('../functions/revenue_desk_call_gateway/lib/offline-postal-index');

const GATEWAY = 'functions/revenue_desk_call_gateway';
const SNAPSHOT = 'contracts/postal-snapshot.json';
const DATA = 'data/us-postal.txt';
const ATTRIBUTION = 'contracts/postal-attribution.json';
const fail = () => { throw new Error('Postal release composition failed validation.'); };
const git = args => execFileSync('git', args, { cwd: __dirname, encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }).trim();
function cleanSource(revision) {
  if (!/^[a-f0-9]{40}$/.test(revision || '') || git(['rev-parse', 'HEAD']) !== revision
    || git(['status', '--porcelain=v1', '--untracked-files=all'])) fail();
}
function inventory(root) {
  directory(root);
  const files = [];
  function visit(relative) {
    for (const item of fs.readdirSync(path.join(root, relative))) {
      if (!/^[A-Za-z0-9._-]+$/.test(item) || item === '.' || item === '..') fail();
      const name = relative ? `${relative}/${item}` : item;
      const stat = fs.lstatSync(path.join(root, name));
      if (stat.isSymbolicLink()) fail();
      if (stat.isDirectory()) visit(name);
      else if (stat.isFile()) files.push(name);
      else fail();
    }
  }
  visit('');
  return files.sort();
}
function sameNames(left, right) { return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort()); }
function readSnapshot(root, dataSha256, manifestSha256) {
  if (![dataSha256, manifestSha256].every(value => SHA.test(value || ''))
    || !sameNames(inventory(root), FILES)) fail();
  const bytes = new Map(FILES.map(name => [name, regularFile(root, name)]));
  if (digest(bytes.get(SNAPSHOT)) !== manifestSha256 || digest(bytes.get(DATA)) !== dataSha256) fail();
  const manifest = JSON.parse(bytes.get(SNAPSHOT));
  const artifact = JSON.parse(bytes.get('snapshot-artifact.json'));
  const exclusions = JSON.parse(bytes.get('normalization-exclusions.json'));
  const readme = bytes.get('GEONAMES-README.txt');
  if (manifest.format !== 'geonames_us_tsv' || manifest.sha256 !== dataSha256
    || manifest.qualificationOnly !== true || manifest.license !== 'Creative Commons Attribution 4.0'
    || manifest.licenseUrl !== 'https://creativecommons.org/licenses/by/4.0/'
    || manifest.sourceUrl !== 'https://download.geonames.org/export/zip/US.zip'
    || manifest.readmeSha256 !== digest(readme)
    || !/Creative Commons Attribution 4\.0 License/i.test(readme.toString('utf8'))
    || manifest.exclusionsSha256 !== digest(bytes.get('normalization-exclusions.json'))
    || !Array.isArray(exclusions) || exclusions.length !== manifest.excludedRows
    || artifact.schemaVersion !== 1 || artifact.status !== 'unapproved_postal_candidate'
    || artifact.installationAuthorized !== false || !Array.isArray(artifact.files)
    || !sameNames(artifact.files.map(file => file.path), FILES.filter(name => name !== 'snapshot-artifact.json'))) fail();
  for (const item of artifact.files) {
    const data = bytes.get(item.path);
    if (item.sha256 !== digest(data) || item.bytes !== data.length) fail();
  }
  const excludedZips = new Set();
  for (const row of exclusions) {
    if (!row || !/^\d{5}$/.test(row.zip5) || !Number.isSafeInteger(row.row) || row.row < 1
      || !['missing_state_code', 'state_code_outside_current_supported_set', 'unsupported_place_name',
        'zip_also_has_unresolved_source_row'].includes(row.reason)) fail();
    excludedZips.add(row.zip5);
  }
  const lines = bytes.get(DATA).toString('utf8').trimEnd().split('\n');
  if (manifest.retainedRows !== lines.length || manifest.sourceRows !== lines.length + exclusions.length
    || manifest.excludedZipCount !== excludedZips.size
    || lines.some(line => excludedZips.has(line.split('\t')[1]))) fail();
  // Execute only the selected checkout's reviewed loader, never code supplied by an input artifact.
  const loaded = loadPostalSnapshot({ packageRoot: root });
  if (loaded.sha256 !== dataSha256 || loaded.index.status !== 'ready'
    || loaded.index.provenance.relationCount !== artifact.relationCount
    || lookupPostalIndex(loaded.index, { asOf: new Date().toISOString().slice(0, 10) }).status !== 'ready') fail();
  return { bytes, manifest, artifact, readme };
}

function compose({ sourceRevision, runtimeArtifact, baseManifestSha256, snapshotArtifact,
  dataSha256, snapshotManifestSha256, outputRoot } = {}) {
  cleanSource(sourceRevision);
  if (![runtimeArtifact, snapshotArtifact, outputRoot].every(value => typeof value === 'string' && path.isAbsolute(value))
    || !SHA.test(baseManifestSha256 || '')) fail();
  const postal = readSnapshot(snapshotArtifact, dataSha256, snapshotManifestSha256);
  const baseBytes = regularFile(runtimeArtifact, 'release-manifest.json');
  if (digest(baseBytes) !== baseManifestSha256) fail();
  const baseManifest = JSON.parse(baseBytes);
  return publish(outputRoot, [runtimeArtifact, snapshotArtifact], staging => {
    const runtime = path.join(staging, 'runtime');
    const entries = readTree(sourceRevision);
    for (const entry of entries) put(runtime, entry.relative, readBlob(entry.object));
    stampSource(runtime, SOURCE_STAMP_PATH, '__REVENUE_DESK_SOURCE_REVISION__', sourceRevision);
    stampSource(runtime, ANALYTICS_STAMP_PATH, '__SYLVARA_UNSTAMPED_SOURCE_REVISION__', sourceRevision);
    if (entries.some(entry => entry.relative === CONTROL_ANALYTICS_STAMP_PATH)) {
      stampSource(runtime, CONTROL_ANALYTICS_STAMP_PATH, '__SYLVARA_UNSTAMPED_SOURCE_REVISION__', sourceRevision);
    }
    const generated = writeCoreBridges(runtime, entries), sourceFiles = [...entries, ...generated];
    if (baseManifest.schema_version !== 1 || baseManifest.source_revision !== sourceRevision
      || !Array.isArray(baseManifest.files) || baseManifest.files.length !== sourceFiles.length
      || !sameNames(inventory(runtimeArtifact), [...sourceFiles.map(file => file.relative), 'release-manifest.json'])) fail();
    const original = new Map([['release-manifest.json', baseBytes]]);
    for (const entry of sourceFiles) {
      const expected = regularFile(runtime, entry.relative), actual = regularFile(runtimeArtifact, entry.relative);
      const source = entry.source || entry;
      const matching = baseManifest.files.filter(row => row.path === entry.relative && row.sha256 === digest(actual)
        && row.source_path === source.repositoryPath && row.source_sha256 === digest(readBlob(source.object)));
      if (!expected.equals(actual) || matching.length !== 1) fail();
      original.set(entry.relative, actual);
    }
    const gateway = path.join(runtime, GATEWAY);
    if (JSON.parse(regularFile(gateway, 'contracts/service-area-tool-contract.json')).enabled !== false
      || fs.existsSync(path.join(gateway, DATA)) || fs.existsSync(path.join(gateway, ATTRIBUTION))) fail();
    fs.writeFileSync(path.join(gateway, SNAPSHOT), postal.bytes.get(SNAPSHOT), { flag: 'w' });
    put(gateway, DATA, postal.bytes.get(DATA));
    put(gateway, ATTRIBUTION, json({ schemaVersion: 1, source: 'GeoNames', license: postal.manifest.license,
      licenseUrl: postal.manifest.licenseUrl, attribution: postal.manifest.attribution,
      readmeSha256: postal.manifest.readmeSha256, readme: postal.readme.toString('utf8') }));
    validateArtifact(runtime);
    const applied = loadPostalSnapshot({ packageRoot: gateway });
    if (applied.sha256 !== dataSha256) fail();
    put(staging, 'provenance/runtime-base-release-manifest.json', baseBytes);
    for (const [name, bytes] of postal.bytes) {
      if (name !== DATA) put(staging, `provenance/postal/${name}`, bytes);
    }
    const changes = [`${GATEWAY}/${SNAPSHOT}`, `${GATEWAY}/${DATA}`, `${GATEWAY}/${ATTRIBUTION}`];
    for (const [name, bytes] of original) {
      if (!regularFile(runtimeArtifact, name).equals(bytes)) fail();
      if (name !== 'release-manifest.json' && !changes.includes(name)
        && !regularFile(runtime, name).equals(bytes)) fail();
    }
    for (const [name, bytes] of postal.bytes) if (!regularFile(snapshotArtifact, name).equals(bytes)) fail();
    if (!sameNames(inventory(runtimeArtifact), [...original.keys()]) || !sameNames(inventory(snapshotArtifact), FILES)) fail();
    const manifest = { schemaVersion: 1, kind: 'postal_snapshot_composition',
      status: 'local_candidate_installation_held', installationAuthorized: false, routeEnabled: false,
      sourceRevision, sourceStampMeaning: 'Base code revision; use this composition manifest for external asset parity.',
      baseManifestSha256, snapshotSha256: dataSha256, snapshotManifestSha256,
      snapshotArtifactSha256: digest(postal.bytes.get('snapshot-artifact.json')),
      excludedRows: postal.manifest.excludedRows, excludedZipCount: postal.manifest.excludedZipCount,
      relationCount: applied.index.provenance.relationCount, changedRuntimePaths: changes,
      dependencyMaterializationRequired: true, approvedCoverageChanged: false,
      files: inventory(staging).map(name => {
        const bytes = regularFile(staging, name);
        return { path: name, bytes: bytes.length, sha256: digest(bytes) };
      }) };
    const manifestBytes = json(manifest);
    put(staging, 'composition-manifest.json', manifestBytes);
    cleanSource(sourceRevision);
    return { manifestSha256: digest(manifestBytes), snapshotSha256: dataSha256, routeEnabled: false };
  });
}
if (require.main === module) {
  try {
    const a = argumentsFor(['--source-revision', '--runtime-artifact', '--base-manifest-sha256', '--snapshot-artifact',
      '--snapshot-sha256', '--snapshot-manifest-sha256', '--output']);
    process.stdout.write(`${JSON.stringify(compose({ sourceRevision: a['--source-revision'],
      runtimeArtifact: a['--runtime-artifact'], baseManifestSha256: a['--base-manifest-sha256'],
      snapshotArtifact: a['--snapshot-artifact'], dataSha256: a['--snapshot-sha256'],
      snapshotManifestSha256: a['--snapshot-manifest-sha256'], outputRoot: a['--output'] }))}\n`);
  } catch { process.stderr.write('Postal release composition failed validation.\n'); process.exitCode = 1; }
}
module.exports = { compose, readSnapshot, inventory };
