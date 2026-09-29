'use strict';

const { isClientCallDetails } = require('../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/reporting');
const { minimizeFact, canonicalJson } = require('../functions/analytics_sync/lib/facts');

function requireCondition(condition, code) {
  if (!condition) { const error = new Error(code); error.code = code; throw error; }
}

/** Join the trusted, in-process canonical reader to already reconciled facts.
 * Analytics deliberately omits request text: its hashes cannot attest that text.
 * Never accept a deserialized JSON adjunct as a substitute for the canonical
 * reader. The store supplied to that reader remains an application trust boundary.
 */
function buildPrivateCallLedger(snapshot, calls, deployment, now) {
  requireCondition(isClientCallDetails(snapshot), 'REPORT_DETAILS_SOURCE_REQUIRED');
  const captured = Date.parse(snapshot.capturedAt);
  requireCondition(Number.isFinite(captured) && captured <= now && now - captured <= 300_000,
    'REPORT_DETAILS_STALE');
  requireCondition(snapshot.clientKey === deployment.CLIENT_KEY
    && snapshot.deploymentKey === deployment.DEPLOYMENT_KEY
    && snapshot.configurationVersionId === deployment.CONFIGURATION_VERSION
    && snapshot.sourceRevision === deployment.SOURCE_REVISION,
  'REPORT_DETAILS_OWNERSHIP_CONFLICT');
  requireCondition(snapshot.rows.length === calls.length, 'REPORT_DETAILS_COHORT_CONFLICT');
  const facts = new Map(calls.map((fact) => [fact.CALL_KEY, fact]));
  const seen = new Set();
  for (const row of snapshot.rows) {
    const fact = minimizeFact('call', row.fact);
    requireCondition(!seen.has(fact.CALL_KEY) && facts.has(fact.CALL_KEY)
      && canonicalJson(fact) === canonicalJson(facts.get(fact.CALL_KEY)),
    'REPORT_DETAILS_ROWSET_CONFLICT');
    seen.add(fact.CALL_KEY);
  }
  return Object.freeze(snapshot.rows.slice().sort((left, right) =>
    left.fact.STARTED_AT.localeCompare(right.fact.STARTED_AT)
      || left.fact.CALL_KEY.localeCompare(right.fact.CALL_KEY)).map((row, index) => Object.freeze({
    // Document-local references avoid publishing internal/provider identifiers.
    callReference: `C-${String(index + 1).padStart(4, '0')}`,
    startedAtUtc: row.fact.STARTED_AT, endedAtUtc: row.fact.ENDED_AT ?? null,
    connected: row.fact.HANDLED_RECORDED,
    route: row.fact.COVERAGE_MODE ?? null, trigger: row.coverageTrigger,
    callerIntent: row.callerIntent, issueSummary: row.issueSummary,
    contentWithheld: row.contentWithheld,
    outcome: row.fact.OUTCOME, urgency: row.fact.URGENCY_CLASS ?? null,
    officeFollowUpRequired: row.fact.OFFICE_FOLLOW_UP_REQUIRED ?? null,
    notificationState: row.fact.NOTIFICATION_STATE ?? null,
    // A flag or provider-accepted alert is not evidence of human completion.
    inboxDelivery: null, businessAcknowledgment: null, completedFollowUp: null,
  })));
}

module.exports = { buildPrivateCallLedger };
