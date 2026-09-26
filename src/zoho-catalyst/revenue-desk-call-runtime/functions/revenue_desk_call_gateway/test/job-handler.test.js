'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { RevenueDeskError } = require('../lib/errors');
const { loadJobConfig: loadRuntimeJobConfig } = require('../lib/config');
const {
  createWorkerJobHandler: createRuntimeWorkerJobHandler, assertDevelopmentJob, readJobParams,
} = require('../lib/job-handler');
const { SOURCE_REVISION, environment } = require('./runtime-fixture');

const loadJobConfig = (env) => loadRuntimeJobConfig(env, {
  artifactSourceRevision: SOURCE_REVISION,
});
const createWorkerJobHandler = (options) => createRuntimeWorkerJobHandler({
  dispatcherFactory: () => ({ dispatch: async () => ({ status: 'Dispatched' }) }),
  ...options,
  artifactSourceRevision: SOURCE_REVISION,
});

const config = loadJobConfig(environment());
const runtimeEnvironment = environment();

function request(overrides = {}) {
  return {
    getProjectDetails() { return { id: config.projectId }; },
    getJobPoolDetails() {
      return { id: config.workerJobPoolId, name: 'RevenueDeskCallJobs', type: 'Function' };
    },
    getAllJobParams() { return { mode: 'retry_scan' }; },
    ...overrides,
  };
}

test('unit: worker accepts only the exact Development project and Function Job pool identity', () => {
  assert.doesNotThrow(() => assertDevelopmentJob(request(), runtimeEnvironment, config));
  assert.throws(() => assertDevelopmentJob(request(),
    { ...runtimeEnvironment, X_ZOHO_CATALYST_ENVIRONMENT: 'Production' }, config), { code: 'PRODUCTION_BLOCKED' });
  assert.throws(() => assertDevelopmentJob(request({ getProjectDetails() { return { id: '999' }; } }),
    runtimeEnvironment, config), { code: 'PRODUCTION_BLOCKED' });
  assert.throws(() => assertDevelopmentJob(request({
    getJobPoolDetails() { return { id: '999', name: 'RevenueDeskCallJobs', type: 'Function' }; },
  }), runtimeEnvironment, config), { code: 'PRODUCTION_BLOCKED' });
  assert.throws(() => assertDevelopmentJob(request({
    getJobPoolDetails() {
      return { id: config.workerJobPoolId, name: 'RevenueDeskCallJobs', type: 'Webhook' };
    },
  }), runtimeEnvironment, config), { code: 'PRODUCTION_BLOCKED' });
  assert.throws(() => assertDevelopmentJob(request({
    getJobPoolDetails() {
      return { id: config.workerJobPoolId, name: 'AnotherPool', type: 'Function' };
    },
  }), runtimeEnvironment, config), { code: 'PRODUCTION_BLOCKED' });
});

test('unit: minimal Production dark worker rejects before Job Request, SDK, store, or service access', async () => {
  const accesses = { request: 0, sdk: 0, store: 0, service: 0 };
  const handler = createWorkerJobHandler({
    environment: {
      DEPLOYMENT_ENVIRONMENT: 'production', DEPLOYMENT_MODE: 'dark', SOURCE_REVISION,
    },
    catalystSdk: { initialize() { accesses.sdk += 1; } },
    storeFactory() { accesses.store += 1; },
    serviceFactory() { accesses.service += 1; },
  });
  const jobRequest = {
    getProjectDetails() { accesses.request += 1; return {}; },
    getJobPoolDetails() { accesses.request += 1; return {}; },
    getAllJobParams() { accesses.request += 1; return {}; },
  };
  const result = await handler(jobRequest, { closeWithFailure() {} });
  assert.deepEqual(result, { status: 'Failed', errorCode: 'PRODUCTION_DARK' });
  assert.deepEqual(accesses, { request: 0, sdk: 0, store: 0, service: 0 });
});

test('unit: worker supports both documented Job Pool method casings', () => {
  const lowerCaseMethod = request({ getJobPoolDetails: undefined,
    getJobpoolDetails() {
      return { id: config.workerJobPoolId, name: 'RevenueDeskCallJobs', type: 'Function' };
    } });
  assert.doesNotThrow(() => assertDevelopmentJob(lowerCaseMethod, runtimeEnvironment, config));
  assert.throws(() => assertDevelopmentJob(request({ getJobPoolDetails: undefined }), runtimeEnvironment, config),
    { code: 'PRODUCTION_BLOCKED' });
});

test('unit: worker accepts only exact string parameters for the four private modes', () => {
  assert.deepEqual(readJobParams(request({
    getAllJobParams() { return { mode: 'process_event', event_key: `evt_${'a'.repeat(64)}` }; },
  })), { mode: 'process_event', event_key: `evt_${'a'.repeat(64)}` });
  assert.deepEqual(readJobParams(request()), { mode: 'retry_scan' });
  for (const mode of ['rebuild_report', 'reconcile_deployment']) {
    assert.deepEqual(readJobParams(request({
      getAllJobParams() { return { mode, deployment_id: 'deployment_A' }; },
    })), { mode, deployment_id: 'deployment_A' });
  }
  for (const params of [
    {}, { mode: 'unknown' }, { mode: 'approve_route' }, { mode: 'activate_route' },
    { mode: 'retry_scan', extra: 'x' },
    { mode: 'process_event' }, { mode: 'process_event', event_key: 'raw-provider-id' },
    { mode: 'rebuild_report', deployment_id: 'bad/id' },
    { mode: 'retry_scan', limit: 25 },
  ]) {
    assert.throws(() => readJobParams(request({ getAllJobParams() { return params; } })),
      { code: 'INVALID_JOB_PARAMETER' });
  }
});

test('unit: worker dispatches each validated mode to one exact service operation', async () => {
  const calls = [];
  const service = {
    async processEventReceipt(value) { calls.push(['process_event', value]); return { status: 'Completed' }; },
    async runRetryJob(value) {
      calls.push(['retry_scan', value]);
      return { events: { results: [] }, notifications: { results: [] },
        deployments: { results: [] }, reportSummaries: { results: [] } };
    },
    async rebuildReport(value) { calls.push(['rebuild_report', value]); return { status: 'ReportRebuilt' }; },
    async reconcileDeployment(value) {
      calls.push(['reconcile_deployment', value]);
      return { status: 'DeploymentReconciled' };
    },
  };
  const handler = createWorkerJobHandler({
    catalystSdk: { initialize() { return {}; } },
    environment: runtimeEnvironment,
    storeFactory: () => ({}),
    mailFactory: () => ({}),
    serviceFactory: () => service,
  });
  const invocations = [
    { mode: 'process_event', event_key: `evt_${'b'.repeat(64)}` },
    { mode: 'retry_scan' },
    { mode: 'rebuild_report', deployment_id: 'deployment_A' },
    { mode: 'reconcile_deployment', deployment_id: 'deployment_A' },
  ];
  for (const params of invocations) {
    const context = { closeWithSuccess() {} };
    await handler(request({ getAllJobParams() { return params; } }), context);
  }
  assert.deepEqual(calls, [
    ['process_event', `evt_${'b'.repeat(64)}`],
    ['retry_scan', 25],
    ['rebuild_report', 'deployment_A'],
    ['reconcile_deployment', 'deployment_A'],
  ]);
});

test('unit: retry_scan closes with failure when a row failure remains uncontained', async () => {
  const result = {
    events: { examined: 1, results: [{ status: 'Failed', errorCode: 'CATALYST_QUERY_FAILED' }] },
    notifications: { examined: 0, reconciliationRequired: 0, results: [] },
    deployments: { expired: 0, examined: 0, results: [] },
    reportSummaries: { examined: 0, results: [] },
  };
  const context = {
    failed: false, succeeded: false,
    closeWithFailure() { this.failed = true; },
    closeWithSuccess() { this.succeeded = true; },
  };
  const handler = createWorkerJobHandler({
    catalystSdk: { initialize() { return {}; } }, environment: runtimeEnvironment,
    storeFactory: () => ({}), mailFactory: () => ({}),
    serviceFactory: () => ({ async runRetryJob() { return result; } }),
  });
  assert.deepEqual(await handler(request(), context), {
    status: 'Failed',
    errorCode: 'WORKER_MODE_FAILED',
  });
  assert.equal(context.failed, true);
  assert.equal(context.succeeded, false);
});

test('unit: worker contains diagnostic codes, messages and causes at both failure exits', async () => {
  const marker = 'synthetic-private-diagnostic';
  const cases = [
    { failure: Object.assign(new Error(marker, { cause: new Error(marker) }),
      { code: `https://example.invalid/${marker}`, retryable: true, ambiguous: true }),
      expectedCode: 'UNEXPECTED_ERROR', retryable: false, ambiguous: false },
    { failure: Object.assign(new Error(marker), { code: 'SYNTHETIC_PRIVATE_CONTENT' }),
      expectedCode: 'UNEXPECTED_ERROR', retryable: false, ambiguous: false },
    { failure: new RevenueDeskError(marker, marker, { cause: new Error(marker) }),
      expectedCode: 'UNEXPECTED_ERROR', retryable: false, ambiguous: false },
    { failure: new RevenueDeskError('CATALYST_QUERY_FAILED', marker,
      { cause: new Error(marker), httpStatus: 503, retryable: true, ambiguous: true }),
      expectedCode: 'CATALYST_QUERY_FAILED', retryable: true, ambiguous: true },
  ];
  for (const { failure, expectedCode, retryable, ambiguous } of cases) {
    const logs = [];
    let closed = 0;
    const handler = createWorkerJobHandler({
      environment: runtimeEnvironment,
      catalystSdk: { initialize() { throw failure; } },
      logger: { error(record) { logs.push(record); } },
    });
    assert.deepEqual(await handler(request(), { closeWithFailure() { closed += 1; } }),
      { status: 'Failed', errorCode: expectedCode });
    assert.equal(closed, 1);
    await assert.rejects(handler(request(), {}), (escaped) => {
      assert.notEqual(escaped, failure);
      assert.equal(escaped.code, expectedCode);
      assert.equal(escaped.message, 'Revenue Desk worker failed.');
      assert.equal(escaped.retryable, retryable);
      assert.equal(escaped.ambiguous, ambiguous);
      assert.equal(escaped.httpStatus, failure instanceof RevenueDeskError ? failure.httpStatus : 503);
      assert.equal(Object.hasOwn(escaped, 'cause'), false);
      assert.equal(escaped.stack.includes(marker), false);
      return true;
    });
    assert.equal(logs.length, 2);
    assert.ok(logs.every(({ errorCode }) => errorCode === expectedCode));
    assert.equal(JSON.stringify(logs).includes(marker), false);
  }
});
