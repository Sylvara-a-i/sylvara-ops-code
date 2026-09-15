'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateConfiguration } = require('../lib/validation');
const { validateReportBaseline } = require('../lib/report-baseline');
const { configurationSnapshotFingerprint } = require('../lib/approval-control');
const { buildCrmPreTestSnapshot } = require('../../../../revenue-desk-analytics/functions/analytics_sync/lib/crm-report-baseline');
const { crmBaselineFixture } = require('../../../../revenue-desk-analytics/functions/analytics_sync/test/helpers/crm-baseline-fixture');
const { configuration, configurationRow, runtimeFixture, authorizationRows, invoke, payloadInbound } = require('./runtime-fixture');

function snapshot() {
  const input = crmBaselineFixture();
  delete input.context.testStartedAt;
  for (const item of [input.context, input.evidence]) {
    item.configurationVersion = 'cfg_A_v1';
    item.configurationVersionId = 'configuration_version_A';
    item.crmModifiedAt = '2026-08-19T11:50:00.000Z';
    item.sourcePeriod = { start: '2026-07-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' };
  }
  input.deal.Configuration_Version = input.context.configurationVersion;
  input.deal.Modified_Time = input.context.crmModifiedAt;
  input.evidence.readAt = '2026-08-19T11:55:00.000Z';
  input.evidence.capturedAt = '2026-08-19T11:56:00.000Z';
  input.metadata.observedAt = '2026-08-19T11:54:00.000Z';
  return buildCrmPreTestSnapshot(input, { now: Date.parse(input.evidence.capturedAt) });
}

test('legacy configuration shape stays unchanged; a captured baseline round-trips immutably', () => {
  const legacy = configuration('A');
  const before = structuredClone(legacy);
  assert.equal(Object.hasOwn(validateConfiguration(legacy), 'reportBaseline'), false);
  assert.deepEqual(legacy, before);
  const input = { ...legacy, reportBaseline: snapshot() };
  const prepared = validateConfiguration(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(prepared.reportBaseline, input.reportBaseline);
  assert.ok(Object.isFrozen(prepared.reportBaseline.values));
  assert.ok(Object.isFrozen(prepared.reportBaseline.sourcePeriod));
  assert.notEqual(prepared.reportBaseline.configurationVersionId, prepared.configurationVersion);
});

test('stored baseline rejects private extras, wrong shapes, unsafe values and invented evidence', () => {
  const cases = [
    (v) => { v.email = 'synthetic@example.invalid'; },
    (v) => { v.values.customerName = 'Synthetic private name'; },
    (v) => { v.values.monthlyInboundCallBand = '9135550123'; },
    (v) => { v.values.monthlyInboundCalls = '140'; },
    (v) => { v.values.monthlyInboundCalls = 1.5; },
    (v) => { v.values.estimatedUnansweredCallRate = 100.01; },
    (v) => { v.values.afterHoursCallShare = 1.005; },
    (v) => { v.values.averageJobValueMinorUnits = 1.5; },
    (v) => { v.values.currentMonthlyAnsweringCostMinorUnits = -1; },
    (v) => { v.values.averageJobValueMinorUnits = Number.MAX_SAFE_INTEGER; },
    (v) => { v.values = []; },
    (v) => { delete v.values.monthlyInboundCalls; },
    (v) => { v.currency = 'EUR'; },
    (v) => { v.environment = 'production'; },
    (v) => { v.provenanceStatus = 'verified_live'; },
    (v) => { v.sourcePeriod.end = v.sourcePeriod.start; },
    (v) => { v.sourcePeriod.end = '2026-09-01T00:00:00.000Z'; },
    (v) => { v.sourceModifiedAt = '2026-08-20T00:00:00.000Z'; },
    (v) => { v.capturedAt = '2026-02-30T00:00:00.000Z'; },
    (v) => { v.configurationVersionId = 'x'.repeat(129); },
    (v) => { v.clientKey = v.deploymentKey; },
    (v) => { v[Symbol('private')] = 'extra'; },
  ];
  for (const mutate of cases) {
    const value = structuredClone(snapshot()); mutate(value);
    assert.throws(() => validateReportBaseline(value), (error) => error.code === 'INVALID_SCHEMA'
      && error.message === 'Stored report baseline is invalid.');
  }
  for (const value of [undefined, null, []]) {
    assert.throws(() => validateConfiguration({ ...configuration('A'), reportBaseline: value }),
      { code: 'INVALID_SCHEMA' });
  }
});

test('unknowns are not zero and expected physical, partition, label and coverage bindings are exact', () => {
  const value = structuredClone(snapshot());
  for (const field of Object.keys(value.values)) value.values[field] = null;
  value.currency = null;
  assert.deepEqual(validateReportBaseline(value).values, value.values);
  for (const expected of [
    { clientKey: 'e'.repeat(64) }, { deploymentKey: 'f'.repeat(64) },
    { configurationVersionId: value.configurationVersion },
    { configurationVersion: 'different-label' }, { coverageMode: 'AfterHoursAndOverflow' },
  ]) assert.throws(() => validateReportBaseline(value, expected), { code: 'INVALID_SCHEMA' });
  assert.throws(() => validateConfiguration({ ...configuration('A'), reportBaseline: {
    ...value, configurationVersion: 'different-label',
  } }), { code: 'INVALID_SCHEMA' });
  assert.throws(() => validateConfiguration({ ...configuration('A'), reportBaseline: {
    ...value, coverageMode: 'AfterHoursAndOverflow',
  } }), { code: 'INVALID_SCHEMA' });
});

test('configuration approval fingerprints include the entire stored baseline', () => {
  const row = configurationRow({}, 'A', '1');
  const original = configurationSnapshotFingerprint(row);
  row.CONFIGURATION_JSON = JSON.stringify({ ...configuration('A'), reportBaseline: snapshot() });
  const withBaseline = configurationSnapshotFingerprint(row);
  assert.notEqual(withBaseline, original);
  const changed = JSON.parse(row.CONFIGURATION_JSON);
  changed.reportBaseline.values.monthlyInboundCalls += 1;
  row.CONFIGURATION_JSON = JSON.stringify(changed);
  assert.notEqual(configurationSnapshotFingerprint(row), withBaseline);
});

test('stored baseline stays out of the actual synthetic resolver conversation and metadata', async () => {
  const fixture = runtimeFixture();
  const row = fixture.store.rows.get('RevenueDeskConfigurationVersions')[0];
  row.CONFIGURATION_JSON = JSON.stringify({ ...JSON.parse(row.CONFIGURATION_JSON), reportBaseline: snapshot() });
  const deployment = fixture.store.rows.get('RevenueDeskDeployments')[0];
  fixture.store.authorizationRows = [
    ...authorizationRows(deployment, row, 'A', fixture.config.authorizationEventSecret),
    ...fixture.store.authorizationRows.filter((item) => item.DEPLOYMENT_ID !== 'deployment_A'),
  ];
  const response = await invoke(fixture.listener, { url: '/retell/inbound', payload: payloadInbound('A'), env: fixture.env });
  assert.equal(response.status, 200);
  assert.equal(response.body.call_inbound.reject, undefined);
  const serialized = JSON.stringify(response.body);
  for (const field of ['reportBaseline', 'monthlyInboundCalls', 'averageJobValueMinorUnits', 'sourcePeriod']) {
    assert.equal(serialized.includes(field), false);
  }
  assert.equal(serialized.includes(snapshot().clientKey), false);
});
