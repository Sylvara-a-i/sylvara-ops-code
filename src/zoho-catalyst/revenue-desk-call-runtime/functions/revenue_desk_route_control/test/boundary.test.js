'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { loadConfig } = require('../lib/config');
const { createRequestListener } = require('../lib/http-boundary');
const { createRetellRouteProvider } = require('../lib/retell-route-provider');
const { deterministicIdempotencyKey } = require('../lib/journey-core-service');
const { RevenueDeskError } = require('revenue_desk_call_gateway/lib/errors');
const { numberLookupKey } = require('revenue_desk_call_gateway/lib/security');

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
        host: 'route-control.development.catalystserverless.com',
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
      return { status: 200, async json() { return structuredClone(repurposed); } };
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
        fetchImpl: async () => ({
          status: 200, async json() { return structuredClone(malformed); },
        }),
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
          return { status: 200, async json() { return {}; } };
        }
        gets += 1;
        const value = sparsePhase === 'before' || gets > 1
          ? { ...activePhone(config), inbound_agents: undefined }
          : activePhone(config);
        return { status: 200, async json() { return structuredClone(value); } };
      },
    });
    const result = await provider.disableRoute(routeBinding(config));
    assert.equal(result.status, 'manual_rollback_required');
    assert.notEqual(result.failureCode, null);
    assert.equal(patches, sparsePhase === 'before' ? 0 : 1);
  }
});
