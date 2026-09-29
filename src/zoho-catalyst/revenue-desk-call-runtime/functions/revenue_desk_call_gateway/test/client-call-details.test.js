'use strict';

const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { queryClientReport, queryClientCallDetails, isClientCallDetails, reportToCsv } = require('../lib/reporting');
const { callFact, opaqueKeys, normalizeFactTimestamps } = require('../lib/analytics-outbox');
const { runtimeFixture, invoke, payloadInbound, eventPayload } = require('./runtime-fixture');

test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });

async function fixtureWithCall(analysis = {}) {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const result = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', 'private_details_fixture',
      inbound.body.call_inbound.metadata, 'A', { bookable_opportunity: true,
        office_follow_up_required: true, workflow_failure_code: null,
        workflow_failure_text: null, ...analysis }), env: fixture.env });
  assert.equal(result.status, 200);
  return fixture;
}

const readDetails = (fixture) => queryClientCallDetails(
  fixture.store, fixture.config, 'client_A', 'deployment_A', fixture.clock.value,
);

test('private detail snapshot reuses the canonical text and exact minimized fact without caller identity', async () => {
  const fixture = await fixtureWithCall();
  const snapshot = await readDetails(fixture);
  const row = fixture.store.rows.get('RevenueDeskCalls')[0];
  const canonical = JSON.parse(row.CANONICAL_CALL_JSON);
  const keys = opaqueKeys(fixture.config, 'client_A', 'deployment_A');
  assert.equal(isClientCallDetails(snapshot), true);
  assert.deepEqual(Object.keys(snapshot), ['schemaVersion', 'capturedAt', 'clientKey',
    'deploymentKey', 'configurationVersionId', 'sourceRevision', 'rows']);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.capturedAt, new Date(fixture.clock.value).toISOString());
  assert.equal(snapshot.clientKey, keys.CLIENT_KEY);
  assert.equal(snapshot.deploymentKey, keys.DEPLOYMENT_KEY);
  assert.equal(snapshot.configurationVersionId, row.CONFIGURATION_VERSION_ID);
  assert.equal(snapshot.sourceRevision, fixture.config.sourceRevision);
  assert.equal(snapshot.rows.length, 1);
  assert.deepEqual(snapshot.rows[0], {
    fact: normalizeFactTimestamps('call', callFact(fixture.config, row, canonical)),
    sourceVersion: row.CALL_VERSION,
    callerIntent: 'service_request', issueSummary: 'Leaking water heater',
    coverageTrigger: 'AfterHours', contentWithheld: false,
  });
  assert.doesNotMatch(JSON.stringify(snapshot),
    /callerName|callbackNumber|cityOrZip|specificPersonRequested|transcript|recording|Caller A|Lenexa|\+1555/);
  assert.equal(Object.hasOwn(snapshot.rows[0].fact, 'callerIntent'), false);
  assert.equal(Object.hasOwn(snapshot.rows[0].fact, 'issueSummary'), false);
});

test('private snapshot leaves absent requests and trigger unknown and never restores sensitive content', async () => {
  const unknownFixture = await fixtureWithCall({ caller_intent: null,
    issue_summary: null, coverage_trigger: 'Unknown' });
  const unknown = (await readDetails(unknownFixture)).rows[0];
  assert.equal(unknown.callerIntent, null);
  assert.equal(unknown.issueSummary, null);
  assert.equal(unknown.coverageTrigger, 'Unknown');
  assert.equal(unknown.contentWithheld, false);
  const sensitiveFixture = await fixtureWithCall({ sensitive_data_detected: true,
    caller_intent: 'Synthetic withheld request', issue_summary: 'Synthetic withheld detail' });
  const sensitive = (await readDetails(sensitiveFixture)).rows[0];
  assert.equal(sensitive.callerIntent, null);
  assert.equal(sensitive.issueSummary, null);
  assert.equal(sensitive.contentWithheld, true);
  assert.equal(sensitive.fact.OUTCOME, 'sensitive_data_ended');
  const row = sensitiveFixture.store.rows.get('RevenueDeskCalls')[0];
  row.CANONICAL_CALL_JSON = JSON.stringify({ ...JSON.parse(row.CANONICAL_CALL_JSON),
    issueSummary: 'Corrupt retained content' });
  await assert.rejects(readDetails(sensitiveFixture), { code: 'REPORT_DATA_INVALID' });
});

test('private snapshot branding cannot survive cloning or serialization and every nested value is immutable', async () => {
  const snapshot = await readDetails(await fixtureWithCall());
  for (const candidate of [null, undefined, 1, 'text', {}, { ...snapshot },
    structuredClone(snapshot), JSON.parse(JSON.stringify(snapshot))]) {
    assert.equal(isClientCallDetails(candidate), false);
  }
  for (const value of [snapshot, snapshot.rows, snapshot.rows[0], snapshot.rows[0].fact]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.throws(() => { snapshot.clientKey = 'f'.repeat(64); }, TypeError);
  assert.throws(() => { snapshot.rows.push(snapshot.rows[0]); }, TypeError);
  assert.throws(() => { snapshot.rows[0].issueSummary = 'replacement'; }, TypeError);
  assert.throws(() => { snapshot.rows[0].fact.OUTCOME = 'spam'; }, TypeError);
});

test('private details validate one copied cohort without a second canonical query', async () => {
  const fixture = await fixtureWithCall();
  const liveRow = fixture.store.rows.get('RevenueDeskCalls')[0];
  const before = structuredClone(liveRow);
  const query = fixture.store.query.bind(fixture.store);
  let callReads = 0;
  fixture.store.query = async (table, ...args) => {
    if (table === fixture.config.tables.CANONICAL_CALL_TABLE) {
      callReads += 1;
      return fixture.store.rows.get(table);
    }
    if (table === fixture.config.tables.NOTIFICATION_TABLE) {
      liveRow.CALL_VERSION += 1;
      liveRow.CANONICAL_CALL_JSON = JSON.stringify({ ...JSON.parse(liveRow.CANONICAL_CALL_JSON),
        issueSummary: 'Later canonical change' });
    }
    return query(table, ...args);
  };
  const snapshot = await readDetails(fixture);
  assert.equal(callReads, 1);
  assert.equal(snapshot.rows[0].sourceVersion, before.CALL_VERSION);
  assert.equal(snapshot.rows[0].issueSummary, 'Leaking water heater');
  assert.equal(JSON.parse(liveRow.CANONICAL_CALL_JSON).issueSummary, 'Later canonical change');
});

test('private details retain unhandled rows for exact cohort reconciliation and bind their versions', async () => {
  const fixture = await fixtureWithCall();
  const existing = fixture.store.rows.get('RevenueDeskCalls')[0];
  const unhandled = { ...structuredClone(existing), ROWID: '999',
    CALL_KEY: `call_${'f'.repeat(64)}`, CORRELATION_ID: `corr_${'f'.repeat(32)}`,
    CALL_VERSION: '2', HANDLED_RECORDED: false, OUTCOME: 'unresolved', NOTIFICATION_STATE: null };
  unhandled.CANONICAL_CALL_JSON = JSON.stringify({ ...JSON.parse(existing.CANONICAL_CALL_JSON),
    callKey: unhandled.CALL_KEY, correlationId: unhandled.CORRELATION_ID, outcome: 'unresolved',
    callerIntent: null, issueSummary: null, coverageTrigger: 'Unknown', urgency: 'unknown',
    bookableOpportunity: null, officeFollowUpRequired: null });
  fixture.store.rows.get('RevenueDeskCalls').push(unhandled);
  const snapshot = await readDetails(fixture);
  assert.equal(snapshot.rows.length, 2);
  const attempt = snapshot.rows.find((row) => !row.fact.HANDLED_RECORDED);
  assert.equal(attempt.sourceVersion, 2);
  assert.equal(attempt.fact.CALL_KEY, 'f'.repeat(64));
  assert.equal(attempt.callerIntent, null);
  unhandled.CALL_VERSION = '02';
  await assert.rejects(readDetails(fixture), { code: 'REPORT_DATA_INVALID' });
});

test('empty private detail cohort still carries the exact opaque scope without invented calls', async () => {
  const fixture = runtimeFixture();
  const snapshot = await readDetails(fixture);
  const keys = opaqueKeys(fixture.config, 'client_A', 'deployment_A');
  assert.equal(isClientCallDetails(snapshot), true);
  assert.equal(snapshot.clientKey, keys.CLIENT_KEY);
  assert.equal(snapshot.deploymentKey, keys.DEPLOYMENT_KEY);
  assert.deepEqual(snapshot.rows, []);
});

test('private details reject source, ownership and notification drift before receiving the trusted brand', async () => {
  for (const mutate of [
    (row) => { row.CLIENT_ID = 'client_B'; },
    (row) => { row.SOURCE_REVISION = 'e'.repeat(40); },
    (row) => { row.CANONICAL_CALL_JSON = JSON.stringify({ ...JSON.parse(row.CANONICAL_CALL_JSON),
      deploymentId: 'deployment_B' }); },
  ]) {
    const fixture = await fixtureWithCall();
    mutate(fixture.store.rows.get('RevenueDeskCalls')[0]);
    await assert.rejects(readDetails(fixture), { code: 'REPORT_OWNERSHIP_CONFLICT' });
  }
  const fixture = await fixtureWithCall();
  await assert.rejects(queryClientCallDetails(fixture.store, fixture.config,
    'client_B', 'deployment_A', fixture.clock.value), { code: 'REPORT_OWNERSHIP_CONFLICT' });
  fixture.store.rows.get('RevenueDeskNotifications')[0].STATUS = 'RetryRequired';
  await assert.rejects(readDetails(fixture), { code: 'REPORT_RECONCILIATION_REQUIRED' });
});

test('default report JSON and CSV remain byte-identical to the accepted source baseline', async () => {
  const fixture = await fixtureWithCall();
  const report = await queryClientReport(fixture.store, fixture.config,
    'client_A', 'deployment_A', fixture.clock.value);
  const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
  // Captured with this exact synthetic fixture on the accepted 89411b3 source,
  // before the private reader addition. Private detail must not alter exports.
  assert.equal(digest(JSON.stringify(report)), '4fd603b431984515480cb7d006dcf27fb36c1b398e2a9b272e537c462e871c54');
  assert.equal(digest(reportToCsv(report)), '2b1a7c6f03e8dd6b1ae300580648705cbee8bb6066e2cedd682f49dfd6e9f619');
  await readDetails(fixture);
  const after = await queryClientReport(fixture.store, fixture.config,
    'client_A', 'deployment_A', fixture.clock.value);
  assert.equal(JSON.stringify(after), JSON.stringify(report));
  assert.equal(reportToCsv(after), reportToCsv(report));
});
