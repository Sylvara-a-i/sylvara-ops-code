'use strict';

const crypto = require('node:crypto');
const { AnalyticsSyncError, classified, invariant } = require('./errors');
const {
  canonicalJson, checkpointRow, compareWatermark, createOutboxRow, makeBatchKey,
  parseOutboxRow, targetRow,
} = require('./facts');
const { buildDailyMetricFact } = require('./daily-rollup');

function iso(milliseconds) {
  invariant(Number.isSafeInteger(milliseconds) && milliseconds >= 0,
    'TIME_INVALID', 'Analytics sync clock is invalid.');
  return new Date(milliseconds).toISOString();
}

function safeErrorCode(error) {
  return typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code : 'ANALYTICS_SYNC_UNKNOWN';
}

function samePartition(left, right) {
  return left.RECORD_TYPE === right.RECORD_TYPE
    && left.CLIENT_KEY === right.CLIENT_KEY
    && left.DEPLOYMENT_KEY === right.DEPLOYMENT_KEY
    && left.CONFIGURATION_VERSION === right.CONFIGURATION_VERSION
    && left.ENGAGEMENT_TYPE === right.ENGAGEMENT_TYPE
    && left.ENVIRONMENT === right.ENVIRONMENT
    && left.METRIC_VERSION === right.METRIC_VERSION
    && left.SOURCE_DATE_UTC === right.SOURCE_DATE_UTC;
}

function providerMatchIdentity(row) {
  return canonicalJson({
    CLIENT_KEY: row.CLIENT_KEY,
    DEPLOYMENT_KEY: row.DEPLOYMENT_KEY,
    ENVIRONMENT: row.ENVIRONMENT,
    RECORD_KEY: row.RECORD_KEY,
  });
}

function contiguousUniqueCandidates(rows, maximum) {
  const selected = [];
  const identities = new Set();
  for (const row of rows) {
    const identity = providerMatchIdentity(row);
    // Corrections deliberately share the provider upsert identity. Stop before
    // the first repeat so provider readback remains one-to-one with this batch.
    if (identities.has(identity)) break;
    identities.add(identity);
    selected.push(row);
    if (selected.length === maximum) break;
  }
  return selected;
}

function contiguousEligibleCandidates(rows, first, maximum) {
  const prefix = [];
  for (const row of rows) {
    const eligible = samePartition(row, first)
      && (row.SYNC_STATUS === 'Pending' || row.SYNC_STATUS === 'RetryRequired')
      && !row.PROVIDER_JOB_ID && !row.READBACK_JOB_ID;
    // Watermark ordering is global within the checkpoint partition. Skipping a
    // different grain here would let later rows repeatedly wait behind it.
    if (!eligible) break;
    prefix.push(row);
    if (prefix.length === maximum) break;
  }
  return contiguousUniqueCandidates(prefix, maximum);
}

function readbackIdentity(row) {
  return canonicalJson({
    CLIENT_KEY: row.CLIENT_KEY,
    DEPLOYMENT_KEY: row.DEPLOYMENT_KEY,
    ENVIRONMENT: row.ENVIRONMENT,
    PAYLOAD_HASH: row.PAYLOAD_HASH,
    RECORD_KEY: row.RECORD_KEY,
    SOURCE_MODIFIED_AT: row.SOURCE_MODIFIED_AT,
  });
}

function createAnalyticsSyncService(options) {
  const {
    store,
    adapter,
    config,
    now = Date.now,
    randomBytes = crypto.randomBytes,
    logger = { info() {}, warn() {}, error() {} },
  } = options;
  invariant(store && adapter && config?.environment === 'development' && config.mode === 'active',
    'SERVICE_CONFIGURATION_INVALID', 'Active Analytics service dependencies are invalid.');

  function result(state, counts = {}) {
    return Object.freeze({
      state,
      examined: counts.examined || 0,
      claimed: counts.claimed || 0,
      submitted: counts.submitted || 0,
      pending: counts.pending || 0,
      reconciled: counts.reconciled || 0,
      retryRequired: counts.retryRequired || 0,
      failed: counts.failed || 0,
      contention: counts.contention || 0,
      dailyMetricsEnsured: counts.dailyMetricsEnsured || 0,
    });
  }

  async function transitionAll(rows, patchFor, release = true) {
    const updated = [];
    for (const row of rows) {
      const next = await store.patchClaim(row, patchFor(row), release);
      invariant(next, 'OUTBOX_CONCURRENCY_CONFLICT',
        'Analytics outbox transition lost its fencing claim.', { retryable: true });
      updated.push(parseOutboxRow(next, config.environment));
    }
    return updated;
  }

  function retryDelay(attemptCount) {
    return config.retryDelaysMs[Math.min(Math.max(0, attemptCount - 1),
      config.retryDelaysMs.length - 1)];
  }

  async function quarantine(rows, code, nowMs, state = 'ReconciliationRequired') {
    const nowIso = iso(nowMs);
    return transitionAll(rows, () => ({
      SYNC_STATUS: state,
      PROVIDER_STATE: state,
      LAST_ERROR_CODE: code,
      NEXT_ATTEMPT_AT: nowIso,
      UPDATED_AT: nowIso,
    }));
  }

  async function submitFailure(rows, rawError, nowMs) {
    const error = classified(rawError);
    const code = safeErrorCode(error);
    const nowIso = iso(nowMs);
    if (error.ambiguous) {
      await quarantine(rows, code, nowMs);
      return result('ReconciliationRequired', { claimed: rows.length, failed: rows.length });
    }
    const attemptCount = Math.max(...rows.map((row) => row.ATTEMPT_COUNT));
    if (error.retryable && attemptCount < config.maxAttempts) {
      const nextAttemptAt = iso(nowMs + retryDelay(attemptCount));
      await transitionAll(rows, () => ({
        SYNC_STATUS: 'RetryRequired',
        BATCH_KEY: null,
        PROVIDER_JOB_ID: null,
        PROVIDER_STATE: null,
        READBACK_JOB_ID: null,
        POLL_COUNT: 0,
        LAST_ERROR_CODE: code,
        NEXT_ATTEMPT_AT: nextAttemptAt,
        UPDATED_AT: nowIso,
      }));
      return result('RetryRequired', { claimed: rows.length, retryRequired: rows.length });
    }
    await quarantine(rows, code, nowMs, 'TerminalFailure');
    return result('TerminalFailure', { claimed: rows.length, failed: rows.length });
  }

  async function deferPoll(rows, rawError, nowMs) {
    const error = classified(rawError);
    if (error.ambiguous || !error.retryable) {
      await quarantine(rows, safeErrorCode(error), nowMs);
      return result('ReconciliationRequired', { claimed: rows.length, failed: rows.length });
    }
    const nowIso = iso(nowMs);
    const nextPoll = Math.max(...rows.map((row) => row.POLL_COUNT)) + 1;
    if (nextPoll >= config.maxPollCount) {
      await quarantine(rows, 'ANALYTICS_POLL_EXHAUSTED', nowMs);
      return result('ReconciliationRequired', { claimed: rows.length, failed: rows.length });
    }
    await transitionAll(rows, () => ({
      SYNC_STATUS: 'Submitted',
      POLL_COUNT: nextPoll,
      LAST_ERROR_CODE: safeErrorCode(error),
      NEXT_ATTEMPT_AT: iso(nowMs + config.pollDelayMs),
      UPDATED_AT: nowIso,
    }));
    return result('Submitted', { claimed: rows.length, pending: rows.length });
  }

  async function submit(rows, nowMs) {
    const nowIso = iso(nowMs);
    const invoking = await transitionAll(rows, (row) => ({
      ATTEMPT_COUNT: row.ATTEMPT_COUNT + 1,
      LAST_ATTEMPT_AT: nowIso,
      PROVIDER_STATE: 'Submitting',
      LAST_ERROR_CODE: null,
      UPDATED_AT: nowIso,
    }), false);
    try {
      const response = await adapter.submitBatch(invoking[0].RECORD_TYPE,
        invoking.map(targetRow));
      invariant(response && /^\d{3,30}$/.test(String(response.jobId)),
        'ANALYTICS_RESPONSE_INVALID', 'Analytics import submission lacks a Job ID.',
        { ambiguous: true });
      await transitionAll(invoking, () => ({
        SYNC_STATUS: 'Submitted',
        PROVIDER_JOB_ID: String(response.jobId),
        PROVIDER_STATE: 'Submitted',
        EXPECTED_ROW_COUNT: invoking.length,
        POLL_COUNT: 0,
        SUBMITTED_AT: nowIso,
        NEXT_ATTEMPT_AT: iso(nowMs + config.pollDelayMs),
        UPDATED_AT: nowIso,
      }));
      return result('Submitted', { claimed: invoking.length, submitted: invoking.length });
    } catch (error) {
      return submitFailure(invoking, error, nowMs);
    }
  }

  async function beginReadback(rows, summary, nowMs) {
    const nowIso = iso(nowMs);
    const prepared = await transitionAll(rows, () => ({
      PROVIDER_STATE: 'ReadbackStarting',
      ACCEPTED_ROW_COUNT: summary.acceptedRows,
      REJECTED_ROW_COUNT: summary.rejectedRows,
      POLL_COUNT: 0,
      UPDATED_AT: nowIso,
    }), false);
    try {
      const response = await adapter.startReadback(prepared[0].RECORD_TYPE,
        prepared.map(targetRow));
      invariant(response && /^\d{3,30}$/.test(String(response.jobId)),
        'ANALYTICS_RESPONSE_INVALID', 'Analytics readback submission lacks a Job ID.',
        { retryable: true });
      await transitionAll(prepared, () => ({
        SYNC_STATUS: 'Submitted',
        PROVIDER_STATE: 'ReadbackSubmitted',
        READBACK_JOB_ID: String(response.jobId),
        POLL_COUNT: 0,
        NEXT_ATTEMPT_AT: iso(nowMs + config.pollDelayMs),
        UPDATED_AT: nowIso,
      }));
      return result('ReadbackSubmitted', { claimed: prepared.length, pending: prepared.length });
    } catch (error) {
      return deferPoll(prepared, error, nowMs);
    }
  }

  async function pollImport(rows, nowMs) {
    const jobIds = new Set(rows.map((row) => row.PROVIDER_JOB_ID));
    invariant(jobIds.size === 1 && !jobIds.has(null), 'OUTBOX_BATCH_INVALID',
      'Analytics batch has conflicting import Job IDs.');
    if (Math.max(...rows.map((row) => row.POLL_COUNT)) >= config.maxPollCount) {
      await quarantine(rows, 'ANALYTICS_IMPORT_POLL_EXHAUSTED', nowMs);
      return result('ReconciliationRequired', { claimed: rows.length, failed: rows.length });
    }
    let status;
    try {
      status = await adapter.pollImport([...jobIds][0]);
    } catch (error) {
      return deferPoll(rows, error, nowMs);
    }
    if (status.state === 'missing') {
      await quarantine(rows, 'ANALYTICS_IMPORT_JOB_MISSING', nowMs);
      return result('ReconciliationRequired', { claimed: rows.length, failed: rows.length });
    }
    if (status.state === 'failed') {
      await quarantine(rows, 'ANALYTICS_IMPORT_FAILED', nowMs, 'TerminalFailure');
      return result('TerminalFailure', { claimed: rows.length, failed: rows.length });
    }
    if (status.state === 'pending') {
      const nowIso = iso(nowMs);
      await transitionAll(rows, (row) => ({
        SYNC_STATUS: 'Submitted',
        PROVIDER_STATE: 'ImportPending',
        POLL_COUNT: row.POLL_COUNT + 1,
        NEXT_ATTEMPT_AT: iso(nowMs + config.pollDelayMs),
        UPDATED_AT: nowIso,
      }));
      return result('Submitted', { claimed: rows.length, pending: rows.length });
    }
    invariant(status.state === 'complete', 'ANALYTICS_RESPONSE_INVALID',
      'Analytics import status is unknown.', { ambiguous: true });
    if (status.totalRows !== rows.length || status.acceptedRows !== rows.length
      || status.rejectedRows !== 0) {
      await quarantine(rows, 'ANALYTICS_IMPORT_COUNT_MISMATCH', nowMs);
      return result('ReconciliationRequired', { claimed: rows.length, failed: rows.length });
    }
    return beginReadback(rows, status, nowMs);
  }

  async function pollReadback(rows, nowMs) {
    const jobIds = new Set(rows.map((row) => row.READBACK_JOB_ID));
    invariant(jobIds.size === 1 && !jobIds.has(null), 'OUTBOX_BATCH_INVALID',
      'Analytics batch has conflicting readback Job IDs.');
    if (Math.max(...rows.map((row) => row.POLL_COUNT)) >= config.maxPollCount) {
      await quarantine(rows, 'ANALYTICS_READBACK_POLL_EXHAUSTED', nowMs);
      return result('ReconciliationRequired', { claimed: rows.length, failed: rows.length });
    }
    let status;
    try {
      status = await adapter.pollReadback([...jobIds][0]);
    } catch (error) {
      return deferPoll(rows, error, nowMs);
    }
    if (status.state === 'pending') {
      const nowIso = iso(nowMs);
      await transitionAll(rows, (row) => ({
        SYNC_STATUS: 'Submitted',
        PROVIDER_STATE: 'ReadbackPending',
        POLL_COUNT: row.POLL_COUNT + 1,
        NEXT_ATTEMPT_AT: iso(nowMs + config.pollDelayMs),
        UPDATED_AT: nowIso,
      }));
      return result('Submitted', { claimed: rows.length, pending: rows.length });
    }
    if (status.state === 'missing' || status.state === 'failed') {
      await quarantine(rows, status.state === 'missing'
        ? 'ANALYTICS_READBACK_JOB_MISSING' : 'ANALYTICS_READBACK_FAILED', nowMs);
      return result('ReconciliationRequired', { claimed: rows.length, failed: rows.length });
    }
    invariant(status.state === 'complete' && Array.isArray(status.rows),
      'ANALYTICS_RESPONSE_INVALID', 'Analytics readback status is unknown.', { ambiguous: true });
    const expected = rows.map(targetRow).map(readbackIdentity).sort();
    const actual = status.rows.map(readbackIdentity).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      await quarantine(rows, 'ANALYTICS_READBACK_MISMATCH', nowMs);
      return result('ReconciliationRequired', { claimed: rows.length, failed: rows.length });
    }
    const ordered = [...rows].sort(compareWatermark);
    const last = ordered.at(-1);
    if (await store.hasOlderUnresolved(last, last.BATCH_KEY)) {
      await quarantine(rows, 'ANALYTICS_CHECKPOINT_GAP', nowMs);
      return result('ReconciliationRequired', { claimed: rows.length, failed: rows.length });
    }
    const watermark = last.SOURCE_MODIFIED_AT;
    const nowIso = iso(nowMs);
    await transitionAll(rows, () => ({
      SYNC_STATUS: 'CheckpointPending',
      PROVIDER_STATE: 'Reconciled',
      READBACK_ROW_COUNT: actual.length,
      READBACK_WATERMARK: watermark,
      RECONCILED_AT: nowIso,
      LAST_ERROR_CODE: null,
      NEXT_ATTEMPT_AT: nowIso,
      UPDATED_AT: nowIso,
    }));
    return result('CheckpointPending', { claimed: rows.length, reconciled: rows.length });
  }

  async function commitCheckpoint(rows, nowMs) {
    const ordered = [...rows].sort(compareWatermark);
    const last = ordered.at(-1);
    if (await store.hasOlderUnresolved(last, last.BATCH_KEY)) {
      await quarantine(rows, 'ANALYTICS_CHECKPOINT_GAP', nowMs);
      return result('ReconciliationRequired', { claimed: rows.length, failed: rows.length });
    }
    const nowIso = iso(nowMs);
    await store.upsertCheckpoint(checkpointRow(last, last.RECORD_TYPE, nowIso,
      iso(nowMs + config.staleAfterMs)));
    let dailyMetricsEnsured = 0;
    if (last.RECORD_TYPE === 'call') {
      const callRows = (await store.listRollupCalls(
        last,
        last.BATCH_KEY,
        config.maxRollupCalls,
      ))
        .map((row) => parseOutboxRow(row, config.environment));
      invariant(callRows.some((row) => row.OUTBOX_KEY === last.OUTBOX_KEY),
        'ROLLUP_SOURCE_MISSING', 'Reconciled call is absent from its daily-rollup source.');
      const metric = buildDailyMetricFact({
        calls: callRows.map((row) => row.fact),
        reportingDateUtc: last.SOURCE_DATE_UTC,
        clientKey: last.CLIENT_KEY,
        deploymentKey: last.DEPLOYMENT_KEY,
        configurationVersion: last.CONFIGURATION_VERSION,
        engagementType: last.ENGAGEMENT_TYPE,
        environment: last.ENVIRONMENT,
        metricVersion: last.METRIC_VERSION,
        sourceRevision: config.sourceRevision,
      });
      const metricRow = createOutboxRow('daily_metric', metric, nowIso);
      const readback = await store.ensureOutbox(metricRow);
      parseOutboxRow(readback, config.environment);
      dailyMetricsEnsured = 1;
    }
    await transitionAll(rows, () => ({
      SYNC_STATUS: 'Succeeded',
      PROVIDER_STATE: 'Succeeded',
      LAST_ERROR_CODE: null,
      NEXT_ATTEMPT_AT: nowIso,
      UPDATED_AT: nowIso,
    }));
    return result('Succeeded', {
      claimed: rows.length, reconciled: rows.length, dailyMetricsEnsured,
    });
  }

  async function run() {
    const nowMs = now();
    const nowIso = iso(nowMs);
    const due = await store.listDue(config.environment, nowIso, config.maxBatchSize);
    if (due.length === 0) return result('Idle');
    const parsedDue = due.map((row) => parseOutboxRow(row, config.environment));
    const first = parsedDue[0];
    let candidates;
    let batchKey = first.BATCH_KEY;
    let outboxOwnershipConflict = false;
    if (batchKey) {
      candidates = (await store.listBatch(config.environment, batchKey))
        .map((row) => parseOutboxRow(row, config.environment));
      if (candidates.some((row) => row.SYNC_STATUS === 'ReconciliationRequired')) {
        return result('ReconciliationRequired', { examined: candidates.length, failed: candidates.length });
      }
    } else {
      candidates = contiguousEligibleCandidates(parsedDue, first, config.maxBatchSize);
      const conflicts = [];
      for (const row of candidates) {
        if (await store.hasOutboxOwnershipConflict(row)) conflicts.push(row);
      }
      if (conflicts.length > 0) {
        candidates = conflicts;
        outboxOwnershipConflict = true;
      }
      batchKey = makeBatchKey(candidates);
    }
    invariant(candidates.length >= 1 && candidates.length <= config.maxBatchSize
      && candidates.every((row) => samePartition(row, candidates[0]))
      && new Set(candidates.map(providerMatchIdentity)).size === candidates.length,
    'OUTBOX_BATCH_INVALID', 'Analytics batch crosses a client or deployment partition.');
    const leaseOwner = randomBytes(16).toString('hex');
    const leaseToken = randomBytes(32).toString('hex');
    const claimState = {
      batchKey,
      leaseOwner,
      leaseToken,
      nowIso,
      leaseExpiresIso: iso(nowMs + config.leaseMs),
    };
    const claimed = [];
    for (const row of candidates) {
      try {
        const next = await store.claim(row, claimState);
        if (next) claimed.push(parseOutboxRow(next, config.environment));
      } catch (error) {
        if (!(error instanceof AnalyticsSyncError) || error.code !== 'OUTBOX_CLAIM_BUSY') throw error;
      }
    }
    if (claimed.length !== candidates.length) {
      logger.warn({ event: 'analytics_sync_contention', state: 'Contention',
        examined: candidates.length, claimed: claimed.length, contention: 1,
        sourceRevision: config.sourceRevision });
      return result('Contention', {
        examined: candidates.length, claimed: claimed.length, contention: 1,
      });
    }
    if (claimed.some((row) => row.PROVIDER_STATE === 'Submitting' && !row.PROVIDER_JOB_ID)) {
      await quarantine(claimed, 'ANALYTICS_SUBMISSION_OUTCOME_UNKNOWN', nowMs);
      return result('ReconciliationRequired', { claimed: claimed.length, failed: claimed.length });
    }
    if (!outboxOwnershipConflict) {
      for (const row of claimed) {
        if (await store.hasOutboxOwnershipConflict(row)) {
          outboxOwnershipConflict = true;
          break;
        }
      }
    }
    if (outboxOwnershipConflict) {
      await quarantine(claimed, 'ANALYTICS_OUTBOX_OWNERSHIP_CONFLICT', nowMs);
      return result('ReconciliationRequired', { claimed: claimed.length, failed: claimed.length });
    }
    let outcome;
    if (claimed.every((row) => row.PROVIDER_STATE === 'Reconciled')) {
      outcome = await commitCheckpoint(claimed, nowMs);
    } else if (claimed.every((row) => row.READBACK_JOB_ID)) {
      outcome = await pollReadback(claimed, nowMs);
    } else if (claimed.every((row) => row.PROVIDER_JOB_ID)) {
      outcome = await pollImport(claimed, nowMs);
    } else if (claimed.every((row) => !row.PROVIDER_JOB_ID && !row.READBACK_JOB_ID)) {
      const last = [...claimed].sort(compareWatermark).at(-1);
      if (await store.hasOlderUnresolved(last, batchKey)) {
        const priorByKey = new Map(candidates.map((row) => [row.OUTBOX_KEY, row]));
        await transitionAll(claimed, (row) => {
          const prior = priorByKey.get(row.OUTBOX_KEY);
          return {
            SYNC_STATUS: prior?.SYNC_STATUS === 'RetryRequired' ? 'RetryRequired' : 'Pending',
            BATCH_KEY: null,
            PROVIDER_STATE: null,
            LAST_ERROR_CODE: 'ANALYTICS_ORDERED_WAIT',
            NEXT_ATTEMPT_AT: iso(nowMs + config.pollDelayMs),
            UPDATED_AT: nowIso,
          };
        });
        outcome = result('OrderedWait', { claimed: claimed.length, pending: claimed.length });
      } else {
        outcome = await submit(claimed, nowMs);
      }
    } else {
      await quarantine(claimed, 'ANALYTICS_BATCH_STATE_CONFLICT', nowMs);
      outcome = result('ReconciliationRequired', { claimed: claimed.length, failed: claimed.length });
    }
    logger.info({ event: 'analytics_sync_run', state: outcome.state,
      examined: candidates.length, claimed: claimed.length,
      submitted: outcome.submitted, pending: outcome.pending, reconciled: outcome.reconciled,
      retryRequired: outcome.retryRequired, failed: outcome.failed,
      sourceRevision: config.sourceRevision });
    return outcome;
  }

  return Object.freeze({ run });
}

module.exports = {
  contiguousEligibleCandidates,
  contiguousUniqueCandidates,
  createAnalyticsSyncService,
  providerMatchIdentity,
  readbackIdentity,
  samePartition,
};
