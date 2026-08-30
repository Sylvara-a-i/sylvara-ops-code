'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  computeApprovedInputDigest,
  computePrivateTargetBindingDigest,
  executeFixedTargetMigration,
  parsePrivateTargetBinding,
} = require('..');
const { createFixedTargetMigrationAdapter } = require('../lib/fixed-target-adapter');

const DIGEST_KEY = 'synthetic-fixed-target-digest-key-000000000000000000000000';
const CONSTRAINT_EVIDENCE_DIGEST = `sha256:${'e'.repeat(64)}`;
const APPROVAL_CAPTURED_AT = new Date(Date.now() - 60_000).toISOString();
const MAX_APPROVAL_WINDOW_MS = 15 * 60 * 1000;
const SYNTHETIC_TARGET = Object.freeze({
  organizationId: 'synthetic-org-0001',
  projectId: 'synthetic-project-0001',
  environment: 'Development',
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function contractFixture() {
  return {
    schemaVersion: 1,
    migrationId: 'synthetic-fixed-target-v1',
    resources: [{
      id: 'deployments',
      sourceTable: 'LegacyDeployments',
      targetTable: 'RevenueDeskDeployments',
      sourceKeyColumn: 'LEGACY_KEY',
      targetKeyColumn: 'DEPLOYMENT_KEY',
      partitionColumns: ['SOURCE_ENVIRONMENT'],
      projection: {
        DEPLOYMENT_KEY: { source: 'LEGACY_KEY', required: true },
        SOURCE_ENVIRONMENT: { source: 'SOURCE_ENVIRONMENT', required: true, nonBlank: true },
        VALUE: { source: 'LEGACY_VALUE', required: true },
      },
    }],
  };
}

function privateInputFixture({
  key = 'synthetic-key', value = 'synthetic-value', target = null,
  capturedAt = APPROVAL_CAPTURED_AT,
} = {}) {
  return {
    schemaVersion: 1,
    captureId: 'synthetic-private-capture-fixed-001',
    capturedAt,
    sources: [{
      table: 'LegacyDeployments',
      rowCount: 1,
      rows: [{
        LEGACY_KEY: key,
        SOURCE_ENVIRONMENT: 'development',
        LEGACY_VALUE: value,
        PRIVATE_SOURCE_ONLY: 'must-never-be-logged',
      }],
    }],
    targets: [{
      table: 'RevenueDeskDeployments',
      rowCount: target ? 1 : 0,
      rows: target ? [target] : [],
    }],
  };
}

function bindingFixture(contract, privateInput, overrides = {}) {
  const approvedInputDigest = computeApprovedInputDigest({ contract, privateInput });
  const raw = {
    schemaVersion: 1,
    target: { ...SYNTHETIC_TARGET },
    approval: {
      migrationId: contract.migrationId,
      captureId: privateInput.captureId,
      capturedAt: privateInput.capturedAt,
      expiresAt: new Date(
        Date.parse(privateInput.capturedAt) + MAX_APPROVAL_WINDOW_MS,
      ).toISOString(),
      inputDigest: approvedInputDigest,
      mode: overrides.approval?.mode || 'apply',
    },
    resources: [{
      resourceId: 'deployments',
      targetTable: 'RevenueDeskDeployments',
      keyColumn: 'DEPLOYMENT_KEY',
      columns: ['DEPLOYMENT_KEY', 'SOURCE_ENVIRONMENT', 'VALUE'],
      uniqueConstraintEvidence: {
        capturedAt: privateInput.capturedAt,
        metadataSha256: CONSTRAINT_EVIDENCE_DIGEST,
      },
    }],
    quarantine: {
      table: 'RevenueDeskMigrationQuarantine',
      conflictIdColumn: 'CONFLICT_ID',
      inputDigestColumn: 'INPUT_DIGEST',
      reasonColumn: 'REASON',
      evidenceColumn: 'EVIDENCE_JSON',
      idempotencyColumn: 'OPERATION_ID',
      uniqueConstraintEvidence: {
        capturedAt: privateInput.capturedAt,
        metadataSha256: CONSTRAINT_EVIDENCE_DIGEST,
      },
    },
    zcql: { parser: 'V2', pageSize: 2, maxPages: 1 },
    operationTimeoutMs: 250,
  };
  const merged = {
    ...raw,
    ...overrides,
    target: { ...raw.target, ...overrides.target },
    approval: { ...raw.approval, ...overrides.approval },
    quarantine: { ...raw.quarantine, ...overrides.quarantine },
    zcql: { ...raw.zcql, ...overrides.zcql },
  };
  const binding = parsePrivateTargetBinding(JSON.stringify(merged));
  return {
    approvedInputDigest,
    approvedTargetBindingDigest: computePrivateTargetBindingDigest(binding),
    binding,
    serialized: JSON.stringify(merged),
  };
}

function selectedRow(statement, row) {
  const match = /^SELECT ([A-Z0-9_, ]+) FROM ([A-Za-z][A-Za-z0-9_]*) /.exec(statement);
  assert.ok(match, `unexpected synthetic ZCQL: ${statement}`);
  const selected = match[1].split(', ');
  return {
    table: match[2],
    row: Object.fromEntries(selected
      .filter((column) => Object.hasOwn(row, column))
      .map((column) => [column, row[column]])),
  };
}

function transportFixture({
  targetRow = null,
  auditIdentity = SYNTHETIC_TARGET,
  changesIdentity = SYNTHETIC_TARGET,
  throwAfterInsert = false,
  failBeforeInsert = false,
  auditResult = null,
  constraintEvidenceSha256 = CONSTRAINT_EVIDENCE_DIGEST,
  constraintUnique = true,
} = {}) {
  const state = {
    targetRow: targetRow ? clone(targetRow) : null,
    quarantines: new Map(),
    queries: [],
    inserts: [],
    identities: { audit: 0, changes: 0 },
    constraintReads: [],
  };
  const audit = {
    capabilities: {
      fixedTarget: true,
      identityReadback: true,
      independentReadback: true,
      constraintReadback: true,
      readOnly: true,
      zcqlV2: true,
    },
    async readIdentity() {
      state.identities.audit += 1;
      return clone(auditIdentity);
    },
    async readUniqueConstraint(request) {
      state.constraintReads.push(clone(request));
      return {
        evidenceSha256: constraintEvidenceSha256,
        keyColumn: request.keyColumn,
        table: request.table,
        unique: constraintUnique,
      };
    },
    async executeZcql(request) {
      state.queries.push(request);
      if (auditResult) return clone(auditResult);
      if (request.statement.includes('FROM RevenueDeskDeployments ')) {
        if (!state.targetRow) return [];
        const selected = selectedRow(request.statement, state.targetRow);
        return [{ [selected.table]: selected.row }];
      }
      if (request.statement.includes('FROM RevenueDeskMigrationQuarantine ')) {
        const match = /WHERE CONFLICT_ID = '([^']+)'/.exec(request.statement);
        const row = match ? state.quarantines.get(match[1]) : null;
        if (!row) return [];
        const selected = selectedRow(request.statement, row);
        return [{ [selected.table]: selected.row }];
      }
      throw new Error('unexpected synthetic table');
    },
  };
  const changes = {
    capabilities: {
      fixedTarget: true,
      identityReadback: true,
      datastoreInsert: true,
    },
    async readIdentity() {
      state.identities.changes += 1;
      return clone(changesIdentity);
    },
    async insertRow(request) {
      state.inserts.push(request);
      if (failBeforeInsert) throw new Error('synthetic pre-commit failure');
      if (request.table === 'RevenueDeskDeployments') {
        state.targetRow = { ROWID: '1001', ...clone(request.row) };
      } else if (request.table === 'RevenueDeskMigrationQuarantine') {
        state.quarantines.set(request.row.CONFLICT_ID, clone(request.row));
      }
      if (throwAfterInsert) throw new Error('synthetic post-commit timeout');
      return { accepted: true };
    },
  };
  return { state, transport: { audit, changes } };
}

test('default dry-run cannot initialize or inspect a private live capability', async () => {
  const blocked = new Proxy({}, {
    get() { throw new Error('dry-run inspected a live capability'); },
  });
  const result = await executeFixedTargetMigration({
    contract: contractFixture(),
    privateInput: privateInputFixture(),
    digestKey: DIGEST_KEY,
    privateTargetBinding: blocked,
    transport: blocked,
    logger: blocked,
  });
  assert.equal(result.mode, 'dry-run');
});

test('private binding parser seals one exact Development target and rejects unsafe variants', () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  const { binding, serialized } = bindingFixture(contract, privateInput);
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(Object.isFrozen(binding.target), true);
  assert.throws(() => { binding.target.projectId = 'changed-project'; }, TypeError);

  const production = JSON.parse(serialized);
  production.target.environment = 'Production';
  assert.throws(() => parsePrivateTargetBinding(JSON.stringify(production)),
    (error) => error.code === 'INVALID_PRIVATE_TARGET_BINDING');
  const unbounded = JSON.parse(serialized);
  unbounded.zcql.maxPages = 100;
  assert.throws(() => parsePrivateTargetBinding(JSON.stringify(unbounded)),
    (error) => error.code === 'INVALID_PRIVATE_TARGET_BINDING');
  const bareAssertion = JSON.parse(serialized);
  delete bareAssertion.resources[0].uniqueConstraintEvidence;
  bareAssertion.resources[0].uniqueKeyVerified = true;
  assert.throws(() => parsePrivateTargetBinding(JSON.stringify(bareAssertion)),
    (error) => error.code === 'INVALID_PRIVATE_TARGET_BINDING');
  const staleEvidence = JSON.parse(serialized);
  staleEvidence.resources[0].uniqueConstraintEvidence.capturedAt = '2025-01-01T00:00:00.000Z';
  assert.throws(() => parsePrivateTargetBinding(JSON.stringify(staleEvidence)),
    (error) => error.code === 'INVALID_PRIVATE_TARGET_BINDING');
  const noncanonical = JSON.parse(serialized);
  noncanonical.approval.capturedAt = noncanonical.approval.capturedAt.replace(/\.\d{3}Z$/, 'Z');
  assert.throws(() => parsePrivateTargetBinding(JSON.stringify(noncanonical)),
    (error) => error.code === 'INVALID_PRIVATE_TARGET_BINDING');
  const unboundedWindow = JSON.parse(serialized);
  unboundedWindow.approval.expiresAt = new Date(
    Date.parse(unboundedWindow.approval.capturedAt) + MAX_APPROVAL_WINDOW_MS + 1,
  ).toISOString();
  assert.throws(() => parsePrivateTargetBinding(JSON.stringify(unboundedWindow)),
    (error) => error.code === 'INVALID_PRIVATE_TARGET_BINDING');
});

test('apply binds exact approval before accessing transport and rejects raw mutable bindings', () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  const {
    binding, approvedInputDigest, approvedTargetBindingDigest, serialized,
  } = bindingFixture(contract, privateInput);
  let transportAccesses = 0;
  const transport = new Proxy({}, {
    get() { transportAccesses += 1; throw new Error('transport must remain untouched'); },
  });
  assert.throws(() => createFixedTargetMigrationAdapter({
    mode: 'apply',
    contract,
    privateInput,
    approvedInputDigest: `sha256:${'0'.repeat(64)}`,
    approvedTargetBindingDigest,
    binding,
    transport,
  }), (error) => error.code === 'APPROVED_INPUT_DIGEST_MISMATCH');
  assert.equal(transportAccesses, 0);
  assert.throws(() => createFixedTargetMigrationAdapter({
    mode: 'apply',
    contract,
    privateInput,
    approvedInputDigest,
    approvedTargetBindingDigest,
    binding: JSON.parse(serialized),
    transport,
  }), (error) => error.code === 'PRIVATE_TARGET_BINDING_REQUIRED');
  assert.equal(transportAccesses, 0);
});

test('the same approved input cannot be redirected to a different Development target', () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  const {
    approvedInputDigest, approvedTargetBindingDigest, serialized,
  } = bindingFixture(contract, privateInput);
  const redirected = JSON.parse(serialized);
  redirected.target.projectId = 'synthetic-project-redirected';
  const redirectedBinding = parsePrivateTargetBinding(JSON.stringify(redirected));
  assert.notEqual(
    computePrivateTargetBindingDigest(redirectedBinding),
    approvedTargetBindingDigest,
  );

  let transportAccesses = 0;
  const transport = new Proxy({}, {
    get() { transportAccesses += 1; throw new Error('transport must remain untouched'); },
  });
  assert.throws(() => createFixedTargetMigrationAdapter({
    mode: 'apply',
    contract,
    privateInput,
    approvedInputDigest,
    approvedTargetBindingDigest,
    binding: redirectedBinding,
    transport,
  }), (error) => error.code === 'APPROVED_TARGET_BINDING_DIGEST_MISMATCH');
  assert.equal(transportAccesses, 0);
});

test('apply and reconcile require separate mode-bound target approvals', () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  const applyApproval = bindingFixture(contract, privateInput);
  const reconcileApproval = bindingFixture(
    contract,
    privateInput,
    { approval: { mode: 'reconcile' } },
  );
  let transportAccesses = 0;
  const transport = new Proxy({}, {
    get() { transportAccesses += 1; throw new Error('transport must remain untouched'); },
  });

  assert.throws(() => createFixedTargetMigrationAdapter({
    mode: 'reconcile',
    contract,
    privateInput,
    approvedInputDigest: applyApproval.approvedInputDigest,
    approvedTargetBindingDigest: applyApproval.approvedTargetBindingDigest,
    binding: applyApproval.binding,
    transport,
  }), (error) => error.code === 'PRIVATE_TARGET_APPROVAL_MISMATCH');
  assert.throws(() => createFixedTargetMigrationAdapter({
    mode: 'apply',
    contract,
    privateInput,
    approvedInputDigest: reconcileApproval.approvedInputDigest,
    approvedTargetBindingDigest: reconcileApproval.approvedTargetBindingDigest,
    binding: reconcileApproval.binding,
    transport,
  }), (error) => error.code === 'PRIVATE_TARGET_APPROVAL_MISMATCH');
  assert.equal(transportAccesses, 0);
});

test('fixed-target runner rejects a stale cursor before inspecting transport', async () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  const {
    binding, approvedInputDigest, approvedTargetBindingDigest,
  } = bindingFixture(contract, privateInput);
  let transportAccesses = 0;
  const transport = new Proxy({}, {
    get() { transportAccesses += 1; throw new Error('transport must remain untouched'); },
  });
  await assert.rejects(executeFixedTargetMigration({
    mode: 'apply',
    contract,
    privateInput,
    digestKey: DIGEST_KEY,
    approvedInputDigest,
    approvedTargetBindingDigest,
    privateTargetBinding: binding,
    transport,
    cursor: 'v1.invalid.invalid',
  }), (error) => error.code === 'INVALID_MIGRATION_CURSOR');
  assert.equal(transportAccesses, 0);
});

test('fixed-target runner rejects expired and future approvals before inspecting transport', async (t) => {
  const contract = contractFixture();
  const blockedTransport = () => {
    let accesses = 0;
    return {
      proxy: new Proxy({}, {
        get() { accesses += 1; throw new Error('transport must remain untouched'); },
      }),
      accesses: () => accesses,
    };
  };

  await t.test('expired approval', async () => {
    const capturedAt = new Date(Date.now() - MAX_APPROVAL_WINDOW_MS - 60_000).toISOString();
    const privateInput = privateInputFixture({ capturedAt });
    const approval = bindingFixture(contract, privateInput);
    const transport = blockedTransport();
    await assert.rejects(executeFixedTargetMigration({
      mode: 'apply',
      contract,
      privateInput,
      digestKey: DIGEST_KEY,
      approvedInputDigest: approval.approvedInputDigest,
      approvedTargetBindingDigest: approval.approvedTargetBindingDigest,
      privateTargetBinding: approval.binding,
      transport: transport.proxy,
    }), (error) => error.code === 'PRIVATE_TARGET_APPROVAL_EXPIRED');
    assert.equal(transport.accesses(), 0);
  });

  await t.test('future approval', async () => {
    const capturedAt = new Date(Date.now() + 60_000).toISOString();
    const privateInput = privateInputFixture({ capturedAt });
    const approval = bindingFixture(contract, privateInput);
    const transport = blockedTransport();
    await assert.rejects(executeFixedTargetMigration({
      mode: 'apply',
      contract,
      privateInput,
      digestKey: DIGEST_KEY,
      approvedInputDigest: approval.approvedInputDigest,
      approvedTargetBindingDigest: approval.approvedTargetBindingDigest,
      privateTargetBinding: approval.binding,
      transport: transport.proxy,
    }), (error) => error.code === 'PRIVATE_TARGET_APPROVAL_NOT_YET_VALID');
    assert.equal(transport.accesses(), 0);
  });
});

test('fixed-target apply uses generated bounded ZCQL, separate planes, and redacted logs', async () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture({
    key: "synthetic-key'quoted",
    value: 'private-value-never-log',
  });
  const {
    binding, approvedInputDigest, approvedTargetBindingDigest,
  } = bindingFixture(contract, privateInput);
  const fixture = transportFixture();
  const logs = [];
  const result = await executeFixedTargetMigration({
    mode: 'apply',
    contract,
    privateInput,
    digestKey: DIGEST_KEY,
    approvedInputDigest,
    approvedTargetBindingDigest,
    privateTargetBinding: binding,
    transport: fixture.transport,
    logger: (event) => logs.push(event),
  });
  assert.equal(result.operations[0].status, 'inserted_and_read_back');
  assert.equal(fixture.state.inserts.length, 1);
  assert.equal(fixture.state.identities.changes, 1);
  assert.equal(fixture.state.identities.audit, 3);
  assert.equal(fixture.state.constraintReads.length, 1);
  assert.equal(fixture.state.queries.length, 2);
  for (const request of fixture.state.queries) {
    assert.equal(request.parser, 'V2');
    assert.deepEqual({ ...request.pagination }, { pageSize: 2, maxPages: 1 });
    assert.match(request.statement, / ORDER BY ROWID ASC LIMIT 2$/);
    assert.match(request.statement, /synthetic-key''quoted/);
    assert.doesNotMatch(request.statement, /PRIVATE_SOURCE_ONLY/);
  }
  const serializedLogs = JSON.stringify(logs);
  for (const prohibited of [
    SYNTHETIC_TARGET.organizationId,
    SYNTHETIC_TARGET.projectId,
    'RevenueDeskDeployments',
    "synthetic-key'quoted",
    'private-value-never-log',
    approvedInputDigest,
  ]) assert.equal(serializedLogs.includes(prohibited), false);
});

test('table allowlists and Development identity fail closed before query or write', async () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  const {
    binding, approvedInputDigest, approvedTargetBindingDigest,
  } = bindingFixture(contract, privateInput);
  const fixture = transportFixture({
    auditIdentity: { ...SYNTHETIC_TARGET, projectId: 'synthetic-project-other' },
  });
  const adapter = createFixedTargetMigrationAdapter({
    mode: 'apply', contract, privateInput, approvedInputDigest, approvedTargetBindingDigest,
    binding, transport: fixture.transport,
  });
  await assert.rejects(adapter.readTarget({
    targetTable: 'UnapprovedTable', keyColumn: 'DEPLOYMENT_KEY', keyValue: 'synthetic-key',
  }), (error) => error.code === 'TARGET_ALLOWLIST_REJECTED');
  assert.equal(fixture.state.identities.audit, 0);
  await assert.rejects(adapter.readTarget({
    targetTable: 'RevenueDeskDeployments',
    keyColumn: 'DEPLOYMENT_KEY',
    keyValue: 'synthetic-key',
  }), (error) => error.code === 'DEVELOPMENT_TARGET_MISMATCH');
  assert.equal(fixture.state.queries.length, 0);
  assert.equal(fixture.state.inserts.length, 0);

  const writeFixture = transportFixture({
    changesIdentity: { ...SYNTHETIC_TARGET, projectId: 'synthetic-project-other' },
  });
  const writeAdapter = createFixedTargetMigrationAdapter({
    mode: 'apply', contract, privateInput, approvedInputDigest, approvedTargetBindingDigest,
    binding, transport: writeFixture.transport,
  });
  await assert.rejects(writeAdapter.insertTarget({
    targetTable: 'RevenueDeskDeployments',
    keyColumn: 'DEPLOYMENT_KEY',
    keyValue: 'synthetic-key',
    row: {
      DEPLOYMENT_KEY: 'synthetic-key',
      SOURCE_ENVIRONMENT: 'development',
      VALUE: 'synthetic-value',
    },
    idempotencyKey: `hmac-sha256:${'a'.repeat(64)}`,
    approvedInputDigest,
  }), (error) => error.code === 'DEVELOPMENT_TARGET_MISMATCH');
  assert.equal(writeFixture.state.inserts.length, 0);
});

test('current unique-constraint readback is required before the changes plane is touched', async () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  const {
    binding, approvedInputDigest, approvedTargetBindingDigest,
  } = bindingFixture(contract, privateInput);
  const fixture = transportFixture({ constraintUnique: false });
  const adapter = createFixedTargetMigrationAdapter({
    mode: 'apply', contract, privateInput, approvedInputDigest, approvedTargetBindingDigest,
    binding, transport: fixture.transport,
  });
  await assert.rejects(adapter.insertTarget({
    targetTable: 'RevenueDeskDeployments',
    keyColumn: 'DEPLOYMENT_KEY',
    keyValue: 'synthetic-key',
    row: {
      DEPLOYMENT_KEY: 'synthetic-key',
      SOURCE_ENVIRONMENT: 'development',
      VALUE: 'synthetic-value',
    },
    idempotencyKey: `hmac-sha256:${'a'.repeat(64)}`,
    approvedInputDigest,
  }), (error) => error.code === 'UNIQUE_CONSTRAINT_READBACK_MISMATCH');
  assert.equal(fixture.state.constraintReads.length, 1);
  assert.equal(fixture.state.identities.changes, 0);
  assert.equal(fixture.state.inserts.length, 0);
});

test('audit responses cannot exceed the two-row duplicate-detection bound', async () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  const {
    binding, approvedInputDigest, approvedTargetBindingDigest,
  } = bindingFixture(contract, privateInput, { approval: { mode: 'reconcile' } });
  const row = {
    ROWID: '1001', DEPLOYMENT_KEY: 'synthetic-key',
    SOURCE_ENVIRONMENT: 'development', VALUE: 'synthetic-value',
  };
  const fixture = transportFixture({ auditResult: [row, row, row] });
  const adapter = createFixedTargetMigrationAdapter({
    mode: 'reconcile', contract, privateInput, approvedInputDigest, approvedTargetBindingDigest,
    binding, transport: { audit: fixture.transport.audit },
  });
  await assert.rejects(adapter.readTarget({
    targetTable: 'RevenueDeskDeployments',
    keyColumn: 'DEPLOYMENT_KEY',
    keyValue: 'synthetic-key',
  }), (error) => error.code === 'INVALID_AUDIT_READBACK');
  assert.match(fixture.state.queries[0].statement, / LIMIT 2$/);
});

test('ambiguous target insert is never retried and is resolved only by audit readback', async () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  const {
    binding, approvedInputDigest, approvedTargetBindingDigest,
  } = bindingFixture(contract, privateInput);
  const fixture = transportFixture({ throwAfterInsert: true });
  const result = await executeFixedTargetMigration({
    mode: 'apply', contract, privateInput, digestKey: DIGEST_KEY,
    approvedInputDigest, privateTargetBinding: binding, transport: fixture.transport,
    approvedTargetBindingDigest,
  });
  assert.equal(fixture.state.inserts.length, 1);
  assert.equal(fixture.state.inserts[0].approval.inputDigest, approvedInputDigest);
  assert.match(fixture.state.inserts[0].approval.operationDigest, /^hmac-sha256:/);
  assert.equal(result.operations[0].status, 'converged_after_ambiguous_insert');
  assert.equal(fixture.state.identities.audit, 3);
  assert.equal(fixture.state.constraintReads.length, 1);
});

test('unresolved ambiguous insert fails after one write and one independent readback', async () => {
  const contract = contractFixture();
  const privateInput = privateInputFixture();
  const {
    binding, approvedInputDigest, approvedTargetBindingDigest,
  } = bindingFixture(contract, privateInput);
  const fixture = transportFixture({ failBeforeInsert: true });
  await assert.rejects(executeFixedTargetMigration({
    mode: 'apply', contract, privateInput, digestKey: DIGEST_KEY,
    approvedInputDigest, privateTargetBinding: binding, transport: fixture.transport,
    approvedTargetBindingDigest,
  }), (error) => error.code === 'TARGET_READBACK_FAILED');
  assert.equal(fixture.state.inserts.length, 1);
  assert.equal(fixture.state.queries.length, 2);
});

test('reconcile retains no changes plane and performs independent readback only', async () => {
  const contract = contractFixture();
  const target = {
    ROWID: '1001',
    DEPLOYMENT_KEY: 'synthetic-key',
    SOURCE_ENVIRONMENT: 'development',
    VALUE: 'synthetic-value',
  };
  const privateInput = privateInputFixture({ target });
  const {
    binding, approvedInputDigest, approvedTargetBindingDigest,
  } = bindingFixture(contract, privateInput, { approval: { mode: 'reconcile' } });
  const fixture = transportFixture({ targetRow: target });
  const transport = { audit: fixture.transport.audit };
  Object.defineProperty(transport, 'changes', {
    get() { throw new Error('reconcile inspected a changes plane'); },
  });
  const result = await executeFixedTargetMigration({
    mode: 'reconcile', contract, privateInput, digestKey: DIGEST_KEY,
    approvedInputDigest, privateTargetBinding: binding, transport,
    approvedTargetBindingDigest,
  });
  assert.equal(result.operations[0].status, 'target_matched');
  assert.equal(result.reconciliation.completeApprovedInputReadbackProven, true);
  assert.equal(fixture.state.inserts.length, 0);
});

test('conflicts use a unique quarantine key and receive separate audit readback', async () => {
  const contract = contractFixture();
  const target = {
    ROWID: '1001',
    DEPLOYMENT_KEY: 'synthetic-key',
    SOURCE_ENVIRONMENT: 'development',
    VALUE: 'different-target-value',
  };
  const privateInput = privateInputFixture({ target });
  const {
    binding, approvedInputDigest, approvedTargetBindingDigest,
  } = bindingFixture(contract, privateInput);
  const fixture = transportFixture({ targetRow: target });
  const result = await executeFixedTargetMigration({
    mode: 'apply', contract, privateInput, digestKey: DIGEST_KEY,
    approvedInputDigest, privateTargetBinding: binding, transport: fixture.transport,
    approvedTargetBindingDigest,
  });
  assert.equal(result.operations[0].status, 'quarantined');
  assert.equal(fixture.state.inserts.length, 1);
  assert.equal(fixture.state.inserts[0].table, 'RevenueDeskMigrationQuarantine');
  assert.match(fixture.state.inserts[0].row.CONFLICT_ID, /^hmac-sha256:/);
  assert.equal(fixture.state.identities.audit, 3);
  assert.equal(fixture.state.constraintReads.length, 1);
  assert.equal(fixture.state.identities.changes, 1);
});
