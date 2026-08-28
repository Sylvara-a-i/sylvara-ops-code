'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const contracts = require('../lib/contracts');
const { loadConfig: loadRuntimeConfig, loadJobConfig: loadRuntimeJobConfig } = require('../lib/config');
const { verifyRetellSignature } = require('../lib/security');
const { validateInboundPayload, validateEventEnvelope, MAX_RETELL_CALL_DURATION_MS } = require('../lib/validation');
const { extractAnalysis, validateValueEvidence } = require('../lib/analysis');
const { CatalystMailAdapter, messageContent } = require('../lib/catalyst-mail');
const { CatalystJobAdapter, assertJobReadback } = require('../lib/catalyst-jobs');
const { readRawBody } = require('../lib/http');
const { csvCell } = require('../lib/reporting');
const { timingSafeToken } = require('../lib/runtime-boundary');
const { boundedPendingDeployments } = require('../lib/runtime-service');
const { createSafeConsoleLogger } = require('../lib/logging');
const {
  createOutboxRow, deploymentFact, ensureOutboxRow, normalizeFactTimestamps, outboxKey,
} = require('../lib/analytics-outbox');
const {
  createOutboxRow: createCanonicalOutboxRow,
} = require('../../../../revenue-desk-analytics/functions/analytics_sync/lib/facts');
const { SOURCE_REVISION, environment, eventPayload } = require('./runtime-fixture');

const loadConfig = (env) => loadRuntimeConfig(env, { artifactSourceRevision: SOURCE_REVISION });
const loadJobConfig = (env) => loadRuntimeJobConfig(env, { artifactSourceRevision: SOURCE_REVISION });

function analyticsCallFact(overrides = {}) {
  return {
    SCHEMA_VERSION: 1, METRIC_VERSION: 'revenue_desk_runtime_v1',
    RECORD_KEY: 'a'.repeat(64), CLIENT_KEY: 'b'.repeat(64), DEPLOYMENT_KEY: 'c'.repeat(64),
    CONFIGURATION_VERSION: 'config-v1', ENGAGEMENT_TYPE: 'free_test',
    ENVIRONMENT: 'development', SOURCE_MODIFIED_AT: '2026-08-24T12:05:00.000Z',
    SOURCE_REVISION, CALL_KEY: 'a'.repeat(64),
    STARTED_AT: '2026-08-24T12:00:00.000Z', CALL_STATUS: 'ended',
    OUTCOME: 'potential_job', HANDLED_RECORDED: true,
    ...overrides,
  };
}

test('unit: bounded terminal batches advance to row 26 after the first batch converges', () => {
  const rows = Array.from({ length: 26 }, (_, index) => ({
    DEPLOYMENT_ID: `deployment_${index + 1}`,
    STOPPED_AT: new Date(index * 1000).toISOString(),
    REPORT_RECONCILIATION_STATUS: 'Pending',
  }));
  const first = boundedPendingDeployments(rows, 25);
  assert.equal(first.length, 25);
  first.forEach((row) => { row.REPORT_RECONCILIATION_STATUS = 'Completed'; });
  assert.deepEqual(
    boundedPendingDeployments(rows, 25).map((row) => row.DEPLOYMENT_ID),
    ['deployment_26'],
  );
});

const OUTBOX_PROVIDER_IDENTITY_COLUMNS = Object.freeze([
  'RECORD_TYPE', 'ENVIRONMENT', 'CLIENT_KEY', 'DEPLOYMENT_KEY',
  'RECORD_KEY', 'SOURCE_MODIFIED_AT',
]);

function ownershipError(code) {
  return Object.assign(new Error('Synthetic Analytics ownership failure.'), { code });
}

function outboxTestStore(initialRows = []) {
  const rows = initialRows.map((row, index) => ({
    ROWID: row.ROWID || String(index + 1), ...row,
  }));
  let nextRowId = rows.length + 1;
  return {
    rows,
    insertCalls: 0,
    async unique(table, column, value) {
      assert.equal(table, 'AnalyticsSyncOutbox');
      const matches = rows.filter((row) => String(row[column]) === String(value));
      if (matches.length > 1) throw ownershipError('AMBIGUOUS_DURABLE_OWNERSHIP');
      return matches.length === 1 ? { ...matches[0] } : null;
    },
    async uniqueOutboxProviderIdentity(table, identity) {
      assert.equal(table, 'AnalyticsSyncOutbox');
      const matches = rows.filter((row) => Number(row.ROW_SCHEMA_VERSION) === 2
        && OUTBOX_PROVIDER_IDENTITY_COLUMNS.every((column) => (
          String(row[column]) === String(identity[column])
        )));
      if (matches.length > 1) throw ownershipError('AMBIGUOUS_DURABLE_OWNERSHIP');
      return matches.length === 1 ? { ...matches[0] } : null;
    },
    async insertUnique(table, keyColumn, candidate) {
      assert.equal(table, 'AnalyticsSyncOutbox');
      assert.equal(keyColumn, 'OUTBOX_KEY');
      this.insertCalls += 1;
      const current = rows.find((row) => row[keyColumn] === candidate[keyColumn]);
      if (current) return { row: { ...current }, inserted: false };
      const inserted = { ...candidate, ROWID: String(nextRowId++) };
      rows.push(inserted);
      return { row: { ...inserted }, inserted: true };
    },
  };
}

function concurrentUniqueStore() {
  const base = outboxTestStore();
  const rows = new Map();
  let arrivals = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return {
    ...base,
    rows,
    async insertUnique(table, keyColumn, candidate) {
      assert.equal(table, 'AnalyticsSyncOutbox');
      assert.equal(keyColumn, 'OUTBOX_KEY');
      base.insertCalls += 1;
      arrivals += 1;
      if (arrivals === 2) release();
      await gate;
      const current = rows.get(candidate[keyColumn]);
      if (current) return { row: { ...current }, inserted: false };
      const inserted = { ...candidate, ROWID: String(rows.size + 1) };
      rows.set(candidate[keyColumn], inserted);
      base.rows.push(inserted);
      return { row: { ...inserted }, inserted: true };
    },
  };
}

test('unit: Analytics producer rejects conflicting facts at one source watermark', async () => {
  const baseFact = analyticsCallFact();
  const existing = {
    ...createOutboxRow('call', baseFact, '2026-08-24T12:06:00.000Z'), ROWID: '1',
  };
  const store = outboxTestStore([existing]);
  await assert.rejects(() => ensureOutboxRow(store, {
    tables: { ANALYTICS_OUTBOX_TABLE: 'AnalyticsSyncOutbox' },
  }, 'call', { ...baseFact, OUTCOME: 'spam' }, '2026-08-24T12:06:01.000Z'),
  (error) => error.code === 'DURABLE_IDEMPOTENCY_CONFLICT');
  assert.equal(store.insertCalls, 0);
  assert.equal(existing.OUTBOX_KEY, outboxKey('call', baseFact));
  assert.equal(existing.SYNC_STATUS, 'Pending');
  assert.equal(Object.hasOwn(existing, 'STATUS'), false);
});

test('unit: concurrent conflicting Analytics facts cannot both own one source version', async () => {
  const store = concurrentUniqueStore();
  const config = { tables: { ANALYTICS_OUTBOX_TABLE: 'AnalyticsSyncOutbox' } };
  const results = await Promise.allSettled([
    ensureOutboxRow(store, config, 'call', analyticsCallFact(), '2026-08-24T12:06:00.000Z'),
    ensureOutboxRow(store, config, 'call', analyticsCallFact({ OUTCOME: 'spam' }),
      '2026-08-24T12:06:01.000Z'),
  ]);
  assert.deepEqual(results.map(({ status }) => status).sort(), ['fulfilled', 'rejected']);
  assert.equal(results.find(({ status }) => status === 'rejected').reason.code,
    'DURABLE_IDEMPOTENCY_CONFLICT');
  assert.equal(store.rows.size, 1);
});

test('unit: concurrent exact Analytics replays converge on one source version', async () => {
  const store = concurrentUniqueStore();
  const config = { tables: { ANALYTICS_OUTBOX_TABLE: 'AnalyticsSyncOutbox' } };
  const results = await Promise.all([
    ensureOutboxRow(store, config, 'call', analyticsCallFact(), '2026-08-24T12:06:00.000Z'),
    ensureOutboxRow(store, config, 'call', analyticsCallFact(), '2026-08-24T12:06:00.000Z'),
  ]);
  assert.equal(store.rows.size, 1);
  assert.deepEqual(results.map(({ inserted }) => inserted).sort(), [false, true]);
  assert.equal(results[0].row.OUTBOX_KEY, results[1].row.OUTBOX_KEY);
});

test('unit: Analytics producer rejects wrong-key, duplicate, and disagreeing durable owners', async () => {
  const config = { tables: { ANALYTICS_OUTBOX_TABLE: 'AnalyticsSyncOutbox' } };
  const fact = analyticsCallFact();
  const expected = createOutboxRow('call', fact, '2026-08-24T12:06:00.000Z');

  const wrongKeyStore = outboxTestStore([{
    ...expected, OUTBOX_KEY: 'f'.repeat(64), ROWID: '1',
  }]);
  await assert.rejects(
    () => ensureOutboxRow(
      wrongKeyStore, config, 'call', fact, '2026-08-24T12:06:00.000Z',
    ),
    { code: 'DURABLE_IDEMPOTENCY_CONFLICT' },
  );
  assert.equal(wrongKeyStore.insertCalls, 0);

  const duplicateIdentityStore = outboxTestStore([
    { ...expected, OUTBOX_KEY: 'e'.repeat(64), ROWID: '1' },
    { ...expected, OUTBOX_KEY: 'f'.repeat(64), ROWID: '2' },
  ]);
  await assert.rejects(
    () => ensureOutboxRow(
      duplicateIdentityStore, config, 'call', fact, '2026-08-24T12:06:00.000Z',
    ),
    { code: 'AMBIGUOUS_DURABLE_OWNERSHIP' },
  );
  assert.equal(duplicateIdentityStore.insertCalls, 0);

  const disagreeingStore = {
    async unique() { return { ...expected, ROWID: '1' }; },
    async uniqueOutboxProviderIdentity() { return { ...expected, ROWID: '2' }; },
    async insertUnique() { assert.fail('ownership conflict must fail before insert'); },
  };
  await assert.rejects(
    () => ensureOutboxRow(
      disagreeingStore, config, 'call', fact, '2026-08-24T12:06:00.000Z',
    ),
    { code: 'DURABLE_IDEMPOTENCY_CONFLICT' },
  );
});

test('unit: ambiguous Analytics insert converges only through both ownership readbacks', async () => {
  const base = outboxTestStore();
  const store = {
    ...base,
    async insertUnique(...args) {
      await base.insertUnique(...args);
      throw ownershipError('CATALYST_INSERT_FAILED');
    },
  };
  const result = await ensureOutboxRow(store, {
    tables: { ANALYTICS_OUTBOX_TABLE: 'AnalyticsSyncOutbox' },
  }, 'call', analyticsCallFact(), '2026-08-24T12:06:00.000Z');
  assert.equal(base.rows.length, 1);
  assert.equal(result.row.ROWID, base.rows[0].ROWID);
  assert.equal(result.inserted, false);
});

test('unit: every runtime Analytics timestamp converges from whole-second to millisecond UTC', () => {
  const common = {
    SCHEMA_VERSION: 1, RECORD_KEY: 'a'.repeat(64), CLIENT_KEY: 'b'.repeat(64),
    DEPLOYMENT_KEY: 'c'.repeat(64), CONFIGURATION_VERSION: 'config-v1',
    ENGAGEMENT_TYPE: 'free_test', ENVIRONMENT: 'development', SOURCE_REVISION,
  };
  const cases = [
    ['call', {
      ...common, METRIC_VERSION: 'revenue_desk_runtime_v1',
      SOURCE_MODIFIED_AT: '2026-08-24T12:05:00Z',
      STARTED_AT: '2026-08-24T12:00:00Z', ENDED_AT: '2026-08-24T12:04:00Z',
      CALL_KEY: 'a'.repeat(64), CALL_STATUS: 'ended', OUTCOME: 'potential_job',
      HANDLED_RECORDED: true,
    }, ['SOURCE_MODIFIED_AT', 'STARTED_AT', 'ENDED_AT']],
    ['deployment', {
      ...common, RECORD_KEY: 'c'.repeat(64), METRIC_VERSION: 'revenue_desk_runtime_v1',
      SOURCE_MODIFIED_AT: '2026-08-27T12:00:00Z',
      ACTUAL_START_AT: '2026-08-20T12:00:00Z',
      EXPIRES_AT: '2026-08-27T12:00:00Z', STOPPED_AT: '2026-08-27T12:00:00Z',
      CAPABILITY_PROFILE: 'call_gap_monitor_v1', PLAN_TIER: 'free_test',
      DEPLOYMENT_STATUS: 'completed', GO_LIVE_APPROVAL_STATUS: 'approved',
      LIMIT_POLICY: 'seven_days_or_25_calls', BILLING_MODE: 'free_test',
      COVERAGE_MODE: 'after_hours_only', HANDLED_COUNT: 1, CALL_LIMIT: 25,
    }, ['SOURCE_MODIFIED_AT', 'ACTUAL_START_AT', 'EXPIRES_AT', 'STOPPED_AT']],
    ['final_test_result', {
      ...common, RECORD_KEY: 'c'.repeat(64), METRIC_VERSION: 'revenue_desk_final_test_v1',
      SOURCE_MODIFIED_AT: '2026-08-27T12:00:00Z',
      TEST_STARTED_AT: '2026-08-20T12:00:00Z',
      TEST_ENDED_AT: '2026-08-27T12:00:00Z',
      TEST_END_REASON: 'seven_day_limit_reached', CALLS_CAPTURED: 1, CALL_LIMIT: 25,
      QUALIFIED_OPPORTUNITIES: 1, URGENT_REQUESTS: 0, EXISTING_CUSTOMER_CALLS: 0,
      WRONG_FIT_CALLS: 0, DURATION_EVIDENCE_COMPLETE: true,
      ANALYSIS_EVIDENCE_COMPLETE: true,
    }, ['SOURCE_MODIFIED_AT', 'TEST_STARTED_AT', 'TEST_ENDED_AT']],
  ];
  for (const [recordType, wholeSecondFact, timestampFields] of cases) {
    const normalizedFact = normalizeFactTimestamps(recordType, wholeSecondFact);
    const wholeSecondRow = createOutboxRow(
      recordType, wholeSecondFact, '2026-08-27T12:01:00Z',
    );
    const utcRow = createOutboxRow(
      recordType, normalizedFact, '2026-08-27T12:01:00.000Z',
    );
    assert.deepEqual(wholeSecondRow, utcRow);
    const payload = JSON.parse(wholeSecondRow.PAYLOAD_JSON);
    for (const field of timestampFields) {
      assert.equal(payload[field], new Date(wholeSecondFact[field]).toISOString(), field);
    }
  }
  for (const invalid of ['2026-08-24T07:00:00-05:00', '2026-08-24']) {
    assert.throws(() => createOutboxRow(
      'call', analyticsCallFact({ STARTED_AT: invalid }), '2026-08-24T12:06:00.000Z',
    ), { code: 'ANALYTICS_FACT_INVALID' });
  }

  const leapDay = createOutboxRow('call', analyticsCallFact({
    SOURCE_MODIFIED_AT: '2028-02-29T12:05:00Z',
    STARTED_AT: '2028-02-29T12:00:00Z',
  }), '2028-02-29T12:06:00Z');
  assert.equal(leapDay.SOURCE_MODIFIED_AT, '2028-02-29T12:05:00.000Z');
  assert.equal(JSON.parse(leapDay.PAYLOAD_JSON).STARTED_AT, '2028-02-29T12:00:00.000Z');
  assert.equal(leapDay.CREATED_AT, '2028-02-29T12:06:00.000Z');

  for (const impossible of [
    '2026-02-29T12:00:00Z',
    '2026-02-30T12:00:00.000Z',
    '2026-04-31T12:00:00Z',
  ]) {
    assert.throws(() => createOutboxRow(
      'call', analyticsCallFact({ STARTED_AT: impossible }), '2026-08-24T12:06:00.000Z',
    ), { code: 'ANALYTICS_FACT_INVALID' });
  }
  assert.throws(() => createOutboxRow(
    'call', analyticsCallFact(), '2026-02-30T12:06:00Z',
  ), { code: 'ANALYTICS_FACT_INVALID' });
});

test('unit: runtime Analytics row is byte-for-byte compatible with the canonical package', () => {
  const fact = analyticsCallFact({ ENDED_AT: '2026-08-24T12:04:00Z' });
  const createdAt = '2026-08-24T12:06:00Z';
  assert.equal(
    JSON.stringify(createOutboxRow('call', fact, createdAt)),
    JSON.stringify(createCanonicalOutboxRow('call', fact, createdAt)),
  );
});

test('unit: final-test facts reject a changed payload at the same terminal watermark', async () => {
  const fact = {
    SCHEMA_VERSION: 1, METRIC_VERSION: 'revenue_desk_final_test_v1',
    RECORD_KEY: 'a'.repeat(64), CLIENT_KEY: 'b'.repeat(64), DEPLOYMENT_KEY: 'a'.repeat(64),
    CONFIGURATION_VERSION: 'config-v1', ENGAGEMENT_TYPE: 'free_test',
    ENVIRONMENT: 'development', SOURCE_MODIFIED_AT: '2026-08-27T12:00:00.000Z',
    SOURCE_REVISION, TEST_STARTED_AT: '2026-08-20T12:00:00.000Z',
    TEST_ENDED_AT: '2026-08-27T12:00:00.000Z', TEST_END_REASON: 'seven_day_limit_reached',
    CALLS_CAPTURED: 1, CALL_LIMIT: 25, QUALIFIED_OPPORTUNITIES: 1,
    URGENT_REQUESTS: 0, EXISTING_CUSTOMER_CALLS: 0, WRONG_FIT_CALLS: 0,
    DURATION_EVIDENCE_COMPLETE: true, ANALYSIS_EVIDENCE_COMPLETE: true,
  };
  const existing = createOutboxRow(
    'final_test_result', fact, '2026-08-27T12:00:00.000Z',
  );
  const store = outboxTestStore([{ ...existing, ROWID: '1' }]);
  await assert.rejects(() => ensureOutboxRow(store,
  { tables: { ANALYTICS_OUTBOX_TABLE: 'AnalyticsSyncOutbox' } },
  'final_test_result', { ...fact, QUALIFIED_OPPORTUNITIES: 2 },
  '2026-08-27T12:01:00.000Z'), { code: 'DURABLE_IDEMPOTENCY_CONFLICT' });
  assert.equal(store.insertCalls, 0);
});

test('unit: deployment analytics reads historical policy from the immutable version snapshot', () => {
  const fact = deploymentFact({ analyticsPartitionSecret: 'e'.repeat(32) }, {
    configurationVersionId: 'configuration_version_archived',
    engagementType: 'free_test', capabilityProfile: 'call_gap_monitor_v1',
    planTier: 'ArchivedTier', limitPolicy: 'archived_limit_policy_v1',
    billingMode: 'archived_mode', numberOwnership: 'dedicated_deployment',
    environment: 'development', coverageMode: 'AfterHoursOnly',
  }, {
    CLIENT_ID: 'client_archived', DEPLOYMENT_ID: 'deployment_archived',
    TEST_STATUS: 'Completed', GO_LIVE_APPROVAL_STATUS: 'Approved',
    HANDLED_COUNT: 7, CALL_LIMIT: 25,
    ACTUAL_START_AT: '2026-08-20T12:00:00.000Z',
    EXPIRES_AT: '2026-08-27T12:00:00.000Z',
    SOURCE_ENVIRONMENT: 'development', SOURCE_REVISION,
    UPDATED_AT: '2026-08-27T12:00:00.000Z',
  });
  assert.deepEqual([
    fact.PLAN_TIER, fact.LIMIT_POLICY, fact.BILLING_MODE,
  ], ['archived_tier', 'archived_limit_policy_v1', 'archived_mode']);
  assert.notEqual(fact.PLAN_TIER,
    contracts.CAPABILITY_PROFILES.get('call_gap_monitor_v1').plan_tier);
});

test('unit: approved gate taxonomies, engagement types, and capability profiles are exact', () => {
  assert.deepEqual([...contracts.COVERAGE_MODES], ['AfterHoursOnly', 'NoAnswerOverflowOnly', 'AfterHoursAndOverflow']);
  assert.deepEqual([...contracts.COVERAGE_LABEL_TO_MODE], [
    ['After Hours Only', 'AfterHoursOnly'],
    ['No Answer / Overflow Only', 'NoAnswerOverflowOnly'],
    ['After Hours + Overflow', 'AfterHoursAndOverflow'],
  ]);
  assert.deepEqual([...contracts.RETELL_EVENTS], ['call_ended', 'call_analyzed']);
  assert.equal(contracts.OUTCOMES.size, 11);
  assert.equal(contracts.VALUE_EVIDENCE_CLASSES.size, 5);
  assert.deepEqual([...contracts.MVP_REPORT_VALUE_EVIDENCE_CLASSES],
    ['unknown', 'customer_supplied_estimate']);
  assert.deepEqual([...contracts.MVP_REPORT_VALUE_EVIDENCE_SOURCES], ['retell']);
  assert.equal(contracts.CONTRACT.canonical_call_schema_version, 2);
  assert.deepEqual(contracts.CONTRACT.legacy_canonical_call_schema_versions, [1]);
  assert.deepEqual([...contracts.RETELL_CUSTOM_ANALYSIS_FIELDS], [
    'outcome', 'coverage_trigger', 'caller_name', 'callback_number', 'customer_type',
    'caller_intent', 'issue_summary', 'city_or_zip', 'urgency',
    'specific_person_requested', 'sensitive_data_detected', 'bookable_opportunity',
    'office_follow_up_required', 'workflow_failure_code', 'workflow_failure_text',
  ]);
  assert.deepEqual([...contracts.RETELL_LIVE_SHARED_AGENT_ANALYSIS_FIELDS], [
    'outcome', 'coverage_trigger', 'caller_name', 'callback_number', 'customer_type',
    'caller_intent', 'issue_summary', 'city_or_zip', 'urgency',
    'specific_person_requested', 'sensitive_data_detected',
  ]);
  assert.deepEqual([...contracts.RETELL_REQUIRED_RUNTIME_ANALYSIS_FIELDS], [
    'outcome', 'coverage_trigger', 'customer_type', 'urgency', 'sensitive_data_detected',
  ]);
  assert.deepEqual([...contracts.RETELL_CONVERSATION_VARIABLE_FIELDS], [
    'configuration_version', 'company_description', 'callback_expectation', 'client_id',
    'unsupported_services_json', 'business_hours', 'coverage_mode', 'capability_profile',
    'service_area_json', 'company_name', 'resolver_status', 'deployment_id',
    'engagement_type', 'urgent_conditions_json', 'services_handled_json',
  ]);
  assert.deepEqual([...contracts.CUSTOMER_TYPES], ['new', 'existing', 'unknown']);
  assert.deepEqual([...contracts.URGENCIES], ['routine', 'urgent', 'immediate_danger', 'unknown']);
  assert.deepEqual(contracts.CONTRACT.retell_custom_analysis_readback, {
    runtime_supported_field_count: 15,
    live_shared_agent_field_count: 11,
    status: 'pending_retell_agent_qa',
    caller_intent_value_contract: 'bounded text only; read-only metadata exposed the field but not an authoritative complete enum, so no closed value set is inferred',
    missing_evidence_behavior: 'preserve null and withhold affected aggregates',
  });
  assert.deepEqual([...contracts.OPTIONAL_VALUE_EVIDENCE_FIELDS], [
    'value_evidence_class', 'value_minor_units', 'value_currency',
    'value_method_id', 'value_method_version',
  ]);
  assert.equal(contracts.CONTRACT.reporting.monthly_connected_minutes_methodology_id,
    'retell_duration_elapsed_calendar_run_rate_v1');
  assert.match(contracts.CONTRACT.reporting.in_flight_overshoot_methodology,
    /max\(handled_call_count - call_limit, 0\)/);
  assert.equal(contracts.NOTIFICATION_STATES.has('DryRunRecorded'), true);
  assert.equal(contracts.STOP_REASON_TO_CRM.get('call_limit_reached'), 'Call Limit Reached');
  assert.deepEqual([...contracts.ENGAGEMENT_TYPES], ['free_test', 'paid_service']);
  assert.deepEqual(contracts.CAPABILITY_PROFILES.get('call_gap_monitor_v1'), {
    id: 'call_gap_monitor_v1', engagement_type: 'free_test', plan_tier: 'none',
    status: 'active', enabled: true,
    limit_policy: 'seven_calendar_days_or_25_connected_calls_v1', billing_mode: 'none',
    traffic_environments: ['development'],
  });
  assert.deepEqual(
    [...contracts.CAPABILITY_PROFILES].map(([id, profile]) => [
      id, profile.engagement_type, profile.status, profile.enabled,
    ]),
    [
      ['call_gap_monitor_v1', 'free_test', 'active', true],
      ['launch_v1', 'paid_service', 'draft', false],
      ['growth_v1', 'paid_service', 'draft', false],
      ['scale_v1', 'paid_service', 'draft', false],
    ],
  );
});

test('unit: environment registry permits only minimal Production dark mode and rejects unsafe values', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'config', 'variables.json'), 'utf8'));
  const env = environment();
  assert.deepEqual(Object.keys(env).sort(), registry.variables.map(({ name }) => name).sort());
  const workerExample = fs.readFileSync(path.join(
    __dirname, '..', '..', 'revenue_desk_call_worker', '.env.example',
  ), 'utf8');
  const workerNames = workerExample.split(/\r?\n/)
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => line.slice(0, line.indexOf('=')));
  assert.equal(new Set(workerNames).size, workerNames.length,
    'worker environment example must not duplicate a variable');
  assert.deepEqual(workerNames.sort(), registry.variables
    .filter(({ consumer }) => consumer === 'worker' || consumer === 'both')
    .map(({ name }) => name).sort());
  assert.deepEqual(registry.variables.filter(({ name }) => name.startsWith('CATALYST_')), [],
    'Catalyst reserves the CATALYST_ environment-variable namespace');
  assert.equal(loadConfig(env).tables.DEPLOYMENT_TABLE, 'RevenueDeskDeployments');
  const jobOnly = { ...env };
  for (const name of [
    'RETELL_WEBHOOK_API_KEY', 'NUMBER_LOOKUP_HMAC_SECRET', 'INTERNAL_READINESS_TOKEN',
    'RETELL_INBOUND_PATH', 'RETELL_EVENTS_PATH', 'INTERNAL_READINESS_PATH',
    'REVENUE_DESK_RUNTIME_HOST', 'RETELL_SIGNATURE_MAX_AGE_MS', 'MAX_WEBHOOK_BYTES',
    'INBOUND_BODY_TIMEOUT_MS',
  ]) delete jobOnly[name];
  assert.equal(loadJobConfig(jobOnly).workerJobPoolId, env.REVENUE_DESK_WORKER_JOB_POOL_ID);
  assert.equal(Object.hasOwn(loadConfig(env), 'workerJobPoolId'), false);
  const production = loadConfig({
    DEPLOYMENT_ENVIRONMENT: 'production',
    DEPLOYMENT_MODE: 'dark',
    SOURCE_REVISION,
  });
  assert.deepEqual(production, {
    environment: 'production', deploymentMode: 'dark', sourceRevision: SOURCE_REVISION,
  });
  assert.throws(() => loadConfig({ ...env, DEPLOYMENT_MODE: 'dark' }),
    { code: 'INVALID_RUNTIME_CONFIGURATION' });
  assert.throws(() => loadConfig({
    DEPLOYMENT_ENVIRONMENT: 'production', DEPLOYMENT_MODE: 'active', SOURCE_REVISION,
  }), { code: 'INVALID_RUNTIME_CONFIGURATION' });
  assert.throws(() => loadRuntimeConfig(env), { code: 'UNSTAMPED_ARTIFACT' });
  assert.throws(() => loadRuntimeConfig(env, { artifactSourceRevision: 'e'.repeat(40) }),
    { code: 'SOURCE_REVISION_MISMATCH' });
  assert.throws(() => loadConfig({ ...env, ZOHO_CATALYST_ZCQL_PARSER: 'V1' }),
    { code: 'INVALID_RUNTIME_CONFIGURATION' });
  assert.throws(() => loadConfig({ ...env, EVENT_HMAC_SECRET: env.NUMBER_LOOKUP_HMAC_SECRET }),
    { code: 'INVALID_RUNTIME_CONFIGURATION' });
  assert.throws(() => loadConfig({
    ...env, ANALYTICS_PARTITION_HMAC_SECRET: env.EVENT_HMAC_SECRET,
  }), { code: 'INVALID_RUNTIME_CONFIGURATION' });
  assert.throws(() => loadConfig({ ...env, DEPLOYMENT_TABLE: 'AnotherTable' }),
    { code: 'INVALID_RUNTIME_CONFIGURATION' });
  assert.throws(() => loadConfig({ ...env, REVENUE_DESK_NOTIFICATION_MODE: 'send' }),
    { code: 'PRODUCTION_BLOCKED' });
  assert.throws(() => loadConfig({ ...env, REVENUE_DESK_MAIL_FROM: 'not-email' }),
    { code: 'INVALID_RUNTIME_CONFIGURATION' });
  for (const [name, value] of [
    ['RETELL_WEBHOOK_API_KEY', '<set-in-catalyst-secret>'],
    ['EVENT_HMAC_SECRET', '<set-in-catalyst-secret-material>'],
    ['ANALYTICS_PARTITION_HMAC_SECRET', '<set-in-catalyst-secret-material>'],
    ['NUMBER_LOOKUP_HMAC_SECRET', '<set-in-catalyst-secret-material>'],
    ['INTERNAL_READINESS_TOKEN', '<set-in-catalyst-secret-material>'],
  ]) {
    assert.throws(() => loadConfig({ ...env, [name]: value }),
      { code: 'INVALID_RUNTIME_CONFIGURATION' }, name);
  }
});

test('unit: pinned Catalyst SDK and adapter use the reviewed Function Job contract', async () => {
  const sdkPackage = require('zcatalyst-sdk-node/package.json');
  const { JobScheduling } = require('zcatalyst-sdk-node/lib/job-scheduling');
  assert.equal(sdkPackage.version, '3.4.0');
  assert.equal(typeof JobScheduling.prototype.job, 'function');
  assert.equal(typeof Object.getOwnPropertyDescriptor(JobScheduling.prototype, 'JOB').get, 'function');
  const requests = [];
  const eventKey = `evt_${'a'.repeat(64)}`;
  const app = { jobScheduling() { return { JOB: {
    async submitJob(request) {
      requests.push(request);
      return {
        job_id: '900001',
        job_status: 'PENDING',
        job_meta_details: {
          job_name: request.job_name,
          source_type: 'API',
          target_type: 'Function',
          target_details: {
            id: '900002',
            target_name: 'revenue_desk_call_worker',
          },
          jobpool_id: '900003',
          jobpool_details: {
            id: '900003',
            name: 'RevenueDeskCallJobs',
            type: 'Function',
          },
          params: { mode: 'process_event', event_key: eventKey },
          job_config: { number_of_retries: 0, retry_interval: 0 },
        },
      };
    },
  } }; } };
  const adapter = new CatalystJobAdapter({ app, config: loadConfig(environment()) });
  assert.deepEqual(await adapter.enqueueProcessEvent(eventKey), {
    jobId: '900001',
    status: 'PENDING',
  });
  assert.deepEqual(requests, [{
    job_name: `RevenueDeskEvent_${'a'.repeat(24)}`,
    jobpool_name: 'RevenueDeskCallJobs',
    target_type: 'Function',
    target_name: 'revenue_desk_call_worker',
    params: { mode: 'process_event', event_key: eventKey },
    job_config: { number_of_retries: 0, retry_interval: 0 },
  }]);
});

test('unit: Function Job readback rejects partial, conflicting, failed, and lossy responses', () => {
  const eventKey = `evt_${'a'.repeat(64)}`;
  const expected = {
    job_name: `RevenueDeskEvent_${'a'.repeat(24)}`,
    jobpool_name: 'RevenueDeskCallJobs',
    target_type: 'Function',
    target_name: 'revenue_desk_call_worker',
    params: { mode: 'process_event', event_key: eventKey },
    job_config: { number_of_retries: 0, retry_interval: 0 },
  };
  const valid = {
    job_id: '900001',
    job_status: 'Pending',
    job_meta_details: {
      job_name: expected.job_name,
      source_type: 'API',
      target_type: 'Function',
      target_details: { id: '900002', target_name: expected.target_name },
      jobpool_id: '900003',
      jobpool_details: {
        id: '900003',
        name: expected.jobpool_name,
        type: 'Function',
      },
      params: { ...expected.params },
      job_config: { ...expected.job_config },
    },
  };
  const rejects = [
    { ...valid, job_id: Number.MAX_SAFE_INTEGER + 2 },
    { ...valid, job_id: '0' },
    { ...valid, job_status: 'Failure' },
    { ...valid, job_status: 'Unknown' },
    { ...valid, job_meta_details: undefined },
    { ...valid, job_meta_details: { ...valid.job_meta_details, jobpool_details: undefined } },
    { ...valid, job_meta_details: {
      ...valid.job_meta_details,
      jobpool_details: { ...valid.job_meta_details.jobpool_details, id: '900004' },
    } },
    { ...valid, job_meta_details: {
      ...valid.job_meta_details,
      target_details: { ...valid.job_meta_details.target_details, target_name: 'other_worker' },
    } },
    { ...valid, job_meta_details: {
      ...valid.job_meta_details,
      params: { ...expected.params, unexpected: 'value' },
    } },
    { ...valid, job_meta_details: {
      ...valid.job_meta_details,
      job_config: { number_of_retries: 1, retry_interval: 0 },
    } },
    { ...valid, job_meta_details: {
      ...valid.job_meta_details,
      job_config: { number_of_retries: 0, retry_interval: '0' },
    } },
    { ...valid, job_meta_details: {
      ...valid.job_meta_details,
      job_config: { number_of_retries: 0 },
    } },
  ];
  for (const candidate of rejects) {
    assert.throws(() => assertJobReadback(candidate, expected), {
      code: 'CATALYST_JOB_READBACK_FAILED', ambiguous: true,
    });
  }
  for (const status of ['Submitted', 'PENDING', 'Running', 'SUCCESS', 'Successful']) {
    assert.equal(assertJobReadback({ ...valid, job_status: status }, expected).status, status);
  }
});

test('unit: default console logger emits only allowlisted opaque operational fields', () => {
  const lines = [];
  const logger = createSafeConsoleLogger({
    error(line) { lines.push(line); },
    warn(line) { lines.push(line); },
  });
  logger.error({
    event: 'runtime_request_failed', correlationId: `corr_${'a'.repeat(32)}`,
    errorCode: 'INVALID_SIGNATURE', route: 'events', status: 401,
    eventType: 'call_ended', state: 'TerminalFailure',
    eventCount: 2, notificationCount: 1, reconciliationRequired: 0,
    signature: 'private-signature', rawPayload: '{"caller":"private"}',
    phoneNumber: '+15550000000', recipient: 'private@example.invalid',
  });
  assert.deepEqual(JSON.parse(lines[0]), {
    level: 'error', event: 'runtime_request_failed',
    correlationId: `corr_${'a'.repeat(32)}`, errorCode: 'INVALID_SIGNATURE',
    route: 'events', eventType: 'call_ended', state: 'TerminalFailure', status: 401,
    eventCount: 2, notificationCount: 1, reconciliationRequired: 0,
  });
  assert.doesNotMatch(lines[0], /private|15550000000/);
  logger.warn({ event: 'invalid event name', correlationId: '+15550000000', rawPayload: 'private' });
  assert.deepEqual(JSON.parse(lines[1]), { level: 'warn', event: 'runtime_log' });
});

test('unit: Data Store schema contains five canonical tables plus Analytics delivery outbox', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'config', 'datastore-schema.json'), 'utf8'));
  assert.equal(schema.schema_version, 6);
  assert.equal(
    schema.status,
    'development_tables_present_requires_additive_schema_completion_and_binding_readback',
  );
  assert.deepEqual(schema.tables.map(({ api_name: name }) => name), [
    'RevenueDeskDeployments', 'RevenueDeskConfigurationVersions',
    'RevenueDeskEventReceipts', 'RevenueDeskCalls', 'RevenueDeskNotifications',
    'AnalyticsSyncOutbox',
  ]);
  for (const table of schema.tables) {
    assert.equal(table.required_unique_columns.length >= 1, true);
    for (const name of table.required_unique_columns) {
      assert.equal(table.columns.find(({ api_name: apiName }) => apiName === name).unique, true);
    }
    assert.equal(table.required_pii_ephi_columns.length >= 1, true);
    for (const name of table.required_pii_ephi_columns) {
      const column = table.columns.find(({ api_name: apiName }) => apiName === name);
      assert.equal(column.type, 'encrypted_text', name);
      assert.equal(column.audit_consent, true, name);
    }
    for (const column of table.columns.filter(({ type }) => type === 'encrypted_text')) {
      assert.equal(column.max_length, 10_000, column.api_name);
    }
  }
  const deploymentSchema = schema.tables.find(({ api_name: name }) => name === 'RevenueDeskDeployments');
  assert.deepEqual(deploymentSchema.required_unique_columns, ['DEPLOYMENT_KEY', 'NUMBER_LOOKUP_HASH']);
  assert.equal(deploymentSchema.columns.find(({ api_name: name }) => name === 'DEPLOYMENT_ID').unique, false);
  assert.equal(deploymentSchema.columns.some(
    ({ api_name: name }) => name === 'ACTIVE_CONFIGURATION_VERSION_ID',
  ), true);
  assert.equal(deploymentSchema.columns.some(
    ({ api_name: name }) => name === 'CONFIGURATION_JSON',
  ), false);
  for (const field of [
    'APPROVED_CONFIGURATION_VERSION_ID', 'APPROVAL_EVENT_KEY',
    'APPROVED_ROUTE_FINGERPRINT', 'GO_LIVE_APPROVED_AT', 'ACTIVATION_EVENT_KEY',
  ]) {
    const column = deploymentSchema.columns.find(({ api_name: name }) => name === field);
    assert.equal(column?.mandatory, false, field);
  }
  for (const field of ['ACTUAL_START_AT', 'EXPIRES_AT']) {
    assert.equal(deploymentSchema.columns.find(
      ({ api_name: name }) => name === field,
    )?.mandatory, false, field);
  }
  const configurationSchema = schema.tables.find(
    ({ api_name: name }) => name === 'RevenueDeskConfigurationVersions',
  );
  assert.deepEqual(configurationSchema.required_unique_columns, ['CONFIGURATION_VERSION_ID']);
  const configurationColumns = new Map(configurationSchema.columns.map(
    (column) => [column.api_name, column],
  ));
  const immutableConfigurationFields = [
    'ENGAGEMENT_TYPE', 'CAPABILITY_PROFILE', 'PLAN_TIER', 'CONFIGURATION_VERSION',
    'DEPLOYMENT_STATUS', 'GO_LIVE_APPROVAL_STATUS', 'LIMIT_POLICY', 'BILLING_MODE',
    'NUMBER_OWNERSHIP', 'ENVIRONMENT', 'SOURCE_REVISION',
  ];
  for (const field of immutableConfigurationFields) {
    assert.equal(configurationColumns.get(field)?.mandatory, true, field);
  }
  assert.equal(configurationColumns.get('CONFIGURATION_VERSION').max_length, 100);
  assert.equal(configurationColumns.get('CONFIGURATION_VERSION').private, true);
  for (const field of ['CONFIGURATION_JSON', 'STATUS', 'APPROVAL_STATUS']) {
    assert.equal(configurationColumns.has(field), true, field);
  }
  assert.equal(configurationColumns.get('CONFIGURATION_JSON').private, true);
  assert.equal(configurationColumns.get('CONFIGURATION_JSON').audit_consent, true);
  const receiptColumns = new Set(schema.tables.find(({ api_name: name }) => name === 'RevenueDeskEventReceipts')
    .columns.map(({ api_name: name }) => name));
  for (const field of [
    'RECEIPT_KIND', 'EVENT_DATA_JSON', 'RECEIPT_VERSION', 'LEASE_TOKEN', 'JOB_REFERENCE',
    'ENQUEUED_AT', 'NEXT_ATTEMPT_AT', 'CONFIGURATION_VERSION_ID', 'ROUTE_FINGERPRINT',
    'ROUTE_READBACK_FINGERPRINT', 'RELATED_EVENT_KEY',
  ]) {
    assert.equal(receiptColumns.has(field), true, field);
  }
  const notificationColumns = new Set(schema.tables.find(({ api_name: name }) => name === 'RevenueDeskNotifications')
    .columns.map(({ api_name: name }) => name));
  for (const field of ['NOTIFICATION_VERSION', 'TEMPLATE_VERSION', 'PROVIDER_RESULT_REFERENCE',
    'SEND_TOKEN', 'LAST_ATTEMPT_AT', 'NEXT_ATTEMPT_AT', 'LAST_ERROR_CODE']) {
    assert.equal(notificationColumns.has(field), true, field);
  }
  assert.equal(JSON.stringify(schema).includes('ADMISSION_SLOT'), false);
  assert.equal(JSON.stringify(schema).includes('REPORTING_OUTBOX'), false);
  const outbox = schema.tables.find(({ api_name: name }) => name === 'AnalyticsSyncOutbox');
  assert.deepEqual(outbox.required_unique_columns, ['OUTBOX_KEY']);
  assert.equal(outbox.columns.every((column) => column.mandatory === false), true);
  const requiredV2 = new Set(outbox.columns.filter(
    ({ required_for_v2_rows: required }) => required === true,
  ).map(({ api_name: name }) => name));
  for (const name of [
    'OUTBOX_KEY', 'ROW_SCHEMA_VERSION', 'RECORD_TYPE',
    'RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION',
    'ENGAGEMENT_TYPE', 'ENVIRONMENT', 'SOURCE_DATE_UTC', 'PAYLOAD_JSON', 'PAYLOAD_HASH',
    'METRIC_VERSION', 'SOURCE_MODIFIED_AT', 'SYNC_STATUS', 'ATTEMPT_COUNT', 'CLAIM_COUNT',
    'POLL_COUNT', 'NEXT_ATTEMPT_AT', 'FENCE_VERSION', 'CREATED_AT', 'UPDATED_AT',
    'SOURCE_REVISION',
  ]) assert.equal(requiredV2.has(name), true, name);
  const removedProviderColumn = ['PROVIDER', 'VERSION', 'KEY'].join('_');
  assert.equal(outbox.columns.some(({ api_name: name }) => name === removedProviderColumn), false);
  for (const relativePath of [
    '../lib/analytics-outbox.js', '../lib/catalyst-store.js', '../lib/runtime-service.js',
    '../../../config/datastore-schema.json', '../../../README.md',
  ]) {
    assert.equal(fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8')
      .includes(removedProviderColumn), false, relativePath);
  }
  assert.equal(outbox.columns.some(({ api_name: name }) => name === 'SOURCE_DATE_UTC'), true);
  assert.equal(outbox.columns.some(({ api_name: name }) => name === 'SYNC_STATUS'), true);
  assert.equal(outbox.columns.some(({ api_name: name }) => name === 'STATUS'), false);
  const reserved = new Set(outbox.documented_v1_casefold_reserved_columns
    .map((name) => name.toLowerCase()));
  assert.equal(outbox.columns.every(({ api_name: name }) =>
    !reserved.has(name.toLowerCase())), true);
  assert.match(schema.migration_gates.join(' '), /unique nullable.*multiple legacy nulls/i);
});

test('unit: Retell signature uses raw bytes, millisecond timestamp, constant-time HMAC, and 300-second freshness', () => {
  const rawBody = Buffer.from('{"event":"call_ended"}', 'utf8');
  const now = 1_800_000_000_000;
  const key = 'synthetic-retell-verification-key';
  const digest = crypto.createHmac('sha256', key).update(rawBody.toString('utf8') + now).digest('hex');
  const header = `v=${now},d=${digest}`;
  assert.equal(verifyRetellSignature({ rawBody, signatureHeader: header, verificationKey: key,
    nowMs: now, maxAgeMs: 300_000 }).timestamp, now);
  assert.throws(() => verifyRetellSignature({ rawBody: Buffer.from('{}'), signatureHeader: header,
    verificationKey: key, nowMs: now, maxAgeMs: 300_000 }), { code: 'INVALID_SIGNATURE' });
  assert.throws(() => verifyRetellSignature({ rawBody, signatureHeader: header, verificationKey: key,
    nowMs: now + 300_001, maxAgeMs: 300_000 }), { code: 'STALE_SIGNATURE' });
  assert.throws(() => verifyRetellSignature({ rawBody, signatureHeader: header.replace(String(now), String(Math.floor(now / 1000))),
    verificationKey: key, nowMs: now, maxAgeMs: 300_000 }), { code: 'STALE_SIGNATURE' });
});

test('unit: optional bounded SIP headers are accepted then discarded', () => {
  const normalized = validateInboundPayload({ event: 'call_inbound', event_timestamp: 1_800_000_000_000,
    call_inbound: { agent_id: 'agent_shared_free_test', agent_version: 7,
      from_number: '+15551110001', to_number: '+15550000001',
      custom_sip_headers: { 'X-Synthetic-Trace': 'discard-me' } } });
  assert.equal(normalized.toNumber, '+15550000001');
  assert.equal(normalized.eventTimestamp, 1_800_000_000_000);
  assert.equal(Object.hasOwn(normalized, 'customSipHeaders'), false);

  const currentContract = validateInboundPayload({ event: 'call_inbound',
    call_inbound: { from_number: '+15551110001', to_number: '+15550000001' } });
  assert.equal(currentContract.eventTimestamp, null);
  assert.equal(currentContract.agentId, null);
  assert.equal(currentContract.agentVersion, null);
});

test('unit: Retell post-call duration is required, integral, and bounded', () => {
  const payload = eventPayload('call_ended', 'duration_unit', {}, 'A');
  payload.call.duration_ms = 45_000;
  assert.equal(validateEventEnvelope(payload).durationMs, 45_000);
  for (const duration of [undefined, -1, 1.5, MAX_RETELL_CALL_DURATION_MS + 1]) {
    payload.call.duration_ms = duration;
    assert.throws(() => validateEventEnvelope(payload), { code: 'INVALID_SCHEMA' });
  }
});

test('unit: live field fixture and canonical required enum tokens stay exact', () => {
  const custom = eventPayload('call_analyzed', 'analysis_contract_unit', {}, 'A')
    .call.call_analysis.custom_analysis_data;
  assert.deepEqual(Object.keys(custom), [...contracts.RETELL_LIVE_SHARED_AGENT_ANALYSIS_FIELDS]);
  assert.equal(custom.caller_intent, 'service_request');
  assert.equal(custom.sensitive_data_detected, false);
  const complete = extractAnalysis({ call_analysis: { custom_analysis_data: custom } });
  assert.equal(complete.configuredAnalysisComplete, true);
  assert.equal(complete.workflowFailureEvidenceComplete, false);

  for (const [field, value] of [
    ['outcome', 'Potential Job'],
    ['coverage_trigger', 'afterhours'],
    ['customer_type', 'New'],
    ['urgency', 'Routine'],
    ['sensitive_data_detected', 'false'],
  ]) {
    assert.throws(() => extractAnalysis({ call_analysis: { custom_analysis_data: {
      ...custom, [field]: value,
    } } }));
  }

  const missingRequired = { ...custom };
  delete missingRequired.sensitive_data_detected;
  assert.equal(extractAnalysis({ call_analysis: {
    custom_analysis_data: missingRequired,
  } }).configuredAnalysisComplete, false);
});

test('unit: sensitive-data signals minimize every caller field before value validation', () => {
  for (const data of [
    { outcome: 'sensitive_data_ended', caller_name: 'Do Not Store', value_evidence_class: 'confirmed_revenue' },
    { outcome: 'potential_job', issue_summary: 'My SSN is 123456789' },
    { outcome: 'potential_job', issue_summary: 'My bank routing number is 123456789' },
    { outcome: 'potential_job', issue_summary: 'My medical diagnosis is diabetes' },
    { outcome: 'potential_job', callback_number: '+378282246310005' },
    { outcome: 'potential_job', workflow_failure_code: 'unsafe_note',
      workflow_failure_text: ['My SSN is 123', '45', '6789'].join('-'),
      bookable_opportunity: true },
  ]) {
    const result = extractAnalysis({ call_analysis: { custom_analysis_data: data } });
    assert.equal(result.outcome, 'sensitive_data_ended');
    assert.equal(result.callerName, null);
    assert.equal(result.callbackNumber, null);
    assert.equal(result.issueSummary, null);
    assert.equal(result.bookableOpportunity, null);
    assert.equal(result.officeFollowUpRequired, null);
    assert.equal(result.workflowFailureCode, null);
    assert.equal(result.workflowFailureText, null);
    assert.equal(result.workflowFailureEvidenceComplete, false);
    assert.equal(result.value.evidenceClass, 'unknown');
  }
});

test('unit: structured opportunity and workflow evidence is bounded and internally consistent', () => {
  const result = extractAnalysis({ call_analysis: { custom_analysis_data: {
    outcome: 'urgent_potential_job', coverage_trigger: 'AfterHours', urgency: 'urgent',
    bookable_opportunity: true, office_follow_up_required: true,
    workflow_failure_code: 'office_queue_unavailable',
    workflow_failure_text: 'The office queue was unavailable during the test call.',
  } } });
  assert.equal(result.bookableOpportunity, true);
  assert.equal(result.officeFollowUpRequired, true);
  assert.equal(result.workflowFailureCode, 'office_queue_unavailable');
  assert.equal(result.workflowFailureText, 'The office queue was unavailable during the test call.');
  const incomplete = extractAnalysis({ call_analysis: { custom_analysis_data: {
    outcome: 'potential_job', urgency: 'routine',
  } } });
  assert.equal(incomplete.bookableOpportunity, null);
  assert.equal(incomplete.officeFollowUpRequired, null);
  for (const custom_analysis_data of [
    { outcome: 'potential_job', bookable_opportunity: 'true' },
    { outcome: 'existing_customer', bookable_opportunity: true },
    { outcome: 'potential_job', workflow_failure_code: 'UPPER_CASE' },
    { outcome: 'potential_job', workflow_failure_text: 'Missing code.' },
    { outcome: 'potential_job', workflow_failure_code: 'valid_code',
      workflow_failure_text: 'x'.repeat(241) },
    { outcome: 'urgent_potential_job', urgency: 'routine' },
    { outcome: 'potential_job', urgency: 'urgent' },
    { outcome: 'existing_customer', urgency: 'immediate_danger' },
  ]) assert.throws(() => extractAnalysis({ call_analysis: { custom_analysis_data } }));
  assert.equal(extractAnalysis({ call_analysis: { custom_analysis_data: {
    outcome: 'unresolved', urgency: 'immediate_danger',
  } } }).outcome, 'unresolved');
});

test('unit: Retell cannot assert confirmed, booked, or internal estimated revenue', () => {
  assert.equal(validateValueEvidence({}).source, 'retell');
  assert.equal(validateValueEvidence({ value_evidence_class: 'customer_supplied_estimate',
    value_minor_units: 12500, value_currency: 'USD' }).evidenceClass, 'customer_supplied_estimate');
  for (const value_evidence_class of ['confirmed_revenue', 'booked_revenue', 'internal_estimate_with_method']) {
    assert.throws(() => validateValueEvidence({ value_evidence_class, value_minor_units: 12500,
      value_currency: 'USD' }), { code: 'UNAUTHORIZED_VALUE_EVIDENCE' });
  }
  assert.throws(() => validateValueEvidence({ value_evidence_class: 'confirmed_revenue',
    value_minor_units: 12500, value_currency: 'USD' }, new Set(), 'verified_downstream'),
  { code: 'UNAUTHORIZED_VALUE_EVIDENCE' });
});

test('unit: Catalyst Mail dry-run validates email ownership and never accesses email SDK', async () => {
  let emailAccesses = 0;
  const config = loadConfig(environment());
  const adapter = new CatalystMailAdapter({
    app: { email() { emailAccesses += 1; throw new Error('must remain unreachable'); } }, config,
  });
  const prepared = adapter.prepare({ recipient: { approved: true, channel: 'email',
    email: 'approved@example.invalid' }, payload: { outcome: 'potential_job' } });
  const result = await adapter.notify(prepared);
  assert.equal(result.status, 'DryRunRecorded');
  assert.equal(emailAccesses, 0);
  assert.throws(() => adapter.prepare({ recipient: { approved: true, channel: 'mobile',
    email: 'approved@example.invalid' }, payload: {} }), { code: 'NOTIFICATION_DESTINATION_UNAVAILABLE' });
});

test('unit: Catalyst Mail real Development path uses official SDK shape and treats timeout as ambiguous', async () => {
  const sent = [];
  const config = loadConfig(environment({ REVENUE_DESK_NOTIFICATION_MODE: 'send_development' }));
  const adapter = new CatalystMailAdapter({ app: { email() { return { async sendMail(message) {
    sent.push(message); return { isAsync: false, project_details: { id: 'synthetic-project' },
      from_email: message.from_email, to_email: message.to_email };
  } }; } }, config });
  const prepared = adapter.prepare({ recipient: { approved: true, channel: 'email',
    email: 'synthetic-recipient@example.invalid' }, payload: { callerName: 'Synthetic Caller',
    callOutcome: 'potential_job' } });
  const delivered = await adapter.notify(prepared);
  assert.equal(delivered.status, 'Sent');
  assert.match(delivered.providerResultReference, /^mail_[a-f0-9]{64}$/);
  assert.deepEqual(sent[0].to_email, ['synthetic-recipient@example.invalid']);
  assert.equal(sent[0].from_email, 'verified-sender@example.invalid');
  assert.equal(sent[0].html_mode, true);

  const timeout = new CatalystMailAdapter({ app: { email() { return { sendMail() {
    return new Promise(() => {});
  } }; } }, config: { ...config, mailTimeoutMs: 5 } });
  const timedOut = await timeout.notify(timeout.prepare({ recipient: { approved: true, channel: 'email',
    email: 'synthetic-recipient@example.invalid' }, payload: { callOutcome: 'potential_job' } }));
  assert.equal(timedOut.status, 'Ambiguous');
  assert.equal(timedOut.ambiguous, true);

  const unverified = new CatalystMailAdapter({ app: { email() { return { async sendMail() {
    return { accepted: true };
  } }; } }, config });
  const unverifiedResult = await unverified.notify(unverified.prepare({ recipient: {
    approved: true, channel: 'email', email: 'synthetic-recipient@example.invalid',
  }, payload: { callOutcome: 'potential_job' } }));
  assert.equal(unverifiedResult.status, 'Ambiguous');
  assert.equal(unverifiedResult.providerCode, 'CATALYST_MAIL_RESPONSE_INVALID');
});

test('unit: Catalyst Mail escapes caller text and preserves the capability disclaimer', () => {
  const content = messageContent({
    callerName: '<script>alert("caller")</script>',
    issueSummary: '<img src=x onerror=alert("issue")>',
    callOutcome: 'potential_job',
  });
  assert.doesNotMatch(content, /<script|<img/i);
  assert.match(content, /&lt;script&gt;alert\(&quot;caller&quot;\)&lt;\/script&gt;/);
  assert.match(content, /&lt;img src=x onerror=alert\(&quot;issue&quot;\)&gt;/);
  assert.match(content, /No appointment or dispatch has been confirmed\./);
});

test('unit: raw-body reader enforces the byte ceiling', async () => {
  const request = Readable.from([Buffer.alloc(1025)]);
  await assert.rejects(readRawBody(request, { maximumBytes: 1024, timeoutMs: 1000 }),
    { code: 'REQUEST_TOO_LARGE' });
});

test('unit: CSV export neutralizes caller-supplied spreadsheet formulas and controls', () => {
  assert.equal(csvCell('=HYPERLINK("https://example.invalid")'), `"'=HYPERLINK(""https://example.invalid"")"`);
  assert.equal(csvCell('  +1+1'), "'  +1+1");
  assert.equal(csvCell('safe\tvalue'), 'safe value');
});

test('unit: readiness token comparison is deterministic and timing-safe at the digest boundary', () => {
  assert.equal(timingSafeToken('a'.repeat(32), 'a'.repeat(32)), true);
  assert.equal(timingSafeToken('a'.repeat(32), 'b'.repeat(32)), false);
  assert.equal(timingSafeToken('short', 'b'.repeat(32)), false);
});

test('unit: runtime readiness keeps Development gated and Production unconditionally dark', () => {
  const readiness = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'config', 'runtime-readiness.json'), 'utf8'));
  assert.equal(readiness.record_type, 'revenue_desk_call_runtime_readiness_contract');
  assert.equal(readiness.current_status, 'unverified_requires_deployment_and_readback');
  assert.equal(readiness.source_revision_committed, false);
  assert.equal(readiness.development.active_profile, 'free_test/call_gap_monitor_v1');
  assert.equal(readiness.development.paid_profiles, 'disabled_draft_fail_closed');
  assert.equal(readiness.production.deployment_mode, 'dark');
  assert.deepEqual(readiness.production.required_variables,
    ['DEPLOYMENT_ENVIRONMENT', 'DEPLOYMENT_MODE', 'SOURCE_REVISION']);
  assert.equal(readiness.production.all_gateway_and_worker_invocations,
    '503_before_sdk_or_store');
  assert.equal(readiness.production.traffic_or_activation_authorized, false);
  assert.equal(readiness.tables.canonical_operational.length, 5);
  assert.deepEqual(readiness.tables.delivery_infrastructure,
    ['AnalyticsSyncOutbox', 'CRMBillingOperations']);
  assert.equal(readiness.terminal_report_gate.queue_owner,
    'revenue_desk_call_worker retry_scan');
  assert.equal(readiness.terminal_report_gate.required_operation_status, 'completed');
  assert.equal(readiness.terminal_report_gate.required_last_outcome,
    'report_summary_readback_confirmed');
  assert.equal(readiness.release_artifact.checkout_is_unstamped, true);
  assert.equal(readiness.legacy_deletion_gate.safe, false);
});

test('unit: package manifest contains only the exact gateway and worker targets', () => {
  const project = JSON.parse(fs.readFileSync(path.join(
    __dirname, '..', '..', '..', 'catalyst.json',
  ), 'utf8'));
  assert.deepEqual(project.functions.targets, [
    'revenue_desk_call_gateway',
    'revenue_desk_call_worker',
  ]);
  assert.equal(project.functions.scripts.predeploy,
    'npm --prefix revenue_desk_call_worker ci --ignore-scripts --install-links');
});

test('unit: Advanced I/O entrypoint exports the Catalyst request handler', () => {
  const functionConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalyst-config.json'), 'utf8'));
  assert.equal(require('../package.json').name, functionConfig.deployment.name);
  const handler = require('../index');
  assert.equal(typeof handler, 'function');
});
