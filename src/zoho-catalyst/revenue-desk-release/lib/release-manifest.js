'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const ARTIFACT_PROVENANCE_SCHEMA = 'revenue-desk-artifact-provenance-v1';
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function compareExactSet(actual, expected, label) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    throw new Error(`${label} must match the canonical release contract exactly.`);
  }
}

function hashBytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`${label} is invalid.`);
  }
}

function artifactProvenanceDigest(provenance) {
  return hashBytes(Buffer.from(JSON.stringify([
    ARTIFACT_PROVENANCE_SCHEMA,
    provenance.function_name,
    provenance.package_name,
    provenance.revision_stamp_target,
    provenance.source_revision,
    provenance.source_tree_sha256,
    provenance.artifact_sha256,
    provenance.artifact_file_count,
  ]), 'utf8'));
}

function createArtifactProvenance({ functionName, packageName, revisionStampTarget,
  sourceRevision, sourceTreeSha256, artifactSha256, artifactFileCount }) {
  for (const [value, label] of [
    [functionName, 'Function name'],
    [packageName, 'Package name'],
    [revisionStampTarget, 'Revision-stamp target'],
  ]) {
    if (!SAFE_NAME_PATTERN.test(value || '')) throw new Error(`${label} is invalid.`);
  }
  if (packageName !== functionName) {
    throw new Error(`Artifact package identity does not match ${functionName}.`);
  }
  if (!SHA_PATTERN.test(sourceRevision || '')) {
    throw new Error(`Artifact source revision is invalid for ${functionName}.`);
  }
  if (!DIGEST_PATTERN.test(sourceTreeSha256 || '')) {
    throw new Error(`Artifact source-tree digest is invalid for ${functionName}.`);
  }
  if (!DIGEST_PATTERN.test(artifactSha256 || '')
    || !Number.isInteger(artifactFileCount) || artifactFileCount < 1) {
    throw new Error(`Artifact digest is invalid for ${functionName}.`);
  }
  const provenance = {
    schema_version: ARTIFACT_PROVENANCE_SCHEMA,
    function_name: functionName,
    package_name: packageName,
    revision_stamp_target: revisionStampTarget,
    source_revision: sourceRevision,
    source_tree_sha256: sourceTreeSha256,
    artifact_sha256: artifactSha256,
    artifact_file_count: artifactFileCount,
  };
  return { ...provenance, binding_sha256: artifactProvenanceDigest(provenance) };
}

function validateArtifactProvenance(artifact, expectedName, expectedRevisionStampTarget,
  sourceRevision, sourceTreeSha256) {
  assertPlainObject(artifact?.provenance, `Artifact provenance for ${expectedName}`);
  const provenance = artifact.provenance;
  const rebuilt = createArtifactProvenance({
    functionName: provenance.function_name,
    packageName: provenance.package_name,
    revisionStampTarget: provenance.revision_stamp_target,
    sourceRevision: provenance.source_revision,
    sourceTreeSha256: provenance.source_tree_sha256,
    artifactSha256: provenance.artifact_sha256,
    artifactFileCount: provenance.artifact_file_count,
  });
  if (provenance.schema_version !== ARTIFACT_PROVENANCE_SCHEMA
    || provenance.function_name !== expectedName
    || provenance.package_name !== expectedName
    || provenance.revision_stamp_target !== expectedRevisionStampTarget
    || provenance.source_revision !== sourceRevision
    || provenance.source_tree_sha256 !== sourceTreeSha256
    || provenance.artifact_sha256 !== artifact.sha256
    || provenance.artifact_file_count !== artifact.file_count
    || provenance.binding_sha256 !== rebuilt.binding_sha256) {
    throw new Error(`Artifact provenance does not match ${expectedName}.`);
  }
  return provenance;
}

function collectArtifactFiles(root) {
  const files = [];
  let totalBytes = 0;

  function visit(current, relativeRoot) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('Release artifacts must not contain symlinks.');
    if (stat.isFile()) {
      if (stat.size > MAX_FILE_BYTES) throw new Error('Release artifact contains an oversized file.');
      totalBytes += stat.size;
      if (totalBytes > MAX_ARTIFACT_BYTES) throw new Error('Release artifact exceeds the size ceiling.');
      files.push({ absolute: current, relative: relativeRoot || path.basename(current), size: stat.size });
      return;
    }
    if (!stat.isDirectory()) throw new Error('Release artifact contains an unsupported entry type.');
    for (const name of fs.readdirSync(current).sort()) {
      if (!SAFE_NAME_PATTERN.test(name)) throw new Error('Release artifact contains an unsafe path.');
      visit(path.join(current, name), relativeRoot ? `${relativeRoot}/${name}` : name);
    }
  }

  visit(root, '');
  if (files.length === 0) throw new Error('Release artifact is empty.');
  return files.sort((left, right) => left.relative.localeCompare(right.relative));
}

function hashArtifact(root) {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved)) throw new Error('Release artifact does not exist.');
  const files = collectArtifactFiles(resolved);
  const digest = crypto.createHash('sha256');
  for (const file of files) {
    const relative = Buffer.from(file.relative, 'utf8');
    const data = fs.readFileSync(file.absolute);
    const header = Buffer.alloc(16);
    header.writeBigUInt64BE(BigInt(relative.length), 0);
    header.writeBigUInt64BE(BigInt(data.length), 8);
    digest.update(header).update(relative).update(data);
  }
  return { sha256: digest.digest('hex'), file_count: files.length };
}

function inspectArtifact({ root, functionContract, sourceRevision, sourceTreeSha256,
  allowedTargets }) {
  assertPlainObject(functionContract, 'Function release contract');
  const name = functionContract.name;
  const revisionStampTarget = functionContract.revision_stamp_target;
  if (!SAFE_NAME_PATTERN.test(name || '') || !SAFE_NAME_PATTERN.test(revisionStampTarget || '')) {
    throw new Error('Function artifact contract is invalid.');
  }
  const resolved = path.resolve(root);
  if (!fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Artifact root is invalid for ${name}.`);
  }
  const artifact = hashArtifact(resolved);
  const catalyst = readJson(path.join(resolved, 'catalyst.json'), 'Artifact catalyst.json');
  const targets = catalyst?.functions?.targets;
  if (catalyst?.functions?.source !== 'functions' || !Array.isArray(targets)
    || targets.length === 0 || new Set(targets).size !== targets.length
    || targets.some((target) => !allowedTargets.includes(target))
    || !targets.includes(name) || !targets.includes(revisionStampTarget)) {
    throw new Error(`Artifact Catalyst target identity does not match ${name}.`);
  }

  const functionRoot = path.join(resolved, 'functions', name);
  const packageJson = readJson(path.join(functionRoot, 'package.json'),
    `Artifact package.json for ${name}`);
  const packageLock = readJson(path.join(functionRoot, 'package-lock.json'),
    `Artifact package-lock.json for ${name}`);
  if (packageJson.name !== name || packageLock.name !== name
    || packageLock.packages?.['']?.name !== name) {
    throw new Error(`Artifact package identity does not match ${name}.`);
  }

  const stampPath = path.join(resolved, 'functions', revisionStampTarget,
    'lib', 'source-revision.js');
  let stamp;
  try {
    stamp = fs.readFileSync(stampPath, 'utf8');
  } catch {
    throw new Error(`Artifact source-revision stamp is missing for ${name}.`);
  }
  const matches = [...stamp.matchAll(
    /\bconst\s+ARTIFACT_SOURCE_REVISION\s*=\s*(['"])([a-f0-9]{40})\1\s*;/g,
  )];
  if (matches.length !== 1 || matches[0][2] !== sourceRevision) {
    throw new Error(`Artifact source revision does not match ${name}.`);
  }

  const provenance = createArtifactProvenance({
    functionName: name,
    packageName: packageJson.name,
    revisionStampTarget,
    sourceRevision: matches[0][2],
    sourceTreeSha256,
    artifactSha256: artifact.sha256,
    artifactFileCount: artifact.file_count,
  });
  return { ...artifact, provenance };
}

function buildManifest({ contract, sourceRevision, environment, artifacts,
  sourceTrees, contractDigests }) {
  assertPlainObject(contract, 'Release contract');
  if (!SHA_PATTERN.test(sourceRevision || '')) {
    throw new Error('sourceRevision must be an exact lowercase 40-character commit SHA.');
  }
  const mode = contract.environment_modes?.[environment];
  if (!mode) throw new Error('Environment is not allowed by the release contract.');
  assertPlainObject(artifacts, 'Artifacts');
  assertPlainObject(sourceTrees, 'Source-tree digests');
  assertPlainObject(contractDigests, 'Contract digests');

  const names = contract.functions.map(({ name }) => name);
  compareExactSet(Object.keys(artifacts), names, 'Artifact names');
  compareExactSet(Object.keys(sourceTrees), names, 'Source-tree digest names');
  compareExactSet(Object.keys(contractDigests), contract.contract_files, 'Contract digest paths');

  const functions = names.map((name) => {
    const functionContract = contract.functions.find((entry) => entry.name === name);
    const artifact = artifacts[name];
    const sourceTreeSha = sourceTrees[name];
    if (!artifact || !DIGEST_PATTERN.test(artifact.sha256 || '')
      || !Number.isInteger(artifact.file_count) || artifact.file_count < 1) {
      throw new Error(`Artifact digest is invalid for ${name}.`);
    }
    if (!DIGEST_PATTERN.test(sourceTreeSha || '')) {
      throw new Error(`Source-tree digest is invalid for ${name}.`);
    }
    const provenance = validateArtifactProvenance(
      artifact, name, functionContract.revision_stamp_target, sourceRevision, sourceTreeSha,
    );
    return {
      name,
      package_name: provenance.package_name,
      revision_stamp_target: provenance.revision_stamp_target,
      source_revision: sourceRevision,
      source_tree_sha256: sourceTreeSha,
      artifact_sha256: artifact.sha256,
      artifact_file_count: artifact.file_count,
      artifact_provenance_sha256: provenance.binding_sha256,
    };
  });

  for (const value of Object.values(contractDigests)) {
    if (!DIGEST_PATTERN.test(value || '')) throw new Error('Contract digest is invalid.');
  }

  return {
    schema_version: 2,
    release_kind: 'revenue_desk_six_function_release',
    source_revision: sourceRevision,
    environment,
    mode,
    functions,
    job_pools: [...contract.job_pools],
    tables: [...contract.tables],
    contract_sha256: Object.fromEntries(contract.contract_files.map((file) => [
      file, contractDigests[file],
    ])),
    production_invariants: environment === 'Production'
      ? { ...contract.production_invariants }
      : null,
  };
}

function verifyReadback(manifest, readback, contract) {
  assertPlainObject(manifest, 'Release manifest');
  assertPlainObject(readback, 'Deployment readback');
  assertPlainObject(contract, 'Release contract');
  if (manifest.schema_version !== 2
    || manifest.release_kind !== 'revenue_desk_six_function_release'
    || !Array.isArray(manifest.functions)) {
    throw new Error('Release manifest provenance schema is invalid.');
  }
  const contractByName = new Map(contract.functions.map((entry) => [entry.name, entry]));
  compareExactSet(manifest.functions.map(({ name }) => name), [...contractByName.keys()],
    'Manifest function names');
  for (const entry of manifest.functions) {
    const functionContract = contractByName.get(entry.name);
    const provenance = createArtifactProvenance({
      functionName: entry.name,
      packageName: entry.package_name,
      revisionStampTarget: entry.revision_stamp_target,
      sourceRevision: entry.source_revision,
      sourceTreeSha256: entry.source_tree_sha256,
      artifactSha256: entry.artifact_sha256,
      artifactFileCount: entry.artifact_file_count,
    });
    if (entry.revision_stamp_target !== functionContract.revision_stamp_target
      || entry.source_revision !== manifest.source_revision
      || entry.artifact_provenance_sha256 !== provenance.binding_sha256) {
      throw new Error(`Release manifest provenance failed for ${entry.name}.`);
    }
  }
  if (manifest.source_revision !== readback.source_revision
    || manifest.environment !== readback.environment
    || manifest.mode !== readback.mode) {
    throw new Error('Deployment readback does not match the release identity.');
  }
  if (!Array.isArray(readback.functions)) throw new Error('Deployment readback functions are required.');
  const expectedNames = [...contractByName.keys()];
  compareExactSet(readback.functions.map(({ name }) => name), expectedNames,
    'Deployed function names');
  compareExactSet(readback.job_pools || [], contract.job_pools, 'Deployed Job pools');
  compareExactSet(readback.tables || [], contract.tables, 'Deployed tables');

  const expectedByName = new Map(manifest.functions.map((entry) => [entry.name, entry]));
  for (const deployed of readback.functions) {
    const expected = expectedByName.get(deployed.name);
    if (!expected || deployed.source_revision !== manifest.source_revision
      || deployed.artifact_sha256 !== expected.artifact_sha256
      || deployed.source_tree_sha256 !== expected.source_tree_sha256) {
      throw new Error(`Deployment parity failed for ${deployed.name}.`);
    }
  }
  assertPlainObject(readback.contract_sha256, 'Deployment contract digests');
  compareExactSet(Object.keys(readback.contract_sha256), Object.keys(manifest.contract_sha256),
    'Deployment contract paths');
  for (const [contractPath, expectedDigest] of Object.entries(manifest.contract_sha256)) {
    if (readback.contract_sha256[contractPath] !== expectedDigest) {
      throw new Error(`Deployment contract digest does not match: ${contractPath}.`);
    }
  }
  if (manifest.environment === 'Production') {
    for (const [name, expected] of Object.entries(contract.production_invariants)) {
      if (readback[name] !== expected) {
        throw new Error(`Dark Production invariant failed: ${name}.`);
      }
    }
  }
  return true;
}

module.exports = {
  ARTIFACT_PROVENANCE_SCHEMA,
  buildManifest,
  compareExactSet,
  createArtifactProvenance,
  hashArtifact,
  hashBytes,
  inspectArtifact,
  verifyReadback,
};
