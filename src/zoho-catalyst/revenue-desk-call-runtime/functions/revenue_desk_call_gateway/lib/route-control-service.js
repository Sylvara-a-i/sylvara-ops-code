'use strict';

const {
  approvalIntentSignature,
  activationIntentSignature,
  authorizationReceiptRow,
  evaluateActivationTransition,
  evaluateApprovalTransition,
  routeFingerprint,
  routeFromRows,
} = require('./approval-control');
const { validateConfigurationVersionRow } = require('./configuration-version');
const { ROLLBACK_CONTROL_REASON_TO_CRM, STOP_REASON_TO_CRM } = require('./contracts');
const { RevenueDeskError, invariant } = require('./errors');
const { keyedDigest, numberLookupKey } = require('./security');
const { E164_PATTERN, validateConfiguration } = require('./validation');
const {
  verifyAuthorizationReceiptIntegrity,
} = require('./authorization-receipt');

const CRM_ID = /^[1-9][0-9]{7,29}$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const IDEMPOTENCY_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const APPROVAL_EVENT_PATTERN = /^approval_[a-f0-9]{64}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const OPERATOR_HASH_PATTERN = /^operator_[a-f0-9]{64}$/;
const ROLLBACK_REASON_TO_CRM = Object.freeze(Object.fromEntries(
  ROLLBACK_CONTROL_REASON_TO_CRM,
));
const ROLLBACK_REASONS = new Set(Object.keys(ROLLBACK_REASON_TO_CRM));
const CRM_END_REASONS = new Set(STOP_REASON_TO_CRM.values());
if (!Object.values(ROLLBACK_REASON_TO_CRM).every((reason) => CRM_END_REASONS.has(reason))) {
  throw new Error('Rollback reason mapping contains an unsupported CRM picklist value.');
}
const RUNTIME_TERMINAL_REASONS = new Set([
  'call_limit_reached',
  'seven_day_limit_reached',
]);
const RUNTIME_TERMINAL_REPORT_STATES = new Set([
  'Pending',
  'AwaitingSettlement',
  'Completed',
]);
const DEPLOYMENT_CAS_FIELDS = Object.freeze([
  'DEPLOYMENT_KEY', 'NUMBER_LOOKUP_HASH', 'BINDING_ID', 'BINDING_VERSION', 'CLIENT_ID',
  'DEPLOYMENT_ID', 'ACTIVE_CONFIGURATION_VERSION_ID', 'APPROVED_CONFIGURATION_VERSION_ID',
  'APPROVAL_EVENT_KEY', 'APPROVED_ROUTE_FINGERPRINT', 'GO_LIVE_APPROVED_AT',
  'ACTIVATION_EVENT_KEY', 'MONITOR_AGENT_ID', 'MONITOR_AGENT_VERSION', 'COVERAGE_MODE',
  'TEST_STATUS', 'GO_LIVE_APPROVAL_STATUS', 'APPROVED_START_AT', 'ACTUAL_START_AT',
  'EXPIRES_AT', 'CALL_LIMIT', 'HANDLED_COUNT', 'COUNT_VERSION',
  'COUNTED_CALL_KEYS_JSON', 'STOP_REASON', 'STOPPED_AT',
  'REPORT_RECONCILIATION_STATUS', 'REPORT_RECONCILIATION_VERSION',
  'SOURCE_REVISION', 'SOURCE_ENVIRONMENT', 'UPDATED_AT',
]);
const RUNTIME_OWNED_DEPLOYMENT_FIELDS = new Set([
  'HANDLED_COUNT', 'COUNTED_CALL_KEYS_JSON', 'COUNT_VERSION', 'UPDATED_AT',
  'REPORT_RECONCILIATION_STATUS', 'REPORT_RECONCILIATION_VERSION',
]);
const CONTROL_OWNED_DEPLOYMENT_FIELDS = Object.freeze(DEPLOYMENT_CAS_FIELDS.filter(
  (field) => !RUNTIME_OWNED_DEPLOYMENT_FIELDS.has(field),
));

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, fields, code = 'INVALID_CONTROL_REQUEST') {
  invariant(plain(value), code, 'Control request must be an object.', { httpStatus: 400 });
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  invariant(actual.length === expected.length
    && actual.every((field, index) => field === expected[index]),
  code, 'Control request fields are invalid.', { httpStatus: 400 });
}

function validateCommand(action, body) {
  invariant(new Set(['approve', 'activate', 'rollback']).has(action),
    'INVALID_CONTROL_ACTION', 'Control action is invalid.', { httpStatus: 404 });
  const fields = ['dealId', 'journeyId', 'deploymentId', 'configurationVersionId',
    'idempotencyKey'];
  if (action === 'rollback') fields.push('reason');
  exactKeys(body, fields);
  invariant(CRM_ID.test(body.dealId || '')
    && OPAQUE_ID.test(body.journeyId || '')
    && OPAQUE_ID.test(body.deploymentId || '')
    && OPAQUE_ID.test(body.configurationVersionId || '')
    && IDEMPOTENCY_ID.test(body.idempotencyKey || ''),
  'INVALID_CONTROL_REQUEST', 'Control request identity is invalid.', { httpStatus: 400 });
  if (action === 'rollback') invariant(ROLLBACK_REASONS.has(body.reason),
    'INVALID_CONTROL_REQUEST', 'Rollback reason is invalid.', { httpStatus: 400 });
  return Object.freeze({ ...body });
}

function same(actual, expected) {
  if (typeof expected === 'number') return Number(actual) === expected;
  if (typeof expected === 'boolean') return actual === expected
    || String(actual).toLowerCase() === String(expected);
  return (actual === undefined ? null : actual) === expected;
}

function fullDeploymentPrestate(row) {
  invariant(plain(row) && /^[0-9]{1,30}$/.test(String(row.ROWID || '')),
    'CONTROL_STATE_INVALID', 'Deployment row is unavailable.', { httpStatus: 503 });
  return Object.fromEntries(DEPLOYMENT_CAS_FIELDS.map((field) => [
    field, row[field] === undefined ? null : row[field],
  ]));
}

function verifyPatch(row, patch) {
  invariant(plain(row) && Object.entries(patch).every(([field, value]) => same(row[field], value)),
    'CONTROL_CAS_CONFLICT', 'Deployment transition did not read back exactly.',
    { httpStatus: 503, retryable: true, ambiguous: true });
}

function verifyControlPatch(row, patch) {
  const controlPatch = Object.fromEntries(Object.entries(patch).filter(
    ([field]) => CONTROL_OWNED_DEPLOYMENT_FIELDS.includes(field),
  ));
  invariant(Object.keys(controlPatch).length > 0
    && Object.entries(controlPatch).every(([field, value]) => same(row[field], value)),
  'CONTROL_CAS_CONFLICT', 'Deployment control transition did not read back exactly.',
  { httpStatus: 503, retryable: true, ambiguous: true });
}

function eventFromReceipt(receipt, config) {
  invariant(plain(receipt) && receipt.RECEIPT_KIND === 'authorization_event'
    && receipt.STATUS === 'Completed' && typeof receipt.EVENT_DATA_JSON === 'string',
  'CONTROL_AUDIT_INVALID', 'Authorization history is invalid.', { httpStatus: 503 });
  const { data, event } = verifyAuthorizationReceiptIntegrity(
    receipt, config.eventChainSecret, {
      code: 'CONTROL_AUDIT_INVALID',
      message: 'Authorization history failed integrity verification.',
    },
  );
  invariant(data.schemaVersion === 1,
    'CONTROL_AUDIT_INVALID', 'Authorization history payload is invalid.', { httpStatus: 503 });
  return event;
}

function receiptData(receipt, config) {
  return verifyAuthorizationReceiptIntegrity(receipt, config.eventChainSecret, {
    code: 'CONTROL_AUDIT_INVALID',
    message: 'Authorization history failed integrity verification.',
  }).data;
}

function exactTimestamp(value) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validateCompletedApprovalReceipt(receipt, {
  command, deployment, configurationRow, expectedRouteFingerprint, config,
}) {
  const { data, event } = verifyAuthorizationReceiptIntegrity(
    receipt, config.eventChainSecret, {
      code: 'CONTROL_AUDIT_INVALID',
      message: 'The completed approval receipt failed integrity verification.',
    },
  );
  const binding = data.controlBinding;
  const evidenceAt = Date.parse(data.evidenceObservedAt);
  const decidedAt = Date.parse(data.decidedAt);
  invariant(plain(receipt)
    && receipt.RECEIPT_KIND === 'authorization_event'
    && receipt.STATUS === 'Completed'
    && Number(receipt.RECEIPT_VERSION) === 1
    && Number(receipt.ATTEMPT_COUNT) === 0
    && (receipt.CALL_KEY === null || receipt.CALL_KEY === undefined)
    && (receipt.CORRELATION_ID === null || receipt.CORRELATION_ID === undefined)
    && (receipt.ROUTE_READBACK_FINGERPRINT === null
      || receipt.ROUTE_READBACK_FINGERPRINT === undefined)
    && (receipt.RELATED_EVENT_KEY === null || receipt.RELATED_EVENT_KEY === undefined)
    && [null, undefined].includes(receipt.LEASE_TOKEN)
    && (receipt.LEASE_EXPIRES_AT === null || receipt.LEASE_EXPIRES_AT === undefined)
    && (receipt.JOB_REFERENCE === null || receipt.JOB_REFERENCE === undefined)
    && (receipt.ENQUEUED_AT === null || receipt.ENQUEUED_AT === undefined)
    && (receipt.NEXT_ATTEMPT_AT === null || receipt.NEXT_ATTEMPT_AT === undefined)
    && (receipt.LAST_ERROR_CODE === null || receipt.LAST_ERROR_CODE === undefined)
    && APPROVAL_EVENT_PATTERN.test(receipt.EVENT_KEY || '')
    && receipt.EVENT_KEY === deployment.APPROVAL_EVENT_KEY
    && receipt.EVENT_TYPE === 'approve'
    && receipt.DEPLOYMENT_ID === command.deploymentId
    && receipt.CONFIGURATION_VERSION_ID === command.configurationVersionId
    && receipt.ROUTE_FINGERPRINT === expectedRouteFingerprint
    && receipt.SOURCE_REVISION === config.sourceRevision
    && receipt.SOURCE_ENVIRONMENT === config.environment
    && data.schemaVersion === 1
    && data.action === 'approve'
    && data.decision === 'Approved'
    && data.configurationVersionId === command.configurationVersionId
    && data.routeFingerprint === expectedRouteFingerprint
    && data.operatorIdHash === config.operatorIdHash
    && OPERATOR_HASH_PATTERN.test(data.operatorIdHash || '')
    && HASH_PATTERN.test(data.intentFingerprint || '')
    && data.evidenceRevision === config.sourceRevision
    && exactTimestamp(data.evidenceObservedAt)
    && exactTimestamp(data.decidedAt)
    && evidenceAt <= decidedAt
    && decidedAt - evidenceAt <= 3_600_000
    && Number.isSafeInteger(data.expectedDeploymentVersion)
    && data.expectedDeploymentVersion >= 0
    && Number(deployment.COUNT_VERSION) >= data.expectedDeploymentVersion + 1
    && Number.isSafeInteger(data.capacityRemainingAtDecision)
    && data.capacityRemainingAtDecision >= 1
    && (data.previousEventHash === 'genesis'
      || HASH_PATTERN.test(data.previousEventHash || ''))
    && HASH_PATTERN.test(data.eventHash || '')
    && data.decidedAt === deployment.GO_LIVE_APPROVED_AT
    && receipt.RECEIVED_AT === data.decidedAt
    && receipt.PROCESSED_AT === data.decidedAt
    && data.approvalEventKey === null
    && data.routeReadbackFingerprint === null
    && data.routeObservedAt === null
    && data.actualStartAt === null
    && data.expiresAt === null
    && binding.action === 'approve'
    && binding.dealId === command.dealId
    && binding.journeyId === command.journeyId
    && binding.deploymentId === command.deploymentId
    && binding.configurationVersionId === command.configurationVersionId
    && binding.reason === null
    && binding.deploymentControlPrestateDigest === null
    && binding.deploymentControlPoststateDigest === null
    && deployment.DEPLOYMENT_ID === command.deploymentId
    && deployment.APPROVED_CONFIGURATION_VERSION_ID === command.configurationVersionId
    && deployment.APPROVED_ROUTE_FINGERPRINT === expectedRouteFingerprint
    && deployment.GO_LIVE_APPROVAL_STATUS === 'Approved'
    && configurationRow.CONFIGURATION_VERSION_ID === command.configurationVersionId
    && configurationRow.DEPLOYMENT_ID === command.deploymentId
    && configurationRow.SOURCE_REVISION === config.sourceRevision
    && configurationRow.SOURCE_ENVIRONMENT === config.environment,
  'CONTROL_AUDIT_INVALID',
  'The completed approval receipt does not match the activation target.',
  { httpStatus: 503 });
  return Object.freeze({ receipt, data, event });
}

function canonicalControlState(row) {
  invariant(plain(row), 'CONTROL_STATE_INVALID', 'Deployment control state is unavailable.',
    { httpStatus: 503 });
  return JSON.stringify(Object.fromEntries(CONTROL_OWNED_DEPLOYMENT_FIELDS.map((field) => [
    field, row[field] === undefined ? null : row[field],
  ])));
}

function deploymentControlDigest(secret, row) {
  return `control_${keyedDigest(secret, 'revenue-desk-route-control-state-v1', [
    canonicalControlState(row),
  ])}`;
}

function controlBinding(action, command, {
  deploymentControlPrestateDigest = null,
  deploymentControlPoststateDigest = null,
} = {}) {
  return Object.freeze({
    schemaVersion: 1,
    action,
    dealId: command.dealId,
    journeyId: command.journeyId,
    deploymentId: command.deploymentId,
    configurationVersionId: command.configurationVersionId,
    idempotencyKey: command.idempotencyKey,
    reason: action === 'rollback' ? command.reason : null,
    deploymentControlPrestateDigest,
    deploymentControlPoststateDigest,
  });
}

function assertReceiptCommand(receipt, action, command, config) {
  const data = receiptData(receipt, config);
  const binding = data.controlBinding;
  const eventAction = action === 'rollback' ? 'revoke' : action;
  invariant(receipt.RECEIPT_KIND === 'authorization_event'
    && Number(receipt.RECEIPT_VERSION) === 1
    && receipt.EVENT_KEY === eventKey(config, action, command.idempotencyKey)
    && receipt.EVENT_TYPE === eventAction
    && receipt.DEPLOYMENT_ID === command.deploymentId
    && receipt.CONFIGURATION_VERSION_ID === command.configurationVersionId
    && receipt.ROUTE_FINGERPRINT === data.routeFingerprint
    && (receipt.ROUTE_READBACK_FINGERPRINT ?? null)
      === (data.routeReadbackFingerprint ?? null)
    && (receipt.RELATED_EVENT_KEY ?? null) === (data.approvalEventKey ?? null)
    && receipt.SOURCE_REVISION === config.sourceRevision
    && receipt.SOURCE_ENVIRONMENT === config.environment
    && (receipt.CALL_KEY === null || receipt.CALL_KEY === undefined)
    && (receipt.CORRELATION_ID === null || receipt.CORRELATION_ID === undefined)
    && receipt.RECEIVED_AT === data.decidedAt
    && data.schemaVersion === 1
    && data.action === eventAction
    && data.configurationVersionId === command.configurationVersionId
    && binding.schemaVersion === 1
    && binding.action === action
    && binding.dealId === command.dealId
    && binding.journeyId === command.journeyId
    && binding.deploymentId === command.deploymentId
    && binding.configurationVersionId === command.configurationVersionId
    && binding.idempotencyKey === command.idempotencyKey
    && binding.reason === (action === 'rollback' ? command.reason : null)
    && binding.configurationVersionId === command.configurationVersionId,
  'CONTROL_IDEMPOTENCY_CONFLICT', 'Control idempotency key is bound to another command.',
  { httpStatus: 409 });
  return data;
}

function decisionPatch(action, receipt, command, config) {
  const data = assertReceiptCommand(receipt, action, command, config);
  const expectedVersion = Number(data.expectedDeploymentVersion);
  invariant(Number.isSafeInteger(expectedVersion) && expectedVersion >= 0
    && Number.isFinite(Date.parse(data.decidedAt)),
  'CONTROL_AUDIT_INVALID', 'Authorization receipt cannot be resumed.', { httpStatus: 503 });
  if (action === 'approve') {
    invariant(data.action === 'approve' && data.decision === 'Approved',
      'CONTROL_AUDIT_INVALID', 'Approval receipt is invalid.', { httpStatus: 503 });
    return Object.freeze({
      GO_LIVE_APPROVAL_STATUS: 'Approved', TEST_STATUS: 'Scheduled',
      APPROVED_CONFIGURATION_VERSION_ID: command.configurationVersionId,
      APPROVAL_EVENT_KEY: receipt.EVENT_KEY,
      APPROVED_ROUTE_FINGERPRINT: data.routeFingerprint,
      GO_LIVE_APPROVED_AT: data.decidedAt, UPDATED_AT: data.decidedAt,
      COUNT_VERSION: expectedVersion + 1,
    });
  }
  if (action === 'activate') {
    invariant(data.action === 'activate' && data.decision === 'Activated'
      && Number.isFinite(Date.parse(data.actualStartAt))
      && Number.isFinite(Date.parse(data.expiresAt)),
    'CONTROL_AUDIT_INVALID', 'Activation receipt is invalid.', { httpStatus: 503 });
    return Object.freeze({
      TEST_STATUS: 'Live', ACTIVATION_EVENT_KEY: receipt.EVENT_KEY,
      ACTUAL_START_AT: data.actualStartAt, EXPIRES_AT: data.expiresAt,
      UPDATED_AT: data.decidedAt, COUNT_VERSION: expectedVersion + 1,
    });
  }
  invariant(data.action === 'revoke' && data.decision === 'Revoked',
    'CONTROL_AUDIT_INVALID', 'Rollback receipt is invalid.', { httpStatus: 503 });
  return Object.freeze({
    GO_LIVE_APPROVAL_STATUS: 'Revoked', TEST_STATUS: 'Stopped',
    STOP_REASON: command.reason, STOPPED_AT: data.decidedAt,
    UPDATED_AT: data.decidedAt, COUNT_VERSION: expectedVersion + 1,
  });
}

function eventKey(config, action, idempotencyKey) {
  const prefix = action === 'activate' ? 'activation' : 'approval';
  return `${prefix}_${keyedDigest(config.eventChainSecret,
    'revenue-desk-route-control-idempotency-v1', [action, idempotencyKey])}`;
}

function rollbackClaimPayload(command) {
  return Object.freeze({
    schemaVersion: 1,
    action: 'rollback_claim',
    dealId: command.dealId,
    journeyId: command.journeyId,
    deploymentId: command.deploymentId,
    configurationVersionId: command.configurationVersionId,
    idempotencyKey: command.idempotencyKey,
    reason: command.reason,
  });
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function crmEndReason(internalReason) {
  const reason = ROLLBACK_REASON_TO_CRM[internalReason]
    || STOP_REASON_TO_CRM.get(internalReason);
  invariant(CRM_END_REASONS.has(reason),
    'CONTROL_STATE_INVALID', 'Deployment stop reason has no CRM mapping.',
    { httpStatus: 503 });
  return reason;
}

function lookupId(value) {
  return plain(value) ? value.id : null;
}

function optionalText(value) {
  return value === null || value === undefined || value === '' ? null : value;
}

function exactPhone(value, expected) {
  return expected === null
    ? optionalText(value) === null
    : E164_PATTERN.test(value || '') && value === expected;
}

function dealValueMatchesConfiguration(deal, configuration) {
  const noAnswerMatches = configuration.coverageMode === 'AfterHoursOnly'
    ? deal.No_Answer_Delay === null || deal.No_Answer_Delay === undefined
    : Number(deal.No_Answer_Delay) === configuration.noAnswerDelay;
  return deal.Approved_Test_Route === configuration.approvedTestRoute
    && noAnswerMatches
    && deal.Forwarding_Administrator_Name === configuration.forwardingAdministratorName
    && exactPhone(deal.Forwarding_Administrator_Mobile,
      configuration.forwardingAdministratorMobile)
    && deal.Approved_Fallback_Destination === configuration.approvedFallbackDestination
    && exactPhone(deal.Approved_Fallback_Number, configuration.approvedFallbackNumber)
    && deal.Rollback_Contact_Name === configuration.rollbackContactName
    && exactPhone(deal.Rollback_Contact_Mobile, configuration.rollbackContactMobile)
    && deal.Alert_Recipient_Name === configuration.notificationRecipient.name
    && optionalText(deal.Alert_Recipient_Email) === configuration.notificationRecipient.email
    && exactPhone(deal.Alert_Recipient_Mobile, configuration.notificationRecipient.mobile);
}

function validateDealBinding(deal, command, configurationVersion) {
  invariant(plain(deal) && String(deal.id) === command.dealId
    && deal.Pipeline === 'Revenue Desk Sales'
    && deal.Entry_Offer === '7-Day Revenue Leak Test'
    && deal.Intake_Submission_ID === command.journeyId
    && CRM_ID.test(lookupId(deal.Account_Name) || '')
    && CRM_ID.test(lookupId(deal.Contact_Name) || '')
    && deal.Setup_Access_Status === 'Submitted'
    && hasText(deal.Setup_Access_Verified_At)
    && deal.Setup_Form_Submission_ID === configurationVersion.setupFormSubmissionId
    && deal.Setup_Form_Version === configurationVersion.setupFormVersion
    && hasText(deal.Setup_Form_Submitted_At)
    && deal.Authorized_Representative_Confirmed === true
    && deal.Test_Scope_Accepted === true
    && hasText(deal.Authority_Confirmed_At)
    && hasText(deal.Test_Scope_Accepted_At)
    && deal.Deployment_Record_ID === command.deploymentId
    && deal.Configuration_Version === command.configurationVersionId
    && dealValueMatchesConfiguration(deal, configurationVersion),
  'CONTROL_PRECONDITION_FAILED', 'CRM journey is incomplete or does not match the immutable configuration.',
  { httpStatus: 409 });
}

function validateDealBase(deal, command, configurationVersion) {
  validateDealBinding(deal, command, configurationVersion);
  invariant(deal.Stage === 'Setup and QA',
    'CONTROL_PRECONDITION_FAILED', 'CRM journey is not at the setup control stage.',
    { httpStatus: 409 });
}

function validateApprovalDeal(deal, command, configuration) {
  validateDealBase(deal, command, configuration);
  invariant(deal.Test_Status === 'Setup Pending'
    && deal.Go_Live_Approval_Status !== 'Approved'
    && !deal.Go_Live_Approved_At
    && !deal.Approved_Deployment_Record_ID
    && !deal.Approved_Configuration_Version
    && !deal.Test_Start_At && !deal.Test_End_At,
  'CONTROL_PRECONDITION_FAILED', 'CRM journey is not awaiting configuration approval.',
  { httpStatus: 409 });
}

function validateAssignedTestNumber(deal, deployment, runtimeConfig) {
  invariant(runtimeConfig.retellRouteMode === 'isolated_test'
    && E164_PATTERN.test(runtimeConfig.retellPhoneNumber || '')
    && E164_PATTERN.test(deal.Test_Phone_Number || '')
    && deal.Test_Phone_Number === runtimeConfig.retellPhoneNumber
    && deployment.NUMBER_LOOKUP_HASH === numberLookupKey(
      runtimeConfig.numberSecret,
      runtimeConfig.retellPhoneNumber,
    ),
  'ISOLATED_RETELL_TEST_NUMBER_REQUIRED',
  'An isolated Retell Development test number is required.', { httpStatus: 409 });
}

function validateActivationDeal(deal, command, configuration, deployment, runtimeConfig) {
  validateDealBase(deal, command, configuration);
  validateAssignedTestNumber(deal, deployment, runtimeConfig);
  invariant(deal.Test_Status === 'Scheduled'
    && deal.Go_Live_Approval_Status === 'Approved'
    && hasText(deal.Go_Live_Approved_At)
    && deal.Approved_Deployment_Record_ID === command.deploymentId
    && deal.Approved_Configuration_Version === command.configurationVersionId
    && !deal.Test_Start_At && !deal.Test_End_At,
  'CONTROL_PRECONDITION_FAILED', 'CRM journey is not awaiting activation.',
  { httpStatus: 409 });
}

function validateReplayDeal(action, deal, command, configuration, deployment, runtimeConfig) {
  validateDealBinding(deal, command, configuration);
  if (action === 'activate' && deployment.TEST_STATUS !== 'Stopped') {
    validateAssignedTestNumber(deal, deployment, runtimeConfig);
  }
  const approved = deal.Go_Live_Approval_Status === 'Approved'
    && deal.Approved_Deployment_Record_ID === command.deploymentId
    && deal.Approved_Configuration_Version === command.configurationVersionId
    && hasText(deal.Go_Live_Approved_At);
  const awaitingApproval = deal.Stage === 'Setup and QA'
    && deal.Test_Status === 'Setup Pending' && deal.Go_Live_Approval_Status !== 'Approved'
    && !deal.Test_Start_At && !deal.Test_End_At;
  const awaitingActivation = deal.Stage === 'Setup and QA'
    && deal.Test_Status === 'Scheduled' && approved
    && (!deal.Test_Start_At || deal.Test_Start_At === deployment.ACTUAL_START_AT)
    && !deal.Test_End_At;
  const active = deal.Stage === 'Test Live' && deal.Test_Status === 'Live' && approved
    && deal.Test_Start_At === deployment.ACTUAL_START_AT && !deal.Test_End_At;
  const partialRollback = action === 'rollback'
    && new Set(['Setup and QA', 'Test Live', 'Results Review']).has(deal.Stage)
    && approved
    && deployment.TEST_STATUS === 'Stopped'
    && deployment.STOP_REASON === command.reason
    && deal.Rollback_Completed_At === deployment.STOPPED_AT
    && deal.Test_End_At === deployment.STOPPED_AT
    && deal.Test_End_Reason === crmEndReason(command.reason);
  const stopped = deal.Stage === 'Closed Lost'
    && deal.Rollback_Completed_At === deployment.STOPPED_AT
    && deal.Test_End_At === deployment.STOPPED_AT
    && deal.Test_End_Reason === crmEndReason(deployment.STOP_REASON)
    && (action !== 'rollback' || deployment.STOP_REASON === command.reason);
  const valid = action === 'approve'
    ? awaitingApproval || awaitingActivation || active || stopped
    : action === 'activate'
      ? awaitingActivation || active || stopped
      : awaitingActivation || active || partialRollback || stopped;
  invariant(valid, 'CONTROL_PRECONDITION_FAILED',
    'CRM journey state no longer matches the control receipt.', { httpStatus: 409 });
}

function validateRollbackDeal(deal, command, configuration, deployment) {
  validateDealBinding(deal, command, configuration);
  invariant(!hasText(deal.Billing_Subscription_ID),
    'CONTROL_PRECONDITION_FAILED',
    'A deployment with a Billing subscription cannot use Free Test rollback.',
    { httpStatus: 409 });
  const approved = deal.Go_Live_Approval_Status === 'Approved'
    && deal.Approved_Deployment_Record_ID === command.deploymentId
    && deal.Approved_Configuration_Version === command.configurationVersionId;
  const beforeStop = new Set(['Setup and QA', 'Test Live', 'Results Review']).has(deal.Stage)
    && approved && !deal.Test_End_At;
  const afterStop = deal.Stage === 'Closed Lost'
    && deal.Rollback_Completed_At === deployment.STOPPED_AT
    && deal.Test_End_At === deployment.STOPPED_AT
    && deal.Test_End_Reason === crmEndReason(command.reason)
    && deployment.STOP_REASON === command.reason;
  invariant(beforeStop || afterStop, 'CONTROL_PRECONDITION_FAILED',
    'CRM journey is not bound to a safe rollback state.', { httpStatus: 409 });
}

function parseConfiguration(row, command, sourceRevision, deployment) {
  const version = validateConfigurationVersionRow(row, {
    code: 'CONTROL_PRECONDITION_FAILED',
    expectedDeploymentId: command.deploymentId,
    expectedEnvironment: 'development',
    expectedSourceRevision: sourceRevision,
  });
  invariant(version.configurationVersionId === command.configurationVersionId,
    'CONTROL_PRECONDITION_FAILED', 'Configuration-version identity does not match.',
    { httpStatus: 409 });
  let parsed;
  try { parsed = JSON.parse(version.configurationJson); } catch (_) { parsed = null; }
  const configuration = validateConfiguration(parsed);
  invariant(deployment && configuration.clientId === deployment.CLIENT_ID
    && configuration.crmDealId === command.dealId
    && configuration.deploymentId === command.deploymentId
    && configuration.configurationVersion === command.configurationVersionId
    && configuration.approved === true
    && configuration.authorizedRepresentativeConfirmed === true
    && configuration.testScopeAccepted === true,
  'CONTROL_PRECONDITION_FAILED', 'Immutable configuration is not approved for this journey.',
  { httpStatus: 409 });
  return configuration;
}

function createRouteControlService({
  config, store, crm, provider, now = Date.now,
  onActivationCheckpoint = async () => {},
  onActivationContainmentCheckpoint = async () => {},
  onRollbackCheckpoint = async () => {},
}) {
  invariant(config?.environment === 'development' && config?.deploymentMode === 'active',
    'PRODUCTION_DARK', 'Route control is Development-only.', { httpStatus: 503 });
  invariant(store && crm && provider, 'INVALID_RUNTIME_CONFIGURATION',
    'Route-control dependencies are unavailable.', { httpStatus: 503 });
  const tables = config.tables;

  function rollbackClaimKey(deploymentId) {
    return `rollback_claim_${keyedDigest(
      config.eventChainSecret,
      'revenue-desk-rollback-claim-key-v1',
      [config.environment, config.sourceRevision, deploymentId],
    )}`;
  }

  function rollbackClaimFingerprint(serialized) {
    return keyedDigest(config.eventChainSecret, 'revenue-desk-rollback-claim-v1', [
      config.environment,
      config.sourceRevision,
      serialized,
    ]);
  }

  async function acquireRollbackClaim(command) {
    const payload = rollbackClaimPayload(command);
    const serialized = JSON.stringify(payload);
    const key = rollbackClaimKey(command.deploymentId);
    const fingerprint = rollbackClaimFingerprint(serialized);
    const observedAt = new Date(now()).toISOString();
    const input = {
      EVENT_KEY: key,
      RECEIPT_KIND: 'control_claim',
      CALL_KEY: null,
      PAYLOAD_FINGERPRINT: fingerprint,
      EVENT_TYPE: 'rollback_claim',
      EVENT_DATA_JSON: serialized,
      CORRELATION_ID: null,
      DEPLOYMENT_ID: command.deploymentId,
      CONFIGURATION_VERSION_ID: command.configurationVersionId,
      ROUTE_FINGERPRINT: null,
      ROUTE_READBACK_FINGERPRINT: null,
      RELATED_EVENT_KEY: null,
      STATUS: 'Prepared',
      RECEIPT_VERSION: 1,
      ATTEMPT_COUNT: 0,
      LEASE_TOKEN: null,
      LEASE_EXPIRES_AT: null,
      JOB_REFERENCE: null,
      ENQUEUED_AT: null,
      NEXT_ATTEMPT_AT: null,
      LAST_ERROR_CODE: null,
      RECEIVED_AT: observedAt,
      PROCESSED_AT: null,
      SOURCE_REVISION: config.sourceRevision,
      SOURCE_ENVIRONMENT: config.environment,
    };
    const existing = await store.unique(tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', key);
    if (existing) {
      invariant(existing.RECEIPT_KIND === 'control_claim'
        && existing.EVENT_TYPE === 'rollback_claim'
        && existing.DEPLOYMENT_ID === command.deploymentId
        && existing.CONFIGURATION_VERSION_ID === command.configurationVersionId
        && existing.PAYLOAD_FINGERPRINT === fingerprint
        && existing.EVENT_DATA_JSON === serialized
        && existing.SOURCE_REVISION === config.sourceRevision
        && existing.SOURCE_ENVIRONMENT === config.environment
        && Number(existing.RECEIPT_VERSION) === 1
        && new Set(['Prepared', 'Completed', 'ReconciliationRequired'])
          .has(existing.STATUS),
      'CONTROL_IDEMPOTENCY_CONFLICT',
      'Deployment rollback is already claimed by another command.',
      { httpStatus: 409 });
      return existing;
    }
    const inserted = await store.insertUnique(
      tables.EVENT_RECEIPT_TABLE,
      'EVENT_KEY',
      input,
      [
        'EVENT_KEY', 'RECEIPT_KIND', 'PAYLOAD_FINGERPRINT', 'EVENT_TYPE',
        'EVENT_DATA_JSON', 'DEPLOYMENT_ID', 'CONFIGURATION_VERSION_ID',
        'SOURCE_REVISION', 'SOURCE_ENVIRONMENT',
      ],
    );
    invariant(inserted.row?.STATUS === 'Prepared'
      && inserted.row.PAYLOAD_FINGERPRINT === fingerprint,
    'CONTROL_AUDIT_INCOMPLETE', 'Rollback claim did not read back exactly.',
    { httpStatus: 503, ambiguous: true });
    return inserted.row;
  }

  async function activeRollbackClaims(deploymentId) {
    const rows = await store.queryBounded(
      tables.EVENT_RECEIPT_TABLE,
      'DEPLOYMENT_ID',
      deploymentId,
      'RECEIVED_AT',
      100,
      { RECEIPT_KIND: 'control_claim' },
    );
    invariant(rows.length < 100,
      'CONTROL_AUDIT_INVALID', 'Rollback claim inventory is incomplete.',
      { httpStatus: 503 });
    return rows.filter((row) => new Set([
      'Prepared', 'Completed', 'ReconciliationRequired',
    ]).has(row.STATUS));
  }

  async function assertNoActiveRollbackClaim(command) {
    const claims = await activeRollbackClaims(command.deploymentId);
    invariant(claims.length === 0,
      'ACTIVATION_SUPERSEDED_BY_ROLLBACK',
      'A deployment-bound rollback claim blocks activation.',
      { httpStatus: 409 });
  }

  async function setRollbackClaimStatus(claim, status, errorCode = null) {
    invariant(claim?.RECEIPT_KIND === 'control_claim'
      && claim.EVENT_TYPE === 'rollback_claim'
      && new Set(['Prepared', 'Completed', 'ReconciliationRequired']).has(claim.STATUS)
      && new Set(['Completed', 'ReconciliationRequired']).has(status),
    'CONTROL_AUDIT_INVALID', 'Rollback claim state is invalid.',
    { httpStatus: 503 });
    if (claim.STATUS === status
      && (errorCode === null || claim.LAST_ERROR_CODE === errorCode)) return claim;
    const changed = await store.conditionalUpdate(
      tables.EVENT_RECEIPT_TABLE,
      claim.ROWID,
      {
        STATUS: status,
        PROCESSED_AT: new Date(now()).toISOString(),
        LAST_ERROR_CODE: errorCode,
      },
      {
        EVENT_KEY: claim.EVENT_KEY,
        STATUS: claim.STATUS,
        PAYLOAD_FINGERPRINT: claim.PAYLOAD_FINGERPRINT,
        RECEIPT_VERSION: 1,
      },
    );
    if (changed?.STATUS === status && changed.LAST_ERROR_CODE === errorCode) {
      return changed;
    }
    const current = await store.unique(
      tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', claim.EVENT_KEY,
    );
    invariant(current?.EVENT_KEY === claim.EVENT_KEY
      && current.PAYLOAD_FINGERPRINT === claim.PAYLOAD_FINGERPRINT
      && current.STATUS === status
      && current.LAST_ERROR_CODE === errorCode,
    'CONTROL_AUDIT_INCOMPLETE', 'Rollback claim did not finalize exactly.',
    { httpStatus: 503, ambiguous: true });
    return current;
  }

  function isRuntimeTerminalRollbackSupersession(current, binding) {
    if (!plain(current) || !plain(binding)
      || current.TEST_STATUS !== 'Completed'
      || current.GO_LIVE_APPROVAL_STATUS !== 'Approved'
      || !RUNTIME_TERMINAL_REASONS.has(current.STOP_REASON)
      || !Number.isFinite(Date.parse(current.STOPPED_AT))
      || !RUNTIME_TERMINAL_REPORT_STATES.has(current.REPORT_RECONCILIATION_STATUS)
      || !Number.isSafeInteger(Number(current.REPORT_RECONCILIATION_VERSION))
      || Number(current.REPORT_RECONCILIATION_VERSION) < 1) return false;
    // The runtime may win the shared version CAS only by completing the exact
    // previously-Live deployment. Reconstructing that prestate and matching
    // its bound HMAC prevents a terminal row from bypassing rollback identity.
    const reconstructedPrestate = {
      ...current,
      TEST_STATUS: 'Live',
      STOP_REASON: null,
      STOPPED_AT: null,
    };
    return deploymentControlDigest(config.eventChainSecret, reconstructedPrestate)
      === binding.deploymentControlPrestateDigest;
  }

  function activationBindingIsLive(deployment, receipt, data, command) {
    return plain(deployment)
      && deployment.TEST_STATUS === 'Live'
      && deployment.GO_LIVE_APPROVAL_STATUS === 'Approved'
      && deployment.ACTIVE_CONFIGURATION_VERSION_ID === command.configurationVersionId
      && deployment.APPROVED_CONFIGURATION_VERSION_ID === command.configurationVersionId
      && deployment.ACTIVATION_EVENT_KEY === receipt.EVENT_KEY
      && deployment.ACTUAL_START_AT === data.actualStartAt
      && deployment.EXPIRES_AT === data.expiresAt
      && Number.isFinite(Date.parse(deployment.ACTUAL_START_AT))
      && Number.isFinite(Date.parse(deployment.EXPIRES_AT));
  }

  function activationBindingIsRuntimeTerminal(deployment, receipt, data, command) {
    return plain(deployment)
      && deployment.TEST_STATUS === 'Completed'
      && deployment.GO_LIVE_APPROVAL_STATUS === 'Approved'
      && deployment.ACTIVE_CONFIGURATION_VERSION_ID === command.configurationVersionId
      && deployment.APPROVED_CONFIGURATION_VERSION_ID === command.configurationVersionId
      && deployment.ACTIVATION_EVENT_KEY === receipt.EVENT_KEY
      && deployment.ACTUAL_START_AT === data.actualStartAt
      && deployment.EXPIRES_AT === data.expiresAt
      && RUNTIME_TERMINAL_REASONS.has(deployment.STOP_REASON)
      && Number.isFinite(Date.parse(deployment.STOPPED_AT))
      && RUNTIME_TERMINAL_REPORT_STATES.has(deployment.REPORT_RECONCILIATION_STATUS)
      && Number.isSafeInteger(Number(deployment.REPORT_RECONCILIATION_VERSION))
      && Number(deployment.REPORT_RECONCILIATION_VERSION) >= 1;
  }

  function validateRuntimeTerminalReplayDeal(deal, command, configuration, deployment) {
    validateDealBinding(deal, command, configuration);
    const activeCrm = deal.Stage === 'Test Live'
      && deal.Test_Status === 'Live'
      && deal.Test_Start_At === deployment.ACTUAL_START_AT
      && !deal.Test_End_At;
    const terminalCrm = new Set(['Test Live', 'Results Review']).has(deal.Stage)
      && deal.Test_Status === 'Completed'
      && deal.Test_Start_At === deployment.ACTUAL_START_AT
      && deal.Test_End_At === deployment.STOPPED_AT
      && deal.Test_End_Reason === STOP_REASON_TO_CRM.get(deployment.STOP_REASON)
      && !deal.Rollback_Completed_At;
    invariant(activeCrm || terminalCrm,
      'CONTROL_PRECONDITION_FAILED',
      'CRM terminal state no longer matches the bound deployment.',
      { httpStatus: 409 });
  }

  async function applyRollbackDecision(deployment, patch, binding, command) {
    const rollbackPrestate = await restoreQuiescedActivationForRollback(
      deployment, binding, command,
    );
    const controlPatch = { ...patch };
    delete controlPatch.COUNT_VERSION;
    const poststate = await store.mutate(
      tables.DEPLOYMENT_TABLE,
      'DEPLOYMENT_ID',
      rollbackPrestate.DEPLOYMENT_ID,
      'COUNT_VERSION',
      (current) => {
        const currentDigest = deploymentControlDigest(config.eventChainSecret, current);
        if (currentDigest === binding.deploymentControlPoststateDigest) return null;
        if (isRuntimeTerminalRollbackSupersession(current, binding)) {
          throw new RevenueDeskError('ROLLBACK_SUPERSEDED_BY_RUNTIME_TERMINAL',
            'The runtime completed the deployment before rollback could commit.',
            { httpStatus: 409 });
        }
        invariant(currentDigest === binding.deploymentControlPrestateDigest,
          'CONTROL_STATE_INVALID',
          'Rollback control state changed after the audited decision.',
          { httpStatus: 503, ambiguous: true });
        return controlPatch;
      },
    );
    invariant(deploymentControlDigest(config.eventChainSecret, poststate)
      === binding.deploymentControlPoststateDigest,
    'CONTROL_CAS_CONFLICT', 'Rollback transition did not read back exactly.',
    { httpStatus: 503, retryable: true, ambiguous: true });
    verifyControlPatch(poststate, controlPatch);
    return poststate;
  }

  async function markControlReceiptReconciliation(receipt, error) {
    if (!receipt?.ROWID || receipt.STATUS === 'ReconciliationRequired') return receipt;
    invariant(new Set(['Prepared', 'Completed']).has(receipt.STATUS),
      'CONTROL_AUDIT_INCOMPLETE', 'Control receipt cannot enter reconciliation.',
      { httpStatus: 503, ambiguous: true });
    const errorCode = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.code)
      ? error.code : 'CONTROL_STATE_INVALID';
    const changed = await store.conditionalUpdate(tables.EVENT_RECEIPT_TABLE, receipt.ROWID, {
      STATUS: 'ReconciliationRequired', LAST_ERROR_CODE: errorCode,
      ...(receipt.STATUS === 'Prepared'
        ? { PROCESSED_AT: new Date(now()).toISOString() } : {}),
    }, {
      EVENT_KEY: receipt.EVENT_KEY, STATUS: receipt.STATUS,
      PAYLOAD_FINGERPRINT: receipt.PAYLOAD_FINGERPRINT, RECEIPT_VERSION: 1,
    });
    invariant(changed?.STATUS === 'ReconciliationRequired'
      && changed.LAST_ERROR_CODE === errorCode,
    'CONTROL_AUDIT_INCOMPLETE', 'Control receipt reconciliation did not read back exactly.',
    { httpStatus: 503, ambiguous: true });
    return changed;
  }

  async function quiescePreparedActivationForRollback(_deployment, command) {
    const rows = await store.queryBounded(
      tables.EVENT_RECEIPT_TABLE,
      'DEPLOYMENT_ID',
      command.deploymentId,
      'RECEIVED_AT',
      100,
      { RECEIPT_KIND: 'authorization_event' },
    );
    invariant(rows.length < 100,
      'CONTROL_AUDIT_INVALID', 'Activation receipt inventory is incomplete.',
      { httpStatus: 503 });
    const active = rows.filter((row) => row.EVENT_TYPE === 'activate'
      && new Set(['Prepared', 'Completed', 'ReconciliationRequired']).has(row.STATUS));
    invariant(active.length <= 1,
      'CONTROL_AUDIT_INVALID', 'Multiple activation decisions require reconciliation.',
      { httpStatus: 503 });
    if (active.length === 0) return [];
    let activationReceipt = active[0];
    invariant(activationReceipt.DEPLOYMENT_ID === command.deploymentId
      && activationReceipt.CONFIGURATION_VERSION_ID === command.configurationVersionId,
    'CONTROL_AUDIT_INVALID', 'Activation receipt does not match the rollback target.',
    { httpStatus: 503 });
    const activationData = receiptData(activationReceipt, config);
    const binding = activationData.controlBinding;
    invariant(binding.action === 'activate'
      && binding.dealId === command.dealId
      && binding.journeyId === command.journeyId
      && binding.deploymentId === command.deploymentId
      && binding.configurationVersionId === command.configurationVersionId,
    'CONTROL_AUDIT_INVALID', 'Activation receipt binding does not match rollback.',
    { httpStatus: 503 });
    const activationReceiptIdentity = Object.freeze({
      ROWID: activationReceipt.ROWID,
      EVENT_KEY: activationReceipt.EVENT_KEY,
      PAYLOAD_FINGERPRINT: activationReceipt.PAYLOAD_FINGERPRINT,
      EVENT_DATA_JSON: activationReceipt.EVENT_DATA_JSON,
      DEPLOYMENT_ID: activationReceipt.DEPLOYMENT_ID,
      CONFIGURATION_VERSION_ID: activationReceipt.CONFIGURATION_VERSION_ID,
      RECEIPT_VERSION: Number(activationReceipt.RECEIPT_VERSION),
    });
    if (activationReceipt.STATUS === 'Prepared') {
      await onRollbackCheckpoint('activation_prepared_observed_pre_quiesce', {
        deploymentId: command.deploymentId,
        receiptKey: activationReceipt.EVENT_KEY,
      });
    }
    // A failed CAS returns the competing readback. Converge that readback in a
    // bounded loop so Prepared -> containment-started cannot slip between the
    // rollback read and its ownership transfer.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      invariant(activationReceipt?.ROWID === activationReceiptIdentity.ROWID
        && activationReceipt.EVENT_KEY === activationReceiptIdentity.EVENT_KEY
        && activationReceipt.PAYLOAD_FINGERPRINT
          === activationReceiptIdentity.PAYLOAD_FINGERPRINT
        && activationReceipt.EVENT_DATA_JSON === activationReceiptIdentity.EVENT_DATA_JSON
        && activationReceipt.DEPLOYMENT_ID === activationReceiptIdentity.DEPLOYMENT_ID
        && activationReceipt.CONFIGURATION_VERSION_ID
          === activationReceiptIdentity.CONFIGURATION_VERSION_ID
        && Number(activationReceipt.RECEIPT_VERSION)
          === activationReceiptIdentity.RECEIPT_VERSION,
      'CONTROL_AUDIT_INCOMPLETE',
      'Activation receipt identity changed while rollback acquired containment.',
      { httpStatus: 503, ambiguous: true });
      if (activationReceipt.STATUS === 'Completed') break;
      if (activationReceipt.STATUS === 'FailedCompensated') return [];
      if (activationReceipt.STATUS === 'ReconciliationRequired'
        && activationReceipt.LAST_ERROR_CODE === 'ACTIVATION_SUPERSEDED_BY_ROLLBACK') break;
      if (activationReceipt.STATUS === 'Prepared') {
        activationReceipt = await store.conditionalUpdate(
          tables.EVENT_RECEIPT_TABLE,
          activationReceipt.ROWID,
          {
            STATUS: 'ReconciliationRequired',
            PROCESSED_AT: new Date(now()).toISOString(),
            LAST_ERROR_CODE: 'ACTIVATION_SUPERSEDED_BY_ROLLBACK',
          },
          {
            EVENT_KEY: activationReceipt.EVENT_KEY,
            STATUS: 'Prepared',
            PAYLOAD_FINGERPRINT: activationReceipt.PAYLOAD_FINGERPRINT,
            RECEIPT_VERSION: 1,
          },
        );
        continue;
      }
      if (activationReceipt.STATUS === 'ReconciliationRequired') {
        // A rollback claim is the single durable owner of shutdown. Transfer an
        // interrupted or partially completed activation-containment outcome
        // before either path mutates deployment, CRM, or provider state, so
        // exact retries cannot deadlock on a failed compensation boundary.
        const priorContainmentOutcome = activationReceipt.LAST_ERROR_CODE;
        invariant(typeof priorContainmentOutcome === 'string'
          && /^[A-Z][A-Z0-9_]{2,63}$/.test(priorContainmentOutcome),
        'CONTROL_AUDIT_INCOMPLETE',
        'Activation reconciliation outcome is not safely transferable.',
        { httpStatus: 503, ambiguous: true });
        activationReceipt = await store.conditionalUpdate(
          tables.EVENT_RECEIPT_TABLE,
          activationReceipt.ROWID,
          { LAST_ERROR_CODE: 'ACTIVATION_SUPERSEDED_BY_ROLLBACK' },
          {
            EVENT_KEY: activationReceipt.EVENT_KEY,
            STATUS: 'ReconciliationRequired',
            LAST_ERROR_CODE: priorContainmentOutcome,
            PAYLOAD_FINGERPRINT: activationReceipt.PAYLOAD_FINGERPRINT,
            RECEIPT_VERSION: 1,
          },
        );
        continue;
      }
      break;
    }
    invariant(activationReceipt?.STATUS === 'Completed'
      || (activationReceipt?.STATUS === 'ReconciliationRequired'
        && activationReceipt.LAST_ERROR_CODE === 'ACTIVATION_SUPERSEDED_BY_ROLLBACK'),
      'CONTROL_AUDIT_INCOMPLETE',
      'Activation receipt could not be serialized before rollback.',
      { httpStatus: 503, ambiguous: true });
    return [{ receipt: activationReceipt, data: activationData }];
  }

  async function containQuiescedActivationBeforeRollback(command) {
    const activations = await quiescePreparedActivationForRollback(null, command);
    const deployment = await store.unique(
      tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', command.deploymentId,
    );
    invariant(deployment,
      'CONTROL_PRECONDITION_FAILED', 'Rollback deployment is unavailable.',
      { httpStatus: 409 });
    const match = activations.find(({ receipt, data }) =>
      receipt.STATUS === 'ReconciliationRequired'
      && receipt.LAST_ERROR_CODE === 'ACTIVATION_SUPERSEDED_BY_ROLLBACK'
      && activationBindingIsLive(deployment, receipt, data, command));
    if (!match) return deployment;
    const liveDigest = deploymentControlDigest(config.eventChainSecret, deployment);
    const scheduled = {
      ...deployment,
      TEST_STATUS: 'Scheduled',
      ACTIVATION_EVENT_KEY: null,
      ACTUAL_START_AT: null,
      EXPIRES_AT: null,
    };
    const scheduledDigest = deploymentControlDigest(config.eventChainSecret, scheduled);
    const restored = await store.mutate(
      tables.DEPLOYMENT_TABLE,
      'DEPLOYMENT_ID',
      command.deploymentId,
      'COUNT_VERSION',
      (current) => {
        const currentDigest = deploymentControlDigest(config.eventChainSecret, current);
        if (currentDigest === scheduledDigest) return null;
        invariant(currentDigest === liveDigest,
          'CONTROL_STATE_INVALID',
          'Quiesced activation changed before rollback prestate containment.',
          { httpStatus: 503, ambiguous: true });
        return {
          TEST_STATUS: 'Scheduled',
          ACTIVATION_EVENT_KEY: null,
          ACTUAL_START_AT: null,
          EXPIRES_AT: null,
          UPDATED_AT: new Date(now()).toISOString(),
        };
      },
    );
    invariant(deploymentControlDigest(config.eventChainSecret, restored) === scheduledDigest,
      'CONTROL_CAS_CONFLICT',
      'Quiesced activation prestate containment did not read back exactly.',
      { httpStatus: 503, retryable: true, ambiguous: true });
    return restored;
  }

  async function restoreQuiescedActivationForRollback(deployment, binding, command) {
    if (deploymentControlDigest(config.eventChainSecret, deployment)
      === binding.deploymentControlPrestateDigest) return deployment;
    const activations = await quiescePreparedActivationForRollback(deployment, command);
    const match = activations.find(({ receipt, data }) =>
      receipt.STATUS === 'ReconciliationRequired'
      && receipt.LAST_ERROR_CODE === 'ACTIVATION_SUPERSEDED_BY_ROLLBACK'
      && activationBindingIsLive(deployment, receipt, data, command));
    if (!match) return deployment;
    const scheduled = {
      ...deployment,
      TEST_STATUS: 'Scheduled',
      ACTIVATION_EVENT_KEY: null,
      ACTUAL_START_AT: null,
      EXPIRES_AT: null,
    };
    invariant(deploymentControlDigest(config.eventChainSecret, scheduled)
      === binding.deploymentControlPrestateDigest,
    'CONTROL_STATE_INVALID',
    'Quiesced activation does not reconstruct the rollback prestate.',
    { httpStatus: 503, ambiguous: true });
    const liveDigest = deploymentControlDigest(config.eventChainSecret, deployment);
    const restored = await store.mutate(
      tables.DEPLOYMENT_TABLE,
      'DEPLOYMENT_ID',
      deployment.DEPLOYMENT_ID,
      'COUNT_VERSION',
      (current) => {
        const currentDigest = deploymentControlDigest(config.eventChainSecret, current);
        if (currentDigest === binding.deploymentControlPrestateDigest) return null;
        invariant(currentDigest === liveDigest,
          'CONTROL_STATE_INVALID',
          'Quiesced activation changed before rollback containment.',
          { httpStatus: 503, ambiguous: true });
        return {
          TEST_STATUS: 'Scheduled',
          ACTIVATION_EVENT_KEY: null,
          ACTUAL_START_AT: null,
          EXPIRES_AT: null,
          UPDATED_AT: new Date(now()).toISOString(),
        };
      },
    );
    invariant(deploymentControlDigest(config.eventChainSecret, restored)
      === binding.deploymentControlPrestateDigest,
    'CONTROL_CAS_CONFLICT', 'Activation rollback containment did not converge.',
    { httpStatus: 503, retryable: true, ambiguous: true });
    return restored;
  }

  async function containActivationBehindRollbackClaim(before, after) {
    const beforeDigest = deploymentControlDigest(config.eventChainSecret, before);
    const afterDigest = deploymentControlDigest(config.eventChainSecret, after);
    const restored = await store.mutate(
      tables.DEPLOYMENT_TABLE,
      'DEPLOYMENT_ID',
      after.DEPLOYMENT_ID,
      'COUNT_VERSION',
      (current) => {
        const digest = deploymentControlDigest(config.eventChainSecret, current);
        if (digest === beforeDigest) return null;
        invariant(digest === afterDigest,
          'CONTROL_STATE_INVALID',
          'Activation changed before rollback-claim containment.',
          { httpStatus: 503, ambiguous: true });
        return {
          TEST_STATUS: before.TEST_STATUS,
          ACTIVATION_EVENT_KEY: before.ACTIVATION_EVENT_KEY,
          ACTUAL_START_AT: before.ACTUAL_START_AT,
          EXPIRES_AT: before.EXPIRES_AT,
          UPDATED_AT: new Date(now()).toISOString(),
        };
      },
    );
    invariant(deploymentControlDigest(config.eventChainSecret, restored) === beforeDigest,
      'CONTROL_CAS_CONFLICT',
      'Rollback-claim activation containment did not read back exactly.',
      { httpStatus: 503, retryable: true, ambiguous: true });
    return restored;
  }

  async function activationTimestampForRollback(command, deployment) {
    if (Number.isFinite(Date.parse(deployment.ACTUAL_START_AT))) {
      return deployment.ACTUAL_START_AT;
    }
    const activations = await quiescePreparedActivationForRollback(deployment, command);
    const match = activations.find(({ data }) =>
      Number.isFinite(Date.parse(data.actualStartAt)));
    return match?.data?.actualStartAt || null;
  }

  async function readState(command) {
    const [deployment, configurationRow, deal, receipts] = await Promise.all([
      store.unique(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', command.deploymentId),
      store.unique(tables.CONFIGURATION_VERSION_TABLE, 'CONFIGURATION_VERSION_ID',
        command.configurationVersionId),
      crm.getDeal(command.dealId),
      store.queryBounded(tables.EVENT_RECEIPT_TABLE, 'DEPLOYMENT_ID', command.deploymentId,
        'RECEIVED_AT', 100, { RECEIPT_KIND: 'authorization_event' }),
    ]);
    invariant(deployment && configurationRow && deal,
      'CONTROL_PRECONDITION_FAILED', 'Required control-plane state is unavailable.',
      { httpStatus: 409 });
    const configuration = parseConfiguration(
      configurationRow, command, config.sourceRevision, deployment,
    );
    const events = receipts.filter((receipt) => receipt.STATUS === 'Completed')
      .map((receipt) => eventFromReceipt(receipt, config));
    return { deployment, configurationRow, configuration, deal, events, receipts };
  }

  async function requireCompletedActivationApproval(command, suppliedState = null) {
    const [deployment, configurationRow, receipts] = suppliedState?.deployment
      && suppliedState?.configurationRow && Array.isArray(suppliedState?.receipts)
      ? [suppliedState.deployment, suppliedState.configurationRow, suppliedState.receipts]
      : await Promise.all([
        store.unique(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', command.deploymentId),
        store.unique(tables.CONFIGURATION_VERSION_TABLE, 'CONFIGURATION_VERSION_ID',
          command.configurationVersionId),
        store.queryBounded(tables.EVENT_RECEIPT_TABLE, 'DEPLOYMENT_ID', command.deploymentId,
          'RECEIVED_AT', 100, { RECEIPT_KIND: 'authorization_event' }),
      ]);
    invariant(deployment && configurationRow,
      'CONTROL_PRECONDITION_FAILED', 'Activation state is unavailable.',
      { httpStatus: 409 });
    invariant(APPROVAL_EVENT_PATTERN.test(deployment.APPROVAL_EVENT_KEY || '')
      && deployment.GO_LIVE_APPROVAL_STATUS === 'Approved'
      && deployment.APPROVED_CONFIGURATION_VERSION_ID === command.configurationVersionId
      && typeof deployment.APPROVED_ROUTE_FINGERPRINT === 'string',
    'CONTROL_PRECONDITION_FAILED', 'Activation has no completed configuration approval.',
    { httpStatus: 409 });
    invariant(receipts.length < 100,
      'CONTROL_AUDIT_INVALID', 'Approval receipt inventory is incomplete.',
      { httpStatus: 503 });
    const approvals = receipts.filter((receipt) => receipt.EVENT_TYPE === 'approve');
    invariant(approvals.length === 1
      && approvals[0].EVENT_KEY === deployment.APPROVAL_EVENT_KEY,
    'CONTROL_AUDIT_INVALID', 'Activation requires one exact referenced approval receipt.',
    { httpStatus: 503 });
    const expectedRouteFingerprint = suppliedState?.routeFingerprint
      || routeFingerprint(routeFromRows(deployment, configurationRow));
    return validateCompletedApprovalReceipt(approvals[0], {
      command,
      deployment,
      configurationRow,
      expectedRouteFingerprint,
      config,
    });
  }

  function assertActivationApprovalChain(receipt, data, approval) {
    invariant(receipt?.EVENT_TYPE === 'activate'
      && receipt.RELATED_EVENT_KEY === approval.receipt.EVENT_KEY
      && data?.action === 'activate'
      && data.decision === 'Activated'
      && data.approvalEventKey === approval.receipt.EVENT_KEY
      && data.previousEventHash === approval.data.eventHash,
    'CONTROL_AUDIT_INVALID',
    'Activation receipt is not chained to the completed approval receipt.',
    { httpStatus: 503 });
  }

  async function readBoundIdentity(command) {
    const [deployment, configurationRow, deal] = await Promise.all([
      store.unique(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', command.deploymentId),
      store.unique(tables.CONFIGURATION_VERSION_TABLE, 'CONFIGURATION_VERSION_ID',
        command.configurationVersionId),
      crm.getDeal(command.dealId),
    ]);
    invariant(deployment && configurationRow && deal,
      'CONTROL_PRECONDITION_FAILED', 'Rollback identity is unavailable.',
      { httpStatus: 409 });
    const configuration = parseConfiguration(
      configurationRow, command, config.sourceRevision, deployment,
    );
    validateDealBinding(deal, command, configuration);
    invariant(!hasText(deal.Billing_Subscription_ID),
      'CONTROL_PRECONDITION_FAILED',
      'A deployment with a Billing subscription cannot use Free Test rollback.',
      { httpStatus: 409 });
    return { deployment, configurationRow, configuration, deal };
  }

  function assertNoCompetingActivationReceipt(state, command) {
    invariant(state.receipts.length < 100,
      'CONTROL_IDEMPOTENCY_CONFLICT',
      'Activation receipt inventory is incomplete.', { httpStatus: 409 });
    const expectedKey = eventKey(config, 'activate', command.idempotencyKey);
    const conflicts = state.receipts.filter((receipt) => receipt.EVENT_TYPE === 'activate'
      && receipt.EVENT_KEY !== expectedKey
      // One deployment has one activation decision. A different Completed key is also a
      // conflict: it may be the durable half of an interrupted compensation and must be
      // reconciled through its original idempotency identity before any new attempt.
      && new Set(['Prepared', 'Completed', 'ReconciliationRequired']).has(receipt.STATUS));
    invariant(conflicts.length === 0,
      'CONTROL_IDEMPOTENCY_CONFLICT',
      'Another activation attempt requires exact resume or reconciliation.',
      { httpStatus: 409 });
  }

  async function persistDecision(result, deployment, command, action) {
    const patch = {
      ...result.deploymentPatch,
      COUNT_VERSION: Number(deployment.COUNT_VERSION) + 1,
    };
    const rollbackDigests = action === 'rollback' ? {
      deploymentControlPrestateDigest: deploymentControlDigest(
        config.eventChainSecret, deployment,
      ),
      deploymentControlPoststateDigest: deploymentControlDigest(
        config.eventChainSecret, { ...deployment, ...patch },
      ),
    } : {};
    const receipt = {
      ...authorizationReceiptRow(result.event, {
        sourceRevision: config.sourceRevision,
        environment: config.environment,
        controlBinding: controlBinding(action, command, rollbackDigests),
        eventChainSecret: config.eventChainSecret,
      }),
      STATUS: 'Prepared',
      PROCESSED_AT: null,
    };
    const inserted = await store.insertUnique(tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', receipt, [
      'EVENT_KEY', 'RECEIPT_KIND', 'PAYLOAD_FINGERPRINT', 'EVENT_TYPE', 'EVENT_DATA_JSON',
      'DEPLOYMENT_ID', 'CONFIGURATION_VERSION_ID', 'ROUTE_FINGERPRINT',
      'ROUTE_READBACK_FINGERPRINT', 'RELATED_EVENT_KEY', 'SOURCE_REVISION',
      'SOURCE_ENVIRONMENT',
    ]);
    invariant(new Set(['Prepared', 'Completed']).has(inserted.row.STATUS),
      'CONTROL_IDEMPOTENCY_CONFLICT', 'Control receipt is not resumable.', { httpStatus: 409 });
    const receiptPayload = assertReceiptCommand(inserted.row, action, command, config);
    let poststate = deployment;
    const alreadyApplied = Object.entries(patch).every(([field, value]) => same(poststate[field], value));
    if (!alreadyApplied) {
      if (action === 'rollback') {
        try {
          await quiescePreparedActivationForRollback(deployment, command);
          poststate = await applyRollbackDecision(
            deployment, patch, receiptPayload.controlBinding, command,
          );
        } catch (error) {
          await markControlReceiptReconciliation(inserted.row, error);
          throw error;
        }
      } else if (action === 'activate') {
        try {
          await assertNoActiveRollbackClaim(command);
          const currentReceipt = await store.unique(
            tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', inserted.row.EVENT_KEY,
          );
          invariant(currentReceipt?.STATUS === 'Prepared',
            'ACTIVATION_SUPERSEDED_BY_ROLLBACK',
            'Activation receipt was quiesced before its deployment transition.',
            { httpStatus: 409 });
          poststate = await store.conditionalUpdate(
            tables.DEPLOYMENT_TABLE,
            deployment.ROWID,
            patch,
            fullDeploymentPrestate(deployment),
          );
          verifyPatch(poststate, patch);
          try {
            await assertNoActiveRollbackClaim(command);
          } catch (error) {
            await markControlReceiptReconciliation(currentReceipt, error);
            await containActivationBehindRollbackClaim(deployment, poststate);
            throw error;
          }
        } catch (error) {
          const currentReceipt = await store.unique(
            tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', inserted.row.EVENT_KEY,
          );
          if (currentReceipt?.STATUS === 'Prepared') {
            await markControlReceiptReconciliation(currentReceipt, error);
          }
          throw error;
        }
      } else {
        poststate = await store.conditionalUpdate(tables.DEPLOYMENT_TABLE, deployment.ROWID,
          patch, fullDeploymentPrestate(deployment));
        verifyPatch(poststate, patch);
      }
    }
    if (action !== 'activate' && inserted.row.STATUS !== 'Completed') {
      const completed = await store.conditionalUpdate(tables.EVENT_RECEIPT_TABLE,
        inserted.row.ROWID, { STATUS: 'Completed', PROCESSED_AT: result.event.DECIDED_AT }, {
          EVENT_KEY: receipt.EVENT_KEY,
          STATUS: 'Prepared',
          PAYLOAD_FINGERPRINT: receipt.PAYLOAD_FINGERPRINT,
          RECEIPT_VERSION: 1,
        });
      invariant(completed?.STATUS === 'Completed'
        && completed.PROCESSED_AT === result.event.DECIDED_AT,
      'CONTROL_AUDIT_INCOMPLETE', 'Authorization receipt did not finalize.',
      { httpStatus: 503, retryable: true, ambiguous: true });
    }
    return poststate;
  }

  async function finalizePreparedReceipt(receipt, decidedAt) {
    if (receipt.STATUS === 'Completed') return receipt;
    const completed = await store.conditionalUpdate(tables.EVENT_RECEIPT_TABLE,
      receipt.ROWID, { STATUS: 'Completed', PROCESSED_AT: decidedAt }, {
        EVENT_KEY: receipt.EVENT_KEY,
        STATUS: 'Prepared',
        PAYLOAD_FINGERPRINT: receipt.PAYLOAD_FINGERPRINT,
        RECEIPT_VERSION: 1,
      });
    invariant(completed?.STATUS === 'Completed' && completed.PROCESSED_AT === decidedAt,
      'CONTROL_AUDIT_INCOMPLETE', 'Authorization receipt did not finalize.',
      { httpStatus: 503, retryable: true, ambiguous: true });
    return completed;
  }

  async function existingDecision(action, command, { beforePreparedApply } = {}) {
    const key = eventKey(config, action, command.idempotencyKey);
    const receipt = await store.unique(tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', key);
    if (!receipt) return null;
    invariant(new Set(['Prepared', 'Completed']).has(receipt.STATUS)
      || (new Set(['activate', 'rollback']).has(action)
        && receipt.STATUS === 'ReconciliationRequired'),
      'CONTROL_IDEMPOTENCY_CONFLICT', 'Control receipt is not resumable.', { httpStatus: 409 });
    const data = assertReceiptCommand(receipt, action, command, config);
    const [deployment, configurationRow, deal] = await Promise.all([
      store.unique(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', command.deploymentId),
      store.unique(tables.CONFIGURATION_VERSION_TABLE, 'CONFIGURATION_VERSION_ID',
        command.configurationVersionId),
      crm.getDeal(command.dealId),
    ]);
    invariant(deployment && configurationRow && deal,
      'CONTROL_STATE_INVALID', 'Control state readback is unavailable.', { httpStatus: 503 });
    const configuration = parseConfiguration(
      configurationRow, command, config.sourceRevision, deployment,
    );
    const runtimeTerminalRollback = action === 'rollback'
      && receipt.STATUS === 'ReconciliationRequired'
      && isRuntimeTerminalRollbackSupersession(deployment, data.controlBinding);
    const locallyContainedActivation = action === 'activate'
      && new Set(['Prepared', 'ReconciliationRequired']).has(receipt.STATUS)
      && deployment.TEST_STATUS === 'Scheduled'
      && deployment.GO_LIVE_APPROVAL_STATUS === 'Approved'
      && deployment.ACTIVATION_EVENT_KEY === null
      && deployment.ACTUAL_START_AT === null
      && deployment.EXPIRES_AT === null
      && Number(deployment.COUNT_VERSION) >= Number(data.expectedDeploymentVersion) + 2;
    const activationContainmentPending = action === 'activate'
      && receipt.STATUS === 'ReconciliationRequired'
      && (locallyContainedActivation
        || activationBindingIsLive(deployment, receipt, data, command));
    if (runtimeTerminalRollback) {
      validateRuntimeTerminalReplayDeal(
        deal, command, configuration, deployment,
      );
    } else if (locallyContainedActivation || activationContainmentPending) {
      validateDealBinding(deal, command, configuration);
      const approved = deal.Go_Live_Approval_Status === 'Approved'
        && deal.Approved_Deployment_Record_ID === command.deploymentId
        && deal.Approved_Configuration_Version === command.configurationVersionId
        && hasText(deal.Go_Live_Approved_At);
      const exactInactive = deal.Stage === 'Setup and QA'
        && deal.Test_Status === 'Scheduled' && !deal.Test_Start_At && !deal.Test_End_At;
      const exactInterruptedLive = deal.Stage === 'Test Live'
        && deal.Test_Status === 'Live'
        && deal.Test_Start_At === data.actualStartAt && !deal.Test_End_At;
      invariant(approved && (exactInactive || exactInterruptedLive),
        'CONTROL_PRECONDITION_FAILED',
        'CRM activation containment no longer matches the control receipt.',
        { httpStatus: 409 });
    } else {
      validateReplayDeal(action, deal, command, configuration, deployment, config);
    }
    const route = routeFingerprint(routeFromRows(deployment, configurationRow));
    invariant(route === receipt.ROUTE_FINGERPRINT && route === data.routeFingerprint,
      'CONTROL_STATE_INVALID', 'Prepared control receipt no longer matches the route.',
      { httpStatus: 503 });
    if (runtimeTerminalRollback) {
      return Object.freeze({ action, replayed: true, resumed: true,
        rollbackRuntimeTerminal: true, receipt, receiptData: data,
        deployment, configurationRow, routeFingerprint: route, deal });
    }
    if (activationContainmentPending) {
      return Object.freeze({ action, replayed: true, resumed: true,
        activationContainmentPending: true, receipt, receiptData: data,
        deployment, configurationRow, routeFingerprint: route, deal });
    }
    if (action === 'rollback' && (receipt.STATUS === 'ReconciliationRequired'
      || deployment.TEST_STATUS === 'Paused')) {
      return Object.freeze({ action, replayed: true, resumed: true,
        rollbackPending: true, receipt, receiptData: data,
        deployment, configurationRow, routeFingerprint: route, deal });
    }
    if (receipt.STATUS === 'Prepared') {
      if (locallyContainedActivation) {
        return Object.freeze({ action, replayed: true, resumed: true,
          activationContainmentPending: true, receipt, receiptData: data,
          deployment, configurationRow, routeFingerprint: route, deal });
      }
      const patch = decisionPatch(action, receipt, command, config);
      let poststate = deployment;
      const alreadyApplied = Object.entries(patch)
        .every(([field, value]) => same(poststate[field], value));
      if (!alreadyApplied) {
        invariant((action === 'rollback'
          || Number(poststate.COUNT_VERSION) === Number(data.expectedDeploymentVersion))
          && ((action === 'approve' && poststate.TEST_STATUS === 'Ready for Approval'
            && poststate.GO_LIVE_APPROVAL_STATUS === 'Pending Internal Approval')
          || (action === 'activate' && poststate.TEST_STATUS === 'Scheduled'
            && poststate.GO_LIVE_APPROVAL_STATUS === 'Approved')
          || (action === 'rollback' && new Set(['Scheduled', 'Live']).has(poststate.TEST_STATUS)
            && poststate.GO_LIVE_APPROVAL_STATUS === 'Approved')),
        'CONTROL_STATE_INVALID', 'Prepared control receipt cannot be safely resumed.',
        { httpStatus: 503, ambiguous: true });
        if (action === 'activate') {
          invariant(now() - Date.parse(data.decidedAt) <= 900_000,
            'CONTROL_PREPARED_RECEIPT_STALE', 'Prepared activation evidence is stale.',
            { httpStatus: 409 });
        }
        if (beforePreparedApply) await beforePreparedApply({
          deployment: poststate, configurationRow, routeFingerprint: route,
          receipt, receiptData: data,
        });
        if (action === 'rollback') {
          try {
            await quiescePreparedActivationForRollback(poststate, command);
            poststate = await applyRollbackDecision(
              poststate, patch, data.controlBinding, command,
            );
          } catch (error) {
            await markControlReceiptReconciliation(receipt, error);
            throw error;
          }
        } else {
          poststate = await store.conditionalUpdate(tables.DEPLOYMENT_TABLE, poststate.ROWID,
            patch, fullDeploymentPrestate(poststate));
          verifyPatch(poststate, patch);
        }
      }
      if (action !== 'activate') await finalizePreparedReceipt(receipt, data.decidedAt);
      return Object.freeze({ action, replayed: true, resumed: true,
        receipt, receiptData: data, deployment: poststate,
        configurationRow, routeFingerprint: route, deal });
    }
    return Object.freeze({ action, replayed: true, resumed: false,
      receipt, receiptData: data, deployment, configurationRow,
      routeFingerprint: route, deal });
  }

  async function assertNoConflictingDeployment(selected) {
    await assertExclusiveNumberOwner(selected, 'CONTROL_PRECONDITION_FAILED');
    const rows = await store.queryBounded(tables.DEPLOYMENT_TABLE, 'CLIENT_ID',
      selected.CLIENT_ID, 'UPDATED_AT', 100, {});
    invariant(rows.length < 100,
      'CONTROL_PRECONDITION_FAILED', 'Conflicting deployment inventory is incomplete.',
      { httpStatus: 409 });
    const conflicts = rows.filter((row) => row.DEPLOYMENT_ID !== selected.DEPLOYMENT_ID
      && (new Set(['Scheduled', 'Live', 'Paused']).has(row.TEST_STATUS)
        || row.GO_LIVE_APPROVAL_STATUS === 'Blocked'));
    invariant(conflicts.length === 0,
      'CONTROL_PRECONDITION_FAILED', 'Another approved or active deployment conflicts.',
      { httpStatus: 409 });
  }

  async function assertExclusiveNumberOwner(selected, code) {
    invariant(/^num_[a-f0-9]{64}$/.test(selected?.NUMBER_LOOKUP_HASH || ''),
      code, 'Deployment number ownership is unavailable.', { httpStatus: 409 });
    // NUMBER_LOOKUP_HASH is a unique Data Store column. This readback proves
    // the selected row still owns that global lease immediately before use.
    const owners = await store.queryBounded(tables.DEPLOYMENT_TABLE,
      'NUMBER_LOOKUP_HASH', selected.NUMBER_LOOKUP_HASH, 'UPDATED_AT', 3, {});
    invariant(owners.length === 1
      && owners[0].DEPLOYMENT_ID === selected.DEPLOYMENT_ID
      && owners[0].CLIENT_ID === selected.CLIENT_ID,
    code, 'The isolated test number does not have one exact deployment owner.',
    { httpStatus: 409 });
  }

  async function verifyActiveRouteBinding(state, command, expectedReadbackFingerprint = null) {
    await assertExclusiveNumberOwner(state.deployment, 'ROUTE_VERIFICATION_FAILED');
    const readback = await provider.verifyActiveRoute({
      deployment: state.deployment,
      configurationVersion: state.configurationRow,
      routeFingerprint: state.routeFingerprint,
    });
    invariant(readback?.status === 'route_active'
      && readback.deploymentId === command.deploymentId
      && readback.configurationVersionId === command.configurationVersionId
      && readback.routeFingerprint === state.routeFingerprint
      && /^readback_[a-f0-9]{64}$/.test(readback.readbackFingerprint || '')
      && (expectedReadbackFingerprint === null
        || readback.readbackFingerprint === expectedReadbackFingerprint)
      && Number.isFinite(Date.parse(readback.observedAt)),
    'ROUTE_VERIFICATION_FAILED', 'Authoritative route verification did not match.',
    { httpStatus: 409 });
    return readback;
  }

  async function containActivationFailure(error, deployment, receiptKey, state, command) {
    invariant(deployment.GO_LIVE_APPROVAL_STATUS === 'Approved'
      && new Set(['Scheduled', 'Live']).has(deployment.TEST_STATUS),
    'CONTROL_STATE_INVALID',
    'Activation containment cannot mutate a terminal deployment.',
    { httpStatus: 409 });
    const compensatedAt = new Date(now()).toISOString();
    let containmentReceipt = await store.unique(
      tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', receiptKey,
    );
    invariant(containmentReceipt?.ROWID,
      'CONTROL_AUDIT_INCOMPLETE', 'Activation containment receipt is unavailable.',
      { httpStatus: 503, ambiguous: true });
    assertReceiptCommand(containmentReceipt, 'activate', command, config);
    if (containmentReceipt.STATUS === 'Completed') {
      throw new RevenueDeskError('CONTROL_PRECONDITION_FAILED',
        'Completed activation history won the containment race and was not mutated.', {
          cause: error, httpStatus: 409,
        });
    }
    if (containmentReceipt.STATUS === 'Prepared') {
      await onActivationContainmentCheckpoint('containment_receipt_observed_pre_fence', {
        deploymentId: command.deploymentId,
        receiptKey,
      });
      const fenced = await store.conditionalUpdate(
        tables.EVENT_RECEIPT_TABLE,
        containmentReceipt.ROWID,
        {
          STATUS: 'ReconciliationRequired',
          PROCESSED_AT: compensatedAt,
          LAST_ERROR_CODE: 'ACTIVATION_CONTAINMENT_STARTED',
        },
        {
          EVENT_KEY: receiptKey,
          STATUS: 'Prepared',
          PAYLOAD_FINGERPRINT: containmentReceipt.PAYLOAD_FINGERPRINT,
          RECEIPT_VERSION: 1,
        },
      );
      assertReceiptCommand(fenced, 'activate', command, config);
      if (fenced.STATUS === 'Completed') {
        throw new RevenueDeskError('CONTROL_PRECONDITION_FAILED',
          'Completed activation history won the containment race and was not mutated.', {
            cause: error, httpStatus: 409,
          });
      }
      invariant(fenced.STATUS === 'ReconciliationRequired'
        && fenced.LAST_ERROR_CODE === 'ACTIVATION_CONTAINMENT_STARTED',
      'CONTROL_AUDIT_INCOMPLETE',
      'Activation containment could not acquire its durable audit fence.',
      { httpStatus: 503, ambiguous: true });
      containmentReceipt = fenced;
    } else {
      if (containmentReceipt.STATUS === 'ReconciliationRequired'
        && containmentReceipt.LAST_ERROR_CODE === 'ACTIVATION_SUPERSEDED_BY_ROLLBACK') {
        throw new RevenueDeskError('ACTIVATION_SUPERSEDED_BY_ROLLBACK',
          'Rollback owns containment for this deployment.', {
            cause: error, httpStatus: 409,
          });
      }
      invariant(containmentReceipt.STATUS === 'ReconciliationRequired'
        && typeof containmentReceipt.LAST_ERROR_CODE === 'string',
        'CONTROL_IDEMPOTENCY_CONFLICT',
        'Activation receipt is not eligible for containment.',
        { httpStatus: 409 });
    }
    await onActivationContainmentCheckpoint('containment_fenced_pre_deployment', {
      deploymentId: command.deploymentId,
      receiptKey,
    });
    const patch = {
      TEST_STATUS: 'Scheduled', ACTIVATION_EVENT_KEY: null,
      ACTUAL_START_AT: null, EXPIRES_AT: null,
      UPDATED_AT: compensatedAt,
    };
    const expectedControlDigest = deploymentControlDigest(config.eventChainSecret, deployment);
    const containedControlDigest = deploymentControlDigest(
      config.eventChainSecret, { ...deployment, ...patch },
    );
    let terminalControlDrift = false;
    const compensated = await store.mutate(
      tables.DEPLOYMENT_TABLE,
      'DEPLOYMENT_ID',
      deployment.DEPLOYMENT_ID,
      'COUNT_VERSION',
      (current) => {
        const currentDigest = deploymentControlDigest(config.eventChainSecret, current);
        if (currentDigest === containedControlDigest) return null;
        if (current.TEST_STATUS !== 'Live') {
          terminalControlDrift = true;
          return null;
        }
        invariant(currentDigest === expectedControlDigest,
          'CONTROL_STATE_INVALID',
          'Live activation control state changed before containment.',
          { httpStatus: 503, ambiguous: true });
        return patch;
      },
    );
    if (terminalControlDrift) {
      const currentReceipt = await store.unique(
        tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', receiptKey,
      );
      let terminalProofError = null;
      if (currentReceipt?.STATUS === 'Completed') {
        try {
          const currentData = assertReceiptCommand(currentReceipt, 'activate', command, config);
          invariant(activationBindingIsRuntimeTerminal(
            compensated, currentReceipt, currentData, command,
          ),
          'CONTROL_STATE_INVALID',
          'Terminal activation state does not match its completed receipt.',
          { httpStatus: 503, ambiguous: true });
          const freshDeal = await crm.getDeal(command.dealId);
          const configuration = parseConfiguration(
            state.configurationRow, command, config.sourceRevision, compensated,
          );
          validateRuntimeTerminalReplayDeal(
            freshDeal, command, configuration, compensated,
          );
          const fingerprint = state.routeFingerprint || routeFingerprint(routeFromRows(
            compensated, state.configurationRow,
          ));
          const route = await disableRouteForRollback(
            compensated, state.configurationRow, fingerprint,
          );
          if (route?.status !== 'route_inactive') {
            throw new RevenueDeskError('ROLLBACK_MANUAL_REQUIRED',
              'Runtime completion is closed, but provider inactivity requires reconciliation.', {
                httpStatus: 409,
                safeDetails: {
                  contained: true,
                  rollbackStatus: 'reconciliation_required',
                  terminalReason: compensated.STOP_REASON,
                  rollbackInstructions: route?.instructions,
                  failureCode: route?.failureCode || 'ROUTE_ROLLBACK_FAILED',
                },
              });
          }
          throw new RevenueDeskError('ACTIVATION_SUPERSEDED_BY_TERMINAL_STATE',
            'The runtime completed the deployment while activation was being replayed.', {
              httpStatus: 409,
            });
        } catch (terminalError) {
          if (new Set([
            'ACTIVATION_SUPERSEDED_BY_TERMINAL_STATE', 'ROLLBACK_MANUAL_REQUIRED',
          ]).has(terminalError?.code)) throw terminalError;
          terminalProofError = terminalError;
        }
      }
      // An unproven terminal mutation is ambiguous. Continue through the
      // reconciliation path below so the completed receipt cannot admit it.
      if (terminalProofError) error = terminalProofError;
    }
    if (!terminalControlDrift) {
      invariant(deploymentControlDigest(config.eventChainSecret, compensated)
        === containedControlDigest,
      'CONTROL_CAS_CONFLICT', 'Activation containment did not read back exactly.',
      { httpStatus: 503, retryable: true, ambiguous: true });
      verifyControlPatch(compensated, patch);
    }
    // Contain the gateway-authoritative state before any external ownership or
    // provider operation. A timeout or ownership conflict must never leave the
    // deployment admitted as Live after activation verification has failed.
    await onActivationContainmentCheckpoint('deployment_inactive_pre_crm', {
      deploymentId: command.deploymentId,
      receiptKey,
    });
    const ownershipReceipt = await store.unique(
      tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', receiptKey,
    );
    assertReceiptCommand(ownershipReceipt, 'activate', command, config);
    if (ownershipReceipt.STATUS === 'ReconciliationRequired'
      && ownershipReceipt.LAST_ERROR_CODE === 'ACTIVATION_SUPERSEDED_BY_ROLLBACK') {
      throw new RevenueDeskError('ACTIVATION_SUPERSEDED_BY_ROLLBACK',
        'Rollback took ownership before activation containment reached an external system.', {
          cause: error, httpStatus: 409,
        });
    }
    invariant(ownershipReceipt.STATUS === 'ReconciliationRequired'
      && typeof ownershipReceipt.LAST_ERROR_CODE === 'string'
      && ownershipReceipt.PAYLOAD_FINGERPRINT === containmentReceipt.PAYLOAD_FINGERPRINT,
    'CONTROL_AUDIT_INCOMPLETE', 'Activation containment ownership was lost.',
    { httpStatus: 503, ambiguous: true });
    let crmContained = false;
    let crmFailure = null;
    const activatedAt = deployment.ACTUAL_START_AT || state?.receiptData?.actualStartAt;
    invariant(Number.isFinite(Date.parse(activatedAt)),
      'CONTROL_AUDIT_INVALID', 'Activation timestamp is unavailable for containment.',
      { httpStatus: 503 });
    try {
      const crmReadback = await crm.containActivation(command.dealId, {
        deploymentId: command.deploymentId,
        configurationVersionId: command.configurationVersionId,
        activatedAt,
        expectedDeal: state.deal,
      });
      crmContained = crmReadback.Stage === 'Setup and QA'
        && crmReadback.Test_Status === 'Scheduled' && !crmReadback.Test_Start_At;
    } catch (containmentError) {
      crmFailure = containmentError;
    }
    let routeReadback = null;
    let routeFailure = null;
    try {
      await assertExclusiveNumberOwner(compensated, 'ROUTE_ROLLBACK_OWNERSHIP_UNPROVEN');
      routeReadback = await provider.disableRoute({
        deployment: compensated,
        configurationVersion: state.configurationRow,
        routeFingerprint: state.routeFingerprint,
      });
    } catch (providerError) {
      routeFailure = providerError;
    }
    const runtimeEvidenceAdvanced = [
      'HANDLED_COUNT', 'COUNTED_CALL_KEYS_JSON',
      'REPORT_RECONCILIATION_STATUS', 'REPORT_RECONCILIATION_VERSION',
    ].some((field) => !same(compensated[field], deployment[field]));
    const fullyCompensated = !terminalControlDrift && !runtimeEvidenceAdvanced
      && !crmFailure && crmContained && !routeFailure
      && routeReadback?.status === 'route_inactive';
    const receiptStatus = fullyCompensated ? 'FailedCompensated' : 'ReconciliationRequired';
    const receipt = await store.unique(tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', receiptKey);
    if (receipt?.STATUS === 'ReconciliationRequired'
      && receipt.LAST_ERROR_CODE === 'ACTIVATION_SUPERSEDED_BY_ROLLBACK') {
      throw new RevenueDeskError('ACTIVATION_SUPERSEDED_BY_ROLLBACK',
        'Rollback took ownership while activation containment was reconciling.', {
          cause: error, httpStatus: 409,
        });
    }
    invariant(receipt?.ROWID
      && receipt.STATUS === 'ReconciliationRequired'
      && typeof receipt.LAST_ERROR_CODE === 'string'
      && receipt.PAYLOAD_FINGERPRINT === containmentReceipt.PAYLOAD_FINGERPRINT,
    'CONTROL_AUDIT_INCOMPLETE', 'Activation containment audit fence was lost.',
    { httpStatus: 503, ambiguous: true });
    const lastErrorCode = routeFailure?.code || crmFailure?.code || (crmContained
      ? 'CRM_ACTIVATION_PROVEN_INACTIVE' : 'CRM_ACTIVATION_RECONCILIATION_REQUIRED');
    const updated = await store.conditionalUpdate(tables.EVENT_RECEIPT_TABLE, receipt.ROWID,
      { STATUS: receiptStatus, LAST_ERROR_CODE: lastErrorCode }, {
        EVENT_KEY: receiptKey, STATUS: 'ReconciliationRequired',
        LAST_ERROR_CODE: receipt.LAST_ERROR_CODE,
        PAYLOAD_FINGERPRINT: receipt.PAYLOAD_FINGERPRINT, RECEIPT_VERSION: 1,
      });
    if (updated?.STATUS === 'ReconciliationRequired'
      && updated.LAST_ERROR_CODE === 'ACTIVATION_SUPERSEDED_BY_ROLLBACK') {
      throw new RevenueDeskError('ACTIVATION_SUPERSEDED_BY_ROLLBACK',
        'Rollback retained ownership of activation containment.', {
          cause: error, httpStatus: 409,
        });
    }
    invariant(updated?.STATUS === receiptStatus
      && updated.LAST_ERROR_CODE === lastErrorCode,
    'CONTROL_AUDIT_INCOMPLETE', 'Activation containment audit did not converge.',
    { httpStatus: 503, ambiguous: true });
    if (!fullyCompensated) {
      throw new RevenueDeskError('CRM_ACTIVATION_RECONCILIATION_REQUIRED',
        'Activation was contained, but CRM or provider state requires reconciliation.',
        { cause: routeFailure || crmFailure || error, httpStatus: 503, ambiguous: true });
    }
    throw new RevenueDeskError('ACTIVATION_COMPENSATED',
      'CRM activation failed; the deployment remains approved and inactive.',
      { cause: error, httpStatus: 503, retryable: false });
  }

  async function completeActivationSaga(state, command) {
    const receipt = state.receipt || await store.unique(
      tables.EVENT_RECEIPT_TABLE,
      'EVENT_KEY',
      eventKey(config, 'activate', command.idempotencyKey),
    );
    invariant(receipt && new Set(['Prepared', 'Completed']).has(receipt.STATUS),
      'CONTROL_AUDIT_INVALID', 'Activation receipt is unavailable.', { httpStatus: 503 });
    const data = assertReceiptCommand(receipt, 'activate', command, config);
    const receiptKey = receipt.EVENT_KEY;
    async function stopForRollbackClaim(error) {
      const currentReceipt = await store.unique(
        tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', receiptKey,
      );
      if (currentReceipt?.STATUS === 'Prepared') {
        await markControlReceiptReconciliation(currentReceipt, error);
      }
      const currentDeployment = await store.unique(
        tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', command.deploymentId,
      );
      if (activationBindingIsLive(currentDeployment, receipt, data, command)) {
        await containActivationBehindRollbackClaim({
          ...currentDeployment,
          TEST_STATUS: 'Scheduled',
          ACTIVATION_EVENT_KEY: null,
          ACTUAL_START_AT: null,
          EXPIRES_AT: null,
        }, currentDeployment);
      }
      throw error;
    }
    if (receipt.STATUS === 'Prepared') {
      await onActivationCheckpoint('deployment_live_prepared', {
        deploymentId: command.deploymentId, receiptStatus: receipt.STATUS,
      });
    }
    try {
      await verifyActiveRouteBinding(state, command, data.routeReadbackFingerprint);
    } catch (error) {
      await containActivationFailure(error, state.deployment, receiptKey, state, command);
    }
    if (receipt.STATUS === 'Prepared') {
      await onActivationCheckpoint('post_cas_provider_verified', {
        deploymentId: command.deploymentId, receiptStatus: receipt.STATUS,
      });
    }
    try {
      await crm.recordActivation(command.dealId, {
        deploymentId: command.deploymentId,
        configurationVersionId: command.configurationVersionId,
        activatedAt: state.deployment.ACTUAL_START_AT,
        expectedDeal: state.deal,
      });
    } catch (error) {
      await containActivationFailure(error, state.deployment, receiptKey, state, command);
    }
    if (receipt.STATUS === 'Prepared') {
      await onActivationCheckpoint('crm_activation_verified', {
        deploymentId: command.deploymentId, receiptStatus: receipt.STATUS,
      });
    }
    try {
      // CRM is an external transaction boundary. Re-read the exact provider
      // route once more before making the Prepared receipt gateway-admissible.
      await verifyActiveRouteBinding(state, command, data.routeReadbackFingerprint);
    } catch (error) {
      await containActivationFailure(error, state.deployment, receiptKey, state, command);
    }
    if (receipt.STATUS === 'Prepared') {
      await onActivationCheckpoint('final_provider_verified', {
        deploymentId: command.deploymentId, receiptStatus: receipt.STATUS,
      });
      const finalDeployment = await store.unique(
        tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', command.deploymentId,
      );
      if (!activationBindingIsLive(finalDeployment, receipt, data, command)) {
        const error = new RevenueDeskError('ACTIVATION_SUPERSEDED_BY_TERMINAL_STATE',
          'Activation lost its final control-state race and remains non-admissible.',
          { httpStatus: 409, ambiguous: true });
        await markControlReceiptReconciliation(receipt, error);
        throw error;
      }
      await onActivationCheckpoint('activation_live_final_read', {
        deploymentId: command.deploymentId, receiptStatus: receipt.STATUS,
      });
      try {
        await assertNoActiveRollbackClaim(command);
      } catch (error) {
        await stopForRollbackClaim(error);
      }
      await onActivationCheckpoint('activation_claim_finalization_window', {
        deploymentId: command.deploymentId, receiptStatus: receipt.STATUS,
      });
    }
    const completedReceipt = receipt.STATUS === 'Prepared'
      ? await finalizePreparedReceipt(receipt, data.decidedAt)
      : receipt;
    if (receipt.STATUS === 'Prepared') {
      await onActivationCheckpoint('activation_receipt_completed', {
        deploymentId: command.deploymentId, receiptStatus: completedReceipt.STATUS,
      });
    }
    const responseDeployment = await store.unique(
      tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', command.deploymentId,
    );
    const rollbackClaims = await activeRollbackClaims(command.deploymentId);
    if (rollbackClaims.length > 0) {
      throw new RevenueDeskError('ACTIVATION_SUPERSEDED_BY_ROLLBACK',
        'A deployment-bound rollback claim prevents an active response.',
        { httpStatus: 409 });
    }
    if (activationBindingIsRuntimeTerminal(
      responseDeployment, completedReceipt, data, command,
    )) {
      throw new RevenueDeskError('CONTROL_PRECONDITION_FAILED',
        'Activation completed, but the runtime has already reached a terminal state.',
        { httpStatus: 409 });
    }
    if (!activationBindingIsLive(responseDeployment, completedReceipt, data, command)) {
      const error = new RevenueDeskError('ACTIVATION_SUPERSEDED_BY_TERMINAL_STATE',
        'Activation no longer matches the final control state.',
        { httpStatus: 409, ambiguous: true });
      if (completedReceipt.STATUS === 'Prepared') {
        await markControlReceiptReconciliation(completedReceipt, error);
      }
      throw error;
    }
    invariant(now() < Date.parse(responseDeployment.EXPIRES_AT),
      'CONTROL_PRECONDITION_FAILED',
      'Activation reached its terminal window before response.',
      { httpStatus: 409 });
    return Object.freeze({ receipt: completedReceipt, deployment: responseDeployment });
  }

  async function requireVerifiedRollback(routeReadback, deployment, receipt, command) {
    if (routeReadback?.status === 'route_inactive') return deployment;
    let contained = deployment;
    if (contained.TEST_STATUS === 'Stopped') {
      const containedAt = new Date(now()).toISOString();
      const patch = {
        TEST_STATUS: 'Paused', GO_LIVE_APPROVAL_STATUS: 'Blocked',
        STOPPED_AT: null, STOP_REASON: command.reason,
        UPDATED_AT: containedAt,
      };
      const expectedDigest = deploymentControlDigest(config.eventChainSecret, contained);
      const containedDigest = deploymentControlDigest(
        config.eventChainSecret, { ...contained, ...patch },
      );
      contained = await store.mutate(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID',
        contained.DEPLOYMENT_ID, 'COUNT_VERSION', (current) => {
          const currentDigest = deploymentControlDigest(config.eventChainSecret, current);
          if (currentDigest === containedDigest) return null;
          invariant(currentDigest === expectedDigest,
            'CONTROL_STATE_INVALID', 'Rollback containment state changed concurrently.',
            { httpStatus: 503, ambiguous: true });
          return patch;
        });
      invariant(deploymentControlDigest(config.eventChainSecret, contained) === containedDigest,
        'CONTROL_CAS_CONFLICT', 'Rollback containment did not read back exactly.',
        { httpStatus: 503, retryable: true, ambiguous: true });
      verifyControlPatch(contained, patch);
    }
    invariant(contained.TEST_STATUS === 'Paused'
      && contained.GO_LIVE_APPROVAL_STATUS === 'Blocked',
    'CONTROL_STATE_INVALID', 'Rollback containment did not converge.',
    { httpStatus: 503, ambiguous: true });
    if (receipt?.STATUS === 'Completed') {
      const updated = await store.conditionalUpdate(tables.EVENT_RECEIPT_TABLE,
        receipt.ROWID, { STATUS: 'ReconciliationRequired',
          LAST_ERROR_CODE: routeReadback?.failureCode || 'ROUTE_ROLLBACK_FAILED' }, {
          EVENT_KEY: receipt.EVENT_KEY, STATUS: 'Completed', RECEIPT_VERSION: 1,
        });
      invariant(updated?.STATUS === 'ReconciliationRequired',
        'CONTROL_AUDIT_INCOMPLETE', 'Rollback containment audit did not converge.',
        { httpStatus: 503, ambiguous: true });
    }
    throw new RevenueDeskError('ROLLBACK_MANUAL_REQUIRED',
      'Rollback is locally contained but provider inactivity is not proven.', {
        httpStatus: 409,
        safeDetails: {
          contained: true,
          rollbackStatus: 'manual_rollback_required',
          rollbackInstructions: routeReadback?.instructions,
          failureCode: routeReadback?.failureCode || 'ROUTE_ROLLBACK_FAILED',
        },
      });
  }

  async function disableRouteForRollback(deployment, configurationRow, fingerprint) {
    try {
      await assertExclusiveNumberOwner(deployment, 'ROUTE_ROLLBACK_OWNERSHIP_UNPROVEN');
      return await provider.disableRoute({
        deployment,
        configurationVersion: configurationRow,
        routeFingerprint: fingerprint,
      });
    } catch (error) {
      const failureCode = typeof error?.code === 'string'
        && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.code)
        ? error.code : 'ROUTE_ROLLBACK_FAILED';
      return Object.freeze({
        status: 'manual_rollback_required',
        failureCode,
        instructions: 'Reconcile number ownership before restoring the prior provider route.',
      });
    }
  }

  async function reconcileRuntimeTerminalRollback(existing, command, claim) {
    invariant(existing.rollbackRuntimeTerminal
      && isRuntimeTerminalRollbackSupersession(
        existing.deployment, existing.receiptData.controlBinding,
      ),
    'CONTROL_STATE_INVALID', 'Runtime terminal rollback reconciliation is invalid.',
    { httpStatus: 503 });
    const route = await disableRouteForRollback(existing.deployment,
      existing.configurationRow, existing.routeFingerprint);
    await setRollbackClaimStatus(
      claim,
      'ReconciliationRequired',
      'ROLLBACK_SUPERSEDED_BY_RUNTIME_TERMINAL',
    );
    if (route?.status !== 'route_inactive') {
      throw new RevenueDeskError('ROLLBACK_MANUAL_REQUIRED',
        'Runtime completion is contained, but provider inactivity requires reconciliation.', {
          httpStatus: 409,
          safeDetails: {
            contained: true,
            rollbackStatus: 'reconciliation_required',
            terminalReason: existing.deployment.STOP_REASON,
            rollbackInstructions: route?.instructions,
            failureCode: route?.failureCode || 'ROUTE_ROLLBACK_FAILED',
          },
        });
    }
    // CRM must remain on the existing evidence-gated completion path. Reusing
    // a rollback or activation-containment transition here would falsify the
    // runtime-owned terminal reason or bypass terminal-report reconciliation.
    throw new RevenueDeskError('ROLLBACK_SUPERSEDED_BY_RUNTIME_TERMINAL',
      'The runtime completed the deployment first; the route is inactive and CRM completion remains evidence-gated.', {
        httpStatus: 409,
        safeDetails: {
          contained: true,
          rollbackStatus: 'reconciliation_required',
          terminalReason: existing.deployment.STOP_REASON,
        },
      });
  }

  async function reconcileRuntimeTerminalBeforeRollbackDecision(state, command, claim) {
    const activationReceipt = state.receipts.find((receipt) =>
      receipt.EVENT_KEY === state.deployment.ACTIVATION_EVENT_KEY
      && receipt.EVENT_TYPE === 'activate'
      && receipt.STATUS === 'Completed');
    invariant(activationReceipt,
      'CONTROL_STATE_INVALID',
      'Runtime-terminal deployment has no completed activation receipt.',
      { httpStatus: 503, ambiguous: true });
    const activationData = receiptData(activationReceipt, config);
    invariant(activationBindingIsRuntimeTerminal(
      state.deployment, activationReceipt, activationData, command,
    ),
    'CONTROL_STATE_INVALID',
    'Runtime-terminal deployment does not match its activation receipt.',
    { httpStatus: 503, ambiguous: true });
    validateRuntimeTerminalReplayDeal(
      state.deal, command, state.configuration, state.deployment,
    );
    const fingerprint = routeFingerprint(routeFromRows(
      state.deployment, state.configurationRow,
    ));
    const route = await disableRouteForRollback(
      state.deployment, state.configurationRow, fingerprint,
    );
    await setRollbackClaimStatus(
      claim,
      'ReconciliationRequired',
      'ROLLBACK_SUPERSEDED_BY_RUNTIME_TERMINAL',
    );
    if (route?.status !== 'route_inactive') {
      throw new RevenueDeskError('ROLLBACK_MANUAL_REQUIRED',
        'Runtime completion is contained, but provider inactivity requires reconciliation.', {
          httpStatus: 409,
          safeDetails: {
            contained: true,
            rollbackStatus: 'reconciliation_required',
            terminalReason: state.deployment.STOP_REASON,
            rollbackInstructions: route?.instructions,
            failureCode: route?.failureCode || 'ROUTE_ROLLBACK_FAILED',
          },
        });
    }
    throw new RevenueDeskError('ROLLBACK_SUPERSEDED_BY_RUNTIME_TERMINAL',
      'The runtime completed the deployment first; the route is inactive and CRM completion remains evidence-gated.', {
        httpStatus: 409,
        safeDetails: {
          contained: true,
          rollbackStatus: 'reconciliation_required',
          terminalReason: state.deployment.STOP_REASON,
        },
      });
  }

  async function finalizePendingRollback(existing, command) {
    let deployment = existing.deployment;
    if (deployment.TEST_STATUS === 'Paused') {
      const stoppedAt = existing.receiptData.decidedAt;
      const patch = {
        TEST_STATUS: 'Stopped', GO_LIVE_APPROVAL_STATUS: 'Revoked',
        STOP_REASON: command.reason, STOPPED_AT: stoppedAt,
        UPDATED_AT: new Date(now()).toISOString(),
      };
      const expectedDigest = deploymentControlDigest(config.eventChainSecret, deployment);
      const stoppedDigest = deploymentControlDigest(
        config.eventChainSecret, { ...deployment, ...patch },
      );
      deployment = await store.mutate(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID',
        deployment.DEPLOYMENT_ID, 'COUNT_VERSION', (current) => {
          const currentDigest = deploymentControlDigest(config.eventChainSecret, current);
          if (currentDigest === stoppedDigest) return null;
          invariant(currentDigest === expectedDigest,
            'CONTROL_STATE_INVALID', 'Pending rollback state changed concurrently.',
            { httpStatus: 503, ambiguous: true });
          return patch;
        });
      invariant(deploymentControlDigest(config.eventChainSecret, deployment) === stoppedDigest,
        'CONTROL_CAS_CONFLICT', 'Pending rollback did not read back exactly.',
        { httpStatus: 503, retryable: true, ambiguous: true });
      verifyControlPatch(deployment, patch);
    }
    if (existing.receipt.STATUS === 'ReconciliationRequired') {
      const completed = await store.conditionalUpdate(tables.EVENT_RECEIPT_TABLE,
        existing.receipt.ROWID, { STATUS: 'Completed', LAST_ERROR_CODE: null }, {
          EVENT_KEY: existing.receipt.EVENT_KEY, STATUS: 'ReconciliationRequired',
          RECEIPT_VERSION: 1,
        });
      invariant(completed?.STATUS === 'Completed',
        'CONTROL_AUDIT_INCOMPLETE', 'Rollback audit did not finalize.',
        { httpStatus: 503, ambiguous: true });
    }
    return deployment;
  }

  async function approve(raw) {
    const command = validateCommand('approve', raw);
    const replay = await existingDecision('approve', command);
    if (replay) {
      if (replay.deployment.TEST_STATUS === 'Scheduled') await crm.recordApproval(command.dealId, {
        deploymentId: command.deploymentId,
        configurationVersionId: command.configurationVersionId,
        approvedAt: replay.deployment.GO_LIVE_APPROVED_AT,
        expectedDeal: replay.deal,
      });
      return replay;
    }
    const state = await readState(command);
    validateApprovalDeal(state.deal, command, state.configuration);
    await assertNoConflictingDeployment(state.deployment);
    const observedAt = new Date(now()).toISOString();
    const route = routeFingerprint(routeFromRows(state.deployment, state.configurationRow));
    const intent = {
      schema_version: 1,
      event_id: eventKey(config, 'approve', command.idempotencyKey),
      action: 'approve',
      deployment_id: command.deploymentId,
      configuration_version_id: command.configurationVersionId,
      route_fingerprint: route,
      evidence_revision: config.sourceRevision,
      evidence_observed_at: observedAt,
      requested_at: observedAt,
      operator_id_hash: config.operatorIdHash,
      expected_deployment_version: Number(state.deployment.COUNT_VERSION),
    };
    const evidence = {
      status: 'ready', deployment_id: command.deploymentId,
      configuration_version_id: command.configurationVersionId,
      route_fingerprint: route, source_revision: config.sourceRevision,
      deployment_version: Number(state.deployment.COUNT_VERSION), observed_at: observedAt,
      handled_count: Number(state.deployment.HANDLED_COUNT),
    };
    const result = evaluateApprovalTransition({
      intent,
      signature: approvalIntentSignature(intent, config.operatorVerificationSecret),
      operatorVerificationSecret: config.operatorVerificationSecret,
      eventChainSecret: config.eventChainSecret,
      deployment: state.deployment,
      configurationVersion: state.configurationRow,
      evidence,
      existingEvents: state.events,
      nowMs: now(),
    });
    const deployment = await persistDecision(result, state.deployment, command, 'approve');
    await crm.recordApproval(command.dealId, {
      deploymentId: command.deploymentId,
      configurationVersionId: command.configurationVersionId,
      approvedAt: deployment.GO_LIVE_APPROVED_AT,
      expectedDeal: state.deal,
    });
    return Object.freeze({ action: 'approve', replayed: false, deployment });
  }

  async function activate(raw) {
    const command = validateCommand('activate', raw);
    await assertNoActiveRollbackClaim(command);
    // A Prepared activation resume can apply its deployment CAS inside existingDecision.
    // Prove the immutable approval receipt before entering that resumable write path.
    await requireCompletedActivationApproval(command);
    const replay = await existingDecision('activate', command, {
      beforePreparedApply: async ({ receipt, receiptData }) => {
        const approval = await requireCompletedActivationApproval(command);
        assertActivationApprovalChain(receipt, receiptData, approval);
      },
    });
    if (replay) {
      const approval = await requireCompletedActivationApproval(command);
      assertActivationApprovalChain(replay.receipt, replay.receiptData, approval);
      if (replay.activationContainmentPending) {
        await containActivationFailure(
          new RevenueDeskError('CRM_ACTIVATION_PROVEN_INACTIVE',
            'Interrupted activation containment requires exact repair.', { httpStatus: 503 }),
          replay.deployment,
          eventKey(config, 'activate', command.idempotencyKey),
          replay,
          command,
        );
      }
      if (replay.receipt.STATUS === 'Completed') {
        const freshDeployment = await store.unique(
          tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', command.deploymentId,
        );
        invariant(activationBindingIsLive(
          freshDeployment, replay.receipt, replay.receiptData, command,
        ),
        'CONTROL_PRECONDITION_FAILED',
        'Completed activation no longer matches a Live deployment.',
        { httpStatus: 409 });
        invariant(now() < Date.parse(freshDeployment.EXPIRES_AT),
          'CONTROL_PRECONDITION_FAILED',
          'Completed activation has reached its terminal window.',
          { httpStatus: 409 });
        await verifyActiveRouteBinding({
          ...replay,
          deployment: freshDeployment,
          routeFingerprint: replay.routeFingerprint,
        }, command, replay.receiptData.routeReadbackFingerprint);
        const [finalDeployment, finalDeal] = await Promise.all([
          store.unique(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', command.deploymentId),
          crm.getDeal(command.dealId),
        ]);
        await assertNoActiveRollbackClaim(command);
        if (activationBindingIsRuntimeTerminal(
          finalDeployment, replay.receipt, replay.receiptData, command,
        )) {
          throw new RevenueDeskError('ACTIVATION_SUPERSEDED_BY_TERMINAL_STATE',
            'The runtime completed the deployment during activation replay.', {
              httpStatus: 409,
            });
        }
        invariant(activationBindingIsLive(
          finalDeployment, replay.receipt, replay.receiptData, command,
        )
          && now() < Date.parse(finalDeployment.EXPIRES_AT),
        'CONTROL_PRECONDITION_FAILED',
        'Completed activation no longer matches a current Live deployment.',
        { httpStatus: 409 });
        const exactCrmLive = finalDeal.Stage === 'Test Live'
          && finalDeal.Test_Status === 'Live'
          && finalDeal.Test_Start_At === finalDeployment.ACTUAL_START_AT
          && !finalDeal.Test_End_At
          && finalDeal.Go_Live_Approval_Status === 'Approved'
          && finalDeal.Approved_Deployment_Record_ID === command.deploymentId
          && finalDeal.Approved_Configuration_Version === command.configurationVersionId;
        invariant(exactCrmLive,
          'CONTROL_PRECONDITION_FAILED',
          'Completed activation CRM state is not the exact Live readback.',
          { httpStatus: 409 });
        return Object.freeze({
          ...replay,
          deployment: finalDeployment,
          deal: finalDeal,
        });
      }
      invariant(replay.deployment.GO_LIVE_APPROVAL_STATUS === 'Approved'
        && !new Set(['Paused', 'Stopped']).has(replay.deployment.TEST_STATUS),
      'CONTROL_PRECONDITION_FAILED',
      'A stopped or rollback-pending deployment cannot be activated.',
      { httpStatus: 409 });
      const crmAlreadyLive = replay.deal.Stage === 'Test Live'
        && replay.deal.Test_Status === 'Live'
        && replay.deal.Test_Start_At === replay.deployment.ACTUAL_START_AT
        && replay.deal.Approved_Deployment_Record_ID === command.deploymentId
        && replay.deal.Approved_Configuration_Version === command.configurationVersionId;
      const decidedAt = Date.parse(replay.receiptData.decidedAt);
      const expiresAt = Date.parse(replay.deployment.EXPIRES_AT);
      const stale = !Number.isFinite(decidedAt) || !Number.isFinite(expiresAt)
        || now() - decidedAt > 900_000 || now() >= expiresAt;
      if ((replay.receipt.STATUS === 'Prepared' || !crmAlreadyLive) && stale) {
        let cause;
        try {
          await crm.proveActivationInactive(command.dealId, {
            deploymentId: command.deploymentId,
            configurationVersionId: command.configurationVersionId,
            activatedAt: replay.deployment.ACTUAL_START_AT,
          });
          cause = new RevenueDeskError('CRM_ACTIVATION_PROVEN_INACTIVE',
            'Stale activation resume was proven inactive.', { httpStatus: 503 });
        } catch (error) {
          cause = error;
        }
        await containActivationFailure(cause, replay.deployment,
          eventKey(config, 'activate', command.idempotencyKey), replay, command);
      }
      const completed = await completeActivationSaga(replay, command);
      return Object.freeze({
        ...replay,
        receipt: completed.receipt,
        deployment: completed.deployment,
      });
    }
    const state = await readState(command);
    assertNoCompetingActivationReceipt(state, command);
    state.routeFingerprint = routeFingerprint(routeFromRows(
      state.deployment, state.configurationRow,
    ));
    const approval = await requireCompletedActivationApproval(command, state);
    validateActivationDeal(state.deal, command, state.configuration,
      state.deployment, config);
    await assertNoConflictingDeployment(state.deployment);
    const readback = await verifyActiveRouteBinding(state, command);
    const route = state.routeFingerprint;
    const intent = {
      schema_version: 1,
      event_id: eventKey(config, 'activate', command.idempotencyKey),
      action: 'activate',
      deployment_id: command.deploymentId,
      configuration_version_id: command.configurationVersionId,
      approval_event_key: state.deployment.APPROVAL_EVENT_KEY,
      route_fingerprint: route,
      route_readback_fingerprint: readback.readbackFingerprint,
      route_observed_at: readback.observedAt,
      evidence_revision: config.sourceRevision,
      evidence_observed_at: readback.observedAt,
      requested_at: new Date(now()).toISOString(),
      operator_id_hash: config.operatorIdHash,
      expected_deployment_version: Number(state.deployment.COUNT_VERSION),
    };
    const evidence = {
      status: 'route_active', deployment_id: command.deploymentId,
      configuration_version_id: command.configurationVersionId,
      approval_event_key: state.deployment.APPROVAL_EVENT_KEY,
      route_fingerprint: route, route_readback_fingerprint: readback.readbackFingerprint,
      source_revision: config.sourceRevision,
      deployment_version: Number(state.deployment.COUNT_VERSION),
      observed_at: readback.observedAt,
    };
    const result = evaluateActivationTransition({
      intent,
      signature: activationIntentSignature(intent, config.operatorVerificationSecret),
      operatorVerificationSecret: config.operatorVerificationSecret,
      eventChainSecret: config.eventChainSecret,
      deployment: state.deployment,
      configurationVersion: state.configurationRow,
      evidence,
      existingEvents: [approval.event],
      nowMs: now(),
    });
    const deployment = await persistDecision(result, state.deployment, command, 'activate');
    const completed = await completeActivationSaga({ ...state, deployment }, command);
    return Object.freeze({ action: 'activate', replayed: false,
      deployment: completed.deployment, receipt: completed.receipt });
  }

  async function rollback(raw) {
    const command = validateCommand('rollback', raw);
    // Immutable CRM/configuration ownership is proven before the one global
    // deployment claim is inserted. The claim then fences every mutable read,
    // activation CAS, runtime admission, provider change, and exact retry.
    await readBoundIdentity(command);
    const priorClaim = await store.unique(
      tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY', rollbackClaimKey(command.deploymentId),
    );
    if (!priorClaim) {
      const preflight = await readState(command);
      validateRollbackDeal(
        preflight.deal, command, preflight.configuration, preflight.deployment,
      );
      invariant(new Set(['Scheduled', 'Live']).has(preflight.deployment.TEST_STATUS)
        && preflight.deployment.GO_LIVE_APPROVAL_STATUS === 'Approved',
      'CONTROL_PRECONDITION_FAILED', 'Deployment is not eligible for rollback.',
      { httpStatus: 409 });
    }
    let claim = await acquireRollbackClaim(command);
    try {
      await onRollbackCheckpoint('claim_acquired_pre_quiesce', {
        deploymentId: command.deploymentId,
        claimKey: claim.EVENT_KEY,
      });
      await containQuiescedActivationBeforeRollback(command);
      const existing = await existingDecision('rollback', command);
      if (existing) {
        if (existing.rollbackRuntimeTerminal) {
          return reconcileRuntimeTerminalRollback(existing, command, claim);
        }
        const activatedAt = await activationTimestampForRollback(
          command, existing.deployment,
        );
        let resumed = existing;
        if (existing.receipt.STATUS === 'ReconciliationRequired'
          && new Set(['Scheduled', 'Live']).has(existing.deployment.TEST_STATUS)) {
          const patch = decisionPatch('rollback', existing.receipt, command, config);
          const deployment = await applyRollbackDecision(
            existing.deployment,
            patch,
            existing.receiptData.controlBinding,
            command,
          );
          resumed = Object.freeze({ ...existing, deployment });
        }
        invariant(new Set(['Stopped', 'Paused']).has(resumed.deployment?.TEST_STATUS),
          'CONTROL_STATE_INVALID',
          'Rollback receipt and deployment state conflict.', { httpStatus: 503 });
        const route = await disableRouteForRollback(resumed.deployment,
          resumed.configurationRow, resumed.routeFingerprint);
        await requireVerifiedRollback(route, resumed.deployment, resumed.receipt, command);
        const deployment = await finalizePendingRollback(resumed, command);
        const crmReadback = await crm.recordRollback(command.dealId, {
          deploymentId: command.deploymentId,
          configurationVersionId: command.configurationVersionId,
          stoppedAt: deployment.STOPPED_AT,
          reason: crmEndReason(command.reason),
          routeInactive: route?.status === 'route_inactive',
          activatedAt,
          expectedDeal: resumed.deal,
        });
        if (crmReadback?.manualCloseRequired) {
          throw new RevenueDeskError('CRM_MANUAL_CLOSE_REQUIRED',
            'Rollback is safe, but the operator must complete the authorized CRM close transition.', {
              httpStatus: 409,
              safeDetails: crmReadback.manualCloseRequired,
            });
        }
        claim = await setRollbackClaimStatus(claim, 'Completed');
        return Object.freeze({ ...resumed, deployment, route, claimStatus: claim.STATUS });
      }
      let state = await readState(command);
      const rollbackDeployment = await containQuiescedActivationBeforeRollback(command);
      state = Object.freeze({ ...state, deployment: rollbackDeployment });
      if (state.deployment.TEST_STATUS === 'Completed') {
        return reconcileRuntimeTerminalBeforeRollbackDecision(state, command, claim);
      }
      validateRollbackDeal(state.deal, command, state.configuration, state.deployment);
      if (state.deployment.TEST_STATUS === 'Stopped') {
        throw new RevenueDeskError('CONTROL_IDEMPOTENCY_CONFLICT',
          'Stopped deployments require their original audited rollback identity.',
          { httpStatus: 409 });
      }
      invariant(new Set(['Scheduled', 'Live']).has(state.deployment.TEST_STATUS)
        && state.deployment.GO_LIVE_APPROVAL_STATUS === 'Approved',
      'CONTROL_PRECONDITION_FAILED', 'Deployment is not eligible for rollback.',
      { httpStatus: 409 });
      const activatedAt = await activationTimestampForRollback(command, state.deployment);
      const observedAt = new Date(now()).toISOString();
      const route = routeFingerprint(routeFromRows(state.deployment, state.configurationRow));
      const intent = {
        schema_version: 1,
        event_id: eventKey(config, 'rollback', command.idempotencyKey),
        action: 'revoke', deployment_id: command.deploymentId,
        configuration_version_id: command.configurationVersionId,
        route_fingerprint: route, evidence_revision: config.sourceRevision,
        evidence_observed_at: observedAt, requested_at: observedAt,
        operator_id_hash: config.operatorIdHash,
        expected_deployment_version: Number(state.deployment.COUNT_VERSION),
      };
      const evidence = {
        status: 'ready', deployment_id: command.deploymentId,
        configuration_version_id: command.configurationVersionId,
        route_fingerprint: route, source_revision: config.sourceRevision,
        deployment_version: Number(state.deployment.COUNT_VERSION), observed_at: observedAt,
        handled_count: Number(state.deployment.HANDLED_COUNT),
      };
      const result = evaluateApprovalTransition({
        intent, signature: approvalIntentSignature(intent, config.operatorVerificationSecret),
        operatorVerificationSecret: config.operatorVerificationSecret,
        eventChainSecret: config.eventChainSecret, deployment: state.deployment,
        configurationVersion: state.configurationRow, evidence,
        existingEvents: state.events, nowMs: now(),
      });
      const rollbackResult = Object.freeze({
        ...result,
        deploymentPatch: Object.freeze({ ...result.deploymentPatch, STOP_REASON: command.reason }),
      });
      let deployment;
      try {
        deployment = await persistDecision(rollbackResult, state.deployment,
          command, 'rollback');
      } catch (error) {
        if (error?.code !== 'ROLLBACK_SUPERSEDED_BY_RUNTIME_TERMINAL') throw error;
        const terminal = await existingDecision('rollback', command);
        invariant(terminal?.rollbackRuntimeTerminal,
          'CONTROL_STATE_INVALID',
          'Runtime terminal rollback reconciliation could not be resumed.',
          { httpStatus: 503, ambiguous: true });
        return reconcileRuntimeTerminalRollback(terminal, command, claim);
      }
      await onRollbackCheckpoint('deployment_stopped_pre_provider', {
        deploymentId: command.deploymentId,
        receiptKey: eventKey(config, 'rollback', command.idempotencyKey),
      });
      const routeReadback = await disableRouteForRollback(deployment,
        state.configurationRow, route);
      const receipt = await store.unique(tables.EVENT_RECEIPT_TABLE, 'EVENT_KEY',
        eventKey(config, 'rollback', command.idempotencyKey));
      await requireVerifiedRollback(routeReadback, deployment, receipt, command);
      const crmReadback = await crm.recordRollback(command.dealId, {
        deploymentId: command.deploymentId,
        configurationVersionId: command.configurationVersionId,
        stoppedAt: deployment.STOPPED_AT,
        reason: crmEndReason(command.reason),
        routeInactive: routeReadback?.status === 'route_inactive',
        activatedAt,
        expectedDeal: state.deal,
      });
      if (crmReadback?.manualCloseRequired) {
        throw new RevenueDeskError('CRM_MANUAL_CLOSE_REQUIRED',
          'Rollback is safe, but the operator must complete the authorized CRM close transition.', {
            httpStatus: 409,
            safeDetails: crmReadback.manualCloseRequired,
          });
      }
      claim = await setRollbackClaimStatus(claim, 'Completed');
      return Object.freeze({ action: 'rollback', replayed: false,
        deployment, route: routeReadback, claimStatus: claim.STATUS });
    } catch (error) {
      const errorCode = typeof error?.code === 'string'
        && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.code)
        ? error.code : 'CONTROL_STATE_INVALID';
      claim = await setRollbackClaimStatus(
        claim, 'ReconciliationRequired', errorCode,
      );
      throw error;
    }
  }

  return Object.freeze({ approve, activate, rollback });
}

module.exports = Object.freeze({
  DEPLOYMENT_CAS_FIELDS,
  ROLLBACK_REASON_TO_CRM,
  ROLLBACK_REASONS,
  createRouteControlService,
  validateCommand,
  fullDeploymentPrestate,
});
