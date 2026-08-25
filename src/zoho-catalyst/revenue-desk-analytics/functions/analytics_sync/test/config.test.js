'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../lib/config');
const REVISION = 'a'.repeat(40);

function environment(overrides = {}) {
  return {
    DEPLOYMENT_ENVIRONMENT: 'development', SOURCE_REVISION: REVISION,
    ANALYTICS_SYNC_MODE: 'disabled', EXPECTED_CATALYST_PROJECT_ID: '123456',
    ANALYTICS_JOB_POOL_ID: '654321', ANALYTICS_CHECKPOINT_TABLE: 'AnalyticsSyncCheckpoints',
    ANALYTICS_OUTBOX_TABLE: 'AnalyticsSyncOutbox', ...overrides,
  };
}

function activeEnvironment(overrides = {}) {
  return environment({
    ANALYTICS_SYNC_MODE: 'active', ANALYTICS_READ_CONNECTION_LINK_NAME: 'analytics_read',
    ANALYTICS_WRITE_CONNECTION_LINK_NAME: 'analytics_write',
    ANALYTICS_API_BASE_URL: 'https://analyticsapi.zoho.com',
    ANALYTICS_ORGANIZATION_ID: '123456789', ANALYTICS_WORKSPACE_ID: '987654321',
    ANALYTICS_MIGRATION_EVIDENCE_DIGEST: 'b'.repeat(64),
    ANALYTICS_TARGETS_JSON: JSON.stringify(Object.fromEntries([
      'deployment', 'call', 'daily_metric', 'final_test_result', 'conversion_status',
    ].map((recordType, index) => [recordType,
      { table: `Synthetic${index}`, view_id: String(1000 + index) }]))),
    ...overrides,
  });
}

test('disabled and readiness configuration do not require provider bindings', () => {
  assert.equal(loadConfig(environment(), REVISION).provider, null);
  assert.equal(loadConfig(environment({ ANALYTICS_SYNC_MODE: 'readiness' }), REVISION).provider, null);
});

test('dark Production configuration requires only identity and ignores active-system settings', () => {
  const config = loadConfig({
    DEPLOYMENT_ENVIRONMENT: 'production', SOURCE_REVISION: REVISION,
    ANALYTICS_SYNC_MODE: 'readiness', EXPECTED_CATALYST_PROJECT_ID: '123456',
    ANALYTICS_JOB_POOL_ID: '654321',
    // These deliberately malformed values prove the dark return does not parse active settings.
    ANALYTICS_CHECKPOINT_TABLE: 'WrongTable', ANALYTICS_MAX_BATCH_SIZE: 'unbounded',
  }, REVISION);
  assert.deepEqual(config, {
    environment: 'production', catalystEnvironment: 'Production',
    sourceRevision: REVISION, mode: 'readiness',
    expectedProjectId: '123456', jobPoolId: '654321', tables: null, provider: null,
  });
});

test('active Development configuration validates separate Connections, exact targets, and evidence digest', () => {
  const config = loadConfig(activeEnvironment(), REVISION);
  assert.equal(config.environment, 'development');
  assert.deepEqual(
    { read: config.provider.readConnection, write: config.provider.writeConnection },
    { read: 'analytics_read', write: 'analytics_write' },
  );
  assert.equal(config.provider.targets.call.table, 'Synthetic1');
  assert.equal(config.provider.migrationEvidenceDigest, 'b'.repeat(64));
  assert.throws(() => loadConfig(activeEnvironment({
    ANALYTICS_WRITE_CONNECTION_LINK_NAME: 'analytics_read',
  }), REVISION), /must be separate/);
  assert.throws(() => loadConfig(activeEnvironment({
    ANALYTICS_MIGRATION_EVIDENCE_DIGEST: '0'.repeat(64),
  }), REVISION), /evidence digest/);
  assert.throws(() => loadConfig(activeEnvironment({
    ANALYTICS_API_BASE_URL: 'https://analyticsapi.zoho.evil.example',
  }), REVISION), /regional Zoho Analytics/);
  assert.throws(() => loadConfig(activeEnvironment({
    ANALYTICS_API_BASE_URL: 'https://analyticsapi.zoho.com:444',
  }), REVISION), /regional Zoho Analytics/);
});

test('runtime revision must exactly match an immutable stamped artifact revision', () => {
  assert.throws(() => loadConfig(environment(), 'b'.repeat(40)), /does not match/);
  assert.throws(() => loadConfig(environment(), '__SYLVARA_UNSTAMPED_SOURCE_REVISION__'),
    /not stamped/);
});

test('Production active mode and noncanonical Catalyst tables are blocked', () => {
  assert.throws(() => loadConfig(environment({
    DEPLOYMENT_ENVIRONMENT: 'production', ANALYTICS_SYNC_MODE: 'active',
  }), REVISION), /code-blocked/);
  assert.throws(() => loadConfig(environment({
    ANALYTICS_OUTBOX_TABLE: 'LegacyAnalyticsOutbox',
  }), REVISION), /canonical names/);
  assert.throws(() => loadConfig(environment({
    DEPLOYMENT_ENVIRONMENT: 'Development',
  }), REVISION), /must be development or production/);
});
