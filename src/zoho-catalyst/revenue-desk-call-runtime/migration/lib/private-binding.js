'use strict';

const { canonicalize } = require('./canonical');
const { SHA256_PATTERN, sha256 } = require('./digests');
const { invariant } = require('./errors');

const TABLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const COLUMN_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const ID_PATTERN = /^[a-z][a-z0-9_-]{2,63}$/;
const PRIVATE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_BINDING_BYTES = 65_536;
const MAX_APPROVAL_WINDOW_MS = 15 * 60 * 1000;
const sealedBindings = new WeakSet();

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, allowed, message) {
  invariant(plain(value) && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key)),
  'INVALID_PRIVATE_TARGET_BINDING', message);
}

function boundedPrivateId(value) {
  return typeof value === 'string' && PRIVATE_ID_PATTERN.test(value);
}

function canonicalUtcTimestampMs(value) {
  if (typeof value !== 'string' || !UTC_TIMESTAMP_PATTERN.test(value)) return null;
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) && new Date(timestampMs).toISOString() === value
    ? timestampMs
    : null;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validateConstraintEvidence(evidence, capturedAt, label) {
  exactKeys(evidence, new Set(['capturedAt', 'metadataSha256']),
    `${label} properties are invalid.`);
  invariant(evidence.capturedAt === capturedAt
    && UTC_TIMESTAMP_PATTERN.test(evidence.capturedAt || '')
    && SHA256_PATTERN.test(evidence.metadataSha256 || ''),
  'INVALID_PRIVATE_TARGET_BINDING',
  `${label} must bind fresh metadata from the approved capture.`);
  return { ...evidence };
}

function validateResource(resource, capturedAt) {
  exactKeys(resource, new Set([
    'resourceId', 'targetTable', 'keyColumn', 'columns', 'uniqueConstraintEvidence',
  ]), 'Private resource binding properties are invalid.');
  invariant(ID_PATTERN.test(resource.resourceId || '')
    && TABLE_PATTERN.test(resource.targetTable || '')
    && COLUMN_PATTERN.test(resource.keyColumn || '')
    && Array.isArray(resource.columns) && resource.columns.length >= 1
    && resource.columns.length <= 64
    && resource.columns.every((column) => COLUMN_PATTERN.test(column))
    && new Set(resource.columns).size === resource.columns.length
    && resource.columns.includes(resource.keyColumn),
  'INVALID_PRIVATE_TARGET_BINDING',
  'Private resource binding identity, columns, or unique-key evidence is invalid.');
  return {
    ...resource,
    columns: [...resource.columns].sort(),
    uniqueConstraintEvidence: validateConstraintEvidence(
      resource.uniqueConstraintEvidence,
      capturedAt,
      'Private resource unique-constraint evidence',
    ),
  };
}

function validateQuarantine(quarantine, capturedAt) {
  exactKeys(quarantine, new Set([
    'table', 'conflictIdColumn', 'inputDigestColumn', 'reasonColumn',
    'evidenceColumn', 'idempotencyColumn', 'uniqueConstraintEvidence',
  ]), 'Private quarantine binding properties are invalid.');
  const columns = [
    quarantine.conflictIdColumn,
    quarantine.inputDigestColumn,
    quarantine.reasonColumn,
    quarantine.evidenceColumn,
    quarantine.idempotencyColumn,
  ];
  invariant(TABLE_PATTERN.test(quarantine.table || '')
    && columns.every((column) => COLUMN_PATTERN.test(column))
    && new Set(columns).size === columns.length,
  'INVALID_PRIVATE_TARGET_BINDING',
  'Private quarantine table, columns, or unique-key evidence is invalid.');
  return {
    ...quarantine,
    uniqueConstraintEvidence: validateConstraintEvidence(
      quarantine.uniqueConstraintEvidence,
      capturedAt,
      'Private quarantine unique-constraint evidence',
    ),
  };
}

function validateBinding(parsed) {
  exactKeys(parsed, new Set([
    'schemaVersion', 'target', 'approval', 'resources', 'quarantine',
    'zcql', 'operationTimeoutMs',
  ]), 'Private target binding properties are invalid.');
  invariant(parsed.schemaVersion === 1,
    'INVALID_PRIVATE_TARGET_BINDING', 'Private target binding schema is unsupported.');

  exactKeys(parsed.target, new Set(['organizationId', 'projectId', 'environment']),
    'Private target identity properties are invalid.');
  invariant(boundedPrivateId(parsed.target.organizationId)
    && boundedPrivateId(parsed.target.projectId)
    && parsed.target.environment === 'Development',
  'INVALID_PRIVATE_TARGET_BINDING',
  'The private target must bind one exact Development organization and project.');

  exactKeys(parsed.approval, new Set([
    'migrationId', 'captureId', 'capturedAt', 'expiresAt', 'inputDigest', 'mode',
  ]), 'Private approval binding properties are invalid.');
  const capturedAtMs = canonicalUtcTimestampMs(parsed.approval.capturedAt);
  const expiresAtMs = canonicalUtcTimestampMs(parsed.approval.expiresAt);
  invariant(ID_PATTERN.test(parsed.approval.migrationId || '')
    && typeof parsed.approval.captureId === 'string'
    && parsed.approval.captureId.length >= 8 && parsed.approval.captureId.length <= 128
    && capturedAtMs !== null
    && expiresAtMs !== null
    && expiresAtMs > capturedAtMs
    && expiresAtMs - capturedAtMs <= MAX_APPROVAL_WINDOW_MS
    && SHA256_PATTERN.test(parsed.approval.inputDigest || '')
    && new Set(['apply', 'reconcile']).has(parsed.approval.mode),
  'INVALID_PRIVATE_TARGET_BINDING',
  'Private approval identity, digest, or validity window is invalid.');

  invariant(Array.isArray(parsed.resources) && parsed.resources.length >= 1
    && parsed.resources.length <= 64,
  'INVALID_PRIVATE_TARGET_BINDING', 'Private resource bindings are invalid.');
  const resources = parsed.resources.map((resource) => (
    validateResource(resource, parsed.approval.capturedAt)
  ))
    .sort((left, right) => left.resourceId.localeCompare(right.resourceId));
  invariant(new Set(resources.map((resource) => resource.resourceId)).size === resources.length
    && new Set(resources.map((resource) => resource.targetTable.toLowerCase())).size
      === resources.length,
  'INVALID_PRIVATE_TARGET_BINDING', 'Private resource bindings must be unique.');

  const quarantine = validateQuarantine(parsed.quarantine, parsed.approval.capturedAt);
  invariant(!resources.some((resource) => (
    resource.targetTable.toLowerCase() === quarantine.table.toLowerCase()
  )), 'INVALID_PRIVATE_TARGET_BINDING',
  'The quarantine table must be separate from every migration target.');

  exactKeys(parsed.zcql, new Set(['parser', 'pageSize', 'maxPages']),
    'Private ZCQL binding properties are invalid.');
  invariant(parsed.zcql.parser === 'V2'
    && parsed.zcql.pageSize === 2 && parsed.zcql.maxPages === 1,
    'INVALID_PRIVATE_TARGET_BINDING',
    'Private ZCQL reads must use parser V2 and one bounded duplicate-detection page.');
  invariant(Number.isSafeInteger(parsed.operationTimeoutMs)
    && parsed.operationTimeoutMs >= 250 && parsed.operationTimeoutMs <= 15_000,
  'INVALID_PRIVATE_TARGET_BINDING',
  'Private target operations require a bounded timeout between 250 and 15,000 milliseconds.');

  return {
    schemaVersion: 1,
    target: { ...parsed.target },
    approval: { ...parsed.approval },
    resources,
    quarantine,
    zcql: { parser: 'V2', pageSize: 2, maxPages: 1 },
    operationTimeoutMs: parsed.operationTimeoutMs,
  };
}

/**
 * Parses one private runtime binding and returns a deeply frozen, module-sealed copy.
 * Accepting serialized input prevents an operator from passing a mutable object whose
 * target can change between approval validation and the first provider operation.
 */
function parsePrivateTargetBinding(serialized) {
  invariant(typeof serialized === 'string' && Buffer.byteLength(serialized, 'utf8') >= 2
    && Buffer.byteLength(serialized, 'utf8') <= MAX_BINDING_BYTES,
  'INVALID_PRIVATE_TARGET_BINDING', 'A bounded serialized private target binding is required.');
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    invariant(false, 'INVALID_PRIVATE_TARGET_BINDING',
      'The private target binding is not valid JSON.');
  }
  // Canonicalization rejects prototypes, undefined values, unsafe numbers, and
  // cycles before any private identity is trusted as an immutable target.
  const binding = deepFreeze(canonicalize(validateBinding(parsed)));
  sealedBindings.add(binding);
  return binding;
}

function isSealedPrivateTargetBinding(value) {
  return plain(value) && Object.isFrozen(value) && sealedBindings.has(value);
}

/**
 * Rejects stale and future approvals at the execution seam. Parsing alone does
 * not consume authority because a private binding may be prepared before a run.
 */
function assertPrivateTargetBindingFresh(binding, nowMs = Date.now()) {
  invariant(isSealedPrivateTargetBinding(binding), 'PRIVATE_TARGET_BINDING_REQUIRED',
    'A parsed immutable private target binding is required.');
  invariant(Number.isFinite(nowMs), 'PRIVATE_TARGET_APPROVAL_TIME_INVALID',
    'The private target approval validation time is invalid.');
  const capturedAtMs = canonicalUtcTimestampMs(binding.approval.capturedAt);
  const expiresAtMs = canonicalUtcTimestampMs(binding.approval.expiresAt);
  invariant(capturedAtMs !== null && capturedAtMs <= nowMs,
    'PRIVATE_TARGET_APPROVAL_NOT_YET_VALID',
    'The private target approval capture is in the future.');
  invariant(expiresAtMs !== null && nowMs < expiresAtMs,
    'PRIVATE_TARGET_APPROVAL_EXPIRED',
    'The private target approval has expired.');
  return binding;
}

/**
 * Produces the digest that must be copied into a separate private approval envelope.
 * Execution code must receive that approved value independently; deriving and approving
 * it at execution time would collapse the target-approval boundary this digest protects.
 */
function computePrivateTargetBindingDigest(binding) {
  invariant(isSealedPrivateTargetBinding(binding), 'PRIVATE_TARGET_BINDING_REQUIRED',
    'A parsed immutable private target binding is required.');
  return sha256({
    domain: 'revenue-desk-private-target-binding-v1',
    binding,
  });
}

module.exports = {
  assertPrivateTargetBindingFresh,
  computePrivateTargetBindingDigest,
  isSealedPrivateTargetBinding,
  parsePrivateTargetBinding,
};
