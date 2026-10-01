'use strict';

const crypto = require('node:crypto');
const { canonicalJson } = require('../functions/analytics_sync/lib/facts');
const { createReportAttemptBudget, REPORT_ATTEMPT_MAXIMUMS, REPORT_PAIR_ATTEMPT_MAXIMUMS } = require('../functions/analytics_sync/lib/report-attempt-budget');
const { createReconciledFreeTestInputReader } = require('./read-reconciled-free-test-input');
const { prepareFreeTestDocument, prepareFreeTestPdfDocument, pdfDocumentIdentity } = require('./prepare-free-test-draft');
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
  budgetOptions = {}, synthetic = false, pdfRenderer = null, reportBundle = false } = {}) {
  if (!runs || !runtimeConfig || runtimeConfig.environment !== 'development'
    || !/^[a-f0-9]{40}$/.test(runtimeConfig.sourceRevision)
    || typeof now !== 'function' || typeof synthetic !== 'boolean'
    || typeof reportBundle !== 'boolean' || (reportBundle && !pdfRenderer)
    || (readOpportunityReview !== null && typeof readOpportunityReview !== 'function')) fail();
  const timeoutMs = budgetOptions.timeoutMs ?? (reportBundle ? 120000 : 60000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000
    || Object.keys(budgetOptions).some(key => !['timeoutMs', 'limits'].includes(key))) fail();
  const ceilings = reportBundle ? REPORT_PAIR_ATTEMPT_MAXIMUMS : LIMITS;
  const limits = { ...ceilings, ...budgetOptions.limits };
  // Trusted configuration may narrow ceilings, never expand them silently.
  if (Object.keys(limits).length !== Object.keys(LIMITS).length
    || Object.keys(limits).some(key => !Number.isSafeInteger(limits[key])
      || limits[key] < 1 || limits[key] > ceilings[key])) fail();
  // Reject a known-incomplete HTTP plan before any durable/render claim is consumed.
  // Each complete partition pass is three fixed metadata/export pairs; review
  // adds the existing extra source fence. Narrowing remains allowed above this floor.
  if (reportBundle && (timeoutMs !== 120000
    || limits.analytics_read < (readOpportunityReview ? 24 : 18)
    || Object.keys(ceilings).some(kind => kind !== 'analytics_read' && limits[kind] !== ceilings[kind]))) fail();
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
      const documentOptions = { callDetails: prepared.callDetails, opportunityReview, now: now(), synthetic };
      const reviewSnapshotSha256 = crypto.createHash('sha256').update(canonicalJson({ review: opportunityReview ?? null })).digest('hex');
      const source = prepareFreeTestDocument(prepared.input, documentOptions);
      const write = createWorkDriveDraftWriter({ reportRunStore: runs, workdrive, now,
        async readDestinationBinding(...args) {
          const binding = await readDestinationBinding(...args);
          if (binding?.clientId !== scope.clientId || binding?.deploymentId !== scope.deploymentId) fail();
          return binding;
        } });
      const roles = reportBundle ? ['summary', 'supporting'] : [null];
      const sources = roles.map(role => ({ role, packetOptions: { ...documentOptions,
        ...(role ? { packetRole: role } : {}) }, source: role
          ? prepareFreeTestDocument(prepared.input, { ...documentOptions, packetRole: role }) : source }));
      let bundleRow = null;
      let bundleIdentity = null;
      if (reportBundle) {
        bundleIdentity = { ...identity, sourceGenerationKey: source.generationKey,
          rendererVersion: 'free-test-pair-v1', reviewSnapshotSha256, artifacts: Object.fromEntries(sources.map(item =>
            [item.role, pdfDocumentIdentity(item.source, pdfRenderer)])) };
        const bundleKey = crypto.createHash('sha256').update(`report-pdf-pair-v1\0${canonicalJson(bundleIdentity)}`).digest('hex');
        bundleRow = await runs.get(bundleKey, context);
        if (!bundleRow) bundleRow = await runs.insert(bundleKey, { kind: 'report_bundle_v1',
          identity: bundleIdentity, phase: 'working', manifest: null }, context);
        budget.assertActive();
        if (!bundleRow || bundleRow.state.kind !== 'report_bundle_v1'
          || canonicalJson(bundleRow.state.identity) !== canonicalJson(bundleIdentity)
          || !['working','accepted'].includes(bundleRow.state.phase)) fail();
      }
      const artifacts = {};
      for (const { role, packetOptions, source } of sources) {
        let document = source;
        let cached = null;
        let generationRow = null;
        if (pdfRenderer) {
          const pdfIdentity = pdfDocumentIdentity(source, pdfRenderer);
          const renderIdentity = { ...identity, ...pdfIdentity };
          const renderKey = crypto.createHash('sha256')
            .update(`report-pdf-generation-v1\0${canonicalJson(renderIdentity)}`).digest('hex');
          generationRow = await runs.get(renderKey, context);
          budget.assertActive();
          const owner = crypto.randomUUID();
          let mine = false;
          if (!generationRow) {
            const state = { kind: 'pdf_generation_v1', identity: renderIdentity,
              phase: 'render_started', owner, accepted: null };
            generationRow = await runs.insert(renderKey, state, context);
            budget.assertActive();
            mine = generationRow?.state.owner === owner;
          }
          if (!generationRow || generationRow.state.kind !== 'pdf_generation_v1'
            || canonicalJson(generationRow.state.identity) !== canonicalJson(renderIdentity)
            || !['render_started', 'accepted'].includes(generationRow.state.phase)) fail();
          // A consumed dispatch never expires or resets. Unknown rendering/upload
          // completion may be reconciled from exact stored bytes, never rerendered.
          cached = await write.readExistingPdf(source, pdfRenderer, context);
          budget.assertActive();
          if (cached) document = cached.document;
          else if (mine) document = await prepareFreeTestPdfDocument(prepared.input, packetOptions, pdfRenderer, context);
          else fail();
          budget.assertActive();
          if (document.generationKey !== pdfIdentity.generationKey) fail();
          if (generationRow.state.phase === 'accepted'
            && (!cached || generationRow.state.accepted?.generationKey !== document.generationKey
              || generationRow.state.accepted?.documentSha256 !== document.documentSha256
              || generationRow.state.accepted?.receiptSha256 !== cached.result.receiptSha256)) fail();
          // Export/retrieval is asynchronous: re-attest the complete current
          // source before accepting the result, without replaying CRM/imports.
          const freshReview = readOpportunityReview
            ? structuredClone(await readOpportunityReview(scope, context)) : opportunityReview;
          budget.assertActive();
          const fresh = await read(scope, context);
          budget.assertActive();
          if (!fresh || (readOpportunityReview && freshReview === undefined)
            || (reportBundle && crypto.createHash('sha256').update(canonicalJson({ review: freshReview ?? null })).digest('hex') !== reviewSnapshotSha256)) fail();
          const currentSource = prepareFreeTestDocument(fresh.input, {
            callDetails: fresh.callDetails, opportunityReview: freshReview, now: now(), synthetic, ...(role ? { packetRole: role } : {}) });
          if (currentSource.generationKey !== document.sourceGenerationKey) fail();
        }
        const result = cached?.result || await write(document, context);
        budget.assertActive();
        if (generationRow && generationRow.state.phase !== 'accepted') {
          const accepted = { generationKey: result.generationKey,
            documentSha256: result.documentSha256, receiptSha256: result.receiptSha256 };
          const state = { ...generationRow.state, phase: 'accepted', accepted };
          const saved = await runs.compareAndSwap(generationRow, state, context);
          budget.assertActive();
          const verified = saved || await runs.get(generationRow.key, context);
          budget.assertActive();
          if (!verified || canonicalJson(verified.state) !== canonicalJson(state)) fail();
        }
        budget.assertActive();
        artifacts[role || "legacy"] = result;
      }
      let result = artifacts.legacy;
      if (reportBundle) {
        const manifest = { schemaVersion: 1, sourceGenerationKey: source.generationKey,
          initialDeliveryArtifact: 'summary', supportingAvailability: 'private', reviewSnapshotSha256,
          artifacts: Object.fromEntries(['summary','supporting'].map(role => [role, {
            generationKey: artifacts[role].generationKey, documentSha256: artifacts[role].documentSha256,
            receiptSha256: artifacts[role].receiptSha256,
            privateReceiptKey: crypto.createHash('sha256').update(`workdrive-draft-v1\0${artifacts[role].generationKey}`).digest('hex') }])) };
        const manifestSha256 = crypto.createHash('sha256').update(canonicalJson(manifest)).digest('hex');
        const state = { ...bundleRow.state, phase: 'accepted', manifest, manifestSha256 };
        if (bundleRow.state.phase === 'accepted') {
          if (canonicalJson(bundleRow.state) !== canonicalJson(state)) fail();
        } else {
          const saved = await runs.compareAndSwap(bundleRow, state, context);
          const verified = saved || await runs.get(bundleRow.key, context);
          if (!verified || canonicalJson(verified.state) !== canonicalJson(state)) fail();
        }
        budget.assertActive();
        result = Object.freeze({ status: 'report_pair_verified_not_for_delivery',
          generationKey: bundleRow.key, documentSha256: manifestSha256, receiptSha256: manifestSha256,
          manifestSha256, manifest: Object.freeze(manifest), artifacts: Object.freeze(artifacts) });
      }
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

module.exports = { createDurableReportComposition, REPORT_ATTEMPT_LIMITS: LIMITS, REPORT_PAIR_ATTEMPT_LIMITS: REPORT_PAIR_ATTEMPT_MAXIMUMS };
