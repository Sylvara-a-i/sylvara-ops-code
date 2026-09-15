'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const vm = require('node:vm');
const { renderFreeTestDemo } = require('../lib/free-test-demo-view');

// Inspect this renderer's fixed markup, not arbitrary HTML. An unexpected second
// script must fail the test rather than leave its code outside the assertions.
function singleInlineScript(html) {
  assert.equal((html.match(/<script\b/gi) || []).length, 1, 'Exactly one script tag is allowed');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi)];
  assert.equal(scripts.length, 1, 'Exactly one complete script is required');
  assert.match(scripts[0][0], /^<script>/i, 'The script must have no attributes');
  assert.ok(scripts[0][0].toLowerCase().endsWith('</script>'), 'The closing script tag must be exact');
  return scripts[0][1];
}

function fixture() {
  return {
    label: 'SYNTHETIC DEMONSTRATION — NO LIVE CALLS',
    companies: ['A', 'B'].map(key => ({
      key, preparation: { candidate: { businessHours: 'Reviewed synthetic hours' } },
      report: { engagementType: 'free_test', calls: [], metrics: { unresolvedCalls: 1 } },
      notificationPreviews: [], crmSummary: { adapter: 'fake' }, state: 'stopped',
    })),
  };
}

test('renderer requires a two-company synthetic report and preserves unknowns', () => {
  assert.throws(() => renderFreeTestDemo({}), /SYNTHETIC_DEMO_REQUIRED/);
  const input = fixture();
  const html = renderFreeTestDemo(input);
  assert.equal((html.match(/class="company"/g) || []).length, 2);
  assert.equal((html.match(/data-step="/g) || []).length, 14);
  assert.match(html, /Unknown \/ not established/);
  assert.match(html, /not confirmed jobs, recovered revenue/);
  input.companies[0].report.engagementType = 'paid';
  assert.throws(() => renderFreeTestDemo(input), /SYNTHETIC_REPORT_REQUIRED/);
});

test('early-stop rehearsal is labeled separately and never claims carrier restoration', () => {
  const input = fixture();
  input.earlyStopRehearsal = {
    before: { testStatus: 'Live', callsCaptured: 1 },
    after: { testStatus: 'Stopped', approvalStatus: 'Revoked' },
    newAdmissionRejected: true, alreadyAdmittedCallSettled: true,
    terminalEvidencePreserved: true, sameCommandReplay: true,
    revocationReceiptCount: 1, originalHandlingRestorationVerified: false,
    report: { callsCaptured: 2, testEndReason: 'Sylvara Stopped',
      testEnd: '2026-08-22T12:01:02.000Z', sourceModifiedAt: '2026-08-22T12:01:03.000Z' },
  };
  const html = renderFreeTestDemo(input);
  assert.equal((html.match(/Early operator stop — separate synthetic rehearsal/g) || []).length, 1);
  assert.match(html, /Stopped \/ Revoked/);
  assert.match(html, /rehearsal calls are not added to the two reports/);
  assert.match(html, /Rehearsal report connected calls<\/th><td>2/);
  assert.match(html, /Rehearsal report end reason<\/th><td>Sylvara Stopped/);
  assert.match(html, /Rehearsal report ended at<\/th><td>2026-08-22T12:01:02.000Z/);
  assert.match(html, /Original carrier handling restored<\/th><td>Unknown \/ not established/);
  assert.doesNotMatch(html, /Original carrier handling restored<\/th><td>Verified/);
});

test('all fixture text is escaped and no executable remote assets or forms exist', () => {
  const input = fixture();
  input.companies[0].key = '<ScRiPt src="https://invalid.example"></sCrIpT>';
  input.companies[0].notificationPreviews = { value: '</pre><img src=x onerror=alert(1)>' };
  const html = renderFreeTestDemo(input);
  assert.match(html, /&lt;ScRiPt/);
  assert.match(html, /&lt;\/pre&gt;&lt;img/);
  assert.doesNotMatch(html, /<(?:img|iframe|form|audio|video|link)\b|<script\s+src=/i);
  assert.match(html, /connect-src 'none'/);
  const script = singleInlineScript(html);
  assert.doesNotMatch(script, /fetch|XMLHttpRequest|WebSocket|getUserMedia|window\.open|location\s*=/);
  const digest = createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes(`script-src 'sha256-${digest}';`), 'CSP must allow the exact inline script hash');
});

test('script inspection rejects extra, incomplete, or attributed scripts regardless of tag case', () => {
  assert.equal(singleInlineScript('<SCRIPT>approved()</sCrIpT>'), 'approved()');
  assert.throws(() => singleInlineScript('<script>approved()</script><ScRiPt>unexpected()</ScRiPt>'), /Exactly one script tag/);
  assert.throws(() => singleInlineScript('<script>incomplete()'), /Exactly one complete script/);
  assert.throws(() => singleInlineScript('<script src="https://invalid.example"></script>'), /no attributes/);
  assert.throws(() => singleInlineScript('<script>unexpected()</script\t\n bar>'), /closing script tag must be exact/);
  assert.throws(() => singleInlineScript('<script>unexpected()</SCRIPT >'), /closing script tag must be exact/);
  assert.throws(() => singleInlineScript('<script>unexpected()</script/>'), /closing script tag must be exact/);
});

test('local step controls and company selection work without network or browser globals', () => {
  const html = renderFreeTestDemo(fixture());
  const script = singleInlineScript(html);
  const element = data => ({ dataset: data, hidden: false, events: {}, attributes: {},
    addEventListener(name, callback) { this.events[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; } });
  const articles = [0, 1].map(() => {
    const article = element({});
    article.sections = Array.from({ length: 7 }, (_, step) => element({ step: String(step) }));
    article.querySelectorAll = () => article.sections;
    return article;
  });
  const buttons = Array.from({ length: 7 }, (_, go) => element({ go: String(go) }));
  const ids = Object.fromEntries(['company', 'progress', 'previous', 'next'].map(id => [id, element({})]));
  vm.runInNewContext(script, { document: {
    querySelectorAll: selector => selector === '.company' ? articles : buttons,
    getElementById: id => ids[id],
  } }, { timeout: 1000 });
  assert.equal(articles[0].hidden, false);
  assert.equal(articles[1].hidden, true);
  assert.equal(ids.previous.disabled, true);
  buttons[5].events.click();
  assert.equal(ids.progress.textContent, '6 of 7 · Results');
  assert.equal(articles[0].sections[5].hidden, false);
  ids.company.events.change({ target: { value: '1' } });
  assert.equal(articles[0].hidden, true);
  assert.equal(articles[1].sections[5].hidden, false);
  ids.next.events.click();
  assert.equal(ids.next.disabled, true);
  ids.previous.events.click();
  assert.equal(ids.next.disabled, false);
  // Exercise all fourteen company/step combinations, not just the Results and
  // Stop examples, so future navigation edits cannot hide one company's state.
  for (let company = 0; company < articles.length; company += 1) {
    ids.company.events.change({ target: { value: String(company) } });
    for (let step = 0; step < buttons.length; step += 1) {
      buttons[step].events.click();
      assert.equal(articles[company].hidden, false);
      assert.equal(articles[1 - company].hidden, true);
      articles[company].sections.forEach((section, index) => {
        assert.equal(section.hidden, index !== step);
      });
      assert.equal(ids.previous.disabled, step === 0);
      assert.equal(ids.next.disabled, step === 6);
      assert.equal(buttons[step].attributes['aria-current'], 'step');
      assert.equal(buttons.filter((button) => button.attributes['aria-current'] === 'step').length, 1);
    }
  }
});
