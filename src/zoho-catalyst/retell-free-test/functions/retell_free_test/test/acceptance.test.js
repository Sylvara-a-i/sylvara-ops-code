'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NOW,
  deployment,
  configuration,
  assignment,
  createFixture,
  inbound,
  admit,
  analyzedEvent,
  raw,
} = require('./helpers');

test('acceptance: two clients share one agent with isolated conversation, persistence, notification, and Analytics', async () => {
  const fixture = createFixture();
  const admittedA = await admit(fixture, 'A');
  const admittedB = await admit(fixture, 'B');
  assert.equal(admittedA.result.response.call_inbound.override_agent_id, admittedB.result.response.call_inbound.override_agent_id);
  const varsA = admittedA.result.response.call_inbound.dynamic_variables;
  const varsB = admittedB.result.response.call_inbound.dynamic_variables;
  assert.equal(varsA.client_id, 'client_A');
  assert.equal(varsB.client_id, 'client_B');
  assert.match(varsA.company_name, /Alpha/);
  assert.match(varsB.company_name, /Beta/);
  assert.match(varsA.service_area_json, /Lenexa/);
  assert.doesNotMatch(varsA.service_area_json, /Liberty/);
  assert.match(varsB.urgent_conditions_json, /sewage backup/);
  assert.doesNotMatch(varsB.urgent_conditions_json, /uncontrolled leak/);

  const eventA = analyzedEvent({ callId: 'call_isolation_A', metadata: admittedA.metadata, letter: 'A' });
  const eventB = analyzedEvent({ callId: 'call_isolation_B', metadata: admittedB.metadata, letter: 'B' });
  await fixture.service.processEvent(eventA, { rawBody: raw(eventA) });
  await fixture.service.processEvent(eventB, { rawBody: raw(eventB) });
  const snapshot = await fixture.store.snapshot();
  assert.deepEqual(snapshot.calls.map(({ clientId }) => clientId).sort(), ['client_A', 'client_B']);
  assert.deepEqual(snapshot.notifications.map(({ recipientId }) => recipientId).sort(), ['recipient_A', 'recipient_B']);
  assert.equal(snapshot.notifications.find(({ clientId }) => clientId === 'client_A').recipientId, 'recipient_A');
  assert.equal(snapshot.notifications.find(({ clientId }) => clientId === 'client_B').recipientId, 'recipient_B');
  assert.deepEqual([...fixture.analyticsAdapter.projections.values()].map(({ clientId }) => clientId).sort(), ['client_A', 'client_B']);
});

test('acceptance: replaying Client A changes neither Client B nor any durable count', async () => {
  const fixture = createFixture();
  const admittedA = await admit(fixture, 'A');
  const admittedB = await admit(fixture, 'B');
  const eventA = analyzedEvent({ callId: 'call_replay_A', metadata: admittedA.metadata, letter: 'A' });
  const eventB = analyzedEvent({ callId: 'call_replay_B', metadata: admittedB.metadata, letter: 'B' });
  await fixture.service.processEvent(eventA, { rawBody: raw(eventA) });
  await fixture.service.processEvent(eventB, { rawBody: raw(eventB) });
  const before = await fixture.store.snapshot();
  await fixture.service.processEvent(eventA, { rawBody: raw(eventA) });
  const after = await fixture.store.snapshot();
  assert.equal(after.calls.length, before.calls.length);
  assert.equal(after.notifications.length, before.notifications.length);
  assert.equal(after.outbox.length, before.outbox.length);
  assert.deepEqual(after.deployments.find(({ clientId }) => clientId === 'client_B'),
    before.deployments.find(({ clientId }) => clientId === 'client_B'));
});

test('acceptance: concurrent webhook replay has one call, one attempt/delivery, and one Analytics projection', async () => {
  const fixture = createFixture();
  const admitted = await admit(fixture, 'A');
  const event = analyzedEvent({ callId: 'call_concurrent_replay', metadata: admitted.metadata });
  const [one, two] = await Promise.all([
    fixture.service.processEvent(event, { rawBody: raw(event) }),
    fixture.service.processEvent(event, { rawBody: raw(event) }),
  ]);
  assert.ok([one.status, two.status].includes('InProgress'));
  const snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.calls.length, 1);
  assert.equal(snapshot.notifications.length, 1);
  assert.equal(snapshot.notifications[0].attempts, 1);
  assert.equal(fixture.notificationAdapter.deliveries.size, 1);
  assert.equal(fixture.analyticsAdapter.projections.size, 1);
});

test('acceptance: atomic number reassignment resolves new calls to B while delayed admitted A call remains A', async () => {
  const fixture = createFixture({ assignments: [assignment('A')] });
  const admittedA = await admit(fixture, 'A', { timestamp: NOW - 60_000 });
  const reassignedAt = new Date(NOW).toISOString();
  await fixture.store.retireAndAssignNumber({
    retiredAssignmentId: 'assignment_A_v1',
    retiredAt: reassignedAt,
    replacement: assignment('B', {
      assignmentId: 'assignment_A_number_to_B_v2',
      assignmentVersion: 2,
      toNumber: '+15550000001',
      effectiveFrom: reassignedAt,
    }),
  });
  const newB = await fixture.service.resolveInbound(inbound('B', {
    toNumber: '+15550000001',
    timestamp: NOW + 1,
    fromNumber: '+15551119999',
  }), { signatureTimestamp: NOW + 1 });
  assert.equal(newB.response.call_inbound.metadata.client_id, 'client_B');
  assert.equal(newB.response.call_inbound.metadata.number_assignment_version, '2');

  const delayedOldA = analyzedEvent({
    callId: 'call_delayed_old_A',
    metadata: undefined,
    letter: 'A',
    startTimestamp: NOW - 59_000,
    endTimestamp: NOW - 1000,
  });
  await fixture.service.processEvent(delayedOldA, { rawBody: raw(delayedOldA) });
  const snapshot = await fixture.store.snapshot();
  const oldCall = snapshot.calls.find(({ correlationId }) => correlationId);
  assert.equal(oldCall.clientId, 'client_A');
  assert.equal(oldCall.assignmentId, 'assignment_A_v1');
  assert.equal(snapshot.notifications[0].recipientId, 'recipient_A');
});

test('acceptance: number reassignment rejects missing target configuration, mismatches, overlap, and stale version', async (t) => {
  const cases = [
    ['missing target config', assignment('B', { deploymentId: 'deployment_missing', assignmentId: 'replacement_1', assignmentVersion: 2 })],
    ['wrong client', assignment('B', { clientId: 'client_A', assignmentId: 'replacement_2', assignmentVersion: 2 })],
    ['wrong version', assignment('B', { configurationVersion: 'cfg_wrong', assignmentId: 'replacement_3', assignmentVersion: 2 })],
    ['wrong agent', assignment('B', { agentId: 'agent_wrong', assignmentId: 'replacement_4', assignmentVersion: 2 })],
    ['stale version', assignment('B', { assignmentId: 'replacement_5', assignmentVersion: 1 })],
  ];
  for (const [name, replacement] of cases) {
    await t.test(name, async () => {
      const fixture = createFixture();
      replacement.toNumber = '+15550000001';
      replacement.effectiveFrom = new Date(NOW).toISOString();
      await assert.rejects(fixture.store.retireAndAssignNumber({
        retiredAssignmentId: 'assignment_A_v1',
        retiredAt: replacement.effectiveFrom,
        replacement,
      }), { code: 'ASSIGNMENT_REPLACEMENT_INVALID' });
    });
  }
  await t.test('overlap', async () => {
    const overlapping = assignment('B', {
      assignmentId: 'overlap_existing',
      assignmentVersion: 2,
      toNumber: '+15550000001',
      effectiveFrom: new Date(NOW + 120_000).toISOString(),
    });
    const fixture = createFixture({ assignments: [assignment('A'), assignment('B'), overlapping] });
    await assert.rejects(fixture.store.retireAndAssignNumber({
      retiredAssignmentId: 'assignment_A_v1',
      retiredAt: new Date(NOW).toISOString(),
      replacement: assignment('B', {
        assignmentId: 'replacement_overlap',
        assignmentVersion: 3,
        toNumber: '+15550000001',
        effectiveFrom: new Date(NOW).toISOString(),
      }),
    }), { code: 'ASSIGNMENT_REPLACEMENT_INVALID' });
  });
  await t.test('target already has an active dedicated number', async () => {
    const fixture = createFixture();
    const cutover = new Date(NOW).toISOString();
    await assert.rejects(fixture.store.retireAndAssignNumber({
      retiredAssignmentId: 'assignment_A_v1',
      retiredAt: cutover,
      replacement: assignment('B', {
        assignmentId: 'replacement_second_number',
        assignmentVersion: 2,
        toNumber: '+15550000001',
        effectiveFrom: cutover,
      }),
    }), { code: 'ASSIGNMENT_REPLACEMENT_INVALID' });
  });
  await t.test('future cutover leaves the current route active', async () => {
    const fixture = createFixture({ assignments: [assignment('A')] });
    const future = new Date(NOW + 60_000).toISOString();
    await assert.rejects(fixture.store.retireAndAssignNumber({
      retiredAssignmentId: 'assignment_A_v1',
      retiredAt: future,
      replacement: assignment('B', {
        assignmentId: 'replacement_future', assignmentVersion: 2,
        toNumber: '+15550000001', effectiveFrom: future,
      }),
    }), { code: 'ASSIGNMENT_REPLACEMENT_INVALID' });
    const stillA = await fixture.service.resolveInbound(inbound('A'), { signatureTimestamp: NOW });
    assert.equal(stillA.response.call_inbound.metadata.client_id, 'client_A');
  });
  await t.test('zero-length history is rejected', async () => {
    const fixture = createFixture({ assignments: [assignment('A', { effectiveFrom: new Date(NOW).toISOString() })] });
    const cutover = new Date(NOW).toISOString();
    await assert.rejects(fixture.store.retireAndAssignNumber({
      retiredAssignmentId: 'assignment_A_v1', retiredAt: cutover,
      replacement: assignment('B', {
        assignmentId: 'replacement_zero', assignmentVersion: 2,
        toNumber: '+15550000001', effectiveFrom: cutover,
      }),
    }), { code: 'ASSIGNMENT_REPLACEMENT_INVALID' });
  });
  await t.test('replacement assignment ID cannot overwrite an existing record', async () => {
    const fixture = createFixture({ assignments: [assignment('A')] });
    const cutover = new Date(NOW).toISOString();
    await assert.rejects(fixture.store.retireAndAssignNumber({
      retiredAssignmentId: 'assignment_A_v1', retiredAt: cutover,
      replacement: assignment('B', {
        assignmentId: 'assignment_A_v1', assignmentVersion: 2,
        toNumber: '+15550000001', effectiveFrom: cutover,
      }),
    }), { code: 'ASSIGNMENT_REPLACEMENT_INVALID' });
  });
  const ineligibleTargets = [
    ['stopped', (target) => { target.testStatus = 'Stopped'; }],
    ['approval revoked', (target) => { target.goLiveApprovalStatus = 'Revoked'; }],
    ['expired', (target) => { target.expiresAt = new Date(NOW).toISOString(); }],
    ['call capacity exhausted', (target) => {
      target.admittedCallCount = 25;
      target.handledCallCount = 25;
    }],
  ];
  for (const [name, makeIneligible] of ineligibleTargets) {
    await t.test(`ineligible replacement target: ${name}`, async () => {
      const fixture = createFixture({ assignments: [assignment('A')] });
      makeIneligible(fixture.store.deployments.get('deployment_B'));
      const cutover = new Date(NOW).toISOString();
      await assert.rejects(fixture.store.retireAndAssignNumber({
        retiredAssignmentId: 'assignment_A_v1',
        retiredAt: cutover,
        replacement: assignment('B', {
          assignmentId: `replacement_ineligible_${name.replace(/[^a-z]+/g, '_')}`,
          assignmentVersion: 2,
          toNumber: '+15550000001',
          effectiveFrom: cutover,
        }),
      }), { code: 'ASSIGNMENT_REPLACEMENT_INVALID' });
      const snapshot = await fixture.store.snapshot();
      assert.equal(snapshot.assignments.length, 1);
      assert.equal(snapshot.assignments[0].assignmentId, 'assignment_A_v1');
      assert.equal(snapshot.assignments[0].status, 'Active');
      assert.equal(snapshot.assignments[0].effectiveTo, null);
    });
  }
});

test('acceptance: Client A number with otherwise-valid Client B metadata fails with zero downstream side effects', async () => {
  const fixture = createFixture();
  const admittedB = await admit(fixture, 'B');
  const contaminated = analyzedEvent({ callId: 'call_cross_number_metadata', metadata: admittedB.metadata, letter: 'A' });
  await assert.rejects(fixture.service.processEvent(contaminated, { rawBody: raw(contaminated) }), { code: 'CALL_OWNERSHIP_UNRESOLVED' });
  const snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.calls.length, 0);
  assert.equal(snapshot.notifications.length, 0);
  assert.equal(snapshot.outbox.length, 0);
  assert.equal(snapshot.receipts[0].status, 'TerminalFailure');
});

test('acceptance: shared agent alone is ambiguous across two eligible clients and fails closed', async () => {
  const fixture = createFixture();
  const event = analyzedEvent({ callId: 'call_agent_only_ambiguous', metadata: undefined });
  delete event.call.to_number;
  await assert.rejects(fixture.service.processEvent(event, { rawBody: raw(event) }), { code: 'CALL_OWNERSHIP_UNRESOLVED' });
  const snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.calls.length, 0);
  assert.equal(snapshot.receipts[0].status, 'TerminalFailure');
});

test('acceptance: malformed event with a usable call ID is durably terminal and sends nothing', async () => {
  const fixture = createFixture();
  const malformed = {
    event: 'call_analyzed',
    call: { call_id: 'call_malformed', agent_id: 'agent_shared_free_test' },
  };
  await assert.rejects(fixture.service.processEvent(malformed, { rawBody: raw(malformed) }), { code: 'INVALID_SCHEMA' });
  const snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.receipts.length, 1);
  assert.equal(snapshot.receipts[0].status, 'TerminalFailure');
  assert.equal(snapshot.calls.length, 0);
  assert.equal(snapshot.notifications.length, 0);
  assert.equal(snapshot.outbox.length, 0);
});

test('acceptance: reporting projection is client-partitioned, final-outcome only, and carries progress/value evidence', async () => {
  const fixture = createFixture();
  const admitted = await admit(fixture, 'A');
  const event = analyzedEvent({
    callId: 'call_reporting',
    metadata: admitted.metadata,
    data: {
      outcome: 'urgent_potential_job',
      urgency: 'urgent',
      value_evidence_class: 'customer_supplied_estimate',
      value_minor_units: 25000,
      value_currency: 'USD',
    },
  });
  await fixture.service.processEvent(event, { rawBody: raw(event) });
  assert.equal(fixture.analyticsAdapter.projections.size, 1);
  const projection = [...fixture.analyticsAdapter.projections.values()][0];
  assert.equal(projection.clientId, 'client_A');
  assert.equal(projection.outcome, 'urgent_potential_job');
  assert.equal(projection.notificationState, 'Succeeded');
  assert.equal(projection.coverageTrigger, 'AfterHours');
  assert.equal(projection.callLimit, 25);
  assert.equal(projection.admittedCallCount, 1);
  assert.equal(projection.handledCallCount, 1);
  assert.equal(projection.callLimitProgress, 1 / 25);
  assert.ok(projection.testPeriodProgress > 0 && projection.testPeriodProgress < 1);
  assert.equal(projection.valueEvidenceClass, 'customer_supplied_estimate');
  assert.equal(projection.valueMinorUnits, 25000);
  assert.equal(projection.valueCurrency, 'USD');
});

test('acceptance: body event timestamp cannot drift outside the verified Retell signature window', async () => {
  const fixture = createFixture();
  const payload = inbound('A');
  const result = await fixture.service.resolveInbound(payload, { signatureTimestamp: NOW + 300_001 });
  assert.equal(result.status, 'ConfigurationUnavailable');
  assert.equal(result.reasonCode, 'EVENT_TIMESTAMP_MISMATCH');
  const snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.admissions.length, 0);
});

test('acceptance: volunteered sensitive information is absent from canonical call, notification, Analytics, and logs', async () => {
  const fixture = createFixture();
  const admitted = await admit(fixture, 'A');
  const event = analyzedEvent({
    callId: 'call_sensitive_retention',
    metadata: admitted.metadata,
    data: { issue_summary: 'My bank account is 123456789', outcome: 'potential_job' },
  });
  await fixture.service.processEvent(event, { rawBody: raw(event) });
  const snapshot = await fixture.store.snapshot();
  const serialized = JSON.stringify({
    calls: snapshot.calls,
    notifications: snapshot.notifications,
    outbox: snapshot.outbox,
    analytics: [...fixture.analyticsAdapter.projections.values()],
    logs: fixture.logs,
  });
  assert.equal(snapshot.calls[0].outcome, 'sensitive_data_ended');
  assert.equal(snapshot.calls[0].issueSummary, null);
  assert.doesNotMatch(serialized, /123456789|bank account/);
});

test('acceptance: card-like digits presented as a callback number are minimized before every downstream store', async () => {
  const fixture = createFixture();
  const admitted = await admit(fixture, 'A');
  const event = analyzedEvent({
    callId: 'call_card_in_callback',
    metadata: admitted.metadata,
    data: { callback_number: '+378282246310005' },
  });
  await fixture.service.processEvent(event, { rawBody: raw(event) });
  const snapshot = await fixture.store.snapshot();
  assert.equal(snapshot.calls[0].outcome, 'sensitive_data_ended');
  assert.equal(snapshot.calls[0].callbackNumber, null);
  assert.equal(snapshot.calls[0].sensitiveDataMinimized, true);
  assert.equal(snapshot.notifications[0].payload.callbackNumber, null);
  assert.equal([...fixture.analyticsAdapter.projections.values()][0].outcome, 'sensitive_data_ended');
  assert.doesNotMatch(JSON.stringify({ snapshot, logs: fixture.logs }), /378282246310005/);
});
