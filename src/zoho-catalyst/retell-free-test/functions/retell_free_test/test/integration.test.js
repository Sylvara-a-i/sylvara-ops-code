'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SyntheticNotificationAdapter } = require('../lib/adapters');
const {
  NOW,
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
} = require('./helpers');

test('integration: exact resolver gate returns immutable ownership and only Client A conversation configuration', async () => {
  const fixture = createFixture();
  const result = await fixture.service.resolveInbound(inbound('A'), { signatureTimestamp: NOW });
  assert.equal(result.status, 'Resolved');
  const response = result.response.call_inbound;
  assert.equal(response.override_agent_id, 'agent_shared_free_test');
  assert.deepEqual(response.metadata, {
    resolver_status: 'Resolved',
    client_id: 'client_A',
    deployment_id: 'deployment_A',
    configuration_version: 'cfg_A_v1',
    engagement_type: 'free_test',
    capability_profile: 'call_gap_monitor_v1',
    coverage_mode: 'AfterHoursOnly',
    admission_id: response.metadata.admission_id,
    number_assignment_id: 'assignment_A_v1',
    number_assignment_version: '1',
    correlation_id: response.metadata.correlation_id,
  });
  assert.match(response.dynamic_variables.company_name, /Alpha/);
  assert.doesNotMatch(JSON.stringify(response), /Beta|recipient_B|b@example/);
});

test('integration: unknown and ambiguous numbers enter tenantless Configuration Unavailable voice gate', async () => {
  const unknownFixture = createFixture();
  const unknown = await unknownFixture.service.resolveInbound(inbound('A', { toNumber: '+15559999999' }), { signatureTimestamp: NOW });
  assert.equal(unknown.status, 'ConfigurationUnavailable');
  assert.equal(unknown.response.call_inbound.dynamic_variables.resolver_status, 'ConfigurationUnavailable');
  assert.equal(unknown.response.call_inbound.dynamic_variables.client_id, '');
  assert.equal(Object.hasOwn(unknown.response.call_inbound, 'reject'), false);
  assert.doesNotMatch(JSON.stringify(unknown.response), /Alpha|Beta|client_A|client_B/);

  const ambiguousFixture = createFixture({
    assignments: [assignment('A'), assignment('B', { toNumber: '+15550000001' })],
  });
  const ambiguous = await ambiguousFixture.service.resolveInbound(inbound('A'), { signatureTimestamp: NOW });
  assert.equal(ambiguous.status, 'ConfigurationUnavailable');
  assert.equal(ambiguous.reasonCode, 'CONFIGURATION_UNAVAILABLE');
});

test('integration: corrupt exact-gate values fail closed instead of accepting malformed configuration', async () => {
  for (const [field, invalid] of [
    ['engagementType', 'paid_service'],
    ['capabilityProfile', 'revenue_desk'],
    ['coverageMode', 'After Hours Only'],
    ['configurationVersion', 'wrong_version'],
  ]) {
    const fixture = createFixture();
    fixture.store.deployments.get('deployment_A')[field] = invalid;
    const result = await fixture.service.resolveInbound(inbound('A'), { signatureTimestamp: NOW });
    assert.equal(result.status, 'ConfigurationUnavailable', field);
  }
});

test('integration: Live deployment without explicit activation timestamps fails closed', async () => {
  const fixture = createFixture({ deployments: [deployment('A')], configurations: [configuration('A')], assignments: [assignment('A')] });
  fixture.store.deployments.get('deployment_A').actualStartAt = null;
  fixture.store.deployments.get('deployment_A').expiresAt = null;
  const result = await fixture.service.resolveInbound(inbound('A'), { signatureTimestamp: NOW });
  assert.equal(result.status, 'ConfigurationUnavailable');
  assert.equal(result.reasonCode, 'INVALID_SCHEMA');
  const state = await fixture.store.getDeployment('deployment_A');
  assert.equal(state.actualStartAt, null);
  assert.equal(state.expiresAt, null);
});

test('integration: exact seven-day boundary expires and records the canonical CRM-mapped stop reason', async () => {
  const fixture = createFixture({
    deployments: [deployment('A')], configurations: [configuration('A')], assignments: [assignment('A')],
  });
  const timestamp = Date.parse(EXPIRES);
  const result = await fixture.service.resolveInbound(inbound('A', { timestamp }), { signatureTimestamp: timestamp });
  assert.equal(result.status, 'ConfigurationUnavailable');
  assert.equal(result.reasonCode, 'TEST_EXPIRED');
  const state = await fixture.store.getDeployment('deployment_A');
  assert.equal(state.testStatus, 'Completed');
  assert.equal(state.stopReason, 'seven_day_limit_reached');
});

test('integration: 25 concurrent reservations admit, 25 handled calls stop the test, and the 26th fails', async () => {
  const fixture = createFixture({
    deployments: [deployment('A')], configurations: [configuration('A')], assignments: [assignment('A')],
  });
  const calls = Array.from({ length: 26 }, (_, index) => fixture.service.resolveInbound(inbound('A', {
    timestamp: NOW + index,
    fromNumber: `+1555111${String(index).padStart(4, '0')}`,
  }), { signatureTimestamp: NOW + index }));
  const results = await Promise.all(calls);
  assert.equal(results.filter(({ status }) => status === 'Resolved').length, 25);
  assert.equal(results.filter(({ status }) => status === 'ConfigurationUnavailable').length, 1);
  assert.equal(results.find(({ status }) => status === 'ConfigurationUnavailable').reasonCode, 'ADMISSION_CAPACITY_RESERVED');
  const replayPayload = inbound('A', { timestamp: NOW, fromNumber: '+15551110000' });
  const replay = await fixture.service.resolveInbound(replayPayload, { signatureTimestamp: NOW });
  assert.equal(replay.status, 'Resolved');
  let state = await fixture.store.getDeployment('deployment_A');
  assert.equal(state.admittedCallCount, 25);
  assert.equal(state.handledCallCount, 0);
  assert.equal(state.stopReason, null);
  for (let index = 0; index < 25; index += 1) {
    const event = analyzedEvent({
      callId: `call_limit_${index}`,
      metadata: results[index].response.call_inbound.metadata,
      startTimestamp: NOW + 1000 + index,
      endTimestamp: NOW + 61_000 + index,
    });
    await fixture.service.processEvent(event, { rawBody: raw(event) });
  }
  state = await fixture.store.getDeployment('deployment_A');
  assert.equal(state.handledCallCount, 25);
  assert.equal(state.stopReason, 'call_limit_reached');
  const twentySixth = await fixture.service.resolveInbound(inbound('A', {
    timestamp: NOW + 100_000,
    fromNumber: '+15551119998',
  }), { signatureTimestamp: NOW + 100_000 });
  assert.equal(twentySixth.status, 'ConfigurationUnavailable');
});

test('integration: final provider no-call evidence releases one orphan slot without counting a handled call', async () => {
  let releasableAdmissionId = null;
  const fixture = createFixture({
    deployments: [deployment('A')], configurations: [configuration('A')], assignments: [assignment('A')],
    admissionReconciliationBehavior: ({ admissionId }) => (
      admissionId === releasableAdmissionId ? 'no_call_created' : 'ambiguous'
    ),
  });
  const reservations = await Promise.all(Array.from({ length: 25 }, (_, index) => fixture.service.resolveInbound(
    inbound('A', {
      timestamp: NOW + index,
      fromNumber: `+1555222${String(index).padStart(4, '0')}`,
    }),
    { signatureTimestamp: NOW + index },
  )));
  releasableAdmissionId = reservations[0].response.call_inbound.metadata.admission_id;
  const full = await fixture.service.resolveInbound(inbound('A', {
    timestamp: NOW + 30,
    fromNumber: '+15552229999',
  }), { signatureTimestamp: NOW + 30 });
  assert.equal(full.reasonCode, 'ADMISSION_CAPACITY_RESERVED');

  const reconciliation = await fixture.service.reconcileOrphanAdmissions();
  let snapshot = await fixture.store.snapshot();
  const deploymentState = snapshot.deployments[0];
  const released = snapshot.admissions.find(({ admissionId }) => admissionId === releasableAdmissionId);
  assert.equal(reconciliation.results.filter(({ status }) => status === 'ReleasedNoCall').length, 1);
  assert.equal(reconciliation.results.filter(({ status }) => status === 'ReconciliationRequired').length, 24);
  assert.equal(deploymentState.admittedCallCount, 24);
  assert.equal(deploymentState.handledCallCount, 0);
  assert.equal(released.state, 'ReleasedNoCall');
  assert.equal(released.reconciliationState, 'ReleasedNoCall');

  const replayPayload = inbound('A', { timestamp: NOW, fromNumber: '+15552220000' });
  const releasedReplay = await fixture.service.resolveInbound(replayPayload, { signatureTimestamp: NOW });
  assert.equal(releasedReplay.status, 'ConfigurationUnavailable');
  assert.equal(releasedReplay.reasonCode, 'ADMISSION_RELEASED_NO_CALL');
  const replacement = await fixture.service.resolveInbound(inbound('A', {
    timestamp: NOW + 31,
    fromNumber: '+15552229998',
  }), { signatureTimestamp: NOW + 31 });
  assert.equal(replacement.status, 'Resolved');
  snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.deployments[0].admittedCallCount, 25);
  assert.equal(snapshot.deployments[0].handledCallCount, 0);
  assert.equal(fixture.admissionReconciliationAdapter.observations
    .filter(({ admissionId }) => admissionId === releasableAdmissionId).length, 1);
});

test('integration: ambiguous admission lookup fails closed until later final authoritative evidence', async () => {
  let providerDecision = 'ambiguous';
  const fixture = createFixture({
    deployments: [deployment('A')], configurations: [configuration('A')], assignments: [assignment('A')],
    admissionReconciliationBehavior: () => providerDecision,
  });
  const admitted = await admit(fixture, 'A');
  const first = await fixture.service.reconcileOrphanAdmissions();
  let snapshot = await fixture.store.snapshot();
  assert.equal(first.results[0].status, 'ReconciliationRequired');
  assert.equal(snapshot.admissions[0].state, 'Reserved');
  assert.equal(snapshot.admissions[0].reconciliationState, 'ReconciliationRequired');
  assert.equal(snapshot.deployments[0].admittedCallCount, 1);
  assert.equal(snapshot.deployments[0].handledCallCount, 0);

  providerDecision = 'no_call_created';
  const second = await fixture.service.reconcileOrphanAdmissions();
  snapshot = await fixture.store.snapshot();
  assert.equal(second.results[0].status, 'ReleasedNoCall');
  assert.equal(snapshot.admissions[0].admissionId, admitted.metadata.admission_id);
  assert.equal(snapshot.admissions[0].state, 'ReleasedNoCall');
  assert.equal(snapshot.deployments[0].admittedCallCount, 0);
  assert.equal(snapshot.deployments[0].handledCallCount, 0);
});

test('integration: no-call evidence with the wrong admission binding fails closed', async () => {
  const admissionReconciliationAdapter = {
    async inspect(request) {
      return {
        decision: 'NoCallCreated',
        authoritative: true,
        final: true,
        evidenceKey: 'synthetic_wrong_binding',
        bindingFingerprint: '0'.repeat(64),
        observedAt: request.observedAt,
        providerResponseCode: 'SYNTHETIC_NO_CALL_FINAL',
      };
    },
  };
  const fixture = createFixture({
    deployments: [deployment('A')], configurations: [configuration('A')], assignments: [assignment('A')],
    admissionReconciliationAdapter,
  });
  await admit(fixture, 'A');
  const reconciliation = await fixture.service.reconcileOrphanAdmissions();
  const snapshot = await fixture.store.snapshot();
  assert.equal(reconciliation.results[0].status, 'ReconciliationRequired');
  assert.equal(reconciliation.results[0].errorCode, 'INVALID_ADMISSION_RECONCILIATION_EVIDENCE');
  assert.equal(snapshot.admissions[0].state, 'Reserved');
  assert.equal(snapshot.admissions[0].reconciliationState, 'ReconciliationRequired');
  assert.equal(snapshot.deployments[0].admittedCallCount, 1);
  assert.equal(snapshot.deployments[0].handledCallCount, 0);
});

test('integration: webhook binding wins safely when it races a no-call reconciliation lease', async () => {
  let releaseInspection;
  let inspectionRequest;
  const inspectionStarted = new Promise((resolve) => { inspectionRequest = resolve; });
  const continueInspection = new Promise((resolve) => { releaseInspection = resolve; });
  const admissionReconciliationAdapter = {
    async inspect(request) {
      inspectionRequest(request);
      await continueInspection;
      return {
        decision: 'NoCallCreated',
        authoritative: true,
        final: true,
        evidenceKey: 'synthetic_race_no_call',
        bindingFingerprint: request.bindingFingerprint,
        observedAt: request.observedAt,
        providerResponseCode: 'SYNTHETIC_NO_CALL_FINAL',
      };
    },
  };
  const fixture = createFixture({
    deployments: [deployment('A')], configurations: [configuration('A')], assignments: [assignment('A')],
    admissionReconciliationAdapter,
  });
  const admitted = await admit(fixture, 'A');
  const reconciliationPromise = fixture.service.reconcileOrphanAdmissions();
  await inspectionStarted;
  const event = analyzedEvent({ callId: 'call_orphan_race', metadata: admitted.metadata });
  await fixture.service.processEvent(event, { rawBody: raw(event) });
  releaseInspection();
  const reconciliation = await reconciliationPromise;
  const snapshot = await fixture.store.snapshot();
  assert.equal(reconciliation.results[0].status, 'LeaseLost');
  assert.equal(snapshot.admissions[0].state, 'Handled');
  assert.equal(snapshot.admissions[0].reconciliationState, 'CallBound');
  assert.equal(snapshot.deployments[0].admittedCallCount, 1);
  assert.equal(snapshot.deployments[0].handledCallCount, 1);
  assert.equal(snapshot.calls.length, 1);
});

test('integration: call_ended creates incomplete durable state and call_analyzed enriches once', async () => {
  const fixture = createFixture();
  const admission = await admit(fixture, 'A');
  const ended = endedEvent({ callId: 'call_delayed_analysis', metadata: admission.metadata });
  await fixture.service.processEvent(ended, { rawBody: raw(ended) });
  let snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.calls.length, 1);
  assert.equal(snapshot.calls[0].processingState, 'AwaitingAnalysis');
  assert.equal(snapshot.notifications.length, 0);
  assert.equal(snapshot.outbox.length, 0);

  const analyzed = analyzedEvent({ callId: 'call_delayed_analysis', metadata: admission.metadata });
  await fixture.service.processEvent(analyzed, { rawBody: raw(analyzed) });
  snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.calls[0].outcome, 'potential_job');
  assert.equal(snapshot.calls[0].processingState, 'Complete');
  assert.equal(snapshot.notifications.length, 1);
  assert.equal(snapshot.notifications[0].state, 'Succeeded');
  assert.equal(snapshot.outbox.length, 1);
  assert.equal(fixture.analyticsAdapter.projections.size, 1);
});

test('integration: call_analyzed before call_ended remains enriched with one notification and one Analytics fact', async () => {
  const fixture = createFixture();
  const admission = await admit(fixture, 'A');
  const analyzed = analyzedEvent({ callId: 'call_reordered', metadata: admission.metadata });
  const ended = endedEvent({ callId: 'call_reordered', metadata: admission.metadata });
  await fixture.service.processEvent(analyzed, { rawBody: raw(analyzed) });
  await fixture.service.processEvent(ended, { rawBody: raw(ended) });
  const snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.calls.length, 1);
  assert.equal(snapshot.calls[0].outcome, 'potential_job');
  assert.equal(snapshot.calls[0].processingState, 'Complete');
  assert.equal(snapshot.notifications.length, 1);
  assert.equal(snapshot.outbox.length, 1);
  assert.equal(fixture.notificationAdapter.deliveries.size, 1);
  assert.equal(fixture.analyticsAdapter.projections.size, 1);
});

test('integration: webhook replay creates no duplicate call, notification, attempt, or Analytics projection', async () => {
  const fixture = createFixture();
  const admission = await admit(fixture, 'A');
  const event = analyzedEvent({ callId: 'call_replay', metadata: admission.metadata });
  const first = await fixture.service.processEvent(event, { rawBody: raw(event) });
  const replay = await fixture.service.processEvent(event, { rawBody: raw(event) });
  const snapshot = await fixture.store.snapshot();
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(snapshot.calls.length, 1);
  assert.equal(snapshot.notifications.length, 1);
  assert.equal(snapshot.notifications[0].attempts, 1);
  assert.equal(snapshot.outbox.length, 1);
  assert.equal(fixture.notificationAdapter.deliveries.size, 1);
  assert.equal(fixture.analyticsAdapter.projections.size, 1);
});

test('integration: notification retry honors backoff, cannot be bypassed by replay, and terminates at max attempts', async () => {
  let sends = 0;
  const fixture = createFixture({ notificationBehavior: () => { sends += 1; return 'retryable_failure'; } });
  const admission = await admit(fixture, 'A');
  const event = analyzedEvent({ callId: 'call_retry', metadata: admission.metadata });
  await assert.rejects(fixture.service.processEvent(event, { rawBody: raw(event) }), { code: 'NOTIFICATION_PROVIDER_FAILURE' });
  let snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.notifications[0].state, 'RetryRequired');
  assert.equal(snapshot.notifications[0].attempts, 1);
  assert.equal(snapshot.notifications[0].nextAttemptAt, new Date(NOW + 1000).toISOString());

  await assert.rejects(fixture.service.processEvent(event, { rawBody: raw(event) }), { code: 'NOTIFICATION_RETRY_NOT_DUE' });
  assert.equal(sends, 1);
  fixture.clock.value += 1000;
  await assert.rejects(fixture.service.processEvent(event, { rawBody: raw(event) }), { code: 'NOTIFICATION_PROVIDER_FAILURE' });
  snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.notifications[0].attempts, 2);
  assert.equal(snapshot.notifications[0].nextAttemptAt, new Date(NOW + 6000).toISOString());
  fixture.clock.value += 5000;
  const terminal = await fixture.service.processEvent(event, { rawBody: raw(event) });
  snapshot = await fixture.store.snapshot();
  assert.equal(terminal.status, 'Completed');
  assert.equal(snapshot.notifications[0].state, 'TerminalFailure');
  assert.equal(snapshot.notifications[0].attempts, 3);
  assert.equal(sends, 3);
});

test('integration: ambiguous notification result remains ReconciliationRequired and is never blindly resent', async () => {
  let sends = 0;
  const adapter = new SyntheticNotificationAdapter({ behavior: () => { sends += 1; return 'ambiguous'; } });
  const fixture = createFixture({ notificationAdapter: adapter });
  const admission = await admit(fixture, 'A');
  const event = analyzedEvent({ callId: 'call_ambiguous_notification', metadata: admission.metadata });
  await assert.rejects(fixture.service.processEvent(event, { rawBody: raw(event) }), { code: 'NOTIFICATION_PROVIDER_AMBIGUOUS' });
  await assert.rejects(fixture.service.processEvent(event, { rawBody: raw(event) }), { code: 'NOTIFICATION_RECONCILIATION_REQUIRED' });
  const snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.notifications[0].state, 'ReconciliationRequired');
  assert.equal(snapshot.receipts[0].status, 'ReconciliationRequired');
  assert.equal(sends, 1);
});

test('integration: retryable Analytics failure honors backoff and succeeds exactly once on replay', async () => {
  let upserts = 0;
  const fixture = createFixture({
    analyticsBehavior: () => { upserts += 1; return upserts === 1 ? 'retryable_failure' : 'success'; },
  });
  const admission = await admit(fixture, 'A');
  const event = analyzedEvent({ callId: 'call_analytics_retry', metadata: admission.metadata });
  await assert.rejects(fixture.service.processEvent(event, { rawBody: raw(event) }),
    { code: 'ANALYTICS_PROVIDER_FAILURE' });
  let snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.outbox[0].state, 'RetryRequired');
  assert.equal(snapshot.outbox[0].attempts, 1);
  assert.equal(snapshot.outbox[0].nextAttemptAt, new Date(NOW + 1000).toISOString());
  await assert.rejects(fixture.service.processEvent(event, { rawBody: raw(event) }),
    { code: 'ANALYTICS_RETRY_NOT_DUE' });
  assert.equal(upserts, 1);
  fixture.clock.value += 1000;
  await fixture.service.processEvent(event, { rawBody: raw(event) });
  snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.outbox[0].state, 'Succeeded');
  assert.equal(snapshot.outbox[0].attempts, 2);
  assert.equal(snapshot.receipts[0].status, 'Completed');
  assert.equal(fixture.analyticsAdapter.rows.size, 1);
  assert.equal(fixture.analyticsAdapter.projections.size, 1);
});

test('integration: retryable Analytics failure becomes terminal after the bounded third attempt', async () => {
  let upserts = 0;
  const fixture = createFixture({
    analyticsBehavior: () => { upserts += 1; return 'retryable_failure'; },
  });
  const admission = await admit(fixture, 'A');
  const event = analyzedEvent({ callId: 'call_analytics_terminal', metadata: admission.metadata });
  await assert.rejects(fixture.service.processEvent(event, { rawBody: raw(event) }),
    { code: 'ANALYTICS_PROVIDER_FAILURE' });
  fixture.clock.value += 1000;
  await assert.rejects(fixture.service.processEvent(event, { rawBody: raw(event) }),
    { code: 'ANALYTICS_PROVIDER_FAILURE' });
  fixture.clock.value += 5000;
  await assert.rejects(fixture.service.processEvent(event, { rawBody: raw(event) }),
    { code: 'ANALYTICS_TERMINAL_FAILURE' });
  const replay = await fixture.service.processEvent(event, { rawBody: raw(event) });
  const snapshot = await fixture.store.snapshot();
  assert.equal(upserts, 3);
  assert.equal(snapshot.outbox[0].state, 'TerminalFailure');
  assert.equal(snapshot.outbox[0].attempts, 3);
  assert.equal(snapshot.receipts[0].status, 'TerminalFailure');
  assert.equal(replay.status, 'TerminalFailure');
});

test('integration: Analytics retry reuses its immutable fact when later calls advance deployment progress', async () => {
  let firstAttempt = true;
  const fixture = createFixture({
    analyticsBehavior: () => {
      if (firstAttempt) {
        firstAttempt = false;
        return 'retryable_failure';
      }
      return 'success';
    },
  });
  const firstAdmission = await admit(fixture, 'A');
  const firstEvent = analyzedEvent({ callId: 'call_analytics_stable_first', metadata: firstAdmission.metadata });
  await assert.rejects(fixture.service.processEvent(firstEvent, { rawBody: raw(firstEvent) }),
    { code: 'ANALYTICS_PROVIDER_FAILURE' });
  fixture.clock.value += 1000;
  const secondAdmission = await admit(fixture, 'A', {
    timestamp: fixture.clock.value,
    fromNumber: '+15551119990',
  });
  const secondEvent = analyzedEvent({
    callId: 'call_analytics_stable_second', metadata: secondAdmission.metadata,
    startTimestamp: NOW + 2000, endTimestamp: NOW + 62_000,
  });
  await fixture.service.processEvent(secondEvent, { rawBody: raw(secondEvent) });
  await fixture.service.processEvent(firstEvent, { rawBody: raw(firstEvent) });
  const snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.outbox.length, 2);
  assert.equal(snapshot.outbox.every(({ state }) => state === 'Succeeded'), true);
  assert.equal(fixture.analyticsAdapter.projections.size, 2);
  const firstProjection = [...fixture.analyticsAdapter.projections.values()]
    .find(({ callStartedAt }) => callStartedAt === new Date(firstEvent.call.start_timestamp).toISOString());
  assert.equal(firstProjection.handledCallCount, 1);
});

test('integration: signed event from another agent is durably quarantined and replay preserves terminal failure', async () => {
  const fixture = createFixture();
  const admission = await admit(fixture, 'A');
  const event = analyzedEvent({ callId: 'call_wrong_agent', metadata: admission.metadata });
  event.call.agent_id = 'agent_wrong';
  await assert.rejects(fixture.service.processEvent(event, { rawBody: raw(event) }), { code: 'CALL_OWNERSHIP_UNRESOLVED' });
  const replay = await fixture.service.processEvent(event, { rawBody: raw(event) });
  const snapshot = await fixture.store.snapshot();
  assert.equal(replay.status, 'TerminalFailure');
  assert.equal(snapshot.receipts[0].status, 'TerminalFailure');
  assert.equal(snapshot.calls.length, 0);
});

test('integration: safe logs contain correlation and state only, never tenant, phones, recipients, or payload text', async () => {
  const fixture = createFixture();
  const admission = await admit(fixture, 'A');
  const event = analyzedEvent({ callId: 'call_safe_logs', metadata: admission.metadata });
  await fixture.service.processEvent(event, { rawBody: raw(event) });
  const failed = analyzedEvent({ callId: 'call_safe_error_logs', metadata: undefined });
  delete failed.call.to_number;
  await assert.rejects(fixture.service.processEvent(failed, { rawBody: raw(failed) }));
  const serialized = JSON.stringify(fixture.logs);
  for (const forbidden of [
    'client_A', 'deployment_A', 'cfg_A_v1', '+15550000001', '+15551110001',
    'recipient_A', 'Synthetic Caller', 'Leaking water heater', 'X-Retell-Signature',
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.match(serialized, /correlationId/);
  assert.doesNotMatch(serialized, /evt_[0-9a-f]+|receiptKey/);
});

test('integration: missing analysis is bounded to one unresolved notification and Analytics fact', async () => {
  const fixture = createFixture();
  const admitted = await admit(fixture, 'A');
  const ended = endedEvent({ callId: 'call_missing_analysis', metadata: admitted.metadata });
  await fixture.service.processEvent(ended, { rawBody: raw(ended) });
  fixture.clock.value = ended.call.end_timestamp + 900_000;
  const reconciled = await fixture.service.reconcileIncompleteCalls();
  assert.equal(reconciled.results[0].status, 'Completed');
  const replay = await fixture.service.reconcileIncompleteCalls();
  assert.equal(replay.examined, 0);
  const snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.calls[0].outcome, 'unresolved');
  assert.equal(snapshot.calls[0].processingState, 'Complete');
  assert.equal(snapshot.notifications.length, 1);
  assert.equal(snapshot.outbox.length, 1);
  assert.equal(fixture.analyticsAdapter.projections.size, 1);

  const late = analyzedEvent({ callId: 'call_missing_analysis', metadata: admitted.metadata });
  await assert.rejects(fixture.service.processEvent(late, { rawBody: raw(late) }), { code: 'LATE_ANALYSIS_AFTER_FINALIZATION' });
  const afterLate = await fixture.store.snapshot();
  assert.equal(afterLate.calls[0].outcome, 'unresolved');
  assert.equal(afterLate.notifications.length, 1);
  assert.equal(afterLate.outbox.length, 1);
});

test('integration: analyzed-before-ended with no end timestamp publishes one final fact only after end arrives', async () => {
  const fixture = createFixture();
  const admitted = await admit(fixture, 'A');
  const analyzed = analyzedEvent({ callId: 'call_end_later', metadata: admitted.metadata });
  analyzed.call.end_timestamp = null;
  await fixture.service.processEvent(analyzed, { rawBody: raw(analyzed) });
  assert.equal(fixture.analyticsAdapter.projections.size, 0);
  const ended = endedEvent({ callId: 'call_end_later', metadata: admitted.metadata });
  await fixture.service.processEvent(ended, { rawBody: raw(ended) });
  assert.equal(fixture.analyticsAdapter.projections.size, 1);
  const projection = [...fixture.analyticsAdapter.projections.values()][0];
  assert.equal(projection.callEndedAt, new Date(ended.call.end_timestamp).toISOString());
  assert.equal(projection.outcome, 'potential_job');
});

test('integration: conflicting call timestamps are terminal and cannot mutate the canonical call', async () => {
  const fixture = createFixture();
  const admitted = await admit(fixture, 'A');
  const ended = endedEvent({ callId: 'call_timestamp_conflict', metadata: admitted.metadata });
  await fixture.service.processEvent(ended, { rawBody: raw(ended) });
  const conflict = analyzedEvent({
    callId: 'call_timestamp_conflict', metadata: admitted.metadata,
    startTimestamp: ended.call.start_timestamp + 1,
    endTimestamp: ended.call.end_timestamp + 1,
  });
  await assert.rejects(fixture.service.processEvent(conflict, { rawBody: raw(conflict) }), { code: 'CALL_EVENT_CONFLICT' });
  const snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.calls[0].startedAt, new Date(ended.call.start_timestamp).toISOString());
  assert.equal(snapshot.calls[0].endedAt, new Date(ended.call.end_timestamp).toISOString());
  assert.equal(snapshot.notifications.length, 0);
});

test('integration: notification retry followed by reordered end emits one final Analytics fact with Succeeded state', async () => {
  let sends = 0;
  const fixture = createFixture({ notificationBehavior: () => { sends += 1; return sends === 1 ? 'retryable_failure' : 'success'; } });
  const admitted = await admit(fixture, 'A');
  const analyzed = analyzedEvent({ callId: 'call_retry_reordered', metadata: admitted.metadata });
  analyzed.call.end_timestamp = null;
  await assert.rejects(fixture.service.processEvent(analyzed, { rawBody: raw(analyzed) }), { code: 'NOTIFICATION_PROVIDER_FAILURE' });
  const ended = endedEvent({ callId: 'call_retry_reordered', metadata: admitted.metadata });
  await fixture.service.processEvent(ended, { rawBody: raw(ended) });
  assert.equal(fixture.analyticsAdapter.projections.size, 0);
  fixture.clock.value += 1000;
  await fixture.service.processEvent(analyzed, { rawBody: raw(analyzed) });
  const snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.notifications[0].state, 'Succeeded');
  assert.equal(snapshot.outbox.length, 1);
  assert.equal([...fixture.analyticsAdapter.projections.values()][0].notificationState, 'Succeeded');
});

test('integration: durable-call fallback revalidates immutable configuration before downstream side effects', async () => {
  const fixture = createFixture();
  const admitted = await admit(fixture, 'A');
  const ended = endedEvent({ callId: 'call_corrupt_config', metadata: admitted.metadata });
  await fixture.service.processEvent(ended, { rawBody: raw(ended) });
  fixture.store.configurations.get('deployment_A\0cfg_A_v1').notificationRecipient.recipientId = 'recipient_B';
  const analyzed = analyzedEvent({ callId: 'call_corrupt_config', metadata: undefined });
  await assert.rejects(fixture.service.processEvent(analyzed, { rawBody: raw(analyzed) }), { code: 'CONFIGURATION_IMMUTABILITY_FAILURE' });
  const snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.notifications.length, 0);
  assert.equal(snapshot.outbox.length, 0);
});

test('integration: event agent version is mandatory and pinned before ownership or side effects', async () => {
  for (const mode of ['missing', 'wrong']) {
    const fixture = createFixture();
    const admitted = await admit(fixture, 'A');
    const event = analyzedEvent({ callId: `call_agent_version_${mode}`, metadata: admitted.metadata });
    if (mode === 'missing') delete event.call.agent_version;
    else event.call.agent_version += 1;
    await assert.rejects(fixture.service.processEvent(event, { rawBody: raw(event) }));
    const snapshot = await fixture.store.snapshot();
    assert.equal(snapshot.calls.length, 0);
    assert.equal(snapshot.notifications.length, 0);
    assert.equal(snapshot.receipts[0].status, 'TerminalFailure');
  }
});

test('integration: one correlation ID spans admission, call, receipt, notification, outbox, and Analytics', async () => {
  const fixture = createFixture();
  const admitted = await admit(fixture, 'A');
  const event = analyzedEvent({ callId: 'call_correlation', metadata: admitted.metadata });
  await fixture.service.processEvent(event, { rawBody: raw(event) });
  const snapshot = await fixture.store.snapshot();
  const expected = admitted.result.correlationId;
  assert.equal(admitted.metadata.correlation_id, expected);
  assert.equal(snapshot.admissions[0].correlationId, expected);
  assert.equal(snapshot.calls[0].correlationId, expected);
  assert.equal(snapshot.receipts[0].correlationId, expected);
  assert.equal(snapshot.notifications[0].correlationId, expected);
  assert.equal(snapshot.outbox[0].correlationId, expected);
  assert.equal([...fixture.analyticsAdapter.projections.values()][0].correlationId, expected);
});

test('integration: immediate-danger safety flag survives notification and reporting projection', async () => {
  const fixture = createFixture();
  const admitted = await admit(fixture, 'A');
  const event = analyzedEvent({
    callId: 'call_safety_flag', metadata: admitted.metadata,
    data: { outcome: 'urgent_potential_job', urgency: 'immediate_danger' },
  });
  await fixture.service.processEvent(event, { rawBody: raw(event) });
  const snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.notifications[0].payload.safetyFlag, true);
  const projection = [...fixture.analyticsAdapter.projections.values()][0];
  assert.equal(projection.safetyFlag, true);
  assert.equal(projection.urgency, 'immediate_danger');
});

test('integration: incomplete-call reconciliation resumes safely after a notification retry', async () => {
  let sends = 0;
  const fixture = createFixture({ notificationBehavior: () => { sends += 1; return sends === 1 ? 'retryable_failure' : 'success'; } });
  const admitted = await admit(fixture, 'A');
  const ended = endedEvent({ callId: 'call_reconcile_retry', metadata: admitted.metadata });
  await fixture.service.processEvent(ended, { rawBody: raw(ended) });
  fixture.clock.value = ended.call.end_timestamp + 900_000;
  const first = await fixture.service.reconcileIncompleteCalls();
  assert.equal(first.results[0].status, 'RetryRequired');
  let snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.calls[0].processingState, 'FinalizingWithoutAnalysis');
  assert.equal(snapshot.notifications[0].state, 'RetryRequired');
  fixture.clock.value += 30_000;
  const second = await fixture.service.reconcileIncompleteCalls();
  assert.equal(second.results[0].status, 'Completed');
  snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.calls[0].processingState, 'Complete');
  assert.equal(snapshot.notifications[0].state, 'Succeeded');
  assert.equal(snapshot.outbox.length, 1);
  assert.equal(sends, 2);
});

test('integration: stale Sending notification requires readback and is never blindly resent', async () => {
  const fixture = createFixture();
  const admitted = await admit(fixture, 'A');
  const ended = endedEvent({ callId: 'call_stale_sending', metadata: admitted.metadata });
  await fixture.service.processEvent(ended, { rawBody: raw(ended) });
  const call = (await fixture.store.snapshot()).calls[0];
  await fixture.store.applyCallAnalysis(call.callKey, {
    analysisReady: true,
    analysisFinalized: true,
    analysisSource: 'retell',
    processingState: 'Complete',
    outcome: 'potential_job',
    coverageTrigger: 'AfterHours',
    callerName: 'Synthetic Caller A',
    callbackNumber: '+15551110001',
    customerType: 'new',
    callerIntent: 'request_service',
    issueSummary: 'Leaking water heater',
    cityOrZip: 'Lenexa',
    urgency: 'routine',
    specificPersonRequested: null,
    valueEvidenceClass: 'unknown',
    valueMinorUnits: null,
    valueCurrency: null,
    valueMethodId: null,
    valueMethodVersion: null,
    sensitiveDataMinimized: false,
  });
  await fixture.store.ensureNotification({
    notificationId: `${call.callKey}:client_notification_v1`,
    callKey: call.callKey,
    correlationId: call.correlationId,
    sourceRevision: runtimeConfig.sourceRevision,
    sourceEnvironment: runtimeConfig.environment,
    clientId: call.clientId,
    deploymentId: call.deploymentId,
    configurationVersion: call.configurationVersion,
    recipientId: 'recipient_A',
    payload: {
      callerName: 'Synthetic Caller A', callbackNumber: '+15551110001', customerType: 'new', cityOrZip: 'Lenexa',
      issueSummary: 'Leaking water heater', urgency: 'routine', specificPersonRequested: null, safetyFlag: false,
      callTimestamp: call.startedAt, callOutcome: 'potential_job',
    },
    state: 'Sending', attempts: 1, providerReference: null, providerResponseCode: null,
    lastErrorCode: null, createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(),
    lastAttemptAt: new Date(NOW).toISOString(), nextAttemptAt: null,
  });
  const analyzed = analyzedEvent({ callId: 'call_stale_sending', metadata: admitted.metadata });
  await assert.rejects(fixture.service.processEvent(analyzed, { rawBody: raw(analyzed) }),
    { code: 'NOTIFICATION_RECONCILIATION_REQUIRED' });
  const snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.notifications[0].state, 'ReconciliationRequired');
  assert.equal(fixture.notificationAdapter.deliveries.size, 0);
});

test('integration: inbound shared-agent version mismatch fails closed with no admission', async () => {
  const fixture = createFixture();
  const payload = inbound('A');
  payload.call_inbound.agent_version += 1;
  const result = await fixture.service.resolveInbound(payload, { signatureTimestamp: NOW });
  assert.equal(result.status, 'ConfigurationUnavailable');
  assert.equal((await fixture.store.snapshot()).admissions.length, 0);
});
