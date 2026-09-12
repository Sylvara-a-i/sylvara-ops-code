'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const vm = require('node:vm');
const { renderFreeTestDemo } = require('../lib/free-test-demo-view');

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

test('all fixture text is escaped and no executable remote assets or forms exist', () => {
  const input = fixture();
  input.companies[0].key = '<script src="https://invalid.example"></script>';
  input.companies[0].notificationPreviews = { value: '</pre><img src=x onerror=alert(1)>' };
  const html = renderFreeTestDemo(input);
  assert.match(html, /&lt;script/);
  assert.match(html, /&lt;\/pre&gt;&lt;img/);
  assert.doesNotMatch(html, /<(?:img|iframe|form|audio|video|link)\b|<script\s+src=/i);
  assert.match(html, /connect-src 'none'/);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(script, /fetch|XMLHttpRequest|WebSocket|getUserMedia|window\.open|location\s*=/);
  assert.match(html, new RegExp(`sha256-${createHash('sha256').update(script).digest('base64').replace(/[+]/g, '\\+')}`));
});

test('local step controls and company selection work without network or browser globals', () => {
  const html = renderFreeTestDemo(fixture());
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
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
});
