'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const test = require('node:test');

const catalystRoot = path.resolve(__dirname, '..', '..');
const repositoryRoot = path.resolve(catalystRoot, '..', '..');
const fromCatalyst = (...parts) => path.join(catalystRoot, ...parts);

const contract = require('../release-contract.json');
const productContract = require(path.join(
  repositoryRoot, 'docs', 'product', 'free-revenue-leak-test-release-contract.json',
));
const {
  buildManifest, createArtifactProvenance, verifyReadback,
} = require('../lib/release-manifest');
const { handleRequest: handleForm1 } = require(fromCatalyst(
  'revenue-leak-test-request-form', 'functions', 'revenue_leak_test_request_form',
  'lib', 'handler',
));
const { validateForm2Payload } = require(fromCatalyst(
  'revenue-leak-test-setup-form', 'functions', 'revenue_leak_test_setup_form',
  'lib', 'form-contract',
));
const { createWorkerJobHandler } = require(fromCatalyst(
  'revenue-desk-call-runtime', 'functions', 'revenue_desk_call_gateway',
  'lib', 'job-handler',
));
const {
  SOURCE_REVISION,
  configuration: runtimeConfiguration,
  eventPayload,
  invoke,
  payloadInbound,
  retryJobRequest,
  runtimeFixture,
} = require(fromCatalyst(
  'revenue-desk-call-runtime', 'functions', 'revenue_desk_call_gateway',
  'test', 'runtime-fixture',
));
const { SCHEMA_VERSION, validatePayload: validateCrmAction } = require(fromCatalyst(
  'crm-billing-orchestrator', 'functions', 'crm_billing_orchestrator',
  'lib', 'action-contract',
));
const {
  parseReportSummary,
  reportSummaryPatch,
  validateReportOperation,
} = require(fromCatalyst(
  'crm-billing-orchestrator', 'functions', 'crm_billing_orchestrator',
  'lib', 'report-summary',
));
const { createAnalyticsSyncJobHandler } = require(fromCatalyst(
  'revenue-desk-analytics', 'functions', 'analytics_sync', 'lib', 'job-handler',
));
const { parseOutboxRow, targetRow } = require(fromCatalyst(
  'revenue-desk-analytics', 'functions', 'analytics_sync', 'lib', 'facts',
));
const { MemoryStore } = require(fromCatalyst(
  'revenue-desk-analytics', 'functions', 'analytics_sync', 'test', 'helpers',
));
const shadowQaContract = require(path.join(
  repositoryRoot, 'src', 'retell', 'agents', '7-day-free-test',
  'contracts', 'shadow-qa-contract.json',
));
const nonurgentContract = require(path.join(
  repositoryRoot, 'src', 'retell', 'agents', '7-day-free-test',
  'contracts', 'nonurgent-classification-contract.json',
));

const FORM1_ISSUE_SECRET = 'i'.repeat(43);
const FORM1_PREFILL_SECRET = 'p'.repeat(43);
const FORM1_TOKEN_PEPPER = 't'.repeat(43);
const LEAD_ID = '9'.repeat(19);
const CONTACT_ID = `${'8'.repeat(17)}1`;
const ACCOUNT_ID = `${'8'.repeat(17)}2`;
const DEAL_ID = '400000001';

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function releaseFixture(environment) {
  const names = contract.functions.map(({ name }) => name);
  const sourceTrees = Object.fromEntries(names.map((name) => [
    name, digest(`source:${name}`),
  ]));
  const artifacts = Object.fromEntries(contract.functions.map((entry) => {
    const artifact = {
      sha256: digest(`artifact:${entry.name}`),
      file_count: 1,
    };
    artifact.provenance = createArtifactProvenance({
      functionName: entry.name,
      packageName: entry.name,
      revisionStampTarget: entry.revision_stamp_target,
      sourceRevision: SOURCE_REVISION,
      sourceTreeSha256: sourceTrees[entry.name],
      artifactSha256: artifact.sha256,
      artifactFileCount: artifact.file_count,
    });
    return [entry.name, artifact];
  }));
  const contractDigests = Object.fromEntries(contract.contract_files.map((file) => [
    file, digest(`contract:${file}`),
  ]));
  const manifest = buildManifest({
    contract,
    sourceRevision: SOURCE_REVISION,
    environment,
    artifacts,
    sourceTrees,
    contractDigests,
  });
  const readback = {
    source_revision: SOURCE_REVISION,
    environment,
    mode: manifest.mode,
    functions: manifest.functions.map((entry) => ({
      name: entry.name,
      source_revision: entry.source_revision,
      source_tree_sha256: entry.source_tree_sha256,
      artifact_sha256: entry.artifact_sha256,
    })),
    job_pools: [...manifest.job_pools],
    tables: [...manifest.tables],
    contract_sha256: { ...manifest.contract_sha256 },
    ...(environment === 'Production' ? contract.production_invariants : {}),
  };
  return { manifest, readback };
}

function jsonPost(url, headerName, headerValue, body) {
  return {
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/json',
      [headerName]: headerValue,
    },
    rawBody: Buffer.from(JSON.stringify(body), 'utf8'),
  };
}

function form1Config() {
  return {
    assistedConstants: {
      entryOffer: 'Synthetic test offer',
      intakeFormVersion: 'synthetic-form1-v1',
      leadStatus: 'Synthetic requested',
      sourcePage: 'synthetic-release-test',
      submissionChannel: 'Synthetic In Person',
    },
    form1PublicUrl: 'https://forms.zohopublic.com/synthetic/form/FreeTest/formperma/example',
    form1TokenFieldAlias: 'assisted_token',
    issuePath: '/form1/issue-test',
    prefillPath: '/form1/prefill-test',
    issueHeaderName: 'x-synthetic-form1-issue',
    prefillHeaderName: 'x-synthetic-form1-prefill',
    issueHeaderSecret: FORM1_ISSUE_SECRET,
    prefillHeaderSecret: FORM1_PREFILL_SECRET,
    tokenPepper: FORM1_TOKEN_PEPPER,
    maxBodyBytes: 4096,
    inboundBodyTimeoutMs: 5000,
  };
}

async function runForm1Request() {
  const config = form1Config();
  const lead = {
    id: LEAD_ID,
    Modified_Time: '2026-08-22T06:00:00-05:00',
    First_Name: 'Casey',
    Last_Name: 'Tester',
    Company: 'Synthetic Plumbing A',
    Decision_Maker_Role: 'Owner / Founder',
    Designation: 'Owner',
    Email: 'casey@example.invalid',
    Mobile: '+15550102000',
    Lead_Source: 'Synthetic source',
    Main_Business_Phone: '+15550102100',
    Current_Call_Handling: 'Office Staff / Dispatcher',
    Requested_Test_Route: 'After Hours Only',
    Phone_System_Provider: 'Synthetic PBX',
    Primary_Service_Area: 'Synthetic County',
    Field_Team_Size_Band: 'Synthetic Approved Band',
    Intake_Submission_ID: 'f1a_00000000-0000-4000-8000-000000000000',
  };
  let session;
  let uuidCall = 0;
  const dependencies = {
    config,
    now: () => Date.parse('2026-08-22T12:00:00.000Z'),
    randomBytes: () => Buffer.alloc(32, 7),
    randomUUID: () => (++uuidCall === 1
      ? '11111111-1111-4111-8111-111111111111'
      : '22222222-2222-4222-8222-222222222222'),
    crmClient: {
      async getLead(id) {
        assert.equal(id, LEAD_ID);
        return { ...lead };
      },
      async updateIntakeSubmissionId(current, intakeSubmissionId) {
        assert.equal(current.id, LEAD_ID);
        lead.Intake_Submission_ID = intakeSubmissionId;
        return { ...lead };
      },
    },
    sessionStore: {
      async createSession(input) {
        session = {
          rowId: '1',
          ...input,
          status: 'issuing',
          expiresAt: '2026-08-22T12:15:00.000Z',
        };
        return { ...session };
      },
      async markIssued(input) {
        session = { ...input, status: 'issued' };
        return { ...session };
      },
      async readByTokenHash(tokenHash) {
        assert.equal(tokenHash, session.tokenHash);
        return { ...session };
      },
      async reservePrefill(input, owner) {
        assert.equal(owner, '22222222-2222-4222-8222-222222222222');
        session = { ...input, status: 'prefilling', prefillCount: 1, maxPrefills: 10 };
        return { ...session };
      },
      async completePrefill(input) {
        session = { ...input, status: 'prefilled' };
        return { ...session };
      },
      async cancelPrefill() { assert.fail('valid prefill must not be cancelled'); },
      async markExpired() { assert.fail('valid session must not expire'); },
      async markFailed() { assert.fail('valid issuance must not fail'); },
      async markReconciliationRequired() { assert.fail('valid issuance must not reconcile'); },
    },
  };

  const issued = await handleForm1(jsonPost(
    config.issuePath,
    config.issueHeaderName,
    FORM1_ISSUE_SECRET,
    { leadId: LEAD_ID },
  ), dependencies);
  const token = new URL(issued.body.formUrl).searchParams.get(config.form1TokenFieldAlias);
  const prefilled = await handleForm1(jsonPost(
    config.prefillPath,
    config.prefillHeaderName,
    FORM1_PREFILL_SECRET,
    { token },
  ), dependencies);
  return { issued, prefilled };
}

function runForm2Authorization(intakeSubmissionId) {
  const existing = {
    contact: {
      id: CONTACT_ID,
      Modified_Time: '2026-08-22T06:30:00-05:00',
      Account_Name: { id: ACCOUNT_ID, name: 'Synthetic Plumbing A' },
      Email: 'casey@example.invalid',
      Mobile: '+15550102000',
    },
    account: {
      id: ACCOUNT_ID,
      Modified_Time: '2026-08-22T06:30:00-05:00',
      Primary_Contact: { id: CONTACT_ID, name: 'Casey Tester' },
      Field_Team_Size_Band: 'Synthetic Approved Band',
    },
    deal: {
      id: DEAL_ID,
      Modified_Time: '2026-08-22T06:30:00-05:00',
      Account_Name: { id: ACCOUNT_ID, name: 'Synthetic Plumbing A' },
      Contact_Name: { id: CONTACT_ID, name: 'Casey Tester' },
      Current_Call_Handling: 'Office Staff / Dispatcher',
      Requested_Test_Route: 'After Hours Only',
      Approved_Test_Route: 'After Hours Only',
      Intake_Submission_ID: intakeSubmissionId,
    },
  };
  const payload = {
    firstName: 'Casey',
    lastName: 'Tester',
    decisionMakerRole: 'Owner / Founder',
    jobTitle: 'Owner',
    decisionAuthority: 'Authorized Signer',
    businessEmail: 'casey@example.invalid',
    directMobileNumber: '+15550102000',
    companyName: 'Synthetic Plumbing A',
    legalBusinessName: 'Synthetic Plumbing A LLC',
    mainBusinessNumber: '+15550102100',
    phoneSystemProvider: 'Synthetic PBX',
    primaryServiceArea: 'Synthetic County',
    normalBusinessHours: 'Monday-Friday 08:00-17:00 America/Chicago',
    fieldTeamSizeBand: 'Synthetic Approved Band',
    servicesHandled: ['Water Heaters'],
    otherServiceDetails: null,
    currentCallHandling: 'Office Staff / Dispatcher',
    requestedTestRoute: 'After Hours Only',
    approvedTestRoute: 'After Hours Only',
    requestedStartDate: '2026-08-22',
    noAnswerDelay: null,
    forwardingAdministratorName: 'Synthetic Administrator',
    forwardingAdministratorMobile: '+15550102300',
    approvedFallbackDestination: 'Voicemail',
    approvedFallbackNumber: null,
    rollbackContactName: 'Synthetic Rollback Contact',
    rollbackContactMobile: '+15550102500',
    urgentCallHandling: 'Alert + Capture Callback',
    existingCustomerCallHandling: 'Capture Callback Only',
    alertRecipientName: 'Synthetic Alert Recipient',
    alertRecipientEmail: 'alerts@example.invalid',
    authorizedRepresentativeConfirmed: true,
    testScopeAccepted: true,
  };
  const updates = validateForm2Payload(payload, {
    existing,
    trustedNow: '2026-08-22T12:00:00.000Z',
    setupFormVersion: 'synthetic-form2-v1',
    submissionId: 'synthetic-form2-submission-0001',
    setupAccessSubmittedStatus: 'Synthetic Submitted',
    allowedPhoneSystemProviders: ['Synthetic PBX'],
  });
  return { existing, payload, updates };
}

function workerContext() {
  return {
    succeeded: 0,
    failed: 0,
    closeWithSuccess() { this.succeeded += 1; },
    closeWithFailure() { this.failed += 1; },
  };
}

function analyticsEnvironment() {
  const tableNames = {
    deployment: 'RevenueDeskAnalyticsDeploymentFacts',
    call: 'RevenueDeskAnalyticsCallFacts',
    daily_metric: 'RevenueDeskAnalyticsDailyMetricFacts',
    final_test_result: 'RevenueDeskAnalyticsFinalTestResultFacts',
    conversion_status: 'RevenueDeskAnalyticsConversionStatusFacts',
  };
  const targets = Object.fromEntries(Object.entries(tableNames)
    .map(([recordType, table], index) => [recordType, {
      table, view_id: String(700000 + index),
    }]));
  return {
    DEPLOYMENT_ENVIRONMENT: 'development',
    X_ZOHO_CATALYST_ENVIRONMENT: 'Development',
    SOURCE_REVISION,
    ANALYTICS_SYNC_MODE: 'active',
    EXPECTED_CATALYST_PROJECT_ID: 'synthetic-development-project',
    ANALYTICS_JOB_POOL_ID: 'synthetic-analytics-pool',
    ANALYTICS_CHECKPOINT_TABLE: 'AnalyticsSyncCheckpoints',
    ANALYTICS_OUTBOX_TABLE: 'AnalyticsSyncOutbox',
    ANALYTICS_READ_CONNECTION_LINK_NAME: 'SyntheticAnalyticsRead',
    ANALYTICS_WRITE_CONNECTION_LINK_NAME: 'SyntheticAnalyticsWrite',
    ANALYTICS_ORGANIZATION_ID: '700001',
    ANALYTICS_WORKSPACE_ID: '700002',
    ANALYTICS_API_BASE_URL: 'https://analyticsapi.zoho.com',
    ANALYTICS_TARGETS_JSON: JSON.stringify(targets),
    ANALYTICS_MIGRATION_EVIDENCE_DIGEST: '7'.repeat(64),
  };
}

function analyticsJob(environment) {
  return {
    getProjectDetails: () => ({ id: environment.EXPECTED_CATALYST_PROJECT_ID }),
    getJobPoolDetails: () => ({
      id: environment.ANALYTICS_JOB_POOL_ID,
      name: 'RevenueDeskAnalyticsJobs',
      type: 'Function',
    }),
    getAllJobParams: () => ({}),
  };
}

test('synthetic Development lifecycle crosses all six release boundaries at one revision', async () => {
  const development = releaseFixture('Development');
  assert.equal(verifyReadback(development.manifest, development.readback, contract), true);
  assert.equal(development.manifest.mode, 'synthetic-only');
  assert.deepEqual(development.manifest.functions.map(({ name }) => name), [
    'revenue_leak_test_request_form',
    'revenue_leak_test_setup_form',
    'revenue_desk_call_gateway',
    'revenue_desk_call_worker',
    'crm_billing_orchestrator',
    'analytics_sync',
  ]);
  assert.equal(new Set(development.manifest.functions.map(
    ({ source_revision: revision }) => revision,
  )).size, 1);
  assert.equal(development.manifest.functions[0].source_revision, SOURCE_REVISION);
  assert.deepEqual(development.manifest.job_pools, [
    'RevenueDeskCallJobs', 'RevenueDeskAnalyticsJobs',
  ]);
  assert.deepEqual(development.manifest.tables, [
    'RevenueDeskDeployments',
    'RevenueDeskConfigurationVersions',
    'RevenueDeskEventReceipts',
    'RevenueDeskCalls',
    'RevenueDeskNotifications',
    'RevenueLeakTestRequestFormSessions',
    'Form2SessionsV3Runtime',
    'Form2PrefillsV3',
    'Form2SubmissionsV3',
    'Form2VerificationProofsV3',
    'CRMBillingOperations',
    'AnalyticsSyncCheckpoints',
    'AnalyticsSyncOutbox',
  ]);

  const form1 = await runForm1Request();
  assert.equal(form1.issued.status, 201);
  assert.equal(form1.prefilled.status, 200);
  assert.equal(form1.prefilled.body.company, 'Synthetic Plumbing A');
  assert.match(form1.prefilled.body.intake_submission_id, /^f1a_[0-9a-f-]{36}$/);

  const form2 = runForm2Authorization(form1.prefilled.body.intake_submission_id);
  assert.equal(form2.updates.accountUpdate.Account_Name, 'Synthetic Plumbing A');
  assert.equal(form2.updates.dealUpdate.Authorized_Representative_Confirmed, true);
  assert.equal(form2.updates.dealUpdate.Test_Scope_Accepted, true);
  assert.equal(Object.hasOwn(form2.updates.dealUpdate, 'Go_Live_Approval_Status'), false);
  assert.equal(Object.values(form2.payload).some(
    (value) => typeof value === 'string' && /transfer/i.test(value),
  ), false);

  const configuredRuntime = runtimeConfiguration('A');
  assert.equal(configuredRuntime.companyName, form2.updates.accountUpdate.Account_Name);
  assert.equal(configuredRuntime.crmDealId, form2.existing.deal.id);
  assert.equal(configuredRuntime.coverageMode, 'AfterHoursOnly');
  assert.equal(form2.existing.deal.Approved_Test_Route, 'After Hours Only');

  const runtime = runtimeFixture();
  const inbound = await invoke(runtime.listener, {
    url: '/retell/inbound',
    payload: payloadInbound('A'),
    env: runtime.env,
    processJobs: false,
  });
  assert.equal(inbound.status, 200);
  assert.equal(inbound.body.call_inbound.metadata.deployment_id, 'deployment_A');
  assert.equal(JSON.stringify(inbound.body).toLowerCase().includes('transfer'), false);

  const analyzed = eventPayload(
    'call_analyzed',
    'synthetic_release_lifecycle_call',
    inbound.body.call_inbound.metadata,
    'A',
    { bookable_opportunity: true, office_follow_up_required: true },
  );
  const accepted = await invoke(runtime.listener, {
    url: '/retell/events',
    payload: analyzed,
    env: runtime.env,
    processJobs: false,
  });
  assert.equal(accepted.status, 200);
  assert.equal(runtime.jobQueue.length, 1);

  const worker = createWorkerJobHandler({
    catalystSdk: runtime.catalystSdk,
    environment: runtime.env,
    artifactSourceRevision: SOURCE_REVISION,
    now: () => runtime.clock.value,
    storeFactory: () => runtime.store,
    dispatcherFactory: () => ({
      async dispatch() { assert.fail('offline lifecycle must not dispatch a network request'); },
    }),
  });
  const processContext = workerContext();
  const processed = await worker(
    retryJobRequest(runtime.env, runtime.jobQueue.shift()),
    processContext,
  );
  assert.equal(processed.status, 'Completed');
  assert.deepEqual([processContext.succeeded, processContext.failed], [1, 0]);
  assert.equal(runtime.store.rows.get('RevenueDeskCalls').length, 1);
  assert.equal(runtime.store.rows.get('RevenueDeskNotifications')[0].STATUS, 'DryRunRecorded');

  runtime.clock.value = Date.parse('2026-08-27T12:00:01.000Z');
  const reportContext = workerContext();
  const rebuilt = await worker(retryJobRequest(runtime.env, {
    mode: 'rebuild_report',
    deployment_id: 'deployment_A',
  }), reportContext);
  assert.equal(rebuilt.status, 'ReportRebuilt');
  assert.equal(rebuilt.terminalSettlementReady, true);
  assert.deepEqual([reportContext.succeeded, reportContext.failed], [1, 0]);

  const operations = runtime.store.rows.get('CRMBillingOperations');
  assert.equal(operations.length, 1);
  const operation = operations[0];
  assert.equal(operation.SOURCE_REVISION, SOURCE_REVISION);
  const crmConfig = {
    analyticsPartitionSecret: runtime.config.analyticsPartitionSecret,
    deploymentEnvironment: 'development',
    testCompletedStatusValue: 'Completed',
  };
  const verifiedOperation = validateReportOperation(crmConfig, operation, DEAL_ID);
  const summary = parseReportSummary(operation.OPERATION_PAYLOAD_JSON);
  assert.deepEqual(verifiedOperation.summary, summary);
  const crmAction = validateCrmAction({
    schemaVersion: SCHEMA_VERSION,
    action: 'sync_report_summary',
    dealId: DEAL_ID,
    operationKey: operation.OPERATION_KEY,
  });
  assert.equal(crmAction.action, 'sync_report_summary');
  const crmPatch = reportSummaryPatch(crmConfig, summary);
  assert.equal(crmPatch.Test_Status, 'Completed');
  assert.equal(Object.hasOwn(crmPatch, 'Stage'), false);
  assert.equal(Object.hasOwn(crmPatch, 'Billing_Subscription_ID'), false);

  const runtimeOutbox = runtime.store.rows.get('AnalyticsSyncOutbox');
  const callRow = runtimeOutbox.find((row) => row.RECORD_TYPE === 'call');
  assert.ok(callRow);
  const parsedCall = parseOutboxRow(callRow, 'development');
  assert.equal(parsedCall.SOURCE_REVISION, SOURCE_REVISION);
  const expectedTarget = targetRow(parsedCall);
  const analyticsStore = new MemoryStore([callRow]);
  const analyticsEnv = analyticsEnvironment();
  let analyticsNow = Date.parse(callRow.NEXT_ATTEMPT_AT);
  let submittedRows = [];
  const adapter = {
    async submitBatch(recordType, rows) {
      assert.equal(recordType, 'call');
      submittedRows = rows;
      return { jobId: '700101' };
    },
    async pollImport() {
      return { state: 'complete', totalRows: 1, acceptedRows: 1, rejectedRows: 0 };
    },
    async startReadback(recordType, rows) {
      assert.equal(recordType, 'call');
      assert.deepEqual(rows, submittedRows);
      return { jobId: '700102' };
    },
    async pollReadback() {
      return { state: 'complete', rows: [{
        RECORD_KEY: expectedTarget.RECORD_KEY,
        CLIENT_KEY: expectedTarget.CLIENT_KEY,
        DEPLOYMENT_KEY: expectedTarget.DEPLOYMENT_KEY,
        ENVIRONMENT: expectedTarget.ENVIRONMENT,
        PAYLOAD_HASH: expectedTarget.PAYLOAD_HASH,
        SOURCE_MODIFIED_AT: expectedTarget.SOURCE_MODIFIED_AT,
      }] };
    },
  };
  let connectionAccesses = 0;
  const analyticsHandler = createAnalyticsSyncJobHandler({
    environment: analyticsEnv,
    artifactSourceRevision: SOURCE_REVISION,
    now: () => analyticsNow,
    randomBytes: (size) => Buffer.alloc(size, 6),
    catalystSdk: { initialize() {
      return { connections() {
        connectionAccesses += 1;
        throw new Error('offline lifecycle must not read a live Connection');
      } };
    } },
    storeFactory: () => analyticsStore,
    clientFactory: () => adapter,
  });
  const runAnalytics = async () => analyticsHandler(
    analyticsJob(analyticsEnv),
    workerContext(),
  );
  assert.equal((await runAnalytics()).state, 'Submitted');
  analyticsNow += 30_000;
  assert.equal((await runAnalytics()).state, 'ReadbackSubmitted');
  analyticsNow += 30_000;
  assert.equal((await runAnalytics()).state, 'CheckpointPending');
  assert.equal((await runAnalytics()).state, 'Succeeded');
  assert.equal(connectionAccesses, 0);
  assert.equal(analyticsStore.rows.find((row) => row.RECORD_TYPE === 'call').SYNC_STATUS,
    'Succeeded');
  assert.equal(analyticsStore.checkpoints.size, 1);
  assert.equal(analyticsStore.rows.filter((row) => row.RECORD_TYPE === 'daily_metric').length, 1);
});

test('Production remains dark and the release preserves the no-transfer boundary', () => {
  const production = releaseFixture('Production');
  assert.equal(verifyReadback(production.manifest, production.readback, contract), true);
  assert.equal(production.manifest.mode, 'dark');
  assert.deepEqual(production.manifest.production_invariants, {
    traffic_enabled: false,
    routes_active: false,
    schedules_active: false,
    retell_bindings_active: false,
    legacy_retell_assets_callable: false,
  });
  assert.equal(
    productContract.staged_cleanup
      .dark_production_may_precede_retell_bound_development_cleanup,
    true,
  );
  assert.equal(
    productContract.staged_cleanup
      .delete_retell_bound_legacy_assets_before_retell_testing_or_traffic,
    true,
  );
  assert.equal(
    productContract.production_scope
      .retell_bound_development_assets_may_remain_quarantined,
    true,
  );
  assert.equal(shadowQaContract.capability_boundary.transfer, false);
  assert.equal(nonurgentContract.capability_boundary.transfers, false);
  assert.equal(shadowQaContract.post_call_definitions.find(
    ({ key }) => key === 'transfer_attempted',
  ).required_value, false);
  assert.equal(shadowQaContract.post_call_definitions.find(
    ({ key }) => key === 'transfer_result',
  ).required_value, 'not_enabled');
});
