'use strict';

// Real boundary and diagnostic issuer; synthetic SDK/factories, no provider I/O.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const REVISION = 'a'.repeat(40);
const PROJECT_ID = '101000001';
const HELD = 'REPORT_STORAGE_QUALIFICATION_HELD';
const boundaryPath = path.resolve(__dirname, '../lib/http-boundary.js');
const wrapperPath = path.resolve(__dirname, '../lib/report-storage-qualification.js');
const gatewayRoot = path.resolve(__dirname, '../../revenue_desk_call_gateway');
const analyticsRoot = path.resolve(__dirname,
  '../../../../revenue-desk-analytics/functions/analytics_sync/lib');
const packagedPrefix = '../reporting/revenue-desk-analytics/functions/analytics_sync/lib/';

async function withBoundary(run) {
  // These tests use node:test's default serial execution in an isolated file.
  const originalLoad = Module._load;
  const originalCache = new Map(Object.entries(require.cache));
  const loads = { bindingReader: 0 };
  delete require.cache[boundaryPath];
  delete require.cache[wrapperPath];
  Module._load = function load(request, parent, isMain) {
    if (request.startsWith('revenue_desk_call_gateway/')) {
      return originalLoad.call(this,
        path.join(gatewayRoot, request.slice('revenue_desk_call_gateway/'.length)), parent, isMain);
    }
    if (parent?.filename === wrapperPath && [
      packagedPrefix + 'report-storage-binding-diagnostic',
      packagedPrefix + 'report-storage-diagnostic',
    ].includes(request)) {
      if (request.endsWith('/report-storage-binding-diagnostic')) loads.bindingReader += 1;
      return originalLoad.call(this, path.join(analyticsRoot, path.basename(request)), parent, isMain);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { createRequestListener } = require(boundaryPath);
    const diagnostic = require(path.join(analyticsRoot, 'report-storage-binding-diagnostic.js'));
    await run({ createRequestListener, ...diagnostic, loads });
  } finally {
    Module._load = originalLoad;
    for (const key of Object.keys(require.cache)) {
      if (!originalCache.has(key)) delete require.cache[key];
    }
    for (const [key, value] of originalCache) require.cache[key] = value;
  }
}

function environment() {
  return {
    DEPLOYMENT_ENVIRONMENT: 'development', DEPLOYMENT_MODE: 'active',
    SOURCE_REVISION: REVISION, ZOHO_CATALYST_ZCQL_PARSER: 'V2',
    EXPECTED_CATALYST_PROJECT_ID_SHA256: crypto.createHash('sha256').update(PROJECT_ID).digest('hex'),
    ROUTE_CONTROL_HOST: 'route-control.development.catalystserverless.com',
    ROUTE_CONTROL_SHARED_HEADER_NAME: 'x-synthetic-control', ROUTE_CONTROL_SHARED_HEADER_VALUE: 'h'.repeat(32),
    ROUTE_CONTROL_OPERATOR_IDENTITY: 'placeholder',
    ROUTE_CONTROL_OPERATOR_HMAC_SECRET: 'o'.repeat(32), ROUTE_CONTROL_EVENT_HMAC_SECRET: 'e'.repeat(32),
    ROUTE_CONTROL_MAX_BODY_BYTES: '4096', PLATFORM_OPERATION_TIMEOUT_MS: '3000', CRM_ORGANIZATION_ID: '6'.repeat(3),
    FORM2_WORKFLOW_HMAC_SECRET: 'w'.repeat(32), FORM2_DESTINATION_SHA256: 'f'.repeat(64), FORM2_FORM_VERSION: 'form2-v1',
    CRM_API_BASE_URL: 'https://www.zohoapis.com/crm/v8',
    CRM_READ_CONNECTION_LINK_NAME: 'syntheticfixturevalue123456789',
    CRM_WRITE_CONNECTION_LINK_NAME: 'syntheticbillingsecret1234',
    RETELL_API_BASE_URL: 'https://api.retellai.com', RETELL_ROUTE_MODE: 'disabled',
    RETELL_ROLLBACK_INSTRUCTIONS: 'placeholder', NUMBER_LOOKUP_HMAC_SECRET: 'n'.repeat(32),
    DEPLOYMENT_TABLE: 'RevenueDeskDeployments', CONFIGURATION_VERSION_TABLE: 'RevenueDeskConfigurationVersions',
    EVENT_RECEIPT_TABLE: 'RevenueDeskEventReceipts', CANONICAL_CALL_TABLE: 'RevenueDeskCalls',
    NOTIFICATION_TABLE: 'RevenueDeskNotifications', ANALYTICS_OUTBOX_TABLE: 'AnalyticsSyncOutbox', OPERATION_TABLE: 'CRMBillingOperations',
  };
}

function response() {
  return { headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = JSON.parse(value); } };
}

function fixture(createRequestListener, { error, origin = 'constructor', logger } = {}) {
  const env = environment(), calls = { sdk: 0, constructor: 0, handler: 0, forbidden: 0 }, logs = [];
  const denied = () => { calls.forbidden += 1; throw new Error('Synthetic provider access prohibited'); };
  const app = { config: { projectId: PROJECT_ID, environment: 'development' },
    connections: denied, email: denied, datastore: denied };
  const factories = Object.fromEntries(['crm', 'store', 'core', 'evidence', 'provider', 'full', 'staging',
    'configurationSource', 'configurationConversion', 'configurationMetadata'].map(name => [name, denied]));
  factories.storageQualification = (receivedApp, config) => {
    calls.constructor += 1;
    assert.equal(receivedApp, app);
    assert.equal(config.sourceRevision, REVISION);
    if (origin === 'constructor') throw error;
    return { async handle() { calls.handler += 1; throw error; } };
  };
  const listener = createRequestListener({ environment: env, artifactSourceRevision: REVISION,
    catalystSdk: { initialize() { calls.sdk += 1; if (origin === 'sdk') throw error; return app; } },
    factories, fetchImpl: denied,
    failureLogger(record) { logs.push(record); return logger?.(record); } });
  const request = { method: 'POST', url: '/internal/revenue-desk/approve-configuration',
    headers: { host: env.ROUTE_CONTROL_HOST, 'x-zc-environment': 'development', 'x-zc-projectid': PROJECT_ID,
      'x-synthetic-control': env.ROUTE_CONTROL_SHARED_HEADER_VALUE, 'content-type': 'application/json' },
    rawBody: Buffer.from(JSON.stringify({ profile: 'report_storage_qualification_v1', action: 'qualify_storage' })) };
  return { listener, request, calls, logs, factories };
}

function assertGenericFailure(output) {
  assert.equal(output.statusCode, 500);
  assert.deepEqual(output.body, { ok: false, code: 'control_failed' });
  assert.equal(output.headers['cache-control'], 'no-store, max-age=0');
}

test('authenticated constructor failure logs only the issued closed binding projection', async () => {
  await withBoundary(async ({ createRequestListener, bindingDiagnosticError, loads }) => {
    const f = fixture(createRequestListener, { error: bindingDiagnosticError('marker_missing') });
    const output = response(); await f.listener(f.request, output);
    assertGenericFailure(output);
    assert.deepEqual(f.logs, [{ stage: 'storage_binding', code: HELD,
      bindingFailure: { schemaVersion: 1, firstFailure: 'marker_missing' } }]);
    assert.equal(Object.isFrozen(f.logs[0]), true);
    assert.equal(Object.isFrozen(f.logs[0].bindingFailure), true);
    assert.deepEqual(f.calls, { sdk: 1, constructor: 1, handler: 0, forbidden: 0 });
    assert.equal(loads.bindingReader, 1);
    assert.equal(Object.hasOwn(output.body, 'bindingFailure'), false);
  });
});

test('arbitrary error fields cannot forge issuance or cause new diagnostic property reads', async () => {
  await withBoundary(async ({ createRequestListener, storageBindingFailureDiagnostic }) => {
    for (const hostileGetters of [false, true]) {
      const error = new Error('SYNTHETIC_PRIVATE_CANARY'), reads = [];
      let codeReads = 0;
      Object.defineProperty(error, 'code', { get() { codeReads += 1; return HELD; } });
      for (const key of ['bindingFailure', 'diagnostic', 'firstFailure', 'schemaVersion', 'safeDetails', 'cause']) {
        Object.defineProperty(error, key, hostileGetters
          ? { get() { reads.push(key); throw new Error('Synthetic getter must not run'); } }
          : { value: key === 'bindingFailure' ? { schemaVersion: 1, firstFailure: 'marker_missing' }
            : 'SYNTHETIC_PRIVATE_CANARY' });
      }
      for (const key of ['stack', 'message']) {
        Object.defineProperty(error, key, { configurable: true,
          get() { reads.push(key); throw new Error('Synthetic error text must not be inspected'); } });
      }
      assert.equal(storageBindingFailureDiagnostic(error), undefined);
      assert.deepEqual(reads, []);
      assert.equal(codeReads, 0);
      const f = fixture(createRequestListener, { error }), output = response();
      await f.listener(f.request, output);
      assertGenericFailure(output);
      assert.deepEqual(f.logs, [{ stage: 'storage_binding', code: HELD }]);
      assert.deepEqual(reads, []);
      // Existing catch/log and public-code selection each read code once.
      assert.equal(codeReads, 2);
      assert.equal(JSON.stringify([f.logs, output.body]).includes('SYNTHETIC_PRIVATE_CANARY'), false);
      assert.deepEqual(f.calls, { sdk: 1, constructor: 1, handler: 0, forbidden: 0 });
    }
  });
});

test('issued binding errors outside the constructor stage do not acquire bindingFailure logs', async () => {
  await withBoundary(async ({ createRequestListener, bindingDiagnosticError, loads }) => {
    for (const origin of ['handler', 'sdk']) {
      const f = fixture(createRequestListener, { error: bindingDiagnosticError('marker_missing'), origin });
      const output = response(); await f.listener(f.request, output);
      assertGenericFailure(output);
      assert.deepEqual(f.logs, [{ stage: origin === 'handler' ? 'storage_handler' : 'sdk_initialize', code: HELD }]);
      assert.deepEqual(f.calls, { sdk: 1, constructor: origin === 'handler' ? 1 : 0,
        handler: origin === 'handler' ? 1 : 0, forbidden: 0 });
    }
    assert.equal(loads.bindingReader, 0);
  });
});

test('synchronous and rejected logger failures retain the same public failure without retry', async () => {
  await withBoundary(async ({ createRequestListener, bindingDiagnosticError }) => {
    for (const logger of [() => { throw new Error('Synthetic logger failure'); },
      () => Promise.reject(new Error('Synthetic logger rejection'))]) {
      const f = fixture(createRequestListener, { error: bindingDiagnosticError('marker_missing'), logger });
      const output = response(); await f.listener(f.request, output); await Promise.resolve();
      assertGenericFailure(output);
      assert.deepEqual(f.logs, [{ stage: 'storage_binding', code: HELD,
        bindingFailure: { schemaVersion: 1, firstFailure: 'marker_missing' } }]);
      assert.deepEqual(f.calls, { sdk: 1, constructor: 1, handler: 0, forbidden: 0 });
    }
  });
});

test('authentication still precedes body, SDK, factory and lazy diagnostic projection', async () => {
  await withBoundary(async ({ createRequestListener, bindingDiagnosticError, loads }) => {
    for (const variant of ['missing', 'wrong', 'duplicate', 'wrong_host']) {
      const f = fixture(createRequestListener, { error: bindingDiagnosticError('marker_missing') });
      let bodyReads = 0, factoryReads = 0;
      Object.defineProperty(f.factories, 'storageQualification', {
        get() { factoryReads += 1; throw new Error('Unauthenticated factory must not be read'); },
      });
      delete f.request.rawBody;
      Object.defineProperty(f.request, 'rawBody', {
        get() { bodyReads += 1; throw new Error('Unauthenticated body must not be read'); },
      });
      if (variant === 'missing') delete f.request.headers['x-synthetic-control'];
      if (variant === 'wrong') f.request.headers['x-synthetic-control'] = 'synthetic-wrong-value';
      if (variant === 'duplicate') f.request.rawHeaders = [
        'x-synthetic-control', 'h'.repeat(32), 'X-Synthetic-Control', 'h'.repeat(32),
      ];
      if (variant === 'wrong_host') f.request.headers.host = 'other.invalid';
      const output = response(); await f.listener(f.request, output);
      assert.equal(output.statusCode, 401, variant);
      assert.deepEqual(output.body, { ok: false, code: 'control_authentication_failed' });
      assert.equal(bodyReads, 0);
      assert.equal(factoryReads, 0);
      assert.deepEqual(f.calls, { sdk: 0, constructor: 0, handler: 0, forbidden: 0 });
      assert.deepEqual(f.logs, []);
    }
    assert.equal(loads.bindingReader, 0);
  });
});
