'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createReportAttemptBudget, isReportAttemptBudget, REPORT_ATTEMPT_MAXIMUMS } = require('../lib/report-attempt-budget');

const make = (overrides = {}) => createReportAttemptBudget({ timeoutMs: 1000, limits: REPORT_ATTEMPT_MAXIMUMS, ...overrides });

test('whole-attempt request reservations are branded, exact, bounded and never replenished', () => {
  const budget = make();
  try {
    assert.equal(isReportAttemptBudget(budget), true);
    assert.equal(isReportAttemptBudget({ ...budget }), false);
    budget.consume('analytics_read', 6);
    budget.consume('analytics_read', 6);
    assert.equal(budget.snapshot().analytics_read, 12);
    assert.throws(() => budget.consume('analytics_read'), { code: 'REPORT_ATTEMPT_LIMIT_EXCEEDED' });
    assert.equal(budget.signal.aborted, true);
    assert.equal(budget.snapshot().analytics_read, 12);
    assert.throws(() => budget.consume('workdrive_write'), { code: 'REPORT_ATTEMPT_LIMIT_EXCEEDED' });
  } finally { budget.close(); }
  for (const limits of [{ ...REPORT_ATTEMPT_MAXIMUMS, source_read: 241 },
    { ...REPORT_ATTEMPT_MAXIMUMS, checkpoint_write: true },
    { ...REPORT_ATTEMPT_MAXIMUMS, extra: 1 }, {}]) {
    assert.throws(() => make({ limits }), { code: 'REPORT_BUDGET_INVALID' });
  }
  for (const timeoutMs of [null, true, '', 0, 120001, 2.5]) {
    assert.throws(() => make({ timeoutMs }), { code: 'REPORT_BUDGET_INVALID' });
  }
});

test('the whole-attempt deadline, parent cancellation and close stop later work', async () => {
  let now = 1000;
  const budget = make({ now: () => now });
  now += 1000;
  assert.throws(() => budget.assertActive(), { code: 'REPORT_ATTEMPT_TIMEOUT' });
  budget.close();
  const parent = new AbortController();
  const cancelled = make({ signal: parent.signal });
  parent.abort();
  assert.throws(() => cancelled.consume('source_read'), { code: 'REPORT_ATTEMPT_ABORTED' });
  cancelled.close();
  const timed = make({ timeoutMs: 10 });
  await new Promise((resolve) => timed.signal.addEventListener('abort', resolve, { once: true }));
  assert.throws(() => timed.assertActive(), { code: 'REPORT_ATTEMPT_TIMEOUT' });
  timed.close();
  const closed = make();
  closed.close();
  assert.throws(() => closed.consume('source_read'), { code: 'REPORT_ATTEMPT_ABORTED' });
});
