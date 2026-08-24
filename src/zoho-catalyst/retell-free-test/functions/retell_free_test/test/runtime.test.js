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

function downgradeCanonicalCallToV1(call) {
  const legacy = JSON.parse(call.CANONICAL_CALL_JSON);
  legacy.schemaVersion = 1;
  delete legacy.durationMs;
  delete legacy.bookableOpportunity;
  delete legacy.officeFollowUpRequired;
  delete legacy.workflowFailureCode;
  delete legacy.workflowFailureText;
  if (legacy.value) delete legacy.value.source;
  call.CANONICAL_CALL_JSON = JSON.stringify(legacy);
}

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
  assert.equal(JSON.parse(calls[0].CANONICAL_CALL_JSON).schemaVersion, 2);
  assert.equal(JSON.parse(calls[0].CANONICAL_CALL_JSON).durationMs, 60_000);
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

test('integration: authoritative Retell duration converges across event order and conflicts fail closed', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const metadata = inbound.body.call_inbound.metadata;

  const analyzedFirst = eventPayload('call_analyzed', 'duration_analyzed_first_A', metadata, 'A');
  const endedSecond = eventPayload('call_ended', 'duration_analyzed_first_A', metadata, 'A');
  analyzedFirst.call.duration_ms = 45_000;
  endedSecond.call.duration_ms = 45_000;
  assert.equal((await invoke(fixture.listener, { url: '/retell/events',
    payload: analyzedFirst, env: fixture.env })).status, 200);
  assert.equal((await invoke(fixture.listener, { url: '/retell/events',
    payload: endedSecond, env: fixture.env })).status, 200);

  const endedFirst = eventPayload('call_ended', 'duration_ended_first_A', metadata, 'A');
  const analyzedSecond = eventPayload('call_analyzed', 'duration_ended_first_A', metadata, 'A');
  endedFirst.call.duration_ms = 30_000;
  analyzedSecond.call.duration_ms = 30_000;
  assert.equal((await invoke(fixture.listener, { url: '/retell/events',
    payload: endedFirst, env: fixture.env })).status, 200);
  assert.equal((await invoke(fixture.listener, { url: '/retell/events',
    payload: analyzedSecond, env: fixture.env })).status, 200);

  const calls = fixture.store.rows.get('FreeTestCalls');
  assert.deepEqual(calls.map((row) => JSON.parse(row.CANONICAL_CALL_JSON).durationMs).sort(),
    [30_000, 45_000]);
  const beforeConflict = structuredClone(calls.find((row) => JSON.parse(row.CANONICAL_CALL_JSON)
    .durationMs === 45_000));
  const conflict = eventPayload('call_analyzed', 'duration_analyzed_first_A', metadata, 'A');
  conflict.call.duration_ms = 46_000;
  const rejected = await invoke(fixture.listener, { url: '/retell/events',
    payload: conflict, env: fixture.env });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 'DURABLE_IDEMPOTENCY_CONFLICT');
  assert.deepEqual(calls.find((row) => row.CALL_KEY === beforeConflict.CALL_KEY), beforeConflict);
  assert.equal(fixture.store.rows.get('FreeTestDeployments')[0].HANDLED_COUNT, 2);
  assert.equal(fixture.store.rows.get('FreeTestNotifications').length, 2);
});

test('integration: settled schema-v1 replay is preserved while incomplete analysis is quarantined', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const metadata = inbound.body.call_inbound.metadata;
  const callId = 'legacy_schema_v1_A';
  assert.equal((await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_ended', callId, metadata, 'A'), env: fixture.env })).status, 200);

  const call = fixture.store.rows.get('FreeTestCalls')[0];
  downgradeCanonicalCallToV1(call);
  const callBefore = structuredClone(call);
  const deploymentBefore = structuredClone(fixture.store.rows.get('FreeTestDeployments')[0]);

  // Simulate a missing legacy receipt for otherwise fully settled call-ended
  // state. The replay can be acknowledged without changing the durable call.
  fixture.store.rows.set('FreeTestRetellEventReceipts', []);
  const settledReplay = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_ended', callId, metadata, 'A'), env: fixture.env });
  assert.equal(settledReplay.status, 200);
  assert.equal(settledReplay.body.status, 'Completed');
  assert.deepEqual(fixture.store.rows.get('FreeTestCalls')[0], callBefore);
  assert.deepEqual(fixture.store.rows.get('FreeTestDeployments')[0], deploymentBefore);

  const replayOrder = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', callId, metadata, 'A', {
      bookable_opportunity: true, office_follow_up_required: true,
    }), env: fixture.env });
  assert.equal(replayOrder.status, 409);
  assert.equal(replayOrder.body.code, 'DURABLE_IDEMPOTENCY_CONFLICT');
  assert.deepEqual(fixture.store.rows.get('FreeTestCalls')[0], callBefore);
  assert.deepEqual(fixture.store.rows.get('FreeTestDeployments')[0], deploymentBefore);
  assert.equal(fixture.store.rows.get('FreeTestNotifications').length, 0);
  assert.equal(fixture.store.rows.get('FreeTestRetellEventReceipts').at(-1).STATUS,
    'ReconciliationRequired');
  assert.equal(fixture.store.rows.get('FreeTestRetellEventReceipts').at(-1).LAST_ERROR_CODE,
    'DURABLE_IDEMPOTENCY_CONFLICT');

  const report = await queryClientReport(fixture.store, fixture.config,
    'client_A', 'deployment_A', fixture.clock.value);
  assert.equal(report.callsCaptured, 1);
  assert.equal(report.actualAverageCallDurationSeconds, null);
  assert.equal(report.durationEvidenceComplete, false);
  assert.equal(report.durationWithheldCalls, 1);
  assert.equal(report.legacySchemaCallsWithheld, 1);
  assert.equal(report.bookableOpportunities, null);
  assert.equal(report.officeFollowUpCalls, null);
  assert.equal(report.structuredAnalysisComplete, false);
  assert.equal(report.calls[0].callDurationSeconds, null);
  assert.equal(report.calls[0].bookableOpportunity, null);
  assert.equal(report.calls[0].officeFollowUpRequired, null);
  assert.equal(report.calls[0].evidenceWithheldReason, 'legacy_schema_v1');
  assert.match(report.dataConfidenceNotes.join(' '), /no legacy duration is inferred/i);
});

test('integration: settled schema-v1 analysis proves its durable notification before completion', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const metadata = inbound.body.call_inbound.metadata;
  const callId = 'legacy_schema_v1_settled_analysis_A';
  const analyzed = eventPayload('call_analyzed', callId, metadata, 'A');
  assert.equal((await invoke(fixture.listener, { url: '/retell/events',
    payload: analyzed, env: fixture.env })).status, 200);

  const call = fixture.store.rows.get('FreeTestCalls')[0];
  downgradeCanonicalCallToV1(call);
  const callBefore = structuredClone(call);
  const deploymentBefore = structuredClone(fixture.store.rows.get('FreeTestDeployments')[0]);
  const notificationBefore = structuredClone(fixture.store.rows.get('FreeTestNotifications')[0]);
  fixture.store.rows.set('FreeTestRetellEventReceipts', []);

  const replay = await invoke(fixture.listener, { url: '/retell/events',
    payload: analyzed, env: fixture.env });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.status, 'Completed');
  assert.deepEqual(fixture.store.rows.get('FreeTestCalls')[0], callBefore);
  assert.deepEqual(fixture.store.rows.get('FreeTestDeployments')[0], deploymentBefore);
  assert.deepEqual(fixture.store.rows.get('FreeTestNotifications')[0], notificationBefore);
  assert.equal(fixture.store.rows.get('FreeTestRetellEventReceipts')[0].STATUS, 'Completed');
});

test('integration: partial schema-v1 handled state is quarantined instead of silently completed', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const metadata = inbound.body.call_inbound.metadata;
  const callId = 'legacy_schema_v1_partial_A';
  assert.equal((await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_ended', callId, metadata, 'A'), env: fixture.env })).status, 200);

  const call = fixture.store.rows.get('FreeTestCalls')[0];
  downgradeCanonicalCallToV1(call);
  call.HANDLED_RECORDED = false;
  fixture.store.rows.set('FreeTestRetellEventReceipts', []);

  const replay = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_ended', callId, metadata, 'A'), env: fixture.env });
  assert.equal(replay.status, 409);
  assert.equal(replay.body.code, 'DURABLE_IDEMPOTENCY_CONFLICT');
  assert.equal(call.HANDLED_RECORDED, false);
  assert.equal(fixture.store.rows.get('FreeTestDeployments')[0].HANDLED_COUNT, 1);
  assert.equal(fixture.store.rows.get('FreeTestNotifications').length, 0);
  assert.equal(fixture.store.rows.get('FreeTestRetellEventReceipts')[0].STATUS,
    'ReconciliationRequired');
  assert.equal(fixture.store.rows.get('FreeTestRetellEventReceipts')[0].LAST_ERROR_CODE,
    'DURABLE_IDEMPOTENCY_CONFLICT');

  const duplicate = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_ended', callId, metadata, 'A'), env: fixture.env });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.status, 'ReconciliationRequired');
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(fixture.store.rows.get('FreeTestRetellEventReceipts').length, 1);
  assert.equal(fixture.store.rows.get('FreeTestNotifications').length, 0);
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
    headers: { 'x-free-test-readiness-token': 'wrong-token' } });
  assert.equal(denied.status, 401);
  const ready = await invoke(fixture.listener, { method: 'GET', url: '/internal/readiness', env: fixture.env,
    headers: { 'x-free-test-readiness-token': fixture.env.INTERNAL_READINESS_TOKEN } });
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

  const defaultTlsPort = runtimeFixture();
  const acceptedDefaultTlsPort = await invoke(defaultTlsPort.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: defaultTlsPort.env,
    headers: { host: `${defaultTlsPort.env.FREE_TEST_DEVELOPMENT_HOST}:443` } });
  assert.equal(acceptedDefaultTlsPort.status, 200);
  assert.equal(acceptedDefaultTlsPort.body.call_inbound.dynamic_variables.resolver_status, 'Resolved');

  const fixture = runtimeFixture();
  const rejected = await invoke(fixture.listener, { url: '/retell/inbound', payload: payloadInbound('A'),
    env: fixture.env, headers: { host: 'retell-free-test.catalystserverless.com' } });
  assert.equal(rejected.status, 503);
  assert.equal(rejected.body.code, 'CATALYST_HOST_MISMATCH');
  assert.equal(fixture.initialized, 0);

  for (const invalidAuthority of [
    `${fixture.env.FREE_TEST_DEVELOPMENT_HOST}:80`,
    `${fixture.env.FREE_TEST_DEVELOPMENT_HOST}:444`,
    `user@${fixture.env.FREE_TEST_DEVELOPMENT_HOST}`,
    `${fixture.env.FREE_TEST_DEVELOPMENT_HOST}/path`,
  ]) {
    const invalid = runtimeFixture();
    const result = await invoke(invalid.listener, { url: '/retell/inbound', payload: payloadInbound('A'),
      env: invalid.env, headers: { host: invalidAuthority } });
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'CATALYST_HOST_MISMATCH');
    assert.equal(invalid.initialized, 0);
  }
});

test('integration: Catalyst platform environment and project identity fail closed before store or Mail use', async () => {
  const noHeader = runtimeFixture();
  const acceptedWithoutOptionalHeader = await invoke(noHeader.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: noHeader.env });
  assert.equal(acceptedWithoutOptionalHeader.status, 200);
  assert.equal(acceptedWithoutOptionalHeader.body.call_inbound.dynamic_variables.resolver_status, 'Resolved');

  const untrustedHeader = runtimeFixture();
  const acceptedWithUntrustedHeader = await invoke(untrustedHeader.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: untrustedHeader.env,
    headers: { 'x-zc-environment': 'Production' } });
  assert.equal(acceptedWithUntrustedHeader.status, 200);
  assert.equal(acceptedWithUntrustedHeader.body.call_inbound.dynamic_variables.resolver_status, 'Resolved');

  const productionSdk = runtimeFixture();
  productionSdk.app.config.environment = 'production';
  const rejectedProductionSdk = await invoke(productionSdk.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: productionSdk.env });
  assert.equal(rejectedProductionSdk.status, 503);
  assert.equal(rejectedProductionSdk.body.code, 'CATALYST_ENVIRONMENT_MISMATCH');
  assert.equal(productionSdk.store.rows.get('FreeTestCalls').length, 0);
  assert.equal(productionSdk.mailAccesses, 0);

  for (const environmentValue of ['', null, undefined, {}]) {
    const missingSdkEnvironment = runtimeFixture();
    missingSdkEnvironment.app.config.environment = environmentValue;
    const rejectedMissingSdkEnvironment = await invoke(missingSdkEnvironment.listener, {
      url: '/retell/inbound', payload: payloadInbound('A'), env: missingSdkEnvironment.env });
    assert.equal(rejectedMissingSdkEnvironment.status, 503);
    assert.equal(rejectedMissingSdkEnvironment.body.code, 'CATALYST_ENVIRONMENT_MISMATCH');
    assert.equal(missingSdkEnvironment.store.rows.get('FreeTestCalls').length, 0);
    assert.equal(missingSdkEnvironment.mailAccesses, 0);
  }

  const sdkMismatch = runtimeFixture();
  sdkMismatch.app.config.projectId = '999';
  const rejectedProject = await invoke(sdkMismatch.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: sdkMismatch.env });
  assert.equal(rejectedProject.status, 503);
  assert.equal(rejectedProject.body.code, 'CATALYST_PROJECT_MISMATCH');
  assert.equal(sdkMismatch.store.rows.get('FreeTestCalls').length, 0);
  assert.equal(sdkMismatch.mailAccesses, 0);

  const projectKeyMismatch = runtimeFixture();
  projectKeyMismatch.app.config.projectKey = 'invalid project key';
  const rejectedProjectKey = await invoke(projectKeyMismatch.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: projectKeyMismatch.env });
  assert.equal(rejectedProjectKey.status, 503);
  assert.equal(rejectedProjectKey.body.code, 'CATALYST_PROJECT_MISMATCH');
  assert.equal(projectKeyMismatch.store.rows.get('FreeTestCalls').length, 0);
  assert.equal(projectKeyMismatch.mailAccesses, 0);
});

test('integration: duplicate readiness token header fails closed', async () => {
  const fixture = runtimeFixture();
  const token = fixture.env.INTERNAL_READINESS_TOKEN;
  const rejected = await invoke(fixture.listener, { method: 'GET', url: '/internal/readiness', env: fixture.env,
    headers: { 'x-free-test-readiness-token': token }, rawHeaders: [
      'host', fixture.env.FREE_TEST_DEVELOPMENT_HOST,
      'x-free-test-readiness-token', token,
      'x-free-test-readiness-token', token,
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

test('integration: transient pre-send reads remain retryable and invoke Mail only after recovery', async () => {
  let sends = 0;
  const fixture = runtimeFixture({
    mailBehavior: async () => {
      sends += 1;
      return { isAsync: false, project_details: { id: 'synthetic-project' },
        from_email: 'verified-sender@example.invalid', to_email: ['a@example.invalid'] };
    },
  });
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', 'notification_read_retry_A',
      inbound.body.call_inbound.metadata, 'A'), env: fixture.env });
  const notification = fixture.store.rows.get('FreeTestNotifications')[0];
  const call = fixture.store.rows.get('FreeTestCalls')[0];
  Object.assign(notification, { STATUS: 'Pending', ATTEMPT_COUNT: 0, PROVIDER_CODE: 'NOT_ATTEMPTED',
    PROVIDER_RESULT_REFERENCE: null, SEND_TOKEN: null, LAST_ATTEMPT_AT: null,
    NEXT_ATTEMPT_AT: null, LAST_ERROR_CODE: null });
  call.NOTIFICATION_STATE = 'Pending';

  const query = fixture.store.query.bind(fixture.store);
  let failCallRead = true;
  fixture.store.query = async (...args) => {
    if (failCallRead && args[0] === 'FreeTestCalls' && args[1] === 'CALL_KEY') {
      failCallRead = false;
      throw new FreeTestError('CATALYST_QUERY_FAILED', 'synthetic transient call read',
        { httpStatus: 503, retryable: true });
    }
    return query(...args);
  };
  const sendEnvironment = { ...fixture.env, FREE_TEST_NOTIFICATION_MODE: 'send_development' };
  const handler = createRetryJobHandler({ catalystSdk: fixture.catalystSdk,
    environment: sendEnvironment, now: () => fixture.clock.value,
    storeFactory: () => fixture.store });
  const first = await handler(retryJobRequest(sendEnvironment), retryJobContext());
  assert.deepEqual(first.notifications.results,
    [{ status: 'RetryRequired', errorCode: 'CATALYST_QUERY_FAILED' }]);
  assert.equal(notification.STATUS, 'RetryRequired');
  assert.equal(notification.ATTEMPT_COUNT, 1);
  assert.equal(notification.NEXT_ATTEMPT_AT,
    new Date(fixture.clock.value + 1000).toISOString());
  assert.equal(notification.PROVIDER_CODE, 'NOT_ATTEMPTED');
  assert.equal(notification.LAST_ERROR_CODE, 'CATALYST_QUERY_FAILED');
  assert.equal(call.NOTIFICATION_STATE, 'RetryRequired');
  assert.equal(sends, 0);
  assert.equal(fixture.mailAccesses, 0);

  fixture.clock.value += 1000;
  const recovered = await handler(retryJobRequest(sendEnvironment), retryJobContext());
  assert.equal(recovered.notifications.results[0].status, 'Sent');
  assert.equal(notification.STATUS, 'Sent');
  assert.equal(notification.ATTEMPT_COUNT, 2);
  assert.equal(notification.PROVIDER_CODE, 'CATALYST_MAIL_ACCEPTED');
  assert.equal(call.NOTIFICATION_STATE, 'Sent');
  assert.equal(sends, 1);
  assert.equal(fixture.mailAccesses, 1);
});

test('integration: repeated pre-send read failures terminate without a provider invocation', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', 'notification_read_terminal_A',
      inbound.body.call_inbound.metadata, 'A'), env: fixture.env });
  const notification = fixture.store.rows.get('FreeTestNotifications')[0];
  const call = fixture.store.rows.get('FreeTestCalls')[0];
  Object.assign(notification, { STATUS: 'Pending', ATTEMPT_COUNT: 0, PROVIDER_CODE: 'NOT_ATTEMPTED',
    PROVIDER_RESULT_REFERENCE: null, SEND_TOKEN: null, LAST_ATTEMPT_AT: null,
    NEXT_ATTEMPT_AT: null, LAST_ERROR_CODE: null });
  call.NOTIFICATION_STATE = 'Pending';

  const query = fixture.store.query.bind(fixture.store);
  let failNextCallRead = false;
  fixture.store.query = async (...args) => {
    if (failNextCallRead && args[0] === 'FreeTestCalls' && args[1] === 'CALL_KEY') {
      failNextCallRead = false;
      throw new FreeTestError('CATALYST_QUERY_FAILED', 'synthetic persistent call read',
        { httpStatus: 503, retryable: true });
    }
    return query(...args);
  };
  const sendEnvironment = { ...fixture.env, FREE_TEST_NOTIFICATION_MODE: 'send_development' };
  const handler = createRetryJobHandler({ catalystSdk: fixture.catalystSdk,
    environment: sendEnvironment, now: () => fixture.clock.value,
    storeFactory: () => fixture.store });
  for (const delay of [0, 1000, 5000]) {
    fixture.clock.value += delay;
    failNextCallRead = true;
    await handler(retryJobRequest(sendEnvironment), retryJobContext());
  }
  assert.equal(notification.STATUS, 'TerminalFailure');
  assert.equal(notification.ATTEMPT_COUNT, 3);
  assert.equal(notification.NEXT_ATTEMPT_AT, null);
  assert.equal(notification.PROVIDER_CODE, 'NOT_ATTEMPTED');
  assert.equal(notification.PROVIDER_RESULT_REFERENCE, null);
  assert.equal(notification.LAST_ERROR_CODE, 'CATALYST_QUERY_FAILED');
  assert.equal(call.NOTIFICATION_STATE, 'TerminalFailure');
  assert.equal(fixture.mailAccesses, 0);
  fixture.clock.value += 60_000;
  assert.equal((await handler(retryJobRequest(sendEnvironment), retryJobContext()))
    .notifications.examined, 0);
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
    bookable_opportunity: true, office_follow_up_required: true,
    workflow_failure_code: 'office_queue_unavailable',
    workflow_failure_text: 'The synthetic office queue was unavailable.',
    value_evidence_class: 'customer_supplied_estimate', value_minor_units: 12500, value_currency: 'USD',
  });
  // Provider connected duration is authoritative and intentionally differs from the wall-clock timestamps.
  event.call.duration_ms = 45_000;
  await invoke(fixture.listener, { url: '/retell/events', payload: event, env: fixture.env });
  const completed = fixture.store.rows.get('FreeTestCalls')[0];
  fixture.store.rows.get('FreeTestCalls').push({ ...structuredClone(completed), ROWID: '999',
    CALL_KEY: `call_${'f'.repeat(64)}`, CORRELATION_ID: `corr_${'f'.repeat(32)}`,
    HANDLED_RECORDED: false, OUTCOME: 'unresolved', PROCESSING_STATE: 'AwaitingAnalysis',
    NOTIFICATION_STATE: null,
    CANONICAL_CALL_JSON: JSON.stringify({ ...JSON.parse(completed.CANONICAL_CALL_JSON),
      callKey: `call_${'f'.repeat(64)}`, correlationId: `corr_${'f'.repeat(32)}`,
      outcome: 'unresolved', urgency: 'unknown', bookableOpportunity: null,
      officeFollowUpRequired: null }) });
  const report = await queryClientReport(fixture.store, fixture.config,
    'client_A', 'deployment_A', fixture.clock.value);
  assert.equal(report.clientId, 'client_A');
  assert.equal(report.metrics.totalCallsHandled, 1);
  assert.equal(report.metrics.urgentPotentialJobs, 1);
  assert.equal(report.metrics.potentialJobs, 0);
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.callsCaptured, 1);
  assert.equal(report.actualAverageCallDurationSeconds, 45);
  assert.equal(report.qualifiedOpportunities, 1);
  assert.equal(report.existingCustomerCalls, 0);
  assert.equal(report.outOfAreaOrWrongFitCalls, 0);
  assert.equal(report.urgentRequests, 1);
  assert.equal(report.bookableOpportunities, 1);
  assert.equal(report.officeFollowUpCalls, 1);
  assert.equal(report.observedWorkflowFailures, 1);
  assert.equal(report.recommendedPaidCoverage, 'After Hours Only');
  assert.equal(report.expectedMonthlyConnectedMinutesMin, 10.5);
  assert.equal(report.expectedMonthlyConnectedMinutesMax, 11.63);
  assert.match(report.expectedMonthlyConnectedMinutesMethodology,
    /observed handled connected minutes.*28 and 31/i);
  assert.equal(report.testStart, '2026-08-20T12:00:00.000Z');
  assert.equal(report.testEnd, null);
  assert.equal(report.testEndReason, null);
  assert.equal(report.callsRemaining, 24);
  assert.equal(report.limitReached, false);
  assert.equal(report.inFlightOvershoot, 0);
  assert.equal(report.durationEvidenceComplete, true);
  assert.equal(report.structuredAnalysisComplete, true);
  assert.equal(report.legacySchemaCallsWithheld, 0);
  assert.equal(report.durationWithheldCalls, 0);
  assert.equal(report.dataConfidenceNotes.length, 8);
  assert.match(report.dataConfidenceNotes.join(' '), /0.75 observed minutes across 2 elapsed approved test days/);
  assert.match(report.dataConfidenceNotes.join(' '), /source-qualified per call/);
  const reportedCall = report.calls.find(({ outcome }) => outcome === 'urgent_potential_job');
  assert.equal(reportedCall.callDurationSeconds, 45);
  assert.equal(reportedCall.bookableOpportunity, true);
  assert.equal(reportedCall.officeFollowUpRequired, true);
  assert.equal(reportedCall.workflowFailureCode, 'office_queue_unavailable');
  assert.equal(reportedCall.analysisEvidenceComplete, true);
  assert.equal(reportedCall.evidenceWithheldReason, null);
  assert.equal(Object.hasOwn(reportedCall, 'workflowFailureText'), false);
  assert.equal(Object.hasOwn(reportedCall, 'callbackNumber'), false);
  assert.equal(Object.hasOwn(reportedCall, 'callerName'), false);
  assert.equal(Object.hasOwn(reportedCall, 'issueSummary'), false);
  assert.equal(Object.hasOwn(reportedCall, 'cityOrZip'), false);
  assert.equal(Object.hasOwn(reportedCall, 'specificPersonRequested'), false);
  assert.equal(reportedCall.valueEvidenceClass, 'customer_supplied_estimate');
  assert.equal(report.notificationStates.DryRunRecorded, 1);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /numberLookupHash|recording|transcript|\+15550000001/);
  assert.doesNotMatch(serialized, /\+15551110001|Caller A|Leaking water heater|Lenexa/);
  const csv = reportToCsv(report);
  const [header, summary, ...callRows] = csv.split('\r\n');
  assert.match(header, /^recordType,clientId,deploymentId,configurationVersion,coverageMode,/);
  assert.match(summary, /^summary,client_A,deployment_A,cfg_A_v1,AfterHoursOnly,1,0,1,/);
  assert.equal(callRows.length, report.calls.length);
  assert.ok(callRows.every((row) => row.startsWith('call,client_A,deployment_A,cfg_A_v1,')));
  assert.match(summary, /DryRunRecorded/);
  assert.match(header, /actualAverageCallDurationSeconds,qualifiedOpportunities/);
  assert.match(header, /recommendedPaidCoverage,expectedMonthlyConnectedMinutesMin/);
  assert.match(header, /bookableOpportunity,officeFollowUpRequired,analysisEvidenceComplete/);
  assert.match(csv, /urgent_potential_job/);
  assert.match(csv, /office_queue_unavailable/);
  assert.doesNotMatch(csv, /\+15550000001|\+15551110001|Caller A|Leaking water heater|Lenexa|numberLookupHash|recording|transcript/);
  assert.doesNotMatch(csv, /client_B|Synthetic Plumbing B/);

  const completedPeriod = await queryClientReport(fixture.store, fixture.config,
    'client_A', 'deployment_A', Date.parse(report.testExpiresAt));
  assert.equal(completedPeriod.testEnd, report.testExpiresAt);
  assert.equal(completedPeriod.testEndReason, 'Seven-Day Limit Reached');
  assert.equal(completedPeriod.testPeriodProgress, 1);
  assert.equal(completedPeriod.expectedMonthlyConnectedMinutesMin, 3);
  assert.equal(completedPeriod.expectedMonthlyConnectedMinutesMax, 3.32);
});

test('integration: report classifications distinguish existing-customer and wrong-fit calls', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  for (const [callId, data] of [
    ['report_existing_A', { outcome: 'existing_customer', customer_type: 'existing',
      office_follow_up_required: true }],
    ['report_out_of_area_A', { outcome: 'out_of_area' }],
    ['report_unsupported_A', { outcome: 'unsupported_service' }],
  ]) {
    const response = await invoke(fixture.listener, { url: '/retell/events',
      payload: eventPayload('call_analyzed', callId,
        inbound.body.call_inbound.metadata, 'A', data), env: fixture.env });
    assert.equal(response.status, 200);
  }
  const report = await queryClientReport(fixture.store, fixture.config,
    'client_A', 'deployment_A', fixture.clock.value);
  assert.equal(report.callsCaptured, 3);
  assert.equal(report.qualifiedOpportunities, 0);
  assert.equal(report.existingCustomerCalls, 1);
  assert.equal(report.outOfAreaOrWrongFitCalls, 2);
  assert.equal(report.urgentRequests, 0);
  assert.equal(report.bookableOpportunities, null);
  assert.equal(report.officeFollowUpCalls, null);
  assert.equal(report.structuredAnalysisComplete, false);
  assert.equal(report.observedWorkflowFailures, 0);
  assert.equal(report.recommendedPaidCoverage, 'After Hours Only');
  assert.equal(report.actualAverageCallDurationSeconds, 60);
  assert.equal(report.expectedMonthlyConnectedMinutesMin, 42);
  assert.equal(report.expectedMonthlyConnectedMinutesMax, 46.5);
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
    queryClientReport(fixture.store, fixture.config,
      'client_A', 'deployment_A', fixture.clock.value),
    { code: 'REPORT_OWNERSHIP_CONFLICT' },
  );
});

test('integration: reports fail closed on client, count, or notification reconciliation drift', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', 'report_reconcile_A',
      inbound.body.call_inbound.metadata, 'A', {
        value_evidence_class: 'customer_supplied_estimate',
        value_minor_units: 10_000, value_currency: 'USD',
      }), env: fixture.env });

  await assert.rejects(
    queryClientReport(fixture.store, fixture.config,
      'client_B', 'deployment_A', fixture.clock.value),
    { code: 'REPORT_OWNERSHIP_CONFLICT' },
  );

  const call = fixture.store.rows.get('FreeTestCalls')[0];
  const originalOutcome = call.OUTCOME;
  call.OUTCOME = 'spam';
  await assert.rejects(
    queryClientReport(fixture.store, fixture.config,
      'client_A', 'deployment_A', fixture.clock.value),
    { code: 'REPORT_RECONCILIATION_REQUIRED' },
  );
  call.OUTCOME = originalOutcome;

  const originalCanonical = call.CANONICAL_CALL_JSON;
  const absentProvenance = JSON.parse(originalCanonical);
  delete absentProvenance.value.source;
  call.CANONICAL_CALL_JSON = JSON.stringify(absentProvenance);
  const legacyAuthorized = await queryClientReport(fixture.store, fixture.config,
    'client_A', 'deployment_A', fixture.clock.value);
  assert.equal(legacyAuthorized.calls[0].valueEvidenceClass, 'customer_supplied_estimate');
  assert.equal(legacyAuthorized.calls[0].bookableOpportunity, null);
  assert.equal(legacyAuthorized.calls[0].officeFollowUpRequired, null);
  assert.equal(legacyAuthorized.structuredAnalysisComplete, false);
  assert.equal(legacyAuthorized.bookableOpportunities, null);
  assert.equal(legacyAuthorized.officeFollowUpCalls, null);

  for (const corrupted of [
    { ...absentProvenance, customerType: 'unreviewed_type' },
    { ...absentProvenance, sensitiveDataMinimized: true },
    { ...absentProvenance, urgency: 'urgent' },
    { ...absentProvenance, value: { ...absentProvenance.value,
      evidenceClass: 'confirmed_revenue' } },
    { ...absentProvenance, value: { ...absentProvenance.value,
      source: 'verified_downstream' } },
    { ...absentProvenance, value: { evidenceClass: 'confirmed_revenue',
      valueMinorUnits: 10_000, currency: 'USD', methodId: null, methodVersion: null,
      source: 'verified_downstream' } },
    { ...absentProvenance, value: { evidenceClass: 'internal_estimate_with_method',
      valueMinorUnits: 10_000, currency: 'USD', methodId: 'unapproved', methodVersion: 'v1',
      source: 'server_method' } },
    { ...absentProvenance, value: { ...absentProvenance.value,
      unreviewedProvenance: 'untrusted' } },
  ]) {
    call.CANONICAL_CALL_JSON = JSON.stringify(corrupted);
    await assert.rejects(
      queryClientReport(fixture.store, fixture.config,
        'client_A', 'deployment_A', fixture.clock.value),
      { code: 'REPORT_DATA_INVALID' },
    );
  }
  call.CANONICAL_CALL_JSON = originalCanonical;

  call.HANDLED_RECORDED = false;
  await assert.rejects(
    queryClientReport(fixture.store, fixture.config,
      'client_A', 'deployment_A', fixture.clock.value),
    { code: 'REPORT_RECONCILIATION_REQUIRED' },
  );
  call.HANDLED_RECORDED = true;

  const deployment = fixture.store.rows.get('FreeTestDeployments')[0];
  const countedCallKeys = deployment.COUNTED_CALL_KEYS_JSON;
  deployment.COUNTED_CALL_KEYS_JSON = JSON.stringify([`call_${'e'.repeat(64)}`]);
  await assert.rejects(
    queryClientReport(fixture.store, fixture.config,
      'client_A', 'deployment_A', fixture.clock.value),
    { code: 'REPORT_RECONCILIATION_REQUIRED' },
  );
  deployment.COUNTED_CALL_KEYS_JSON = countedCallKeys;

  const notification = fixture.store.rows.get('FreeTestNotifications')[0];
  notification.STATUS = 'RetryRequired';
  await assert.rejects(
    queryClientReport(fixture.store, fixture.config,
      'client_A', 'deployment_A', fixture.clock.value),
    { code: 'REPORT_RECONCILIATION_REQUIRED' },
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
