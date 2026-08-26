'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const model = JSON.parse(fs.readFileSync(path.resolve(
  __dirname, '../../../config/analytics-model-contract.json',
), 'utf8'));
const { evaluatePreRenderGate, scopeInventoryDigest } = require(path.resolve(
  __dirname, '../../../tools/evaluate-dashboard-pre-render-gate.js',
));
const evaluatorPath = path.resolve(
  __dirname, '../../../tools/evaluate-dashboard-pre-render-gate.js',
);

const NOW = Date.parse('2026-08-26T18:05:00.000Z');
const WATERMARK = '2026-08-26T18:00:00.000Z';
const REVISION = 'a'.repeat(40);

function evidenceFixture() {
  const recordTypes = Object.fromEntries(model.pre_render_gate.required_record_types
    .map((recordType) => [recordType, {
      status: 'Healthy',
      last_error_code: null,
      last_rejected_row_count: 0,
      last_source_modified_at: WATERMARK,
      provider_watermark: WATERMARK,
      stale_after_at: '2026-08-26T20:00:00.000Z',
      last_reconciled_at: '2026-08-26T18:01:00.000Z',
      source_revision: REVISION,
    }]));
  const scope = {
    ENVIRONMENT: 'development',
    ENGAGEMENT_TYPE: 'free_test',
    CLIENT_KEY: 'b'.repeat(64),
    DEPLOYMENT_KEY: 'c'.repeat(64),
    unresolved_v2_outbox_rows: 0,
    checkpoints: recordTypes,
    analytics_readback: {
      binding_verified: true,
      partition_isolation_verified: true,
      record_types: Object.fromEntries(model.pre_render_gate.required_record_types
        .map((recordType) => [recordType, {
          row_count: 1,
          duplicate_record_key_count: 0,
          payload_hash_mismatch_count: 0,
          latest_source_modified_at: WATERMARK,
          source_revision: REVISION,
        }])),
    },
  };
  const digest = scopeInventoryDigest([scope]);
  return {
    schema_version: 1,
    evaluated_at: '2026-08-26T18:05:00.000Z',
    approved_source_revision: REVISION,
    scope_inventory: {
      expected_scope_count: 1,
      catalyst_scope_digest: digest,
      analytics_scope_digest: digest,
    },
    scopes: [scope],
  };
}

function approvalFixture(evidence) {
  return {
    approved_scope_inventory_digest: scopeInventoryDigest(evidence.scopes),
    approved_source_revision: REVISION,
    schema_version: 1,
  };
}

const DEFAULT_APPROVAL = approvalFixture(evidenceFixture());

function evaluateGate(gate, evidence, approval = DEFAULT_APPROVAL) {
  return evaluatePreRenderGate(gate, evidence, NOW, approval);
}

test('pre-render gate accepts only reconciled Catalyst checkpoints and exact Analytics readback', () => {
  const evidence = evidenceFixture();
  assert.deepEqual(evaluateGate(model.pre_render_gate, evidence), {
    verdict: 'ready',
    reason_codes: [],
  });
});

test('private CLI evaluates real files and emits only a coarse verdict', (t) => {
  const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sylvara-analytics-gate-'));
  t.after(() => fs.rmSync(privateRoot, { force: true, recursive: true }));
  const evidencePath = path.join(privateRoot, 'evidence.json');
  const approvalPath = path.join(privateRoot, 'approval.json');
  const evidence = evidenceFixture();
  const now = Date.now();
  const watermark = new Date(now - 60_000).toISOString();
  const reconciledAt = new Date(now - 30_000).toISOString();
  evidence.evaluated_at = new Date(now - 1_000).toISOString();
  for (const checkpoint of Object.values(evidence.scopes[0].checkpoints)) {
    checkpoint.last_source_modified_at = watermark;
    checkpoint.provider_watermark = watermark;
    checkpoint.last_reconciled_at = reconciledAt;
    checkpoint.stale_after_at = new Date(now + 600_000).toISOString();
  }
  for (const readback of Object.values(evidence.scopes[0].analytics_readback.record_types)) {
    readback.latest_source_modified_at = watermark;
  }
  fs.writeFileSync(evidencePath, JSON.stringify(evidence), { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(approvalPath, JSON.stringify(approvalFixture(evidence)), {
    encoding: 'utf8',
    mode: 0o600,
  });

  const ready = spawnSync(process.execPath, [
    evaluatorPath, '--evidence', evidencePath, '--approval', approvalPath,
  ], { encoding: 'utf8', shell: false, windowsHide: true });
  assert.equal(ready.status, 0, ready.stderr);
  assert.deepEqual(JSON.parse(ready.stdout), { verdict: 'ready', reason_codes: [] });

  evidence.scopes[0].unresolved_v2_outbox_rows = 1;
  evidence.private_canary = 'must-not-be-logged';
  fs.writeFileSync(evidencePath, JSON.stringify(evidence), { encoding: 'utf8', mode: 0o600 });
  const blocked = spawnSync(process.execPath, [
    evaluatorPath, '--evidence', evidencePath, '--approval', approvalPath,
  ], { encoding: 'utf8', shell: false, windowsHide: true });
  assert.equal(blocked.status, 1);
  assert.equal(blocked.stdout.includes('must-not-be-logged'), false);
  assert.deepEqual(JSON.parse(blocked.stdout), {
    verdict: 'blocked',
    reason_codes: ['EVIDENCE_MISSING_OR_INVALID', 'UNRESOLVED_OUTBOX'],
  });

  const repositoryInput = spawnSync(process.execPath, [
    evaluatorPath,
    '--evidence', path.resolve(__dirname, '../../../config/analytics-model-contract.json'),
    '--approval', approvalPath,
  ], { encoding: 'utf8', shell: false, windowsHide: true });
  assert.equal(repositoryInput.status, 1);
  assert.deepEqual(JSON.parse(repositoryInput.stdout), {
    verdict: 'blocked',
    reason_codes: ['CLI_INPUT_INVALID'],
  });
});

test('a separately approved scope inventory prevents self-consistent omissions', () => {
  const complete = evidenceFixture();
  const secondScope = structuredClone(complete.scopes[0]);
  secondScope.CLIENT_KEY = 'd'.repeat(64);
  secondScope.DEPLOYMENT_KEY = 'e'.repeat(64);
  complete.scopes.push(secondScope);
  const approvedDigest = scopeInventoryDigest(complete.scopes);
  const approval = {
    ...DEFAULT_APPROVAL,
    approved_scope_inventory_digest: approvedDigest,
  };
  complete.scope_inventory = {
    expected_scope_count: 2,
    catalyst_scope_digest: approvedDigest,
    analytics_scope_digest: approvedDigest,
  };
  assert.equal(evaluateGate(model.pre_render_gate, complete, approval).verdict, 'ready');

  const omitted = structuredClone(complete);
  omitted.scopes.pop();
  const selfDeclaredDigest = scopeInventoryDigest(omitted.scopes);
  omitted.scope_inventory = {
    expected_scope_count: 1,
    catalyst_scope_digest: selfDeclaredDigest,
    analytics_scope_digest: selfDeclaredDigest,
  };
  const result = evaluateGate(model.pre_render_gate, omitted, approval);
  assert.equal(result.verdict, 'blocked');
  assert.ok(result.reason_codes.includes('SCOPE_INVENTORY_MISMATCH'));
});

test('timestamps alone can never produce a ready freshness verdict', () => {
  const timestampOnly = {
    schema_version: 1,
    evaluated_at: '2026-08-26T18:05:00.000Z',
    scopes: [{ latest_source_modified_at: WATERMARK }],
  };
  const result = evaluateGate(model.pre_render_gate, timestampOnly);
  assert.equal(result.verdict, 'blocked');
  assert.ok(result.reason_codes.includes('SCOPE_INVENTORY_MISMATCH'));
  assert.ok(result.reason_codes.includes('SCOPE_INVALID'));
});

test('malformed scope evidence returns blocked instead of throwing', () => {
  const evidence = evidenceFixture();
  evidence.scopes = [null];
  evidence.scope_inventory.catalyst_scope_digest = null;
  evidence.scope_inventory.analytics_scope_digest = null;
  const result = evaluateGate(model.pre_render_gate, evidence);
  assert.equal(result.verdict, 'blocked');
  assert.ok(result.reason_codes.includes('SCOPE_INVENTORY_MISMATCH'));
  assert.ok(result.reason_codes.includes('SCOPE_INVALID'));
});

test('malformed required record types return blocked instead of throwing', () => {
  const gate = structuredClone(model.pre_render_gate);
  gate.required_record_types = {};
  const result = evaluateGate(gate, evidenceFixture());
  assert.equal(result.verdict, 'blocked');
  assert.ok(result.reason_codes.includes('GATE_CONTRACT_INVALID'));
});

test('unresolved outbox, stale checkpoint, or readback mismatch blocks publication', async (t) => {
  await t.test('unresolved outbox', () => {
    const evidence = evidenceFixture();
    evidence.scopes[0].unresolved_v2_outbox_rows = 1;
    const result = evaluateGate(model.pre_render_gate, evidence);
    assert.equal(result.verdict, 'blocked');
    assert.ok(result.reason_codes.includes('UNRESOLVED_OUTBOX'));
  });

  await t.test('stale checkpoint', () => {
    const evidence = evidenceFixture();
    evidence.scopes[0].checkpoints.call.stale_after_at = '2026-08-26T18:04:59.000Z';
    const result = evaluateGate(model.pre_render_gate, evidence);
    assert.equal(result.verdict, 'blocked');
    assert.ok(result.reason_codes.includes('CHECKPOINT_STALE'));
  });

  await t.test('future checkpoint evidence', () => {
    const evidence = evidenceFixture();
    evidence.scopes[0].checkpoints.call.last_source_modified_at = '2026-08-26T18:06:00.000Z';
    evidence.scopes[0].checkpoints.call.provider_watermark = '2026-08-26T18:06:00.000Z';
    evidence.scopes[0].checkpoints.call.last_reconciled_at = '2026-08-26T18:07:00.000Z';
    evidence.scopes[0].analytics_readback.record_types.call.latest_source_modified_at =
      '2026-08-26T18:06:00.000Z';
    const result = evaluateGate(model.pre_render_gate, evidence);
    assert.equal(result.verdict, 'blocked');
    assert.ok(result.reason_codes.includes('CHECKPOINT_FUTURE_TIMESTAMP'));
  });

  await t.test('Analytics mismatch', () => {
    const evidence = evidenceFixture();
    evidence.scopes[0].analytics_readback.record_types.call.row_count = 2;
    evidence.scopes[0].analytics_readback.record_types.call.duplicate_record_key_count = 1;
    const result = evaluateGate(model.pre_render_gate, evidence);
    assert.equal(result.verdict, 'blocked');
    assert.ok(result.reason_codes.includes('ANALYTICS_ROWSET_INVALID'));
  });
});

test('one approved source revision binds every checkpoint and Analytics readback', async (t) => {
  await t.test('missing approved revision', () => {
    const evidence = evidenceFixture();
    delete evidence.approved_source_revision;
    const result = evaluateGate(model.pre_render_gate, evidence);
    assert.equal(result.verdict, 'blocked');
    assert.ok(result.reason_codes.includes('EVIDENCE_MISSING_OR_INVALID'));
    assert.ok(result.reason_codes.includes('APPROVED_SOURCE_REVISION_INVALID'));
  });

  await t.test('mixed checkpoint revisions', () => {
    const evidence = evidenceFixture();
    evidence.scopes[0].checkpoints.call.source_revision = 'd'.repeat(40);
    evidence.scopes[0].analytics_readback.record_types.call.source_revision = 'd'.repeat(40);
    const result = evaluateGate(model.pre_render_gate, evidence);
    assert.equal(result.verdict, 'blocked');
    assert.ok(result.reason_codes.includes('CHECKPOINT_APPROVED_REVISION_MISMATCH'));
    assert.ok(result.reason_codes.includes('ANALYTICS_APPROVED_REVISION_MISMATCH'));
  });

  await t.test('self-consistent source revision substitution', () => {
    const evidence = evidenceFixture();
    const substituted = 'f'.repeat(40);
    evidence.approved_source_revision = substituted;
    for (const checkpoint of Object.values(evidence.scopes[0].checkpoints)) {
      checkpoint.source_revision = substituted;
    }
    for (const provider of Object.values(evidence.scopes[0].analytics_readback.record_types)) {
      provider.source_revision = substituted;
    }
    const result = evaluateGate(model.pre_render_gate, evidence);
    assert.equal(result.verdict, 'blocked');
    assert.ok(result.reason_codes.includes('APPROVED_SOURCE_REVISION_MISMATCH'));
  });
});

test('gate contract drift fails closed with a deterministic blocked verdict', async (t) => {
  await t.test('evidence age weakened', () => {
    const gate = structuredClone(model.pre_render_gate);
    gate.maximum_evidence_age_seconds = 301;
    const result = evaluateGate(gate, evidenceFixture());
    assert.equal(result.verdict, 'blocked');
    assert.ok(result.reason_codes.includes('GATE_CONTRACT_INVALID'));
  });

  await t.test('required scope changed', () => {
    const gate = structuredClone(model.pre_render_gate);
    gate.required_environment = 'production';
    const result = evaluateGate(gate, evidenceFixture());
    assert.equal(result.verdict, 'blocked');
    assert.ok(result.reason_codes.includes('GATE_CONTRACT_INVALID'));
  });

  await t.test('record type omitted', () => {
    const gate = structuredClone(model.pre_render_gate);
    gate.required_record_types = gate.required_record_types.slice(1);
    const result = evaluateGate(gate, evidenceFixture());
    assert.equal(result.verdict, 'blocked');
    assert.ok(result.reason_codes.includes('GATE_CONTRACT_INVALID'));
  });
});
