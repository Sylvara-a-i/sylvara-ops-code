'use strict';

const crypto = require('node:crypto');
const { canonicalStringify } = require('./canonical');
const { invariant } = require('./errors');

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

function normalizeDigestKey(value) {
  invariant(typeof value === 'string' || Buffer.isBuffer(value),
    'INVALID_DIGEST_KEY', 'A private migration digest key is required.');
  const key = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, 'utf8');
  invariant(key.length >= 32, 'INVALID_DIGEST_KEY',
    'The private migration digest key must contain at least 32 bytes.');
  return key;
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

function hmacSha256(digestKey, domain, value) {
  invariant(typeof domain === 'string' && domain.length > 0,
    'INVALID_DIGEST_DOMAIN', 'A digest domain is required.');
  return `hmac-sha256:${crypto.createHmac('sha256', normalizeDigestKey(digestKey))
    .update(`${domain}\n${canonicalStringify(value)}`).digest('hex')}`;
}

function digestEquals(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function assertApprovedDigest(value) {
  invariant(SHA256_PATTERN.test(value || ''), 'APPROVED_INPUT_DIGEST_REQUIRED',
    'Apply and reconcile require an immutable approved input digest.');
  return value;
}

module.exports = {
  SHA256_PATTERN,
  normalizeDigestKey,
  sha256,
  hmacSha256,
  digestEquals,
  assertApprovedDigest,
};
