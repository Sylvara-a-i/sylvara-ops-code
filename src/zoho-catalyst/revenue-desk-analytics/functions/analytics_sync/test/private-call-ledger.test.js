'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { buildFreeTestReport } = require('../../../tools/build-free-test-report');
const { buildPrivateCallLedger } = require('../../../tools/build-private-call-ledger');
const { renderFreeTestReport } = require('../../../tools/render-free-test-report');
const { privateCallLedgerFixture } = require('./helpers/private-call-ledger-fixture');
const { refreshDigests } = require('./helpers/free-test-report-fixture');
const { queryClientCallDetails } = require('../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/reporting');

test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });

test('canonical reader joins attested facts and renders a private client ledger only', async () => {
  const { input, snapshot, now } = await privateCallLedgerFixture();
  const defaultReport = buildFreeTestReport(input, now);
  assert.equal(Object.hasOwn(defaultReport, 'callDetails'), false);
  const report = buildFreeTestReport(input, now, snapshot);
  assert.equal(report.callDetails[0].callerIntent, 'service_request');
  assert.equal(report.callDetails[0].issueSummary, 'Leaking water heater');
  assert.equal(report.callDetails[0].trigger, 'AfterHours');
  assert.equal(report.callDetails[0].completedFollowUp, null);
  const html = renderFreeTestReport(input, { now, audience: 'client', synthetic: true, callDetails: snapshot });
  assert.match(html, /Individual call details/);
  assert.match(html, /C-0001/);
  assert.match(html, /Leaking water heater/);
  for (const label of ['Inbox Receipt', 'Office Acknowledgment', 'Completed Follow-Up']) {
    assert.ok(html.includes(`<th scope="row">${label}</th><td>Unknown</td>`));
  }
  assert.match(html, /Preview Only — Not Sent/);
  assert.match(html, /Observed trigger<\/th><td>After Hours/);
  assert.match(html, /Urgency<\/th><td>Routine/);
  assert.match(html, /Flagged for Office Follow-Up<\/th><td>Yes/);
  assert.doesNotMatch(html, /Unknown \/ Unknown \/ Unknown|Office follow-up required|AfterHours/);
  for (const forbidden of [snapshot.clientKey, snapshot.deploymentKey,
    snapshot.rows[0].fact.CALL_KEY, 'Caller A', '+15551110001', 'Lenexa']) {
    assert.equal(html.includes(forbidden), false);
  }
  assert.deepEqual(buildFreeTestReport(input, now), defaultReport);
  assert.throws(() => renderFreeTestReport(input, { now, callDetails: snapshot }),
    { code: 'REPORT_RENDER_OPTIONS_INVALID' });
});

test('serialized or forged adjuncts cannot supply descriptions to a report', async () => {
  const { input, snapshot, now } = await privateCallLedgerFixture();
  for (const untrusted of [JSON.parse(JSON.stringify(snapshot)), { ...snapshot }, {}]) {
    assert.throws(() => buildFreeTestReport(input, now, untrusted),
      { code: 'REPORT_DETAILS_SOURCE_REQUIRED' });
  }
});

test('client call records retain provider acceptance and uncertain alert evidence instead of relabeling as preview', async () => {
  const { input, runtime, now } = await privateCallLedgerFixture();
  for (const [state, expected] of [
    ['Sent', 'Provider accepted — inbox delivery not verified'],
    ['Ambiguous', 'Ambiguous — reconcile before any resend'],
  ]) {
    runtime.store.rows.get(runtime.config.tables.CANONICAL_CALL_TABLE)[0].NOTIFICATION_STATE = state;
    runtime.store.rows.get(runtime.config.tables.NOTIFICATION_TABLE)[0].STATUS = state;
    const snapshot = await queryClientCallDetails(runtime.store, runtime.config, 'client_A', 'deployment_A', now);
    input.calls = snapshot.rows.map((row) => ({ ...row.fact }));
    refreshDigests(input);
    const html = renderFreeTestReport(input, { now, audience: 'client', callDetails: snapshot });
    assert.ok(html.includes(`<th scope="row">Office alert</th><td>${expected}</td>`));
    assert.doesNotMatch(html, /Preview Only — Not Sent/);
    assert.match(html, /Inbox Receipt<\/th><td>Unknown/);
  }
});

test('private details reject stale, future, cross-scope, missing, duplicate or changed facts', async () => {
  const { input, snapshot, now } = await privateCallLedgerFixture();
  const join = (calls = input.calls, deployment = input.deployment, at = now) =>
    buildPrivateCallLedger(snapshot, calls, deployment, at);
  assert.throws(() => join(input.calls, input.deployment, now + 300_001), { code: 'REPORT_DETAILS_STALE' });
  assert.throws(() => join(input.calls, input.deployment, now - 1), { code: 'REPORT_DETAILS_STALE' });
  for (const field of ['CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION', 'SOURCE_REVISION']) {
    assert.throws(() => join(input.calls, { ...input.deployment, [field]: 'different' }),
      { code: 'REPORT_DETAILS_OWNERSHIP_CONFLICT' });
  }
  assert.throws(() => join([]), { code: 'REPORT_DETAILS_COHORT_CONFLICT' });
  assert.throws(() => join([...input.calls, ...input.calls]), { code: 'REPORT_DETAILS_COHORT_CONFLICT' });
  assert.throws(() => join([{ ...input.calls[0], SOURCE_MODIFIED_AT: new Date(now).toISOString() }]),
    { code: 'REPORT_DETAILS_ROWSET_CONFLICT' });
});

test('request text is escaped; unknown trigger is never inferred from the route', async () => {
  for (const [request, escaped] of [
    ['<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
    ['<SCRIPT>alert(1)</SCRIPT>', '&lt;SCRIPT&gt;alert(1)&lt;/SCRIPT&gt;'],
    ['<ScRiPt data-test="synthetic">alert(1)</ScRiPt>',
      '&lt;ScRiPt data-test=&quot;synthetic&quot;&gt;alert(1)&lt;/ScRiPt&gt;'],
  ]) {
    const { input, snapshot, now } = await privateCallLedgerFixture({
      caller_intent: request, issue_summary: '=PRIVATE & <request>', coverage_trigger: 'Unknown',
    });
    const html = renderFreeTestReport(input, { now, audience: 'client', callDetails: snapshot });
    assert.ok(html.includes(escaped));
    assert.match(html, /=PRIVATE &amp; &lt;request&gt;/);
    assert.doesNotMatch(html, /<script\b/i);
    assert.match(html, /Observed trigger<\/th><td>Unknown/);
    assert.match(html, /After-hours only/);
  }
});
