'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FUNCTION_TARGET = 'analytics_sync';
const REVISION_PATTERN = /^[a-f0-9]{40}$/;
const EXPECTED_DEPLOYMENT = Object.freeze({
  name: FUNCTION_TARGET,
  stack: 'node18',
  type: 'job',
});
const EXPECTED_EXECUTION = Object.freeze({ main: 'index.js' });
const MAX_DEPENDENCY_DEPTH = 128;
const MAX_DEPENDENCY_ENTRIES = 200000;
const REQUIRED_ROOT_FILES = Object.freeze([
  'catalyst-config.json',
  'index.js',
  'package-lock.json',
  'package.json',
  'verify-artifact.js',
]);

class ArtifactVerificationError extends Error {}

function fail(message) {
  throw new ArtifactVerificationError(message);
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail(`${label} is invalid`);
  }
}

function sameJson(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function sameScalarRecord(left, right) {
  if (!left || typeof left !== 'object' || Array.isArray(left)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return sameJson(leftKeys, rightKeys)
    && rightKeys.every((key) => left[key] === right[key]);
}

function metadata(file, label) {
  try {
    return fs.lstatSync(file);
  } catch {
    fail(`${label} is missing`);
  }
}

function optionalMetadata(file, label) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail(`${label} could not be inspected`);
  }
}

function verifyRegularDirectory(directory, label) {
  const entry = metadata(directory, label);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    fail(`${label} is not a regular directory`);
  }
}

function verifyRegularFile(file, label) {
  const entry = metadata(file, label);
  if (!entry.isFile() || entry.isSymbolicLink()) {
    fail(`${label} is not a regular file`);
  }
}

function verifyDirectoryEntries(directory, allowed, label) {
  verifyRegularDirectory(directory, label);
  for (const name of fs.readdirSync(directory)) {
    if (!allowed.has(name)) fail(`${label} contains an unsupported entry`);
  }
}

function firstPartyJavaScript(functionRoot) {
  const files = [
    path.join(functionRoot, 'index.js'),
    path.join(functionRoot, 'verify-artifact.js'),
  ];
  const libraryRoot = path.join(functionRoot, 'lib');
  verifyRegularDirectory(libraryRoot, 'artifact lib path');
  for (const name of fs.readdirSync(libraryRoot).sort()) {
    const candidate = path.join(libraryRoot, name);
    const entry = metadata(candidate, `artifact lib entry ${name}`);
    if (entry.isSymbolicLink() || !entry.isFile() || !name.endsWith('.js')) {
      fail('artifact lib contains an unsupported entry');
    }
    files.push(candidate);
  }
  return files;
}

function verifyPackageBinding(functionRoot) {
  const packageJson = readJson(path.join(functionRoot, 'package.json'), 'package.json');
  const lock = readJson(path.join(functionRoot, 'package-lock.json'), 'package-lock.json');
  const rootLock = lock?.packages?.[''];
  if (packageJson?.name !== FUNCTION_TARGET || packageJson?.private !== true
    || packageJson?.main !== 'index.js' || lock?.name !== FUNCTION_TARGET
    || lock?.lockfileVersion !== 3 || rootLock?.name !== FUNCTION_TARGET
    || !sameJson(packageJson.dependencies, rootLock.dependencies)) {
    fail('artifact package and lockfile are not bound');
  }
  return Object.keys(packageJson.dependencies || {}).length;
}

function verifyNodeModules(functionRoot, dependencyCount) {
  const nodeModules = path.join(functionRoot, 'node_modules');
  const entry = optionalMetadata(nodeModules, 'artifact node_modules root');
  if (!entry) {
    if (dependencyCount > 0) fail('artifact node_modules root is missing');
    return;
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    fail('artifact node_modules root is not a regular directory');
  }
  verifyDependencyTreeLinks(nodeModules);
}

function containedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function verifyDependencyTreeLinks(nodeModules) {
  let realRoot;
  try {
    realRoot = fs.realpathSync(nodeModules);
  } catch {
    fail('artifact node_modules root could not be resolved');
  }
  const pending = [{ depth: 0, directory: nodeModules }];
  let inspectedEntries = 0;
  while (pending.length) {
    const { depth, directory } = pending.pop();
    if (depth > MAX_DEPENDENCY_DEPTH) {
      fail('artifact dependency tree exceeds the safe depth limit');
    }
    let names;
    try {
      names = fs.readdirSync(directory);
    } catch {
      fail('artifact dependency tree could not be inspected');
    }
    for (const name of names) {
      inspectedEntries += 1;
      if (inspectedEntries > MAX_DEPENDENCY_ENTRIES) {
        fail('artifact dependency tree exceeds the safe entry limit');
      }
      const candidate = path.join(directory, name);
      const candidateMetadata = metadata(candidate, 'artifact dependency entry');
      if (candidateMetadata.isSymbolicLink()) {
        let resolved;
        try {
          resolved = fs.realpathSync(candidate);
        } catch {
          fail('artifact dependency link is broken or cyclic');
        }
        if (!containedPath(realRoot, resolved)) {
          fail('artifact dependency link resolves outside node_modules');
        }
      } else if (candidateMetadata.isDirectory()) {
        pending.push({ depth: depth + 1, directory: candidate });
      } else if (!candidateMetadata.isFile()) {
        fail('artifact dependency tree contains an unsupported entry');
      }
    }
  }
}

function verifyProjectBinding(functionRoot) {
  if (path.basename(functionRoot) !== FUNCTION_TARGET) {
    fail('artifact function directory has the wrong target name');
  }
  const projectRoot = path.resolve(functionRoot, '..', '..');
  verifyDirectoryEntries(projectRoot, new Set(['catalyst.json', 'functions']),
    'artifact project root');
  verifyDirectoryEntries(path.join(projectRoot, 'functions'), new Set([FUNCTION_TARGET]),
    'artifact functions root');
  const catalystPath = path.join(projectRoot, 'catalyst.json');
  verifyRegularFile(catalystPath, 'artifact catalyst.json');
  const catalyst = readJson(catalystPath, 'catalyst.json');
  if (catalyst?.functions?.source !== 'functions'
    || JSON.stringify(catalyst?.functions?.targets) !== JSON.stringify([FUNCTION_TARGET])) {
    fail('artifact project is not scoped to analytics_sync');
  }
  const target = readJson(path.join(functionRoot, 'catalyst-config.json'),
    'catalyst-config.json');
  if (!sameScalarRecord(target?.deployment, EXPECTED_DEPLOYMENT)
    || !sameScalarRecord(target?.execution, EXPECTED_EXECUTION)) {
    fail('Catalyst target descriptor is not exact');
  }
}

function verifyStampedRevision(functionRoot, approvedSourceRevision) {
  const stamp = fs.readFileSync(path.join(functionRoot, 'lib', 'source-revision.js'), 'utf8');
  const matches = [...stamp.matchAll(/ARTIFACT_SOURCE_REVISION\s*=\s*['"]([^'"]+)['"]/g)];
  if (matches.length !== 1 || !REVISION_PATTERN.test(matches[0][1])) {
    fail('artifact source revision is not stamped');
  }
  if (matches[0][1] !== approvedSourceRevision) {
    fail('artifact source revision does not match APPROVED_SOURCE_REVISION');
  }
}

function syntaxCheck(files) {
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
      encoding: 'utf8', shell: false, windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      fail(`artifact JavaScript failed syntax validation: ${path.basename(file)}`);
    }
  }
}

function verify({
  functionRoot = __dirname,
  approvedSourceRevision = process.env.APPROVED_SOURCE_REVISION,
} = {}) {
  if (typeof approvedSourceRevision !== 'string'
    || !REVISION_PATTERN.test(approvedSourceRevision)) {
    fail('APPROVED_SOURCE_REVISION is missing or invalid');
  }
  const root = path.resolve(functionRoot);
  verifyDirectoryEntries(root, new Set([
    ...REQUIRED_ROOT_FILES, 'lib', 'node_modules',
  ]), 'artifact function root');
  for (const name of REQUIRED_ROOT_FILES) {
    const candidate = path.join(root, name);
    verifyRegularFile(candidate, `artifact root file ${name}`);
  }
  for (const sourceOnly of ['test', 'tools', '.env', '.env.example']) {
    if (fs.existsSync(path.join(root, sourceOnly))) {
      fail(`source-only path is present in the artifact: ${sourceOnly}`);
    }
  }
  const javascript = firstPartyJavaScript(root);
  verifyProjectBinding(root);
  const dependencyCount = verifyPackageBinding(root);
  verifyNodeModules(root, dependencyCount);
  verifyStampedRevision(root, approvedSourceRevision);
  syntaxCheck(javascript);
}

function main() {
  verify();
  process.stdout.write('analytics_sync artifact verification passed\n');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Analytics artifact verification stopped: ${
      error instanceof ArtifactVerificationError ? error.message : 'unexpected failure'}\n`);
    process.exitCode = 1;
  }
}

module.exports = { ArtifactVerificationError, verify };
