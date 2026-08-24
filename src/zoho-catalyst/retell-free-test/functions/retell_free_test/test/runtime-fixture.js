'use strict';

const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { loadConfig } = require('../lib/config');
const { FreeTestError } = require('../lib/errors');
const { numberLookupKey } = require('../lib/security');
const { createRequestListener } = require('../lib/runtime-boundary');

const NOW = Date.parse('2026-08-22T12:00:00.000Z');
const SOURCE_REVISION = 'd'.repeat(40);

function environment(overrides = {}) {
  return {
    DEPLOYMENT_ENVIRONMENT: 'development', ZOHO_CATALYST_ZCQL_PARSER: 'V2', SOURCE_REVISION,
    X_ZOHO_CATALYST_ENVIRONMENT: 'Development',
    RETELL_WEBHOOK_API_KEY: 'a'.repeat(32),
    RETELL_SHARED_AGENT_ID: 'agent_shared_free_test', RETELL_SHARED_AGENT_VERSION: '7',
    RETELL_INBOUND_PATH: '/retell/inbound', RETELL_EVENTS_PATH: '/retell/events',
    INTERNAL_READINESS_PATH: '/internal/readiness', RETELL_SIGNATURE_MAX_AGE_MS: '300000',
    FREE_TEST_DEVELOPMENT_HOST: 'retell-free-test.development.catalystserverless.com',
    FREE_TEST_DEVELOPMENT_PROJECT_ID: '101000001',
    FREE_TEST_RETRY_JOB_POOL_ID: '101000002',
    MAX_WEBHOOK_BYTES: '262144', INBOUND_BODY_TIMEOUT_MS: '5000',
    EVENT_HMAC_SECRET: 'b'.repeat(32),
    NUMBER_LOOKUP_HMAC_SECRET: 'c'.repeat(32),
    INTERNAL_READINESS_TOKEN: 'd'.repeat(32),
    PLATFORM_OPERATION_TIMEOUT_MS: '3000', FREE_TEST_NOTIFICATION_MODE: 'dry_run',
    FREE_TEST_MAIL_FROM: 'verified-sender@example.invalid',
    FREE_TEST_MAIL_TIMEOUT_MS: '3000', FREE_TEST_NOTIFICATION_MAX_ATTEMPTS: '3',
    DEPLOYMENT_TABLE: 'FreeTestDeployments', EVENT_RECEIPT_TABLE: 'FreeTestRetellEventReceipts',
    CANONICAL_CALL_TABLE: 'FreeTestCalls', NOTIFICATION_TABLE: 'FreeTestNotifications',
    ...overrides,
  };
}

function configuration(letter) {
  return {
    clientId: `client_${letter}`, deploymentId: `deployment_${letter}`,
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
    CONFIGURATION_VERSION: `cfg_${letter}_v1`, CONFIGURATION_JSON: JSON.stringify(configuration(letter)),
    ENGAGEMENT_TYPE: 'free_test', CAPABILITY_PROFILE: 'call_gap_monitor_v1',
    MONITOR_AGENT_ID: config.sharedAgentId, MONITOR_AGENT_VERSION: config.sharedAgentVersion,
    COVERAGE_MODE: letter === 'A' ? 'AfterHoursOnly' : 'NoAnswerOverflowOnly',
    TEST_STATUS: 'Live', GO_LIVE_APPROVAL_STATUS: 'Approved',
    APPROVED_START_AT: '2026-08-20T12:00:00.000Z', ACTUAL_START_AT: '2026-08-20T12:00:00.000Z',
    EXPIRES_AT: '2026-08-27T12:00:00.000Z', CALL_LIMIT: 25, HANDLED_COUNT: 0,
    COUNT_VERSION: 0, COUNTED_CALL_KEYS_JSON: '[]', STOP_REASON: null, STOPPED_AT: null,
    SOURCE_REVISION, SOURCE_ENVIRONMENT: 'development', UPDATED_AT: '2026-08-20T12:00:00.000Z',
  };
}

class RuntimeMemoryStore {
  constructor(config) {
    this.config = config;
    this.nextRowId = 10;
    this.rows = new Map(Object.values(config.tables).map((table) => [table, []]));
    this.rows.get(config.tables.DEPLOYMENT_TABLE).push(
      deploymentRow(config, 'A', 1), deploymentRow(config, 'B', 2),
    );
  }
  clone(value) { return value ? structuredClone(value) : value; }
  async query(table, column, value) {
    return this.rows.get(table).filter((row) => String(row[column]) === String(value)).map((row) => this.clone(row));
  }
  async unique(table, column, value) {
    const rows = await this.query(table, column, value);
    if (rows.length > 1) throw new FreeTestError('AMBIGUOUS_DURABLE_OWNERSHIP', 'ambiguous');
    return rows[0] || null;
  }
  async insertUnique(table, keyColumn, row, immutable) {
    const rows = this.rows.get(table);
    const existing = rows.find((candidate) => candidate[keyColumn] === row[keyColumn]);
    if (existing) {
      for (const column of immutable) if (existing[column] !== row[column]) {
        throw new FreeTestError('DURABLE_IDEMPOTENCY_CONFLICT', 'conflict');
      }
      return { row: this.clone(existing), inserted: false };
    }
    const inserted = { ...this.clone(row), ROWID: String(this.nextRowId++) };
    rows.push(inserted);
    return { row: this.clone(inserted), inserted: true };
  }
  async mutate(table, keyColumn, keyValue, versionColumn, mutator) {
    const row = this.rows.get(table).find((candidate) => candidate[keyColumn] === keyValue);
    if (!row) throw new FreeTestError('DURABLE_ROW_MISSING', 'missing');
    const patch = mutator(this.clone(row));
    if (patch) Object.assign(row, this.clone(patch), { [versionColumn]: Number(row[versionColumn]) + 1 });
    return this.clone(row);
  }
  async readiness() { return { tableCount: this.rows.size,
    sourceDeploymentCount: this.rows.get(this.config.tables.DEPLOYMENT_TABLE).length }; }
}

function payloadInbound(letter, timestamp = NOW) {
  return { event: 'call_inbound', event_timestamp: timestamp, call_inbound: {
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
    start_timestamp: NOW, end_timestamp: NOW + 60_000, metadata,
  };
  if (event === 'call_analyzed') call.call_analysis = { custom_analysis_data: {
    caller_name: `Caller ${letter}`, callback_number: letter === 'A' ? '+15551110001' : '+15551110002',
    customer_type: 'new', caller_intent: 'request_service',
    issue_summary: letter === 'A' ? 'Leaking water heater' : 'Blocked drain',
    city_or_zip: letter === 'A' ? 'Lenexa' : 'Liberty', urgency: 'routine',
    specific_person_requested: null, outcome: 'potential_job',
    coverage_trigger: letter === 'A' ? 'AfterHours' : 'NoAnswerOverflow',
    value_evidence_class: 'unknown', ...data,
  } };
  return { event, call };
}

function signature(rawBody, key, timestamp = NOW) {
  const digest = crypto.createHmac('sha256', key).update(rawBody.toString('utf8') + timestamp).digest('hex');
  return `v=${timestamp},d=${digest}`;
}

function retryJobRequest(runtimeEnvironment) {
  return {
    getProjectDetails() { return { id: runtimeEnvironment.FREE_TEST_DEVELOPMENT_PROJECT_ID }; },
    getJobPoolDetails() { return { id: runtimeEnvironment.FREE_TEST_RETRY_JOB_POOL_ID, type: 'Function' }; },
  };
}

function retryJobContext(overrides = {}) {
  return { ...overrides };
}

async function invoke(listener, { method = 'POST', url, payload, env, headers = {}, signatureTimestamp = NOW,
  rawHeaders = null, headersDistinct = null }) {
  const runtimeEnvironment = env || environment();
  const rawBody = Buffer.from(payload === undefined ? '' : JSON.stringify(payload), 'utf8');
  const request = Readable.from(rawBody.length ? [rawBody] : []);
  request.method = method;
  request.url = url;
  request.headers = {
    host: runtimeEnvironment.FREE_TEST_DEVELOPMENT_HOST, 'content-type': 'application/json',
    'x-zc-environment': 'Development',
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
  return { status: response.statusCode, headers: response.headers,
    body: response.body ? JSON.parse(response.body) : null, rawBody };
}

function runtimeFixture(overrides = {}) {
  const env = environment(overrides.environment);
  const config = loadConfig(env);
  const store = new RuntimeMemoryStore(config);
  let initialized = 0;
  let mailAccesses = 0;
  const app = { config: { environment: 'development', projectId: env.FREE_TEST_DEVELOPMENT_PROJECT_ID,
    projectKey: 'synthetic_development_project_key' },
    email() { mailAccesses += 1; return { sendMail: overrides.mailBehavior || (() => {
      throw new Error('send boundary must remain unreachable');
    }) }; } };
  const catalystSdk = { initialize() { initialized += 1; return app; } };
  const logs = [];
  const logger = { info(record) { logs.push(record); }, warn(record) { logs.push(record); }, error(record) { logs.push(record); } };
  const clock = { value: overrides.now === undefined ? NOW : overrides.now };
  const listener = createRequestListener({ catalystSdk, environment: env, now: () => clock.value,
    storeFactory: () => store, logger });
  return { env, config, store, listener, logs, app, catalystSdk, clock,
    get initialized() { return initialized; }, get mailAccesses() { return mailAccesses; } };
}

module.exports = {
  NOW, SOURCE_REVISION, environment, configuration, deploymentRow, RuntimeMemoryStore,
  payloadInbound, eventPayload, signature, retryJobRequest, retryJobContext, invoke, runtimeFixture,
};
