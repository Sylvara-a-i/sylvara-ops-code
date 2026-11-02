'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { runtimeFixture, invoke, payloadInbound } = require('./runtime-fixture');
const { RevenueDeskError } = require('../lib/errors');
const { createRuntimeService } = require('../lib/runtime-service');
const { CatalystMailAdapter } = require('../lib/catalyst-mail');
const sample = require('./fixtures/retell-webhooks.json');
const sampleBefore = JSON.stringify(sample);
const { projectRawUsageEvidence } = require('../lib/raw-usage-evidence');

test.after(() => {
  assert.equal(JSON.stringify(sample), sampleBefore, 'source transcript fixture stays unchanged');
  assert.deepEqual(guard.blocked, []);
  guard.restore();
});

async function admitted() {
  const f = runtimeFixture();
  const response = await invoke(f.listener, { url: '/retell/inbound',
    payload: payloadInbound('A'), env: f.env });
  assert.equal(response.status, 200);
  const payload = (event) => ({ event, call: {
    ...structuredClone(sample.call), metadata: response.body.call_inbound.metadata,
    ...(event === 'call_analyzed' ? { call_analysis: {
      custom_analysis_data: structuredClone(sample.analysis),
    } } : {}),
  } });
  return { f, payload };
}

function assertSettled(f) {
  const calls = f.store.rows.get('RevenueDeskCalls');
  const notifications = f.store.rows.get('RevenueDeskNotifications');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].PROCESSING_STATE, 'Completed');
  assert.equal(f.store.rows.get('RevenueDeskDeployments')[0].HANDLED_COUNT, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].STATUS, 'DryRunRecorded');
  assert.equal(notifications[0].ATTEMPT_COUNT, 0);
  assert.equal(f.mailAccesses, 0);
  const canonical = JSON.parse(calls[0].CANONICAL_CALL_JSON);
  assert.equal(canonical.issueSummary, sample.analysis.issue_summary);
  assert.equal(canonical.durationMs, sample.call.duration_ms);
  assert.equal(canonical.officeFollowUpRequired, true);
  const projection = projectRawUsageEvidence({ rows: calls, complete: true,
    scope: usageScope(calls[0]) });
  assert.equal(projection.calls.length, 1);
  assert.equal(projection.calls[0].durationMs, sample.call.duration_ms);
  assert.deepEqual(projection.calls[0].holds, []);
  assertNoncharging(projection.calls[0]);
  // The approved runtime minimizes provider artifacts; it does not retain raw
  // transcripts. Preserve the input and structured detail without changing that policy.
  const stored = JSON.stringify({ rows: [...f.store.rows], logs: f.logs });
  assert.equal(stored.includes(JSON.stringify(sample.call.transcript).slice(1, -1)), false);
  for (const turn of sample.call.transcript_object) assert.equal(stored.includes(turn.content), false);
  assert.equal(stored.includes(sample.call.recording_url), false);
  assert.equal(f.store.rows.get('AnalyticsSyncOutbox')
    .filter((row) => row.RECORD_TYPE === 'call').length, 1);
}

// This file is already selected by the offline runner and canonical verifier.
// Keep the focused projection regressions under the same installed offline guard.
function usageScope(row) {
  return { environment: row.SOURCE_ENVIRONMENT, clientId: row.CLIENT_ID,
    deploymentId: row.DEPLOYMENT_ID, configurationVersionId: row.CONFIGURATION_VERSION_ID,
    configurationVersion: row.CONFIGURATION_VERSION };
}

function usageRow(overrides = {}, columns = {}) {
  const body = { schemaVersion: 2, notificationPayloadVersion: 2,
    callKey: `call_${'a'.repeat(64)}`, clientId: 'client_synthetic', deploymentId: 'deployment_synthetic',
    configurationVersionId: 'configuration_synthetic', configurationVersion: 'v1',
    correlationId: 'correlation_synthetic', bindingId: 'binding_synthetic', bindingVersion: 1,
    engagementType: 'free_test', capabilityProfile: 'call_gap_monitor_v1',
    startedAt: '2026-08-31T23:59:45.000Z', endedAt: '2026-09-01T00:00:15.000Z',
    durationMs: 29001, callStatus: 'ended', disconnectionReason: 'user_hangup', ...overrides };
  return { CALL_KEY: body.callKey, CLIENT_ID: body.clientId, DEPLOYMENT_ID: body.deploymentId,
    CONFIGURATION_VERSION_ID: body.configurationVersionId, CONFIGURATION_VERSION: body.configurationVersion,
    ENGAGEMENT_TYPE: body.engagementType, CAPABILITY_PROFILE: body.capabilityProfile,
    CORRELATION_ID: body.correlationId, BINDING_ID: body.bindingId, BINDING_VERSION: body.bindingVersion,
    STARTED_AT: body.startedAt, ENDED_AT: body.endedAt, SOURCE_ENVIRONMENT: 'development',
    SOURCE_REVISION: 'b'.repeat(40), CANONICAL_CALL_JSON: JSON.stringify(body), ...columns };
}

function project(rows, options = {}) {
  return projectRawUsageEvidence({ rows, scope: usageScope(usageRow()), complete: true, ...options });
}

function assertNoncharging(value) {
  assert.equal(value.billableMinutes, null);
  assert.equal(value.chargeMinor, null);
  assert.equal(value.billingAuthority, false);
}

test('usage projection deduplicates durable snapshots by CALL_KEY across analysis revisions and order', () => {
  const original = usageRow();
  const revised = usageRow({ outcome: 'different_analysis', issueSummary: 'synthetic private detail' },
    { CALL_VERSION: 22, EVENT_KEY: 'synthetic_different_event', SOURCE_REVISION: 'c'.repeat(40) });
  const inputs = [original, revised, original];
  const before = structuredClone(inputs);
  const forward = project(inputs);
  assert.deepEqual(forward, project([...inputs].reverse()));
  assert.equal(forward.calls.length, 1);
  assert.equal(forward.calls[0].durationMs, 29001);
  assert.equal(forward.calls[0].evidenceFingerprint, project([original]).calls[0].evidenceFingerprint);
  assert.deepEqual(forward.calls[0].holds, []);
  assert.deepEqual(inputs, before);
  assertNoncharging(forward);
});

for (const [name, change, duration, hold] of [
  ['zero', { durationMs: 0 }, 0, null],
  ['maximum', { durationMs: 86400000 }, 86400000, null],
  ['missing', { durationMs: undefined }, null, 'duration_invalid'],
  ['null', { durationMs: null }, null, 'duration_invalid'],
  ['text', { durationMs: '29001' }, null, 'duration_invalid'],
  ['fraction', { durationMs: 1.5 }, null, 'duration_invalid'],
  ['negative', { durationMs: -1 }, null, 'duration_invalid'],
  ['overflow', { durationMs: Number.MAX_SAFE_INTEGER + 1 }, null, 'duration_invalid'],
  ['outside provider bound', { durationMs: 86400001 }, null, 'duration_invalid'],
  ['historical v1', { schemaVersion: 1 }, null, 'historical_duration_unsupported'],
  ['unknown schema', { schemaVersion: 3 }, null, 'schema_unsupported'],
]) {
  test(`raw duration preserves ${name} without computation or coercion`, () => {
    const row = usageRow(change);
    const before = structuredClone(row);
    const output = project([row]).calls[0];
    assert.equal(output.durationMs, duration);
    if (hold) assert.ok(output.holds.includes(hold));
    else assert.deepEqual(output.holds, []);
    assertNoncharging(output);
    assert.deepEqual(row, before, 'including historical schema v1 bytes');
  });
}

for (const change of [{ durationMs: 4 }, { startedAt: '2026-08-31T23:59:44.000Z' },
  { endedAt: '2026-09-01T00:00:16.000Z' }, { engagementType: 'paid_service' },
  { callStatus: 'error' }, { disconnectionReason: 'error_synthetic' },
  { bindingId: 'other_binding' }, { numberLookupHash: `num_${'d'.repeat(64)}` },
  { coverageMode: 'OverflowOnly' }]) {
  test(`conflicting immutable usage evidence is held: ${Object.keys(change)[0]}`, () => {
    const rows = [usageRow(), usageRow(change)];
    const output = project(rows);
    assert.deepEqual(output, project([...rows].reverse()));
    assert.equal(output.calls.length, 1);
    assert.equal(output.calls[0].durationMs, null);
    assert.ok(output.calls[0].holds.includes('immutable_evidence_conflict'));
  });
}

for (const column of ['CLIENT_ID', 'DEPLOYMENT_ID', 'CONFIGURATION_VERSION_ID',
  'CONFIGURATION_VERSION', 'SOURCE_ENVIRONMENT']) {
  test(`wrong usage scope never leaks or creates a second duration: ${column}`, () => {
    const foreign = usageRow({}, { [column]: 'foreign' });
    assert.equal(project([foreign]).calls.length, 0);
    const output = project([usageRow(), foreign]);
    assert.ok(output.holds.includes('scope_conflict'));
    assert.equal(output.calls.length, 1);
    assert.equal(output.calls[0].durationMs, null);
  });
}

test('cross-period, error, not-connected and free-test facts stay raw and noncharging', () => {
  for (const callStatus of ['ended', 'error', 'not_connected']) {
    const output = project([usageRow({ callStatus })]);
    assert.equal(output.calls[0].durationMs, 29001, 'never end minus start, rounded or allocated');
    assert.equal(output.calls[0].startedAt, '2026-08-31T23:59:45.000Z');
    assert.equal(output.calls[0].endedAt, '2026-09-01T00:00:15.000Z');
    assert.equal(output.calls[0].callStatus, callStatus);
    assert.equal(output.calls[0].engagementType, 'free_test');
    assertNoncharging(output.calls[0]);
    assert.equal(output.completeness.providerCompleteness, 'unproven');
  }
});

test('invalid scope cannot assert scoped read completeness', () => {
  const output = projectRawUsageEvidence({ scope: {}, rows: [], complete: true });
  assert.equal(output.completeness.scopedReadComplete, false);
  assert.deepEqual(output.holds, ['scope_invalid']);
  assert.deepEqual(output.calls, []);
  assertNoncharging(output);
  assert.equal(project([]).completeness.scopedReadComplete, true, 'valid empty scoped read stays complete');
});

test('malformed rows and incomplete reads cannot imply complete evidence', () => {
  assert.ok(project(null).holds.includes('snapshot_invalid'));
  assert.ok(project([null]).holds.includes('call_key_invalid'));
  assert.ok(project([usageRow()], { scope: {} }).holds.includes('scope_invalid'));
  const invalid = project([usageRow({}, { CANONICAL_CALL_JSON: '{' })]).calls[0];
  assert.ok(invalid.holds.includes('canonical_invalid'));
  assert.equal(invalid.durationMs, null);
  const binding = project([usageRow({}, { STARTED_AT: 'wrong' })]).calls[0];
  assert.ok(binding.holds.includes('canonical_binding_conflict'));
  assert.equal(binding.durationMs, null);
  const partial = project([usageRow()], { complete: false });
  assert.equal(partial.completeness.scopedReadComplete, false);
  assert.ok(partial.calls[0].holds.includes('snapshot_incomplete'));
  assert.equal(partial.calls[0].rawEvidenceComplete, false);
  const enriched = project([usageRow({ endedAt: null, disconnectionReason: null }), usageRow()]);
  assert.deepEqual(enriched.calls[0].holds, []);
  assert.equal(enriched.calls[0].durationMs, 29001);
});

test('usage output is a privacy allowlist and has no side-effect dependencies', () => {
  const forbidden = { transcript: 'synthetic-private-marker', recordingUrl: 'synthetic-private-marker',
    callerName: 'synthetic-private-marker', callbackNumber: 'synthetic-private-marker',
    fullJSON: { private: 'synthetic-private-marker' }, issueSummary: 'synthetic-private-marker' };
  const row = usageRow(forbidden, forbidden);
  const writes = [];
  const spies = Object.fromEntries(['providerWrite', 'crmWrite', 'invoice', 'email', 'payment', 'dispatch']
    .map((name) => [name, () => { writes.push(name); throw new Error('unexpected write'); }]));
  const output = project([row], spies);
  assert.deepEqual(writes, []);
  assert.equal(JSON.stringify(output).includes('synthetic-private-marker'), false);
  assert.deepEqual(Object.keys(output.calls[0]).sort(), ['schemaVersion', 'callKey', 'environment',
    'clientId', 'deploymentId', 'configurationVersionId', 'configurationVersion', 'canonicalSchemaVersion',
    'startedAt', 'endedAt', 'durationMs', 'callStatus', 'disconnectionReason', 'engagementType',
    'sourceRevisions', 'evidenceFingerprint', 'holds', 'rawEvidenceComplete', 'billableMinutes',
    'chargeMinor', 'billingAuthority'].sort());
});

for (const order of [
  ['call_ended', 'call_analyzed', 'call_ended', 'call_analyzed'],
  ['call_analyzed', 'call_ended', 'call_analyzed', 'call_ended'],
  ['call_analyzed', 'call_analyzed', 'call_ended', 'call_ended'],
]) {
  test(`synthetic webhook replay converges: ${order.join(', ')}`, async () => {
    const { f, payload } = await admitted();
    for (const event of order) {
      const input = payload(event);
      const before = structuredClone(input);
      const response = await invoke(f.listener, { url: '/retell/events',
        payload: input, env: f.env, processJobs: false });
      assert.equal(response.status, 200);
      assert.deepEqual(input, before);
    }
    // Both duplicate delivery and reversed worker order are exercised before
    // any event is processed, rather than only replaying completed receipts.
    f.jobQueue.reverse();
    await f.listener.processQueuedJobs();
    assert.equal(f.workerErrors.length, 0);
    assertSettled(f);
    const beforeReplay = structuredClone([...f.store.rows]);
    for (const event of ['call_ended', 'call_analyzed']) {
      const response = await invoke(f.listener, { url: '/retell/events', payload: payload(event), env: f.env });
      assert.equal(response.body.duplicate, true);
    }
    assert.deepEqual([...f.store.rows], beforeReplay);
  });
}

for (const table of ['RevenueDeskCalls', 'RevenueDeskNotifications', 'AnalyticsSyncOutbox']) {
  for (const afterWrite of [false, true]) {
    test(`partial ${table} ${afterWrite ? 'lost response' : 'pre-write failure'} remains replay-safe`, async () => {
      const { f, payload } = await admitted();
      const insert = f.store.insertUnique.bind(f.store);
      let injected = false;
      f.store.insertUnique = async (target, ...args) => {
        if (target !== table || injected) return insert(target, ...args);
        injected = true;
        if (afterWrite) await insert(target, ...args);
        throw new RevenueDeskError('CATALYST_INSERT_FAILED', 'Synthetic injected write failure',
          { httpStatus: 503, retryable: true, ambiguous: afterWrite });
      };
      await invoke(f.listener, { url: '/retell/events', payload: payload('call_analyzed'), env: f.env });
      assert.equal(injected, true);
      if (table === 'AnalyticsSyncOutbox' && afterWrite) {
        // The outbox adapter proves an uncertain insert by exact identity readback.
        assert.equal(f.workerErrors.length, 0);
        assertSettled(f);
        return;
      }
      assert.equal(f.workerErrors.length, 1);
      const receipt = f.store.rows.get('RevenueDeskEventReceipts')
        .find((row) => row.RECEIPT_KIND === 'provider_event');
      assert.equal(receipt.STATUS, afterWrite ? 'ReconciliationRequired' : 'RetryRequired');
      f.store.insertUnique = insert;
      const service = createRuntimeService({ store: f.store, config: f.config,
        mailAdapter: new CatalystMailAdapter({ app: f.app, config: f.config }), now: () => f.clock.value });
      f.clock.value += 1000;
      if (afterWrite) {
        const before = structuredClone([...f.store.rows]);
        await service.processEventReceipt(receipt.EVENT_KEY);
        assert.deepEqual([...f.store.rows], before, 'uncertain write requires reconciliation, not blind replay');
        assert.equal(f.mailAccesses, 0);
      } else {
        await service.processEventReceipt(receipt.EVENT_KEY);
        assert.equal(receipt.STATUS, 'Completed');
        assertSettled(f);
      }
    });
  }
}
