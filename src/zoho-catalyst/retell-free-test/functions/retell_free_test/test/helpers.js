'use strict';

const { MemoryStore } = require('../lib/memory-store');
const {
  SyntheticNotificationAdapter,
  SyntheticAnalyticsAdapter,
  SyntheticAdmissionReconciliationAdapter,
  DisabledCrmSummaryAdapter,
} = require('../lib/adapters');
const { createFreeTestService } = require('../lib/service');

const NOW = Date.parse('2026-08-22T12:00:00.000Z');
const START = '2026-08-20T12:00:00.000Z';
const EXPIRES = '2026-08-27T12:00:00.000Z';

const runtimeConfig = Object.freeze({
  environment: 'development',
  sourceRevision: 'a'.repeat(40),
  retellVerificationKey: 'synthetic-retell-verification-material',
  admissionSecret: 'synthetic-admission-key-material-aaaaaaaa',
  eventSecret: 'synthetic-event-key-material-bbbbbbbbbbbb',
  numberSecret: 'synthetic-number-key-material-ccccccccccc',
  sharedAgentId: 'agent_shared_free_test',
  sharedAgentVersion: 7,
  maxSignatureAgeMs: 300_000,
  notificationMaxAttempts: 3,
});

function deployment(letter, overrides = {}) {
  return {
    clientId: `client_${letter}`,
    deploymentId: `deployment_${letter}`,
    configurationVersion: `cfg_${letter}_v1`,
    environment: 'development',
    engagementType: 'free_test',
    capabilityProfile: 'call_gap_monitor_v1',
    coverageMode: letter === 'A' ? 'AfterHoursOnly' : 'NoAnswerOverflowOnly',
    testStatus: 'Live',
    goLiveApprovalStatus: 'Approved',
    approvedStartAt: START,
    actualStartAt: START,
    expiresAt: EXPIRES,
    admissionLimit: 25,
    admittedCallCount: 0,
    handledCallCount: 0,
    stopReason: null,
    monitorAgentId: runtimeConfig.sharedAgentId,
    monitorAgentVersion: runtimeConfig.sharedAgentVersion,
    ...overrides,
  };
}

function configuration(letter, overrides = {}) {
  return {
    clientId: `client_${letter}`,
    deploymentId: `deployment_${letter}`,
    configurationVersion: `cfg_${letter}_v1`,
    approved: true,
    companyName: letter === 'A' ? 'Synthetic Plumbing Alpha' : 'Synthetic Plumbing Beta',
    companyDescription: 'Synthetic residential plumbing contractor.',
    businessHours: 'Monday-Friday 08:00-17:00 America/Chicago',
    coverageMode: letter === 'A' ? 'AfterHoursOnly' : 'NoAnswerOverflowOnly',
    servicesHandled: letter === 'A' ? ['water heaters', 'leaks'] : ['drains', 'fixtures'],
    unsupportedServices: letter === 'A' ? ['septic pumping'] : ['well drilling'],
    serviceArea: letter === 'A'
      ? { cities: ['Lenexa'], zips: ['66215'] }
      : { cities: ['Liberty'], zips: ['64068'] },
    urgentConditions: letter === 'A' ? ['active uncontrolled leak'] : ['sewage backup'],
    callbackExpectation: 'The team will review the information. No appointment or dispatch is confirmed.',
    notificationRecipient: {
      recipientId: `recipient_${letter}`,
      approved: true,
      name: `Synthetic Recipient ${letter}`,
      channel: 'email',
      email: `${letter.toLowerCase()}@example.invalid`,
      mobile: null,
    },
    ...overrides,
  };
}

function assignment(letter, overrides = {}) {
  return {
    assignmentId: `assignment_${letter}_v1`,
    assignmentVersion: 1,
    toNumber: letter === 'A' ? '+15550000001' : '+15550000002',
    clientId: `client_${letter}`,
    deploymentId: `deployment_${letter}`,
    configurationVersion: `cfg_${letter}_v1`,
    agentId: runtimeConfig.sharedAgentId,
    status: 'Active',
    effectiveFrom: '2026-08-19T12:00:00.000Z',
    effectiveTo: null,
    ...overrides,
  };
}

function createFixture(options = {}) {
  const deployments = options.deployments || [deployment('A'), deployment('B')];
  const configurations = options.configurations || [configuration('A'), configuration('B')];
  const assignments = options.assignments || [assignment('A'), assignment('B')];
  const clock = options.clock || { value: NOW };
  const store = new MemoryStore({ deployments, configurations, assignments }, { now: () => clock.value });
  const notificationAdapter = options.notificationAdapter || new SyntheticNotificationAdapter({
    environment: 'development',
    behavior: options.notificationBehavior,
  });
  const analyticsAdapter = options.analyticsAdapter || new SyntheticAnalyticsAdapter({
    environment: 'development',
    behavior: options.analyticsBehavior,
  });
  const admissionReconciliationAdapter = options.admissionReconciliationAdapter
    || new SyntheticAdmissionReconciliationAdapter({
      environment: 'development',
      behavior: options.admissionReconciliationBehavior,
    });
  const crmSummaryAdapter = new DisabledCrmSummaryAdapter({ environment: 'development', mode: 'disabled' });
  const logs = [];
  const logger = options.logger || {
    info(record) { logs.push({ level: 'info', ...record }); },
    warn(record) { logs.push({ level: 'warn', ...record }); },
    error(record) { logs.push({ level: 'error', ...record }); },
  };
  const service = createFreeTestService({
    store,
    config: runtimeConfig,
    notificationAdapter,
    analyticsAdapter,
    admissionReconciliationAdapter,
    crmSummaryAdapter,
    now: () => clock.value,
    documentedValueMethods: options.documentedValueMethods || new Set(),
    logger,
  });
  return {
    store,
    service,
    notificationAdapter,
    analyticsAdapter,
    admissionReconciliationAdapter,
    crmSummaryAdapter,
    logs,
    clock,
  };
}

function inbound(letter, options = {}) {
  return {
    event: 'call_inbound',
    event_timestamp: options.timestamp || NOW,
    call_inbound: {
      agent_id: runtimeConfig.sharedAgentId,
      agent_version: runtimeConfig.sharedAgentVersion,
      from_number: options.fromNumber || (letter === 'A' ? '+15551110001' : '+15551110002'),
      to_number: options.toNumber || (letter === 'A' ? '+15550000001' : '+15550000002'),
      ...(options.customSipHeaders ? { custom_sip_headers: options.customSipHeaders } : {}),
    },
  };
}

async function admit(fixture, letter, options = {}) {
  const payload = inbound(letter, options);
  const result = await fixture.service.resolveInbound(payload, { signatureTimestamp: payload.event_timestamp });
  if (result.status !== 'Resolved') throw new Error(`Admission failed: ${result.reasonCode}`);
  return { payload, result, metadata: result.response.call_inbound.metadata };
}

function analyzedEvent({ callId, metadata, letter = 'A', startTimestamp = NOW + 1000, endTimestamp = NOW + 61_000, data = {} }) {
  return {
    event: 'call_analyzed',
    call: {
      call_id: callId,
      agent_id: runtimeConfig.sharedAgentId,
      agent_version: runtimeConfig.sharedAgentVersion,
      to_number: letter === 'A' ? '+15550000001' : '+15550000002',
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
      metadata,
      call_analysis: {
        custom_analysis_data: {
          caller_name: `Synthetic Caller ${letter}`,
          callback_number: letter === 'A' ? '+15551110001' : '+15551110002',
          customer_type: 'new',
          caller_intent: 'request_service',
          issue_summary: letter === 'A' ? 'Leaking water heater' : 'Blocked kitchen drain',
          city_or_zip: letter === 'A' ? 'Lenexa' : 'Liberty',
          urgency: 'routine',
          specific_person_requested: null,
          outcome: 'potential_job',
          coverage_trigger: letter === 'A' ? 'AfterHours' : 'NoAnswerOverflow',
          value_evidence_class: 'unknown',
          ...data,
        },
      },
    },
  };
}

function endedEvent({ callId, metadata, letter = 'A', startTimestamp = NOW + 1000, endTimestamp = NOW + 61_000 }) {
  return {
    event: 'call_ended',
    call: {
      call_id: callId,
      agent_id: runtimeConfig.sharedAgentId,
      agent_version: runtimeConfig.sharedAgentVersion,
      to_number: letter === 'A' ? '+15550000001' : '+15550000002',
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
      metadata,
    },
  };
}

function raw(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

module.exports = {
  NOW,
  START,
  EXPIRES,
  runtimeConfig,
  deployment,
  configuration,
  assignment,
  createFixture,
  inbound,
  admit,
  analyzedEvent,
  endedEvent,
  raw,
};
