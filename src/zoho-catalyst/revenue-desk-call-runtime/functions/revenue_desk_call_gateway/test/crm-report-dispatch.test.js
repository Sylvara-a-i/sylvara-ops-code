'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCrmReportDispatcher } = require('../lib/crm-report-dispatch');
const { loadJobConfig } = require('../lib/config');
const { environment, SOURCE_REVISION } = require('./runtime-fixture');

const OPERATION_KEY = 'a'.repeat(64);
const config = (overrides = {}) => ({
  environment: 'development',
  crmBillingOrchestratorUrl:
    'https://example-development.catalystserverless.com/server/crm_billing_orchestrator/lifecycle',
  crmBillingApiGatewayKey: 'gateway-secret-value',
  crmBillingSharedHeaderName: 'x-sylvara-report-auth',
  crmBillingSharedHeaderValue: 'report-secret-value',
  crmBillingDispatchTimeoutMs: 100,
  ...overrides,
});

function successResponse() {
  return new Response(JSON.stringify({
    ok: true,
    action: 'sync_report_summary',
    outcome: 'report_summary_readback_confirmed',
    duplicate: false,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('dispatcher sends only the exact operation binding with both caller credentials', async () => {
  let request;
  const dispatcher = createCrmReportDispatcher(config(), async (url, options) => {
    request = { url, options };
    return successResponse();
  });
  assert.deepEqual(await dispatcher.dispatch('100000000000001', OPERATION_KEY), {
    status: 'Dispatched', duplicate: false,
  });
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.ZCFKEY, 'gateway-secret-value');
  assert.equal(request.options.headers['x-sylvara-report-auth'], 'report-secret-value');
  assert.deepEqual(JSON.parse(request.options.body), {
    schemaVersion: 'crm-billing-lifecycle-v2', action: 'sync_report_summary',
    dealId: '100000000000001', operationKey: OPERATION_KEY,
  });
});

test('dispatcher rejects invalid media types and oversized chunked bodies', async () => {
  const wrongType = createCrmReportDispatcher(config(), async () => new Response('{}', {
    status: 200, headers: { 'content-type': 'text/plain' },
  }));
  await assert.rejects(() => wrongType.dispatch('100000000000001', OPERATION_KEY),
    (error) => error.code === 'CRM_REPORT_DISPATCH_INVALID' && error.ambiguous === true);

  const oversized = createCrmReportDispatcher(config(), async () => new Response(
    new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(4097));
      controller.close();
    } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ));
  await assert.rejects(() => oversized.dispatch('100000000000001', OPERATION_KEY),
    (error) => error.code === 'CRM_REPORT_DISPATCH_INVALID' && error.ambiguous === true);
});

test('dispatcher timeout covers a response body that never completes', async () => {
  let aborted = false;
  const dispatcher = createCrmReportDispatcher(config({ crmBillingDispatchTimeoutMs: 20 }),
    async (_url, options) => {
      options.signal.addEventListener('abort', () => { aborted = true; });
      return new Response(new ReadableStream({ start() {} }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
  await assert.rejects(() => dispatcher.dispatch('100000000000001', OPERATION_KEY),
    (error) => error.code === 'CRM_REPORT_DISPATCH_UNAVAILABLE'
      && error.retryable === true && error.ambiguous === true);
  assert.equal(aborted, true);
});

test('dispatcher fails before I/O when the operation binding is absent', async () => {
  let called = false;
  const dispatcher = createCrmReportDispatcher(config(), async () => {
    called = true;
    return successResponse();
  });
  await assert.rejects(() => dispatcher.dispatch('100000000000001'),
    (error) => error.code === 'REPORT_DATA_INVALID');
  assert.equal(called, false);
});

// Synthetic credentials only. No Connection is read by these tests.
const SYNTHETIC_OAUTH = `Zoho-oauthtoken ${'o'.repeat(32)}`;
const oauthConfig = (overrides = {}) => config({
  crmBillingAuthMode: 'oauth', crmBillingApiGatewayKey: null,
  crmBillingConnectionLinkName: 'synthetic_report_oauth', ...overrides,
});
const connectionApp = (read) => ({ connections: () => ({ getConnectionCredentials: read }) });

test('OAuth dispatch preserves report authorization and payload, never sending ZCFKEY', async () => {
  let reads = 0; let sends = 0;
  const dispatcher = createCrmReportDispatcher(oauthConfig(), async (_url, request) => {
    sends += 1;
    assert.deepEqual(request.headers, { Accept: 'application/json', 'Content-Type': 'application/json',
      Authorization: SYNTHETIC_OAUTH, 'ZC-OAUTH-USER': 'ADMIN',
      'x-sylvara-report-auth': 'report-secret-value' });
    assert.equal(request.redirect, 'error');
    assert.deepEqual(JSON.parse(request.body), { schemaVersion: 'crm-billing-lifecycle-v2',
      action: 'sync_report_summary', dealId: '100000000000001', operationKey: OPERATION_KEY });
    return successResponse();
  }, connectionApp(async (alias) => {
    reads += 1; assert.equal(alias, 'synthetic_report_oauth');
    return { headers: { authorization: SYNTHETIC_OAUTH }, parameters: {} };
  }));
  assert.equal((await dispatcher.dispatch('100000000000001', OPERATION_KEY)).status, 'Dispatched');
  assert.equal(reads, 1); assert.equal(sends, 1);
});

test('OAuth invalid operation performs neither a credential read nor a report request', async () => {
  let reads = 0; let sends = 0;
  const dispatcher = createCrmReportDispatcher(oauthConfig(), async () => { sends += 1; },
    connectionApp(async () => { reads += 1; }));
  await assert.rejects(dispatcher.dispatch('100000000000001'), { code: 'REPORT_DATA_INVALID' });
  assert.equal(reads, 0); assert.equal(sends, 0);
});

test('OAuth refuses credential shape, extra authentication and header injection before POST', async () => {
  for (const credentials of [null, {}, { headers: {}, parameters: {} },
    { headers: { Authorization: SYNTHETIC_OAUTH }, parameters: { access_token: 'synthetic-secret-value' } },
    { headers: { Authorization: SYNTHETIC_OAUTH, ZCFKEY: 'synthetic' }, parameters: {} },
    { headers: { Authorization: SYNTHETIC_OAUTH, authorization: SYNTHETIC_OAUTH }, parameters: {} },
    { headers: { Authorization: `Bearer ${'o'.repeat(32)}` }, parameters: {} },
    { headers: { Authorization: `${SYNTHETIC_OAUTH}\r\nZCFKEY: injected` }, parameters: {} },
    { headers: { Authorization: SYNTHETIC_OAUTH }, parameters: [] },
    { headers: { Authorization: 'Zoho-oauthtoken short' }, parameters: {} },
  ]) {
    let sends = 0;
    const dispatcher = createCrmReportDispatcher(oauthConfig(), async () => { sends += 1; },
      connectionApp(async () => credentials));
    await assert.rejects(dispatcher.dispatch('100000000000001', OPERATION_KEY),
      (error) => error.code === 'INVALID_RUNTIME_CONFIGURATION' && !error.ambiguous);
    assert.equal(sends, 0);
  }
});

test('OAuth credential failure is sanitized, does not resend and does not fall back', async () => {
  let reads = 0; let sends = 0;
  const dispatcher = createCrmReportDispatcher(oauthConfig(), async () => { sends += 1; },
    connectionApp(async () => { reads += 1; throw new Error(`private ${SYNTHETIC_OAUTH}`); }));
  await assert.rejects(dispatcher.dispatch('100000000000001', OPERATION_KEY), (error) => {
    assert.equal(error.code, 'CRM_REPORT_DISPATCH_UNAVAILABLE');
    assert.equal(error.ambiguous, false); assert.equal(error.cause, undefined);
    assert.equal(JSON.stringify(error).includes(SYNTHETIC_OAUTH), false);
    assert.equal(error.message.includes(SYNTHETIC_OAUTH), false);
    return true;
  });
  assert.equal(reads, 1); assert.equal(sends, 0);
});

test('OAuth acquisition timeout cannot trigger a late report POST', async () => {
  let release; let reads = 0; let sends = 0;
  const dispatcher = createCrmReportDispatcher(oauthConfig({ crmBillingDispatchTimeoutMs: 20 }),
    async () => { sends += 1; return successResponse(); }, connectionApp(() => {
      reads += 1; return new Promise((resolve) => { release = resolve; });
    }));
  await assert.rejects(dispatcher.dispatch('100000000000001', OPERATION_KEY),
    (error) => error.code === 'CRM_REPORT_DISPATCH_UNAVAILABLE' && !error.ambiguous);
  release({ headers: { Authorization: SYNTHETIC_OAUTH }, parameters: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads, 1); assert.equal(sends, 0);
});

test('OAuth HTTP rejection or ambiguous transport never retries or reveals credential causes', async () => {
  for (const reply of [
    () => new Response('{"error":"unauthorized"}', { status: 401,
      headers: { 'content-type': 'application/json' } }),
    () => { throw new Error(`transport private ${SYNTHETIC_OAUTH}`); },
  ]) {
    let reads = 0; let sends = 0;
    const dispatcher = createCrmReportDispatcher(oauthConfig(), async () => { sends += 1; return reply(); },
      connectionApp(async () => { reads += 1;
        return { headers: { Authorization: SYNTHETIC_OAUTH }, parameters: {} }; }));
    await assert.rejects(dispatcher.dispatch('100000000000001', OPERATION_KEY), (error) => {
      assert.equal(error.ambiguous, true); assert.equal(error.cause, undefined);
      assert.equal(JSON.stringify(error).includes(SYNTHETIC_OAUTH), false); return true;
    });
    assert.equal(reads, 1); assert.equal(sends, 1);
  }
});

test('OAuth requires SDK capability and never sends when credential acquisition is unavailable', async () => {
  let sends = 0;
  const fetchImpl = async () => { sends += 1; return successResponse(); };
  for (const app of [null, {}, { connections: null }]) {
    assert.throws(() => createCrmReportDispatcher(oauthConfig(), fetchImpl, app),
      { code: 'INVALID_RUNTIME_CONFIGURATION' });
  }
  const dispatcher = createCrmReportDispatcher(oauthConfig(), fetchImpl, { connections: () => ({}) });
  await assert.rejects(dispatcher.dispatch('100000000000001', OPERATION_KEY),
    (error) => error.code === 'CRM_REPORT_DISPATCH_UNAVAILABLE' && !error.ambiguous);
  assert.equal(sends, 0);
});

test('OAuth obtains fresh managed credentials for each distinct dispatch', async () => {
  let reads = 0; const observed = [];
  const dispatcher = createCrmReportDispatcher(oauthConfig(), async (_url, request) => {
    observed.push(request.headers.Authorization); return successResponse();
  }, connectionApp(async () => {
    reads += 1;
    return { headers: { Authorization: `Zoho-oauthtoken ${String(reads).repeat(32)}` }, parameters: {} };
  }));
  await dispatcher.dispatch('100000000000001', OPERATION_KEY);
  await dispatcher.dispatch('100000000000001', 'b'.repeat(64));
  assert.equal(reads, 2); assert.equal(observed.length, 2);
  assert.notEqual(observed[0], observed[1]);
});

test('OAuth request and response timeouts after acquisition are ambiguous without retry', async () => {
  for (const phase of ['request', 'response']) {
    let reads = 0; let sends = 0; let aborted = false;
    const dispatcher = createCrmReportDispatcher(oauthConfig({ crmBillingDispatchTimeoutMs: 20 }),
      async (_url, request) => {
        sends += 1;
        request.signal.addEventListener('abort', () => { aborted = true; });
        if (phase === 'request') return new Promise(() => {});
        return new Response(new ReadableStream({ start() {} }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }, connectionApp(async () => {
        reads += 1; return { headers: { Authorization: SYNTHETIC_OAUTH }, parameters: {} };
      }));
    await assert.rejects(dispatcher.dispatch('100000000000001', OPERATION_KEY),
      (error) => error.code === 'CRM_REPORT_DISPATCH_UNAVAILABLE' && error.ambiguous);
    assert.equal(reads, 1); assert.equal(sends, 1); assert.equal(aborted, true);
  }
});

test('OAuth late credential rejection stays handled and cannot leak or start a request', async () => {
  let rejectRead; let sends = 0;
  const dispatcher = createCrmReportDispatcher(oauthConfig({ crmBillingDispatchTimeoutMs: 20 }),
    async () => { sends += 1; }, connectionApp(() => new Promise((_resolve, reject) => {
      rejectRead = reject;
    })));
  await assert.rejects(dispatcher.dispatch('100000000000001', OPERATION_KEY), (error) => {
    assert.equal(error.code, 'CRM_REPORT_DISPATCH_UNAVAILABLE');
    assert.equal(error.ambiguous, false); assert.equal(error.cause, undefined);
    return true;
  });
  rejectRead(new Error(`private ${SYNTHETIC_OAUTH}`));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sends, 0);
});

test('configuration selects exactly one transport and requires the independent report credential', () => {
  const read = (env) => loadJobConfig(env, { artifactSourceRevision: SOURCE_REVISION });
  const previous = read(environment());
  assert.equal(previous.crmBillingAuthMode, 'api_key');
  assert.equal(previous.crmBillingConnectionLinkName, null);
  const oauth = environment({ CRM_BILLING_AUTH_MODE: 'oauth',
    CRM_BILLING_CONNECTION_LINK_NAME: 'synthetic_report_oauth' });
  delete oauth.CRM_BILLING_API_GATEWAY_KEY;
  const selected = read(oauth);
  assert.equal(selected.crmBillingAuthMode, 'oauth');
  assert.equal(selected.crmBillingApiGatewayKey, null);
  assert.equal(selected.crmBillingSharedHeaderValue, previous.crmBillingSharedHeaderValue);
  for (const env of [
    { ...oauth, CRM_BILLING_API_GATEWAY_KEY: 'synthetic-secret-value' },
    { ...oauth, CRM_BILLING_API_GATEWAY_KEY: undefined },
    { ...oauth, CRM_BILLING_API_GATEWAY_KEY: '' },
    { ...oauth, CRM_BILLING_CONNECTION_LINK_NAME: undefined },
    { ...oauth, CRM_BILLING_CONNECTION_LINK_NAME: 'invalid\r\nname' },
    { ...oauth, CRM_BILLING_SHARED_HEADER_VALUE: undefined },
    { ...oauth, CRM_BILLING_AUTH_MODE: 'automatic' },
    { ...oauth, CRM_BILLING_AUTH_MODE: '' },
    environment({ CRM_BILLING_CONNECTION_LINK_NAME: 'ambiguous_dual_binding' }),
  ]) assert.throws(() => read(env), { code: 'INVALID_RUNTIME_CONFIGURATION' });
});

test('worker default factory passes its SDK app into OAuth report dispatch', async (t) => {
  const { createWorkerJobHandler } = require('../lib/job-handler');
  const env = environment({ CRM_BILLING_AUTH_MODE: 'oauth',
    CRM_BILLING_CONNECTION_LINK_NAME: 'synthetic_report_oauth' });
  delete env.CRM_BILLING_API_GATEWAY_KEY;
  let reads = 0; let sends = 0;
  t.mock.method(globalThis, 'fetch', async (_url, request) => {
    sends += 1; assert.equal(request.headers.Authorization, SYNTHETIC_OAUTH);
    assert.equal(Object.hasOwn(request.headers, 'ZCFKEY'), false);
    return successResponse();
  });
  const handler = createWorkerJobHandler({ environment: env, artifactSourceRevision: SOURCE_REVISION,
    catalystSdk: { initialize: () => connectionApp(async () => { reads += 1;
      return { headers: { Authorization: SYNTHETIC_OAUTH }, parameters: {} }; }) },
    storeFactory: () => ({}), mailFactory: () => ({}),
    serviceFactory: ({ crmSummaryDispatcher }) => ({
      rebuildReport: () => crmSummaryDispatcher.dispatch('100000000000001', OPERATION_KEY),
    }),
  });
  const result = await handler({ getProjectDetails: () => ({ id: env.REVENUE_DESK_PROJECT_ID }),
    getJobPoolDetails: () => ({ id: env.REVENUE_DESK_WORKER_JOB_POOL_ID, type: 'Function' }),
    getAllJobParams: () => ({ mode: 'rebuild_report', deployment_id: 'synthetic_deployment' }),
  }, {});
  assert.equal(result.status, 'Dispatched'); assert.equal(reads, 1); assert.equal(sends, 1);
});
