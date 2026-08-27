'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const functionRoot = path.join(__dirname, '..');

test('job target is independently deployable and imports a materialized reviewed core package', () => {
  const config = JSON.parse(fs.readFileSync(path.join(functionRoot, 'catalyst-config.json'), 'utf8'));
  assert.deepEqual(config.deployment, {
    name: 'revenue_desk_call_worker', stack: 'node24', type: 'job',
  });
  assert.equal(Object.hasOwn(config.deployment, 'env_variables'), false);
  assert.equal(config.execution.main, 'index.js');
  const projectConfig = JSON.parse(fs.readFileSync(path.join(functionRoot, '..', '..', 'catalyst.json'), 'utf8'));
  assert.deepEqual(projectConfig.functions.targets, ['revenue_desk_call_gateway', 'revenue_desk_call_worker']);
  assert.equal(projectConfig.functions.scripts.predeploy,
    'npm --prefix revenue_desk_call_worker ci --ignore-scripts --install-links');
  const retryConfig = JSON.parse(fs.readFileSync(
    path.join(functionRoot, '..', '..', 'config', 'retry-job.json'), 'utf8',
  ));
  assert.equal(retryConfig.record_type, 'revenue_desk_call_worker_job_contract');
  assert.equal(retryConfig.environment, 'Development');
  assert.equal(retryConfig.current_status,
    'unverified_requires_development_provisioning_and_readback');
  assert.deepEqual(retryConfig.function_target, {
    name: 'revenue_desk_call_worker', stack: 'node24', type: 'job', memory_mb: 256,
  });
  assert.equal(retryConfig.function_target.memory_mb, 256);
  assert.equal(retryConfig.job_pool.memory_mb, 512);
  assert.equal(retryConfig.sdk_submission.target_name, 'revenue_desk_call_worker');
  assert.equal(retryConfig.sdk_submission.shape,
    'app.jobScheduling().JOB.submitJob(payload)');
  assert.equal(retryConfig.sdk_submission.platform_retries, 0);
  assert.deepEqual(retryConfig.scheduled_retry_scan.params, { mode: 'retry_scan' });
  assert.equal(retryConfig.scheduled_retry_scan.cron_name, 'RevenueDeskRetry1m');
  assert.equal(retryConfig.scheduled_retry_scan.cron_name_max_characters, 20);
  assert.equal(retryConfig.scheduled_retry_scan.cron_name.length
    <= retryConfig.scheduled_retry_scan.cron_name_max_characters, true,
    'Catalyst rejects Cron names longer than 20 characters');
  assert.equal(retryConfig.scheduled_retry_scan.initial_status, 'disabled');
  assert.deepEqual(retryConfig.scheduled_retry_scan.schedule,
    { hour: 0, minute: 1, second: 0, repetition_type: 'every' });
  assert.deepEqual(Object.keys(retryConfig.private_modes), [
    'process_event', 'retry_scan', 'rebuild_report', 'reconcile_deployment',
  ]);

  const functionPackage = require('../package.json');
  const functionLock = require('../package-lock.json');
  assert.equal(functionPackage.name, config.deployment.name);
  assert.equal(functionPackage.engines.node, '24.x');
  assert.equal(functionLock.packages[''].engines.node, '24.x');
  assert.match(fs.readFileSync(path.join(functionRoot, 'index.js'), 'utf8'),
    /createSafeConsoleLogger\(console\)/);
  const corePackagePath = require.resolve('revenue_desk_call_gateway/package.json');
  const corePackageRoot = path.dirname(corePackagePath);
  const coreSourceRoot = path.join(functionRoot, '..', 'revenue_desk_call_gateway');
  assert.equal(require(corePackagePath).name, 'revenue_desk_call_gateway');
  assert.equal(fs.lstatSync(corePackageRoot).isSymbolicLink(), false,
    'run npm ci with --install-links before Catalyst packages the job target');
  assert.equal(path.relative(functionRoot, fs.realpathSync(corePackageRoot)).startsWith('node_modules'), true);
  const runtimeFiles = [
    'index.js', 'package.json', path.join('contracts', 'revenue-desk-call-contract.json'),
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
