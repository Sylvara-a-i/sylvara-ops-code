'use strict';

const { createHash } = require('node:crypto');
const { isPlainObject, MAX_RETELL_CALL_DURATION_MS } = require('./validation');
const { ENGAGEMENT_TYPES } = require('./contracts');

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CALL_KEY = /^call_[a-f0-9]{64}$/;
const SCOPE_COLUMNS = Object.freeze({
  environment: 'SOURCE_ENVIRONMENT', clientId: 'CLIENT_ID', deploymentId: 'DEPLOYMENT_ID',
  configurationVersionId: 'CONFIGURATION_VERSION_ID', configurationVersion: 'CONFIGURATION_VERSION',
});
const BINDINGS = Object.freeze({
  callKey: 'CALL_KEY', clientId: 'CLIENT_ID', deploymentId: 'DEPLOYMENT_ID',
  configurationVersionId: 'CONFIGURATION_VERSION_ID', configurationVersion: 'CONFIGURATION_VERSION',
  engagementType: 'ENGAGEMENT_TYPE', capabilityProfile: 'CAPABILITY_PROFILE',
  correlationId: 'CORRELATION_ID', bindingId: 'BINDING_ID',
});
const noncharging = () => ({ billableMinutes: null, chargeMinor: null, billingAuthority: false });
const unique = (values) => [...new Set(values)].sort();
const iso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;

function scopeIsValid(scope) {
  return isPlainObject(scope) && ['development', 'production'].includes(scope.environment)
    && Object.keys(SCOPE_COLUMNS).every((key) => typeof scope[key] === 'string' && ID.test(scope[key]));
}

function projectRow(row) {
  const holds = [];
  let canonical;
  try { canonical = JSON.parse(row.CANONICAL_CALL_JSON); } catch { /* held below */ }
  if (!isPlainObject(canonical)) return { holds: ['canonical_invalid'], facts: null };
  if (!Object.entries(BINDINGS).every(([field, column]) => canonical[field] === row[column]
      && typeof canonical[field] === 'string' && ID.test(canonical[field]))
    || !Number.isSafeInteger(canonical.bindingVersion)
    || canonical.bindingVersion < 1 || canonical.bindingVersion !== Number(row.BINDING_VERSION)
    || canonical.startedAt !== row.STARTED_AT || canonical.endedAt !== row.ENDED_AT) {
    holds.push('canonical_binding_conflict');
  }
  const schemaVersion = [1, 2].includes(canonical.schemaVersion) ? canonical.schemaVersion : null;
  if (schemaVersion === null) holds.push('schema_unsupported');
  const durationValid = schemaVersion === 2 && Number.isSafeInteger(canonical.durationMs)
    && canonical.durationMs >= 0 && canonical.durationMs <= MAX_RETELL_CALL_DURATION_MS;
  if (!durationValid) holds.push(schemaVersion === 1 ? 'historical_duration_unsupported' : 'duration_invalid');
  const startedAt = iso(canonical.startedAt) ? canonical.startedAt : null;
  const endedAt = iso(canonical.endedAt) ? canonical.endedAt : null;
  if (!startedAt || (canonical.endedAt !== null && !endedAt)
    || (endedAt && startedAt && endedAt < startedAt)) holds.push('timestamps_invalid');
  if (canonical.endedAt === null) holds.push('end_time_missing');
  const callStatus = ['ended', 'error', 'not_connected'].includes(canonical.callStatus)
    ? canonical.callStatus : null;
  if (!callStatus) holds.push('terminal_status_missing');
  const disconnectionReason = typeof canonical.disconnectionReason === 'string'
    && /^[a-z][a-z0-9_]{0,63}$/.test(canonical.disconnectionReason)
    ? canonical.disconnectionReason : null;
  if (canonical.disconnectionReason != null && !disconnectionReason) holds.push('disconnection_invalid');
  const engagementType = ENGAGEMENT_TYPES.has(canonical.engagementType) ? canonical.engagementType : null;
  if (!engagementType) holds.push('engagement_invalid');
  const sourceRevision = typeof row.SOURCE_REVISION === 'string' && /^[a-f0-9]{40}$/.test(row.SOURCE_REVISION)
    ? row.SOURCE_REVISION : null;
  if (!sourceRevision) holds.push('source_revision_invalid');
  // These are facts only. In particular, never derive duration from timestamps.
  return { holds, sourceRevision, facts: {
    canonicalSchemaVersion: schemaVersion, startedAt, endedAt,
    durationMs: durationValid ? canonical.durationMs : null,
    callStatus, disconnectionReason, engagementType,
  }, binding: Object.values(BINDINGS).map((column) => row[column])
    .concat(Number(row.BINDING_VERSION), canonical.numberLookupHash, canonical.coverageMode) };
}

/** Pure projection of a complete-or-explicitly-incomplete scoped RevenueDeskCalls read.
 * CALL_KEY already is the runtime HMAC identity. No provider/event ID is accepted here.
 */
function projectRawUsageEvidence({ scope, rows, complete = false } = {}) {
  const holds = [];
  const validScope = scopeIsValid(scope);
  const finish = (calls) => Object.freeze({
    schemaVersion: 1, calls: Object.freeze(calls), holds: Object.freeze(unique(holds)),
    completeness: Object.freeze({ scopedReadComplete: validScope && complete === true && Array.isArray(rows),
      population: 'internal_accepted_calls', providerCompleteness: 'unproven' }),
    ...noncharging(),
  });
  if (!validScope) { holds.push('scope_invalid'); return finish([]); }
  if (!Array.isArray(rows)) { holds.push('snapshot_invalid'); return finish([]); }
  if (complete !== true) holds.push('snapshot_incomplete');
  const groups = new Map();
  const mismatchedKeys = new Set();
  for (const row of rows) {
    if (!isPlainObject(row) || typeof row.CALL_KEY !== 'string' || !CALL_KEY.test(row.CALL_KEY)) {
      holds.push('call_key_invalid'); continue;
    }
    if (!Object.entries(SCOPE_COLUMNS).every(([field, column]) => row[column] === scope[field])) {
      holds.push('scope_conflict'); mismatchedKeys.add(row.CALL_KEY); continue;
    }
    if (!groups.has(row.CALL_KEY)) groups.set(row.CALL_KEY, []);
    groups.get(row.CALL_KEY).push(projectRow(row));
  }
  const calls = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([callKey, candidates]) => {
    const callHolds = candidates.flatMap((candidate) => candidate.holds);
    if (mismatchedKeys.has(callKey)) callHolds.push('immutable_evidence_conflict');
    if (complete !== true) callHolds.push('snapshot_incomplete');
    const facts = {};
    for (const key of ['canonicalSchemaVersion', 'startedAt', 'endedAt', 'durationMs',
      'callStatus', 'disconnectionReason', 'engagementType']) {
      // Runtime permits missing end/disconnection evidence to be enriched later.
      const values = [...new Set(candidates.map((candidate) => candidate.facts?.[key] ?? null))];
      const comparable = ['endedAt', 'disconnectionReason'].includes(key)
        ? values.filter((value) => value !== null) : values;
      if (comparable.length > 1) callHolds.push('immutable_evidence_conflict');
      facts[key] = comparable.length === 1 ? comparable[0] : null;
    }
    // Correlation/route binding is checked, but never copied into the projection.
    if (new Set(candidates.map((candidate) => JSON.stringify(candidate.binding))).size > 1) {
      callHolds.push('immutable_evidence_conflict');
    }
    if (facts.endedAt) {
      const index = callHolds.indexOf('end_time_missing');
      if (index !== -1 && candidates.every((candidate) => candidate.facts)) {
        for (let i = callHolds.length - 1; i >= 0; i -= 1) {
          if (callHolds[i] === 'end_time_missing') callHolds.splice(i, 1);
        }
      }
    }
    // A conflicting/malformed durable identity cannot select a preferred duration.
    if (callHolds.some((hold) => ['immutable_evidence_conflict', 'canonical_binding_conflict',
      'canonical_invalid'].includes(hold))) facts.durationMs = null;
    const evidence = { callKey, ...Object.fromEntries(Object.keys(SCOPE_COLUMNS).map((key) => [key, scope[key]])),
      ...facts };
    return Object.freeze({ schemaVersion: 1, ...evidence,
      sourceRevisions: Object.freeze(unique(candidates.map((candidate) => candidate.sourceRevision).filter(Boolean))),
      // Analysis, event receipts, mutation versions and current source revisions
      // are not usage identities and cannot create another unit of duration.
      evidenceFingerprint: createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
      holds: Object.freeze(unique(callHolds)),
      rawEvidenceComplete: callHolds.length === 0,
      ...noncharging(),
    });
  });
  return finish(calls);
}

module.exports = { projectRawUsageEvidence };
