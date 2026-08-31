'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createJourneyCoreControlService, deterministicIdempotencyKey, isJourneyCoreCommand }
  = require('../lib/journey-core-service');
const { keyedDigest } = require('revenue_desk_call_gateway/lib/security');

const CONTROL_REVISION = 'b'.repeat(40);
const EVIDENCE_REVISION = 'a'.repeat(40);
const SUBMISSION_ROW_ID = '8000000000001';
const CONFIGURATION_ID = `form2cfgv1:${SUBMISSION_ROW_ID}:${EVIDENCE_REVISION}`;
const DEAL_ID = '400000000000001';
const ACCOUNT_ID = '400000000000002';
const CONTACT_ID = '400000000000003';
const JOURNEY_ID = 'journey_synthetic';
const AT = '2026-08-30T12:00:00.000Z';
const CRM_AT = '2026-08-30T12:00:00+00:00';
const SYNTHETIC_ORG_NUMBER = '606';
const CRM_ORGANIZATION_SHA256 = crypto.createHash('sha256')
  .update(SYNTHETIC_ORG_NUMBER).digest('hex');
const FORM2_DESTINATION_SHA256 = '6'.repeat(64);
const FORM2_FORM_VERSION = 'free-test-setup-v1';
const SYNTHETIC_FORM2_WORKFLOW_HMAC_MATERIAL = 'w'.repeat(32);

function bindingDigest() {
  return keyedDigest(SYNTHETIC_FORM2_WORKFLOW_HMAC_MATERIAL,
    'sylvara.form2.prefill-binding.v1', [
    CRM_ORGANIZATION_SHA256, CONTACT_ID, ACCOUNT_ID, DEAL_ID, JOURNEY_ID,
    FORM2_DESTINATION_SHA256, 'form2', FORM2_FORM_VERSION, EVIDENCE_REVISION,
  ]);
}

function copy(value) { return structuredClone(value); }

function bundle(overrides = {}) {
  const prefillKey = '1'.repeat(64);
  const sessionRowId = '7000000000001';
  const source = EVIDENCE_REVISION;
  const selected = {
    submission: {
      ROWID: SUBMISSION_ROW_ID, SUBMISSION_KEY: '2'.repeat(64), PREFILL_KEY: prefillKey,
      SESSION_ROW_ID: sessionRowId, SUBMISSION_FINGERPRINT: '3'.repeat(64),
      STATUS: 'succeeded', SUCCEEDED_AT: AT, FAILED_AT: '', RECONCILIATION_REQUIRED_AT: '',
      LAST_OUTCOME: 'succeeded', SOURCE_REVISION: source, SOURCE_ENVIRONMENT: 'development',
    },
    prefill: {
      PREFILL_KEY: prefillKey, SESSION_ROW_ID: sessionRowId, CRM_DEAL_ID: DEAL_ID,
      CRM_ACCOUNT_ID: ACCOUNT_ID, CRM_CONTACT_ID: CONTACT_ID, STATUS: 'submitted',
      LAST_OUTCOME: 'submitted', SUBMITTED_AT: AT, HANDLE_CONSUMED_AT: AT,
      RECONCILIATION_REQUIRED_AT: '', SNAPSHOT_FINGERPRINT: '4'.repeat(64),
      CRM_ORGANIZATION_HASH: CRM_ORGANIZATION_SHA256,
      JOURNEY_BINDING_DIGEST: bindingDigest(), FORM_IDENTITY_HASH: FORM2_DESTINATION_SHA256,
      EXPECTED_STAGE: 'form2', SOURCE_REVISION: source, SOURCE_ENVIRONMENT: 'development',
    },
    session: {
      ROWID: sessionRowId, CRM_DEAL_ID: DEAL_ID, CRM_ACCOUNT_ID: ACCOUNT_ID,
      CRM_CONTACT_ID: CONTACT_ID, JOURNEY_BINDING_DIGEST: bindingDigest(),
      STATUS: 'submitted', LAST_OUTCOME: 'submitted', VERIFIED_AT: AT, SUBMITTED_AT: AT,
      EXPIRED_AT: '', REVOKED_AT: '', FAILED_AT: '',
      SOURCE_REVISION: source, SOURCE_ENVIRONMENT: 'development',
    },
    proof: {
      SESSION_ROW_ID: sessionRowId, PROOF_KEY: '7'.repeat(64),
      BINDING_DIGEST: '8'.repeat(64), DESTINATION_DIGEST: '9'.repeat(64),
      STATUS: 'consumed', LAST_OUTCOME: 'proof_consumed', VERIFIED_AT: AT, CONSUMED_AT: AT,
      SOURCE_REVISION: source, SOURCE_ENVIRONMENT: 'development',
    },
  };
  for (const [group, values] of Object.entries(overrides)) Object.assign(selected[group], values);
  return selected;
}

function initialDeal(overrides = {}) {
  return {
    id: DEAL_ID, Modified_Time: CRM_AT, Pipeline: 'Revenue Desk Sales',
    Stage: 'Setup and Authorization', Entry_Offer: '7-Day Revenue Leak Test',
    Intake_Submission_ID: JOURNEY_ID,
    Account_Name: { id: ACCOUNT_ID }, Contact_Name: { id: CONTACT_ID },
    Setup_Access_Status: 'Submitted', Setup_Access_Verified_At: CRM_AT,
    Setup_Form_Submission_ID: 'form2_synthetic_submission',
    Setup_Form_Version: FORM2_FORM_VERSION, Setup_Form_Submitted_At: CRM_AT,
    Authorized_Representative_Confirmed: true, Test_Scope_Accepted: true,
    Authority_Confirmed_At: CRM_AT, Test_Scope_Accepted_At: CRM_AT,
    Configuration_Version: CONFIGURATION_ID, Deployment_Record_ID: null,
    Approved_Configuration_Version: null, Approved_Deployment_Record_ID: null,
    Test_Status: 'Not Started', Go_Live_Approval_Status: 'Not Ready',
    Go_Live_Approved_At: null, Test_Start_At: null, Test_End_At: null,
    Rollback_Completed_At: null, Billing_Subscription_ID: null, Reason_For_Loss__s: null,
    ...overrides,
  };
}

function command(action, overrides = {}) {
  return {
    dealId: DEAL_ID, journeyId: JOURNEY_ID,
    configurationVersionId: CONFIGURATION_ID,
    idempotencyKey: deterministicIdempotencyKey(
      action, DEAL_ID, JOURNEY_ID, CONFIGURATION_ID,
    ),
    ...(action === 'rollback' ? { reason: 'operator_requested' } : {}),
    ...overrides,
  };
}

class MemoryStore {
  constructor() { this.rows = []; this.nextRowId = 1; this.tables = []; }

  async queryBounded(table, column, value, _order, limit, additional = {}) {
    this.tables.push(table);
    return copy(this.rows.filter((row) => row[column] === value
      && Object.entries(additional).every(([key, expected]) => row[key] === expected))
      .slice(0, limit));
  }

  async unique(table, column, value) {
    this.tables.push(table);
    const rows = this.rows.filter((row) => String(row[column]) === String(value));
    assert.ok(rows.length <= 1);
    return rows[0] ? copy(rows[0]) : null;
  }

  async insertUnique(table, key, row, immutable) {
    this.tables.push(table);
    let current = this.rows.find((candidate) => candidate[key] === row[key]);
    if (!current) {
      current = { ...copy(row), ROWID: String(this.nextRowId++) };
      this.rows.push(current);
      return { row: copy(current), inserted: true };
    }
    for (const field of immutable) assert.deepEqual(current[field], row[field]);
    return { row: copy(current), inserted: false };
  }

  async conditionalUpdate(table, rowId, patch, expected) {
    assert.ok(Object.keys(expected).length <= 4,
      'conditional updates may use at most four explicit predicates');
    this.tables.push(table);
    const current = this.rows.find((row) => row.ROWID === String(rowId));
    if (!current || !Object.entries(expected).every(([key, value]) => current[key] === value)) {
      return current ? copy(current) : null;
    }
    Object.assign(current, copy(patch));
    return copy(current);
  }
}

function fixture({ evidence = bundle(), deal = initialDeal(), approvalFailureOnce = false,
  rollbackFailureOnce = false, clockStart = Date.parse(AT) } = {}) {
  const store = new MemoryStore();
  const state = copy(deal);
  let approvalWrites = 0;
  let rollbackWrites = 0;
  let failApproval = approvalFailureOnce;
  let failRollback = rollbackFailureOnce;
  let clock = clockStart;
  const crm = {
    async getDeal() { return copy(state); },
    async recordCoreApproval(_dealId, value) {
      if (state.Stage === 'Setup and QA' && state.Test_Status === 'Scheduled'
        && state.Go_Live_Approval_Status === 'Approved'
        && Date.parse(state.Go_Live_Approved_At) === Date.parse(value.approvedAt)
        && state.Approved_Configuration_Version === value.configurationVersionId) {
        return copy(state);
      }
      approvalWrites += 1;
      Object.assign(state, {
        Modified_Time: new Date(clock).toISOString(), Stage: 'Setup and QA',
        Test_Status: 'Scheduled', Go_Live_Approval_Status: 'Approved',
        Go_Live_Approved_At: new Date(value.approvedAt).toISOString()
          .replace(/\.\d{3}Z$/, '+00:00'),
        Approved_Deployment_Record_ID: null,
        Approved_Configuration_Version: value.configurationVersionId,
      });
      if (failApproval) {
        failApproval = false;
        throw new Error('synthetic ambiguous CRM approval readback');
      }
      return copy(state);
    },
    async recordCoreRollback(_dealId, value) {
      if (state.Stage === 'Closed Lost' && state.Test_Status === 'Failed'
        && state.Go_Live_Approval_Status === 'Revoked'
        && Date.parse(state.Rollback_Completed_At) === Date.parse(value.stoppedAt)
        && state.Approved_Configuration_Version === value.configurationVersionId
        && state.Test_End_Reason === value.reason) {
        return copy(state);
      }
      rollbackWrites += 1;
      Object.assign(state, {
        Modified_Time: new Date(clock).toISOString(), Stage: 'Closed Lost',
        Test_Status: 'Failed', Go_Live_Approval_Status: 'Revoked',
        Test_Start_At: null,
        Test_End_At: new Date(value.stoppedAt).toISOString().replace(/\.\d{3}Z$/, '+00:00'),
        Test_End_Reason: value.reason,
        Rollback_Completed_At: new Date(value.stoppedAt).toISOString()
          .replace(/\.\d{3}Z$/, '+00:00'),
        Reason_For_Loss__s: 'Other',
      });
      if (failRollback) {
        failRollback = false;
        throw new Error('synthetic ambiguous CRM rollback readback');
      }
      return copy(state);
    },
  };
  const config = {
    environment: 'development', deploymentMode: 'active',
    sourceRevision: CONTROL_REVISION, eventChainSecret: 'e'.repeat(32),
    crmOrganizationSha256: CRM_ORGANIZATION_SHA256,
    form2DestinationSha256: FORM2_DESTINATION_SHA256,
    form2FormVersion: FORM2_FORM_VERSION,
    form2WorkflowHmacMaterial: SYNTHETIC_FORM2_WORKFLOW_HMAC_MATERIAL,
    tables: { EVENT_RECEIPT_TABLE: 'RevenueDeskEventReceipts' },
  };
  const service = createJourneyCoreControlService({
    config, store, evidenceStore: { async readBundle() { return copy(evidence); } },
    crm, now: () => clock,
  });
  return {
    service, store, state, config,
    advance() { clock += 60_000; },
    get approvalWrites() { return approvalWrites; },
    get rollbackWrites() { return rollbackWrites; },
  };
}

test('initialized and submitted Deal approves without workflow, deployment, phone, or provider',
  async () => {
  const selected = fixture();
  const approved = await selected.service.approve(command('approve'));
  assert.deepEqual(approved, {
    state: 'Scheduled', replayed: false, approved: true, active: false,
    stopped: false, configurationVersionId: CONFIGURATION_ID,
  });
  assert.equal(selected.state.Stage, 'Setup and QA');
  assert.equal(selected.state.Test_Status, 'Scheduled');
  assert.equal(selected.state.Go_Live_Approval_Status, 'Approved');
  assert.equal(selected.state.Deployment_Record_ID, null);
  assert.equal(selected.state.Approved_Deployment_Record_ID, null);
  assert.equal(selected.approvalWrites, 1);
  assert.deepEqual(new Set(selected.store.tables), new Set(['RevenueDeskEventReceipts']));

  const replay = await selected.service.approve(command('approve'));
  assert.equal(replay.replayed, true);
  assert.equal(selected.approvalWrites, 1);
});

test('activation is durably rejected before provider state and preserves approval', async () => {
  const selected = fixture();
  await selected.service.approve(command('approve'));
  selected.advance();
  await assert.rejects(selected.service.activate(command('activate')),
    { code: 'ISOLATED_RETELL_TEST_NUMBER_REQUIRED' });
  assert.equal(selected.state.Stage, 'Setup and QA');
  assert.equal(selected.state.Test_Status, 'Scheduled');
  assert.equal(selected.state.Go_Live_Approval_Status, 'Approved');
  assert.equal(selected.state.Test_Start_At, null);
  const activation = selected.store.rows.find((row) => row.EVENT_TYPE === 'activate');
  assert.equal(activation.STATUS, 'Completed');
  assert.equal(JSON.parse(activation.EVENT_DATA_JSON).decision,
    'BlockedNoTelephonyDeployment');
});

test('reconciliation retry reuses the original durable approval claim', async () => {
  const selected = fixture({ approvalFailureOnce: true });
  await assert.rejects(selected.service.approve(command('approve')),
    /synthetic ambiguous CRM approval readback/);
  const receipt = selected.store.rows.find((row) => row.EVENT_TYPE === 'approve');
  assert.equal(receipt.STATUS, 'ReconciliationRequired');
  const originalData = receipt.EVENT_DATA_JSON;
  const approved = await selected.service.approve(command('approve'));
  assert.equal(approved.state, 'Scheduled');
  assert.equal(selected.approvalWrites, 1);
  assert.equal(receipt.STATUS, 'Completed');
  assert.equal(receipt.EVENT_DATA_JSON, originalData);
});

test('reconciliation retry completes an ambiguously applied rollback without another write',
  async () => {
  const selected = fixture({ rollbackFailureOnce: true });
  await selected.service.approve(command('approve'));
  selected.advance();
  await assert.rejects(selected.service.rollback(command('rollback')),
    /synthetic ambiguous CRM rollback readback/);
  const receipt = selected.store.rows.find((row) => row.EVENT_TYPE === 'revoke');
  assert.equal(receipt.STATUS, 'ReconciliationRequired');
  const originalData = receipt.EVENT_DATA_JSON;
  assert.equal(selected.state.Stage, 'Closed Lost');
  assert.equal(selected.rollbackWrites, 1);

  const stopped = await selected.service.rollback(command('rollback'));
  assert.equal(stopped.state, 'Stopped');
  assert.equal(stopped.replayed, false);
  assert.equal(selected.rollbackWrites, 1);
  assert.equal(receipt.STATUS, 'Completed');
  assert.equal(receipt.EVENT_DATA_JSON, originalData);
});

test('completed receipt authority rejects JSON, HMAC, and immutable outer-column tampering',
  async () => {
  const mutations = [
    (row) => { row.PAYLOAD_FINGERPRINT = '0'.repeat(64); },
    (row) => { row.EVENT_KEY = `coreapr_${'0'.repeat(64)}`; },
    (row) => { row.EVENT_TYPE = 'activate'; },
    (row) => { row.CONFIGURATION_VERSION_ID = `form2cfgv1:${SUBMISSION_ROW_ID}:${'c'.repeat(40)}`; },
    (row) => { row.DEPLOYMENT_ID = 'deployment_synthetic'; },
    (row) => { row.SOURCE_REVISION = 'c'.repeat(40); },
    (row) => { row.SOURCE_ENVIRONMENT = 'production'; },
    (row) => { row.RECEIVED_AT = '2026-08-30T12:01:00.000Z'; },
    (row) => { row.RELATED_EVENT_KEY = `coreapr_${'1'.repeat(64)}`; },
    (row) => {
      const data = JSON.parse(row.EVENT_DATA_JSON);
      data.decision = 'RevokedInactive';
      row.EVENT_DATA_JSON = JSON.stringify(data);
    },
    (row) => { row.PROCESSED_AT = '2026-08-30T12:01:00.000Z'; },
  ];
  for (const mutate of mutations) {
    const selected = fixture();
    await selected.service.approve(command('approve'));
    const receipt = selected.store.rows.find((row) => row.EVENT_TYPE === 'approve');
    mutate(receipt);
    // Force the synthetic provider to return the row even when the tampered
    // configuration column would otherwise hide it from the bounded inventory.
    selected.store.queryBounded = async () => copy(selected.store.rows);
    await assert.rejects(selected.service.approve(command('approve')),
      { code: 'CONTROL_AUDIT_INVALID' });
    assert.equal(selected.approvalWrites, 1);
  }
});

test('receipt completion readback rejects immutable drift after provider-bounded CAS', async () => {
  const selected = fixture();
  const conditionalUpdate = selected.store.conditionalUpdate.bind(selected.store);
  let tampered = false;
  selected.store.conditionalUpdate = async (...args) => {
    const [, , patch] = args;
    if (!tampered && patch.STATUS === 'Completed') {
      tampered = true;
      selected.store.rows[0].RELATED_EVENT_KEY = `coreapr_${'2'.repeat(64)}`;
    }
    return conditionalUpdate(...args);
  };
  await assert.rejects(selected.service.approve(command('approve')),
    { code: 'CONTROL_AUDIT_INVALID' });
  assert.equal(selected.approvalWrites, 1);
  // The provider-bounded update can land, but the changed immutable identity
  // prevents this row from ever becoming replayable approval authority.
  assert.equal(selected.store.rows[0].STATUS, 'Completed');
  await assert.rejects(selected.service.approve(command('approve')),
    { code: 'CONTROL_AUDIT_INVALID' });
  assert.equal(selected.approvalWrites, 1);
});

test('subsecond runtime clocks produce exact whole-second CRM approval and rollback evidence',
  async () => {
  const selected = fixture({ clockStart: Date.parse(AT) + 789 });
  await selected.service.approve(command('approve'));
  assert.equal(selected.state.Go_Live_Approved_At, CRM_AT);
  const approval = selected.store.rows.find((row) => row.EVENT_TYPE === 'approve');
  assert.equal(JSON.parse(approval.EVENT_DATA_JSON).decidedAt, AT);
  selected.advance();
  await selected.service.rollback(command('rollback'));
  assert.equal(selected.state.Rollback_Completed_At, '2026-08-30T12:01:00+00:00');
  const rollback = selected.store.rows.find((row) => row.EVENT_TYPE === 'revoke');
  assert.equal(JSON.parse(rollback.EVENT_DATA_JSON).decidedAt,
    '2026-08-30T12:01:00.000Z');
});

test('rollback is durable, repeatable, and blocks later activation', async () => {
  const selected = fixture();
  await selected.service.approve(command('approve'));
  selected.advance();
  await assert.rejects(selected.service.activate(command('activate')),
    { code: 'ISOLATED_RETELL_TEST_NUMBER_REQUIRED' });
  selected.advance();
  const stopped = await selected.service.rollback(command('rollback'));
  assert.equal(stopped.state, 'Stopped');
  assert.equal(selected.state.Stage, 'Closed Lost');
  assert.equal(selected.state.Test_Status, 'Failed');
  assert.equal(selected.state.Go_Live_Approval_Status, 'Revoked');
  assert.equal(selected.rollbackWrites, 1);
  assert.equal((await selected.service.rollback(command('rollback'))).replayed, true);
  assert.equal(selected.rollbackWrites, 1);
  await assert.rejects(selected.service.activate(command('activate')),
    { code: 'ACTIVATION_SUPERSEDED_BY_ROLLBACK' });
});

test('completed rollback replay rejects drifted CRM terminal or Billing evidence', async () => {
  const drifts = [
    { Billing_Subscription_ID: 'subscription_synthetic' },
    { Test_End_At: '2026-08-30T13:00:00+00:00' },
    { Test_End_Reason: 'Technical Failure' },
    { Go_Live_Approved_At: '2026-08-30T11:00:00+00:00' },
    { Reason_For_Loss__s: '' },
    { Deployment_Record_ID: 'deployment_synthetic' },
  ];
  for (const drift of drifts) {
    const selected = fixture();
    await selected.service.approve(command('approve'));
    selected.advance();
    await selected.service.rollback(command('rollback'));
    Object.assign(selected.state, drift);
    await assert.rejects(selected.service.rollback(command('rollback')),
      { code: 'CONTROL_PRECONDITION_FAILED' });
  }
});

test('configuration pointer binds historical Form 2 evidence rather than current control SHA',
  async () => {
  assert.notEqual(EVIDENCE_REVISION, CONTROL_REVISION);
  const selected = fixture();
  await selected.service.approve(command('approve'));
  assert.equal(selected.state.Approved_Configuration_Version, CONFIGURATION_ID);
});

test('wrong security-stage token or evidence revision fails before any write', async () => {
  for (const evidence of [
    bundle({ prefill: { EXPECTED_STAGE: 'Setup and Authorization' } }),
    bundle({ proof: { SOURCE_REVISION: CONTROL_REVISION } }),
  ]) {
    const selected = fixture({ evidence });
    await assert.rejects(selected.service.approve(command('approve')),
      { code: 'FORM2_EVIDENCE_INVALID' });
    assert.equal(selected.approvalWrites, 0);
    assert.equal(selected.store.rows.length, 0);
  }
});

test('journey binding is recomputed from trusted Form 2 and live CRM identity', async () => {
  for (const evidence of [
    bundle({ prefill: { CRM_ORGANIZATION_HASH: '0'.repeat(64) } }),
    bundle({ prefill: { FORM_IDENTITY_HASH: '0'.repeat(64) } }),
    bundle({ prefill: { JOURNEY_BINDING_DIGEST: '0'.repeat(64) } }),
    bundle({ session: { JOURNEY_BINDING_DIGEST: '0'.repeat(64) } }),
  ]) {
    const selected = fixture({ evidence });
    await assert.rejects(selected.service.approve(command('approve')),
      { code: 'FORM2_EVIDENCE_INVALID' });
    assert.equal(selected.approvalWrites, 0);
  }
  const wrongVersion = fixture({ deal: initialDeal({ Setup_Form_Version: 'form2-other' }) });
  await assert.rejects(wrongVersion.service.approve(command('approve')),
    { code: 'CONTROL_PRECONDITION_FAILED' });
  assert.equal(wrongVersion.approvalWrites, 0);
  const billingBound = fixture({
    deal: initialDeal({ Billing_Subscription_ID: 'subscription_synthetic' }),
  });
  await assert.rejects(billingBound.service.approve(command('approve')),
    { code: 'CONTROL_PRECONDITION_FAILED' });
  assert.equal(billingBound.approvalWrites, 0);
});

test('deterministic action identity rejects alternate authenticated UUIDs', async () => {
  const selected = fixture();
  await assert.rejects(selected.service.approve(command('approve', {
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
  })), { code: 'INVALID_CONTROL_REQUEST' });
  assert.equal(selected.approvalWrites, 0);
  assert.equal(selected.store.rows.length, 0);
});

test('completed approval survives a later route-control source revision', async () => {
  const selected = fixture();
  await selected.service.approve(command('approve'));
  selected.config.sourceRevision = 'c'.repeat(40);
  assert.equal((await selected.service.approve(command('approve'))).replayed, true);
  await assert.rejects(selected.service.activate(command('activate')),
    { code: 'ISOLATED_RETELL_TEST_NUMBER_REQUIRED' });
  const activation = selected.store.rows.find((row) => row.EVENT_TYPE === 'activate');
  assert.equal(activation.SOURCE_REVISION, 'c'.repeat(40));
});

test('missing or nonblank deployment identity selects the correct bounded mode', () => {
  assert.equal(isJourneyCoreCommand(command('approve')), true);
  assert.equal(isJourneyCoreCommand(command('approve', { deploymentId: '' })), true);
  assert.equal(isJourneyCoreCommand(command('approve', { deploymentId: null })), true);
  assert.equal(isJourneyCoreCommand(command('approve', {
    deploymentId: 'deployment_synthetic',
  })), false);
});
