'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { runtimeFixture, invoke, NOW, SOURCE_REVISION, authorizationRows } = require('./runtime-fixture');
const { createRequestListener } = require('../lib/runtime-boundary');
const { loadDeployment, resolverMetadata } = require('../lib/runtime-service');
const { declarationFingerprint } = require('../lib/service-area-configuration');
const { loadPostalSnapshot } = require('../lib/postal-index-loader');
const { contract } = require('../lib/service-area-tool');
const manifest = require('../contracts/postal-snapshot.json');
const { failedIndex } = require('../lib/offline-postal-index');
const { validateConfiguration } = require('../lib/validation');
const { configuration } = require('./runtime-fixture');
const { prepareFreeTestConfiguration } = require('../lib/free-test-preparation');
const { SYNTHETIC_NOW, syntheticPreparationInputs } = require('../../../../revenue-desk-release/test/fixtures/free-test-preparation');

function confirmation(declaration, overrides = {}) {
  return { schemaVersion: 1,
    approvedCoverage: { status: 'contractor_approved', ...declaration },
    policy: { cityMeaning: 'postal_locality' }, snapshotSha256: manifest.sha256,
    confirmation: { confirmedAt: '2026-08-20T11:30:00.000Z', reference: 'synthetic_geography_review',
      declarationSha256: declarationFingerprint(declaration) }, ...overrides };
}

async function harness({ legacy = false, snapshot = loadPostalSnapshot({ allowSynthetic: true }), configure,
  responseBudgetMs = 8000 } = {}) {
  const f = runtimeFixture();
  const rows = f.store.rows.get(f.config.tables.DEPLOYMENT_TABLE);
  const configs = f.store.rows.get(f.config.tables.CONFIGURATION_VERSION_TABLE);
  for (const [index, row] of configs.entries()) {
    const configuration = JSON.parse(row.CONFIGURATION_JSON);
    configuration.serviceArea = { cities: [index ? 'Kansas City, MO' : 'Kansas City, KS'], zips: [] };
    if (!legacy) configuration.serviceAreaResolution = confirmation(configuration.serviceArea);
    if (configure && index === 0) configure(configuration);
    row.CONFIGURATION_JSON = JSON.stringify(configuration);
  }
  f.store.authorizationRows = rows.flatMap((row, index) => authorizationRows(row, configs[index],
    index ? 'B' : 'A', f.config.authorizationEventSecret));
  const deployment = await loadDeployment(f.store, rows[0], f.config);
  const metadata = resolverMetadata(f.config, deployment, `corr_${'a'.repeat(32)}`, new Date(NOW).toISOString());
  const payload = { name: contract.name,
    args: { city: 'Kansas City', state: 'KS', zip: '66101', addressKind: 'physical' },
    call: { call_id: 'synthetic_service_area_call', call_type: 'phone_call', direction: 'inbound',
      call_status: 'ongoing', agent_id: f.config.sharedAgentId, agent_version: f.config.sharedAgentVersion,
      to_number: '+15550000001', start_timestamp: NOW, metadata,
      transcript: 'SYNTHETIC_PRIVATE_MARKER' } };
  let writes = 0;
  const readStore = new Proxy(f.store, { get(target, key) {
    if (['insertUnique', 'mutate', 'update', 'insert', 'delete'].includes(key)) {
      return () => { writes += 1; throw new Error('service-area lookup attempted a write'); };
    }
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const listener = createRequestListener({ catalystSdk: f.catalystSdk, environment: f.env,
    now: () => f.clock.value, artifactSourceRevision: SOURCE_REVISION, storeFactory: () => readStore,
    jobFactory: () => { writes += 1; throw new Error('unexpected job access'); },
    serviceAreaTool: { ...contract, enabled: true }, postalSnapshotProvider: () => snapshot,
    retellResponseBudgetMs: responseBudgetMs,
    logger: { error(record) { f.logs.push(record); } } });
  return { ...f, rows, configs, payload,
    async request(change = {}, body = payload) {
      const before = JSON.stringify([...f.store.rows]);
      const response = await invoke(listener, { url: contract.path, payload: body,
        signatureTimestamp: f.clock.value, ...change });
      assert.equal(writes, 0);
      assert.equal(JSON.stringify([...f.store.rows]), before, 'lookup must never change durable state');
      assert.equal(f.mailAccesses, 0);
      assert.deepEqual(f.jobQueue, []);
      assert.doesNotMatch(JSON.stringify([response.body, f.logs]), /SYNTHETIC_PRIVATE_MARKER|ownership_token|client_A|deployment_A|approvedCoverage|candidateRelations/);
      return response;
    } };
}

test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });

test('shipped route stays disabled before SDK access, even with an activation-like environment variable', async () => {
  const f = runtimeFixture({ environment: { SERVICE_AREA_TOOL_ENABLED: 'true' } });
  assert.equal(contract.enabled, false);
  const response = await invoke(f.listener, { url: contract.path, payload: {} });
  assert.equal(response.status, 404);
  assert.equal(f.initialized, 0);
});

test('signed context yields a minimized decision; repeated lookup and caller correction never write', async () => {
  const f = await harness();
  const first = await f.request();
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 'eligible');
  assert.equal(first.body.postalConsistency, 'consistent');
  assert.deepEqual((await f.request()).body, first.body);
  f.payload.args = { city: 'Kansas City', state: 'MO', zip: '64101', addressKind: 'physical' };
  const corrected = await f.request();
  assert.equal(corrected.body.status, 'manual_review');
  assert.equal(corrected.body.evaluatedLocation.city.state, 'MO');
});

test('legacy city-only 66212 requests city/state and does not invent approval', async () => {
  const f = await harness({ legacy: true });
  f.payload.args = { zip: '66212', addressKind: 'physical' };
  const result = await f.request();
  assert.equal(result.body.status, 'needs_clarification');
  assert.equal(result.body.nextAction, 'ask_city_and_state');
  f.payload.args = { city: 'Kansas City', state: 'KS', addressKind: 'physical' };
  assert.equal((await f.request()).body.status, 'manual_review');
});

test('signature failures and duplicate signature headers never yield eligibility', async () => {
  const f = await harness();
  for (const change of [
    { headers: { 'x-retell-signature': null } },
    { headers: { 'x-retell-signature': `v=${NOW},d=${'0'.repeat(64)}` } },
    { signatureTimestamp: NOW - 300001 },
    { signatureTimestamp: NOW + 300001 },
    { headersDistinct: { 'x-retell-signature': ['first', 'second'] } },
  ]) {
    const result = await f.request(change);
    assert.ok(result.status >= 400);
    assert.equal(result.body.reason, 'service_area_unavailable');
  }
});

test('slow datastore, wrong method and unsupported content type return neutral failures', async () => {
  const f = await harness({ responseBudgetMs: 25 });
  for (const change of [{ method: 'GET' }, { headers: { 'content-type': 'text/plain' } },
    { url: `${contract.path}?client_id=client_B` }]) {
    const result = await f.request(change);
    assert.ok(result.status >= 400);
    assert.equal(result.body.status, 'manual_review');
  }
  f.store.unique = () => new Promise(() => {});
  const timedOut = await f.request();
  assert.equal(timedOut.status, 503);
  assert.equal(timedOut.body.reason, 'service_area_unavailable');
});

test('model authority, cross-tenant metadata, wrong number, version and unsigned ownership are rejected', async () => {
  const f = await harness();
  for (const mutate of [
    (p) => { p.args.client_id = 'client_B'; },
    (p) => { p.args.configurationVersion = 'cfg_B_v1'; },
    (p) => { delete p.call.metadata; },
    (p) => { p.call.metadata.client_id = 'client_B'; },
    (p) => { p.call.metadata.deployment_id = 'deployment_B'; },
    (p) => { p.call.metadata.configuration_version_id = 'configuration_version_B'; },
    (p) => { p.call.metadata.ownership_token = '0'.repeat(64); },
    (p) => { p.call.to_number = '+15550000002'; },
    (p) => { p.call.agent_version += 1; },
    (p) => { p.call.call_type = 'web_call'; },
    (p) => { p.call.direction = 'outbound'; },
    (p) => { p.call.call_status = 'ended'; },
    (p) => { p.call.start_timestamp -= 300001; },
  ]) {
    const payload = structuredClone(f.payload); mutate(payload);
    const result = await f.request({}, payload);
    assert.ok(result.status >= 400);
    assert.equal(result.body.status, 'manual_review');
  }
});

test('expired, stopped, changed, or rolled-back deployment cannot serve a prior call context', async () => {
  for (const mutate of [
    (f) => { f.clock.value = Date.parse('2026-08-28T12:00:00Z'); },
    (f) => { f.rows[0].TEST_STATUS = 'Paused'; },
    (f) => { f.rows[0].ACTIVE_CONFIGURATION_VERSION_ID = 'configuration_version_B'; },
    (f) => { f.rows[0].BINDING_VERSION += 1; },
    (f) => { f.configs[0].CONFIGURATION_JSON = f.configs[0].CONFIGURATION_JSON.replace('postal_locality', 'municipality'); },
    (f) => { f.store.rows.get(f.config.tables.EVENT_RECEIPT_TABLE).push({
      RECEIPT_KIND: 'control_claim', DEPLOYMENT_ID: 'deployment_A', STATUS: 'Prepared', RECEIVED_AT: new Date(NOW).toISOString(),
    }); },
  ]) {
    const f = await harness(); mutate(f);
    const result = await f.request();
    assert.ok(result.status >= 400);
    assert.equal(result.body.reason, 'service_area_unavailable');
  }
});

test('unavailable, corrupt or mismatched snapshots never reject a paired location', async () => {
  for (const snapshot of [null, { index: failedIndex('corrupt'), sha256: manifest.sha256 },
    { ...loadPostalSnapshot({ allowSynthetic: true }), sha256: '0'.repeat(64) }]) {
    const f = await harness({ snapshot });
    const result = await f.request();
    assert.equal(result.body.status, 'manual_review');
    assert.equal(result.body.postalConsistency, 'unknown');
  }
});

test('mixed policies preserve missing evidence; ZIP+4 and leading zeros stay strings', async () => {
  for (const mixedLists of ['union', 'intersection']) {
    const f = await harness({ configure(configuration) {
      configuration.serviceArea.zips = ['00501'];
      configuration.serviceAreaResolution = confirmation(configuration.serviceArea,
        { policy: { cityMeaning: 'postal_locality', mixedLists } });
    } });
    f.payload.args = { zip: '00501-1234', addressKind: 'physical' };
    const response = await f.request();
    assert.equal(response.body.status, mixedLists === 'union' ? 'eligible' : 'needs_clarification');
    assert.equal(response.body.evaluatedLocation.zip5, '00501');
  }
});

test('physical location clarification and nonmatching pair remain caller questions', async () => {
  const f = await harness();
  f.payload.args.addressKind = 'po_box';
  assert.equal((await f.request()).body.nextAction, 'ask_physical_service_location');
  f.payload.args = { city: 'Kansas City', state: 'KS', zip: '66212', addressKind: 'physical' };
  assert.equal((await f.request()).body.nextAction, 'confirm_service_city_state_and_zip');
});

test('optional confirmation preserves legacy configs and binds explicit policy to the exact declaration', () => {
  assert.equal(validateConfiguration(configuration('A')).serviceAreaResolution, undefined);
  const input = configuration('A');
  input.serviceArea = { cities: ['Kansas City, KS'], zips: ['66101'] };
  input.serviceAreaResolution = confirmation(input.serviceArea, { policy: { cityMeaning: 'municipality',
    municipalityEvidence: 'boundary_required', mixedLists: 'intersection' } });
  assert.equal(validateConfiguration(input).serviceAreaResolution.policy.mixedLists, 'intersection');
  for (const mutate of [
    (p) => { delete p.serviceAreaResolution.policy.mixedLists; },
    (p) => { delete p.serviceAreaResolution.policy.municipalityEvidence; },
    (p) => { delete p.serviceAreaResolution.policy.cityMeaning; },
    (p) => { p.serviceArea.cities = ['Kansas City, MO']; },
    (p) => { p.serviceAreaResolution.approvedCoverage.zips = ['66101-1234']; },
    (p) => { p.serviceAreaResolution.approvedCoverage.cities = ['Kansas City']; },
    (p) => { p.serviceAreaResolution.confirmation.reference = 'https://example.invalid/private'; },
    (p) => { p.serviceAreaResolution.confirmation.confirmedAt = '2026-13-01'; },
    (p) => { p.serviceAreaResolution.candidateZips = ['66212']; },
  ]) {
    const changed = structuredClone(input); mutate(changed);
    assert.throws(() => validateConfiguration(changed), { code: 'INVALID_SCHEMA' });
  }
});

test('Form 2 service-area source up to 2000 characters remains unapproved local preparation', () => {
  const input = syntheticPreparationInputs()[0];
  input.crm.account.Primary_Service_Area = 'Synthetic service area description. '.repeat(58).slice(0, 2000);
  input.review.serviceAreaSourceText = input.crm.account.Primary_Service_Area;
  input.review.serviceArea = { cities: ['Kansas City, KS'], zips: [] };
  input.review.serviceAreaResolution = confirmation(input.review.serviceArea);
  const prepared = prepareFreeTestConfiguration(input, { now: SYNTHETIC_NOW });
  assert.equal(prepared.status, 'prepared_local_only');
  assert.equal(prepared.candidate.approved, false);
  assert.equal(prepared.evidenceStatus, 'locally_consistent_not_authenticated');
  assert.ok(Buffer.byteLength(JSON.stringify(prepared.candidate)) <= 10000);
  input.review.serviceAreaSourceText += 'changed';
  assert.equal(prepareFreeTestConfiguration(input, { now: SYNTHETIC_NOW }).status, 'blocked');
  input.crm.account.Primary_Service_Area = 'x'.repeat(2001);
  input.review.serviceAreaSourceText = input.crm.account.Primary_Service_Area;
  assert.equal(prepareFreeTestConfiguration(input, { now: SYNTHETIC_NOW }).status, 'blocked');
});

test('future operator confirmation and complete oversized configuration remain blocked', () => {
  const input = syntheticPreparationInputs()[0];
  input.review.serviceArea = { cities: ['Kansas City, KS'], zips: [] };
  input.review.serviceAreaResolution = confirmation(input.review.serviceArea);
  input.review.serviceAreaResolution.confirmation.confirmedAt = new Date(SYNTHETIC_NOW + 1).toISOString();
  assert.equal(prepareFreeTestConfiguration(input, { now: SYNTHETIC_NOW }).status, 'blocked');
  input.review.serviceAreaResolution.confirmation.confirmedAt = new Date(SYNTHETIC_NOW).toISOString();
  input.review.unsupportedServices = Array.from({ length: 30 }, (_, i) => `${i} ${'x'.repeat(110)}`);
  input.review.urgentConditions = Array.from({ length: 25 }, (_, i) => `${i} ${'y'.repeat(110)}`);
  input.review.serviceAreaResolution.approvedCoverage.cities = Array.from({ length: 30 }, (_, i) =>
    `Synthetic ${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)} ${'Place '.repeat(8)}, KS`);
  assert.equal(prepareFreeTestConfiguration(input, { now: SYNTHETIC_NOW }).status, 'blocked');
});
