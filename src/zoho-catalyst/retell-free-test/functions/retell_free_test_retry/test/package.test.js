'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const functionRoot = path.join(__dirname, '..');

test('job target is independently deployable and imports a materialized reviewed core package', () => {
  const config = JSON.parse(fs.readFileSync(path.join(functionRoot, 'catalyst-config.json'), 'utf8'));
  assert.deepEqual(config.deployment, {
    name: 'retell_free_test_retry', stack: 'node18', type: 'job',
  });
  assert.equal(Object.hasOwn(config.deployment, 'env_variables'), false);
  assert.equal(config.execution.main, 'index.js');
  const projectConfig = JSON.parse(fs.readFileSync(path.join(functionRoot, '..', '..', 'catalyst.json'), 'utf8'));
  assert.deepEqual(projectConfig.functions.targets, ['retell_free_test', 'retell_free_test_retry']);
  assert.equal(projectConfig.functions.scripts.predeploy,
    'npm --prefix retell_free_test_retry ci --ignore-scripts --install-links');
  const retryConfig = JSON.parse(fs.readFileSync(
    path.join(functionRoot, '..', '..', 'config', 'retry-job.json'), 'utf8',
  ));
  assert.equal(retryConfig.record_type, 'development_retry_job_contract');
  assert.equal(retryConfig.environment, 'Development');
  assert.equal(retryConfig.live_state, 'requires_fresh_candidate_readback');
  assert.equal(Object.hasOwn(retryConfig, 'source_revision'), false);
  assert.equal(retryConfig.historical_observation.status, 'historical_only');
  assert.equal(retryConfig.function_target.memory_mb, 256);
  assert.equal(retryConfig.job_pool.memory_mb, 512);
  assert.equal(retryConfig.job.target_name, 'retell_free_test_retry');
  assert.deepEqual(retryConfig.job.params, {});
  assert.equal(retryConfig.job.platform_retries_enabled, false);
  assert.equal(retryConfig.cron.name, 'FreeTestRetry1m');
  assert.equal(retryConfig.cron.platform_name_max_characters, 20);
  assert.equal(retryConfig.cron.name.length <= retryConfig.cron.platform_name_max_characters, true,
    'Catalyst rejects Cron names longer than 20 characters');
  assert.equal(retryConfig.cron.status_on_initial_provisioning, 'disabled');
  assert.deepEqual(retryConfig.cron.detail,
    { hour: 0, minute: 1, second: 0, repetition_type: 'every' });

  assert.equal(require('../package.json').name, config.deployment.name);
  assert.match(fs.readFileSync(path.join(functionRoot, 'index.js'), 'utf8'),
    /createSafeConsoleLogger\(console\)/);
  const corePackagePath = require.resolve('retell_free_test/package.json');
  const corePackageRoot = path.dirname(corePackagePath);
  const coreSourceRoot = path.join(functionRoot, '..', 'retell_free_test');
  assert.equal(require(corePackagePath).name, 'retell_free_test');
  assert.equal(fs.lstatSync(corePackageRoot).isSymbolicLink(), false,
    'run npm ci with --install-links before Catalyst packages the job target');
  assert.equal(path.relative(functionRoot, fs.realpathSync(corePackageRoot)).startsWith('node_modules'), true);
  const runtimeFiles = [
    'index.js', 'package.json', path.join('contracts', 'free-test-contract.json'),
    ...fs.readdirSync(path.join(coreSourceRoot, 'lib')).sort().map((name) => path.join('lib', name)),
  ];
  for (const relativePath of runtimeFiles) {
    assert.equal(
      fs.readFileSync(path.join(corePackageRoot, relativePath), 'utf8'),
      fs.readFileSync(path.join(coreSourceRoot, relativePath), 'utf8'),
      `materialized core package is stale: ${relativePath}`,
    );
  }
  assert.equal(typeof require('../index'), 'function');
});
