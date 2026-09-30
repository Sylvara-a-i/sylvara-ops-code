'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { installOfflineGuard } = require('../../../../revenue-desk-release/test/helpers/offline-guard');
const guard = installOfflineGuard();
const { buildFreeTestReport, factRowsetDigest } = require('../../../tools/build-free-test-report');
const { renderFreeTestReport } = require('../../../tools/render-free-test-report');
const { METHOD_ID, METHOD_VERSION, SCOPE_FIELDS } = require('../../../tools/opportunity-value');
const { privateCallLedgerFixture } = require('./helpers/private-call-ledger-fixture');

test.after(() => { guard.restore(); assert.deepEqual(guard.blocked, []); });
const key = (value) => crypto.createHash('sha256').update(`synthetic-value-integration-${value}`).digest('hex');

function reviewFor(input, now) {
  return { schemaVersion: 1, methodId: METHOD_ID, methodVersion: METHOD_VERSION,
    scope: Object.fromEntries(SCOPE_FIELDS.map((field) => [field, input.deployment[field]])),
    callRowsetDigest: factRowsetDigest('call', input.calls),
    review: { status: 'reviewed', reviewedAt: new Date(now).toISOString(), reviewerReference: key('reviewer') },
    groups: [{ groupKey: key('group'), callKeys: [input.calls[0].CALL_KEY], reviewStatus: 'qualified',
      knownJobValue: { amountMinorUnits: 12500, currency: 'USD', evidenceReference: key('document'),
        effectiveDate: new Date(now).toISOString().slice(0, 10) }, averageJobValue: null }],
  };
}

test('private client report joins opportunity groups using document-local call references only', async () => {
  const { input, snapshot, now } = await privateCallLedgerFixture();
  const review = reviewFor(input, now);
  const baseline = buildFreeTestReport(input, now);
  const result = buildFreeTestReport(input, now, snapshot, review);
  assert.equal(result.opportunityValue.status, 'complete');
  assert.equal(result.opportunityValue.groups[0].groupReference, 'O-0001');
  assert.deepEqual(result.opportunityValue.groups[0].callReferences, ['C-0001']);
  assert.equal(Object.hasOwn(result.opportunityValue.groups[0], 'groupKey'), false);
  assert.equal(Object.hasOwn(result.opportunityValue.groups[0], 'callKeys'), false);
  assert.equal(result.callDetails.length, input.calls.length);
  assert.deepEqual(result.duringTest, baseline.duringTest);
  assert.deepEqual(buildFreeTestReport(input, now), baseline);
  const html = renderFreeTestReport(input, { now, audience: 'client', callDetails: snapshot, opportunityReview: review });
  assert.match(html, /Estimated Opportunity Value/);
  assert.match(html, /Contractor-documented known job value/);
  assert.match(html, /\$125/);
  assert.match(html, /O-0001/);
  assert.match(html, /C-0001/);
  assert.match(html, /Individual call details/);
  assert.match(html, /Leaking water heater/);
  for (const privateValue of [input.calls[0].CALL_KEY, review.groups[0].groupKey,
    review.review.reviewerReference, review.groups[0].knownJobValue.evidenceReference,
    review.scope.CLIENT_KEY, review.scope.DEPLOYMENT_KEY, review.callRowsetDigest]) {
    assert.equal(html.includes(privateValue), false);
    assert.equal(JSON.stringify(result.opportunityValue).includes(privateValue), false);
  }
});

test('trusted details without review explicitly show unknown while default report stays unchanged', async () => {
  const { input, snapshot, now } = await privateCallLedgerFixture();
  const report = buildFreeTestReport(input, now, snapshot);
  assert.equal(report.opportunityValue.status, 'not_available');
  assert.equal(report.opportunityValue.ungroupedQualifiedCallCount, 1);
  assert.deepEqual(report.opportunityValue.subtotals, []);
  const html = renderFreeTestReport(input, { now, audience: 'client', callDetails: snapshot });
  assert.match(html, /Unknown — no reviewed opportunity group/);
  assert.match(html, /No explicit opportunity groups are recorded/);
  assert.match(html, /Individual call details/);
  assert.doesNotMatch(html, /\$0/);
  const defaults = buildFreeTestReport(input, now);
  assert.equal(Object.hasOwn(defaults, 'opportunityValue'), false);
  assert.doesNotMatch(renderFreeTestReport(input, { now }), /Estimated Opportunity Value/);
  assert.equal(renderFreeTestReport(input, { now }), renderFreeTestReport(input, { now, opportunityReview: null }));
});

test('opportunity review cannot bypass trusted details or enter the internal audience', async () => {
  const { input, snapshot, now } = await privateCallLedgerFixture();
  const review = reviewFor(input, now);
  assert.throws(() => buildFreeTestReport(input, now, null, review), { code: 'REPORT_OPPORTUNITY_DETAILS_REQUIRED' });
  for (const options of [
    { audience: 'client', opportunityReview: review },
    { audience: 'internal', opportunityReview: review },
    { audience: 'internal', callDetails: snapshot, opportunityReview: review },
  ]) assert.throws(() => renderFreeTestReport(input, { now, ...options }), { code: 'REPORT_RENDER_OPTIONS_INVALID' });
  assert.throws(() => buildFreeTestReport(input, now, JSON.parse(JSON.stringify(snapshot)), review),
    { code: 'REPORT_DETAILS_SOURCE_REQUIRED' });
  review.callRowsetDigest = key('stale-rowset');
  assert.throws(() => buildFreeTestReport(input, now, snapshot, review), { code: 'OPPORTUNITY_ROWSET_CONFLICT' });
});

test('client money formatting respects currency minor units without floating-point loss', async () => {
  const { input, snapshot, now } = await privateCallLedgerFixture();
  for (const [currency, amountMinorUnits, expected] of [
    ['JPY', 12500, '¥12,500'], ['KWD', 12500, 'KWD 12.500'],
    ['USD', Number.MAX_SAFE_INTEGER, '$90,071,992,547,409.91'],
  ]) {
    const review = reviewFor(input, now);
    Object.assign(review.groups[0].knownJobValue, { currency, amountMinorUnits });
    const html = renderFreeTestReport(input, { now, audience: 'client', callDetails: snapshot, opportunityReview: review });
    assert.equal(html.includes(expected), true);
  }
  const unsupported = reviewFor(input, now);
  unsupported.groups[0].knownJobValue.currency = 'ZZZ';
  assert.throws(() => renderFreeTestReport(input, { now, audience: 'client', callDetails: snapshot,
    opportunityReview: unsupported }), { code: 'REPORT_VALUE_CURRENCY_UNSUPPORTED' });
});

test('incomplete groups stay unvalued and applicable average basis is explicit', async () => {
  const { input, snapshot, now } = await privateCallLedgerFixture();
  const review = reviewFor(input, now);
  review.groups[0].averageJobValue = { ...review.groups[0].knownJobValue };
  review.groups[0].knownJobValue = null;
  const html = renderFreeTestReport(input, { now, audience: 'client', callDetails: snapshot, opportunityReview: review });
  assert.match(html, /Contractor-documented applicable average job value/);
  review.groups[0].reviewStatus = 'incomplete';
  const incomplete = renderFreeTestReport(input, { now, audience: 'client', callDetails: snapshot, opportunityReview: review });
  assert.match(incomplete, /Unknown — group review incomplete/);
  assert.doesNotMatch(incomplete, /\$125/);
  assert.match(incomplete, /Individual call details/);
});

test('three observed calls retain every ledger row while repeat calls share one valued group', async () => {
  const { input, snapshot, now } = await privateCallLedgerFixture([
    { issue_summary: 'Synthetic leaking water heater request' },
    { issue_summary: 'Synthetic repeat update about the same water heater' },
    { issue_summary: 'Synthetic separate drain request with value unknown' },
  ]);
  const review = reviewFor(input, now);
  const repeatRows = snapshot.rows.filter((row) => row.issueSummary.includes('water heater'));
  const separateRow = snapshot.rows.find((row) => row.issueSummary.includes('drain'));
  assert.equal(repeatRows.length, 2);
  review.groups[0].callKeys = repeatRows.map((row) => row.fact.CALL_KEY);
  review.groups.push({ groupKey: key('separate-group'), callKeys: [separateRow.fact.CALL_KEY],
    reviewStatus: 'qualified', knownJobValue: null, averageJobValue: null });
  const report = buildFreeTestReport(input, now, snapshot, review);
  assert.equal(report.duringTest.callsCaptured, 3);
  assert.equal(report.callDetails.length, 3);
  assert.equal(report.opportunityValue.status, 'partial');
  assert.equal(report.opportunityValue.valuedGroupCount, 1);
  assert.equal(report.opportunityValue.unknownGroupCount, 1);
  assert.equal(report.opportunityValue.ungroupedQualifiedCallCount, 0);
  assert.deepEqual(report.opportunityValue.subtotals,
    [{ currency: 'USD', amountMinorUnits: 12500, valuedGroupCount: 1 }]);
  assert.deepEqual(report.opportunityValue.groups.map((group) => group.callReferences.length).sort(), [1, 2]);
  const html = renderFreeTestReport(input, { now, audience: 'client', callDetails: snapshot, opportunityReview: review });
  assert.match(html, /Partial coverage — the amounts below are documented subtotals/);
  const summary = html.slice(html.indexOf('<div class="summary-overview">'), html.indexOf('<caption>Connected-call breakdown'));
  assert.match(summary, /<dt>Calls Handled<\/dt><dd>3<\/dd>/);
  assert.match(summary, /<dt>Reviewed Opportunity Groups<\/dt><dd>2<\/dd>/);
  assert.match(summary, /Estimated Opportunity Value — Partial coverage/);
  assert.match(summary, /\$125 — Partial Subtotal/);
  assert.match(summary, /Valued groups: 1 · Unknown \/ incomplete groups excluded: 1 · Potential new-job calls not yet grouped: 0/);
  assert.match(summary, /estimate, not revenue; unknown values are excluded, not treated as zero/);
  assert.match(html, /<th scope="row">Potential New-Job Calls<\/th><td>3<\/td>/);
  assert.doesNotMatch(html, /New job opportunities/);
  const groups = html.slice(html.indexOf('<div class="opportunity-groups">'), html.indexOf('<h3>Value limitations'));
  for (const row of snapshot.rows) assert.ok(groups.includes(row.issueSummary));
  for (const group of report.opportunityValue.groups) {
    assert.ok(groups.includes(group.groupReference));
    assert.ok(groups.includes(`<td>${group.callReferences.join(', ')}</td>`));
  }
  assert.equal((groups.match(/\$125/g) || []).length, 1);
  assert.equal((html.match(/<section class="call-detail">/g) || []).length, 3);
  for (const reference of ['C-0001', 'C-0002', 'C-0003']) assert.equal(html.includes(reference), true);
  for (const row of snapshot.rows) assert.equal(html.includes(row.issueSummary), true);
  assert.doesNotMatch(html, /\$250|\$375/);
  assert.match(html, /grid-template-rows: 1fr auto/);
  assert.match(html, /counter\(page\).*counter\(pages\)/);
  assert.match(html, /\.call-detail \{ break-inside: avoid; \}/);
  // A keep-with-next rule alone allows the introduction itself to split.
  const intro = html.match(/<h2 id="call-detail">Individual call details<\/h2>\s*<p>(.*?)<\/p>\s*<section class="call-detail"><table><caption>(.*?)<\/caption>/);
  assert.ok(intro, 'the complete introduction immediately precedes the first call record');
  assert.equal(intro[1], 'References apply to this draft only. Each record is one observed call, not necessarily a distinct job. Unknown means evidence is unavailable. An alert accepted by the provider is not proof of inbox receipt or completed office work.');
  assert.equal(intro[2], 'C-0001 — Call record');
  assert.match(html, /#call-detail \{ page-break-after: avoid; \}/);
  const introStyle = html.match(/#call-detail \+ p \{([^}]+)\}/)[1];
  for (const property of ['break-inside', 'page-break-inside', 'break-after', 'page-break-after']) {
    assert.match(introStyle, new RegExp(`(?:^|;)\\s*${property}: avoid;`));
  }
});

test('multi-call synthetic fixture remains bounded to one through four local analyses', async () => {
  for (const invalid of [[], Array.from({ length: 5 }, () => ({})), [null], [[]]]) {
    await assert.rejects(privateCallLedgerFixture(invalid), { message: 'SYNTHETIC_LEDGER_INPUT_INVALID' });
  }
  const { input, snapshot, now } = await privateCallLedgerFixture([{}, {}, {}, { outcome: 'spam' }]);
  const report = buildFreeTestReport(input, now, snapshot);
  assert.equal(report.callDetails.length, 4);
  assert.equal(report.duringTest.callsCaptured, 4);
  assert.equal(report.opportunityValue.qualifiedCallCount, 3);
});

test('client presentation uses the exact product name and disambiguated symbols without changing canonical currencies', async () => {
  const { input, snapshot, now } = await privateCallLedgerFixture();
  for (const [currency, expected] of [['USD', '$1,250'], ['CAD', 'CA$1,250'],
    ['AUD', 'A$1,250'], ['EUR', '\u20ac1,250'], ['GBP', '\u00a31,250']]) {
    const review = reviewFor(input, now);
    Object.assign(review.groups[0].knownJobValue, { currency, amountMinorUnits: 125000 });
    const report = buildFreeTestReport(input, now, snapshot, review);
    assert.equal(report.opportunityValue.subtotals[0].currency, currency);
    assert.equal(report.opportunityValue.subtotals[0].amountMinorUnits, 125000);
    const html = renderFreeTestReport(input, { now, audience: 'client', callDetails: snapshot, opportunityReview: review });
    assert.ok(html.includes(expected));
    assert.match(html, /<h1>7-Day Revenue Leak Test<\/h1>/);
    assert.match(html, /Private Review Draft - Not for delivery/);
    assert.doesNotMatch(html, /USD 1,250|Seven-Day Free Test Results/);
  }
});
