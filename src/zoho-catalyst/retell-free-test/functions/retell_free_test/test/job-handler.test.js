'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadJobConfig } = require('../lib/config');
const { assertDevelopmentJob } = require('../lib/job-handler');
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
