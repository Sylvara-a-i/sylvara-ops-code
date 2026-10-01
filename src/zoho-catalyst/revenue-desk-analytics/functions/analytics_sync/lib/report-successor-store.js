'use strict';

const crypto = require('node:crypto');
const { canonicalJson } = require('./facts');
const { reportRunProjection: projection, MAX_STATE_BYTES } = require('./report-run-store');
const { createReportRunTransport } = require('./report-run-transport');
const KEY = /^[a-f0-9]{64}$/, ROW = /^[1-9][0-9]{0,29}$/;
const REVISION = 'unique_insert_successor_v1', MAX_VERSION = 2147483647;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const rootKey = key => `revenue-desk-report-v1:${key}`;
const prefix = key => `revenue-desk-report-v2:${key}:`;
const slotKey = (key, version) => version === 1 ? rootKey(key) : prefix(key) + String(version).padStart(10, '0');
function fail() { throw Object.assign(new Error('REPORT_RUN_RECONCILIATION_REQUIRED'),
  { code: 'REPORT_RUN_RECONCILIATION_REQUIRED', ambiguous: true }); }
function freeze(value) { if (value && typeof value === 'object') {
  Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const digest = row => sha(`${row.ROWID}\0${row.ReportPayloadJson}`);
function validateProjection(row, state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)
    || !Object.entries(projection(state)).every(([column, value]) =>
      typeof value === 'boolean' ? String(row[column]).toLowerCase() === String(value)
        : typeof value === 'number' ? Number(row[column]) === value : row[column] === value)) fail();
}
function decode(key, row, expectedVersion) {
  if (!row || !ROW.test(String(row.ROWID)) || typeof row.ReportPayloadJson !== 'string'
    || Buffer.byteLength(row.ReportPayloadJson) > MAX_STATE_BYTES) fail();
  let envelope; try { envelope = JSON.parse(row.ReportPayloadJson); } catch { fail(); }
  if (canonicalJson(envelope) !== row.ReportPayloadJson) fail();
  const version = Number(row.RD_REPORT_VERSION);
  if (!/^[1-9][0-9]*$/.test(String(row.RD_REPORT_VERSION))
    || !Number.isSafeInteger(version) || version > MAX_VERSION) fail();
  if (envelope.storageRevision !== REVISION) {
    if (expectedVersion !== 1 || row.IdempotencyKey !== rootKey(key) || row.ReportRunId !== rootKey(key)) fail();
    validateProjection(row, envelope);
    return { key, rowId: String(row.ROWID), version, state: envelope,
      storageRevision: 'legacy_read_only_v1', digest: digest(row) };
  }
  if (Object.keys(envelope).sort().join(',') !== 'key,owner,predecessor,rootDigest,state,storageRevision,version'
    || envelope.key !== key || envelope.version !== version
    || (expectedVersion !== undefined && version !== expectedVersion)
    || row.IdempotencyKey !== slotKey(key, version) || row.ReportRunId !== row.IdempotencyKey
    || !/^[a-f0-9]{32}$/.test(envelope.owner)
    || (version === 1 ? envelope.predecessor !== null || envelope.rootDigest !== null
      : !KEY.test(envelope.rootDigest || '') || !envelope.predecessor
        || Object.keys(envelope.predecessor).sort().join(',') !== 'digest,rowId,version'
        || !ROW.test(envelope.predecessor.rowId) || !KEY.test(envelope.predecessor.digest)
        || envelope.predecessor.version !== version - 1)) fail();
  validateProjection(row, envelope.state);
  return { key, rowId: String(row.ROWID), version, state: envelope.state,
    storageRevision: REVISION, digest: digest(row), envelope };
}

/** No UPDATE, mutable head pointer or lease bypass. The universal old root key
 * contends with legacy writers; retained old roots are explicitly read-only.
 * Latest-two verifies the current edge and root commitment, not every ancestor.
 * Trusted writers only append a successor obtained from an issued current row.
 * Administrative history tampering requires separate audit/reconciliation. */
function createReportSuccessorStore({ app, environment, table = 'ReportRuns', timeoutMs = 3000,
  transport = null } = {}) {
  if (environment !== 'development' || table !== 'ReportRuns' || !app
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail();
  const io = transport || createReportRunTransport({ app, timeoutMs });
  if (typeof io.query !== 'function' || typeof io.insert !== 'function') fail();
  const issued = new WeakMap();
  function active(options, kind) {
    if (options?.signal?.aborted) fail();
    options?.budget?.consume(kind);
  }
  async function query(sql, options) {
    active(options, 'report_run_read'); const rows = await io.query(sql, options);
    if (options?.signal?.aborted || !Array.isArray(rows) || rows.length > 2) fail();
    return rows.map(row => row.ReportRuns || row);
  }
  async function physical(key, version, options) {
    const rows = await query(`SELECT * FROM ReportRuns WHERE IdempotencyKey = '${slotKey(key, version)}' LIMIT 2`, options);
    if (rows.length > 1) fail();
    return rows.length ? decode(key, rows[0], version) : null;
  }
  function expose(row, rootDigest) {
    const result = freeze({ key: row.key, rowId: row.rowId, version: row.version,
      state: row.state, storageRevision: row.storageRevision });
    issued.set(result, { ...row, rootDigest }); return result;
  }
  async function get(key, options = {}) {
    if (!KEY.test(key)) fail();
    const root = await physical(key, 1, options);
    if (!root) return null;
    const rows = await query(`SELECT * FROM ReportRuns WHERE IdempotencyKey LIKE '${prefix(key)}%' ORDER BY RD_REPORT_VERSION DESC LIMIT 2`, options);
    if (root.storageRevision !== REVISION) {
      if (rows.length) fail(); return expose(root, root.digest);
    }
    if (!rows.length) return expose(root, root.digest);
    const ordered = rows.map(row => decode(key, row)).sort((a,b) => b.version - a.version);
    const head = ordered[0], previous = head.version === 2 ? root : ordered[1];
    if (head.version < 2 || !previous || previous.version !== head.version - 1
      || head.envelope.rootDigest !== root.digest
      || head.envelope.predecessor.rowId !== previous.rowId
      || head.envelope.predecessor.digest !== previous.digest
      || (previous.version > 1 && previous.envelope.rootDigest !== root.digest)
      || (head.version === 2 && ordered.length !== 1)) fail();
    return expose(head, root.digest);
  }
  async function append(key, version, state, predecessor, rootDigest, options) {
    const envelope = { storageRevision: REVISION, key, version, owner: crypto.randomBytes(16).toString('hex'),
      predecessor, rootDigest, state };
    const json = canonicalJson(envelope);
    if (Buffer.byteLength(json) > MAX_STATE_BYTES) fail();
    const row = { ...projection(state), IdempotencyKey: slotKey(key, version),
      ReportRunId: slotKey(key, version), ReportPayloadJson: json, RD_REPORT_VERSION: version };
    active(options, 'report_run_write');
    try { await io.insert(row, options); } catch { /* One dispatch only; exact slot readback decides. */ }
    const actual = await physical(key, version, options);
    if (!actual) fail(); // Unknown insertion cannot authorize any downstream effect.
    return { actual, mine: actual.storageRevision === REVISION
      && canonicalJson(actual.envelope) === json };
  }
  async function insert(key, state, options = {}) {
    if (!KEY.test(key)) fail();
    const { actual, mine } = await append(key, 1, state, null, null, options);
    if (!mine) return null; // Accepted replay belongs to get(), never insertion ownership.
    // Same root slot protects old and new writers. Never mutate an old winner.
    return expose(actual, actual.digest);
  }
  async function compareAndSwap(current, state, options = {}) {
    const prior = issued.get(current);
    if (!prior || prior.storageRevision !== REVISION || prior.version >= MAX_VERSION) fail();
    const predecessor = { rowId: prior.rowId, version: prior.version, digest: prior.digest };
    const { actual, mine } = await append(prior.key, prior.version + 1, state, predecessor, prior.rootDigest, options);
    if (!mine) return null;
    return expose(actual, prior.rootDigest);
  }
  return Object.freeze({ get, insert, compareAndSwap, storageRevision: REVISION });
}
module.exports = { createReportSuccessorStore, REPORT_SUCCESSOR_REVISION: REVISION };
