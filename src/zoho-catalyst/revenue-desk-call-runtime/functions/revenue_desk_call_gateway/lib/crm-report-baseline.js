'use strict';

// Shared pure mapping for controller-owned pre-test capture and local reports.
// It never reads CRM, authenticates supplied evidence, changes a record, or
// promotes a customer's estimate to verified revenue. Runtime callers must
// obtain the projected inputs from their authenticated, bounded adapters.
const { invariant } = require('./errors');

const MAX_READBACK_AGE_MS = 15 * 60 * 1000;
const CRM_ID = /^[1-9][0-9]{7,29}$/;
const KEY = /^[a-f0-9]{64}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const CURRENT_HANDLING = new Set([
  'Office Staff / Dispatcher', 'Owner / Technician Cell', 'Voicemail',
  'Phone Menu / IVR', 'Human Answering Service', 'Existing AI Receptionist',
  'Mixed', 'Unknown',
]);
const BAND_VALUES = Object.freeze({
  Monthly_Inbound_Call_Band: new Set(['Under 20', '20-49', '50-99', '100-249', '250+', 'Unknown']),
  After_Hours_Call_Band: new Set(['None', '1-9', '10-24', '25-49', '50+', 'Unknown']),
  Average_Job_Value_Band: new Set([
    'Under $250', '$250-$499', '$500-$999', '$1,000-$2,499', '$2,500+', 'Unknown',
  ]),
});
const ROUTES = Object.freeze({
  'After Hours Only': 'AfterHoursOnly',
  'After-Hours': 'AfterHoursOnly',
  'No Answer / Overflow Only': 'NoAnswerOverflowOnly',
  'No-Answer/Overflow': 'NoAnswerOverflowOnly',
  'After Hours + Overflow': 'AfterHoursAndOverflow',
  Both: 'AfterHoursAndOverflow',
});
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
});
const METADATA_FIELDS = Object.freeze({ ...FIELDS, Approved_Test_Route: 'picklist' });
const RELATIONSHIP_FIELDS = Object.freeze([
  'leadId', 'accountId', 'contactId', 'dealId', 'intakeSubmissionId',
]);

function exactObject(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
    && Reflect.ownKeys(value).length === keys.length
    && Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
}

function requireBaseline(condition, code = 'CRM_BASELINE_INVALID') {
  invariant(condition, code, 'CRM report baseline requires verified, consistent source evidence.');
}

function timestamp(value) {
  requireBaseline(typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value));
  const epoch = Date.parse(value);
  const local = value.slice(0, 19);
  requireBaseline(Number.isFinite(epoch)
    && new Date(Date.parse(`${local}.000Z`)).toISOString() === `${local}.000Z`);
  return epoch;
}

function period(value) {
  requireBaseline(exactObject(value, ['start', 'end']));
  const start = timestamp(value.start);
  const end = timestamp(value.end);
  requireBaseline(start < end, 'CRM_BASELINE_PERIOD_INVALID');
  return { start, end };
}

function samePeriod(left, right) {
  return left.start === right.start && left.end === right.end;
}

function scalar(value, kind) {
  if (value === null) return null;
  requireBaseline(typeof value === 'number' && Number.isFinite(value) && value >= 0);
  if (kind === 'integer') requireBaseline(Number.isSafeInteger(value) && value <= 999999999);
  else requireBaseline(value <= 100 && /^\d+(?:\.\d{1,2})?$/.test(String(value)));
  return value;
}

function minorUnits(value) {
  if (value === null) return null;
  requireBaseline(typeof value === 'number' && Number.isFinite(value));
  const match = /^(0|[1-9][0-9]{0,8})(?:\.([0-9]{1,2}))?$/.exec(String(value));
  requireBaseline(Boolean(match));
  // Parse decimal digits rather than rounding a binary floating-point amount.
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
}

function selectedChoice(value, field, metadata) {
  if (value === null) return null;
  requireBaseline(typeof value === 'string' && metadata.fields[field].activeValues.includes(value),
    'CRM_BASELINE_CHOICE_UNVERIFIED');
  if (value === '-None-') return null;
  if (field === 'Current_Call_Handling') {
    requireBaseline(CURRENT_HANDLING.has(value), 'CRM_BASELINE_CHOICE_UNVERIFIED');
  } else {
    // Only the reviewed field-specific ranges may leave this private boundary.
    // A supplied metadata option cannot authorize arbitrary numeric contact data.
    // Retain the exact selected range; never manufacture a numeric midpoint.
    requireBaseline(BAND_VALUES[field]?.has(value),
    'CRM_BASELINE_CHOICE_UNVERIFIED');
  }
  return value;
}

// Both entry points share every field, ownership and privacy check. Only the
// temporal boundary differs: fresh capture cannot impersonate historical proof.
function buildBaseline(input, now, freshCapture) {
  requireBaseline(exactObject(input, ['deal', 'context', 'evidence', 'metadata']));
  const { deal, context, evidence, metadata } = input;
  requireBaseline(exactObject(context, [
    'clientKey', 'deploymentKey', 'configurationVersionId', 'configurationVersion', 'environment', 'relationships',
    'crmModifiedAt', 'approvedTestRoute', 'sourcePeriod', 'evidenceClass', 'currency',
    ...(freshCapture ? [] : ['testStartedAt']),
  ]));
  requireBaseline(KEY.test(context.clientKey) && KEY.test(context.deploymentKey)
    && context.clientKey !== context.deploymentKey
    && typeof context.configurationVersionId === 'string' && VERSION.test(context.configurationVersionId)
    && VERSION.test(context.configurationVersion)
    && context.environment === 'development');
  requireBaseline(exactObject(context.relationships, RELATIONSHIP_FIELDS));
  const relationships = context.relationships;
  const recordIds = ['leadId', 'accountId', 'contactId', 'dealId'].map((key) => relationships[key]);
  requireBaseline(recordIds.every((id) => typeof id === 'string' && CRM_ID.test(id))
    && new Set(recordIds).size === recordIds.length
    && typeof relationships.intakeSubmissionId === 'string'
    && VERSION.test(relationships.intakeSubmissionId), 'CRM_BASELINE_OWNERSHIP_CONFLICT');
  requireBaseline(exactObject(deal, [
    'id', 'Account_Name', 'Contact_Name', 'Modified_Time', 'Configuration_Version',
    'Intake_Submission_ID', 'Approved_Test_Route', ...Object.keys(FIELDS),
  ]));
  requireBaseline(exactObject(deal.Account_Name, ['id']) && exactObject(deal.Contact_Name, ['id'])
    && deal.id === relationships.dealId && deal.Account_Name.id === relationships.accountId
    && deal.Contact_Name.id === relationships.contactId
    && deal.Intake_Submission_ID === relationships.intakeSubmissionId
    && deal.Configuration_Version === context.configurationVersion
    && deal.Modified_Time === context.crmModifiedAt
    && Object.hasOwn(ROUTES, deal.Approved_Test_Route)
    && deal.Approved_Test_Route === context.approvedTestRoute,
  'CRM_BASELINE_OWNERSHIP_CONFLICT');
  requireBaseline(exactObject(evidence, [
    'source', 'clientKey', 'deploymentKey', 'configurationVersionId', 'configurationVersion', 'environment',
    'relationships', 'crmModifiedAt', 'readAt', 'capturedAt', 'sourcePeriod', 'evidenceClass',
  ]));
  requireBaseline(evidence.source === 'crm_selected_field_readback'
    && ['clientKey', 'deploymentKey', 'configurationVersionId', 'configurationVersion', 'environment', 'crmModifiedAt',
      'evidenceClass'].every((field) => evidence[field] === context[field])
    && exactObject(evidence.relationships, RELATIONSHIP_FIELDS)
    && RELATIONSHIP_FIELDS.every((field) => evidence.relationships[field] === relationships[field]),
  'CRM_BASELINE_OWNERSHIP_CONFLICT');
  requireBaseline(['customer_supplied_estimate', 'verified_business_records'].includes(context.evidenceClass));
  const sourcePeriod = period(evidence.sourcePeriod);
  period(context.sourcePeriod);
  requireBaseline(samePeriod(evidence.sourcePeriod, context.sourcePeriod), 'CRM_BASELINE_PERIOD_INVALID');
  const modified = timestamp(deal.Modified_Time);
  const readAt = timestamp(evidence.readAt);
  const captured = timestamp(evidence.capturedAt);
  requireBaseline(Number.isSafeInteger(now) && modified <= readAt && modified <= captured
    && captured <= now
    && sourcePeriod.end <= captured,
  'CRM_BASELINE_TIMING_INVALID');
  if (freshCapture) {
    // Revalidation records the actual server read time, never a fabricated
    // earlier time. The source must still predate the reviewed capture; later
    // edits cannot be treated as the same immutable baseline.
    requireBaseline(readAt <= now && now - captured <= MAX_READBACK_AGE_MS
      && now - readAt <= MAX_READBACK_AGE_MS
      && Math.abs(captured - readAt) <= MAX_READBACK_AGE_MS, 'CRM_BASELINE_TIMING_INVALID');
  } else {
    const testStarted = timestamp(context.testStartedAt);
    requireBaseline(readAt <= captured && captured - readAt <= MAX_READBACK_AGE_MS
      && captured <= testStarted && testStarted <= now, 'CRM_BASELINE_TIMING_INVALID');
  }
  requireBaseline(exactObject(metadata, ['source', 'observedAt', 'fields'])
    && metadata.source === 'crm_field_metadata_readback'
    && exactObject(metadata.fields, Object.keys(METADATA_FIELDS)), 'CRM_BASELINE_METADATA_UNVERIFIED');
  const observed = timestamp(metadata.observedAt);
  // The configuration writer independently re-reads metadata after the owner
  // reviews an exact fresh capture. That later observation can validate the
  // same immutable values, but may not be future-dated or outside the capture's
  // bounded window. Historical reports still require original pre-capture
  // metadata: they cannot repair old provenance with today's field choices.
  requireBaseline(freshCapture
    ? observed <= now && now - observed <= MAX_READBACK_AGE_MS
      && Math.abs(captured - observed) <= MAX_READBACK_AGE_MS
    : observed <= captured && captured - observed <= MAX_READBACK_AGE_MS,
    'CRM_BASELINE_METADATA_UNVERIFIED');
  for (const [field, dataType] of Object.entries(METADATA_FIELDS)) {
    const spec = metadata.fields[field];
    requireBaseline(exactObject(spec, dataType === 'picklist'
      ? ['apiName', 'dataType', 'active', 'activeValues'] : ['apiName', 'dataType', 'active'])
      && spec.apiName === field && spec.dataType === dataType && spec.active === true,
    'CRM_BASELINE_METADATA_UNVERIFIED');
    if (dataType === 'picklist') requireBaseline(Array.isArray(spec.activeValues)
      && spec.activeValues.length > 0 && spec.activeValues.length <= 100
      && spec.activeValues.every((value) => typeof value === 'string' && value.length <= 120)
      && new Set(spec.activeValues).size === spec.activeValues.length,
    'CRM_BASELINE_METADATA_UNVERIFIED');
  }
  // The selected scalar must be in the fresh projection of this field's
  // actual/reference values; accepting a known alias alone is not metadata proof.
  requireBaseline(metadata.fields.Approved_Test_Route.activeValues.includes(deal.Approved_Test_Route),
    'CRM_BASELINE_CHOICE_UNVERIFIED');
  const averageJobValueMinorUnits = minorUnits(deal.Average_Job_Value);
  const currentMonthlyAnsweringCostMinorUnits = minorUnits(deal.Current_Monthly_Answering_Cost);
  const hasAmount = averageJobValueMinorUnits !== null || currentMonthlyAnsweringCostMinorUnits !== null;
  requireBaseline(context.currency === 'USD' || (context.currency === null && !hasAmount));
  const values = Object.freeze({
    currentCallHandling: selectedChoice(deal.Current_Call_Handling, 'Current_Call_Handling', metadata),
    monthlyInboundCalls: scalar(deal.Monthly_Inbound_Calls, 'integer'),
    monthlyInboundCallBand: selectedChoice(deal.Monthly_Inbound_Call_Band, 'Monthly_Inbound_Call_Band', metadata),
    afterHoursCallBand: selectedChoice(deal.After_Hours_Call_Band, 'After_Hours_Call_Band', metadata),
    afterHoursCallShare: scalar(deal.After_Hours_Call_Share, 'percent'),
    estimatedUnansweredCallRate: scalar(deal.Estimated_Unanswered_Call_Rate, 'percent'),
    averageJobValueMinorUnits,
    averageJobValueBand: selectedChoice(deal.Average_Job_Value_Band, 'Average_Job_Value_Band', metadata),
    currentMonthlyAnsweringCostMinorUnits,
  });
  return Object.freeze({
    schemaVersion: 1,
    clientKey: context.clientKey,
    deploymentKey: context.deploymentKey,
    // Analytics facts bind the physical version row; CRM retains its separate
    // configuration label. Never join those two identities by coincidence.
    configurationVersionId: context.configurationVersionId,
    configurationVersion: context.configurationVersion,
    environment: context.environment,
    coverageMode: ROUTES[deal.Approved_Test_Route],
    capturedAt: new Date(captured).toISOString(),
    sourceModifiedAt: new Date(modified).toISOString(),
    sourcePeriod: Object.freeze({ start: new Date(sourcePeriod.start).toISOString(),
      end: new Date(sourcePeriod.end).toISOString() }),
    evidenceClass: context.evidenceClass,
    provenanceStatus: 'locally_consistent_not_authenticated',
    comparisonStatus: 'context_only_not_before_after_proof',
    currency: hasAmount ? context.currency : null,
    values,
  });
}

/**
 * Validate a fresh pre-start Deal projection without an anticipated test start.
 * This pure mapping is deterministic inside the freshness window; durable
 * single-capture/idempotency enforcement belongs to the configuration writer.
 * Caller-supplied evidence is checked for consistency, not authenticated here.
 */
function buildCrmPreTestSnapshot(input, { now = Date.now() } = {}) {
  return buildBaseline(input, now, true);
}

/**
 * Validate previously captured source evidence when preparing a later report.
 * Freshness is checked at original capture; the actual test start must fall
 * between that capture and report time. Historical evidence is never recaptured.
 */
function buildCrmReportBaseline(input, { now = Date.now() } = {}) {
  return buildBaseline(input, now, false);
}

module.exports = { buildCrmPreTestSnapshot, buildCrmReportBaseline, MAX_READBACK_AGE_MS };
