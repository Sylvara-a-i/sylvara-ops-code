'use strict';

const crypto = require('node:crypto');
const { canonicalStringify } = require('./canonical');
const { normalizeDigestKey, digestEquals } = require('./digests');
const { invariant } = require('./errors');

const CURSOR_PATTERN = /^v1\.([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/;

function cursorMac(digestKey, payloadText) {
  return crypto.createHmac('sha256', normalizeDigestKey(digestKey))
    .update(`revenue-desk-migration-cursor-v1\n${payloadText}`).digest('hex');
}

function encodeCursor(digestKey, payload) {
  const text = canonicalStringify({ version: 1, ...payload });
  const encoded = Buffer.from(text, 'utf8').toString('base64url');
  return `v1.${encoded}.${cursorMac(digestKey, encoded)}`;
}

function decodeCursor(digestKey, token, expectedInputDigest, totalRecords) {
  if (token === null || token === undefined || token === '') return 0;
  invariant(typeof token === 'string', 'INVALID_MIGRATION_CURSOR',
    'Migration cursor must be an opaque string.');
  const match = CURSOR_PATTERN.exec(token);
  invariant(match && digestEquals(match[2], cursorMac(digestKey, match[1])),
    'INVALID_MIGRATION_CURSOR', 'Migration cursor signature is invalid.');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
  } catch {
    invariant(false, 'INVALID_MIGRATION_CURSOR', 'Migration cursor payload is invalid.');
  }
  invariant(payload && payload.version === 1 && payload.inputDigest === expectedInputDigest
    && Number.isSafeInteger(payload.offset) && payload.offset >= 0 && payload.offset < totalRecords,
  'INVALID_MIGRATION_CURSOR', 'Migration cursor is stale or outside the approved input.');
  return payload.offset;
}

module.exports = { encodeCursor, decodeCursor };
