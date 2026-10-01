'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { createReportingFactory } = require('../../../tools/create-reporting-factory');
const { TARGET_TABLE_NAMES } = require('../lib/config');
test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });

function fixture() {
  const clock = { value: Date.parse('2026-09-29T12:00:00.000Z') };
  const effects = { source: 0, datastore: 0, query: 0, credentials: 0, fetch: 0, destination: 0 };
  const config = { environment: 'development', catalystEnvironment: 'Development',
    sourceRevision: 'a'.repeat(40), expectedProjectId: '123456789',
    tables: { outbox: 'AnalyticsSyncOutbox', checkpoint: 'AnalyticsSyncCheckpoints' },
    analyticsTimeoutMs: 20000, responseMaxBytes: 1048576, platformTimeoutMs: 3000, staleAfterMs: 7200000,
    provider: { readConnection: 'synthetic_analytics_reader',
      migrationEvidenceDigest: 'b'.repeat(64), apiBaseUrl: 'https://analyticsapi.zoho.com',
      organizationId: '123456789', workspaceId: '987654321',
      targets: Object.fromEntries(Object.entries(TARGET_TABLE_NAMES).map(([type, table], index) =>
        [type, { table, viewId: String(1000 + index) }])) } };
  const acceptance = { environment: 'development', sourceRevision: config.sourceRevision,
    verifiedAt: clock.value - 1000, expiresAt: clock.value + 86400000,
    schemaDigest: 'c'.repeat(64), analyticsContractDigest: 'd'.repeat(64),
    workdriveContractDigest: 'e'.repeat(64), releaseCompositionDigest: 'f'.repeat(64) };
  acceptance.pdfRendererDigest = 'e'.repeat(64);
  const options = { pdfRenderer: { version: 'synthetic-v1', qualificationDigest: acceptance.pdfRendererDigest,
    async render() { assert.fail('Unexpected PDF render'); } }, analyticsConfig: config, acceptance,
    workdriveBinding: { connectionReference: 'synthetic_workdrive_drafts',
      apiOrigin: 'https://www.zohoapis.com', downloadOrigin: 'https://download.zoho.com', timeoutMs: 20000 },
    now: () => clock.value,
    async readDestinationBinding() { effects.destination += 1; assert.fail('Unexpected destination lookup'); },
    async fetchImpl() { effects.fetch += 1; assert.fail('Unexpected provider request'); } };
  const runtimeConfig = { environment: 'development', sourceRevision: config.sourceRevision,
    projectId: config.expectedProjectId, tables: { DEPLOYMENT_TABLE: 'RevenueDeskDeployments' } };
  const runtimeStore = { async unique() { effects.source += 1; assert.fail('Unexpected canonical read'); },
    async query() { effects.source += 1; assert.fail('Unexpected canonical read'); },
    async queryBounded() { effects.source += 1; assert.fail('Unexpected canonical read'); } };
  const app = { async authenticateRequest() { effects.credentials += 1; assert.fail('Unexpected runtime authorization'); }, datastore() { effects.datastore += 1; assert.fail('Unexpected SDK store access'); },
    zcql() { effects.query += 1; assert.fail('Unexpected SDK query'); },
    connections() { effects.credentials += 1; assert.fail('Unexpected credential access'); } };
  return { options, config, acceptance, clock, effects, app, runtimeConfig, runtimeStore };
}
const none = { source: 0, datastore: 0, query: 0, credentials: 0, fetch: 0, destination: 0 };
const REQUIRED = { code: 'REPORTING_BINDING_REQUIRED' };

test('protected private bindings compose a frozen hook without credentials, source reads or network at construction', () => {
  const f = fixture();
  const factory = createReportingFactory(f.options);
  // The accepted private snapshot is immutable even if its caller later reuses
  // the supplied object for another purpose.
  f.config.provider.apiBaseUrl = 'https://example.invalid';
  f.acceptance.expiresAt = 0;
  const hook = factory(f.app, f.runtimeConfig, f.runtimeStore);
  assert.equal(typeof hook, 'function');
  assert.equal(Object.isFrozen(hook), true);
  assert.equal(hook.attemptTimeoutMs, 120000);
  assert.deepEqual(f.effects, none);
});

test('factory refuses wrong runtime identity and stale or malformed private acceptance before any read', () => {
  for (const field of ['environment', 'sourceRevision', 'projectId']) {
    const f = fixture();
    const factory = createReportingFactory(f.options);
    assert.throws(() => factory(f.app, { ...f.runtimeConfig, [field]: 'unapproved' }, f.runtimeStore), REQUIRED);
    assert.deepEqual(f.effects, none);
  }
  const changes = [
    f => { f.acceptance.verifiedAt = f.clock.value + 1; },
    f => { f.acceptance.verifiedAt = -1; },
    f => { f.acceptance.expiresAt = f.clock.value; },
    f => { f.acceptance.schemaDigest = '0'.repeat(64); },
    f => { f.acceptance.sourceRevision = 'b'.repeat(40); },
    f => { f.clock.value = NaN; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    assert.throws(() => createReportingFactory(f.options), REQUIRED);
    assert.deepEqual(f.effects, none);
  }
  const f = fixture();
  const factory = createReportingFactory(f.options);
  f.clock.value = f.acceptance.expiresAt;
  assert.throws(() => factory(f.app, f.runtimeConfig, f.runtimeStore), REQUIRED);
  assert.deepEqual(f.effects, none);
});

test('factory reuses fixed provider origins, canonical tables and bounded request configuration', () => {
  const changes = [
    f => { f.config.provider.apiBaseUrl = 'https://example.invalid'; },
    f => {
      const malformed = new URL('https://analyticsapi.zoho.com');
      malformed.username = 'synthetic';
      f.config.provider.apiBaseUrl = malformed.href;
    },
    f => { f.config.provider.apiBaseUrl = 'https://analyticsapi.zoho.com/?credential=synthetic'; },
    f => { f.config.provider.targets.call.table = TARGET_TABLE_NAMES.deployment; },
    f => { f.config.provider.targets.call.viewId = f.config.provider.targets.deployment.viewId; },
    f => { delete f.config.provider.targets.call; },
    f => { f.config.provider.targets.call.extra = 'unsupported'; },
    f => { f.config.analyticsTimeoutMs = true; },
    f => { f.config.responseMaxBytes = 0; },
    f => { f.config.provider.readConnection = 'unapproved connection'; },
    f => { f.config.provider.organizationId = 'wrong'; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    assert.throws(() => createReportingFactory(f.options), REQUIRED);
    assert.deepEqual(f.effects, none);
  }
  for (const origin of ['apiOrigin', 'downloadOrigin']) {
    const f = fixture(); f.options.workdriveBinding[origin] = 'https://example.invalid';
    const factory = createReportingFactory(f.options);
    assert.throws(() => factory(f.app, f.runtimeConfig, f.runtimeStore), { code: 'WORKDRIVE_CONFIGURATION_INVALID' });
    assert.deepEqual(f.effects, none);
  }
  assert.throws(() => createReportingFactory({ environment: { REPORTING_ENABLED: 'true' } }), REQUIRED);
});

test('a reused hook rejects expired acceptance before scope claims, source reads or credentials', async () => {
  const f = fixture();
  const hook = createReportingFactory(f.options)(f.app, f.runtimeConfig, f.runtimeStore);
  f.clock.value = f.acceptance.expiresAt;
  await assert.rejects(hook({ clientId: 'client_A', deploymentId: 'deployment_A' }), REQUIRED);
  assert.deepEqual(f.effects, none);
});

test('approval expiry during a pending canonical read aborts the attempt and forbids later SDK or provider work', async () => {
  const f = fixture();
  f.options.now = Date.now;
  f.acceptance.verifiedAt = Date.now() - 1000;
  f.acceptance.expiresAt = Date.now() + 500;
  let release;
  let entered;
  const pending = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  f.runtimeStore.unique = async () => { f.effects.source += 1; entered(); return pending; };
  const hook = createReportingFactory(f.options)(f.app, f.runtimeConfig, f.runtimeStore);
  const attempt = hook({ clientId: 'client_A', deploymentId: 'deployment_A' });
  await started;
  await assert.rejects(attempt, REQUIRED);
  release(null);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.effects, { ...none, source: 1 });
});


test('the trusted hook rejects caller controls and pre-cancelled work before any access', async () => {
  const f = fixture();
  const hook = createReportingFactory(f.options)(f.app, f.runtimeConfig, f.runtimeStore);
  const scope = { clientId: 'client_A', deploymentId: 'deployment_A' };
  for (const options of [null, true, [], { enabled: true }, { environment: 'production' }, { signal: true }]) {
    await assert.rejects(hook(scope, options), REQUIRED);
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(hook(scope, { signal: controller.signal }), REQUIRED);
  assert.deepEqual(f.effects, none);
});


test('approval expiry observed before a timer turn prevents the next reserved operation', async () => {
  const f = fixture();
  f.runtimeStore.unique = async () => {
    f.effects.source += 1;
    f.clock.value = f.acceptance.expiresAt;
    return null;
  };
  const hook = createReportingFactory(f.options)(f.app, f.runtimeConfig, f.runtimeStore);
  await assert.rejects(hook({ clientId: 'client_A', deploymentId: 'deployment_A' }),
    { code: 'DRAFT_RECONCILIATION_REQUIRED' });
  assert.deepEqual(f.effects, { ...none, source: 1 });
});

test('automatic factory refuses absent or unqualified PDF renderer before any access', () => {
  for (const mutate of [f => { delete f.options.pdfRenderer; },
    f => { f.options.pdfRenderer.qualificationDigest = 'f'.repeat(64); },
    f => { delete f.acceptance.pdfRendererDigest; }]) {
    const f = fixture(); mutate(f);
    assert.throws(() => createReportingFactory(f.options), REQUIRED);
    assert.deepEqual(f.effects, none);
  }
});

test('automatic native binding constructs the managed renderer with no credential read and immutable metadata', () => {
  const f = fixture();
  const { VERSION } = require('../lib/native-pdf-renderer');
  delete f.options.pdfRenderer;
  f.options.pdfBinding = { apiOrigin: 'https://api.catalyst.zoho.com',
    projectId: f.config.expectedProjectId, organizationId: '123456789', environment: 'Development',
    connectionReference: 'syntheticPdfRenderer', timeoutMs: 30000, version: VERSION,
    qualificationDigest: f.acceptance.pdfRendererDigest };
  f.app.config = { projectId: f.config.expectedProjectId, environment: 'Development' };
  const factory = createReportingFactory(f.options);
  f.options.pdfBinding.apiOrigin = 'https://invalid.test';
  const hook = factory(f.app, f.runtimeConfig, f.runtimeStore);
  assert.equal(typeof hook, 'function');
  assert.deepEqual(f.effects, none);
  assert.throws(() => factory({ ...f.app, config: { projectId: '999', environment: 'Development' } },
    f.runtimeConfig, f.runtimeStore), { code: 'PDF_RENDER_CONFIGURATION_INVALID' });
  assert.deepEqual(f.effects, none);
});
test('automatic factory cannot accept two competing PDF bindings or a wrong native project', () => {
  const f=fixture();
  const { VERSION } = require('../lib/native-pdf-renderer');
  f.options.pdfBinding={apiOrigin:'https://api.catalyst.zoho.com',projectId:'999',organizationId:'123456789',
    environment:'Development',connectionReference:'syntheticPdfRenderer',timeoutMs:30000,version:VERSION,
    qualificationDigest:f.acceptance.pdfRendererDigest};
  assert.throws(()=>createReportingFactory(f.options),REQUIRED);
  delete f.options.pdfRenderer;
  assert.throws(()=>createReportingFactory(f.options),REQUIRED);
  assert.deepEqual(f.effects,none);
});

test('protected factory retains separate read-only recovery admission and checks expiry before reads', async()=>{
 const f=fixture();const hook=createReportingFactory(f.options)(f.app,f.runtimeConfig,f.runtimeStore);
 assert.equal(typeof hook.inspectExhausted,'function');assert.equal(Object.isFrozen(hook.inspectExhausted),true);
 f.clock.value=f.acceptance.expiresAt;
 await assert.rejects(hook.inspectExhausted({clientId:'client_A',deploymentId:'deployment_A'}),REQUIRED);
 assert.deepEqual(f.effects,none);
});
