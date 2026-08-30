'use strict';

const crypto = require('node:crypto');

const { invariant } = require('./errors');

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

function authorizationReceiptFingerprint(serialized) {
  return crypto.createHash('sha256')
    .update('revenue-desk-authorization-receipt-v1\0', 'utf8')
    .update(serialized, 'utf8').digest('hex');
}

module.exports = Object.freeze({
  AUTHORIZATION_EVENT_DATA_FIELDS,
  CONTROL_BINDING_FIELDS,
  CONTROL_DIGEST,
  authorizationReceiptFingerprint,
  parseAuthorizationReceiptData,
  serializeAuthorizationReceiptData,
  validateControlBinding,
});
