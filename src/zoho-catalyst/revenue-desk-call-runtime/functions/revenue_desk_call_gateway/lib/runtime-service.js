'use strict';

const crypto = require('node:crypto');
const {
  CONTRACT, COVERAGE_MODES, NOTIFICATION_STATES, CRM_TEST_STATUSES,
} = require('./contracts');
const { validateConfigurationVersionRow } = require('./configuration-version');
const { RevenueDeskError, invariant } = require('./errors');
const {
  validateInboundPayload, validateEventEnvelope, validateConfiguration, e164, isPlainObject,
  MAX_RETELL_CALL_DURATION_MS,
} = require('./validation');
const {
  numberLookupKey, eventReceiptKey, callLookupKey, payloadFingerprint,
  publicCorrelationId, keyedDigest,
} = require('./security');
const { extractAnalysis, triggerAllowedForMode, makeNotificationPayload } = require('./analysis');
const { MAX_CATALYST_TEXT_BYTES } = require('./catalyst-store');
const {
  OUTBOX_IMMUTABLE, callFact, createOutboxRow, deploymentFact, finalTestResultFact,
  ensureOutboxRow,
} = require('./analytics-outbox');
const {
  buildCrmReportSummary, ensureCrmReportSummary, reportSummaryIdentity,
} = require('./crm-report-outbox');
const { routeFingerprint, routeFromRows } = require('./approval-control');

const RECEIPT_IMMUTABLE = Object.freeze([
  'EVENT_KEY', 'RECEIPT_KIND', 'CALL_KEY', 'PAYLOAD_FINGERPRINT',
  'EVENT_TYPE', 'EVENT_DATA_JSON',
]);
const CALL_IMMUTABLE = Object.freeze([
  'CALL_KEY', 'CORRELATION_ID', 'CLIENT_ID', 'DEPLOYMENT_ID',
  'CONFIGURATION_VERSION_ID', 'CONFIGURATION_VERSION', 'ENGAGEMENT_TYPE', 'CAPABILITY_PROFILE',
  'BINDING_ID', 'BINDING_VERSION',
]);
const NOTIFICATION_IMMUTABLE = Object.freeze([
  'NOTIFICATION_KEY', 'CALL_KEY', 'CORRELATION_ID', 'CLIENT_ID', 'DEPLOYMENT_ID',
  'CONFIGURATION_VERSION_ID', 'CONFIGURATION_VERSION', 'ENGAGEMENT_TYPE', 'CAPABILITY_PROFILE',
  'RECIPIENT_FINGERPRINT', 'TEMPLATE_VERSION', 'PAYLOAD_JSON',
]);
const EVENT_RETRY_DELAYS_MS = Object.freeze([1000, 5000]);
const NOTIFICATION_RETRY_DELAYS_MS = Object.freeze([1000, 5000]);
const READINESS_DEPLOYMENT_LIMIT = 100;
const TERMINAL_RECONCILIATION_STATES = Object.freeze([
  'Pending', 'AwaitingSettlement', 'Completed',
]);
const REPORT_DISPATCH_STATES = Object.freeze([
  'processing', 'reconciliation_required', 'pending',
]);
const CONTAINED_EVENT_STATES = new Set([
  'Completed', 'RetryRequired', 'TerminalFailure', 'ReconciliationRequired',
]);
const CONTAINED_NOTIFICATION_STATES = new Set([
  'DryRunRecorded', 'Sent', 'Ambiguous', 'ReconciliationRequired', 'TerminalFailure',
]);
const RETRYABLE_NOTIFICATION_STATES = new Set(['Pending', 'RetryRequired']);
const NOTIFICATION_FAILURE_RESULT_STATES = new Set([
  ...CONTAINED_NOTIFICATION_STATES, 'RetryRequired',
]);
const OWNERSHIP_METADATA_FIELDS = Object.freeze([
  'resolver_status', 'client_id', 'deployment_id', 'configuration_version_id',
  'configuration_version', 'engagement_type',
  'capability_profile', 'coverage_mode', 'number_binding_id', 'number_binding_version',
  'correlation_id', 'resolved_at', 'ownership_token',
]);
const AUTHORIZATION_EVENT_DATA_FIELDS = Object.freeze([
  'schemaVersion', 'action', 'decision', 'configurationVersionId', 'routeFingerprint',
  'operatorIdHash', 'intentFingerprint', 'evidenceRevision', 'evidenceObservedAt',
  'expectedDeploymentVersion',
  'capacityRemainingAtDecision', 'previousEventHash', 'eventHash', 'decidedAt',
  'approvalEventKey', 'routeReadbackFingerprint', 'routeObservedAt', 'actualStartAt',
  'expiresAt',
]);
const APPROVAL_EVENT_PATTERN = /^approval_[a-f0-9]{64}$/;
const ACTIVATION_EVENT_PATTERN = /^activation_[a-f0-9]{64}$/;
const ROUTE_FINGERPRINT_PATTERN = /^route_[a-f0-9]{64}$/;
const ROUTE_READBACK_PATTERN = /^readback_[a-f0-9]{64}$/;
const OPERATOR_HASH_PATTERN = /^operator_[a-f0-9]{64}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ACTIVATION_READBACK_MAX_AGE_MS = 900_000;

function canonicalTimestamp(value, name) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  invariant(Number.isFinite(parsed) && new Date(parsed).toISOString() === value,
    'CONFIGURATION_UNAVAILABLE', `${name} is invalid.`);
  return value;
}

function optionalTimestamp(value, name) {
  return value === null || value === undefined ? null : canonicalTimestamp(value, name);
}

function nextMutationTimestamp(previous, candidate) {
  const previousMs = Date.parse(previous);
  const candidateMs = Date.parse(candidate);
  invariant(Number.isFinite(previousMs) && Number.isFinite(candidateMs),
    'CONFIGURATION_UNAVAILABLE', 'Deployment mutation timestamp is invalid.');
  // Catalyst mutations can share a millisecond. The Analytics provider-version fence uses this
  // watermark, so advance it monotonically whenever the deployment fact changes.
  return new Date(Math.max(candidateMs, previousMs + 1)).toISOString();
}

function nullableString(value, pattern, name) {
  if (value === null || value === undefined) return null;
  invariant(typeof value === 'string' && pattern.test(value),
    'CONFIGURATION_UNAVAILABLE', `${name} is invalid.`);
  return value;
}

function exactFields(value, fields, name) {
  invariant(isPlainObject(value), 'CONFIGURATION_UNAVAILABLE', `${name} is invalid.`);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  invariant(actual.length === expected.length
    && actual.every((field, index) => field === expected[index]),
  'CONFIGURATION_UNAVAILABLE', `${name} has invalid fields.`);
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

function scanTimestamp(row, column, offsetMs = 0) {
  const parsed = Date.parse(row?.[column]);
  return Number.isFinite(parsed) ? parsed + offsetMs : Number.NEGATIVE_INFINITY;
}

function scanOrderValue(row, lane) {
  return scanTimestamp(row, lane.orderColumn, lane.offsetMs || 0);
}

function compareRowIds(left, right) {
  const leftId = String(left?.ROWID ?? '');
  const rightId = String(right?.ROWID ?? '');
  return leftId.length - rightId.length || leftId.localeCompare(rightId);
}

// Provider queries establish bounded per-lane order. Round-based reservation prevents
// one busy status from monopolizing the scan; final sorting keeps selected work in due order.
function fairBoundedCandidates(lanes, limit) {
  invariant(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100,
    'INVALID_RETRY_LIMIT', 'Retry job limit is invalid.');
  const queues = lanes.map((lane) => ({
    ...lane,
    rows: [...lane.rows].sort((left, right) => scanOrderValue(left, lane)
      - scanOrderValue(right, lane) || compareRowIds(left, right)),
  }));
  const selected = [];
  while (selected.length < limit) {
    const available = queues.filter((lane) => lane.rows.length > 0)
      .sort((left, right) => (
        scanOrderValue(left.rows[0], left) - scanOrderValue(right.rows[0], right)
        || compareRowIds(left.rows[0], right.rows[0])
        || left.name.localeCompare(right.name)
      ));
    if (available.length === 0) break;
    for (const lane of available) {
      if (selected.length >= limit) break;
      const row = lane.rows.shift();
      selected.push({
        row,
        orderValue: scanOrderValue(row, lane),
      });
    }
  }
  return selected.sort((left, right) => left.orderValue - right.orderValue
    || compareRowIds(left.row, right.row)).map(({ row }) => row);
}

function dueOrInvalid(row, column, dueAt, offsetMs = 0) {
  const parsed = Date.parse(row?.[column]);
  return !Number.isFinite(parsed) || parsed + offsetMs <= dueAt;
}

function assertScanTimestamp(row, column) {
  invariant(Number.isFinite(Date.parse(row?.[column])),
    'DURABLE_ROW_INVALID', `${column} is invalid.`);
}

function nextScanCursorTimestamp(previous, candidate) {
  const previousMs = Date.parse(previous);
  const candidateMs = Date.parse(candidate);
  invariant(Number.isFinite(candidateMs),
    'CONFIGURATION_UNAVAILABLE', 'Scan cursor timestamp is invalid.');
  return new Date(Number.isFinite(previousMs)
    ? Math.max(candidateMs, previousMs + 1) : candidateMs).toISOString();
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
    if (error instanceof RevenueDeskError) throw error;
    throw new RevenueDeskError('CONFIGURATION_UNAVAILABLE', `${name} is invalid.`, { cause: error });
  }
}

function deploymentFromRow(row, configurationRow, config) {
  invariant(isPlainObject(row), 'CONFIGURATION_UNAVAILABLE', 'Deployment row is unavailable.');
  const version = validateConfigurationVersionRow(configurationRow, {
    expectedDeploymentId: row.DEPLOYMENT_ID,
    expectedEnvironment: config.environment,
    expectedSourceRevision: config.sourceRevision,
  });
  const configuration = validateConfiguration(
    parseJsonColumn(version.configurationJson, 'CONFIGURATION_JSON'),
  );
  const approvedStartAt = canonicalTimestamp(row.APPROVED_START_AT, 'APPROVED_START_AT');
  const actualStartAt = optionalTimestamp(row.ACTUAL_START_AT, 'ACTUAL_START_AT');
  const expiresAt = optionalTimestamp(row.EXPIRES_AT, 'EXPIRES_AT');
  const approvedConfigurationVersionId = nullableString(
    row.APPROVED_CONFIGURATION_VERSION_ID, /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/,
    'APPROVED_CONFIGURATION_VERSION_ID',
  );
  const approvalEventKey = nullableString(
    row.APPROVAL_EVENT_KEY, APPROVAL_EVENT_PATTERN, 'APPROVAL_EVENT_KEY',
  );
  const approvedRouteFingerprint = nullableString(
    row.APPROVED_ROUTE_FINGERPRINT, ROUTE_FINGERPRINT_PATTERN, 'APPROVED_ROUTE_FINGERPRINT',
  );
  const goLiveApprovedAt = optionalTimestamp(row.GO_LIVE_APPROVED_AT, 'GO_LIVE_APPROVED_AT');
  const activationEventKey = nullableString(
    row.ACTIVATION_EVENT_KEY, ACTIVATION_EVENT_PATTERN, 'ACTIVATION_EVENT_KEY',
  );
  const handledCount = integerColumn(row.HANDLED_COUNT, 'HANDLED_COUNT');
  const callLimit = integerColumn(row.CALL_LIMIT, 'CALL_LIMIT', 1);
  const stopReason = row.STOP_REASON === null || row.STOP_REASON === undefined
    ? null : row.STOP_REASON;
  const stoppedAt = row.STOPPED_AT === null || row.STOPPED_AT === undefined
    ? null : canonicalTimestamp(row.STOPPED_AT, 'STOPPED_AT');
  const countedCallKeys = parseJsonColumn(row.COUNTED_CALL_KEYS_JSON, 'COUNTED_CALL_KEYS_JSON');
  const reportReconciliationStatus = row.REPORT_RECONCILIATION_STATUS;
  const reportReconciliationVersion = integerColumn(
    row.REPORT_RECONCILIATION_VERSION, 'REPORT_RECONCILIATION_VERSION',
  );
  invariant(new Set(['NotRequired', 'Pending', 'AwaitingSettlement', 'Completed'])
    .has(reportReconciliationStatus),
  'CONFIGURATION_UNAVAILABLE', 'Deployment report reconciliation state is invalid.');
  invariant(CRM_TEST_STATUSES.has(row.TEST_STATUS)
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(String(row.DEPLOYMENT_ID ?? ''))
    && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(
      String(version.configurationVersion ?? ''),
    ),
  'CONFIGURATION_UNAVAILABLE', 'Deployment CRM report identity is invalid.');
  invariant(Array.isArray(countedCallKeys) && countedCallKeys.every((key) => /^call_[a-f0-9]{64}$/.test(key))
    && new Set(countedCallKeys).size === countedCallKeys.length
    && countedCallKeys.length === handledCount,
  'CONFIGURATION_UNAVAILABLE', 'Handled-call convergence state is inconsistent.');
  invariant(row.SOURCE_ENVIRONMENT === config.environment
    && version.environment === config.environment,
  'CONFIGURATION_UNAVAILABLE', 'Deployment environment binding is invalid.');
  invariant(row.SOURCE_REVISION === config.sourceRevision
    && version.sourceRevision === config.sourceRevision,
  'CONFIGURATION_UNAVAILABLE', 'Deployment source revision does not match this runtime.');
  invariant(typeof row.ACTIVE_CONFIGURATION_VERSION_ID === 'string'
    && row.ACTIVE_CONFIGURATION_VERSION_ID === version.configurationVersionId
    && version.deploymentId === row.DEPLOYMENT_ID
    && configurationRow.STATUS === 'Active'
    && configurationRow.APPROVAL_STATUS === 'Approved',
  'CONFIGURATION_UNAVAILABLE', 'Active configuration-version reference is invalid.');
  const capability = version.profile;
  invariant(capability
    && capability.engagement_type === version.engagementType
    && capability.enabled === true
    && capability.status === 'active'
    && capability.traffic_environments.includes(config.environment),
  'CONFIGURATION_UNAVAILABLE', 'Capability profile is disabled or unavailable.');
  invariant(version.deploymentStatus === CONTRACT.active_test_status
    && version.goLiveApprovalStatus === CONTRACT.approved_go_live_status,
  'CONFIGURATION_UNAVAILABLE', 'Configuration version is not approved for live routing.');
  const completedFreeTest = version.engagementType === 'free_test'
    && row.TEST_STATUS === 'Completed';
  invariant(completedFreeTest
    ? new Set(['Pending', 'AwaitingSettlement', 'Completed']).has(reportReconciliationStatus)
      && reportReconciliationVersion >= 1
    : reportReconciliationStatus === 'NotRequired',
  'CONFIGURATION_UNAVAILABLE', 'Deployment and report reconciliation states conflict.');
  invariant(COVERAGE_MODES.has(row.COVERAGE_MODE) && row.MONITOR_AGENT_ID === config.sharedAgentId
    && integerColumn(row.MONITOR_AGENT_VERSION, 'MONITOR_AGENT_VERSION') === config.sharedAgentVersion,
  'CONFIGURATION_UNAVAILABLE', 'Shared agent or coverage binding is invalid.');
  const approvalReferences = [
    approvedConfigurationVersionId, approvalEventKey, approvedRouteFingerprint, goLiveApprovedAt,
  ];
  const activationReferences = [activationEventKey, actualStartAt, expiresAt];
  const hasApproval = approvalReferences.every((value) => value !== null);
  const hasActivation = activationReferences.every((value) => value !== null);
  invariant(approvalReferences.every((value) => value === null) || hasApproval,
    'CONFIGURATION_UNAVAILABLE', 'Approval references are incomplete.');
  invariant(activationReferences.every((value) => value === null) || hasActivation,
    'CONFIGURATION_UNAVAILABLE', 'Activation references are incomplete.');
  invariant(!hasActivation || hasApproval,
    'CONFIGURATION_UNAVAILABLE', 'Activation is missing its approval binding.');
  invariant(callLimit === CONTRACT.handled_call_limit,
    'CONFIGURATION_UNAVAILABLE', 'Handled-call limit is invalid.');
  if (hasApproval) {
    const currentRouteFingerprint = routeFingerprint(routeFromRows(row, configurationRow));
    invariant(approvedConfigurationVersionId === row.ACTIVE_CONFIGURATION_VERSION_ID
      && approvedRouteFingerprint === currentRouteFingerprint,
    'CONFIGURATION_UNAVAILABLE',
    'Approval is stale because the governed configuration or route changed.');
  }
  if (hasActivation) {
    invariant(Date.parse(actualStartAt) >= Date.parse(goLiveApprovedAt)
      && Date.parse(expiresAt) - Date.parse(actualStartAt)
        === CONTRACT.test_duration_days * 86_400_000,
    'CONFIGURATION_UNAVAILABLE', 'Activated test timing is invalid.');
  }
  invariant(row.TEST_STATUS !== 'Scheduled' || (row.GO_LIVE_APPROVAL_STATUS === 'Approved'
      && hasApproval && !hasActivation),
  'CONFIGURATION_UNAVAILABLE', 'Scheduled deployment approval state is invalid.');
  invariant(row.TEST_STATUS !== CONTRACT.active_test_status
      || (row.GO_LIVE_APPROVAL_STATUS === CONTRACT.approved_go_live_status
        && hasApproval && hasActivation),
  'CONFIGURATION_UNAVAILABLE', 'Live deployment activation state is invalid.');
  invariant(row.GO_LIVE_APPROVAL_STATUS !== CONTRACT.approved_go_live_status || hasApproval,
    'CONFIGURATION_UNAVAILABLE', 'Approved deployment is missing authorization evidence.');
  invariant(configuration.approved && configuration.notificationRecipient.approved
    && configuration.notificationRecipient.channel === 'email'
    && configuration.clientId === row.CLIENT_ID
    && configuration.deploymentId === row.DEPLOYMENT_ID
    && configuration.configurationVersion === version.configurationVersion
    && configuration.coverageMode === row.COVERAGE_MODE,
  'CONFIGURATION_UNAVAILABLE', 'Embedded configuration ownership is invalid.');
  invariant(/^[1-9][0-9]{7,29}$/.test(configuration.crmDealId),
    'CONFIGURATION_UNAVAILABLE', 'Deployment CRM Deal binding is invalid.');
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
    crmDealId: configuration.crmDealId,
    deploymentId: row.DEPLOYMENT_ID,
    configurationVersionId: version.configurationVersionId,
    configurationVersion: version.configurationVersion,
    engagementType: version.engagementType,
    capabilityProfile: version.capabilityProfile,
    planTier: version.planTier,
    configuredDeploymentStatus: version.deploymentStatus,
    configuredGoLiveApprovalStatus: version.goLiveApprovalStatus,
    limitPolicy: version.limitPolicy,
    billingMode: version.billingMode,
    numberOwnership: version.numberOwnership,
    environment: version.environment,
    bindingId: row.BINDING_ID,
    bindingVersion: integerColumn(row.BINDING_VERSION, 'BINDING_VERSION', 1),
    numberLookupHash: row.NUMBER_LOOKUP_HASH,
    coverageMode: row.COVERAGE_MODE,
    approvedStartAt,
    approvedConfigurationVersionId,
    approvalEventKey,
    approvedRouteFingerprint,
    goLiveApprovedAt,
    activationEventKey,
    actualStartAt,
    expiresAt,
    callLimit,
    handledCount,
    countedCallKeys,
    countVersion: integerColumn(row.COUNT_VERSION, 'COUNT_VERSION'),
    reportReconciliationStatus,
    reportReconciliationVersion,
    testStatus: row.TEST_STATUS,
    approvalStatus: row.GO_LIVE_APPROVAL_STATUS,
    approvalEvidenceValidated: false,
    activationEvidenceValidated: false,
    stopReason,
    stoppedAt,
  });
}

function authorizationReceiptData(receipt, deployment, config, kind) {
  invariant(isPlainObject(receipt), 'CONFIGURATION_UNAVAILABLE',
    `${kind} authorization receipt is unavailable.`);
  invariant(receipt.RECEIPT_KIND === 'authorization_event'
    && receipt.STATUS === 'Completed'
    && integerColumn(receipt.RECEIPT_VERSION, 'RECEIPT_VERSION', 1) === 1
    && integerColumn(receipt.ATTEMPT_COUNT, 'ATTEMPT_COUNT') === 0
    && (receipt.CALL_KEY === null || receipt.CALL_KEY === undefined)
    && (receipt.CORRELATION_ID === null || receipt.CORRELATION_ID === undefined)
    && receipt.DEPLOYMENT_ID === deployment.deploymentId
    && receipt.CONFIGURATION_VERSION_ID === deployment.configurationVersionId
    && receipt.ROUTE_FINGERPRINT === deployment.approvedRouteFingerprint
    && receipt.SOURCE_REVISION === config.sourceRevision
    && receipt.SOURCE_ENVIRONMENT === config.environment
    && HASH_PATTERN.test(receipt.PAYLOAD_FINGERPRINT || ''),
  'CONFIGURATION_UNAVAILABLE', `${kind} authorization receipt binding is invalid.`);
  const data = parseJsonColumn(receipt.EVENT_DATA_JSON, `${kind} EVENT_DATA_JSON`);
  exactFields(data, AUTHORIZATION_EVENT_DATA_FIELDS, `${kind} authorization event`);
  const expectedReceiptFingerprint = crypto.createHash('sha256')
    .update('revenue-desk-authorization-receipt-v1\0', 'utf8')
    .update(receipt.EVENT_DATA_JSON, 'utf8').digest('hex');
  invariant(data.schemaVersion === 1
    && data.configurationVersionId === deployment.configurationVersionId
    && data.routeFingerprint === deployment.approvedRouteFingerprint
    && OPERATOR_HASH_PATTERN.test(data.operatorIdHash || '')
    && HASH_PATTERN.test(data.intentFingerprint || '')
    && receipt.PAYLOAD_FINGERPRINT === expectedReceiptFingerprint
    && data.evidenceRevision === config.sourceRevision
    && Number.isSafeInteger(data.expectedDeploymentVersion)
    && data.expectedDeploymentVersion >= 0
    && (data.previousEventHash === 'genesis' || HASH_PATTERN.test(data.previousEventHash || ''))
    && HASH_PATTERN.test(data.eventHash || ''),
  'CONFIGURATION_UNAVAILABLE', `${kind} authorization event binding is invalid.`);
  canonicalTimestamp(data.evidenceObservedAt, `${kind} evidenceObservedAt`);
  canonicalTimestamp(data.decidedAt, `${kind} decidedAt`);
  invariant(receipt.RECEIVED_AT === data.decidedAt && receipt.PROCESSED_AT === data.decidedAt,
    'CONFIGURATION_UNAVAILABLE', `${kind} authorization receipt timestamps are inconsistent.`);
  return data;
}

function validateAuthorizationEvidence(deployment, approvalReceipt, activationReceipt, config) {
  let approvalData = null;
  let activationData = null;
  if (deployment.approvalEventKey !== null) {
    approvalData = authorizationReceiptData(approvalReceipt, deployment, config, 'Approval');
    invariant(APPROVAL_EVENT_PATTERN.test(approvalReceipt.EVENT_KEY || '')
      && approvalReceipt.EVENT_KEY === deployment.approvalEventKey
      && approvalReceipt.EVENT_TYPE === 'approve'
      && (approvalReceipt.RELATED_EVENT_KEY === null
        || approvalReceipt.RELATED_EVENT_KEY === undefined)
      && approvalData.action === 'approve'
      && approvalData.decision === 'Approved'
      && approvalData.decidedAt === deployment.goLiveApprovedAt
      && Number.isSafeInteger(approvalData.capacityRemainingAtDecision)
      && approvalData.capacityRemainingAtDecision >= 1
      && approvalData.approvalEventKey === null
      && (approvalReceipt.ROUTE_READBACK_FINGERPRINT === null
        || approvalReceipt.ROUTE_READBACK_FINGERPRINT === undefined)
      && approvalData.routeReadbackFingerprint === null
      && approvalData.routeObservedAt === null
      && approvalData.actualStartAt === null
      && approvalData.expiresAt === null,
    'CONFIGURATION_UNAVAILABLE', 'Approval receipt is not the referenced approval decision.');
  } else {
    invariant(approvalReceipt === null, 'CONFIGURATION_UNAVAILABLE',
      'Unreferenced approval evidence is invalid.');
  }

  if (deployment.activationEventKey !== null) {
    activationData = authorizationReceiptData(activationReceipt, deployment, config, 'Activation');
    invariant(approvalData !== null
      && ACTIVATION_EVENT_PATTERN.test(activationReceipt.EVENT_KEY || '')
      && activationReceipt.EVENT_KEY === deployment.activationEventKey
      && activationReceipt.EVENT_TYPE === 'activate'
      && activationReceipt.RELATED_EVENT_KEY === deployment.approvalEventKey
      && activationReceipt.ROUTE_READBACK_FINGERPRINT
        === activationData.routeReadbackFingerprint
      && activationData.action === 'activate'
      && activationData.decision === 'Activated'
      && activationData.approvalEventKey === deployment.approvalEventKey
      && activationData.previousEventHash === approvalData.eventHash
      && activationData.capacityRemainingAtDecision === null
      && ROUTE_READBACK_PATTERN.test(activationData.routeReadbackFingerprint || '')
      && activationData.evidenceObservedAt === activationData.routeObservedAt
      && activationData.decidedAt === deployment.actualStartAt
      && activationData.actualStartAt === deployment.actualStartAt
      && activationData.expiresAt === deployment.expiresAt,
    'CONFIGURATION_UNAVAILABLE', 'Activation receipt is not bound to the approved route.');
    const routeObservedAt = Date.parse(canonicalTimestamp(
      activationData.routeObservedAt, 'Activation routeObservedAt',
    ));
    const activatedAt = Date.parse(deployment.actualStartAt);
    invariant(routeObservedAt <= activatedAt
      && activatedAt - routeObservedAt <= ACTIVATION_READBACK_MAX_AGE_MS,
    'CONFIGURATION_UNAVAILABLE',
    'Activation did not follow a fresh authoritative route readback.');
  } else {
    invariant(activationReceipt === null, 'CONFIGURATION_UNAVAILABLE',
      'Unreferenced activation evidence is invalid.');
  }

  return Object.freeze({
    ...deployment,
    approvalEvidenceValidated: approvalData !== null,
    activationEvidenceValidated: activationData !== null,
  });
}

async function loadDeployment(store, row, config) {
  invariant(isPlainObject(row), 'CONFIGURATION_UNAVAILABLE', 'Deployment row is unavailable.');
  const configurationRow = await store.unique(
    config.tables.CONFIGURATION_VERSION_TABLE,
    'CONFIGURATION_VERSION_ID',
    row.ACTIVE_CONFIGURATION_VERSION_ID,
  );
  const deployment = deploymentFromRow(row, configurationRow, config);
  const approvalReceipt = deployment.approvalEventKey === null ? null : await store.unique(
    config.tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', deployment.approvalEventKey,
  );
  const activationReceipt = deployment.activationEventKey === null ? null : await store.unique(
    config.tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', deployment.activationEventKey,
  );
  return validateAuthorizationEvidence(
    deployment, approvalReceipt, activationReceipt, config,
  );
}

function activeAt(deployment, timestampMs) {
  invariant(deployment.testStatus === CONTRACT.active_test_status
    && deployment.approvalStatus === CONTRACT.approved_go_live_status
    && deployment.approvalEvidenceValidated === true
    && deployment.activationEvidenceValidated === true
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
  return keyedDigest(config.eventSecret, 'revenue-desk-runtime-binding-v1', fields);
}

function resolverMetadata(config, deployment, correlationId, resolvedAt) {
  const values = [
    deployment.clientId, deployment.deploymentId, deployment.configurationVersionId,
    deployment.configurationVersion, deployment.engagementType, deployment.capabilityProfile,
    deployment.bindingId, deployment.bindingVersion, deployment.numberLookupHash,
    correlationId, resolvedAt,
  ];
  return Object.freeze({
    resolver_status: CONTRACT.resolved_status,
    client_id: deployment.clientId,
    deployment_id: deployment.deploymentId,
    configuration_version_id: deployment.configurationVersionId,
    configuration_version: deployment.configurationVersion,
    engagement_type: deployment.engagementType,
    capability_profile: deployment.capabilityProfile,
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
    'client_id', 'deployment_id', 'configuration_version_id', 'configuration_version',
    'coverage_mode', 'number_binding_id',
    'number_binding_version', 'correlation_id', 'resolved_at', 'ownership_token',
    'engagement_type', 'capability_profile',
  ];
  invariant(metadata.resolver_status === CONTRACT.resolved_status
    && required.every((name) => typeof metadata[name] === 'string' && metadata[name].length > 0),
  'CALL_OWNERSHIP_UNRESOLVED', 'Ownership metadata failed the exact gate.');
  const bindingVersion = integerColumn(metadata.number_binding_version, 'number_binding_version', 1);
  canonicalTimestamp(metadata.resolved_at, 'resolved_at');
  return Object.freeze({ ...metadata, bindingVersion });
}

function validateMetadataBinding(metadata, deployment, config) {
  invariant(metadata.client_id === deployment.clientId
    && metadata.deployment_id === deployment.deploymentId
    && metadata.configuration_version_id === deployment.configurationVersionId
    && metadata.configuration_version === deployment.configurationVersion
    && metadata.engagement_type === deployment.engagementType
    && metadata.capability_profile === deployment.capabilityProfile
    && metadata.coverage_mode === deployment.coverageMode
    && metadata.number_binding_id === deployment.bindingId
    && metadata.bindingVersion === deployment.bindingVersion,
  'CALL_OWNERSHIP_UNRESOLVED', 'Ownership metadata conflicts with the deployment.');
  const expected = metadataToken(config, [
    deployment.clientId, deployment.deploymentId, deployment.configurationVersionId,
    deployment.configurationVersion, deployment.engagementType, deployment.capabilityProfile,
    deployment.bindingId, deployment.bindingVersion, deployment.numberLookupHash,
    metadata.correlation_id, metadata.resolved_at,
  ]);
  invariant(expected === metadata.ownership_token,
    'CALL_OWNERSHIP_UNRESOLVED', 'Ownership token is invalid.');
}

function canonicalCallObject(envelope, deployment, callKey, correlationId, analysis = null) {
  const existing = analysis || {};
  return Object.freeze({
    schemaVersion: 2,
    callKey,
    correlationId,
    clientId: deployment.clientId,
    deploymentId: deployment.deploymentId,
    configurationVersionId: deployment.configurationVersionId,
    configurationVersion: deployment.configurationVersion,
    engagementType: deployment.engagementType,
    capabilityProfile: deployment.capabilityProfile,
    coverageMode: deployment.coverageMode,
    bindingId: deployment.bindingId,
    bindingVersion: deployment.bindingVersion,
    numberLookupHash: deployment.numberLookupHash,
    startedAt: new Date(envelope.startTimestamp).toISOString(),
    endedAt: envelope.endTimestamp === null ? null : new Date(envelope.endTimestamp).toISOString(),
    durationMs: envelope.durationMs,
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
    bookableOpportunity: existing.bookableOpportunity ?? null,
    officeFollowUpRequired: existing.officeFollowUpRequired ?? null,
    workflowFailureCode: existing.workflowFailureCode ?? null,
    workflowFailureText: existing.workflowFailureText ?? null,
    value: existing.value || { evidenceClass: 'unknown', valueMinorUnits: null, currency: null,
      methodId: null, methodVersion: null, source: 'retell' },
    sensitiveDataMinimized: existing.sensitiveDataMinimized === true,
  });
}

function assertCanonicalCallIntegrity(row, canonical, deployment = null,
  errorCode = 'CALL_OWNERSHIP_UNRESOLVED') {
  const bindingVersion = Number(row?.BINDING_VERSION);
  const supportedSchema = canonical?.schemaVersion === 1 || canonical?.schemaVersion === 2;
  const durationValid = canonical?.schemaVersion === 1
    || (Number.isSafeInteger(canonical?.durationMs)
      && canonical.durationMs >= 0 && canonical.durationMs <= MAX_RETELL_CALL_DURATION_MS);
  invariant(isPlainObject(row) && isPlainObject(canonical)
    && supportedSchema
    && canonical.callKey === row.CALL_KEY
    && canonical.correlationId === row.CORRELATION_ID
    && canonical.clientId === row.CLIENT_ID
    && canonical.deploymentId === row.DEPLOYMENT_ID
    && canonical.configurationVersionId === row.CONFIGURATION_VERSION_ID
    && canonical.configurationVersion === row.CONFIGURATION_VERSION
    && canonical.engagementType === row.ENGAGEMENT_TYPE
    && canonical.capabilityProfile === row.CAPABILITY_PROFILE
    && canonical.bindingId === row.BINDING_ID
    && Number.isSafeInteger(bindingVersion)
    && canonical.bindingVersion === bindingVersion
    && durationValid,
  errorCode, 'Canonical call content conflicts with its durable tenant binding.');
  if (deployment) invariant(row.CLIENT_ID === deployment.clientId
    && row.DEPLOYMENT_ID === deployment.deploymentId
    && row.CONFIGURATION_VERSION_ID === deployment.configurationVersionId
    && row.CONFIGURATION_VERSION === deployment.configurationVersion
    && row.ENGAGEMENT_TYPE === deployment.engagementType
    && row.CAPABILITY_PROFILE === deployment.capabilityProfile
    && (canonical.schemaVersion === 1 || canonical.coverageMode === deployment.coverageMode)
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
    durationMs: envelope.durationMs,
    callStatus: envelope.callStatus,
    disconnectionReason: envelope.disconnectionReason,
    metadata,
    analysis,
  });
  invariant(Buffer.byteLength(JSON.stringify(eventData), 'utf8') <= MAX_CATALYST_TEXT_BYTES,
    'INVALID_SCHEMA', 'Minimized event exceeds the durable bound.');
  return Object.freeze({ callId: envelope.callId, eventData });
}

function boundedPendingDeployments(rows, limit) {
  return rows.filter((row) => row.REPORT_RECONCILIATION_STATUS === 'Pending')
    .sort((left, right) => String(left.STOPPED_AT).localeCompare(String(right.STOPPED_AT)))
    .slice(0, limit);
}

function createRuntimeService({
  store,
  mailAdapter,
  crmSummaryDispatcher = null,
  jobAdapter = null,
  config,
  now = Date.now,
  logger = { info() {}, warn() {}, error() {} },
}) {
  invariant(config.environment === 'development', 'PRODUCTION_BLOCKED', 'Runtime service is Development-only.', { httpStatus: 503 });
  const deploymentTable = config.tables.DEPLOYMENT_TABLE;
  const receiptTable = config.tables.EVENT_RECEIPT_TABLE;
  const callTable = config.tables.CANONICAL_CALL_TABLE;
  const notificationTable = config.tables.NOTIFICATION_TABLE;

  async function materializeDeploymentOutbox(deploymentId, createdAt) {
    const row = await store.unique(deploymentTable, 'DEPLOYMENT_ID', deploymentId);
    const deployment = await loadDeployment(store, row, config);
    return ensureOutboxRow(store, config, 'deployment',
      deploymentFact(config, deployment, row), createdAt);
  }

  async function materializeFinalTestOutbox(deployment, row, report, createdAt) {
    if (deployment.engagementType !== 'free_test'
      || report.testEnd === null || report.testEndReason === null) return null;
    const fact = finalTestResultFact(config, deployment, row, report);
    const expected = createOutboxRow('final_test_result', fact, createdAt);
    const providerKeyOwner = await store.unique(
      config.tables.ANALYTICS_OUTBOX_TABLE,
      'PROVIDER_VERSION_KEY',
      expected.PROVIDER_VERSION_KEY,
    );
    const outboxKeyOwner = await store.unique(
      config.tables.ANALYTICS_OUTBOX_TABLE, 'OUTBOX_KEY', expected.OUTBOX_KEY,
    );
    invariant(!providerKeyOwner || !outboxKeyOwner
      || String(providerKeyOwner.ROWID) === String(outboxKeyOwner.ROWID),
    'DURABLE_IDEMPOTENCY_CONFLICT',
    'Final Analytics artifact identities resolve to different durable rows.');
    const existing = providerKeyOwner || outboxKeyOwner;
    if (!existing) {
      return ensureOutboxRow(store, config, 'final_test_result', fact, createdAt);
    }
    if (OUTBOX_IMMUTABLE.every((column) => (
      String(existing[column]) === String(expected[column])
    ))) return Object.freeze({ row: existing, inserted: false, repaired: false });

    const repairKeyColumn = providerKeyOwner ? 'PROVIDER_VERSION_KEY' : 'OUTBOX_KEY';
    const repairKeyValue = providerKeyOwner
      ? expected.PROVIDER_VERSION_KEY : expected.OUTBOX_KEY;
    const repaired = await store.mutate(
      config.tables.ANALYTICS_OUTBOX_TABLE,
      repairKeyColumn,
      repairKeyValue,
      'FENCE_VERSION',
      (current) => {
        if (OUTBOX_IMMUTABLE.every((column) => (
          String(current[column]) === String(expected[column])
        ))) return null;
        const immutablePatch = Object.fromEntries(OUTBOX_IMMUTABLE.map((column) => (
          [column, expected[column]]
        )));
        // The provider-version identity is deterministic authoritative evidence. Advancing
        // FENCE_VERSION invalidates any old Analytics lease before the repaired row is retried.
        return {
          ...immutablePatch,
          SYNC_STATUS: 'Pending', BATCH_KEY: null,
          ATTEMPT_COUNT: 0, CLAIM_COUNT: 0, POLL_COUNT: 0,
          NEXT_ATTEMPT_AT: createdAt, LEASE_OWNER: null, LEASE_TOKEN: null,
          LEASE_EXPIRES_AT: null, PROVIDER_JOB_ID: null, PROVIDER_STATE: null,
          EXPECTED_ROW_COUNT: null, ACCEPTED_ROW_COUNT: null, REJECTED_ROW_COUNT: null,
          READBACK_JOB_ID: null, READBACK_ROW_COUNT: null, READBACK_WATERMARK: null,
          LAST_ERROR_CODE: null, LAST_ATTEMPT_AT: null, SUBMITTED_AT: null,
          RECONCILED_AT: null,
          CREATED_AT: Number.isFinite(Date.parse(current.CREATED_AT))
            ? current.CREATED_AT : createdAt,
          UPDATED_AT: createdAt,
        };
      },
    );
    invariant(OUTBOX_IMMUTABLE.every((column) => (
      String(repaired[column]) === String(expected[column])
    )), 'REPORT_RECONCILIATION_REQUIRED',
    'Final Analytics artifact repair failed exact readback.');
    return Object.freeze({ row: repaired, inserted: false, repaired: true });
  }

  async function materializeCallOutbox(callRow, createdAt) {
    const canonical = assertCanonicalCallIntegrity(
      callRow,
      parseJsonColumn(callRow.CANONICAL_CALL_JSON, 'CANONICAL_CALL_JSON'),
    );
    if (canonical.schemaVersion !== 2 || callRow.PROCESSING_STATE !== 'Completed'
      || callRow.ENDED_AT === null) return null;
    return ensureOutboxRow(store, config, 'call', callFact(config, callRow, canonical), createdAt);
  }

  async function terminalSettlement(deployment) {
    const [receipts, calls, notifications] = await Promise.all([
      store.query(receiptTable, 'DEPLOYMENT_ID', deployment.deploymentId),
      store.query(callTable, 'DEPLOYMENT_ID', deployment.deploymentId),
      store.query(notificationTable, 'DEPLOYMENT_ID', deployment.deploymentId),
    ]);
    const providerReceipts = receipts.filter((row) => row.RECEIPT_KIND === 'provider_event');
    const inboundReceipts = receipts.filter((row) => row.RECEIPT_KIND === 'inbound_resolution');
    const completedProviderKeys = new Set(providerReceipts
      .filter((row) => row.STATUS === 'Completed').map((row) => row.CALL_KEY));
    const callCorrelations = new Set(calls.map((row) => row.CORRELATION_ID));
    const unresolvedInboundCount = inboundReceipts.filter((row) => (
      row.STATUS !== 'Completed' || !callCorrelations.has(row.CORRELATION_ID)
    )).length;
    const unsettledProviderCount = providerReceipts.filter((row) => row.STATUS !== 'Completed').length;
    const unsettledCallCount = calls.filter((row) => (
      row.ENDED_AT === null || row.ENDED_AT === undefined
      || !completedProviderKeys.has(row.CALL_KEY)
      || (row.HANDLED_RECORDED === true && row.PROCESSING_STATE !== 'Completed')
    )).length;
    const settledNotificationStates = new Set([
      'DryRunRecorded', 'Sent', 'Ambiguous', 'ReconciliationRequired', 'TerminalFailure',
    ]);
    const unsettledNotificationCount = notifications
      .filter((row) => !settledNotificationStates.has(row.STATUS)).length;
    const ready = unresolvedInboundCount === 0 && unsettledProviderCount === 0
      && unsettledCallCount === 0 && unsettledNotificationCount === 0;
    return Object.freeze({
      ready,
      unresolvedInboundCount,
      unsettledProviderCount,
      unsettledCallCount,
      unsettledNotificationCount,
    });
  }

  async function findByNumber(toNumber) {
    const lookup = numberLookupKey(config.numberSecret, toNumber);
    const rows = await store.query(deploymentTable, 'NUMBER_LOOKUP_HASH', lookup);
    invariant(rows.length === 1, 'CONFIGURATION_UNAVAILABLE', 'Called number does not resolve uniquely.');
    const deployment = await loadDeployment(store, rows[0], config);
    invariant(deployment.numberLookupHash === lookup, 'CONFIGURATION_UNAVAILABLE', 'Called-number binding is inconsistent.');
    return deployment;
  }

  async function resolveInbound(payload, context = {}) {
    let result;
    try {
      const inbound = validateInboundPayload(payload);
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
      result = Object.freeze({ status: CONTRACT.resolved_status, correlationId,
        deployment, numberLookupHash: deployment.numberLookupHash, response: Object.freeze({
        call_inbound: Object.freeze({
          override_agent_id: config.sharedAgentId,
          override_agent_version: config.sharedAgentVersion,
          dynamic_variables: conversationVariables(deployment, metadata),
          metadata,
        }),
      }) });
    } catch (error) {
      if (!(error instanceof RevenueDeskError)) throw error;
      const correlationId = publicCorrelationId(config.eventSecret, [
        'inbound-unavailable', context.signatureTimestamp || now(), error.code,
      ]);
      result = Object.freeze({ ...unavailable(config, error.code), correlationId,
        deployment: null, numberLookupHash: null });
    }
    invariant(typeof context.requestFingerprint === 'string'
      && /^[a-f0-9]{64}$/.test(context.requestFingerprint),
    'INVALID_RUNTIME_CONFIGURATION', 'Inbound request fingerprint is unavailable.',
    { httpStatus: 503 });
    const receivedAt = new Date(now()).toISOString();
    const eventKey = `inbound_${keyedDigest(
      config.eventSecret,
      'revenue-desk-inbound-receipt-v1',
      [context.requestFingerprint, context.signatureTimestamp],
    )}`;
    const decision = Object.freeze({
      schemaVersion: 1,
      decision: result.status,
      reasonCode: result.reasonCode || null,
      numberLookupHash: result.numberLookupHash,
      configurationVersionId: result.deployment?.configurationVersionId || null,
      engagementType: result.deployment?.engagementType || null,
      capabilityProfile: result.deployment?.capabilityProfile || null,
      signatureTimestamp: context.signatureTimestamp,
    });
    await store.insertUnique(receiptTable, 'EVENT_KEY', {
      EVENT_KEY: eventKey, RECEIPT_KIND: 'inbound_resolution', CALL_KEY: null,
      PAYLOAD_FINGERPRINT: context.requestFingerprint,
      EVENT_TYPE: 'call_inbound', EVENT_DATA_JSON: JSON.stringify(decision),
      CORRELATION_ID: result.correlationId,
      DEPLOYMENT_ID: result.deployment?.deploymentId || null,
      STATUS: 'Completed', RECEIPT_VERSION: 1, ATTEMPT_COUNT: 0,
      LEASE_TOKEN: null, LEASE_EXPIRES_AT: null, JOB_REFERENCE: null, ENQUEUED_AT: null,
      NEXT_ATTEMPT_AT: null, LAST_ERROR_CODE: result.reasonCode || null,
      RECEIVED_AT: receivedAt, PROCESSED_AT: receivedAt,
      SOURCE_REVISION: config.sourceRevision, SOURCE_ENVIRONMENT: config.environment,
    }, RECEIPT_IMMUTABLE);
    if (result.status === CONTRACT.resolved_status) {
      logger.info({ event: 'inbound_resolved', correlationId: result.correlationId });
    } else {
      logger.warn({ event: 'inbound_unavailable', correlationId: result.correlationId,
        errorCode: result.reasonCode });
    }
    return result;
  }

  async function ownership(eventData, callKey) {
    invariant(eventData.agentId === config.sharedAgentId && eventData.agentVersion === config.sharedAgentVersion,
      'CALL_OWNERSHIP_UNRESOLVED', 'Post-call agent binding is invalid.');
    const eventNumberHash = eventData.numberLookupHash;
    if (isPlainObject(eventData.metadata) && Object.keys(eventData.metadata).length > 0) {
      const metadata = parseOwnershipMetadata(eventData.metadata, config);
      const row = await store.unique(deploymentTable, 'DEPLOYMENT_ID', metadata.deployment_id);
      const deployment = await loadDeployment(store, row, config);
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
      const deployment = await loadDeployment(store, deploymentRow, config);
      const canonical = assertCanonicalCallIntegrity(existing,
        parseJsonColumn(existing.CANONICAL_CALL_JSON, 'CANONICAL_CALL_JSON'), deployment);
      invariant(CALL_IMMUTABLE.every((column) => existing[column] !== null && existing[column] !== undefined)
        && existing.SOURCE_ENVIRONMENT === config.environment
        && /^[0-9a-f]{40}$/.test(existing.SOURCE_REVISION)
        && eventNumberHash === canonical.numberLookupHash,
      'CALL_OWNERSHIP_UNRESOLVED', 'Durable call binding is inconsistent.');
      return { deployment, correlationId: existing.CORRELATION_ID };
    }
    const rows = await store.query(deploymentTable, 'NUMBER_LOOKUP_HASH', eventNumberHash);
    invariant(rows.length === 1, 'CALL_OWNERSHIP_UNRESOLVED',
      'Called-number hash does not resolve uniquely.');
    const deployment = await loadDeployment(store, rows[0], config);
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
      CONFIGURATION_VERSION_ID: owner.deployment.configurationVersionId,
      CONFIGURATION_VERSION: owner.deployment.configurationVersion,
      ENGAGEMENT_TYPE: owner.deployment.engagementType,
      CAPABILITY_PROFILE: owner.deployment.capabilityProfile,
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
    invariant(row.SOURCE_ENVIRONMENT === config.environment && /^[0-9a-f]{40}$/.test(row.SOURCE_REVISION),
      'CALL_OWNERSHIP_UNRESOLVED', 'Canonical call source audit identity is invalid.');
    const durableCanonical = assertCanonicalCallIntegrity(row,
      parseJsonColumn(row.CANONICAL_CALL_JSON, 'CANONICAL_CALL_JSON'), owner.deployment);
    // Schema v1 never established authoritative provider duration or the new
    // structured evidence fields. Preserve it byte-for-byte and let reporting
    // withhold unsupported evidence rather than fabricating an upgrade.
    if (durableCanonical.schemaVersion === 1) return row;
    if (!analysis) {
      const prior = durableCanonical;
      invariant(prior.startedAt === canonical.startedAt,
        'DURABLE_IDEMPOTENCY_CONFLICT', 'Provider call start time changed across events.');
      invariant(prior.durationMs === canonical.durationMs,
        'DURABLE_IDEMPOTENCY_CONFLICT', 'Provider call duration changed across events.');
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
        return { CANONICAL_CALL_JSON: JSON.stringify({ ...body, endedAt: canonical.endedAt }),
          ENDED_AT: canonical.endedAt,
          UPDATED_AT: nextMutationTimestamp(current.UPDATED_AT, at) };
      });
    }
    return store.mutate(callTable, 'CALL_KEY', callKey, 'CALL_VERSION', (current) => {
      const prior = assertCanonicalCallIntegrity(current,
        parseJsonColumn(current.CANONICAL_CALL_JSON, 'CANONICAL_CALL_JSON'), owner.deployment);
      invariant(prior.startedAt === canonical.startedAt,
        'DURABLE_IDEMPOTENCY_CONFLICT', 'Provider call start time changed across events.');
      invariant(prior.durationMs === canonical.durationMs,
        'DURABLE_IDEMPOTENCY_CONFLICT', 'Provider call duration changed across events.');
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
        UPDATED_AT: nextMutationTimestamp(current.UPDATED_AT, at),
      };
    });
  }

  async function ensureNotification(callRow, deployment, at) {
    const call = assertCanonicalCallIntegrity(callRow,
      parseJsonColumn(callRow.CANONICAL_CALL_JSON, 'CANONICAL_CALL_JSON'), deployment);
    const payload = makeNotificationPayload(call);
    const prepared = mailAdapter.prepare({ recipient: deployment.configuration.notificationRecipient, payload });
    const notificationKey = `notify_${keyedDigest(config.eventSecret, 'revenue-desk-notification-v1', [
      callRow.CALL_KEY, prepared.templateVersion, prepared.recipientFingerprint,
    ])}`;
    const row = {
      NOTIFICATION_KEY: notificationKey, NOTIFICATION_VERSION: 1, CALL_KEY: callRow.CALL_KEY,
      CORRELATION_ID: callRow.CORRELATION_ID, CLIENT_ID: callRow.CLIENT_ID,
      DEPLOYMENT_ID: callRow.DEPLOYMENT_ID,
      CONFIGURATION_VERSION_ID: callRow.CONFIGURATION_VERSION_ID,
      CONFIGURATION_VERSION: callRow.CONFIGURATION_VERSION,
      ENGAGEMENT_TYPE: callRow.ENGAGEMENT_TYPE, CAPABILITY_PROFILE: callRow.CAPABILITY_PROFILE,
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
    invariant(current.SOURCE_ENVIRONMENT === config.environment
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

  async function countHandledCall(callKey, deployment, at) {
    return store.mutate(
      deploymentTable,
      'DEPLOYMENT_ID',
      deployment.deploymentId,
      'COUNT_VERSION',
      (current) => {
      invariant(current.ACTIVE_CONFIGURATION_VERSION_ID === deployment.configurationVersionId
        && current.SOURCE_REVISION === config.sourceRevision
        && current.SOURCE_ENVIRONMENT === config.environment,
      'CONFIGURATION_UNAVAILABLE', 'Deployment changed during handled-call convergence.');
      const keys = parseJsonColumn(current.COUNTED_CALL_KEYS_JSON, 'COUNTED_CALL_KEYS_JSON');
      const handledCount = integerColumn(current.HANDLED_COUNT, 'HANDLED_COUNT');
      const callLimit = integerColumn(current.CALL_LIMIT, 'CALL_LIMIT', 1);
      invariant(Array.isArray(keys) && keys.length === handledCount
        && new Set(keys).size === keys.length
        && keys.every((key) => /^call_[a-f0-9]{64}$/.test(key)),
      'CONFIGURATION_UNAVAILABLE', 'Handled-call convergence state is inconsistent.');
      if (keys.includes(callKey)) return null;
      const nextKeys = [...keys, callKey];
      const reachedNow = current.TEST_STATUS === CONTRACT.active_test_status
        && handledCount < callLimit && nextKeys.length >= callLimit;
      const reconciliationVersion = integerColumn(
        current.REPORT_RECONCILIATION_VERSION, 'REPORT_RECONCILIATION_VERSION',
      );
      return {
        COUNTED_CALL_KEYS_JSON: JSON.stringify(nextKeys), HANDLED_COUNT: nextKeys.length,
        ...(reachedNow ? { TEST_STATUS: 'Completed', STOP_REASON: 'call_limit_reached',
          STOPPED_AT: at, REPORT_RECONCILIATION_STATUS: 'Pending',
          REPORT_RECONCILIATION_VERSION: reconciliationVersion + 1 } : {}),
        UPDATED_AT: nextMutationTimestamp(current.UPDATED_AT, at),
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
    let status = error instanceof RevenueDeskError && error.ambiguous
      ? 'ReconciliationRequired' : 'TerminalFailure';
    let nextAttemptAt = null;
    if (error instanceof RevenueDeskError && error.retryable
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
      && !RETRYABLE_NOTIFICATION_STATES.has(current.STATUS)
      && current.STATUS !== 'Sending') return null;
    const at = new Date(now()).toISOString();
    if (!CONTAINED_NOTIFICATION_STATES.has(current.STATUS)) {
      current = await store.mutate(notificationTable, 'NOTIFICATION_KEY', candidate.NOTIFICATION_KEY,
        'NOTIFICATION_VERSION', (row) => {
          if (CONTAINED_NOTIFICATION_STATES.has(row.STATUS)) return null;
          const ambiguous = row.STATUS === 'Sending'
            || (error instanceof RevenueDeskError && error.ambiguous);
          if (ambiguous) return {
            STATUS: 'Ambiguous', PROVIDER_CODE: 'CATALYST_MAIL_UNRESOLVED_AFTER_INVOKE',
            PROVIDER_RESULT_REFERENCE: null, SEND_TOKEN: null, NEXT_ATTEMPT_AT: null,
            LAST_ERROR_CODE: durableErrorCode(error), UPDATED_AT: at,
          };
          if (!RETRYABLE_NOTIFICATION_STATES.has(row.STATUS)) return null;
          if (error instanceof RevenueDeskError && error.retryable) {
            // ATTEMPT_COUNT covers the bounded delivery pipeline, including a safe
            // pre-provider read attempt. Provider invocation evidence remains in
            // PROVIDER_CODE and PROVIDER_RESULT_REFERENCE.
            const attempt = integerColumn(row.ATTEMPT_COUNT, 'ATTEMPT_COUNT') + 1;
            const exhausted = attempt >= config.notificationMaxAttempts;
            return {
              STATUS: exhausted ? 'TerminalFailure' : 'RetryRequired',
              ATTEMPT_COUNT: attempt, SEND_TOKEN: null, LAST_ATTEMPT_AT: at,
              NEXT_ATTEMPT_AT: exhausted ? null
                : new Date(now() + NOTIFICATION_RETRY_DELAYS_MS[attempt - 1]).toISOString(),
              LAST_ERROR_CODE: durableErrorCode(error), UPDATED_AT: at,
            };
          }
          return {
            STATUS: 'ReconciliationRequired', PROVIDER_CODE: 'NOTIFICATION_RECONCILIATION_REQUIRED',
            PROVIDER_RESULT_REFERENCE: null, SEND_TOKEN: null, NEXT_ATTEMPT_AT: null,
            LAST_ERROR_CODE: durableErrorCode(error), UPDATED_AT: at,
          };
        });
    }
    if (!NOTIFICATION_FAILURE_RESULT_STATES.has(current.STATUS)) return null;
    const call = await store.unique(callTable, 'CALL_KEY', current.CALL_KEY);
    invariant(call && call.CLIENT_ID === current.CLIENT_ID
      && call.DEPLOYMENT_ID === current.DEPLOYMENT_ID
      && call.CONFIGURATION_VERSION_ID === current.CONFIGURATION_VERSION_ID
      && call.CONFIGURATION_VERSION === current.CONFIGURATION_VERSION,
    'CALL_OWNERSHIP_UNRESOLVED', 'Notification failure cannot be correlated to its call.');
    await store.mutate(callTable, 'CALL_KEY', call.CALL_KEY, 'CALL_VERSION', (row) => (
      row.NOTIFICATION_STATE === current.STATUS ? null
        : { NOTIFICATION_STATE: current.STATUS, UPDATED_AT: at }
    ));
    return current.STATUS;
  }

  async function assertLegacyReplaySettled(callRow, canonical, eventData, callKey, deployment) {
    const settled = (condition) => invariant(condition,
      'DURABLE_IDEMPOTENCY_CONFLICT',
      'Legacy canonical call state requires reconciliation.',
      { httpStatus: 409, ambiguous: true });
    const handledEligible = eventData.callStatus === 'ended';
    const counted = deployment.countedCallKeys.includes(callKey);
    const expectedStartedAt = new Date(eventData.startTimestamp).toISOString();
    const expectedEndedAt = eventData.endTimestamp === null
      ? null : new Date(eventData.endTimestamp).toISOString();

    settled(canonical.startedAt === expectedStartedAt
      && canonical.endedAt === expectedEndedAt
      && canonical.callStatus === eventData.callStatus
      && canonical.disconnectionReason === eventData.disconnectionReason);
    settled(typeof callRow.HANDLED_RECORDED === 'boolean'
      && callRow.HANDLED_RECORDED === handledEligible
      && counted === handledEligible);
    settled(new Set(['AwaitingAnalysis', 'Completed']).has(callRow.PROCESSING_STATE)
      && (!eventData.analysis || callRow.PROCESSING_STATE === 'Completed'));

    const notifications = await store.query(notificationTable, 'CALL_KEY', callKey);
    const notificationState = callRow.NOTIFICATION_STATE ?? null;
    settled(notificationState === null || NOTIFICATION_STATES.has(notificationState));
    const notificationRequired = handledEligible && (Boolean(eventData.analysis)
      || callRow.PROCESSING_STATE === 'Completed'
      || notificationState !== null
      || notifications.length > 0);
    if (!notificationRequired) {
      settled(notificationState === null && notifications.length === 0);
      return;
    }

    settled(notificationState !== null && notifications.length === 1);
    const notification = notifications[0];
    let prepared = null;
    try {
      prepared = mailAdapter.prepare({
        recipient: deployment.configuration.notificationRecipient,
        payload: makeNotificationPayload(canonical),
      });
    } catch (_) {
      settled(false);
    }
    const expectedNotificationKey = `notify_${keyedDigest(
      config.eventSecret,
      'revenue-desk-notification-v1',
      [callKey, prepared.templateVersion, prepared.recipientFingerprint],
    )}`;
    settled(notification.NOTIFICATION_KEY === expectedNotificationKey
      && notification.CALL_KEY === callRow.CALL_KEY
      && notification.CORRELATION_ID === callRow.CORRELATION_ID
      && notification.CLIENT_ID === callRow.CLIENT_ID
      && notification.DEPLOYMENT_ID === callRow.DEPLOYMENT_ID
      && notification.CONFIGURATION_VERSION_ID === callRow.CONFIGURATION_VERSION_ID
      && notification.CONFIGURATION_VERSION === callRow.CONFIGURATION_VERSION
      && notification.ENGAGEMENT_TYPE === callRow.ENGAGEMENT_TYPE
      && notification.CAPABILITY_PROFILE === callRow.CAPABILITY_PROFILE
      && notification.RECIPIENT_FINGERPRINT === prepared.recipientFingerprint
      && notification.TEMPLATE_VERSION === prepared.templateVersion
      && notification.PAYLOAD_JSON === JSON.stringify(makeNotificationPayload(canonical))
      && notification.STATUS === notificationState
      && notification.SOURCE_ENVIRONMENT === config.environment
      && /^[0-9a-f]{40}$/.test(notification.SOURCE_REVISION));
  }

  async function executeClaimedEvent(eventData, callKey, receiptKey, workerToken) {
    const at = new Date(now()).toISOString();
    try {
      const owner = await ownership(eventData, callKey);
      await mutateClaimedReceipt(receiptKey, workerToken, () => ({
        CORRELATION_ID: owner.correlationId, DEPLOYMENT_ID: owner.deployment.deploymentId,
      }));
      const terminalBeforeMutation = await store.unique(
        deploymentTable, 'DEPLOYMENT_ID', owner.deployment.deploymentId,
      );
      if (terminalBeforeMutation?.TEST_STATUS === 'Completed'
        && terminalBeforeMutation.REPORT_RECONCILIATION_STATUS === 'Completed') {
        // A newly claimed provider receipt may change terminal call evidence. Reopen the
        // durable queue before touching source rows; completed receipt replay never reaches here.
        await setReportReconciliationStatus(
          owner.deployment.deploymentId, new Set(['Completed']), 'Pending',
        );
      }
      const analysis = eventData.analysis;
      if (analysis) invariant(triggerAllowedForMode(analysis.coverageTrigger, owner.deployment.coverageMode),
        'INVALID_ANALYSIS', 'Coverage trigger conflicts with the deployment mode.');
      await mutateClaimedReceipt(receiptKey, workerToken, () => ({
        LEASE_EXPIRES_AT: new Date(now() + 30_000).toISOString(),
      }));
      let call = await upsertCall(eventData, callKey, owner, analysis, at);
      const durableCall = assertCanonicalCallIntegrity(call,
        parseJsonColumn(call.CANONICAL_CALL_JSON, 'CANONICAL_CALL_JSON'), owner.deployment);
      if (durableCall.schemaVersion === 1) {
        // Schema-v1 is preserved byte-for-byte. A replay may be acknowledged
        // only when the durable count, processing, and notification state are
        // already complete and mutually consistent; partial legacy state is
        // quarantined for reconciliation instead of being silently completed.
        await assertLegacyReplaySettled(call, durableCall, eventData, callKey, owner.deployment);
        await mutateClaimedReceipt(receiptKey, workerToken, () => ({
          STATUS: 'Completed', PROCESSED_AT: at, LEASE_EXPIRES_AT: null,
          NEXT_ATTEMPT_AT: null, LAST_ERROR_CODE: null,
        }));
        logger.warn({ event: 'legacy_call_withheld', correlationId: owner.correlationId,
          eventType: eventData.event, state: 'LegacyWithheld' });
        return { status: 'Completed', duplicate: false, correlationId: owner.correlationId,
          legacyWithheld: true };
      }
      const handledEligible = eventData.callStatus === 'ended';
      if (handledEligible) await countHandledCall(callKey, owner.deployment, at);
      if (analysis && handledEligible) {
        await mutateClaimedReceipt(receiptKey, workerToken, () => ({
          LEASE_EXPIRES_AT: new Date(now() + 30_000).toISOString(),
        }));
        const notificationState = await ensureNotification(call, owner.deployment, at);
        call = await store.mutate(callTable, 'CALL_KEY', callKey, 'CALL_VERSION', (current) => {
          if (current.HANDLED_RECORDED === true && current.NOTIFICATION_STATE === notificationState
            && current.PROCESSING_STATE === 'Completed') return null;
          return { HANDLED_RECORDED: handledEligible, NOTIFICATION_STATE: notificationState,
            PROCESSING_STATE: 'Completed',
            UPDATED_AT: nextMutationTimestamp(current.UPDATED_AT, at) };
        });
      } else {
        call = await store.mutate(callTable, 'CALL_KEY', callKey, 'CALL_VERSION', (current) => (
          current.HANDLED_RECORDED === handledEligible
            && (!analysis || current.PROCESSING_STATE === 'Completed') ? null
            : { HANDLED_RECORDED: handledEligible,
              ...(analysis ? { PROCESSING_STATE: 'Completed' } : {}),
              UPDATED_AT: nextMutationTimestamp(current.UPDATED_AT, at) }
        ));
      }
      await materializeCallOutbox(call, at);
      await materializeDeploymentOutbox(owner.deployment.deploymentId, at);
      await mutateClaimedReceipt(receiptKey, workerToken, () => ({
        STATUS: 'Completed', PROCESSED_AT: at, LEASE_EXPIRES_AT: null,
        NEXT_ATTEMPT_AT: null, LAST_ERROR_CODE: null,
      }));
      const terminalRow = await store.unique(
        deploymentTable, 'DEPLOYMENT_ID', owner.deployment.deploymentId,
      );
      if (terminalRow?.TEST_STATUS === 'Completed') {
        try {
          if (terminalRow.REPORT_RECONCILIATION_STATUS === 'AwaitingSettlement') {
            await setReportReconciliationStatus(
              owner.deployment.deploymentId,
              new Set(['AwaitingSettlement']),
              'Pending',
            );
          }
          const terminal = await reconcileTerminalDeployment(owner.deployment.deploymentId);
          logger.info({
            event: 'terminal_report_reconciliation',
            correlationId: owner.correlationId,
            state: terminal.status,
          });
        } catch (error) {
          // Call/event convergence is already durable. retry_scan owns replay-safe
          // terminal reconciliation, so a report-side failure must not corrupt or
          // reopen the provider receipt.
          logger.error({
            event: 'terminal_report_reconciliation_failed',
            correlationId: owner.correlationId,
            errorCode: durableErrorCode(error),
          });
        }
      }
      logger.info({ event: 'retell_event_completed', correlationId: owner.correlationId,
        eventType: eventData.event, state: call.PROCESSING_STATE });
      return { status: 'Completed', duplicate: false, correlationId: owner.correlationId };
    } catch (error) {
      let status = 'TerminalFailure';
      let nextAttemptAt = null;
      try {
        const durable = await store.unique(receiptTable, 'EVENT_KEY', receiptKey);
        const attempt = Number(durable?.ATTEMPT_COUNT || 1);
        if (error instanceof RevenueDeskError && error.ambiguous) status = 'ReconciliationRequired';
        else if (error instanceof RevenueDeskError && error.retryable && attempt <= EVENT_RETRY_DELAYS_MS.length) {
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
    const pending = current.STATUS === 'Pending' || current.STATUS === 'Queued';
    const leaseExpired = current.STATUS === 'Processing'
      && dueOrInvalid(current, 'LEASE_EXPIRES_AT', currentTime);
    const retryDue = current.STATUS === 'RetryRequired'
      && dueOrInvalid(current, 'NEXT_ATTEMPT_AT', currentTime);
    if (!pending && !leaseExpired && !retryDue) {
      return { terminal: { status: current.STATUS, duplicate: true } };
    }
    const leaseExpiresAt = new Date(currentTime + 30_000).toISOString();
    const workerToken = crypto.randomBytes(16).toString('hex');
    const resumed = await store.mutate(receiptTable, 'EVENT_KEY', receiptKey, 'RECEIPT_VERSION', (row) => {
      const available = row.STATUS === 'Pending' || row.STATUS === 'Queued';
      const expired = row.STATUS === 'Processing'
        && dueOrInvalid(row, 'LEASE_EXPIRES_AT', now());
      const due = row.STATUS === 'RetryRequired'
        && dueOrInvalid(row, 'NEXT_ATTEMPT_AT', now());
      if (!available && !expired && !due) return null;
      return { STATUS: 'Processing', ATTEMPT_COUNT: Number(row.ATTEMPT_COUNT) + 1,
        LEASE_TOKEN: workerToken, LEASE_EXPIRES_AT: leaseExpiresAt,
        NEXT_ATTEMPT_AT: null, LAST_ERROR_CODE: null };
    });
    if (resumed.STATUS !== 'Processing' || resumed.LEASE_TOKEN !== workerToken) {
      return { terminal: { status: resumed.STATUS, duplicate: true } };
    }
    return { row: resumed, workerToken };
  }

  async function enqueueReceipt(receiptKey, duplicate) {
    invariant(jobAdapter && typeof jobAdapter.enqueueProcessEvent === 'function',
      'INVALID_RUNTIME_CONFIGURATION', 'Function Job adapter is unavailable.',
      { httpStatus: 503 });
    let submission;
    try {
      submission = await jobAdapter.enqueueProcessEvent(receiptKey);
    } catch (error) {
      const retryAt = new Date(now() + EVENT_RETRY_DELAYS_MS[0]).toISOString();
      const current = await store.mutate(
        receiptTable,
        'EVENT_KEY',
        receiptKey,
        'RECEIPT_VERSION',
        (row) => new Set(['Pending', 'Queued', 'RetryRequired']).has(row.STATUS) ? {
          STATUS: 'RetryRequired',
          NEXT_ATTEMPT_AT: retryAt,
          LAST_ERROR_CODE: durableErrorCode(error),
        } : null,
      );
      if (!new Set(['Pending', 'Queued', 'RetryRequired']).has(current.STATUS)) {
        return {
          status: current.STATUS,
          duplicate,
          correlationId: current.CORRELATION_ID || null,
        };
      }
      throw error;
    }
    const enqueuedAt = new Date(now()).toISOString();
    const current = await store.mutate(
      receiptTable,
      'EVENT_KEY',
      receiptKey,
      'RECEIPT_VERSION',
      (row) => new Set(['Pending', 'RetryRequired']).has(row.STATUS) ? {
        STATUS: 'Queued',
        JOB_REFERENCE: submission.jobId,
        ENQUEUED_AT: enqueuedAt,
        NEXT_ATTEMPT_AT: null,
        LAST_ERROR_CODE: null,
      } : null,
    );
    logger.info({
      event: 'revenue_desk_event_enqueued',
      correlationId: publicCorrelationId(config.eventSecret, ['event-queued', receiptKey]),
      state: current.STATUS,
    });
    return {
      status: current.STATUS,
      duplicate,
      correlationId: current.CORRELATION_ID || null,
    };
  }

  async function acceptEvent(payload, rawBody) {
    const fingerprint = payloadFingerprint(config.eventSecret, rawBody);
    let normalized;
    try {
      normalized = normalizeEventForReceipt(payload, config);
    } catch (error) {
      const at = new Date(now()).toISOString();
      const quarantineKey = `evtq_${keyedDigest(config.eventSecret, 'revenue-desk-quarantine-event-v1', [fingerprint])}`;
      const quarantineCallKey = `call_${keyedDigest(config.eventSecret, 'revenue-desk-quarantine-call-v1', [fingerprint])}`;
      const eventType = typeof payload?.event === 'string' && /^[a-z_]{1,32}$/.test(payload.event)
        ? payload.event : 'invalid';
      await store.insertUnique(receiptTable, 'EVENT_KEY', {
        EVENT_KEY: quarantineKey, RECEIPT_KIND: 'provider_event',
        CALL_KEY: quarantineCallKey, PAYLOAD_FINGERPRINT: fingerprint,
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
    const receipt = {
      EVENT_KEY: receiptKey, RECEIPT_KIND: 'provider_event',
      CALL_KEY: callKey, PAYLOAD_FINGERPRINT: fingerprint,
      EVENT_TYPE: eventData.event, EVENT_DATA_JSON: JSON.stringify(eventData),
      CORRELATION_ID: null, DEPLOYMENT_ID: null, STATUS: 'Pending', RECEIPT_VERSION: 1,
      ATTEMPT_COUNT: 0, LEASE_TOKEN: null,
      LEASE_EXPIRES_AT: null,
      JOB_REFERENCE: null, ENQUEUED_AT: null,
      NEXT_ATTEMPT_AT: null, LAST_ERROR_CODE: null, RECEIVED_AT: at, PROCESSED_AT: null,
      SOURCE_REVISION: config.sourceRevision, SOURCE_ENVIRONMENT: config.environment,
    };
    const claimed = await store.insertUnique(receiptTable, 'EVENT_KEY', receipt, RECEIPT_IMMUTABLE);
    if (claimed.inserted) return enqueueReceipt(receiptKey, false);
    if (claimed.row.STATUS === 'Pending') return enqueueReceipt(receiptKey, true);
    if (claimed.row.STATUS === 'RetryRequired'
      && Date.parse(claimed.row.NEXT_ATTEMPT_AT || '') <= now()) {
      return enqueueReceipt(receiptKey, true);
    }
    if (claimed.row.STATUS === 'RetryRequired') {
      throw new RevenueDeskError(
        'EVENT_ENQUEUE_PENDING',
        'Event is durably retained and awaiting a bounded retry.',
        { httpStatus: 503, retryable: true },
      );
    }
    return {
      status: claimed.row.STATUS,
      duplicate: true,
      correlationId: claimed.row.CORRELATION_ID || null,
    };
  }

  async function processEventReceipt(receiptKey) {
    invariant(typeof receiptKey === 'string' && /^evt_[a-f0-9]{64}$/.test(receiptKey),
      'INVALID_JOB_PARAMETER', 'process_event requires one valid event_key.',
      { httpStatus: 400 });
    const current = await store.unique(receiptTable, 'EVENT_KEY', receiptKey);
    invariant(current, 'EVENT_RECEIPT_NOT_FOUND', 'Event receipt is unavailable.',
      { httpStatus: 503, retryable: true });
    invariant(current.RECEIPT_KIND === 'provider_event',
      'INVALID_JOB_PARAMETER', 'process_event accepts provider-event receipts only.',
      { httpStatus: 400 });
    const claimed = await claimExistingReceipt(receiptKey, current);
    if (claimed.terminal) return claimed.terminal;
    const eventData = parseJsonColumn(claimed.row.EVENT_DATA_JSON, 'EVENT_DATA_JSON');
    return executeClaimedEvent(
      eventData,
      claimed.row.CALL_KEY,
      claimed.row.EVENT_KEY,
      claimed.workerToken,
    );
  }

  async function retryDueEvents(limit = 25) {
    const scanAt = now();
    const lanes = [];
    for (const lane of [
      { name: 'Pending', orderColumn: 'RECEIVED_AT', dueColumn: null },
      { name: 'Queued', orderColumn: 'RECEIVED_AT', dueColumn: null },
      { name: 'RetryRequired', orderColumn: 'NEXT_ATTEMPT_AT', dueColumn: 'NEXT_ATTEMPT_AT' },
      { name: 'Processing', orderColumn: 'LEASE_EXPIRES_AT', dueColumn: 'LEASE_EXPIRES_AT' },
    ]) {
      const rows = await store.queryBounded(
        receiptTable, 'STATUS', lane.name, lane.orderColumn, limit,
        { RECEIPT_KIND: 'provider_event' },
      );
      lanes.push({ ...lane, rows: lane.dueColumn
        ? rows.filter((row) => dueOrInvalid(row, lane.dueColumn, scanAt)) : rows });
    }
    const candidates = fairBoundedCandidates(lanes, limit);
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
        assertScanTimestamp(candidate, candidate.STATUS === 'RetryRequired'
          ? 'NEXT_ATTEMPT_AT' : candidate.STATUS === 'Processing'
            ? 'LEASE_EXPIRES_AT' : 'RECEIVED_AT');
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
    const scanAt = now();
    const lanes = [];
    for (const lane of [
      { name: 'Sending', orderColumn: 'LAST_ATTEMPT_AT', dueColumn: 'LAST_ATTEMPT_AT',
        offsetMs: config.mailTimeoutMs },
      { name: 'Pending', orderColumn: 'CREATED_AT', dueColumn: null },
      { name: 'RetryRequired', orderColumn: 'NEXT_ATTEMPT_AT', dueColumn: 'NEXT_ATTEMPT_AT' },
    ]) {
      const rows = await store.queryBounded(
        notificationTable, 'STATUS', lane.name, lane.orderColumn, limit,
      );
      lanes.push({ ...lane, rows: lane.dueColumn
        ? rows.filter((row) => dueOrInvalid(row, lane.dueColumn, scanAt, lane.offsetMs || 0))
        : rows });
    }
    const candidates = fairBoundedCandidates(lanes, limit);
    const staleSending = candidates.filter((row) => row.STATUS === 'Sending');
    const results = [];
    for (const candidate of staleSending) {
      try {
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
            && call.CONFIGURATION_VERSION_ID === notification.CONFIGURATION_VERSION_ID
            && call.CONFIGURATION_VERSION === notification.CONFIGURATION_VERSION,
          'CALL_OWNERSHIP_UNRESOLVED', 'Ambiguous notification ownership is inconsistent.');
          await store.mutate(callTable, 'CALL_KEY', call.CALL_KEY, 'CALL_VERSION', (current) => (
            current.NOTIFICATION_STATE === 'Ambiguous' ? null
              : { NOTIFICATION_STATE: 'Ambiguous', UPDATED_AT: new Date(now()).toISOString() }
          ));
          await wakeTerminalReconciliation(notification.DEPLOYMENT_ID);
        }
      } catch (error) {
        results.push({ status: 'Failed', errorCode: durableErrorCode(error) });
      }
    }
    const due = candidates.filter((row) => row.STATUS !== 'Sending');
    for (const candidate of due) {
      try {
        assertScanTimestamp(candidate, candidate.STATUS === 'RetryRequired'
          ? 'NEXT_ATTEMPT_AT' : 'CREATED_AT');
        const call = await store.unique(callTable, 'CALL_KEY', candidate.CALL_KEY);
        const deploymentRow = await store.unique(deploymentTable, 'DEPLOYMENT_ID', candidate.DEPLOYMENT_ID);
        const deployment = await loadDeployment(store, deploymentRow, config);
        invariant(call && call.CLIENT_ID === deployment.clientId
          && call.CONFIGURATION_VERSION_ID === deployment.configurationVersionId
          && call.CONFIGURATION_VERSION === deployment.configurationVersion,
        'CALL_OWNERSHIP_UNRESOLVED', 'Notification retry ownership is inconsistent.');
        const status = await ensureNotification(call, deployment, new Date(now()).toISOString());
        await store.mutate(callTable, 'CALL_KEY', call.CALL_KEY, 'CALL_VERSION', (current) => (
          current.NOTIFICATION_STATE === status ? null : {
            NOTIFICATION_STATE: status, UPDATED_AT: new Date(now()).toISOString(),
          }
        ));
        await wakeTerminalReconciliation(deployment.deploymentId);
        results.push({ status });
      } catch (error) {
        let containedStatus = null;
        try {
          containedStatus = await containNotificationFailure(candidate, error);
          if (containedStatus) await wakeTerminalReconciliation(candidate.DEPLOYMENT_ID);
        } catch (_) { /* The Job result remains Failed and is surfaced to Catalyst. */ }
        results.push({ status: containedStatus || 'Failed', errorCode: durableErrorCode(error) });
      }
    }
    const reconciliationRows = [];
    for (const status of ['Ambiguous', 'ReconciliationRequired']) {
      reconciliationRows.push(await store.queryBounded(
        notificationTable, 'STATUS', status, 'UPDATED_AT', limit,
      ));
    }
    const reconciliationRequired = reconciliationRows.reduce(
      (count, rows) => count + rows.length, 0,
    );
    return Object.freeze({ examined: due.length, staleSending: staleSending.length,
      reconciliationRequired,
      reconciliationRequiredCapped: reconciliationRows.some((rows) => rows.length === limit),
      results: Object.freeze(results) });
  }

  async function runRetryJob(limit = 25) {
    invariant(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100,
      'INVALID_RETRY_LIMIT', 'Retry job limit is invalid.');
    const events = await retryDueEvents(limit);
    const notifications = await retryDueNotifications(limit);
    const deployments = await reconcileDueDeployments(limit);
    return Object.freeze({
      events,
      notifications,
      deployments,
      reportSummaries: await dispatchPendingReportSummaries(limit),
    });
  }

  function validDeploymentId(deploymentId) {
    invariant(typeof deploymentId === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(deploymentId),
    'INVALID_JOB_PARAMETER', 'Deployment identifier is invalid.', { httpStatus: 400 });
    return deploymentId;
  }

  async function stopExpiredDeployment(deploymentId) {
    const id = validDeploymentId(deploymentId);
    const row = await store.unique(deploymentTable, 'DEPLOYMENT_ID', id);
    const deployment = await loadDeployment(store, row, config);
    if (deployment.testStatus !== CONTRACT.active_test_status
      || Date.parse(deployment.expiresAt) > now()) return row;
    return store.mutate(deploymentTable, 'DEPLOYMENT_ID', id, 'COUNT_VERSION', (current) => {
      if (current.TEST_STATUS !== CONTRACT.active_test_status) return null;
      const expiresAt = canonicalTimestamp(current.EXPIRES_AT, 'EXPIRES_AT');
      if (Date.parse(expiresAt) > now()) return null;
      invariant(current.STOP_REASON === null && current.STOPPED_AT === null,
        'CONFIGURATION_UNAVAILABLE', 'Expired deployment stop state is inconsistent.');
      return {
        TEST_STATUS: 'Completed',
        STOP_REASON: 'seven_day_limit_reached',
        // Expiry is the authoritative first end condition; scanner delay must not
        // lengthen the test or alter its report period.
        STOPPED_AT: expiresAt,
        REPORT_RECONCILIATION_STATUS: 'Pending',
        REPORT_RECONCILIATION_VERSION: integerColumn(
          current.REPORT_RECONCILIATION_VERSION, 'REPORT_RECONCILIATION_VERSION',
        ) + 1,
        UPDATED_AT: nextMutationTimestamp(current.UPDATED_AT, new Date(now()).toISOString()),
      };
    });
  }

  async function setReportReconciliationStatus(deploymentId, fromStatuses, status) {
    return store.mutate(
      deploymentTable,
      'DEPLOYMENT_ID',
      deploymentId,
      'REPORT_RECONCILIATION_VERSION',
      (current) => fromStatuses.has(current.REPORT_RECONCILIATION_STATUS) ? {
        REPORT_RECONCILIATION_STATUS: status,
        UPDATED_AT: nextMutationTimestamp(current.UPDATED_AT, new Date(now()).toISOString()),
      } : null,
    );
  }

  async function wakeTerminalReconciliation(deploymentId) {
    const row = await store.unique(deploymentTable, 'DEPLOYMENT_ID', deploymentId);
    if (row?.TEST_STATUS === 'Completed'
      && new Set(['AwaitingSettlement', 'Completed'])
        .has(row.REPORT_RECONCILIATION_STATUS)) {
      await setReportReconciliationStatus(
        deploymentId, new Set(['AwaitingSettlement', 'Completed']), 'Pending',
      );
    }
  }

  async function advanceTerminalScanCursor(deploymentId) {
    return store.mutate(
      deploymentTable,
      'DEPLOYMENT_ID',
      deploymentId,
      'REPORT_RECONCILIATION_VERSION',
      (current) => current.TEST_STATUS === 'Completed'
        && current.SOURCE_REVISION === config.sourceRevision
        && TERMINAL_RECONCILIATION_STATES.includes(current.REPORT_RECONCILIATION_STATUS)
        ? { UPDATED_AT: nextScanCursorTimestamp(
          current.UPDATED_AT, new Date(now()).toISOString(),
        ) } : null,
    );
  }

  async function buildReport(deployment) {
    const { queryClientReport } = require('./reporting');
    return queryClientReport(
      store,
      config,
      deployment.clientId,
      deployment.deploymentId,
      now(),
    );
  }

  async function materializeReportArtifacts(deployment, row, report, createdAt, terminalReady) {
    const callRows = await store.query(callTable, 'DEPLOYMENT_ID', deployment.deploymentId);
    for (const callRow of callRows) await materializeCallOutbox(callRow, createdAt);
    await ensureOutboxRow(store, config, 'deployment',
      deploymentFact(config, deployment, row), createdAt);
    if (terminalReady) {
      await materializeFinalTestOutbox(deployment, row, report, createdAt);
      await ensureCrmReportSummary(store, config, deployment, report, createdAt);
    }
  }

  async function terminalArtifactsPresent(deployment, row, report, requireCrmCompletion = true) {
    const summary = buildCrmReportSummary(config, deployment, report);
    const identity = reportSummaryIdentity(config, summary);
    const operation = await store.unique(
      config.tables.OPERATION_TABLE, 'OPERATION_KEY', identity.operationKey,
    );
    if (!operation
      || operation.OPERATION_FINGERPRINT !== identity.operationFingerprint
      || operation.ACTION !== 'sync_report_summary'
      || operation.CRM_DEAL_ID !== summary.dealId
      || operation.OPERATION_PAYLOAD_JSON !== JSON.stringify(summary)
      || operation.SOURCE_ENVIRONMENT !== config.environment
      || (requireCrmCompletion && (operation.STATUS !== 'completed'
        || operation.LAST_OUTCOME !== 'report_summary_readback_confirmed'))) return false;
    const fact = finalTestResultFact(config, deployment, row, report);
    const expected = createOutboxRow('final_test_result', fact, report.testEnd);
    const analytics = await store.unique(
      config.tables.ANALYTICS_OUTBOX_TABLE,
      'PROVIDER_VERSION_KEY',
      expected.PROVIDER_VERSION_KEY,
    );
    return Boolean(analytics && OUTBOX_IMMUTABLE.every((column) => (
      String(analytics[column]) === String(expected[column])
    )));
  }

  async function reconcileTerminalDeployment(deploymentId) {
    const id = validDeploymentId(deploymentId);
    await stopExpiredDeployment(id);
    const row = await store.unique(deploymentTable, 'DEPLOYMENT_ID', id);
    const deployment = await loadDeployment(store, row, config);
    if (deployment.engagementType !== 'free_test' || deployment.testStatus !== 'Completed') {
      return Object.freeze({ status: 'NotTerminal', deploymentId: id });
    }
    if (deployment.reportReconciliationStatus === 'Completed') {
      const report = await buildReport(deployment);
      if (await terminalArtifactsPresent(deployment, row, report)) {
        return Object.freeze({ status: 'TerminalReportReconciled', deploymentId: id, report });
      }
      await setReportReconciliationStatus(id, new Set(['Completed']), 'Pending');
    }
    const pendingRow = await store.unique(deploymentTable, 'DEPLOYMENT_ID', id);
    const pendingDeployment = await loadDeployment(store, pendingRow, config);
    const settlement = await terminalSettlement(pendingDeployment);
    if (!settlement.ready) {
      await setReportReconciliationStatus(
        id, new Set(['Pending']), 'AwaitingSettlement',
      );
      return Object.freeze({ status: 'AwaitingSettlement', deploymentId: id, settlement });
    }
    const report = await buildReport(pendingDeployment);
    invariant(report.testEnd !== null && report.testEndReason !== null,
      'REPORT_RECONCILIATION_REQUIRED', 'Terminal report end evidence is unavailable.');
    const createdAt = new Date(now()).toISOString();
    await materializeReportArtifacts(pendingDeployment, pendingRow, report, createdAt, true);
    invariant(await terminalArtifactsPresent(pendingDeployment, pendingRow, report, false),
      'REPORT_RECONCILIATION_REQUIRED', 'Terminal report artifacts failed exact readback.');
    if (!(await terminalArtifactsPresent(pendingDeployment, pendingRow, report, true))) {
      return Object.freeze({ status: 'AwaitingCrmReportReadback', deploymentId: id, report });
    }
    await setReportReconciliationStatus(
      id, new Set(['Pending', 'AwaitingSettlement']), 'Completed',
    );
    return Object.freeze({ status: 'TerminalReportReconciled', deploymentId: id, report });
  }

  async function reconcileDueDeployments(limit = 25) {
    const liveRows = (await store.queryBounded(
      deploymentTable, 'TEST_STATUS', CONTRACT.active_test_status, 'EXPIRES_AT', limit,
      { SOURCE_REVISION: config.sourceRevision },
    )).filter((row) => dueOrInvalid(row, 'EXPIRES_AT', now()));
    const results = [];
    for (const row of liveRows) {
      try {
        await stopExpiredDeployment(row.DEPLOYMENT_ID);
      } catch (error) {
        results.push({ status: 'Failed', errorCode: durableErrorCode(error) });
      }
    }
    const lanes = [];
    for (const status of TERMINAL_RECONCILIATION_STATES) {
      lanes.push({
        name: status,
        orderColumn: 'UPDATED_AT',
        rows: await store.queryBounded(
          deploymentTable,
          'REPORT_RECONCILIATION_STATUS',
          status,
          'UPDATED_AT',
          limit,
          { SOURCE_REVISION: config.sourceRevision },
        ),
      });
    }
    const candidates = fairBoundedCandidates(lanes, limit);
    for (const row of candidates) {
      let result;
      try {
        result = await reconcileTerminalDeployment(row.DEPLOYMENT_ID);
      } catch (error) {
        result = { status: 'Failed', errorCode: durableErrorCode(error) };
      }
      try {
        await advanceTerminalScanCursor(row.DEPLOYMENT_ID);
      } catch (error) {
        result = { status: 'Failed', errorCode: durableErrorCode(error) };
      }
      results.push(result);
    }
    return Object.freeze({
      expired: liveRows.length,
      examined: candidates.length,
      results: Object.freeze(results),
    });
  }

  async function dispatchPendingReportSummaries(limit = 25) {
    invariant(crmSummaryDispatcher && typeof crmSummaryDispatcher.dispatch === 'function',
      'INVALID_RUNTIME_CONFIGURATION', 'CRM report dispatcher is unavailable.',
      { httpStatus: 503 });
    const scanLimit = Math.min(limit, 5);
    const lanes = [];
    for (const status of REPORT_DISPATCH_STATES) {
      lanes.push({
        name: status,
        orderColumn: 'UPDATED_AT',
        rows: await store.queryBounded(
          config.tables.OPERATION_TABLE,
          'STATUS', status, 'UPDATED_AT', scanLimit,
          { ACTION: 'sync_report_summary' },
        ),
      });
    }
    const candidates = fairBoundedCandidates(lanes, scanLimit);
    const results = [];
    for (const operation of candidates) {
      let summary = null;
      let result;
      try {
        summary = parseJsonColumn(operation.OPERATION_PAYLOAD_JSON, 'OPERATION_PAYLOAD_JSON');
        const identity = reportSummaryIdentity(config, summary);
        invariant(operation.ACTION === 'sync_report_summary'
          && operation.OPERATION_KEY === identity.operationKey
          && operation.OPERATION_FINGERPRINT === identity.operationFingerprint
          && operation.SOURCE_ENVIRONMENT === config.environment
          && /^[1-9][0-9]{7,29}$/.test(String(summary.dealId ?? ''))
          && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(String(summary.deploymentId ?? '')),
        'REPORT_DATA_INVALID', 'CRM report dispatch operation is invalid.');
        await crmSummaryDispatcher.dispatch(summary.dealId, operation.OPERATION_KEY);
        const readback = await store.unique(
          config.tables.OPERATION_TABLE, 'OPERATION_KEY', operation.OPERATION_KEY,
        );
        if (readback?.STATUS === 'completed'
          && readback.LAST_OUTCOME === 'report_summary_readback_confirmed'
          && readback.OPERATION_FINGERPRINT === operation.OPERATION_FINGERPRINT
          && readback.OPERATION_PAYLOAD_JSON === operation.OPERATION_PAYLOAD_JSON
          && readback.ACTION === operation.ACTION
          && readback.CRM_DEAL_ID === operation.CRM_DEAL_ID && summary) {
          await reconcileTerminalDeployment(summary.deploymentId);
          result = { status: 'Completed' };
        } else {
          throw new RevenueDeskError(
            'REPORT_RECONCILIATION_REQUIRED',
            'CRM report summary did not reach exact completed readback.',
            { httpStatus: 503, retryable: true },
          );
        }
      } catch (error) {
        result = { status: 'Failed', errorCode: durableErrorCode(error) };
      }
      try {
        const current = await store.unique(
          config.tables.OPERATION_TABLE, 'OPERATION_KEY', operation.OPERATION_KEY,
        );
        if (current && current.ACTION === 'sync_report_summary'
          && REPORT_DISPATCH_STATES.includes(current.STATUS)) {
          await store.mutate(
            config.tables.OPERATION_TABLE,
            'OPERATION_KEY',
            operation.OPERATION_KEY,
            'OPERATION_VERSION',
            (row) => row.ACTION === 'sync_report_summary'
              && REPORT_DISPATCH_STATES.includes(row.STATUS)
              ? { UPDATED_AT: nextScanCursorTimestamp(
                row.UPDATED_AT, new Date(now()).toISOString(),
              ) } : null,
          );
        }
      } catch (error) {
        result = { status: 'Failed', errorCode: durableErrorCode(error) };
      }
      results.push(result);
    }
    return Object.freeze({ examined: candidates.length, results: Object.freeze(results) });
  }

  async function rebuildReport(deploymentId) {
    const id = validDeploymentId(deploymentId);
    await stopExpiredDeployment(id);
    const row = await store.unique(deploymentTable, 'DEPLOYMENT_ID', id);
    const deployment = await loadDeployment(store, row, config);
    const report = await buildReport(deployment);
    const settlement = deployment.testStatus === 'Completed'
      ? await terminalSettlement(deployment) : Object.freeze({ ready: false });
    const createdAt = new Date(now()).toISOString();
    await materializeReportArtifacts(deployment, row, report, createdAt, settlement.ready);
    return Object.freeze({
      status: deployment.testStatus === 'Completed' && !settlement.ready
        ? 'ReportRebuiltAwaitingSettlement' : 'ReportRebuilt',
      report,
      terminalSettlementReady: settlement.ready,
    });
  }

  async function reconcileDeployment(deploymentId) {
    const terminal = await reconcileTerminalDeployment(deploymentId);
    invariant(terminal.status === 'TerminalReportReconciled',
      'REPORT_RECONCILIATION_REQUIRED', 'Deployment is not ready for terminal reconciliation.',
      { httpStatus: 503, retryable: true });
    return Object.freeze({
      status: 'DeploymentReconciled',
      deploymentId: terminal.report.deploymentId,
      handledCallCount: terminal.report.handledCallCount,
      notificationStateCount: Object.keys(terminal.report.notificationStates).length,
    });
  }

  async function readiness() {
    const base = await store.readiness();
    const rows = await store.queryBounded(
      deploymentTable,
      'SOURCE_REVISION',
      config.sourceRevision,
      'UPDATED_AT',
      READINESS_DEPLOYMENT_LIMIT,
    );
    const configurationRows = await store.queryBounded(
      config.tables.CONFIGURATION_VERSION_TABLE,
      'SOURCE_REVISION',
      config.sourceRevision,
      'CREATED_AT',
      READINESS_DEPLOYMENT_LIMIT,
    );
    const readinessScanCapped = Boolean(base.sourceDeploymentCountCapped)
      || rows.length === READINESS_DEPLOYMENT_LIMIT
      || configurationRows.length === READINESS_DEPLOYMENT_LIMIT;
    let activeDeploymentCount = 0;
    let terminalReconciliationPendingCount = readinessScanCapped ? 1 : 0;
    for (const row of rows) {
      let deployment;
      try {
        // Readiness uses the same exact immutable-version and authorization-receipt readback
        // as ingress; status strings or shallow row shape can never make a route ready.
        deployment = await loadDeployment(store, row, config);
      } catch (error) {
        if (!(error instanceof RevenueDeskError)) throw error;
        terminalReconciliationPendingCount += 1;
        continue;
      }
      const terminalFreeTest = deployment.engagementType === 'free_test'
        && deployment.testStatus === 'Completed';
      if (deployment.testStatus === CONTRACT.active_test_status) {
        if (Date.parse(deployment.expiresAt) <= now()) {
          terminalReconciliationPendingCount += 1;
        } else {
          activeDeploymentCount += 1;
        }
      } else if (terminalFreeTest && deployment.reportReconciliationStatus !== 'Completed') {
        terminalReconciliationPendingCount += 1;
      }
    }
    return Object.freeze({
      ...base,
      activeDeploymentCount,
      terminalReconciliationPendingCount,
      readinessScanCapped,
    });
  }

  return Object.freeze({
    resolveInbound,
    acceptEvent,
    processEventReceipt,
    retryDueEvents,
    retryDueNotifications,
    runRetryJob,
    rebuildReport,
    reconcileDeployment,
    reconcileDueDeployments,
    readiness,
  });
}

module.exports = {
  createRuntimeService, deploymentFromRow, loadDeployment, activeAt, resolverMetadata, unavailable,
  normalizeEventForReceipt, assertCanonicalCallIntegrity,
  boundedPendingDeployments,
};
