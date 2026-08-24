'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadJobConfig } = require('../lib/config');
const { createRetryJobHandler, assertDevelopmentJob } = require('../lib/job-handler');
const { environment } = require('./runtime-fixture');

const config = loadJobConfig(environment());
const runtimeEnvironment = environment();

function request(overrides = {}) {
  return {
    getProjectDetails() { return { id: config.developmentProjectId }; },
    getJobPoolDetails() { return { id: config.retryJobPoolId, type: 'Function' }; },
    ...overrides,
  };
}

test('unit: retry Job accepts only the exact platform Development, project, and Function pool identity', () => {
  assert.doesNotThrow(() => assertDevelopmentJob(request(), runtimeEnvironment, config));
  assert.throws(() => assertDevelopmentJob(request(),
    { ...runtimeEnvironment, X_ZOHO_CATALYST_ENVIRONMENT: 'Production' }, config), { code: 'PRODUCTION_BLOCKED' });
  assert.throws(() => assertDevelopmentJob(request({ getProjectDetails() { return { id: '999' }; } }),
    runtimeEnvironment, config), { code: 'PRODUCTION_BLOCKED' });
  assert.throws(() => assertDevelopmentJob(request({
    getJobPoolDetails() { return { id: '999', type: 'Function' }; },
  }), runtimeEnvironment, config), { code: 'PRODUCTION_BLOCKED' });
  assert.throws(() => assertDevelopmentJob(request({
    getJobPoolDetails() { return { id: config.retryJobPoolId, type: 'Webhook' }; },
  }), runtimeEnvironment, config), { code: 'PRODUCTION_BLOCKED' });
});

test('unit: retry Job supports both currently documented Job Pool method casings without using params', () => {
  const lowerCaseMethod = request({ getJobPoolDetails: undefined,
    getJobpoolDetails() { return { id: config.retryJobPoolId, type: 'Function' }; } });
  assert.doesNotThrow(() => assertDevelopmentJob(lowerCaseMethod, runtimeEnvironment, config));
  assert.throws(() => assertDevelopmentJob(request({ getJobPoolDetails: undefined }), runtimeEnvironment, config),
    { code: 'PRODUCTION_BLOCKED' });
});

test('unit: retry Job closes with failure when a row failure remains uncontained', async () => {
  const result = {
    events: { examined: 1, results: [{ status: 'Failed', errorCode: 'CATALYST_QUERY_FAILED' }] },
    notifications: { examined: 0, reconciliationRequired: 0, results: [] },
  };
  const context = {
    failed: false, succeeded: false,
    closeWithFailure() { this.failed = true; },
    closeWithSuccess() { this.succeeded = true; },
  };
  const handler = createRetryJobHandler({
    catalystSdk: { initialize() { return {}; } }, environment: runtimeEnvironment,
    storeFactory: () => ({}), mailFactory: () => ({}),
    serviceFactory: () => ({ async runRetryJob() { return result; } }),
  });
  assert.equal(await handler(request(), context), result);
  assert.equal(context.failed, true);
  assert.equal(context.succeeded, false);
});
