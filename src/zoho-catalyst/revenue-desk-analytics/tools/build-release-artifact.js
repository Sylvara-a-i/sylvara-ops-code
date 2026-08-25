'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const COMPONENT_SUBPATH = 'src/zoho-catalyst/revenue-desk-analytics';
const FUNCTION_TARGET = 'analytics_sync';
const SOURCE_REVISION_SENTINEL = '__SYLVARA_UNSTAMPED_SOURCE_REVISION__';
const REVISION_PATTERN = /^[a-f0-9]{40}$/;
const MAX_ARTIFACT_BYTES = 24 * 1024 * 1024;

class ArtifactBuildError extends Error {}

function fail(message) {
  throw new ArtifactBuildError(message);
}

function normalized(value) {
  const result = path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? result.toLowerCase() : result;
}

function samePath(left, right) {
  return normalized(left) === normalized(right);
}

function safeGitEnvironment() {
  const environment = {
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
    GIT_CONFIG_NOSYSTEM: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0',
    LANG: 'C', LC_ALL: 'C', PATH: process.env.PATH || '',
  };
  for (const name of ['ComSpec', 'PATHEXT', 'SystemRoot', 'WINDIR']) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}

function runGit(directory, arguments_, binary = false) {
  const result = spawnSync('git', [
    '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
    '-C', directory, ...arguments_,
  ], {
    encoding: binary ? null : 'utf8', env: safeGitEnvironment(), shell: false,
    maxBuffer: MAX_ARTIFACT_BYTES, windowsHide: true,
  });
  if (result.error || result.status !== 0) fail('approved Git state could not be read safely');
  return result.stdout;
}

function releaseRelativePath(repositoryPath) {
  const prefix = `${COMPONENT_SUBPATH}/`;
  if (!repositoryPath.startsWith(prefix)) return null;
  const relative = repositoryPath.slice(prefix.length);
  if (relative === 'catalyst.json') return relative;
  const functionPrefix = `functions/${FUNCTION_TARGET}/`;
  if (!relative.startsWith(functionPrefix)) return null;
  const functionRelative = relative.slice(functionPrefix.length);
  if (new Set(['catalyst-config.json', 'index.js', 'package.json', 'package-lock.json'])
    .has(functionRelative)) return relative;
  if (/^lib\/[A-Za-z0-9][A-Za-z0-9-]*\.js$/.test(functionRelative)) return relative;
  return null;
}

function parseReleaseTree(tree) {
  const entries = [];
  for (const raw of tree.toString('utf8').split('\0')) {
    if (!raw) continue;
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(raw);
    if (!match) fail('approved Analytics tree contains a linked or unsupported entry');
    const repositoryPath = match[3];
    if (repositoryPath.includes('\\') || path.posix.normalize(repositoryPath) !== repositoryPath
      || repositoryPath.split('/').some((part) => !part || part === '.' || part === '..')) {
      fail('approved Analytics tree contains an unsafe path');
    }
    const relativePath = releaseRelativePath(repositoryPath);
    if (relativePath) entries.push(Object.freeze({
      mode: match[1], objectId: match[2], repositoryPath, relativePath,
    }));
  }
  const paths = new Set(entries.map((entry) => entry.relativePath));
  for (const required of [
    'catalyst.json', `functions/${FUNCTION_TARGET}/catalyst-config.json`,
    `functions/${FUNCTION_TARGET}/index.js`, `functions/${FUNCTION_TARGET}/package.json`,
    `functions/${FUNCTION_TARGET}/package-lock.json`,
    `functions/${FUNCTION_TARGET}/lib/source-revision.js`,
  ]) {
    if (!paths.has(required)) fail('approved Analytics release tree is incomplete');
  }
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function blobDigest(content) {
  return crypto.createHash('sha1').update(Buffer.from(`blob ${content.length}\0`))
    .update(content).digest('hex');
}

function exportRelease(repositoryRoot, entries, projectRoot) {
  let totalBytes = 0;
  fs.mkdirSync(projectRoot, { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    const content = runGit(repositoryRoot, ['cat-file', 'blob', entry.objectId], true);
    totalBytes += content.length;
    if (totalBytes > MAX_ARTIFACT_BYTES || blobDigest(content) !== entry.objectId) {
      fail('approved Analytics blob failed integrity validation');
    }
    const destination = path.join(projectRoot, ...entry.relativePath.split('/'));
    const relative = path.relative(projectRoot, destination);
    if (relative.startsWith('..') || path.isAbsolute(relative)) fail('release path escaped its root');
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, content, { flag: 'wx', mode: entry.mode === '100755' ? 0o700 : 0o600 });
  }
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

function stampArtifact(projectRoot, revision) {
  if (!REVISION_PATTERN.test(revision)) fail('approved source revision is invalid');
  const stampPath = path.join(
    projectRoot, 'functions', FUNCTION_TARGET, 'lib', 'source-revision.js',
  );
  const source = fs.readFileSync(stampPath, 'utf8');
  if (count(source, SOURCE_REVISION_SENTINEL) !== 1) {
    fail('artifact source-revision template is not the exact unstamped form');
  }
  const stamped = source.replace(SOURCE_REVISION_SENTINEL, revision);
  fs.writeFileSync(stampPath, stamped, { encoding: 'utf8', flag: 'w' });
  const readback = fs.readFileSync(stampPath, 'utf8');
  if (count(readback, revision) !== 1 || readback.includes(SOURCE_REVISION_SENTINEL)) {
    fail('artifact source-revision stamp failed readback');
  }
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail(`${label} is invalid`);
  }
}

function validateRelease(projectRoot) {
  const catalyst = readJson(path.join(projectRoot, 'catalyst.json'), 'catalyst.json');
  if (catalyst?.functions?.source !== 'functions'
    || JSON.stringify(catalyst?.functions?.targets) !== JSON.stringify([FUNCTION_TARGET])) {
    fail('Catalyst release is not scoped to analytics_sync');
  }
  const functionRoot = path.join(projectRoot, 'functions', FUNCTION_TARGET);
  const packageJson = readJson(path.join(functionRoot, 'package.json'), 'package.json');
  const lock = readJson(path.join(functionRoot, 'package-lock.json'), 'package-lock.json');
  if (packageJson?.name !== FUNCTION_TARGET || lock?.name !== FUNCTION_TARGET
    || lock?.lockfileVersion !== 3 || lock?.packages?.['']?.name !== FUNCTION_TARGET
    || JSON.stringify(packageJson.dependencies || {})
      !== JSON.stringify(lock.packages[''].dependencies || {})) {
    fail('Analytics package lock does not bind the release package');
  }
}

function manifest(projectRoot, revision) {
  const files = [];
  const pending = [projectRoot];
  while (pending.length) {
    const directory = pending.pop();
    for (const name of fs.readdirSync(directory).sort().reverse()) {
      const candidate = path.join(directory, name);
      const metadata = fs.lstatSync(candidate);
      if (metadata.isSymbolicLink()) fail('release artifact contains a symbolic link');
      if (metadata.isDirectory()) pending.push(candidate);
      else if (metadata.isFile()) {
        const content = fs.readFileSync(candidate);
        files.push({
          path: path.relative(projectRoot, candidate).split(path.sep).join('/'),
          bytes: content.length,
          sha256: crypto.createHash('sha256').update(content).digest('hex'),
        });
      } else fail('release artifact contains an unsupported file');
    }
  }
  return {
    schemaVersion: 'revenue-desk-analytics-release-v1', sourceRevision: revision,
    functionTarget: FUNCTION_TARGET,
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function safeCleanup(root, parent) {
  if (typeof root !== 'string' || !path.basename(root).startsWith('sylvara-analytics-release-')) return;
  const relative = path.relative(parent, root);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
  fs.rmSync(root, { recursive: true, force: true });
}

function build({ environment = process.env, scriptPath = __filename } = {}) {
  const revision = String(environment.APPROVED_SOURCE_REVISION || '');
  if (!REVISION_PATTERN.test(revision)) fail('APPROVED_SOURCE_REVISION is missing or invalid');
  const componentRoot = fs.realpathSync(path.resolve(path.dirname(scriptPath), '..'));
  const repositoryRoot = fs.realpathSync(String(runGit(componentRoot,
    ['rev-parse', '--show-toplevel'])).trim());
  const expectedComponent = path.join(repositoryRoot, ...COMPONENT_SUBPATH.split('/'));
  if (!samePath(componentRoot, expectedComponent)) fail('builder is outside the approved component path');
  const resolved = String(runGit(repositoryRoot,
    ['rev-parse', '--verify', `${revision}^{commit}`])).trim();
  const head = String(runGit(repositoryRoot, ['rev-parse', '--verify', 'HEAD'])).trim();
  if (resolved !== revision || head !== revision) fail('HEAD is not the exact approved revision');
  if (runGit(repositoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], true).length) {
    fail('repository checkout is not clean');
  }
  const entries = parseReleaseTree(runGit(repositoryRoot, [
    'ls-tree', '-r', '-z', '--full-tree', revision, '--', COMPONENT_SUBPATH,
  ], true));
  const temporaryParent = fs.realpathSync(os.tmpdir());
  const artifactRoot = fs.mkdtempSync(path.join(temporaryParent, 'sylvara-analytics-release-'));
  try {
    const projectRoot = path.join(artifactRoot, 'release', 'revenue-desk-analytics');
    exportRelease(repositoryRoot, entries, projectRoot);
    stampArtifact(projectRoot, revision);
    validateRelease(projectRoot);
    if (runGit(repositoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], true).length) {
      fail('release build changed the repository checkout');
    }
    const manifestPath = path.join(artifactRoot, 'artifact-manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest(projectRoot, revision), null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return Object.freeze({ artifactRoot, projectRoot, manifestPath,
      sourceRevision: revision, functionTarget: FUNCTION_TARGET, deployed: false });
  } catch (error) {
    safeCleanup(artifactRoot, temporaryParent);
    throw error;
  }
}

function main() {
  const result = build();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Analytics release build stopped: ${error instanceof ArtifactBuildError
      ? error.message : 'unexpected failure'}\n`);
    process.exitCode = 1;
  }
}

module.exports = { ArtifactBuildError, COMPONENT_SUBPATH, FUNCTION_TARGET, build,
  parseReleaseTree, safeCleanup, stampArtifact, validateRelease };
