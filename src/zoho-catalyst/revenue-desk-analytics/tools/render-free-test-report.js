'use strict';

// Local operator draft only. Never send, import, initialize a provider, or render
// raw input objects: the existing report builder must reconcile the evidence first.
const fs = require('node:fs');
const path = require('node:path');
const { buildFreeTestReport } = require('./build-free-test-report');

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const TITLE = 'Seven-Day Free Test Results';
const DRAFT = 'Draft — Operator review only — Not for delivery';
const COVERAGE = Object.freeze({
  after_hours_only: 'After-hours only', no_answer_overflow_only: 'No-answer / overflow only',
  after_hours_and_overflow: 'After-hours and overflow',
});
const NOTIFICATION_LABELS = Object.freeze({
  Pending: 'Pending — not yet attempted', Sending: 'Sending — outcome unresolved',
  RetryRequired: 'Retry required — bounded retry pending',
  DryRunRecorded: 'Dry run recorded — nothing sent', Sent: 'Provider accepted — inbox delivery not verified',
  Ambiguous: 'Ambiguous — reconcile before any resend',
  ReconciliationRequired: 'Reconciliation required — operator review',
  Succeeded: 'Legacy succeeded state — delivery not verified',
  TerminalFailure: 'Terminal failure — automatic retries stopped',
});

function fail(code) { const error = new Error(code); error.code = code; throw error; }

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

const available = (value) => value !== null && value !== undefined;
const text = (value) => available(value) ? String(value) : 'Not available';
const count = (value) => available(value) ? String(value) : 'Not available';
const percent = (value) => available(value) ? `${value}%` : 'Not available';
const amount = (value, currency) => available(value) && currency === 'USD'
  ? `USD ${(value / 100).toFixed(2)}` : 'Not available';
const instant = (value) => available(value) ? `${value.replace('T', ' ').replace('.000Z', '').replace(/Z$/, '')} UTC` : 'Not available';
const titleCase = (value) => available(value)
  ? value.split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ') : 'Not available';

function table(caption, headers, rows) {
  return `<table><caption>${escapeHtml(caption)}</caption><thead><tr>${headers.map((header) =>
    `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) =>
    `<tr><th scope="row">${escapeHtml(row[0])}</th>${row.slice(1).map((value) =>
      `<td>${escapeHtml(text(value))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

/** Produce self-contained HTML only after the fixed-test report gate passes.
 * All source IDs/hashes remain in private evidence, not visible or hidden HTML.
 * Fonts use the local standards stack; no font is downloaded or bundled. Print
 * pagination and actual font substitution still require operator visual review.
 */
function renderFreeTestReport(input, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some((key) => !['now', 'synthetic'].includes(key))) fail('REPORT_RENDER_OPTIONS_INVALID');
  const { now = Date.now(), synthetic = false } = options;
  if (!Number.isSafeInteger(now) || typeof synthetic !== 'boolean') fail('REPORT_RENDER_OPTIONS_INVALID');
  const report = buildFreeTestReport(input, now);
  const before = report.beforeTest;
  const during = report.duringTest;
  const evidence = report.evidence;
  const baselineRows = before.values ? [
    ['Current call handling', before.values.currentCallHandling],
    ['Monthly inbound calls', count(before.values.monthlyInboundCalls)],
    ['Monthly inbound call range', before.values.monthlyInboundCallBand],
    ['After-hours call range', before.values.afterHoursCallBand],
    ['After-hours call share', percent(before.values.afterHoursCallShare)],
    ['Estimated unanswered-call rate', percent(before.values.estimatedUnansweredCallRate)],
    ['Average job value (business supplied)', amount(before.values.averageJobValueMinorUnits, before.currency)],
    ['Average job value range', before.values.averageJobValueBand],
    ['Monthly answering cost (business supplied)', amount(before.values.currentMonthlyAnsweringCostMinorUnits, before.currency)],
  ] : [];
  const baseline = before.values
    ? `<p>Evidence: ${escapeHtml(before.evidenceClass === 'customer_supplied_estimate'
      ? 'Business-supplied estimate' : 'Business records identified in the captured evidence')}.</p>
      <p>Source period: ${escapeHtml(instant(before.sourcePeriod.start))} to ${escapeHtml(instant(before.sourcePeriod.end))}.</p>
      <p>Captured: ${escapeHtml(instant(before.capturedAt))}. Source last modified: ${escapeHtml(instant(before.sourceModifiedAt))}.</p>
      ${table('Business baseline — context, not measured improvement', ['Measure', 'Supplied value'], baselineRows)}`
    : '<p>Not available. No pre-test baseline is attached to this test; it has not been reconstructed from later data.</p>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${TITLE}</title><style>
@page { size: Letter; margin: .80in 1in .78in; }
* { box-sizing: border-box; }
body { margin: 0 auto; padding: .5in; max-width: 8.5in; color: #161616; background: white;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif; font-size: 10pt; line-height: 1.3; }
h1 { font-size: 18pt; } h2 { font-size: 15pt; margin-top: 18pt; } h3 { font-size: 12pt; }
h1, h2, h3, caption { break-after: avoid; } p, li { orphans: 3; widows: 3; }
p { margin: 0 0 5pt; } header { border-bottom: 2px solid; padding-bottom: 10pt; }
.status { font-size: 9pt; font-weight: bold; } .synthetic { border: 2px solid; padding: 8pt; font-weight: bold; }
table { border-collapse: collapse; width: 100%; margin: 10pt 0; font-size: 8.8pt; table-layout: fixed; }
caption { text-align: left; font-weight: bold; margin-bottom: 5pt; }
th, td { border: 1px solid #777; padding: 5pt; text-align: left; overflow-wrap: anywhere; }
thead { display: table-header-group; } tr { break-inside: avoid; }
footer { margin-top: 18pt; border-top: 1px solid; padding-top: 6pt; font-size: 9pt; }
@media print { body { max-width: none; padding: 0; } }
</style></head><body>
<header><p>Sylvara | Free-Test Results</p><p class="status">${DRAFT}</p>
${synthetic ? '<p class="synthetic">Synthetic Demo — No Live Calls</p>' : ''}
<h1>${TITLE}</h1><p>One test, one business. Review the evidence and limitations before deciding next steps.</p>
<p>Owner: Sylvara operator | Document version 1 | Rev. ${escapeHtml(new Date(now).toISOString().slice(0, 10))}</p></header>
<main>
<section aria-labelledby="period"><h2 id="period">Test period and coverage</h2>
${table('Terminal test summary', ['Measure', 'Result'], [
    ['Started', instant(during.startedAtUtc)], ['Ended', instant(during.endedAtUtc)],
    ['Stop reason', titleCase(during.endReason)], ['Coverage', COVERAGE[during.coverage] || 'Not available'],
    ['Unique connected calls captured', count(during.callsCaptured)], ['Connected-call limit', count(during.callLimit)],
    ['Unconnected / unhandled attempts', count(during.unhandledAttempts)],
    ['Average connected call duration', available(during.averageCallDurationSeconds)
      ? `${during.averageCallDurationSeconds} seconds` : 'Not available'],
  ])}
<p>The stop reason is recorded workflow evidence, not proof that carrier forwarding or original handling was restored. Restoration evidence requires separate operator review.</p></section>
<section aria-labelledby="baseline"><h2 id="baseline">Before the test</h2>${baseline}
<p>Baseline values and observed route calls are context, not a like-for-like before-and-after comparison.</p></section>
<section aria-labelledby="calls"><h2 id="calls">Call results</h2>
${table('Six non-overlapping groups of connected calls', ['Call group', 'Calls'],
    during.callMix.map((group) => [group.label, group.calls]))}
${table('Daily connected calls — UTC dates', ['Date (UTC)', 'Calls'], during.dailyCallsUtc.length
    ? during.dailyCallsUtc.map((day) => [day.dateUtc, day.calls]) : [['No connected calls', 0]])}</section>
<section aria-labelledby="flags"><h2 id="flags">Follow-up and exceptions</h2>
<p>These flags overlap the six call groups and each other. Do not add them to the connected-call total.</p>
${table('Overlapping flags and observed failures', ['Measure', 'Calls'], [
    ['Urgent requests', count(during.urgentRequests)],
    ['Bookable opportunities (not confirmed bookings)', count(during.bookableOpportunities)],
    ['Calls requiring office follow-up', count(during.officeFollowUpCalls)],
    ['Observed workflow failures', count(during.observedWorkflowFailures)],
  ])}
<h3 id="handoff">Call-to-business handoff</h3>
<p>These states describe the same unique connected calls, not additional calls or completed business work. Missing notification evidence stays separate from every known state.</p>
${table('Recorded alert states — connected calls only', ['State', 'Calls'], [
    ...during.handoff.notificationStates.map(({ state, calls }) => [NOTIFICATION_LABELS[state], calls]),
    ['Notification evidence not available', during.handoff.missingNotificationEvidenceCalls],
  ])}
${table('Delivery and human follow-up evidence', ['Evidence', 'Calls / state'], [
    ['Inbox delivery verified', count(during.handoff.inboxDeliveryVerifiedCalls)],
    ['Business acknowledgment', count(during.handoff.businessAcknowledgmentCalls)],
    ['Completed business callbacks', count(during.handoff.completedCallbackCalls)],
    ['Structured analysis completion', evidence.analysisComplete ? 'Complete' : 'Incomplete / Not available'],
  ])}
<p>DryRunRecorded is a preview, not a send. Sent records provider acceptance only; it does not prove inbox arrival, reading, acknowledgment or a callback. Per-call missing-analysis counts are not available in this minimized report.</p>
<p>The business owns manual follow-up. A Sylvara operator reviews failed or uncertain delivery before recovery; this report triggers no retry, message or callback. Existing report readiness and reconciliation gates still apply.</p></section>
<section aria-labelledby="limitations"><h2 id="limitations">Evidence and limitations</h2>
${table('Evidence completeness', ['Evidence', 'State'], [
    ['Structured call analysis', evidence.analysisComplete ? 'Complete' : 'Incomplete / Not available'],
    ['Connected-call duration', evidence.durationComplete ? 'Complete' : 'Incomplete / Not available'],
    ['Source last modified', instant(evidence.sourceModifiedAt)],
  ])}
<ul>${evidence.limits.map((limit) => `<li>${escapeHtml(limit)}</li>`).join('')}</ul>
${synthetic ? '<p>All displayed outcomes are illustrative synthetic data. No live voice quality, delivery, forwarding, fallback or customer results are proved by this demo.</p>' : ''}
</section>
<section aria-labelledby="next"><h2 id="next">Next steps</h2>
${table('Evidence-based review prompts', ['Measure', 'Result'], [
    ['Coverage to review', COVERAGE[report.nextSteps.supportedCoverage] || 'Not available'],
    ['Estimated monthly connected minutes — lower estimate', count(report.nextSteps.estimatedMonthlyConnectedMinutesMin)],
    ['Estimated monthly connected minutes — upper estimate', count(report.nextSteps.estimatedMonthlyConnectedMinutesMax)],
  ])}<p>${escapeHtml(report.nextSteps.label)}</p>
<p>No recovered revenue, confirmed jobs, savings or improvement is calculated from these call counts.</p>
<p>Verify the single-test scope and restoration evidence, resolve unknowns, then approve any next action separately. No publication or delivery is authorized.</p></section>
</main><footer><p>${DRAFT}</p><p>Local HTML draft. Inter is used only if installed; the native/local fallback may differ. Printed pages, font substitution and pagination have not been visually verified. No fonts or assets are downloaded.</p></footer>
</body></html>`;
}

function localAbsolute(value, extension) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /^[\\/]{2}/.test(value)
    || path.extname(value).toLowerCase() !== extension
    || (process.platform === 'win32' && value.slice(2).includes(':'))) fail('REPORT_PRIVATE_PATH_REQUIRED');
  return value;
}

function outsideGit(directory) {
  let current = directory;
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) fail('REPORT_PRIVATE_PATH_REQUIRED');
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/** Read only the explicitly selected bounded JSON file; never load environment
 * files. Existing/link outputs are refused, and validation precedes creation.
 * A local process with filesystem write access is outside this path boundary.
 */
function run(argv, now = Date.now()) {
  try {
    if (!Array.isArray(argv) || ![2, 3].includes(argv.length)
      || (argv.length === 3 && argv[2] !== '--synthetic')) fail('REPORT_ARGUMENTS_INVALID');
    const inputPath = localAbsolute(argv[0], '.json');
    const outputPath = localAbsolute(argv[1], '.html');
    const inputMetadata = fs.lstatSync(inputPath);
    if (!inputMetadata.isFile() || inputMetadata.isSymbolicLink() || inputMetadata.nlink !== 1
      || inputMetadata.size < 1 || inputMetadata.size > MAX_INPUT_BYTES) fail('REPORT_INPUT_FILE_INVALID');
    const physicalInput = fs.realpathSync(inputPath);
    localAbsolute(physicalInput, '.json');
    outsideGit(path.dirname(physicalInput));
    const parent = fs.realpathSync(path.dirname(outputPath));
    if (/^[\\/]{2}/.test(parent)) fail('REPORT_PRIVATE_PATH_REQUIRED');
    outsideGit(parent);
    const physicalOutput = path.join(parent, path.basename(outputPath));
    if (fs.existsSync(physicalOutput)) fail('REPORT_OUTPUT_EXISTS');
    let input;
    try { input = JSON.parse(fs.readFileSync(physicalInput, 'utf8')); }
    catch { fail('REPORT_INPUT_JSON_INVALID'); }
    const html = renderFreeTestReport(input, { now, synthetic: argv.length === 3 });
    fs.writeFileSync(physicalOutput, html, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return Object.freeze({ status: 'draft_created_not_for_delivery' });
  } catch {
    // Parser, filesystem and validator diagnostics can contain private paths or
    // payload bytes. The CLI exposes one fixed failure, never the original error.
    fail('REPORT_RENDER_FAILED');
  }
}

if (require.main === module) {
  try { run(process.argv.slice(2)); process.stdout.write('Local report draft created; delivery is not authorized.\n'); }
  catch { process.stderr.write('Report render failed; no delivery is authorized.\n'); process.exitCode = 1; }
}

module.exports = { escapeHtml, renderFreeTestReport, run };
