'use strict';

const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { loadConfig } = require('../lib/config');
const { RevenueDeskError } = require('../lib/errors');
const { numberLookupKey } = require('../lib/security');
const { routeFingerprint, routeFromRows, authorizationReceiptRow } = require('../lib/approval-control');
const { createRequestListener } = require('../lib/runtime-boundary');
const { createRuntimeService } = require('../lib/runtime-service');
const { CatalystMailAdapter } = require('../lib/catalyst-mail');

const NOW = Date.parse('2026-08-22T12:00:00.000Z');
const SOURCE_REVISION = 'd'.repeat(40);

function environment(overrides = {}) {
  const crmBillingUrlVariable = ['CRM', 'BILLING', 'ORCHESTRATOR', 'URL'].join('_');
  return {
    DEPLOYMENT_ENVIRONMENT: 'development', DEPLOYMENT_MODE: 'active',
    ZOHO_CATALYST_ZCQL_PARSER: 'V2', SOURCE_REVISION,
    X_ZOHO_CATALYST_ENVIRONMENT: 'Development',
    RETELL_WEBHOOK_API_KEY: 'a'.repeat(32),
    RETELL_SHARED_AGENT_ID: 'agent_shared_free_test', RETELL_SHARED_AGENT_VERSION: '7',
    RETELL_INBOUND_PATH: '/retell/inbound', RETELL_EVENTS_PATH: '/retell/events',
    INTERNAL_READINESS_PATH: '/internal/readiness', RETELL_SIGNATURE_MAX_AGE_MS: '300000',
    REVENUE_DESK_RUNTIME_HOST: 'revenue-desk-call-runtime.development.catalystserverless.com',
    REVENUE_DESK_PROJECT_ID: '101000001',
    REVENUE_DESK_WORKER_JOB_POOL_ID: '101000002',
    CRM_BILLING_ORCHESTRATOR_HOST:
      'crm-billing-orchestrator.development.catalystserverless.com',
    [crmBillingUrlVariable]:
      'https://crm-billing-orchestrator.development.catalystserverless.com/server/crm-billing',
    CRM_BILLING_API_GATEWAY_KEY: 'f'.repeat(32),
    CRM_BILLING_SHARED_HEADER_NAME: 'x-synthetic-lifecycle-key',
    CRM_BILLING_SHARED_HEADER_VALUE: 'g'.repeat(32),
    CRM_BILLING_DISPATCH_TIMEOUT_MS: '3000',
    MAX_WEBHOOK_BYTES: '262144', INBOUND_BODY_TIMEOUT_MS: '5000',
    EVENT_HMAC_SECRET: 'b'.repeat(32),
    ANALYTICS_PARTITION_HMAC_SECRET: 'e'.repeat(32),
    NUMBER_LOOKUP_HMAC_SECRET: 'c'.repeat(32),
    INTERNAL_READINESS_TOKEN: 'd'.repeat(32),
    PLATFORM_OPERATION_TIMEOUT_MS: '3000', REVENUE_DESK_NOTIFICATION_MODE: 'dry_run',
    REVENUE_DESK_MAIL_FROM: 'verified-sender@example.invalid',
    REVENUE_DESK_MAIL_TIMEOUT_MS: '3000', REVENUE_DESK_NOTIFICATION_MAX_ATTEMPTS: '3',
    DEPLOYMENT_TABLE: 'RevenueDeskDeployments',
    CONFIGURATION_VERSION_TABLE: 'RevenueDeskConfigurationVersions',
    EVENT_RECEIPT_TABLE: 'RevenueDeskEventReceipts',
    CANONICAL_CALL_TABLE: 'RevenueDeskCalls', NOTIFICATION_TABLE: 'RevenueDeskNotifications',
    ANALYTICS_OUTBOX_TABLE: 'AnalyticsSyncOutbox',
    OPERATION_TABLE: 'CRMBillingOperations',
    ...overrides,
  };
}

function configuration(letter) {
  return {
    clientId: `client_${letter}`, crmDealId: letter === 'A' ? '400000001' : '400000002',
    deploymentId: `deployment_${letter}`,
    configurationVersion: `cfg_${letter}_v1`, approved: true,
    companyName: `Synthetic Plumbing ${letter}`, companyDescription: 'Synthetic contractor.',
    businessHours: 'Monday-Friday 08:00-17:00 America/Chicago',
    coverageMode: letter === 'A' ? 'AfterHoursOnly' : 'NoAnswerOverflowOnly',
    servicesHandled: letter === 'A' ? ['water heaters'] : ['drains'],
    unsupportedServices: letter === 'A' ? ['septic pumping'] : ['well drilling'],
    serviceArea: letter === 'A' ? { cities: ['Lenexa'], zips: ['66215'] }
      : { cities: ['Liberty'], zips: ['64068'] },
    urgentConditions: letter === 'A' ? ['active uncontrolled leak'] : ['sewage backup'],
    callbackExpectation: 'The team will review this. No appointment or dispatch is confirmed.',
    notificationRecipient: {
      recipientId: `recipient_${letter}`, approved: true, name: `Recipient ${letter}`,
      channel: 'email', email: `${letter.toLowerCase()}@example.invalid`, mobile: null,
    },
  };
}

function deploymentRow(config, letter, rowId) {
  const number = letter === 'A' ? '+15550000001' : '+15550000002';
  return {
    ROWID: String(rowId), DEPLOYMENT_KEY: `deployment_key_${letter}`,
    NUMBER_LOOKUP_HASH: numberLookupKey(config.numberSecret, number), BINDING_ID: `binding_${letter}`,
    BINDING_VERSION: 1, CLIENT_ID: `client_${letter}`, DEPLOYMENT_ID: `deployment_${letter}`,
    ACTIVE_CONFIGURATION_VERSION_ID: `configuration_version_${letter}`,
    APPROVED_CONFIGURATION_VERSION_ID: null, APPROVAL_EVENT_KEY: null,
    APPROVED_ROUTE_FINGERPRINT: null, GO_LIVE_APPROVED_AT: null,
    ACTIVATION_EVENT_KEY: null,
    MONITOR_AGENT_ID: config.sharedAgentId, MONITOR_AGENT_VERSION: config.sharedAgentVersion,
    COVERAGE_MODE: letter === 'A' ? 'AfterHoursOnly' : 'NoAnswerOverflowOnly',
    TEST_STATUS: 'Live', GO_LIVE_APPROVAL_STATUS: 'Approved',
    APPROVED_START_AT: '2026-08-20T12:00:00.000Z', ACTUAL_START_AT: '2026-08-20T12:00:00.000Z',
    EXPIRES_AT: '2026-08-27T12:00:00.000Z', CALL_LIMIT: 25, HANDLED_COUNT: 0,
    COUNT_VERSION: 0, COUNTED_CALL_KEYS_JSON: '[]', STOP_REASON: null, STOPPED_AT: null,
    REPORT_RECONCILIATION_STATUS: 'NotRequired', REPORT_RECONCILIATION_VERSION: 0,
    SOURCE_REVISION, SOURCE_ENVIRONMENT: 'development', UPDATED_AT: '2026-08-20T12:00:00.000Z',
  };
}

function configurationRow(config, letter, rowId) {
  return {
    ROWID: String(rowId),
    CONFIGURATION_VERSION_ID: `configuration_version_${letter}`,
    DEPLOYMENT_ID: `deployment_${letter}`,
    CONFIGURATION_VERSION: `cfg_${letter}_v1`,
    CONFIGURATION_JSON: JSON.stringify(configuration(letter)),
    ENGAGEMENT_TYPE: 'free_test',
    CAPABILITY_PROFILE: 'call_gap_monitor_v1',
    PLAN_TIER: 'none',
    DEPLOYMENT_STATUS: 'Live',
    GO_LIVE_APPROVAL_STATUS: 'Approved',
    LIMIT_POLICY: 'seven_calendar_days_or_25_connected_calls_v1',
    BILLING_MODE: 'none',
    NUMBER_OWNERSHIP: 'dedicated_deployment',
    ENVIRONMENT: 'development',
    STATUS: 'Active',
    APPROVAL_STATUS: 'Approved',
    SOURCE_REVISION,
    SOURCE_ENVIRONMENT: 'development',
    CREATED_AT: '2026-08-20T12:00:00.000Z',
    ACTIVATED_AT: '2026-08-20T12:00:00.000Z',
  };
}

function authorizationRows(deployment, configurationVersion, letter) {
  const suffix = letter.toLowerCase();
  const approvalKey = `approval_${suffix.repeat(64)}`;
  const activationSuffix = letter === 'A' ? 'c' : 'd';
  const activationKey = `activation_${activationSuffix.repeat(64)}`;
  const route = routeFingerprint(routeFromRows(deployment, configurationVersion));
  const approvedAt = '2026-08-20T11:50:00.000Z';
  const routeObservedAt = '2026-08-20T11:59:00.000Z';
  const actualStartAt = '2026-08-20T12:00:00.000Z';
  const expiresAt = '2026-08-27T12:00:00.000Z';
  Object.assign(deployment, {
    APPROVED_CONFIGURATION_VERSION_ID: configurationVersion.CONFIGURATION_VERSION_ID,
    APPROVAL_EVENT_KEY: approvalKey,
    APPROVED_ROUTE_FINGERPRINT: route,
    GO_LIVE_APPROVED_AT: approvedAt,
    ACTIVATION_EVENT_KEY: activationKey,
    ACTUAL_START_AT: actualStartAt,
    EXPIRES_AT: expiresAt,
  });
  const approval = {
    AUTHORIZATION_EVENT_ID: approvalKey,
    ACTION: 'approve', DECISION: 'Approved',
    DEPLOYMENT_ID: deployment.DEPLOYMENT_ID,
    CONFIGURATION_VERSION_ID: configurationVersion.CONFIGURATION_VERSION_ID,
    ROUTE_FINGERPRINT: route,
    OPERATOR_ID_HASH: `operator_${'e'.repeat(64)}`,
    INTENT_FINGERPRINT: crypto.createHash('sha256').update(`approval:${letter}`).digest('hex'),
    EVIDENCE_REVISION: SOURCE_REVISION,
    EVIDENCE_OBSERVED_AT: '2026-08-20T11:49:00.000Z',
    EXPECTED_DEPLOYMENT_VERSION: 0,
    CAPACITY_REMAINING_AT_DECISION: 25,
    PREVIOUS_EVENT_HASH: 'genesis',
    EVENT_HASH: crypto.createHash('sha256').update(`approval-event:${letter}`).digest('hex'),
    DECIDED_AT: approvedAt,
  };
  const activation = {
    AUTHORIZATION_EVENT_ID: activationKey,
    ACTION: 'activate', DECISION: 'Activated',
    DEPLOYMENT_ID: deployment.DEPLOYMENT_ID,
    CONFIGURATION_VERSION_ID: configurationVersion.CONFIGURATION_VERSION_ID,
    ROUTE_FINGERPRINT: route,
    ROUTE_READBACK_FINGERPRINT: `readback_${activationSuffix.repeat(64)}`,
    ROUTE_OBSERVED_AT: routeObservedAt,
    APPROVAL_EVENT_KEY: approvalKey,
    OPERATOR_ID_HASH: `operator_${'e'.repeat(64)}`,
    INTENT_FINGERPRINT: crypto.createHash('sha256').update(`activation:${letter}`).digest('hex'),
    EVIDENCE_REVISION: SOURCE_REVISION,
    EVIDENCE_OBSERVED_AT: routeObservedAt,
    EXPECTED_DEPLOYMENT_VERSION: 1,
    PREVIOUS_EVENT_HASH: approval.EVENT_HASH,
    EVENT_HASH: crypto.createHash('sha256').update(`activation-event:${letter}`).digest('hex'),
    ACTUAL_START_AT: actualStartAt,
    EXPIRES_AT: expiresAt,
    DECIDED_AT: actualStartAt,
  };
  return [approval, activation].map((event) => authorizationReceiptRow(event, {
    sourceRevision: SOURCE_REVISION,
    environment: 'development',
  }));
}

class RuntimeMemoryStore {
  constructor(config) {
    this.config = config;
    this.nextRowId = 10;
    this.rows = new Map(Object.values(config.tables).map((table) => [table, []]));
    const deployments = [deploymentRow(config, 'A', 1), deploymentRow(config, 'B', 2)];
    const configurationVersions = [
      configurationRow(config, 'A', 3), configurationRow(config, 'B', 4),
    ];
    this.authorizationRows = deployments.flatMap((deployment, index) => (
      authorizationRows(deployment, configurationVersions[index], index === 0 ? 'A' : 'B')
    ));
    this.rows.get(config.tables.DEPLOYMENT_TABLE).push(...deployments);
    this.rows.get(config.tables.CONFIGURATION_VERSION_TABLE).push(...configurationVersions);
  }
  clone(value) { return value ? structuredClone(value) : value; }
  async query(table, column, value) {
    const baseRows = this.rows.get(table);
    const candidates = table === this.config.tables.EVENT_RECEIPT_TABLE && column === 'EVENT_KEY'
      ? [...baseRows, ...this.authorizationRows] : baseRows;
    return candidates.filter((row) => String(row[column]) === String(value))
      .map((row) => this.clone(row));
  }
  async queryBounded(table, column, value, orderColumn, limit, additional = {}) {
    const baseRows = this.rows.get(table);
    const candidates = table === this.config.tables.EVENT_RECEIPT_TABLE && column === 'EVENT_KEY'
      ? [...baseRows, ...this.authorizationRows] : baseRows;
    return candidates
      .filter((row) => String(row[column]) === String(value))
      .filter((row) => Object.entries(additional)
        .every(([candidate, expected]) => String(row[candidate]) === String(expected)))
      .sort((left, right) => String(left[orderColumn]).localeCompare(String(right[orderColumn]))
        || Number(left.ROWID) - Number(right.ROWID))
      .slice(0, limit)
      .map((row) => this.clone(row));
  }
  async unique(table, column, value) {
    const rows = await this.query(table, column, value);
    if (rows.length > 1) throw new RevenueDeskError('AMBIGUOUS_DURABLE_OWNERSHIP', 'ambiguous');
    return rows[0] || null;
  }
  async uniqueOutboxProviderIdentity(table, identity) {
    const columns = [
      'RECORD_TYPE', 'ENVIRONMENT', 'CLIENT_KEY', 'DEPLOYMENT_KEY',
      'RECORD_KEY', 'SOURCE_MODIFIED_AT',
    ];
    const matches = this.rows.get(table)
      .filter((row) => Number(row.ROW_SCHEMA_VERSION) === 2)
      .filter((row) => columns.every(
        (column) => String(row[column]) === String(identity[column]),
      ));
    if (matches.length > 1) {
      throw new RevenueDeskError('AMBIGUOUS_DURABLE_OWNERSHIP', 'ambiguous');
    }
    return matches.length === 1 ? this.clone(matches[0]) : null;
  }
  async insertUnique(table, keyColumn, row, immutable) {
    const rows = this.rows.get(table);
    const existing = rows.find((candidate) => candidate[keyColumn] === row[keyColumn]);
    if (existing) {
      for (const column of immutable) if (existing[column] !== row[column]) {
        throw new RevenueDeskError('DURABLE_IDEMPOTENCY_CONFLICT', 'conflict');
      }
      return { row: this.clone(existing), inserted: false };
    }
    const inserted = { ...this.clone(row), ROWID: String(this.nextRowId++) };
    rows.push(inserted);
    return { row: this.clone(inserted), inserted: true };
  }
  async mutate(table, keyColumn, keyValue, versionColumn, mutator) {
    const row = this.rows.get(table).find((candidate) => candidate[keyColumn] === keyValue);
    if (!row) throw new RevenueDeskError('DURABLE_ROW_MISSING', 'missing');
    const patch = mutator(this.clone(row));
    if (patch) Object.assign(row, this.clone(patch), { [versionColumn]: Number(row[versionColumn]) + 1 });
    return this.clone(row);
  }
  async readiness() {
    const sourceRows = await this.queryBounded(
      this.config.tables.DEPLOYMENT_TABLE,
      'SOURCE_REVISION',
      this.config.sourceRevision,
      'UPDATED_AT',
      100,
    );
    if (this.config.environment === 'development' && sourceRows.length === 0) {
      throw new RevenueDeskError('CATALYST_READINESS_FAILED', 'no source deployment');
    }
    return {
      tableCount: this.rows.size,
      sourceDeploymentCount: sourceRows.length,
      sourceDeploymentCountCapped: sourceRows.length === 100,
    };
  }
}

function payloadInbound(letter, timestamp) {
  return { event: 'call_inbound', ...(timestamp === undefined ? {} : { event_timestamp: timestamp }), call_inbound: {
    agent_id: 'agent_shared_free_test', agent_version: 7,
    from_number: letter === 'A' ? '+15551110001' : '+15551110002',
    to_number: letter === 'A' ? '+15550000001' : '+15550000002',
  } };
}

function eventPayload(event, callId, metadata, letter = 'A', data = {}) {
  const call = {
    call_id: callId, agent_id: 'agent_shared_free_test', agent_version: 7,
    call_status: 'ended', disconnection_reason: 'user_hangup',
    to_number: letter === 'A' ? '+15550000001' : '+15550000002',
    start_timestamp: NOW, end_timestamp: NOW + 60_000, duration_ms: 60_000, metadata,
  };
  if (event === 'call_analyzed') call.call_analysis = { custom_analysis_data: {
    // Keep the default fixture identical to the sanitized 11-field live readback.
    // Tests for the expanded runtime contract add those fields explicitly in `data`.
    outcome: 'potential_job',
    coverage_trigger: letter === 'A' ? 'AfterHours' : 'NoAnswerOverflow',
    caller_name: `Caller ${letter}`,
    callback_number: letter === 'A' ? '+15551110001' : '+15551110002',
    customer_type: 'new', caller_intent: 'service_request',
    issue_summary: letter === 'A' ? 'Leaking water heater' : 'Blocked drain',
    city_or_zip: letter === 'A' ? 'Lenexa' : 'Liberty', urgency: 'routine',
    specific_person_requested: null, sensitive_data_detected: false,
    ...data,
  } };
  return { event, call };
}

function signature(rawBody, key, timestamp = NOW) {
  const digest = crypto.createHmac('sha256', key).update(rawBody.toString('utf8') + timestamp).digest('hex');
  return `v=${timestamp},d=${digest}`;
}

function retryJobRequest(runtimeEnvironment, params = { mode: 'retry_scan' }) {
  return {
    getProjectDetails() { return { id: runtimeEnvironment.REVENUE_DESK_PROJECT_ID }; },
    getJobPoolDetails() { return {
      id: runtimeEnvironment.REVENUE_DESK_WORKER_JOB_POOL_ID,
      name: 'RevenueDeskCallJobs',
      type: 'Function',
    }; },
    getAllJobParams() { return structuredClone(params); },
  };
}

function retryJobContext(overrides = {}) {
  return { ...overrides };
}

async function invoke(listener, { method = 'POST', url, payload, env, headers = {}, signatureTimestamp = NOW,
  rawHeaders = null, headersDistinct = null, processJobs = true }) {
  const runtimeEnvironment = env || environment();
  const rawBody = Buffer.from(payload === undefined ? '' : JSON.stringify(payload), 'utf8');
  const request = Readable.from(rawBody.length ? [rawBody] : []);
  request.method = method;
  request.url = url;
  request.headers = {
    host: runtimeEnvironment.REVENUE_DESK_RUNTIME_HOST, 'content-type': 'application/json',
    ...(payload === undefined ? {} : { 'x-retell-signature': signature(rawBody, runtimeEnvironment.RETELL_WEBHOOK_API_KEY, signatureTimestamp) }),
    ...headers,
  };
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === null) delete request.headers[name];
  }
  if (rawHeaders !== null) request.rawHeaders = rawHeaders;
  if (headersDistinct !== null) request.headersDistinct = headersDistinct;
  const response = { statusCode: null, headers: {}, body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value = '') { this.body = value; } };
  await listener(request, response);
  if (processJobs && typeof listener.processQueuedJobs === 'function') {
    await listener.processQueuedJobs();
  }
  return { status: response.statusCode, headers: response.headers,
    body: response.body ? JSON.parse(response.body) : null, rawBody };
}

function runtimeFixture(overrides = {}) {
  const env = environment(overrides.environment);
  const config = loadConfig(env, { artifactSourceRevision: SOURCE_REVISION });
  const store = new RuntimeMemoryStore(config);
  let initialized = 0;
  let mailAccesses = 0;
  const app = { config: { environment: env.DEPLOYMENT_ENVIRONMENT, projectId: env.REVENUE_DESK_PROJECT_ID,
    projectKey: 'synthetic_development_project_key' },
    email() { mailAccesses += 1; return { sendMail: overrides.mailBehavior || (() => {
      throw new Error('send boundary must remain unreachable');
    }) }; } };
  const catalystSdk = { initialize() { initialized += 1; return app; } };
  const logs = [];
  const logger = { info(record) { logs.push(record); }, warn(record) { logs.push(record); }, error(record) { logs.push(record); } };
  const clock = { value: overrides.now === undefined ? NOW : overrides.now };
  const jobQueue = [];
  const workerErrors = [];
  const jobFactory = () => ({
    async enqueueProcessEvent(eventKey) {
      jobQueue.push({ mode: 'process_event', event_key: eventKey });
      return { jobId: `job_${eventKey.slice(-24)}`, status: 'Submitted' };
    },
  });
  const listener = createRequestListener({ catalystSdk, environment: env, now: () => clock.value,
    storeFactory: () => store, jobFactory, logger, artifactSourceRevision: SOURCE_REVISION });
  listener.processQueuedJobs = async () => {
    while (jobQueue.length > 0) {
      const params = jobQueue.shift();
      const workerConfig = loadConfig(env, { artifactSourceRevision: SOURCE_REVISION });
      const service = createRuntimeService({
        store,
        mailAdapter: new CatalystMailAdapter({ app, config: workerConfig }),
        config: workerConfig,
        now: () => clock.value,
        logger,
      });
      try {
        await service.processEventReceipt(params.event_key);
      } catch (error) {
        workerErrors.push(error);
      }
    }
  };
  return { env, config, store, listener, logs, app, catalystSdk, clock,
    jobQueue, workerErrors,
    get initialized() { return initialized; }, get mailAccesses() { return mailAccesses; } };
}

module.exports = {
  NOW, SOURCE_REVISION, environment, configuration, deploymentRow, configurationRow, RuntimeMemoryStore,
  payloadInbound, eventPayload, signature, retryJobRequest, retryJobContext, invoke, runtimeFixture,
};
