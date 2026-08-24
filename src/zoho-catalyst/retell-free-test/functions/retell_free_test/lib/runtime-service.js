'use strict';

const crypto = require('node:crypto');
const { CONTRACT, COVERAGE_MODES } = require('./contracts');
const { FreeTestError, invariant } = require('./errors');
const {
  validateInboundPayload, validateEventEnvelope, validateConfiguration, e164, isPlainObject,
} = require('./validation');
const {
  numberLookupKey, eventReceiptKey, callLookupKey, payloadFingerprint,
  publicCorrelationId, keyedDigest,
} = require('./security');
const { extractAnalysis, triggerAllowedForMode, makeNotificationPayload } = require('./analysis');
const { MAX_CATALYST_TEXT_BYTES } = require('./catalyst-store');

const RECEIPT_IMMUTABLE = Object.freeze([
  'EVENT_KEY', 'CALL_KEY', 'PAYLOAD_FINGERPRINT', 'EVENT_TYPE', 'EVENT_DATA_JSON',
]);
const CALL_IMMUTABLE = Object.freeze([
  'CALL_KEY', 'CORRELATION_ID', 'CLIENT_ID', 'DEPLOYMENT_ID', 'CONFIGURATION_VERSION',
  'BINDING_ID', 'BINDING_VERSION',
]);
const NOTIFICATION_IMMUTABLE = Object.freeze([
  'NOTIFICATION_KEY', 'CALL_KEY', 'CORRELATION_ID', 'CLIENT_ID', 'DEPLOYMENT_ID',
  'CONFIGURATION_VERSION', 'RECIPIENT_FINGERPRINT', 'TEMPLATE_VERSION', 'PAYLOAD_JSON',
]);
const EVENT_RETRY_DELAYS_MS = Object.freeze([1000, 5000]);
const NOTIFICATION_RETRY_DELAYS_MS = Object.freeze([1000, 5000]);
const CONTAINED_EVENT_STATES = new Set([
  'Completed', 'RetryRequired', 'TerminalFailure', 'ReconciliationRequired',
]);
const CONTAINED_NOTIFICATION_STATES = new Set([
  'DryRunRecorded', 'Sent', 'Ambiguous', 'ReconciliationRequired', 'TerminalFailure',
]);
const OWNERSHIP_METADATA_FIELDS = Object.freeze([
  'resolver_status', 'client_id', 'deployment_id', 'configuration_version', 'engagement_type',
  'capability_profile', 'coverage_mode', 'number_binding_id', 'number_binding_version',
  'correlation_id', 'resolved_at', 'ownership_token',
]);

function canonicalTimestamp(value, name) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  invariant(Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
    'CONFIGURATION_UNAVAILABLE', `${name} is invalid.`);
  return value;
}

function integerColumn(value, name, minimum = 0) {
  const canonicalString = typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value);
  const parsed = typeof value === 'number' ? value
    : canonicalString ? Number(value) : Number.NaN;
  invariant(Number.isSafeInteger(parsed) && parsed >= minimum,
    'CONFIGURATION_UNAVAILABLE', `${name} is invalid.`);
  return parsed;
}

function durableErrorCode(error) {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code : 'UNEXPECTED_ERROR';
}

function parseJsonColumn(value, name) {
  invariant(typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= MAX_CATALYST_TEXT_BYTES,
    'CONFIGURATION_UNAVAILABLE', `${name} is invalid.`);
  try {
    const parsed = JSON.parse(value);
    invariant(isPlainObject(parsed) || Array.isArray(parsed),
      'CONFIGURATION_UNAVAILABLE', `${name} is invalid.`);
    return parsed;
  } catch (error) {
    if (error instanceof FreeTestError) throw error;
    throw new FreeTestError('CONFIGURATION_UNAVAILABLE', `${name} is invalid.`, { cause: error });
  }
}

function deploymentFromRow(row, config) {
  invariant(isPlainObject(row), 'CONFIGURATION_UNAVAILABLE', 'Deployment row is unavailable.');
  const configuration = validateConfiguration(parseJsonColumn(row.CONFIGURATION_JSON, 'CONFIGURATION_JSON'));
  const approvedStartAt = canonicalTimestamp(row.APPROVED_START_AT, 'APPROVED_START_AT');
  const actualStartAt = canonicalTimestamp(row.ACTUAL_START_AT, 'ACTUAL_START_AT');
  const expiresAt = canonicalTimestamp(row.EXPIRES_AT, 'EXPIRES_AT');
  const handledCount = integerColumn(row.HANDLED_COUNT, 'HANDLED_COUNT');
  const callLimit = integerColumn(row.CALL_LIMIT, 'CALL_LIMIT', 1);
  const stopReason = row.STOP_REASON === null || row.STOP_REASON === undefined
    ? null : row.STOP_REASON;
  const stoppedAt = row.STOPPED_AT === null || row.STOPPED_AT === undefined
    ? null : canonicalTimestamp(row.STOPPED_AT, 'STOPPED_AT');
  const countedCallKeys = parseJsonColumn(row.COUNTED_CALL_KEYS_JSON, 'COUNTED_CALL_KEYS_JSON');
  invariant(Array.isArray(countedCallKeys) && countedCallKeys.every((key) => /^call_[a-f0-9]{64}$/.test(key))
    && new Set(countedCallKeys).size === countedCallKeys.length
    && countedCallKeys.length === handledCount,
  'CONFIGURATION_UNAVAILABLE', 'Handled-call convergence state is inconsistent.');
  invariant(row.SOURCE_ENVIRONMENT === 'development' && row.ENGAGEMENT_TYPE === CONTRACT.engagement_type
    && row.CAPABILITY_PROFILE === CONTRACT.capability_profile,
  'CONFIGURATION_UNAVAILABLE', 'Deployment capability gate is invalid.');
  invariant(row.SOURCE_REVISION === config.sourceRevision,
    'CONFIGURATION_UNAVAILABLE', 'Deployment source revision does not match this runtime.');
  invariant(COVERAGE_MODES.has(row.COVERAGE_MODE) && row.MONITOR_AGENT_ID === config.sharedAgentId
    && integerColumn(row.MONITOR_AGENT_VERSION, 'MONITOR_AGENT_VERSION') === config.sharedAgentVersion,
  'CONFIGURATION_UNAVAILABLE', 'Shared agent or coverage binding is invalid.');
  invariant(callLimit === CONTRACT.handled_call_limit
    && Date.parse(actualStartAt) >= Date.parse(approvedStartAt)
    && Date.parse(expiresAt) - Date.parse(actualStartAt) === CONTRACT.test_duration_days * 86_400_000,
  'CONFIGURATION_UNAVAILABLE', 'Test timing or call-limit configuration is invalid.');
  invariant(configuration.approved && configuration.notificationRecipient.approved
    && configuration.notificationRecipient.channel === 'email'
    && configuration.clientId === row.CLIENT_ID
    && configuration.deploymentId === row.DEPLOYMENT_ID
    && configuration.configurationVersion === row.CONFIGURATION_VERSION
    && configuration.coverageMode === row.COVERAGE_MODE,
  'CONFIGURATION_UNAVAILABLE', 'Embedded configuration ownership is invalid.');
  invariant(typeof row.BINDING_ID === 'string' && row.BINDING_ID.length > 0
    && integerColumn(row.BINDING_VERSION, 'BINDING_VERSION', 1) > 0
    && /^num_[a-f0-9]{64}$/.test(row.NUMBER_LOOKUP_HASH),
  'CONFIGURATION_UNAVAILABLE', 'Number binding is invalid.');
  invariant((stopReason === null && stoppedAt === null)
    || (typeof stopReason === 'string'
      && CONTRACT.stop_reason_mappings.some((item) => item.internal === stopReason)
      && stoppedAt !== null),
  'CONFIGURATION_UNAVAILABLE', 'Deployment stop state is inconsistent.');
  return Object.freeze({
    row,
    configuration,
    clientId: row.CLIENT_ID,
    deploymentId: row.DEPLOYMENT_ID,
    configurationVersion: row.CONFIGURATION_VERSION,
    bindingId: row.BINDING_ID,
    bindingVersion: integerColumn(row.BINDING_VERSION, 'BINDING_VERSION', 1),
    numberLookupHash: row.NUMBER_LOOKUP_HASH,
    coverageMode: row.COVERAGE_MODE,
    approvedStartAt,
    actualStartAt,
    expiresAt,
    callLimit,
    handledCount,
    countedCallKeys,
    countVersion: integerColumn(row.COUNT_VERSION, 'COUNT_VERSION'),
    testStatus: row.TEST_STATUS,
    approvalStatus: row.GO_LIVE_APPROVAL_STATUS,
    stopReason,
    stoppedAt,
  });
}

function activeAt(deployment, timestampMs) {
  invariant(deployment.testStatus === CONTRACT.active_test_status
    && deployment.approvalStatus === CONTRACT.approved_go_live_status
    && deployment.stopReason === null
    && deployment.stoppedAt === null,
  'CONFIGURATION_UNAVAILABLE', 'Deployment is not approved and active.');
  invariant(timestampMs >= Date.parse(deployment.actualStartAt)
    && timestampMs < Date.parse(deployment.expiresAt),
  'CONFIGURATION_UNAVAILABLE', 'Deployment is outside its approved test period.');
  invariant(deployment.handledCount < deployment.callLimit,
    'CONFIGURATION_UNAVAILABLE', 'Deployment handled-call limit has been reached.');
}

function metadataToken(config, fields) {
  return keyedDigest(config.eventSecret, 'free-test-runtime-binding-v1', fields);
}

function resolverMetadata(config, deployment, correlationId, resolvedAt) {
  const values = [
    deployment.clientId, deployment.deploymentId, deployment.configurationVersion,
    deployment.bindingId, deployment.bindingVersion, deployment.numberLookupHash,
    correlationId, resolvedAt,
  ];
  return Object.freeze({
    resolver_status: CONTRACT.resolved_status,
    client_id: deployment.clientId,
    deployment_id: deployment.deploymentId,
    configuration_version: deployment.configurationVersion,
    engagement_type: CONTRACT.engagement_type,
    capability_profile: CONTRACT.capability_profile,
    coverage_mode: deployment.coverageMode,
    number_binding_id: deployment.bindingId,
    number_binding_version: String(deployment.bindingVersion),
    correlation_id: correlationId,
    resolved_at: resolvedAt,
    ownership_token: metadataToken(config, values),
  });
}

function unavailable(config, reasonCode) {
  return Object.freeze({
    status: CONTRACT.configuration_unavailable_status,
    reasonCode,
    response: Object.freeze({ call_inbound: Object.freeze({ reject: true }) }),
  });
}

function conversationVariables(deployment, metadata) {
  const item = deployment.configuration;
  return Object.freeze({
    ...metadata,
    company_name: item.companyName,
    company_description: item.companyDescription || '',
    business_hours: item.businessHours,
    services_handled_json: JSON.stringify(item.servicesHandled),
    unsupported_services_json: JSON.stringify(item.unsupportedServices),
    service_area_json: JSON.stringify(item.serviceArea),
    urgent_conditions_json: JSON.stringify(item.urgentConditions),
    callback_expectation: item.callbackExpectation,
  });
}

function parseOwnershipMetadata(metadata, config) {
  invariant(isPlainObject(metadata), 'CALL_OWNERSHIP_UNRESOLVED', 'Ownership metadata is unavailable.');
  const required = [
    'client_id', 'deployment_id', 'configuration_version', 'coverage_mode', 'number_binding_id',
    'number_binding_version', 'correlation_id', 'resolved_at', 'ownership_token',
  ];
  invariant(metadata.resolver_status === CONTRACT.resolved_status
    && metadata.engagement_type === CONTRACT.engagement_type
    && metadata.capability_profile === CONTRACT.capability_profile
    && required.every((name) => typeof metadata[name] === 'string' && metadata[name].length > 0),
  'CALL_OWNERSHIP_UNRESOLVED', 'Ownership metadata failed the exact gate.');
  const bindingVersion = integerColumn(metadata.number_binding_version, 'number_binding_version', 1);
  canonicalTimestamp(metadata.resolved_at, 'resolved_at');
  return Object.freeze({ ...metadata, bindingVersion });
}

function validateMetadataBinding(metadata, deployment, config) {
  invariant(metadata.client_id === deployment.clientId
    && metadata.deployment_id === deployment.deploymentId
    && metadata.configuration_version === deployment.configurationVersion
    && metadata.coverage_mode === deployment.coverageMode
    && metadata.number_binding_id === deployment.bindingId
    && metadata.bindingVersion === deployment.bindingVersion,
  'CALL_OWNERSHIP_UNRESOLVED', 'Ownership metadata conflicts with the deployment.');
  const expected = metadataToken(config, [
    deployment.clientId, deployment.deploymentId, deployment.configurationVersion,
    deployment.bindingId, deployment.bindingVersion, deployment.numberLookupHash,
    metadata.correlation_id, metadata.resolved_at,
  ]);
  invariant(expected === metadata.ownership_token,
    'CALL_OWNERSHIP_UNRESOLVED', 'Ownership token is invalid.');
}

function canonicalCallObject(envelope, deployment, callKey, correlationId, analysis = null) {
  const existing = analysis || {};
  return Object.freeze({
    schemaVersion: 1,
    callKey,
    correlationId,
    clientId: deployment.clientId,
    deploymentId: deployment.deploymentId,
    configurationVersion: deployment.configurationVersion,
    bindingId: deployment.bindingId,
    bindingVersion: deployment.bindingVersion,
    numberLookupHash: deployment.numberLookupHash,
    startedAt: new Date(envelope.startTimestamp).toISOString(),
    endedAt: envelope.endTimestamp === null ? null : new Date(envelope.endTimestamp).toISOString(),
    callStatus: envelope.callStatus,
    disconnectionReason: envelope.disconnectionReason,
    outcome: existing.outcome || 'unresolved',
    coverageTrigger: existing.coverageTrigger || 'Unknown',
    callerName: existing.callerName ?? null,
    callbackNumber: existing.callbackNumber ?? null,
    customerType: existing.customerType || 'unknown',
    callerIntent: existing.callerIntent ?? null,
    issueSummary: existing.issueSummary ?? null,
    cityOrZip: existing.cityOrZip ?? null,
    urgency: existing.urgency || 'unknown',
    specificPersonRequested: existing.specificPersonRequested ?? null,
    value: existing.value || { evidenceClass: 'unknown', valueMinorUnits: null, currency: null, methodId: null, methodVersion: null },
    sensitiveDataMinimized: existing.sensitiveDataMinimized === true,
  });
}

function assertCanonicalCallIntegrity(row, canonical, deployment = null,
  errorCode = 'CALL_OWNERSHIP_UNRESOLVED') {
  const bindingVersion = Number(row?.BINDING_VERSION);
  invariant(isPlainObject(row) && isPlainObject(canonical)
    && canonical.schemaVersion === 1
    && canonical.callKey === row.CALL_KEY
    && canonical.correlationId === row.CORRELATION_ID
    && canonical.clientId === row.CLIENT_ID
    && canonical.deploymentId === row.DEPLOYMENT_ID
    && canonical.configurationVersion === row.CONFIGURATION_VERSION
    && canonical.bindingId === row.BINDING_ID
    && Number.isSafeInteger(bindingVersion)
    && canonical.bindingVersion === bindingVersion,
  errorCode, 'Canonical call content conflicts with its durable tenant binding.');
  if (deployment) invariant(row.CLIENT_ID === deployment.clientId
    && row.DEPLOYMENT_ID === deployment.deploymentId
    && row.CONFIGURATION_VERSION === deployment.configurationVersion
    && row.BINDING_ID === deployment.bindingId
    && bindingVersion === deployment.bindingVersion
    && canonical.numberLookupHash === deployment.numberLookupHash,
  errorCode, 'Canonical call content conflicts with deployment ownership.');
  return canonical;
}

function normalizeEventForReceipt(payload, config) {
  const envelope = validateEventEnvelope(payload);
  const toNumber = e164(envelope.call.to_number, 'event webhook.call.to_number');
  let metadata = null;
  if (isPlainObject(envelope.call.metadata)) {
    metadata = {};
    for (const field of OWNERSHIP_METADATA_FIELDS) {
      if (typeof envelope.call.metadata[field] === 'string') {
        invariant(envelope.call.metadata[field].length <= 256, 'INVALID_SCHEMA',
          'Event ownership metadata is too large.');
        metadata[field] = envelope.call.metadata[field];
      }
    }
  }
  const analysis = envelope.event === 'call_analyzed'
    ? extractAnalysis(envelope.call, new Set()) : null;
  const eventData = Object.freeze({
    event: envelope.event,
    agentId: envelope.agentId,
    agentVersion: envelope.agentVersion,
    numberLookupHash: numberLookupKey(config.numberSecret, toNumber),
    startTimestamp: envelope.startTimestamp,
    endTimestamp: envelope.endTimestamp,
    callStatus: envelope.callStatus,
    disconnectionReason: envelope.disconnectionReason,
    metadata,
    analysis,
  });
  invariant(Buffer.byteLength(JSON.stringify(eventData), 'utf8') <= MAX_CATALYST_TEXT_BYTES,
    'INVALID_SCHEMA', 'Minimized event exceeds the durable bound.');
  return Object.freeze({ callId: envelope.callId, eventData });
}

function createRuntimeService({ store, mailAdapter, config, now = Date.now, logger = { info() {}, warn() {}, error() {} } }) {
  invariant(config.environment === 'development', 'PRODUCTION_BLOCKED', 'Runtime service is Development-only.', { httpStatus: 503 });
  const deploymentTable = config.tables.DEPLOYMENT_TABLE;
  const receiptTable = config.tables.EVENT_RECEIPT_TABLE;
  const callTable = config.tables.CANONICAL_CALL_TABLE;
  const notificationTable = config.tables.NOTIFICATION_TABLE;

  async function findByNumber(toNumber) {
    const lookup = numberLookupKey(config.numberSecret, toNumber);
    const rows = await store.query(deploymentTable, 'NUMBER_LOOKUP_HASH', lookup);
    invariant(rows.length === 1, 'CONFIGURATION_UNAVAILABLE', 'Called number does not resolve uniquely.');
    const deployment = deploymentFromRow(rows[0], config);
    invariant(deployment.numberLookupHash === lookup, 'CONFIGURATION_UNAVAILABLE', 'Called-number binding is inconsistent.');
    return deployment;
  }

  async function resolveInbound(payload, context = {}) {
    let inbound = null;
    try {
      inbound = validateInboundPayload(payload);
      invariant(Number.isSafeInteger(context.signatureTimestamp),
        'EVENT_TIMESTAMP_MISMATCH', 'Verified signature timestamp is unavailable.');
      invariant(Math.abs(context.signatureTimestamp - inbound.eventTimestamp) <= config.maxSignatureAgeMs,
        'EVENT_TIMESTAMP_MISMATCH', 'Signed and body timestamps are inconsistent.');
      invariant((inbound.agentId === null || inbound.agentId === config.sharedAgentId)
        && (inbound.agentVersion === null || inbound.agentVersion === config.sharedAgentVersion),
      'CONFIGURATION_UNAVAILABLE', 'Inbound shared-agent binding is invalid.');
      const deployment = await findByNumber(inbound.toNumber);
      const requestTimestamp = now();
      activeAt(deployment, requestTimestamp);
      const resolvedAt = new Date(requestTimestamp).toISOString();
      const correlationId = publicCorrelationId(config.eventSecret, [
        'inbound', deployment.numberLookupHash, context.signatureTimestamp, inbound.fromNumber,
      ]);
      const metadata = resolverMetadata(config, deployment, correlationId, resolvedAt);
      logger.info({ event: 'inbound_resolved', correlationId });
      return Object.freeze({ status: CONTRACT.resolved_status, correlationId, response: Object.freeze({
        call_inbound: Object.freeze({
          override_agent_id: config.sharedAgentId,
          override_agent_version: config.sharedAgentVersion,
          dynamic_variables: conversationVariables(deployment, metadata),
          metadata,
        }),
      }) });
    } catch (error) {
      if (!(error instanceof FreeTestError)) throw error;
      const correlationId = publicCorrelationId(config.eventSecret, [
        'inbound-unavailable', context.signatureTimestamp || now(), error.code,
      ]);
      logger.warn({ event: 'inbound_unavailable', correlationId, errorCode: error.code });
      return unavailable(config, error.code);
    }
  }

  async function ownership(eventData, callKey) {
    invariant(eventData.agentId === config.sharedAgentId && eventData.agentVersion === config.sharedAgentVersion,
      'CALL_OWNERSHIP_UNRESOLVED', 'Post-call agent binding is invalid.');
    const eventNumberHash = eventData.numberLookupHash;
    if (isPlainObject(eventData.metadata) && Object.keys(eventData.metadata).length > 0) {
      const metadata = parseOwnershipMetadata(eventData.metadata, config);
      const row = await store.unique(deploymentTable, 'DEPLOYMENT_ID', metadata.deployment_id);
      const deployment = deploymentFromRow(row, config);
      invariant(eventNumberHash === deployment.numberLookupHash,
        'CALL_OWNERSHIP_UNRESOLVED', 'Event called number conflicts with ownership metadata.');
      validateMetadataBinding(metadata, deployment, config);
      invariant(eventData.startTimestamp >= Date.parse(deployment.actualStartAt)
        && eventData.startTimestamp < Date.parse(deployment.expiresAt),
      'CALL_OWNERSHIP_UNRESOLVED', 'Call is outside the test interval.');
      return { deployment, correlationId: metadata.correlation_id };
    }
    const existing = await store.unique(callTable, 'CALL_KEY', callKey);
    if (existing) {
      const deploymentRow = await store.unique(deploymentTable, 'DEPLOYMENT_ID', existing.DEPLOYMENT_ID);
      const deployment = deploymentFromRow(deploymentRow, config);
      const canonical = assertCanonicalCallIntegrity(existing,
        parseJsonColumn(existing.CANONICAL_CALL_JSON, 'CANONICAL_CALL_JSON'), deployment);
      invariant(CALL_IMMUTABLE.every((column) => existing[column] !== null && existing[column] !== undefined)
        && existing.SOURCE_ENVIRONMENT === 'development'
        && /^[0-9a-f]{40}$/.test(existing.SOURCE_REVISION)
        && eventNumberHash === canonical.numberLookupHash,
      'CALL_OWNERSHIP_UNRESOLVED', 'Durable call binding is inconsistent.');
      return { deployment, correlationId: existing.CORRELATION_ID };
    }
    const rows = await store.query(deploymentTable, 'NUMBER_LOOKUP_HASH', eventNumberHash);
    invariant(rows.length === 1, 'CALL_OWNERSHIP_UNRESOLVED',
      'Called-number hash does not resolve uniquely.');
    const deployment = deploymentFromRow(rows[0], config);
    activeAt(deployment, eventData.startTimestamp);
    return {
      deployment,
      correlationId: publicCorrelationId(config.eventSecret, ['post-call-number-fallback', callKey, deployment.bindingId]),
    };
  }

  async function upsertCall(eventData, callKey, owner, analysis, at) {
    const canonical = canonicalCallObject(eventData, owner.deployment, callKey, owner.correlationId, analysis);
    const initial = {
      CALL_KEY: callKey, CALL_VERSION: 1, CORRELATION_ID: owner.correlationId,
      CLIENT_ID: owner.deployment.clientId, DEPLOYMENT_ID: owner.deployment.deploymentId,
      CONFIGURATION_VERSION: owner.deployment.configurationVersion,
      BINDING_ID: owner.deployment.bindingId, BINDING_VERSION: owner.deployment.bindingVersion,
      CANONICAL_CALL_JSON: JSON.stringify(canonical), OUTCOME: canonical.outcome,
      PROCESSING_STATE: analysis ? 'Analyzed' : 'AwaitingAnalysis', HANDLED_RECORDED: false,
      NOTIFICATION_STATE: null, STARTED_AT: canonical.startedAt, ENDED_AT: canonical.endedAt,
      SOURCE_REVISION: config.sourceRevision, SOURCE_ENVIRONMENT: config.environment, UPDATED_AT: at,
    };
    const inserted = await store.insertUnique(callTable, 'CALL_KEY', initial, CALL_IMMUTABLE);
    const row = inserted.row;
    for (const column of CALL_IMMUTABLE) invariant(column === 'BINDING_VERSION'
      ? Number(row[column]) === initial[column] : row[column] === initial[column],
      'CALL_OWNERSHIP_UNRESOLVED', 'Provider call identity is already bound elsewhere.');
    invariant(row.SOURCE_ENVIRONMENT === 'development' && /^[0-9a-f]{40}$/.test(row.SOURCE_REVISION),
      'CALL_OWNERSHIP_UNRESOLVED', 'Canonical call source audit identity is invalid.');
    if (!analysis) {
      const prior = assertCanonicalCallIntegrity(row,
        parseJsonColumn(row.CANONICAL_CALL_JSON, 'CANONICAL_CALL_JSON'), owner.deployment);
      invariant(prior.startedAt === canonical.startedAt,
        'DURABLE_IDEMPOTENCY_CONFLICT', 'Provider call start time changed across events.');
      invariant(!prior.callStatus || prior.callStatus === canonical.callStatus,
        'DURABLE_IDEMPOTENCY_CONFLICT', 'Provider call lifecycle status changed across events.');
      invariant(!prior.disconnectionReason || !canonical.disconnectionReason
        || prior.disconnectionReason === canonical.disconnectionReason,
      'DURABLE_IDEMPOTENCY_CONFLICT', 'Provider disconnection reason changed across events.');
      invariant(!prior.endedAt || !canonical.endedAt || prior.endedAt === canonical.endedAt,
        'DURABLE_IDEMPOTENCY_CONFLICT', 'Provider call end time changed across events.');
      if (prior.endedAt || !canonical.endedAt) return row;
      return store.mutate(callTable, 'CALL_KEY', callKey, 'CALL_VERSION', (current) => {
        const body = assertCanonicalCallIntegrity(current,
          parseJsonColumn(current.CANONICAL_CALL_JSON, 'CANONICAL_CALL_JSON'), owner.deployment);
        if (body.endedAt) return null;
        return { CANONICAL_CALL_JSON: JSON.stringify({ ...body, endedAt: canonical.endedAt }), ENDED_AT: canonical.endedAt, UPDATED_AT: at };
      });
    }
    return store.mutate(callTable, 'CALL_KEY', callKey, 'CALL_VERSION', (current) => {
      const prior = assertCanonicalCallIntegrity(current,
        parseJsonColumn(current.CANONICAL_CALL_JSON, 'CANONICAL_CALL_JSON'), owner.deployment);
      invariant(prior.startedAt === canonical.startedAt,
        'DURABLE_IDEMPOTENCY_CONFLICT', 'Provider call start time changed across events.');
      invariant(!prior.callStatus || prior.callStatus === canonical.callStatus,
        'DURABLE_IDEMPOTENCY_CONFLICT', 'Provider call lifecycle status changed across events.');
      invariant(!prior.disconnectionReason || !canonical.disconnectionReason
        || prior.disconnectionReason === canonical.disconnectionReason,
      'DURABLE_IDEMPOTENCY_CONFLICT', 'Provider disconnection reason changed across events.');
      invariant(!prior.endedAt || !canonical.endedAt || prior.endedAt === canonical.endedAt,
        'DURABLE_IDEMPOTENCY_CONFLICT', 'Provider call end time changed across events.');
      if (current.PROCESSING_STATE === 'Completed') {
        invariant(current.OUTCOME === canonical.outcome,
          'DURABLE_IDEMPOTENCY_CONFLICT', 'Analyzed call replay changed the canonical outcome.');
        return null;
      }
      return {
        CANONICAL_CALL_JSON: JSON.stringify({ ...canonical,
          endedAt: canonical.endedAt || prior.endedAt,
          callStatus: canonical.callStatus || prior.callStatus,
          disconnectionReason: canonical.disconnectionReason || prior.disconnectionReason }),
        OUTCOME: canonical.outcome, PROCESSING_STATE: 'Analyzed',
        STARTED_AT: canonical.startedAt, ENDED_AT: canonical.endedAt || prior.endedAt,
        UPDATED_AT: at,
      };
    });
  }

  async function ensureNotification(callRow, deployment, at) {
    const call = assertCanonicalCallIntegrity(callRow,
      parseJsonColumn(callRow.CANONICAL_CALL_JSON, 'CANONICAL_CALL_JSON'), deployment);
    const payload = makeNotificationPayload(call);
    const prepared = mailAdapter.prepare({ recipient: deployment.configuration.notificationRecipient, payload });
    const notificationKey = `notify_${keyedDigest(config.eventSecret, 'free-test-notification-v1', [
      callRow.CALL_KEY, prepared.templateVersion, prepared.recipientFingerprint,
    ])}`;
    const row = {
      NOTIFICATION_KEY: notificationKey, NOTIFICATION_VERSION: 1, CALL_KEY: callRow.CALL_KEY,
      CORRELATION_ID: callRow.CORRELATION_ID, CLIENT_ID: callRow.CLIENT_ID,
      DEPLOYMENT_ID: callRow.DEPLOYMENT_ID, CONFIGURATION_VERSION: callRow.CONFIGURATION_VERSION,
      RECIPIENT_FINGERPRINT: prepared.recipientFingerprint,
      TEMPLATE_VERSION: prepared.templateVersion, PAYLOAD_JSON: JSON.stringify(payload), STATUS: 'Pending',
      ATTEMPT_COUNT: 0, PROVIDER_CODE: 'NOT_ATTEMPTED',
      PROVIDER_RESULT_REFERENCE: null,
      SEND_TOKEN: null, LAST_ATTEMPT_AT: null, NEXT_ATTEMPT_AT: null, LAST_ERROR_CODE: null,
      CREATED_AT: at, UPDATED_AT: at, SOURCE_REVISION: config.sourceRevision,
      SOURCE_ENVIRONMENT: config.environment,
    };
    const ensured = await store.insertUnique(notificationTable, 'NOTIFICATION_KEY', row, NOTIFICATION_IMMUTABLE);
    const current = ensured.row;
    invariant(current.SOURCE_ENVIRONMENT === 'development'
      && /^[0-9a-f]{40}$/.test(current.SOURCE_REVISION),
    'NOTIFICATION_STATE_CONFLICT', 'Notification source audit identity is invalid.');
    if (new Set(['DryRunRecorded', 'Sent', 'Ambiguous', 'TerminalFailure']).has(current.STATUS)) {
      return current.STATUS;
    }
    if (current.STATUS === 'Sending') return 'Sending';
    if (current.STATUS === 'RetryRequired' && Date.parse(current.NEXT_ATTEMPT_AT || '') > now()) {
      return current.STATUS;
    }
    invariant(current.STATUS === 'Pending' || current.STATUS === 'RetryRequired',
      'NOTIFICATION_STATE_CONFLICT', 'Notification cannot be claimed from its durable state.');
    let attempt = Number(current.ATTEMPT_COUNT);
    let sendToken = null;
    if (config.mailMode === 'send_development') {
      attempt += 1;
      sendToken = crypto.randomBytes(16).toString('hex');
      const claimed = await store.mutate(notificationTable, 'NOTIFICATION_KEY', notificationKey,
        'NOTIFICATION_VERSION', (candidate) => new Set(['Pending', 'RetryRequired']).has(candidate.STATUS) ? {
          STATUS: 'Sending', ATTEMPT_COUNT: attempt, LAST_ATTEMPT_AT: at,
          NEXT_ATTEMPT_AT: null, PROVIDER_CODE: 'CATALYST_MAIL_INVOKING',
          PROVIDER_RESULT_REFERENCE: null, SEND_TOKEN: sendToken,
          UPDATED_AT: at,
        } : null);
      if (claimed.SEND_TOKEN !== sendToken) return claimed.STATUS;
    }
    const result = await mailAdapter.notify(prepared);
    let status = result.status;
    let nextAttemptAt = null;
    if (status === 'RetryRequired') {
      if (attempt >= config.notificationMaxAttempts) status = 'TerminalFailure';
      else nextAttemptAt = new Date(now() + NOTIFICATION_RETRY_DELAYS_MS[Math.max(0, attempt - 1)]).toISOString();
    }
    await store.mutate(notificationTable, 'NOTIFICATION_KEY', notificationKey,
      'NOTIFICATION_VERSION', (candidate) => {
        if (sendToken && candidate.SEND_TOKEN !== sendToken) return null;
        return {
          STATUS: status, PROVIDER_CODE: result.providerCode,
          PROVIDER_RESULT_REFERENCE: result.providerResultReference,
          SEND_TOKEN: null,
          NEXT_ATTEMPT_AT: nextAttemptAt,
          LAST_ERROR_CODE: new Set(['RetryRequired', 'Ambiguous', 'TerminalFailure']).has(status)
            ? result.providerCode : null,
          UPDATED_AT: at,
        };
      });
    return status;
  }

  async function countHandledCall(callKey, deploymentId, at) {
    return store.mutate(deploymentTable, 'DEPLOYMENT_ID', deploymentId, 'COUNT_VERSION', (current) => {
      const deployment = deploymentFromRow(current, config);
      if (deployment.countedCallKeys.includes(callKey)) return null;
      const keys = [...deployment.countedCallKeys, callKey];
      const reachedNow = deployment.handledCount < deployment.callLimit
        && keys.length >= deployment.callLimit;
      return {
        COUNTED_CALL_KEYS_JSON: JSON.stringify(keys), HANDLED_COUNT: keys.length,
        ...(reachedNow ? { TEST_STATUS: 'Completed', STOP_REASON: 'call_limit_reached', STOPPED_AT: at } : {}),
        UPDATED_AT: at,
      };
    });
  }

  async function mutateClaimedReceipt(receiptKey, workerToken, patch) {
    const row = await store.mutate(receiptTable, 'EVENT_KEY', receiptKey, 'RECEIPT_VERSION', (current) => (
      current.STATUS === 'Processing' && workerToken === current.LEASE_TOKEN ? patch(current) : null
    ));
    invariant(workerToken === row.LEASE_TOKEN, 'EVENT_LEASE_LOST',
      'Event processing lease was lost.', { httpStatus: 503, retryable: true });
    return row;
  }

  async function containClaimedEventFailure(candidate, workerToken, error) {
    if (!workerToken) return null;
    const current = await store.unique(receiptTable, 'EVENT_KEY', candidate.EVENT_KEY);
    if (!current) return null;
    if (CONTAINED_EVENT_STATES.has(current.STATUS)) return current.STATUS;
    if (current.STATUS !== 'Processing' || current.LEASE_TOKEN !== workerToken) return null;
    const attempt = Number(current.ATTEMPT_COUNT);
    const code = durableErrorCode(error);
    let status = error instanceof FreeTestError && error.ambiguous
      ? 'ReconciliationRequired' : 'TerminalFailure';
    let nextAttemptAt = null;
    if (error instanceof FreeTestError && error.retryable
      && Number.isSafeInteger(attempt) && attempt <= EVENT_RETRY_DELAYS_MS.length) {
      status = 'RetryRequired';
      nextAttemptAt = new Date(now() + EVENT_RETRY_DELAYS_MS[attempt - 1]).toISOString();
    }
    const at = new Date(now()).toISOString();
    const contained = await store.mutate(receiptTable, 'EVENT_KEY', candidate.EVENT_KEY,
      'RECEIPT_VERSION', (row) => row.STATUS === 'Processing' && workerToken === row.LEASE_TOKEN ? {
        STATUS: status, LEASE_TOKEN: null, LEASE_EXPIRES_AT: null,
        NEXT_ATTEMPT_AT: nextAttemptAt, LAST_ERROR_CODE: code,
        PROCESSED_AT: status === 'RetryRequired' ? null : at,
      } : null);
    return CONTAINED_EVENT_STATES.has(contained.STATUS) ? contained.STATUS : null;
  }

  async function containNotificationFailure(candidate, error) {
    let current = await store.unique(notificationTable, 'NOTIFICATION_KEY', candidate.NOTIFICATION_KEY);
    if (!current) return null;
    if (!CONTAINED_NOTIFICATION_STATES.has(current.STATUS)
      && !new Set(['Pending', 'RetryRequired', 'Sending']).has(current.STATUS)) return null;
    const at = new Date(now()).toISOString();
    if (!CONTAINED_NOTIFICATION_STATES.has(current.STATUS)) {
      const ambiguous = current.STATUS === 'Sending'
        || (error instanceof FreeTestError && error.ambiguous);
      const status = ambiguous ? 'Ambiguous' : 'ReconciliationRequired';
      const providerCode = ambiguous
        ? 'CATALYST_MAIL_UNRESOLVED_AFTER_INVOKE' : 'NOTIFICATION_RECONCILIATION_REQUIRED';
      current = await store.mutate(notificationTable, 'NOTIFICATION_KEY', candidate.NOTIFICATION_KEY,
        'NOTIFICATION_VERSION', (row) => new Set(['Pending', 'RetryRequired', 'Sending']).has(row.STATUS) ? {
          STATUS: status, PROVIDER_CODE: providerCode, PROVIDER_RESULT_REFERENCE: null,
          SEND_TOKEN: null, NEXT_ATTEMPT_AT: null, LAST_ERROR_CODE: durableErrorCode(error),
          UPDATED_AT: at,
        } : null);
    }
    if (!CONTAINED_NOTIFICATION_STATES.has(current.STATUS)) return null;
    const call = await store.unique(callTable, 'CALL_KEY', current.CALL_KEY);
    invariant(call && call.CLIENT_ID === current.CLIENT_ID
      && call.DEPLOYMENT_ID === current.DEPLOYMENT_ID
      && call.CONFIGURATION_VERSION === current.CONFIGURATION_VERSION,
    'CALL_OWNERSHIP_UNRESOLVED', 'Notification failure cannot be correlated to its call.');
    await store.mutate(callTable, 'CALL_KEY', call.CALL_KEY, 'CALL_VERSION', (row) => (
      row.NOTIFICATION_STATE === current.STATUS ? null
        : { NOTIFICATION_STATE: current.STATUS, UPDATED_AT: at }
    ));
    return current.STATUS;
  }

  async function executeClaimedEvent(eventData, callKey, receiptKey, workerToken) {
    const at = new Date(now()).toISOString();
    try {
      const owner = await ownership(eventData, callKey);
      await mutateClaimedReceipt(receiptKey, workerToken, () => ({
        CORRELATION_ID: owner.correlationId, DEPLOYMENT_ID: owner.deployment.deploymentId,
      }));
      const analysis = eventData.analysis;
      if (analysis) invariant(triggerAllowedForMode(analysis.coverageTrigger, owner.deployment.coverageMode),
        'INVALID_ANALYSIS', 'Coverage trigger conflicts with the deployment mode.');
      await mutateClaimedReceipt(receiptKey, workerToken, () => ({
        LEASE_EXPIRES_AT: new Date(now() + 30_000).toISOString(),
      }));
      let call = await upsertCall(eventData, callKey, owner, analysis, at);
      const handledEligible = eventData.callStatus === 'ended';
      if (handledEligible) await countHandledCall(callKey, owner.deployment.deploymentId, at);
      if (analysis && handledEligible) {
        await mutateClaimedReceipt(receiptKey, workerToken, () => ({
          LEASE_EXPIRES_AT: new Date(now() + 30_000).toISOString(),
        }));
        const notificationState = await ensureNotification(call, owner.deployment, at);
        call = await store.mutate(callTable, 'CALL_KEY', callKey, 'CALL_VERSION', (current) => {
          if (current.HANDLED_RECORDED === true && current.NOTIFICATION_STATE === notificationState
            && current.PROCESSING_STATE === 'Completed') return null;
          return { HANDLED_RECORDED: handledEligible, NOTIFICATION_STATE: notificationState,
            PROCESSING_STATE: 'Completed', UPDATED_AT: at };
        });
      } else {
        call = await store.mutate(callTable, 'CALL_KEY', callKey, 'CALL_VERSION', (current) => (
          current.HANDLED_RECORDED === handledEligible
            && (!analysis || current.PROCESSING_STATE === 'Completed') ? null
            : { HANDLED_RECORDED: handledEligible,
              ...(analysis ? { PROCESSING_STATE: 'Completed' } : {}), UPDATED_AT: at }
        ));
      }
      await mutateClaimedReceipt(receiptKey, workerToken, () => ({
        STATUS: 'Completed', PROCESSED_AT: at, LEASE_EXPIRES_AT: null,
        NEXT_ATTEMPT_AT: null, LAST_ERROR_CODE: null,
      }));
      logger.info({ event: 'retell_event_completed', correlationId: owner.correlationId,
        eventType: eventData.event, state: call.PROCESSING_STATE });
      return { status: 'Completed', duplicate: false, correlationId: owner.correlationId };
    } catch (error) {
      let status = 'TerminalFailure';
      let nextAttemptAt = null;
      try {
        const durable = await store.unique(receiptTable, 'EVENT_KEY', receiptKey);
        const attempt = Number(durable?.ATTEMPT_COUNT || 1);
        if (error instanceof FreeTestError && error.ambiguous) status = 'ReconciliationRequired';
        else if (error instanceof FreeTestError && error.retryable && attempt <= EVENT_RETRY_DELAYS_MS.length) {
          status = 'RetryRequired';
          nextAttemptAt = new Date(now() + EVENT_RETRY_DELAYS_MS[attempt - 1]).toISOString();
        }
        await mutateClaimedReceipt(receiptKey, workerToken, () => ({
          STATUS: status, LEASE_EXPIRES_AT: null, NEXT_ATTEMPT_AT: nextAttemptAt,
          LAST_ERROR_CODE: error.code || 'UNEXPECTED_ERROR',
        }));
      } catch (_) { /* Original error remains authoritative. */ }
      const correlationId = publicCorrelationId(config.eventSecret, ['event-failure', receiptKey]);
      logger.error({ event: 'retell_event_failed', correlationId, eventType: eventData.event,
        state: status, errorCode: error.code || 'UNEXPECTED_ERROR' });
      throw error;
    }
  }

  async function claimExistingReceipt(receiptKey, current) {
    if (current.STATUS === 'Completed') return { terminal: { status: 'Completed', duplicate: true } };
    if (current.STATUS === 'TerminalFailure' || current.STATUS === 'ReconciliationRequired') {
      return { terminal: { status: current.STATUS, duplicate: true } };
    }
    const currentTime = now();
    const leaseExpired = current.STATUS === 'Processing'
      && Date.parse(current.LEASE_EXPIRES_AT || '') <= currentTime;
    const retryDue = current.STATUS === 'RetryRequired'
      && Date.parse(current.NEXT_ATTEMPT_AT || '') <= currentTime;
    if (!leaseExpired && !retryDue) return { terminal: { status: current.STATUS, duplicate: true } };
    const leaseExpiresAt = new Date(currentTime + 30_000).toISOString();
    const workerToken = crypto.randomBytes(16).toString('hex');
    const resumed = await store.mutate(receiptTable, 'EVENT_KEY', receiptKey, 'RECEIPT_VERSION', (row) => {
      const expired = row.STATUS === 'Processing' && Date.parse(row.LEASE_EXPIRES_AT || '') <= now();
      const due = row.STATUS === 'RetryRequired' && Date.parse(row.NEXT_ATTEMPT_AT || '') <= now();
      if (!expired && !due) return null;
      return { STATUS: 'Processing', ATTEMPT_COUNT: Number(row.ATTEMPT_COUNT) + 1,
        LEASE_TOKEN: workerToken, LEASE_EXPIRES_AT: leaseExpiresAt,
        NEXT_ATTEMPT_AT: null, LAST_ERROR_CODE: null };
    });
    if (resumed.STATUS !== 'Processing' || resumed.LEASE_TOKEN !== workerToken) {
      return { terminal: { status: resumed.STATUS, duplicate: true } };
    }
    return { row: resumed, workerToken };
  }

  async function processEvent(payload, rawBody) {
    const fingerprint = payloadFingerprint(config.eventSecret, rawBody);
    let normalized;
    try {
      normalized = normalizeEventForReceipt(payload, config);
    } catch (error) {
      const at = new Date(now()).toISOString();
      const quarantineKey = `evtq_${keyedDigest(config.eventSecret, 'free-test-quarantine-event-v1', [fingerprint])}`;
      const quarantineCallKey = `call_${keyedDigest(config.eventSecret, 'free-test-quarantine-call-v1', [fingerprint])}`;
      const eventType = typeof payload?.event === 'string' && /^[a-z_]{1,32}$/.test(payload.event)
        ? payload.event : 'invalid';
      await store.insertUnique(receiptTable, 'EVENT_KEY', {
        EVENT_KEY: quarantineKey, CALL_KEY: quarantineCallKey, PAYLOAD_FINGERPRINT: fingerprint,
        EVENT_TYPE: eventType, EVENT_DATA_JSON: '{}',
        CORRELATION_ID: publicCorrelationId(config.eventSecret, ['quarantine', fingerprint]),
        DEPLOYMENT_ID: null, STATUS: 'TerminalFailure', RECEIPT_VERSION: 1,
        ATTEMPT_COUNT: 1, LEASE_TOKEN: null,
        LEASE_EXPIRES_AT: null, NEXT_ATTEMPT_AT: null,
        LAST_ERROR_CODE: error.code || 'INVALID_EVENT', RECEIVED_AT: at, PROCESSED_AT: at,
        SOURCE_REVISION: config.sourceRevision, SOURCE_ENVIRONMENT: config.environment,
      }, RECEIPT_IMMUTABLE);
      throw error;
    }
    const { callId, eventData } = normalized;
    const callKey = callLookupKey(config.eventSecret, callId);
    const receiptKey = eventReceiptKey(config.eventSecret, eventData.event, callId);
    const at = new Date(now()).toISOString();
    const workerToken = crypto.randomBytes(16).toString('hex');
    const receipt = {
      EVENT_KEY: receiptKey, CALL_KEY: callKey, PAYLOAD_FINGERPRINT: fingerprint,
      EVENT_TYPE: eventData.event, EVENT_DATA_JSON: JSON.stringify(eventData),
      CORRELATION_ID: null, DEPLOYMENT_ID: null, STATUS: 'Processing', RECEIPT_VERSION: 1,
      ATTEMPT_COUNT: 1, LEASE_TOKEN: workerToken,
      LEASE_EXPIRES_AT: new Date(now() + 30_000).toISOString(),
      NEXT_ATTEMPT_AT: null, LAST_ERROR_CODE: null, RECEIVED_AT: at, PROCESSED_AT: null,
      SOURCE_REVISION: config.sourceRevision, SOURCE_ENVIRONMENT: config.environment,
    };
    const claimed = await store.insertUnique(receiptTable, 'EVENT_KEY', receipt, RECEIPT_IMMUTABLE);
    if (!claimed.inserted) {
      const resumed = await claimExistingReceipt(receiptKey, claimed.row);
      if (resumed.terminal) return resumed.terminal;
      return executeClaimedEvent(eventData, callKey, receiptKey, resumed.workerToken);
    }
    return executeClaimedEvent(eventData, callKey, receiptKey, workerToken);
  }

  async function retryDueEvents(limit = 25) {
    const retryRows = await store.query(receiptTable, 'STATUS', 'RetryRequired');
    const processingRows = await store.query(receiptTable, 'STATUS', 'Processing');
    const candidates = [...retryRows, ...processingRows]
      .filter((row) => (row.STATUS === 'RetryRequired'
        ? Date.parse(row.NEXT_ATTEMPT_AT || '') <= now()
        : Date.parse(row.LEASE_EXPIRES_AT || '') <= now()))
      .sort((left, right) => String(left.RECEIVED_AT).localeCompare(String(right.RECEIVED_AT)))
      .slice(0, limit);
    const results = [];
    for (const candidate of candidates) {
      let workerToken = null;
      try {
        const claimed = await claimExistingReceipt(candidate.EVENT_KEY, candidate);
        if (claimed.terminal) {
          results.push({ status: claimed.terminal.status });
          continue;
        }
        workerToken = claimed.workerToken;
        const eventData = parseJsonColumn(candidate.EVENT_DATA_JSON, 'EVENT_DATA_JSON');
        results.push(await executeClaimedEvent(eventData, candidate.CALL_KEY, candidate.EVENT_KEY,
          claimed.workerToken));
      } catch (error) {
        let containedStatus = null;
        try {
          containedStatus = await containClaimedEventFailure(candidate, workerToken, error);
        } catch (_) { /* The Job result remains Failed and is surfaced to Catalyst. */ }
        results.push({ status: containedStatus || 'Failed', errorCode: durableErrorCode(error) });
      }
    }
    return Object.freeze({ examined: candidates.length, results: Object.freeze(results) });
  }

  async function retryDueNotifications(limit = 25) {
    const staleSending = (await store.query(notificationTable, 'STATUS', 'Sending'))
      .filter((row) => Date.parse(row.LAST_ATTEMPT_AT || '') + config.mailTimeoutMs <= now())
      .slice(0, limit);
    for (const candidate of staleSending) {
      const notification = await store.mutate(notificationTable, 'NOTIFICATION_KEY', candidate.NOTIFICATION_KEY,
        'NOTIFICATION_VERSION', (current) => current.STATUS === 'Sending' ? {
          STATUS: 'Ambiguous', PROVIDER_CODE: 'CATALYST_MAIL_STALE_SENDING',
          LAST_ERROR_CODE: 'CATALYST_MAIL_STALE_SENDING', NEXT_ATTEMPT_AT: null,
          SEND_TOKEN: null,
          UPDATED_AT: new Date(now()).toISOString(),
        } : null);
      if (notification.STATUS === 'Ambiguous') {
        const call = await store.unique(callTable, 'CALL_KEY', notification.CALL_KEY);
        invariant(call && call.CLIENT_ID === notification.CLIENT_ID
          && call.DEPLOYMENT_ID === notification.DEPLOYMENT_ID
          && call.CONFIGURATION_VERSION === notification.CONFIGURATION_VERSION,
        'CALL_OWNERSHIP_UNRESOLVED', 'Ambiguous notification ownership is inconsistent.');
        await store.mutate(callTable, 'CALL_KEY', call.CALL_KEY, 'CALL_VERSION', (current) => (
          current.NOTIFICATION_STATE === 'Ambiguous' ? null
            : { NOTIFICATION_STATE: 'Ambiguous', UPDATED_AT: new Date(now()).toISOString() }
        ));
      }
    }
    const retryRows = await store.query(notificationTable, 'STATUS', 'RetryRequired');
    const pendingRows = await store.query(notificationTable, 'STATUS', 'Pending');
    const due = [...pendingRows, ...retryRows]
      .filter((row) => !row.NEXT_ATTEMPT_AT || Date.parse(row.NEXT_ATTEMPT_AT) <= now())
      .slice(0, limit);
    const results = [];
    for (const candidate of due) {
      try {
        const call = await store.unique(callTable, 'CALL_KEY', candidate.CALL_KEY);
        const deploymentRow = await store.unique(deploymentTable, 'DEPLOYMENT_ID', candidate.DEPLOYMENT_ID);
        const deployment = deploymentFromRow(deploymentRow, config);
        invariant(call && call.CLIENT_ID === deployment.clientId
          && call.CONFIGURATION_VERSION === deployment.configurationVersion,
        'CALL_OWNERSHIP_UNRESOLVED', 'Notification retry ownership is inconsistent.');
        const status = await ensureNotification(call, deployment, new Date(now()).toISOString());
        await store.mutate(callTable, 'CALL_KEY', call.CALL_KEY, 'CALL_VERSION', (current) => (
          current.NOTIFICATION_STATE === status ? null : {
            NOTIFICATION_STATE: status, UPDATED_AT: new Date(now()).toISOString(),
          }
        ));
        results.push({ status });
      } catch (error) {
        let containedStatus = null;
        try {
          containedStatus = await containNotificationFailure(candidate, error);
        } catch (_) { /* The Job result remains Failed and is surfaced to Catalyst. */ }
        results.push({ status: containedStatus || 'Failed', errorCode: durableErrorCode(error) });
      }
    }
    const ambiguous = (await store.query(notificationTable, 'STATUS', 'Ambiguous')).length;
    const reconciliation = (await store.query(notificationTable, 'STATUS', 'ReconciliationRequired')).length;
    return Object.freeze({ examined: due.length, staleSending: staleSending.length,
      reconciliationRequired: ambiguous + reconciliation, results: Object.freeze(results) });
  }

  async function runRetryJob(limit = 25) {
    invariant(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100,
      'INVALID_RETRY_LIMIT', 'Retry job limit is invalid.');
    return Object.freeze({
      events: await retryDueEvents(limit),
      notifications: await retryDueNotifications(limit),
    });
  }

  return Object.freeze({ resolveInbound, processEvent, retryDueEvents,
    retryDueNotifications, runRetryJob, readiness: () => store.readiness() });
}

module.exports = {
  createRuntimeService, deploymentFromRow, activeAt, resolverMetadata, unavailable,
  normalizeEventForReceipt, assertCanonicalCallIntegrity,
};
