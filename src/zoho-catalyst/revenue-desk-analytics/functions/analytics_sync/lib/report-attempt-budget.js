'use strict';

const { AnalyticsSyncError, invariant } = require('./errors');

const budgets = new WeakSet();
const MAXIMUMS = Object.freeze({ analytics_read: 12, source_read: 240, checkpoint_write: 3,
  workdrive_read: 24, workdrive_write: 1, report_run_read: 16, report_run_write: 12 });

// Four complete source passes when reviewed (initial, review fence, two PDF fences),
// each three metadata/export pairs. Legacy single-document ceilings are unchanged.
const PAIR_MAXIMUMS = Object.freeze({ ...MAXIMUMS, analytics_read: 24, workdrive_read: 48, workdrive_write: 2,
  report_run_read: 40, report_run_write: 26 });

/** One trusted construction-time budget for the complete reporting attempt.
 * Reservations count even when authorization or a request fails. They cannot be
 * replenished by a retry, another source pass, or a document adapter.
 */
function createReportAttemptBudget({ signal, timeoutMs, limits, now = Date.now } = {}) {
  invariant((signal === undefined || signal instanceof AbortSignal) && typeof now === 'function'
    && Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 120_000
    && limits && typeof limits === 'object' && !Array.isArray(limits)
    && Object.keys(limits).sort().join(',') === Object.keys(MAXIMUMS).sort().join(',')
    && Object.keys(MAXIMUMS).every((key) => Number.isSafeInteger(limits[key])
      && limits[key] >= 0 && limits[key] <= PAIR_MAXIMUMS[key]),
  'REPORT_BUDGET_INVALID', 'Report attempt budget is invalid.');
  const startedAt = now();
  invariant(Number.isSafeInteger(startedAt) && startedAt >= 0
    && Number.isSafeInteger(startedAt + timeoutMs),
  'REPORT_BUDGET_INVALID', 'Report attempt deadline is invalid.');
  const ceilings = Object.freeze({ ...limits });
  const used = Object.fromEntries(Object.keys(MAXIMUMS).map((key) => [key, 0]));
  const controller = new AbortController();
  let closed = false;
  let reason = null;
  const abort = (code) => { if (!reason) reason = code; controller.abort(); };
  const parentAbort = () => abort('REPORT_ATTEMPT_ABORTED');
  signal?.addEventListener('abort', parentAbort, { once: true });
  if (signal?.aborted) parentAbort();
  const timer = setTimeout(() => abort('REPORT_ATTEMPT_TIMEOUT'), timeoutMs);
  function assertActive() {
    const current = now();
    if (!Number.isSafeInteger(current) || current < startedAt || current - startedAt >= timeoutMs) {
      abort('REPORT_ATTEMPT_TIMEOUT');
    }
    if (closed || controller.signal.aborted) throw new AnalyticsSyncError(
      reason || 'REPORT_ATTEMPT_ABORTED', 'Report attempt budget is closed.', { retryable: true });
  }
  const budget = Object.freeze({
    signal: controller.signal,
    assertActive,
    consume(kind, count = 1) {
      assertActive();
      invariant(Object.hasOwn(ceilings, kind) && Number.isSafeInteger(count) && count > 0,
        'REPORT_BUDGET_INVALID', 'Report operation reservation is invalid.');
      if (count > ceilings[kind] - used[kind]) {
        abort('REPORT_ATTEMPT_LIMIT_EXCEEDED');
        assertActive();
      }
      used[kind] += count;
    },
    snapshot() { return Object.freeze({ ...used }); },
    close() {
      closed = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', parentAbort);
      abort('REPORT_ATTEMPT_ABORTED');
    },
  });
  budgets.add(budget);
  return budget;
}

const isReportAttemptBudget = (value) => budgets.has(value);

module.exports = { createReportAttemptBudget, isReportAttemptBudget, REPORT_ATTEMPT_MAXIMUMS: MAXIMUMS, REPORT_PAIR_ATTEMPT_MAXIMUMS: PAIR_MAXIMUMS };
