'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { PassThrough } = require('node:stream');
const { loadConfig } = require('../lib/config');
const { createRequestListener } = require('../lib/http-boundary');
const { createRetellRouteProvider } = require('../lib/retell-route-provider');
const { deterministicIdempotencyKey } = require('../lib/journey-core-service');
const { RevenueDeskError } = require('revenue_desk_call_gateway/lib/errors');
const { numberLookupKey } = require('revenue_desk_call_gateway/lib/security');
const { PROFILE } = require('../lib/configuration-staging-service');
const { PROFILE: SUCCESSOR_PROFILE } = require('revenue_desk_call_gateway/lib/configuration-successor');
const { RECONCILIATION_PROFILE, COMPLETION_PROFILE, TRANSITION_PROFILE } = require('revenue_desk_call_gateway/lib/configuration-reconciliation');

const REVISION = 'a'.repeat(40);
const PROJECT_ID = '101000001';
const SYNTHETIC_OPERATOR_IDENTITY = 'synthetic-administrator';
const SYNTHETIC_ORGANIZATION_ID = '606';
const SYNTHETIC_CRM_READ_LINK = 'syntheticfixturevalue123456789';
const SYNTHETIC_CRM_WRITE_LINK = 'syntheticbillingsecret1234';
const SYNTHETIC_ROLLBACK_INSTRUCTIONS = 'Restore the approved synthetic provider route.';
const SYNTHETIC_TEST_PHONE = '+15550100104';
const SYNTHETIC_INBOUND_URL =
  'https://route-control.development.catalystserverless.com/retell/inbound';
const SYNTHETIC_RETELL_LINK = 'syntheticfingerprintsecretvalue123456';

function environment(overrides = {}) {
  return {
    DEPLOYMENT_ENVIRONMENT: 'development', DEPLOYMENT_MODE: 'active',
    SOURCE_REVISION: REVISION, ZOHO_CATALYST_ZCQL_PARSER: 'V2',
    EXPECTED_CATALYST_PROJECT_ID_SHA256: crypto.createHash('sha256')
      .update(PROJECT_ID).digest('hex'),
    ROUTE_CONTROL_HOST: 'route-control.development.catalystserverless.com',
    ROUTE_CONTROL_SHARED_HEADER_NAME: 'x-synthetic-control',
    ROUTE_CONTROL_SHARED_HEADER_VALUE: 'h'.repeat(32),
    ROUTE_CONTROL_OPERATOR_IDENTITY: SYNTHETIC_OPERATOR_IDENTITY,
    ROUTE_CONTROL_OPERATOR_HMAC_SECRET: 'o'.repeat(32),
    ROUTE_CONTROL_EVENT_HMAC_SECRET: 'e'.repeat(32),
    ROUTE_CONTROL_MAX_BODY_BYTES: '4096', PLATFORM_OPERATION_TIMEOUT_MS: '3000',
    CRM_ORGANIZATION_ID: SYNTHETIC_ORGANIZATION_ID,
    FORM2_WORKFLOW_HMAC_SECRET: 'w'.repeat(32),
    FORM2_DESTINATION_SHA256: 'f'.repeat(64), FORM2_FORM_VERSION: 'form2-v1',
    CRM_API_BASE_URL: 'https://www.zohoapis.com/crm/v8',
    CRM_READ_CONNECTION_LINK_NAME: SYNTHETIC_CRM_READ_LINK,
    CRM_WRITE_CONNECTION_LINK_NAME: SYNTHETIC_CRM_WRITE_LINK,
    RETELL_API_BASE_URL: 'https://api.retellai.com', RETELL_ROUTE_MODE: 'disabled',
    RETELL_ROLLBACK_INSTRUCTIONS: SYNTHETIC_ROLLBACK_INSTRUCTIONS,
    NUMBER_LOOKUP_HMAC_SECRET: 'n'.repeat(32),
    DEPLOYMENT_TABLE: 'RevenueDeskDeployments',
    CONFIGURATION_VERSION_TABLE: 'RevenueDeskConfigurationVersions',
    EVENT_RECEIPT_TABLE: 'RevenueDeskEventReceipts',
    CANONICAL_CALL_TABLE: 'RevenueDeskCalls',
    NOTIFICATION_TABLE: 'RevenueDeskNotifications',
    ANALYTICS_OUTBOX_TABLE: 'AnalyticsSyncOutbox',
    OPERATION_TABLE: 'CRMBillingOperations',
    ...overrides,
  };
}

function response() {
  return {
    headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = JSON.parse(value); },
  };
}

test('application credential rejection on every control action precedes body, SDK and effects', async () => {
  const retiredCredential = environment().ROUTE_CONTROL_SHARED_HEADER_VALUE;
  const env = environment({ ROUTE_CONTROL_SHARED_HEADER_VALUE: 'z'.repeat(32) });
  for (const action of ['approve-configuration', 'activate-free-test', 'rollback-free-test']) {
    for (const variant of ['missing', 'wrong', 'retired', 'form2', 'duplicate', 'physical-duplicate', 'raw-duplicate']) {
      let sdk = 0; let body = 0;
      const listener = createRequestListener({ environment: env, artifactSourceRevision: REVISION,
        catalystSdk: { initialize() { sdk += 1; throw new Error('SDK prohibited'); } } });
      const request = { method: 'POST', url: `/internal/revenue-desk/${action}`,
        headers: { host: env.ROUTE_CONTROL_HOST, 'x-zc-environment': 'development',
          'x-zc-projectid': PROJECT_ID, 'content-type': 'application/json' },
        get rawBody() { body += 1; throw new Error('Body prohibited'); } };
      const supplied = {
        form2: env.FORM2_WORKFLOW_HMAC_SECRET,
        retired: retiredCredential,
        duplicate: env.ROUTE_CONTROL_SHARED_HEADER_VALUE,
        'physical-duplicate': env.ROUTE_CONTROL_SHARED_HEADER_VALUE,
        'raw-duplicate': env.ROUTE_CONTROL_SHARED_HEADER_VALUE,
        wrong: 'synthetic-wrong-value',
      };
      if (variant !== 'missing') request.headers['x-synthetic-control'] = supplied[variant];
      if (variant === 'duplicate') request.headers['X-Synthetic-Control'] = env.ROUTE_CONTROL_SHARED_HEADER_VALUE;
      if (variant === 'physical-duplicate') request.headersDistinct = {
        'x-synthetic-control': [env.ROUTE_CONTROL_SHARED_HEADER_VALUE, env.ROUTE_CONTROL_SHARED_HEADER_VALUE],
      };
      if (variant === 'raw-duplicate') request.rawHeaders = ['x-synthetic-control',
        env.ROUTE_CONTROL_SHARED_HEADER_VALUE, 'X-Synthetic-Control', env.ROUTE_CONTROL_SHARED_HEADER_VALUE];
      const output = response(); await listener(request, output);
      assert.equal(output.statusCode, 401, `${action}/${variant}`);
      assert.deepEqual(output.body, { ok: false, code: 'control_authentication_failed' });
      assert.equal(sdk, 0); assert.equal(body, 0);
    }
  }
});

test('authenticated unfinished control body times out before SDK and late input cannot dispatch', async () => {
  let sdk = 0;
  const env = environment({ PLATFORM_OPERATION_TIMEOUT_MS: '250' });
  const listener = createRequestListener({ environment: env, artifactSourceRevision: REVISION,
    catalystSdk: { initialize() { sdk += 1; throw new Error('SDK prohibited'); } } });
  const request = new PassThrough();
  Object.assign(request, { method: 'POST', url: '/internal/revenue-desk/approve-configuration',
    headers: { host: env.ROUTE_CONTROL_HOST, 'x-zc-environment': 'development',
      'x-zc-projectid': PROJECT_ID, 'x-synthetic-control': env.ROUTE_CONTROL_SHARED_HEADER_VALUE,
      'content-type': 'application/json' } });
  const output = response();
  await listener(request, output);
  assert.equal(output.statusCode, 408);
  assert.equal(output.body.code, 'invalid_control_request');
  assert.equal(request.listenerCount('data'), 0);
  assert.equal(request.listenerCount('end'), 0);
  request.end('{}'); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sdk, 0);
});

test('authenticated configuration staging binds reader deadlines before dispatch and rejects other actions', async () => {
  let providers = 0; let stages = 0;
  const readerTimeouts = [];
  const listener = createRequestListener({ environment: environment(), artifactSourceRevision: REVISION,
    catalystSdk: { initialize() { return { config: { environment: 'development', projectId: PROJECT_ID } }; } },
    factories: { crm: () => ({}), store: () => ({}), core: () => ({}), evidence: () => ({}),
      configurationSource: () => ({}),
      configurationConversion: ({ timeoutMs }) => { readerTimeouts.push(['conversion', timeoutMs]); return {}; },
      configurationMetadata: ({ timeoutMs }) => { readerTimeouts.push(['metadata', timeoutMs]); return {}; },
      staging: () => ({ async stage() { stages += 1; return { state: 'StagedInactive', replayed: false,
        configurationVersionId: 'synthetic_configuration', deploymentId: 'synthetic_deployment' }; } }),
      provider: () => { providers += 1; throw new Error('Provider construction prohibited'); } } });
  for (const action of ['approve-configuration', 'activate-free-test']) {
    const output = response();
    await listener({ method: 'POST', url: `/internal/revenue-desk/${action}`,
      headers: { host: 'route-control.development.catalystserverless.com',
        'x-zc-environment': 'development', 'x-zc-projectid': PROJECT_ID,
        'x-synthetic-control': 'h'.repeat(32), 'content-type': 'application/json' },
      rawBody: Buffer.from(JSON.stringify({ profile: PROFILE })) }, output);
    assert.equal(output.statusCode, action === 'approve-configuration' ? 200 : 400);
    if (output.statusCode === 200) assert.deepEqual({ active: output.body.active, approved: output.body.approved },
      { active: false, approved: false });
  }
  assert.equal(stages, 1); assert.equal(providers, 0);
  assert.deepEqual(readerTimeouts, [['conversion', 3000], ['metadata', 3000]]);
});

test('inactive successor uses only existing authenticated approval route without constructing a provider', async () => {
  let attempts = 0;
  const listener = createRequestListener({ environment: environment(), artifactSourceRevision: REVISION,
    catalystSdk: { initialize() { return { config: { environment: 'development', projectId: PROJECT_ID } }; } },
    factories: { crm: () => ({}), store: () => ({}), evidence: () => ({}), configurationSource: () => ({}),
      configurationConversion: () => ({}), successor: () => ({ async succeed() {
        attempts += 1; return { state: 'SuccessorInactive', replayed: false,
          configurationVersionId: 'synthetic_successor', deploymentId: 'synthetic_deployment' };
      } }), provider: () => { throw new Error('Provider construction prohibited'); },
      full: () => { throw new Error('Ordinary control prohibited'); } } });
  for (const action of ['approve-configuration', 'activate-free-test', 'rollback-free-test']) {
    const output = response();
    await listener({ method: 'POST', url: `/internal/revenue-desk/${action}`,
      headers: { host: 'route-control.development.catalystserverless.com', 'x-zc-environment': 'development',
        'x-zc-projectid': PROJECT_ID, 'x-synthetic-control': 'h'.repeat(32), 'content-type': 'application/json' },
      rawBody: Buffer.from(JSON.stringify({ profile: SUCCESSOR_PROFILE })) }, output);
    assert.equal(output.statusCode, action === 'approve-configuration' ? 200 : 400);
    if (output.statusCode === 200) {
      assert.equal(output.body.active, false); assert.equal(output.body.approved, false);
      assert.equal(output.body.action, 'succeed_inactive_configuration');
    }
  }
  assert.equal(attempts, 1);
  assert.equal(loadConfig(environment(), REVISION).successorAuthorizationSha256, null);
  assert.throws(() => loadConfig(environment({ ROUTE_CONTROL_SUCCESSOR_AUTHORIZATION_SHA256: 'not-a-document-digest' }), REVISION));
});

test('configuration reconciliation, completion and transition dispatch only to the staging owner without provider or mail paths', async () => {
  for (const profile of [RECONCILIATION_PROFILE, COMPLETION_PROFILE, TRANSITION_PROFILE]) for (const replayed of [false, true]) {
    const method = profile === TRANSITION_PROFILE ? 'transition' : profile === COMPLETION_PROFILE ? 'complete' : 'reconcile';
    const calls = { reconcile: 0, complete: 0, transition: 0, provider: 0, full: 0, stage: 0, connections: 0, mail: 0, fetch: 0 };
    const body = { profile, syntheticMarker: 'owner-reviewed-recovery' };
    const listener = createRequestListener({ environment: environment(), artifactSourceRevision: REVISION,
      fetchImpl: async () => { calls.fetch += 1; throw new Error('Outbound access prohibited'); },
      catalystSdk: { initialize() { return {
        config: { environment: 'development', projectId: PROJECT_ID },
        connections() { calls.connections += 1; throw new Error('Credential access prohibited'); },
        email() { calls.mail += 1; throw new Error('Mail access prohibited'); },
      }; } },
      factories: { crm: () => ({}), store: () => ({}), core: () => ({}), evidence: () => ({}),
        configurationSource: () => ({}), configurationConversion: () => ({}), configurationMetadata: () => ({}),
        staging: () => ({
          async stage() { calls.stage += 1; throw new Error('Ordinary staging is not reconciliation'); },
          async [method](value) {
            calls[method] += 1; assert.deepEqual(value, body);
            return { state: 'StagedInactive', replayed, approved: true, active: true,
              configurationVersionId: 'synthetic_successor_configuration', deploymentId: 'synthetic_deployment' };
          },
        }),
        provider: () => { calls.provider += 1; throw new Error('Provider construction prohibited'); },
        full: () => { calls.full += 1; throw new Error('Full control construction prohibited'); },
      } });
    const output = response();
    await listener({ method: 'POST', url: '/internal/revenue-desk/approve-configuration',
      headers: { host: 'route-control.development.catalystserverless.com',
        'x-zc-environment': 'development', 'x-zc-projectid': PROJECT_ID,
        'x-synthetic-control': 'h'.repeat(32), 'content-type': 'application/json' },
      rawBody: Buffer.from(JSON.stringify(body)) }, output);
    assert.equal(output.statusCode, 200);
    assert.deepEqual(output.body, { ok: true, action: `${method}_configuration`, state: 'StagedInactive',
      replayed, approved: false, active: false,
      configurationVersionId: 'synthetic_successor_configuration', deploymentId: 'synthetic_deployment' });
    assert.deepEqual(calls, { reconcile: method === 'reconcile' ? 1 : 0, complete: method === 'complete' ? 1 : 0,
      transition: method === 'transition' ? 1 : 0,
      provider: 0, full: 0, stage: 0, connections: 0, mail: 0, fetch: 0 });
    assert.equal(output.headers['cache-control'], 'no-store, max-age=0');
  }
});

test('reconciliation, completion and transition wrong route, missing authentication and oversized input reject before SDK or factories', async () => {
  const cases = [
    { status: 400, mutate: (request) => { request.url = '/internal/revenue-desk/activate-free-test'; } },
    { status: 400, mutate: (request) => { request.url = '/internal/revenue-desk/rollback-free-test'; } },
    { status: 401, mutate: (request) => { delete request.headers['x-synthetic-control']; } },
    { status: 401, mutate: (request) => { request.headers['x-synthetic-control'] = 'wrong'; } },
    { status: 413, mutate: (request) => { request.headers['content-length'] = '4097'; } },
    { status: 400, mutate: (request) => { request.rawBody = Buffer.from(JSON.stringify({
      profile: JSON.parse(request.rawBody).profile, padding: 'x'.repeat(4096),
    })); } },
  ];
  for (const profile of [RECONCILIATION_PROFILE, COMPLETION_PROFILE, TRANSITION_PROFILE]) for (const selected of cases) {
    let initialized = 0; let factories = 0;
    const forbiddenFactory = () => { factories += 1; throw new Error('Factory access prohibited'); };
    const listener = createRequestListener({ environment: environment(), artifactSourceRevision: REVISION,
      catalystSdk: { initialize() { initialized += 1; throw new Error('SDK access prohibited'); } },
      factories: Object.fromEntries(['crm', 'store', 'core', 'evidence', 'configurationSource',
        'configurationConversion', 'configurationMetadata', 'staging', 'provider', 'full']
        .map((name) => [name, forbiddenFactory])) });
    const request = { method: 'POST', url: '/internal/revenue-desk/approve-configuration',
      headers: { host: 'route-control.development.catalystserverless.com',
        'x-zc-environment': 'development', 'x-zc-projectid': PROJECT_ID,
        'x-synthetic-control': 'h'.repeat(32), 'content-type': 'application/json' },
      rawBody: Buffer.from(JSON.stringify({ profile })) };
    selected.mutate(request);
    const output = response(); await listener(request, output);
    assert.equal(output.statusCode, selected.status);
    assert.deepEqual(output.body, { ok: false,
      code: selected.status === 401 ? 'control_authentication_failed' : 'invalid_control_request' });
    assert.equal(initialized, 0); assert.equal(factories, 0);
  }
});

function isolatedConfig() {
  return loadConfig(environment({
    RETELL_ROUTE_MODE: 'isolated_test', RETELL_TEST_PHONE_NUMBER: SYNTHETIC_TEST_PHONE,
    RETELL_SHARED_AGENT_ID: 'agent_synthetic', RETELL_SHARED_AGENT_VERSION: '7',
    RETELL_INBOUND_WEBHOOK_URL: SYNTHETIC_INBOUND_URL,
    RETELL_CONNECTION_LINK_NAME: SYNTHETIC_RETELL_LINK,
  }), REVISION);
}

function activePhone(config) {
  return {
    phone_number: config.retellPhoneNumber, phone_number_type: 'retell-twilio',
    last_modification_timestamp: 1, nickname: 'ZZZ SYNTHETIC Development route',
    inbound_agents: [{ agent_id: config.sharedAgentId, agent_version: 7, weight: 1 }],
    outbound_agents: [], inbound_sms_agents: [], outbound_sms_agents: [],
    inbound_webhook_url: config.inboundWebhookUrl,
    inbound_sms_webhook_url: null, fallback_number: null,
  };
}

function routeBinding(config) {
  const routeFingerprint = `route_${'5'.repeat(64)}`;
  return {
    deployment: {
      NUMBER_LOOKUP_HASH: numberLookupKey(config.numberSecret, config.retellPhoneNumber),
      MONITOR_AGENT_ID: config.sharedAgentId, MONITOR_AGENT_VERSION: 7,
      DEPLOYMENT_ID: 'deployment_synthetic',
      ACTIVE_CONFIGURATION_VERSION_ID: 'configuration_synthetic',
      APPROVED_ROUTE_FINGERPRINT: routeFingerprint,
    },
    configurationVersion: {
      DEPLOYMENT_ID: 'deployment_synthetic',
      CONFIGURATION_VERSION_ID: 'configuration_synthetic',
    },
    routeFingerprint,
  };
}

test('disabled telephony mode installs without a number and fails activation closed', async () => {
  const config = loadConfig(environment(), REVISION);
  assert.equal(config.retellRouteMode, 'disabled');
  assert.equal(config.retellPhoneNumber, null);
  const provider = createRetellRouteProvider(config);
  await assert.rejects(provider.verifyActiveRoute(),
    { code: 'ISOLATED_RETELL_TEST_NUMBER_REQUIRED' });
  assert.deepEqual(await provider.disableRoute(), {
    status: 'manual_rollback_required',
    instructions: 'Restore the approved synthetic provider route.',
    failureCode: 'ISOLATED_RETELL_TEST_NUMBER_REQUIRED',
  });
});

test('bad private authentication is rejected before body and SDK access', async () => {
  let sdkAccesses = 0;
  let bodyReads = 0;
  const listener = createRequestListener({
    environment: environment(), artifactSourceRevision: REVISION,
    catalystSdk: { initialize() { sdkAccesses += 1; throw new Error('must not run'); } },
  });
  const request = {
    method: 'POST', url: '/internal/revenue-desk/approve-configuration',
    headers: {
      host: 'route-control.development.catalystserverless.com',
      'x-zc-environment': 'development', 'x-zc-projectid': PROJECT_ID,
      'x-synthetic-control': 'wrong', 'content-type': 'application/json',
    },
  };
  Object.defineProperty(request, 'rawBody', {
    get() { bodyReads += 1; throw new Error('must not read'); },
  });
  const output = response();
  await listener(request, output);
  assert.equal(output.statusCode, 401);
  assert.deepEqual(output.body, { ok: false, code: 'control_authentication_failed' });
  assert.equal(bodyReads, 0);
  assert.equal(sdkAccesses, 0);
});

test('control authentication accepts only the configured host with optional exact HTTPS default port',
  async () => {
  const host = environment().ROUTE_CONTROL_HOST;
  for (const value of [host, host.toUpperCase(), `${host}:443`, `${host.toUpperCase()}:443`]) {
    let sdkAccesses = 0;
    const listener = createRequestListener({
      environment: environment(), artifactSourceRevision: REVISION,
      catalystSdk: { initialize() {
        sdkAccesses += 1;
        throw new Error('Synthetic stop after successful authentication.');
      } },
    });
    const output = response();
    await listener({
      method: 'POST', url: '/internal/revenue-desk/approve-configuration',
      headers: {
        host: value, 'x-zc-environment': 'development', 'x-zc-projectid': PROJECT_ID,
        'x-synthetic-control': 'h'.repeat(32), 'content-type': 'application/json',
      },
      rawBody: Buffer.from('{}'),
    }, output);
    assert.equal(sdkAccesses, 1);
    assert.equal(output.statusCode, 500);
    assert.deepEqual(output.body, { ok: false, code: 'control_failed' });
  }
});

test('default-port compatibility preserves exact authority, header shape, and caller identity rejection',
  async () => {
  const host = environment().ROUTE_CONTROL_HOST;
  const rejectedHosts = [undefined, null, 443, [host], '', 'other.development.catalystserverless.com',
    'route-control.catalystserverless.com', `${host}:80`, `${host}:8443`, `${host}:0443`,
    `${host}:443:443`, `${host}:`, `${host}.`, `${host} `, ` ${host}`, `${host}:443 `,
    `https://${host}`, `${host}/`, `user@${host}`, `${host}.example.invalid`, `${host},${host}`];
  const mutations = rejectedHosts.map(value => request => {
    if (value === undefined) delete request.headers.host;
    else request.headers.host = value;
    // A valid forwarded value never substitutes for a rejected Host.
    request.headers['x-forwarded-host'] = host;
    request.headers.forwarded = `host=${host};proto=https`;
  });
  mutations.push(
    request => { request.headersDistinct = { host: [`${host}:443`, `${host}:443`] }; },
    request => { request.headersDistinct = { host: [`${host}:443`], Host: [`${host}:443`] }; },
    request => { request.headersDistinct = { host: `${host}:443` }; },
    request => { request.headersDistinct = { host: [] }; },
    request => { request.headersDistinct = { host: [null] }; },
    request => { request.rawHeaders = ['Host', `${host}:443`, 'host', `${host}:443`]; },
    request => { request.headers['x-zc-environment'] = 'production'; },
    request => { request.headers['x-zc-projectid'] = '101000002'; },
    request => { request.headers['x-synthetic-control'] = 'h'.repeat(32) + ' '; },
  );
  for (const mutate of mutations) {
    let bodyReads = 0;
    let sdkAccesses = 0;
    const listener = createRequestListener({
      environment: environment(), artifactSourceRevision: REVISION,
      catalystSdk: { initialize() { sdkAccesses += 1; throw new Error('must not run'); } },
    });
    const request = {
      method: 'POST', url: '/internal/revenue-desk/approve-configuration',
      headers: {
        host: `${host}:443`, 'x-zc-environment': 'development', 'x-zc-projectid': PROJECT_ID,
        'x-synthetic-control': 'h'.repeat(32), 'content-type': 'application/json',
      },
    };
    Object.defineProperty(request, 'rawBody', {
      get() { bodyReads += 1; throw new Error('must not read'); },
    });
    mutate(request);
    const output = response();
    await listener(request, output);
    assert.equal(output.statusCode, 401);
    assert.deepEqual(output.body, { ok: false, code: 'control_authentication_failed' });
    assert.equal(bodyReads, 0);
    assert.equal(sdkAccesses, 0);
  }
});

test('HTTP boundary dispatches a blank-deployment command to Journey-core before provider setup',
  async () => {
  let providerConstructions = 0;
  let fullConstructions = 0;
  let receivedBody = null;
  const listener = createRequestListener({
    environment: environment(), artifactSourceRevision: REVISION,
    catalystSdk: { initialize() {
      return { config: { environment: 'development', projectId: PROJECT_ID } };
    } },
    factories: {
      crm: () => ({}), store: () => ({}), evidence: () => ({}),
      core: () => ({
        async approve(body) {
          receivedBody = structuredClone(body);
          return {
            state: 'Scheduled', replayed: false, approved: true,
            active: false, stopped: false,
            configurationVersionId: `form2cfgv1:8000000000001:${'a'.repeat(40)}`,
          };
        },
      }),
      provider: () => { providerConstructions += 1; throw new Error('must not run'); },
      full: () => { fullConstructions += 1; throw new Error('must not run'); },
    },
  });
  const body = {
    dealId: '400000000000001', journeyId: 'journey_synthetic',
    configurationVersionId: `form2cfgv1:8000000000001:${'a'.repeat(40)}`,
    deploymentId: '',
  };
  body.idempotencyKey = deterministicIdempotencyKey(
    'approve', body.dealId, body.journeyId, body.configurationVersionId,
  );
  const rawBody = Buffer.from(JSON.stringify(body));
  const request = {
    method: 'POST', url: '/internal/revenue-desk/approve-configuration', rawBody,
    headers: {
      host: 'route-control.development.catalystserverless.com',
      'x-zc-environment': 'development', 'x-zc-projectid': PROJECT_ID,
      'x-synthetic-control': 'h'.repeat(32), 'content-type': 'application/json',
      'content-length': String(rawBody.length),
    },
  };
  const output = response();
  await listener(request, output);
  assert.deepEqual(receivedBody, body);
  assert.equal(providerConstructions, 0);
  assert.equal(fullConstructions, 0);
  assert.equal(output.statusCode, 200);
  assert.deepEqual(output.body, {
    ok: true, action: 'approve', state: 'Scheduled', replayed: false,
    approved: true, active: false, stopped: false,
    configurationVersionId: body.configurationVersionId,
    rollbackStatus: null, rollbackInstructions: null,
  });
});

test('all Journey-core wire shapes bypass full deployment and Retell provider construction',
  async () => {
  const configurationVersionId = `form2cfgv1:8000000000001:${'a'.repeat(40)}`;
  const cases = [
    { action: 'approve', path: '/internal/revenue-desk/approve-configuration',
      deployment: 'omitted', status: 200, expected: {
        ok: true, action: 'approve', state: 'Scheduled', replayed: false,
        approved: true, active: false, stopped: false, configurationVersionId,
        rollbackStatus: null, rollbackInstructions: null,
      } },
    { action: 'activate', path: '/internal/revenue-desk/activate-free-test',
      deployment: null, status: 409, expected: {
        ok: false, code: 'isolated_retell_test_number_required',
      } },
    { action: 'rollback', path: '/internal/revenue-desk/rollback-free-test',
      deployment: '', status: 200, expected: {
        ok: true, action: 'rollback', state: 'Stopped', replayed: false,
        approved: false, active: false, stopped: true, configurationVersionId,
        rollbackStatus: 'route_inactive', rollbackInstructions: null,
      } },
  ];
  for (const selected of cases) {
    let providerConstructions = 0;
    let fullConstructions = 0;
    const core = {
      async approve() { return { state: 'Scheduled', replayed: false, approved: true,
        active: false, stopped: false, configurationVersionId }; },
      async activate() {
        throw new RevenueDeskError('ISOLATED_RETELL_TEST_NUMBER_REQUIRED',
          'Activation remains pre-telephony.', { httpStatus: 409 });
      },
      async rollback() { return { state: 'Stopped', replayed: false, approved: false,
        active: false, stopped: true, configurationVersionId }; },
    };
    const listener = createRequestListener({
      environment: environment(), artifactSourceRevision: REVISION,
      catalystSdk: { initialize() {
        return { config: { environment: 'development', projectId: PROJECT_ID } };
      } },
      factories: {
        crm: () => ({}), store: () => ({}), evidence: () => ({}), core: () => core,
        provider: () => { providerConstructions += 1; throw new Error('must not run'); },
        full: () => { fullConstructions += 1; throw new Error('must not run'); },
      },
    });
    const body = {
      dealId: '400000000000001', journeyId: 'journey_synthetic', configurationVersionId,
      idempotencyKey: deterministicIdempotencyKey(selected.action,
        '400000000000001', 'journey_synthetic', configurationVersionId),
      ...(selected.action === 'rollback' ? { reason: 'operator_requested' } : {}),
    };
    if (selected.deployment !== 'omitted') body.deploymentId = selected.deployment;
    const rawBody = Buffer.from(JSON.stringify(body));
    const output = response();
    await listener({
      method: 'POST', url: selected.path, rawBody,
      headers: {
        host: 'ROUTE-CONTROL.DEVELOPMENT.CATALYSTSERVERLESS.COM:443',
        'x-zc-environment': 'development', 'x-zc-projectid': PROJECT_ID,
        'x-synthetic-control': 'h'.repeat(32), 'content-type': 'application/json',
        'content-length': String(rawBody.length),
      },
    }, output);
    assert.equal(output.statusCode, selected.status);
    assert.deepEqual(output.body, selected.expected);
    assert.equal(providerConstructions, 0);
    assert.equal(fullConstructions, 0);
  }
});

test('isolated mode rejects incomplete number identity', () => {
  assert.throws(() => loadConfig(environment({ RETELL_ROUTE_MODE: 'isolated_test' }), REVISION),
    { code: 'INVALID_RUNTIME_CONFIGURATION' });
});

test('route-control requires exact trusted Form 2 binding configuration', () => {
  const config = loadConfig(environment(), REVISION);
  assert.equal(config.form2DestinationSha256, 'f'.repeat(64));
  assert.equal(config.form2FormVersion, 'form2-v1');
  assert.equal(config.crmOrganizationSha256,
    crypto.createHash('sha256').update(SYNTHETIC_ORGANIZATION_ID).digest('hex'));
  for (const overrides of [
    { FORM2_WORKFLOW_HMAC_SECRET: '' },
    { FORM2_DESTINATION_SHA256: 'not-a-digest' },
    { FORM2_FORM_VERSION: 'invalid version' },
    { FORM2_WORKFLOW_HMAC_SECRET: 'e'.repeat(32) },
  ]) {
    assert.throws(() => loadConfig(environment(overrides), REVISION),
      { code: 'INVALID_RUNTIME_CONFIGURATION' });
  }
});

test('public Form 1 channel is optional, exact, and rejects assisted or placeholder configuration', () => {
  assert.equal(loadConfig(environment(), REVISION).form1PublicSubmissionChannel, null);
  assert.equal(loadConfig(environment({ FORM1_PUBLIC_SUBMISSION_CHANNEL: '' }), REVISION)
    .form1PublicSubmissionChannel, null);
  assert.equal(loadConfig(environment({ FORM1_PUBLIC_SUBMISSION_CHANNEL: ' Synthetic Public Form ' }), REVISION)
    .form1PublicSubmissionChannel, ' Synthetic Public Form ');
  for (const value of ['CRM Assisted', ' crm   assisted ', 'unknown', 'PENDING', 'default',
    '<verified-channel>', '   ', 'bad\nchannel', 'x'.repeat(101)]) {
    assert.throws(() => loadConfig(environment({ FORM1_PUBLIC_SUBMISSION_CHANNEL: value }), REVISION),
      { code: 'INVALID_RUNTIME_CONFIGURATION' });
  }
});

test('rollback never clears an unverified or repurposed Retell number', async () => {
  const config = isolatedConfig();
  let patches = 0;
  const repurposed = {
    phone_number: config.retellPhoneNumber, phone_number_type: 'retell-twilio',
    last_modification_timestamp: 1, nickname: 'Customer production route',
    inbound_agents: [{ agent_id: config.sharedAgentId, agent_version: 7, weight: 1 }],
    outbound_agents: [], inbound_sms_agents: [], outbound_sms_agents: [],
    inbound_webhook_url: config.inboundWebhookUrl,
    inbound_sms_webhook_url: null, fallback_number: null,
  };
  const provider = createRetellRouteProvider(config, {
    authorization: async () => 'Bearer synthetic',
    fetchImpl: async (_url, options) => {
      if (options.method === 'PATCH') patches += 1;
      return new Response(JSON.stringify(repurposed), {headers:{'content-type':'application/json'}});
    },
  });
  const result = await provider.disableRoute(routeBinding(config));
  assert.equal(result.status, 'manual_rollback_required');
  assert.equal(result.failureCode, 'ROUTE_ROLLBACK_OWNERSHIP_UNPROVEN');
  assert.equal(patches, 0);
});

test('active verification rejects every missing or malformed route-state field', async () => {
  const config = isolatedConfig();
  const fields = [
    'inbound_agents', 'outbound_agents', 'inbound_sms_agents', 'outbound_sms_agents',
    'inbound_webhook_url', 'inbound_sms_webhook_url', 'fallback_number',
  ];
  for (const field of fields) {
    for (const mode of ['missing', 'wrong_type']) {
      const malformed = activePhone(config);
      if (mode === 'missing') delete malformed[field];
      else malformed[field] = field.endsWith('_agents') ? {} : [];
      const provider = createRetellRouteProvider(config, {
        authorization: async () => 'Bearer synthetic',
        fetchImpl: async () => new Response(JSON.stringify(malformed), {headers:{'content-type':'application/json'}}),
      });
      await assert.rejects(provider.verifyActiveRoute(routeBinding(config)),
        { code: 'ROUTE_VERIFICATION_FAILED' });
    }
  }
});

test('rollback treats sparse provider readback as manual and never as inactive', async () => {
  const config = isolatedConfig();
  for (const sparsePhase of ['before', 'after']) {
    let gets = 0;
    let patches = 0;
    const provider = createRetellRouteProvider(config, {
      authorization: async () => 'Bearer synthetic',
      fetchImpl: async (_url, options) => {
        if (options.method === 'PATCH') {
          patches += 1;
          return new Response('{}', {headers:{'content-type':'application/json'}});
        }
        gets += 1;
        const value = sparsePhase === 'before' || gets > 1
          ? { ...activePhone(config), inbound_agents: undefined }
          : activePhone(config);
        return new Response(JSON.stringify(value), {headers:{'content-type':'application/json'}});
      },
    });
    const result = await provider.disableRoute(routeBinding(config));
    assert.equal(result.status, 'manual_rollback_required');
    assert.notEqual(result.failureCode, null);
    assert.equal(patches, sparsePhase === 'before' ? 0 : 1);
  }
});


test('report delivery profile is authenticated and uses existing controller principal before provider construction', async () => {
  const actors=[];let calls=0;
  const listener=createRequestListener({environment:environment(),artifactSourceRevision:REVISION,
    catalystSdk:{initialize(){return {config:{environment:'development',projectId:PROJECT_ID}};}},
    factories:{store:()=>({}),reportDelivery:()=>({async handle(body,context){calls++;actors.push(context.actor);
      assert.equal(body.dealId,'synthetic_deal');return {manifestSha256:'a'.repeat(64)};}}),
      crm:()=>{throw Error('CRM control writer construction prohibited');},provider:()=>{throw Error('Retell construction prohibited');}}});
  const headers={host:'route-control.development.catalystserverless.com','x-zc-environment':'development',
    'x-zc-projectid':PROJECT_ID,'x-synthetic-control':'h'.repeat(32),'content-type':'application/json'};
  const output=response();await listener({method:'POST',url:'/internal/revenue-desk/approve-configuration',headers,
    rawBody:Buffer.from(JSON.stringify({profile:'report_delivery_v1',action:'view',dealId:'synthetic_deal'}))},output);
  assert.equal(output.statusCode,200);assert.equal(calls,1);assert.equal(actors[0].kind,'internal_controller');
  assert.equal(actors[0].identity,loadConfig(environment(),REVISION).operatorIdHash);
  const denied=response();await listener({method:'POST',url:'/internal/revenue-desk/approve-configuration',
    headers:{...headers,'x-synthetic-control':'invalid'},rawBody:Buffer.from('{}')},denied);
  assert.equal(denied.statusCode,401);assert.equal(calls,1);
});


test('sender qualification reuses authenticated controller without any storage or writer/provider construction',async()=>{
 const {createProtectedSenderQualification}=require('../lib/report-sender-qualification');
 const env=environment(),config=loadConfig(env,REVISION);let credentials=0,gets=0;
 const at=1800000000000,b={schemaVersion:1,enabled:true,environment:'development',sourceRevision:REVISION,projectId:PROJECT_ID,
  controlHost:config.controlHost,connectionReference:'synthetic_sender',fromAddress:'reports@example.invalid',fromName:'Synthetic',verifiedAt:at-1,expiresAt:at+60000,timeoutMs:1000,costQualificationDigest:'b'.repeat(64)};
 env.REPORT_SENDER_QUALIFICATION_JSON=JSON.stringify(b);env.REPORT_SENDER_QUALIFICATION_SHA256=crypto.createHash('sha256').update(env.REPORT_SENDER_QUALIFICATION_JSON).digest('hex');
 const blocked=()=>{assert.fail('No stores/writers/provider/other factory allowed');};
 const listener=createRequestListener({environment:env,artifactSourceRevision:REVISION,catalystSdk:{initialize(){return {config:{environment:'Development',projectId:PROJECT_ID},datastore:blocked,zcql:blocked,
  connections:()=>({async getConnectionCredentials(link){credentials++;assert.equal(link,'synthetic_sender');return {parameters:{},headers:{Authorization:'Zoho-oauthtoken '+'s'.repeat(24)}};}})};}},
  factories:{store:blocked,crm:blocked,provider:blocked,reportDelivery:blocked,senderQualification:createProtectedSenderQualification({environment:env,now:()=>at,
   fetchImpl:async()=>{gets++;return new Response(JSON.stringify({from_addresses:[{email:b.fromAddress,user_name:b.fromName,type:'org_email',id:'123456789'}]}),{headers:{'content-type':'application/json'}});}})}});
 const headers={host:config.controlHost,'x-zc-environment':'development','x-zc-projectid':PROJECT_ID,'x-synthetic-control':'h'.repeat(32),'content-type':'application/json'};
 const body=Buffer.from(JSON.stringify({profile:'report_sender_qualification_v1',action:'qualify_sender'}));
 for(const change of [{headers:{...headers,'x-synthetic-control':'invalid'}},{headers:{...headers,'x-zc-environment':'production'}},{url:'/internal/revenue-desk/activate-free-test'}]){
  const output=response();await listener({method:'POST',url:'/internal/revenue-desk/approve-configuration',headers,rawBody:body,...change},output);assert.notEqual(output.statusCode,200);}
 assert.equal(credentials,0);assert.equal(gets,0);
 const output=response();await listener({method:'POST',url:'/internal/revenue-desk/approve-configuration',headers,rawBody:body},output);
 assert.equal(output.statusCode,200);assert.equal(output.body.result.status,'sender_allowed');assert.equal(credentials,1);assert.equal(gets,1);
});

test('storage qualification authenticates before diagnostic and never constructs customer effects', async()=>{
 const env=environment(),config=loadConfig(env,REVISION);let calls=0;
 const blocked=()=>assert.fail('Customer storage/CRM/Retell factory prohibited');
 const listener=createRequestListener({environment:env,artifactSourceRevision:REVISION,
 catalystSdk:{initialize(){return {config:{environment:'development',projectId:PROJECT_ID}};}},
 factories:{store:blocked,crm:blocked,provider:blocked,reportDelivery:blocked,
 storageQualification:()=>({async handle(body,context){calls++;assert.equal(body.action,'qualify_storage');assert.equal(context.actor.kind,'internal_controller');assert.equal(context.actor.identity,config.operatorIdHash);return {status:'synthetic_observation'};}})}});
 const headers={host:config.controlHost,'x-zc-environment':'development','x-zc-projectid':PROJECT_ID,'x-synthetic-control':'h'.repeat(32),'content-type':'application/json'};
 const rawBody=Buffer.from(JSON.stringify({profile:'report_storage_qualification_v1',action:'qualify_storage'}));
 for(const change of [{headers:{...headers,'x-synthetic-control':'invalid'}},{headers:{...headers,'x-zc-environment':'production'}},{url:'/internal/revenue-desk/activate-free-test'}]){
 const out=response();await listener({method:'POST',url:'/internal/revenue-desk/approve-configuration',headers,rawBody,...change},out);assert.notEqual(out.statusCode,200);}
 assert.equal(calls,0);const out=response();await listener({method:'POST',url:'/internal/revenue-desk/approve-configuration',headers,rawBody},out);assert.equal(out.statusCode,200);assert.equal(calls,1);
});

test('protected inventory composes in actual Controller config while provider execution stays disabled', () => {
  const env = environment({RETELL_TEST_PHONE_NUMBER:SYNTHETIC_TEST_PHONE}), baseline = loadConfig(env, REVISION);
  const document = {schemaVersion:1,environment:'development',sourceRevision:REVISION,
    operatorIdHash:baseline.operatorIdHash,approvalSha256:'9'.repeat(64),assignments:[{
      dealId:'900000001',journeyId:'synthetic_inventory_journey',clientId:'synthetic_inventory_client',
      deploymentId:'synthetic_inventory_deployment',phoneNumber:'+19135550901'}]};
  const raw=JSON.stringify(document), pin=crypto.createHash('sha256').update(raw).digest('hex');
  const config=loadConfig({...env,RETELL_NUMBER_ASSIGNMENT_MODE:'approved_inventory',
    RETELL_NUMBER_INVENTORY_JSON:raw,RETELL_NUMBER_INVENTORY_SHA256:pin},REVISION);
  assert.equal(config.retellRouteMode,'disabled');assert.equal(config.numberAssignmentMode,'approved_inventory');
  assert.equal(config.approvedTestNumbers.length,1);
  assert.throws(()=>loadConfig({...env,RETELL_NUMBER_ASSIGNMENT_MODE:'approved_inventory',
    RETELL_NUMBER_INVENTORY_JSON:raw,RETELL_NUMBER_INVENTORY_SHA256:'0'.repeat(64)},REVISION),
    {code:'INVALID_TEST_NUMBER_INVENTORY'});
});


test('runtime context stays authenticated, disabled and before SDK/stores/providers', async () => {
  const { createProtectedRuntimeContext } = require('../lib/report-runtime-context');
  const env = environment(); let sdk = 0;
  const listener = createRequestListener({ environment: env, artifactSourceRevision: REVISION,
    catalystSdk: { initialize() { sdk++; throw Error('SDK must not initialize while disabled'); } },
    factories: { runtimeContext: createProtectedRuntimeContext({ environment: env }),
      store() { assert.fail('store'); }, crm() { assert.fail('CRM'); }, provider() { assert.fail('provider'); } } });
  const request = { method: 'POST', url: '/internal/revenue-desk/approve-configuration',
    headers: { host: env.ROUTE_CONTROL_HOST, 'x-zc-environment': 'development',
      'x-zc-projectid': PROJECT_ID, 'x-synthetic-control': env.ROUTE_CONTROL_SHARED_HEADER_VALUE,
      'content-type': 'application/json' },
    body: JSON.stringify({ profile: 'report_runtime_context_v1', action: 'inspect_context' }) };
  const output = response(); await listener(request, output);
  assert.equal(output.statusCode, 200); assert.equal(output.body.result.binding_valid, false); assert.equal(sdk, 0);
  delete request.headers['x-synthetic-control']; const denied = response(); await listener(request, denied);
  assert.equal(denied.statusCode, 401); assert.equal(sdk, 0);
});

test('context command cannot bypass control headers, host, project, environment or route', async () => {
  const env = environment(); let inspections = 0;
  const listener = createRequestListener({ environment: env, artifactSourceRevision: REVISION,
    catalystSdk: { initialize() { assert.fail('SDK'); } },
    factories: { runtimeContext() { inspections++; assert.fail('inspection'); },
      store() { assert.fail('store'); }, crm() { assert.fail('CRM'); }, provider() { assert.fail('provider'); } } });
  for (const variant of ['header', 'host', 'project', 'environment', 'route', 'body']) {
    const request = { method: 'POST', url: '/internal/revenue-desk/approve-configuration',
      headers: { host: env.ROUTE_CONTROL_HOST, 'x-zc-environment': 'development',
        'x-zc-projectid': PROJECT_ID, 'x-synthetic-control': env.ROUTE_CONTROL_SHARED_HEADER_VALUE,
        'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'report_runtime_context_v1', action: 'inspect_context' }) };
    if (variant === 'header') request.headers['x-synthetic-control'] = 'wrong';
    if (variant === 'host') request.headers.host = 'wrong.invalid';
    if (variant === 'project') request.headers['x-zc-projectid'] = '999999999';
    if (variant === 'environment') request.headers['x-zc-environment'] = 'production';
    if (variant === 'route') request.url = '/internal/revenue-desk/activate-free-test';
    if (variant === 'body') request.headers['content-type'] = 'text/plain';
    const output = response(); await listener(request, output);
    assert.ok(output.statusCode >= 400); assert.equal(output.body.result, undefined);
  }
  assert.equal(inspections, 0);
});

test('route adapter deadlines cover authorization and stalled headers without late dispatch', async () => {
 for(const stage of ['authorization','headers']){
  const config={...isolatedConfig(),platformTimeoutMs:20};let requests=0,signal,release;
  const pending=new Promise(resolve=>{release=resolve;});
  const provider=createRetellRouteProvider(config,{authorization:stage==='authorization'?()=>pending:async()=> 'Bearer synthetic',
   fetchImpl:async(_url,options)=>{requests++;signal=options.signal;return pending;}});
  const started=performance.now();await assert.rejects(provider.verifyActiveRoute(routeBinding(config)),error=>
   error.code==='RETELL_ROUTE_REQUEST_FAILED'&&error.retryable===true&&error.ambiguous===false);
  assert.ok(performance.now()-started<500);assert.equal(requests,stage==='headers'?1:0);if(signal)assert.equal(signal.aborted,true);
  let cancelled=0;release(stage==='authorization'?'Bearer synthetic':new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}}));
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(requests,stage==='headers'?1:0);if(stage==='headers')assert.equal(cancelled,1);
 }
});

test('route adapter cancels stalled body reads and ignores late body completion',async()=>{
 const config={...isolatedConfig(),platformTimeoutMs:20};let requests=0,cancels=0,signal,release;
 const body={getReader(){return {read:()=>new Promise(resolve=>{release=resolve;}),cancel(){cancels++;return new Promise(()=>{});}};}};
 const provider=createRetellRouteProvider(config,{authorization:async()=> 'Bearer synthetic',fetchImpl:async(_url,options)=>{
  requests++;signal=options.signal;return {status:200,headers:new Headers({'content-type':'application/json'}),body};}});
 await assert.rejects(provider.verifyActiveRoute(routeBinding(config)),{code:'RETELL_ROUTE_REQUEST_FAILED'});
 assert.equal(signal.aborted,true);assert.ok(cancels>=1);assert.equal(requests,1);
 release({done:false,value:Buffer.from(JSON.stringify(activePhone(config)))});await new Promise(resolve=>setTimeout(resolve,5));assert.equal(requests,1);
});

test('route adapter bounds declared and actual bytes, chunk count, JSON and UTF8 before accepting evidence',async()=>{
 const config=isolatedConfig();
 const responses=[()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'262145'}}),
  ()=>new Response(Buffer.alloc(262145,32),{headers:{'content-type':'application/json'}}),
  ()=>new Response('{bad',{headers:{'content-type':'application/json'}}),
  ()=>new Response(Buffer.from([255]),{headers:{'content-type':'application/json'}}),
  ()=>new Response('{}',{headers:{'content-type':'text/plain'}}),
  ()=>new Response('{}',{headers:{'content-type':'application/json','content-encoding':'gzip'}}),
  ()=>({status:200,headers:new Headers({'content-type':'application/json'}),body:{getReader(){return {async read(){return {done:false,value:Buffer.alloc(0)};},async cancel(){}};}}})];
 for(const response of responses){let requests=0;const provider=createRetellRouteProvider(config,{authorization:async()=> 'Bearer synthetic',fetchImpl:async()=>{requests++;return response();}});
  await assert.rejects(provider.verifyActiveRoute(routeBinding(config)),{code:'RETELL_ROUTE_REQUEST_FAILED'});assert.equal(requests,1);
 }
});

test('route adapter rejects redirects and malformed GET evidence without retry or route mutation',async()=>{
 const config=isolatedConfig();let requests=0;
 const provider=createRetellRouteProvider(config,{authorization:async()=> 'Bearer synthetic',fetchImpl:async(_url,options)=>{
  requests++;assert.equal(options.redirect,'error');assert.equal(options.headers['Accept-Encoding'],'identity');throw Error('synthetic redirect rejected');}});
 await assert.rejects(provider.verifyActiveRoute(routeBinding(config)),error=>error.code==='RETELL_ROUTE_REQUEST_FAILED'&&error.retryable===true&&error.ambiguous===false);assert.equal(requests,1);
});

test('unknown PATCH headers or body stays manual with one dispatch and no later readback',async()=>{
 for(const stage of ['headers','body']){
  const config={...isolatedConfig(),platformTimeoutMs:20};let gets=0,patches=0,signal;
  const provider=createRetellRouteProvider(config,{authorization:async()=> 'Bearer synthetic',fetchImpl:async(_url,options)=>{
   assert.equal(options.redirect,'error');if(options.method==='GET'){gets++;return new Response(JSON.stringify(activePhone(config)),{headers:{'content-type':'application/json'}});}
   patches++;signal=options.signal;if(stage==='headers')return new Promise(()=>{});
   return new Response(new ReadableStream({pull(){return new Promise(()=>{});}}),{headers:{'content-type':'application/json'}});
  }});
  const result=await provider.disableRoute(routeBinding(config));assert.equal(result.status,'manual_rollback_required');assert.equal(result.failureCode,'RETELL_ROUTE_REQUEST_FAILED');
  assert.equal(patches,1);assert.equal(gets,1);assert.equal(signal.aborted,true);
 }
});

test('successful PATCH with null or array JSON remains unknown and never retries',async()=>{
 for(const payload of ['null','[]']){
  const config=isolatedConfig();let gets=0,patches=0;
  const provider=createRetellRouteProvider(config,{authorization:async()=> 'Bearer synthetic',fetchImpl:async(_url,options)=>{
   if(options.method==='GET'){gets++;return new Response(JSON.stringify(activePhone(config)),{headers:{'content-type':'application/json'}});}
   patches++;return new Response(payload,{headers:{'content-type':'application/json'}});
  }});
  const result=await provider.disableRoute(routeBinding(config));
  assert.equal(result.status,'manual_rollback_required');assert.equal(result.failureCode,'RETELL_ROUTE_REQUEST_FAILED');
  assert.equal(gets,1);assert.equal(patches,1);
 }
});

function storageFailureFixture({ initialize, binding, handler, failureLogger } = {}) {
  const env = environment(), config = loadConfig(env, REVISION), logs = [];
  const blocked = () => assert.fail('No customer stores, CRM writers or providers');
  const listener = createRequestListener({ environment: env, artifactSourceRevision: REVISION,
    failureLogger: failureLogger || (record => logs.push(record)),
    catalystSdk: { initialize: initialize || (() => ({ config: { environment: 'Development', projectId: PROJECT_ID } })) },
    factories: { store: blocked, crm: blocked, provider: blocked, reportDelivery: blocked,
      storageQualification: binding || (() => ({ handle: handler || (async () => ({ status: 'synthetic_observation' })) })) } });
  const request = { method: 'POST', url: '/internal/revenue-desk/approve-configuration',
    headers: { host: config.controlHost, 'x-zc-environment': 'development', 'x-zc-projectid': PROJECT_ID,
      'x-synthetic-control': env.ROUTE_CONTROL_SHARED_HEADER_VALUE, 'content-type': 'application/json' },
    rawBody: Buffer.from(JSON.stringify({ profile: 'report_storage_qualification_v1', action: 'qualify_storage' })) };
  return { listener, request, logs };
}
const storageFailure = code => Object.assign(new Error('SYNTHETIC_PRIVATE_MESSAGE'), { code,
  value: { token: 'SYNTHETIC_PRIVATE_TOKEN' }, privateHeader: 'SYNTHETIC_PRIVATE_HEADER' });
for (const [stage, options, expectedStatus, expectedCode] of [
  ['sdk_initialize', { initialize() { throw storageFailure('app/invalid_project_details'); } }, 500, 'app/invalid_project_details'],
  ['runtime_identity', { initialize() { return { config: { environment: 'Production', projectId: PROJECT_ID } }; } }, 503, 'CONTROL_AUTHENTICATION_FAILED'],
  ['storage_binding', { binding() { throw storageFailure('REPORT_STORAGE_QUALIFICATION_HELD'); } }, 500, 'REPORT_STORAGE_QUALIFICATION_HELD'],
  ['storage_handler', { handler: async () => { throw storageFailure('REPORT_STORAGE_QUALIFICATION_HELD'); } }, 500, 'REPORT_STORAGE_QUALIFICATION_HELD'],
]) test('fixed storage failure observation at ' + stage + ' preserves public response', async () => {
  const f = storageFailureFixture(options), output = response(); await f.listener(f.request, output);
  assert.equal(output.statusCode, expectedStatus);
  assert.deepEqual(output.body, { ok: false, code: expectedStatus === 503 ? 'control_authentication_failed' : 'control_failed' });
  assert.deepEqual(f.logs, [{ stage, code: expectedCode }]);
  assert.deepEqual(Object.keys(f.logs[0]).sort(), ['code', 'stage']);
  assert.equal(Object.isFrozen(f.logs[0]), true);
  assert.equal(JSON.stringify({ logs: f.logs, output: output.body }).includes('SYNTHETIC_PRIVATE'), false);
});
for (const code of ['auth/invalid_credential', 'MODULE_NOT_FOUND', 'app/invalid_app_object'])
  test('SDK fixed code allowlist preserves ' + code, async () => {
    const f = storageFailureFixture({ initialize() { throw storageFailure(code); } }), output = response();
    await f.listener(f.request, output); assert.equal(output.statusCode, 500);
    assert.deepEqual(output.body, { ok: false, code: 'control_failed' });
    assert.deepEqual(f.logs, [{ stage: 'sdk_initialize', code }]);
  });
for (const code of ['SYNTHETIC_PRIVATE_CODE', undefined, { raw: 'SYNTHETIC_PRIVATE_TOKEN' }])
  test('unknown storage error code remains fixed unknown ' + typeof code, async () => {
    const f = storageFailureFixture({ binding() { throw storageFailure(code); } }), output = response();
    await f.listener(f.request, output); assert.deepEqual(f.logs, [{ stage: 'storage_binding', code: 'unknown' }]);
    assert.deepEqual(output.body, { ok: false, code: 'control_failed' });
    assert.equal(JSON.stringify(f.logs).includes('SYNTHETIC_PRIVATE'), false);
  });
test('storage logger failure cannot change diagnostic HTTP result or retry handler', async () => {
  let calls = 0, logCalls = 0;
  const f = storageFailureFixture({ handler: async () => { calls++; throw storageFailure('REPORT_STORAGE_QUALIFICATION_HELD'); },
    failureLogger() { logCalls++; throw Error('SYNTHETIC_PRIVATE_LOGGER_ERROR'); } }), output = response();
  await f.listener(f.request, output); assert.equal(calls, 1); assert.equal(logCalls, 1);
  assert.equal(output.statusCode, 500); assert.deepEqual(output.body, { ok: false, code: 'control_failed' });
});
test('asynchronous storage logger rejection is contained without delaying or changing HTTP result', async () => {
  let calls = 0, logCalls = 0;
  const f = storageFailureFixture({ handler: async () => { calls++; throw storageFailure('REPORT_STORAGE_QUALIFICATION_HELD'); },
    async failureLogger() { logCalls++; throw Error('SYNTHETIC_PRIVATE_ASYNC_LOGGER_ERROR'); } }), output = response();
  await f.listener(f.request, output);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(logCalls, 1);
  assert.equal(output.statusCode, 500); assert.deepEqual(output.body, { ok: false, code: 'control_failed' });
});
test('storage success produces no failure observation', async () => {
  const f = storageFailureFixture(), output = response(); await f.listener(f.request, output);
  assert.equal(output.statusCode, 200); assert.deepEqual(output.body, { ok: true, action: 'qualify_storage', result: { status: 'synthetic_observation' } });
  assert.deepEqual(f.logs, []);
});
test('storage response failure after successful handler is not mislabelled as handler failure', async () => {
  const f = storageFailureFixture(), output = response(), normalEnd = output.end; let sends = 0;
  output.end = function(value) { if (++sends === 1) throw Error('SYNTHETIC_PRIVATE_RESPONSE_FAILURE'); normalEnd.call(this, value); };
  await f.listener(f.request, output); assert.equal(output.statusCode, 500);
  assert.deepEqual(output.body, { ok: false, code: 'control_failed' }); assert.deepEqual(f.logs, []);
});
test('storage handler failure keeps accepted effects unknown and never retries', async () => {
  let acceptedEffects = 0;
  const f = storageFailureFixture({ handler: async () => { acceptedEffects++; throw storageFailure('REPORT_STORAGE_QUALIFICATION_HELD'); } }), output = response();
  await f.listener(f.request, output); assert.equal(acceptedEffects, 1);
  assert.deepEqual(f.logs, [{ stage: 'storage_handler', code: 'REPORT_STORAGE_QUALIFICATION_HELD' }]);
  assert.deepEqual(Object.keys(f.logs[0]).sort(), ['code', 'stage']);
  assert.deepEqual(output.body, { ok: false, code: 'control_failed' });
});
test('auth body and wrong control route failures produce no storage diagnostic observation', async () => {
  for (const variant of ['auth', 'body', 'route']) {
    let calls = 0;
    const f = storageFailureFixture({ initialize() { calls++; throw Error('Must not reach tracked SDK initialization'); } }), output = response();
    if (variant === 'auth') f.request.headers['x-synthetic-control'] = 'invalid';
    if (variant === 'body') f.request.headers['content-type'] = 'text/plain';
    if (variant === 'route') f.request.url = '/internal/revenue-desk/activate-free-test';
    await f.listener(f.request, output); assert.deepEqual(f.logs, []);
    assert.equal(output.statusCode, variant === 'auth' ? 401 : variant === 'body' ? 415 : 500);
    assert.equal(calls, variant === 'route' ? 1 : 0);
  }
});
test('nonstorage SDK failure produces no storage observation', async () => {
  const f = storageFailureFixture({ initialize() { throw storageFailure('auth/invalid_credential'); } }), output = response();
  f.request.rawBody = Buffer.from(JSON.stringify({ profile: 'report_sender_qualification_v1', action: 'qualify_sender' }));
  await f.listener(f.request, output); assert.equal(output.statusCode, 500);
  assert.deepEqual(output.body, { ok: false, code: 'control_failed' }); assert.deepEqual(f.logs, []);
});

test('storage precondition allowlist preserves existing503 response', async () => {
  const f = storageFailureFixture({ binding() { throw new RevenueDeskError('CONTROL_PRECONDITION_FAILED', 'SYNTHETIC_PRIVATE_MESSAGE', { httpStatus: 503 }); } }), output = response();
  await f.listener(f.request, output); assert.equal(output.statusCode, 503);
  assert.deepEqual(output.body, { ok: false, code: 'control_precondition_failed' });
  assert.deepEqual(f.logs, [{ stage: 'storage_binding', code: 'CONTROL_PRECONDITION_FAILED' }]);
});
for (const [missing, stage, code] of [
  ['x-zc-project-key', 'sdk_initialize', 'app/invalid_project_details'],
  ['x-zc-admin-cred-type', 'sdk_initialize', 'auth/invalid_credential'],
  ['x-zc-user-type', 'storage_binding', 'REPORT_STORAGE_QUALIFICATION_HELD'],
  ['x-zc-user-cred-type', 'storage_handler', 'auth/invalid_credential'],
]) test('actual SDK fake header boundary observes ' + missing + ' without provider dispatch', async () => {
  const sdk = require('zcatalyst-sdk-node');
  const f = storageFailureFixture({ initialize(request) {
    const headers = { ...request.headers, 'x-zc-project-key': 'synthetic-project-key',
      'x-zc-admin-cred-type': 'token', 'x-zc-admin-cred-token': 'synthetic-admin-token',
      'x-zc-user-cred-type': 'token', 'x-zc-user-cred-token': 'synthetic-user-token', 'x-zc-user-type': 'admin' };
    delete headers[missing]; return sdk.initialize({ headers });
  }, binding(app) {
    if (app.credential.getCurrentUser() !== 'user' || app.credential.getCurrentUserType() !== 'admin')
      throw storageFailure('REPORT_STORAGE_QUALIFICATION_HELD');
    return { async handle() { await app.authenticateRequest({ headers: {} }); assert.fail('Missing synthetic credential type must reject'); } };
  } }), output = response();
  await f.listener(f.request, output); assert.equal(output.statusCode, 500);
  assert.deepEqual(output.body, { ok: false, code: 'control_failed' }); assert.deepEqual(f.logs, [{ stage, code }]);
  assert.equal(JSON.stringify(f.logs).includes('synthetic-'), false);
});
