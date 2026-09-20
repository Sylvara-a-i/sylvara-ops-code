'use strict';

const { RevenueDeskError, invariant } = require('revenue_desk_call_gateway/lib/errors');

const FIELDS = Object.freeze({
  Current_Call_Handling: 'picklist',
  Monthly_Inbound_Calls: 'integer',
  Monthly_Inbound_Call_Band: 'picklist',
  After_Hours_Call_Band: 'picklist',
  After_Hours_Call_Share: 'percent',
  Estimated_Unanswered_Call_Rate: 'percent',
  Average_Job_Value: 'currency',
  Average_Job_Value_Band: 'picklist',
  Current_Monthly_Answering_Cost: 'currency',
  Approved_Test_Route: 'picklist',
});
const MAX_FIELDS = 2000;
const MAX_OPTIONS = 100;
const CODE = 'CONFIGURATION_METADATA_INVALID';

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function requireMetadata(condition) {
  invariant(condition, CODE, 'CRM configuration field metadata is incomplete or incompatible.',
    { httpStatus: 503 });
}

function activeValues(options) {
  requireMetadata(Array.isArray(options) && options.length > 0 && options.length <= MAX_OPTIONS);
  const result = new Set();
  for (const option of options) {
    requireMetadata(plain(option) && ['used', 'unused'].includes(option.type));
    if (option.type === 'unused') continue;
    // Preserve stored and reference representations. Translated display labels
    // cannot authorize source values, and retired options cannot become active.
    for (const key of ['actual_value', 'reference_value']) {
      const value = option[key];
      requireMetadata(typeof value === 'string' && value.length > 0 && value.length <= 120
        && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
      result.add(value);
    }
  }
  requireMetadata(result.size > 0 && result.size <= MAX_OPTIONS);
  return Object.freeze([...result].sort());
}

function projectMetadata(response, observedAt) {
  requireMetadata(plain(response) && Array.isArray(response.fields)
    && response.fields.length > 0 && response.fields.length <= MAX_FIELDS);
  // This endpoint has no documented pagination. An unexpected continuation or
  // partial-result envelope must not be mistaken for a complete source read.
  requireMetadata(!['info', 'next_page_token', 'more_records', 'partial']
    .some((key) => Object.hasOwn(response, key)));
  const selected = new Map();
  for (const field of response.fields) {
    requireMetadata(plain(field) && typeof field.api_name === 'string');
    if (!Object.hasOwn(FIELDS, field.api_name)) continue;
    requireMetadata(!selected.has(field.api_name));
    selected.set(field.api_name, field);
  }
  const fields = {};
  for (const [apiName, dataType] of Object.entries(FIELDS)) {
    const field = selected.get(apiName);
    requireMetadata(field?.type === 'used' && field.data_type === dataType
      && field.visible === true && field.virtual_field === false);
    fields[apiName] = Object.freeze({ apiName, dataType, active: true,
      ...(dataType === 'picklist' ? { activeValues: activeValues(field.pick_list_values) } : {}),
    });
  }
  return Object.freeze({ source: 'crm_field_metadata_readback', observedAt,
    fields: Object.freeze(fields) });
}

/**
 * Server-owned source for the canonical pre-test baseline, not an HTTP input.
 * Only the existing organization-bound CRM read client is injected by the host.
 * CRM v8 metadata capability (checked 2026-09-15):
 * https://www.zoho.com/crm/developer/docs/api/v8/field-meta.html
 * The field READ scope, tenant permissions and deployed readback remain separate
 * acceptance requirements. Module-wide used values do not prove layout rules.
 */
function createConfigurationMetadataReader({ crm, now = Date.now, timeoutMs = 10000 } = {}) {
  invariant(typeof crm?.getPreparationFieldMetadata === 'function' && typeof now === 'function'
    && Number.isSafeInteger(timeoutMs) && timeoutMs >= 250 && timeoutMs <= 10000,
  'CONFIGURATION_METADATA_READER_UNAVAILABLE', 'CRM configuration metadata reader is unavailable.',
  { httpStatus: 503 });
  const read = crm.getPreparationFieldMetadata.bind(crm);

  async function readMetadata() {
    // Dating at the start is conservative: a delayed read cannot reset freshness.
    const startedAt = now();
    requireMetadata(Number.isSafeInteger(startedAt) && startedAt >= 0
      && startedAt <= 8_640_000_000_000_000);
    let response;
    let timer;
    try {
      response = await Promise.race([
        Promise.resolve().then(read),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('metadata timeout')), timeoutMs);
        }),
      ]);
    } catch (_) {
      // Never propagate provider causes containing credentials, headers or data.
      throw new RevenueDeskError('CONFIGURATION_METADATA_READ_UNAVAILABLE',
        'CRM configuration metadata read is unavailable.', { httpStatus: 503, retryable: true });
    } finally { clearTimeout(timer); }
    const finishedAt = now();
    requireMetadata(Number.isSafeInteger(finishedAt) && finishedAt >= startedAt
      && finishedAt - startedAt <= timeoutMs);
    return projectMetadata(response, new Date(startedAt).toISOString());
  }
  return Object.freeze({ readMetadata });
}

module.exports = Object.freeze({ FIELDS, createConfigurationMetadataReader });
