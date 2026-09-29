'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAnalyticsClient, normalizeReadback, parseJobCode, quoteSqlIdentifier, quoteSqlValue,
} = require('../lib/analytics-client');
const { createConnectionAuthorizationProvider } = require('../lib/connection-boundary');
const { TARGET_TABLE_NAMES } = require('../lib/config');
const { callFact } = require('./helpers');
const { createOutboxRow, parseOutboxRow, targetRow } = require('../lib/facts');

function response(payload, status = 200) {
  const bytes = Buffer.from(JSON.stringify(payload));
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => bytes,
  };
}

function config() {
  const targets = Object.fromEntries([
    'deployment', 'call', 'daily_metric', 'final_test_result', 'conversion_status',
  ].map((recordType, index) => [recordType,
    { table: TARGET_TABLE_NAMES[recordType], viewId: String(1000 + index) }]));
  return {
    environment: 'development', maxBatchSize: 25, analyticsTimeoutMs: 20000,
    responseMaxBytes: 1048576,
    provider: {
      apiBaseUrl: 'https://analyticsapi.zoho.com', organizationId: '123456789',
      workspaceId: '987654321', targets,
    },
  };
}

function viewDetails(runtimeConfig, recordType, overrides = {}) {
  const target = runtimeConfig.provider.targets[recordType];
  return {
    status: 'success',
    data: {
      views: {
        viewId: target.viewId,
        viewName: target.table,
        viewType: 'Table',
        workspaceId: runtimeConfig.provider.workspaceId,
        orgId: runtimeConfig.provider.organizationId,
        ...overrides,
      },
    },
  };
}

const authorization = async () => `Zoho-oauthtoken ${'a'.repeat(32)}`;

test('async updateadd submission uses bounded JSON, exact matching columns, and the write Connection', async () => {
  const calls = [];
  const runtimeConfig = config();
  const client = createAnalyticsClient({
    config: runtimeConfig,
    readAuthorizationProvider: async () => `Zoho-oauthtoken ${'r'.repeat(32)}`,
    writeAuthorizationProvider: async () => `Zoho-oauthtoken ${'w'.repeat(32)}`,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (init.method === 'GET') return response(viewDetails(runtimeConfig, 'call'));
      return response({ status: 'success', data: { jobId: '1234567890' } });
    },
  });
  const parsed = parseOutboxRow(createOutboxRow('call', callFact(),
    '2026-08-24T12:06:00.000Z'), 'development');
  assert.deepEqual(await client.submitBatch('call', [targetRow(parsed)]),
    { jobId: '1234567890' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].url,
    'https://analyticsapi.zoho.com/restapi/v2/views/1001');
  assert.equal(calls[0].init.headers.Authorization,
    `Zoho-oauthtoken ${'r'.repeat(32)}`);
  assert.equal(calls[0].init.headers['ZANALYTICS-ORGID'], '123456789');
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.body instanceof FormData, true);
  assert.equal(calls[1].init.headers.Authorization,
    `Zoho-oauthtoken ${'w'.repeat(32)}`);
  assert.equal(calls[1].init.headers['ZANALYTICS-ORGID'], '123456789');
  const importConfig = JSON.parse(decodeURIComponent(new URL(calls[1].url).searchParams.get('CONFIG')));
  assert.equal(importConfig.importType, 'updateadd');
  assert.equal(importConfig.fileType, 'json');
  assert.equal(importConfig.onError, 'abort');
  assert.deepEqual(importConfig.matchingColumns,
    ['RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENVIRONMENT']);
});

test('a swapped private view ID fails authoritative table binding before any write', async () => {
  const requests = [];
  const runtimeConfig = config();
  const deploymentViewId = runtimeConfig.provider.targets.deployment.viewId;
  const callViewId = runtimeConfig.provider.targets.call.viewId;
  runtimeConfig.provider.targets.deployment.viewId = callViewId;
  runtimeConfig.provider.targets.call.viewId = deploymentViewId;
  const client = createAnalyticsClient({
    config: runtimeConfig,
    readAuthorizationProvider: authorization,
    writeAuthorizationProvider: async () => {
      assert.fail('write authorization must not be requested for a mismatched target');
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return response(viewDetails(runtimeConfig, 'call', {
        viewName: TARGET_TABLE_NAMES.deployment,
      }));
    },
  });
  const parsed = parseOutboxRow(createOutboxRow('call', callFact(),
    '2026-08-24T12:06:00.000Z'), 'development');
  await assert.rejects(client.submitBatch('call', [targetRow(parsed)]),
    /does not match the fixed import binding/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests.some(({ init }) => init.method === 'POST'), false);
});

test('target metadata binds exact view, type, workspace, and organization before write', async (t) => {
  const cases = [
    ['view ID', { viewId: '9999' }],
    ['view type', { viewType: 'QueryTable' }],
    ['workspace', { workspaceId: '9999' }],
    ['organization', { orgId: '9999' }],
    ['complete identity', { orgId: undefined }],
  ];
  for (const [label, overrides] of cases) {
    await t.test(label, async () => {
      const requests = [];
      const runtimeConfig = config();
      const client = createAnalyticsClient({
        config: runtimeConfig,
        readAuthorizationProvider: authorization,
        writeAuthorizationProvider: async () => {
          assert.fail('write authorization must not be requested for invalid metadata');
        },
        fetchImpl: async (url, init) => {
          requests.push({ url, init });
          return response(viewDetails(runtimeConfig, 'call', overrides));
        },
      });
      const parsed = parseOutboxRow(createOutboxRow('call', callFact(),
        '2026-08-24T12:06:00.000Z'), 'development');
      await assert.rejects(client.submitBatch('call', [targetRow(parsed)]),
        /target metadata/);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].init.method, 'GET');
    });
  }
});

test('official import Job codes and summaries are parsed conservatively', async () => {
  assert.deepEqual(parseJobCode({ status: 'success', data: { jobCode: '1002' } }).code, '1002');
  assert.throws(() => parseJobCode({ status: 'success', data: { jobCode: '1999' } }),
    /unknown Job code/);
  const queue = [
    response({ status: 'success', data: { jobCode: '1001' } }),
    response({ status: 'success', data: { jobCode: '1004', jobInfo: {
      importSummary: { totalRowCount: '2', successRowCount: '2' },
    } } }),
    response({ status: 'success', data: { jobCode: '1005' } }),
  ];
  const client = createAnalyticsClient({
    config: config(), readAuthorizationProvider: authorization,
    writeAuthorizationProvider: authorization, fetchImpl: async () => queue.shift(),
  });
  assert.deepEqual(await client.pollImport('1234'), { state: 'pending' });
  assert.deepEqual(await client.pollImport('1234'),
    { state: 'complete', totalRows: 2, acceptedRows: 2, rejectedRows: 0 });
  assert.deepEqual(await client.pollImport('1234'), { state: 'missing' });
});

test('readback export selects only opaque partition keys and accepts only six exact columns', async () => {
  const requests = [];
  const parsed = parseOutboxRow(createOutboxRow('call', callFact(),
    '2026-08-24T12:06:00.000Z'), 'development');
  const row = targetRow(parsed);
  const readback = {
    RECORD_KEY: row.RECORD_KEY, CLIENT_KEY: row.CLIENT_KEY,
    DEPLOYMENT_KEY: row.DEPLOYMENT_KEY, ENVIRONMENT: row.ENVIRONMENT,
    PAYLOAD_HASH: row.PAYLOAD_HASH, SOURCE_MODIFIED_AT: row.SOURCE_MODIFIED_AT,
  };
  const queue = [
    response({ status: 'success', data: { jobId: '2001' } }),
    response({ status: 'success', data: { jobCode: '1004' } }),
    response([readback]),
  ];
  const client = createAnalyticsClient({
    config: config(), readAuthorizationProvider: authorization,
    writeAuthorizationProvider: authorization,
    fetchImpl: async (url, init) => { requests.push({ url, init }); return queue.shift(); },
  });
  assert.deepEqual(await client.startReadback('call', [row]), { jobId: '2001' });
  const exportConfig = JSON.parse(new URL(requests[0].url).searchParams.get('CONFIG'));
  assert.match(exportConfig.sqlQuery, /"CLIENT_KEY" = '[a-f0-9]{64}'/);
  assert.match(exportConfig.sqlQuery, /"DEPLOYMENT_KEY" = '[a-f0-9]{64}'/);
  assert.equal(exportConfig.showPersonalCols, false);
  assert.deepEqual(await client.pollReadback('2001'), { state: 'complete', rows: [readback] });
  assert.throws(() => normalizeReadback([{ ...readback, TRANSCRIPT: 'synthetic' }]),
    /unapproved columns/);
  assert.equal(quoteSqlIdentifier('Safe_Table'), '"Safe_Table"');
  assert.equal(quoteSqlValue('safe-value'), "'safe-value'");
  assert.throws(() => quoteSqlIdentifier('unsafe table'), /identifier/);
});

test('Connection boundary accepts exactly one OAuth Authorization header and no query credentials', async () => {
  const validApp = {
    connections: () => ({ getConnectionCredentials: async () => ({
      headers: { Authorization: `Zoho-oauthtoken ${'a'.repeat(32)}` }, parameters: {},
    }) }),
  };
  assert.equal((await createConnectionAuthorizationProvider(validApp, 'safe_link', 1000)())
    .startsWith('Zoho-oauthtoken '), true);
  const invalidApp = {
    connections: () => ({ getConnectionCredentials: async () => ({
      headers: { Authorization: `Zoho-oauthtoken ${'a'.repeat(32)}`, 'X-Extra': 'no' },
      parameters: { token: 'no' },
    }) }),
  };
  await assert.rejects(createConnectionAuthorizationProvider(invalidApp, 'safe_link', 1000),
    /Query-parameter credentials are prohibited/);
});

function completeScopeFixture(overrides = {}) {
  const runtimeConfig = { ...config(), sourceRevision: 'a'.repeat(40), ...overrides };
  const parsed = parseOutboxRow(createOutboxRow('call', callFact(),
    '2026-08-24T12:06:00.000Z'), 'development');
  const fact = targetRow(parsed);
  const scope = { CLIENT_KEY: fact.CLIENT_KEY, DEPLOYMENT_KEY: fact.DEPLOYMENT_KEY,
    CONFIGURATION_VERSION: 'config_A', ENGAGEMENT_TYPE: 'free_test',
    ENVIRONMENT: 'development', SOURCE_REVISION: runtimeConfig.sourceRevision };
  const row = Object.fromEntries(['RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY',
    'ENVIRONMENT', 'PAYLOAD_HASH', 'SOURCE_MODIFIED_AT'].map((key) => [key, fact[key]]));
  const requests = [];
  function clientFor(payload, { metadata = viewDetails(runtimeConfig, 'call'),
    exportResponse, readAuthorizationProvider = authorization } = {}) {
    return createAnalyticsClient({ config: runtimeConfig, readAuthorizationProvider,
      writeAuthorizationProvider: async () => assert.fail('read must never request write authorization'),
      now: () => Date.parse('2026-08-24T12:07:00.000Z'),
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        const body = url.includes('/data?') ? payload : metadata;
        return url.includes('/data?') && exportResponse ? exportResponse
          : new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      },
    });
  }
  return { runtimeConfig, scope, row, requests, clientFor };
}

test('complete partition export reads unknown keys with no key filter and freezes its scope', async () => {
  const f = completeScopeFixture();
  const scope = { ...f.scope };
  const other = { ...f.row, RECORD_KEY: 'f'.repeat(64) };
  const pending = f.clientFor([f.row, other]).readCompleteScope(scope, 'call');
  scope.CLIENT_KEY = 'e'.repeat(64);
  const result = await pending;
  assert.deepEqual(result, { scope: f.scope, recordType: 'call', rows: [f.row, other],
    complete: true, bindingVerified: true, observedAt: '2026-08-24T12:07:00.000Z' });
  assert.equal(Object.isFrozen(result.rows[0]), true);
  assert.equal(Object.isFrozen(result.scope), true);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].url, 'https://analyticsapi.zoho.com/restapi/v2/views/1001');
  assert.equal(new URL(f.requests[1].url).pathname, '/restapi/v2/workspaces/987654321/views/1001/data');
  const query = JSON.parse(new URL(f.requests[1].url).searchParams.get('CONFIG'));
  assert.equal(query.criteria, ['ENVIRONMENT', 'CLIENT_KEY', 'DEPLOYMENT_KEY'].map((key) =>
    `"${TARGET_TABLE_NAMES.call}"."${key}" = '${f.scope[key]}'`).join(' AND '));
  assert.deepEqual(query.selectedColumns, Object.keys(f.row));
  assert.equal(query.keyValueFormat, true);
  assert.equal(query.showHiddenCols, false);
  assert.equal(query.showPersonalCols, false);
  assert.equal(Object.hasOwn(query, 'validateSystemTags'), false);
  for (const { init } of f.requests) {
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, await authorization());
    assert.equal(init.headers['ZANALYTICS-ORGID'], '123456789');
  }
});

test('complete partition proves explicit empty rows and accepts only established exact envelopes', async () => {
  for (const payload of [[], { data: [] }, { data: { rows: [] } }]) {
    const f = completeScopeFixture();
    assert.deepEqual((await f.clientFor(payload).readCompleteScope(f.scope, 'call')).rows, []);
  }
});

test('complete partition refuses pagination, duplicates, cross-scope, malformed and oversized cohorts', async (t) => {
  const base = completeScopeFixture();
  const cases = [
    ['pagination', { data: [base.row], next: 'synthetic-next' }],
    ['nested pagination', { data: { rows: [base.row], more: true } }],
    ['missing rows', {}],
    ['extra column', [{ ...base.row, TRANSCRIPT: 'synthetic' }]],
    ['missing column', [{ ...base.row, PAYLOAD_HASH: undefined }]],
    ['duplicate', [base.row, base.row]],
    ['cross-client', [{ ...base.row, CLIENT_KEY: 'f'.repeat(64) }]],
    ['cross-deployment', [{ ...base.row, DEPLOYMENT_KEY: 'f'.repeat(64) }]],
    ['cross-environment', [{ ...base.row, ENVIRONMENT: 'production' }]],
    ['invalid hash', [{ ...base.row, PAYLOAD_HASH: 'invalid' }]],
    ['invalid watermark', [{ ...base.row, SOURCE_MODIFIED_AT: '2026-08-24' }]],
    ['full source page', Array.from({ length: 100 }, (_, i) =>
      ({ ...base.row, RECORD_KEY: i.toString(16).padStart(64, '0') }))],
  ];
  for (const [label, payload] of cases) await t.test(label, async () => {
    const f = completeScopeFixture();
    await assert.rejects(f.clientFor(payload).readCompleteScope(f.scope, 'call'),
      { code: 'ANALYTICS_RESPONSE_INVALID' });
  });
});

test('complete partition refuses invalid scope before authorization or requests and wrong binding before export', async () => {
  const f = completeScopeFixture();
  for (const scope of [null, { ...f.scope, EXTRA: true },
    { ...f.scope, SOURCE_REVISION: 'b'.repeat(40) }, { ...f.scope, ENVIRONMENT: 'production' },
    { ...f.scope, ENGAGEMENT_TYPE: 'paid' }, { ...f.scope, CLIENT_KEY: 'invalid' }]) {
    await assert.rejects(f.clientFor([]).readCompleteScope(scope, 'call'), { code: 'ANALYTICS_SCOPE_INVALID' });
  }
  await assert.rejects(f.clientFor([]).readCompleteScope(f.scope, 'daily_metric'), { code: 'ANALYTICS_SCOPE_INVALID' });
  assert.equal(f.requests.length, 0);
  await assert.rejects(f.clientFor([], { metadata: viewDetails(f.runtimeConfig, 'call',
    { workspaceId: '9999' }) }).readCompleteScope(f.scope, 'call'),
  { code: 'ANALYTICS_TARGET_BINDING_MISMATCH' });
  assert.equal(f.requests.length, 1);
});

test('complete partition rejects incomplete HTTP responses and streams within the byte bound', async (t) => {
  const cases = [
    ['partial content', () => new Response('[]', { status: 206 })],
    ['wrong content type', () => new Response('[]', { headers: { 'content-type': 'text/html' } })],
    ['content range', () => new Response('[]', { headers: {
      'content-type': 'application/json', 'content-range': 'bytes 0-1/100' } })],
    ['oversized declared length', () => new Response('[]', { headers: {
      'content-type': 'application/json', 'content-length': '99999' } })],
    ['malformed JSON', () => new Response('[', { headers: { 'content-type': 'application/json' } })],
  ];
  for (const [label, exportResponse] of cases) await t.test(label, async () => {
    const f = completeScopeFixture({ responseMaxBytes: 1024 });
    await assert.rejects(f.clientFor([], { exportResponse: exportResponse() }).readCompleteScope(f.scope, 'call'));
  });
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(600)); },
    cancel() { cancelled = true; } });
  const f = completeScopeFixture({ responseMaxBytes: 1024 });
  await assert.rejects(f.clientFor([], { exportResponse: new Response(body,
    { headers: { 'content-type': 'application/json' } }) }).readCompleteScope(f.scope, 'call'),
  { code: 'ANALYTICS_RESPONSE_TOO_LARGE' });
  assert.equal(cancelled, true);
});

test('complete partition timeout covers authorization and forbids late requests', async () => {
  const f = completeScopeFixture({ analyticsTimeoutMs: 20 });
  let resolveAuthorization;
  const pendingAuthorization = new Promise((resolve) => { resolveAuthorization = resolve; });
  const client = f.clientFor([], { readAuthorizationProvider: () => pendingAuthorization });
  await assert.rejects(client.readCompleteScope(f.scope, 'call'), { code: 'ANALYTICS_TIMEOUT' });
  resolveAuthorization(await authorization());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.requests.length, 0);
});

test('complete partition timeout cancels a stalled streamed body', async () => {
  let cancelled = false;
  const f = completeScopeFixture({ analyticsTimeoutMs: 20 });
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(f.clientFor([], { exportResponse: new Response(body,
    { headers: { 'content-type': 'application/json' } }) }).readCompleteScope(f.scope, 'call'),
  { code: 'ANALYTICS_TIMEOUT' });
  assert.equal(cancelled, true);
});

test('parent cancellation before or during authorization prevents any later request', async () => {
  for (const abortBeforeStart of [true, false]) {
    const f = completeScopeFixture();
    const controller = new AbortController();
    let authorize;
    let authorizationCalls = 0;
    const pendingAuthorization = new Promise((resolve) => { authorize = resolve; });
    if (abortBeforeStart) controller.abort();
    const pending = f.clientFor([], { readAuthorizationProvider: () => {
      authorizationCalls += 1;
      return pendingAuthorization;
    } }).readCompleteScope(f.scope, 'call', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, { code: 'ANALYTICS_ABORTED' });
    authorize(await authorization());
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(authorizationCalls, abortBeforeStart ? 0 : 1);
    assert.equal(f.requests.length, 0);
  }
});

test('parent cancellation promptly releases an active body before the longer adapter timeout', async () => {
  let cancelled = false;
  const f = completeScopeFixture();
  const controller = new AbortController();
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const pending = f.clientFor([], { exportResponse: new Response(body,
    { headers: { 'content-type': 'application/json' } }) })
    .readCompleteScope(f.scope, 'call', { signal: controller.signal });
  const rejected = assert.rejects(pending, { code: 'ANALYTICS_ABORTED' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.requests.length, 2);
  controller.abort();
  await rejected;
  assert.equal(cancelled, true);
});
