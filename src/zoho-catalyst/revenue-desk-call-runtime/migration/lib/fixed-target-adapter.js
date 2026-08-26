'use strict';

const { canonicalStringify } = require('./canonical');
const { validateContract, validatePrivateInput, keyIdentity, validatePrimitive } = require('./contract');
const {
  SHA256_PATTERN, assertApprovedDigest, digestEquals,
} = require('./digests');
const { MigrationError, invariant } = require('./errors');
const { computeApprovedInputDigest } = require('./planner');
const {
  assertPrivateTargetBindingFresh,
  computePrivateTargetBindingDigest,
  isSealedPrivateTargetBinding,
} = require('./private-binding');

const HMAC_PATTERN = /^hmac-sha256:[a-f0-9]{64}$/;
const REASON_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const MAX_STATEMENT_BYTES = 65_536;
const MAX_ROW_BYTES = 48_000;
const MAX_EVIDENCE_BYTES = 10_000;
const LIVE_MODES = new Set(['apply', 'reconcile']);

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasExactKeys(value, expected) {
  return plain(value) && sameArray(Object.keys(value).sort(compareText), [...expected].sort(compareText));
}

function validateApprovalBoundary({
  binding,
  contract,
  privateInput,
  approvedInputDigest,
  approvedTargetBindingDigest,
  mode,
}) {
  assertPrivateTargetBindingFresh(binding);
  assertApprovedDigest(approvedInputDigest);
  invariant(SHA256_PATTERN.test(approvedTargetBindingDigest || ''),
    'APPROVED_TARGET_BINDING_DIGEST_REQUIRED',
    'Apply and reconcile require a separately approved private target-binding digest.');
  const normalizedContract = validateContract(contract);
  validatePrivateInput(privateInput, normalizedContract);
  const computedDigest = computeApprovedInputDigest({ contract: normalizedContract, privateInput });
  invariant(digestEquals(approvedInputDigest, computedDigest)
    && digestEquals(binding.approval.inputDigest, computedDigest),
  'APPROVED_INPUT_DIGEST_MISMATCH',
  'The private fixed-target binding does not match the exact approved migration input.');
  invariant(digestEquals(
    approvedTargetBindingDigest,
    computePrivateTargetBindingDigest(binding),
  ), 'APPROVED_TARGET_BINDING_DIGEST_MISMATCH',
  'The private fixed-target binding does not match the separately approved target digest.');
  invariant(binding.approval.migrationId === normalizedContract.migrationId
    && binding.approval.captureId === privateInput.captureId
    && binding.approval.capturedAt === privateInput.capturedAt
    && binding.approval.mode === mode,
  'PRIVATE_TARGET_APPROVAL_MISMATCH',
  'The private fixed-target binding does not match the approved migration capture.');

  const resources = new Map(binding.resources.map((resource) => [resource.resourceId, resource]));
  invariant(resources.size === normalizedContract.resources.length,
    'PRIVATE_TARGET_APPROVAL_MISMATCH',
    'The private target resource allowlist does not match the migration contract.');
  for (const resource of normalizedContract.resources) {
    const target = resources.get(resource.id);
    const columns = Object.keys(resource.projection).sort(compareText);
    invariant(target && target.targetTable === resource.targetTable
      && target.keyColumn === resource.targetKeyColumn
      && sameArray(target.columns, columns),
    'PRIVATE_TARGET_APPROVAL_MISMATCH',
    'The private target table or column allowlist does not match the migration contract.');
  }
  const occupiedTables = new Set(normalizedContract.resources.flatMap((resource) => (
    [resource.sourceTable.toLowerCase(), resource.targetTable.toLowerCase()]
  )));
  invariant(!occupiedTables.has(binding.quarantine.table.toLowerCase()),
    'PRIVATE_TARGET_APPROVAL_MISMATCH',
    'The private quarantine table overlaps a migration source or target.');
  return { normalizedContract, computedDigest };
}

function validateAuditPlane(audit) {
  invariant(plain(audit)
    && audit.capabilities?.fixedTarget === true
    && audit.capabilities?.identityReadback === true
    && audit.capabilities?.independentReadback === true
    && audit.capabilities?.constraintReadback === true
    && audit.capabilities?.readOnly === true
    && audit.capabilities?.zcqlV2 === true
    && typeof audit.readIdentity === 'function'
    && typeof audit.readUniqueConstraint === 'function'
    && typeof audit.executeZcql === 'function',
  'FIXED_TARGET_TRANSPORT_REQUIRED',
  'A fixed-target, read-only Catalyst audit plane with ZCQL V2 is required.');
  return audit;
}

function validateChangesPlane(changes, audit) {
  invariant(plain(changes) && changes !== audit
    && changes.capabilities?.fixedTarget === true
    && changes.capabilities?.identityReadback === true
    && changes.capabilities?.datastoreInsert === true
    && typeof changes.readIdentity === 'function'
    && typeof changes.insertRow === 'function',
  'FIXED_TARGET_TRANSPORT_REQUIRED',
  'Apply requires a distinct fixed-target Catalyst changes plane.');
  return changes;
}

function createEventLogger(logger, mode) {
  invariant(logger === null || logger === undefined || typeof logger === 'function',
    'INVALID_ADAPTER_LOGGER', 'The migration adapter logger must be a function.');
  return (operation, outcome, ambiguous = false) => {
    if (!logger) return;
    // Logs intentionally exclude identities, table names, statements, keys, rows,
    // digests, provider responses, and original exception messages.
    try {
      logger(Object.freeze({
        event: 'fixed_target_migration_operation', mode, operation, outcome, ambiguous,
      }));
    } catch {
      // A diagnostic sink cannot alter or obscure the durable provider outcome.
    }
  };
}

function timeoutError() {
  return new Error('bounded-operation-timeout');
}

async function callBounded(operation, timeoutMs, {
  code, message, operationName, ambiguous = false, log,
}) {
  let timer;
  log(operationName, 'started', false);
  try {
    const result = await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError()), timeoutMs);
      }),
    ]);
    log(operationName, 'succeeded', false);
    return result;
  } catch {
    log(operationName, 'failed', ambiguous);
    throw new MigrationError(code, message, { operation: operationName, ambiguous });
  } finally {
    clearTimeout(timer);
  }
}

function targetMatches(expected, actual) {
  return plain(actual)
    && typeof actual.organizationId === 'string'
    && typeof actual.projectId === 'string'
    && actual.environment === 'Development'
    && actual.organizationId === expected.organizationId
    && actual.projectId === expected.projectId;
}

async function verifyIdentity(plane, planeName, binding, log) {
  const identity = await callBounded(
    () => plane.readIdentity(),
    binding.operationTimeoutMs,
    {
      code: 'TARGET_IDENTITY_READ_FAILED',
      message: 'The Catalyst target identity could not be read independently.',
      operationName: `${planeName}_identity_read`,
      log,
    },
  );
  invariant(targetMatches(binding.target, identity), 'DEVELOPMENT_TARGET_MISMATCH',
    'The active Catalyst identity is not the exact approved Development target.');
}

async function verifyUniqueConstraint(audit, binding, {
  table, keyColumn, evidence, operationName,
}, log) {
  await verifyIdentity(audit, 'audit', binding, log);
  const actual = await callBounded(
    () => audit.readUniqueConstraint(Object.freeze({
      target: binding.target,
      table,
      keyColumn,
    })),
    binding.operationTimeoutMs,
    {
      code: 'UNIQUE_CONSTRAINT_READBACK_FAILED',
      message: 'The unique-constraint metadata could not be read independently.',
      operationName,
      log,
    },
  );
  invariant(hasExactKeys(actual, new Set([
    'evidenceSha256', 'keyColumn', 'table', 'unique',
  ]))
    && actual.table === table
    && actual.keyColumn === keyColumn
    && actual.unique === true
    && digestEquals(actual.evidenceSha256, evidence.metadataSha256),
  'UNIQUE_CONSTRAINT_READBACK_MISMATCH',
  'The current unique-constraint metadata does not match the separately approved evidence.');
}

function sqlValue(value) {
  validatePrimitive(value, {});
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function buildSelect({ table, columns, keyColumn, keyValue, rowLimit }) {
  const selected = [...new Set(['ROWID', ...columns])].sort(compareText);
  const statement = `SELECT ${selected.join(', ')} FROM ${table} WHERE ${keyColumn} = ${sqlValue(keyValue)} ORDER BY ROWID ASC LIMIT ${rowLimit}`;
  invariant(Buffer.byteLength(statement, 'utf8') <= MAX_STATEMENT_BYTES,
    'ZCQL_STATEMENT_REJECTED', 'The allowlisted ZCQL statement exceeds its size bound.');
  return { selected, statement };
}

function normalizeQueryRows(result, table, selected, rowLimit) {
  invariant(Array.isArray(result) && result.length <= rowLimit,
    'INVALID_AUDIT_READBACK', 'The bounded Catalyst audit response is invalid.');
  const allowed = new Set(selected);
  return result.map((entry) => {
    invariant(plain(entry), 'INVALID_AUDIT_READBACK',
      'The Catalyst audit response contains an invalid row.');
    const nested = entry[table];
    const row = plain(nested) ? nested : entry;
    invariant(plain(row) && Object.keys(row).every((column) => allowed.has(column)),
      'INVALID_AUDIT_READBACK',
      'The Catalyst audit response contains a column outside the generated allowlist.');
    const normalized = Object.create(null);
    for (const [column, value] of Object.entries(row)) {
      normalized[column] = validatePrimitive(value, {});
    }
    return normalized;
  });
}

function validateTargetRow(row, resource, normalizedResource) {
  invariant(plain(row) && Object.keys(row).length >= 1
    && Object.keys(row).every((column) => resource.columns.includes(column)),
  'TARGET_ROW_REJECTED', 'The target row contains a column outside the approved projection.');
  const normalized = Object.create(null);
  for (const [column, value] of Object.entries(row)) {
    normalized[column] = validatePrimitive(value, { resourceId: normalizedResource.id, column });
  }
  for (const [column, descriptor] of Object.entries(normalizedResource.projection)) {
    if (!descriptor.required) continue;
    invariant(Object.hasOwn(normalized, column) && normalized[column] !== null
      && (!descriptor.nonBlank || (typeof normalized[column] === 'string'
        && normalized[column].trim().length > 0)),
    'TARGET_ROW_REJECTED', 'The target row is missing a required approved value.');
  }
  invariant(Buffer.byteLength(JSON.stringify(normalized), 'utf8') <= MAX_ROW_BYTES,
    'TARGET_ROW_REJECTED', 'The target row exceeds the approved size.');
  return Object.freeze(normalized);
}

function createFixedTargetMigrationAdapter({
  mode,
  contract,
  privateInput,
  approvedInputDigest,
  approvedTargetBindingDigest,
  binding,
  transport,
  logger = null,
}) {
  invariant(LIVE_MODES.has(mode), 'INVALID_MIGRATION_MODE',
    'A fixed-target adapter may be created only for explicit apply or reconcile mode.');
  invariant(isSealedPrivateTargetBinding(binding), 'PRIVATE_TARGET_BINDING_REQUIRED',
    'Apply and reconcile require a parsed immutable private target binding.');
  const { normalizedContract, computedDigest } = validateApprovalBoundary({
    binding, contract, privateInput, approvedInputDigest, approvedTargetBindingDigest, mode,
  });
  invariant(plain(transport), 'FIXED_TARGET_TRANSPORT_REQUIRED',
    'A private fixed-target Catalyst transport is required.');
  const audit = validateAuditPlane(transport.audit);
  // Reconcile deliberately does not inspect or retain a write-capable plane.
  const changes = mode === 'apply' ? validateChangesPlane(transport.changes, audit) : null;
  const log = createEventLogger(logger, mode);
  const contractResources = new Map(normalizedContract.resources.map((resource) => (
    [resource.id, resource]
  )));
  const resourcesByTable = new Map(binding.resources.map((resource) => (
    [resource.targetTable, {
      binding: resource,
      contract: contractResources.get(resource.resourceId),
    }]
  )));

  async function queryBounded({ table, columns, keyColumn, keyValue, operationName }) {
    keyIdentity(keyValue);
    await verifyIdentity(audit, 'audit', binding, log);
    const query = buildSelect({
      table,
      columns,
      keyColumn,
      keyValue,
      rowLimit: binding.zcql.pageSize,
    });
    const result = await callBounded(
      () => audit.executeZcql(Object.freeze({
        target: binding.target,
        parser: binding.zcql.parser,
        statement: query.statement,
        pagination: Object.freeze({
          pageSize: binding.zcql.pageSize,
          maxPages: binding.zcql.maxPages,
        }),
      })),
      binding.operationTimeoutMs,
      {
        code: 'AUDIT_ZCQL_READ_FAILED',
        message: 'The bounded Catalyst audit query failed.',
        operationName,
        log,
      },
    );
    return normalizeQueryRows(result, table, query.selected, binding.zcql.pageSize);
  }

  async function readTarget({ targetTable, keyColumn, keyValue }) {
    const resource = resourcesByTable.get(targetTable);
    invariant(resource && keyColumn === resource.binding.keyColumn,
      'TARGET_ALLOWLIST_REJECTED',
      'The target table or key column is outside the immutable private allowlist.');
    const rows = await queryBounded({
      table: resource.binding.targetTable,
      columns: resource.binding.columns,
      keyColumn: resource.binding.keyColumn,
      keyValue,
      operationName: 'target_readback',
    });
    return rows.map((row) => Object.freeze(Object.fromEntries(
      resource.binding.columns
        .filter((column) => Object.hasOwn(row, column))
        .map((column) => [column, row[column]]),
    )));
  }

  async function readQuarantine({ conflictId }) {
    invariant(HMAC_PATTERN.test(conflictId || ''), 'QUARANTINE_KEY_REJECTED',
      'The quarantine conflict key is invalid.');
    const quarantine = binding.quarantine;
    const columns = [
      quarantine.conflictIdColumn,
      quarantine.inputDigestColumn,
      quarantine.reasonColumn,
    ];
    const rows = await queryBounded({
      table: quarantine.table,
      columns,
      keyColumn: quarantine.conflictIdColumn,
      keyValue: conflictId,
      operationName: 'quarantine_readback',
    });
    invariant(rows.length <= 1, 'QUARANTINE_OWNERSHIP_AMBIGUOUS',
      'The unique quarantine conflict key returned multiple rows.');
    if (rows.length === 0) return null;
    return Object.freeze({
      conflictId: rows[0][quarantine.conflictIdColumn],
      inputDigest: rows[0][quarantine.inputDigestColumn],
      reason: rows[0][quarantine.reasonColumn],
    });
  }

  const base = {
    capabilities: Object.freeze({ privateMigration: true, independentReadback: true }),
    readTarget,
    readQuarantine,
  };
  if (mode === 'reconcile') return Object.freeze(base);

  async function insertRow(table, row, operationName, approval) {
    await verifyIdentity(changes, 'changes', binding, log);
    return callBounded(
      () => changes.insertRow(Object.freeze({
        target: binding.target,
        table,
        row,
        approval,
      })),
      binding.operationTimeoutMs,
      {
        code: 'CATALYST_WRITE_AMBIGUOUS',
        message: 'The Catalyst insert outcome is ambiguous and requires independent readback.',
        operationName,
        ambiguous: true,
        log,
      },
    );
  }

  async function insertTarget({
    targetTable, keyColumn, keyValue, row, idempotencyKey, approvedInputDigest: requestDigest,
  }) {
    const resource = resourcesByTable.get(targetTable);
    invariant(resource && keyColumn === resource.binding.keyColumn,
      'TARGET_ALLOWLIST_REJECTED',
      'The target table or key column is outside the immutable private allowlist.');
    invariant(HMAC_PATTERN.test(idempotencyKey || '')
      && SHA256_PATTERN.test(requestDigest || '')
      && digestEquals(requestDigest, computedDigest),
    'TARGET_WRITE_APPROVAL_REJECTED',
    'The target insert is not bound to the approved migration operation and input.');
    keyIdentity(keyValue);
    const normalized = validateTargetRow(row, resource.binding, resource.contract);
    invariant(Object.hasOwn(normalized, keyColumn)
      && keyIdentity(normalized[keyColumn]) === keyIdentity(keyValue),
    'TARGET_WRITE_APPROVAL_REJECTED',
    'The target insert key does not match the approved projected row.');
    await verifyUniqueConstraint(audit, binding, {
      table: resource.binding.targetTable,
      keyColumn: resource.binding.keyColumn,
      evidence: resource.binding.uniqueConstraintEvidence,
      operationName: 'target_unique_constraint_readback',
    }, log);
    await insertRow(
      resource.binding.targetTable,
      normalized,
      'target_insert',
      Object.freeze({ inputDigest: computedDigest, operationDigest: idempotencyKey }),
    );
  }

  async function quarantineConflict({ conflict, idempotencyKey }) {
    invariant(plain(conflict)
      && HMAC_PATTERN.test(conflict.conflictId || '')
      && SHA256_PATTERN.test(conflict.inputDigest || '')
      && digestEquals(conflict.inputDigest, computedDigest)
      && REASON_PATTERN.test(conflict.reason || '')
      && HMAC_PATTERN.test(idempotencyKey || ''),
    'QUARANTINE_WRITE_REJECTED',
    'The quarantine write is not bound to the approved migration conflict.');
    const existing = await readQuarantine({ conflictId: conflict.conflictId });
    if (existing) {
      invariant(existing.conflictId === conflict.conflictId
        && digestEquals(existing.inputDigest, conflict.inputDigest)
        && existing.reason === conflict.reason,
      'QUARANTINE_WRITE_REJECTED',
      'The durable quarantine key is already bound to different evidence.');
      return;
    }
    const evidence = canonicalStringify(conflict);
    invariant(Buffer.byteLength(evidence, 'utf8') <= MAX_EVIDENCE_BYTES,
      'QUARANTINE_WRITE_REJECTED', 'The sanitized conflict evidence exceeds its size bound.');
    const quarantine = binding.quarantine;
    const row = Object.freeze({
      [quarantine.conflictIdColumn]: conflict.conflictId,
      [quarantine.inputDigestColumn]: conflict.inputDigest,
      [quarantine.reasonColumn]: conflict.reason,
      [quarantine.evidenceColumn]: evidence,
      [quarantine.idempotencyColumn]: idempotencyKey,
    });
    await verifyUniqueConstraint(audit, binding, {
      table: quarantine.table,
      keyColumn: quarantine.conflictIdColumn,
      evidence: quarantine.uniqueConstraintEvidence,
      operationName: 'quarantine_unique_constraint_readback',
    }, log);
    await insertRow(
      quarantine.table,
      row,
      'quarantine_insert',
      Object.freeze({ inputDigest: computedDigest, operationDigest: idempotencyKey }),
    );
  }

  return Object.freeze({ ...base, insertTarget, quarantineConflict });
}

module.exports = { createFixedTargetMigrationAdapter };
