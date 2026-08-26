'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { queryClientReport } = require('../lib/reporting');
const {
  NOW, payloadInbound, eventPayload, invoke, runtimeFixture,
} = require('./runtime-fixture');

async function resolve(fixture, letter, timestamp = NOW) {
  return invoke(fixture.listener, {
    url: '/retell/inbound', payload: payloadInbound(letter, timestamp), env: fixture.env,
    signatureTimestamp: timestamp,
  });
}

function stateWithoutAuditReceipts(store) {
  return JSON.stringify([...store.rows.entries()]
    .filter(([table]) => table !== 'RevenueDeskEventReceipts'));
}

test('acceptance: two synthetic clients remain isolated through resolution, call, notification, and correlation', async () => {
  const fixture = runtimeFixture();
  const a = await resolve(fixture, 'A');
  const b = await resolve(fixture, 'B');
  assert.equal(a.body.call_inbound.dynamic_variables.service_area_json.includes('Lenexa'), true);
  assert.equal(b.body.call_inbound.dynamic_variables.service_area_json.includes('Liberty'), true);
  assert.equal(a.body.call_inbound.dynamic_variables.urgent_conditions_json.includes('active uncontrolled leak'), true);
  assert.equal(b.body.call_inbound.dynamic_variables.urgent_conditions_json.includes('sewage backup'), true);
  const eventA = eventPayload('call_analyzed', 'acceptance_call_A', a.body.call_inbound.metadata, 'A');
  const eventB = eventPayload('call_analyzed', 'acceptance_call_B', b.body.call_inbound.metadata, 'B');
  const resultA = await invoke(fixture.listener, { url: '/retell/events', payload: eventA, env: fixture.env });
  const resultB = await invoke(fixture.listener, { url: '/retell/events', payload: eventB, env: fixture.env });
  assert.equal(resultA.body.status, 'Queued');
  assert.equal(resultB.body.status, 'Queued');
  const calls = fixture.store.rows.get('RevenueDeskCalls');
  const notifications = fixture.store.rows.get('RevenueDeskNotifications');
  const [callA] = calls.filter((row) => row.CLIENT_ID === 'client_A');
  const [callB] = calls.filter((row) => row.CLIENT_ID === 'client_B');
  assert.notEqual(callA.CORRELATION_ID, callB.CORRELATION_ID);
  assert.equal(callA.CORRELATION_ID, a.body.call_inbound.metadata.correlation_id);
  assert.equal(callB.CORRELATION_ID, b.body.call_inbound.metadata.correlation_id);
  assert.deepEqual(new Set(calls.map((row) => row.CLIENT_ID)), new Set(['client_A', 'client_B']));
  assert.deepEqual(new Set(notifications.map((row) => row.CLIENT_ID)), new Set(['client_A', 'client_B']));
  for (const row of notifications) {
    assert.equal(row.DEPLOYMENT_ID.endsWith(row.CLIENT_ID.slice(-1)), true);
    assert.equal(JSON.parse(row.PAYLOAD_JSON).issueSummary.includes(row.CLIENT_ID.endsWith('A') ? 'water heater' : 'drain'), true);
  }
});

test('acceptance: replay produces no duplicate canonical call, count, or notification', async () => {
  const fixture = runtimeFixture();
  const inbound = await resolve(fixture, 'A');
  const event = eventPayload('call_analyzed', 'acceptance_replay_A', inbound.body.call_inbound.metadata, 'A');
  await invoke(fixture.listener, { url: '/retell/events', payload: event, env: fixture.env });
  await invoke(fixture.listener, { url: '/retell/events', payload: event, env: fixture.env });
  assert.equal(fixture.store.rows.get('RevenueDeskCalls').length, 1);
  assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 1);
  assert.equal(fixture.store.rows.get('RevenueDeskDeployments')[0].HANDLED_COUNT, 1);
  assert.equal(fixture.store.rows.get('RevenueDeskDeployments')[1].HANDLED_COUNT, 0);
});

test('acceptance: cross-client metadata/number contamination fails before call or notification persistence', async () => {
  const fixture = runtimeFixture();
  const inboundA = await resolve(fixture, 'A');
  const contaminated = eventPayload('call_analyzed', 'cross_client_attempt', inboundA.body.call_inbound.metadata, 'B');
  const response = await invoke(fixture.listener, { url: '/retell/events', payload: contaminated, env: fixture.env });
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'Queued');
  assert.equal(fixture.workerErrors.at(-1).code, 'CALL_OWNERSHIP_UNRESOLVED');
  assert.equal(fixture.store.rows.get('RevenueDeskCalls').length, 0);
  assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 0);
  assert.equal(fixture.store.rows.get('RevenueDeskDeployments').every((row) => row.HANDLED_COUNT === 0), true);
  assert.equal(fixture.store.rows.get('RevenueDeskEventReceipts')
    .find((row) => row.RECEIPT_KIND === 'provider_event').STATUS, 'TerminalFailure');
});

test('acceptance: analyzed-before-ended and ended-before-analyzed each converge to one final call fact', async () => {
  const fixture = runtimeFixture();
  const inboundA = await resolve(fixture, 'A');
  const analyzedFirst = eventPayload('call_analyzed', 'reorder_A', inboundA.body.call_inbound.metadata, 'A');
  analyzedFirst.call.end_timestamp = null;
  await invoke(fixture.listener, { url: '/retell/events', payload: analyzedFirst, env: fixture.env });
  await invoke(fixture.listener, { url: '/retell/events', payload: eventPayload('call_ended', 'reorder_A',
    inboundA.body.call_inbound.metadata, 'A'), env: fixture.env });

  const inboundB = await resolve(fixture, 'B');
  await invoke(fixture.listener, { url: '/retell/events', payload: eventPayload('call_ended', 'reorder_B',
    inboundB.body.call_inbound.metadata, 'B'), env: fixture.env });
  await invoke(fixture.listener, { url: '/retell/events', payload: eventPayload('call_analyzed', 'reorder_B',
    inboundB.body.call_inbound.metadata, 'B'), env: fixture.env });
  assert.equal(fixture.store.rows.get('RevenueDeskCalls').length, 2);
  assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 2);
  assert.equal(fixture.store.rows.get('RevenueDeskCalls').every((row) => row.ENDED_AT !== null
    && row.PROCESSING_STATE === 'Completed'), true);
  assert.deepEqual(fixture.store.rows.get('RevenueDeskDeployments').map((row) => row.HANDLED_COUNT), [1, 1]);
});

test('acceptance: exact seven-day boundary and malformed configuration fail closed', async () => {
  const expiry = Date.parse('2026-08-27T12:00:00.000Z');
  const expired = runtimeFixture({ now: expiry });
  const atBoundary = await resolve(expired, 'A', expiry);
  assert.deepEqual(atBoundary.body, { call_inbound: { reject: true } });

  const receivedAfterExpiry = runtimeFixture({ now: expiry + 1000 });
  const freshPreExpirySignature = await resolve(receivedAfterExpiry, 'A', expiry - 1000);
  assert.deepEqual(freshPreExpirySignature.body, { call_inbound: { reject: true } });
  assert.equal(receivedAfterExpiry.store.rows.get('RevenueDeskCalls').length, 0);
  assert.equal(receivedAfterExpiry.store.rows.get('RevenueDeskEventReceipts')
    .filter((row) => row.RECEIPT_KIND === 'inbound_resolution').length, 1);
  assert.equal(receivedAfterExpiry.store.rows.get('RevenueDeskEventReceipts')
    .filter((row) => row.RECEIPT_KIND === 'provider_event').length, 0);

  const malformed = runtimeFixture();
  malformed.store.rows.get('RevenueDeskDeployments')[0].COVERAGE_MODE = 'after_hours';
  const rejected = await resolve(malformed, 'A');
  assert.deepEqual(rejected.body, { call_inbound: { reject: true } });

  const malformedTimestamp = runtimeFixture();
  malformedTimestamp.store.rows.get('RevenueDeskDeployments')[0].EXPIRES_AT = 'not-a-timestamp';
  const timestampRejected = await resolve(malformedTimestamp, 'A');
  assert.equal(timestampRejected.status, 200);
  assert.deepEqual(timestampRejected.body, { call_inbound: { reject: true } });
});

test('acceptance: every required deployment/configuration gate failure rejects without writes', async () => {
  const cases = [
    ['missing client id', (row) => { row.CLIENT_ID = ''; }],
    ['missing deployment id', (row) => { row.DEPLOYMENT_ID = ''; }],
    ['missing configuration version', (row) => { row.ACTIVE_CONFIGURATION_VERSION_ID = ''; }],
    ['wrong engagement type', (_row, configurationRow) => {
      configurationRow.ENGAGEMENT_TYPE = 'paid_service';
    }],
    ['wrong capability profile', (_row, configurationRow) => {
      configurationRow.CAPABILITY_PROFILE = 'revenue_desk';
    }],
    ['missing immutable plan tier', (_row, configurationRow) => {
      delete configurationRow.PLAN_TIER;
    }],
    ['immutable plan tier conflicts with profile', (_row, configurationRow) => {
      configurationRow.PLAN_TIER = 'Launch';
    }],
    ['missing immutable deployment status', (_row, configurationRow) => {
      delete configurationRow.DEPLOYMENT_STATUS;
    }],
    ['immutable deployment is not live-capable', (_row, configurationRow) => {
      configurationRow.DEPLOYMENT_STATUS = 'Setup Pending';
    }],
    ['missing immutable go-live approval status', (_row, configurationRow) => {
      delete configurationRow.GO_LIVE_APPROVAL_STATUS;
    }],
    ['immutable go-live status is not approved', (_row, configurationRow) => {
      configurationRow.GO_LIVE_APPROVAL_STATUS = 'Pending Internal Approval';
    }],
    ['immutable limit policy conflicts with profile', (_row, configurationRow) => {
      configurationRow.LIMIT_POLICY = 'disabled';
    }],
    ['immutable billing mode conflicts with profile', (_row, configurationRow) => {
      configurationRow.BILLING_MODE = 'disabled';
    }],
    ['missing immutable number ownership', (_row, configurationRow) => {
      delete configurationRow.NUMBER_OWNERSHIP;
    }],
    ['immutable environment alias mismatch', (_row, configurationRow) => {
      configurationRow.ENVIRONMENT = 'production';
    }],
    ['configuration version exceeds canonical length', (_row, configurationRow) => {
      configurationRow.CONFIGURATION_VERSION = `v${'1'.repeat(100)}`;
    }],
    ['invalid coverage mode', (row) => { row.COVERAGE_MODE = 'After Hours Only'; }],
    ['inactive test', (row) => { row.TEST_STATUS = 'Stopped'; }],
    ['active row with stopped timestamp', (row) => {
      row.STOPPED_AT = new Date(NOW - 1000).toISOString();
    }],
    ['malformed stopped timestamp', (row) => { row.STOPPED_AT = 'not-a-timestamp'; }],
    ['stop reason without stopped timestamp', (row) => { row.STOP_REASON = 'sylvara_stopped'; }],
    ['approval missing', (row) => { row.GO_LIVE_APPROVAL_STATUS = 'Pending Internal Approval'; }],
    ['configuration ownership mismatch', (_row, configurationRow) => {
      const config = JSON.parse(configurationRow.CONFIGURATION_JSON);
      config.configurationVersion = 'cfg_A_conflict';
      configurationRow.CONFIGURATION_JSON = JSON.stringify(config);
    }],
    ['shared agent mismatch', (row) => { row.MONITOR_AGENT_ID = 'agent_wrong_binding'; }],
    ['source revision mismatch', (row) => { row.SOURCE_REVISION = 'b'.repeat(40); }],
    ['empty handled count', (row) => { row.HANDLED_COUNT = ''; }],
    ['empty count version', (row) => { row.COUNT_VERSION = ''; }],
    ['noncanonical binding version', (row) => { row.BINDING_VERSION = '01'; }],
  ];
  for (const [name, mutate] of cases) {
    const fixture = runtimeFixture();
    const before = stateWithoutAuditReceipts(fixture.store);
    mutate(
      fixture.store.rows.get('RevenueDeskDeployments')[0],
      fixture.store.rows.get('RevenueDeskConfigurationVersions')[0],
    );
    const afterMutation = stateWithoutAuditReceipts(fixture.store);
    const rejected = await resolve(fixture, 'A');
    assert.equal(rejected.status, 200, name);
    assert.deepEqual(rejected.body, { call_inbound: { reject: true } }, name);
    assert.equal(stateWithoutAuditReceipts(fixture.store), afterMutation,
      `${name} must not mutate resolver state`);
    assert.notEqual(before, afterMutation, `${name} fixture mutation must take effect`);
    assert.equal(fixture.store.rows.get('RevenueDeskCalls').length, 0, name);
    assert.equal(fixture.store.rows.get('RevenueDeskEventReceipts')
      .filter((row) => row.RECEIPT_KIND === 'inbound_resolution').length, 1, name);
    assert.equal(fixture.store.rows.get('RevenueDeskEventReceipts')
      .filter((row) => row.RECEIPT_KIND === 'provider_event').length, 0, name);
    assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 0, name);
  }

  const exhausted = runtimeFixture();
  const deployment = exhausted.store.rows.get('RevenueDeskDeployments')[0];
  deployment.HANDLED_COUNT = 25;
  deployment.COUNTED_CALL_KEYS_JSON = JSON.stringify(Array.from(
    { length: 25 }, (_, index) => `call_${String(index).padStart(64, '0')}`,
  ));
  const exhaustedBefore = stateWithoutAuditReceipts(exhausted.store);
  const exhaustedResult = await resolve(exhausted, 'A');
  assert.deepEqual(exhaustedResult.body, { call_inbound: { reject: true } });
  assert.equal(stateWithoutAuditReceipts(exhausted.store), exhaustedBefore);
});

test('acceptance: live status requires exact approval and activation receipts for the current route', async () => {
  const cases = [
    ['status strings without references', (fixture) => {
      Object.assign(fixture.store.rows.get('RevenueDeskDeployments')[0], {
        APPROVED_CONFIGURATION_VERSION_ID: null,
        APPROVAL_EVENT_KEY: null,
        APPROVED_ROUTE_FINGERPRINT: null,
        GO_LIVE_APPROVED_AT: null,
        ACTIVATION_EVENT_KEY: null,
        ACTUAL_START_AT: null,
        EXPIRES_AT: null,
      });
    }],
    ['missing approval receipt', (fixture) => {
      fixture.store.authorizationRows = fixture.store.authorizationRows.filter(
        (row) => row.EVENT_KEY !== fixture.store.rows.get('RevenueDeskDeployments')[0].APPROVAL_EVENT_KEY,
      );
    }],
    ['missing activation receipt', (fixture) => {
      fixture.store.authorizationRows = fixture.store.authorizationRows.filter(
        (row) => row.EVENT_KEY !== fixture.store.rows.get('RevenueDeskDeployments')[0].ACTIVATION_EVENT_KEY,
      );
    }],
    ['changed route after approval', (fixture) => {
      fixture.store.rows.get('RevenueDeskDeployments')[0].BINDING_VERSION = 2;
    }],
    ['changed active configuration after approval', (fixture) => {
      const current = fixture.store.rows.get('RevenueDeskConfigurationVersions')[0];
      fixture.store.rows.get('RevenueDeskConfigurationVersions').push({
        ...structuredClone(current),
        ROWID: '99',
        CONFIGURATION_VERSION_ID: 'configuration_version_A_v2',
        CONFIGURATION_VERSION: 'cfg_A_v2',
        CONFIGURATION_JSON: JSON.stringify({
          ...JSON.parse(current.CONFIGURATION_JSON), configurationVersion: 'cfg_A_v2',
        }),
      });
      fixture.store.rows.get('RevenueDeskDeployments')[0].ACTIVE_CONFIGURATION_VERSION_ID =
        'configuration_version_A_v2';
    }],
    ['changed configuration content after approval', (fixture) => {
      const configurationRow = fixture.store.rows.get('RevenueDeskConfigurationVersions')[0];
      configurationRow.CONFIGURATION_JSON = JSON.stringify({
        ...JSON.parse(configurationRow.CONFIGURATION_JSON),
        companyDescription: 'Changed after approval.',
      });
    }],
    ['approval receipt no longer records approval', (fixture) => {
      const index = fixture.store.authorizationRows.findIndex(
        (row) => row.EVENT_KEY.startsWith('approval_a'),
      );
      const approval = fixture.store.authorizationRows[index];
      fixture.store.authorizationRows[index] = { ...approval, EVENT_DATA_JSON: JSON.stringify({
        ...JSON.parse(approval.EVENT_DATA_JSON), decision: 'Revoked',
      }) };
    }],
    ['activation readback no longer matches', (fixture) => {
      const index = fixture.store.authorizationRows.findIndex(
        (row) => row.EVENT_KEY.startsWith('activation_c'),
      );
      const activation = fixture.store.authorizationRows[index];
      fixture.store.authorizationRows[index] = { ...activation, EVENT_DATA_JSON: JSON.stringify({
        ...JSON.parse(activation.EVENT_DATA_JSON),
        routeReadbackFingerprint: `readback_${'f'.repeat(64)}`,
      }) };
    }],
    ['authorization source changed', (fixture) => {
      const index = fixture.store.authorizationRows.findIndex(
        (row) => row.EVENT_KEY.startsWith('approval_a'),
      );
      fixture.store.authorizationRows[index] = {
        ...fixture.store.authorizationRows[index], SOURCE_REVISION: 'b'.repeat(40),
      };
    }],
  ];

  for (const [name, mutate] of cases) {
    const fixture = runtimeFixture();
    mutate(fixture);
    const rejected = await resolve(fixture, 'A');
    assert.equal(rejected.status, 200, name);
    assert.deepEqual(rejected.body, { call_inbound: { reject: true } }, name);
    assert.equal(fixture.store.rows.get('RevenueDeskCalls').length, 0, name);
    assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 0, name);
  }
});

test('acceptance: sensitive and immediate-danger evidence is minimized or preserved safely downstream', async () => {
  const fixture = runtimeFixture();
  const inboundA = await resolve(fixture, 'A');
  const sensitive = eventPayload('call_analyzed', 'sensitive_A', inboundA.body.call_inbound.metadata, 'A', {
    issue_summary: 'My bank routing number is 123456789', outcome: 'potential_job',
  });
  await invoke(fixture.listener, { url: '/retell/events', payload: sensitive, env: fixture.env });
  const inboundB = await resolve(fixture, 'B');
  const safety = eventPayload('call_analyzed', 'safety_B', inboundB.body.call_inbound.metadata, 'B', {
    urgency: 'immediate_danger', outcome: 'unresolved',
  });
  await invoke(fixture.listener, { url: '/retell/events', payload: safety, env: fixture.env });
  const [sensitiveNotice, safetyNotice] = fixture.store.rows.get('RevenueDeskNotifications')
    .sort((left, right) => left.CLIENT_ID.localeCompare(right.CLIENT_ID));
  const minimized = JSON.parse(sensitiveNotice.PAYLOAD_JSON);
  assert.equal(minimized.callOutcome, 'sensitive_data_ended');
  assert.equal(minimized.issueSummary, null);
  assert.equal(minimized.callbackNumber, null);
  const safetyPayload = JSON.parse(safetyNotice.PAYLOAD_JSON);
  assert.equal(Object.hasOwn(safetyPayload, 'safetyFlag'), false);
  assert.equal(safetyPayload.urgency, 'immediate_danger');
});

test('acceptance: already-resolved in-flight calls may produce documented practical overshoot only', async () => {
  const fixture = runtimeFixture();
  const deployment = fixture.store.rows.get('RevenueDeskDeployments')[0];
  const admitted = [];
  for (let index = 0; index < 26; index += 1) admitted.push(await resolve(fixture, 'A'));
  let stoppedAt = null;
  for (let index = 0; index < admitted.length; index += 1) {
    await invoke(fixture.listener, { url: '/retell/events',
      payload: eventPayload('call_ended', `inflight_${index + 1}`,
        admitted[index].body.call_inbound.metadata, 'A'), env: fixture.env });
    if (index === 24) stoppedAt = deployment.STOPPED_AT;
  }
  assert.equal(deployment.HANDLED_COUNT, 26);
  assert.equal(deployment.TEST_STATUS, 'Completed');
  assert.equal(deployment.STOPPED_AT, stoppedAt);
  const report = await queryClientReport(fixture.store, fixture.config,
    'client_A', 'deployment_A', fixture.clock.value);
  assert.equal(report.inFlightOvershoot, 1);
  assert.equal(report.callsRemaining, 0);
  assert.equal(report.limitReached, true);
  assert.match(report.dataConfidenceNotes.join(' '), /in-flight overshoot/i);
  fixture.clock.value += 1;
  const blocked = await resolve(fixture, 'A', fixture.clock.value);
  assert.deepEqual(blocked.body, { call_inbound: { reject: true } });
});

test('acceptance: ordinary logs contain no tenant, phone, recipient, payload, or signature data', async () => {
  const fixture = runtimeFixture();
  const inbound = await resolve(fixture, 'A');
  const event = eventPayload('call_analyzed', 'safe_log_A', inbound.body.call_inbound.metadata, 'A');
  await invoke(fixture.listener, { url: '/retell/events', payload: event, env: fixture.env });
  await invoke(fixture.listener, { url: '/+15551110001/Caller-Content', payload: {}, env: fixture.env });
  const logs = JSON.stringify(fixture.logs);
  for (const prohibited of [
    'client_A', 'deployment_A', 'cfg_A_v1', 'Synthetic Plumbing A', '+1555',
    'a@example.invalid', 'Leaking water heater', 'Caller-Content', 'ownership_token', 'x-retell-signature',
  ]) assert.equal(logs.includes(prohibited), false, prohibited);
  assert.match(logs, /corr_[a-f0-9]{32}/);
});
