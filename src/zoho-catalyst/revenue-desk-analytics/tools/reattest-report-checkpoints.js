'use strict';

const { invariant } = require('../functions/analytics_sync/lib/errors');
const { isReportAttemptBudget } = require('../functions/analytics_sync/lib/report-attempt-budget');
const { canonicalJson, sha256 } = require('../functions/analytics_sync/lib/facts');
const { checkpointState, validateReportCheckpoint } = require('../functions/analytics_sync/lib/report-checkpoint-verification');

const TYPES = Object.freeze(['deployment', 'call', 'final_test_result']);
const SCOPE_KEYS = Object.freeze(['CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION',
  'ENGAGEMENT_TYPE', 'ENVIRONMENT', 'SOURCE_REVISION']);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const time = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

/** Validate the assembler's complete proof without substituting fresh dates.
 * The trusted assembler owns canonical reads; this is not an input/HTTP API for
 * caller-supplied evidence. Only opaque hashes enter durable checkpoint state.
 */
function reportVerificationDigest(proof, now) {
  invariant(exactKeys(proof, ['scope', 'sourceDigest', 'canonicalDigest', 'recordTypes', 'checkpoints', 'verifiedAt'])
    && exactKeys(proof.scope, SCOPE_KEYS) && exactKeys(proof.recordTypes, TYPES)
    && exactKeys(proof.checkpoints, TYPES) && hash(proof.sourceDigest) && hash(proof.canonicalDigest)
    && hash(proof.scope.CLIENT_KEY) && hash(proof.scope.DEPLOYMENT_KEY)
    && typeof proof.scope.CONFIGURATION_VERSION === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(proof.scope.CONFIGURATION_VERSION)
    && proof.scope.ENVIRONMENT === 'development' && proof.scope.ENGAGEMENT_TYPE === 'free_test'
    && typeof proof.scope.SOURCE_REVISION === 'string' && /^[a-f0-9]{40}$/.test(proof.scope.SOURCE_REVISION)
    && Number.isSafeInteger(now) && time(proof.verifiedAt)
    && Date.parse(proof.verifiedAt) <= now && now - Date.parse(proof.verifiedAt) <= 300_000,
  'REPORT_VERIFICATION_INVALID', 'Report verification proof is invalid.');
  const recordTypes = {};
  for (const type of TYPES) {
    const item = proof.recordTypes[type];
    invariant(exactKeys(item, ['factDigest', 'readbackDigest', 'rowCount', 'lastSourceModifiedAt', 'lastRecordKey', 'observedAt'])
      && hash(item.factDigest) && item.factDigest === item.readbackDigest
      && Number.isSafeInteger(item.rowCount) && item.rowCount >= 0 && item.rowCount < 100
      && (type === 'call' || item.rowCount === 1) && time(item.observedAt)
      && item.observedAt <= proof.verifiedAt
      && Date.parse(proof.verifiedAt) - Date.parse(item.observedAt) <= 300_000,
    'REPORT_VERIFICATION_INVALID', 'Report source and complete Analytics partition do not agree.');
    if (item.rowCount === 0) {
      invariant(type === 'call' && proof.checkpoints[type] === null
        && item.lastSourceModifiedAt === null && item.lastRecordKey === null,
      'REPORT_VERIFICATION_INVALID', 'Empty call verification is inconsistent.');
    } else {
      const checkpoint = proof.checkpoints[type];
      validateReportCheckpoint(proof.scope, type, checkpoint, now);
      invariant(time(item.lastSourceModifiedAt) && item.lastSourceModifiedAt <= proof.verifiedAt
        && hash(item.lastRecordKey) && checkpoint.LAST_SOURCE_MODIFIED_AT === item.lastSourceModifiedAt
        && checkpoint.LAST_RECORD_KEY === item.lastRecordKey,
      'REPORT_VERIFICATION_INVALID', 'Report checkpoint does not match its complete source partition.');
    }
    recordTypes[type] = { rowsetDigest: item.readbackDigest, rowCount: item.rowCount,
      lastSourceModifiedAt: item.lastSourceModifiedAt, lastRecordKey: item.lastRecordKey };
  }
  return sha256(`report-complete-verification-v1\0${canonicalJson({ scope: proof.scope,
    sourceDigest: proof.sourceDigest, canonicalDigest: proof.canonicalDigest, recordTypes })}`);
}

function createReportCheckpointReattestor({ analyticsStore, now = Date.now, freshnessMs } = {}) {
  invariant(typeof analyticsStore?.reattestReportCheckpoint === 'function'
    && typeof analyticsStore?.getReportCheckpoint === 'function' && typeof now === 'function'
    && Number.isSafeInteger(freshnessMs) && freshnessMs >= 300_000 && freshnessMs <= 86_400_000,
  'REPORT_VERIFICATION_INVALID', 'Report re-attestation dependencies are invalid.');
  return async function reattestCheckpoints(verificationProof, options = {}) {
    invariant(options && typeof options === 'object' && !Array.isArray(options)
      && Object.keys(options).every((key) => key === 'signal' || key === 'budget')
      && (options.signal === undefined || options.signal instanceof AbortSignal)
      && (options.budget === undefined || (isReportAttemptBudget(options.budget)
        && (options.signal === undefined || options.signal === options.budget.signal))),
    'REPORT_VERIFICATION_INVALID', 'Report verification options are invalid.');
    const proof = structuredClone(verificationProof);
    const at = now();
    const digest = reportVerificationDigest(proof, at);
    const expected = proof.checkpoints;
    const desired = {};
    const assertActive = () => {
      options.budget?.assertActive();
      invariant(!options.signal?.aborted, 'REPORT_VERIFICATION_ABORTED', 'Report verification was cancelled.');
    };
    assertActive();
    invariant(TYPES.some((type) => expected[type] && Date.parse(expected[type].STALE_AFTER_AT) <= at),
      'REPORT_VERIFICATION_NOT_REQUIRED', 'Report checkpoints have not expired.');
    const verification = Object.freeze({ digest, verifiedAt: proof.verifiedAt,
      staleAfterAt: new Date(Date.parse(proof.verifiedAt) + freshnessMs).toISOString() });
    for (const type of TYPES) {
      assertActive();
      desired[type] = expected[type] === null ? null : await analyticsStore.reattestReportCheckpoint(
        proof.scope, type, expected[type], verification, options);
    }
    // Resolve the entire cohort after all conditional writes, including a call
    // checkpoint that must still be absent. Partial progress cannot return ready.
    for (const type of TYPES) {
      assertActive();
      const observed = await analyticsStore.getReportCheckpoint(proof.scope, type, options);
      invariant(desired[type] === null ? observed === null
        : observed && checkpointState(observed) === checkpointState(desired[type]),
      'REPORT_CHECKPOINT_CONFLICT', 'Report verification changed before durable readback.');
    }
    assertActive();
    return Object.freeze({ verificationDigest: digest, verifiedAt: verification.verifiedAt });
  };
}

module.exports = { createReportCheckpointReattestor, reportVerificationDigest };
