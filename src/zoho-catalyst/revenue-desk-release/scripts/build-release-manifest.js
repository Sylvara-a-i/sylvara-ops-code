'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildManifest, hashBytes, inspectArtifact } = require('../lib/release-manifest');

const componentRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(componentRoot, '..', '..', '..');
const profileContracts = Object.freeze({
  'canonical-seven': 'release-contract.json',
  'setup-journey': 'setup-journey-release-contract.json',
  'free-test-journey-core-v1': 'free-test-journey-core-v1-release-contract.json',
});
const profileNames = Object.freeze(Object.keys(profileContracts));

function values(name) {
  const found = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) found.push(process.argv[index + 1]);
  }
  return found;
}

function value(name) {
  return values(name)[0] || null;
}

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseAssignments(items, functionContracts, sourceRevision, sourceTrees) {
  const result = {};
  const expectedNames = functionContracts.map(({ name }) => name);
  const byName = new Map(functionContracts.map((entry) => [entry.name, entry]));
  for (const item of items) {
    const separator = item.indexOf('=');
    if (separator < 1) throw new Error('--artifact must use function_name=path.');
    const name = item.slice(0, separator);
    if (!expectedNames.includes(name) || result[name]) throw new Error('Artifact name is invalid or repeated.');
    result[name] = inspectArtifact({
      root: item.slice(separator + 1),
      functionContract: byName.get(name),
      sourceRevision,
      sourceTreeSha256: sourceTrees[name],
      allowedTargets: expectedNames,
    });
  }
  return result;
}

function trackedTreeDigest(revision, relativeRoot) {
  const raw = git(['ls-tree', '-r', '-z', '--full-tree', revision, '--', relativeRoot]);
  const prefix = `${relativeRoot}/`;
  const files = [];
  for (const record of raw.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    const [mode, type, object] = record.slice(0, tab).split(' ');
    const repositoryPath = record.slice(tab + 1);
    if (mode !== '100644' || type !== 'blob' || !repositoryPath.startsWith(prefix)) {
      throw new Error(`Source tree contains an unsupported entry under ${relativeRoot}.`);
    }
    const relative = repositoryPath.slice(prefix.length);
    if (relative.startsWith('test/') || relative.includes('/test/')) continue;
    files.push({ object, relative });
  }
  files.sort((left, right) => left.relative.localeCompare(right.relative));
  if (files.length === 0) throw new Error(`No deployable source found under ${relativeRoot}.`);
  const parts = [];
  for (const file of files) {
    const data = git(['cat-file', 'blob', file.object], null);
    parts.push(Buffer.from(file.relative), Buffer.from([0]), data, Buffer.from([0]));
  }
  return hashBytes(Buffer.concat(parts));
}

function trackedFileDigest(revision, relativePath) {
  return hashBytes(git(['show', `${revision}:${relativePath}`], null));
}

function main() {
  const selectedProfiles = values('--profile');
  if (selectedProfiles.length > 1) throw new Error('--profile must not be repeated.');
  const profile = selectedProfiles[0] || 'canonical-seven';
  const contractFile = profileContracts[profile];
  if (!contractFile) throw new Error(`--profile must be one of: ${profileNames.join(', ')}.`);
  const contract = JSON.parse(fs.readFileSync(path.join(componentRoot, contractFile), 'utf8'));
  const revision = value('--source-revision');
  const environment = value('--environment');
  const outputValue = value('--output');
  if (!outputValue) throw new Error('--output is required.');
  const head = git(['rev-parse', 'HEAD']).trim();
  if (revision !== head || git(['rev-parse', '--verify', `${revision}^{commit}`]).trim() !== revision) {
    throw new Error('--source-revision must be the exact checked-out HEAD commit.');
  }
  if (git(['status', '--porcelain=v1', '--untracked-files=all']).trim()) {
    throw new Error('Release checkout must be clean.');
  }
  const sourceTrees = Object.fromEntries(contract.functions.map(({ name, source_root: sourceRoot }) => [
    name, trackedTreeDigest(revision, sourceRoot),
  ]));
  const artifacts = parseAssignments(
    values('--artifact'), contract.functions, revision, sourceTrees,
  );
  const contractDigests = Object.fromEntries(contract.contract_files.map((file) => [
    file, trackedFileDigest(revision, file),
  ]));
  const manifest = buildManifest({
    contract, sourceRevision: revision, environment, artifacts, sourceTrees, contractDigests,
  });
  const output = path.resolve(process.cwd(), outputValue);
  const relativeOutput = path.relative(repositoryRoot, output);
  if (!relativeOutput.startsWith(`..${path.sep}`) || path.isAbsolute(relativeOutput)) {
    throw new Error('--output must be outside the Git repository.');
  }
  if (fs.existsSync(output)) throw new Error('--output must not already exist.');
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${output}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Release build failed.'}\n`);
  process.exitCode = 1;
}
