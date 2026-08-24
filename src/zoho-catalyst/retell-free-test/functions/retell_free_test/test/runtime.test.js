'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../lib/config');
const { FreeTestError } = require('../lib/errors');
const { createCatalystStore, MAX_CATALYST_TEXT_BYTES } = require('../lib/catalyst-store');
const { createRequestListener } = require('../lib/runtime-boundary');
const { createRetryJobHandler } = require('../lib/job-handler');
const { queryClientReport, reportToCsv } = require('../lib/reporting');
const {
  environment, payloadInbound, eventPayload, retryJobRequest, retryJobContext, invoke, runtimeFixture,
} = require('./runtime-fixture');

test('integration: Catalyst adapter uses allowlisted ZCQL and unique insert readback', async () => {
  const config = loadConfig(environment());
  const statements = [];
  const rows = [];
  const app = {
    datastore() { return { table() { return { async insertRow(row) {
      // Catalyst may deserialize a Data Store BigInt as a string on readback.
      rows.push({ ...row, BINDING_VERSION: String(row.BINDING_VERSION), ROWID: '101' });
      return rows.at(-1);
    } }; } }; },
    zcql() { return { async executeZCQLQuery(statement) {
      statements.push(statement);
      const match = /WHERE ([A-Z_]+) = (?:'([^']+)'|([0-9]+))$/.exec(statement);
      const expected = match[2] ?? match[3];
      return rows.filter((row) => String(row[match[1]]) === expected)
        .map((row) => ({ FreeTestCalls: row }));
    } }; },
  };
  const store = createCatalystStore(app, config);
  const call = { CALL_KEY: `call_${'a'.repeat(64)}`, CALL_VERSION: 1, BINDING_VERSION: 1 };
  const result = await store.insertUnique('FreeTestCalls', 'CALL_KEY', call,
    ['CALL_KEY', 'BINDING_VERSION']);
  assert.equal(result.inserted, true);
  assert.equal(result.row.CALL_KEY, call.CALL_KEY);
  assert.match(statements.at(-1), /^SELECT \* FROM FreeTestCalls WHERE CALL_KEY = /);
  await store.query('FreeTestCalls', 'ROWID', '101');
  assert.match(statements.at(-1), /WHERE ROWID = 101$/);
  await assert.rejects(store.query('NotAllowed', 'CALL_KEY', call.CALL_KEY), { code: 'INVALID_DATASTORE_QUERY' });
});

test('integration: Catalyst adapter rejects text beyond the provider 10,000-byte boundary', async () => {
  const config = loadConfig(environment());
  const inserted = [];
  const app = {
    datastore() { return { table() { return { async insertRow(row) {
      inserted.push(row);
      return row;
    } }; } }; },
    zcql() { return { async executeZCQLQuery() { return []; } }; },
  };
  const store = createCatalystStore(app, config);
  await store.insert('FreeTestRetellEventReceipts', {
    EVENT_DATA_JSON: 'x'.repeat(MAX_CATALYST_TEXT_BYTES),
  });
  await assert.rejects(store.insert('FreeTestRetellEventReceipts', {
    EVENT_DATA_JSON: 'x'.repeat(MAX_CATALYST_TEXT_BYTES + 1),
  }), { code: 'INVALID_DATASTORE_ROW' });
  assert.equal(inserted.length, 1);
});

test('integration: ambiguous deployment IDs fail closed without database uniqueness', async () => {
  const config = loadConfig(environment());
  const app = {
    datastore() { return { table() { return { async insertRow() { throw new Error('not used'); } }; } }; },
    zcql() { return { async executeZCQLQuery() {
      return [
        { FreeTestDeployments: { ROWID: '101', DEPLOYMENT_ID: 'deployment_A' } },
        { FreeTestDeployments: { ROWID: '102', DEPLOYMENT_ID: 'deployment_A' } },
      ];
    } }; },
  };
  const store = createCatalystStore(app, config);
  await assert.rejects(
    store.unique('FreeTestDeployments', 'DEPLOYMENT_ID', 'deployment_A'),
    { code: 'AMBIGUOUS_DURABLE_OWNERSHIP' },
  );
});

test('integration: Catalyst optimistic mutation does not mistake a competing write for its own', async () => {
  const config = loadConfig(environment());
  const row = {
    ROWID: '101', DEPLOYMENT_ID: 'deployment_A', COUNT_VERSION: 0,
    HANDLED_COUNT: 0, COUNTED_CALL_KEYS_JSON: '[]',
  };
  let updateCount = 0;
  const app = {
    datastore() { return { table() { return { async insertRow() { throw new Error('not used'); } }; } }; },
    zcql() { return { async executeZCQLQuery(statement) {
      if (statement.startsWith('SELECT ')) return [{ FreeTestDeployments: { ...row } }];
      updateCount += 1;
      if (updateCount === 1) {
        Object.assign(row, {
          COUNT_VERSION: 1, HANDLED_COUNT: 1, COUNTED_CALL_KEYS_JSON: '["call_A"]',
        });
      } else {
        Object.assign(row, {
          COUNT_VERSION: 2, HANDLED_COUNT: 2, COUNTED_CALL_KEYS_JSON: '["call_A","call_B"]',
        });
      }
      return [];
    } }; },
  };
  const store = createCatalystStore(app, config);
  const result = await store.mutate('FreeTestDeployments', 'DEPLOYMENT_ID', 'deployment_A',
    'COUNT_VERSION', (current) => {
      const keys = [...JSON.parse(current.COUNTED_CALL_KEYS_JSON), 'call_B'];
      return { HANDLED_COUNT: keys.length, COUNTED_CALL_KEYS_JSON: JSON.stringify(keys) };
    });
  assert.equal(updateCount, 2);
  assert.equal(result.HANDLED_COUNT, 2);
  assert.deepEqual(JSON.parse(result.COUNTED_CALL_KEYS_JSON), ['call_A', 'call_B']);
});

test('integration: Advanced I/O resolver isolates two clients and rejects unknown configuration', async () => {
  const fixture = runtimeFixture();
  const resolvedA = await invoke(fixture.listener, { url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env });
  const resolvedB = await invoke(fixture.listener, { url: '/retell/inbound', payload: payloadInbound('B'), env: fixture.env });
  assert.equal(resolvedA.body.call_inbound.dynamic_variables.company_name, 'Synthetic Plumbing A');
  assert.equal(resolvedB.body.call_inbound.dynamic_variables.company_name, 'Synthetic Plumbing B');
  assert.equal(resolvedA.body.call_inbound.metadata.client_id, 'client_A');
  assert.equal(resolvedB.body.call_inbound.metadata.client_id, 'client_B');
  const unknown = payloadInbound('A');
  unknown.call_inbound.to_number = '+15559999999';
  const rejected = await invoke(fixture.listener, { url: '/retell/inbound', payload: unknown, env: fixture.env });
  assert.deepEqual(rejected.body, { call_inbound: { reject: true } });
  assert.doesNotMatch(JSON.stringify(rejected.body), /client_[AB]|Synthetic Plumbing/);
});

test('integration: resolver fails closed on an oversized encrypted configuration snapshot', async () => {
  const fixture = runtimeFixture();
  const deployment = fixture.store.rows.get('FreeTestDeployments')[0];
  const currentBytes = Buffer.byteLength(deployment.CONFIGURATION_JSON, 'utf8');
  deployment.CONFIGURATION_JSON += ' '.repeat(MAX_CATALYST_TEXT_BYTES - currentBytes + 1);
  const result = await invoke(fixture.listener, {
    url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env,
  });
  assert.deepEqual(result.body, { call_inbound: { reject: true } });
  assert.equal(fixture.store.rows.get('FreeTestCalls').length, 0);
  assert.equal(fixture.store.rows.get('FreeTestNotifications').length, 0);
});

test('integration: ended/analyzed convergence counts once, records one dry-run notification, and replays safely', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env });
  const metadata = inbound.body.call_inbound.metadata;
  const ended = eventPayload('call_ended', 'runtime_call_A', metadata, 'A');
  const analyzed = eventPayload('call_analyzed', 'runtime_call_A', metadata, 'A');
  assert.equal((await invoke(fixture.listener, { url: '/retell/events', payload: ended, env: fixture.env })).status, 200);
  assert.equal((await invoke(fixture.listener, { url: '/retell/events', payload: analyzed, env: fixture.env })).status, 200);
  const replay = await invoke(fixture.listener, { url: '/retell/events', payload: analyzed, env: fixture.env });
  assert.equal(replay.body.duplicate, true);
  const calls = fixture.store.rows.get('FreeTestCalls');
  const notifications = fixture.store.rows.get('FreeTestNotifications');
  const deployment = fixture.store.rows.get('FreeTestDeployments').find((row) => row.CLIENT_ID === 'client_A');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].PROCESSING_STATE, 'Completed');
  assert.equal(deployment.HANDLED_COUNT, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].STATUS, 'DryRunRecorded');
  assert.equal(notifications[0].ATTEMPT_COUNT, 0);
  assert.equal(fixture.mailAccesses, 0);
});

test('integration: conflicting lifecycle timestamps are quarantined without rewriting or notifying', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const metadata = inbound.body.call_inbound.metadata;
  const callId = 'conflicting_lifecycle_A';
  const ended = eventPayload('call_ended', callId, metadata, 'A');
  assert.equal((await invoke(fixture.listener, { url: '/retell/events',
    payload: ended, env: fixture.env })).status, 200);
  const callBefore = structuredClone(fixture.store.rows.get('FreeTestCalls')[0]);
  const countBefore = fixture.store.rows.get('FreeTestDeployments')[0].HANDLED_COUNT;

  const conflicting = eventPayload('call_analyzed', callId, metadata, 'A');
  conflicting.call.start_timestamp += 30_000;
  const rejected = await invoke(fixture.listener, { url: '/retell/events',
    payload: conflicting, env: fixture.env });

  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 'DURABLE_IDEMPOTENCY_CONFLICT');
  assert.deepEqual(fixture.store.rows.get('FreeTestCalls')[0], callBefore);
  assert.equal(fixture.store.rows.get('FreeTestDeployments')[0].HANDLED_COUNT, countBefore);
  assert.equal(fixture.store.rows.get('FreeTestNotifications').length, 0);
  assert.equal(fixture.store.rows.get('FreeTestRetellEventReceipts').at(-1).STATUS, 'TerminalFailure');
});

test('integration: delayed analysis converges after a reviewed source revision changes', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env });
  const metadata = inbound.body.call_inbound.metadata;
  const callId = 'revision_delayed_analysis_A';
  await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_ended', callId, metadata, 'A'), env: fixture.env });

  const nextRevision = 'e'.repeat(40);
  const nextEnvironment = environment({ SOURCE_REVISION: nextRevision });
  fixture.store.rows.get('FreeTestDeployments').forEach((row) => { row.SOURCE_REVISION = nextRevision; });
  const nextListener = createRequestListener({ catalystSdk: fixture.catalystSdk,
    environment: nextEnvironment, now: () => fixture.clock.value, storeFactory: () => fixture.store });
  const response = await invoke(nextListener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', callId, metadata, 'A'), env: nextEnvironment });
  assert.equal(response.status, 200);
  const call = fixture.store.rows.get('FreeTestCalls')[0];
  assert.equal(call.PROCESSING_STATE, 'Completed');
  assert.equal(call.SOURCE_REVISION, fixture.env.SOURCE_REVISION);
  assert.equal(fixture.store.rows.get('FreeTestNotifications')[0].SOURCE_REVISION, nextRevision);
  assert.equal(fixture.store.rows.get('FreeTestDeployments')[0].HANDLED_COUNT, 1);
});

test('integration: call_ended counts toward the limit while notification waits for analysis', async () => {
  const fixture = runtimeFixture();
  for (let index = 0; index < 25; index += 1) {
    const inbound = await invoke(fixture.listener, { url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env });
    const event = eventPayload('call_ended', `limit_call_${index}`, inbound.body.call_inbound.metadata, 'A');
    assert.equal((await invoke(fixture.listener, { url: '/retell/events', payload: event, env: fixture.env })).status, 200);
  }
  const deployment = fixture.store.rows.get('FreeTestDeployments').find((row) => row.CLIENT_ID === 'client_A');
  assert.equal(deployment.HANDLED_COUNT, 25);
  assert.equal(deployment.TEST_STATUS, 'Completed');
  assert.equal(deployment.STOP_REASON, 'call_limit_reached');
  assert.equal(fixture.store.rows.get('FreeTestNotifications').length, 0);
  const extra = await invoke(fixture.listener, { url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env });
  assert.deepEqual(extra.body, { call_inbound: { reject: true } });
});

test('integration: failed call lifecycle is preserved but is not counted or notified as handled', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const failed = eventPayload('call_ended', 'failed_lifecycle_A',
    inbound.body.call_inbound.metadata, 'A');
  failed.call.call_status = 'error';
  failed.call.disconnection_reason = 'error_retell';
  const response = await invoke(fixture.listener, { url: '/retell/events', payload: failed,
    env: fixture.env });
  assert.equal(response.status, 200);
  const call = fixture.store.rows.get('FreeTestCalls')[0];
  const canonical = JSON.parse(call.CANONICAL_CALL_JSON);
  assert.equal(canonical.callStatus, 'error');
  assert.equal(canonical.disconnectionReason, 'error_retell');
  assert.equal(call.HANDLED_RECORDED, false);
  assert.equal(fixture.store.rows.get('FreeTestDeployments')[0].HANDLED_COUNT, 0);
  assert.equal(fixture.store.rows.get('FreeTestNotifications').length, 0);
});

test('integration: readiness is private and Production fails before SDK or Data Store access', async () => {
  const fixture = runtimeFixture();
  const denied = await invoke(fixture.listener, { method: 'GET', url: '/internal/readiness', env: fixture.env,
    headers: { authorization: 'Bearer wrong-token' } });
  assert.equal(denied.status, 401);
  const ready = await invoke(fixture.listener, { method: 'GET', url: '/internal/readiness', env: fixture.env,
    headers: { authorization: `Bearer ${fixture.env.INTERNAL_READINESS_TOKEN}` } });
  assert.equal(ready.body.table_count, 4);
  assert.equal(ready.body.mail_mode, 'dry_run');

  let initialized = 0;
  const prodEnv = environment({ DEPLOYMENT_ENVIRONMENT: 'production' });
  const production = createRequestListener({ catalystSdk: { initialize() { initialized += 1; } }, environment: prodEnv });
  const rejected = await invoke(production, { url: '/retell/inbound', payload: payloadInbound('A'), env: prodEnv });
  assert.equal(rejected.status, 503);
  assert.equal(rejected.body.code, 'PRODUCTION_BLOCKED');
  assert.equal(initialized, 0);
});

test('integration: documented Development hosts pass while a production-shaped host fails before SDK initialization', async () => {
  const alternateDevelopmentHost = 'retell-free-test.development.zohocatalyst.com';
  const alternate = runtimeFixture({ environment: { FREE_TEST_DEVELOPMENT_HOST: alternateDevelopmentHost } });
  const accepted = await invoke(alternate.listener, { url: '/retell/inbound', payload: payloadInbound('A'),
    env: alternate.env, headers: { host: alternateDevelopmentHost } });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.call_inbound.dynamic_variables.resolver_status, 'Resolved');

  const fixture = runtimeFixture();
  const rejected = await invoke(fixture.listener, { url: '/retell/inbound', payload: payloadInbound('A'),
    env: fixture.env, headers: { host: 'retell-free-test.catalystserverless.com' } });
  assert.equal(rejected.status, 503);
  assert.equal(rejected.body.code, 'PRODUCTION_BLOCKED');
  assert.equal(fixture.initialized, 0);
});

test('integration: Catalyst platform environment and project identity fail closed before store or Mail use', async () => {
  const noHeader = runtimeFixture();
  const acceptedWithoutOptionalHeader = await invoke(noHeader.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: noHeader.env, headers: { 'x-zc-environment': null } });
  assert.equal(acceptedWithoutOptionalHeader.status, 200);
  assert.equal(acceptedWithoutOptionalHeader.body.call_inbound.dynamic_variables.resolver_status, 'Resolved');

  const headerMismatch = runtimeFixture();
  const rejectedHeader = await invoke(headerMismatch.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: headerMismatch.env,
    headers: { 'x-zc-environment': 'Production' } });
  assert.equal(rejectedHeader.status, 503);
  assert.equal(rejectedHeader.body.code, 'PRODUCTION_BLOCKED');
  assert.equal(headerMismatch.store.rows.get('FreeTestCalls').length, 0);
  assert.equal(headerMismatch.mailAccesses, 0);

  const duplicateHeader = runtimeFixture();
  const rejectedDuplicate = await invoke(duplicateHeader.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: duplicateHeader.env,
    headersDistinct: { host: [duplicateHeader.env.FREE_TEST_DEVELOPMENT_HOST],
      'content-type': ['application/json'], 'x-retell-signature': ['synthetic'],
      'x-zc-environment': ['Development', 'Development'] } });
  assert.equal(rejectedDuplicate.status, 400);
  assert.equal(rejectedDuplicate.body.code, 'INVALID_REQUEST_HEADER');
  assert.equal(duplicateHeader.store.rows.get('FreeTestCalls').length, 0);
  assert.equal(duplicateHeader.mailAccesses, 0);

  const sdkMismatch = runtimeFixture();
  sdkMismatch.app.config.projectId = '999';
  const rejectedProject = await invoke(sdkMismatch.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: sdkMismatch.env });
  assert.equal(rejectedProject.status, 503);
  assert.equal(rejectedProject.body.code, 'PRODUCTION_BLOCKED');
  assert.equal(sdkMismatch.store.rows.get('FreeTestCalls').length, 0);
  assert.equal(sdkMismatch.mailAccesses, 0);
});

test('integration: duplicate readiness authorization fails closed', async () => {
  const fixture = runtimeFixture();
  const token = `Bearer ${fixture.env.INTERNAL_READINESS_TOKEN}`;
  const rejected = await invoke(fixture.listener, { method: 'GET', url: '/internal/readiness', env: fixture.env,
    headers: { authorization: token }, rawHeaders: [
      'host', fixture.env.FREE_TEST_DEVELOPMENT_HOST,
      'authorization', token,
      'authorization', token,
    ] });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 'INVALID_REQUEST_HEADER');
});

test('integration: exact Advanced I/O routes reject query variants', async () => {
  const fixture = runtimeFixture();
  const rejected = await invoke(fixture.listener, { url: '/retell/inbound?tenant=client_A',
    payload: payloadInbound('A'), env: fixture.env });
  assert.equal(rejected.status, 404);
  assert.equal(rejected.body.code, 'ROUTE_NOT_FOUND');
  assert.equal(fixture.initialized, 0);
});

test('integration: authenticated malformed event creates one replay-safe minimized quarantine receipt', async () => {
  const fixture = runtimeFixture();
  const malformed = { event: 'call_analyzed', call: { agent_id: 'agent_shared_free_test' } };
  const first = await invoke(fixture.listener, { url: '/retell/events', payload: malformed, env: fixture.env });
  const replay = await invoke(fixture.listener, { url: '/retell/events', payload: malformed, env: fixture.env });
  assert.equal(first.status, 400);
  assert.equal(replay.status, 400);
  const receipts = fixture.store.rows.get('FreeTestRetellEventReceipts');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].STATUS, 'TerminalFailure');
  assert.equal(receipts[0].EVENT_DATA_JSON, '{}');
  assert.equal(JSON.stringify(receipts[0]).includes('agent_shared_free_test'), false);
});

test('integration: Catalyst retry job honors notification backoff and converges an explicit pre-send rejection', async () => {
  let sends = 0;
  const fixture = runtimeFixture({
    environment: { FREE_TEST_NOTIFICATION_MODE: 'send_development' },
    mailBehavior: async () => {
      sends += 1;
      if (sends === 1) {
        const error = new Error('synthetic retryable pre-send rejection');
        error.preSend = true;
        error.retryable = true;
        throw error;
      }
      return { isAsync: false, project_details: { id: 'synthetic-project' },
        from_email: 'verified-sender@example.invalid', to_email: ['a@example.invalid'] };
    },
  });
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env });
  const event = eventPayload('call_analyzed', 'job_retry_A', inbound.body.call_inbound.metadata, 'A');
  assert.equal((await invoke(fixture.listener, { url: '/retell/events', payload: event, env: fixture.env })).status, 200);
  const notification = fixture.store.rows.get('FreeTestNotifications')[0];
  assert.equal(notification.STATUS, 'RetryRequired');
  assert.equal(notification.ATTEMPT_COUNT, 1);
  const context = retryJobContext({ closed: false, closeWithSuccess() { this.closed = true; } });
  const handler = createRetryJobHandler({ catalystSdk: fixture.catalystSdk, environment: fixture.env,
    now: () => fixture.clock.value, storeFactory: () => fixture.store });
  assert.equal((await handler(retryJobRequest(fixture.env), context)).notifications.examined, 0);
  fixture.clock.value += 1000;
  const result = await handler(retryJobRequest(fixture.env), context);
  assert.equal(result.notifications.examined, 1);
  assert.equal(notification.STATUS, 'Sent');
  assert.equal(notification.ATTEMPT_COUNT, 2);
  assert.equal(notification.TEMPLATE_VERSION, 'free_test_call_summary_v1');
  assert.match(notification.PROVIDER_RESULT_REFERENCE, /^mail_[a-f0-9]{64}$/);
  assert.equal(sends, 2);
  assert.equal(fixture.store.rows.get('FreeTestCalls')[0].NOTIFICATION_STATE, 'Sent');
  assert.equal(context.closed, true);
});

test('integration: repeated retryable Mail rejections stop durably after the third attempt', async () => {
  let sends = 0;
  const fixture = runtimeFixture({
    environment: { FREE_TEST_NOTIFICATION_MODE: 'send_development' },
    mailBehavior: async () => {
      sends += 1;
      const error = new Error('synthetic repeated pre-send rejection');
      error.preSend = true;
      error.retryable = true;
      throw error;
    },
  });
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const event = eventPayload('call_analyzed', 'job_terminal_A', inbound.body.call_inbound.metadata, 'A');
  assert.equal((await invoke(fixture.listener, { url: '/retell/events', payload: event,
    env: fixture.env })).status, 200);
  const notification = fixture.store.rows.get('FreeTestNotifications')[0];
  const call = fixture.store.rows.get('FreeTestCalls')[0];
  assert.equal(notification.STATUS, 'RetryRequired');
  assert.equal(notification.ATTEMPT_COUNT, 1);

  const handler = createRetryJobHandler({ catalystSdk: fixture.catalystSdk,
    environment: fixture.env, now: () => fixture.clock.value,
    storeFactory: () => fixture.store });
  fixture.clock.value += 1000;
  assert.equal((await handler(retryJobRequest(fixture.env), retryJobContext()))
    .notifications.results[0].status, 'RetryRequired');
  assert.equal(notification.ATTEMPT_COUNT, 2);
  fixture.clock.value += 5000;
  assert.equal((await handler(retryJobRequest(fixture.env), retryJobContext()))
    .notifications.results[0].status, 'TerminalFailure');
  assert.equal(notification.STATUS, 'TerminalFailure');
  assert.equal(notification.ATTEMPT_COUNT, 3);
  assert.equal(notification.NEXT_ATTEMPT_AT, null);
  assert.equal(notification.LAST_ERROR_CODE, 'CATALYST_MAIL_RETRYABLE_REJECTION');
  assert.equal(call.NOTIFICATION_STATE, 'TerminalFailure');
  assert.equal(sends, 3);
  fixture.clock.value += 60_000;
  assert.equal((await handler(retryJobRequest(fixture.env), retryJobContext()))
    .notifications.examined, 0);
  assert.equal(sends, 3);
});

test('integration: stale Mail invocation becomes ambiguous in notification and call state without resending', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', 'stale_mail_A', inbound.body.call_inbound.metadata, 'A'),
    env: fixture.env });
  const notification = fixture.store.rows.get('FreeTestNotifications')[0];
  const call = fixture.store.rows.get('FreeTestCalls')[0];
  Object.assign(notification, { STATUS: 'Sending', SEND_TOKEN: 'e'.repeat(32),
    LAST_ATTEMPT_AT: new Date(fixture.clock.value - 10_000).toISOString() });
  call.NOTIFICATION_STATE = 'Sending';
  const handler = createRetryJobHandler({ catalystSdk: fixture.catalystSdk, environment: fixture.env,
    now: () => fixture.clock.value, storeFactory: () => fixture.store });
  const result = await handler(retryJobRequest(fixture.env), retryJobContext());
  assert.equal(result.notifications.staleSending, 1);
  assert.equal(notification.STATUS, 'Ambiguous');
  assert.equal(notification.SEND_TOKEN, null);
  assert.equal(call.NOTIFICATION_STATE, 'Ambiguous');
  assert.equal(fixture.mailAccesses, 0);
});

test('integration: Catalyst retry job replays a due minimized event receipt without raw provider payload', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env });
  const event = eventPayload('call_ended', 'event_job_retry_A', inbound.body.call_inbound.metadata, 'A');
  const query = fixture.store.query.bind(fixture.store);
  let failOnce = true;
  fixture.store.query = async (...args) => {
    if (failOnce && args[0] === 'FreeTestDeployments' && args[1] === 'DEPLOYMENT_ID') {
      failOnce = false;
      throw new FreeTestError('CATALYST_QUERY_FAILED', 'synthetic transient query',
        { httpStatus: 503, retryable: true });
    }
    return query(...args);
  };
  const failed = await invoke(fixture.listener, { url: '/retell/events', payload: event, env: fixture.env });
  assert.equal(failed.status, 503);
  const receipt = fixture.store.rows.get('FreeTestRetellEventReceipts')[0];
  assert.equal(receipt.STATUS, 'RetryRequired');
  assert.equal(JSON.parse(receipt.EVENT_DATA_JSON).numberLookupHash.startsWith('num_'), true);
  assert.equal(receipt.EVENT_DATA_JSON.includes('+1555'), false);
  const handler = createRetryJobHandler({ catalystSdk: fixture.catalystSdk, environment: fixture.env,
    now: () => fixture.clock.value, storeFactory: () => fixture.store });
  assert.equal((await handler(retryJobRequest(fixture.env), retryJobContext())).events.examined, 0);
  fixture.clock.value += 1000;
  assert.equal((await handler(retryJobRequest(fixture.env), retryJobContext())).events.results[0].status, 'Completed');
  assert.equal(receipt.STATUS, 'Completed');
  assert.equal(fixture.store.rows.get('FreeTestCalls').length, 1);
  assert.equal(fixture.store.rows.get('FreeTestDeployments')[0].HANDLED_COUNT, 1);
});

test('integration: retry Job durably terminates an unreadable claimed event receipt', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const event = eventPayload('call_ended', 'event_job_invalid_A',
    inbound.body.call_inbound.metadata, 'A');
  const query = fixture.store.query.bind(fixture.store);
  let failOnce = true;
  fixture.store.query = async (...args) => {
    if (failOnce && args[0] === 'FreeTestDeployments' && args[1] === 'DEPLOYMENT_ID') {
      failOnce = false;
      throw new FreeTestError('CATALYST_QUERY_FAILED', 'synthetic transient query',
        { httpStatus: 503, retryable: true });
    }
    return query(...args);
  };
  await invoke(fixture.listener, { url: '/retell/events', payload: event, env: fixture.env });
  const receipt = fixture.store.rows.get('FreeTestRetellEventReceipts')[0];
  receipt.EVENT_DATA_JSON = '{';
  fixture.clock.value += 1000;
  const handler = createRetryJobHandler({ catalystSdk: fixture.catalystSdk, environment: fixture.env,
    now: () => fixture.clock.value, storeFactory: () => fixture.store });
  const result = await handler(retryJobRequest(fixture.env), retryJobContext());
  assert.deepEqual(result.events.results,
    [{ status: 'TerminalFailure', errorCode: 'CONFIGURATION_UNAVAILABLE' }]);
  assert.equal(receipt.STATUS, 'TerminalFailure');
  assert.equal(receipt.LEASE_TOKEN, null);
  assert.equal(receipt.LAST_ERROR_CODE, 'CONFIGURATION_UNAVAILABLE');
});

test('integration: four-table report query and CSV remain client partitioned and value-evidence explicit', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env });
  const event = eventPayload('call_analyzed', 'report_A', inbound.body.call_inbound.metadata, 'A', {
    outcome: 'urgent_potential_job', urgency: 'urgent',
    value_evidence_class: 'customer_supplied_estimate', value_minor_units: 12500, value_currency: 'USD',
  });
  await invoke(fixture.listener, { url: '/retell/events', payload: event, env: fixture.env });
  const completed = fixture.store.rows.get('FreeTestCalls')[0];
  fixture.store.rows.get('FreeTestCalls').push({ ...structuredClone(completed), ROWID: '999',
    CALL_KEY: `call_${'f'.repeat(64)}`, CORRELATION_ID: `corr_${'f'.repeat(32)}`,
    HANDLED_RECORDED: false, OUTCOME: 'potential_job', PROCESSING_STATE: 'AwaitingAnalysis',
    CANONICAL_CALL_JSON: JSON.stringify({ ...JSON.parse(completed.CANONICAL_CALL_JSON),
      callKey: `call_${'f'.repeat(64)}`, correlationId: `corr_${'f'.repeat(32)}`,
      outcome: 'potential_job' }) });
  const report = await queryClientReport(fixture.store, fixture.config, 'deployment_A', fixture.clock.value);
  assert.equal(report.clientId, 'client_A');
  assert.equal(report.metrics.totalCallsHandled, 1);
  assert.equal(report.metrics.urgentPotentialJobs, 1);
  assert.equal(report.metrics.potentialJobs, 0);
  assert.equal(report.calls[0].valueEvidenceClass, 'customer_supplied_estimate');
  assert.equal(report.notificationStates.DryRunRecorded, 1);
  const csv = reportToCsv(report);
  assert.match(csv, /urgent_potential_job/);
  assert.doesNotMatch(csv, /client_B|Synthetic Plumbing B/);
});

test('integration: canonical JSON tenant conflicts fail before notification preparation or reporting', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', 'canonical_conflict_A',
      inbound.body.call_inbound.metadata, 'A'), env: fixture.env });
  const call = fixture.store.rows.get('FreeTestCalls')[0];
  call.CANONICAL_CALL_JSON = JSON.stringify({ ...JSON.parse(call.CANONICAL_CALL_JSON),
    clientId: 'client_B' });
  const corruptedCall = structuredClone(call);
  const countBefore = fixture.store.rows.get('FreeTestDeployments')[0].HANDLED_COUNT;
  const conflictedEvent = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_ended', 'canonical_conflict_A',
      inbound.body.call_inbound.metadata, 'A'), env: fixture.env });
  assert.equal(conflictedEvent.status, 400);
  assert.equal(conflictedEvent.body.code, 'CALL_OWNERSHIP_UNRESOLVED');
  assert.deepEqual(call, corruptedCall);
  assert.equal(fixture.store.rows.get('FreeTestDeployments')[0].HANDLED_COUNT, countBefore);
  const notification = fixture.store.rows.get('FreeTestNotifications')[0];
  Object.assign(notification, { STATUS: 'Pending', NEXT_ATTEMPT_AT: null });
  let prepares = 0;
  let sends = 0;
  const handler = createRetryJobHandler({
    catalystSdk: fixture.catalystSdk, environment: fixture.env,
    now: () => fixture.clock.value, storeFactory: () => fixture.store,
    mailFactory: () => ({
      prepare() { prepares += 1; throw new Error('must remain unreachable'); },
      async notify() { sends += 1; throw new Error('must remain unreachable'); },
    }),
  });
  const retry = await handler(retryJobRequest(fixture.env), retryJobContext());
  assert.deepEqual(retry.notifications.results,
    [{ status: 'ReconciliationRequired', errorCode: 'CALL_OWNERSHIP_UNRESOLVED' }]);
  assert.equal(retry.notifications.reconciliationRequired, 1);
  assert.equal(prepares, 0);
  assert.equal(sends, 0);
  assert.equal(notification.STATUS, 'ReconciliationRequired');
  assert.equal(notification.LAST_ERROR_CODE, 'CALL_OWNERSHIP_UNRESOLVED');
  assert.equal(call.NOTIFICATION_STATE, 'ReconciliationRequired');
  await assert.rejects(
    queryClientReport(fixture.store, fixture.config, 'deployment_A', fixture.clock.value),
    { code: 'REPORT_OWNERSHIP_CONFLICT' },
  );
});

test('integration: later analysis cannot overwrite a corrupted canonical tenant binding', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const metadata = inbound.body.call_inbound.metadata;
  const callId = 'canonical_overwrite_A';
  assert.equal((await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_ended', callId, metadata, 'A'), env: fixture.env })).status, 200);
  const call = fixture.store.rows.get('FreeTestCalls')[0];
  call.CANONICAL_CALL_JSON = JSON.stringify({ ...JSON.parse(call.CANONICAL_CALL_JSON),
    deploymentId: 'deployment_B' });

  const analyzed = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', callId, metadata, 'A'), env: fixture.env });
  assert.equal(analyzed.status, 400);
  assert.equal(analyzed.body.code, 'CALL_OWNERSHIP_UNRESOLVED');
  assert.equal(JSON.parse(call.CANONICAL_CALL_JSON).deploymentId, 'deployment_B');
  assert.equal(fixture.store.rows.get('FreeTestNotifications').length, 0);
  assert.equal(fixture.store.rows.get('FreeTestDeployments')[0].HANDLED_COUNT, 1);
  assert.equal(fixture.store.rows.get('FreeTestRetellEventReceipts').at(-1).STATUS, 'TerminalFailure');
});
