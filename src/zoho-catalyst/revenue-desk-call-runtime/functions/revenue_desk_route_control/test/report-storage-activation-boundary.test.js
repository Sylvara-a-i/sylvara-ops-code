'use strict';

// Real HTTP boundary/configuration; synthetic SDK and handler, no provider I/O.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { loadConfig } = require('../lib/config');
const { createRequestListener } = require('../lib/http-boundary');

const REVISION = 'a'.repeat(40);
const PROJECT_ID = '101000001';
const PROFILE = 'report_storage_qualification_v1';
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
function command() {
  const verifiedAt = 1700000000000, expiresAt = verifiedAt + 3600000;
  const evidence = Object.fromEntries(['ownerAuthorization', 'ownership', 'access'].map((role, index) => [role, {
    stateSha256: String(index + 1).repeat(64), digest: String(index + 4).repeat(64), verifiedAt, expiresAt,
  }]));
  return { profile: PROFILE, action: 'qualify_storage', activation: {
    schemaVersion: 1, bindingSha256: 'a'.repeat(64), operationDigest: 'b'.repeat(64), verifiedAt, expiresAt, evidence,
  } };
}
function response() {
  return { headers: {}, statusCode: null, body: null,
    setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = JSON.parse(value); } };
}
function fixture({ handler, runtimeProject = PROJECT_ID, runtimeEnvironment = 'development' } = {}) {
  const env = environment(), calls = { sdk: 0, storage: 0, handle: 0, forbidden: 0 }, logs = [];
  const denied = () => { calls.forbidden += 1; throw new Error('Synthetic provider access prohibited'); };
  const app = { config: { projectId: runtimeProject, environment: runtimeEnvironment }, connections: denied, email: denied };
  const factories = Object.fromEntries(['crm', 'store', 'core', 'evidence', 'provider', 'full', 'staging',
    'configurationSource', 'configurationConversion', 'configurationMetadata'].map(name => [name, denied]));
  factories.storageQualification = (receivedApp, config) => {
    calls.storage += 1; assert.equal(receivedApp, app); assert.equal(config.sourceRevision, REVISION);
    return { async handle(value, options) {
      calls.handle += 1;
      assert.deepEqual(options.actor, { kind: 'internal_controller', identity: loadConfig(env, REVISION).operatorIdHash });
      assert.equal(Object.isFrozen(options.actor), true);
      return handler ? handler(value, options) : { status: 'synthetic_boundary_only' };
    } };
  };
  const listener = createRequestListener({ environment: env, artifactSourceRevision: REVISION,
    catalystSdk: { initialize() { calls.sdk += 1; return app; } }, factories, fetchImpl: denied,
    failureLogger(record) { logs.push(record); } });
  const request = { method: 'POST', url: '/internal/revenue-desk/approve-configuration',
    headers: { host: env.ROUTE_CONTROL_HOST, 'x-zc-environment': 'development', 'x-zc-projectid': PROJECT_ID,
      'x-synthetic-control': env.ROUTE_CONTROL_SHARED_HEADER_VALUE, 'content-type': 'application/json' },
    rawBody: Buffer.from(JSON.stringify(command())) };
  return { listener, request, env, calls, logs };
}

test('protected existing approval route forwards the complete activation and internal actor unchanged', async () => {
  const expected = command(); let received;
  const f = fixture({ handler(value) { received = value; return { status: 'synthetic_boundary_only' }; } });
  const output = response(); await f.listener(f.request, output);
  assert.equal(output.statusCode, 200); assert.deepEqual(received, expected);
  assert.deepEqual(f.calls, { sdk: 1, storage: 1, handle: 1, forbidden: 0 });
  assert.deepEqual(output.body, { ok: true, action: 'qualify_storage', result: { status: 'synthetic_boundary_only' } });
  assert.equal(output.headers['cache-control'], 'no-store, max-age=0');
});

test('activation cannot bypass authentication or cause its body to be inspected before authentication', async () => {
  for (const variant of ['missing', 'wrong', 'duplicate', 'wrong_host', 'wrong_project', 'production']) {
    const f = fixture(); let bodyReads = 0;
    delete f.request.rawBody;
    Object.defineProperty(f.request, 'rawBody', { get() { bodyReads += 1; assert.fail('Unauthenticated activation inspected'); } });
    if (variant === 'missing') delete f.request.headers['x-synthetic-control'];
    if (variant === 'wrong') f.request.headers['x-synthetic-control'] = 'synthetic-wrong-value';
    if (variant === 'duplicate') f.request.rawHeaders = ['x-synthetic-control', 'h'.repeat(32), 'X-Synthetic-Control', 'h'.repeat(32)];
    if (variant === 'wrong_host') f.request.headers.host = 'other.invalid';
    if (variant === 'wrong_project') f.request.headers['x-zc-projectid'] = '101000002';
    if (variant === 'production') f.request.headers['x-zc-environment'] = 'production';
    const output = response(); await f.listener(f.request, output);
    assert.equal(output.statusCode, 401, variant);
    assert.deepEqual(output.body, { ok: false, code: 'control_authentication_failed' });
    assert.equal(bodyReads, 0); assert.deepEqual(f.calls, { sdk: 0, storage: 0, handle: 0, forbidden: 0 });
  }
});

test('activation does not create another route or permit a mismatched managed runtime', async () => {
  for (const action of ['activate-free-test', 'rollback-free-test']) {
    const f = fixture(), output = response(); f.request.url = '/internal/revenue-desk/' + action;
    await f.listener(f.request, output);
    assert.equal(output.statusCode, 503); assert.equal(f.calls.storage, 0); assert.equal(f.calls.handle, 0);
    assert.equal(f.calls.forbidden, 0);
  }
  for (const options of [{ runtimeProject: '101000002' }, { runtimeEnvironment: 'production' }]) {
    const f = fixture(options), output = response(); await f.listener(f.request, output);
    assert.equal(output.statusCode, 503); assert.equal(output.body.code, 'control_authentication_failed');
    assert.deepEqual(f.calls, { sdk: 1, storage: 0, handle: 0, forbidden: 0 });
  }
});

test('activation rejection stays generic and never echoes activation receipts or arbitrary error properties', async () => {
  const f = fixture({ handler(value) {
    const error = new Error('SYNTHETIC_PRIVATE_EVIDENCE'); error.code = 'REPORT_STORAGE_QUALIFICATION_HELD';
    error.activation = value.activation; throw error;
  } });
  const output = response(); await f.listener(f.request, output);
  assert.equal(output.statusCode, 500); assert.deepEqual(output.body, { ok: false, code: 'control_failed' });
  assert.deepEqual(f.logs, [{ stage: 'storage_handler', code: 'REPORT_STORAGE_QUALIFICATION_HELD' }]);
  assert.equal(f.calls.forbidden, 0);
});
