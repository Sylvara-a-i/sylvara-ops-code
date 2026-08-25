'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const builderPath = path.resolve(__dirname, '../../../tools/build-release-artifact.js');
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

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function fixture(testContext) {
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
  writeJson(path.join(component, 'catalyst.json'), {
    functions: { source: 'functions', targets: [TARGET], ignore: ['test/**', '.env*'] },
  });
  writeJson(path.join(functionRoot, 'catalyst-config.json'), {
    deployment: { name: TARGET, stack: 'node18', type: 'job' },
    execution: { main: 'index.js' },
  });
  writeJson(path.join(functionRoot, 'package.json'), {
    name: TARGET, version: '1.0.0', private: true, main: 'index.js', dependencies: {},
  });
  writeJson(path.join(functionRoot, 'package-lock.json'), {
    name: TARGET, version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: { '': { name: TARGET, version: '1.0.0', dependencies: {} } },
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

test('release builder exports and stamps exact clean Git source without mutating checkout', (testContext) => {
  const source = fixture(testContext);
  const result = spawnSync(process.execPath, [source.script], {
    cwd: source.repository, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, APPROVED_SOURCE_REVISION: source.revision,
      TEMP: source.artifactParent, TMP: source.artifactParent, TMPDIR: source.artifactParent },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.sourceRevision, source.revision);
  assert.equal(output.functionTarget, TARGET);
  assert.equal(output.deployed, false);
  const checkoutStamp = path.join(source.component, 'functions', TARGET, 'lib', 'source-revision.js');
  const artifactStamp = path.join(output.projectRoot, 'functions', TARGET, 'lib', 'source-revision.js');
  assert.match(fs.readFileSync(checkoutStamp, 'utf8'), new RegExp(SENTINEL));
  assert.match(fs.readFileSync(artifactStamp, 'utf8'), new RegExp(source.revision));
  assert.equal(fs.existsSync(path.join(output.projectRoot, 'functions', TARGET, 'test')), false);
  assert.equal(fs.existsSync(path.join(output.projectRoot, 'functions', TARGET, '.env.example')), false);
  assert.ok(fs.statSync(output.manifestPath).isFile());
  assert.equal(run('git', ['-C', source.repository, 'status', '--porcelain=v1',
    '--untracked-files=all']), '');
});

test('release builder rejects a dirty checkout before creating a release', (testContext) => {
  const source = fixture(testContext);
  fs.appendFileSync(path.join(source.component, 'catalyst.json'), '\n');
  const before = fs.readdirSync(source.artifactParent);
  const result = spawnSync(process.execPath, [source.script], {
    cwd: source.repository, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, APPROVED_SOURCE_REVISION: source.revision,
      TEMP: source.artifactParent, TMP: source.artifactParent, TMPDIR: source.artifactParent },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checkout is not clean/);
  assert.deepEqual(fs.readdirSync(source.artifactParent), before);
});
