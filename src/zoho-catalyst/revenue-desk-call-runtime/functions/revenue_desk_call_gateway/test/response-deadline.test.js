'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadConfig } = require('../lib/config');
const { RevenueDeskError } = require('../lib/errors');
const { createRequestListener } = require('../lib/runtime-boundary');
const { createRuntimeService } = require('../lib/runtime-service');
const {
  NOW, SOURCE_REVISION, RuntimeMemoryStore, environment, eventPayload, invoke, payloadInbound,
} = require('./runtime-fixture');

function application(env) {
  return {
    config: {
      environment: env.DEPLOYMENT_ENVIRONMENT,
      projectId: env.REVENUE_DESK_PROJECT_ID,
      projectKey: 'synthetic_development_project_key',
    },
  };
}

test('both Retell ingress routes fail closed within the reserved provider-response budget', async () => {
  const env = environment();
  const app = application(env);
  const listener = createRequestListener({
    catalystSdk: { initialize() { return app; } },
    environment: env,
    now: () => NOW,
    artifactSourceRevision: SOURCE_REVISION,
    storeFactory: () => ({}),
    jobFactory: () => ({}),
    serviceFactory: () => ({
      acceptEvent: () => new Promise(() => {}),
      resolveInbound: () => new Promise(() => {}),
    }),
    retellResponseBudgetMs: 20,
  });

  for (const request of [
    { url: '/retell/events', payload: eventPayload(
      'call_ended', 'response_deadline_A', {}, 'A',
    ) },
    { url: '/retell/inbound', payload: payloadInbound('A') },
  ]) {
    const startedAt = performance.now();
    const response = await invoke(listener, {
      ...request,
      env,
      processJobs: false,
    });
    const elapsedMs = performance.now() - startedAt;

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      ok: false,
      code: 'RETELL_RESPONSE_DEADLINE_EXCEEDED',
    });
    assert.ok(elapsedMs < 500, `deadline response took ${elapsedMs}ms`);
  }
});

test('a late resolved inbound receipt remains an explicit terminal reconciliation gate', async () => {
  const env = environment();
  const config = loadConfig(env, { artifactSourceRevision: SOURCE_REVISION });
  const store = new RuntimeMemoryStore(config);
  store.rows.set(config.tables.DEPLOYMENT_TABLE,
    store.rows.get(config.tables.DEPLOYMENT_TABLE)
      .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  store.rows.set(config.tables.CONFIGURATION_VERSION_TABLE,
    store.rows.get(config.tables.CONFIGURATION_VERSION_TABLE)
      .filter((row) => row.DEPLOYMENT_ID === 'deployment_A'));
  const app = application(env);
  const clock = { value: NOW };
  const originalInsertUnique = store.insertUnique.bind(store);
  let releaseInsert;
  let insertCommitted;
  const committed = new Promise((resolve) => { insertCommitted = resolve; });
  const release = new Promise((resolve) => { releaseInsert = resolve; });
  store.insertUnique = async (...args) => {
    const result = await originalInsertUnique(...args);
    const [table, , row] = args;
    if (table === config.tables.EVENT_RECEIPT_TABLE
      && row.RECEIPT_KIND === 'inbound_resolution') {
      insertCommitted();
      await release;
    }
    return result;
  };
  let resolutionCompleted;
  const completed = new Promise((resolve) => { resolutionCompleted = resolve; });
  const listener = createRequestListener({
    catalystSdk: { initialize() { return app; } },
    environment: env,
    now: () => clock.value,
    artifactSourceRevision: SOURCE_REVISION,
    storeFactory: () => store,
    serviceFactory: (options) => {
      const service = createRuntimeService(options);
      return Object.freeze({
        ...service,
        async resolveInbound(...args) {
          try {
            return await service.resolveInbound(...args);
          } finally {
            resolutionCompleted();
          }
        },
      });
    },
    retellResponseBudgetMs: 20,
  });

  const invocation = invoke(listener, {
    url: '/retell/inbound', payload: payloadInbound('A'), env, processJobs: false,
  });
  await committed;
  const response = await invocation;
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'RETELL_RESPONSE_DEADLINE_EXCEEDED');
  releaseInsert();
  await completed;

  const [receipt] = store.rows.get(config.tables.EVENT_RECEIPT_TABLE);
  assert.equal(receipt.RECEIPT_KIND, 'inbound_resolution');
  assert.equal(JSON.parse(receipt.EVENT_DATA_JSON).decision, 'Resolved');
  assert.equal(store.rows.get(config.tables.CANONICAL_CALL_TABLE).length, 0);

  clock.value = Date.parse(store.rows.get(config.tables.DEPLOYMENT_TABLE)[0].EXPIRES_AT);
  const service = createRuntimeService({ store, mailAdapter: null, config, now: () => clock.value });
  const reconciliation = await service.reconcileDueDeployments(25);
  assert.equal(reconciliation.results.some((item) => item.status === 'AwaitingSettlement'), true);
  const deployment = store.rows.get(config.tables.DEPLOYMENT_TABLE)[0];
  assert.equal(deployment.REPORT_RECONCILIATION_STATUS, 'AwaitingSettlement');
  assert.equal(store.rows.get(config.tables.OPERATION_TABLE).length, 0);
  assert.equal(store.rows.get(config.tables.ANALYTICS_OUTBOX_TABLE)
    .filter((row) => row.RECORD_TYPE === 'final_test_result').length, 0);
});

test('a late committed receipt and concurrent provider retry submit and process exactly once', async () => {
  const env = environment();
  const config = loadConfig(env, { artifactSourceRevision: SOURCE_REVISION });
  const store = new RuntimeMemoryStore(config);
  const app = application(env);
  const originalInsertUnique = store.insertUnique.bind(store);
  let releaseFirstInsert;
  let firstInsertCommitted;
  let delayed = false;
  const firstInsertBarrier = new Promise((resolve) => { firstInsertCommitted = resolve; });
  const releaseBarrier = new Promise((resolve) => { releaseFirstInsert = resolve; });
  store.insertUnique = async (...args) => {
    const result = await originalInsertUnique(...args);
    const [table, , row] = args;
    if (!delayed && table === config.tables.EVENT_RECEIPT_TABLE
      && row.RECEIPT_KIND === 'provider_event') {
      delayed = true;
      firstInsertCommitted();
      await releaseBarrier;
    }
    return result;
  };

  const submitted = [];
  let serviceCount = 0;
  let firstServiceCompleted;
  const firstCompletion = new Promise((resolve) => { firstServiceCompleted = resolve; });
  const listener = createRequestListener({
    catalystSdk: { initialize() { return app; } },
    environment: env,
    now: () => NOW,
    artifactSourceRevision: SOURCE_REVISION,
    storeFactory: () => store,
    jobFactory: () => ({
      async enqueueProcessEvent(eventKey) {
        submitted.push(eventKey);
        return { jobId: `job_${eventKey.slice(-24)}`, status: 'Submitted' };
      },
    }),
    serviceFactory: (options) => {
      const service = createRuntimeService(options);
      serviceCount += 1;
      if (serviceCount !== 1) return service;
      return Object.freeze({
        ...service,
        async acceptEvent(...args) {
          try {
            return await service.acceptEvent(...args);
          } finally {
            firstServiceCompleted();
          }
        },
      });
    },
    retellResponseBudgetMs: 20,
  });
  const request = {
    url: '/retell/events',
    payload: eventPayload('call_ended', 'deadline_retry_A', {}, 'A'),
    env,
    processJobs: false,
  };

  const firstInvocation = invoke(listener, request);
  await firstInsertBarrier;
  const timedOut = await firstInvocation;
  assert.equal(timedOut.status, 503);
  assert.equal(timedOut.body.code, 'RETELL_RESPONSE_DEADLINE_EXCEEDED');

  const retry = await invoke(listener, request);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, 'Queued');
  assert.equal(retry.body.duplicate, true);
  releaseFirstInsert();
  await firstCompletion;

  assert.equal(submitted.length, 1);
  const receipts = store.rows.get(config.tables.EVENT_RECEIPT_TABLE)
    .filter((row) => row.RECEIPT_KIND === 'provider_event');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].STATUS, 'Queued');
  assert.equal(receipts[0].LEASE_TOKEN, null);
  assert.equal(receipts[0].JOB_REFERENCE, `job_${submitted[0].slice(-24)}`);

  const worker = createRuntimeService({ store, mailAdapter: null, config, now: () => NOW });
  const processed = await worker.processEventReceipt(submitted[0]);
  const duplicate = await worker.processEventReceipt(submitted[0]);
  assert.equal(processed.status, 'Completed');
  assert.deepEqual(duplicate, { status: 'Completed', duplicate: true });
  assert.equal(store.rows.get(config.tables.CANONICAL_CALL_TABLE).length, 1);
  assert.equal(store.rows.get(config.tables.DEPLOYMENT_TABLE)[0].HANDLED_COUNT, 1);
});

test('ambiguous job submission remains durably queued and is never resubmitted by HTTP replay', async () => {
  const env = environment();
  const config = loadConfig(env, { artifactSourceRevision: SOURCE_REVISION });
  const store = new RuntimeMemoryStore(config);
  const app = application(env);
  const clock = { value: NOW };
  let submitAttempts = 0;
  const listener = createRequestListener({
    catalystSdk: { initialize() { return app; } },
    environment: env,
    now: () => clock.value,
    artifactSourceRevision: SOURCE_REVISION,
    storeFactory: () => store,
    jobFactory: () => ({
      async enqueueProcessEvent() {
        submitAttempts += 1;
        throw new RevenueDeskError(
          'CATALYST_JOB_SUBMIT_TIMEOUT',
          'Synthetic ambiguous job outcome.',
          { httpStatus: 503, retryable: true, ambiguous: true },
        );
      },
    }),
  });
  const request = {
    url: '/retell/events',
    payload: eventPayload('call_ended', 'ambiguous_job_A', {}, 'A'),
    env,
    processJobs: false,
  };

  const ambiguous = await invoke(listener, request);
  assert.equal(ambiguous.status, 503);
  assert.equal(ambiguous.body.code, 'CATALYST_JOB_SUBMIT_TIMEOUT');
  const replay = await invoke(listener, request);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.status, 'Queued');
  assert.equal(replay.body.duplicate, true);
  assert.equal(submitAttempts, 1);

  const [receipt] = store.rows.get(config.tables.EVENT_RECEIPT_TABLE)
    .filter((row) => row.RECEIPT_KIND === 'provider_event');
  assert.equal(receipt.STATUS, 'Queued');
  assert.equal(receipt.LEASE_TOKEN, null);
  assert.equal(receipt.JOB_REFERENCE, null);
  assert.equal(receipt.LAST_ERROR_CODE, 'CATALYST_JOB_SUBMIT_TIMEOUT');

  const originalQuery = store.query.bind(store);
  let failProcessingOnce = true;
  store.query = async (...args) => {
    if (failProcessingOnce && args[0] === config.tables.DEPLOYMENT_TABLE) {
      failProcessingOnce = false;
      throw new RevenueDeskError(
        'SYNTHETIC_RETRYABLE_DEPENDENCY',
        'Synthetic retryable processing failure.',
        { httpStatus: 503, retryable: true },
      );
    }
    return originalQuery(...args);
  };
  const worker = createRuntimeService({
    store, mailAdapter: null, config, now: () => clock.value,
  });
  await assert.rejects(
    worker.processEventReceipt(receipt.EVENT_KEY),
    (error) => error.code === 'SYNTHETIC_RETRYABLE_DEPENDENCY',
  );
  const retryRequired = await store.unique(
    config.tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', receipt.EVENT_KEY,
  );
  assert.equal(retryRequired.STATUS, 'RetryRequired');
  clock.value += 1_000;

  const dueReplay = await invoke(listener, request);
  assert.equal(dueReplay.status, 200);
  assert.equal(dueReplay.body.status, 'RetryRequired');
  assert.equal(dueReplay.body.duplicate, true);
  assert.equal(submitAttempts, 1);

  const processed = await worker.processEventReceipt(receipt.EVENT_KEY);
  assert.equal(processed.status, 'Completed');
  assert.equal(store.rows.get(config.tables.CANONICAL_CALL_TABLE).length, 1);
});
