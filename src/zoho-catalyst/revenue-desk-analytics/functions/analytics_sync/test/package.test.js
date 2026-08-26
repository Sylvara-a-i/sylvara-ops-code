'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const functionRoot = path.join(__dirname, '..');
const projectRoot = path.join(functionRoot, '..', '..');

function json(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

test('package is exactly one private analytics_sync Job target with no HTTP route', () => {
  const catalyst = json('catalyst.json');
  assert.deepEqual(catalyst.functions.targets, ['analytics_sync']);
  assert.equal(catalyst.functions.source, 'functions');
  assert.equal(catalyst.functions.scripts.predeploy,
    'npm --prefix analytics_sync ci --ignore-scripts');
  assert.equal(fs.existsSync(path.join(projectRoot, 'config', 'routes.json')), false);
  const deployment = JSON.parse(fs.readFileSync(
    path.join(functionRoot, 'catalyst-config.json'), 'utf8'));
  assert.deepEqual(deployment.deployment,
    { name: 'analytics_sync', stack: 'node18', type: 'job' });
  assert.equal(deployment.execution.main, 'index.js');
  const packageJson = require('../package.json');
  assert.equal(packageJson.name, 'analytics_sync');
  assert.equal(packageJson.scripts['artifact:verify'],
    'node verify-artifact.js && npm ls --omit=dev --all --ignore-scripts');
  assert.equal(typeof require('../index'), 'function');
});

test('Job, pool, empty params, dark Production, and provider contracts are exact', () => {
  const contract = json(path.join('config', 'analytics-sync.json'));
  assert.equal(contract.function.target_name, 'analytics_sync');
  assert.equal(contract.function.public_http_endpoint, false);
  assert.deepEqual(contract.job_pool, {
    name: 'RevenueDeskAnalyticsJobs', type: 'Function', memory_mb: 512,
    platform_retries_enabled: false, job_params: {},
  });
  assert.deepEqual(contract.runtime_modes.production, ['disabled', 'readiness']);
  assert.equal(contract.production_dark_contract.sdk_initialization, false);
  assert.equal(contract.production_dark_contract.datastore_reads, 0);
  assert.equal(contract.production_dark_contract.datastore_writes, 0);
  assert.equal(contract.production_dark_contract.analytics_reads, 0);
  assert.equal(contract.production_dark_contract.analytics_writes, 0);
  assert.equal(contract.production_dark_contract.result, 'DarkNoOp');
  assert.equal(contract.production_dark_contract.tables_required, false);
  assert.equal(contract.production_dark_contract.connections_required, false);
  assert.deepEqual(contract.provider_contract.connection_references, {
    read: 'ANALYTICS_READ_CONNECTION_LINK_NAME',
    write: 'ANALYTICS_WRITE_CONNECTION_LINK_NAME',
    must_be_distinct: true,
  });
  assert.match(contract.provider_contract.pre_write_target_check,
    /Immediately before every import POST.*read-only Connection.*view ID.*table name.*workspace ID.*organization ID.*do not cache.*write authorization/);
  assert.deepEqual(contract.provider_contract.matching_columns,
    ['RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENVIRONMENT']);
  assert.deepEqual(contract.provider_contract.provider_version_fence.identity_columns, [
    'RECORD_TYPE', 'ENVIRONMENT', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'RECORD_KEY',
    'SOURCE_MODIFIED_AT',
  ]);
  assert.equal(contract.provider_contract.provider_version_fence.column,
    'PROVIDER_VERSION_KEY');
  assert.equal(contract.provider_contract.provider_version_fence.provider_unique_constraint_required,
    true);
  assert.equal(contract.compatibility.legacy_rows_automatically_claimed, false);
  assert.equal(contract.compatibility.additive_columns_physical_mandatory, false);
  assert.equal(contract.compatibility.v2_outbox_state_column, 'SYNC_STATUS');
  assert.equal(contract.compatibility.documented_v1_outbox_state_column, 'Status');
  assert.equal(contract.compatibility.nullable_unique_semantics,
    'unverified_activation_blocker');
  assert.equal(contract.observed_development_inventory_2026_08_24.AnalyticsSyncOutbox, 307);
});

test('additive v2 schemas preserve live rows and include fencing, retry, readback, and checkpoints', () => {
  const schema = json(path.join('config', 'datastore-schema.json'));
  assert.equal(schema.schema_version, 2);
  assert.equal(schema.migration_policy.observed_counts.AnalyticsSyncOutbox, 307);
  assert.match(schema.migration_policy.strategy, /never rebuild, truncate, rename, or delete/);
  assert.deepEqual(schema.tables.map((table) => table.api_name),
    ['AnalyticsSyncCheckpoints', 'AnalyticsSyncOutbox']);
  for (const table of schema.tables) {
    assert.deepEqual(table.required_unique_columns, table.api_name === 'AnalyticsSyncOutbox'
      ? ['OUTBOX_KEY', 'PROVIDER_VERSION_KEY'] : ['CHECKPOINT_KEY']);
    assert.equal(table.columns.every((column) => column.mandatory === false), true,
      `${table.api_name} additive columns must be physically nullable`);
    for (const uniqueName of table.required_unique_columns) {
      const column = table.columns.find(({ api_name: name }) => name === uniqueName);
      assert.equal(column.unique, true, uniqueName);
      assert.equal(column.required_for_v2_rows, true, uniqueName);
    }
    assert.ok(table.columns.some((column) => column.api_name === 'ROW_SCHEMA_VERSION'
      && column.required_for_v2_rows === true));
  }
  const requiredByTable = {
    AnalyticsSyncCheckpoints: [
      'CHECKPOINT_KEY', 'ROW_SCHEMA_VERSION', 'RECORD_TYPE', 'TARGET_TABLE_ALIAS',
      'CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENVIRONMENT', 'LAST_SOURCE_MODIFIED_AT',
      'LAST_RECORD_KEY', 'PROVIDER_WATERMARK', 'LAST_PROVIDER_JOB_ID',
      'LAST_ACCEPTED_ROW_COUNT', 'LAST_REJECTED_ROW_COUNT', 'STATUS', 'STALE_AFTER_AT',
      'VERSION', 'LAST_SYNC_AT', 'LAST_RECONCILED_AT', 'CREATED_AT', 'UPDATED_AT',
      'SOURCE_REVISION', 'METRIC_VERSION',
    ],
    AnalyticsSyncOutbox: [
      'OUTBOX_KEY', 'PROVIDER_VERSION_KEY', 'ROW_SCHEMA_VERSION', 'RECORD_TYPE',
      'RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION',
      'ENGAGEMENT_TYPE', 'ENVIRONMENT', 'PAYLOAD_JSON', 'PAYLOAD_HASH', 'METRIC_VERSION',
      'SOURCE_MODIFIED_AT', 'SOURCE_DATE_UTC', 'SYNC_STATUS', 'ATTEMPT_COUNT',
      'CLAIM_COUNT', 'POLL_COUNT', 'NEXT_ATTEMPT_AT', 'FENCE_VERSION', 'CREATED_AT',
      'UPDATED_AT', 'SOURCE_REVISION',
    ],
  };
  for (const table of schema.tables) {
    const required = table.columns.filter((column) => column.required_for_v2_rows === true)
      .map((column) => column.api_name);
    assert.deepEqual(required, requiredByTable[table.api_name]);
    const reserved = new Set(
      schema.migration_policy.documented_v1_casefold_reserved_columns[table.api_name]
        .map((name) => name.toLowerCase()),
    );
    assert.equal(table.columns.every((column) =>
      !reserved.has(column.api_name.toLowerCase())), true,
    `${table.api_name} v2 columns must not collide with documented v1 columns`);
  }
  const outbox = schema.tables.find((table) => table.api_name === 'AnalyticsSyncOutbox');
  const names = new Set(outbox.columns.map((column) => column.api_name));
  for (const required of [
    'PROVIDER_VERSION_KEY', 'PAYLOAD_HASH', 'SYNC_STATUS', 'BATCH_KEY', 'ATTEMPT_COUNT',
    'CLAIM_COUNT', 'POLL_COUNT',
    'LEASE_TOKEN', 'FENCE_VERSION', 'PROVIDER_JOB_ID', 'READBACK_JOB_ID',
    'READBACK_ROW_COUNT', 'READBACK_WATERMARK',
  ]) assert.equal(names.has(required), true, required);
  const providerVersion = outbox.columns.find(
    (column) => column.api_name === 'PROVIDER_VERSION_KEY',
  );
  assert.equal(providerVersion.unique, true);
  assert.equal(providerVersion.required_for_v2_rows, true);
  assert.equal(names.has('STATUS'), false);
  const checkpoint = schema.tables.find((table) =>
    table.api_name === 'AnalyticsSyncCheckpoints');
  assert.equal(checkpoint.columns.some((column) => column.api_name === 'STATUS'), true);
  assert.match(schema.provisioning_gates.join(' '), /unique nullable.*multiple legacy nulls/i);
  assert.equal(names.has('SOURCE_DATE_UTC'), true);
  assert.deepEqual(schema.data_policy.app_user_permissions, []);
  assert.equal(schema.data_policy.raw_transcripts, false);
});

test('variable registry and example contain names/placeholders only and no known private project ID', () => {
  const registry = json(path.join('config', 'variables.json'));
  const names = new Set(registry.variables.map((variable) => variable.name));
  assert.deepEqual(
    registry.variables.filter(({ name }) => name.endsWith('_CONNECTION_LINK_NAME'))
      .map(({ name }) => name),
    ['ANALYTICS_READ_CONNECTION_LINK_NAME', 'ANALYTICS_WRITE_CONNECTION_LINK_NAME'],
  );
  for (const required of [
    'ANALYTICS_SYNC_MODE', 'EXPECTED_CATALYST_PROJECT_ID', 'ANALYTICS_JOB_POOL_ID',
    'ANALYTICS_CHECKPOINT_TABLE', 'ANALYTICS_OUTBOX_TABLE',
    'ANALYTICS_READ_CONNECTION_LINK_NAME', 'ANALYTICS_WRITE_CONNECTION_LINK_NAME',
    'ANALYTICS_TARGETS_JSON', 'ANALYTICS_MIGRATION_EVIDENCE_DIGEST',
  ]) assert.equal(names.has(required), true, required);
  const deploymentEnvironment = registry.variables.find((variable) =>
    variable.name === 'DEPLOYMENT_ENVIRONMENT');
  assert.deepEqual(deploymentEnvironment.allowed, ['development', 'production']);
  const example = fs.readFileSync(path.join(functionRoot, '.env.example'), 'utf8');
  assert.doesNotMatch(example, /\b\d{15,30}\b/);
  assert.doesNotMatch(example, /Zoho-oauthtoken|refresh_token|client_secret/i);
  assert.match(example, /TBD_PRIVATE_CATALYST_PROJECT_ID/);
});

test('README and runbook link the central standards and block a thinner live replacement', () => {
  const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
  const runbook = fs.readFileSync(path.join(projectRoot, 'RUNBOOK.md'), 'utf8');
  const parity = json(path.join('config', 'live-source-parity.json'));
  assert.match(readme, /Retell\/Catalyst\/CRM\/Analytics reporting runbook/);
  assert.match(readme, /Zoho Analytics standard/);
  assert.match(readme, /npm run artifact:verify/);
  assert.match(readme, /APPROVED_SOURCE_REVISION/);
  assert.match(runbook, /thinner candidate is not an acceptable replacement/);
  assert.match(runbook, /npm run artifact:verify/);
  assert.match(runbook, /APPROVED_SOURCE_REVISION/);
  assert.equal(parity.deployment_replacement_authorized, false);
  assert.ok(parity.live_modules.some((module) => module.name === 'daily-rollup.js'
    && module.repository_candidate.includes('functions/analytics_sync/lib/daily-rollup.js')
    && module.parity.includes('persistence-and-private-live-fixture-parity-blocked')));
  assert.ok(parity.live_modules.every((module) => module.candidate_owner
    && Array.isArray(module.candidate_tests) && module.candidate_tests.length >= 1));
  assert.equal(fs.existsSync(path.resolve(projectRoot,
    '../../../docs/runbooks/retell-catalyst-analytics-reporting.md')), true);
  assert.equal(fs.existsSync(path.resolve(projectRoot,
    '../../../docs/zoho/standards/analytics.md')), true);
});
