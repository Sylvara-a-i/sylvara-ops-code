'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { renderFreeTestReport, run } = require('../../../tools/render-free-test-report');
const { buildFreeTestReport } = require('../../../tools/build-free-test-report');
const { NOW, fixture, attachBaseline, refreshDigests, overshootFixture } = require('./helpers/free-test-report-fixture');
const render = (input) => renderFreeTestReport(input, { now: NOW, synthetic: true, audience: 'client' });
const metric = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;

test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });

test('client summary uses the same validated counts and categories without altering the internal view', () => {
  const input = fixture(); attachBaseline(input);
  const original = structuredClone(input);
  const report = buildFreeTestReport(input, NOW);
  const html = render(input);
  assert.ok(html.includes(metric('Calls Handled', report.duringTest.callsCaptured)));
  assert.ok(html.includes(metric('Potential New-Job Calls', report.duringTest.callMix[0].calls)));
  assert.ok(html.includes(metric('Calls Flagged For Office Follow-Up', report.duringTest.officeFollowUpCalls)));
  for (const group of report.duringTest.callMix) {
    assert.ok(html.includes(`<th scope="row">${group.label}</th><td>${group.calls}</td>`));
  }
  assert.equal((html.match(/<th scope="row">/g) || []).length, 7); // Six categories and their existing total.
  assert.match(html, /unique connected calls/);
  assert.match(html, /Urgency and follow-up flags overlap/);
  assert.match(html, /follow-up flag does not establish whether office work is still outstanding/);
  assert.match(html, /not unique customers, confirmed appointments, jobs or revenue/);
  assert.match(html, /not a like-for-like comparison/);
  assert.match(html, /Only this route was measured, not all calls to the business/);
  assert.match(html, /Draft — Client layout for review — Not for delivery/);
  assert.match(html, /Synthetic Demo — No Live Calls/);
  assert.match(html, /Business name:<\/strong> Not supplied/);
  assert.doesNotMatch(html, /Source last modified|Business baseline —|Recorded alert states|rendering notes|font substitution|Operator review only/);
  assert.equal(renderFreeTestReport(input, { now: NOW }),
    renderFreeTestReport(input, { now: NOW, audience: 'internal' }));
  assert.deepEqual(input, original);
});

test('unknown optional counts and absent baseline never become zero or a wall of missing fields', () => {
  const input = fixture();
  delete input.calls[0].OFFICE_FOLLOW_UP_REQUIRED;
  delete input.finalResult.OFFICE_FOLLOW_UP_CALLS;
  input.finalResult.ANALYSIS_EVIDENCE_COMPLETE = false;
  refreshDigests(input);
  const html = render(input);
  assert.ok(html.includes(metric('Calls Flagged For Office Follow-Up', 'Not available')));
  assert.match(html, /Call analysis is incomplete/);
  assert.match(html, /total number of workflow failures is not available; this does not mean zero/);
  assert.match(html, /1 call\(s\) ended with a setup failure/);
  assert.match(html, /No pre-test baseline is available/);
  assert.doesNotMatch(html, /Monthly inbound|Average job value|Monthly answering cost|USD/);
  const empty = render(fixture(true));
  assert.ok(empty.includes(metric('Calls Handled', 0)));
  assert.ok(empty.includes(metric('Calls Flagged For Office Follow-Up', 0)));
  assert.match(empty, /No connected calls were captured/);
  assert.doesNotMatch(empty, /improved results|recovered revenue of|successful test/i);
});

test('actual shortened dates and stop cause remain visible, with no seven-day completion claim', () => {
  const input = overshootFixture();
  input.deployment.STOPPED_AT = input.finalResult.TEST_ENDED_AT = '2026-08-25T11:00:00.000Z';
  refreshDigests(input);
  const html = render(input);
  assert.match(html, /2026-08-24 11:00:00 UTC to 2026-08-25 11:00:00 UTC/);
  assert.match(html, /Call limit reached; not necessarily seven completed days/);
  assert.match(html, /2 already-admitted call\(s\) finished above the 25-call limit/);
  assert.match(html, /recorded test stop does not prove that original phone handling was restored/);
  input.deployment.STOP_REASON = input.finalResult.TEST_END_REASON = 'technical_failure';
  refreshDigests(input);
  assert.match(render(input), /Stopped because of a technical failure/);
});

test('office-alert problems remain visible as business impact, not technical tables or delivery claims', () => {
  const cases = [
    ['pending', /1 office alert\(s\) were waiting to be sent/],
    ['sending', /1 office alert\(s\) had an unconfirmed send outcome/],
    ['retry_required', /1 office alert\(s\) required delivery recovery/],
    ['ambiguous', /1 office alert\(s\) had an uncertain outcome; check before any resend/],
    ['reconciliation_required', /1 office alert\(s\) needed operator investigation/],
    ['terminal_failure', /1 office alert\(s\) failed; operator follow-up is required/],
    ['sent', /1 office alert\(s\) were accepted by the mail provider; inbox receipt is not verified/],
    ['succeeded', /1 office alert\(s\) had a legacy success status without verified delivery/],
  ];
  for (const [state, expected] of cases) {
    const input = fixture(); input.calls[0].NOTIFICATION_STATE = state;
    delete input.calls[1].NOTIFICATION_STATE;
    refreshDigests(input);
    const html = render(input);
    assert.match(html, expected);
    assert.match(html, /9 office alert\(s\) were preview-only; nothing was sent for those calls/);
    assert.match(html, /Office-alert evidence is not available for 1 call\(s\)/);
    assert.match(html, /Inbox receipt, office acknowledgment and completed callbacks are not verified/);
    assert.equal((html.match(/<table>/g) || []).length, 1);
  }
});

test('client rendering retains single-test validation, readiness gates and data minimization', () => {
  for (const change of [
    (input) => { input.calls[0].CLIENT_KEY = 'e'.repeat(64); },
    (input) => { input.finalResult.CALLS_CAPTURED = 99; },
    (input) => { input.evidence.scopes[0].unresolved_v2_outbox_rows = 1; },
    (input) => { input.evidence.evaluated_at = '2026-08-31T12:00:00.000Z'; },
  ]) {
    const input = fixture(); change(input); assert.throws(() => render(input));
  }
  const input = fixture();
  input.displayName = '<img src="https://example.invalid/private">';
  input.recipient = 'private@example.invalid';
  const html = render(input);
  for (const hidden of [input.displayName, input.recipient, input.deployment.CLIENT_KEY,
    input.deployment.DEPLOYMENT_KEY, input.deployment.CONFIGURATION_VERSION, input.deployment.SOURCE_REVISION]) {
    assert.equal(html.includes(hidden), false);
  }
  assert.doesNotMatch(html, /<!--|<script|<iframe|<img|<form|<link|@import|url\(/i);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /size: Letter/);
  assert.match(html, /"Inter", sans-serif/);
  assert.throws(() => renderFreeTestReport(input, { now: NOW, audience: 'published' }),
    { code: 'REPORT_RENDER_OPTIONS_INVALID' });
});

test('existing CLI creates a separate client draft only and still refuses overwrites or duplicate flags', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sylvara-client-summary-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inputPath = path.join(root, 'input.json');
  const outputPath = path.join(root, 'client.html');
  fs.writeFileSync(inputPath, JSON.stringify(fixture()), { flag: 'wx' });
  assert.deepEqual(run([inputPath, outputPath, '--audience=client', '--synthetic'], NOW),
    { status: 'draft_created_not_for_delivery' });
  assert.match(fs.readFileSync(outputPath, 'utf8'), /Client Summary Draft/);
  const before = fs.readFileSync(outputPath, 'utf8');
  assert.throws(() => run([inputPath, outputPath, '--audience=client'], NOW), { code: 'REPORT_RENDER_FAILED' });
  assert.equal(fs.readFileSync(outputPath, 'utf8'), before);
  assert.throws(() => run([inputPath, path.join(root, 'other.html'), '--synthetic', '--synthetic'], NOW),
    { code: 'REPORT_RENDER_FAILED' });
  assert.equal(fs.existsSync(path.join(root, 'other.html')), false);
});
