'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { buildFreeTestReport } = require('../../../tools/build-free-test-report');
const { buildPrivateCallLedger } = require('../../../tools/build-private-call-ledger');
const { renderFreeTestReport } = require('../../../tools/render-free-test-report');
const { privateCallLedgerFixture } = require('./helpers/private-call-ledger-fixture');

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
  assert.match(html, /Unknown \/ Unknown \/ Unknown/);
  assert.match(html, /Dry run recorded — nothing sent/);
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
  const { input, snapshot, now } = await privateCallLedgerFixture({
    caller_intent: '<script>alert(1)</script>', issue_summary: '=PRIVATE & <request>', coverage_trigger: 'Unknown',
  });
  const html = renderFreeTestReport(input, { now, audience: 'client', callDetails: snapshot });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /=PRIVATE &amp; &lt;request&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Observed trigger<\/th><td>Unknown/);
  assert.match(html, /After-hours only/);
});
