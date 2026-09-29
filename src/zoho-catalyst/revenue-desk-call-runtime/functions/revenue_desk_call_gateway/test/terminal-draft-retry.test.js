'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { createRuntimeService } = require('../lib/runtime-service');
const { createWorkerJobHandler } = require('../lib/job-handler');
const { RevenueDeskError } = require('../lib/errors');
const { SOURCE_REVISION, runtimeFixture, retryJobRequest, retryJobContext } = require('./runtime-fixture');

test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });

function service(fixture, extra = {}) {
  return createRuntimeService({ store: fixture.store, mailAdapter: {}, config: fixture.config,
    now: () => fixture.clock.value, ...extra });
}

async function completeSyntheticCrmReadback(fixture) {
  for (const operation of fixture.store.rows.get('CRMBillingOperations')) {
    await fixture.store.mutate('CRMBillingOperations', 'OPERATION_KEY', operation.OPERATION_KEY,
      'OPERATION_VERSION', () => ({ STATUS: 'completed', LAST_OUTCOME: 'report_summary_readback_confirmed' }));
  }
}

async function terminalFixture() {
  const fixture = runtimeFixture();
  fixture.clock.value = Date.parse('2026-08-27T12:00:00.000Z');
  const runtime = service(fixture);
  const waiting = await runtime.reconcileDueDeployments(25);
  assert.ok(waiting.results.every((row) => row.status === 'AwaitingCrmReportReadback'));
  await completeSyntheticCrmReadback(fixture);
  const completed = await runtime.reconcileDueDeployments(25);
  assert.ok(completed.results.every((row) => row.status === 'TerminalReportReconciled'));
  return fixture;
}

function businessState(fixture) {
  return structuredClone({
    operations: fixture.store.rows.get('CRMBillingOperations'),
    outbox: fixture.store.rows.get('AnalyticsSyncOutbox'),
    deployments: fixture.store.rows.get('RevenueDeskDeployments').map((row) => {
      // The existing fair-scan cursor advances its CAS version on each attempt.
      const { UPDATED_AT, REPORT_RECONCILIATION_VERSION, ...business } = row;
      return business;
    }),
  });
}

test('terminal draft dependency stays held by default and starts only after exact CRM readback', async () => {
  const fixture = runtimeFixture();
  const observed = [];
  const runtime = service(fixture, { async onTerminalReportReconciled(scope, context) {
    assert.equal(Object.isFrozen(scope), true);
    assert.deepEqual(Object.keys(scope).sort(), ['clientId', 'deploymentId']);
    assert.equal(Object.isFrozen(context), true);
    assert.deepEqual(Object.keys(context), ['signal']);
    assert.equal(context.signal.aborted, false);
    const row = fixture.store.rows.get('RevenueDeskDeployments')
      .find((candidate) => candidate.DEPLOYMENT_ID === scope.deploymentId);
    assert.equal(row.CLIENT_ID, scope.clientId);
    assert.equal(row.REPORT_RECONCILIATION_STATUS, 'Completed');
    observed.push(scope);
    return { status: 'awaiting_reconciled_evidence', privateDiagnostic: 'must-not-propagate' };
  } });
  assert.equal((await runtime.reconcileDueDeployments()).examined, 0);
  fixture.clock.value = Date.parse('2026-08-27T12:00:00.000Z');
  await runtime.reconcileDueDeployments();
  assert.deepEqual(observed, []);
  await completeSyntheticCrmReadback(fixture);
  const ready = await runtime.reconcileDueDeployments();
  assert.deepEqual(observed, [{ clientId: 'client_A', deploymentId: 'deployment_A' }]);
  assert.equal(ready.results.filter((row) => row.reportDraftStatus).length, 1);
  await runtime.reconcileDueDeployments();
  assert.deepEqual(observed, [{ clientId: 'client_A', deploymentId: 'deployment_A' },
    { clientId: 'client_B', deploymentId: 'deployment_B' }]);
  assert.equal(JSON.stringify(ready).includes('must-not-propagate'), false);
  const before = businessState(fixture);
  const held = await service(fixture).reconcileDueDeployments();
  assert.ok(held.results.every((row) => !Object.hasOwn(row, 'reportDraftStatus')));
  assert.deepEqual(businessState(fixture), before);
});

test('a failed draft retries on the existing Completed sweep without replaying CRM or outbox work', async () => {
  const fixture = await terminalFixture();
  const before = businessState(fixture);
  const attempted = [];
  let failFirst = true;
  const runtime = service(fixture, { async onTerminalReportReconciled(scope) {
    attempted.push(scope.deploymentId);
    if (scope.deploymentId === 'deployment_A' && failFirst) {
      failFirst = false;
      throw new RevenueDeskError('PRIVATE_PROVIDER_DETAIL', 'private path and caller detail');
    }
    return { status: 'existing_draft_verified_not_for_delivery' };
  } });
  const first = await runtime.reconcileDueDeployments(1);
  assert.deepEqual(first.results, [{ status: 'Failed', errorCode: 'REPORT_DRAFT_RECONCILIATION_REQUIRED' }]);
  const second = await runtime.reconcileDueDeployments(1);
  assert.equal(second.results[0].deploymentId, 'deployment_B');
  assert.equal(second.results[0].reportDraftStatus, 'existing_draft_verified_not_for_delivery');
  const retried = await runtime.reconcileDueDeployments(1);
  assert.equal(retried.results[0].deploymentId, 'deployment_A');
  assert.equal(retried.results[0].reportDraftStatus, 'existing_draft_verified_not_for_delivery');
  assert.deepEqual(attempted, ['deployment_A', 'deployment_B', 'deployment_A']);
  assert.deepEqual(businessState(fixture), before);
  assert.doesNotMatch(JSON.stringify(first), /private|caller|deployment_A|PRIVATE_PROVIDER_DETAIL/);
});

test('a timed-out draft receives cancellation and cannot monopolize another completed deployment', async () => {
  const fixture = await terminalFixture();
  const before = businessState(fixture);
  let stalledSignal;
  const runtime = service(fixture, { config: { ...fixture.config, platformTimeoutMs: 250 },
    async onTerminalReportReconciled(scope, { signal }) {
      if (scope.deploymentId === 'deployment_A') {
        stalledSignal = signal;
        return new Promise(() => {});
      }
      return { status: 'draft_created_not_for_delivery' };
    } });
  const scanned = await runtime.reconcileDueDeployments(2);
  assert.equal(stalledSignal.aborted, true);
  assert.deepEqual(scanned.results[0], { status: 'Failed', errorCode: 'REPORT_DRAFT_RECONCILIATION_REQUIRED' });
  assert.equal(scanned.results[1].deploymentId, 'deployment_B');
  assert.equal(scanned.results[1].reportDraftStatus, undefined);
  const next = await runtime.reconcileDueDeployments(2);
  assert.equal(next.results[0].deploymentId, 'deployment_B');
  assert.equal(next.results[0].reportDraftStatus, 'draft_created_not_for_delivery');
  assert.deepEqual(businessState(fixture), before);
});

test('unsupported or missing draft outcomes fail closed after durable terminal reconciliation', async () => {
  const fixture = await terminalFixture();
  const before = businessState(fixture);
  for (const result of [undefined, null, {}, { status: 'emailed' }, { status: 'private-detail' }]) {
    const runtime = service(fixture, { onTerminalReportReconciled: async () => result });
    await assert.rejects(runtime.reconcileDeployment('deployment_A'), {
      code: 'REPORT_DRAFT_RECONCILIATION_REQUIRED', message: 'Terminal draft requires reconciliation.',
    });
  }
  assert.deepEqual(businessState(fixture), before);
  assert.throws(() => service(fixture, { onTerminalReportReconciled: true }),
    { code: 'INVALID_RUNTIME_CONFIGURATION' });
});

test('worker accepts the held trusted factory only after identity validation and sanitizes failures', async () => {
  const fixture = await terminalFixture();
  const logs = [];
  let constructed = 0;
  const options = { catalystSdk: fixture.catalystSdk, environment: fixture.env,
    artifactSourceRevision: SOURCE_REVISION, now: () => fixture.clock.value,
    storeFactory: () => fixture.store, mailFactory: () => ({}),
    dispatcherFactory: () => ({ async dispatch() { assert.fail('Completed CRM work must not dispatch again'); } }),
    logger: { info: (record) => logs.push(record), error: (record) => logs.push(record) },
    terminalDraftReconcilerFactory(app, config, store) {
      constructed += 1;
      assert.equal(app, fixture.app); assert.equal(store, fixture.store);
      assert.equal(config.sourceRevision, SOURCE_REVISION);
      return async () => { throw new Error('private caller content and path'); };
    } };
  const handler = createWorkerJobHandler(options);
  const context = () => retryJobContext({ closeWithFailure() {} });
  const invalid = retryJobRequest(fixture.env);
  invalid.getProjectDetails = () => ({ id: '999' });
  assert.equal((await handler(invalid, context())).errorCode, 'PRODUCTION_BLOCKED');
  assert.equal(constructed, 0);
  const failed = await handler(retryJobRequest(fixture.env), context());
  assert.equal(failed.status, 'Failed');
  assert.equal(failed.errorCode, 'WORKER_MODE_FAILED');
  assert.equal(constructed, 1);
  assert.doesNotMatch(JSON.stringify(logs), /client_A|deployment_A|private caller|path/);
  const factoryFailure = createWorkerJobHandler({ ...options,
    terminalDraftReconcilerFactory() { throw new Error('private factory configuration'); } });
  assert.equal((await factoryFailure(retryJobRequest(fixture.env), context())).errorCode,
    'REPORT_DRAFT_RECONCILIATION_REQUIRED');
});


test('trusted frozen reporting deadlines override only the callback timeout and one attempt spans the full worker scan', async () => {
  const fixture = await terminalFixture();
  const attempted = [];
  const callback = Object.freeze(Object.assign(async (scope) => {
    attempted.push(scope.deploymentId);
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { status: 'draft_created_not_for_delivery' };
  }, { attemptTimeoutMs: 250 }));
  const runtime = service(fixture, { config: { ...fixture.config, platformTimeoutMs: 5 },
    onTerminalReportReconciled: callback, crmSummaryDispatcher: { async dispatch() {
      assert.fail('Completed CRM work cannot replay');
    } } });
  const first = await runtime.runRetryJob(100);
  assert.equal(first.deployments.results.filter((row) => row.reportDraftStatus).length, 1);
  assert.deepEqual(attempted, ['deployment_A']);
  await runtime.runRetryJob(100);
  assert.deepEqual(attempted, ['deployment_A', 'deployment_B']);
  for (const deadline of [null, true, '', 0, 120001, 2.5]) {
    const invalid = Object.freeze(Object.assign(async () => {}, { attemptTimeoutMs: deadline }));
    assert.throws(() => service(fixture, { onTerminalReportReconciled: invalid }),
      { code: 'INVALID_RUNTIME_CONFIGURATION' });
  }
  assert.throws(() => service(fixture, { onTerminalReportReconciled:
    Object.assign(async () => {}, { attemptTimeoutMs: 250 }) }), { code: 'INVALID_RUNTIME_CONFIGURATION' });
});
