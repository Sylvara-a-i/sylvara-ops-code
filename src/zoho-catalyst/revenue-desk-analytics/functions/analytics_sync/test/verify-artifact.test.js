'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const verifierPath = path.resolve(__dirname, '../verify-artifact.js');
const { verify } = require(verifierPath);
const TARGET = 'analytics_sync';
const REVISION = 'a'.repeat(40);

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function artifactFixture(testContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-verifier-test-'));
  testContext.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, 'project');
  const functionRoot = path.join(projectRoot, 'functions', TARGET);
  fs.mkdirSync(path.join(functionRoot, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(functionRoot, 'node_modules'));
  fs.copyFileSync(verifierPath, path.join(functionRoot, 'verify-artifact.js'));
  writeJson(path.join(projectRoot, 'catalyst.json'), {
    functions: { source: 'functions', targets: [TARGET] },
  });
  writeJson(path.join(functionRoot, 'catalyst-config.json'), {
    deployment: { name: TARGET, stack: 'node24', type: 'job' },
    execution: { main: 'index.js' },
  });
  writeJson(path.join(functionRoot, 'package.json'), {
    name: TARGET, version: '1.0.0', private: true, main: 'index.js', dependencies: {},
    engines: { node: '24.x' },
  });
  writeJson(path.join(functionRoot, 'package-lock.json'), {
    name: TARGET, version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: { '': { name: TARGET, version: '1.0.0', dependencies: {},
      engines: { node: '24.x' } } },
  });
  fs.writeFileSync(path.join(functionRoot, 'index.js'),
    "'use strict';\nmodule.exports = () => undefined;\n", 'utf8');
  fs.writeFileSync(path.join(functionRoot, 'lib', 'source-revision.js'),
    `'use strict';\nconst ARTIFACT_SOURCE_REVISION = '${REVISION}';\n`
      + 'module.exports = { ARTIFACT_SOURCE_REVISION };\n', 'utf8');
  return { functionRoot, projectRoot, root };
}

function verifyFixture(fixture, approvedSourceRevision = REVISION) {
  return verify({ functionRoot: fixture.functionRoot, approvedSourceRevision });
}

function tryDirectoryLink(link, target) {
  try {
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOSYS'].includes(error?.code)) return false;
    throw error;
  }
}

function tryFileLink(link, target) {
  try {
    fs.symlinkSync(target, link, 'file');
    return true;
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOSYS'].includes(error?.code)) return false;
    throw error;
  }
}

function runNpm(arguments_, cwd) {
  assert.ok(process.env.npm_execpath, 'npm_execpath is required for dependency tests');
  const result = spawnSync(process.execPath, [process.env.npm_execpath, ...arguments_], {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

test('artifact verifier requires an explicit lowercase approved revision', (testContext) => {
  const fixture = artifactFixture(testContext);
  assert.doesNotThrow(() => verifyFixture(fixture));
  const originalApprovedRevision = process.env.APPROVED_SOURCE_REVISION;
  try {
    process.env.APPROVED_SOURCE_REVISION = REVISION;
    assert.doesNotThrow(() => verify({ functionRoot: fixture.functionRoot }));
    delete process.env.APPROVED_SOURCE_REVISION;
    assert.throws(() => verify({ functionRoot: fixture.functionRoot }),
      /APPROVED_SOURCE_REVISION is missing or invalid/);
  } finally {
    if (originalApprovedRevision === undefined) {
      delete process.env.APPROVED_SOURCE_REVISION;
    } else {
      process.env.APPROVED_SOURCE_REVISION = originalApprovedRevision;
    }
  }
  assert.throws(() => verifyFixture(fixture, REVISION.toUpperCase()),
    /APPROVED_SOURCE_REVISION is missing or invalid/);
  assert.throws(() => verifyFixture(fixture, 'b'.repeat(40)),
    /does not match APPROVED_SOURCE_REVISION/);
});

test('artifact verifier rejects mutated Catalyst deployment and execution descriptors',
  (testContext) => {
    const fixture = artifactFixture(testContext);
    const descriptorPath = path.join(fixture.functionRoot, 'catalyst-config.json');
    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));

    writeJson(descriptorPath, {
      ...descriptor,
      deployment: { ...descriptor.deployment, stack: 'node20' },
    });
    assert.throws(() => verifyFixture(fixture), /Catalyst target descriptor is not exact/);

    writeJson(descriptorPath, {
      ...descriptor,
      execution: { main: 'other.js' },
    });
    assert.throws(() => verifyFixture(fixture), /Catalyst target descriptor is not exact/);

    writeJson(descriptorPath, {
      ...descriptor,
      deployment: { ...descriptor.deployment, unsupported: true },
    });
    assert.throws(() => verifyFixture(fixture), /Catalyst target descriptor is not exact/);
  });

test('artifact verifier rejects package and lockfile root Node engine drift', (testContext) => {
  const fixture = artifactFixture(testContext);
  const packagePath = path.join(fixture.functionRoot, 'package.json');
  const lockPath = path.join(fixture.functionRoot, 'package-lock.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

  writeJson(packagePath, { ...packageJson, engines: { node: '18.x' } });
  assert.throws(() => verifyFixture(fixture), /Node engine requirements are not exact/);

  writeJson(packagePath, packageJson);
  writeJson(lockPath, {
    ...lock,
    packages: {
      ...lock.packages,
      '': { ...lock.packages[''], engines: { node: '18.x' } },
    },
  });
  assert.throws(() => verifyFixture(fixture), /Node engine requirements are not exact/);
});

test('artifact verifier rejects a non-file catalyst.json boundary', (testContext) => {
  const fixture = artifactFixture(testContext);
  const catalystPath = path.join(fixture.projectRoot, 'catalyst.json');
  fs.rmSync(catalystPath);
  fs.mkdirSync(catalystPath);
  assert.throws(() => verifyFixture(fixture), /artifact catalyst\.json is not a regular file/);
});

test('artifact verifier rejects a linked project root when directory links are available',
  (testContext) => {
    const fixture = artifactFixture(testContext);
    const linkedProject = path.join(fixture.root, 'linked-project');
    if (!tryDirectoryLink(linkedProject, fixture.projectRoot)) {
      testContext.skip('directory links are unavailable on this platform');
      return;
    }
    const linkedFunction = path.join(linkedProject, 'functions', TARGET);
    assert.throws(() => verify({
      functionRoot: linkedFunction,
      approvedSourceRevision: REVISION,
    }), /artifact project root is not a regular directory/);
  });

test('artifact verifier permits internal dependency links but rejects a linked node_modules root',
  (testContext) => {
    const fixture = artifactFixture(testContext);
    const nodeModules = path.join(fixture.functionRoot, 'node_modules');
    const dependency = path.join(nodeModules, 'dependency');
    const dependencyLink = path.join(nodeModules, 'dependency-link');
    fs.mkdirSync(dependency);
    const executable = path.join(dependency, 'cli.js');
    fs.writeFileSync(executable, "'use strict';\n", 'utf8');
    const binRoot = path.join(nodeModules, '.bin');
    fs.mkdirSync(binRoot);
    tryFileLink(path.join(binRoot, 'dependency'), executable);
    const internalLinkCreated = tryDirectoryLink(dependencyLink, dependency);
    assert.doesNotThrow(() => verifyFixture(fixture));
    if (internalLinkCreated) fs.rmSync(dependencyLink, { recursive: true, force: true });

    const relocated = path.join(fixture.root, 'installed-node-modules');
    fs.renameSync(nodeModules, relocated);
    if (!tryDirectoryLink(nodeModules, relocated)) {
      fs.writeFileSync(nodeModules, 'not a directory', 'utf8');
    }
    assert.throws(() => verifyFixture(fixture),
      /artifact node_modules root is not a regular directory/);
  });

test('artifact verifier rejects an external declared dependency link that npm ls accepts',
  (testContext) => {
    const fixture = artifactFixture(testContext);
    const outsideDependency = path.join(fixture.root, 'outside-dependency');
    fs.mkdirSync(outsideDependency);
    writeJson(path.join(outsideDependency, 'package.json'), {
      name: 'outside-dependency',
      version: '1.0.0',
    });
    fs.writeFileSync(path.join(outsideDependency, 'index.js'),
      "'use strict';\nmodule.exports = {};\n", 'utf8');

    const install = runNpm([
      'install', '--ignore-scripts', '--no-audit', '--no-fund', '--install-links=false',
      outsideDependency,
    ], fixture.functionRoot);
    assert.equal(install.status, 0, install.stderr);
    const installedDependency = path.join(
      fixture.functionRoot, 'node_modules', 'outside-dependency',
    );
    if (!fs.lstatSync(installedDependency).isSymbolicLink()) {
      fs.rmSync(installedDependency, { recursive: true, force: true });
      if (!tryDirectoryLink(installedDependency, outsideDependency)) {
        testContext.skip('directory links are unavailable on this platform');
        return;
      }
    }

    const npmLs = runNpm([
      'ls', '--omit=dev', '--all', '--ignore-scripts',
    ], fixture.functionRoot);
    assert.equal(npmLs.status, 0, npmLs.stderr);
    assert.throws(() => verifyFixture(fixture),
      /artifact dependency link resolves outside node_modules/);
  });
