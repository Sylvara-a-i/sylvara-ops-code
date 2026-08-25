'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnalyticsSyncJobHandler } = require('../lib/job-handler');
const { MemoryStore } = require('./helpers');
const REVISION = 'a'.repeat(40);

function environment(configuredEnvironment, mode) {
  const catalystEnvironment = configuredEnvironment === 'production'
    ? 'Production' : 'Development';
  return {
    DEPLOYMENT_ENVIRONMENT: configuredEnvironment,
    X_ZOHO_CATALYST_ENVIRONMENT: catalystEnvironment,
    SOURCE_REVISION: 'a'.repeat(40), ANALYTICS_SYNC_MODE: mode,
    EXPECTED_CATALYST_PROJECT_ID: '123456', ANALYTICS_JOB_POOL_ID: '654321',
    ANALYTICS_CHECKPOINT_TABLE: 'AnalyticsSyncCheckpoints',
    ANALYTICS_OUTBOX_TABLE: 'AnalyticsSyncOutbox',
  };
}

function productionEnvironment(mode) {
  return {
    DEPLOYMENT_ENVIRONMENT: 'production', X_ZOHO_CATALYST_ENVIRONMENT: 'Production',
    SOURCE_REVISION: 'a'.repeat(40), ANALYTICS_SYNC_MODE: mode,
    EXPECTED_CATALYST_PROJECT_ID: '123456', ANALYTICS_JOB_POOL_ID: '654321',
  };
}

function job(params = {}) {
  return {
    getProjectDetails: () => ({ id: '123456', name: 'Private project' }),
    getJobPoolDetails: () => ({ id: '654321', name: 'RevenueDeskAnalyticsJobs', type: 'Function' }),
    getAllJobParams: () => params,
  };
}

function context() {
  return {
    succeeded: 0, failed: 0,
    closeWithSuccess() { this.succeeded += 1; },
    closeWithFailure() { this.failed += 1; },
  };
}

test('Production disabled and readiness are identical dark no-ops before SDK or external I/O', async () => {
  for (const mode of ['disabled', 'readiness']) {
    let initialized = 0;
    const ctx = context();
    const handler = createAnalyticsSyncJobHandler({
      environment: productionEnvironment(mode),
      artifactSourceRevision: REVISION,
      catalystSdk: { initialize() { initialized += 1; throw new Error('must not initialize'); } },
      storeFactory() { throw new Error('must not create a Data Store adapter'); },
      clientFactory() { throw new Error('must not create an Analytics client'); },
      fetchImpl() { throw new Error('must not perform external I/O'); },
    });
    const result = await handler(job(), ctx);
    assert.deepEqual(result, {
      state: 'DarkNoOp', mode, environment: 'production', externalReads: 0,
      externalWrites: 0, sourceRevision: 'a'.repeat(40),
    });
    assert.equal(initialized, 0);
    assert.equal(ctx.succeeded, 1);
    assert.equal(ctx.failed, 0);
  }
});

test('Development disabled is an SDK-free no-op and readiness touches only the two Catalyst tables', async () => {
  let initialized = 0;
  let storeFactoryCalls = 0;
  const disabledContext = context();
  const disabled = createAnalyticsSyncJobHandler({
    environment: environment('development', 'disabled'),
    artifactSourceRevision: REVISION,
    catalystSdk: { initialize() { initialized += 1; } },
  });
  assert.equal((await disabled(job(), disabledContext)).state, 'DisabledNoOp');
  assert.equal(initialized, 0);

  const store = new MemoryStore();
  const readinessContext = context();
  const readiness = createAnalyticsSyncJobHandler({
    environment: environment('development', 'readiness'),
    artifactSourceRevision: REVISION,
    catalystSdk: { initialize() { initialized += 1; return {}; } },
    storeFactory() { storeFactoryCalls += 1; return store; },
    clientFactory() { throw new Error('readiness must not create an Analytics client'); },
  });
  const result = await readiness(job(), readinessContext);
  assert.equal(result.state, 'Readiness');
  assert.equal(result.analyticsWritesEnabled, false);
  assert.equal(result.tableCount, 2);
  assert.equal(result.rowSchemaVersion, 2);
  assert.equal(initialized, 1);
  assert.equal(storeFactoryCalls, 1);
  assert.equal(store.readinessCalls, 1);
});

test('caller-selected Job params and wrong project or pool identity fail closed', async () => {
  for (const invalidJob of [
    job({ mode: 'active' }),
    { ...job(), getProjectDetails: () => ({ id: '999999' }) },
    { ...job(), getJobPoolDetails: () => ({ id: '654321', name: 'WrongPool', type: 'Function' }) },
  ]) {
    const ctx = context();
    const handler = createAnalyticsSyncJobHandler({
      environment: environment('development', 'disabled'),
      artifactSourceRevision: REVISION,
      catalystSdk: { initialize() { throw new Error('must not initialize'); } },
    });
    const result = await handler(invalidJob, ctx);
    assert.equal(result.state, 'Failed');
    assert.equal(ctx.succeeded, 0);
    assert.equal(ctx.failed, 1);
  }
});

test('configured lowercase environment must match the native title-case Catalyst identity', async () => {
  const invalidEnvironment = environment('development', 'disabled');
  invalidEnvironment.X_ZOHO_CATALYST_ENVIRONMENT = 'development';
  const ctx = context();
  const handler = createAnalyticsSyncJobHandler({
    environment: invalidEnvironment,
    artifactSourceRevision: REVISION,
    catalystSdk: { initialize() { throw new Error('must not initialize'); } },
  });
  const result = await handler(job(), ctx);
  assert.equal(result.state, 'Failed');
  assert.equal(result.code, 'JOB_IDENTITY_INVALID');
  assert.equal(ctx.failed, 1);
});
