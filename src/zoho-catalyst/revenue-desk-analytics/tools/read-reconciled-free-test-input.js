'use strict';

const { canonicalJson, checkpointKey, minimizeFact, parseOutboxRow, sha256 } = require('../functions/analytics_sync/lib/facts');
const { REPORT_SOURCE_PAGE_SIZE } = require('../functions/analytics_sync/lib/catalyst-store');
const { isReportAttemptBudget } = require('../functions/analytics_sync/lib/report-attempt-budget');
const { checkpointState, checkpointVerificationPatch } = require('../functions/analytics_sync/lib/report-checkpoint-verification');
const { queryClientCallDetails, queryClientReport } = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/reporting');
const { createRuntimeService, loadDeployment } = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/runtime-service');
const { deploymentFact, finalTestResultFact } = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/analytics-outbox');
const { buildFreeTestReport, factRowsetDigest, readbackRowsetDigest } = require('./build-free-test-report');
const { buildPrivateCallLedger } = require('./build-private-call-ledger');
const { reportVerificationDigest } = require('./reattest-report-checkpoints');
const { scopeInventoryDigest } = require('./evaluate-dashboard-pre-render-gate');

const TYPES = Object.freeze(['deployment', 'call', 'final_test_result']);
const SCOPE_KEYS = Object.freeze(['CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION',
  'ENGAGEMENT_TYPE', 'ENVIRONMENT', 'SOURCE_REVISION']);
const READBACK_KEYS = Object.freeze(['RECORD_KEY', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENVIRONMENT',
  'PAYLOAD_HASH', 'SOURCE_MODIFIED_AT']);
const MAX_SOURCE_ROWS = TYPES.length * (REPORT_SOURCE_PAGE_SIZE - 1);
const terminalReconciled = (row) => row && ((row.TEST_STATUS === 'Completed'
  && row.REPORT_RECONCILIATION_STATUS === 'Completed') || (row.TEST_STATUS === 'Stopped'
  && row.REPORT_RECONCILIATION_STATUS === 'NotRequired'));

function fail() {
  const error = new Error('DRAFT_RECONCILIATION_REQUIRED');
  error.code = 'DRAFT_RECONCILIATION_REQUIRED';
  throw error;
}

const requireCondition = (condition) => { if (!condition) fail(); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const canonicalTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

function integer(value) {
  const parsed = typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  requireCondition(Number.isSafeInteger(parsed) && parsed >= 0);
  return parsed;
}

function sourceSnapshot(rows, scope) {
  requireCondition(Array.isArray(rows) && rows.length <= MAX_SOURCE_ROWS);
  const parsed = rows.map((row) => parseOutboxRow(structuredClone(row), scope.ENVIRONMENT));
  const latest = new Map();
  const identities = new Set();
  for (const row of parsed) {
    requireCondition(TYPES.includes(row.RECORD_TYPE)
      && integer(row.ROW_SCHEMA_VERSION) === 2
      && ['CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION', 'ENGAGEMENT_TYPE', 'ENVIRONMENT']
        .every((key) => row[key] === scope[key]));
    const versionKey = `${row.RECORD_TYPE}:${row.RECORD_KEY}:${row.SOURCE_MODIFIED_AT}`;
    requireCondition(!identities.has(versionKey));
    identities.add(versionKey);
    const key = `${row.RECORD_TYPE}:${row.RECORD_KEY}`;
    if (!latest.has(key) || latest.get(key).SOURCE_MODIFIED_AT < row.SOURCE_MODIFIED_AT) latest.set(key, row);
  }
  const current = [...latest.values()].sort((a, b) => a.OUTBOX_KEY.localeCompare(b.OUTBOX_KEY));
  requireCondition(TYPES.every((type) => parsed.filter((row) => row.RECORD_TYPE === type).length < REPORT_SOURCE_PAGE_SIZE));
  requireCondition(current.every((row) => row.SOURCE_REVISION === scope.SOURCE_REVISION));
  // Include older pending versions: the latest-looking facts cannot waive an
  // unresolved source write or import in this test's report partition.
  return { rows: current, settled: parsed.every((row) => row.SYNC_STATUS === 'Succeeded'),
    fingerprint: parsed.map((row) => canonicalJson(row)).sort().join('\n') };
}

function checkpointProjection(row, scope, type) {
  if (row === null) return null;
  requireCondition(row && integer(row.ROW_SCHEMA_VERSION) === 2 && row.RECORD_TYPE === type
    && row.CHECKPOINT_KEY === checkpointKey({ ...scope, RECORD_TYPE: type })
    && ['ENVIRONMENT', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'SOURCE_REVISION'].every((key) => row[key] === scope[key]));
  return { status: row.STATUS, last_error_code: row.LAST_ERROR_CODE,
    last_rejected_row_count: integer(row.LAST_REJECTED_ROW_COUNT),
    last_source_modified_at: row.LAST_SOURCE_MODIFIED_AT, provider_watermark: row.PROVIDER_WATERMARK,
    last_reconciled_at: row.LAST_RECONCILED_AT, stale_after_at: row.STALE_AFTER_AT,
    source_revision: row.SOURCE_REVISION };
}

/** Assemble the existing report gate from canonical and independently read-back
 * records. This trusted application boundary accepts no caller-supplied report
 * facts, completeness assertion, approval packet, or serialized private ledger.
 *
 * readCompleteScope is the sole provider-contract boundary. It must independently
 * verify the fixed Analytics target and a complete partition (including zero
 * calls and unexpected rows), not export only the requested source record keys.
 * The current provider client's IN-key batch readback is not that contract.
 * No live complete-scope reader or storage destination is installed here.
 */
function createReconciledFreeTestInputReader({ runtimeStore, runtimeConfig, analyticsStore,
  readCompleteScope, reattestCheckpoints = null, now = Date.now } = {}) {
  requireCondition(runtimeStore && typeof runtimeStore.query === 'function' && typeof runtimeStore.unique === 'function'
    && typeof runtimeStore.queryBounded === 'function'
    && runtimeConfig?.environment === 'development' && /^[a-f0-9]{40}$/.test(runtimeConfig.sourceRevision)
    && typeof analyticsStore?.listReportRows === 'function'
    && typeof analyticsStore?.getReportCheckpoint === 'function'
    && typeof readCompleteScope === 'function' && typeof now === 'function'
    && (reattestCheckpoints === null || typeof reattestCheckpoints === 'function'));
  return async function readReconciledFreeTestInput({ clientId, deploymentId } = {}, options = {}) {
    try {
      requireCondition(options && typeof options === 'object' && !Array.isArray(options)
        && Object.keys(options).every((key) => key === 'signal' || key === 'budget')
        && (options.signal === undefined || options.signal instanceof AbortSignal)
        && (options.budget === undefined || (isReportAttemptBudget(options.budget)
          && (options.signal === undefined || options.signal === options.budget.signal))));
      const budget = options.budget;
      const signal = budget?.signal || options.signal;
      const assertActive = () => { budget?.assertActive(); requireCondition(!signal?.aborted); };
      // Canonical helpers perform several sequential reads. Guard each of their
      // three read primitives so a pending read cannot resume into fresh SDK
      // requests after the worker deadline. Retain the real store as receiver.
      async function canonicalRead(method, args) {
        assertActive();
        budget?.consume('source_read');
        const result = await runtimeStore[method](...args);
        assertActive();
        return result;
      }
      const canonicalStore = Object.freeze({
        unique: (...args) => canonicalRead('unique', args),
        query: (...args) => canonicalRead('query', args),
        queryBounded: (...args) => canonicalRead('queryBounded', args),
        uniqueOutboxProviderIdentity: (...args) => canonicalRead('uniqueOutboxProviderIdentity', args),
      });
      const readOptions = Object.freeze({ signal, ...(budget ? { budget } : {}) });
      assertActive();
      requireCondition([clientId, deploymentId].every((value) => typeof value === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value)));
      const at = now();
      requireCondition(Number.isSafeInteger(at));
      const terminal = structuredClone(await canonicalStore.unique(runtimeConfig.tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', deploymentId));
      assertActive();
      requireCondition(terminal?.CLIENT_ID === clientId && terminalReconciled(terminal));
      const details = await queryClientCallDetails(canonicalStore, runtimeConfig, clientId, deploymentId, at);
      assertActive();
      const scope = Object.freeze({ CLIENT_KEY: details.clientKey, DEPLOYMENT_KEY: details.deploymentKey,
        CONFIGURATION_VERSION: details.configurationVersionId, ENGAGEMENT_TYPE: 'free_test',
        ENVIRONMENT: 'development', SOURCE_REVISION: runtimeConfig.sourceRevision });
      const before = sourceSnapshot(await analyticsStore.listReportRows(scope, readOptions), scope);
      assertActive();
      if (!before.settled) return null;
      const facts = Object.fromEntries(TYPES.map((type) => [type,
        before.rows.filter((row) => row.RECORD_TYPE === type).map((row) => row.fact)]));
      if (!facts.deployment.length || !facts.final_test_result.length) return null;
      requireCondition(facts.deployment.length === 1 && facts.final_test_result.length === 1);
      async function assertCanonicalFacts(row, atMs) {
        assertActive();
        // Stopped rows intentionally keep NotRequired. Their manual closeout
        // must independently prove the signed rollback, complete settlement and
        // exact CRM/final-outbox readback on every fresh source pass.
        const deployment = row.TEST_STATUS === 'Stopped'
          ? await createRuntimeService({ store: canonicalStore, config: runtimeConfig, mailAdapter: {}, now })
            .assertStoppedReportReady(deploymentId)
          : await loadDeployment(canonicalStore, row, runtimeConfig);
        assertActive();
        const report = await queryClientReport(canonicalStore, runtimeConfig, clientId, deploymentId, atMs);
        assertActive();
        requireCondition(deployment.configurationVersionId === scope.CONFIGURATION_VERSION
          && deployment.engagementType === scope.ENGAGEMENT_TYPE && deployment.environment === scope.ENVIRONMENT
          && row.SOURCE_REVISION === scope.SOURCE_REVISION
          && canonicalTime(row.UPDATED_AT)
          && facts.deployment[0].SOURCE_MODIFIED_AT <= row.UPDATED_AT);
        // UPDATED_AT also advances for the existing reconciliation scan cursor.
        // Preserve the attested deployment-fact watermark, but compare every
        // actual deployment/configuration field against today's canonical row.
        const canonicalDeployment = deploymentFact(runtimeConfig, deployment,
          { ...row, UPDATED_AT: facts.deployment[0].SOURCE_MODIFIED_AT });
        const canonicalFinal = finalTestResultFact(runtimeConfig, deployment, row, report);
        requireCondition(canonicalJson(minimizeFact('deployment', canonicalDeployment)) === canonicalJson(facts.deployment[0])
          && canonicalJson(minimizeFact('final_test_result', canonicalFinal)) === canonicalJson(facts.final_test_result[0]));
      }
      await assertCanonicalFacts(terminal, at);
      const checkpoints = {};
      const checkpointRows = {};
      const readbacks = {};
      const observations = {};
      for (const type of TYPES) {
        assertActive();
        const checkpoint = structuredClone(await analyticsStore.getReportCheckpoint(scope, type, readOptions));
        assertActive();
        if (checkpoint === null && facts[type].length) return null;
        checkpoints[type] = checkpointProjection(checkpoint, scope, type);
        checkpointRows[type] = checkpoint;
        // Propagate the worker deadline to provider reads, not just the eventual
        // document write. Cancellation must stop later partition requests too.
        const readback = structuredClone(await readCompleteScope(scope, type, readOptions));
        assertActive();
        if (readback === null) return null;
        requireCondition(exactKeys(readback, ['scope', 'recordType', 'rows', 'complete', 'bindingVerified', 'observedAt'])
          && exactKeys(readback.scope, SCOPE_KEYS) && SCOPE_KEYS.every((key) => readback.scope[key] === scope[key])
          && readback.recordType === type && readback.complete === true && readback.bindingVerified === true
          && canonicalTime(readback.observedAt) && Date.parse(readback.observedAt) >= at
          && Date.parse(readback.observedAt) <= now()
          && Array.isArray(readback.rows) && readback.rows.length <= MAX_SOURCE_ROWS);
        const rows = structuredClone(readback.rows);
        observations[type] = readback.observedAt;
        requireCondition(rows.every((row) => exactKeys(row, READBACK_KEYS)
          && ['CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENVIRONMENT'].every((key) => row[key] === scope[key])
          && /^[a-f0-9]{64}$/.test(row.RECORD_KEY) && /^[a-f0-9]{64}$/.test(row.PAYLOAD_HASH)
          && canonicalTime(row.SOURCE_MODIFIED_AT)));
        readbacks[type] = { row_count: rows.length,
          duplicate_record_key_count: rows.length - new Set(rows.map((row) => row.RECORD_KEY)).size,
          payload_hash_mismatch_count: 0, source_revision: scope.SOURCE_REVISION,
          rowset_digest: readbackRowsetDigest(type, rows),
          ...(rows.length ? { latest_source_modified_at: rows.map((row) => row.SOURCE_MODIFIED_AT).sort().at(-1) }
            : { empty_source_verified: facts[type].length === 0 }) };
      }
      // Provider reads may span several awaits. Reject a moving source cohort,
      // including canonical text edits that leave aggregate counts unchanged.
      const after = sourceSnapshot(await analyticsStore.listReportRows(scope, readOptions), scope);
      assertActive();
      requireCondition(after.settled && before.fingerprint === after.fingerprint);
      for (const type of TYPES) {
        assertActive();
        const observed = await analyticsStore.getReportCheckpoint(scope, type, readOptions);
        requireCondition(checkpointRows[type] === null ? observed === null
          : observed && checkpointState(observed) === checkpointState(checkpointRows[type]));
        assertActive();
      }
      let finishedAt = now();
      requireCondition(Number.isSafeInteger(finishedAt) && finishedAt >= at && finishedAt - at <= 300_000);
      let freshDetails = await queryClientCallDetails(canonicalStore, runtimeConfig, clientId, deploymentId, finishedAt);
      assertActive();
      requireCondition(JSON.stringify({ ...details, capturedAt: null })
        === JSON.stringify({ ...freshDetails, capturedAt: null }));
      const terminalAfter = structuredClone(await canonicalStore.unique(runtimeConfig.tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', deploymentId));
      assertActive();
      requireCondition(terminalReconciled(terminalAfter)
        && terminalAfter.REPORT_RECONCILIATION_STATUS === terminal.REPORT_RECONCILIATION_STATUS
        && terminalAfter.TEST_STATUS === terminal.TEST_STATUS && terminalAfter.CLIENT_ID === terminal.CLIENT_ID
        && terminalAfter.REPORT_RECONCILIATION_VERSION === terminal.REPORT_RECONCILIATION_VERSION);
      await assertCanonicalFacts(terminalAfter, finishedAt);
      // Validate actual equality before any possible checkpoint write. No date
      // substitution or relaxed rendering gate is used to authorize verification.
      buildPrivateCallLedger(freshDetails, facts.call, facts.deployment[0], finishedAt);
      const recordTypes = Object.fromEntries(TYPES.map((type) => {
        const last = [...facts[type]].sort((left, right) => left.SOURCE_MODIFIED_AT.localeCompare(right.SOURCE_MODIFIED_AT)
          || left.RECORD_KEY.localeCompare(right.RECORD_KEY)).at(-1);
        return [type, { factDigest: factRowsetDigest(type, facts[type]),
          readbackDigest: readbacks[type].rowset_digest, rowCount: facts[type].length,
          lastSourceModifiedAt: last?.SOURCE_MODIFIED_AT ?? null, lastRecordKey: last?.RECORD_KEY ?? null,
          observedAt: observations[type] }];
      }));
      finishedAt = now();
      requireCondition(Number.isSafeInteger(finishedAt) && finishedAt >= at && finishedAt - at <= 300_000);
      const proof = { scope, sourceDigest: sha256(before.fingerprint),
        canonicalDigest: sha256(JSON.stringify({ ...freshDetails, capturedAt: null })),
        recordTypes, checkpoints: structuredClone(checkpointRows), verifiedAt: new Date(finishedAt).toISOString() };
      const verificationDigest = reportVerificationDigest(proof, finishedAt);
      if (TYPES.some((type) => checkpointRows[type] && Date.parse(checkpointRows[type].STALE_AFTER_AT) <= finishedAt)) {
        requireCondition(reattestCheckpoints !== null);
        const result = await reattestCheckpoints(proof, readOptions);
        assertActive();
        requireCondition(exactKeys(result, ['verificationDigest', 'verifiedAt'])
          && result.verificationDigest === verificationDigest && result.verifiedAt === proof.verifiedAt);
        for (const type of TYPES) {
          const observed = structuredClone(await analyticsStore.getReportCheckpoint(scope, type, readOptions));
          assertActive();
          if (checkpointRows[type] === null) requireCondition(observed === null);
          else {
            const patch = checkpointVerificationPatch(scope, type, checkpointRows[type], {
              digest: verificationDigest, verifiedAt: proof.verifiedAt, staleAfterAt: observed?.STALE_AFTER_AT });
            requireCondition(observed && checkpointState(observed) === checkpointState({ ...checkpointRows[type], ...patch }));
          }
          checkpointRows[type] = observed;
          checkpoints[type] = checkpointProjection(observed, scope, type);
        }
        finishedAt = now();
        requireCondition(Number.isSafeInteger(finishedAt) && finishedAt >= at && finishedAt - at <= 300_000);
        const verifiedDetails = await queryClientCallDetails(canonicalStore, runtimeConfig, clientId, deploymentId, finishedAt);
        requireCondition(JSON.stringify({ ...freshDetails, capturedAt: null })
          === JSON.stringify({ ...verifiedDetails, capturedAt: null }));
        freshDetails = verifiedDetails;
        const verifiedTerminal = await canonicalStore.unique(runtimeConfig.tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', deploymentId);
        requireCondition(verifiedTerminal?.TEST_STATUS === terminal.TEST_STATUS
          && terminalReconciled(verifiedTerminal)
          && verifiedTerminal.REPORT_RECONCILIATION_STATUS === terminal.REPORT_RECONCILIATION_STATUS
          && verifiedTerminal.CLIENT_ID === terminal.CLIENT_ID
          && verifiedTerminal.REPORT_RECONCILIATION_VERSION === terminal.REPORT_RECONCILIATION_VERSION);
        await assertCanonicalFacts(verifiedTerminal, finishedAt);
        const verifiedSource = sourceSnapshot(await analyticsStore.listReportRows(scope, readOptions), scope);
        assertActive();
        requireCondition(verifiedSource.settled && verifiedSource.fingerprint === before.fingerprint);
        for (const type of TYPES) {
          const observed = await analyticsStore.getReportCheckpoint(scope, type, readOptions);
          assertActive();
          requireCondition(checkpointRows[type] === null ? observed === null
            : observed && checkpointState(observed) === checkpointState(checkpointRows[type]));
        }
      }
      const evaluatedAt = new Date(finishedAt).toISOString();
      if (!facts.call.length) readbacks.call.verified_at = evaluatedAt;
      const evidenceScope = { ENVIRONMENT: scope.ENVIRONMENT, ENGAGEMENT_TYPE: scope.ENGAGEMENT_TYPE,
        CLIENT_KEY: scope.CLIENT_KEY, DEPLOYMENT_KEY: scope.DEPLOYMENT_KEY, unresolved_v2_outbox_rows: 0,
        source_call_count: facts.call.length, checkpoints,
        analytics_readback: { binding_verified: true, partition_isolation_verified: true, record_types: readbacks } };
      const digest = scopeInventoryDigest([evidenceScope]);
      const input = { deployment: facts.deployment[0], calls: facts.call, finalResult: facts.final_test_result[0],
        evidence: { schema_version: 1, evaluated_at: evaluatedAt, approved_source_revision: scope.SOURCE_REVISION,
          scope_inventory: { expected_scope_count: 1, catalyst_scope_digest: digest, analytics_scope_digest: digest },
          scopes: [evidenceScope] },
        approval: { schema_version: 1, approved_source_revision: scope.SOURCE_REVISION,
          approved_scope_inventory_digest: digest } };
      buildFreeTestReport(input, finishedAt, freshDetails);
      return { input, callDetails: freshDetails };
    } catch { fail(); }
  };
}

module.exports = { createReconciledFreeTestInputReader };
