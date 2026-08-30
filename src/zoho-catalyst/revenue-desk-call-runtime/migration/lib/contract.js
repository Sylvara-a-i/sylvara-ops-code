'use strict';

const { canonicalize } = require('./canonical');
const { invariant } = require('./errors');

const TABLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const COLUMN_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const ID_PATTERN = /^[a-z][a-z0-9_-]{2,63}$/;
const MAX_TEXT_BYTES = 10_000;

function plain(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function primitive(value) {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isSafeInteger(value));
}

function validatePrimitive(value, context) {
  invariant(primitive(value), 'INVALID_MIGRATION_VALUE',
    'Mapped migration values must be bounded JSON primitives.', context);
  if (typeof value === 'string') invariant(Buffer.byteLength(value, 'utf8') <= MAX_TEXT_BYTES,
    'INVALID_MIGRATION_VALUE', 'Mapped migration text exceeds the Catalyst column limit.', context);
  return value;
}

function exactKeys(value, allowed, code, message, details) {
  invariant(plain(value) && Object.keys(value).every((key) => allowed.has(key)), code, message, details);
}

function validateProjection(projection, resourceId, sourceKeyColumn, targetKeyColumn) {
  invariant(plain(projection) && Object.keys(projection).length > 0,
    'INVALID_MIGRATION_CONTRACT', 'Each resource requires a nonempty projection.', { resourceId });
  const normalized = {};
  for (const targetColumn of Object.keys(projection).sort()) {
    invariant(COLUMN_PATTERN.test(targetColumn), 'INVALID_MIGRATION_CONTRACT',
      'Projection target columns must use Catalyst API names.', { resourceId, targetColumn });
    const descriptor = projection[targetColumn];
    exactKeys(descriptor, new Set(['source', 'constant', 'required', 'nonBlank']),
      'INVALID_MIGRATION_CONTRACT', 'Projection descriptors contain an unsupported property.',
      { resourceId, targetColumn });
    const hasSource = Object.hasOwn(descriptor, 'source');
    const hasConstant = Object.hasOwn(descriptor, 'constant');
    invariant(hasSource !== hasConstant, 'INVALID_MIGRATION_CONTRACT',
      'A projection descriptor requires exactly one source or constant.', { resourceId, targetColumn });
    invariant(descriptor.required === undefined || typeof descriptor.required === 'boolean',
      'INVALID_MIGRATION_CONTRACT', 'Projection required flags must be Boolean.',
      { resourceId, targetColumn });
    invariant(descriptor.nonBlank === undefined || typeof descriptor.nonBlank === 'boolean',
      'INVALID_MIGRATION_CONTRACT', 'Projection nonBlank flags must be Boolean.',
      { resourceId, targetColumn });
    const required = descriptor.required === true;
    const nonBlank = descriptor.nonBlank === true;
    invariant(!nonBlank || required, 'INVALID_MIGRATION_CONTRACT',
      'A nonBlank projection must also be required.', { resourceId, targetColumn });
    if (hasSource) invariant(COLUMN_PATTERN.test(descriptor.source),
      'INVALID_MIGRATION_CONTRACT', 'Projection source columns must use Catalyst API names.',
      { resourceId, targetColumn });
    if (hasConstant) {
      validatePrimitive(descriptor.constant, { resourceId, targetColumn });
      invariant(!required || descriptor.constant !== null, 'INVALID_MIGRATION_CONTRACT',
        'A required constant projection cannot be null.', { resourceId, targetColumn });
      invariant(!nonBlank || (typeof descriptor.constant === 'string'
        && descriptor.constant.trim().length > 0),
      'INVALID_MIGRATION_CONTRACT', 'A nonBlank constant must contain non-whitespace text.',
      { resourceId, targetColumn });
    }
    normalized[targetColumn] = Object.freeze({
      ...(hasSource ? { source: descriptor.source } : { constant: descriptor.constant }),
      required,
      nonBlank,
    });
  }
  invariant(normalized[targetKeyColumn]?.source === sourceKeyColumn
    && normalized[targetKeyColumn].required === true,
  'INVALID_MIGRATION_CONTRACT', 'The target key must map directly from the required source key.',
  { resourceId, targetKeyColumn });
  return Object.freeze(normalized);
}

function validateContract(contract) {
  exactKeys(contract, new Set(['schemaVersion', 'migrationId', 'resources']),
    'INVALID_MIGRATION_CONTRACT', 'Migration contract contains unsupported properties.');
  invariant(contract.schemaVersion === 1 && ID_PATTERN.test(contract.migrationId || '')
    && Array.isArray(contract.resources) && contract.resources.length > 0,
  'INVALID_MIGRATION_CONTRACT', 'Migration contract identity or resources are invalid.');
  const resourceIds = new Set();
  const sourceTables = new Set();
  const targetTables = new Set();
  const resources = contract.resources.map((resource) => {
    exactKeys(resource, new Set([
      'id', 'sourceTable', 'targetTable', 'sourceKeyColumn', 'targetKeyColumn',
      'partitionColumns', 'projection',
    ]), 'INVALID_MIGRATION_CONTRACT', 'Migration resource contains unsupported properties.');
    invariant(ID_PATTERN.test(resource.id || '') && !resourceIds.has(resource.id),
      'INVALID_MIGRATION_CONTRACT', 'Migration resource IDs must be unique and bounded.',
      { resourceId: resource.id });
    const sourceTableIdentity = String(resource.sourceTable || '').toLowerCase();
    const targetTableIdentity = String(resource.targetTable || '').toLowerCase();
    invariant(typeof resource.sourceTable === 'string' && TABLE_PATTERN.test(resource.sourceTable)
      && !sourceTables.has(sourceTableIdentity)
      && typeof resource.targetTable === 'string' && TABLE_PATTERN.test(resource.targetTable)
      && !targetTables.has(targetTableIdentity),
    'INVALID_MIGRATION_CONTRACT', 'Migration source and target tables must be unique and valid.',
    { resourceId: resource.id });
    invariant(COLUMN_PATTERN.test(resource.sourceKeyColumn || '')
      && COLUMN_PATTERN.test(resource.targetKeyColumn || ''),
    'INVALID_MIGRATION_CONTRACT', 'Migration key columns must use Catalyst API names.',
    { resourceId: resource.id });
    invariant(Array.isArray(resource.partitionColumns) && resource.partitionColumns.length > 0
      && new Set(resource.partitionColumns).size === resource.partitionColumns.length
      && resource.partitionColumns.every((column) => COLUMN_PATTERN.test(column)),
    'INVALID_MIGRATION_CONTRACT', 'Migration partition columns must be a unique nonempty allowlist.',
    { resourceId: resource.id });
    const projection = validateProjection(
      resource.projection, resource.id, resource.sourceKeyColumn, resource.targetKeyColumn,
    );
    invariant(resource.partitionColumns.every((column) => projection[column]?.required),
      'INVALID_MIGRATION_CONTRACT', 'Every partition column must be a required projection.',
      { resourceId: resource.id });
    resourceIds.add(resource.id);
    sourceTables.add(sourceTableIdentity);
    targetTables.add(targetTableIdentity);
    return Object.freeze({
      ...resource,
      partitionColumns: Object.freeze([...resource.partitionColumns]),
      projection,
    });
  }).sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  invariant([...sourceTables].every((table) => !targetTables.has(table)),
    'INVALID_MIGRATION_CONTRACT',
    'Migration source and target table sets must be globally disjoint.');
  return Object.freeze({
    schemaVersion: 1,
    migrationId: contract.migrationId,
    resources: Object.freeze(resources),
  });
}

function validateTableSnapshots(entries, expectedTables, kind) {
  invariant(Array.isArray(entries) && entries.length === expectedTables.size,
    'INVALID_PRIVATE_INPUT', `Private ${kind} snapshots must cover every contracted table exactly once.`);
  const result = new Map();
  for (const entry of entries) {
    exactKeys(entry, new Set(['table', 'rowCount', 'rows']), 'INVALID_PRIVATE_INPUT',
      `Private ${kind} snapshot contains unsupported properties.`);
    invariant(expectedTables.has(entry.table) && !result.has(entry.table) && Array.isArray(entry.rows)
      && Number.isSafeInteger(entry.rowCount) && entry.rowCount >= 0
      && entry.rowCount === entry.rows.length,
      'INVALID_PRIVATE_INPUT', `Private ${kind} snapshot table coverage is invalid.`,
      { table: entry.table });
    for (const [index, row] of entry.rows.entries()) invariant(plain(row),
      'INVALID_PRIVATE_INPUT', `Private ${kind} rows must be plain objects.`,
      { table: entry.table, rowIndex: index });
    result.set(entry.table, entry.rows);
  }
  return result;
}

function validatePrivateInput(privateInput, contract) {
  exactKeys(privateInput, new Set([
    'schemaVersion', 'captureId', 'capturedAt', 'sources', 'targets',
  ]), 'INVALID_PRIVATE_INPUT', 'Private migration input contains unsupported properties.');
  invariant(privateInput.schemaVersion === 1 && typeof privateInput.captureId === 'string'
    && privateInput.captureId.length >= 8 && privateInput.captureId.length <= 128,
  'INVALID_PRIVATE_INPUT', 'Private migration capture identity is invalid.');
  invariant(typeof privateInput.capturedAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(privateInput.capturedAt)
    && Number.isFinite(Date.parse(privateInput.capturedAt)),
  'INVALID_PRIVATE_INPUT', 'Private migration capture timestamp must be UTC ISO-8601.');
  // Canonicalization here rejects undefined, non-JSON, unsafe-number, or cyclic input
  // before an approval digest can be computed over a misleading subset.
  canonicalize(privateInput);
  const sources = validateTableSnapshots(
    privateInput.sources, new Set(contract.resources.map((resource) => resource.sourceTable)), 'source',
  );
  const targets = validateTableSnapshots(
    privateInput.targets, new Set(contract.resources.map((resource) => resource.targetTable)), 'target',
  );
  return { sources, targets };
}

function projectSourceRow(resource, row) {
  const projected = {};
  const missingColumns = [];
  for (const [targetColumn, descriptor] of Object.entries(resource.projection)) {
    if (Object.hasOwn(descriptor, 'constant')) {
      projected[targetColumn] = descriptor.constant;
    } else if (Object.hasOwn(row, descriptor.source)) {
      const value = validatePrimitive(row[descriptor.source], {
        resourceId: resource.id, targetColumn,
      });
      if ((descriptor.required && value === null)
        || (descriptor.nonBlank && (typeof value !== 'string' || value.trim().length === 0))) {
        missingColumns.push(targetColumn);
      } else {
        projected[targetColumn] = value;
      }
    } else if (descriptor.required) {
      missingColumns.push(targetColumn);
    }
  }
  return { row: projected, missingColumns };
}

function projectTargetRow(resource, row) {
  invariant(plain(row), 'INVALID_TARGET_READBACK', 'Target readback must be a plain object.',
    { resourceId: resource.id });
  const projected = {};
  for (const targetColumn of Object.keys(resource.projection)) {
    if (Object.hasOwn(row, targetColumn)) projected[targetColumn] = validatePrimitive(
      row[targetColumn], { resourceId: resource.id, targetColumn },
    );
  }
  return projected;
}

function keyIdentity(value) {
  invariant((typeof value === 'string' && value.trim().length > 0
    && Buffer.byteLength(value, 'utf8') <= 256)
    || (typeof value === 'number' && Number.isSafeInteger(value)),
  'INVALID_SOURCE_KEY', 'Migration keys must be bounded strings or safe integers.');
  return `${typeof value}:${String(value)}`;
}

module.exports = {
  validateContract,
  validatePrivateInput,
  projectSourceRow,
  projectTargetRow,
  keyIdentity,
  validatePrimitive,
};
