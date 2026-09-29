'use strict';

const crypto = require('node:crypto');
const { canonicalJson } = require('../functions/analytics_sync/lib/facts');
const { createReportAttemptBudget, REPORT_ATTEMPT_MAXIMUMS } = require('../functions/analytics_sync/lib/report-attempt-budget');
const { createReconciledFreeTestInputReader } = require('./read-reconciled-free-test-input');
const { prepareFreeTestDocument } = require('./prepare-free-test-draft');
const { createWorkDriveDraftWriter } = require('./prepare-workdrive-draft');
const LIMITS = REPORT_ATTEMPT_MAXIMUMS;
const WAITING = Object.freeze({ status: 'awaiting_reconciled_evidence' });
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value);
function fail() { throw Object.assign(new Error('DRAFT_RECONCILIATION_REQUIRED'), { code: 'DRAFT_RECONCILIATION_REQUIRED' }); }

/** Trusted worker construction only; never selected by Job parameters or a toggle.
 * A durable scope claim runs BEFORE source/provider reads, with a six-failure
 * ceiling and persisted backoff. Reusing an exact draft resets failure count but
 * retains a 15-minute minimum read interval. A reviewed revision uses the same
 * validated renderer and its new content key; the old document stays immutable.
 */
function createDurableReportComposition({ runtimeStore, runtimeConfig, analyticsStore,
  readCompleteScope, readOpportunityReview = null, reportRunStore: runs, workdrive,
  readDestinationBinding, reattestCheckpoints = null, now = Date.now,
  budgetOptions = {}, synthetic = false } = {}) {
  if (!runs || !runtimeConfig || runtimeConfig.environment !== 'development'
    || !/^[a-f0-9]{40}$/.test(runtimeConfig.sourceRevision)
    || typeof now !== 'function' || typeof synthetic !== 'boolean'
    || (readOpportunityReview !== null && typeof readOpportunityReview !== 'function')) fail();
  const timeoutMs = budgetOptions.timeoutMs ?? 60000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000
    || Object.keys(budgetOptions).some(key => !['timeoutMs', 'limits'].includes(key))) fail();
  const limits = { ...LIMITS, ...budgetOptions.limits };
  // Trusted configuration may narrow ceilings, never expand them silently.
  if (Object.keys(limits).length !== Object.keys(LIMITS).length
    || Object.keys(limits).some(key => !Number.isSafeInteger(limits[key])
      || limits[key] < 1 || limits[key] > LIMITS[key])) fail();
  const read = createReconciledFreeTestInputReader({ runtimeStore, runtimeConfig,
    analyticsStore, readCompleteScope, reattestCheckpoints, now });
  async function reconcile(scope, options = {}) {
    let budget;
    try {
      if (!scope || Object.keys(scope).sort().join(',') !== 'clientId,deploymentId'
        || !id(scope.clientId) || !id(scope.deploymentId)
        || Object.keys(options).some(key => key !== 'signal')) fail();
      budget = createReportAttemptBudget({ signal: options.signal, timeoutMs, limits, now });
      const context = Object.freeze({ signal: budget.signal, budget });
      // ReportRuns requires true period/relationship identity even for a pending
      // verification attempt. Read the existing canonical terminal row; do not
      // fabricate a period from the retry clock or manufacture report success.
      budget.consume('source_read');
      const terminal = await runtimeStore.unique(runtimeConfig.tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', scope.deploymentId);
      budget.assertActive();
      const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
        && new Date(value).toISOString() === value;
      if (!terminal || terminal.CLIENT_ID !== scope.clientId
        || terminal.SOURCE_REVISION !== runtimeConfig.sourceRevision
        || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(terminal.ACTIVE_CONFIGURATION_VERSION_ID)
        || !instant(terminal.ACTUAL_START_AT) || !instant(terminal.STOPPED_AT)
        || terminal.STOPPED_AT < terminal.ACTUAL_START_AT) fail();
      const identity = { ...scope, environment: runtimeConfig.environment, sourceRevision: runtimeConfig.sourceRevision,
        configurationVersionId: terminal.ACTIVE_CONFIGURATION_VERSION_ID,
        periodStart: terminal.ACTUAL_START_AT.slice(0, 10), periodEnd: terminal.STOPPED_AT.slice(0, 10) };
      const key = crypto.createHash('sha256').update(`report-attempt-v1\0${canonicalJson(identity)}`).digest('hex');
      let row = await runs.get(key, context);
      budget.assertActive();
      if (row) {
        if (row.state.kind !== 'report_attempt_v1' || canonicalJson(row.state.identity) !== canonicalJson(identity)
          || !Number.isSafeInteger(row.state.failures) || row.state.failures < 0 || row.state.failures > 6
          || !Number.isSafeInteger(row.state.nextAttemptAt)
          || !['working', 'waiting', 'verified'].includes(row.state.phase)) fail();
        if (row.state.failures >= 6 || row.state.nextAttemptAt > now()) return WAITING;
      }
      const failures = (row?.state.failures || 0) + 1;
      const backoffMs = Math.min(1800000, 60000 * 2 ** (failures - 1));
      const claim = { kind: 'report_attempt_v1', identity, phase: 'working', owner: crypto.randomUUID(),
        failures, nextAttemptAt: now() + Math.max(timeoutMs + 5000, backoffMs),
        lastGenerationKey: row?.state.lastGenerationKey || null };
      row = row ? await runs.compareAndSwap(row, claim, context) : await runs.insert(key, claim, context);
      budget.assertActive();
      if (!row || canonicalJson(row.state) !== canonicalJson(claim)) return WAITING;
      let prepared = await read(scope, context);
      budget.assertActive();
      if (prepared === null) {
        if (!await runs.compareAndSwap(row, { ...claim, phase: 'waiting' }, context)) fail();
        return WAITING;
      }
      let opportunityReview = null;
      if (readOpportunityReview) {
        opportunityReview = structuredClone(await readOpportunityReview(scope, context));
        budget.assertActive();
        if (opportunityReview === undefined) fail();
        prepared = await read(scope, context);
        budget.assertActive();
        if (prepared === null) {
          if (!await runs.compareAndSwap(row, { ...claim, phase: 'waiting' }, context)) fail();
          return WAITING;
        }
      }
      const document = prepareFreeTestDocument(prepared.input, { callDetails: prepared.callDetails,
        opportunityReview, now: now(), synthetic });
      const write = createWorkDriveDraftWriter({ reportRunStore: runs, workdrive, now,
        async readDestinationBinding(...args) {
          const binding = await readDestinationBinding(...args);
          if (binding?.clientId !== scope.clientId || binding?.deploymentId !== scope.deploymentId) fail();
          return binding;
        } });
      const result = await write(document, context);
      budget.assertActive();
      const finished = { ...claim, phase: 'verified', failures: 0,
        nextAttemptAt: now() + 900000, lastGenerationKey: result.generationKey };
      if (!await runs.compareAndSwap(row, finished, context)) fail();
      budget.assertActive();
      return result;
    } catch { fail(); }
    finally { budget?.close(); }
  }
  // The trusted runtime wrapper recognizes this bounded duration; public job
  // input and environment configuration cannot install or lengthen this hook.
  Object.defineProperty(reconcile, 'attemptTimeoutMs', { value: timeoutMs });
  return Object.freeze(reconcile);
}

module.exports = { createDurableReportComposition, REPORT_ATTEMPT_LIMITS: LIMITS };
