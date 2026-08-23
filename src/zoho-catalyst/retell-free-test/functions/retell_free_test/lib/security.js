'use strict';

const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const { FreeTestError, invariant } = require('./errors');

const RETELL_SIGNATURE_PATTERN = /^v=([0-9]{1,16}),d=([0-9a-fA-F]{64})$/;

function asRawUtf8(rawBody) {
  invariant(Buffer.isBuffer(rawBody), 'INVALID_RAW_BODY', 'Webhook verification requires the raw request bytes.', { httpStatus: 400 });
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
  } catch (error) {
    throw new FreeTestError('INVALID_RAW_BODY', 'Webhook body is not valid UTF-8.', { cause: error, httpStatus: 400 });
  }
}

function verifyRetellSignature({ rawBody, signatureHeader, verificationKey, nowMs, maxAgeMs = 300_000 }) {
  invariant(typeof signatureHeader === 'string', 'MISSING_SIGNATURE', 'Retell signature is required.', { httpStatus: 401 });
  invariant(typeof verificationKey === 'string' && verificationKey.length >= 24, 'INVALID_RUNTIME_CONFIGURATION', 'Retell verification key is unavailable.', { httpStatus: 503 });
  invariant(maxAgeMs === 300_000, 'INVALID_RUNTIME_CONFIGURATION', 'Retell signature maximum age must remain 300 seconds.', { httpStatus: 503 });
  const match = RETELL_SIGNATURE_PATTERN.exec(signatureHeader.trim());
  invariant(match, 'INVALID_SIGNATURE', 'Retell signature format is invalid.', { httpStatus: 401 });
  const timestamp = Number(match[1]);
  invariant(Number.isSafeInteger(timestamp), 'INVALID_SIGNATURE', 'Retell signature timestamp is invalid.', { httpStatus: 401 });
  invariant(Math.abs(nowMs - timestamp) <= maxAgeMs, 'STALE_SIGNATURE', 'Retell signature is outside the accepted window.', { httpStatus: 401 });
  const rawText = asRawUtf8(rawBody);
  const expected = crypto.createHmac('sha256', verificationKey).update(rawText + match[1], 'utf8').digest();
  const provided = Buffer.from(match[2], 'hex');
  invariant(provided.length === expected.length && crypto.timingSafeEqual(provided, expected),
    'INVALID_SIGNATURE', 'Retell signature did not verify.', { httpStatus: 401 });
  return Object.freeze({ timestamp });
}

function keyedDigest(secret, domain, parts) {
  invariant(typeof secret === 'string' && secret.length >= 32, 'INVALID_RUNTIME_CONFIGURATION', `${domain} key material is unavailable.`, { httpStatus: 503 });
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(domain, 'utf8');
  for (const part of parts) {
    hmac.update('\0', 'utf8');
    hmac.update(String(part), 'utf8');
  }
  return hmac.digest('hex');
}

function admissionId(secret, inbound) {
  return `adm_${keyedDigest(secret, 'free-test-admission-v1', [
    inbound.eventTimestamp,
    inbound.toNumber,
    inbound.fromNumber,
  ]).slice(0, 40)}`;
}

function numberLookupKey(secret, toNumber) {
  return `num_${keyedDigest(secret, 'free-test-number-v1', [toNumber])}`;
}

function eventReceiptKey(secret, event, callId) {
  return `evt_${keyedDigest(secret, 'free-test-event-v1', [event, callId])}`;
}

function callLookupKey(secret, callId) {
  return `call_${keyedDigest(secret, 'free-test-call-v1', [callId])}`;
}

function payloadFingerprint(secret, rawBody) {
  return keyedDigest(secret, 'free-test-event-payload-v1', [asRawUtf8(rawBody)]);
}

function publicCorrelationId(secret, parts) {
  return `corr_${keyedDigest(secret, 'free-test-correlation-v1', parts).slice(0, 32)}`;
}

module.exports = {
  verifyRetellSignature,
  keyedDigest,
  admissionId,
  numberLookupKey,
  eventReceiptKey,
  callLookupKey,
  payloadFingerprint,
  publicCorrelationId,
};
