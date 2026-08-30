'use strict';

const crypto = require('node:crypto');

const { invariant } = require('./errors');
const { keyedDigest } = require('./security');

const AUTHORIZATION_EVENT_DATA_FIELDS = Object.freeze([
  'schemaVersion', 'action', 'decision', 'configurationVersionId', 'routeFingerprint',
  'operatorIdHash', 'intentFingerprint', 'evidenceRevision', 'evidenceObservedAt',
  'expectedDeploymentVersion', 'capacityRemainingAtDecision', 'previousEventHash',
  'eventHash', 'decidedAt', 'approvalEventKey', 'routeReadbackFingerprint',
  'routeObservedAt', 'actualStartAt', 'expiresAt', 'controlBinding',
]);
const CONTROL_BINDING_FIELDS = Object.freeze([
  'schemaVersion', 'action', 'dealId', 'journeyId', 'deploymentId',
  'configurationVersionId', 'idempotencyKey', 'reason',
  'deploymentControlPrestateDigest', 'deploymentControlPoststateDigest',
]);
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CRM_ID = /^[1-9][0-9]{7,29}$/;
const IDEMPOTENCY_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CONTROL_DIGEST = /^control_[a-f0-9]{64}$/;
const HASH = /^[a-f0-9]{64}$/;
const APPROVAL_EVENT_HASH_FIELDS = Object.freeze([
  'AUTHORIZATION_EVENT_ID', 'EVENT_SCHEMA_VERSION', 'ACTION', 'DECISION',
  'DEPLOYMENT_ID', 'CONFIGURATION_VERSION_ID', 'ROUTE_FINGERPRINT',
  'OPERATOR_ID_HASH', 'INTENT_FINGERPRINT', 'EVIDENCE_REVISION',
  'EVIDENCE_OBSERVED_AT', 'EXPECTED_DEPLOYMENT_VERSION',
  'CAPACITY_REMAINING_AT_DECISION', 'PREVIOUS_EVENT_HASH', 'DECIDED_AT',
]);
const ACTIVATION_EVENT_HASH_FIELDS = Object.freeze([
  'AUTHORIZATION_EVENT_ID', 'EVENT_SCHEMA_VERSION', 'ACTION', 'DECISION',
  'DEPLOYMENT_ID', 'CONFIGURATION_VERSION_ID', 'ROUTE_FINGERPRINT',
  'ROUTE_READBACK_FINGERPRINT', 'ROUTE_OBSERVED_AT', 'APPROVAL_EVENT_KEY',
  'OPERATOR_ID_HASH', 'INTENT_FINGERPRINT', 'EVIDENCE_REVISION',
  'EVIDENCE_OBSERVED_AT', 'EXPECTED_DEPLOYMENT_VERSION', 'PREVIOUS_EVENT_HASH',
  'ACTUAL_START_AT', 'EXPIRES_AT', 'DECIDED_AT',
]);

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(value, fields, code, message, httpStatus) {
  invariant(plain(value), code, message, { httpStatus });
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  invariant(actual.length === expected.length
    && actual.every((field, index) => field === expected[index]),
  code, message, { httpStatus });
}

function validateControlBinding(binding, {
  code = 'INVALID_APPROVAL_EVENT',
  message = 'Authorization control binding is invalid.',
  httpStatus = 503,
} = {}) {
  exactFields(binding, CONTROL_BINDING_FIELDS, code, message, httpStatus);
  invariant(binding.schemaVersion === 1
    && new Set(['approve', 'activate', 'rollback']).has(binding.action)
    && CRM_ID.test(binding.dealId || '')
    && OPAQUE_ID.test(binding.journeyId || '')
    && OPAQUE_ID.test(binding.deploymentId || '')
    && OPAQUE_ID.test(binding.configurationVersionId || '')
    && IDEMPOTENCY_ID.test(binding.idempotencyKey || ''),
  code, message, { httpStatus });
  if (binding.action === 'rollback') {
    invariant(typeof binding.reason === 'string' && /^[a-z][a-z0-9_]{2,63}$/.test(binding.reason)
      && CONTROL_DIGEST.test(binding.deploymentControlPrestateDigest || '')
      && CONTROL_DIGEST.test(binding.deploymentControlPoststateDigest || ''),
    code, message, { httpStatus });
  } else {
    invariant(binding.reason === null
      && binding.deploymentControlPrestateDigest === null
      && binding.deploymentControlPoststateDigest === null,
    code, message, { httpStatus });
  }
  return Object.freeze({ ...binding });
}

function validateAuthorizationReceiptData(data, options = {}) {
  const {
    code = 'INVALID_APPROVAL_EVENT',
    message = 'Authorization receipt payload is invalid.',
    httpStatus = 503,
  } = options;
  exactFields(data, AUTHORIZATION_EVENT_DATA_FIELDS, code, message, httpStatus);
  validateControlBinding(data.controlBinding, { code, message, httpStatus });
  return Object.freeze({ ...data, controlBinding: Object.freeze({ ...data.controlBinding }) });
}

function serializeAuthorizationReceiptData(data, options = {}) {
  const validated = validateAuthorizationReceiptData(data, options);
  const ordered = {};
  for (const field of AUTHORIZATION_EVENT_DATA_FIELDS) ordered[field] = validated[field];
  return JSON.stringify(ordered);
}

function parseAuthorizationReceiptData(serialized, options = {}) {
  const {
    code = 'INVALID_APPROVAL_EVENT',
    message = 'Authorization receipt payload is invalid.',
    httpStatus = 503,
  } = options;
  invariant(typeof serialized === 'string' && Buffer.byteLength(serialized, 'utf8') <= 10_000,
    code, message, { httpStatus });
  let parsed;
  try { parsed = JSON.parse(serialized); } catch (_) { parsed = null; }
  const validated = validateAuthorizationReceiptData(parsed, { code, message, httpStatus });
  invariant(serializeAuthorizationReceiptData(validated, { code, message, httpStatus }) === serialized,
    code, message, { httpStatus });
  return validated;
}

function authorizationEventHash(eventChainSecret, event) {
  invariant(plain(event) && new Set(['approve', 'activate', 'revoke']).has(event.ACTION),
    'INVALID_APPROVAL_EVENT', 'Authorization event hash material is invalid.',
    { httpStatus: 503 });
  const fields = event.ACTION === 'activate'
    ? ACTIVATION_EVENT_HASH_FIELDS : APPROVAL_EVENT_HASH_FIELDS;
  return keyedDigest(eventChainSecret, 'revenue-desk-authorization-event-v1',
    fields.map((field) => event[field]));
}

function authorizationEventFromReceipt(receipt, data) {
  invariant(plain(receipt) && plain(data), 'INVALID_APPROVAL_EVENT',
    'Authorization receipt is invalid.', { httpStatus: 503 });
  return Object.freeze({
    AUTHORIZATION_EVENT_ID: receipt.EVENT_KEY,
    EVENT_SCHEMA_VERSION: data.schemaVersion,
    ACTION: data.action,
    DECISION: data.decision,
    DEPLOYMENT_ID: receipt.DEPLOYMENT_ID,
    CONFIGURATION_VERSION_ID: data.configurationVersionId,
    ROUTE_FINGERPRINT: data.routeFingerprint,
    ROUTE_READBACK_FINGERPRINT: data.routeReadbackFingerprint,
    ROUTE_OBSERVED_AT: data.routeObservedAt,
    APPROVAL_EVENT_KEY: data.approvalEventKey,
    OPERATOR_ID_HASH: data.operatorIdHash,
    INTENT_FINGERPRINT: data.intentFingerprint,
    EVIDENCE_REVISION: data.evidenceRevision,
    EVIDENCE_OBSERVED_AT: data.evidenceObservedAt,
    EXPECTED_DEPLOYMENT_VERSION: data.expectedDeploymentVersion,
    CAPACITY_REMAINING_AT_DECISION: data.capacityRemainingAtDecision,
    PREVIOUS_EVENT_HASH: data.previousEventHash,
    ACTUAL_START_AT: data.actualStartAt,
    EXPIRES_AT: data.expiresAt,
    DECIDED_AT: data.decidedAt,
    EVENT_HASH: data.eventHash,
  });
}

// The keyed receipt fingerprint protects the full canonical payload, including the
// journey/idempotency control binding that is intentionally outside the event chain.
function authorizationReceiptFingerprint(eventChainSecret, serialized) {
  invariant(typeof serialized === 'string' && Buffer.byteLength(serialized, 'utf8') <= 10_000,
    'INVALID_APPROVAL_EVENT', 'Authorization receipt payload is invalid.',
    { httpStatus: 503 });
  return keyedDigest(eventChainSecret, 'revenue-desk-authorization-receipt-v2', [serialized]);
}

function equalHash(left, right) {
  if (!HASH.test(left || '') || !HASH.test(right || '')) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function verifyAuthorizationReceiptIntegrity(receipt, eventChainSecret, options = {}) {
  const {
    code = 'INVALID_APPROVAL_EVENT',
    message = 'Authorization receipt failed integrity verification.',
    httpStatus = 503,
  } = options;
  invariant(plain(receipt), code, message, { httpStatus });
  const data = parseAuthorizationReceiptData(receipt.EVENT_DATA_JSON, {
    code, message, httpStatus,
  });
  const expectedReceiptFingerprint = authorizationReceiptFingerprint(
    eventChainSecret, receipt.EVENT_DATA_JSON,
  );
  const event = authorizationEventFromReceipt(receipt, data);
  const expectedEventHash = authorizationEventHash(eventChainSecret, event);
  invariant(equalHash(receipt.PAYLOAD_FINGERPRINT, expectedReceiptFingerprint)
    && equalHash(data.eventHash, expectedEventHash),
  code, message, { httpStatus });
  return Object.freeze({ data, event });
}

module.exports = Object.freeze({
  AUTHORIZATION_EVENT_DATA_FIELDS,
  ACTIVATION_EVENT_HASH_FIELDS,
  APPROVAL_EVENT_HASH_FIELDS,
  CONTROL_BINDING_FIELDS,
  CONTROL_DIGEST,
  authorizationEventFromReceipt,
  authorizationEventHash,
  authorizationReceiptFingerprint,
  parseAuthorizationReceiptData,
  serializeAuthorizationReceiptData,
  validateControlBinding,
  verifyAuthorizationReceiptIntegrity,
});
