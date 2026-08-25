'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCrmReportDispatcher } = require('../lib/crm-report-dispatch');

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
