'use strict';

const { canonicalStringify } = require('./canonical');
const { encodeCursor, decodeCursor } = require('./cursor');
const { sha256, hmacSha256, normalizeDigestKey } = require('./digests');
const { MigrationError, invariant } = require('./errors');
const {
  validateContract,
  validatePrivateInput,
  projectSourceRow,
  projectTargetRow,
  keyIdentity,
} = require('./contract');

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function approvedEnvelope(contract, privateInput) {
  const sortSnapshots = (entries) => entries.map((entry) => ({
    table: entry.table,
    rowCount: entry.rowCount,
    rows: [...entry.rows].sort((left, right) => compareText(
      canonicalStringify(left), canonicalStringify(right),
    )),
  })).sort((left, right) => compareText(left.table, right.table));
  return {
    contract,
    privateInput: {
      ...privateInput,
      sources: sortSnapshots(privateInput.sources),
      targets: sortSnapshots(privateInput.targets),
    },
  };
}

function computeApprovedInputDigest({ contract, privateInput }) {
  const normalizedContract = validateContract(contract);
  validatePrivateInput(privateInput, normalizedContract);
  return sha256(approvedEnvelope(normalizedContract, privateInput));
}

function rowDigest(digestKey, inputDigest, resource, row) {
  return hmacSha256(digestKey, 'revenue-desk-migration-row-v1', {
    inputDigest,
    resourceId: resource.id,
    targetTable: resource.targetTable,
    row,
  });
}

function keyDigest(digestKey, inputDigest, resource, keyValue) {
  return hmacSha256(digestKey, 'revenue-desk-migration-key-v1', {
    inputDigest,
    resourceId: resource.id,
    keyValue,
  });
}

function createConflict({
  digestKey, inputDigest, contract, privateInput, resource, reason, keyDigestValue,
  sourceDigests = [], targetDigests = [], missingColumns = [], rowOrdinal = null,
}) {
  const evidence = {
    schemaVersion: 1,
    migrationId: contract.migrationId,
    inputDigest,
    capturedAt: privateInput.capturedAt,
    resourceId: resource.id,
    sourceTable: resource.sourceTable,
    targetTable: resource.targetTable,
    reason,
    keyDigest: keyDigestValue,
    sourceDigests: [...sourceDigests].sort(compareText),
    targetDigests: [...targetDigests].sort(compareText),
    missingColumns: [...missingColumns].sort(compareText),
    rowOrdinal,
  };
  return Object.freeze({
    ...evidence,
    conflictId: hmacSha256(digestKey, 'revenue-desk-migration-conflict-v1', evidence),
  });
}

function invalidSourceOperation({
  digestKey, inputDigest, contract, privateInput, resource, row, rowIndex, reason, missingColumns,
}) {
  let candidateKey;
  try {
    candidateKey = row[resource.sourceKeyColumn];
    keyIdentity(candidateKey);
  } catch {
    candidateKey = null;
  }
  const invalidRowDigest = hmacSha256(digestKey, 'revenue-desk-migration-invalid-row-v1', {
    inputDigest, resourceId: resource.id, sourceRow: row,
  });
  const keyDigestValue = candidateKey === null
    ? invalidRowDigest
    : keyDigest(digestKey, inputDigest, resource, candidateKey);
  const conflict = createConflict({
    digestKey,
    inputDigest,
    contract,
    privateInput,
    resource,
    reason,
    keyDigestValue,
    sourceDigests: [invalidRowDigest],
    missingColumns,
    rowOrdinal: null,
  });
  return {
    kind: 'quarantine',
    sortKey: `0-invalid-${invalidRowDigest}`,
    resource,
    keyValue: candidateKey,
    keyDigest: keyDigestValue,
    conflict,
  };
}

function indexTargetRows(resource, rows, digestKey, inputDigest) {
  const byKey = new Map();
  for (const [rowIndex, row] of rows.entries()) {
    const projected = projectTargetRow(resource, row);
    const keyValue = projected[resource.targetKeyColumn];
    let identity;
    try {
      identity = keyIdentity(keyValue);
    } catch (error) {
      throw new MigrationError('INVALID_TARGET_PRESTATE',
        'Every target prestate row must expose a valid contracted key.', {
          resourceId: resource.id,
          rowIndex,
        });
    }
    const entry = {
      keyValue,
      projected,
      digest: rowDigest(digestKey, inputDigest, resource, projected),
    };
    const existing = byKey.get(identity) || [];
    existing.push(entry);
    byKey.set(identity, existing);
  }
  return byKey;
}

function collectResourceRecords({
  contract, privateInput, snapshots, resource, digestKey, inputDigest, partitionEntries,
}) {
  const targetIndex = indexTargetRows(
    resource, snapshots.targets.get(resource.targetTable), digestKey, inputDigest,
  );
  const sourceIndex = new Map();
  const records = [];

  for (const [rowIndex, sourceRow] of snapshots.sources.get(resource.sourceTable).entries()) {
    let projected;
    try {
      projected = projectSourceRow(resource, sourceRow);
    } catch (error) {
      if (!(error instanceof MigrationError)) throw error;
      records.push(invalidSourceOperation({
        digestKey,
        inputDigest,
        contract,
        privateInput,
        resource,
        row: sourceRow,
        rowIndex,
        reason: 'invalid_source_projection',
        missingColumns: [],
      }));
      continue;
    }
    const keyValue = projected.row[resource.targetKeyColumn];
    let identity;
    try {
      identity = keyIdentity(keyValue);
    } catch {
      records.push(invalidSourceOperation({
        digestKey,
        inputDigest,
        contract,
        privateInput,
        resource,
        row: sourceRow,
        rowIndex,
        reason: 'invalid_source_key',
        missingColumns: projected.missingColumns,
      }));
      continue;
    }
    if (projected.missingColumns.length > 0) {
      records.push(invalidSourceOperation({
        digestKey,
        inputDigest,
        contract,
        privateInput,
        resource,
        row: sourceRow,
        rowIndex,
        reason: 'missing_required_projection',
        missingColumns: projected.missingColumns,
      }));
      continue;
    }
    const digest = rowDigest(digestKey, inputDigest, resource, projected.row);
    const keyDigestValue = keyDigest(digestKey, inputDigest, resource, keyValue);
    const partitionValues = Object.fromEntries(
      resource.partitionColumns.map((column) => [column, projected.row[column]]),
    );
    const partitionKeyDigest = hmacSha256(
      digestKey,
      'revenue-desk-migration-partition-key-v1',
      { inputDigest, resourceId: resource.id, partitionValues },
    );
    const partition = partitionEntries.get(partitionKeyDigest) || {
      resourceId: resource.id,
      sourceTable: resource.sourceTable,
      targetTable: resource.targetTable,
      partitionKeyDigest,
      entries: [],
    };
    partition.entries.push({ keyDigest: keyDigestValue, rowDigest: digest });
    partitionEntries.set(partitionKeyDigest, partition);
    const candidates = sourceIndex.get(identity) || [];
    candidates.push({
      rowIndex,
      keyValue,
      keyDigest: keyDigestValue,
      projected: projected.row,
      digest,
      partitionKeyDigest,
    });
    sourceIndex.set(identity, candidates);
  }

  for (const [identity, candidates] of [...sourceIndex.entries()].sort((left, right) => compareText(left[0], right[0]))) {
    const candidate = candidates[0];
    if (candidates.length > 1) {
      const conflict = createConflict({
        digestKey,
        inputDigest,
        contract,
        privateInput,
        resource,
        reason: 'duplicate_source_key',
        keyDigestValue: candidate.keyDigest,
        sourceDigests: candidates.map((entry) => entry.digest),
      });
      records.push({
        kind: 'quarantine',
        sortKey: `1-${canonicalStringify(candidate.keyValue)}`,
        resource,
        keyValue: candidate.keyValue,
        keyDigest: candidate.keyDigest,
        conflict,
      });
      continue;
    }
    const targets = targetIndex.get(identity) || [];
    if (targets.length > 1) {
      const conflict = createConflict({
        digestKey,
        inputDigest,
        contract,
        privateInput,
        resource,
        reason: 'duplicate_target_key',
        keyDigestValue: candidate.keyDigest,
        sourceDigests: [candidate.digest],
        targetDigests: targets.map((entry) => entry.digest),
      });
      records.push({
        kind: 'quarantine',
        sortKey: `1-${canonicalStringify(candidate.keyValue)}`,
        resource,
        keyValue: candidate.keyValue,
        keyDigest: candidate.keyDigest,
        conflict,
      });
      continue;
    }
    if (targets.length === 1 && targets[0].digest !== candidate.digest) {
      const conflict = createConflict({
        digestKey,
        inputDigest,
        contract,
        privateInput,
        resource,
        reason: 'target_payload_conflict',
        keyDigestValue: candidate.keyDigest,
        sourceDigests: [candidate.digest],
        targetDigests: [targets[0].digest],
      });
      records.push({
        kind: 'quarantine',
        sortKey: `1-${canonicalStringify(candidate.keyValue)}`,
        resource,
        keyValue: candidate.keyValue,
        keyDigest: candidate.keyDigest,
        conflict,
      });
      continue;
    }
    records.push({
      kind: targets.length === 1 ? 'already_present' : 'insert',
      sortKey: `1-${canonicalStringify(candidate.keyValue)}`,
      resource,
      keyValue: candidate.keyValue,
      keyDigest: candidate.keyDigest,
      row: candidate.projected,
      rowDigest: candidate.digest,
      partitionKeyDigest: candidate.partitionKeyDigest,
    });
  }
  return records;
}

function summarize(records) {
  const counts = { total: records.length, insert: 0, alreadyPresent: 0, quarantine: 0 };
  for (const record of records) {
    if (record.kind === 'already_present') counts.alreadyPresent += 1;
    else counts[record.kind] += 1;
  }
  return Object.freeze(counts);
}

function createMigrationPlan({
  contract,
  privateInput,
  digestKey,
  cursor = null,
  batchSize = 100,
}) {
  normalizeDigestKey(digestKey);
  const normalizedContract = validateContract(contract);
  const snapshots = validatePrivateInput(privateInput, normalizedContract);
  invariant(Number.isSafeInteger(batchSize) && batchSize >= 1 && batchSize <= 1_000,
    'INVALID_BATCH_SIZE', 'Migration batch size must be between 1 and 1,000.');
  const inputDigest = sha256(approvedEnvelope(normalizedContract, privateInput));
  const partitionEntries = new Map();
  const plannedRecords = normalizedContract.resources.flatMap((resource) => collectResourceRecords({
    contract: normalizedContract,
    privateInput,
    snapshots,
    resource,
    digestKey,
    inputDigest,
    partitionEntries,
  })).sort((left, right) => compareText(
    `${left.resource.id}\u0000${left.sortKey}\u0000${left.kind}`,
    `${right.resource.id}\u0000${right.sortKey}\u0000${right.kind}`,
  ));
  const records = plannedRecords.map((record) => Object.freeze({
    ...record,
    ...(record.row ? { row: Object.freeze({ ...record.row }) } : {}),
  }));

  const partitions = [...partitionEntries.values()].map((partition) => {
    const entries = partition.entries.sort((left, right) => compareText(
      `${left.keyDigest}\u0000${left.rowDigest}`, `${right.keyDigest}\u0000${right.rowDigest}`,
    ));
    return Object.freeze({
      resourceId: partition.resourceId,
      sourceTable: partition.sourceTable,
      targetTable: partition.targetTable,
      partitionKeyDigest: partition.partitionKeyDigest,
      rowCount: entries.length,
      partitionDigest: hmacSha256(digestKey, 'revenue-desk-migration-partition-v1', {
        inputDigest,
        resourceId: partition.resourceId,
        partitionKeyDigest: partition.partitionKeyDigest,
        entries,
      }),
    });
  }).sort((left, right) => compareText(
    `${left.resourceId}\u0000${left.partitionKeyDigest}`,
    `${right.resourceId}\u0000${right.partitionKeyDigest}`,
  ));

  const summary = summarize(records);
  const planDigest = hmacSha256(digestKey, 'revenue-desk-migration-plan-v1', {
    inputDigest,
    migrationId: normalizedContract.migrationId,
    partitions,
    summary,
    records: records.map((record) => ({
      kind: record.kind,
      resourceId: record.resource.id,
      keyDigest: record.keyDigest,
      rowDigest: record.rowDigest || null,
      conflictId: record.conflict?.conflictId || null,
    })),
  });
  const offset = records.length === 0
    ? 0
    : decodeCursor(digestKey, cursor, inputDigest, records.length);
  const batch = records.slice(offset, offset + batchSize);
  const nextOffset = offset + batch.length;
  const nextCursor = nextOffset < records.length
    ? encodeCursor(digestKey, { inputDigest, offset: nextOffset })
    : null;

  return Object.freeze({
    schemaVersion: 1,
    private: true,
    warning: 'Contains private projected rows and keys. Do not log, commit, or place in public evidence.',
    migrationId: normalizedContract.migrationId,
    inputDigest,
    planDigest,
    capturedAt: privateInput.capturedAt,
    summary,
    partitions: Object.freeze(partitions),
    batch: Object.freeze({
      offset,
      size: batch.length,
      records: Object.freeze(batch),
      nextCursor,
    }),
  });
}

module.exports = {
  computeApprovedInputDigest,
  createMigrationPlan,
  rowDigest,
  keyDigest,
};
