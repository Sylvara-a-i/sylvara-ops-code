'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const publicApi = require('..');
const {
  computeApprovedInputDigest,
  createMigrationPlan,
  MigrationError,
} = publicApi;
const { executeMigration } = require('../lib/executor');

const DIGEST_KEY = 'synthetic-only-digest-key-material-000000000000000000000000';

function contractFixture() {
  return {
    schemaVersion: 1,
    migrationId: 'synthetic-development-copy-v1',
    resources: [{
      id: 'deployments',
      sourceTable: 'LegacyDeployments',
      targetTable: 'RevenueDeskDeployments',
      sourceKeyColumn: 'LEGACY_KEY',
      targetKeyColumn: 'DEPLOYMENT_KEY',
      partitionColumns: ['SOURCE_ENVIRONMENT', 'ENGAGEMENT_TYPE'],
      projection: {
        DEPLOYMENT_KEY: { source: 'LEGACY_KEY', required: true },
        SOURCE_ENVIRONMENT: { source: 'ENVIRONMENT', required: true },
        ENGAGEMENT_TYPE: { constant: 'free_test', required: true },
        VALUE: { source: 'LEGACY_VALUE', required: true },
        OPTIONAL_VALUE: { source: 'LEGACY_OPTIONAL' },
      },
    }],
  };
}

function privateInputFixture() {
  return {
    schemaVersion: 1,
    captureId: 'synthetic-private-capture-001',
    capturedAt: '2026-01-01T00:00:00Z',
    sources: [{
      table: 'LegacyDeployments',
      rowCount: 6,
      rows: [
        { LEGACY_KEY: 'a', ENVIRONMENT: 'development', LEGACY_VALUE: 'alpha', SECRET_SOURCE: 'ignored-a' },
        { LEGACY_KEY: 'b', ENVIRONMENT: 'development', LEGACY_VALUE: 'beta', SECRET_SOURCE: 'ignored-b' },
        { LEGACY_KEY: 'c', ENVIRONMENT: 'development', LEGACY_VALUE: 'gamma' },
        { LEGACY_KEY: 'd', ENVIRONMENT: 'development', LEGACY_VALUE: 'delta-one' },
        { LEGACY_KEY: 'd', ENVIRONMENT: 'development', LEGACY_VALUE: 'delta-two' },
        { LEGACY_KEY: 'e', ENVIRONMENT: 'development', SECRET_SOURCE: 'missing-required-value' },
      ],
    }],
    targets: [{
      table: 'RevenueDeskDeployments',
      rowCount: 2,
      rows: [
        {
          ROWID: '1001',
          DEPLOYMENT_KEY: 'b',
          SOURCE_ENVIRONMENT: 'development',
          ENGAGEMENT_TYPE: 'free_test',
          VALUE: 'beta',
          PROVIDER_METADATA: 'ignored',
        },
        {
          ROWID: '1002',
          DEPLOYMENT_KEY: 'c',
          SOURCE_ENVIRONMENT: 'development',
          ENGAGEMENT_TYPE: 'free_test',
          VALUE: 'different',
        },
      ],
    }],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createAdapter(privateInput = privateInputFixture(), options = {}) {
  const targets = new Map();
  const quarantines = new Map();
  const calls = { read: 0, insert: 0, quarantine: 0, readQuarantine: 0 };
  for (const snapshot of privateInput.targets) {
    for (const row of snapshot.rows) targets.set(`${snapshot.table}:${row.DEPLOYMENT_KEY}`, clone(row));
  }
  const adapter = {
    capabilities: { privateMigration: true, independentReadback: true },
    async readTarget({ targetTable, keyValue }) {
      calls.read += 1;
      const row = targets.get(`${targetTable}:${keyValue}`);
      return row ? [clone(row)] : [];
    },
    async insertTarget({ targetTable, keyValue, row }) {
      calls.insert += 1;
      targets.set(`${targetTable}:${keyValue}`, clone(row));
      if (options.throwAfterInsert) throw new Error('synthetic ambiguous timeout');
      return { accepted: true };
    },
    async quarantineConflict({ conflict }) {
      calls.quarantine += 1;
      quarantines.set(conflict.conflictId, clone(conflict));
    },
    async readQuarantine({ conflictId }) {
      calls.readQuarantine += 1;
      const conflict = quarantines.get(conflictId);
      return conflict ? clone(conflict) : null;
    },
  };
  return { adapter, targets, quarantines, calls };
}

test('public API excludes the arbitrary-adapter executor and blocks package subpath bypass', () => {
  assert.equal(Object.hasOwn(publicApi, 'executeMigration'), false);
  assert.equal(Object.hasOwn(publicApi, 'createFixedTargetMigrationAdapter'), false);
  assert.throws(
    () => require('revenue-desk-canonical-table-migration/lib/executor'),
    (error) => error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
  );
  assert.throws(
    () => require('revenue-desk-canonical-table-migration/lib/fixed-target-adapter'),
    (error) => error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
  );
});

test('planner copies only allowlisted projections and quarantines every conflict', () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  const plan = createMigrationPlan({
    contract,
    privateInput,
    digestKey: DIGEST_KEY,
    batchSize: 10,
  });

  assert.deepEqual(plan.summary, {
    total: 5,
    insert: 1,
    alreadyPresent: 1,
    quarantine: 3,
  });
  assert.equal(plan.partitions.length, 1);
  assert.equal(plan.partitions[0].rowCount, 5);
  assert.match(plan.partitions[0].partitionDigest, /^hmac-sha256:[a-f0-9]{64}$/);
  const insert = plan.batch.records.find((record) => record.kind === 'insert');
  assert.deepEqual(insert.row, {
    DEPLOYMENT_KEY: 'a',
    ENGAGEMENT_TYPE: 'free_test',
    SOURCE_ENVIRONMENT: 'development',
    VALUE: 'alpha',
  });
  assert.equal(Object.hasOwn(insert.row, 'SECRET_SOURCE'), false);
  assert.deepEqual(plan.batch.records.filter((record) => record.kind === 'quarantine')
    .map((record) => record.conflict.reason).sort(), [
    'duplicate_source_key',
    'missing_required_projection',
    'target_payload_conflict',
  ]);
  assert.equal(plan.batch.nextCursor, null);
});

test('approved digest, partition evidence, and plan digest ignore snapshot ordering', () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  const reordered = clone(privateInput);
  reordered.sources.reverse();
  reordered.sources[0].rows.reverse();
  reordered.targets.reverse();
  reordered.targets[0].rows.reverse();

  const left = createMigrationPlan({ contract, privateInput, digestKey: DIGEST_KEY, batchSize: 10 });
  const right = createMigrationPlan({ contract, privateInput: reordered, digestKey: DIGEST_KEY, batchSize: 10 });
  assert.equal(left.inputDigest, right.inputDigest);
  assert.equal(left.planDigest, right.planDigest);
  assert.deepEqual(left.partitions, right.partitions);
  assert.equal(computeApprovedInputDigest({ contract, privateInput }), left.inputDigest);
});

test('required nulls and contract-required non-blank text are quarantined', () => {
  const nullInput = privateInputFixture();
  nullInput.sources[0].rows[0].LEGACY_VALUE = null;
  const nullPlan = createMigrationPlan({
    contract: contractFixture(), privateInput: nullInput, digestKey: DIGEST_KEY, batchSize: 10,
  });
  assert.equal(nullPlan.summary.insert, 0);
  assert.equal(nullPlan.summary.quarantine, 4);
  assert.equal(nullPlan.batch.records.filter((record) => (
    record.conflict?.reason === 'missing_required_projection'
  )).length, 2);

  const nullKeyInput = privateInputFixture();
  nullKeyInput.sources[0].rows[0].LEGACY_KEY = null;
  const nullKeyPlan = createMigrationPlan({
    contract: contractFixture(), privateInput: nullKeyInput, digestKey: DIGEST_KEY, batchSize: 10,
  });
  assert.equal(nullKeyPlan.summary.insert, 0);
  assert.equal(nullKeyPlan.batch.records.some((record) => (
    record.conflict?.reason === 'invalid_source_key'
  )), true);

  const nonBlankContract = contractFixture();
  nonBlankContract.resources[0].projection.VALUE.nonBlank = true;
  const blankInput = privateInputFixture();
  blankInput.sources[0].rows[0].LEGACY_VALUE = '   ';
  const blankPlan = createMigrationPlan({
    contract: nonBlankContract, privateInput: blankInput, digestKey: DIGEST_KEY, batchSize: 10,
  });
  assert.equal(blankPlan.summary.insert, 0);
  assert.equal(blankPlan.summary.quarantine, 4);

  const allowedBlankInput = privateInputFixture();
  allowedBlankInput.sources[0].rows[0].LEGACY_VALUE = '   ';
  const allowedBlankPlan = createMigrationPlan({
    contract: contractFixture(), privateInput: allowedBlankInput, digestKey: DIGEST_KEY, batchSize: 10,
  });
  assert.equal(allowedBlankPlan.batch.records.find((record) => record.kind === 'insert').row.VALUE, '   ');
});

test('required constant nulls and non-blank constant violations reject the contract', () => {
  const nullConstant = contractFixture();
  nullConstant.resources[0].projection.ENGAGEMENT_TYPE.constant = null;
  assert.throws(() => computeApprovedInputDigest({
    contract: nullConstant, privateInput: privateInputFixture(),
  }), (error) => error.code === 'INVALID_MIGRATION_CONTRACT');

  const blankConstant = contractFixture();
  blankConstant.resources[0].projection.ENGAGEMENT_TYPE.constant = '  ';
  blankConstant.resources[0].projection.ENGAGEMENT_TYPE.nonBlank = true;
  assert.throws(() => computeApprovedInputDigest({
    contract: blankConstant, privateInput: privateInputFixture(),
  }), (error) => error.code === 'INVALID_MIGRATION_CONTRACT');
});

test('source and target table sets reject same-table and cross-resource overlap', () => {
  const sameTable = contractFixture();
  sameTable.resources[0].targetTable = 'legacydeployments';
  assert.throws(() => computeApprovedInputDigest({
    contract: sameTable, privateInput: privateInputFixture(),
  }), (error) => error.code === 'INVALID_MIGRATION_CONTRACT');

  const crossResource = contractFixture();
  const secondResource = clone(crossResource.resources[0]);
  secondResource.id = 'calls';
  secondResource.sourceTable = 'revenuedeskdeployments';
  secondResource.targetTable = 'RevenueDeskCalls';
  crossResource.resources.push(secondResource);
  assert.throws(() => computeApprovedInputDigest({
    contract: crossResource, privateInput: privateInputFixture(),
  }), (error) => error.code === 'INVALID_MIGRATION_CONTRACT');
});

test('opaque cursors resume deterministic batches and reject tampering', () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  const first = createMigrationPlan({
    contract, privateInput, digestKey: DIGEST_KEY, batchSize: 2,
  });
  assert.equal(first.batch.offset, 0);
  assert.equal(first.batch.size, 2);
  assert.match(first.batch.nextCursor, /^v1\./);

  const second = createMigrationPlan({
    contract,
    privateInput,
    digestKey: DIGEST_KEY,
    cursor: first.batch.nextCursor,
    batchSize: 2,
  });
  assert.equal(second.batch.offset, 2);
  assert.equal(second.batch.size, 2);
  const tampered = `${first.batch.nextCursor.slice(0, -1)}${first.batch.nextCursor.endsWith('0') ? '1' : '0'}`;
  assert.throws(() => createMigrationPlan({
    contract, privateInput, digestKey: DIGEST_KEY, cursor: tampered, batchSize: 2,
  }), (error) => error instanceof MigrationError && error.code === 'INVALID_MIGRATION_CURSOR');
});

test('dry-run is sanitized and never calls a supplied adapter', async () => {
  const adapter = new Proxy({}, {
    get() { throw new Error('dry-run must not inspect an adapter'); },
  });
  const result = await executeMigration({
    mode: 'dry-run',
    contract: contractFixture(),
    privateInput: privateInputFixture(),
    digestKey: DIGEST_KEY,
    adapter,
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('ignored-a'), false);
  assert.equal(serialized.includes('alpha'), false);
  assert.equal(serialized.includes('DEPLOYMENT_KEY'), false);
  assert.equal(result.legacyRetention.legacyResourcesPreserved, true);
  assert.equal(result.legacyRetention.deletionAuthorized, false);
});

test('omitting mode defaults to no-adapter dry-run', async () => {
  const result = await executeMigration({
    contract: contractFixture(),
    privateInput: privateInputFixture(),
    digestKey: DIGEST_KEY,
  });
  assert.equal(result.mode, 'dry-run');
});

test('apply rejects missing or changed approval before adapter access', async () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  let adapterAccessed = false;
  const adapter = new Proxy({}, {
    get() { adapterAccessed = true; return undefined; },
  });
  await assert.rejects(executeMigration({
    mode: 'apply', contract, privateInput, digestKey: DIGEST_KEY, adapter,
  }), (error) => error.code === 'APPROVED_INPUT_DIGEST_REQUIRED');
  await assert.rejects(executeMigration({
    mode: 'apply',
    contract,
    privateInput,
    digestKey: DIGEST_KEY,
    approvedInputDigest: `sha256:${'0'.repeat(64)}`,
    adapter,
  }), (error) => error.code === 'APPROVED_INPUT_DIGEST_MISMATCH');
  assert.equal(adapterAccessed, false);
});

test('apply inserts once, independently reads back, quarantines conflicts, and replays safely', async () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  const approvedInputDigest = computeApprovedInputDigest({ contract, privateInput });
  const state = createAdapter(privateInput);

  const first = await executeMigration({
    mode: 'apply',
    contract,
    privateInput,
    digestKey: DIGEST_KEY,
    approvedInputDigest,
    adapter: state.adapter,
    batchSize: 10,
  });
  assert.equal(state.calls.insert, 1);
  assert.equal(state.calls.quarantine, 3);
  assert.equal(state.quarantines.size, 3);
  assert.equal(first.operations.filter((operation) => operation.status === 'inserted_and_read_back').length, 1);
  assert.equal(first.rollback.length, 1);
  assert.equal(Object.hasOwn(first.rollback[0], 'keyValue'), false);
  assert.equal(Object.hasOwn(first.rollback[0], 'row'), false);
  assert.equal(first.rollback[0].verifiedPrestate, 'absent');
  assert.equal(first.rollback[0].rollbackAuthorized, false);

  const second = await executeMigration({
    mode: 'apply',
    contract,
    privateInput,
    digestKey: DIGEST_KEY,
    approvedInputDigest,
    adapter: state.adapter,
    batchSize: 10,
  });
  assert.equal(state.calls.insert, 1);
  assert.equal(second.operations.filter((operation) => operation.status === 'already_converged').length, 2);
  assert.equal(second.rollback.length, 0);
});

test('ambiguous insert is resolved only by independent readback', async () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  privateInput.sources[0].rows = [privateInput.sources[0].rows[0]];
  privateInput.sources[0].rowCount = 1;
  privateInput.targets[0].rows = [];
  privateInput.targets[0].rowCount = 0;
  const approvedInputDigest = computeApprovedInputDigest({ contract, privateInput });
  const state = createAdapter(privateInput, { throwAfterInsert: true });
  const result = await executeMigration({
    mode: 'apply',
    contract,
    privateInput,
    digestKey: DIGEST_KEY,
    approvedInputDigest,
    adapter: state.adapter,
  });
  assert.equal(result.operations[0].status, 'converged_after_ambiguous_insert');
  assert.equal(result.rollback.length, 1);
  assert.equal(state.calls.read, 2);
});

test('reconcile is read-only and unlocks only a separate retirement review', async () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  const approvedInputDigest = computeApprovedInputDigest({ contract, privateInput });
  const state = createAdapter(privateInput);
  await executeMigration({
    mode: 'apply',
    contract,
    privateInput,
    digestKey: DIGEST_KEY,
    approvedInputDigest,
    adapter: state.adapter,
    batchSize: 10,
  });
  const before = { insert: state.calls.insert, quarantine: state.calls.quarantine };
  const reconciled = await executeMigration({
    mode: 'reconcile',
    contract,
    privateInput,
    digestKey: DIGEST_KEY,
    approvedInputDigest,
    adapter: state.adapter,
    batchSize: 10,
  });
  assert.equal(state.calls.insert, before.insert);
  assert.equal(state.calls.quarantine, before.quarantine);
  assert.equal(reconciled.reconciliation.batchReadbackComplete, true);
  assert.equal(reconciled.reconciliation.completeApprovedInputReadbackProven, true);
  assert.equal(reconciled.reconciliation.retirementStatus,
    'eligible_for_separate_legacy_retirement_review');
  assert.equal(reconciled.reconciliation.deletionAuthorized, false);
  assert.equal(reconciled.legacyRetention.legacyResourcesPreserved, true);
});

test('unsupported transformations and short digest keys fail closed', () => {
  const contract = contractFixture();
  contract.resources[0].projection.VALUE.transform = 'trim';
  assert.throws(() => computeApprovedInputDigest({
    contract, privateInput: privateInputFixture(),
  }), (error) => error.code === 'INVALID_MIGRATION_CONTRACT');
  assert.throws(() => createMigrationPlan({
    contract: contractFixture(),
    privateInput: privateInputFixture(),
    digestKey: 'too-short',
  }), (error) => error.code === 'INVALID_DIGEST_KEY');

  const invalidCount = privateInputFixture();
  invalidCount.sources[0].rowCount += 1;
  assert.throws(() => computeApprovedInputDigest({
    contract: contractFixture(), privateInput: invalidCount,
  }), (error) => error.code === 'INVALID_PRIVATE_INPUT');
});
