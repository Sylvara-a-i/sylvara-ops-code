'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40}$/;
const SENTINEL = '__REVENUE_DESK_SOURCE_REVISION__';
const COMPONENT_PATH = 'src/zoho-catalyst/revenue-desk-call-runtime';
const SOURCE_STAMP_PATH = 'functions/revenue_desk_call_gateway/lib/source-revision.js';
const TARGET_CONTRACTS = Object.freeze({
  gateway: Object.freeze({
    name: 'revenue_desk_call_gateway',
    stack: 'node24',
    type: 'advancedio',
    nodeEngine: '>=18 <25',
  }),
  control: Object.freeze({
    name: 'revenue_desk_route_control',
    stack: 'node24',
    type: 'advancedio',
    nodeEngine: '24.x',
  }),
  worker: Object.freeze({
    name: 'revenue_desk_call_worker',
    stack: 'node24',
    type: 'job',
    nodeEngine: '24.x',
  }),
});
const REQUIRED_FILES = new Set([
  'catalyst.json',
  'functions/revenue_desk_call_gateway/catalyst-config.json',
  'functions/revenue_desk_call_gateway/contracts/capability-profiles.json',
  'functions/revenue_desk_call_gateway/contracts/revenue-desk-call-contract.json',
  'functions/revenue_desk_call_gateway/index.js',
  'functions/revenue_desk_call_gateway/package-lock.json',
  'functions/revenue_desk_call_gateway/package.json',
  'functions/revenue_desk_route_control/catalyst-config.json',
  'functions/revenue_desk_route_control/index.js',
  'functions/revenue_desk_route_control/package-lock.json',
  'functions/revenue_desk_route_control/package.json',
  'functions/revenue_desk_call_worker/catalyst-config.json',
  'functions/revenue_desk_call_worker/index.js',
  'functions/revenue_desk_call_worker/package-lock.json',
  'functions/revenue_desk_call_worker/package.json',
  SOURCE_STAMP_PATH,
]);
const sourceRoot = path.resolve(__dirname, '..');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: sourceRoot,
    encoding: options.encoding === undefined ? 'utf8' : options.encoding,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function slash(value) {
  return value.split(path.sep).join('/');
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`)
    && relative !== '..' && !path.isAbsolute(relative));
}

function isDeployable(relative) {
  if (REQUIRED_FILES.has(relative)) return true;
  return /^functions\/revenue_desk_call_gateway\/lib\/[A-Za-z0-9._-]+\.js$/.test(relative)
    || /^functions\/revenue_desk_call_gateway\/contracts\/[A-Za-z0-9._-]+\.json$/
      .test(relative)
    || /^functions\/revenue_desk_route_control\/lib\/[A-Za-z0-9._-]+\.js$/
      .test(relative);
}

function safeDestination(root, relative) {
  const segments = relative.split('/');
  if (segments.some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error('Release tree contains an unsafe deployable path.');
  }
  const destination = path.resolve(root, ...segments);
  if (!isInside(root, destination) || destination === root) {
    throw new Error('Release tree contains an unsafe deployable path.');
  }
  return destination;
}

function readTree(revision) {
  const raw = git([
    'ls-tree', '-r', '-z', '--full-tree', revision, '--', COMPONENT_PATH,
  ]);
  const prefix = `${COMPONENT_PATH}/`;
  const entries = [];
  for (const record of raw.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab === -1) throw new Error('Git returned a malformed release tree entry.');
    const [mode, type, object] = record.slice(0, tab).split(' ');
    const repositoryPath = record.slice(tab + 1);
    if (!repositoryPath.startsWith(prefix)) continue;
    const relative = repositoryPath.slice(prefix.length);
    if (!isDeployable(relative)) continue;
    if (mode !== '100644' || type !== 'blob' || !/^[a-f0-9]{40,64}$/.test(object)) {
      throw new Error('Release tree contains a non-regular deployable file.');
    }
    entries.push({ object, relative });
  }
  entries.sort((left, right) => left.relative.localeCompare(right.relative));
  const present = new Set(entries.map(({ relative }) => relative));
  for (const required of REQUIRED_FILES) {
    if (!present.has(required)) throw new Error(`Release commit is missing ${required}.`);
  }
  return entries;
}

function readBlob(object) {
  return git(['cat-file', 'blob', object], { encoding: null });
}

function parseJsonFile(root, relative) {
  return JSON.parse(fs.readFileSync(path.join(root, ...relative.split('/')), 'utf8'));
}

function validateTargetContract(root, directory, label, expected) {
  const prefix = `functions/${directory}`;
  const descriptor = parseJsonFile(root, `${prefix}/catalyst-config.json`);
  const functionPackage = parseJsonFile(root, `${prefix}/package.json`);
  const functionLock = parseJsonFile(root, `${prefix}/package-lock.json`);
  const deployment = descriptor?.deployment;
  if (deployment?.name !== expected.name
    || deployment?.stack !== expected.stack
    || deployment?.type !== expected.type) {
    throw new Error(`Release ${label} descriptor must declare ${expected.name} as `
      + `${expected.stack}/${expected.type}.`);
  }
  const execution = descriptor?.execution;
  if (!execution
    || typeof execution !== 'object'
    || Array.isArray(execution)
    || Object.keys(execution).length !== 1
    || execution.main !== 'index.js') {
    throw new Error(`Release ${label} descriptor must declare exact execution main index.js.`);
  }

  const lockRoot = functionLock?.packages?.[''];
  if (functionPackage?.name !== expected.name
    || lockRoot?.name !== expected.name
    || functionPackage?.engines?.node !== expected.nodeEngine
    || lockRoot?.engines?.node !== expected.nodeEngine) {
    throw new Error(`Release ${label} package and lockfile must declare Node engine `
      + `${expected.nodeEngine}.`);
  }
  return { functionLock, functionPackage };
}

function validateArtifact(root) {
  const catalyst = parseJsonFile(root, 'catalyst.json');
  const targets = catalyst?.functions?.targets;
  if (!Array.isArray(targets)
    || targets.length !== 3
    || targets[0] !== 'revenue_desk_call_gateway'
    || targets[1] !== 'revenue_desk_route_control'
    || targets[2] !== 'revenue_desk_call_worker') {
    throw new Error('Release artifact must contain exactly the gateway, route control, and worker targets.');
  }

  const { functionLock: gatewayLock, functionPackage: gatewayPackage }
    = validateTargetContract(root, 'revenue_desk_call_gateway', 'gateway',
      TARGET_CONTRACTS.gateway);
  const { functionLock: workerLock, functionPackage: workerPackage }
    = validateTargetContract(root, 'revenue_desk_call_worker', 'worker',
      TARGET_CONTRACTS.worker);
  const { functionLock: controlLock, functionPackage: controlPackage }
    = validateTargetContract(root, 'revenue_desk_route_control', 'route control',
      TARGET_CONTRACTS.control);
  const dependency = 'file:../revenue_desk_call_gateway';
  if (gatewayLock?.packages?.['']?.name !== gatewayPackage.name
    || workerLock?.packages?.['']?.name !== workerPackage.name
    || workerPackage?.dependencies?.revenue_desk_call_gateway !== dependency
    || workerLock?.packages?.['']?.dependencies?.revenue_desk_call_gateway !== dependency
    || controlPackage?.dependencies?.revenue_desk_call_gateway !== dependency
    || controlLock?.packages?.['']?.dependencies?.revenue_desk_call_gateway !== dependency) {
    throw new Error('Release package roots or local gateway dependencies are inconsistent.');
  }
}

function build() {
  const revision = argument('--revision');
  const outputValue = argument('--output');
  if (!SOURCE_REVISION_PATTERN.test(revision || '')) {
    throw new Error('--revision must be the exact lowercase 40-character release commit SHA.');
  }
  if (!outputValue) throw new Error('--output is required.');

  const repositoryRoot = path.resolve(git(['rev-parse', '--show-toplevel']).trim());
  if (slash(path.relative(repositoryRoot, sourceRoot)) !== COMPONENT_PATH) {
    throw new Error(`Builder must run from the tracked ${COMPONENT_PATH} component.`);
  }
  const head = git(['rev-parse', 'HEAD']).trim();
  if (head !== revision) {
    throw new Error('--revision must resolve to the exact checked-out HEAD commit.');
  }
  const resolved = git(['rev-parse', '--verify', `${revision}^{commit}`]).trim();
  if (resolved !== revision) {
    throw new Error('--revision must resolve to the exact checked-out HEAD commit.');
  }
  if (git(['status', '--porcelain=v1', '--untracked-files=all']).trim()) {
    throw new Error('Release checkout must be clean before building.');
  }

  const outputRoot = path.resolve(process.cwd(), outputValue);
  if (isInside(repositoryRoot, outputRoot)) {
    throw new Error('--output must be outside the Git repository.');
  }
  if (fs.existsSync(outputRoot)) throw new Error('--output must not already exist.');

  const entries = readTree(revision);
  const outputParent = path.dirname(outputRoot);
  fs.mkdirSync(outputParent, { recursive: true });
  const stagingRoot = fs.mkdtempSync(path.join(outputParent,
    `.${path.basename(outputRoot)}.tmp-`));
  try {
    for (const entry of entries) {
      const destination = safeDestination(stagingRoot, entry.relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, readBlob(entry.object));
    }

    const stampPath = path.join(stagingRoot, ...SOURCE_STAMP_PATH.split('/'));
    const unstamped = fs.readFileSync(stampPath, 'utf8');
    const occurrences = unstamped.split(SENTINEL).length - 1;
    if (occurrences !== 1) {
      throw new Error('Source-revision sentinel must occur exactly once in the release commit.');
    }
    fs.writeFileSync(stampPath, unstamped.replace(SENTINEL, revision), 'utf8');
    validateArtifact(stagingRoot);

    const manifestFiles = entries.map(({ relative }) => {
      const data = fs.readFileSync(path.join(stagingRoot, ...relative.split('/')));
      return {
        path: relative,
        sha256: crypto.createHash('sha256').update(data).digest('hex'),
      };
    });
    fs.writeFileSync(path.join(stagingRoot, 'release-manifest.json'), `${JSON.stringify({
      schema_version: 1,
      source_revision: revision,
      files: manifestFiles,
    }, null, 2)}\n`, 'utf8');

    if (git(['status', '--porcelain=v1', '--untracked-files=all']).trim()) {
      throw new Error('Release checkout changed during the build; artifact was not published.');
    }
    if (fs.existsSync(outputRoot)) throw new Error('--output appeared during the build.');
    fs.renameSync(stagingRoot, outputRoot);
    process.stdout.write(`${outputRoot}\n`);
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

try {
  build();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Release build failed.'}\n`);
  process.exitCode = 1;
}
