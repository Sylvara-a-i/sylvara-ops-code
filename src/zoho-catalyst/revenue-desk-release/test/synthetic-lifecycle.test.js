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
const { loadConfig: loadForm1Config } = require(fromCatalyst(
  'revenue-leak-test-request-form', 'functions', 'revenue_leak_test_request_form',
  'lib', 'config',
));
const { createSessionStore: createForm1SessionStore } = require(fromCatalyst(
  'revenue-leak-test-request-form', 'functions', 'revenue_leak_test_request_form',
  'lib', 'session-store',
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
const FORM1_SUBMISSION_SECRET = 's'.repeat(43);
const FORM1_CRM_READ_LINK = 'syntheticfixturevalue123456789';
const FORM1_CRM_WRITE_LINK = 'syntheticbillingsecret1234';
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

function form1Request(url, headerName, headerValue, body) {
  return {
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/json',
      ...(headerName ? { [headerName]: headerValue } : {}),
    },
    rawBody: Buffer.from(JSON.stringify(body), 'utf8'),
  };
}

function form1Config() {
  const projectId = '100000000000001';
  return loadForm1Config({
    DEPLOYMENT_ENVIRONMENT: 'development',
    DEPLOYMENT_MODE: 'active',
    EXPECTED_CATALYST_PROJECT_ID_SHA256: digest(projectId),
    CRM_ORGANIZATION_ID_SHA256: '2'.repeat(64),
    SOURCE_REVISION,
    ISSUE_PATH: '/form1/issue-test',
    ACCESS_PATH: '/form1/access-test',
    EXCHANGE_PATH: '/form1/exchange-test',
    PREFILL_PATH: '/form1/prefill-test',
    SUBMISSION_PATH: '/form1/submission-test',
    ISSUE_HEADER_NAME: 'x-synthetic-form1-issue',
    PREFILL_HEADER_NAME: 'x-synthetic-form1-prefill',
    SUBMISSION_HEADER_NAME: 'x-synthetic-form1-submission',
    ISSUE_HEADER_SECRET: FORM1_ISSUE_SECRET,
    PREFILL_HEADER_SECRET: FORM1_PREFILL_SECRET,
    SUBMISSION_HEADER_SECRET: FORM1_SUBMISSION_SECRET,
    TOKEN_PEPPER: 't'.repeat(43),
    PREFILL_HANDLE_PEPPER: 'h'.repeat(43),
    ISSUING_ACTOR_HASH: `operator_${'3'.repeat(64)}`,
    FORM1_PUBLIC_URL: 'https://forms.zohopublic.com/example/form/Request/formperma/example',
    FORM1_ACCESS_PUBLIC_URL: 'https://synthetic.development.catalystserverless.com/form1/access-test',
    FORM1_PREFILL_HANDLE_FIELD_ALIAS: 'AssistedPrefillHandle',
    CRM_READ_CONNECTION_LINK_NAME: FORM1_CRM_READ_LINK,
    CRM_WRITE_CONNECTION_LINK_NAME: FORM1_CRM_WRITE_LINK,
    FORM1_ENTRY_OFFER_VALUE: 'Free 7-Day Missed-Call',
    FORM1_INTAKE_FORM_VERSION: 'revenue-leak-test-request-v1',
    FORM1_LEAD_STATUS_VALUE: 'Free Test Requested',
    FORM1_SOURCE_PAGE_VALUE: 'crm-assisted-form1',
    FORM1_SUBMISSION_CHANNEL_VALUE: 'CRM Assisted',
  }, SOURCE_REVISION);
}

function form1MemoryAdapter() {
  const rows = [];
  return {
    rows,
    async findRowsByJourneyId(_table, value) {
      return rows.filter((row) => row.INTAKE_SUBMISSION_ID === value).map((row) => ({ ...row }));
    },
    async findRowsByRowId(_table, value) {
      return rows.filter((row) => row.ROWID === String(value)).map((row) => ({ ...row }));
    },
    async findRowsByTokenHash(_table, value) {
      return rows.filter((row) => row.TOKEN_HASH === value).map((row) => ({ ...row }));
    },
    async findRowsByPrefillHandleHash(_table, value) {
      return rows.filter((row) => row.PREFILL_HANDLE_HASH === value)
        .map((row) => ({ ...row }));
    },
    async findRowsByPrefillId(_table, value) {
      return rows.filter((row) => row.PREFILL_ID === value).map((row) => ({ ...row }));
    },
    async insertRow(_table, row) { rows.push({ ROWID: String(rows.length + 1), ...row }); },
    async updateRow(_table, update, expected) {
      const row = rows.find((candidate) => candidate.ROWID === String(update.ROWID));
      if (!row || Object.entries(expected).some(([key, value]) =>
        (typeof value === 'number' ? Number(row[key]) !== value : row[key] !== value))) return [];
      Object.assign(row, Object.fromEntries(
        Object.entries(update).filter(([key]) => key !== 'ROWID'),
      ));
      return [];
    },
  };
}

function syntheticForm1Data() {
  return {
    firstName: 'ZZZ', lastName: 'Synthetic', company: 'ZZZ SYNTHETIC Plumbing',
    decisionMakerRole: 'Owner', jobTitle: '', email: 'synthetic@example.invalid',
    mobilePhone: '+15555550101', companyPhone: '+15555550102',
    currentCallHandling: 'Voicemail', preferredTestRoute: 'After Hours',
    phoneSystemProvider: 'Synthetic Provider', primaryServiceArea: 'ZZZ SYNTHETIC',
    fieldTeamSizeBand: '1-5', additionalNotes: '', contactConsent: true,
    leadSource: 'Other', sourcePage: '', utmSource: 'synthetic', utmMedium: '',
    utmCampaign: '', utmTerm: '', utmContent: '',
  };
}

async function runForm1AssistedJourney() {
  const config = form1Config();
  const adapter = form1MemoryAdapter();
  const recordId = '4000000001';
  const journeyId = 'journey_synthetic_release_001';
  const record = {
    id: recordId,
    Modified_Time: '2026-08-29T11:59:00.000Z',
    Intake_Submission_ID: journeyId,
  };
  let entropy = 1;
  let uuidSequence = 1;
  const randomBytes = (size) => Buffer.alloc(size, entropy++);
  const randomUUID = () =>
    `00000000-0000-4000-8000-${String(uuidSequence++).padStart(12, '0')}`;
  const dependencies = {
    config,
    now: () => Date.parse('2026-08-29T12:00:00.000Z'),
    randomBytes,
    randomUUID,
    crmClient: {
      async getRecord(_module, selectedId) {
        assert.equal(selectedId, recordId);
        return { ...record };
      },
      async getOrInitializeJourney(_module, selectedId) {
        assert.equal(selectedId, recordId);
        return { record: { ...record }, journeyId, initialized: false };
      },
      assertJourney(selected, selectedJourney) {
        assert.equal(selected.Intake_Submission_ID, selectedJourney);
      },
      recordVersion(selected) {
        return selected.Modified_Time;
      },
      recordMatches(selected, patch) {
        return Object.entries(patch).every(([field, value]) => selected[field] === value);
      },
      async completeAssistedSubmission(_module, selected, patch, expectedRecordVersion) {
        assert.equal(selected.id, recordId);
        assert.equal(selected.Modified_Time, expectedRecordVersion);
        Object.assign(record, patch);
        return { record: { ...record }, replayed: false };
      },
    },
  };
  dependencies.sessionStore = createForm1SessionStore(adapter, config, {
    now: dependencies.now,
    randomUUID,
  });
  const issue = await handleForm1(form1Request(
    config.issuePath, config.issueHeaderName, FORM1_ISSUE_SECRET,
    { crmModule: 'Leads', recordId },
  ), dependencies);
  const issuedUrl = new URL(issue.body.accessUrl);
  assert.equal(issuedUrl.search, '');
  assert.deepEqual([...new URLSearchParams(issuedUrl.hash.slice(1)).keys()], ['journeyToken']);
  const journeyToken = new URLSearchParams(issuedUrl.hash.slice(1)).get('journeyToken');
  const access = await handleForm1({
    method: 'GET',
    url: config.accessPath,
    headers: {},
    rawBody: Buffer.alloc(0),
  }, dependencies);
  assert.equal(access.status, 200);
  assert.equal(access.headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(access.body.includes(journeyToken), false);
  assert.equal(access.body.includes(recordId), false);
  const exchanged = await handleForm1(form1Request(
    config.exchangePath, null, null, { journeyToken },
  ), dependencies);
  const formUrl = new URL(exchanged.body.formUrl);
  assert.deepEqual([...formUrl.searchParams.keys()], [config.form1PrefillHandleFieldAlias]);
  const prefillHandle = formUrl.searchParams.get(config.form1PrefillHandleFieldAlias);
  assert.notEqual(prefillHandle, journeyToken);
  assert.equal(exchanged.body.formUrl.includes(journeyToken), false);
  const prefill = await handleForm1(form1Request(
    config.prefillPath, config.prefillHeaderName, FORM1_PREFILL_SECRET,
    { prefillHandle },
  ), dependencies);
  await assert.rejects(
    () => handleForm1(form1Request(
      config.prefillPath, config.prefillHeaderName, FORM1_PREFILL_SECRET,
      { prefillHandle },
    ), dependencies),
    (error) => error.status === 404 && error.publicCode === 'session_not_found',
  );
  const submission = await handleForm1(form1Request(
    config.submissionPath, config.submissionHeaderName, FORM1_SUBMISSION_SECRET,
    {
      prefillId: prefill.body.prefillId,
      configurationRevision: prefill.body.configurationRevision,
      submissionId: 'form1_submission_synthetic_001',
      formData: syntheticForm1Data(),
    },
  ), dependencies);
  const publicSubmission = await handleForm1(form1Request(
    config.submissionPath, config.submissionHeaderName, FORM1_SUBMISSION_SECRET,
    { submissionId: 'form1_public_submission_synthetic_001' },
  ), dependencies);
  return {
    access,
    adapter,
    formUrl,
    issue,
    issuedUrl,
    journeyToken,
    prefill,
    prefillHandle,
    publicSubmission,
    record,
    submission,
  };
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

test('Form 1 assisted issue, prefill, submission, and public lane remain isolated', async () => {
  const form1 = await runForm1AssistedJourney();
  assert.equal(form1.issue.status, 201);
  assert.match(form1.journeyToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(form1.prefillHandle, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual([...form1.formUrl.searchParams.keys()], ['AssistedPrefillHandle']);
  assert.equal(form1.issue.body.accessUrl.includes(form1.record.id), false);
  assert.equal(form1.adapter.rows.length, 1);
  assert.equal(JSON.stringify(form1.adapter.rows[0]).includes(form1.journeyToken), false);
  assert.equal(JSON.stringify(form1.adapter.rows[0]).includes(form1.prefillHandle), false);
  assert.match(form1.adapter.rows[0].TOKEN_HASH, /^[a-f0-9]{64}$/);
  assert.match(form1.adapter.rows[0].PREFILL_HANDLE_HASH, /^[a-f0-9]{64}$/);
  assert.equal(form1.adapter.rows[0].PREFILL_COUNT, 1);
  assert.match(form1.prefill.body.prefillId, /^[0-9a-f-]{36}$/);
  assert.equal(form1.prefill.body.configurationRevision, SOURCE_REVISION);
  assert.equal(Object.hasOwn(form1.prefill.body, 'contactConsent'), false);
  assert.deepEqual(form1.submission.body, { ok: true, replayed: false });
  assert.equal(form1.adapter.rows[0].STATUS, 'consumed');
  assert.equal(form1.record.Submission_Channel, 'CRM Assisted');
  assert.deepEqual(form1.publicSubmission.body, { ok: true, binding: 'public_unbound' });
  assert.equal(form1.adapter.rows.length, 1);
});

test('synthetic Development lifecycle covers the bound Form 1 journey through Analytics', async () => {
  const development = releaseFixture('Development');
  assert.equal(verifyReadback(development.manifest, development.readback, contract), true);
  assert.equal(development.manifest.mode, 'synthetic-only');
  assert.deepEqual(development.manifest.functions.map(({ name }) => name), [
    'revenue_leak_test_request_form',
    'revenue_leak_test_setup_form',
    'revenue_desk_call_gateway',
    'revenue_desk_call_worker',
    'revenue_desk_route_control',
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

  // Controlled conversion remains a CRM-owned human transition. This fixture
  // uses the same canonical journey identity produced by the assisted Form 1
  // boundary without claiming a live CRM Blueprint execution.
  const independentSyntheticIntakeId = 'SYNTH00001';
  const form2 = runForm2Authorization(independentSyntheticIntakeId);
  assert.equal(form2.existing.deal.Intake_Submission_ID, independentSyntheticIntakeId);
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
