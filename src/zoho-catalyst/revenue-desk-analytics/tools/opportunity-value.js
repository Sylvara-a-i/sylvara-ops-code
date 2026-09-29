'use strict';

const { canonicalJson } = require('../functions/analytics_sync/lib/facts');

const METHOD_ID = 'contractor-documented-opportunity-value';
const METHOD_VERSION = 1;
const SCOPE_FIELDS = Object.freeze([
  'CLIENT_KEY', 'DEPLOYMENT_KEY', 'CONFIGURATION_VERSION',
  'ENVIRONMENT', 'ENGAGEMENT_TYPE', 'SOURCE_REVISION',
]);
const QUALIFYING_OUTCOMES = new Set(['potential_job', 'urgent_potential_job']);
const HASH = /^[a-f0-9]{64}$/;
const MAX_GROUPS = 10_000;

function requireCondition(condition, code) {
  if (!condition) { const error = new Error(code); error.code = code; throw error; }
}

function exactObject(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.hasOwn(value, field));
}

function validInstant(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validateScope(scope) {
  requireCondition(exactObject(scope, SCOPE_FIELDS)
    && HASH.test(scope.CLIENT_KEY) && HASH.test(scope.DEPLOYMENT_KEY)
    && typeof scope.CONFIGURATION_VERSION === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(scope.CONFIGURATION_VERSION)
    && scope.ENVIRONMENT === 'development' && scope.ENGAGEMENT_TYPE === 'free_test'
    && typeof scope.SOURCE_REVISION === 'string' && /^[a-f0-9]{40}$/.test(scope.SOURCE_REVISION),
  'OPPORTUNITY_SCOPE_INVALID');
}

function validateBasis(basis, reviewedAt, referenceRegistry, kind, groupKey) {
  if (basis === null) return null;
  requireCondition(exactObject(basis, ['amountMinorUnits', 'currency', 'evidenceReference', 'effectiveDate'])
    && Number.isSafeInteger(basis.amountMinorUnits) && basis.amountMinorUnits >= 0
    && typeof basis.currency === 'string' && /^[A-Z]{3}$/.test(basis.currency)
    && typeof basis.evidenceReference === 'string' && HASH.test(basis.evidenceReference)
    && typeof basis.effectiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(basis.effectiveDate)
    && validInstant(`${basis.effectiveDate}T00:00:00.000Z`)
    && basis.effectiveDate <= reviewedAt.slice(0, 10), 'OPPORTUNITY_VALUE_BASIS_INVALID');
  const previous = referenceRegistry.get(basis.evidenceReference);
  // Reusing one documented average is expected; one known job cannot become
  // multiple independently valued opportunities or conflict with another basis.
  requireCondition(!previous || (previous.kind === kind
    && canonicalJson(previous.basis) === canonicalJson(basis)
    && (kind === 'contractor_average_job' || previous.groupKey === groupKey)),
  'OPPORTUNITY_VALUE_REFERENCE_CONFLICT');
  referenceRegistry.set(basis.evidenceReference, { basis, kind, groupKey });
  return basis;
}

/** Derive a report-only estimate from reviewed contractor evidence.
 * The caller must first validate/attest the supplied call facts and calculate
 * their current rowset digest. Review metadata records results-review provenance;
 * it is not authentication, a workflow approval, or proof of a booked/lost job.
 * This pure function never changes canonical facts or contacts a provider.
 */
function buildOpportunityValue({ calls, scope, callRowsetDigest, evidence = null, now = Date.now() }) {
  validateScope(scope);
  requireCondition(Array.isArray(calls) && calls.length <= MAX_GROUPS
    && typeof callRowsetDigest === 'string' && HASH.test(callRowsetDigest)
    && Number.isFinite(now), 'OPPORTUNITY_INPUT_INVALID');
  const facts = new Map();
  for (const call of calls) {
    requireCondition(call && SCOPE_FIELDS.every((field) => call[field] === scope[field]),
      'OPPORTUNITY_SCOPE_CONFLICT');
    requireCondition(typeof call.CALL_KEY === 'string' && HASH.test(call.CALL_KEY)
      && !facts.has(call.CALL_KEY) && typeof call.HANDLED_RECORDED === 'boolean'
      && validInstant(call.SOURCE_MODIFIED_AT) && Date.parse(call.SOURCE_MODIFIED_AT) <= now,
    'OPPORTUNITY_CALL_INVALID');
    facts.set(call.CALL_KEY, call);
  }
  const qualifying = new Set(calls.filter((call) => call.HANDLED_RECORDED
    && QUALIFYING_OUTCOMES.has(call.OUTCOME)).map((call) => call.CALL_KEY));
  const groups = [];
  const memberKeys = new Set();
  const groupKeys = new Set();
  const referenceRegistry = new Map();
  const totals = new Map();
  if (evidence !== null) {
    requireCondition(exactObject(evidence, [
      'schemaVersion', 'methodId', 'methodVersion', 'scope', 'callRowsetDigest', 'review', 'groups',
    ]) && evidence.schemaVersion === 1 && evidence.methodId === METHOD_ID
      && evidence.methodVersion === METHOD_VERSION, 'OPPORTUNITY_EVIDENCE_INVALID');
    validateScope(evidence.scope);
    requireCondition(SCOPE_FIELDS.every((field) => evidence.scope[field] === scope[field]),
      'OPPORTUNITY_SCOPE_CONFLICT');
    requireCondition(evidence.callRowsetDigest === callRowsetDigest, 'OPPORTUNITY_ROWSET_CONFLICT');
    requireCondition(exactObject(evidence.review, ['status', 'reviewedAt', 'reviewerReference'])
      && evidence.review.status === 'reviewed' && validInstant(evidence.review.reviewedAt)
      && Date.parse(evidence.review.reviewedAt) <= now
      && calls.every((call) => call.SOURCE_MODIFIED_AT <= evidence.review.reviewedAt)
      && typeof evidence.review.reviewerReference === 'string'
      && HASH.test(evidence.review.reviewerReference), 'OPPORTUNITY_REVIEW_INVALID');
    requireCondition(Array.isArray(evidence.groups) && evidence.groups.length <= MAX_GROUPS,
      'OPPORTUNITY_GROUP_INVALID');
    for (const group of evidence.groups) {
      requireCondition(exactObject(group, [
        'groupKey', 'callKeys', 'reviewStatus', 'knownJobValue', 'averageJobValue',
      ]) && typeof group.groupKey === 'string' && HASH.test(group.groupKey)
        && !groupKeys.has(group.groupKey) && Array.isArray(group.callKeys)
        && group.callKeys.length > 0 && group.callKeys.length <= calls.length
        && ['qualified', 'incomplete'].includes(group.reviewStatus), 'OPPORTUNITY_GROUP_INVALID');
      groupKeys.add(group.groupKey);
      for (const key of group.callKeys) {
        requireCondition(typeof key === 'string' && qualifying.has(key), 'OPPORTUNITY_MEMBER_INELIGIBLE');
        requireCondition(!memberKeys.has(key), 'OPPORTUNITY_MEMBER_DUPLICATE');
        memberKeys.add(key);
      }
      const known = validateBasis(group.knownJobValue, evidence.review.reviewedAt,
        referenceRegistry, 'contractor_known_job', group.groupKey);
      const average = validateBasis(group.averageJobValue, evidence.review.reviewedAt,
        referenceRegistry, 'contractor_average_job', group.groupKey);
      // Attaching an average to this reviewed group is the explicit applicability
      // decision. There is no global fallback, price-band midpoint or close rate.
      const selected = group.reviewStatus === 'qualified' ? known || average : null;
      const result = {
        groupKey: group.groupKey, callKeys: Object.freeze([...group.callKeys].sort()),
        status: selected ? 'valued' : 'unknown',
        basisType: selected ? (known ? 'contractor_known_job' : 'contractor_average_job') : null,
        amountMinorUnits: selected?.amountMinorUnits ?? null, currency: selected?.currency ?? null,
        unknownReason: selected ? null : (group.reviewStatus === 'incomplete'
          ? 'group_review_incomplete' : 'value_not_available'),
      };
      groups.push(Object.freeze(result));
      if (selected) {
        const current = totals.get(selected.currency) || { currency: selected.currency,
          amountMinorUnits: 0, valuedGroupCount: 0 };
        const amount = current.amountMinorUnits + selected.amountMinorUnits;
        requireCondition(Number.isSafeInteger(amount), 'OPPORTUNITY_TOTAL_OVERFLOW');
        totals.set(selected.currency, { ...current, amountMinorUnits: amount,
          valuedGroupCount: current.valuedGroupCount + 1 });
      }
    }
  }
  const valuedGroupCount = groups.filter((group) => group.status === 'valued').length;
  const unknownGroupCount = groups.length - valuedGroupCount;
  const ungroupedQualifiedCallCount = qualifying.size - memberKeys.size;
  return Object.freeze({
    label: 'Estimated Opportunity Value', methodId: METHOD_ID, methodVersion: METHOD_VERSION,
    status: valuedGroupCount === 0 ? 'not_available'
      : (unknownGroupCount > 0 || ungroupedQualifiedCallCount > 0 ? 'partial' : 'complete'),
    qualifiedCallCount: qualifying.size,
    reviewedGroupCount: evidence === null ? 0
      : evidence.groups.filter((group) => group.reviewStatus === 'qualified').length,
    valuedGroupCount, unknownGroupCount, ungroupedQualifiedCallCount,
    subtotals: Object.freeze([...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency))
      .map((total) => Object.freeze(total))),
    groups: Object.freeze(groups.sort((a, b) => a.groupKey.localeCompare(b.groupKey))),
    limitation: 'An estimate for reviewed opportunities, not lost, booked, recovered, invoiced or collected revenue. Unknown groups and ungrouped calls are excluded from monetary subtotals.',
  });
}

module.exports = { buildOpportunityValue, METHOD_ID, METHOD_VERSION, SCOPE_FIELDS };
