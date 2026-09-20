'use strict';

const { RevenueDeskError, invariant } = require('revenue_desk_call_gateway/lib/errors');

const TABLE = 'RevenueLeakTestRequestFormSessions';
// This is a read-only projection of the established Form 1 session contract.
// Token/handle hashes and claims are neither returned nor logged by this reader.
const FIELDS = Object.freeze([
  'ROWID', 'CRM_LEAD_ID', 'INTAKE_SUBMISSION_ID', 'CRM_ORGANIZATION_HASH',
  'CRM_MODULE', 'EXPECTED_STAGE', 'FORM_IDENTITY_HASH', 'SOURCE_ENVIRONMENT',
  'SOURCE_REVISION', 'CONFIGURATION_REVISION', 'STATUS', 'LAST_OUTCOME',
  'CREATED_AT', 'ISSUED_AT', 'EXPIRES_AT', 'LAST_PREFILLED_AT',
  'PREFILL_HANDLE_CONSUMED_AT', 'SUBMISSION_STARTED_AT', 'CONSUMED_AT',
  'UPDATED_AT', 'REVOKED_AT', 'SUBMISSION_FINGERPRINT', 'SUBMISSION_CLAIM_ID',
  'CRM_RECORD_VERSION', 'PREFILL_COUNT', 'MAX_PREFILLS', 'SESSION_VERSION',
]);
// Keep these validators aligned with Form 1 security.js/session-store.js. The
// controller package deliberately does not import the separate Form 1 runtime
// or its writable session adapter just to read historical lineage.
const JOURNEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const CRM_ID = /^[1-9][0-9]{9,29}$/;
const ROW_ID = /^[1-9][0-9]{0,29}$/;
const HASH = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const CLAIM = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const RECOVERY = /^r1_[a-f0-9]{40}_[a-f0-9]{12}4[a-f0-9]{3}[89ab][a-f0-9]{15}$/;

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function timestamp(value) {
  const result = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(result) && new Date(result).toISOString() === value ? result : NaN;
}

function integer(value) {
  const result = typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(result) ? result : NaN;
}

function validateLineage(row, journeyId, config, nowMs) {
  const code = 'CONFIGURATION_SOURCE_LINEAGE_INVALID';
  invariant(plain(row) && ROW_ID.test(row.ROWID || '')
    && typeof row.CRM_LEAD_ID === 'string' && CRM_ID.test(row.CRM_LEAD_ID)
    && row.INTAKE_SUBMISSION_ID === journeyId
    && row.CRM_ORGANIZATION_HASH === config.crmOrganizationSha256
    && row.CRM_MODULE === 'Leads' && row.EXPECTED_STAGE === 'form1'
    && row.FORM_IDENTITY_HASH === config.form1DestinationSha256
    && row.SOURCE_ENVIRONMENT === 'development'
    && REVISION.test(row.SOURCE_REVISION || '')
    && row.CONFIGURATION_REVISION === row.SOURCE_REVISION
    && row.STATUS === 'consumed'
    && (row.LAST_OUTCOME === 'submitted' || RECOVERY.test(row.LAST_OUTCOME || ''))
    && (row.REVOKED_AT === null || row.REVOKED_AT === undefined || row.REVOKED_AT === '')
    && HASH.test(row.SUBMISSION_FINGERPRINT || '')
    && CLAIM.test(row.SUBMISSION_CLAIM_ID || '')
    && integer(row.PREFILL_COUNT) === 1 && integer(row.MAX_PREFILLS) === 1
    && integer(row.SESSION_VERSION) >= 5,
  code, 'Completed assisted Form 1 lineage is invalid.', { httpStatus: 409 });
  const times = Object.fromEntries(['CREATED_AT', 'ISSUED_AT', 'EXPIRES_AT',
    'LAST_PREFILLED_AT', 'PREFILL_HANDLE_CONSUMED_AT', 'SUBMISSION_STARTED_AT',
    'CONSUMED_AT', 'UPDATED_AT'].map((field) => [field, timestamp(row[field])]));
  const recordAt = typeof row.CRM_RECORD_VERSION === 'string'
    && row.CRM_RECORD_VERSION.length <= 64
    && /(?:Z|[+-]\d{2}:\d{2})$/.test(row.CRM_RECORD_VERSION)
    ? Date.parse(row.CRM_RECORD_VERSION) : NaN;
  invariant(Object.values(times).every(Number.isFinite) && Number.isFinite(recordAt)
    && Number.isSafeInteger(nowMs) && nowMs >= 0
    && times.CREATED_AT <= times.ISSUED_AT
    && times.ISSUED_AT <= times.LAST_PREFILLED_AT
    && times.LAST_PREFILLED_AT === times.PREFILL_HANDLE_CONSUMED_AT
    && times.LAST_PREFILLED_AT <= times.SUBMISSION_STARTED_AT
    && recordAt <= times.SUBMISSION_STARTED_AT
    && times.SUBMISSION_STARTED_AT < times.EXPIRES_AT
    && times.SUBMISSION_STARTED_AT <= times.CONSUMED_AT
    && times.CONSUMED_AT === times.UPDATED_AT && times.CONSUMED_AT <= nowMs,
  code, 'Completed assisted Form 1 chronology is invalid.', { httpStatus: 409 });
  // Consumption follows the existing assisted writer's exact Lead readback.
  // It recovers the original Lead, not a fabricated native-conversion event.
  // A later controller must independently join current Account/Contact/Deal
  // and authenticated Form 2 evidence before creating a configuration.
  return Object.freeze({ originalLeadId: row.CRM_LEAD_ID, journeyId,
    consumedAt: row.CONSUMED_AT, sourceRevision: row.SOURCE_REVISION,
    form1RowId: String(row.ROWID), submissionFingerprint: row.SUBMISSION_FINGERPRINT });
}

/** Read historical assisted lineage through the authenticated Development app. */
function createConfigurationSourceReader(app, config, { now = Date.now } = {}) {
  invariant(config?.environment === 'development'
    && HASH.test(config.crmOrganizationSha256 || '')
    && HASH.test(config.form1DestinationSha256 || '')
    && Number.isSafeInteger(config.platformTimeoutMs)
    && config.platformTimeoutMs >= 250 && config.platformTimeoutMs <= 5000
    && typeof app?.zcql === 'function' && typeof now === 'function',
  'CONFIGURATION_SOURCE_READER_UNAVAILABLE', 'Configuration source reader is unavailable.',
  { httpStatus: 503 });
  const binding = Object.freeze({ crmOrganizationSha256: config.crmOrganizationSha256,
    form1DestinationSha256: config.form1DestinationSha256 });
  const timeoutMs = config.platformTimeoutMs;

  async function findAssistedLineage(journeyId) {
    invariant(typeof journeyId === 'string' && JOURNEY.test(journeyId),
      'CONFIGURATION_SOURCE_LINEAGE_INVALID', 'Journey identity is invalid.', { httpStatus: 409 });
    const query = `SELECT ${FIELDS.join(', ')} FROM ${TABLE}`
      + ` WHERE INTAKE_SUBMISSION_ID = '${journeyId}' LIMIT 2`;
    let timer;
    let result;
    try {
      result = await Promise.race([
        Promise.resolve().then(() => app.zcql().executeZCQLQuery(query)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('source read timeout')), timeoutMs);
        }),
      ]);
    } catch (_) {
      // Never attach provider causes, which can contain SQL, headers or rows.
      throw new RevenueDeskError('CONFIGURATION_SOURCE_READ_UNAVAILABLE',
        'Configuration source read is unavailable.', { httpStatus: 503, retryable: true });
    } finally { clearTimeout(timer); }
    invariant(Array.isArray(result) && result.length <= 1,
      'CONFIGURATION_SOURCE_LINEAGE_UNAVAILABLE',
      'Assisted Form 1 lineage is ambiguous.', { httpStatus: 409 });
    if (result.length === 0) return null;
    const entry = result[0];
    const row = plain(entry?.[TABLE]) ? entry[TABLE] : entry;
    return validateLineage(row, journeyId, binding, now());
  }

  async function readAssistedLineage(journeyId) {
    const lineage = await findAssistedLineage(journeyId);
    invariant(lineage !== null, 'CONFIGURATION_SOURCE_LINEAGE_UNAVAILABLE',
      'Exactly one completed assisted Form 1 lineage is required.', { httpStatus: 409 });
    return lineage;
  }
  return Object.freeze({ findAssistedLineage, readAssistedLineage });
}

module.exports = Object.freeze({ TABLE, FIELDS, createConfigurationSourceReader });
