'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAnalyticsClient, normalizeReadback, parseJobCode, quoteSqlIdentifier, quoteSqlValue,
} = require('../lib/analytics-client');
const { createConnectionAuthorizationProvider } = require('../lib/connection-boundary');
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
    { table: `Synthetic${index}`, viewId: String(1000 + index) }]));
  return {
    environment: 'development', maxBatchSize: 25, analyticsTimeoutMs: 20000,
    responseMaxBytes: 1048576,
    provider: {
      apiBaseUrl: 'https://analyticsapi.zoho.com', organizationId: '123456789',
      workspaceId: '987654321', targets,
    },
  };
}

const authorization = async () => `Zoho-oauthtoken ${'a'.repeat(32)}`;

test('async updateadd submission uses bounded JSON, exact matching columns, and the write Connection', async () => {
  const calls = [];
  const client = createAnalyticsClient({
    config: config(), readAuthorizationProvider: authorization,
    writeAuthorizationProvider: authorization,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response({ status: 'success', data: { jobId: '1234567890' } });
    },
  });
  const parsed = parseOutboxRow(createOutboxRow('call', callFact(),
    '2026-08-24T12:06:00.000Z'), 'development');
  assert.deepEqual(await client.submitBatch('call', [targetRow(parsed)]),
    { jobId: '1234567890' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body instanceof FormData, true);
  assert.equal(calls[0].init.headers.Authorization.startsWith('Zoho-oauthtoken '), true);
  assert.equal(calls[0].init.headers['ZANALYTICS-ORGID'], '123456789');
  const importConfig = JSON.parse(decodeURIComponent(new URL(calls[0].url).searchParams.get('CONFIG')));
  assert.equal(importConfig.importType, 'updateadd');
  assert.equal(importConfig.fileType, 'json');
  assert.equal(importConfig.onError, 'abort');
  assert.deepEqual(importConfig.matchingColumns,
    ['RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENVIRONMENT']);
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
