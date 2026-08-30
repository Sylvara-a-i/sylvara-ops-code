'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const artifactTest = process.env.SYLVARA_OFFLINE_QUICK_VERIFY === '1' ? test.skip : test;

const builderPath = path.resolve(__dirname, '../../../tools/build-release-artifact.js');
const verifierPath = path.resolve(__dirname, '../verify-artifact.js');
const { ARTIFACT_VERIFY_SCRIPT } = require(builderPath);
const SENTINEL = '__SYLVARA_UNSTAMPED_SOURCE_REVISION__';
const COMPONENT = 'src/zoho-catalyst/revenue-desk-analytics';
const TARGET = 'analytics_sync';

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    encoding: 'utf8', shell: false, windowsHide: true, ...options,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function runNpm(arguments_, options = {}) {
  assert.ok(process.env.npm_execpath, 'npm_execpath is required for the artifact test');
  return run(process.execPath, [process.env.npm_execpath, ...arguments_], options);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function fixture(testContext, {
  stack = 'node24',
  type = 'job',
  packageEngine = '24.x',
  lockEngine = '24.x',
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-artifact-test-'));
  testContext.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, 'repository');
  const component = path.join(repository, ...COMPONENT.split('/'));
  const functionRoot = path.join(component, 'functions', TARGET);
  const artifactParent = path.join(root, 'artifacts');
  fs.mkdirSync(path.join(component, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(functionRoot, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(functionRoot, 'test'), { recursive: true });
  fs.mkdirSync(artifactParent);
  fs.copyFileSync(builderPath, path.join(component, 'tools', path.basename(builderPath)));
  fs.copyFileSync(verifierPath, path.join(functionRoot, path.basename(verifierPath)));
  writeJson(path.join(component, 'catalyst.json'), {
    functions: { source: 'functions', targets: [TARGET], ignore: ['test/**', '.env*'] },
  });
  writeJson(path.join(functionRoot, 'catalyst-config.json'), {
    deployment: { name: TARGET, stack, type },
    execution: { main: 'index.js' },
  });
  writeJson(path.join(functionRoot, 'package.json'), {
    name: TARGET, version: '1.0.0', private: true, main: 'index.js', dependencies: {},
    engines: { node: packageEngine },
    scripts: { 'artifact:verify': ARTIFACT_VERIFY_SCRIPT },
  });
  writeJson(path.join(functionRoot, 'package-lock.json'), {
    name: TARGET, version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: { '': { name: TARGET, version: '1.0.0', dependencies: {},
      engines: { node: lockEngine } } },
  });
  fs.writeFileSync(path.join(functionRoot, 'index.js'), "'use strict';\nmodule.exports = () => undefined;\n");
  fs.writeFileSync(path.join(functionRoot, 'lib', 'source-revision.js'),
    `'use strict';\nconst ARTIFACT_SOURCE_REVISION = '${SENTINEL}';\nmodule.exports = { ARTIFACT_SOURCE_REVISION };\n`);
  fs.writeFileSync(path.join(functionRoot, 'test', 'excluded.test.js'), 'not deployed\n');
  fs.writeFileSync(path.join(functionRoot, '.env.example'), 'NOT_DEPLOYED=placeholder\n');

  run('git', ['init', '-q', '--object-format=sha1', '--template=', repository]);
  run('git', ['-C', repository, 'config', 'user.name', 'Synthetic Artifact Test']);
  run('git', ['-C', repository, 'config', 'user.email', 'artifact@example.invalid']);
  run('git', ['-C', repository, 'add', '--all']);
  run('git', ['-C', repository, 'commit', '-q', '--no-gpg-sign', '--no-verify', '-m', 'fixture']);
  const revision = run('git', ['-C', repository, 'rev-parse', 'HEAD']);
  return { artifactParent, component, repository, revision,
    script: path.join(component, 'tools', path.basename(builderPath)) };
}

function buildFixture(source) {
  return spawnSync(process.execPath, [source.script], {
    cwd: source.repository, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, APPROVED_SOURCE_REVISION: source.revision,
      TEMP: source.artifactParent, TMP: source.artifactParent, TMPDIR: source.artifactParent },
  });
}

artifactTest('release builder exports and stamps exact clean Git source without mutating checkout', (testContext) => {
  const source = fixture(testContext);
  const result = buildFixture(source);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.sourceRevision, source.revision);
  assert.equal(output.functionTarget, TARGET);
  assert.equal(output.deployed, false);
  const checkoutStamp = path.join(source.component, 'functions', TARGET, 'lib', 'source-revision.js');
  const artifactStamp = path.join(output.projectRoot, 'functions', TARGET, 'lib', 'source-revision.js');
  const artifactFunctionRoot = path.dirname(path.dirname(artifactStamp));
  assert.match(fs.readFileSync(checkoutStamp, 'utf8'), new RegExp(SENTINEL));
  assert.match(fs.readFileSync(artifactStamp, 'utf8'), new RegExp(source.revision));
  assert.equal(fs.existsSync(path.join(artifactFunctionRoot, 'test')), false);
  assert.equal(fs.existsSync(path.join(artifactFunctionRoot, 'tools')), false);
  assert.equal(fs.existsSync(path.join(output.projectRoot, 'tools')), false);
  assert.equal(fs.existsSync(path.join(artifactFunctionRoot, '.env.example')), false);
  runNpm(['ci', '--omit=dev', '--ignore-scripts'], { cwd: artifactFunctionRoot });
  const verificationEnvironment = {
    ...process.env,
    APPROVED_SOURCE_REVISION: source.revision,
  };
  assert.match(runNpm(['run', 'artifact:verify'], {
    cwd: artifactFunctionRoot,
    env: verificationEnvironment,
  }),
    /analytics_sync artifact verification passed/);
  const wrongRevision = source.revision === 'f'.repeat(40) ? 'e'.repeat(40) : 'f'.repeat(40);
  const staleResult = spawnSync(process.execPath, [
    process.env.npm_execpath, 'run', 'artifact:verify',
  ], {
    cwd: artifactFunctionRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: { ...process.env, APPROVED_SOURCE_REVISION: wrongRevision },
  });
  assert.equal(staleResult.error, undefined, staleResult.error?.message);
  assert.notEqual(staleResult.status, 0);
  assert.match(staleResult.stderr, /does not match APPROVED_SOURCE_REVISION/);
  assert.ok(fs.statSync(output.manifestPath).isFile());
  assert.equal(run('git', ['-C', source.repository, 'status', '--porcelain=v1',
    '--untracked-files=all']), '');
});

artifactTest('release builder rejects a Node 20 Catalyst target descriptor', (testContext) => {
  const source = fixture(testContext, { stack: 'node20' });
  const result = buildFixture(source);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Catalyst target descriptor is not exact/);
  assert.deepEqual(fs.readdirSync(source.artifactParent), []);
});

artifactTest('release builder rejects a non-Job Catalyst target descriptor', (testContext) => {
  const source = fixture(testContext, { type: 'basic' });
  const result = buildFixture(source);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Catalyst target descriptor is not exact/);
  assert.deepEqual(fs.readdirSync(source.artifactParent), []);
});

artifactTest('release builder rejects a package Node engine mismatch', (testContext) => {
  const source = fixture(testContext, { packageEngine: '18.x' });
  const result = buildFixture(source);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Node engine requirements are not exact/);
  assert.deepEqual(fs.readdirSync(source.artifactParent), []);
});

artifactTest('release builder rejects a lockfile root Node engine mismatch', (testContext) => {
  const source = fixture(testContext, { lockEngine: '18.x' });
  const result = buildFixture(source);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Node engine requirements are not exact/);
  assert.deepEqual(fs.readdirSync(source.artifactParent), []);
});

artifactTest('release builder rejects a dirty checkout before creating a release', (testContext) => {
  const source = fixture(testContext);
  fs.appendFileSync(path.join(source.component, 'catalyst.json'), '\n');
  const before = fs.readdirSync(source.artifactParent);
  const result = buildFixture(source);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checkout is not clean/);
  assert.deepEqual(fs.readdirSync(source.artifactParent), before);
});
