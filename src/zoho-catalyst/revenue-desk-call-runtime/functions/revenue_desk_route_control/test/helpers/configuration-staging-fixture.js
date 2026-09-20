'use strict';

// Synthetic Demo — No Live Calls. Fake adapters are the only I/O boundaries.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { syntheticPreparationInputs, SYNTHETIC_NOW }
  = require('../../../../../revenue-desk-release/test/fixtures/free-test-preparation');
const { prepareFreeTestConfiguration } = require('revenue_desk_call_gateway/lib/free-test-preparation');
const { canonicalApprovalIntent, routeFingerprint, routeFromRows }
  = require('revenue_desk_call_gateway/lib/approval-control');
const { keyedDigest, numberLookupKey } = require('revenue_desk_call_gateway/lib/security');
const { createJourneyCoreControlService, deterministicIdempotencyKey } = require('../../lib/journey-core-service');
const { createConfigurationStagingService, configurationDeploymentId, PROFILE, SIGNATURE_DOMAIN }
  = require('../../lib/configuration-staging-service');

const clone = (value) => structuredClone(value);
class SyntheticStore {
  constructor() { this.rows = new Map(); this.nextId = 1; this.writes = []; }
  rowsFor(table) { if (!this.rows.has(table)) this.rows.set(table, []); return this.rows.get(table); }
  async unique(table, key, value) {
    const rows = this.rowsFor(table).filter((row) => String(row[key]) === String(value));
    assert.ok(rows.length <= 1); return rows[0] ? clone(rows[0]) : null;
  }
  async queryBounded(table, key, value, _order, limit, filters = {}) {
    return clone(this.rowsFor(table).filter((row) => row[key] === value
      && Object.entries(filters).every(([field, expected]) => row[field] === expected)).slice(0, limit));
  }
  async insertUnique(table, key, row, immutable) {
    this.writes.push({ kind: 'insert', table });
    const existing = await this.unique(table, key, row[key]);
    if (existing) {
      for (const field of immutable) assert.deepEqual(existing[field], row[field]);
      return { inserted: false, row: existing };
    }
    if (table === 'RevenueDeskDeployments') {
      assert.equal(await this.unique(table, 'NUMBER_LOOKUP_HASH', row.NUMBER_LOOKUP_HASH), null);
    }
    const created = { ...clone(row), ROWID: String(this.nextId++) };
    this.rowsFor(table).push(created); return { inserted: true, row: clone(created) };
  }
  async conditionalUpdate(table, rowId, patch, expected) {
    this.writes.push({ kind: 'update', table });
    assert.ok(Object.keys(expected).length <= 4);
    const row = this.rowsFor(table).find((item) => item.ROWID === String(rowId));
    if (row && Object.entries(expected).every(([key, value]) => row[key] === value)) Object.assign(row, clone(patch));
    return row ? clone(row) : null;
  }
}

function createStagingFixture(index = 0, { store = new SyntheticStore(), publicNative = false } = {}) {
  const input = syntheticPreparationInputs()[index];
  input.review.deploymentId = configurationDeploymentId(input.crm.deal.id, input.crm.deal.Intake_Submission_ID);
  let clock = SYNTHETIC_NOW;
  const config = { environment: 'development', deploymentMode: 'active', sourceRevision: 'e'.repeat(40),
    eventChainSecret: 'synthetic-event-chain-only-'.repeat(2),
    operatorVerificationSecret: 'synthetic-owner-signing-only-'.repeat(2),
    numberSecret: 'synthetic-number-ownership-only-'.repeat(2),
    operatorIdHash: `operator_${'1'.repeat(64)}`, crmOrganizationSha256: '2'.repeat(64),
    form2DestinationSha256: '3'.repeat(64), form2FormVersion: 'synthetic_v1',
    form2WorkflowHmacMaterial: 'synthetic-form2-workflow-only-'.repeat(2),
    sharedAgentId: `synthetic_no_provider_agent_${index}`, stagingAgentVersion: 1,
    retellPhoneNumber: index ? '+13035550902' : '+19135550901',
    tables: { EVENT_RECEIPT_TABLE: 'RevenueDeskEventReceipts',
      CONFIGURATION_VERSION_TABLE: 'RevenueDeskConfigurationVersions', DEPLOYMENT_TABLE: 'RevenueDeskDeployments' } };
  const records = clone(input.crm); const evidence = clone(input.evidence);
  const binding = keyedDigest(config.form2WorkflowHmacMaterial, 'sylvara.form2.prefill-binding.v1',
    [config.crmOrganizationSha256, records.contact.id, records.account.id, records.deal.id,
      records.deal.Intake_Submission_ID, config.form2DestinationSha256, 'form2', config.form2FormVersion,
      evidence.submission.SOURCE_REVISION]);
  const bundle = { submission: { ...evidence.submission, SUBMISSION_KEY: '4'.repeat(64),
    SUBMISSION_FINGERPRINT: '5'.repeat(64), PREFILL_KEY: '6'.repeat(64) },
  session: { ...evidence.session, LAST_OUTCOME: 'submitted', JOURNEY_BINDING_DIGEST: binding },
  proof: { ...evidence.proof, LAST_OUTCOME: 'proof_consumed', PROOF_KEY: '7'.repeat(64),
    BINDING_DIGEST: '8'.repeat(64), DESTINATION_DIGEST: '9'.repeat(64) },
  prefill: { PREFILL_KEY: '6'.repeat(64), SESSION_ROW_ID: evidence.session.ROWID,
    STATUS: 'submitted', LAST_OUTCOME: 'submitted', SUBMITTED_AT: evidence.submission.SUCCEEDED_AT,
    HANDLE_CONSUMED_AT: evidence.submission.SUCCEEDED_AT, CRM_DEAL_ID: records.deal.id,
    CRM_ACCOUNT_ID: records.account.id, CRM_CONTACT_ID: records.contact.id,
    CRM_ORGANIZATION_HASH: config.crmOrganizationSha256, JOURNEY_BINDING_DIGEST: binding,
    FORM_IDENTITY_HASH: config.form2DestinationSha256, EXPECTED_STAGE: 'form2',
    SNAPSHOT_FINGERPRINT: 'a'.repeat(64), SOURCE_REVISION: evidence.submission.SOURCE_REVISION,
    SOURCE_ENVIRONMENT: 'development' } };
  let stagingWrites = 0;
  const crm = { async getDeal() { return clone(records.deal); },
    async getPreparationRecords() { return clone(records); },
    async getPublicOriginalLead() {
      assert.equal(publicNative, true);
      return { lineageType: 'public_native', originalLeadId: evidence.nativeConversion.leadId,
        journeyId: records.deal.Intake_Submission_ID, submittedAt: '2026-09-09T11:40:00.000Z',
        consentAt: '2026-09-09T11:39:00.000Z',
        submissionChannel: 'Synthetic Public Form', intakeFormVersion: 'revenue-leak-test-request-v1' };
    },
    async recordCoreApproval(_id, value) {
      Object.assign(records.deal, { Stage: 'Setup and QA', Test_Status: 'Scheduled',
        Go_Live_Approval_Status: 'Approved', Go_Live_Approved_At: value.approvedAt,
        Approved_Configuration_Version: value.configurationVersionId });
      return clone(records.deal);
    },
    async recordConfigurationStaging(_id, value) {
      assert.deepEqual(records.deal, value.expectedDeal); stagingWrites += 1;
      Object.assign(records.deal, { Deployment_Record_ID: value.deploymentId, Stage: 'Setup and QA',
        Test_Status: value.priorApproval ? 'Scheduled' : 'Setup Pending' });
      return clone(records.deal);
    } };
  const lineage = { originalLeadId: evidence.nativeConversion.leadId,
    journeyId: records.deal.Intake_Submission_ID, consumedAt: '2026-09-09T11:40:00.000Z',
    sourceRevision: 'c'.repeat(40), form1RowId: String(401 + index), submissionFingerprint: 'b'.repeat(64) };
  const sourceReader = { async findAssistedLineage() { return publicNative ? null : clone(lineage); } };
  const nativeConversion = { originalLeadId: lineage.originalLeadId, journeyId: lineage.journeyId,
    accountId: records.account.id, contactId: records.contact.id, dealId: records.deal.id,
    convertedAt: '2026-09-09T11:42:00.000Z' };
  const conversionReader = { async readConversion() { return { ...clone(nativeConversion), observedAt: new Date(clock).toISOString() }; } };
  const evidenceStore = { async readBundle() { return clone(bundle); } };
  const core = createJourneyCoreControlService({ config, store, crm, evidenceStore, now: () => clock });
  const service = createConfigurationStagingService({ config, store, crm, core, sourceReader, conversionReader, now: () => clock });
  input.review.configurationVersionId = `synthetic_staged_config_${index}`;
  const candidate = prepareFreeTestConfiguration(input, { now: clock }).candidate;
  const final = { ...candidate, approved: true, notificationRecipient: { ...candidate.notificationRecipient, approved: true } };
  const configurationRow = { CONFIGURATION_VERSION_ID: input.review.configurationVersionId,
    DEPLOYMENT_ID: candidate.deploymentId, CONFIGURATION_VERSION: candidate.configurationVersion,
    CONFIGURATION_JSON: JSON.stringify(final), ENGAGEMENT_TYPE: 'free_test', CAPABILITY_PROFILE: 'call_gap_monitor_v1',
    PLAN_TIER: 'none', DEPLOYMENT_STATUS: 'Live', GO_LIVE_APPROVAL_STATUS: 'Approved',
    LIMIT_POLICY: 'seven_calendar_days_or_25_connected_calls_v1', BILLING_MODE: 'none',
    NUMBER_OWNERSHIP: 'dedicated_deployment', ENVIRONMENT: 'development', SOURCE_REVISION: config.sourceRevision,
    SOURCE_ENVIRONMENT: 'development', STATUS: 'Active', APPROVAL_STATUS: 'Approved' };
  const deployment = { CLIENT_ID: candidate.clientId, DEPLOYMENT_ID: candidate.deploymentId,
    ACTIVE_CONFIGURATION_VERSION_ID: configurationRow.CONFIGURATION_VERSION_ID,
    NUMBER_LOOKUP_HASH: numberLookupKey(config.numberSecret, config.retellPhoneNumber),
    BINDING_ID: `synthetic_binding_${index}`, BINDING_VERSION: 1, MONITOR_AGENT_ID: config.sharedAgentId,
    MONITOR_AGENT_VERSION: 1, COVERAGE_MODE: candidate.coverageMode, CALL_LIMIT: 25, COUNT_VERSION: 0,
    HANDLED_COUNT: 0, SOURCE_REVISION: config.sourceRevision, SOURCE_ENVIRONMENT: 'development' };
  const request = { profile: PROFILE, dealId: records.deal.id, journeyId: records.deal.Intake_Submission_ID,
    form2ConfigurationVersion: records.deal.Configuration_Version, review: clone(input.review), configurationRow,
    deployment, intent: { schema_version: 1, event_id: `approval_${String(index + 1).repeat(64)}`, action: 'approve',
      deployment_id: deployment.DEPLOYMENT_ID, configuration_version_id: configurationRow.CONFIGURATION_VERSION_ID,
      route_fingerprint: routeFingerprint(routeFromRows(deployment, configurationRow)),
      evidence_revision: config.sourceRevision, evidence_observed_at: input.evidence.capturedAt,
      requested_at: new Date(clock).toISOString(), operator_id_hash: config.operatorIdHash, expected_deployment_version: 0 },
    signature: '' };
  function sign(domain = SIGNATURE_DOMAIN) {
    request.intent.route_fingerprint = routeFingerprint(routeFromRows(request.deployment, request.configurationRow));
    request.signature = `v1=${crypto.createHmac('sha256', config.operatorVerificationSecret)
      .update(domain).update(canonicalApprovalIntent(request.intent)).digest('hex')}`;
  }
  sign();
  const coreApprovalCommand = { dealId: records.deal.id, journeyId: records.deal.Intake_Submission_ID,
    configurationVersionId: records.deal.Configuration_Version, idempotencyKey: deterministicIdempotencyKey('approve',
      records.deal.id, records.deal.Intake_Submission_ID, records.deal.Configuration_Version) };
  return { request, service, core, coreApprovalCommand, config, store, crm, sourceReader, conversionReader,
    records, bundle, lineage, nativeConversion, sign, get stagingWrites() { return stagingWrites; },
    now: () => clock, advance(ms) { clock += ms; } };
}
module.exports = { createStagingFixture, SyntheticStore };
