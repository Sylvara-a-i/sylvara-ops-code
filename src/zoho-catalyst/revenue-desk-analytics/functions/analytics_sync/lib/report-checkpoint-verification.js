'use strict';

const { invariant } = require('./errors');
const { canonicalJson, checkpointKey } = require('./facts');

const PRESERVED = Object.freeze(['CHECKPOINT_KEY', 'ROW_SCHEMA_VERSION', 'RECORD_TYPE',
  'TARGET_TABLE_ALIAS', 'CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENVIRONMENT', 'LAST_SOURCE_MODIFIED_AT',
  'LAST_RECORD_KEY', 'PROVIDER_WATERMARK', 'LAST_PROVIDER_JOB_ID', 'LAST_ACCEPTED_ROW_COUNT',
  'LAST_REJECTED_ROW_COUNT', 'STATUS', 'LAST_ERROR_CODE', 'LAST_SYNC_AT', 'CREATED_AT',
  'SOURCE_REVISION', 'METRIC_VERSION']);
const MUTABLE = Object.freeze(['LAST_RECONCILED_AT', 'STALE_AFTER_AT', 'UPDATED_AT', 'VERSION',
  'REPORT_VERIFICATION_DIGEST']);
const NUMBERS = new Set(['ROW_SCHEMA_VERSION', 'LAST_ACCEPTED_ROW_COUNT', 'LAST_REJECTED_ROW_COUNT', 'VERSION']);
const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;
function integer(value) {
  const parsed = typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : value;
  invariant(Number.isSafeInteger(parsed) && parsed >= 0,
    'REPORT_CHECKPOINT_INVALID', 'Report checkpoint numeric evidence is invalid.');
  return parsed;
}

function validateReportCheckpoint(scope, type, row, at) {
  invariant(row && ['deployment', 'call', 'final_test_result'].includes(type)
    && integer(row.ROW_SCHEMA_VERSION) === 2 && row.RECORD_TYPE === type
    && row.CHECKPOINT_KEY === checkpointKey({ ...scope, RECORD_TYPE: type })
    && ['CLIENT_KEY', 'DEPLOYMENT_KEY', 'ENVIRONMENT', 'SOURCE_REVISION'].every((key) => row[key] === scope[key])
    && row.TARGET_TABLE_ALIAS === type && scope.ENVIRONMENT === 'development'
    && scope.ENGAGEMENT_TYPE === 'free_test' && row.STATUS === 'Healthy' && row.LAST_ERROR_CODE === null
    && integer(row.LAST_REJECTED_ROW_COUNT) === 0 && integer(row.LAST_ACCEPTED_ROW_COUNT) > 0
    && integer(row.VERSION) < Number.MAX_SAFE_INTEGER
    && /^[a-f0-9]{64}$/.test(row.LAST_RECORD_KEY) && /^\d{3,30}$/.test(row.LAST_PROVIDER_JOB_ID)
    && ['LAST_SOURCE_MODIFIED_AT', 'PROVIDER_WATERMARK', 'LAST_SYNC_AT', 'LAST_RECONCILED_AT',
      'STALE_AFTER_AT', 'CREATED_AT', 'UPDATED_AT'].every((key) => validTime(row[key]))
    && row.LAST_SOURCE_MODIFIED_AT === row.PROVIDER_WATERMARK
    && row.LAST_SOURCE_MODIFIED_AT <= row.LAST_SYNC_AT
    && row.LAST_SYNC_AT <= row.LAST_RECONCILED_AT && row.LAST_RECONCILED_AT < row.STALE_AFTER_AT
    && Date.parse(row.LAST_RECONCILED_AT) <= at
    && (row.REPORT_VERIFICATION_DIGEST == null || /^[a-f0-9]{64}$/.test(row.REPORT_VERIFICATION_DIGEST))
    && (row.LAST_RECONCILED_AT === row.LAST_SYNC_AT || /^[a-f0-9]{64}$/.test(row.REPORT_VERIFICATION_DIGEST)),
  'REPORT_CHECKPOINT_INVALID', 'Report checkpoint ownership or verification evidence is invalid.');
}

function checkpointState(row) {
  invariant(row && typeof row === 'object', 'REPORT_CHECKPOINT_INVALID', 'Report checkpoint is missing.');
  return canonicalJson(Object.fromEntries([...PRESERVED, ...MUTABLE].map((key) => [key,
    NUMBERS.has(key) ? integer(row[key]) : key === 'REPORT_VERIFICATION_DIGEST'
      ? row[key] ?? null : row[key]])));
}

/** Verification advances no source watermark or import history. This additive
 * digest column is used only by the explicitly composed, separately held path.
 */
function checkpointVerificationPatch(scope, type, expected, verification) {
  invariant(verification && Object.keys(verification).sort().join(',') === 'digest,staleAfterAt,verifiedAt'
    && /^[a-f0-9]{64}$/.test(verification.digest) && validTime(verification.verifiedAt)
    && validTime(verification.staleAfterAt)
    && Date.parse(verification.staleAfterAt) - Date.parse(verification.verifiedAt) >= 300_000
    && Date.parse(verification.staleAfterAt) - Date.parse(verification.verifiedAt) <= 86_400_000,
  'REPORT_CHECKPOINT_INVALID', 'Report checkpoint verification is invalid.');
  validateReportCheckpoint(scope, type, expected, Date.parse(verification.verifiedAt));
  return Object.freeze({ LAST_RECONCILED_AT: verification.verifiedAt,
    STALE_AFTER_AT: verification.staleAfterAt, REPORT_VERIFICATION_DIGEST: verification.digest,
    UPDATED_AT: verification.verifiedAt, VERSION: integer(expected.VERSION) + 1 });
}

module.exports = { checkpointState, checkpointVerificationPatch, validateReportCheckpoint };
