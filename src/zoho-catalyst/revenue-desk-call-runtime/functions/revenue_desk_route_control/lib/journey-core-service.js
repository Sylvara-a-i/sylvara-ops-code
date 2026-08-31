'use strict';

const crypto = require('node:crypto');
const { ROLLBACK_CONTROL_REASON_TO_CRM } = require('revenue_desk_call_gateway/lib/contracts');
const { RevenueDeskError, invariant } = require('revenue_desk_call_gateway/lib/errors');
const { keyedDigest } = require('revenue_desk_call_gateway/lib/security');

const CRM_ID = /^[1-9][0-9]{7,29}$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const ROW_ID = /^[1-9][0-9]{0,29}$/;
const CONFIGURATION_REFERENCE = /^form2cfgv1:([1-9][0-9]{0,29}):([a-f0-9]{40})$/;
const RECEIPT_KIND = 'journey_core_control';
const ROLLBACK_REASONS = new Map(ROLLBACK_CONTROL_REASON_TO_CRM);
const RECEIPT_IMMUTABLE_FIELDS = Object.freeze([
  'EVENT_KEY', 'RECEIPT_KIND', 'PAYLOAD_FINGERPRINT', 'EVENT_TYPE', 'EVENT_DATA_JSON',
  'DEPLOYMENT_ID', 'CONFIGURATION_VERSION_ID', 'RELATED_EVENT_KEY', 'RECEIVED_AT',
  'SOURCE_REVISION', 'SOURCE_ENVIRONMENT',
]);
const RECEIPT_DATA_FIELDS = Object.freeze([
  'schemaVersion', 'profile', 'action', 'decision', 'dealId', 'journeyId',
  'deploymentId', 'configurationVersionId', 'idempotencyKey', 'reason',
  'form2EvidenceFingerprint', 'decidedAt',
]);
const RECEIPT_DECISIONS = Object.freeze({
  approve: 'ApprovedInactive', activate: 'BlockedNoTelephonyDeployment',
  rollback: 'RevokedInactive',
});

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, required, optional = []) {
  invariant(plain(value), 'INVALID_CONTROL_REQUEST', 'Control request must be an object.',
    { httpStatus: 400 });
  const keys = Object.keys(value);
  invariant(required.every((key) => keys.includes(key))
    && keys.every((key) => required.includes(key) || optional.includes(key)),
  'INVALID_CONTROL_REQUEST', 'Control request fields are invalid.', { httpStatus: 400 });
}

function deterministicIdempotencyKey(action, dealId, journeyId, configurationVersionId) {
  const digest = crypto.createHash('sha256')
    .update(`sylvara:route-control:core:${action}:v1:${dealId}:${journeyId}:${configurationVersionId}`,
      'utf8')
    .digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(12, 15)}`
    + `-8${digest.slice(15, 18)}-${digest.slice(18, 30)}`;
}

function validateCommand(action, body) {
  invariant(new Set(['approve', 'activate', 'rollback']).has(action),
    'INVALID_CONTROL_REQUEST', 'Control action is invalid.', { httpStatus: 404 });
  const required = ['dealId', 'journeyId', 'configurationVersionId', 'idempotencyKey'];
  if (action === 'rollback') required.push('reason');
  exactKeys(body, required, ['deploymentId']);
  const match = CONFIGURATION_REFERENCE.exec(body.configurationVersionId || '');
  invariant(CRM_ID.test(body.dealId || '') && OPAQUE_ID.test(body.journeyId || '')
    && UUID_V4.test(body.idempotencyKey || '') && match
    && (!Object.hasOwn(body, 'deploymentId') || body.deploymentId === ''
      || body.deploymentId === null),
  'INVALID_CONTROL_REQUEST', 'Control request identity is invalid.', { httpStatus: 400 });
  invariant(body.idempotencyKey === deterministicIdempotencyKey(
    action, body.dealId, body.journeyId, body.configurationVersionId,
  ), 'INVALID_CONTROL_REQUEST', 'Control idempotency identity is invalid.',
  { httpStatus: 400 });
  if (action === 'rollback') invariant(ROLLBACK_REASONS.has(body.reason),
    'INVALID_CONTROL_REQUEST', 'Rollback reason is invalid.', { httpStatus: 400 });
  return Object.freeze({
    action, dealId: body.dealId, journeyId: body.journeyId,
    configurationVersionId: body.configurationVersionId,
    submissionRowId: match[1], evidenceRevision: match[2],
    idempotencyKey: body.idempotencyKey,
    reason: action === 'rollback' ? body.reason : null,
  });
}

function text(value) {
  return typeof value === 'string' && value.length > 0;
}

function catalystTimestamp(value) {
  if (!text(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function crmTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function sameCrmInstant(left, right) {
  return crmTimestamp(left) && crmTimestamp(right) && Date.parse(left) === Date.parse(right);
}

function constantTimeHashEqual(left, right) {
  return HASH.test(left || '') && HASH.test(right || '')
    && crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function lookupId(value) {
  return plain(value) && CRM_ID.test(String(value.id || '')) ? String(value.id) : null;
}

function nullable(value) {
  return value === null || value === undefined || value === '';
}

function validateEvidence(bundle, command, deal, config) {
  const { submission, prefill, session, proof } = bundle;
  // The configuration pointer names the immutable Form 2 artifact that
  // produced the evidence. It deliberately survives later route-control
  // deployments; only the new control receipt is stamped with this runtime.
  const sourceBound = [submission, prefill, session, proof].every((row) =>
    row.SOURCE_REVISION === command.evidenceRevision
      && row.SOURCE_ENVIRONMENT === 'development');
  invariant(sourceBound
    && String(submission.ROWID || '') === command.submissionRowId
    && submission.STATUS === 'succeeded' && submission.LAST_OUTCOME === 'succeeded'
    && catalystTimestamp(submission.SUCCEEDED_AT)
    && nullable(submission.FAILED_AT) && nullable(submission.RECONCILIATION_REQUIRED_AT)
    && HASH.test(submission.PREFILL_KEY || '') && ROW_ID.test(String(submission.SESSION_ROW_ID || '')),
  'FORM2_EVIDENCE_INVALID', 'Completed Form 2 submission evidence is invalid.',
  { httpStatus: 409 });
  invariant(prefill.PREFILL_KEY === submission.PREFILL_KEY
    && String(prefill.SESSION_ROW_ID || '') === String(submission.SESSION_ROW_ID)
    && prefill.STATUS === 'submitted' && prefill.LAST_OUTCOME === 'submitted'
    && catalystTimestamp(prefill.SUBMITTED_AT)
    && catalystTimestamp(prefill.HANDLE_CONSUMED_AT)
    && nullable(prefill.RECONCILIATION_REQUIRED_AT)
    && HASH.test(prefill.CRM_ORGANIZATION_HASH || '')
    && HASH.test(prefill.JOURNEY_BINDING_DIGEST || '')
    && HASH.test(prefill.FORM_IDENTITY_HASH || '')
    // EXPECTED_STAGE is the Form 2 security-stage token, not the mutable CRM
    // Deal Stage label.
    && prefill.EXPECTED_STAGE === 'form2',
  'FORM2_EVIDENCE_INVALID', 'Form 2 prefill evidence is invalid.', { httpStatus: 409 });
  invariant(String(session.ROWID || '') === String(submission.SESSION_ROW_ID)
    && session.STATUS === 'submitted' && session.LAST_OUTCOME === 'submitted'
    && catalystTimestamp(session.VERIFIED_AT) && catalystTimestamp(session.SUBMITTED_AT)
    && nullable(session.EXPIRED_AT) && nullable(session.REVOKED_AT) && nullable(session.FAILED_AT)
    && session.JOURNEY_BINDING_DIGEST === prefill.JOURNEY_BINDING_DIGEST
    && session.CRM_DEAL_ID === prefill.CRM_DEAL_ID
    && session.CRM_ACCOUNT_ID === prefill.CRM_ACCOUNT_ID
    && session.CRM_CONTACT_ID === prefill.CRM_CONTACT_ID,
  'FORM2_EVIDENCE_INVALID', 'Form 2 session evidence is invalid.', { httpStatus: 409 });
  const expectedJourneyBinding = keyedDigest(
    config.form2WorkflowHmacMaterial, 'sylvara.form2.prefill-binding.v1', [
      config.crmOrganizationSha256, session.CRM_CONTACT_ID, session.CRM_ACCOUNT_ID,
      session.CRM_DEAL_ID, command.journeyId, config.form2DestinationSha256,
      'form2', config.form2FormVersion, command.evidenceRevision,
    ],
  );
  invariant(prefill.CRM_ORGANIZATION_HASH === config.crmOrganizationSha256
    && prefill.FORM_IDENTITY_HASH === config.form2DestinationSha256
    && constantTimeHashEqual(prefill.JOURNEY_BINDING_DIGEST, expectedJourneyBinding)
    && constantTimeHashEqual(session.JOURNEY_BINDING_DIGEST, expectedJourneyBinding),
  'FORM2_EVIDENCE_INVALID', 'Form 2 journey binding is invalid.', { httpStatus: 409 });
  invariant(String(proof.SESSION_ROW_ID || '') === String(submission.SESSION_ROW_ID)
    && proof.STATUS === 'consumed' && proof.LAST_OUTCOME === 'proof_consumed'
    && HASH.test(proof.PROOF_KEY || '') && HASH.test(proof.BINDING_DIGEST || '')
    && HASH.test(proof.DESTINATION_DIGEST || '')
    && catalystTimestamp(proof.VERIFIED_AT) && catalystTimestamp(proof.CONSUMED_AT),
  'FORM2_EVIDENCE_INVALID', 'Form 2 access proof is invalid.', { httpStatus: 409 });
  invariant(plain(deal) && String(deal.id) === command.dealId
    && deal.Pipeline === 'Revenue Desk Sales' && deal.Entry_Offer === '7-Day Revenue Leak Test'
    && deal.Intake_Submission_ID === command.journeyId
    && deal.Setup_Access_Status === 'Submitted'
    && crmTimestamp(deal.Setup_Access_Verified_At)
    && text(deal.Setup_Form_Submission_ID)
    && deal.Setup_Form_Version === config.form2FormVersion
    && crmTimestamp(deal.Setup_Form_Submitted_At)
    && deal.Authorized_Representative_Confirmed === true
    && deal.Test_Scope_Accepted === true
    && crmTimestamp(deal.Authority_Confirmed_At)
    && crmTimestamp(deal.Test_Scope_Accepted_At)
    && lookupId(deal.Account_Name) === session.CRM_ACCOUNT_ID
    && lookupId(deal.Contact_Name) === session.CRM_CONTACT_ID
    && session.CRM_DEAL_ID === command.dealId
    && deal.Configuration_Version === command.configurationVersionId
    && nullable(deal.Deployment_Record_ID) && nullable(deal.Approved_Deployment_Record_ID)
    && nullable(deal.Billing_Subscription_ID),
  'CONTROL_PRECONDITION_FAILED', 'CRM Deal does not match completed Form 2 evidence.',
  { httpStatus: 409 });
  return keyedDigest(config.eventChainSecret, 'revenue-desk-journey-core-form2-evidence-v1', [
    command.dealId, command.journeyId, command.configurationVersionId,
    submission.SUBMISSION_KEY, submission.SUBMISSION_FINGERPRINT,
    submission.PREFILL_KEY, submission.SESSION_ROW_ID, submission.SUCCEEDED_AT,
    prefill.SNAPSHOT_FINGERPRINT, prefill.JOURNEY_BINDING_DIGEST,
    proof.PROOF_KEY, proof.BINDING_DIGEST, proof.CONSUMED_AT,
    deal.Setup_Form_Submission_ID, deal.Setup_Form_Version, deal.Setup_Form_Submitted_At,
  ]);
}

function receiptKey(config, action, idempotencyKey) {
  const prefix = { approve: 'coreapr_', activate: 'coreact_', rollback: 'corerbk_' }[action];
  return `${prefix}${keyedDigest(config.eventChainSecret,
    'revenue-desk-journey-core-idempotency-v1', [action, idempotencyKey])}`;
}

function receiptOuterIdentity(config, data, sourceRevision, sourceEnvironment) {
  const approvalKey = deterministicIdempotencyKey(
    'approve', data.dealId, data.journeyId, data.configurationVersionId,
  );
  return Object.freeze({
    eventKey: receiptKey(config, data.action, data.idempotencyKey),
    eventType: data.action === 'rollback' ? 'revoke' : data.action,
    configurationVersionId: data.configurationVersionId,
    deploymentId: null,
    relatedEventKey: data.action === 'approve'
      ? null : receiptKey(config, 'approve', approvalKey),
    receivedAt: data.decidedAt,
    sourceRevision,
    sourceEnvironment,
  });
}

function receiptPayloadFingerprint(config, identity, serialized) {
  return keyedDigest(config.eventChainSecret, 'revenue-desk-journey-core-receipt-v2', [
    identity.sourceRevision, identity.sourceEnvironment, identity.eventKey,
    identity.eventType, identity.configurationVersionId, '<null-deployment>',
    identity.relatedEventKey || '<null-related-event>', identity.receivedAt, serialized,
  ]);
}

function receiptIdentityMatches(left, right) {
  return RECEIPT_IMMUTABLE_FIELDS.every((field) => left?.[field] === right?.[field]);
}

function receiptCasPredicates(receipt) {
  return {
    ...Object.fromEntries(RECEIPT_IMMUTABLE_FIELDS.map((field) => [field, receipt[field]])),
    STATUS: receipt.STATUS,
    RECEIPT_VERSION: Number(receipt.RECEIPT_VERSION),
    PROCESSED_AT: receipt.PROCESSED_AT ?? null,
    LAST_ERROR_CODE: receipt.LAST_ERROR_CODE ?? null,
  };
}

function parseReceipt(receipt, config) {
  let data;
  try { data = JSON.parse(receipt?.EVENT_DATA_JSON); } catch (_) { data = null; }
  const dataShapeValid = plain(data)
    && Object.keys(data).length === RECEIPT_DATA_FIELDS.length
    && Object.keys(data).every((field) => RECEIPT_DATA_FIELDS.includes(field))
    && data.schemaVersion === 1 && data.profile === 'free-test-journey-core-v1'
    && Object.hasOwn(RECEIPT_DECISIONS, data.action)
    && data.decision === RECEIPT_DECISIONS[data.action]
    && CRM_ID.test(data.dealId || '') && OPAQUE_ID.test(data.journeyId || '')
    && CONFIGURATION_REFERENCE.test(data.configurationVersionId || '')
    && UUID_V4.test(data.idempotencyKey || '')
    && data.idempotencyKey === deterministicIdempotencyKey(
      data.action, data.dealId, data.journeyId, data.configurationVersionId,
    )
    && data.deploymentId === null
    && data.reason === (data.action === 'rollback' ? data.reason : null)
    && (data.action !== 'rollback' || ROLLBACK_REASONS.has(data.reason))
    && HASH.test(data.form2EvidenceFingerprint || '')
    && catalystTimestamp(data.decidedAt);
  const sourceRevision = receipt?.SOURCE_REVISION;
  const sourceEnvironment = receipt?.SOURCE_ENVIRONMENT;
  const identity = dataShapeValid
    ? receiptOuterIdentity(config, data, sourceRevision, sourceEnvironment) : null;
  const expectedFingerprint = identity && typeof receipt.EVENT_DATA_JSON === 'string'
    ? receiptPayloadFingerprint(config, identity, receipt.EVENT_DATA_JSON) : null;
  const version = Number(receipt?.RECEIPT_VERSION);
  const processing = receipt?.STATUS === 'Processing';
  const reconciling = receipt?.STATUS === 'ReconciliationRequired';
  const completed = receipt?.STATUS === 'Completed';
  const stateValid = (processing || reconciling)
    ? version === 0 && nullable(receipt.PROCESSED_AT)
      && (processing ? nullable(receipt.LAST_ERROR_CODE)
        : text(receipt.LAST_ERROR_CODE) && receipt.LAST_ERROR_CODE.length <= 128)
    : completed && version === 1 && receipt.PROCESSED_AT === data?.decidedAt
      && nullable(receipt.LAST_ERROR_CODE);
  invariant(plain(receipt) && dataShapeValid && identity
    && receipt.RECEIPT_KIND === RECEIPT_KIND
    // Completed control authority survives a later source-stamped deployment.
    // New receipts still stamp this runtime, while historical receipts retain
    // the immutable revision that actually made their decision.
    && /^[a-f0-9]{40}$/.test(sourceRevision || '')
    && sourceEnvironment === 'development'
    && receipt.EVENT_KEY === identity.eventKey
    && receipt.EVENT_TYPE === identity.eventType
    && receipt.CONFIGURATION_VERSION_ID === identity.configurationVersionId
    && receipt.DEPLOYMENT_ID === identity.deploymentId
    && receipt.RELATED_EVENT_KEY === identity.relatedEventKey
    && receipt.RECEIVED_AT === identity.receivedAt
    && receipt.CALL_KEY === null && receipt.CORRELATION_ID === null
    && receipt.ROUTE_FINGERPRINT === null && receipt.ROUTE_READBACK_FINGERPRINT === null
    && constantTimeHashEqual(receipt.PAYLOAD_FINGERPRINT, expectedFingerprint)
    && Number(receipt.ATTEMPT_COUNT) === 1 && stateValid,
  'CONTROL_AUDIT_INVALID', 'Journey-core control evidence is invalid.',
  { httpStatus: 503 });
  return data;
}

function receiptMatches(data, command, action) {
  return data.schemaVersion === 1 && data.profile === 'free-test-journey-core-v1'
    && data.action === action && data.dealId === command.dealId
    && data.journeyId === command.journeyId
    && data.configurationVersionId === command.configurationVersionId
    && data.deploymentId === null
    && data.reason === (action === 'rollback' ? command.reason : null)
    && HASH.test(data.form2EvidenceFingerprint || '');
}

function createJourneyCoreControlService({ config, store, evidenceStore, crm, now = Date.now }) {
  invariant(config?.environment === 'development' && config?.deploymentMode === 'active'
    && HASH.test(config?.crmOrganizationSha256 || '')
    && HASH.test(config?.form2DestinationSha256 || '')
    && typeof config?.form2FormVersion === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(config.form2FormVersion)
    && typeof config?.form2WorkflowHmacMaterial === 'string'
    && config.form2WorkflowHmacMaterial.length >= 32
    && store && evidenceStore && crm && typeof crm.getDeal === 'function',
  'INVALID_RUNTIME_CONFIGURATION', 'Journey-core control dependencies are unavailable.',
  { httpStatus: 503 });
  const receiptTable = config.tables.EVENT_RECEIPT_TABLE;

  async function readContext(action, raw) {
    const command = validateCommand(action, raw);
    const [bundle, deal, receipts] = await Promise.all([
      evidenceStore.readBundle(command.submissionRowId),
      crm.getDeal(command.dealId),
      store.queryBounded(receiptTable, 'CONFIGURATION_VERSION_ID',
        command.configurationVersionId, 'RECEIVED_AT', 100, { RECEIPT_KIND: RECEIPT_KIND }),
    ]);
    invariant(receipts.length < 100, 'CONTROL_AUDIT_INVALID',
      'Journey-core receipt history exceeded its bounded read.', { httpStatus: 503 });
    const evidenceFingerprint = validateEvidence(bundle, command, deal, config);
    const parsed = receipts.map((receipt) => ({ receipt, data: parseReceipt(receipt, config) }));
    for (const item of parsed) {
      invariant(item.data.configurationVersionId === command.configurationVersionId
        && item.data.dealId === command.dealId && item.data.journeyId === command.journeyId,
      'CONTROL_IDEMPOTENCY_CONFLICT', 'Configuration evidence is bound to another journey.',
      { httpStatus: 409 });
    }
    return { command, bundle, deal, receipts: parsed, evidenceFingerprint };
  }

  function completed(context, action) {
    const matches = context.receipts.filter(({ receipt, data }) =>
      receipt.STATUS === 'Completed' && receiptMatches(data, context.command, action)
      && data.form2EvidenceFingerprint === context.evidenceFingerprint);
    invariant(matches.length <= 1, 'CONTROL_AUDIT_INVALID',
      'Journey-core decision history is ambiguous.', { httpStatus: 503 });
    return matches[0] || null;
  }

  function completedRollback(context) {
    const matches = context.receipts.filter(({ receipt, data }) =>
      receipt.STATUS === 'Completed' && data.schemaVersion === 1
      && data.profile === 'free-test-journey-core-v1' && data.action === 'rollback'
      && data.dealId === context.command.dealId
      && data.journeyId === context.command.journeyId
      && data.configurationVersionId === context.command.configurationVersionId
      && data.deploymentId === null
      && ROLLBACK_REASONS.has(data.reason)
      && data.form2EvidenceFingerprint === context.evidenceFingerprint);
    invariant(matches.length <= 1, 'CONTROL_AUDIT_INVALID',
      'Journey-core rollback history is ambiguous.', { httpStatus: 503 });
    return matches[0] || null;
  }

  function resumableClaim(context, action, decision, relatedEventKey = null) {
    const eventKey = receiptKey(config, action, context.command.idempotencyKey);
    const matches = context.receipts.filter(({ receipt }) => receipt.EVENT_KEY === eventKey);
    invariant(matches.length <= 1, 'CONTROL_AUDIT_INVALID',
      'Journey-core claim history is ambiguous.', { httpStatus: 503 });
    if (matches.length === 0) return null;
    const [{ receipt, data }] = matches;
    invariant(receiptMatches(data, context.command, action)
      && data.idempotencyKey === context.command.idempotencyKey
      && data.decision === decision
      && data.form2EvidenceFingerprint === context.evidenceFingerprint
      && receipt.RELATED_EVENT_KEY === relatedEventKey
      && new Set(['Processing', 'ReconciliationRequired']).has(receipt.STATUS),
    'CONTROL_IDEMPOTENCY_CONFLICT', 'Control idempotency key is bound to another request.',
    { httpStatus: 409 });
    return { receipt, data, replayed: false };
  }

  async function claim(context, action, decision, relatedEventKey = null) {
    const existing = completed(context, action);
    if (existing) return { ...existing, replayed: true };
    const resumable = resumableClaim(context, action, decision, relatedEventKey);
    if (resumable) return resumable;
    const eventKey = receiptKey(config, action, context.command.idempotencyKey);
    const nowMs = now();
    invariant(Number.isSafeInteger(nowMs) && nowMs >= 0,
      'INVALID_RUNTIME_CONFIGURATION', 'Journey-core clock is invalid.',
      { httpStatus: 503 });
    // CRM stores whole-second numeric-offset DateTimes. Stamp the durable
    // receipt at that same precision so exact instant readback cannot diverge
    // merely because JavaScript supplied subsecond precision.
    const decidedAt = new Date(Math.trunc(nowMs / 1000) * 1000).toISOString();
    const data = Object.freeze({
      schemaVersion: 1, profile: 'free-test-journey-core-v1', action,
      decision, dealId: context.command.dealId, journeyId: context.command.journeyId,
      deploymentId: null, configurationVersionId: context.command.configurationVersionId,
      idempotencyKey: context.command.idempotencyKey,
      reason: action === 'rollback' ? context.command.reason : null,
      form2EvidenceFingerprint: context.evidenceFingerprint, decidedAt,
    });
    const serialized = JSON.stringify(data);
    const identity = receiptOuterIdentity(
      config, data, config.sourceRevision, config.environment,
    );
    invariant(identity.eventKey === eventKey && identity.relatedEventKey === relatedEventKey,
      'CONTROL_AUDIT_INVALID', 'Journey-core claim identity is invalid.',
      { httpStatus: 503 });
    const row = {
      EVENT_KEY: identity.eventKey, RECEIPT_KIND, CALL_KEY: null,
      PAYLOAD_FINGERPRINT: receiptPayloadFingerprint(config, identity, serialized),
      EVENT_TYPE: identity.eventType,
      EVENT_DATA_JSON: serialized, CORRELATION_ID: null, DEPLOYMENT_ID: null,
      CONFIGURATION_VERSION_ID: identity.configurationVersionId,
      ROUTE_FINGERPRINT: null, ROUTE_READBACK_FINGERPRINT: null,
      RELATED_EVENT_KEY: identity.relatedEventKey, STATUS: 'Processing', RECEIPT_VERSION: 0,
      ATTEMPT_COUNT: 1, LEASE_TOKEN: null, LEASE_EXPIRES_AT: null,
      JOB_REFERENCE: null, ENQUEUED_AT: null, NEXT_ATTEMPT_AT: null,
      LAST_ERROR_CODE: null, RECEIVED_AT: identity.receivedAt, PROCESSED_AT: null,
      SOURCE_REVISION: identity.sourceRevision,
      SOURCE_ENVIRONMENT: identity.sourceEnvironment,
    };
    const inserted = await store.insertUnique(receiptTable, 'EVENT_KEY', row,
      RECEIPT_IMMUTABLE_FIELDS);
    const readData = parseReceipt(inserted.row, config);
    invariant(receiptMatches(readData, context.command, action)
      && readData.idempotencyKey === context.command.idempotencyKey
      && readData.form2EvidenceFingerprint === context.evidenceFingerprint,
    'CONTROL_IDEMPOTENCY_CONFLICT', 'Control idempotency key is bound to another request.',
    { httpStatus: 409 });
    invariant(new Set(['Processing', 'ReconciliationRequired', 'Completed'])
      .has(inserted.row.STATUS), 'CONTROL_AUDIT_INVALID',
    'Journey-core receipt state is invalid.', { httpStatus: 503 });
    return { receipt: inserted.row, data: readData,
      replayed: inserted.row.STATUS === 'Completed' };
  }

  async function complete(claimed) {
    const claimedData = parseReceipt(claimed.receipt, config);
    invariant(claimed.receipt.EVENT_DATA_JSON === JSON.stringify(claimedData),
      'CONTROL_AUDIT_INVALID', 'Journey-core claim serialization is invalid.',
      { httpStatus: 503 });
    if (claimed.receipt.STATUS === 'Completed') return claimed.receipt;
    const updated = await store.conditionalUpdate(receiptTable, claimed.receipt.ROWID, {
      STATUS: 'Completed', RECEIPT_VERSION: 1, PROCESSED_AT: claimedData.decidedAt,
      LAST_ERROR_CODE: null,
    }, receiptCasPredicates(claimed.receipt));
    const readback = updated || await store.unique(
      receiptTable, 'EVENT_KEY', claimed.receipt.EVENT_KEY,
    );
    const readData = parseReceipt(readback, config);
    invariant(receiptIdentityMatches(readback, claimed.receipt)
      && readback.STATUS === 'Completed' && Number(readback.RECEIPT_VERSION) === 1
      && readback.PROCESSED_AT === claimedData.decidedAt
      && readData.idempotencyKey === claimedData.idempotencyKey,
    'CONTROL_AUDIT_INCOMPLETE', 'Journey-core decision did not finalize.',
    { httpStatus: 503, ambiguous: true });
    return readback;
  }

  async function reconcileFailure(claimed, error) {
    parseReceipt(claimed.receipt, config);
    if (claimed.receipt.STATUS === 'Completed') throw error;
    let readback = null;
    try {
      const errorCode = typeof error?.code === 'string' && error.code.length <= 128
        ? error.code : 'CONTROL_FAILED';
      readback = await store.conditionalUpdate(receiptTable, claimed.receipt.ROWID, {
        STATUS: 'ReconciliationRequired', LAST_ERROR_CODE: errorCode,
      }, receiptCasPredicates(claimed.receipt));
    } catch (_) {
      // The original error remains authoritative; the next replay re-reads the claim.
    }
    if (readback) {
      parseReceipt(readback, config);
      invariant(receiptIdentityMatches(readback, claimed.receipt),
        'CONTROL_AUDIT_INVALID', 'Journey-core reconciliation identity changed.',
        { httpStatus: 503 });
    }
    throw error;
  }

  function requireApproval(context) {
    const approval = completed(context, 'approve');
    invariant(approval && approval.data.decision === 'ApprovedInactive',
      'CONTROL_PRECONDITION_FAILED', 'Configuration approval is unavailable.',
      { httpStatus: 409 });
    return approval;
  }

  function assertApprovedDeal(deal, command, approvedAt) {
    invariant(deal.Stage === 'Setup and QA' && deal.Test_Status === 'Scheduled'
      && deal.Go_Live_Approval_Status === 'Approved'
      && sameCrmInstant(deal.Go_Live_Approved_At, approvedAt)
      && deal.Approved_Configuration_Version === command.configurationVersionId
      && nullable(deal.Approved_Deployment_Record_ID)
      && nullable(deal.Deployment_Record_ID) && nullable(deal.Billing_Subscription_ID)
      && !deal.Test_Start_At && !deal.Test_End_At,
    'CONTROL_PRECONDITION_FAILED', 'CRM approval state is invalid.', { httpStatus: 409 });
  }

  function isStoppedDeal(deal, command, approvedAt, stoppedAt, reason) {
    return deal.Stage === 'Closed Lost' && deal.Test_Status === 'Failed'
      && deal.Go_Live_Approval_Status === 'Revoked'
      && sameCrmInstant(deal.Go_Live_Approved_At, approvedAt)
      && deal.Configuration_Version === command.configurationVersionId
      && deal.Approved_Configuration_Version === command.configurationVersionId
      && nullable(deal.Deployment_Record_ID)
      && nullable(deal.Approved_Deployment_Record_ID)
      && nullable(deal.Billing_Subscription_ID)
      && sameCrmInstant(deal.Test_End_At, stoppedAt)
      && sameCrmInstant(deal.Rollback_Completed_At, stoppedAt)
      && deal.Test_End_Reason === ROLLBACK_REASONS.get(reason)
      && typeof deal.Reason_For_Loss__s === 'string'
      && deal.Reason_For_Loss__s.trim().length > 0
      && !deal.Test_Start_At;
  }

  function assertStoppedDeal(deal, command, approvedAt, stoppedAt, reason) {
    invariant(isStoppedDeal(deal, command, approvedAt, stoppedAt, reason),
      'CONTROL_PRECONDITION_FAILED', 'CRM stopped state is invalid.', { httpStatus: 409 });
  }

  async function approve(raw) {
    const context = await readContext('approve', raw);
    invariant(!completedRollback(context), 'ACTIVATION_SUPERSEDED_BY_ROLLBACK',
      'Configuration was already stopped.', { httpStatus: 409 });
    const prior = completed(context, 'approve');
    if (prior) {
      assertApprovedDeal(context.deal, context.command, prior.data.decidedAt);
      return Object.freeze({ state: 'Scheduled', replayed: true,
        approved: true, active: false, stopped: false,
        configurationVersionId: context.command.configurationVersionId });
    }
    const claimed = await claim(context, 'approve', 'ApprovedInactive');
    try {
      const deal = await crm.recordCoreApproval(context.command.dealId, {
        configurationVersionId: context.command.configurationVersionId,
        approvedAt: claimed.data.decidedAt, expectedDeal: context.deal,
      });
      assertApprovedDeal(deal, context.command, claimed.data.decidedAt);
      await complete(claimed);
      return Object.freeze({ state: 'Scheduled', replayed: claimed.replayed,
        approved: true, active: false, stopped: false,
        configurationVersionId: context.command.configurationVersionId });
    } catch (error) {
      return reconcileFailure(claimed, error);
    }
  }

  async function activate(raw) {
    const context = await readContext('activate', raw);
    invariant(!completedRollback(context), 'ACTIVATION_SUPERSEDED_BY_ROLLBACK',
      'Configuration was stopped before activation.', { httpStatus: 409 });
    const approval = requireApproval(context);
    assertApprovedDeal(context.deal, context.command, approval.data.decidedAt);
    const claimed = await claim(context, 'activate', 'BlockedNoTelephonyDeployment',
      approval.receipt.EVENT_KEY);
    await complete(claimed);
    throw new RevenueDeskError('ISOLATED_RETELL_TEST_NUMBER_REQUIRED',
      'Activation requires a separately approved telephony deployment.',
      { httpStatus: 409, safeDetails: { approved: true, active: false } });
  }

  async function rollback(raw) {
    const context = await readContext('rollback', raw);
    const approval = requireApproval(context);
    const prior = completed(context, 'rollback');
    if (prior) {
      assertStoppedDeal(context.deal, context.command, approval.data.decidedAt,
        prior.data.decidedAt, prior.data.reason);
      return Object.freeze({ state: 'Stopped', replayed: true, approved: false,
        active: false, stopped: true,
        configurationVersionId: context.command.configurationVersionId });
    }
    const resumable = resumableClaim(context, 'rollback', 'RevokedInactive',
      approval.receipt.EVENT_KEY);
    if (resumable) {
      // A prior write can have reached CRM while its response/readback failed.
      // Only the exact stopped state bound to this immutable claim may bypass
      // the normal approved prestate during reconciliation.
      const stopped = isStoppedDeal(context.deal, context.command, approval.data.decidedAt,
        resumable.data.decidedAt, resumable.data.reason);
      if (!stopped) assertApprovedDeal(context.deal, context.command, approval.data.decidedAt);
    } else {
      assertApprovedDeal(context.deal, context.command, approval.data.decidedAt);
    }
    const claimed = resumable || await claim(context, 'rollback', 'RevokedInactive',
      approval.receipt.EVENT_KEY);
    try {
      const deal = await crm.recordCoreRollback(context.command.dealId, {
        configurationVersionId: context.command.configurationVersionId,
        stoppedAt: claimed.data.decidedAt,
        reason: ROLLBACK_REASONS.get(context.command.reason), expectedDeal: context.deal,
      });
      assertStoppedDeal(deal, context.command, approval.data.decidedAt,
        claimed.data.decidedAt, claimed.data.reason);
      await complete(claimed);
      return Object.freeze({ state: 'Stopped', replayed: claimed.replayed, approved: false,
        active: false, stopped: true,
        configurationVersionId: context.command.configurationVersionId });
    } catch (error) {
      return reconcileFailure(claimed, error);
    }
  }

  return Object.freeze({ approve, activate, rollback });
}

function isJourneyCoreCommand(body) {
  return plain(body) && (!Object.hasOwn(body, 'deploymentId')
    || body.deploymentId === '' || body.deploymentId === null);
}

module.exports = Object.freeze({
  RECEIPT_KIND, createJourneyCoreControlService, deterministicIdempotencyKey,
  isJourneyCoreCommand, validateCommand,
});
