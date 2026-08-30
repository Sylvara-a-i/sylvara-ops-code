'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig: loadRuntimeConfig } = require('../lib/config');
const { RevenueDeskError } = require('../lib/errors');
const { createCatalystStore, MAX_CATALYST_TEXT_BYTES } = require('../lib/catalyst-store');
const { createRequestListener } = require('../lib/runtime-boundary');
const { createRuntimeService } = require('../lib/runtime-service');
const { createWorkerJobHandler: createRuntimeWorkerJobHandler } = require('../lib/job-handler');
const { CatalystMailAdapter } = require('../lib/catalyst-mail');
const { OUTBOX_IMMUTABLE, canonicalJson, sha256 } = require('../lib/analytics-outbox');
const { queryClientReport, reportToCsv } = require('../lib/reporting');
const { callLookupKey } = require('../lib/security');
const { RETELL_CONVERSATION_VARIABLE_FIELDS } = require('../lib/contracts');
const { parseOutboxRow } = require('../../../../revenue-desk-analytics/functions/analytics_sync/lib/facts');
const {
  SOURCE_REVISION, environment, payloadInbound, eventPayload,
  retryJobRequest, retryJobContext, invoke, runtimeFixture,
} = require('./runtime-fixture');

const loadConfig = (env) => loadRuntimeConfig(env, { artifactSourceRevision: SOURCE_REVISION });
const testDispatcherFactory = (_app, config, store) => ({
  async dispatch(dealId, operationKey) {
    assert.match(operationKey, /^[a-f0-9]{64}$/);
    const operation = await store.unique(
      config.tables.OPERATION_TABLE, 'OPERATION_KEY', operationKey,
    );
    assert.equal(operation?.ACTION, 'sync_report_summary');
    assert.equal(String(operation?.CRM_DEAL_ID), dealId);
    await store.mutate(
      config.tables.OPERATION_TABLE, 'OPERATION_KEY', operation.OPERATION_KEY,
      'OPERATION_VERSION', (current) => current.STATUS === 'pending' ? {
        STATUS: 'completed', LAST_OUTCOME: 'report_summary_readback_confirmed',
        UPDATED_AT: new Date(Date.parse(current.UPDATED_AT) + 1).toISOString(),
      } : null,
    );
    return { status: 'Dispatched', duplicate: false };
  },
});
const createWorkerJobHandler = (options) => createRuntimeWorkerJobHandler({
  dispatcherFactory: testDispatcherFactory,
  ...options,
  artifactSourceRevision: SOURCE_REVISION,
});

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

async function reconciledTerminalAnalyticsFixture() {
  const fixture = runtimeFixture();
  fixture.store.rows.set('RevenueDeskDeployments', fixture.store.rows.get('RevenueDeskDeployments')
    .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  fixture.store.rows.set('RevenueDeskConfigurationVersions',
    fixture.store.rows.get('RevenueDeskConfigurationVersions')
      .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  fixture.clock.value = Date.parse('2026-08-27T12:00:00.000Z');
  const service = createRuntimeService({
    store: fixture.store, mailAdapter: {}, config: fixture.config,
    now: () => fixture.clock.value,
  });
  const first = await service.reconcileDueDeployments(25);
  assert.equal(first.results[0].status, 'AwaitingCrmReportReadback');
  const operation = fixture.store.rows.get('CRMBillingOperations')[0];
  await fixture.store.mutate('CRMBillingOperations', 'OPERATION_KEY', operation.OPERATION_KEY,
    'OPERATION_VERSION', () => ({
      STATUS: 'completed', LAST_OUTCOME: 'report_summary_readback_confirmed',
    }));
  await service.reconcileDeployment('deployment_A');
  const finalRow = fixture.store.rows.get('AnalyticsSyncOutbox')
    .find((row) => row.RECORD_TYPE === 'final_test_result');
  assert.ok(finalRow);
  return { fixture, service, finalRow };
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
      if (statement.includes(' ORDER BY ')) return [];
      if (statement.includes(' WHERE ROW_SCHEMA_VERSION = 2 AND RECORD_TYPE = ')) return [];
      const match = /WHERE ([A-Z_]+) = (?:'([^']+)'|([0-9]+))$/.exec(statement);
      const expected = match[2] ?? match[3];
      return rows.filter((row) => String(row[match[1]]) === expected)
        .map((row) => ({ RevenueDeskCalls: row }));
    } }; },
  };
  const store = createCatalystStore(app, config);
  const call = { CALL_KEY: `call_${'a'.repeat(64)}`, CALL_VERSION: 1, BINDING_VERSION: 1 };
  const result = await store.insertUnique('RevenueDeskCalls', 'CALL_KEY', call,
    ['CALL_KEY', 'BINDING_VERSION']);
  assert.equal(result.inserted, true);
  assert.equal(result.row.CALL_KEY, call.CALL_KEY);
  assert.match(statements.at(-1), /^SELECT \* FROM RevenueDeskCalls WHERE CALL_KEY = /);
  await store.query('RevenueDeskCalls', 'ROWID', '101');
  assert.match(statements.at(-1), /WHERE ROWID = 101$/);
  await store.queryBounded('CRMBillingOperations', 'STATUS', 'pending', 'CREATED_AT', 25,
    { ACTION: 'sync_report_summary' });
  assert.equal(statements.at(-1), "SELECT * FROM CRMBillingOperations WHERE STATUS = 'pending' AND ACTION = 'sync_report_summary' ORDER BY CREATED_AT ASC, ROWID ASC LIMIT 25");
  await store.queryBounded('RevenueDeskEventReceipts', 'STATUS', 'RetryRequired',
    'NEXT_ATTEMPT_AT', 25, { RECEIPT_KIND: 'provider_event' });
  assert.equal(statements.at(-1), "SELECT * FROM RevenueDeskEventReceipts WHERE STATUS = 'RetryRequired' AND RECEIPT_KIND = 'provider_event' ORDER BY NEXT_ATTEMPT_AT ASC, ROWID ASC LIMIT 25");
  const identity = {
    RECORD_TYPE: 'final_test_result', ENVIRONMENT: 'development',
    CLIENT_KEY: 'a'.repeat(64), DEPLOYMENT_KEY: 'b'.repeat(64),
    RECORD_KEY: 'b'.repeat(64), SOURCE_MODIFIED_AT: '2026-08-27T12:00:00.000Z',
  };
  assert.equal(await store.uniqueOutboxProviderIdentity('AnalyticsSyncOutbox', identity), null);
  assert.equal(statements.at(-1), "SELECT * FROM AnalyticsSyncOutbox WHERE ROW_SCHEMA_VERSION = 2 AND RECORD_TYPE = 'final_test_result' AND ENVIRONMENT = 'development' AND CLIENT_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' AND DEPLOYMENT_KEY = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' AND RECORD_KEY = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' AND SOURCE_MODIFIED_AT = '2026-08-27T12:00:00.000Z' LIMIT 2");
  await assert.rejects(store.queryBounded(
    'CRMBillingOperations', 'STATUS', 'pending', 'NOT_ALLOWED_AT', 25,
  ), { code: 'INVALID_DATASTORE_QUERY' });
  await assert.rejects(
    store.queryBounded('CRMBillingOperations', 'STATUS', 'pending', 'CREATED_AT', 101),
    { code: 'INVALID_DATASTORE_QUERY' },
  );
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
  await store.insert('RevenueDeskEventReceipts', {
    EVENT_DATA_JSON: 'x'.repeat(MAX_CATALYST_TEXT_BYTES),
  });
  await assert.rejects(store.insert('RevenueDeskEventReceipts', {
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
        { RevenueDeskDeployments: { ROWID: '101', DEPLOYMENT_ID: 'deployment_A' } },
        { RevenueDeskDeployments: { ROWID: '102', DEPLOYMENT_ID: 'deployment_A' } },
      ];
    } }; },
  };
  const store = createCatalystStore(app, config);
  await assert.rejects(
    store.unique('RevenueDeskDeployments', 'DEPLOYMENT_ID', 'deployment_A'),
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
      if (statement.startsWith('SELECT ')) return [{ RevenueDeskDeployments: { ...row } }];
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
  const result = await store.mutate('RevenueDeskDeployments', 'DEPLOYMENT_ID', 'deployment_A',
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
  assert.deepEqual(Object.keys(resolvedA.body.call_inbound.dynamic_variables).sort(),
    [...RETELL_CONVERSATION_VARIABLE_FIELDS].sort());
  for (const internalField of [
    'configuration_version_id', 'number_binding_id', 'number_binding_version',
    'correlation_id', 'resolved_at', 'ownership_token',
  ]) {
    assert.equal(Object.hasOwn(resolvedA.body.call_inbound.dynamic_variables, internalField), false);
    assert.equal(Object.hasOwn(resolvedA.body.call_inbound.metadata, internalField), true);
  }
  const unknown = payloadInbound('A');
  unknown.call_inbound.to_number = '+15559999999';
  const rejected = await invoke(fixture.listener, { url: '/retell/inbound', payload: unknown, env: fixture.env });
  assert.deepEqual(rejected.body, { call_inbound: { reject: true } });
  assert.doesNotMatch(JSON.stringify(rejected.body), /client_[AB]|Synthetic Plumbing/);
});

test('integration: a mismatched legacy body timestamp fails closed under the current signed contract', async () => {
  const fixture = runtimeFixture();
  const payload = payloadInbound('A', fixture.clock.value
    + fixture.config.maxSignatureAgeMs + 1);
  const rejected = await invoke(fixture.listener, {
    url: '/retell/inbound', payload, env: fixture.env,
    signatureTimestamp: fixture.clock.value,
  });
  assert.equal(rejected.status, 200);
  assert.deepEqual(rejected.body, { call_inbound: { reject: true } });
  assert.equal(fixture.store.rows.get('RevenueDeskCalls').length, 0);
});

test('integration: resolver fails closed on an oversized encrypted configuration snapshot', async () => {
  const fixture = runtimeFixture();
  const version = fixture.store.rows.get('RevenueDeskConfigurationVersions')[0];
  const currentBytes = Buffer.byteLength(version.CONFIGURATION_JSON, 'utf8');
  version.CONFIGURATION_JSON += ' '.repeat(MAX_CATALYST_TEXT_BYTES - currentBytes + 1);
  const result = await invoke(fixture.listener, {
    url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env,
  });
  assert.deepEqual(result.body, { call_inbound: { reject: true } });
  assert.equal(fixture.store.rows.get('RevenueDeskCalls').length, 0);
  assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 0);
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
  const calls = fixture.store.rows.get('RevenueDeskCalls');
  const notifications = fixture.store.rows.get('RevenueDeskNotifications');
  const deployment = fixture.store.rows.get('RevenueDeskDeployments').find((row) => row.CLIENT_ID === 'client_A');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].PROCESSING_STATE, 'Completed');
  assert.equal(JSON.parse(calls[0].CANONICAL_CALL_JSON).schemaVersion, 2);
  assert.equal(JSON.parse(calls[0].CANONICAL_CALL_JSON).durationMs, 60_000);
  assert.equal(JSON.parse(calls[0].CANONICAL_CALL_JSON).coverageMode, 'AfterHoursOnly');
  assert.equal(deployment.HANDLED_COUNT, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].STATUS, 'DryRunRecorded');
  assert.equal(notifications[0].ATTEMPT_COUNT, 0);
  assert.equal(fixture.mailAccesses, 0);
  const outbox = fixture.store.rows.get('AnalyticsSyncOutbox');
  assert.equal(outbox.filter((row) => row.RECORD_TYPE === 'call').length, 1);
  assert.equal(outbox.filter((row) => row.RECORD_TYPE === 'deployment').length, 1);
  for (const row of outbox) {
    const parsed = parseOutboxRow(row, 'development');
    assert.equal(parsed.ROW_SCHEMA_VERSION, 2);
    const expectedDate = row.RECORD_TYPE === 'call'
      ? parsed.fact.STARTED_AT.slice(0, 10) : row.SOURCE_MODIFIED_AT.slice(0, 10);
    assert.equal(row.SOURCE_DATE_UTC, expectedDate);
    if (row.RECORD_TYPE === 'call') assert.equal(parsed.fact.COVERAGE_MODE, 'after_hours_only');
    if (row.RECORD_TYPE === 'deployment') assert.deepEqual(
      [parsed.fact.CAPABILITY_PROFILE, parsed.fact.PLAN_TIER,
        parsed.fact.LIMIT_POLICY, parsed.fact.BILLING_MODE],
      ['call_gap_monitor_v1', 'none',
        'seven_calendar_days_or_25_connected_calls_v1', 'none'],
    );
    assert.equal(JSON.stringify(row).includes('Caller A'), false);
    assert.equal(JSON.stringify(row).includes('+1555'), false);
  }
});

test('integration: rollback claims reject unseen number-only events but preserve proven settlement', async () => {
  const fixture = runtimeFixture();
  const durableInbound = await invoke(fixture.listener, {
    url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env,
  });
  const signedInbound = await invoke(fixture.listener, {
    url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env,
  });
  const durableCallId = 'rollback_proven_durable_A';
  assert.equal((await invoke(fixture.listener, {
    url: '/retell/events',
    payload: eventPayload('call_ended', durableCallId,
      durableInbound.body.call_inbound.metadata, 'A'),
    env: fixture.env,
  })).status, 200);

  fixture.store.rows.get('RevenueDeskEventReceipts').push({
    ROWID: 'rollback_claim_runtime_A',
    EVENT_KEY: `rollback_claim_${'a'.repeat(64)}`,
    RECEIPT_KIND: 'control_claim',
    EVENT_TYPE: 'rollback_claim',
    DEPLOYMENT_ID: 'deployment_A',
    STATUS: 'Prepared',
    RECEIVED_AT: new Date(fixture.clock.value).toISOString(),
  });

  assert.equal((await invoke(fixture.listener, {
    url: '/retell/events',
    payload: eventPayload('call_ended', 'rollback_proven_signed_A',
      signedInbound.body.call_inbound.metadata, 'A'),
    env: fixture.env,
  })).status, 200, 'pre-claim signed ownership may still settle');
  assert.equal((await invoke(fixture.listener, {
    url: '/retell/events',
    payload: eventPayload('call_analyzed', durableCallId, undefined, 'A'),
    env: fixture.env,
  })).status, 200, 'an existing durable call may still settle');

  const unknown = await invoke(fixture.listener, {
    url: '/retell/events',
    payload: eventPayload('call_ended', 'rollback_unproven_number_only_A', undefined, 'A'),
    env: fixture.env,
  });
  assert.equal(unknown.status, 200);
  assert.equal(fixture.workerErrors.at(-1).code, 'CONFIGURATION_UNAVAILABLE');
  const calls = fixture.store.rows.get('RevenueDeskCalls');
  assert.equal(calls.length, 2);
  assert.equal(calls.some((row) => row.CALL_KEY === callLookupKey(
    fixture.config.eventSecret, 'rollback_unproven_number_only_A',
  )), false);
  assert.equal(fixture.store.rows.get('RevenueDeskDeployments')[0].HANDLED_COUNT, 2);
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
  const callBefore = structuredClone(fixture.store.rows.get('RevenueDeskCalls')[0]);
  const countBefore = fixture.store.rows.get('RevenueDeskDeployments')[0].HANDLED_COUNT;

  const conflicting = eventPayload('call_analyzed', callId, metadata, 'A');
  conflicting.call.start_timestamp += 30_000;
  const rejected = await invoke(fixture.listener, { url: '/retell/events',
    payload: conflicting, env: fixture.env });

  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.status, 'Queued');
  assert.equal(fixture.workerErrors.at(-1).code, 'DURABLE_IDEMPOTENCY_CONFLICT');
  assert.deepEqual(fixture.store.rows.get('RevenueDeskCalls')[0], callBefore);
  assert.equal(fixture.store.rows.get('RevenueDeskDeployments')[0].HANDLED_COUNT, countBefore);
  assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 0);
  assert.equal(fixture.store.rows.get('RevenueDeskEventReceipts').at(-1).STATUS, 'TerminalFailure');
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

  const calls = fixture.store.rows.get('RevenueDeskCalls');
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
  assert.equal(fixture.store.rows.get('RevenueDeskDeployments')[0].HANDLED_COUNT, 2);
  assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 2);
});

test('integration: settled schema-v1 replay is preserved while incomplete analysis is quarantined', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const metadata = inbound.body.call_inbound.metadata;
  const callId = 'legacy_schema_v1_A';
  assert.equal((await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_ended', callId, metadata, 'A'), env: fixture.env })).status, 200);

  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
  downgradeCanonicalCallToV1(call);
  const callBefore = structuredClone(call);
  const deploymentBefore = structuredClone(fixture.store.rows.get('RevenueDeskDeployments')[0]);

  // Simulate a missing legacy receipt for otherwise fully settled call-ended
  // state. The replay can be acknowledged without changing the durable call.
  fixture.store.rows.set('RevenueDeskEventReceipts', []);
  const settledReplay = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_ended', callId, metadata, 'A'), env: fixture.env });
  assert.equal(settledReplay.status, 200);
  assert.equal(settledReplay.body.status, 'Queued');
  assert.equal(fixture.store.rows.get('RevenueDeskEventReceipts')[0].STATUS, 'Completed');
  assert.deepEqual(fixture.store.rows.get('RevenueDeskCalls')[0], callBefore);
  assert.deepEqual(fixture.store.rows.get('RevenueDeskDeployments')[0], deploymentBefore);

  const replayOrder = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', callId, metadata, 'A', {
      bookable_opportunity: true, office_follow_up_required: true,
    }), env: fixture.env });
  assert.equal(replayOrder.status, 200);
  assert.equal(replayOrder.body.status, 'Queued');
  assert.equal(fixture.workerErrors.at(-1).code, 'DURABLE_IDEMPOTENCY_CONFLICT');
  assert.deepEqual(fixture.store.rows.get('RevenueDeskCalls')[0], callBefore);
  assert.deepEqual(fixture.store.rows.get('RevenueDeskDeployments')[0], deploymentBefore);
  assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 0);
  assert.equal(fixture.store.rows.get('RevenueDeskEventReceipts').at(-1).STATUS,
    'ReconciliationRequired');
  assert.equal(fixture.store.rows.get('RevenueDeskEventReceipts').at(-1).LAST_ERROR_CODE,
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

  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
  downgradeCanonicalCallToV1(call);
  const callBefore = structuredClone(call);
  const deploymentBefore = structuredClone(fixture.store.rows.get('RevenueDeskDeployments')[0]);
  const notificationBefore = structuredClone(fixture.store.rows.get('RevenueDeskNotifications')[0]);
  fixture.store.rows.set('RevenueDeskEventReceipts', []);

  const replay = await invoke(fixture.listener, { url: '/retell/events',
    payload: analyzed, env: fixture.env });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.status, 'Queued');
  assert.deepEqual(fixture.store.rows.get('RevenueDeskCalls')[0], callBefore);
  assert.deepEqual(fixture.store.rows.get('RevenueDeskDeployments')[0], deploymentBefore);
  assert.deepEqual(fixture.store.rows.get('RevenueDeskNotifications')[0], notificationBefore);
  assert.equal(fixture.store.rows.get('RevenueDeskEventReceipts')[0].STATUS, 'Completed');
});

test('integration: partial schema-v1 handled state is quarantined instead of silently completed', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const metadata = inbound.body.call_inbound.metadata;
  const callId = 'legacy_schema_v1_partial_A';
  assert.equal((await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_ended', callId, metadata, 'A'), env: fixture.env })).status, 200);

  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
  downgradeCanonicalCallToV1(call);
  call.HANDLED_RECORDED = false;
  fixture.store.rows.set('RevenueDeskEventReceipts', []);

  const replay = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_ended', callId, metadata, 'A'), env: fixture.env });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.status, 'Queued');
  assert.equal(fixture.workerErrors.at(-1).code, 'DURABLE_IDEMPOTENCY_CONFLICT');
  assert.equal(call.HANDLED_RECORDED, false);
  assert.equal(fixture.store.rows.get('RevenueDeskDeployments')[0].HANDLED_COUNT, 1);
  assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 0);
  assert.equal(fixture.store.rows.get('RevenueDeskEventReceipts')[0].STATUS,
    'ReconciliationRequired');
  assert.equal(fixture.store.rows.get('RevenueDeskEventReceipts')[0].LAST_ERROR_CODE,
    'DURABLE_IDEMPOTENCY_CONFLICT');

  const duplicate = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_ended', callId, metadata, 'A'), env: fixture.env });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.status, 'ReconciliationRequired');
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(fixture.store.rows.get('RevenueDeskEventReceipts')
    .filter((row) => row.RECEIPT_KIND === 'provider_event').length, 1);
  assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 0);
});

test('integration: an environment-only source revision change cannot impersonate a rebuilt artifact', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env });
  const metadata = inbound.body.call_inbound.metadata;
  const callId = 'revision_delayed_analysis_A';
  await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_ended', callId, metadata, 'A'), env: fixture.env });

  const nextRevision = 'e'.repeat(40);
  fixture.env.SOURCE_REVISION = nextRevision;
  fixture.store.rows.get('RevenueDeskDeployments').forEach((row) => { row.SOURCE_REVISION = nextRevision; });
  fixture.store.rows.get('RevenueDeskConfigurationVersions')
    .forEach((row) => { row.SOURCE_REVISION = nextRevision; });
  const response = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', callId, metadata, 'A'), env: fixture.env });
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'SOURCE_REVISION_MISMATCH');
  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
  assert.equal(call.PROCESSING_STATE, 'AwaitingAnalysis');
  assert.equal(call.SOURCE_REVISION, SOURCE_REVISION);
  assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 0);
  assert.equal(fixture.store.rows.get('RevenueDeskDeployments')[0].HANDLED_COUNT, 1);
});

test('integration: call_ended counts toward the limit while notification waits for analysis', async () => {
  const fixture = runtimeFixture();
  const acceptedCalls = [];
  for (let index = 0; index < 25; index += 1) {
    const inbound = await invoke(fixture.listener, { url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env });
    const callId = `limit_call_${index}`;
    acceptedCalls.push({ callId, metadata: inbound.body.call_inbound.metadata });
    const event = eventPayload('call_ended', callId, inbound.body.call_inbound.metadata, 'A');
    assert.equal((await invoke(fixture.listener, { url: '/retell/events', payload: event, env: fixture.env })).status, 200);
  }
  const deployment = fixture.store.rows.get('RevenueDeskDeployments').find((row) => row.CLIENT_ID === 'client_A');
  assert.equal(deployment.HANDLED_COUNT, 25);
  assert.equal(deployment.TEST_STATUS, 'Completed');
  assert.equal(deployment.STOP_REASON, 'call_limit_reached');
  assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 0);
  assert.equal(fixture.store.rows.get('CRMBillingOperations').length, 0,
    'terminal report waits for every in-flight analysis');
  for (const accepted of acceptedCalls.slice(0, -1)) {
    await invoke(fixture.listener, { url: '/retell/events',
      payload: eventPayload('call_analyzed', accepted.callId, accepted.metadata, 'A'),
      env: fixture.env });
  }
  assert.equal(fixture.store.rows.get('CRMBillingOperations').length, 0,
    'the final in-flight call remains a settlement gate');
  const last = acceptedCalls.at(-1);
  await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', last.callId, last.metadata, 'A'), env: fixture.env });
  await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', last.callId, last.metadata, 'A'), env: fixture.env });
  assert.equal(fixture.store.rows.get('CRMBillingOperations').length, 1);
  assert.equal(fixture.store.rows.get('CRMBillingOperations')[0].ACTION, 'sync_report_summary');
  assert.equal(fixture.store.rows.get('AnalyticsSyncOutbox')
    .filter((row) => row.RECORD_TYPE === 'final_test_result').length, 1);
  fixture.clock.value += 1;
  const extra = await invoke(fixture.listener, {
    url: '/retell/inbound', payload: payloadInbound('A', fixture.clock.value), env: fixture.env,
    signatureTimestamp: fixture.clock.value,
  });
  assert.deepEqual(extra.body, { call_inbound: { reject: true } });
});

test('integration: a pre-expiry in-flight call reopens terminal evidence and creates a new report revision', async () => {
  const fixture = runtimeFixture();
  fixture.store.rows.set('RevenueDeskDeployments', fixture.store.rows.get('RevenueDeskDeployments')
    .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  fixture.store.rows.set('RevenueDeskConfigurationVersions',
    fixture.store.rows.get('RevenueDeskConfigurationVersions')
      .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  for (let index = 0; index < 24; index += 1) {
    const inbound = await invoke(fixture.listener, {
      url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env,
    });
    await invoke(fixture.listener, {
      url: '/retell/events',
      payload: eventPayload('call_analyzed', `late_settlement_${index}`,
        inbound.body.call_inbound.metadata, 'A'),
      env: fixture.env,
    });
  }
  const inFlightInbound = await invoke(fixture.listener, {
    url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env,
  });
  const lateCallId = 'late_settlement_24';

  fixture.clock.value = Date.parse('2026-08-27T12:00:00.000Z');
  const handler = createWorkerJobHandler({
    catalystSdk: fixture.catalystSdk,
    environment: fixture.env,
    now: () => fixture.clock.value,
    storeFactory: () => fixture.store,
  });
  await handler(retryJobRequest(fixture.env), retryJobContext());
  let deployment = fixture.store.rows.get('RevenueDeskDeployments')[0];
  assert.equal(deployment.REPORT_RECONCILIATION_STATUS, 'Completed');
  const firstOperation = structuredClone(fixture.store.rows.get('CRMBillingOperations')[0]);
  const firstFinal = structuredClone(fixture.store.rows.get('AnalyticsSyncOutbox')
    .find((row) => row.RECORD_TYPE === 'final_test_result'));

  await invoke(fixture.listener, {
    url: '/retell/events',
    payload: eventPayload('call_ended', lateCallId,
      inFlightInbound.body.call_inbound.metadata, 'A'),
    env: fixture.env,
    signatureTimestamp: fixture.clock.value,
  });
  deployment = fixture.store.rows.get('RevenueDeskDeployments')[0];
  assert.equal(deployment.HANDLED_COUNT, 25);
  assert.equal(deployment.STOP_REASON, 'seven_day_limit_reached');
  assert.equal(deployment.STOPPED_AT, deployment.EXPIRES_AT);
  assert.equal(deployment.REPORT_RECONCILIATION_STATUS, 'AwaitingSettlement');

  await invoke(fixture.listener, {
    url: '/retell/events',
    payload: eventPayload('call_analyzed', lateCallId,
      inFlightInbound.body.call_inbound.metadata, 'A', { outcome: 'existing_customer' }),
    env: fixture.env,
    signatureTimestamp: fixture.clock.value,
  });
  const operations = fixture.store.rows.get('CRMBillingOperations');
  assert.equal(operations.length, 2);
  assert.deepEqual(operations.find((row) => row.OPERATION_KEY === firstOperation.OPERATION_KEY),
    firstOperation, 'the completed report revision remains immutable');
  const secondOperation = operations.find((row) => row.OPERATION_KEY !== firstOperation.OPERATION_KEY);
  assert.equal(secondOperation.STATUS, 'pending');
  const secondSummary = JSON.parse(secondOperation.OPERATION_PAYLOAD_JSON);
  assert.equal(secondSummary.callsCaptured, 25);
  assert.equal(secondSummary.existingCustomerCalls, 1);
  const finalRows = fixture.store.rows.get('AnalyticsSyncOutbox')
    .filter((row) => row.RECORD_TYPE === 'final_test_result');
  assert.equal(finalRows.length, 2);
  const secondFinal = finalRows.find((row) => row.OUTBOX_KEY !== firstFinal.OUTBOX_KEY);
  assert.ok(Date.parse(secondFinal.SOURCE_MODIFIED_AT) > Date.parse(firstFinal.SOURCE_MODIFIED_AT));
  const lateCall = fixture.store.rows.get('RevenueDeskCalls')
    .find((row) => row.CALL_KEY === callLookupKey(fixture.config.eventSecret, lateCallId));
  assert.ok(Date.parse(lateCall.UPDATED_AT) > fixture.clock.value,
    'same-millisecond call mutations advance the Analytics source watermark');

  await handler(retryJobRequest(fixture.env), retryJobContext());
  deployment = fixture.store.rows.get('RevenueDeskDeployments')[0];
  assert.equal(secondOperation.STATUS, 'completed');
  assert.equal(deployment.REPORT_RECONCILIATION_STATUS, 'Completed');
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
  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
  const canonical = JSON.parse(call.CANONICAL_CALL_JSON);
  assert.equal(canonical.callStatus, 'error');
  assert.equal(canonical.disconnectionReason, 'error_retell');
  assert.equal(call.HANDLED_RECORDED, false);
  assert.equal(fixture.store.rows.get('RevenueDeskDeployments')[0].HANDLED_COUNT, 0);
  assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 0);
});

test('integration: Development readiness is private and minimal Production is unconditionally dark', async () => {
  const fixture = runtimeFixture();
  const denied = await invoke(fixture.listener, { method: 'GET', url: '/internal/readiness', env: fixture.env,
    headers: { 'x-revenue-desk-readiness-token': 'wrong-token' } });
  assert.equal(denied.status, 401);
  const ready = await invoke(fixture.listener, { method: 'GET', url: '/internal/readiness', env: fixture.env,
    headers: { 'x-revenue-desk-readiness-token': fixture.env.INTERNAL_READINESS_TOKEN } });
  assert.equal(ready.body.table_count, 7);
  assert.equal(ready.body.active_authorized_deployment_count, 2);
  assert.equal(ready.body.terminal_reconciliation_pending_count, 0);
  assert.equal(ready.body.mail_mode, 'dry_run');
  assert.equal(ready.body.traffic_enabled, true);
  assert.equal(ready.body.production_activation_authorized, false);

  const darkEnvironment = {
    DEPLOYMENT_ENVIRONMENT: 'production', DEPLOYMENT_MODE: 'dark', SOURCE_REVISION,
  };
  let sdkInitializations = 0;
  let storeAccesses = 0;
  const darkListener = createRequestListener({
    environment: darkEnvironment,
    artifactSourceRevision: SOURCE_REVISION,
    catalystSdk: { initialize() { sdkInitializations += 1; throw new Error('unreachable'); } },
    storeFactory() { storeAccesses += 1; throw new Error('unreachable'); },
  });
  for (const request of [
    { method: 'GET', url: '/internal/readiness' },
    { method: 'POST', url: '/retell/inbound' },
    { method: 'POST', url: '/retell/events' },
  ]) {
    const rejected = await invoke(darkListener, { ...request, env: darkEnvironment });
    assert.equal(rejected.status, 503);
    assert.equal(rejected.body.code, 'PRODUCTION_DARK');
  }
  assert.equal(sdkInitializations, 0);
  assert.equal(storeAccesses, 0);
});

test('integration: retry_scan expires a no-call test, materializes terminal artifacts, and replays once', async () => {
  const fixture = runtimeFixture();
  fixture.store.rows.set('RevenueDeskDeployments', fixture.store.rows.get('RevenueDeskDeployments')
    .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  fixture.store.rows.set('RevenueDeskConfigurationVersions',
    fixture.store.rows.get('RevenueDeskConfigurationVersions')
      .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  fixture.clock.value = Date.parse('2026-08-27T12:00:00.000Z');

  const before = await invoke(fixture.listener, {
    method: 'GET', url: '/internal/readiness', env: fixture.env,
    headers: { 'x-revenue-desk-readiness-token': fixture.env.INTERNAL_READINESS_TOKEN },
  });
  assert.equal(before.status, 200);
  assert.equal(before.body.active_authorized_deployment_count, 0);
  assert.equal(before.body.terminal_reconciliation_pending_count, 1);

  const handler = createWorkerJobHandler({
    catalystSdk: fixture.catalystSdk,
    environment: fixture.env,
    now: () => fixture.clock.value,
    storeFactory: () => fixture.store,
  });
  await handler(retryJobRequest(fixture.env), retryJobContext());
  await handler(retryJobRequest(fixture.env), retryJobContext());

  const deployment = fixture.store.rows.get('RevenueDeskDeployments')[0];
  assert.equal(deployment.TEST_STATUS, 'Completed');
  assert.equal(deployment.STOP_REASON, 'seven_day_limit_reached');
  assert.equal(deployment.STOPPED_AT, deployment.EXPIRES_AT);
  assert.equal(deployment.REPORT_RECONCILIATION_STATUS, 'Completed');
  const operations = fixture.store.rows.get('CRMBillingOperations');
  assert.equal(operations.length, 1);
  const summary = JSON.parse(operations[0].OPERATION_PAYLOAD_JSON);
  assert.equal(summary.callsCaptured, 0);
  assert.equal(summary.testEndAt, deployment.EXPIRES_AT);
  assert.equal(summary.testEndReason, 'Seven-Day Limit Reached');
  assert.equal(fixture.store.rows.get('AnalyticsSyncOutbox')
    .filter((row) => row.RECORD_TYPE === 'final_test_result').length, 1);

  const after = await invoke(fixture.listener, {
    method: 'GET', url: '/internal/readiness', env: fixture.env,
    headers: { 'x-revenue-desk-readiness-token': fixture.env.INTERNAL_READINESS_TOKEN },
  });
  assert.equal(after.body.terminal_reconciliation_pending_count, 0);
});

test('integration: readiness tracks CRM states and retry_scan repairs missing or corrupt terminal artifacts', async () => {
  const fixture = runtimeFixture();
  fixture.store.rows.set('RevenueDeskDeployments', fixture.store.rows.get('RevenueDeskDeployments')
    .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  fixture.store.rows.set('RevenueDeskConfigurationVersions',
    fixture.store.rows.get('RevenueDeskConfigurationVersions')
      .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  fixture.clock.value = Date.parse('2026-08-27T12:00:00.000Z');
  const service = createRuntimeService({
    store: fixture.store, mailAdapter: {}, config: fixture.config,
    now: () => fixture.clock.value,
  });
  const first = await service.reconcileDueDeployments(25);
  assert.equal(first.results[0].status, 'AwaitingCrmReportReadback');
  const operation = fixture.store.rows.get('CRMBillingOperations')[0];
  assert.equal(operation.STATUS, 'pending');
  assert.equal((await service.readiness()).terminalReconciliationPendingCount, 1);

  for (const status of ['processing', 'reconciliation_required']) {
    await fixture.store.mutate('CRMBillingOperations', 'OPERATION_KEY', operation.OPERATION_KEY,
      'OPERATION_VERSION', () => ({ STATUS: status, LAST_OUTCOME: 'report_summary_readback_required' }));
    assert.equal((await service.readiness()).terminalReconciliationPendingCount, 1);
  }
  await fixture.store.mutate('CRMBillingOperations', 'OPERATION_KEY', operation.OPERATION_KEY,
    'OPERATION_VERSION', () => ({
      STATUS: 'completed', LAST_OUTCOME: 'report_summary_readback_confirmed',
    }));
  assert.equal((await service.readiness()).terminalReconciliationPendingCount, 1,
    'the deployment marker remains pending until the completed CRM row is reconciled');
  await service.reconcileDeployment('deployment_A');
  assert.equal((await service.readiness()).terminalReconciliationPendingCount, 0);

  const expectedFinal = structuredClone(fixture.store.rows.get('AnalyticsSyncOutbox')
    .find((row) => row.RECORD_TYPE === 'final_test_result'));
  fixture.store.rows.set('AnalyticsSyncOutbox', fixture.store.rows.get('AnalyticsSyncOutbox')
    .filter((row) => row.RECORD_TYPE !== 'final_test_result'));
  const handler = createWorkerJobHandler({
    catalystSdk: fixture.catalystSdk,
    environment: fixture.env,
    now: () => fixture.clock.value,
    storeFactory: () => fixture.store,
  });
  await handler(retryJobRequest(fixture.env), retryJobContext());
  let repaired = fixture.store.rows.get('AnalyticsSyncOutbox')
    .find((row) => row.OUTBOX_KEY === expectedFinal.OUTBOX_KEY);
  assert.ok(repaired, 'retry_scan restores a missing final artifact');
  for (const column of OUTBOX_IMMUTABLE) assert.equal(repaired[column], expectedFinal[column]);

  const fenceBeforeCorruption = Number(repaired.FENCE_VERSION);
  Object.assign(repaired, {
    PAYLOAD_HASH: '0'.repeat(64), SYNC_STATUS: 'Succeeded',
    LEASE_OWNER: 'synthetic_worker', LEASE_TOKEN: 's'.repeat(32),
    LEASE_EXPIRES_AT: '2026-08-27T12:05:00.000Z',
    PROVIDER_JOB_ID: 'synthetic_job', PROVIDER_STATE: 'submitted',
  });
  await handler(retryJobRequest(fixture.env), retryJobContext());
  repaired = fixture.store.rows.get('AnalyticsSyncOutbox')
    .find((row) => row.OUTBOX_KEY === expectedFinal.OUTBOX_KEY);
  for (const column of OUTBOX_IMMUTABLE) assert.equal(repaired[column], expectedFinal[column]);
  assert.equal(repaired.SYNC_STATUS, 'Pending');
  for (const column of [
    'LEASE_OWNER', 'LEASE_TOKEN', 'LEASE_EXPIRES_AT', 'PROVIDER_JOB_ID', 'PROVIDER_STATE',
  ]) assert.equal(repaired[column], null, column);
  assert.equal(Number(repaired.FENCE_VERSION), fenceBeforeCorruption + 1,
    'repair fences any pre-existing Analytics owner before retry');
  assert.equal(fixture.store.rows.get('AnalyticsSyncOutbox')
    .filter((row) => row.OUTBOX_KEY === expectedFinal.OUTBOX_KEY).length, 1);

  const fenceBeforeKeyRepair = Number(repaired.FENCE_VERSION);
  repaired.OUTBOX_KEY = 'f'.repeat(64);
  await handler(retryJobRequest(fixture.env), retryJobContext());
  repaired = fixture.store.rows.get('AnalyticsSyncOutbox')
    .find((row) => row.OUTBOX_KEY === expectedFinal.OUTBOX_KEY);
  assert.ok(repaired, 'the bounded provider identity lookup repairs a corrupt outbox key');
  assert.equal(Number(repaired.FENCE_VERSION), fenceBeforeKeyRepair + 1);
  await handler(retryJobRequest(fixture.env), retryJobContext());
  assert.equal(fixture.store.rows.get('AnalyticsSyncOutbox')
    .filter((row) => row.OUTBOX_KEY === expectedFinal.OUTBOX_KEY).length, 1);
  assert.equal(fixture.store.rows.get('RevenueDeskDeployments')[0]
    .REPORT_RECONCILIATION_STATUS, 'Completed');
  assert.equal((await service.readiness()).terminalReconciliationPendingCount, 0);
});

test('integration: final artifact reconciliation never overwrites a divergent payload', async () => {
  const { fixture, service, finalRow } = await reconciledTerminalAnalyticsFixture();
  const divergent = JSON.parse(finalRow.PAYLOAD_JSON);
  divergent.QUALIFIED_OPPORTUNITIES += 1;
  finalRow.PAYLOAD_JSON = canonicalJson(divergent);
  finalRow.PAYLOAD_HASH = sha256(finalRow.PAYLOAD_JSON);
  finalRow.SYNC_STATUS = 'Succeeded';
  const before = structuredClone(finalRow);

  await assert.rejects(service.reconcileDeployment('deployment_A'), {
    code: 'DURABLE_IDEMPOTENCY_CONFLICT',
  });
  const after = fixture.store.rows.get('AnalyticsSyncOutbox')
    .find((row) => row.ROWID === before.ROWID);
  assert.deepEqual(after, before, 'conflicting payload remains untouched for operator review');
});

test('integration: final artifact reconciliation fails closed on ambiguous identity fallback', async () => {
  const { fixture, service, finalRow } = await reconciledTerminalAnalyticsFixture();
  finalRow.OUTBOX_KEY = 'd'.repeat(64);
  const duplicate = {
    ...structuredClone(finalRow), OUTBOX_KEY: 'e'.repeat(64), ROWID: '999999',
  };
  fixture.store.rows.get('AnalyticsSyncOutbox').push(duplicate);
  const before = structuredClone(fixture.store.rows.get('AnalyticsSyncOutbox')
    .filter((row) => row.RECORD_TYPE === 'final_test_result'));

  await assert.rejects(service.reconcileDeployment('deployment_A'), {
    code: 'AMBIGUOUS_DURABLE_OWNERSHIP',
  });
  assert.deepEqual(fixture.store.rows.get('AnalyticsSyncOutbox')
    .filter((row) => row.RECORD_TYPE === 'final_test_result'), before,
  'ambiguous candidates remain untouched for operator review');
});

test('integration: exact final key cannot hide a corrupt-key duplicate identity', async () => {
  const { fixture, service, finalRow } = await reconciledTerminalAnalyticsFixture();
  const duplicate = {
    ...structuredClone(finalRow), OUTBOX_KEY: 'e'.repeat(64), ROWID: '999999',
  };
  fixture.store.rows.get('AnalyticsSyncOutbox').push(duplicate);
  const before = structuredClone(fixture.store.rows.get('AnalyticsSyncOutbox')
    .filter((row) => row.RECORD_TYPE === 'final_test_result'));

  await assert.rejects(service.reconcileDeployment('deployment_A'), {
    code: 'AMBIGUOUS_DURABLE_OWNERSHIP',
  });
  assert.deepEqual(fixture.store.rows.get('AnalyticsSyncOutbox')
    .filter((row) => row.RECORD_TYPE === 'final_test_result'), before,
  'the exact row and corrupt-key duplicate remain untouched for operator review');
});

test('integration: retry_scan recovers an AwaitingSettlement row after a lost terminal wakeup', async () => {
  const fixture = runtimeFixture();
  fixture.store.rows.set('RevenueDeskDeployments', fixture.store.rows.get('RevenueDeskDeployments')
    .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  fixture.store.rows.set('RevenueDeskConfigurationVersions',
    fixture.store.rows.get('RevenueDeskConfigurationVersions')
      .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  const inbound = await invoke(fixture.listener, {
    url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env,
  });
  await invoke(fixture.listener, {
    url: '/retell/events',
    payload: eventPayload('call_analyzed', 'lost_terminal_wakeup_A',
      inbound.body.call_inbound.metadata, 'A'),
    env: fixture.env,
  });
  const deployment = fixture.store.rows.get('RevenueDeskDeployments')[0];
  fixture.clock.value = Date.parse(deployment.EXPIRES_AT);
  Object.assign(deployment, {
    TEST_STATUS: 'Completed', STOP_REASON: 'seven_day_limit_reached',
    STOPPED_AT: deployment.EXPIRES_AT,
    REPORT_RECONCILIATION_STATUS: 'AwaitingSettlement',
    REPORT_RECONCILIATION_VERSION: 1,
    UPDATED_AT: new Date(fixture.clock.value - 1000).toISOString(),
  });

  const handler = createWorkerJobHandler({
    catalystSdk: fixture.catalystSdk,
    environment: fixture.env,
    now: () => fixture.clock.value,
    storeFactory: () => fixture.store,
  });
  const result = await handler(retryJobRequest(fixture.env), retryJobContext());
  assert.equal(result.deployments.examined, 1);
  assert.equal(result.reportSummaries.examined, 1);
  assert.equal(deployment.REPORT_RECONCILIATION_STATUS, 'Completed');
  assert.equal(fixture.store.rows.get('CRMBillingOperations').length, 1);
  assert.equal(fixture.store.rows.get('CRMBillingOperations')[0].STATUS, 'completed');
  assert.equal(fixture.store.rows.get('AnalyticsSyncOutbox')
    .filter((row) => row.RECORD_TYPE === 'final_test_result').length, 1);
});

test('integration: documented Development hosts pass while a production-shaped host fails before SDK initialization', async () => {
  const alternateDevelopmentHost = 'revenue-desk-call-runtime.development.zohocatalyst.com';
  const alternate = runtimeFixture({ environment: { REVENUE_DESK_RUNTIME_HOST: alternateDevelopmentHost } });
  const accepted = await invoke(alternate.listener, { url: '/retell/inbound', payload: payloadInbound('A'),
    env: alternate.env, headers: { host: alternateDevelopmentHost } });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.call_inbound.dynamic_variables.resolver_status, 'Resolved');

  const defaultTlsPort = runtimeFixture();
  const acceptedDefaultTlsPort = await invoke(defaultTlsPort.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: defaultTlsPort.env,
    headers: { host: `${defaultTlsPort.env.REVENUE_DESK_RUNTIME_HOST}:443` } });
  assert.equal(acceptedDefaultTlsPort.status, 200);
  assert.equal(acceptedDefaultTlsPort.body.call_inbound.dynamic_variables.resolver_status, 'Resolved');

  const fixture = runtimeFixture();
  const rejected = await invoke(fixture.listener, { url: '/retell/inbound', payload: payloadInbound('A'),
    env: fixture.env, headers: { host: 'revenue-desk-call-runtime.catalystserverless.com' } });
  assert.equal(rejected.status, 503);
  assert.equal(rejected.body.code, 'CATALYST_HOST_MISMATCH');
  assert.equal(fixture.initialized, 0);

  for (const invalidAuthority of [
    `${fixture.env.REVENUE_DESK_RUNTIME_HOST}:80`,
    `${fixture.env.REVENUE_DESK_RUNTIME_HOST}:444`,
    `user@${fixture.env.REVENUE_DESK_RUNTIME_HOST}`,
    `${fixture.env.REVENUE_DESK_RUNTIME_HOST}/path`,
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
  assert.equal(productionSdk.store.rows.get('RevenueDeskCalls').length, 0);
  assert.equal(productionSdk.mailAccesses, 0);

  for (const environmentValue of ['', null, undefined, {}]) {
    const missingSdkEnvironment = runtimeFixture();
    missingSdkEnvironment.app.config.environment = environmentValue;
    const rejectedMissingSdkEnvironment = await invoke(missingSdkEnvironment.listener, {
      url: '/retell/inbound', payload: payloadInbound('A'), env: missingSdkEnvironment.env });
    assert.equal(rejectedMissingSdkEnvironment.status, 503);
    assert.equal(rejectedMissingSdkEnvironment.body.code, 'CATALYST_ENVIRONMENT_MISMATCH');
    assert.equal(missingSdkEnvironment.store.rows.get('RevenueDeskCalls').length, 0);
    assert.equal(missingSdkEnvironment.mailAccesses, 0);
  }

  const sdkMismatch = runtimeFixture();
  sdkMismatch.app.config.projectId = '999';
  const rejectedProject = await invoke(sdkMismatch.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: sdkMismatch.env });
  assert.equal(rejectedProject.status, 503);
  assert.equal(rejectedProject.body.code, 'CATALYST_PROJECT_MISMATCH');
  assert.equal(sdkMismatch.store.rows.get('RevenueDeskCalls').length, 0);
  assert.equal(sdkMismatch.mailAccesses, 0);

  const projectKeyMismatch = runtimeFixture();
  projectKeyMismatch.app.config.projectKey = 'invalid project key';
  const rejectedProjectKey = await invoke(projectKeyMismatch.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: projectKeyMismatch.env });
  assert.equal(rejectedProjectKey.status, 503);
  assert.equal(rejectedProjectKey.body.code, 'CATALYST_PROJECT_MISMATCH');
  assert.equal(projectKeyMismatch.store.rows.get('RevenueDeskCalls').length, 0);
  assert.equal(projectKeyMismatch.mailAccesses, 0);
});

test('integration: duplicate readiness token header fails closed', async () => {
  const fixture = runtimeFixture();
  const token = fixture.env.INTERNAL_READINESS_TOKEN;
  const rejected = await invoke(fixture.listener, { method: 'GET', url: '/internal/readiness', env: fixture.env,
    headers: { 'x-revenue-desk-readiness-token': token }, rawHeaders: [
      'host', fixture.env.REVENUE_DESK_RUNTIME_HOST,
      'x-revenue-desk-readiness-token', token,
      'x-revenue-desk-readiness-token', token,
    ] });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.code, 'INVALID_REQUEST_HEADER');
});

test('integration: gateway exposes only the three exact Advanced I/O routes', async () => {
  const fixture = runtimeFixture();
  const rejected = await invoke(fixture.listener, { url: '/retell/inbound?tenant=client_A',
    payload: payloadInbound('A'), env: fixture.env });
  assert.equal(rejected.status, 404);
  assert.equal(rejected.body.code, 'ROUTE_NOT_FOUND');
  assert.equal(fixture.initialized, 0);

  const approvalRoute = runtimeFixture();
  const approvalRejected = await invoke(approvalRoute.listener, {
    url: '/internal/approval', payload: {}, env: approvalRoute.env,
  });
  assert.equal(approvalRejected.status, 404);
  assert.equal(approvalRejected.body.code, 'ROUTE_NOT_FOUND');
  assert.equal(approvalRoute.initialized, 0);
});

test('integration: authenticated malformed event creates one replay-safe minimized quarantine receipt', async () => {
  const fixture = runtimeFixture();
  const malformed = { event: 'call_analyzed', call: { agent_id: 'agent_shared_free_test' } };
  const first = await invoke(fixture.listener, { url: '/retell/events', payload: malformed, env: fixture.env });
  const replay = await invoke(fixture.listener, { url: '/retell/events', payload: malformed, env: fixture.env });
  assert.equal(first.status, 400);
  assert.equal(replay.status, 400);
  const receipts = fixture.store.rows.get('RevenueDeskEventReceipts');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].STATUS, 'TerminalFailure');
  assert.equal(receipts[0].EVENT_DATA_JSON, '{}');
  assert.equal(JSON.stringify(receipts[0]).includes('agent_shared_free_test'), false);
});

test('integration: Catalyst retry job honors notification backoff and converges an explicit pre-send rejection', async () => {
  let sends = 0;
  const fixture = runtimeFixture({
    environment: { REVENUE_DESK_NOTIFICATION_MODE: 'send_development' },
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
  const notification = fixture.store.rows.get('RevenueDeskNotifications')[0];
  assert.equal(notification.STATUS, 'RetryRequired');
  assert.equal(notification.ATTEMPT_COUNT, 1);
  const context = retryJobContext({ closed: false, closeWithSuccess() { this.closed = true; } });
  const handler = createWorkerJobHandler({ catalystSdk: fixture.catalystSdk, environment: fixture.env,
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
  assert.equal(fixture.store.rows.get('RevenueDeskCalls')[0].NOTIFICATION_STATE, 'Sent');
  assert.equal(context.closed, true);
});

test('integration: repeated retryable Mail rejections stop durably after the third attempt', async () => {
  let sends = 0;
  const fixture = runtimeFixture({
    environment: { REVENUE_DESK_NOTIFICATION_MODE: 'send_development' },
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
  const notification = fixture.store.rows.get('RevenueDeskNotifications')[0];
  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
  assert.equal(notification.STATUS, 'RetryRequired');
  assert.equal(notification.ATTEMPT_COUNT, 1);

  const handler = createWorkerJobHandler({ catalystSdk: fixture.catalystSdk,
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
  const notification = fixture.store.rows.get('RevenueDeskNotifications')[0];
  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
  Object.assign(notification, { STATUS: 'Pending', ATTEMPT_COUNT: 0, PROVIDER_CODE: 'NOT_ATTEMPTED',
    PROVIDER_RESULT_REFERENCE: null, SEND_TOKEN: null, LAST_ATTEMPT_AT: null,
    NEXT_ATTEMPT_AT: null, LAST_ERROR_CODE: null });
  call.NOTIFICATION_STATE = 'Pending';

  const query = fixture.store.query.bind(fixture.store);
  let failCallRead = true;
  fixture.store.query = async (...args) => {
    if (failCallRead && args[0] === 'RevenueDeskCalls' && args[1] === 'CALL_KEY') {
      failCallRead = false;
      throw new RevenueDeskError('CATALYST_QUERY_FAILED', 'synthetic transient call read',
        { httpStatus: 503, retryable: true });
    }
    return query(...args);
  };
  const sendEnvironment = { ...fixture.env, REVENUE_DESK_NOTIFICATION_MODE: 'send_development' };
  const handler = createWorkerJobHandler({ catalystSdk: fixture.catalystSdk,
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
  const notification = fixture.store.rows.get('RevenueDeskNotifications')[0];
  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
  Object.assign(notification, { STATUS: 'Pending', ATTEMPT_COUNT: 0, PROVIDER_CODE: 'NOT_ATTEMPTED',
    PROVIDER_RESULT_REFERENCE: null, SEND_TOKEN: null, LAST_ATTEMPT_AT: null,
    NEXT_ATTEMPT_AT: null, LAST_ERROR_CODE: null });
  call.NOTIFICATION_STATE = 'Pending';

  const query = fixture.store.query.bind(fixture.store);
  let failNextCallRead = false;
  fixture.store.query = async (...args) => {
    if (failNextCallRead && args[0] === 'RevenueDeskCalls' && args[1] === 'CALL_KEY') {
      failNextCallRead = false;
      throw new RevenueDeskError('CATALYST_QUERY_FAILED', 'synthetic persistent call read',
        { httpStatus: 503, retryable: true });
    }
    return query(...args);
  };
  const sendEnvironment = { ...fixture.env, REVENUE_DESK_NOTIFICATION_MODE: 'send_development' };
  const handler = createWorkerJobHandler({ catalystSdk: fixture.catalystSdk,
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
  const notification = fixture.store.rows.get('RevenueDeskNotifications')[0];
  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
  Object.assign(notification, { STATUS: 'Sending', SEND_TOKEN: 'e'.repeat(32),
    LAST_ATTEMPT_AT: new Date(fixture.clock.value - 10_000).toISOString() });
  call.NOTIFICATION_STATE = 'Sending';
  const handler = createWorkerJobHandler({ catalystSdk: fixture.catalystSdk, environment: fixture.env,
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
    if (failOnce && args[0] === 'RevenueDeskDeployments' && args[1] === 'DEPLOYMENT_ID') {
      failOnce = false;
      throw new RevenueDeskError('CATALYST_QUERY_FAILED', 'synthetic transient query',
        { httpStatus: 503, retryable: true });
    }
    return query(...args);
  };
  const failed = await invoke(fixture.listener, { url: '/retell/events', payload: event, env: fixture.env });
  assert.equal(failed.status, 200);
  assert.equal(failed.body.status, 'Queued');
  const receipt = fixture.store.rows.get('RevenueDeskEventReceipts')
    .find((row) => row.RECEIPT_KIND === 'provider_event');
  assert.equal(receipt.STATUS, 'RetryRequired');
  assert.equal(JSON.parse(receipt.EVENT_DATA_JSON).numberLookupHash.startsWith('num_'), true);
  assert.equal(receipt.EVENT_DATA_JSON.includes('+1555'), false);
  const handler = createWorkerJobHandler({ catalystSdk: fixture.catalystSdk, environment: fixture.env,
    now: () => fixture.clock.value, storeFactory: () => fixture.store });
  assert.equal((await handler(retryJobRequest(fixture.env), retryJobContext())).events.examined, 0);
  fixture.clock.value += 1000;
  assert.equal((await handler(retryJobRequest(fixture.env), retryJobContext())).events.results[0].status, 'Completed');
  assert.equal(receipt.STATUS, 'Completed');
  assert.equal(fixture.store.rows.get('RevenueDeskCalls').length, 1);
  assert.equal(fixture.store.rows.get('RevenueDeskDeployments')[0].HANDLED_COUNT, 1);
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
    if (failOnce && args[0] === 'RevenueDeskDeployments' && args[1] === 'DEPLOYMENT_ID') {
      failOnce = false;
      throw new RevenueDeskError('CATALYST_QUERY_FAILED', 'synthetic transient query',
        { httpStatus: 503, retryable: true });
    }
    return query(...args);
  };
  await invoke(fixture.listener, { url: '/retell/events', payload: event, env: fixture.env });
  const receipt = fixture.store.rows.get('RevenueDeskEventReceipts')
    .find((row) => row.RECEIPT_KIND === 'provider_event');
  receipt.EVENT_DATA_JSON = '{';
  fixture.clock.value += 1000;
  const handler = createWorkerJobHandler({ catalystSdk: fixture.catalystSdk, environment: fixture.env,
    now: () => fixture.clock.value, storeFactory: () => fixture.store });
  const result = await handler(retryJobRequest(fixture.env), retryJobContext());
  assert.deepEqual(result.events.results,
    [{ status: 'TerminalFailure', errorCode: 'CONFIGURATION_UNAVAILABLE' }]);
  assert.equal(receipt.STATUS, 'TerminalFailure');
  assert.equal(receipt.LEASE_TOKEN, null);
  assert.equal(receipt.LAST_ERROR_CODE, 'CONFIGURATION_UNAVAILABLE');
});

test('integration: canonical-table report query and CSV remain client partitioned and value-evidence explicit', async () => {
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
  const completed = fixture.store.rows.get('RevenueDeskCalls')[0];
  fixture.store.rows.get('RevenueDeskCalls').push({ ...structuredClone(completed), ROWID: '999',
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
  assert.match(header, /^recordType,clientId,deploymentId,configurationVersionId,configurationVersion,engagementType,capabilityProfile,coverageMode,/);
  assert.match(summary, /^summary,client_A,deployment_A,configuration_version_A,cfg_A_v1,free_test,call_gap_monitor_v1,AfterHoursOnly,1,0,1,/);
  assert.equal(callRows.length, report.calls.length);
  assert.ok(callRows.every((row) => row.startsWith(
    'call,client_A,deployment_A,configuration_version_A,cfg_A_v1,free_test,call_gap_monitor_v1,',
  )));
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

test('integration: only a terminal authoritative report emits one immutable sanitized final-test fact', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, {
    url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env,
  });
  await invoke(fixture.listener, {
    url: '/retell/events',
    payload: eventPayload('call_analyzed', 'final_report_A',
      inbound.body.call_inbound.metadata, 'A', {
        outcome: 'potential_job', bookable_opportunity: true,
        office_follow_up_required: true,
        workflow_failure_code: null, workflow_failure_text: null,
      }),
    env: fixture.env,
  });
  const handler = createWorkerJobHandler({
    catalystSdk: fixture.catalystSdk,
    environment: fixture.env,
    now: () => fixture.clock.value,
    storeFactory: () => fixture.store,
  });
  const request = retryJobRequest(fixture.env, {
    mode: 'rebuild_report', deployment_id: 'deployment_A',
  });
  await handler(request, retryJobContext());
  assert.equal(fixture.store.rows.get('AnalyticsSyncOutbox')
    .filter((row) => row.RECORD_TYPE === 'final_test_result').length, 0);

  fixture.clock.value = Date.parse('2026-08-27T12:00:00.000Z');
  await handler(request, retryJobContext());
  await handler(request, retryJobContext());
  const finalRows = fixture.store.rows.get('AnalyticsSyncOutbox')
    .filter((row) => row.RECORD_TYPE === 'final_test_result');
  assert.equal(finalRows.length, 1);
  const parsed = parseOutboxRow(finalRows[0], 'development');
  assert.deepEqual({
    endedAt: parsed.fact.TEST_ENDED_AT,
    endReason: parsed.fact.TEST_END_REASON,
    calls: parsed.fact.CALLS_CAPTURED,
    opportunities: parsed.fact.QUALIFIED_OPPORTUNITIES,
  }, {
    endedAt: '2026-08-27T12:00:00.000Z',
    endReason: 'seven_day_limit_reached',
    calls: 1,
    opportunities: 1,
  });
  assert.equal(parsed.fact.RECORD_KEY, parsed.fact.DEPLOYMENT_KEY);
  assert.equal(parsed.fact.ENGAGEMENT_TYPE, 'free_test');
  assert.equal(parsed.fact.DURATION_EVIDENCE_COMPLETE, true);
  assert.equal(parsed.fact.ANALYSIS_EVIDENCE_COMPLETE, true);
  assert.doesNotMatch(finalRows[0].PAYLOAD_JSON,
    /Caller|Synthetic Plumbing|\+1555|email|transcript|recording|secret/i);
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
  assert.equal(report.observedWorkflowFailures, null);
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
  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
  call.CANONICAL_CALL_JSON = JSON.stringify({ ...JSON.parse(call.CANONICAL_CALL_JSON),
    clientId: 'client_B' });
  const corruptedCall = structuredClone(call);
  const countBefore = fixture.store.rows.get('RevenueDeskDeployments')[0].HANDLED_COUNT;
  const conflictedEvent = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_ended', 'canonical_conflict_A',
      inbound.body.call_inbound.metadata, 'A'), env: fixture.env });
  assert.equal(conflictedEvent.status, 200);
  assert.equal(conflictedEvent.body.status, 'Queued');
  assert.equal(fixture.workerErrors.at(-1).code, 'CALL_OWNERSHIP_UNRESOLVED');
  assert.deepEqual(call, corruptedCall);
  assert.equal(fixture.store.rows.get('RevenueDeskDeployments')[0].HANDLED_COUNT, countBefore);
  const notification = fixture.store.rows.get('RevenueDeskNotifications')[0];
  Object.assign(notification, { STATUS: 'Pending', NEXT_ATTEMPT_AT: null });
  let prepares = 0;
  let sends = 0;
  const handler = createWorkerJobHandler({
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

test('integration: engagement, capability, and immutable configuration identity cannot cross call ownership', async () => {
  for (const [field, value] of [
    ['ENGAGEMENT_TYPE', 'paid_service'],
    ['CAPABILITY_PROFILE', 'launch_v1'],
    ['CONFIGURATION_VERSION_ID', 'configuration_version_conflict'],
  ]) {
    const fixture = runtimeFixture();
    const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
      payload: payloadInbound('A'), env: fixture.env });
    await invoke(fixture.listener, { url: '/retell/events',
      payload: eventPayload('call_analyzed', `attribution_${field}`, inbound.body.call_inbound.metadata, 'A'),
      env: fixture.env });
    fixture.store.rows.get('RevenueDeskCalls')[0][field] = value;
    await assert.rejects(queryClientReport(fixture.store, fixture.config,
      'client_A', 'deployment_A', fixture.clock.value), { code: 'REPORT_OWNERSHIP_CONFLICT' });
  }
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

  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
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

  const deployment = fixture.store.rows.get('RevenueDeskDeployments')[0];
  const countedCallKeys = deployment.COUNTED_CALL_KEYS_JSON;
  deployment.COUNTED_CALL_KEYS_JSON = JSON.stringify([`call_${'e'.repeat(64)}`]);
  await assert.rejects(
    queryClientReport(fixture.store, fixture.config,
      'client_A', 'deployment_A', fixture.clock.value),
    { code: 'REPORT_RECONCILIATION_REQUIRED' },
  );
  deployment.COUNTED_CALL_KEYS_JSON = countedCallKeys;

  const notification = fixture.store.rows.get('RevenueDeskNotifications')[0];
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
  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
  call.CANONICAL_CALL_JSON = JSON.stringify({ ...JSON.parse(call.CANONICAL_CALL_JSON),
    deploymentId: 'deployment_B' });

  const analyzed = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', callId, metadata, 'A'), env: fixture.env });
  assert.equal(analyzed.status, 200);
  assert.equal(analyzed.body.status, 'Queued');
  assert.equal(fixture.workerErrors.at(-1).code, 'CALL_OWNERSHIP_UNRESOLVED');
  assert.equal(JSON.parse(call.CANONICAL_CALL_JSON).deploymentId, 'deployment_B');
  assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 0);
  assert.equal(fixture.store.rows.get('RevenueDeskDeployments')[0].HANDLED_COUNT, 1);
  assert.equal(fixture.store.rows.get('RevenueDeskEventReceipts').at(-1).STATUS, 'TerminalFailure');
});

test('integration: event retry lanes are provider-bounded, due-ordered, and fair around poison', async () => {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, {
    url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env,
  });
  for (let index = 0; index < 7; index += 1) {
    await invoke(fixture.listener, {
      url: '/retell/events',
      payload: eventPayload('call_ended', `bounded_event_lane_${index}`,
        inbound.body.call_inbound.metadata, 'A'),
      env: fixture.env,
      processJobs: false,
    });
  }
  const receipts = fixture.store.rows.get('RevenueDeskEventReceipts')
    .filter((row) => row.RECEIPT_KIND === 'provider_event');
  const timestamp = (offset) => new Date(fixture.clock.value + offset).toISOString();
  receipts.forEach((row, index) => Object.assign(row, {
    STATUS: index < 4 ? 'Pending' : index === 4 ? 'Queued'
      : index === 5 ? 'RetryRequired' : 'Processing',
    RECEIVED_AT: timestamp(-7000 + index * 500),
    PROCESSED_AT: null,
    LEASE_TOKEN: null,
    LEASE_EXPIRES_AT: index === 6 ? timestamp(-2000) : null,
    NEXT_ATTEMPT_AT: index === 5 ? timestamp(-3000) : null,
  }));
  receipts[6].LEASE_TOKEN = 'a'.repeat(32);
  receipts[0].EVENT_DATA_JSON = '{';

  const query = fixture.store.query.bind(fixture.store);
  fixture.store.query = async (...args) => {
    if (args[0] === 'RevenueDeskEventReceipts' && args[1] === 'STATUS') {
      throw new Error('event retry candidates must use queryBounded');
    }
    return query(...args);
  };
  const service = createRuntimeService({
    store: fixture.store,
    mailAdapter: {},
    config: fixture.config,
    now: () => fixture.clock.value,
  });
  const result = await service.retryDueEvents(4);
  assert.equal(result.examined, 4);
  assert.deepEqual(result.results.map((item) => item.status).sort(),
    ['Completed', 'Completed', 'Completed', 'TerminalFailure']);
  assert.equal(receipts[0].STATUS, 'TerminalFailure');
  assert.equal(receipts[4].STATUS, 'Completed');
  assert.equal(receipts[5].STATUS, 'Completed');
  assert.equal(receipts[6].STATUS, 'Completed');
  assert.equal(receipts.slice(1, 4).every((row) => row.STATUS === 'Pending'), true,
    'the busy Pending lane cannot consume another lane\'s reserved capacity');
  assert.equal(fixture.store.rows.get('RevenueDeskCalls').length, 3);
});

test('integration: notification retry lanes contain poison without starving stale or retry work', async () => {
  const fixture = runtimeFixture();
  for (let index = 0; index < 4; index += 1) {
    const inbound = await invoke(fixture.listener, {
      url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env,
    });
    await invoke(fixture.listener, {
      url: '/retell/events',
      payload: eventPayload('call_analyzed', `bounded_notification_lane_${index}`,
        inbound.body.call_inbound.metadata, 'A'),
      env: fixture.env,
    });
  }
  const notifications = fixture.store.rows.get('RevenueDeskNotifications');
  const calls = fixture.store.rows.get('RevenueDeskCalls');
  const timestamp = (offset) => new Date(fixture.clock.value + offset).toISOString();
  Object.assign(notifications[0], {
    STATUS: 'Pending', CREATED_AT: 'not-a-timestamp', NEXT_ATTEMPT_AT: null,
    SEND_TOKEN: null,
  });
  calls[0].NOTIFICATION_STATE = 'Pending';
  Object.assign(notifications[1], {
    STATUS: 'Pending', CREATED_AT: timestamp(-4000), NEXT_ATTEMPT_AT: null,
    SEND_TOKEN: null,
  });
  calls[1].NOTIFICATION_STATE = 'Pending';
  Object.assign(notifications[2], {
    STATUS: 'RetryRequired', NEXT_ATTEMPT_AT: timestamp(-3000), SEND_TOKEN: null,
  });
  calls[2].NOTIFICATION_STATE = 'RetryRequired';
  Object.assign(notifications[3], {
    STATUS: 'Sending', LAST_ATTEMPT_AT: timestamp(-10_000),
    SEND_TOKEN: 'b'.repeat(32), NEXT_ATTEMPT_AT: null,
  });
  calls[3].NOTIFICATION_STATE = 'Sending';

  const query = fixture.store.query.bind(fixture.store);
  fixture.store.query = async (...args) => {
    if (args[0] === 'RevenueDeskNotifications' && args[1] === 'STATUS') {
      throw new Error('notification retry candidates and counts must use queryBounded');
    }
    return query(...args);
  };
  const service = createRuntimeService({
    store: fixture.store,
    mailAdapter: new CatalystMailAdapter({ app: fixture.app, config: fixture.config }),
    config: fixture.config,
    now: () => fixture.clock.value,
  });
  const first = await service.retryDueNotifications(3);
  assert.equal(first.examined, 2);
  assert.equal(first.staleSending, 1);
  assert.deepEqual(first.results.map((item) => item.status).sort(),
    ['DryRunRecorded', 'ReconciliationRequired']);
  assert.equal(first.reconciliationRequired, 2);
  assert.equal(first.reconciliationRequiredCapped, false);
  assert.equal(notifications[0].STATUS, 'ReconciliationRequired');
  assert.equal(notifications[1].STATUS, 'Pending');
  assert.equal(notifications[2].STATUS, 'DryRunRecorded');
  assert.equal(notifications[3].STATUS, 'Ambiguous');
  const second = await service.retryDueNotifications(3);
  assert.equal(second.examined, 1);
  assert.equal(notifications[1].STATUS, 'DryRunRecorded');
  assert.equal(fixture.mailAccesses, 0);
});

test('integration: CRM report-summary poison rotates fairly across every lane with a five-row cap', async () => {
  const fixture = runtimeFixture();
  fixture.store.rows.set('RevenueDeskDeployments', fixture.store.rows.get('RevenueDeskDeployments')
    .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  fixture.store.rows.set('RevenueDeskConfigurationVersions',
    fixture.store.rows.get('RevenueDeskConfigurationVersions')
      .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  fixture.clock.value = Date.parse('2026-08-27T12:00:00.000Z');
  let dispatchCalls = 0;
  const service = createRuntimeService({
    store: fixture.store,
    mailAdapter: {},
    crmSummaryDispatcher: { async dispatch() { dispatchCalls += 1; } },
    config: fixture.config,
    now: () => fixture.clock.value,
  });
  await service.reconcileDueDeployments(25);
  const template = structuredClone(fixture.store.rows.get('CRMBillingOperations')[0]);
  const deployment = fixture.store.rows.get('RevenueDeskDeployments')[0];
  Object.assign(deployment, {
    TEST_STATUS: 'Scheduled', STOP_REASON: null, STOPPED_AT: null,
    REPORT_RECONCILIATION_STATUS: 'NotRequired', REPORT_RECONCILIATION_VERSION: 0,
  });
  const statuses = ['processing', 'reconciliation_required', 'pending'];
  const poisonRows = [];
  let sequence = 1;
  for (const status of statuses) {
    for (let index = 0; index < 2; index += 1) {
      poisonRows.push({
        ...structuredClone(template),
        ROWID: String(fixture.store.nextRowId++),
        OPERATION_KEY: sequence.toString(16).padStart(64, '0'),
        OPERATION_PAYLOAD_JSON: '{',
        STATUS: status,
        LAST_OUTCOME: status === 'pending'
          ? 'report_summary_pending' : 'report_summary_readback_required',
        OPERATION_VERSION: 1,
        CREATED_AT: new Date(fixture.clock.value - 3000 + index * 1000).toISOString(),
        UPDATED_AT: new Date(fixture.clock.value - 2000 + index * 1000).toISOString(),
      });
      sequence += 1;
    }
  }
  fixture.store.rows.set('CRMBillingOperations', poisonRows);

  const capped = await service.runRetryJob(25);
  assert.equal(capped.reportSummaries.examined, 5,
    'the release contract permits at most five CRM calls per retry scan');
  assert.equal(dispatchCalls, 0);

  poisonRows.forEach((row, index) => Object.assign(row, {
    OPERATION_VERSION: 1,
    UPDATED_AT: new Date(fixture.clock.value - 2000 + (index % 2) * 1000).toISOString(),
  }));
  const first = await service.runRetryJob(3);
  assert.equal(first.reportSummaries.examined, 3);
  for (const status of statuses) {
    const lane = poisonRows.filter((row) => row.STATUS === status);
    assert.equal(Number(lane[0].OPERATION_VERSION), 2);
    assert.equal(Number(lane[1].OPERATION_VERSION), 1);
  }

  fixture.clock.value += 10;
  const second = await service.runRetryJob(3);
  assert.equal(second.reportSummaries.examined, 3);
  for (const status of statuses) {
    const lane = poisonRows.filter((row) => row.STATUS === status);
    assert.equal(Number(lane[1].OPERATION_VERSION), 2,
      `later ${status} backlog must progress after the first poison attempt`);
  }

  fixture.clock.value += 10;
  for (const status of statuses) {
    poisonRows.push({
      ...structuredClone(template),
      ROWID: String(fixture.store.nextRowId++),
      OPERATION_KEY: sequence.toString(16).padStart(64, '0'),
      OPERATION_PAYLOAD_JSON: '{', STATUS: status,
      LAST_OUTCOME: status === 'pending'
        ? 'report_summary_pending' : 'report_summary_readback_required',
      OPERATION_VERSION: 1,
      CREATED_AT: new Date(fixture.clock.value).toISOString(),
      UPDATED_AT: new Date(fixture.clock.value).toISOString(),
    });
    sequence += 1;
  }
  const third = await service.runRetryJob(3);
  assert.equal(third.reportSummaries.examined, 3);
  for (const status of statuses) {
    const lane = poisonRows.filter((row) => row.STATUS === status);
    assert.equal(Number(lane[0].OPERATION_VERSION), 3,
      `examined ${status} poison must retry despite continuous new version-one arrivals`);
    assert.equal(lane[0].OPERATION_PAYLOAD_JSON, '{');
    assert.equal(lane[0].STATUS, status);
  }
  assert.equal(dispatchCalls, 0);
});

test('integration: a completed CRM report-summary operation is never dispatched twice', async () => {
  const fixture = runtimeFixture();
  fixture.store.rows.set('RevenueDeskDeployments', fixture.store.rows.get('RevenueDeskDeployments')
    .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  fixture.store.rows.set('RevenueDeskConfigurationVersions',
    fixture.store.rows.get('RevenueDeskConfigurationVersions')
      .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  fixture.clock.value = Date.parse('2026-08-27T12:00:00.000Z');
  const dispatched = [];
  const service = createRuntimeService({
    store: fixture.store,
    mailAdapter: {},
    crmSummaryDispatcher: { async dispatch(_dealId, operationKey) {
      dispatched.push(operationKey);
      await fixture.store.mutate(
        'CRMBillingOperations', 'OPERATION_KEY', operationKey, 'OPERATION_VERSION',
        (current) => ({ STATUS: 'completed',
          LAST_OUTCOME: 'report_summary_readback_confirmed',
          UPDATED_AT: new Date(Date.parse(current.UPDATED_AT) + 1).toISOString() }),
      );
    } },
    config: fixture.config,
    now: () => fixture.clock.value,
  });
  await service.runRetryJob(25);
  await service.runRetryJob(25);
  assert.equal(dispatched.length, 1);
  assert.equal(fixture.store.rows.get('CRMBillingOperations')[0].STATUS, 'completed');
});

test('integration: readiness is query-bounded and fails closed on capped or malformed state', async () => {
  const malformed = runtimeFixture();
  const malformedRows = malformed.store.rows.get('RevenueDeskDeployments');
  malformedRows[0].TEST_STATUS = 'Unknown';
  Object.assign(malformedRows[1], {
    TEST_STATUS: 'Completed', REPORT_RECONCILIATION_STATUS: 'Invalid',
    REPORT_RECONCILIATION_VERSION: 1,
  });
  const malformedService = createRuntimeService({
    store: malformed.store, mailAdapter: {}, config: malformed.config,
    now: () => malformed.clock.value,
  });
  const malformedReadiness = await malformedService.readiness();
  assert.equal(malformedReadiness.activeDeploymentCount, 0);
  assert.equal(malformedReadiness.terminalReconciliationPendingCount, 2);
  const malformedResponse = await invoke(malformed.listener, {
    method: 'GET', url: '/internal/readiness', env: malformed.env,
    headers: { 'x-revenue-desk-readiness-token': malformed.env.INTERNAL_READINESS_TOKEN },
  });
  assert.equal(malformedResponse.body.traffic_enabled, false);

  const fixture = runtimeFixture();
  const deployments = fixture.store.rows.get('RevenueDeskDeployments');
  const configurations = fixture.store.rows.get('RevenueDeskConfigurationVersions');
  const baseDeployment = structuredClone(deployments[0]);
  const baseConfiguration = structuredClone(configurations[0]);
  for (let index = 0; index < 148; index += 1) {
    const suffix = `readiness_${String(index).padStart(3, '0')}`;
    deployments.push({
      ...structuredClone(baseDeployment),
      ROWID: String(1000 + index),
      DEPLOYMENT_ID: `deployment_${suffix}`,
      DEPLOYMENT_KEY: `deployment_key_${suffix}`,
      CLIENT_ID: `client_${suffix}`,
      ACTIVE_CONFIGURATION_VERSION_ID: `configuration_${suffix}`,
      APPROVED_CONFIGURATION_VERSION_ID: `configuration_${suffix}`,
      UPDATED_AT: new Date(Date.parse(baseDeployment.UPDATED_AT) + index + 1).toISOString(),
    });
    configurations.push({
      ...structuredClone(baseConfiguration),
      ROWID: String(2000 + index),
      CONFIGURATION_VERSION_ID: `configuration_${suffix}`,
      DEPLOYMENT_ID: `deployment_${suffix}`,
      CREATED_AT: new Date(Date.parse(baseConfiguration.CREATED_AT) + index + 1).toISOString(),
    });
  }
  let boundedQueries = 0;
  let unboundedSourceQueries = 0;
  const queryBounded = fixture.store.queryBounded.bind(fixture.store);
  const query = fixture.store.query.bind(fixture.store);
  fixture.store.queryBounded = async (...args) => {
    boundedQueries += 1;
    return queryBounded(...args);
  };
  fixture.store.query = async (...args) => {
    if (args[1] === 'SOURCE_REVISION') unboundedSourceQueries += 1;
    return query(...args);
  };
  const service = createRuntimeService({
    store: fixture.store, mailAdapter: {}, config: fixture.config,
    now: () => fixture.clock.value,
  });
  const readiness = await service.readiness();
  assert.equal(boundedQueries, 4,
    'readiness uses one bounded store probe plus deployment, configuration, and rollback-claim evidence pages');
  assert.equal(unboundedSourceQueries, 0);
  assert.equal(readiness.readinessScanCapped, true);
  assert.equal(readiness.sourceDeploymentCount, 100);
  assert.equal(readiness.activeDeploymentCount, 2,
    'only deployments with exact version-specific authorization readback are active');
  assert.equal(readiness.terminalReconciliationPendingCount >= 99, true,
    'shallow cloned status rows and the capped evidence page remain explicitly unverified');
});
