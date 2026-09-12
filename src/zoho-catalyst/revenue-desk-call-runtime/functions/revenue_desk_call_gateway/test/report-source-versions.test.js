'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { queryClientReport } = require('../lib/reporting');
const { loadDeployment } = require('../lib/runtime-service');
const { buildCrmReportSummary, canonicalSummary, ensureCrmReportSummary,
  reportSummaryIdentity, validateSourceVersions, SUMMARY_FIELDS,
  LEGACY_SUMMARY_FIELDS, REPORT_SUMMARY_DOMAIN } = require('../lib/crm-report-outbox');
const { runtimeFixture, invoke, payloadInbound, eventPayload } = require('./runtime-fixture');

test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });
const TERMINAL_AS_OF = Date.parse('2026-08-27T12:00:00.000Z');

async function fixtureWithCall() {
  const fixture = runtimeFixture();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const response = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', 'source_vector_fixture',
      inbound.body.call_inbound.metadata, 'A', { bookable_opportunity: true,
        office_follow_up_required: true, workflow_failure_code: null, workflow_failure_text: null }),
    env: fixture.env });
  assert.equal(response.status, 200);
  const report = await queryClientReport(fixture.store, fixture.config,
    'client_A', 'deployment_A', TERMINAL_AS_OF);
  const deployment = await loadDeployment(fixture.store,
    fixture.store.rows.get('RevenueDeskDeployments')[0], fixture.config);
  return { fixture, report, deployment };
}

test('schema 3 appends only sorted sourceVersions and binds its exact vector to the HMAC', async () => {
  const { fixture, report, deployment } = await fixtureWithCall();
  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
  assert.equal(fixture.store.rows.get('RevenueDeskNotifications').length, 1);
  assert.deepEqual(report.sourceVersions, [
    [`c:${call.CALL_KEY.slice('call_'.length)}`, call.CALL_VERSION],
  ]);
  const summary = buildCrmReportSummary(fixture.config, deployment, report);
  assert.equal(summary.schemaVersion, 3);
  assert.equal(REPORT_SUMMARY_DOMAIN, 'sylvara.crm-report-summary.v3');
  assert.equal(SUMMARY_FIELDS.at(-1), 'sourceVersions');
  assert.equal(SUMMARY_FIELDS.includes('accountId'), false);
  assert.deepEqual(Object.keys(summary), SUMMARY_FIELDS);
  assert.deepEqual(summary.sourceVersions, report.sourceVersions);
  const advanced = { ...summary, sourceVersions: summary.sourceVersions.map(([key, version]) => [key, version + 1]) };
  assert.notDeepEqual(reportSummaryIdentity(fixture.config, summary),
    reportSummaryIdentity(fixture.config, advanced));
  assert.equal(Object.isFrozen(summary.sourceVersions[0]), true);
});

test('report arithmetic and version evidence use the same copied rows without a later version query', async () => {
  const { fixture } = await fixtureWithCall();
  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
  const before = structuredClone(call);
  const query = fixture.store.query.bind(fixture.store);
  let callReads = 0;
  fixture.store.query = async (table, ...args) => {
    if (table === fixture.config.tables.CANONICAL_CALL_TABLE) {
      callReads += 1;
      // Deliberately model an adapter returning a mutable view; the production
      // report boundary must isolate it before the notification query awaits.
      return fixture.store.rows.get(table).filter((row) => row.DEPLOYMENT_ID === 'deployment_A');
    }
    if (table === fixture.config.tables.NOTIFICATION_TABLE) {
      call.CALL_VERSION += 1;
      const canonical = JSON.parse(call.CANONICAL_CALL_JSON);
      canonical.durationMs += 1000;
      call.CANONICAL_CALL_JSON = JSON.stringify(canonical);
    }
    return query(table, ...args);
  };
  const report = await queryClientReport(fixture.store, fixture.config,
    'client_A', 'deployment_A', TERMINAL_AS_OF);
  assert.equal(callReads, 1);
  assert.equal(report.sourceVersions[0][1], before.CALL_VERSION);
  assert.equal(report.actualAverageCallDurationSeconds,
    JSON.parse(before.CANONICAL_CALL_JSON).durationMs / 1000);
  assert.equal(call.CALL_VERSION, before.CALL_VERSION + 1);
});

test('version evidence advances even when the report arithmetic is unchanged', async () => {
  const { fixture, report, deployment } = await fixtureWithCall();
  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
  call.CALL_VERSION += 1;
  const advanced = await queryClientReport(fixture.store, fixture.config,
    'client_A', 'deployment_A', TERMINAL_AS_OF);
  assert.equal(advanced.callsCaptured, report.callsCaptured);
  assert.equal(advanced.actualAverageCallDurationSeconds, report.actualAverageCallDurationSeconds);
  assert.deepEqual(advanced.sourceVersions, report.sourceVersions.map(([key, version]) => [key, version + 1]));
  assert.notEqual(reportSummaryIdentity(fixture.config,
    buildCrmReportSummary(fixture.config, deployment, report)).operationKey,
  reportSummaryIdentity(fixture.config,
    buildCrmReportSummary(fixture.config, deployment, advanced)).operationKey);
});

test('retained v1/v2 and current v3 identities match the consumer without generating legacy summaries', async () => {
  const consumer = require('../../../../crm-billing-orchestrator/functions/crm_billing_orchestrator/lib/report-summary');
  const { fixture, report, deployment } = await fixtureWithCall();
  const generated = buildCrmReportSummary(fixture.config, deployment, report);
  const ids = [];
  for (const version of [1, 2, 3]) {
    const fields = version === 3 ? SUMMARY_FIELDS : LEGACY_SUMMARY_FIELDS;
    const retained = Object.fromEntries(fields.map((field) => [field,
      field === 'schemaVersion' ? version : generated[field]]));
    consumer.parseReportSummary(retained);
    assert.equal(canonicalSummary(retained), consumer.canonicalSummary(retained));
    const producerIdentity = reportSummaryIdentity(fixture.config, retained);
    assert.deepEqual(producerIdentity, consumer.reportSummaryIdentity({
      analyticsPartitionSecret: fixture.config.analyticsPartitionSecret,
      deploymentEnvironment: fixture.config.environment,
    }, retained));
    ids.push(producerIdentity.operationKey);
  }
  assert.equal(new Set(ids).size, 3);
  assert.equal(buildCrmReportSummary(fixture.config, deployment, report).schemaVersion, 3);
  for (const invalid of [0, 4, '3', null, undefined, 2.5, 'toString']) {
    assert.throws(() => reportSummaryIdentity(fixture.config,
      { ...generated, schemaVersion: invalid }), { code: 'REPORT_DATA_INVALID' });
  }
  const oldWithNewFields = { ...generated, schemaVersion: 2 };
  assert.throws(() => canonicalSummary(oldWithNewFields), { code: 'REPORT_DATA_INVALID' });
});

test('provider BigInt decimal strings normalize to safe positive source version numbers only', async () => {
  const { fixture, report } = await fixtureWithCall();
  const call = fixture.store.rows.get('RevenueDeskCalls')[0];
  call.CALL_VERSION = String(call.CALL_VERSION);
  const normalized = await queryClientReport(fixture.store, fixture.config,
    'client_A', 'deployment_A', TERMINAL_AS_OF);
  assert.deepEqual(normalized.sourceVersions, report.sourceVersions);
  for (const invalid of [' 1', '1 ', '+1', '-1', '1e2', '1.0', '01', '0', String(Number.MAX_SAFE_INTEGER + 1)]) {
    call.CALL_VERSION = invalid;
    await assert.rejects(queryClientReport(fixture.store, fixture.config,
      'client_A', 'deployment_A', TERMINAL_AS_OF), { code: 'REPORT_DATA_INVALID' });
  }
});

test('missing, duplicate, unsorted, malformed or oversized source vectors fail closed', async () => {
  const key = `c:${'a'.repeat(64)}`;
  for (const invalid of [undefined, null, {}, [[key, 0]], [[key, -1]], [[key, 1.5]],
    [[key, Number.MAX_SAFE_INTEGER + 1]], [[key, '1']], [['call_abc', 1]],
    [[key, 1, 'extra']], [[key, 1], [key, 2]],
    [[`n:${'b'.repeat(64)}`, 1]], [[`c:${'b'.repeat(64)}`, 1], [key, 1]],
    Array.from({ length: 101 }, (_, index) => [`c:${index.toString(16).padStart(64, '0')}`, 1])]) {
    assert.throws(() => validateSourceVersions(invalid), { code: 'REPORT_DATA_INVALID' });
  }
  const { fixture, report, deployment } = await fixtureWithCall();
  const omitted = { ...report }; delete omitted.sourceVersions;
  assert.throws(() => buildCrmReportSummary(fixture.config, deployment, omitted), { code: 'REPORT_DATA_INVALID' });
  for (const incomplete of [[], [[`c:${'a'.repeat(64)}`, 1]],
    [[`c:${'a'.repeat(64)}`, 1], [`c:${'b'.repeat(64)}`, 1]]]) {
    assert.throws(() => buildCrmReportSummary(fixture.config, deployment,
      { ...report, sourceVersions: incomplete }), { code: 'REPORT_RECONCILIATION_REQUIRED' });
  }
  assert.throws(() => buildCrmReportSummary(fixture.config, deployment,
    { ...report, callsCaptured: report.callsCaptured + 1 }), { code: 'REPORT_RECONCILIATION_REQUIRED' });
  const summary = { ...buildCrmReportSummary(fixture.config, deployment, report) };
  delete summary.sourceVersions;
  assert.throws(() => canonicalSummary(summary), { code: 'REPORT_DATA_INVALID' });
});

test('invalid durable source versions reject the report rather than emitting unverifiable evidence', async () => {
  for (const [table, column, invalid] of [
    ['RevenueDeskCalls', 'CALL_VERSION', 0],
    ['RevenueDeskCalls', 'CALL_VERSION', undefined],
    ['RevenueDeskCalls', 'CALL_KEY', `call_${'g'.repeat(64)}`],
  ]) {
    const { fixture } = await fixtureWithCall();
    fixture.store.rows.get(table)[0][column] = invalid;
    await assert.rejects(queryClientReport(fixture.store, fixture.config,
      'client_A', 'deployment_A', TERMINAL_AS_OF), { code: 'REPORT_DATA_INVALID' });
  }
});

test('existing durable 10000-byte payload ceiling remains in force before any outbox insertion', async () => {
  const { fixture, report, deployment } = await fixtureWithCall();
  const expanded = { ...report, dataConfidenceNotes: ['x'.repeat(2000)],
    callsCaptured: 100, handledCallCount: 100,
    sourceVersions: Array.from({ length: 100 }, (_, index) =>
      [`c:${index.toString(16).padStart(64, '0')}`, Number.MAX_SAFE_INTEGER]) };
  const expandedDeployment = { ...deployment, handledCount: 100,
    countedCallKeys: expanded.sourceVersions.map(([key]) => `call_${key.slice(2)}`) };
  let writes = 0;
  await assert.rejects(ensureCrmReportSummary({ async insertUnique() { writes += 1; } },
    fixture.config, expandedDeployment, expanded, new Date(TERMINAL_AS_OF).toISOString()),
  { code: 'REPORT_DATA_INVALID' });
  assert.equal(writes, 0);
});

test('more than 100 unhandled attempts remain in the full report while a late handled call advances the CRM vector', async () => {
  const { fixture, report: initial, deployment } = await fixtureWithCall();
  const inbound = await invoke(fixture.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: fixture.env });
  const metadata = inbound.body.call_inbound.metadata;
  for (let index = 0; index < 101; index += 1) {
    const failed = eventPayload('call_ended', `unhandled_source_${index}`, metadata, 'A');
    failed.call.call_status = 'error';
    failed.call.disconnection_reason = 'error_retell';
    const response = await invoke(fixture.listener, { url: '/retell/events',
      payload: failed, env: fixture.env });
    assert.equal(response.status, 200);
  }
  const report = await queryClientReport(fixture.store, fixture.config,
    'client_A', 'deployment_A', TERMINAL_AS_OF);
  assert.equal(report.calls.length, 102);
  assert.equal(report.calls.length, fixture.store.rows.get('RevenueDeskCalls').length);
  assert.equal(report.callsCaptured, 1);
  assert.deepEqual(report.sourceVersions, initial.sourceVersions);
  const summary = buildCrmReportSummary(fixture.config, deployment, report);
  assert.equal(summary.sourceVersions.length, 1);
  assert.equal(summary.sourceVersions.some(([key]) => key.startsWith('n:')), false);

  const response = await invoke(fixture.listener, { url: '/retell/events',
    payload: eventPayload('call_analyzed', 'late_handled_source', metadata, 'A',
      { bookable_opportunity: true, office_follow_up_required: true,
        workflow_failure_code: null, workflow_failure_text: null }), env: fixture.env });
  assert.equal(response.status, 200);
  const advanced = await queryClientReport(fixture.store, fixture.config,
    'client_A', 'deployment_A', TERMINAL_AS_OF);
  const advancedDeployment = await loadDeployment(fixture.store,
    fixture.store.rows.get('RevenueDeskDeployments')[0], fixture.config);
  assert.equal(advanced.calls.length, 103);
  assert.equal(advanced.callsCaptured, 2);
  assert.equal(advanced.sourceVersions.length, 2);
  assert.ok(advanced.sourceVersions.some(([key, version]) =>
    key === report.sourceVersions[0][0] && version === report.sourceVersions[0][1]));
  assert.notEqual(reportSummaryIdentity(fixture.config, summary).operationKey,
    reportSummaryIdentity(fixture.config,
      buildCrmReportSummary(fixture.config, advancedDeployment, advanced)).operationKey);
});
