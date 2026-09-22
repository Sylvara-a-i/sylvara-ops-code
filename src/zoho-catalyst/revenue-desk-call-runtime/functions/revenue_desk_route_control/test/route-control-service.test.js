'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { routeFingerprint, routeFromRows, evaluateApprovalTransition,
  evaluateActivationTransition, approvalIntentSignature, activationIntentSignature,
  authorizationReceiptRow }
  = require('revenue_desk_call_gateway/lib/approval-control');
const {
  createRouteControlService,
  ROLLBACK_REASON_TO_CRM,
  verifyDeploymentPoststate,
}
  = require('revenue_desk_call_gateway/lib/route-control-service');
const { RevenueDeskError }
  = require('revenue_desk_call_gateway/lib/errors');
const { numberLookupKey, keyedDigest }
  = require('revenue_desk_call_gateway/lib/security');
const { authorizationReceiptFingerprint }
  = require('revenue_desk_call_gateway/lib/authorization-receipt');
const { activeAt, loadDeployment }
  = require('revenue_desk_call_gateway/lib/runtime-service');
const { providerTimingFixture }
  = require('../../revenue_desk_call_gateway/test/provider-timing-fixture');

const SOURCE_REVISION = 'a'.repeat(40);
const NOW = Date.parse('2026-08-29T12:10:00.000Z');
const EVENT_CHAIN_SECRET = 'e'.repeat(32);
const IDS = Object.freeze({
  deal: '400000001', journey: 'journey_synthetic', deployment: 'deployment_synthetic',
  configuration: 'configuration_version_synthetic_v1',
});
const KEYS = Object.freeze({
  approve: '00000000-0000-4000-8000-000000000001',
  activate: '00000000-0000-4000-8000-000000000002',
  rollback: '00000000-0000-4000-8000-000000000003',
});

function configuration() {
  return {
    clientId: 'client_synthetic', crmDealId: IDS.deal,
    deploymentId: IDS.deployment, configurationVersion: IDS.configuration,
    approved: true, companyName: 'ZZZ SYNTHETIC Plumbing',
    companyDescription: 'Synthetic contractor.',
    businessHours: 'Monday-Friday 08:00-17:00 America/Chicago',
    coverageMode: 'AfterHoursOnly', servicesHandled: ['Water Heaters'],
    unsupportedServices: ['Septic Pumping'],
    serviceArea: { cities: ['Lenexa'], zips: ['66215'] },
    urgentConditions: ['active uncontrolled leak'],
    callbackExpectation: 'No appointment or dispatch is confirmed.',
    notificationRecipient: {
      recipientId: 'recipient_synthetic', approved: true,
      name: 'ZZZ SYNTHETIC Alert Recipient', channel: 'email',
      email: 'alerts@example.invalid', mobile: null,
    },
    notificationHandoff: { schemaVersion: 1, timeZone: 'America/Chicago', channel: 'email',
      recipientId: 'recipient_synthetic', monitored: true,
      acknowledgedAt: '2026-08-29T12:00:00.000Z', acknowledgmentReference: 'synthetic_monitoring_v1' },
    phoneSystemProvider: 'Synthetic PBX', approvedTestRoute: 'After Hours Only',
    noAnswerDelay: null,
    forwardingAdministratorName: 'ZZZ SYNTHETIC Administrator',
    forwardingAdministratorMobile: '+15550100101',
    approvedFallbackDestination: 'On-Call Mobile',
    approvedFallbackNumber: '+15550100102',
    rollbackContactName: 'ZZZ SYNTHETIC Rollback Contact',
    rollbackContactMobile: '+15550100103',
    rollbackInstructions: 'Restore the prior synthetic forwarding route.',
    rollbackInstructionsVersion: 'synthetic_provider_v1',
    authorizedRepresentativeConfirmed: true, testScopeAccepted: true,
    authorityConfirmedAt: '2026-08-29T12:00:00.000Z',
    setupFormSubmissionId: 'setup_submission_synthetic', setupFormVersion: 'form2_v1',
  };
}

function deployment() {
  return {
    ROWID: '101', DEPLOYMENT_KEY: 'deployment_key_synthetic',
    NUMBER_LOOKUP_HASH: numberLookupKey('n'.repeat(32), '+15550100104'),
    BINDING_ID: 'binding_synthetic',
    BINDING_VERSION: 2, CLIENT_ID: 'client_synthetic', DEPLOYMENT_ID: IDS.deployment,
    ACTIVE_CONFIGURATION_VERSION_ID: IDS.configuration,
    APPROVED_CONFIGURATION_VERSION_ID: null, APPROVAL_EVENT_KEY: null,
    APPROVED_ROUTE_FINGERPRINT: null, GO_LIVE_APPROVED_AT: null,
    ACTIVATION_EVENT_KEY: null, MONITOR_AGENT_ID: 'agent_synthetic',
    MONITOR_AGENT_VERSION: 7, COVERAGE_MODE: 'AfterHoursOnly',
    TEST_STATUS: 'Ready for Approval',
    GO_LIVE_APPROVAL_STATUS: 'Pending Internal Approval',
    APPROVED_START_AT: '2026-08-30T12:00:00.000Z', ACTUAL_START_AT: null,
    EXPIRES_AT: null, CALL_LIMIT: 25, HANDLED_COUNT: 0, COUNT_VERSION: 0,
    COUNTED_CALL_KEYS_JSON: '[]', STOP_REASON: null, STOPPED_AT: null,
    REPORT_RECONCILIATION_STATUS: 'NotRequired', REPORT_RECONCILIATION_VERSION: 0,
    SOURCE_REVISION, SOURCE_ENVIRONMENT: 'development',
    UPDATED_AT: '2026-08-29T12:00:00.000Z',
  };
}

function configurationRow(overrides = {}) {
  return {
    ROWID: '202', CONFIGURATION_VERSION_ID: IDS.configuration,
    DEPLOYMENT_ID: IDS.deployment, CONFIGURATION_VERSION: IDS.configuration,
    CONFIGURATION_JSON: JSON.stringify(configuration()), ENGAGEMENT_TYPE: 'free_test',
    CAPABILITY_PROFILE: 'call_gap_monitor_v1', PLAN_TIER: 'none',
    DEPLOYMENT_STATUS: 'Live', GO_LIVE_APPROVAL_STATUS: 'Approved',
    LIMIT_POLICY: 'seven_calendar_days_or_25_connected_calls_v1',
    BILLING_MODE: 'none', NUMBER_OWNERSHIP: 'dedicated_deployment',
    ENVIRONMENT: 'development', STATUS: 'Active', APPROVAL_STATUS: 'Approved',
    SOURCE_REVISION, SOURCE_ENVIRONMENT: 'development',
    CREATED_AT: '2026-08-29T12:00:00.000Z', ACTIVATED_AT: null,
    ...overrides,
  };
}

function deal() {
  return {
    id: IDS.deal, Modified_Time: '2026-08-29T07:00:00-05:00',
    Pipeline: 'Revenue Desk Sales', Stage: 'Setup and QA',
    Entry_Offer: 'Free 7-Day Missed-Call', Intake_Submission_ID: IDS.journey,
    Account_Name: { id: '400000002' }, Contact_Name: { id: '400000003' },
    Setup_Access_Status: 'Submitted', Setup_Access_Verified_At: '2026-08-29T12:02:00Z',
    Setup_Form_Submission_ID: 'setup_submission_synthetic',
    Setup_Form_Version: 'form2_v1', Setup_Form_Submitted_At: '2026-08-29T12:01:00Z',
    Authorized_Representative_Confirmed: true, Test_Scope_Accepted: true,
    Authority_Confirmed_At: '2026-08-29T12:00:00Z',
    Test_Scope_Accepted_At: '2026-08-29T12:00:00Z',
    Approved_Test_Route: 'After-Hours', No_Answer_Delay: null,
    Forwarding_Administrator_Name: 'ZZZ SYNTHETIC Administrator',
    Forwarding_Administrator_Mobile: '+15550100101',
    Approved_Fallback_Destination: 'On-Call Mobile',
    Approved_Fallback_Number: '+15550100102',
    Rollback_Contact_Name: 'ZZZ SYNTHETIC Rollback Contact',
    Rollback_Contact_Mobile: '+15550100103',
    Alert_Recipient_Name: 'ZZZ SYNTHETIC Alert Recipient',
    Alert_Recipient_Email: 'alerts@example.invalid', Alert_Recipient_Mobile: null,
    Urgent_Call_Handling: 'Alert + Capture Callback',
    Existing_Customer_Call_Handling: 'Alert + Capture Callback',
    Test_Phone_Number: '+15550100104',
    Deployment_Record_ID: IDS.deployment, Configuration_Version: IDS.configuration,
    Test_Status: 'Setup Pending', Go_Live_Approval_Status: 'Not Ready',
    Go_Live_Approved_At: null, Approved_Deployment_Record_ID: null,
    Approved_Configuration_Version: null, Test_Start_At: null, Test_End_At: null,
    Test_End_Reason: null, Rollback_Completed_At: null,
    Billing_Subscription_ID: null, Reason_For_Loss__s: null,
  };
}

function copy(value) { return structuredClone(value); }

function useCatalystDeploymentBigintReadback(subject) {
  const fields = ['BINDING_VERSION', 'MONITOR_AGENT_VERSION', 'CALL_LIMIT',
    'HANDLED_COUNT', 'COUNT_VERSION', 'REPORT_RECONCILIATION_VERSION'];
  // Keep the synthetic database numeric, but return the actual Catalyst BigInt
  // representation on every fresh read, including post-CAS and exact replay.
  const storedReadback = (row) => {
    if (row?.__table === 'RevenueDeskDeployments') {
      for (const field of fields) row[field] = String(row[field]);
    }
    return row;
  };
  for (const method of ['unique', 'conditionalUpdate']) {
    const original = subject.store[method].bind(subject.store);
    subject.store[method] = async (...args) => storedReadback(await original(...args));
  }
}

test('deployment CAS readback rejects non-versioned governed drift', () => {
  const prestate = deployment();
  const patch = {
    TEST_STATUS: 'Scheduled',
    GO_LIVE_APPROVAL_STATUS: 'Approved',
    COUNT_VERSION: 1,
  };
  assert.doesNotThrow(() => verifyDeploymentPoststate(
    prestate, { ...prestate, ...patch }, patch,
  ));
  assert.throws(() => verifyDeploymentPoststate(prestate, {
    ...prestate,
    ...patch,
    ACTIVE_CONFIGURATION_VERSION_ID: 'configuration_version_conflict',
  }, patch), { code: 'CONTROL_CAS_CONFLICT' });
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

class MemoryStore {
  constructor(rows) {
    this.rows = rows.map(copy);
    this.nextRow = 900;
  }

  async unique(table, column, value) {
    const rows = this.rows.filter((row) => row.__table === table && String(row[column]) === String(value));
    assert.ok(rows.length <= 1);
    return rows[0] ? copy(rows[0]) : null;
  }

  async queryBounded(table, column, value, _order, limit, additional) {
    return this.rows.filter((row) => row.__table === table && row[column] === value
      && Object.entries(additional).every(([field, expected]) => row[field] === expected))
      .slice(0, limit).map(copy);
  }

  async insertUnique(table, keyColumn, input, immutable) {
    const existing = await this.unique(table, keyColumn, input[keyColumn]);
    if (existing) {
      for (const field of immutable) assert.deepEqual(existing[field], input[field]);
      return { row: existing, inserted: false };
    }
    const row = { ...copy(input), ROWID: String(this.nextRow++), __table: table };
    this.rows.push(row);
    return { row: copy(row), inserted: true };
  }

  async conditionalUpdate(table, rowId, patch, expected) {
    assert.ok(Object.keys(expected).length <= 4,
      'conditional updates may use at most four explicit predicates');
    const row = this.rows.find((candidate) => candidate.__table === table
      && candidate.ROWID === String(rowId));
    assert.ok(row);
    const matches = Object.entries(expected).every(([field, value]) => (
      (row[field] === undefined ? null : row[field]) === value
    ));
    if (matches) Object.assign(row, copy(patch));
    return copy(row);
  }

  async mutate(table, keyColumn, keyValue, versionColumn, mutator, attempts = 5) {
    for (let index = 0; index < attempts; index += 1) {
      const current = await this.unique(table, keyColumn, keyValue);
      assert.ok(current);
      const currentVersion = Number(current[versionColumn]);
      assert.ok(Number.isSafeInteger(currentVersion) && currentVersion >= 0);
      const patch = mutator(copy(current));
      if (patch === null) return current;
      const next = { ...copy(patch), [versionColumn]: currentVersion + 1 };
      const readback = await this.conditionalUpdate(
        table, current.ROWID, next, { [versionColumn]: currentVersion },
      );
      if (Number(readback[versionColumn]) === currentVersion + 1
        && Object.entries(next).every(([field, value]) => readback[field] === value)) {
        return readback;
      }
    }
    throw new RevenueDeskError('CATALYST_CONCURRENCY_CONFLICT',
      'synthetic mutation did not converge', { httpStatus: 503 });
  }
}

function fixture({ dealOverrides = {}, deploymentOverrides = {}, configOverrides = {},
  configurationStaging, beforeCrmApproval = async () => {},
  providerMode = 'active', failCrmActivation = false,
  ambiguousCrmActivation = false, mutateDealDuringRouteVerification = null,
  providerModeAfterFirstVerification = null, failProviderDisable = false,
  providerModeAfterSecondVerification = null,
  manualCrmClose = false,
  countBeforeCrmActivationFailure = false, onActivationCheckpoint = async () => {},
  onActivationContainmentCheckpoint = async () => {},
  onRollbackCheckpoint = async () => {} } = {}) {
  let clock = NOW;
  let currentProviderMode = providerMode;
  let providerDisableCalls = 0;
  let providerVerificationCalls = 0;
  let crmActivationCalls = 0;
  let failCrmRead = false;
  let terminalizeNextProviderVerification = false;
  const tables = {
    DEPLOYMENT_TABLE: 'RevenueDeskDeployments',
    CONFIGURATION_VERSION_TABLE: 'RevenueDeskConfigurationVersions',
    EVENT_RECEIPT_TABLE: 'RevenueDeskEventReceipts',
  };
  const store = new MemoryStore([
    { ...deployment(), ...deploymentOverrides, __table: tables.DEPLOYMENT_TABLE },
    { ...configurationRow(configOverrides), __table: tables.CONFIGURATION_VERSION_TABLE },
  ]);
  const crmState = { ...deal(), ...dealOverrides };
  const crm = {
    async getDeal() {
      if (failCrmRead) throw new RevenueDeskError('CRM_READBACK_INVALID',
        'synthetic CRM read failure', { httpStatus: 503 });
      return copy(crmState);
    },
    async recordApproval(_id, value) {
      await beforeCrmApproval(value, crmState);
      Object.assign(crmState, {
        Test_Status: 'Scheduled', Go_Live_Approval_Status: 'Approved',
        Go_Live_Approved_At: value.approvedAt,
        Approved_Deployment_Record_ID: value.deploymentId,
        Approved_Configuration_Version: value.configurationVersionId,
      });
      return copy(crmState);
    },
    async recordActivation(_id, value) {
      crmActivationCalls += 1;
      if (value.expectedDeal?.Approved_Fallback_Number
        !== crmState.Approved_Fallback_Number) {
        throw new RevenueDeskError('CRM_TRANSITION_PRECONDITION_FAILED',
          'synthetic CRM Deal drift', { httpStatus: 409 });
      }
      if (countBeforeCrmActivationFailure) {
        countBeforeCrmActivationFailure = false;
        await store.mutate(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', IDS.deployment,
          'COUNT_VERSION', (current) => ({
            COUNTED_CALL_KEYS_JSON: JSON.stringify([`call_${'f'.repeat(64)}`]),
            HANDLED_COUNT: 1,
            UPDATED_AT: new Date(clock + 1).toISOString(),
          }));
      }
      if (failCrmActivation) throw new RevenueDeskError('CRM_ACTIVATION_PROVEN_INACTIVE',
        'synthetic CRM rejection', { httpStatus: 503 });
      if (ambiguousCrmActivation) {
        throw new RevenueDeskError('CRM_ACTIVATION_RECONCILIATION_REQUIRED',
          'synthetic ambiguous CRM outcome', { httpStatus: 503, ambiguous: true });
      }
      Object.assign(crmState, { Stage: 'Test Live', Test_Status: 'Live',
        Test_Start_At: value.activatedAt });
      return copy(crmState);
    },
    async proveActivationInactive(_id, value) {
      if (crmState.Stage !== 'Setup and QA' || crmState.Test_Status !== 'Scheduled'
        || (crmState.Test_Start_At && crmState.Test_Start_At !== value.activatedAt)) {
        throw new RevenueDeskError('CRM_ACTIVATION_RECONCILIATION_REQUIRED',
          'synthetic CRM reconciliation', { httpStatus: 503, ambiguous: true });
      }
      crmState.Test_Start_At = null;
      return copy(crmState);
    },
    async containActivation(_id, value) {
      if (value.expectedDeal?.Approved_Fallback_Number
        !== crmState.Approved_Fallback_Number) {
        throw new RevenueDeskError('CRM_ACTIVATION_RECONCILIATION_REQUIRED',
          'synthetic CRM containment drift', { httpStatus: 503, ambiguous: true });
      }
      const exactInactive = crmState.Stage === 'Setup and QA'
        && crmState.Test_Status === 'Scheduled' && !crmState.Test_Start_At;
      if (exactInactive) return copy(crmState);
      if (crmState.Stage !== 'Test Live' || crmState.Test_Status !== 'Live'
        || crmState.Test_Start_At !== value.activatedAt
        || crmState.Approved_Deployment_Record_ID !== value.deploymentId
        || crmState.Approved_Configuration_Version !== value.configurationVersionId) {
        throw new RevenueDeskError('CRM_ACTIVATION_RECONCILIATION_REQUIRED',
          'synthetic CRM containment conflict', { httpStatus: 503, ambiguous: true });
      }
      Object.assign(crmState, { Stage: 'Setup and QA', Test_Status: 'Scheduled',
        Test_Start_At: null });
      return copy(crmState);
    },
    async recordRollback(_id, value) {
      if (value.routeInactive === false) return copy(crmState);
      if (manualCrmClose) {
        if (crmState.Stage === 'Closed Lost') return copy(crmState);
        Object.assign(crmState, {
          Test_End_At: value.stoppedAt,
          Test_End_Reason: value.reason,
          Rollback_Completed_At: value.stoppedAt,
        });
        return Object.freeze({
          ...copy(crmState),
          manualCloseRequired: Object.freeze({
            transitionName: crmState.Stage === 'Test Live'
              ? 'Close Live Test' : 'Close During QA',
            requiredOperatorField: 'Reason_For_Loss__s',
            rollbackStatus: 'provider_inactive_and_control_stopped',
          }),
        });
      }
      Object.assign(crmState, { Stage: 'Closed Lost', Test_Status: 'Rolled Back',
        Test_End_At: value.stoppedAt, Test_End_Reason: value.reason,
        Rollback_Completed_At: value.stoppedAt });
      return copy(crmState);
    },
  };
  const provider = {
    async verifyActiveRoute({ deployment: row, configurationVersion: version,
      routeFingerprint: fingerprint }) {
      providerVerificationCalls += 1;
      const observedMode = currentProviderMode;
      if (terminalizeNextProviderVerification) {
        terminalizeNextProviderVerification = false;
        const stoppedAt = new Date(clock).toISOString();
        await store.mutate(tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', IDS.deployment,
          'COUNT_VERSION', () => ({
            TEST_STATUS: 'Completed', STOP_REASON: 'call_limit_reached',
            STOPPED_AT: stoppedAt, REPORT_RECONCILIATION_STATUS: 'Pending',
            REPORT_RECONCILIATION_VERSION: 1, UPDATED_AT: stoppedAt,
          }));
        Object.assign(crmState, {
          Stage: 'Test Live', Test_Status: 'Completed',
          Test_End_At: stoppedAt, Test_End_Reason: 'Call Limit Reached',
        });
      }
      if (typeof mutateDealDuringRouteVerification === 'function') {
        mutateDealDuringRouteVerification(crmState);
        mutateDealDuringRouteVerification = null;
      }
      if (providerVerificationCalls === 1 && providerModeAfterFirstVerification) {
        currentProviderMode = providerModeAfterFirstVerification;
      }
      if (providerVerificationCalls === 2 && providerModeAfterSecondVerification) {
        currentProviderMode = providerModeAfterSecondVerification;
      }
      if (observedMode === 'missing') throw Object.assign(new Error('no route'),
        { code: 'ROUTE_VERIFICATION_FAILED' });
      return {
        status: 'route_active', deploymentId: row.DEPLOYMENT_ID,
        configurationVersionId: version.CONFIGURATION_VERSION_ID,
        routeFingerprint: fingerprint, readbackFingerprint: `readback_${'6'.repeat(64)}`,
        observedAt: new Date(observedMode === 'stale'
          ? clock - 3_600_001 : clock).toISOString(),
      };
    },
    async disableRoute() {
      providerDisableCalls += 1;
      if (failProviderDisable) throw Object.assign(new Error('synthetic provider failure'),
        { code: 'ROUTE_ROLLBACK_FAILED' });
      if (currentProviderMode === 'manual') {
        return { status: 'manual_rollback_required',
          instructions: 'Restore the prior synthetic forwarding route.',
          failureCode: 'ROUTE_ROLLBACK_FAILED' };
      }
      return { status: 'route_inactive', instructions: 'synthetic rollback' };
    },
  };
  const config = {
    environment: 'development', deploymentMode: 'active', sourceRevision: SOURCE_REVISION,
    operatorVerificationSecret: 'o'.repeat(32), eventChainSecret: EVENT_CHAIN_SECRET,
    operatorIdHash: `operator_${'4'.repeat(64)}`, tables,
    retellRouteMode: 'isolated_test', retellPhoneNumber: '+15550100104',
    numberSecret: 'n'.repeat(32),
  };
  const runtimeConfig = {
    environment: 'development', sourceRevision: SOURCE_REVISION,
    sharedAgentId: 'agent_synthetic', sharedAgentVersion: 7, tables,
    authorizationEventSecret: EVENT_CHAIN_SECRET,
  };
  const service = createRouteControlService({
    config, store, crm, provider, configurationStaging, now: () => clock,
    onActivationCheckpoint: (name, payload) => onActivationCheckpoint({
      name, payload, store, tables, runtimeConfig, now: clock,
    }),
    onActivationContainmentCheckpoint: (name, payload) =>
      onActivationContainmentCheckpoint({
        name, payload, store, tables, runtimeConfig, now: clock,
      }),
    onRollbackCheckpoint: (name, payload) => onRollbackCheckpoint({
      name, payload, store, tables, runtimeConfig, now: clock,
    }),
  });
  return {
    service, store, crmState, runtimeConfig,
    setClock(value) { clock = value; },
    setProviderMode(value) { currentProviderMode = value; },
    setProviderDisableFailure(value) { failProviderDisable = value; },
    setCrmReadFailure(value) { failCrmRead = value; },
    terminalizeOnNextProviderVerification() { terminalizeNextProviderVerification = true; },
    getProviderDisableCalls() { return providerDisableCalls; },
    getProviderVerificationCalls() { return providerVerificationCalls; },
    getCrmActivationCalls() { return crmActivationCalls; },
  };
}

function command(action, overrides = {}) {
  return {
    dealId: IDS.deal, journeyId: IDS.journey, deploymentId: IDS.deployment,
    configurationVersionId: IDS.configuration,
    idempotencyKey: KEYS[action],
    ...(action === 'rollback' ? { reason: 'operator_requested' } : {}),
    ...overrides,
  };
}

function coreApprovedFixture(options = {}) {
  const label = 'form2_core_approved_v1';
  const approvedAt = '2026-08-29T12:05:00.000Z';
  return fixture({
    configOverrides: { CONFIGURATION_VERSION: label,
      CONFIGURATION_JSON: JSON.stringify({ ...configuration(), configurationVersion: label }) },
    dealOverrides: { Configuration_Version: label, Test_Status: 'Scheduled',
      Go_Live_Approval_Status: 'Approved', Go_Live_Approved_At: approvedAt,
      Approved_Configuration_Version: label },
    ...options,
  });
}

test('full approval requires server-verified staging before superseding retained core approval', async () => {
  const absent = coreApprovedFixture();
  await assert.rejects(absent.service.approve(command('approve')),
    { code: 'CONTROL_PRECONDITION_FAILED' });
  assert.equal(absent.store.rows.length, 2);
  const calls = [];
  const subject = coreApprovedFixture({ configurationStaging: {
    async assertApprovalSource(value, state) {
      calls.push(value);
      assert.equal(state.deal.Approved_Configuration_Version, 'form2_core_approved_v1');
      assert.equal(state.deployment.TEST_STATUS, 'Ready for Approval');
      return { configurationStaged: true, priorCoreApproval: { configurationVersionId: 'form2_core_approved_v1',
        approvedAt: '2026-08-29T12:05:00.000Z' } };
    },
  } });
  const result = await subject.service.approve(command('approve'));
  assert.equal(calls.length, 1);
  assert.equal(result.replayed, false);
  assert.equal(subject.crmState.Approved_Configuration_Version, IDS.configuration);
  assert.equal(subject.crmState.Approved_Deployment_Record_ID, IDS.deployment);
  assert.equal(subject.crmState.Configuration_Version, 'form2_core_approved_v1');
  assert.equal(result.deployment.TEST_STATUS, 'Scheduled');
  assert.equal(result.deployment.ACTUAL_START_AT, null);
  assert.equal(result.deployment.ACTIVATION_EVENT_KEY, null);
  assert.equal(subject.getProviderVerificationCalls(), 0);
  assert.equal(subject.getProviderDisableCalls(), 0);
});

test('wrong retained approval, stopped CRM and unverified staging cannot create approval evidence', async () => {
  for (const proof of [null, {},
    { configurationVersionId: 'wrong_label', approvedAt: '2026-08-29T12:05:00.000Z' },
    { configurationVersionId: 'form2_core_approved_v1', approvedAt: '2026-08-29T12:04:00.000Z' },
  ]) {
    const subject = coreApprovedFixture({ configurationStaging: {
      async assertApprovalSource() { return { configurationStaged: true, priorCoreApproval: proof }; },
    } });
    await assert.rejects(subject.service.approve(command('approve')),
      { code: 'CONTROL_PRECONDITION_FAILED' });
    assert.equal(subject.store.rows.length, 2);
  }
  for (const patch of [{ Test_Start_At: '2026-08-29T12:06:00.000Z' },
    { Test_End_At: '2026-08-29T12:06:00.000Z' },
    { Approved_Deployment_Record_ID: 'another_deployment' }]) {
    const subject = coreApprovedFixture({ configurationStaging: {
      async assertApprovalSource() { return { configurationStaged: true,
        priorCoreApproval: { configurationVersionId: 'form2_core_approved_v1',
          approvedAt: '2026-08-29T12:05:00.000Z' } }; },
    } });
    Object.assign(subject.crmState, patch);
    await assert.rejects(subject.service.approve(command('approve')),
      { code: 'CONTROL_PRECONDITION_FAILED' });
    assert.equal(subject.store.rows.length, 2);
  }
  const unavailable = coreApprovedFixture({ configurationStaging: {
    async assertApprovalSource() { throw new RevenueDeskError('STAGING_SOURCE_UNVERIFIED',
      'Synthetic source unavailable'); },
  } });
  await assert.rejects(unavailable.service.approve(command('approve')),
    { code: 'STAGING_SOURCE_UNVERIFIED' });
  assert.equal(unavailable.store.rows.length, 2);
});

test('interrupted CRM supersession reconciles the same approval receipt without clearing old evidence', async () => {
  let attempts = 0;
  let verifications = 0;
  const subject = coreApprovedFixture({
    configurationStaging: { async assertApprovalSource() {
      verifications += 1;
      return { configurationStaged: true, priorCoreApproval: { configurationVersionId: 'form2_core_approved_v1',
        approvedAt: '2026-08-29T12:05:00.000Z' } };
    } },
    async beforeCrmApproval(value, current) {
      attempts += 1;
      assert.equal(current.Approved_Configuration_Version, 'form2_core_approved_v1');
      assert.equal(value.expectedDeal.Approved_Configuration_Version, 'form2_core_approved_v1');
      if (attempts === 1) throw new RevenueDeskError('CRM_APPROVAL_RECONCILIATION_REQUIRED',
        'Synthetic interruption before CRM write', { ambiguous: true });
    },
  });
  await assert.rejects(subject.service.approve(command('approve')),
    { code: 'CRM_APPROVAL_RECONCILIATION_REQUIRED' });
  const persisted = copy(subject.store.rows);
  assert.equal(subject.crmState.Go_Live_Approved_At, '2026-08-29T12:05:00.000Z');
  const resumed = await subject.service.approve(command('approve'));
  assert.equal(resumed.replayed, true);
  assert.equal(attempts, 2);
  assert.equal(verifications, 2);
  assert.deepEqual(subject.store.rows, persisted);
  assert.equal(subject.crmState.Approved_Configuration_Version, IDS.configuration);
  assert.equal(subject.crmState.Test_Start_At, null);
  assert.equal(subject.getProviderVerificationCalls(), 0);
});

// Build historical evidence with the pure transition serializer, not the
// current execution controller. This models pre-fix receipts without disabling
// a production guard or editing/resigning an existing stored receipt.
function seedHistoricalApproval(subject, { status = 'Completed', apply = true } = {}) {
  const row = subject.store.rows.find((item) => item.__table === 'RevenueDeskDeployments');
  const version = subject.store.rows.find((item) =>
    item.__table === 'RevenueDeskConfigurationVersions');
  const route = routeFingerprint(routeFromRows(row, version));
  const observedAt = new Date(NOW).toISOString();
  const intent = {
    schema_version: 1,
    event_id: `approval_${keyedDigest(EVENT_CHAIN_SECRET,
      'revenue-desk-route-control-idempotency-v1', ['approve', KEYS.approve])}`,
    action: 'approve', deployment_id: IDS.deployment,
    configuration_version_id: IDS.configuration, route_fingerprint: route,
    evidence_revision: SOURCE_REVISION, evidence_observed_at: observedAt,
    requested_at: observedAt, operator_id_hash: `operator_${'4'.repeat(64)}`,
    expected_deployment_version: Number(row.COUNT_VERSION),
  };
  const result = evaluateApprovalTransition({
    intent, signature: approvalIntentSignature(intent, 'o'.repeat(32)),
    operatorVerificationSecret: 'o'.repeat(32), eventChainSecret: EVENT_CHAIN_SECRET,
    deployment: row, configurationVersion: version, existingEvents: [], nowMs: NOW,
    evidence: { status: 'ready', deployment_id: IDS.deployment,
      configuration_version_id: IDS.configuration, route_fingerprint: route,
      source_revision: SOURCE_REVISION, deployment_version: Number(row.COUNT_VERSION),
      observed_at: observedAt, handled_count: Number(row.HANDLED_COUNT) },
  });
  const approval = authorizationReceiptRow(result.event, {
    sourceRevision: SOURCE_REVISION, environment: 'development',
    controlBinding: { schemaVersion: 1, action: 'approve', ...command('approve'),
      reason: null, deploymentControlPrestateDigest: null, deploymentControlPoststateDigest: null },
    eventChainSecret: EVENT_CHAIN_SECRET,
  });
  subject.store.rows.push({ ...approval, ROWID: String(subject.store.nextRow++),
    __table: 'RevenueDeskEventReceipts', STATUS: status,
    PROCESSED_AT: status === 'Completed' ? observedAt : null });
  if (apply) {
    Object.assign(row, result.deploymentPatch, { COUNT_VERSION: Number(row.COUNT_VERSION) + 1 });
    if (status === 'Completed') Object.assign(subject.crmState, {
      Test_Status: 'Scheduled', Go_Live_Approval_Status: 'Approved',
      Go_Live_Approved_At: row.GO_LIVE_APPROVED_AT,
      Approved_Deployment_Record_ID: IDS.deployment,
      Approved_Configuration_Version: IDS.configuration,
    });
  }
  return result.event;
}

function seedHistoricalActivation(subject, { status, apply }) {
  const approval = seedHistoricalApproval(subject);
  const row = subject.store.rows.find((item) => item.__table === 'RevenueDeskDeployments');
  const version = subject.store.rows.find((item) =>
    item.__table === 'RevenueDeskConfigurationVersions');
  const route = routeFingerprint(routeFromRows(row, version));
  const observedAt = new Date(NOW).toISOString();
  const readback = `readback_${'6'.repeat(64)}`;
  const intent = {
    schema_version: 1,
    event_id: `activation_${keyedDigest(EVENT_CHAIN_SECRET,
      'revenue-desk-route-control-idempotency-v1', ['activate', KEYS.activate])}`,
    action: 'activate', deployment_id: IDS.deployment,
    configuration_version_id: IDS.configuration, route_fingerprint: route,
    approval_event_key: row.APPROVAL_EVENT_KEY,
    route_readback_fingerprint: readback, route_observed_at: observedAt,
    evidence_revision: SOURCE_REVISION, evidence_observed_at: observedAt,
    requested_at: observedAt, operator_id_hash: `operator_${'4'.repeat(64)}`,
    expected_deployment_version: Number(row.COUNT_VERSION),
  };
  const result = evaluateActivationTransition({
    intent, signature: activationIntentSignature(intent, 'o'.repeat(32)),
    operatorVerificationSecret: 'o'.repeat(32), eventChainSecret: EVENT_CHAIN_SECRET,
    deployment: row, configurationVersion: version, existingEvents: [approval], nowMs: NOW,
    evidence: { status: 'route_active', deployment_id: IDS.deployment,
      configuration_version_id: IDS.configuration, approval_event_key: row.APPROVAL_EVENT_KEY,
      route_fingerprint: route, route_readback_fingerprint: readback,
      source_revision: SOURCE_REVISION, deployment_version: Number(row.COUNT_VERSION),
      observed_at: observedAt },
  });
  subject.store.rows.push({ ...authorizationReceiptRow(result.event, {
    sourceRevision: SOURCE_REVISION, environment: 'development',
    controlBinding: { schemaVersion: 1, action: 'activate', ...command('activate'),
      reason: null, deploymentControlPrestateDigest: null, deploymentControlPoststateDigest: null },
    eventChainSecret: EVENT_CHAIN_SECRET,
  }), ROWID: String(subject.store.nextRow++), __table: 'RevenueDeskEventReceipts',
  STATUS: status, PROCESSED_AT: status === 'Completed' ? observedAt : null });
  if (apply) {
    Object.assign(row, result.deploymentPatch, { COUNT_VERSION: Number(row.COUNT_VERSION) + 1 });
    if (status === 'Completed') Object.assign(subject.crmState, {
      Stage: 'Test Live', Test_Status: 'Live', Test_Start_At: row.ACTUAL_START_AT,
    });
  }
}

test('approval succeeds only after complete Form 2 and exact immutable configuration', async () => {
  const happy = fixture();
  happy.crmState.Test_Phone_Number = null;
  const result = await happy.service.approve(command('approve'));
  assert.equal(result.deployment.GO_LIVE_APPROVAL_STATUS, 'Approved');
  assert.equal(result.deployment.TEST_STATUS, 'Scheduled');
  assert.equal(result.deployment.ACTUAL_START_AT, null);
  assert.equal(happy.crmState.Test_Status, 'Scheduled');

  const incomplete = fixture({ dealOverrides: { Setup_Form_Submission_ID: null } });
  await assert.rejects(incomplete.service.approve(command('approve')),
    { code: 'CONTROL_PRECONDITION_FAILED' });
});

test('approval and simulated activation accept Catalyst bigint readback and preserve exact replay', async () => {
  const subject = fixture({ providerMode: 'disabled' });
  useCatalystDeploymentBigintReadback(subject);
  const result = await subject.service.approve(command('approve'));
  assert.equal(result.replayed, false);
  const approved = copy(subject.store.rows);
  const replay = await subject.service.approve(command('approve'));
  assert.equal(replay.replayed, true);
  assert.deepEqual(subject.store.rows, approved);
  assert.equal(subject.store.rows.filter((row) => row.EVENT_TYPE === 'approve').length, 1);
  const stored = await subject.store.unique('RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment);
  assert.equal(stored.COUNT_VERSION, '1');
  assert.equal(stored.TEST_STATUS, 'Scheduled');
  assert.equal(stored.GO_LIVE_APPROVAL_STATUS, 'Approved');
  assert.equal(stored.ACTUAL_START_AT, null);
  assert.equal(stored.EXPIRES_AT, null);
  assert.equal(subject.crmState.Test_Status, 'Scheduled');
  assert.equal(subject.getProviderVerificationCalls(), 0);
  assert.equal(subject.getProviderDisableCalls(), 0);
  assert.equal(subject.getCrmActivationCalls(), 0);

  // Only the existing injected fake provider supplies activation evidence;
  // this is not evidence of an actual telephone route or provider operation.
  subject.setProviderMode('active');
  subject.setClock(NOW + 300_000);
  const activated = await subject.service.activate(command('activate'));
  assert.equal(activated.deployment.TEST_STATUS, 'Live');
  assert.equal(activated.deployment.COUNT_VERSION, '2');
  assert.equal(activated.deployment.ACTUAL_START_AT, new Date(NOW + 300_000).toISOString());
  assert.equal(Date.parse(activated.deployment.EXPIRES_AT)
    - Date.parse(activated.deployment.ACTUAL_START_AT), 7 * 86_400_000);
  assert.ok(subject.getProviderVerificationCalls() > 0);
  assert.equal(subject.getProviderDisableCalls(), 0);
  const liveState = copy({ rows: subject.store.rows, crm: subject.crmState });
  const activationReplay = await subject.service.activate(command('activate'));
  assert.equal(activationReplay.replayed, true);
  assert.deepEqual({ rows: subject.store.rows, crm: subject.crmState }, liveState);
  assert.equal(subject.store.rows.filter((row) => row.EVENT_TYPE === 'activate').length, 1);
});

test('Catalyst bigint activation still requires fresh simulated route evidence before writes or clock start', async () => {
  for (const providerMode of ['missing', 'stale']) {
    const subject = fixture({ providerMode });
    useCatalystDeploymentBigintReadback(subject);
    await subject.service.approve(command('approve'));
    subject.setClock(NOW + 300_000);
    const before = copy({ rows: subject.store.rows, crm: subject.crmState });
    await assert.rejects(subject.service.activate(command('activate')),
      { code: providerMode === 'missing' ? 'ROUTE_VERIFICATION_FAILED' : 'STALE_ACTIVATION_EVIDENCE' });
    assert.deepEqual({ rows: subject.store.rows, crm: subject.crmState }, before);
    assert.equal(subject.getCrmActivationCalls(), 0);
    assert.equal(subject.getProviderDisableCalls(), 0);
    const stored = await subject.store.unique('RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment);
    assert.equal(stored.ACTUAL_START_AT, null);
    assert.equal(stored.EXPIRES_AT, null);
  }
});

test('malformed stored approval counters fail before any durable or CRM effect', async () => {
  for (const field of ['COUNT_VERSION', 'HANDLED_COUNT']) {
    for (const value of [null, '', '00', ' 0', '0.0', '-1', true,
      String(Number.MAX_SAFE_INTEGER + 1)]) {
      const subject = fixture({ providerMode: 'disabled', deploymentOverrides: { [field]: value } });
      const before = copy({ rows: subject.store.rows, crm: subject.crmState });
      await assert.rejects(subject.service.approve(command('approve')));
      assert.deepEqual({ rows: subject.store.rows, crm: subject.crmState }, before);
      assert.equal(subject.getProviderVerificationCalls(), 0);
      assert.equal(subject.getProviderDisableCalls(), 0);
      assert.equal(subject.getCrmActivationCalls(), 0);
    }
  }
});

test('new approval and activation reject unacknowledged monitoring without writes or provider access', async () => {
  for (const mode of ['missing', 'unmonitored', 'future']) {
    const body = configuration();
    if (mode === 'missing') delete body.notificationHandoff;
    if (mode === 'unmonitored') body.notificationHandoff.monitored = false;
    if (mode === 'future') body.notificationHandoff.acknowledgedAt = new Date(NOW + 60_000).toISOString();
    const subject = fixture({ configOverrides: { CONFIGURATION_JSON: JSON.stringify(body) } });
    const before = structuredClone(subject.store.rows);
    await assert.rejects(subject.service.approve(command('approve')),
      { code: 'NOTIFICATION_HANDOFF_UNAPPROVED' });
    assert.deepEqual(subject.store.rows, before);
    assert.equal(subject.getProviderVerificationCalls(), 0);
    seedHistoricalApproval(subject);
    const approved = structuredClone(subject.store.rows);
    await assert.rejects(subject.service.activate(command('activate')),
      { code: 'NOTIFICATION_HANDOFF_UNAPPROVED' });
    assert.deepEqual(subject.store.rows, approved);
    assert.equal(subject.getProviderVerificationCalls(), 0);
    assert.equal(subject.getCrmActivationCalls(), 0);
  }
});

test('historical monitoring absence permits exact approval replay, activation replay and rollback', async () => {
  const body = configuration();
  delete body.notificationHandoff;
  const approval = fixture({ configOverrides: { CONFIGURATION_JSON: JSON.stringify(body) } });
  seedHistoricalApproval(approval);
  assert.equal((await approval.service.approve(command('approve'))).replayed, true);

  const active = fixture({ configOverrides: { CONFIGURATION_JSON: JSON.stringify(body) } });
  seedHistoricalActivation(active, { status: 'Completed', apply: true });
  const beforeConfig = active.store.rows.find((row) => row.__table === 'RevenueDeskConfigurationVersions').CONFIGURATION_JSON;
  assert.equal((await active.service.activate(command('activate'))).replayed, true);
  active.setClock(NOW + 600_000);
  assert.equal((await active.service.rollback(command('rollback'))).replayed, false);
  assert.equal((await active.service.rollback(command('rollback'))).replayed, true);
  assert.equal(active.store.rows.find((row) => row.__table === 'RevenueDeskConfigurationVersions').CONFIGURATION_JSON,
    beforeConfig);
});

test('new approval and activation recheck both authoritative CRM handling preferences', async () => {
  for (const field of ['Urgent_Call_Handling', 'Existing_Customer_Call_Handling']) {
    for (const value of [undefined, null, '', 'Transfer to On-Call', 'Do Not Notify']) {
      const subject = fixture({ dealOverrides: { [field]: value } });
      const before = structuredClone(subject.store.rows);
      await assert.rejects(subject.service.approve(command('approve')),
        { code: 'FREE_TEST_HANDLING_POLICY_UNSUPPORTED' });
      assert.deepEqual(subject.store.rows, before);
      assert.equal(subject.getProviderVerificationCalls(), 0);
      seedHistoricalApproval(subject);
      const approved = structuredClone(subject.store.rows);
      await assert.rejects(subject.service.activate(command('activate')),
        { code: 'FREE_TEST_HANDLING_POLICY_UNSUPPORTED' });
      assert.deepEqual(subject.store.rows, approved);
      assert.equal(subject.getProviderVerificationCalls(), 0);
      assert.equal(subject.getCrmActivationCalls(), 0);
    }
    const changed = fixture();
    await changed.service.approve(command('approve'));
    changed.crmState[field] = 'Transfer to On-Call';
    await assert.rejects(changed.service.activate(command('activate')),
      { code: 'FREE_TEST_HANDLING_POLICY_UNSUPPORTED' });
    assert.equal(changed.getProviderVerificationCalls(), 0);
    assert.equal(changed.getCrmActivationCalls(), 0);
  }
});

test('historical handling preferences do not prevent exact replay or safe rollback', async () => {
  for (const value of [undefined, 'Transfer to On-Call']) {
    const subject = fixture({ dealOverrides: {
      Urgent_Call_Handling: value, Existing_Customer_Call_Handling: value,
    } });
    seedHistoricalActivation(subject, { status: 'Completed', apply: true });
    assert.equal((await subject.service.approve(command('approve'))).replayed, true);
    assert.equal((await subject.service.activate(command('activate'))).replayed, true);
    subject.setClock(NOW + 600_000);
    assert.equal((await subject.service.rollback(command('rollback'))).replayed, false);
    assert.equal((await subject.service.rollback(command('rollback'))).replayed, true);
  }
});

test('distinct CRM labels and physical version IDs preserve approval, activation, rollback and replay', async () => {
  const label = 'form2cfgv1:101:synthetic_label';
  const subject = fixture({
    dealOverrides: { Configuration_Version: label },
    configOverrides: { CONFIGURATION_VERSION: label,
      CONFIGURATION_JSON: JSON.stringify({ ...configuration(), configurationVersion: label }) },
  });
  assert.notEqual(label, command('approve').configurationVersionId);
  const approved = await subject.service.approve(command('approve'));
  assert.equal(approved.deployment.APPROVED_CONFIGURATION_VERSION_ID, IDS.configuration);
  assert.equal(subject.crmState.Configuration_Version, label);
  assert.equal(subject.crmState.Approved_Configuration_Version, IDS.configuration);
  assert.equal(approved.deployment.ACTUAL_START_AT, null);
  assert.equal(subject.getProviderVerificationCalls(), 0);
  assert.equal((await subject.service.approve(command('approve'))).replayed, true);
  subject.setClock(NOW + 300_000);
  const activated = await subject.service.activate(command('activate'));
  assert.equal(activated.deployment.TEST_STATUS, 'Live');
  assert.equal((await subject.service.activate(command('activate'))).replayed, true);
  subject.setClock(NOW + 600_000);
  await subject.service.rollback(command('rollback'));
  assert.equal(subject.crmState.Configuration_Version, label);
  assert.equal(subject.crmState.Approved_Configuration_Version, IDS.configuration);
  assert.equal((await subject.service.rollback(command('rollback'))).replayed, true);
});

test('configuration label joins use the loaded immutable row, never a matching caller ID alone', async () => {
  for (const [recordLabel, jsonLabel, crmLabel] of [
    ['label_one', IDS.configuration, IDS.configuration],
    ['label_one', 'label_two', 'label_two'],
    ['label_one', 'label_one', 'label_two'],
  ]) {
    const subject = fixture({ dealOverrides: { Configuration_Version: crmLabel },
      configOverrides: { CONFIGURATION_VERSION: recordLabel,
        CONFIGURATION_JSON: JSON.stringify({ ...configuration(), configurationVersion: jsonLabel }) } });
    const before = structuredClone(subject.store.rows);
    await assert.rejects(subject.service.approve(command('approve')), { code: 'CONTROL_PRECONDITION_FAILED' });
    assert.deepEqual(subject.store.rows, before);
    assert.equal(subject.getProviderVerificationCalls(), 0);
  }
});

test('approval rejects the pre-submission Verified access state', async () => {
  const subject = fixture({ dealOverrides: { Setup_Access_Status: 'Verified' } });
  await assert.rejects(subject.service.approve(command('approve')),
    { code: 'CONTROL_PRECONDITION_FAILED' });
});

test('approval requires the exact stored offer and known field-specific CRM route', async () => {
  for (const dealOverrides of [
    { Entry_Offer: '7-Day Revenue Leak Test' },
    { Entry_Offer: 'Free 7-Day Missed-Call ' },
    { Entry_Offer: null },
    { Approved_Test_Route: 'AfterHoursOnly' },
    { Approved_Test_Route: 'After-Hours ' },
    { Approved_Test_Route: 'after-hours' },
    { Approved_Test_Route: 'Both' },
    { Approved_Test_Route: null },
  ]) {
    const subject = fixture({ dealOverrides });
    const crmBefore = copy(subject.crmState);
    const rowsBefore = copy(subject.store.rows);
    await assert.rejects(subject.service.approve(command('approve')),
      { code: 'CONTROL_PRECONDITION_FAILED' });
    assert.deepEqual(subject.crmState, crmBefore);
    assert.deepEqual(subject.store.rows, rowsBefore);
    assert.equal(subject.getProviderVerificationCalls(), 0);
    assert.equal(subject.getProviderDisableCalls(), 0);
  }
});

test('approval and replay preserve exact stored or canonical after-hours CRM routes', async () => {
  for (const route of ['After-Hours', 'After Hours Only']) {
    const subject = fixture({ dealOverrides: { Approved_Test_Route: route } });
    const first = await subject.service.approve(command('approve'));
    assert.equal(first.deployment.TEST_STATUS, 'Scheduled');
    subject.crmState.Approved_Test_Route = route === 'After-Hours'
      ? 'After Hours Only' : 'After-Hours';
    const replay = await subject.service.approve(command('approve'));
    assert.equal(replay.replayed, true);
    assert.equal(replay.deployment.APPROVAL_EVENT_KEY, first.deployment.APPROVAL_EVENT_KEY);
    assert.equal(replay.deployment.ACTUAL_START_AT, null);
    assert.equal(subject.store.rows.filter((row) => row.EVENT_TYPE === 'approve').length, 1);
    assert.equal(subject.getProviderVerificationCalls(), 0);
  }
});

test('new overflow and combined approvals fail closed on unverified timing without writes', async () => {
  for (const [stored, label, mode] of [
    ['No-Answer/Overflow', 'No Answer / Overflow Only', 'NoAnswerOverflowOnly'],
    ['Both', 'After Hours + Overflow', 'AfterHoursAndOverflow'],
  ]) {
    const configured = { ...configuration(), coverageMode: mode,
      approvedTestRoute: label, noAnswerDelay: 25 };
    const options = {
      configOverrides: { CONFIGURATION_JSON: JSON.stringify(configured) },
      deploymentOverrides: { COVERAGE_MODE: mode },
      dealOverrides: { Approved_Test_Route: stored, No_Answer_Delay: 25 },
    };
    for (const route of [stored, label]) {
      for (const delay of [25, null, '4 Rings', 'Provider Default', 'Not Sure']) {
        const subject = fixture({ ...options,
          dealOverrides: { ...options.dealOverrides,
            Approved_Test_Route: route, No_Answer_Delay: delay } });
        const before = copy(subject.store.rows);
        const crmBefore = copy(subject.crmState);
        await assert.rejects(subject.service.approve(command('approve')),
          { code: 'PROVIDER_TIMING_UNVERIFIED' });
        assert.deepEqual(subject.store.rows, before);
        assert.deepEqual(subject.crmState, crmBefore);
        assert.equal(subject.getProviderVerificationCalls(), 0);
        assert.equal(subject.getProviderDisableCalls(), 0);
      }
    }
  }
});

test('historical non-after-hours approval cannot resume CAS, repair CRM, or activate', async () => {
  for (const [mode, route, label] of [
    ['NoAnswerOverflowOnly', 'No-Answer/Overflow', 'No Answer / Overflow Only'],
    ['AfterHoursAndOverflow', 'Both', 'After Hours + Overflow'],
  ]) {
    for (const state of [{ status: 'Prepared', apply: false },
      { status: 'Prepared', apply: true }, { status: 'Completed', apply: true }]) {
      const subject = fixture({
        deploymentOverrides: { COVERAGE_MODE: mode },
        configOverrides: { CONFIGURATION_JSON: JSON.stringify({ ...configuration(),
          coverageMode: mode, approvedTestRoute: label, noAnswerDelay: 25 }) },
        dealOverrides: { Approved_Test_Route: route, No_Answer_Delay: 25 },
      });
      seedHistoricalApproval(subject, state);
      const before = copy(subject.store.rows);
      const crmBefore = copy(subject.crmState);
      await assert.rejects(subject.service.approve(command('approve')),
        { code: 'PROVIDER_TIMING_UNVERIFIED' });
      if (state.status === 'Completed') {
        await assert.rejects(subject.service.activate(command('activate')),
          { code: 'PROVIDER_TIMING_UNVERIFIED' });
      }
      assert.deepEqual(subject.store.rows, before);
      assert.deepEqual(subject.crmState, crmBefore);
      assert.equal(subject.getProviderVerificationCalls(), 0);
      assert.equal(subject.getProviderDisableCalls(), 0);
      assert.equal(subject.getCrmActivationCalls(), 0);
      if (state.status === 'Completed') {
        const rolledBack = await subject.service.rollback(command('rollback'));
        assert.equal(rolledBack.deployment.TEST_STATUS, 'Stopped');
        assert.equal(rolledBack.deployment.GO_LIVE_APPROVAL_STATUS, 'Revoked');
        assert.equal(subject.getProviderDisableCalls(), 1);
      }
    }
  }
});

test('owner-attested timing retains execution hold and exact CRM preference during rollback', async () => {
  for (const [mode, stored, label] of [
    ['NoAnswerOverflowOnly', 'No-Answer/Overflow', 'No Answer / Overflow Only'],
    ['AfterHoursAndOverflow', 'Both', 'After Hours + Overflow'],
  ]) {
    const configured = { ...configuration(), coverageMode: mode,
      approvedTestRoute: label, noAnswerDelay: null };
    configured.providerTiming = providerTimingFixture(configured, {
      observedAt: '2026-08-29T12:08:00.000Z', ownerAcceptedAt: '2026-08-29T12:09:00.000Z',
    });
    const options = {
      deploymentOverrides: { COVERAGE_MODE: mode },
      configOverrides: { CONFIGURATION_JSON: JSON.stringify(configured) },
      dealOverrides: { Approved_Test_Route: stored, No_Answer_Delay: '5 Rings' },
    };
    const fresh = fixture(options);
    const original = copy(fresh.store.rows);
    await assert.rejects(fresh.service.approve(command('approve')),
      { code: 'PROVIDER_TIMING_UNVERIFIED' });
    assert.deepEqual(fresh.store.rows, original);
    assert.equal(fresh.getProviderVerificationCalls(), 0);

    // Fabricated history is an isolated regression fixture, never a live
    // activation or permission to bypass the production timing hold.
    for (const preference of ['5 Rings', '4 Rings', 27.5, '27.5', 'Provider Default']) {
      const historical = fixture(options);
      seedHistoricalApproval(historical);
      historical.crmState.No_Answer_Delay = preference;
      const rows = copy(historical.store.rows);
      const crm = copy(historical.crmState);
      await assert.rejects(historical.service.activate(command('activate')),
        { code: 'PROVIDER_TIMING_UNVERIFIED' });
      if (preference === '5 Rings') {
        const stopped = await historical.service.rollback(command('rollback'));
        assert.equal(stopped.deployment.TEST_STATUS, 'Stopped');
      } else {
        await assert.rejects(historical.service.rollback(command('rollback')),
          { code: 'CONTROL_PRECONDITION_FAILED' });
        assert.deepEqual(historical.store.rows, rows);
        assert.deepEqual(historical.crmState, crm);
        assert.equal(historical.getProviderDisableCalls(), 0);
      }
      assert.equal(historical.getProviderVerificationCalls(), 0);
    }
  }
});

test('historical non-after-hours activation replay cannot apply CAS or reach the provider', async () => {
  for (const [mode, route, label] of [
    ['NoAnswerOverflowOnly', 'No-Answer/Overflow', 'No Answer / Overflow Only'],
    ['AfterHoursAndOverflow', 'Both', 'After Hours + Overflow'],
  ]) {
    for (const state of [{ status: 'Prepared', apply: false },
      { status: 'Prepared', apply: true }, { status: 'Completed', apply: true }]) {
      const subject = fixture({
        deploymentOverrides: { COVERAGE_MODE: mode },
        configOverrides: { CONFIGURATION_JSON: JSON.stringify({ ...configuration(),
          coverageMode: mode, approvedTestRoute: label, noAnswerDelay: 25 }) },
        dealOverrides: { Approved_Test_Route: route, No_Answer_Delay: 25 },
      });
      seedHistoricalActivation(subject, state);
      const before = copy(subject.store.rows);
      const crmBefore = copy(subject.crmState);
      await assert.rejects(subject.service.activate(command('activate')),
        { code: 'PROVIDER_TIMING_UNVERIFIED' });
      assert.deepEqual(subject.store.rows, before);
      assert.deepEqual(subject.crmState, crmBefore);
      assert.equal(subject.getProviderVerificationCalls(), 0);
      assert.equal(subject.getProviderDisableCalls(), 0);
      assert.equal(subject.getCrmActivationCalls(), 0);
      const rolledBack = await subject.service.rollback(command('rollback'));
      assert.equal(rolledBack.deployment.TEST_STATUS, 'Stopped');
      assert.equal(rolledBack.deployment.GO_LIVE_APPROVAL_STATUS, 'Revoked');
    }
  }
});

test('full approval rejects incomplete fallback configuration without mutations or provider work', async () => {
  for (const [destination, number] of [
    ['Existing Office Line', null], ['On-Call Mobile', null], ['Other', null],
    ['Voicemail', '+15550100102'], ['Unknown', '+15550100102'],
  ]) {
    const subject = fixture({ configOverrides: { CONFIGURATION_JSON: JSON.stringify({
      ...configuration(), approvedFallbackDestination: destination,
      approvedFallbackNumber: number,
    }) } });
    const crmBefore = copy(subject.crmState);
    const rowsBefore = copy(subject.store.rows);
    await assert.rejects(subject.service.approve(command('approve')),
      { code: 'INVALID_SCHEMA' });
    assert.deepEqual(subject.crmState, crmBefore);
    assert.deepEqual(subject.store.rows, rowsBefore);
    assert.equal(subject.getProviderVerificationCalls(), 0);
    assert.equal(subject.getProviderDisableCalls(), 0);
  }
});

test('full approval does not silently normalize Form 2 national-format phone values', async () => {
  for (const field of ['Forwarding_Administrator_Mobile', 'Approved_Fallback_Number',
    'Rollback_Contact_Mobile']) {
    const subject = fixture({ dealOverrides: { [field]: '(555) 010-0101' } });
    const crmBefore = copy(subject.crmState);
    const rowsBefore = copy(subject.store.rows);
    await assert.rejects(subject.service.approve(command('approve')),
      { code: 'CONTROL_PRECONDITION_FAILED' });
    assert.deepEqual(subject.crmState, crmBefore);
    assert.deepEqual(subject.store.rows, rowsBefore);
    assert.equal(subject.getProviderVerificationCalls(), 0);
  }
});

test('approval rejects configuration-version mismatch', async () => {
  const subject = fixture();
  await assert.rejects(subject.service.approve(command('approve', {
    configurationVersionId: 'configuration_version_synthetic_v2',
  })), { code: 'CONTROL_PRECONDITION_FAILED' });
});

test('approval rejects a configuration bound to another client', async () => {
  const subject = fixture();
  const row = subject.store.rows.find((candidate) =>
    candidate.__table === 'RevenueDeskConfigurationVersions');
  row.CONFIGURATION_JSON = JSON.stringify({ ...configuration(), clientId: 'client_other' });
  await assert.rejects(subject.service.approve(command('approve')),
    { code: 'CONTROL_PRECONDITION_FAILED' });
});

for (const [name, field, value] of [
  ['forwarding administrator mobile', 'Forwarding_Administrator_Mobile', '+15550100109'],
  ['fallback number', 'Approved_Fallback_Number', '+15550100109'],
  ['rollback contact mobile', 'Rollback_Contact_Mobile', '+15550100109'],
  ['alert recipient mobile', 'Alert_Recipient_Mobile', '+15550100109'],
]) {
  test(`approval rejects a mismatched ${name}`, async () => {
    const subject = fixture({ dealOverrides: { [field]: value } });
    await assert.rejects(subject.service.approve(command('approve')),
      { code: 'CONTROL_PRECONDITION_FAILED' });
  });
}

test('activation rejects a CRM test number that differs from the isolated route', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  subject.crmState.Test_Phone_Number = '+15550100109';
  subject.setClock(NOW + 300_000);
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'ISOLATED_RETELL_TEST_NUMBER_REQUIRED' });
});

test('activation requires the isolated test number after number-free approval', async () => {
  const subject = fixture({ dealOverrides: { Test_Phone_Number: null } });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'ISOLATED_RETELL_TEST_NUMBER_REQUIRED' });
});

test('approval rejects another nonterminal deployment for the same client', async () => {
  const subject = fixture();
  subject.store.rows.push({ ...deployment(), ROWID: '102',
    DEPLOYMENT_ID: 'deployment_conflict', TEST_STATUS: 'Live',
    __table: 'RevenueDeskDeployments' });
  await assert.rejects(subject.service.approve(command('approve')),
    { code: 'CONTROL_PRECONDITION_FAILED' });
});

test('activation rechecks every conflicting same-client state', async () => {
  for (const [testStatus, approvalStatus] of [
    ['Scheduled', 'Approved'], ['Live', 'Approved'], ['Paused', 'Approved'],
    ['Ready for Approval', 'Blocked'],
  ]) {
    const subject = fixture();
    await subject.service.approve(command('approve'));
    subject.store.rows.push({ ...deployment(), ROWID: '102',
      NUMBER_LOOKUP_HASH: numberLookupKey('n'.repeat(32), '+15550100109'),
      DEPLOYMENT_ID: `deployment_conflict_${testStatus.replaceAll(' ', '_')}`,
      TEST_STATUS: testStatus, GO_LIVE_APPROVAL_STATUS: approvalStatus,
      __table: 'RevenueDeskDeployments' });
    subject.setClock(NOW + 300_000);
    await assert.rejects(subject.service.activate(command('activate')),
      { code: 'CONTROL_PRECONDITION_FAILED' });
    assert.equal(subject.store.rows.filter((row) =>
      row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate').length, 0);
  }
});

test('approval rejects another client claiming the same isolated number', async () => {
  const subject = fixture();
  subject.store.rows.push({ ...deployment(), ROWID: '102',
    CLIENT_ID: 'client_other', DEPLOYMENT_ID: 'deployment_other', TEST_STATUS: 'Live',
    __table: 'RevenueDeskDeployments' });
  await assert.rejects(subject.service.approve(command('approve')),
    { code: 'CONTROL_PRECONDITION_FAILED' });
});

test('failed rollback containment blocks a second deployment until inactivity is proven', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await subject.service.activate(command('activate'));
  subject.setProviderMode('manual');
  subject.setClock(NOW + 600_000);
  await assert.rejects(subject.service.rollback(command('rollback')),
    { code: 'ROLLBACK_MANUAL_REQUIRED' });

  const contained = await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  assert.equal(contained.TEST_STATUS, 'Paused');
  assert.equal(contained.GO_LIVE_APPROVAL_STATUS, 'Blocked');
  assert.equal(contained.STOPPED_AT, null);
  const receipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'revoke');
  assert.equal(receipt.STATUS, 'ReconciliationRequired');
  assert.notEqual(subject.crmState.Stage, 'Closed Lost');

  const replacementDeploymentId = 'deployment_replacement';
  const replacementConfigurationId = 'configuration_replacement_v1';
  const replacementConfiguration = {
    ...configuration(),
    crmDealId: '400000009',
    deploymentId: replacementDeploymentId,
    configurationVersion: replacementConfigurationId,
  };
  subject.store.rows.push({ ...deployment(), ROWID: '102',
    DEPLOYMENT_ID: replacementDeploymentId,
    ACTIVE_CONFIGURATION_VERSION_ID: replacementConfigurationId,
    __table: 'RevenueDeskDeployments' });
  subject.store.rows.push({ ...configurationRow(), ROWID: '203',
    CONFIGURATION_VERSION_ID: replacementConfigurationId,
    DEPLOYMENT_ID: replacementDeploymentId,
    CONFIGURATION_VERSION: replacementConfigurationId,
    CONFIGURATION_JSON: JSON.stringify(replacementConfiguration),
    __table: 'RevenueDeskConfigurationVersions' });
  const originalCrmState = copy(subject.crmState);
  Object.assign(subject.crmState, deal(), {
    id: '400000009',
    Deployment_Record_ID: replacementDeploymentId,
    Configuration_Version: replacementConfigurationId,
  });
  await assert.rejects(subject.service.approve({
    ...command('approve'),
    dealId: '400000009',
    deploymentId: 'deployment_replacement',
    configurationVersionId: replacementConfigurationId,
    idempotencyKey: '00000000-0000-4000-8000-000000000008',
  }), { code: 'CONTROL_PRECONDITION_FAILED' });

  subject.store.rows = subject.store.rows.filter((row) =>
    row.DEPLOYMENT_ID !== replacementDeploymentId
    && row.CONFIGURATION_VERSION_ID !== replacementConfigurationId);
  Object.assign(subject.crmState, originalCrmState);
  subject.setProviderMode('active');
  const stopped = await subject.service.rollback(command('rollback'));
  assert.equal(stopped.deployment.TEST_STATUS, 'Stopped');
  assert.equal(stopped.deployment.GO_LIVE_APPROVAL_STATUS, 'Revoked');
  assert.equal(subject.crmState.Stage, 'Closed Lost');
  const finalizedReceipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'revoke');
  assert.equal(finalizedReceipt.STATUS, 'Completed');
});

test('activation rejects absent approval, absent route verification, and stale route evidence', async () => {
  const noApproval = fixture();
  await assert.rejects(noApproval.service.activate(command('activate')),
    { code: 'CONTROL_PRECONDITION_FAILED' });

  for (const [mode, code] of [['missing', 'ROUTE_VERIFICATION_FAILED'],
    ['stale', 'STALE_ACTIVATION_EVIDENCE']]) {
    const subject = fixture({ providerMode: mode });
    await subject.service.approve(command('approve'));
    subject.setClock(NOW + 300_000);
    await assert.rejects(subject.service.activate(command('activate')), { code });
  }
});

for (const [name, corrupt] of [
  ['missing', (subject, approval) => {
    subject.store.rows = subject.store.rows.filter((row) => row !== approval);
  }],
  ['Prepared', (_subject, approval) => {
    approval.STATUS = 'Prepared';
    approval.PROCESSED_AT = null;
  }],
  ['tampered event hash', (_subject, approval) => {
    const data = JSON.parse(approval.EVENT_DATA_JSON);
    data.eventHash = '0'.repeat(64);
    approval.EVENT_DATA_JSON = JSON.stringify(data);
    approval.PAYLOAD_FINGERPRINT = authorizationReceiptFingerprint(
      EVENT_CHAIN_SECRET, approval.EVENT_DATA_JSON,
    );
  }],
  ['cross-journey binding', (_subject, approval) => {
    const data = JSON.parse(approval.EVENT_DATA_JSON);
    data.controlBinding.journeyId = 'journey_other';
    approval.EVENT_DATA_JSON = JSON.stringify(data);
    approval.PAYLOAD_FINGERPRINT = authorizationReceiptFingerprint(
      EVENT_CHAIN_SECRET, approval.EVENT_DATA_JSON,
    );
  }],
  ['duplicate decision', (subject, approval) => {
    subject.store.rows.push({
      ...copy(approval),
      ROWID: '998',
      EVENT_KEY: `approval_${'f'.repeat(64)}`,
    });
  }],
]) {
  test(`activation rejects a ${name} approval receipt before any side effect`, async () => {
    const subject = fixture();
    await subject.service.approve(command('approve'));
    const approval = subject.store.rows.find((row) =>
      row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'approve');
    assert.ok(approval);
    corrupt(subject, approval);
    const deploymentBefore = await subject.store.unique(
      'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
    );
    const crmBefore = copy(subject.crmState);
    subject.setClock(NOW + 300_000);

    await assert.rejects(subject.service.activate(command('activate')),
      { code: 'CONTROL_AUDIT_INVALID' });

    assert.equal(subject.getProviderVerificationCalls(), 0);
    assert.equal(subject.getCrmActivationCalls(), 0);
    assert.deepEqual(await subject.store.unique(
      'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
    ), deploymentBefore);
    assert.deepEqual(subject.crmState, crmBefore);
    assert.equal(subject.store.rows.filter((row) =>
      row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate').length, 0);
  });
}

test('activation contains a CRM Deal that drifts after route validation begins', async () => {
  const subject = fixture({
    mutateDealDuringRouteVerification(state) {
      state.Approved_Fallback_Number = '+15550100105';
    },
  });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'CRM_ACTIVATION_RECONCILIATION_REQUIRED' });
  const selected = await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  assert.equal(selected.TEST_STATUS, 'Scheduled');
  assert.equal(selected.ACTUAL_START_AT, null);
  assert.notEqual(subject.crmState.Stage, 'Test Live');
});

test('post-CAS provider drift is contained before CRM activation', async () => {
  const subject = fixture({ providerModeAfterFirstVerification: 'missing' });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'ACTIVATION_COMPENSATED' });
  const selected = await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  assert.equal(selected.TEST_STATUS, 'Scheduled');
  assert.equal(selected.ACTIVATION_EVENT_KEY, null);
  assert.equal(subject.getCrmActivationCalls(), 0);
  assert.notEqual(subject.crmState.Stage, 'Test Live');
  const receipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate');
  assert.equal(receipt.STATUS, 'FailedCompensated');
});

test('approval then activation is split, exact, and idempotent', async () => {
  const subject = fixture();
  const approved = await subject.service.approve(command('approve'));
  assert.equal(approved.deployment.TEST_STATUS, 'Scheduled');
  subject.setClock(NOW + 300_000);
  const activated = await subject.service.activate(command('activate'));
  assert.equal(activated.deployment.TEST_STATUS, 'Live');
  assert.equal(activated.deployment.GO_LIVE_APPROVAL_STATUS, 'Approved');
  assert.equal(Date.parse(activated.deployment.EXPIRES_AT)
    - Date.parse(activated.deployment.ACTUAL_START_AT), 7 * 86_400_000);
  const approvalReceipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'approve');
  const approvalData = JSON.parse(approvalReceipt.EVENT_DATA_JSON);
  const activationData = JSON.parse(activated.receipt.EVENT_DATA_JSON);
  assert.equal(activated.receipt.RELATED_EVENT_KEY, approvalReceipt.EVENT_KEY);
  assert.equal(activationData.previousEventHash, approvalData.eventHash);
  const replay = await subject.service.activate(command('activate'));
  assert.equal(replay.replayed, true);
  assert.equal(replay.deployment.ACTIVATION_EVENT_KEY,
    activated.deployment.ACTIVATION_EVENT_KEY);
});

test('completed activation replay rejects a forged event hash before any side effect', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await subject.service.activate(command('activate'));
  const receipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate');
  const data = { ...JSON.parse(receipt.EVENT_DATA_JSON), eventHash: '0'.repeat(64) };
  receipt.EVENT_DATA_JSON = JSON.stringify(data);
  receipt.PAYLOAD_FINGERPRINT = authorizationReceiptFingerprint(
    EVENT_CHAIN_SECRET, receipt.EVENT_DATA_JSON,
  );
  const providerCalls = subject.getProviderVerificationCalls();
  const crmCalls = subject.getCrmActivationCalls();

  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'CONTROL_AUDIT_INVALID' });
  assert.equal(subject.getProviderVerificationCalls(), providerCalls);
  assert.equal(subject.getCrmActivationCalls(), crmCalls);
  assert.equal(receipt.STATUS, 'Completed');
});

test('activation remains gateway-dark at every Prepared checkpoint and canonical receipts load after completion', async () => {
  const checkpoints = [];
  const subject = fixture({
    async onActivationCheckpoint(context) {
      checkpoints.push(context.name);
      const row = await context.store.unique(
        context.tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', IDS.deployment,
      );
      if (context.name === 'activation_receipt_completed') {
        const admitted = await loadDeployment(
          context.store, row, context.runtimeConfig,
        );
        assert.doesNotThrow(() => activeAt(admitted, NOW + 300_000));
      } else {
        await assert.rejects(loadDeployment(context.store, row, context.runtimeConfig),
          { code: 'CONFIGURATION_UNAVAILABLE' });
      }
    },
  });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  const activated = await subject.service.activate(command('activate'));
  assert.deepEqual(checkpoints, [
    'deployment_live_prepared', 'post_cas_provider_verified',
    'crm_activation_verified', 'final_provider_verified',
    'activation_live_final_read', 'activation_claim_finalization_window',
    'activation_receipt_completed',
  ]);
  const row = await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  const loaded = await loadDeployment(subject.store, row, subject.runtimeConfig);
  assert.doesNotThrow(() => activeAt(loaded, NOW + 300_000));
  assert.equal(activated.receipt.STATUS, 'Completed');
});

for (const crashPoint of [
  'deployment_live_prepared', 'post_cas_provider_verified', 'crm_activation_verified',
  'final_provider_verified', 'activation_live_final_read',
  'activation_claim_finalization_window',
]) {
  test(`exact activation resume completes after a synthetic crash at ${crashPoint}`, async () => {
    let crash = true;
    const subject = fixture({
      async onActivationCheckpoint({ name }) {
        if (crash && name === crashPoint) {
          crash = false;
          throw new Error(`synthetic crash at ${name}`);
        }
      },
    });
    await subject.service.approve(command('approve'));
    subject.setClock(NOW + 300_000);
    await assert.rejects(subject.service.activate(command('activate')),
      new RegExp(`synthetic crash at ${crashPoint}`));
    const prepared = subject.store.rows.find((row) =>
      row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate');
    assert.equal(prepared.STATUS, 'Prepared');
    const liveRow = await subject.store.unique(
      'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
    );
    await assert.rejects(loadDeployment(subject.store, liveRow, subject.runtimeConfig),
      { code: 'CONFIGURATION_UNAVAILABLE' });
    await assert.rejects(subject.service.activate(command('activate', {
      idempotencyKey: '00000000-0000-4000-8000-000000000009',
    })), { code: 'CONTROL_IDEMPOTENCY_CONFLICT' });
    assert.equal(subject.store.rows.filter((row) =>
      row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate').length, 1);
    const resumed = await subject.service.activate(command('activate'));
    assert.equal(resumed.replayed, true);
    assert.equal(resumed.receipt.STATUS, 'Completed');
    const admitted = await loadDeployment(subject.store, resumed.deployment,
      subject.runtimeConfig);
    assert.doesNotThrow(() => activeAt(admitted, NOW + 300_000));
  });
}

test('prepared activation resume rejects a forged event hash before any side effect', async () => {
  let crash = true;
  const subject = fixture({
    async onActivationCheckpoint({ name }) {
      if (crash && name === 'deployment_live_prepared') {
        crash = false;
        throw new Error('synthetic crash before activation side effects');
      }
    },
  });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await assert.rejects(subject.service.activate(command('activate')),
    /synthetic crash before activation side effects/);
  const receipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate');
  const data = { ...JSON.parse(receipt.EVENT_DATA_JSON), eventHash: '0'.repeat(64) };
  receipt.EVENT_DATA_JSON = JSON.stringify(data);
  receipt.PAYLOAD_FINGERPRINT = authorizationReceiptFingerprint(
    EVENT_CHAIN_SECRET, receipt.EVENT_DATA_JSON,
  );
  const providerCalls = subject.getProviderVerificationCalls();
  const crmCalls = subject.getCrmActivationCalls();

  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'CONTROL_AUDIT_INVALID' });
  assert.equal(subject.getProviderVerificationCalls(), providerCalls);
  assert.equal(subject.getCrmActivationCalls(), crmCalls);
  assert.equal(receipt.STATUS, 'Prepared');
});

test('interrupted local activation containment resumes with its receipt timestamp', async () => {
  let interrupt = true;
  const subject = fixture({
    providerModeAfterSecondVerification: 'missing',
    async onActivationContainmentCheckpoint({ name }) {
      if (interrupt && name === 'deployment_inactive_pre_crm') {
        interrupt = false;
        throw new Error('synthetic containment interruption');
      }
    },
  });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await assert.rejects(subject.service.activate(command('activate')),
    /synthetic containment interruption/);
  const contained = await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  assert.equal(contained.TEST_STATUS, 'Scheduled');
  assert.equal(contained.ACTUAL_START_AT, null);
  assert.equal(subject.crmState.Stage, 'Test Live');
  const prepared = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate');
  assert.equal(prepared.STATUS, 'ReconciliationRequired');
  assert.equal(prepared.LAST_ERROR_CODE, 'ACTIVATION_CONTAINMENT_STARTED');
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'ACTIVATION_COMPENSATED' });
  assert.equal(subject.crmState.Stage, 'Setup and QA');
  assert.equal(subject.crmState.Test_Status, 'Scheduled');
  assert.equal(subject.crmState.Test_Start_At, null);
  assert.equal(prepared.STATUS, 'FailedCompensated');
});

test('rollback takes ownership of a fenced activation containment without external replay', async () => {
  const containmentObserved = deferred();
  const releaseContainmentFence = deferred();
  const containmentFenced = deferred();
  const releaseContainment = deferred();
  const rollbackObservedPrepared = deferred();
  const releaseRollbackQuiesce = deferred();
  const subject = fixture({
    providerModeAfterSecondVerification: 'missing',
    async onActivationContainmentCheckpoint({ name }) {
      if (name === 'containment_receipt_observed_pre_fence') {
        containmentObserved.resolve();
        await releaseContainmentFence.promise;
      }
      if (name === 'containment_fenced_pre_deployment') {
        containmentFenced.resolve();
        await releaseContainment.promise;
      }
    },
    async onRollbackCheckpoint({ name }) {
      if (name === 'activation_prepared_observed_pre_quiesce') {
        rollbackObservedPrepared.resolve();
        await releaseRollbackQuiesce.promise;
      }
    },
  });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  const activation = subject.service.activate(command('activate'));
  await containmentObserved.promise;

  const rollback = subject.service.rollback(command('rollback'));
  await rollbackObservedPrepared.promise;
  releaseContainmentFence.resolve();
  await containmentFenced.promise;
  releaseRollbackQuiesce.resolve();
  const stopped = await rollback;
  assert.equal(stopped.deployment.TEST_STATUS, 'Stopped');
  assert.equal(subject.crmState.Stage, 'Closed Lost');
  assert.equal(subject.crmState.Test_Status, 'Rolled Back');
  assert.equal(subject.getProviderDisableCalls(), 1);
  const activationReceipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate');
  assert.equal(activationReceipt.STATUS, 'ReconciliationRequired');
  assert.equal(activationReceipt.LAST_ERROR_CODE, 'ACTIVATION_SUPERSEDED_BY_ROLLBACK');
  const claim = subject.store.rows.find((row) => row.RECEIPT_KIND === 'control_claim');
  assert.equal(claim.STATUS, 'Completed');

  releaseContainment.resolve();
  await assert.rejects(activation, { code: 'ACTIVATION_SUPERSEDED_BY_ROLLBACK' });
  assert.equal(subject.getProviderDisableCalls(), 1,
    'activation containment must not repeat rollback-owned provider work');
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'ACTIVATION_SUPERSEDED_BY_ROLLBACK' });
});

test('rollback serializes a Prepared activation and removes concurrent CRM Live state', async () => {
  const activationReached = deferred();
  const releaseActivation = deferred();
  const rollbackReached = deferred();
  const releaseRollback = deferred();
  const subject = fixture({
    async onActivationCheckpoint({ name }) {
      if (name === 'activation_live_final_read') {
        activationReached.resolve();
        await releaseActivation.promise;
      }
    },
    async onRollbackCheckpoint({ name }) {
      if (name === 'deployment_stopped_pre_provider') {
        rollbackReached.resolve();
        await releaseRollback.promise;
      }
    },
  });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  const activation = subject.service.activate(command('activate'));
  await activationReached.promise;
  const rollback = subject.service.rollback(command('rollback'));
  await rollbackReached.promise;
  releaseActivation.resolve();
  await assert.rejects(activation, { code: 'ACTIVATION_SUPERSEDED_BY_ROLLBACK' });
  assert.equal(subject.crmState.Stage, 'Test Live');
  releaseRollback.resolve();
  const stopped = await rollback;
  assert.equal(stopped.deployment.TEST_STATUS, 'Stopped');
  assert.equal(subject.crmState.Stage, 'Closed Lost');
  assert.equal(subject.crmState.Test_Status, 'Rolled Back');
  const activationReceipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate');
  assert.equal(activationReceipt.STATUS, 'ReconciliationRequired');
  assert.equal(activationReceipt.LAST_ERROR_CODE, 'ACTIVATION_SUPERSEDED_BY_ROLLBACK');
});

test('a rollback claim before activation receipt completion blocks admission without corrupting history', async () => {
  const activationReached = deferred();
  const releaseActivation = deferred();
  const rollbackClaimed = deferred();
  const releaseRollback = deferred();
  let subject;
  subject = fixture({
    async onActivationCheckpoint({ name }) {
      if (name === 'activation_claim_finalization_window') {
        activationReached.resolve();
        await releaseActivation.promise;
      }
    },
    async onRollbackCheckpoint({ name }) {
      if (name === 'claim_acquired_pre_quiesce') {
        rollbackClaimed.resolve();
        await releaseRollback.promise;
      }
    },
  });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  const activation = subject.service.activate(command('activate'));
  await activationReached.promise;
  const rollback = subject.service.rollback(command('rollback'));
  await rollbackClaimed.promise;
  releaseActivation.resolve();
  await assert.rejects(activation, { code: 'ACTIVATION_SUPERSEDED_BY_ROLLBACK' });
  const claimed = await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  assert.equal(claimed.TEST_STATUS, 'Live');
  const activationReceipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate');
  assert.equal(activationReceipt.STATUS, 'Completed');
  const blocked = await loadDeployment(subject.store, claimed, subject.runtimeConfig);
  assert.throws(() => activeAt(blocked, NOW + 300_000),
    { code: 'CONFIGURATION_UNAVAILABLE' });
  releaseRollback.resolve();
  const stopped = await rollback;
  assert.equal(stopped.deployment.TEST_STATUS, 'Stopped');
  assert.equal(stopped.deployment.ACTIVATION_EVENT_KEY, activationReceipt.EVENT_KEY);
  assert.equal(stopped.deployment.ACTUAL_START_AT, activationReceipt
    ? JSON.parse(activationReceipt.EVENT_DATA_JSON).actualStartAt : null);
  const claim = subject.store.rows.find((row) => row.RECEIPT_KIND === 'control_claim');
  assert.equal(claim.STATUS, 'Completed');
});

test('a post-completion rollback claim preserves an already-admitted activation interval', async () => {
  const receiptCompleted = deferred();
  const releaseActivation = deferred();
  const rollbackClaimed = deferred();
  const releaseRollback = deferred();
  let admittedAt;
  let subject;
  subject = fixture({
    async onActivationCheckpoint({ name, store, runtimeConfig }) {
      if (name === 'activation_receipt_completed') {
        const row = await store.unique(
          'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
        );
        const admitted = await loadDeployment(store, row, runtimeConfig);
        admittedAt = admitted.actualStartAt;
        assert.doesNotThrow(() => activeAt(admitted, NOW + 300_000));
        receiptCompleted.resolve();
        await releaseActivation.promise;
      }
    },
    async onRollbackCheckpoint({ name }) {
      if (name === 'claim_acquired_pre_quiesce') {
        rollbackClaimed.resolve();
        await releaseRollback.promise;
      }
    },
  });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  const activation = subject.service.activate(command('activate'));
  await receiptCompleted.promise;
  const rollback = subject.service.rollback(command('rollback'));
  await rollbackClaimed.promise;
  releaseActivation.resolve();
  await assert.rejects(activation, { code: 'ACTIVATION_SUPERSEDED_BY_ROLLBACK' });
  const receipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate');
  assert.equal(receipt.STATUS, 'Completed');
  releaseRollback.resolve();
  const stopped = await rollback;
  assert.equal(stopped.deployment.TEST_STATUS, 'Stopped');
  assert.equal(stopped.deployment.ACTUAL_START_AT, admittedAt);
  assert.ok(Number.isFinite(Date.parse(stopped.deployment.EXPIRES_AT)));
  const settledOwner = await loadDeployment(
    subject.store, stopped.deployment, subject.runtimeConfig,
  );
  assert.equal(settledOwner.activationEvidenceValidated, true);
  assert.equal(settledOwner.actualStartAt, admittedAt);
});

test('completed activation replay fails closed at the exact expiration boundary', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  const activated = await subject.service.activate(command('activate'));
  const receiptBefore = copy(activated.receipt);
  const verificationCallsBefore = subject.getProviderVerificationCalls();
  subject.setClock(Date.parse(activated.deployment.EXPIRES_AT));
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'CONTROL_PRECONDITION_FAILED' });
  assert.equal(subject.getProviderVerificationCalls(), verificationCallsBefore);
  const receiptAfter = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate');
  assert.deepEqual(receiptAfter, receiptBefore);
});

test('completed activation replay preserves its receipt when the runtime terminates concurrently', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  const activated = await subject.service.activate(command('activate'));
  const receiptBefore = copy(activated.receipt);
  subject.setClock(NOW + 600_000);
  subject.terminalizeOnNextProviderVerification();
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'ACTIVATION_SUPERSEDED_BY_TERMINAL_STATE' });
  const receiptAfter = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate');
  assert.deepEqual(receiptAfter, receiptBefore);
  const terminal = await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  assert.equal(terminal.TEST_STATUS, 'Completed');
  const loaded = await loadDeployment(subject.store, terminal, subject.runtimeConfig);
  assert.throws(() => activeAt(loaded, NOW + 600_000),
    { code: 'CONFIGURATION_UNAVAILABLE' });
  assert.equal(subject.getProviderDisableCalls(), 0);
});

test('final provider drift after CRM activation is compensated in CRM and remains gateway-dark', async () => {
  const subject = fixture({ providerModeAfterSecondVerification: 'missing' });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'ACTIVATION_COMPENSATED' });
  const row = await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  assert.equal(row.TEST_STATUS, 'Scheduled');
  assert.equal(row.ACTIVATION_EVENT_KEY, null);
  assert.equal(subject.crmState.Stage, 'Setup and QA');
  assert.equal(subject.crmState.Test_Status, 'Scheduled');
  assert.equal(subject.crmState.Test_Start_At, null);
  const receipt = subject.store.rows.find((candidate) =>
    candidate.__table === 'RevenueDeskEventReceipts'
    && candidate.EVENT_TYPE === 'activate');
  assert.equal(receipt.STATUS, 'FailedCompensated');
  const scheduled = await loadDeployment(subject.store, row, subject.runtimeConfig);
  assert.throws(() => activeAt(scheduled, NOW + 300_000),
    { code: 'CONFIGURATION_UNAVAILABLE' });
});

test('CRM activation failure compensates to approved and inactive', async () => {
  const subject = fixture({ failCrmActivation: true });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'ACTIVATION_COMPENSATED' });
  const row = await subject.store.unique('RevenueDeskDeployments', 'DEPLOYMENT_ID',
    IDS.deployment);
  assert.equal(row.GO_LIVE_APPROVAL_STATUS, 'Approved');
  assert.equal(row.TEST_STATUS, 'Scheduled');
  assert.equal(row.ACTIVATION_EVENT_KEY, null);
  assert.equal(row.ACTUAL_START_AT, null);
});

test('activation containment tolerates only a concurrent runtime counter advance', async () => {
  const subject = fixture({
    failCrmActivation: true,
    countBeforeCrmActivationFailure: true,
  });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'CRM_ACTIVATION_RECONCILIATION_REQUIRED' });
  const row = await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  assert.equal(row.TEST_STATUS, 'Scheduled');
  assert.equal(row.ACTIVATION_EVENT_KEY, null);
  assert.equal(row.HANDLED_COUNT, 1);
  assert.equal(JSON.parse(row.COUNTED_CALL_KEYS_JSON).length, 1);
  const receipt = subject.store.rows.find((candidate) =>
    candidate.__table === 'RevenueDeskEventReceipts'
    && candidate.EVENT_TYPE === 'activate');
  assert.equal(receipt.STATUS, 'ReconciliationRequired');
  const scheduled = await loadDeployment(subject.store, row, subject.runtimeConfig);
  assert.throws(() => activeAt(scheduled, NOW + 300_001),
    { code: 'CONFIGURATION_UNAVAILABLE' });
});

test('ambiguous CRM activation is contained but remains explicit reconciliation', async () => {
  const subject = fixture({ ambiguousCrmActivation: true });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'ACTIVATION_COMPENSATED' });
  const row = await subject.store.unique('RevenueDeskDeployments', 'DEPLOYMENT_ID',
    IDS.deployment);
  assert.equal(row.TEST_STATUS, 'Scheduled');
  assert.equal(row.ACTIVATION_EVENT_KEY, null);
  const receipt = subject.store.rows.find((candidate) =>
    candidate.__table === 'RevenueDeskEventReceipts'
    && candidate.EVENT_TYPE === 'activate');
  assert.equal(receipt.STATUS, 'FailedCompensated');
});

test('provider rollback failure occurs only after gateway admission is contained', async () => {
  const subject = fixture({ failCrmActivation: true, failProviderDisable: true });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'CRM_ACTIVATION_RECONCILIATION_REQUIRED' });
  const row = await subject.store.unique('RevenueDeskDeployments', 'DEPLOYMENT_ID',
    IDS.deployment);
  assert.equal(row.TEST_STATUS, 'Scheduled');
  assert.equal(row.ACTIVATION_EVENT_KEY, null);
  assert.equal(row.ACTUAL_START_AT, null);
  assert.equal(row.EXPIRES_AT, null);
  const receipt = subject.store.rows.find((candidate) =>
    candidate.__table === 'RevenueDeskEventReceipts'
    && candidate.EVENT_TYPE === 'activate');
  assert.equal(receipt.STATUS, 'ReconciliationRequired');
  assert.equal(receipt.LAST_ERROR_CODE, 'ROUTE_ROLLBACK_FAILED');
});

test('an interrupted activation compensation permits only exact-key repair', async () => {
  const subject = fixture({ failCrmActivation: true });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  const original = subject.store.conditionalUpdate.bind(subject.store);
  let interruptReceiptCompensation = true;
  subject.store.conditionalUpdate = async (table, rowId, patch, expected) => {
    const receipt = subject.store.rows.find((row) => row.__table === table
      && row.ROWID === String(rowId));
    if (interruptReceiptCompensation && table === 'RevenueDeskEventReceipts'
      && receipt?.EVENT_TYPE === 'activate' && patch.STATUS === 'FailedCompensated') {
      interruptReceiptCompensation = false;
      return subject.store.unique(table, 'ROWID', rowId);
    }
    return original(table, rowId, patch, expected);
  };
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'CONTROL_AUDIT_INCOMPLETE' });
  const contained = await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  assert.equal(contained.TEST_STATUS, 'Scheduled');
  assert.equal(contained.ACTIVATION_EVENT_KEY, null);
  await assert.rejects(subject.service.activate(command('activate', {
    idempotencyKey: '00000000-0000-4000-8000-000000000009',
  })), { code: 'CONTROL_IDEMPOTENCY_CONFLICT' });
  assert.equal(subject.store.rows.filter((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate').length, 1);
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'ACTIVATION_COMPENSATED' });
  const receipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate');
  assert.equal(receipt.STATUS, 'FailedCompensated');
  assert.equal(subject.store.rows.filter((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate').length, 1);
});

test('provider rollback ambiguity blocks a new activation identity', async () => {
  const subject = fixture({ failCrmActivation: true, providerMode: 'manual' });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'CRM_ACTIVATION_RECONCILIATION_REQUIRED' });
  const deploymentState = await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  assert.equal(deploymentState.TEST_STATUS, 'Scheduled');
  assert.equal(deploymentState.ACTIVATION_EVENT_KEY, null);
  const receipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate');
  assert.equal(receipt.STATUS, 'ReconciliationRequired');
  await assert.rejects(subject.service.activate(command('activate', {
    idempotencyKey: '00000000-0000-4000-8000-000000000009',
  })), { code: 'CONTROL_IDEMPOTENCY_CONFLICT' });
  assert.equal(subject.store.rows.filter((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate').length, 1);
});

test('rollback adopts a partial activation containment and completes shutdown', async () => {
  const subject = fixture({
    providerModeAfterSecondVerification: 'missing',
    failProviderDisable: true,
  });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'CRM_ACTIVATION_RECONCILIATION_REQUIRED' });
  const partial = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate');
  assert.equal(partial.STATUS, 'ReconciliationRequired');
  assert.equal(partial.LAST_ERROR_CODE, 'ROUTE_ROLLBACK_FAILED');

  subject.setProviderDisableFailure(false);
  const stopped = await subject.service.rollback(command('rollback'));
  assert.equal(stopped.deployment.TEST_STATUS, 'Stopped');
  assert.equal(subject.crmState.Stage, 'Closed Lost');
  assert.equal(subject.crmState.Test_Status, 'Rolled Back');
  assert.equal(partial.STATUS, 'ReconciliationRequired');
  assert.equal(partial.LAST_ERROR_CODE, 'ACTIVATION_SUPERSEDED_BY_ROLLBACK');
  const claim = subject.store.rows.find((row) => row.RECEIPT_KIND === 'control_claim');
  assert.equal(claim.STATUS, 'Completed');
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'ACTIVATION_SUPERSEDED_BY_ROLLBACK' });
});

test('a completed activation replay never repairs or compensates CRM drift', async () => {
  const fresh = fixture();
  await fresh.service.approve(command('approve'));
  fresh.setClock(NOW + 300_000);
  const activated = await fresh.service.activate(command('activate'));
  const deploymentBefore = copy(activated.deployment);
  const receiptBefore = copy(activated.receipt);
  Object.assign(fresh.crmState, {
    Stage: 'Setup and QA', Test_Status: 'Scheduled',
    Test_Start_At: activated.deployment.ACTUAL_START_AT,
  });
  fresh.setClock(NOW + 600_000);
  const crmCallsBefore = fresh.getCrmActivationCalls();
  await assert.rejects(fresh.service.activate(command('activate')),
    { code: 'CONTROL_PRECONDITION_FAILED' });
  assert.equal(fresh.crmState.Stage, 'Setup and QA');
  assert.equal(fresh.getCrmActivationCalls(), crmCallsBefore);
  assert.deepEqual(await fresh.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  ), deploymentBefore);
  assert.deepEqual(fresh.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate'),
  receiptBefore);

  const stale = fixture();
  await stale.service.approve(command('approve'));
  stale.setClock(NOW + 300_000);
  const staleActivation = await stale.service.activate(command('activate'));
  Object.assign(stale.crmState, {
    Stage: 'Setup and QA', Test_Status: 'Scheduled',
    Test_Start_At: staleActivation.deployment.ACTUAL_START_AT,
  });
  stale.setClock(NOW + 1_300_001);
  await assert.rejects(stale.service.activate(command('activate')),
    { code: 'CONTROL_PRECONDITION_FAILED' });
  const deploymentState = await stale.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  assert.equal(deploymentState.TEST_STATUS, 'Live');
  assert.equal(stale.crmState.Test_Start_At, staleActivation.deployment.ACTUAL_START_AT);
});

test('completed activation replay reports provider drift without mutating historical state', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  const activated = await subject.service.activate(command('activate'));
  const deploymentBefore = copy(activated.deployment);
  const receiptBefore = copy(activated.receipt);
  const crmBefore = copy(subject.crmState);
  subject.setProviderMode('missing');
  const crmCallsBefore = subject.getCrmActivationCalls();
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'ROUTE_VERIFICATION_FAILED' });
  assert.deepEqual(await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  ), deploymentBefore);
  assert.deepEqual(subject.crmState, crmBefore);
  assert.equal(subject.getCrmActivationCalls(), crmCallsBefore);
  const receipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate');
  assert.deepEqual(receipt, receiptBefore);
  assert.equal(subject.getProviderDisableCalls(), 0);
});

test('completed activation replay reports CRM read failure without mutating history', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  const activated = await subject.service.activate(command('activate'));
  const deploymentBefore = copy(activated.deployment);
  const receiptBefore = copy(activated.receipt);
  const crmBefore = copy(subject.crmState);
  subject.setCrmReadFailure(true);
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'CRM_READBACK_INVALID' });
  assert.deepEqual(await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  ), deploymentBefore);
  assert.deepEqual(subject.crmState, crmBefore);
  assert.deepEqual(subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate'),
  receiptBefore);
  assert.equal(subject.getProviderDisableCalls(), 0);
});

test('a stale Prepared activation request cannot compensate a concurrently Completed receipt', async () => {
  const preparedReached = deferred();
  const releasePrepared = deferred();
  let pauseFirst = true;
  const subject = fixture({
    async onActivationCheckpoint({ name }) {
      if (pauseFirst && name === 'deployment_live_prepared') {
        pauseFirst = false;
        preparedReached.resolve();
        await releasePrepared.promise;
      }
    },
  });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  const stalePrepared = subject.service.activate(command('activate'));
  await preparedReached.promise;
  const winner = await subject.service.activate(command('activate'));
  assert.equal(winner.receipt.STATUS, 'Completed');
  const deploymentBefore = copy(winner.deployment);
  const receiptBefore = copy(winner.receipt);
  const crmBefore = copy(subject.crmState);
  subject.setProviderMode('missing');
  releasePrepared.resolve();
  await assert.rejects(stalePrepared, { code: 'CONTROL_PRECONDITION_FAILED' });
  assert.deepEqual(await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  ), deploymentBefore);
  assert.deepEqual(subject.crmState, crmBefore);
  assert.deepEqual(subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate'),
  receiptBefore);
  assert.equal(subject.getProviderDisableCalls(), 0);
});

test('a Prepared receipt resumes exact poststate instead of creating a second decision', async () => {
  const subject = fixture();
  const original = subject.store.conditionalUpdate.bind(subject.store);
  let interruptFinalize = true;
  subject.store.conditionalUpdate = async (table, rowId, patch, expected) => {
    if (interruptFinalize && table === 'RevenueDeskEventReceipts'
      && patch.STATUS === 'Completed') {
      interruptFinalize = false;
      return subject.store.unique(table, 'ROWID', rowId);
    }
    return original(table, rowId, patch, expected);
  };
  await assert.rejects(subject.service.approve(command('approve')),
    { code: 'CONTROL_AUDIT_INCOMPLETE' });
  const resumed = await subject.service.approve(command('approve'));
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.deployment.TEST_STATUS, 'Scheduled');
  assert.equal(subject.crmState.Test_Status, 'Scheduled');
  assert.equal(subject.store.rows.filter((row) =>
    row.__table === 'RevenueDeskEventReceipts').length, 1);
});

test('a competing activation key cannot bypass an exact Prepared resume', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  const original = subject.store.conditionalUpdate.bind(subject.store);
  let interruptFinalize = true;
  subject.store.conditionalUpdate = async (table, rowId, patch, expected) => {
    const receipt = subject.store.rows.find((row) => row.__table === table
      && row.ROWID === String(rowId));
    if (interruptFinalize && table === 'RevenueDeskEventReceipts'
      && receipt?.EVENT_TYPE === 'activate' && patch.STATUS === 'Completed') {
      interruptFinalize = false;
      return subject.store.unique(table, 'ROWID', rowId);
    }
    return original(table, rowId, patch, expected);
  };
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'CONTROL_AUDIT_INCOMPLETE' });
  await assert.rejects(subject.service.activate(command('activate', {
    idempotencyKey: '00000000-0000-4000-8000-000000000009',
  })), { code: 'CONTROL_IDEMPOTENCY_CONFLICT' });
  const resumed = await subject.service.activate(command('activate'));
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.deployment.TEST_STATUS, 'Live');
  assert.equal(subject.crmState.Stage, 'Test Live');
  assert.equal(subject.store.rows.filter((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'activate').length, 1);
});

test('completed idempotency is bound to Deal, journey, and rollback reason', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  await assert.rejects(subject.service.approve(command('approve', {
    dealId: '400000009', journeyId: 'journey_other',
  })), { code: 'CONTROL_IDEMPOTENCY_CONFLICT' });
  subject.setClock(NOW + 300_000);
  await subject.service.activate(command('activate'));
  subject.setClock(NOW + 600_000);
  await subject.service.rollback(command('rollback'));
  await assert.rejects(subject.service.rollback(command('rollback', {
    reason: 'configuration_changed',
  })), { code: 'CONTROL_IDEMPOTENCY_CONFLICT' });
});

test('every prepared or completed replay revalidates the current CRM journey binding', async () => {
  const approval = fixture();
  await approval.service.approve(command('approve'));
  approval.crmState.Intake_Submission_ID = 'journey_rebound';
  await assert.rejects(approval.service.approve(command('approve')),
    { code: 'CONTROL_PRECONDITION_FAILED' });

  const activation = fixture();
  await activation.service.approve(command('approve'));
  activation.setClock(NOW + 300_000);
  await activation.service.activate(command('activate'));
  activation.crmState.Deployment_Record_ID = 'deployment_rebound';
  await assert.rejects(activation.service.activate(command('activate')),
    { code: 'CONTROL_PRECONDITION_FAILED' });

  const rollback = fixture();
  await rollback.service.approve(command('approve'));
  rollback.setClock(NOW + 300_000);
  await rollback.service.activate(command('activate'));
  rollback.setClock(NOW + 600_000);
  await rollback.service.rollback(command('rollback'));
  rollback.crmState.Configuration_Version = 'configuration_rebound';
  await assert.rejects(rollback.service.rollback(command('rollback')),
    { code: 'CONTROL_PRECONDITION_FAILED' });
});

test('rollback is durable, repeatable, and blocks later activation', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await subject.service.activate(command('activate'));
  subject.setClock(NOW + 600_000);
  const stopped = await subject.service.rollback(command('rollback'));
  assert.equal(stopped.deployment.TEST_STATUS, 'Stopped');
  assert.equal(stopped.deployment.GO_LIVE_APPROVAL_STATUS, 'Revoked');
  assert.equal(stopped.deployment.STOP_REASON, 'operator_requested');
  const replay = await subject.service.rollback(command('rollback'));
  assert.equal(replay.replayed, true);
  await assert.rejects(subject.service.activate(command('activate', {
    idempotencyKey: '00000000-0000-4000-8000-000000000009',
  })), { code: 'ACTIVATION_SUPERSEDED_BY_ROLLBACK' });
});

test('a premature rollback creates no claim and does not block later activation', async () => {
  const subject = fixture();
  await assert.rejects(subject.service.rollback(command('rollback')),
    { code: 'CONTROL_PRECONDITION_FAILED' });
  assert.equal(subject.store.rows.filter((row) =>
    row.RECEIPT_KIND === 'control_claim').length, 0);
  assert.equal(subject.store.rows.filter((row) =>
    row.EVENT_TYPE === 'revoke').length, 0);
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  const activated = await subject.service.activate(command('activate'));
  assert.equal(activated.deployment.TEST_STATUS, 'Live');
});

test('Billing state added after claim blocks rollback before local or provider mutation', async () => {
  let subject;
  subject = fixture({
    async onRollbackCheckpoint({ name }) {
      if (name === 'claim_acquired_pre_quiesce') {
        subject.crmState.Billing_Subscription_ID = 'subscription_synthetic';
      }
    },
  });
  await subject.service.approve(command('approve'));
  await assert.rejects(subject.service.rollback(command('rollback')),
    { code: 'CONTROL_PRECONDITION_FAILED' });
  const deploymentState = await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  assert.equal(deploymentState.TEST_STATUS, 'Scheduled');
  assert.equal(subject.getProviderDisableCalls(), 0);
  assert.equal(subject.store.rows.filter((row) => row.EVENT_TYPE === 'revoke').length, 0);
  const claim = subject.store.rows.find((row) => row.RECEIPT_KIND === 'control_claim');
  assert.equal(claim.STATUS, 'ReconciliationRequired');
});

test('technical rollback stays stopped until the exact manual CRM close is proven', async () => {
  const subject = fixture({ manualCrmClose: true });
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await subject.service.activate(command('activate'));
  subject.setClock(NOW + 600_000);
  await assert.rejects(subject.service.rollback(command('rollback')),
    { code: 'CRM_MANUAL_CLOSE_REQUIRED' });
  const stopped = await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  assert.equal(stopped.TEST_STATUS, 'Stopped');
  assert.equal(subject.crmState.Stage, 'Test Live');
  assert.equal(subject.crmState.Test_Status, 'Live');
  let claim = subject.store.rows.find((row) => row.RECEIPT_KIND === 'control_claim');
  assert.equal(claim.STATUS, 'ReconciliationRequired');
  Object.assign(subject.crmState, {
    Stage: 'Closed Lost', Test_Status: 'Rolled Back',
    Reason_For_Loss__s: 'Test safely stopped',
  });
  const replay = await subject.service.rollback(command('rollback'));
  assert.equal(replay.replayed, true);
  claim = subject.store.rows.find((row) => row.RECEIPT_KIND === 'control_claim');
  assert.equal(claim.STATUS, 'Completed');
});

test('every rollback control reason maps to one approved CRM picklist value', () => {
  assert.deepEqual(ROLLBACK_REASON_TO_CRM, {
    operator_requested: 'Sylvara Stopped',
    route_verification_failed: 'Technical Failure',
    configuration_changed: 'Technical Failure',
    synthetic_test_complete: 'Other',
  });
});

test('rollback survives a counter mutation after its Prepared receipt is inserted', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await subject.service.activate(command('activate'));
  subject.setClock(NOW + 600_000);
  const originalInsert = subject.store.insertUnique.bind(subject.store);
  let race = true;
  subject.store.insertUnique = async (...args) => {
    const result = await originalInsert(...args);
    const input = args[2];
    if (race && input.EVENT_TYPE === 'revoke') {
      race = false;
      await subject.store.mutate('RevenueDeskDeployments', 'DEPLOYMENT_ID',
        IDS.deployment, 'COUNT_VERSION', (current) => ({
          COUNTED_CALL_KEYS_JSON: JSON.stringify([`call_${'9'.repeat(64)}`]),
          HANDLED_COUNT: 1,
          UPDATED_AT: new Date(NOW + 600_001).toISOString(),
        }));
    }
    return result;
  };
  const stopped = await subject.service.rollback(command('rollback'));
  assert.equal(stopped.deployment.TEST_STATUS, 'Stopped');
  assert.equal(stopped.deployment.HANDLED_COUNT, 1);
  const receipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'revoke');
  assert.equal(receipt.STATUS, 'Completed');
  const replay = await subject.service.rollback(command('rollback'));
  assert.equal(replay.replayed, true);
  assert.equal(replay.deployment.TEST_STATUS, 'Stopped');
});

test('runtime terminal CAS supersedes rollback without overwriting terminal evidence', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await subject.service.activate(command('activate'));
  subject.setClock(NOW + 600_000);
  const originalInsert = subject.store.insertUnique.bind(subject.store);
  let terminalRace = true;
  subject.store.insertUnique = async (...args) => {
    const result = await originalInsert(...args);
    const input = args[2];
    if (terminalRace && input.EVENT_TYPE === 'revoke') {
      terminalRace = false;
      await subject.store.mutate('RevenueDeskDeployments', 'DEPLOYMENT_ID',
        IDS.deployment, 'COUNT_VERSION', () => ({
          TEST_STATUS: 'Completed',
          STOP_REASON: 'call_limit_reached',
          STOPPED_AT: new Date(NOW + 600_001).toISOString(),
          COUNTED_CALL_KEYS_JSON: JSON.stringify([`call_${'8'.repeat(64)}`]),
          HANDLED_COUNT: 25,
          REPORT_RECONCILIATION_STATUS: 'Pending',
          REPORT_RECONCILIATION_VERSION: 1,
          UPDATED_AT: new Date(NOW + 600_001).toISOString(),
        }));
    }
    return result;
  };
  const crmBefore = copy(subject.crmState);
  await assert.rejects(subject.service.rollback(command('rollback')),
    { code: 'ROLLBACK_SUPERSEDED_BY_RUNTIME_TERMINAL' });
  const terminal = await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  assert.equal(terminal.TEST_STATUS, 'Completed');
  assert.equal(terminal.STOP_REASON, 'call_limit_reached');
  assert.equal(terminal.HANDLED_COUNT, 25);
  assert.equal(terminal.REPORT_RECONCILIATION_STATUS, 'Pending');
  assert.equal(terminal.REPORT_RECONCILIATION_VERSION, 1);
  assert.equal(subject.getProviderDisableCalls(), 1);
  assert.deepEqual(subject.crmState, crmBefore);
  const receipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'revoke');
  assert.equal(receipt.STATUS, 'ReconciliationRequired');
  assert.equal(receipt.LAST_ERROR_CODE, 'ROLLBACK_SUPERSEDED_BY_RUNTIME_TERMINAL');
  await assert.rejects(subject.service.rollback(command('rollback')),
    { code: 'ROLLBACK_SUPERSEDED_BY_RUNTIME_TERMINAL' });
  assert.equal(subject.getProviderDisableCalls(), 2);
  assert.equal(subject.store.rows.filter((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'revoke').length, 1);
});

test('runtime terminal rollback replay tolerates exact CRM terminal summary state', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await subject.service.activate(command('activate'));
  subject.setClock(NOW + 600_000);
  const originalInsert = subject.store.insertUnique.bind(subject.store);
  let terminalRace = true;
  subject.store.insertUnique = async (...args) => {
    const result = await originalInsert(...args);
    const input = args[2];
    if (terminalRace && input.EVENT_TYPE === 'revoke') {
      terminalRace = false;
      await subject.store.mutate('RevenueDeskDeployments', 'DEPLOYMENT_ID',
        IDS.deployment, 'COUNT_VERSION', () => ({
          TEST_STATUS: 'Completed', STOP_REASON: 'call_limit_reached',
          STOPPED_AT: new Date(NOW + 600_001).toISOString(),
          HANDLED_COUNT: 25, REPORT_RECONCILIATION_STATUS: 'Pending',
          REPORT_RECONCILIATION_VERSION: 1,
          UPDATED_AT: new Date(NOW + 600_001).toISOString(),
        }));
    }
    return result;
  };
  await assert.rejects(subject.service.rollback(command('rollback')),
    { code: 'ROLLBACK_SUPERSEDED_BY_RUNTIME_TERMINAL' });
  const terminal = await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  );
  Object.assign(subject.crmState, {
    Test_Status: 'Completed',
    Test_End_At: terminal.STOPPED_AT,
    Test_End_Reason: 'Call Limit Reached',
  });
  await assert.rejects(subject.service.rollback(command('rollback')),
    { code: 'ROLLBACK_SUPERSEDED_BY_RUNTIME_TERMINAL' });
  assert.equal(subject.getProviderDisableCalls(), 2);
  assert.equal(subject.crmState.Stage, 'Test Live');
  const receipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'revoke');
  assert.equal(receipt.STATUS, 'ReconciliationRequired');
});

test('the original activation key cannot mutate a stopped deployment', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await subject.service.activate(command('activate'));
  subject.setClock(NOW + 600_000);
  const stopped = await subject.service.rollback(command('rollback'));
  const crmBefore = copy(subject.crmState);
  const deploymentBefore = copy(stopped.deployment);
  const providerCallsBefore = subject.getProviderDisableCalls();
  subject.setClock(NOW + 1_500_001);
  await assert.rejects(subject.service.activate(command('activate')),
    { code: 'ACTIVATION_SUPERSEDED_BY_ROLLBACK' });
  assert.deepEqual(await subject.store.unique(
    'RevenueDeskDeployments', 'DEPLOYMENT_ID', IDS.deployment,
  ), deploymentBefore);
  assert.deepEqual(subject.crmState, crmBefore);
  assert.equal(subject.getProviderDisableCalls(), providerCallsBefore);
});

test('ambiguous global ownership contains locally before manual rollback', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await subject.service.activate(command('activate'));
  subject.store.rows.push({ ...deployment(), ROWID: '102',
    CLIENT_ID: 'client_other', DEPLOYMENT_ID: 'deployment_other', TEST_STATUS: 'Live',
    __table: 'RevenueDeskDeployments' });
  const providerCallsBefore = subject.getProviderDisableCalls();
  await assert.rejects(subject.service.rollback(command('rollback')),
    { code: 'ROLLBACK_MANUAL_REQUIRED' });
  assert.equal(subject.getProviderDisableCalls(), providerCallsBefore);
  const selected = subject.store.rows.find((row) => row.ROWID === '101');
  assert.equal(selected.TEST_STATUS, 'Paused');
  assert.equal(selected.GO_LIVE_APPROVAL_STATUS, 'Blocked');
  assert.equal(subject.crmState.Stage, 'Test Live');
  const receipt = subject.store.rows.find((row) =>
    row.__table === 'RevenueDeskEventReceipts' && row.EVENT_TYPE === 'revoke');
  assert.equal(receipt.STATUS, 'ReconciliationRequired');
  assert.equal(receipt.LAST_ERROR_CODE, 'ROUTE_ROLLBACK_OWNERSHIP_UNPROVEN');
});

test('rollback replay completes an exact partial CRM Blueprint transition', async () => {
  const subject = fixture();
  await subject.service.approve(command('approve'));
  subject.setClock(NOW + 300_000);
  await subject.service.activate(command('activate'));
  subject.setClock(NOW + 600_000);
  const stopped = await subject.service.rollback(command('rollback'));
  Object.assign(subject.crmState, {
    Stage: 'Test Live',
    Test_Status: 'Live',
    Test_End_At: stopped.deployment.STOPPED_AT,
    Test_End_Reason: 'Sylvara Stopped',
    Rollback_Completed_At: stopped.deployment.STOPPED_AT,
  });
  const replay = await subject.service.rollback(command('rollback'));
  assert.equal(replay.replayed, true);
  assert.equal(subject.crmState.Stage, 'Closed Lost');
  assert.equal(subject.crmState.Test_Status, 'Rolled Back');
});

test('Production configuration is rejected before any control dependency is used', () => {
  assert.throws(() => createRouteControlService({
    config: { environment: 'production', deploymentMode: 'dark' },
    store: {}, crm: {}, provider: {},
  }), { code: 'PRODUCTION_DARK' });
});

test('route fingerprint binds every immutable Form 2 control field', () => {
  const row = configurationRow();
  const baseDeployment = deployment();
  const first = routeFingerprint(routeFromRows(baseDeployment, row));
  const changed = configuration();
  changed.rollbackContactMobile = '+15550100109';
  row.CONFIGURATION_JSON = JSON.stringify(changed);
  assert.notEqual(routeFingerprint(routeFromRows(baseDeployment, row)), first);
  const otherClient = { ...baseDeployment, CLIENT_ID: 'client_other' };
  assert.notEqual(routeFingerprint(routeFromRows(otherClient, configurationRow())), first);
});
