'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildManifest,
  createArtifactProvenance,
  hashArtifact,
  inspectArtifact,
  verifyReadback,
} = require('../lib/release-manifest');

const contract = require('../release-contract.json');
const revision = 'a'.repeat(40);
const digest = 'b'.repeat(64);

function fixture(environment = 'Development') {
  const names = contract.functions.map(({ name }) => name);
  const sourceTrees = Object.fromEntries(names.map((name) => [name, digest]));
  const artifacts = Object.fromEntries(contract.functions.map((entry) => {
    const artifact = { sha256: digest, file_count: 2 };
    artifact.provenance = createArtifactProvenance({
      functionName: entry.name,
      packageName: entry.name,
      revisionStampTarget: entry.revision_stamp_target,
      sourceRevision: revision,
      sourceTreeSha256: sourceTrees[entry.name],
      artifactSha256: artifact.sha256,
      artifactFileCount: artifact.file_count,
    });
    return [entry.name, artifact];
  }));
  const contractDigests = Object.fromEntries(contract.contract_files.map((file) => [file, digest]));
  const manifest = buildManifest({
    contract, sourceRevision: revision, environment, artifacts, sourceTrees, contractDigests,
  });
  const readback = {
    source_revision: revision,
    environment,
    mode: manifest.mode,
    functions: manifest.functions.map((entry) => ({
      name: entry.name,
      source_revision: revision,
      source_tree_sha256: entry.source_tree_sha256,
      artifact_sha256: entry.artifact_sha256,
    })),
    job_pools: [...manifest.job_pools],
    tables: [...manifest.tables],
    contract_sha256: { ...manifest.contract_sha256 },
  };
  if (environment === 'Production') Object.assign(readback, contract.production_invariants);
  return { manifest, readback };
}

test('builds one manifest containing exactly six functions at one source revision', () => {
  const { manifest } = fixture();
  assert.equal(manifest.functions.length, 6);
  assert.deepEqual(new Set(manifest.functions.map(({ source_revision: sourceRevision }) => sourceRevision)),
    new Set([revision]));
  assert.equal(manifest.tables.length, 13);
  assert.equal(manifest.job_pools.length, 2);
});

test('rejects missing or extra artifacts', () => {
  const names = contract.functions.map(({ name }) => name);
  const artifacts = Object.fromEntries(names.slice(1).map((name) => [name, {
    sha256: digest, file_count: 1,
  }]));
  const sourceTrees = Object.fromEntries(names.map((name) => [name, digest]));
  const contractDigests = Object.fromEntries(contract.contract_files.map((file) => [file, digest]));
  assert.throws(() => buildManifest({
    contract, sourceRevision: revision, environment: 'Development', artifacts,
    sourceTrees, contractDigests,
  }), /Artifact names/);
});

function writeSyntheticArtifact(root, name, sourceRevision) {
  const functionRoot = path.join(root, 'functions', name);
  fs.mkdirSync(path.join(functionRoot, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'catalyst.json'), JSON.stringify({
    functions: { source: 'functions', targets: [name] },
  }));
  fs.writeFileSync(path.join(functionRoot, 'package.json'), JSON.stringify({ name }));
  fs.writeFileSync(path.join(functionRoot, 'package-lock.json'), JSON.stringify({
    name, packages: { '': { name } },
  }));
  fs.writeFileSync(path.join(functionRoot, 'lib', 'source-revision.js'),
    `'use strict';\nconst ARTIFACT_SOURCE_REVISION = '${sourceRevision}';\n`);
}

test('rejects two valid artifacts when their caller labels are swapped', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-desk-provenance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const selected = contract.functions.slice(0, 2);
  const artifacts = {};
  const sourceTrees = Object.fromEntries(contract.functions.map((entry, index) => [
    entry.name, String(index + 1).repeat(64),
  ]));
  for (const entry of selected) {
    const artifactRoot = path.join(root, entry.name);
    writeSyntheticArtifact(artifactRoot, entry.name, revision);
    artifacts[entry.name] = inspectArtifact({
      root: artifactRoot,
      functionContract: entry,
      sourceRevision: revision,
      sourceTreeSha256: sourceTrees[entry.name],
      allowedTargets: contract.functions.map(({ name }) => name),
    });
  }
  [artifacts[selected[0].name], artifacts[selected[1].name]] = [
    artifacts[selected[1].name], artifacts[selected[0].name],
  ];
  const complete = Object.fromEntries(contract.functions.map((entry) => {
    if (artifacts[entry.name]) return [entry.name, artifacts[entry.name]];
    const artifact = { sha256: digest, file_count: 1 };
    artifact.provenance = createArtifactProvenance({
      functionName: entry.name,
      packageName: entry.name,
      revisionStampTarget: entry.revision_stamp_target,
      sourceRevision: revision,
      sourceTreeSha256: sourceTrees[entry.name],
      artifactSha256: artifact.sha256,
      artifactFileCount: artifact.file_count,
    });
    return [entry.name, artifact];
  }));
  const contractDigests = Object.fromEntries(contract.contract_files.map((file) => [file, digest]));
  assert.throws(() => buildManifest({
    contract,
    sourceRevision: revision,
    environment: 'Development',
    artifacts: complete,
    sourceTrees,
    contractDigests,
  }), /provenance does not match/);
});

test('rejects provenance from another revision or source-tree digest', () => {
  const { manifest, readback } = fixture();
  assert.equal(manifest.functions.every((entry) => (
    /^[a-f0-9]{64}$/.test(entry.artifact_provenance_sha256)
    && entry.package_name === entry.name
  )), true);

  const names = contract.functions.map(({ name }) => name);
  const sourceTrees = Object.fromEntries(names.map((name) => [name, digest]));
  const contractDigests = Object.fromEntries(contract.contract_files.map((file) => [file, digest]));
  const artifacts = Object.fromEntries(contract.functions.map((entry) => {
    const artifact = { sha256: digest, file_count: 1 };
    artifact.provenance = createArtifactProvenance({
      functionName: entry.name,
      packageName: entry.name,
      revisionStampTarget: entry.revision_stamp_target,
      sourceRevision: entry === contract.functions[0] ? 'c'.repeat(40) : revision,
      sourceTreeSha256: sourceTrees[entry.name],
      artifactSha256: artifact.sha256,
      artifactFileCount: artifact.file_count,
    });
    return [entry.name, artifact];
  }));
  assert.throws(() => buildManifest({
    contract, sourceRevision: revision, environment: 'Development', artifacts,
    sourceTrees, contractDigests,
  }), /provenance does not match/);
  const first = contract.functions[0];
  artifacts[first.name].provenance = createArtifactProvenance({
    functionName: first.name,
    packageName: first.name,
    revisionStampTarget: first.revision_stamp_target,
    sourceRevision: revision,
    sourceTreeSha256: 'c'.repeat(64),
    artifactSha256: artifacts[first.name].sha256,
    artifactFileCount: artifacts[first.name].file_count,
  });
  assert.throws(() => buildManifest({
    contract, sourceRevision: revision, environment: 'Development', artifacts,
    sourceTrees, contractDigests,
  }), /provenance does not match/);

  manifest.functions[0].artifact_provenance_sha256 = 'c'.repeat(64);
  assert.throws(() => verifyReadback(manifest, readback, contract),
    /manifest provenance failed/);
});

test('verifies exact Development parity and rejects a mixed SHA', () => {
  const { manifest, readback } = fixture();
  assert.equal(verifyReadback(manifest, readback, contract), true);
  readback.functions[2].source_revision = 'c'.repeat(40);
  assert.throws(() => verifyReadback(manifest, readback, contract), /parity failed/);
});

test('rejects legacy resources and missing canonical tables', () => {
  const { manifest, readback } = fixture();
  readback.functions.push({
    name: 'retell_events', source_revision: revision,
    source_tree_sha256: digest, artifact_sha256: digest,
  });
  assert.throws(() => verifyReadback(manifest, readback, contract), /function names/);
  readback.functions.pop();
  readback.tables.pop();
  assert.throws(() => verifyReadback(manifest, readback, contract), /tables/);
});

test('contract digest verification is independent of JSON key order', () => {
  const { manifest, readback } = fixture();
  readback.contract_sha256 = Object.fromEntries(
    Object.entries(readback.contract_sha256).reverse(),
  );
  assert.equal(verifyReadback(manifest, readback, contract), true);
  const first = Object.keys(readback.contract_sha256)[0];
  readback.contract_sha256[first] = 'c'.repeat(64);
  assert.throws(() => verifyReadback(manifest, readback, contract), /digest does not match/);
});

test('dark Production readback cannot activate traffic, routes, or schedules', () => {
  const { manifest, readback } = fixture('Production');
  assert.equal(verifyReadback(manifest, readback, contract), true);
  readback.traffic_enabled = true;
  assert.throws(() => verifyReadback(manifest, readback, contract), /traffic_enabled/);
});

test('artifact hashing is deterministic and rejects symlinks', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-desk-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = true;\n');
  fs.mkdirSync(path.join(root, 'lib'));
  fs.writeFileSync(path.join(root, 'lib', 'a.js'), 'exports.a = 1;\n');
  assert.deepEqual(hashArtifact(root), hashArtifact(root));
  const link = path.join(root, 'lib', 'link.js');
  try {
    fs.symlinkSync(path.join(root, 'index.js'), link);
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return;
    throw error;
  }
  assert.throws(() => hashArtifact(root), /symlinks/);
});
