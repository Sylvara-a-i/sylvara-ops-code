'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const offlineGuard = installOfflineGuard();
const { escapeHtml, renderFreeTestReport, run } = require('../../../tools/render-free-test-report');
const { NOW, fixture, attachBaseline, refreshDigests } = require('./helpers/free-test-report-fixture');

test.after(() => {
  offlineGuard.restore();
  assert.deepEqual(offlineGuard.blocked, []);
});

function privateFiles(t, input = fixture()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sylvara-report-render-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inputPath = path.join(root, 'input.json');
  const outputPath = path.join(root, 'draft.html');
  fs.writeFileSync(inputPath, JSON.stringify(input), { flag: 'wx' });
  return { root, inputPath, outputPath };
}

test('static draft renders exactly six groups, separate flags, limits and no partition identifiers', () => {
  const input = fixture();
  const before = structuredClone(input);
  const html = renderFreeTestReport(input, { now: NOW });
  assert.match(html, /<title>Seven-Day Free Test Results<\/title>/);
  assert.match(html, /Draft — Operator review only — Not for delivery/);
  assert.match(html, /Six non-overlapping groups of connected calls/);
  for (const [label, value] of [
    ['New job opportunities', 2], ['Existing customers', 1], ['Not a fit', 2],
    ['Spam / unwanted calls', 1], ['General questions', 1], ['Incomplete / needs review', 4],
  ]) assert.ok(html.includes(`<th scope="row">${label}</th><td>${value}</td>`));
  assert.match(html, /These flags overlap the six call groups and each other/);
  assert.match(html, /Seven Day Limit Reached/);
  assert.match(html, /carrier forwarding or original handling was restored/);
  assert.match(html, /Average connected call duration<\/th><td>Not available/);
  assert.match(html, /scope="col"/);
  for (const forbidden of [input.deployment.CLIENT_KEY, input.deployment.DEPLOYMENT_KEY,
    input.deployment.CONFIGURATION_VERSION, input.deployment.SOURCE_REVISION]) {
    assert.equal(html.includes(forbidden), false);
  }
  assert.deepEqual(input, before);
});

test('synthetic baseline is prominent and clearly separates estimates, zero, unknown and duration', () => {
  const input = fixture();
  attachBaseline(input);
  input.crmBaseline = null;
  delete input.deployment.PRETEST_MONTHLY_INBOUND_CALLS;
  input.calls.forEach((call) => { call.DURATION_MILLISECONDS = 180000; });
  input.finalResult.ACTUAL_AVERAGE_CALL_DURATION_MILLISECONDS = 180000;
  refreshDigests(input);
  const html = renderFreeTestReport(input, { now: NOW, synthetic: true });
  assert.match(html, /class="synthetic">Synthetic Demo — No Live Calls/);
  assert.match(html, /Business-supplied estimate/);
  assert.match(html, /2026-07-01 00:00:00 UTC/);
  assert.match(html, /Monthly inbound calls<\/th><td>Not available/);
  assert.match(html, /Monthly answering cost \(business supplied\)<\/th><td>USD 0\.00/);
  assert.match(html, /Average connected call duration<\/th><td>180 seconds/);
  assert.match(html, /Average job value \(business supplied\)<\/th><td>USD 350\.25/);
  assert.match(html, /After-hours call share<\/th><td>20\.25%/);
  assert.match(html, /No recovered revenue, confirmed jobs, savings or improvement is calculated/);
  assert.match(html, /All displayed outcomes are illustrative synthetic data/);
});

test('handoff section preserves actual state meaning and never invents delivery or callbacks', () => {
  const input = fixture();
  input.calls[0].NOTIFICATION_STATE = 'sent';
  input.calls[1].NOTIFICATION_STATE = 'ambiguous';
  input.calls[2].NOTIFICATION_STATE = 'pending';
  input.calls[3].NOTIFICATION_STATE = 'terminal_failure';
  delete input.calls[4].NOTIFICATION_STATE;
  input.finalResult.ANALYSIS_EVIDENCE_COMPLETE = false;
  refreshDigests(input);
  const html = renderFreeTestReport(input, { now: NOW, synthetic: true });
  assert.match(html, /<h3 id="handoff">Call-to-business handoff<\/h3>/);
  assert.match(html, /Dry run recorded — nothing sent<\/th><td>6/);
  assert.match(html, /Provider accepted — inbox delivery not verified<\/th><td>1/);
  assert.match(html, /Ambiguous — reconcile before any resend<\/th><td>1/);
  assert.match(html, /Pending — not yet attempted<\/th><td>1/);
  assert.match(html, /Terminal failure — automatic retries stopped<\/th><td>1/);
  assert.match(html, /Notification evidence not available<\/th><td>1/);
  assert.match(html, /Business acknowledgment<\/th><td>Not available/);
  assert.match(html, /Completed business callbacks<\/th><td>Not available/);
  assert.match(html, /Structured analysis completion<\/th><td>Incomplete \/ Not available/);
  assert.match(html, /Per-call missing-analysis counts are not available/);
  assert.match(html, /Existing report readiness and reconciliation gates still apply/);
  input.evidence.scopes[0].unresolved_v2_outbox_rows = 1;
  assert.throws(() => renderFreeTestReport(input, { now: NOW }), { code: 'REPORT_RECONCILIATION_REQUIRED' });
});

test('verified zero is displayed as zero, while unknown optional evidence stays unavailable', () => {
  const empty = renderFreeTestReport(fixture(true), { now: NOW, synthetic: true });
  assert.match(empty, /Unique connected calls captured<\/th><td>0/);
  assert.match(empty, /No connected calls<\/th><td>0/);
  const input = fixture();
  delete input.calls[0].BOOKABLE_OPPORTUNITY;
  delete input.finalResult.BOOKABLE_OPPORTUNITIES;
  refreshDigests(input);
  const html = renderFreeTestReport(input, { now: NOW });
  assert.match(html, /Bookable opportunities \(not confirmed bookings\)<\/th><td>Not available/);
  assert.match(html, /Calls requiring office follow-up<\/th><td>0/);
});

test('all interpolated text is escaped and raw extra inputs cannot enter static HTML', () => {
  assert.equal(escapeHtml('<script x="a&b">\'test\'</script>'),
    '&lt;script x=&quot;a&amp;b&quot;&gt;&#39;test&#39;&lt;/script&gt;');
  const input = fixture();
  input.displayName = '<img src="https://example.invalid/private" onerror="alert(1)">';
  input.recipient = 'private@example.invalid';
  const html = renderFreeTestReport(input, { now: NOW });
  assert.equal(html.includes(input.displayName), false);
  assert.equal(html.includes(input.recipient), false);
  assert.doesNotMatch(html, /<script|<iframe|<img|<form|<link|@import|url\(/i);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /size: Letter/);
  assert.match(html, /font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif/);
  assert.match(html, /font substitution and pagination have not been visually verified/);
});

test('wrong partitions, stale gates, private facts and unsafe options fail before rendering', () => {
  for (const mutate of [
    (input) => { input.calls[0].CLIENT_KEY = 'e'.repeat(64); },
    (input) => { input.evidence.evaluated_at = '2026-08-31T12:00:00.000Z'; },
    (input) => { input.calls[0].callerEmail = 'private@example.invalid'; },
    (input) => { input.finalResult.CALLS_CAPTURED = 999; },
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => renderFreeTestReport(input, { now: NOW }));
  }
  for (const options of [{ now: NaN }, { synthetic: 'yes' }, { recipient: 'private@example.invalid' }]) {
    assert.throws(() => renderFreeTestReport(fixture(), options), { code: 'REPORT_RENDER_OPTIONS_INVALID' });
  }
});

test('local CLI creates exclusively only after successful evidence validation', (t) => {
  const files = privateFiles(t);
  assert.deepEqual(run([files.inputPath, files.outputPath, '--synthetic'], NOW),
    { status: 'draft_created_not_for_delivery' });
  const original = fs.readFileSync(files.outputPath, 'utf8');
  assert.match(original, /Synthetic Demo — No Live Calls/);
  assert.throws(() => run([files.inputPath, files.outputPath], NOW), { code: 'REPORT_RENDER_FAILED' });
  assert.equal(fs.readFileSync(files.outputPath, 'utf8'), original);
});

test('CLI failure emits no raw input and creates no output on malformed or stale evidence', (t) => {
  const files = privateFiles(t);
  const marker = 'PRIVATE_RENDER_MARKER_DO_NOT_ECHO';
  fs.writeFileSync(files.inputPath, `{"${marker}":`);
  const assertFailure = () => {
    assert.throws(() => run([files.inputPath, files.outputPath], NOW), (error) =>
      error.code === 'REPORT_RENDER_FAILED' && error.message === 'REPORT_RENDER_FAILED');
    assert.equal(fs.existsSync(files.outputPath), false);
    assert.deepEqual(fs.readdirSync(files.root), ['input.json']);
  };
  assertFailure();
  const input = fixture(); input.evidence.evaluated_at = '2026-08-31T12:00:00.000Z';
  fs.writeFileSync(files.inputPath, JSON.stringify(input));
  assertFailure();
});

test('CLI refuses public-worktree, network, aliased, relative and non-HTML output paths', (t) => {
  const files = privateFiles(t);
  const sourcePath = path.resolve(__dirname, '../../../config/free-test-report-contract.json');
  for (const args of [
    [sourcePath, files.outputPath], [files.inputPath, path.resolve(__dirname, 'private.html')],
    ['input.json', files.outputPath], [files.inputPath, path.join(files.root, 'draft.pdf')],
    ['\\\\server\\share\\input.json', files.outputPath],
    [files.inputPath, files.outputPath, '--publish'],
  ]) assert.throws(() => run(args, NOW), { code: 'REPORT_RENDER_FAILED' });
  const alias = path.join(files.root, 'alias.json');
  fs.linkSync(files.inputPath, alias);
  assert.throws(() => run([alias, files.outputPath], NOW), { code: 'REPORT_RENDER_FAILED' });
  assert.equal(fs.existsSync(files.outputPath), false);
});
