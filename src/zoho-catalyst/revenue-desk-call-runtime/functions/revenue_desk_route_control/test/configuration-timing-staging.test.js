'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard }
  = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const { providerTimingFixture }
  = require('../../revenue_desk_call_gateway/test/provider-timing-fixture');
const { validateConfiguration }
  = require('revenue_desk_call_gateway/lib/validation');
const { RECEIPT_KIND } = require('../lib/configuration-staging-service');
const { createStagingFixture } = require('./helpers/configuration-staging-fixture');

const offlineGuard = installOfflineGuard();

const ROUTES = Object.freeze([
  Object.freeze({
    mode: 'NoAnswerOverflowOnly',
    stored: 'No-Answer/Overflow',
    label: 'No Answer / Overflow Only',
  }),
  Object.freeze({
    mode: 'AfterHoursAndOverflow',
    stored: 'Both',
    label: 'After Hours + Overflow',
  }),
]);

function configureTiming(fixture, route) {
  const current = JSON.parse(fixture.request.configurationRow.CONFIGURATION_JSON);
  fixture.records.deal.Approved_Test_Route = route.stored;
  fixture.records.deal.No_Answer_Delay = '5 Rings';
  const providerTimingInput = providerTimingFixture({
    clientId: current.clientId,
    crmDealId: current.crmDealId,
    deploymentId: current.deploymentId,
    configurationVersion: current.configurationVersion,
    phoneSystemProvider: current.phoneSystemProvider,
    coverageMode: route.mode,
  }, { businessNumber: fixture.records.account.Phone });
  fixture.request.review.providerTiming = structuredClone(providerTimingInput);
  const configuration = validateConfiguration({ ...current,
    coverageMode: route.mode,
    approvedTestRoute: route.label,
    noAnswerDelay: null,
    providerTiming: providerTimingInput,
  });
  fixture.request.configurationRow.CONFIGURATION_JSON = JSON.stringify(configuration);
  fixture.request.deployment.COVERAGE_MODE = route.mode;
  fixture.sign();
  return { configuration, providerTiming: configuration.providerTiming };
}

function durableSnapshot(fixture) {
  return structuredClone([...fixture.store.rows.entries()]);
}

function assertNoDurableWrite(fixture, recordsBefore) {
  assert.equal(fixture.store.writes.length, 0);
  assert.equal(fixture.stagingWrites, 0);
  assert.ok([...fixture.store.rows.values()].every((rows) => rows.length === 0));
  assert.deepEqual(fixture.records, recordsBefore);
}

test('owner-attested overflow timing stages one exact inactive configuration and replays read-only', async () => {
  for (const route of ROUTES) {
    const fixture = createStagingFixture();
    const { configuration, providerTiming } = configureTiming(fixture, route);

    const result = await fixture.service.stage(fixture.request);
    assert.equal(result.state, 'StagedInactive', route.mode);
    assert.equal(result.replayed, false, route.mode);
    assert.equal(result.approved, false, route.mode);
    assert.equal(result.active, false, route.mode);

    const configurations = fixture.store.rowsFor(
      fixture.config.tables.CONFIGURATION_VERSION_TABLE,
    );
    const deployments = fixture.store.rowsFor(fixture.config.tables.DEPLOYMENT_TABLE);
    const receipts = fixture.store.rowsFor(fixture.config.tables.EVENT_RECEIPT_TABLE)
      .filter((row) => row.RECEIPT_KIND === RECEIPT_KIND);
    assert.equal(configurations.length, 1, route.mode);
    assert.equal(deployments.length, 1, route.mode);
    assert.equal(receipts.length, 1, route.mode);
    assert.deepEqual(JSON.parse(configurations[0].CONFIGURATION_JSON), configuration, route.mode);
    assert.deepEqual(JSON.parse(configurations[0].CONFIGURATION_JSON).providerTiming,
      providerTiming, route.mode);
    assert.equal(deployments[0].COVERAGE_MODE, route.mode);
    assert.equal(deployments[0].TEST_STATUS, 'Ready for Approval');
    assert.equal(deployments[0].GO_LIVE_APPROVAL_STATUS, 'Pending Internal Approval');
    assert.equal(deployments[0].APPROVED_CONFIGURATION_VERSION_ID, null);
    assert.equal(deployments[0].APPROVAL_EVENT_KEY, null);
    assert.equal(deployments[0].ACTIVATION_EVENT_KEY, null);
    assert.equal(deployments[0].ACTUAL_START_AT, null);
    assert.equal(deployments[0].EXPIRES_AT, null);
    assert.equal(receipts[0].STATUS, 'Completed');
    assert.equal(Number(receipts[0].RECEIPT_VERSION), 1);
    assert.equal(fixture.records.deal.Deployment_Record_ID, deployments[0].DEPLOYMENT_ID);
    assert.equal(fixture.stagingWrites, 1);

    const beforeReplay = durableSnapshot(fixture);
    const writesBeforeReplay = fixture.store.writes.length;
    fixture.advance(15 * 60 * 1000 + 1);
    assert.deepEqual(await fixture.service.stage(fixture.request), { ...result, replayed: true });
    assert.equal(fixture.store.writes.length, writesBeforeReplay);
    assert.equal(fixture.stagingWrites, 1);
    assert.deepEqual(durableSnapshot(fixture), beforeReplay);

    const tampered = JSON.parse(fixture.request.configurationRow.CONFIGURATION_JSON);
    tampered.providerTiming.value = '31.5';
    fixture.request.configurationRow.CONFIGURATION_JSON = JSON.stringify(tampered);
    fixture.sign();
    await assert.rejects(fixture.service.stage(fixture.request),
      { code: 'CONFIGURATION_STAGING_CONFLICT' });
    assert.equal(fixture.store.writes.length, writesBeforeReplay);
    assert.equal(fixture.stagingWrites, 1);
    assert.deepEqual(durableSnapshot(fixture), beforeReplay);
  }
});

test('missing, stale, or request-tampered timing cannot write staging state', async () => {
  const cases = [
    {
      expectedCode: 'PROVIDER_TIMING_UNVERIFIED',
      mutate(fixture) { delete fixture.request.review.providerTiming; },
    },
    {
      expectedCode: 'PROVIDER_TIMING_UNVERIFIED',
      mutate(fixture) {
        fixture.request.review.providerTiming.observedAt = '2026-09-09T11:44:59.999Z';
      },
    },
    {
      expectedCode: 'CONFIGURATION_STAGING_CONFLICT',
      mutate(fixture) { fixture.request.review.providerTiming.value = '31.5'; },
    },
  ];
  for (const selected of cases) {
    const fixture = createStagingFixture();
    configureTiming(fixture, ROUTES[0]);
    const recordsBefore = structuredClone(fixture.records);
    selected.mutate(fixture);
    await assert.rejects(fixture.service.stage(fixture.request),
      { code: selected.expectedCode });
    assertNoDurableWrite(fixture, recordsBefore);
  }
});

test.after(() => {
  assert.deepEqual(offlineGuard.blocked, []);
  offlineGuard.restore();
});
