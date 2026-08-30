'use strict';

const { hmacSha256, digestEquals, assertApprovedDigest } = require('./digests');
const { invariant, MigrationError } = require('./errors');
const { createMigrationPlan, rowDigest } = require('./planner');
const { projectTargetRow } = require('./contract');

const MODES = new Set(['dry-run', 'apply', 'reconcile']);

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function validateAdapter(adapter, mode) {
  invariant(plain(adapter), 'MIGRATION_ADAPTER_REQUIRED',
    `${mode} requires an explicitly injected private migration adapter.`);
  invariant(adapter.capabilities?.privateMigration === true
    && adapter.capabilities?.independentReadback === true,
  'MIGRATION_ADAPTER_REQUIRED', 'Migration adapter capabilities are not explicitly enabled.');
  invariant(typeof adapter.readTarget === 'function' && typeof adapter.readQuarantine === 'function',
    'MIGRATION_ADAPTER_REQUIRED', 'Migration adapter readback methods are unavailable.');
  if (mode === 'apply') invariant(typeof adapter.insertTarget === 'function'
    && typeof adapter.quarantineConflict === 'function',
  'MIGRATION_ADAPTER_REQUIRED', 'Apply adapter mutation methods are unavailable.');
  return adapter;
}

function operationDigest(digestKey, plan, record) {
  return hmacSha256(digestKey, 'revenue-desk-migration-operation-v1', {
    inputDigest: plan.inputDigest,
    planDigest: plan.planDigest,
    resourceId: record.resource.id,
    kind: record.kind,
    keyDigest: record.keyDigest,
    rowDigest: record.rowDigest || null,
    conflictId: record.conflict?.conflictId || null,
  });
}

async function readTarget(adapter, record) {
  let rows;
  try {
    rows = await adapter.readTarget({
      targetTable: record.resource.targetTable,
      keyColumn: record.resource.targetKeyColumn,
      keyValue: record.keyValue,
    });
  } catch {
    throw new MigrationError('TARGET_READBACK_FAILED',
      'The private adapter could not read the keyed target row.', {
        resourceId: record.resource.id,
        keyDigest: record.keyDigest,
      });
  }
  invariant(Array.isArray(rows) && rows.length <= 100, 'INVALID_ADAPTER_READBACK',
    'Target adapter readback must return a bounded row array.',
    { resourceId: record.resource.id, keyDigest: record.keyDigest });
  return rows;
}

function inspectRows(rows, record, digestKey, inputDigest) {
  if (rows.length === 0) return { status: 'missing', digests: [] };
  const digests = rows.map((row) => rowDigest(
    digestKey,
    inputDigest,
    record.resource,
    projectTargetRow(record.resource, row),
  )).sort();
  if (rows.length > 1) return { status: 'duplicate', digests };
  return {
    status: digests[0] === record.rowDigest ? 'matched' : 'conflict',
    digests,
  };
}

function runtimeConflict({ digestKey, plan, record, reason, targetDigests }) {
  const evidence = {
    schemaVersion: 1,
    migrationId: plan.migrationId,
    inputDigest: plan.inputDigest,
    capturedAt: plan.capturedAt,
    resourceId: record.resource.id,
    sourceTable: record.resource.sourceTable,
    targetTable: record.resource.targetTable,
    reason,
    keyDigest: record.keyDigest,
    sourceDigests: record.rowDigest ? [record.rowDigest] : [],
    targetDigests: [...targetDigests].sort(),
    missingColumns: [],
    rowOrdinal: null,
  };
  return Object.freeze({
    ...evidence,
    conflictId: hmacSha256(digestKey, 'revenue-desk-migration-conflict-v1', evidence),
  });
}

async function quarantineAndReadBack(adapter, conflict, operationId) {
  let writeFailure = false;
  try {
    await adapter.quarantineConflict({ conflict, idempotencyKey: operationId });
  } catch {
    writeFailure = true;
  }
  let readback;
  try {
    readback = await adapter.readQuarantine({ conflictId: conflict.conflictId });
  } catch {
    throw new MigrationError('QUARANTINE_READBACK_FAILED',
      'Conflict quarantine outcome is ambiguous because independent readback failed.', {
        conflictId: conflict.conflictId,
      });
  }
  invariant(plain(readback)
    && readback.conflictId === conflict.conflictId
    && readback.inputDigest === conflict.inputDigest
    && readback.reason === conflict.reason,
  'QUARANTINE_READBACK_FAILED', 'Conflict quarantine did not independently read back.', {
    conflictId: conflict.conflictId,
  });
  return {
    status: writeFailure ? 'quarantined_after_ambiguous_write' : 'quarantined',
    resourceId: conflict.resourceId,
    keyDigest: conflict.keyDigest,
    conflictId: conflict.conflictId,
    reason: conflict.reason,
    operationDigest: operationId,
  };
}

function rollbackMetadata(digestKey, plan, record, operationId) {
  const evidence = {
    schemaVersion: 1,
    migrationId: plan.migrationId,
    inputDigest: plan.inputDigest,
    planDigest: plan.planDigest,
    operationDigest: operationId,
    resourceId: record.resource.id,
    targetTable: record.resource.targetTable,
    targetKeyColumn: record.resource.targetKeyColumn,
    keyDigest: record.keyDigest,
    expectedPoststateDigest: record.rowDigest,
    verifiedPrestate: 'absent',
    mutationOwnershipEvidence: 'requires_private_adapter_receipt_review',
    rollbackAction: 'remove_inserted_target_only_after_verified_containment',
    rollbackAuthorized: false,
  };
  return Object.freeze({
    ...evidence,
    rollbackId: hmacSha256(digestKey, 'revenue-desk-migration-rollback-v1', evidence),
  });
}

async function applyRecord(adapter, plan, record, digestKey) {
  const operationId = operationDigest(digestKey, plan, record);
  if (record.kind === 'quarantine') {
    return { result: await quarantineAndReadBack(adapter, record.conflict, operationId), rollback: null };
  }

  const before = inspectRows(await readTarget(adapter, record), record, digestKey, plan.inputDigest);
  if (before.status === 'matched') {
    return {
      result: {
        status: 'already_converged',
        resourceId: record.resource.id,
        keyDigest: record.keyDigest,
        rowDigest: record.rowDigest,
        operationDigest: operationId,
      },
      rollback: null,
    };
  }
  if (before.status !== 'missing') {
    const conflict = runtimeConflict({
      digestKey,
      plan,
      record,
      reason: before.status === 'duplicate' ? 'apply_target_duplicate' : 'apply_target_drift',
      targetDigests: before.digests,
    });
    return { result: await quarantineAndReadBack(adapter, conflict, operationId), rollback: null };
  }
  if (record.kind === 'already_present') {
    const conflict = runtimeConflict({
      digestKey,
      plan,
      record,
      reason: 'apply_target_missing_after_prestate',
      targetDigests: [],
    });
    return { result: await quarantineAndReadBack(adapter, conflict, operationId), rollback: null };
  }

  let insertFailure = null;
  try {
    await adapter.insertTarget({
      targetTable: record.resource.targetTable,
      keyColumn: record.resource.targetKeyColumn,
      keyValue: record.keyValue,
      row: record.row,
      idempotencyKey: operationId,
      approvedInputDigest: plan.inputDigest,
    });
  } catch (error) {
    insertFailure = error;
  }

  // The write response is never evidence. A separate keyed read resolves success,
  // duplicate replay, and ambiguous provider timeouts without rewriting legacy data.
  let after;
  try {
    after = inspectRows(await readTarget(adapter, record), record, digestKey, plan.inputDigest);
  } catch (readError) {
    throw new MigrationError('TARGET_READBACK_FAILED',
      'Target insert outcome is ambiguous because independent readback failed.', {
        resourceId: record.resource.id,
        keyDigest: record.keyDigest,
        insertFailed: insertFailure !== null,
        readbackFailed: true,
      });
  }
  invariant(after.status === 'matched', 'TARGET_READBACK_FAILED',
    'Target insert did not independently read back with the approved projection.', {
      resourceId: record.resource.id,
      keyDigest: record.keyDigest,
      insertFailed: insertFailure !== null,
      readbackStatus: after.status,
    });
  return {
    result: {
      status: insertFailure ? 'converged_after_ambiguous_insert' : 'inserted_and_read_back',
      resourceId: record.resource.id,
      keyDigest: record.keyDigest,
      rowDigest: record.rowDigest,
      operationDigest: operationId,
    },
    rollback: rollbackMetadata(digestKey, plan, record, operationId),
  };
}

async function reconcileRecord(adapter, plan, record, digestKey) {
  const operationId = operationDigest(digestKey, plan, record);
  if (record.kind === 'quarantine') {
    let readback;
    try {
      readback = await adapter.readQuarantine({ conflictId: record.conflict.conflictId });
    } catch {
      return {
        status: 'quarantine_readback_failed',
        resourceId: record.resource.id,
        keyDigest: record.keyDigest,
        conflictId: record.conflict.conflictId,
        operationDigest: operationId,
      };
    }
    const matched = plain(readback)
      && readback.conflictId === record.conflict.conflictId
      && readback.inputDigest === plan.inputDigest
      && readback.reason === record.conflict.reason;
    return {
      status: matched ? 'quarantine_matched' : 'quarantine_missing_or_drifted',
      resourceId: record.resource.id,
      keyDigest: record.keyDigest,
      conflictId: record.conflict.conflictId,
      operationDigest: operationId,
    };
  }
  const inspected = inspectRows(await readTarget(adapter, record), record, digestKey, plan.inputDigest);
  return {
    status: inspected.status === 'matched' ? 'target_matched' : `target_${inspected.status}`,
    resourceId: record.resource.id,
    keyDigest: record.keyDigest,
    rowDigest: record.rowDigest,
    operationDigest: operationId,
  };
}

function sanitizedPlan(plan, mode) {
  return {
    schemaVersion: 1,
    mode,
    migrationId: plan.migrationId,
    inputDigest: plan.inputDigest,
    planDigest: plan.planDigest,
    summary: plan.summary,
    partitions: plan.partitions,
    batch: {
      offset: plan.batch.offset,
      size: plan.batch.size,
      nextCursor: plan.batch.nextCursor,
    },
    legacyRetention: {
      legacyResourcesPreserved: true,
      deletionAuthorized: false,
      retirementStatus: 'blocked_pending_complete_independent_readback_and_separate_review',
    },
  };
}

async function executeMigration({
  mode = 'dry-run',
  contract,
  privateInput,
  digestKey,
  approvedInputDigest = null,
  adapter = null,
  cursor = null,
  batchSize = 100,
}) {
  invariant(MODES.has(mode), 'INVALID_MIGRATION_MODE',
    'Migration mode must be dry-run, apply, or reconcile.');
  const plan = createMigrationPlan({ contract, privateInput, digestKey, cursor, batchSize });
  const result = sanitizedPlan(plan, mode);
  if (mode === 'dry-run') return Object.freeze(result);

  assertApprovedDigest(approvedInputDigest);
  invariant(digestEquals(approvedInputDigest, plan.inputDigest), 'APPROVED_INPUT_DIGEST_MISMATCH',
    'The immutable approved input digest does not match this migration snapshot.');
  validateAdapter(adapter, mode);

  const operations = [];
  const rollback = [];
  for (const record of plan.batch.records) {
    if (mode === 'apply') {
      const applied = await applyRecord(adapter, plan, record, digestKey);
      operations.push(applied.result);
      if (applied.rollback) rollback.push(applied.rollback);
    } else {
      operations.push(await reconcileRecord(adapter, plan, record, digestKey));
    }
  }
  const allMatched = mode === 'reconcile' && operations.every((operation) => (
    operation.status === 'target_matched' || operation.status === 'quarantine_matched'
  ));
  return Object.freeze({
    ...result,
    operations: Object.freeze(operations),
    rollback: Object.freeze(rollback),
    reconciliation: mode === 'reconcile' ? Object.freeze({
      batchReadbackComplete: allMatched,
      completeApprovedInputReadbackProven: allMatched
        && plan.batch.offset === 0 && plan.batch.nextCursor === null,
      retirementStatus: allMatched && plan.batch.offset === 0 && plan.batch.nextCursor === null
        ? 'eligible_for_separate_legacy_retirement_review'
        : 'blocked',
      deletionAuthorized: false,
    }) : null,
  });
}

module.exports = { executeMigration };
