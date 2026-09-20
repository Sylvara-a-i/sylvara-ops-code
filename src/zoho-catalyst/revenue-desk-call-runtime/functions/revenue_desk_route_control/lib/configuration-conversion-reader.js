'use strict';

const { RevenueDeskError, invariant } = require('revenue_desk_call_gateway/lib/errors');

const NATIVE_CONVERSION_FIELDS = Object.freeze([
  'id', 'Intake_Submission_ID', 'Modified_Time', 'Converted__s', 'Converted_Date_Time',
]);
const CRM_ID = /^[1-9][0-9]{9,29}$/;
const JOURNEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const CODE = 'CONFIGURATION_CONVERSION_INVALID';

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function requireConversion(condition) {
  invariant(condition, CODE, 'Native Lead conversion evidence is incomplete or inconsistent.',
    { httpStatus: 409 });
}

function timestamp(value) {
  requireConversion(typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value));
  const epoch = Date.parse(value);
  const local = value.slice(0, 19);
  requireConversion(Number.isFinite(epoch)
    && new Date(Date.parse(`${local}.000Z`)).toISOString() === `${local}.000Z`);
  return epoch;
}

function projectConversion(response, originalLeadId, observedAt) {
  requireConversion(plain(response) && Array.isArray(response.data) && response.data.length === 1
    && plain(response.data[0]) && response.data[0].id === originalLeadId
    && plain(response.info) && response.info.count === 1 && response.info.more_records === false
    && (response.info.next_page_token === null || response.info.next_page_token === undefined));
  const row = response.data[0];
  requireConversion(row.Converted__s === true
    && (!Object.hasOwn(row, '$converted') || row.$converted === true)
    && typeof row.Intake_Submission_ID === 'string' && JOURNEY.test(row.Intake_Submission_ID));
  const detail = row.$converted_detail;
  requireConversion(plain(detail));
  const ids = [originalLeadId, detail.account, detail.contact, detail.deal];
  requireConversion(ids.every((id) => typeof id === 'string' && CRM_ID.test(id))
    && new Set(ids).size === ids.length);
  const convertedAt = timestamp(row.Converted_Date_Time);
  requireConversion(convertedAt === timestamp(detail.convert_date) && convertedAt <= observedAt
    && timestamp(row.Modified_Time) <= observedAt);
  // No lookup/name inference: all three targets come from native conversion
  // details, not from today's Deal links. Staging must independently join these
  // exact IDs/journey to its authenticated Form 1, Form 2 and CRM source reads.
  return Object.freeze({ originalLeadId, journeyId: row.Intake_Submission_ID,
    accountId: detail.account, contactId: detail.contact, dealId: detail.deal,
    convertedAt: new Date(convertedAt).toISOString(), observedAt: new Date(observedAt).toISOString() });
}

/**
 * Read-only server adapter. Missing derived conversion details remain a live
 * capability gap; neither matching lookup IDs nor a request flag can replace it.
 * Official contracts checked 2026-09-15:
 * https://www.zoho.com/crm/developer/docs/api/v8/get-records.html
 * https://help.zoho.com/portal/en/community/topic/kaizen-11-the-properties-in-zoho-crm-api
 * The latter documents $converted_detail on GET; its return with the selected
 * v8 fields and the tenant's read scope still require authorized live readback.
 */
function createConfigurationConversionReader({ crm, now = Date.now, timeoutMs = 10000 } = {}) {
  invariant(typeof crm?.getNativeConversion === 'function' && typeof now === 'function'
    && Number.isSafeInteger(timeoutMs) && timeoutMs >= 250 && timeoutMs <= 10000,
  'CONFIGURATION_CONVERSION_READER_UNAVAILABLE', 'Native Lead conversion reader is unavailable.',
  { httpStatus: 503 });
  const read = crm.getNativeConversion.bind(crm);

  async function readConversion(originalLeadId) {
    requireConversion(typeof originalLeadId === 'string' && CRM_ID.test(originalLeadId));
    const startedAt = now();
    requireConversion(Number.isSafeInteger(startedAt) && startedAt >= 0
      && startedAt <= 8_640_000_000_000_000);
    let response;
    let timer;
    try {
      response = await Promise.race([
        Promise.resolve().then(() => read(originalLeadId)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('conversion timeout')), timeoutMs);
        }),
      ]);
    } catch (_) {
      throw new RevenueDeskError('CONFIGURATION_CONVERSION_READ_UNAVAILABLE',
        'Native Lead conversion read is unavailable.', { httpStatus: 503, retryable: true });
    } finally { clearTimeout(timer); }
    const finishedAt = now();
    requireConversion(Number.isSafeInteger(finishedAt) && finishedAt >= startedAt
      && finishedAt - startedAt <= timeoutMs);
    return projectConversion(response, originalLeadId, startedAt);
  }
  return Object.freeze({ readConversion });
}

module.exports = Object.freeze({ NATIVE_CONVERSION_FIELDS, createConfigurationConversionReader });
