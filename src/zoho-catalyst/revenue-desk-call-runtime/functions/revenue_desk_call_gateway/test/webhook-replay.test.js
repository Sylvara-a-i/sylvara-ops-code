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
  // The approved runtime minimizes provider artifacts; it does not retain raw
  // transcripts. Preserve the input and structured detail without changing that policy.
  const stored = JSON.stringify({ rows: [...f.store.rows], logs: f.logs });
  assert.equal(stored.includes(JSON.stringify(sample.call.transcript).slice(1, -1)), false);
  for (const turn of sample.call.transcript_object) assert.equal(stored.includes(turn.content), false);
  assert.equal(stored.includes(sample.call.recording_url), false);
  assert.equal(f.store.rows.get('AnalyticsSyncOutbox')
    .filter((row) => row.RECORD_TYPE === 'call').length, 1);
}

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
