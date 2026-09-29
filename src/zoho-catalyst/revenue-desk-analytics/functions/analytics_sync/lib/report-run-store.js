'use strict';

const { canonicalJson } = require('./facts');
const { withTimeout } = require('./connection-boundary');

const KEY = /^[a-f0-9]{64}$/;
const ROW = /^[0-9]{1,30}$/;
const MAX_STATE_BYTES = 9500;
const MAX_VERSION = 2147483647;
function fail() { throw Object.assign(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'),
  { code: 'REPORT_RUN_RECONCILIATION_REQUIRED' }); }
function stateJson(state) {
  const json = canonicalJson(state);
  if (!state || typeof state !== 'object' || Array.isArray(state)
    || Buffer.byteLength(json) > MAX_STATE_BYTES) fail();
  return json;
}
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const providerKey = (key) => `revenue-desk-report-v1:${key}`;

function projection(state) {
  const identity = state.identity;
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!identity || !['clientId', 'deploymentId'].every(name => typeof identity[name] === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(identity[name]))
    || !date(identity.periodStart) || !date(identity.periodEnd) || identity.periodEnd < identity.periodStart
    || !['workdrive_draft_v1', 'report_attempt_v1'].includes(state.kind)) fail();
  const draft = state.kind === 'workdrive_draft_v1';
  const verified = draft && state.phase === 'verified';
  return { ClientId: identity.clientId, DeploymentId: identity.deploymentId,
    ReportType: draft ? 'free_test_client_draft' : 'free_test_report_verification_attempt',
    PeriodStart: identity.periodStart, PeriodEnd: identity.periodEnd,
    ReportVersion: draft ? identity.rendererVersion : 'report-attempt-v1',
    GenerationStatus: verified ? 'DraftGenerated' : draft ? 'ReconciliationRequired' : 'VerificationPending',
    ApprovalStatus: 'OwnerReviewRequired', DeliveryStatus: 'NotSent',
    ReconciliationStatus: verified ? 'Verified' : 'Pending',
    ActualEstimatedSeparated: verified, CrossClientIsolationPassed: verified,
    DuplicateSendGuardPassed: false, ReportTotalsReconciled: verified,
    AutoDeliveryEnabledAtRun: false, SchemaVersion: 2,
    ReportFormat: draft ? 'html' : 'none',
    ReportObjectKey: verified ? canonicalJson(state.receipt) : null };
}

/** Opt-in adapter for the observed EXISTING ReportRuns table, retaining its
 * mandatory identity/period/status fields, unique IdempotencyKey and encrypted
 * ReportPayloadJson. Only nullable RD_REPORT_VERSION is an additive CAS proposal.
 * Legacy rows are never selected or rewritten. Schema/readback acceptance is
 * required before trusted binding; scope attempts are explicitly not reports.
 * An ambiguous insert/update is reconciled by exact independent readback only.
 */
function createReportRunStore({ app, environment, table = 'ReportRuns', timeoutMs = 3000 } = {}) {
  if (environment !== 'development' || table !== 'ReportRuns'
    || !app || typeof app.datastore !== 'function' || typeof app.zcql !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail();
  function active(options, kind) {
    if (options?.signal?.aborted) fail();
    options?.budget?.consume(kind);
  }
  function dispatch(options, operation) {
    // withTimeout defers dispatch to a microtask; cancellation in that gap must
    // not start a previously undispatched SDK read or durable write.
    if (options.signal?.aborted) fail();
    options.budget?.assertActive();
    return operation();
  }
  async function get(key, options = {}) {
    if (!KEY.test(key)) fail();
    active(options, 'report_run_read');
    const result = await withTimeout(() => dispatch(options, () => app.zcql().executeZCQLQuery(
      `SELECT * FROM ${table} WHERE IdempotencyKey = ${quote(providerKey(key))} LIMIT 2`)), timeoutMs);
    if (options.signal?.aborted || !Array.isArray(result) || result.length > 1) fail();
    if (!result.length) return null;
    const row = result[0][table] || result[0];
    if (!ROW.test(String(row.ROWID)) || row.IdempotencyKey !== providerKey(key)
      || row.ReportRunId !== providerKey(key)
      || !/^[1-9][0-9]*$/.test(String(row.RD_REPORT_VERSION))
      || Number(row.RD_REPORT_VERSION) > MAX_VERSION
      || typeof row.ReportPayloadJson !== 'string'
      || Buffer.byteLength(row.ReportPayloadJson) > MAX_STATE_BYTES) fail();
    let state;
    try { state = JSON.parse(row.ReportPayloadJson); } catch { fail(); }
    if (stateJson(state) !== row.ReportPayloadJson
      || !Object.entries(projection(state)).every(([column, value]) =>
        typeof value === 'boolean' ? String(row[column]).toLowerCase() === String(value)
          : typeof value === 'number' ? Number(row[column]) === value : row[column] === value)) fail();
    return Object.freeze({ key, rowId: String(row.ROWID), version: Number(row.RD_REPORT_VERSION), state });
  }
  async function insert(key, state, options = {}) {
    if (!KEY.test(key)) fail();
    const json = stateJson(state);
    const projected = projection(state);
    active(options, 'report_run_write');
    try {
      await withTimeout(() => dispatch(options, () => app.datastore().table(table).insertRow({
        ...projected, IdempotencyKey: providerKey(key), ReportRunId: providerKey(key),
        ReportPayloadJson: json, RD_REPORT_VERSION: 1 })), timeoutMs, { ambiguous: true });
    } catch { /* The unique key and independent readback decide ownership. */ }
    return get(key, options);
  }
  async function compareAndSwap(current, state, options = {}) {
    if (!current || !KEY.test(current.key) || !ROW.test(current.rowId)
      || !Number.isSafeInteger(current.version) || current.version < 1
      || current.version >= MAX_VERSION) fail();
    const json = stateJson(state);
    const projected = { ...projection(state), ReportPayloadJson: json, RD_REPORT_VERSION: current.version + 1 };
    const render = value => value === null ? 'NULL' : typeof value === 'boolean' ? String(value).toUpperCase()
      : typeof value === 'number' ? String(value) : quote(value);
    const assignments = Object.entries(projected).map(([column, value]) => `${column} = ${render(value)}`).join(', ');
    active(options, 'report_run_write');
    try {
      await withTimeout(() => dispatch(options, () => app.zcql().executeZCQLQuery(`UPDATE ${table}`
        + ` SET ${assignments}`
        + ` WHERE ROWID = ${current.rowId} AND IdempotencyKey = ${quote(providerKey(current.key))}`
        + ` AND RD_REPORT_VERSION = ${current.version}`)), timeoutMs, { ambiguous: true });
    } catch { /* A provider timeout is not proof that its CAS failed. */ }
    const actual = await get(current.key, options);
    return actual?.rowId === current.rowId && actual.version === current.version + 1
      && stateJson(actual.state) === json ? actual : null;
  }
  return Object.freeze({ get, insert, compareAndSwap });
}

module.exports = { createReportRunStore, MAX_STATE_BYTES };
