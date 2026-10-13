'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const runtimeRoot = path.resolve(__dirname, '..', '..', '..');
const componentPath = path.join('src', 'zoho-catalyst', 'revenue-desk-call-runtime');
const analyticsRoot = path.resolve(runtimeRoot, '..', 'revenue-desk-analytics');
const crmRoot = path.resolve(runtimeRoot, '..', 'crm-billing-orchestrator');
const { AUTH_PATHS } = require('../../../scripts/compose-reporting-artifact');

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: 'utf8' });
}

function runOk(command, args, cwd) {
  const result = run(command, args, cwd);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function treeSnapshot(root) {
  const result = [];
  function visit(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const stat = fs.lstatSync(file);
      const relative = path.relative(root, file).split(path.sep).join('/');
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) { result.push({ path: relative, directory: true }); visit(file); }
      else result.push({ path: relative, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
    }
  }
  visit(root);
  return result;
}

function updateJson(root, relative, update) {
  const filePath = path.join(root, ...relative.split('/'));
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  update(value);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createCleanFixture(parent, mutate = () => {}, includeCrm = false) {
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
  fs.cpSync(analyticsRoot, path.join(path.dirname(component), 'revenue-desk-analytics'), {
    recursive: true,
    filter(source) {
      return !path.relative(analyticsRoot, source).split(path.sep).includes('node_modules');
    },
  });
  if (includeCrm) fs.cpSync(crmRoot, path.join(path.dirname(component), 'crm-billing-orchestrator'), {
    recursive: true,
    filter: source => !path.relative(crmRoot, source).split(path.sep).includes('node_modules'),
  });
  mutate(component);
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

function authFixture(fixture, exactAuthRevision = null) {
  if (exactAuthRevision !== null) assert.match(exactAuthRevision, /^[a-f0-9]{40}$/);
  for (const relative of AUTH_PATHS) {
    const file = path.join(fixture.repository, relative);
    if (exactAuthRevision) {
      const result = run('git', ['cat-file', 'blob', `${exactAuthRevision}:${relative}`], runtimeRoot);
      assert.equal(result.status, 0, 'the selected local auth revision must already be available');
      fs.writeFileSync(file, result.stdout);
    } else fs.appendFileSync(file, '\n// Synthetic auth-overlay provenance fixture.\n');
  }
  runOk('git', ['add', '--all'], fixture.repository);
  runOk('git', ['commit', '--no-gpg-sign', '-m', 'synthetic auth preservation fixture'], fixture.repository);
  const revision = runOk('git', ['rev-parse', 'HEAD'], fixture.repository);
  runOk('git', ['checkout', '--detach', fixture.revision], fixture.repository);
  return revision;
}

function crmArtifact(fixture, output, revision = fixture.revision) {
  const prefix = 'src/zoho-catalyst/crm-billing-orchestrator/';
  const files = runOk('git', ['ls-tree', '-r', '--name-only', revision, '--', prefix], fixture.repository).split('\n');
  for (const file of files) {
    const relative = file.slice(prefix.length);
    const result = run('git', ['cat-file', 'blob', `${revision}:${file}`], fixture.repository);
    assert.equal(result.status, 0);
    const destination = path.join(output, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const bytes = relative.endsWith('/lib/source-revision.js') ? result.stdout
      .replace('__SYLVARA_UNSTAMPED_SOURCE_REVISION__', revision)
      .replace('__SYLVARA_UNSTAMPED_DEVELOPMENT_ZAID_HMAC_SHA256__', 'a'.repeat(64)) : result.stdout;
    fs.writeFileSync(destination, bytes);
  }
}

function composeFixture(fixture, authRevision, runtimeArtifact, crmInput, output, reportingRevision = fixture.revision) {
  return run(process.execPath, [path.join(fixture.component, 'scripts', 'compose-reporting-artifact.js'),
    '--reporting-revision', reportingRevision, '--auth-revision', authRevision,
    '--runtime-artifact', runtimeArtifact, '--crm-artifact', crmInput, '--output', output], fixture.component);
}

function prepareCrmFixture(fixture, proofSourceRevision, proofArtifact, output, reportingRevision = fixture.revision) {
  return run(process.execPath, [path.join(fixture.component, 'scripts', 'compose-reporting-artifact.js'),
    '--prepare-crm-base', '--reporting-revision', reportingRevision,
    '--proof-source-revision', proofSourceRevision, '--proof-artifact', proofArtifact,
    '--output', output], fixture.component);
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
  for (const entry of manifest.files) {
    const bytes = fs.readFileSync(path.join(output, entry.path));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    const source = run('git', ['cat-file', 'blob', `${fixture.revision}:${entry.source_path}`], fixture.repository);
    assert.equal(source.status, 0);
    assert.equal(crypto.createHash('sha256').update(source.stdout).digest('hex'), entry.source_sha256);
  }
  for (const name of ['create-durable-report-composition', 'create-reporting-factory', 'prepare-workdrive-draft',
    'reattest-report-checkpoints', 'read-reconciled-free-test-input', 'render-free-test-report']) {
    assert.ok(manifest.files.some(({ path: relative }) => relative
      === `functions/revenue_desk_call_worker/reporting/revenue-desk-analytics/tools/${name}.js`));
  }
  for (const name of ['report-https-bootstrap', 'report-successor-physical', 'report-storage-activation', 'report-storage-binding-diagnostic']) {
    const relative = `functions/revenue_desk_route_control/reporting/revenue-desk-analytics/functions/analytics_sync/lib/${name}.js`;
    const entries = manifest.files.filter(entry => entry.path === relative);
    assert.equal(entries.length, 1, `Controller must package exactly one ${name} module`);
    assert.equal(entries[0].source_path,
      `src/zoho-catalyst/revenue-desk-analytics/functions/analytics_sync/lib/${name}.js`);
    assert.deepEqual(fs.readFileSync(path.join(output, relative)),
      fs.readFileSync(path.join(analyticsRoot, 'functions', 'analytics_sync', 'lib', `${name}.js`)));
  }
  const analyticsStamp = require(path.join(output, 'functions', 'revenue_desk_call_worker',
    'reporting', 'revenue-desk-analytics', 'functions', 'analytics_sync', 'lib', 'source-revision'));
  assert.equal(analyticsStamp.ARTIFACT_SOURCE_REVISION, fixture.revision);
  assert.equal(fs.existsSync(path.join(output, 'functions', 'revenue_desk_call_worker',
    'node_modules')), false);
  assert.equal(fs.existsSync(path.join(output, 'functions', 'revenue_desk_route_control',
    'node_modules')), false);
  // Load the actual isolated Controller closure, with no source/helper fallback.
  const isolatedControl = path.join(parent, 'isolated-controller');
  fs.cpSync(path.join(output, 'functions', 'revenue_desk_route_control'), isolatedControl, { recursive: true });
  // Materialize only the built Controller's local core package. The SDK stays
  // absent: importing the entrypoint must not initialize or acquire credentials.
  fs.cpSync(path.join(output, 'functions', 'revenue_desk_call_gateway'),
    path.join(isolatedControl, 'node_modules', 'revenue_desk_call_gateway'), { recursive: true });
  const isolated = run(process.execPath, ['-e', `
    const assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
    const root=process.cwd(),lib=path.join(root,'reporting/revenue-desk-analytics/functions/analytics_sync/lib');
    let blocked=0,sdkLoads=0;
    const denyNetwork=()=>{blocked+=1;throw Error('Controller startup must remain offline');};
    for(const name of ['node:http','node:https']){
      const api=require(name);api.request=denyNetwork;api.get=denyNetwork;
    }
    for(const name of ['node:net','node:tls']){
      const api=require(name);api.connect=denyNetwork;
      if(name==='node:net'){api.createConnection=denyNetwork;api.Socket.prototype.connect=denyNetwork;}
    }
    globalThis.fetch=denyNetwork;
    const originalLoad=Module._load;
    Module._load=function(request,parent,isMain){
      if(request==='zcatalyst-sdk-node'||request.startsWith('zcatalyst-sdk-node/')){
        sdkLoads+=1;throw Error('Controller startup must not load the SDK');
      }
      return originalLoad.call(this,request,parent,isMain);
    };
    const entryRequire=Module.createRequire(path.join(root,'index.js'));
    const physicalRequire=Module.createRequire(path.join(lib,'report-successor-physical.js'));
    const entryBootstrap=entryRequire.resolve('./reporting/revenue-desk-analytics/functions/analytics_sync/lib/report-https-bootstrap');
    assert.equal(entryBootstrap,physicalRequire.resolve('./report-https-bootstrap'));
    assert.ok(entryBootstrap.startsWith(root+path.sep));
    assert.equal(typeof entryRequire('./index.js'),'function');
    const bootstrap=entryRequire(entryBootstrap);
    assert.strictEqual(bootstrap,physicalRequire('./report-https-bootstrap'));
    assert.strictEqual(bootstrap.assertHttpsBootstrap(),denyNetwork);
    assert.throws(()=>bootstrap.initializeHttpsBootstrap(),{code:'REPORT_RUN_RECONCILIATION_REQUIRED'});
    require(path.join(lib,'report-run-transport'));
    const qualification=require(path.join(lib,'report-storage-qualification'));
    assert.equal(typeof qualification.createProtectedStorageQualification,'function');
    const qualificationRequire=Module.createRequire(path.join(lib,'report-storage-qualification.js'));
    const activationPath=qualificationRequire.resolve('./report-storage-activation');
    assert.equal(activationPath,path.join(lib,'report-storage-activation.js'));
    const activation=qualificationRequire('./report-storage-activation');
    assert.equal(typeof activation.validateDormantBinding,'function');
    assert.equal(typeof activation.activateDormantBinding,'function');
    assert.equal(Object.keys(require.cache).filter(file=>path.basename(file)==='report-https-bootstrap.js').length,1);
    for(const file of Object.keys(require.cache))assert.ok(file.startsWith(root+path.sep),
      'Controller dependencies must resolve inside the isolated artifact');
    const helper=require(path.join(lib,'report-storage-diagnostic'));
    const bridge=require(path.join(root,'lib/report-storage-qualification'));
    const tracker=helper.createStorageDiagnostic();
    helper.recordStorageDiagnostic(tracker,'authenticate_rejected','admission_insert','attempted');
    const error=helper.storageDiagnosticError(tracker);
    assert.equal(bridge.storageFailureDiagnostic(error).attempted,1);
    assert.equal(bridge.storageFailureDiagnostic(Error('unissued')),undefined);
    assert.throws(()=>bridge.createProtectedStorageQualification({environment:{}})({},{}),error=>{
      assert.equal(error.code,'REPORT_STORAGE_QUALIFICATION_HELD');
      assert.deepEqual(bridge.storageBindingFailureDiagnostic(error),{schemaVersion:1,firstFailure:'marker_missing'});
      assert.strictEqual(bridge.storageBindingFailureDiagnostic(error),
        require(path.join(lib,'report-storage-binding-diagnostic')).storageBindingFailureDiagnostic(error));
      return true;
    });
    assert.equal(bridge.storageBindingFailureDiagnostic(Error('unissued')),undefined);
    assert.equal(blocked,0);
    assert.equal(sdkLoads,0);
  `], isolatedControl);
  assert.equal(isolated.status, 0, isolated.stderr || isolated.stdout);
  assert.deepEqual(require(path.join(output, 'catalyst.json')).functions.targets,
    ['revenue_desk_call_gateway', 'revenue_desk_route_control',
      'revenue_desk_call_worker']);
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

test('isolated built Controller cold-loads the locked SDK with one bootstrap and no credential or network access', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-desk-controller-sdk-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const fixture = createCleanFixture(parent);
  const output = path.join(parent, 'artifact');
  runOk(process.execPath, [fixture.builder, '--revision', fixture.revision, '--output', output], fixture.component);
  const isolatedControl = path.join(parent, 'isolated-controller');
  const installedControl = path.join(runtimeRoot, 'functions', 'revenue_desk_route_control');
  const lock = JSON.parse(fs.readFileSync(path.join(installedControl, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/zcatalyst-sdk-node'].version, '3.4.0');
  fs.cpSync(path.join(output, 'functions', 'revenue_desk_route_control'), isolatedControl, { recursive: true });
  fs.cpSync(path.join(output, 'functions', 'revenue_desk_call_gateway'),
    path.join(isolatedControl, 'node_modules', 'revenue_desk_call_gateway'), { recursive: true });
  // Copy only the installed SDK dependency closure, checking each installed
  // version and dependency list against the Controller lock; no installer runs.
  const copied = new Set();
  function copySdkDependency(name) {
    if (copied.has(name)) return;
    const locked = lock.packages[`node_modules/${name}`];
    assert.ok(locked && !locked.link, `Missing locked SDK dependency: ${name}`);
    const source = path.join(installedControl, 'node_modules', name);
    const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    assert.equal(pkg.name, name);
    assert.equal(pkg.version, locked.version);
    assert.deepEqual(pkg.dependencies || {}, locked.dependencies || {});
    copied.add(name);
    fs.cpSync(source, path.join(isolatedControl, 'node_modules', name), { recursive: true, dereference: true });
    for (const dependency of Object.keys(locked.dependencies || {})) copySdkDependency(dependency);
  }
  copySdkDependency('zcatalyst-sdk-node');
  const environment = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'WINDIR']
    .filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  const result = spawnSync(process.execPath, ['-e', `
    const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),Module=require('node:module');
    const root=process.cwd(),lib=path.join(root,'reporting/revenue-desk-analytics/functions/analytics_sync/lib');
    let network=0,credentialFiles=0,credentialEnvironment=0;
    const denyNetwork=()=>{network+=1;throw Error('Packaged SDK test must remain offline');};
    for(const name of ['node:http','node:https']){
      const api=require(name);api.request=denyNetwork;api.get=denyNetwork;
    }
    for(const name of ['node:net','node:tls']){
      const api=require(name);api.connect=denyNetwork;
      if(name==='node:net'){api.createConnection=denyNetwork;api.Socket.prototype.connect=denyNetwork;}
    }
    globalThis.fetch=denyNetwork;
    process.env=new Proxy(process.env,{get(target,name){
      if(name==='CATALYST_AUTH'||name==='CATALYST_CONFIG'){
        credentialEnvironment+=1;throw Error('Ambient SDK credentials must not be read');
      }
      return Reflect.get(target,name);
    }});
    const allowedFiles=new Set();
    function collect(directory){
      for(const item of fs.readdirSync(directory,{withFileTypes:true})){
        const file=path.join(directory,item.name);
        if(item.isDirectory())collect(file);
        else if(item.isFile()&&['.js','.json'].includes(path.extname(file)))allowedFiles.add(file);
      }
    }
    collect(root);
    const denyFile=()=>{credentialFiles+=1;throw Error('Only packaged module files may be read');};
    const readFileSync=fs.readFileSync,openSync=fs.openSync;
    fs.readFileSync=function(file,...args){
      if(typeof file!=='string'||!allowedFiles.has(path.resolve(file)))return denyFile();
      return readFileSync.call(this,file,...args);
    };
    fs.openSync=function(file,flags,...args){
      if(typeof file!=='string'||!allowedFiles.has(path.resolve(file))||flags!=='r')return denyFile();
      return openSync.call(this,file,flags,...args);
    };
    fs.readFile=denyFile;fs.open=denyFile;fs.createReadStream=denyFile;
    fs.promises.readFile=denyFile;fs.promises.open=denyFile;
    const entryRequire=Module.createRequire(path.join(root,'index.js'));
    const physicalRequire=Module.createRequire(path.join(lib,'report-successor-physical.js'));
    assert.equal(typeof entryRequire('./index.js'),'function');
    const bootstrapPath=entryRequire.resolve('./reporting/revenue-desk-analytics/functions/analytics_sync/lib/report-https-bootstrap');
    const bootstrap=entryRequire(bootstrapPath);
    assert.equal(bootstrapPath,physicalRequire.resolve('./report-https-bootstrap'));
    assert.strictEqual(bootstrap,physicalRequire('./report-https-bootstrap'));
    const sdk=entryRequire('zcatalyst-sdk-node');
    assert.equal(entryRequire('zcatalyst-sdk-node/package.json').version,'3.4.0');
    const sdkRoot=path.dirname(entryRequire.resolve('zcatalyst-sdk-node/package.json'));
    const {CatalystApp}=entryRequire(path.join(sdkRoot,'lib/catalyst-app'));
    const {CatalystCredential}=entryRequire(path.join(sdkRoot,'lib/utils/credential'));
    const {PROJECT_HEADER,CREDENTIAL_HEADER}=entryRequire(path.join(sdkRoot,'lib/utils/constants')).default;
    const app=sdk.initialize({headers:{
      [PROJECT_HEADER.id]:'123456789',[PROJECT_HEADER.key]:'synthetic-project-key',
      [PROJECT_HEADER.environment]:'Development',
      [CREDENTIAL_HEADER.admin_cred_type]:'token',[CREDENTIAL_HEADER.admin_token]:'synthetic-admin-token',
      [CREDENTIAL_HEADER.user_cred_type]:'token',[CREDENTIAL_HEADER.user_token]:'synthetic-user-token',
      [CREDENTIAL_HEADER.user]:'admin',
    }});
    assert.ok(app instanceof CatalystApp);
    assert.ok(app.credential instanceof CatalystCredential);
    assert.equal(app.config.projectId,'123456789');
    assert.equal(app.config.environment,'Development');
    const physical=physicalRequire('./report-successor-physical');
    assert.equal(typeof physical.createSuccessorPhysicalTransport,'function');
    assert.ok(require.cache[physicalRequire.resolve('./report-successor-physical')].children
      .some(child=>child===require.cache[bootstrapPath]));
    assert.strictEqual(bootstrap.assertHttpsBootstrap(),denyNetwork);
    assert.throws(()=>bootstrap.initializeHttpsBootstrap(),{code:'REPORT_RUN_RECONCILIATION_REQUIRED'});
    assert.equal(Object.keys(require.cache).filter(file=>path.basename(file)==='report-https-bootstrap.js').length,1);
    for(const file of Object.keys(require.cache))assert.ok(file.startsWith(root+path.sep),
      'All Controller and SDK modules must load from the isolated artifact');
    assert.deepEqual({network,credentialFiles,credentialEnvironment},
      {network:0,credentialFiles:0,credentialEnvironment:0});
  `], { cwd: isolatedControl, encoding: 'utf8', env: environment });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('release builder rejects target runtime and package-engine drift', () => {
  const cases = [
    {
      name: 'gateway descriptor stack',
      mutate(component) {
        updateJson(component, 'functions/revenue_desk_call_gateway/catalyst-config.json',
          (value) => { value.deployment.stack = 'node18'; });
      },
      expected: /gateway descriptor must declare .*node24\/advancedio/,
    },
    {
      name: 'worker descriptor type',
      mutate(component) {
        updateJson(component, 'functions/revenue_desk_call_worker/catalyst-config.json',
          (value) => { value.deployment.type = 'advancedio'; });
      },
      expected: /worker descriptor must declare .*node24\/job/,
    },
    {
      name: 'gateway descriptor missing execution',
      mutate(component) {
        updateJson(component, 'functions/revenue_desk_call_gateway/catalyst-config.json',
          (value) => { delete value.execution; });
      },
      expected: /gateway descriptor must declare exact execution main index\.js/,
    },
    {
      name: 'gateway descriptor changed execution main',
      mutate(component) {
        updateJson(component, 'functions/revenue_desk_call_gateway/catalyst-config.json',
          (value) => { value.execution.main = 'server.js'; });
      },
      expected: /gateway descriptor must declare exact execution main index\.js/,
    },
    {
      name: 'worker descriptor missing execution main',
      mutate(component) {
        updateJson(component, 'functions/revenue_desk_call_worker/catalyst-config.json',
          (value) => { delete value.execution.main; });
      },
      expected: /worker descriptor must declare exact execution main index\.js/,
    },
    {
      name: 'worker descriptor changed execution main',
      mutate(component) {
        updateJson(component, 'functions/revenue_desk_call_worker/catalyst-config.json',
          (value) => { value.execution.main = 'worker.js'; });
      },
      expected: /worker descriptor must declare exact execution main index\.js/,
    },
    {
      name: 'gateway package engine',
      mutate(component) {
        updateJson(component, 'functions/revenue_desk_call_gateway/package.json',
          (value) => { value.engines.node = '>=18 <24'; });
      },
      expected: /gateway package and lockfile must declare Node engine >=18 <25/,
    },
    {
      name: 'worker package engine',
      mutate(component) {
        updateJson(component, 'functions/revenue_desk_call_worker/package.json',
          (value) => { value.engines.node = '18.x'; });
      },
      expected: /worker package and lockfile must declare Node engine 24\.x/,
    },
    {
      name: 'worker lockfile engine',
      mutate(component) {
        updateJson(component, 'functions/revenue_desk_call_worker/package-lock.json',
          (value) => { value.packages[''].engines.node = '18.x'; });
      },
      expected: /worker package and lockfile must declare Node engine 24\.x/,
    },
  ];

  for (const fixtureCase of cases) {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-desk-release-invalid-'));
    try {
      const fixture = createCleanFixture(parent, fixtureCase.mutate);
      const output = path.join(parent, 'artifact');
      const result = run(process.execPath,
        [fixture.builder, '--revision', fixture.revision, '--output', output],
        fixture.component);
      assert.notEqual(result.status, 0, fixtureCase.name);
      assert.match(result.stderr, fixtureCase.expected, fixtureCase.name);
      assert.equal(fs.existsSync(output), false, fixtureCase.name);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  }
});

test('extracted worker archive renders reconciled evidence through one packaged runtime trust module', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-desk-worker-archive-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  // An explicit, already available auth revision qualifies the actual composed
  // code locally. Ordinary CI remains independent of another unmerged PR/ref.
  const exactAuthRevision = process.env.SYLVARA_AUTH_COMPOSITION_TEST_REVISION || null;
  const fixture = createCleanFixture(parent, () => {}, Boolean(exactAuthRevision));
  const authRevision = exactAuthRevision ? authFixture(fixture, exactAuthRevision) : null;
  const output = path.join(parent, 'artifact');
  runOk(process.execPath, [fixture.builder, '--revision', fixture.revision, '--output', output],
    fixture.component);
  let runtimeArtifact = output;
  let composedCrm;
  if (exactAuthRevision) {
    const crmInput = path.join(parent, 'crm-input');
    crmArtifact(fixture, crmInput);
    const composed = path.join(parent, 'composed');
    const result = composeFixture(fixture, authRevision, output, crmInput, composed);
    assert.equal(result.status, 0, result.stderr);
    runtimeArtifact = path.join(composed, 'runtime');
    composedCrm = path.join(composed, 'crm', 'functions', 'crm_billing_orchestrator');
  }
  const stagedWorker = path.join(runtimeArtifact, 'functions', 'revenue_desk_call_worker');
  const stagedCore = path.join(runtimeArtifact, 'functions', 'revenue_desk_call_gateway');
  const nodeModules = path.join(stagedWorker, 'node_modules');
  const corePackage = path.join(nodeModules, 'revenue_desk_call_gateway');
  fs.mkdirSync(corePackage, { recursive: true });
  for (const name of ['index.js', 'package.json', 'lib', 'contracts']) {
    fs.cpSync(path.join(stagedCore, name), path.join(corePackage, name), { recursive: true });
  }
  // Reuse only already installed exact lockfile dependencies. No installation,
  // lifecycle script, network call, symlink or repository fallback enters this archive.
  const lock = JSON.parse(fs.readFileSync(path.join(stagedWorker, 'package-lock.json'), 'utf8'));
  const { createRequire } = require('node:module');
  const sourceRequire = createRequire(path.join(runtimeRoot, 'functions',
    'revenue_desk_call_worker', 'package.json'));
  for (const name of ['agent-base', 'debug', 'https-proxy-agent', 'ms', 'zcatalyst-sdk-node']) {
    const packagePath = sourceRequire.resolve(`${name}/package.json`);
    assert.equal(JSON.parse(fs.readFileSync(packagePath, 'utf8')).version,
      lock.packages[`node_modules/${name}`].version);
    fs.cpSync(path.dirname(packagePath), path.join(nodeModules, name),
      { recursive: true, dereference: true });
  }
  const archive = path.join(parent, 'worker.tar');
  runOk('tar', ['-cf', archive, '-C', stagedWorker, '.'], parent);
  const extracted = path.join(parent, 'extracted-worker');
  fs.mkdirSync(extracted);
  runOk('tar', ['-xf', archive, '-C', extracted], parent);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'release-manifest.json'), 'utf8'));
  const workerPrefix = 'functions/revenue_desk_call_worker/';
  for (const entry of manifest.files.filter((item) => item.path.startsWith(workerPrefix))) {
    const bytes = fs.readFileSync(path.join(extracted, entry.path.slice(workerPrefix.length)));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  }
  assert.equal(fs.existsSync(path.join(extracted, '..', 'revenue_desk_call_gateway')), false);
  const archiveRequire = createRequire(path.join(extracted, 'index.js'));
  const reportingRoot = path.join(extracted, 'reporting', 'revenue-desk-analytics');
  const bridgeRoot = path.join(extracted, 'reporting', 'revenue-desk-call-runtime',
    'functions', 'revenue_desk_call_gateway');
  for (const name of ['analytics-outbox', 'crm-report-baseline', 'reporting', 'runtime-service']) {
    const canonicalPath = archiveRequire.resolve(`revenue_desk_call_gateway/lib/${name}`);
    assert.ok(canonicalPath.startsWith(path.join(extracted, 'node_modules') + path.sep));
    assert.strictEqual(require(path.join(bridgeRoot, 'lib', name)), require(canonicalPath));
  }
  const { createDurableReportComposition, createReportingFactory } = require(path.join(extracted,
    'lib', 'terminal-draft-composition'));
  assert.equal(typeof createDurableReportComposition, 'function');
  assert.equal(typeof createReportingFactory, 'function');
  assert.equal(typeof require(path.join(extracted, 'index')), 'function');
  assert.doesNotMatch(fs.readFileSync(path.join(extracted, 'index.js'), 'utf8'),
    /terminalDraftReconcilerFactory|terminal-draft-composition/);
  const { createWorkerJobHandler } = archiveRequire('revenue_desk_call_gateway/lib/job-handler');
  const { createTerminalDraftReconciler, prepareFreeTestDocument } = require(path.join(reportingRoot,
    'tools', 'prepare-free-test-draft'));
  const { createReconciledReportFixture } = require(path.join(analyticsRoot, 'functions',
    'analytics_sync', 'test', 'helpers', 'reconciled-report-fixture'));
  const { createWorkDriveDraftFixture } = require(path.join(analyticsRoot, 'functions',
    'analytics_sync', 'test', 'helpers', 'workdrive-draft-fixture'));
  const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
  const Module = require('node:module');
  const originalLoad = Module._load;
  const guard = installOfflineGuard();
  const guardedLoad = Module._load;
  // The shared guard normally redirects core imports to reviewed source. For
  // this artifact test, retain its I/O denial but require the extracted core.
  Module._load = function archiveOnlyCore(request, parentModule, isMain) {
    if (request === 'revenue_desk_call_gateway' || request.startsWith('revenue_desk_call_gateway/')) {
      const resolved = Module._resolveFilename(request, parentModule);
      assert.ok(resolved.startsWith(path.join(extracted, 'node_modules', 'revenue_desk_call_gateway')
        + path.sep), 'runtime imports must resolve inside the extracted worker');
      return originalLoad.call(this, resolved, parentModule, isMain);
    }
    return guardedLoad.call(this, request, parentModule, isMain);
  };
  try {
    const f = await createReconciledReportFixture();
    if (exactAuthRevision) {
      const applicationEnv = { ...f.runtime.env, CRM_BILLING_AUTH_MODE: 'application' };
      delete applicationEnv.CRM_BILLING_API_GATEWAY_KEY;
      const { loadJobConfig } = archiveRequire('revenue_desk_call_gateway/lib/config');
      const application = loadJobConfig(applicationEnv, { artifactSourceRevision: f.runtime.config.sourceRevision });
      assert.equal(application.crmBillingAuthMode, 'application');
      assert.equal(application.crmBillingApiGatewayKey, null);
      assert.throws(() => loadJobConfig({ ...applicationEnv, CRM_BILLING_API_GATEWAY_KEY: '' },
        { artifactSourceRevision: f.runtime.config.sourceRevision }));
      const { parseActionRequest } = require(path.join(composedCrm, 'lib', 'action-contract'));
      const { createCrmReportDispatcher } = archiveRequire('revenue_desk_call_gateway/lib/crm-report-dispatch');
      let accepted = 0;
      const dispatcher = createCrmReportDispatcher(application, async (url, request) => {
        assert.equal(Object.hasOwn(request.headers, 'ZCFKEY'), false);
        assert.equal(Object.hasOwn(request.headers, 'Authorization'), false);
        const action = await parseActionRequest({ method: request.method, url, headers: request.headers,
          body: request.body }, { allowedPath: new URL(url).pathname,
          sharedHeaderName: application.crmBillingSharedHeaderName,
          reportSummaryHeaderValue: application.crmBillingSharedHeaderValue,
          sharedHeaderValue: 'synthetic-paid-credential', maxBodyBytes: 4096, platformOperationTimeoutMs: 100 });
        assert.equal(action.action, 'sync_report_summary');
        assert.equal(action.operationKey, 'a'.repeat(64));
        accepted += 1;
        return new Response(JSON.stringify({ ok: true, action: action.action,
          outcome: 'report_summary_readback_confirmed', duplicate: false }),
        { status: 200, headers: { 'content-type': 'application/json' } });
      }, { connections() { assert.fail('application mode must not acquire OAuth'); } });
      assert.equal((await dispatcher.dispatch('100000000000001', 'a'.repeat(64))).status, 'Dispatched');
      assert.equal(accepted, 1);
    }
    const { createReconciledFreeTestInputReader } = require(path.join(reportingRoot,
      'tools', 'read-reconciled-free-test-input'));
    const prepared = await createReconciledFreeTestInputReader(f.readerOptions)(f.identity);
    assert.ok(archiveRequire('revenue_desk_call_gateway/lib/reporting')
      .isClientCallDetails(prepared.callDetails), 'canonical packaged evidence must retain its brand');
    assert.equal(require('../lib/reporting').isClientCallDetails(prepared.callDetails), false,
      'the artifact must not inherit a checkout-local WeakSet through a fallback');
    const directory = path.join(parent, 'private-draft');
    fs.mkdirSync(directory);
    const worker = createWorkerJobHandler({ catalystSdk: f.runtime.catalystSdk,
      environment: f.runtime.env, artifactSourceRevision: f.runtime.config.sourceRevision,
      now: f.now, storeFactory: () => f.runtime.store, dispatcherFactory: () => f.h.dispatcher,
      terminalDraftReconcilerFactory: (_app, config, store) => createTerminalDraftReconciler({
        ...f.readerOptions, runtimeStore: store, runtimeConfig: config,
        privateDirectory: directory, synthetic: true,
      }),
    });
    const sourceRows = structuredClone(f.analyticsStore.rows);
    const request = f.h.fixture.retryJobRequest(f.runtime.env, { mode: 'retry_scan' });
    const context = { closeWithSuccess() {}, closeWithFailure() { assert.fail('packaged worker failed'); } };
    const created = await worker(request, context);
    assert.ok(created.deployments.results.some((row) => row.reportDraftStatus === 'draft_created_not_for_delivery'));
    const repeated = await worker(request, context);
    assert.ok(repeated.deployments.results.some((row) => row.reportDraftStatus === 'existing_draft_verified_not_for_delivery'));
    assert.deepEqual(f.analyticsStore.rows, sourceRows);
    const documents = fs.readdirSync(directory).filter((name) => name.endsWith('.html'));
    assert.equal(documents.length, 1);
    const html = fs.readFileSync(path.join(directory, documents[0]), 'utf8');
    assert.match(html, /Synthetic leaking tap/);
    assert.match(html, /Estimated Opportunity Value/);
    assert.match(html, /Preview Only — Not Sent/);
    assert.match(html, /Unknown/);

    const document = prepareFreeTestDocument(prepared.input, { callDetails: prepared.callDetails,
      now: f.now(), synthetic: true, opportunityReview: null });
    const durable = createWorkDriveDraftFixture(document, { now: f.now() });
    const durableWorker = createWorkerJobHandler({ catalystSdk: f.runtime.catalystSdk,
      environment: f.runtime.env, artifactSourceRevision: f.runtime.config.sourceRevision,
      now: f.now, storeFactory: () => f.runtime.store, dispatcherFactory: () => f.h.dispatcher,
      terminalDraftReconcilerFactory: (_app, config, store) => createDurableReportComposition({
        ...f.readerOptions, runtimeStore: store, runtimeConfig: config, reportRunStore: durable.runs,
        workdrive: durable.workdrive, readDestinationBinding: durable.readDestinationBinding, synthetic: true,
      }),
    });
    const durableCreated = await durableWorker(request, context);
    assert.ok(durableCreated.deployments.results.some((row) => row.reportDraftStatus === 'draft_created_not_for_delivery'));
    const coolingDown = await durableWorker(request, context);
    assert.ok(coolingDown.deployments.results.some((row) => row.reportDraftStatus === 'awaiting_reconciled_evidence'));
    assert.equal(durable.uploads.length, 1);
    assert.equal(durable.resources.size, 1);
    assert.deepEqual([...durable.resources.values()][0].bytes, document.document);
    assert.ok([...durable.rows.values()].some((row) => row.state.kind === 'workdrive_draft_v1'
      && row.state.phase === 'verified' && row.state.receipt.documentSha256 === document.documentSha256));
    assert.deepEqual(f.analyticsStore.rows, sourceRows);
  } finally {
    guard.restore();
    assert.deepEqual(guard.blocked, []);
  }
});

test('auth-preserving composition verifies exact blobs and rejects drift without changing base artifacts', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'revenue-desk-auth-composition-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const fixture = createCleanFixture(parent, () => {}, true);
  const authRevision = authFixture(fixture);
  const runtime = path.join(parent, 'runtime-input');
  const crm = path.join(parent, 'crm-input');
  const proofArtifact = path.join(parent, 'reviewed-auth-crm');
  crmArtifact(fixture, proofArtifact, authRevision);
  const stampRelative = path.join('functions', 'crm_billing_orchestrator', 'lib', 'source-revision.js');
  const proofSourceBefore = fs.readFileSync(path.join(proofArtifact, stampRelative));
  const crmPrepared = prepareCrmFixture(fixture, authRevision, proofArtifact, crm);
  assert.equal(crmPrepared.status, 0, crmPrepared.stderr);
  assert.doesNotMatch(crmPrepared.stdout + crmPrepared.stderr, new RegExp('a'.repeat(64)));
  const crmManifest = JSON.parse(fs.readFileSync(path.join(crm, 'crm-source-base-manifest.json')));
  assert.equal(crmManifest.reporting_revision, fixture.revision);
  assert.equal(crmManifest.proof_source_revision, authRevision);
  assert.equal(crmManifest.installation_authorized, false);
  assert.equal(crmManifest.dependency_materialization_required, true);
  assert.equal(crmManifest.proof_source_stamp_sha256,
    crypto.createHash('sha256').update(proofSourceBefore).digest('hex'));
  assert.doesNotMatch(JSON.stringify(crmManifest), new RegExp('a'.repeat(64)));
  for (const entry of crmManifest.files) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(crm, entry.path))).digest('hex'), entry.sha256);
  }
  const preparedStamp = fs.readFileSync(path.join(crm, stampRelative), 'utf8');
  assert.match(preparedStamp, new RegExp(fixture.revision));
  assert.match(preparedStamp, new RegExp('a'.repeat(64)));
  assert.doesNotMatch(preparedStamp, new RegExp(authRevision));
  assert.doesNotMatch(fs.readFileSync(path.join(crm, 'functions', 'crm_billing_orchestrator', 'lib', 'action-contract.js'), 'utf8'),
    /Synthetic auth-overlay provenance fixture/);
  assert.equal(fs.existsSync(path.join(crm, 'functions', 'crm_billing_orchestrator', 'node_modules')), false);
  assert.deepEqual(fs.readFileSync(path.join(proofArtifact, stampRelative)), proofSourceBefore);
  assert.notEqual(prepareCrmFixture(fixture, authRevision, proofArtifact, crm).status, 0);
  assert.notEqual(prepareCrmFixture(fixture, fixture.revision, proofArtifact, path.join(parent, 'wrong-proof-revision')).status, 0);
  const proofFile = path.join(proofArtifact, 'functions', 'crm_billing_orchestrator', 'lib', 'action-contract.js');
  const exactProofFile = fs.readFileSync(proofFile);
  fs.appendFileSync(proofFile, '\n// altered proof source\n');
  const tampered = path.join(parent, 'tampered-proof-source');
  assert.notEqual(prepareCrmFixture(fixture, authRevision, proofArtifact, tampered).status, 0);
  assert.equal(fs.existsSync(tampered), false);
  fs.writeFileSync(proofFile, exactProofFile);
  fs.writeFileSync(path.join(proofArtifact, stampRelative), proofSourceBefore.toString().replace('a'.repeat(64), 'invalid-proof'));
  assert.notEqual(prepareCrmFixture(fixture, authRevision, proofArtifact, path.join(parent, 'bad-proof-stamp')).status, 0);
  fs.writeFileSync(path.join(proofArtifact, stampRelative), proofSourceBefore);
  runOk(process.execPath, [fixture.builder, '--revision', fixture.revision, '--output', runtime], fixture.component);
  const originalManifest = fs.readFileSync(path.join(runtime, 'release-manifest.json'));
  const immutableInputs = [proofArtifact, runtime, crm];
  const snapshots = immutableInputs.map(treeSnapshot);
  for (const [index, input] of immutableInputs.entries()) {
    const alias = path.join(parent, `input-junction-${index}`);
    fs.symlinkSync(input, alias, 'junction');
    const nestedOutput = path.join(alias, 'must-not-be-created', 'candidate');
    const rejected = index === 0
      ? prepareCrmFixture(fixture, authRevision, proofArtifact, nestedOutput)
      : composeFixture(fixture, authRevision, runtime, crm, nestedOutput);
    assert.notEqual(rejected.status, 0, 'physical output overlap must be rejected');
    assert.match(rejected.stderr, /:destination/);
    assert.equal(fs.existsSync(path.join(input, 'must-not-be-created')), false);
    assert.deepEqual(immutableInputs.map(treeSnapshot), snapshots,
      'junction rejection must leave all immutable input files and directories unchanged');
  }
  const output = path.join(parent, 'composed');
  const result = composeFixture(fixture, authRevision, runtime, crm, output);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'composition-manifest.json')));
  assert.equal(manifest.installation_authorized, false);
  assert.equal(manifest.dependency_materialization_required, true);
  assert.equal(manifest.reporting_revision, fixture.revision);
  assert.equal(manifest.auth_preservation_revision, authRevision);
  assert.equal(manifest.overlays.length, 5);
  for (const entry of manifest.files) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(
      path.join(output, entry.artifact, entry.path))).digest('hex'), entry.sha256);
  }
  assert.deepEqual(fs.readFileSync(path.join(runtime, 'release-manifest.json')), originalManifest);
  assert.deepEqual(fs.readFileSync(path.join(output, 'provenance', 'runtime-base-release-manifest.json')), originalManifest);
  assert.equal(fs.existsSync(path.join(output, 'runtime', 'release-manifest.json')), false,
    'the base manifest must not masquerade as composed parity');
  assert.equal(fs.existsSync(path.join(output, 'runtime', 'functions', 'revenue_desk_call_worker', 'node_modules')), false);
  assert.equal(runOk('git', ['status', '--porcelain=v1'], fixture.repository), '');
  assert.notEqual(composeFixture(fixture, authRevision, runtime, crm, output).status, 0);
  const source = path.join(runtime, 'functions', 'revenue_desk_call_gateway', 'lib', 'config.js');
  const before = fs.readFileSync(source);
  fs.appendFileSync(source, '\n// unauthorized artifact drift\n');
  const drift = path.join(parent, 'drift');
  assert.notEqual(composeFixture(fixture, authRevision, runtime, crm, drift).status, 0);
  assert.equal(fs.existsSync(drift), false);
  fs.writeFileSync(source, before);
  const proofPath = path.join(crm, 'functions', 'crm_billing_orchestrator', 'lib', 'source-revision.js');
  const proof = fs.readFileSync(proofPath);
  fs.writeFileSync(proofPath, proof.toString().replace('a'.repeat(64), 'invalid-proof'));
  assert.notEqual(composeFixture(fixture, authRevision, runtime, crm, path.join(parent, 'proof-drift')).status, 0);
  fs.writeFileSync(proofPath, proof);
  fs.appendFileSync(path.join(fixture.repository, AUTH_PATHS[0]), '\n// overlapping reporting edit\n');
  const dirty = path.join(parent, 'dirty');
  assert.notEqual(composeFixture(fixture, authRevision, runtime, crm, dirty).status, 0);
  assert.notEqual(prepareCrmFixture(fixture, authRevision, proofArtifact, path.join(parent, 'dirty-crm-base')).status, 0);
  runOk('git', ['add', '--all'], fixture.repository);
  runOk('git', ['commit', '--no-gpg-sign', '-m', 'overlapping reporting change'], fixture.repository);
  const changed = runOk('git', ['rev-parse', 'HEAD'], fixture.repository);
  const overlap = path.join(parent, 'overlap');
  assert.notEqual(composeFixture(fixture, authRevision, runtime, crm, overlap, changed).status, 0);
  assert.equal(fs.existsSync(overlap), false);
});
