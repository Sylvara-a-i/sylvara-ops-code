'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const runtimeRoot = path.resolve(__dirname, '..', '..', '..');
const componentPath = path.join('src', 'zoho-catalyst', 'revenue-desk-call-runtime');

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

function runOk(command, args, cwd) {
  const result = run(command, args, cwd);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function createCleanFixture(parent) {
  const repository = path.join(parent, 'repository');
  const component = path.join(repository, componentPath);
  fs.mkdirSync(path.dirname(component), { recursive: true });
  fs.cpSync(runtimeRoot, component, {
    recursive: true,
    filter(source) {
      const relative = path.relative(runtimeRoot, source);
      return !relative.split(path.sep).includes('node_modules');
    },
  });
  runOk('git', ['init'], repository);
  runOk('git', ['config', 'user.name', 'Revenue Desk Release Test'], repository);
  runOk('git', ['config', 'user.email', 'release-test@example.invalid'], repository);
  runOk('git', ['add', '--all'], repository);
  runOk('git', ['commit', '-m', 'fixture'], repository);
  return {
    builder: path.join(component, 'scripts', 'build-release.js'),
    component,
    repository,
    revision: runOk('git', ['rev-parse', 'HEAD'], repository),
  };
}

test('release builder exports only a clean exact Git revision and stamps only its artifact', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-desk-release-test-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const fixture = createCleanFixture(parent);
  const output = path.join(parent, 'artifact-one');
  const repeatedOutput = path.join(parent, 'artifact-two');
  const sourceStampPath = path.join(fixture.component, 'functions',
    'revenue_desk_call_gateway', 'lib', 'source-revision.js');
  const sourceBefore = fs.readFileSync(sourceStampPath, 'utf8');

  const built = run(process.execPath,
    [fixture.builder, '--revision', fixture.revision, '--output', output], fixture.component);
  assert.equal(built.status, 0, built.stderr);
  assert.equal(fs.readFileSync(sourceStampPath, 'utf8'), sourceBefore);
  assert.match(sourceBefore, /__REVENUE_DESK_SOURCE_REVISION__/);

  const stagedStampPath = path.join(output, 'functions', 'revenue_desk_call_gateway',
    'lib', 'source-revision.js');
  assert.doesNotMatch(fs.readFileSync(stagedStampPath, 'utf8'),
    /__REVENUE_DESK_SOURCE_REVISION__/);
  const stagedConfig = require(path.join(output, 'functions', 'revenue_desk_call_gateway',
    'lib', 'config.js'));
  assert.deepEqual(stagedConfig.loadConfig({
    DEPLOYMENT_ENVIRONMENT: 'production',
    DEPLOYMENT_MODE: 'dark',
    SOURCE_REVISION: fixture.revision,
  }), {
    environment: 'production',
    deploymentMode: 'dark',
    sourceRevision: fixture.revision,
  });

  const manifestPath = path.join(output, 'release-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.source_revision, fixture.revision);
  assert.equal(manifest.files.some(({ path: relative }) => relative
    === 'functions/revenue_desk_call_gateway/lib/source-revision.js'), true);
  assert.equal(manifest.files.some(({ path: relative }) => relative.includes('/test/')), false);
  assert.equal(manifest.files.some(({ path: relative }) => relative.includes('.env')), false);
  assert.equal(manifest.files.some(({ path: relative }) => relative.startsWith('scripts/')), false);
  assert.equal(fs.existsSync(path.join(output, 'functions', 'revenue_desk_call_worker',
    'node_modules')), false);
  assert.deepEqual(require(path.join(output, 'catalyst.json')).functions.targets,
    ['revenue_desk_call_gateway', 'revenue_desk_call_worker']);
  assert.equal(runOk('git', ['status', '--porcelain=v1', '--untracked-files=all'],
    fixture.repository), '');

  const rebuilt = run(process.execPath,
    [fixture.builder, '--revision', fixture.revision, '--output', repeatedOutput],
    fixture.component);
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  assert.equal(fs.readFileSync(path.join(repeatedOutput, 'release-manifest.json'), 'utf8'),
    fs.readFileSync(manifestPath, 'utf8'));

  const existing = run(process.execPath,
    [fixture.builder, '--revision', fixture.revision, '--output', output], fixture.component);
  assert.notEqual(existing.status, 0);
  assert.match(existing.stderr, /must not already exist/);

  const fakeRevision = `${fixture.revision[0] === '0' ? '1' : '0'}${fixture.revision.slice(1)}`;
  const fake = run(process.execPath,
    [fixture.builder, '--revision', fakeRevision, '--output', path.join(parent, 'fake')],
    fixture.component);
  assert.notEqual(fake.status, 0);
  assert.match(fake.stderr, /exact checked-out HEAD/);

  const insideRepository = run(process.execPath,
    [fixture.builder, '--revision', fixture.revision,
      '--output', path.join(fixture.repository, 'artifact')], fixture.component);
  assert.notEqual(insideRepository.status, 0);
  assert.match(insideRepository.stderr, /outside the Git repository/);

  fs.appendFileSync(path.join(fixture.component, 'README.md'), '\ndirty fixture\n', 'utf8');
  const dirty = run(process.execPath,
    [fixture.builder, '--revision', fixture.revision, '--output', path.join(parent, 'dirty')],
    fixture.component);
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /must be clean/);
});
