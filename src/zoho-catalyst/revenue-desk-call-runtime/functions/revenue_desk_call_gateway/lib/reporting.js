'use strict';

const { invariant } = require('./errors');
const {
  CONTRACT, COVERAGE_MODE_TO_LABEL, STOP_REASON_TO_CRM, OUTCOMES, COVERAGE_TRIGGERS,
  MVP_REPORT_VALUE_EVIDENCE_CLASSES, MVP_REPORT_VALUE_EVIDENCE_SOURCES,
} = require('./contracts');
const { loadDeployment, assertCanonicalCallIntegrity } = require('./runtime-service');
const { assertOutcomeUrgencyConsistency } = require('./analysis');
const { isPlainObject, E164_PATTERN, MAX_RETELL_CALL_DURATION_MS } = require('./validation');

const DAY_MS = 86_400_000;
const QUALIFIED_OUTCOMES = new Set(['potential_job', 'urgent_potential_job']);
const WRONG_FIT_OUTCOMES = new Set(['unsupported_service', 'out_of_area']);
const URGENT_LEVELS = new Set(['urgent', 'immediate_danger']);

const METRIC_BY_OUTCOME = Object.freeze({
  potential_job: 'potentialJobs', urgent_potential_job: 'urgentPotentialJobs',
  existing_customer: 'existingCustomers', spam: 'spam',
  unsupported_service: 'unsupportedCalls', out_of_area: 'outOfAreaCalls',
  other_general_inquiry: 'otherCalls', unresolved: 'unresolvedCalls',
  configuration_failure: 'unresolvedCalls', caller_abandoned: 'unresolvedCalls',
  sensitive_data_ended: 'otherCalls',
});

function parseCanonical(row) {
  try {
    const value = JSON.parse(row.CANONICAL_CALL_JSON);
    invariant(value && typeof value === 'object' && !Array.isArray(value),
      'REPORT_DATA_INVALID', 'Canonical call report row is invalid.');
    return value;
  } catch (error) {
    if (error.code) throw error;
    invariant(false, 'REPORT_DATA_INVALID', 'Canonical call report row is invalid.');
  }
}

function roundTwo(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function callDurationSeconds(call) {
  const startedAt = typeof call.startedAt === 'string' ? Date.parse(call.startedAt) : Number.NaN;
  invariant(Number.isFinite(startedAt) && new Date(startedAt).toISOString() === call.startedAt,
    'REPORT_DATA_INVALID', 'Canonical call start timestamp is invalid.');
  if (call.endedAt !== null) {
    const endedAt = typeof call.endedAt === 'string' ? Date.parse(call.endedAt) : Number.NaN;
    invariant(Number.isFinite(endedAt) && new Date(endedAt).toISOString() === call.endedAt
      && endedAt >= startedAt,
    'REPORT_DATA_INVALID', 'Canonical call end timestamp is invalid.');
  }
  if (call.schemaVersion === 1) return null;
  invariant(call.schemaVersion === CONTRACT.canonical_call_schema_version,
    'REPORT_DATA_INVALID', 'Canonical call schema version is unsupported.');
  invariant(Number.isSafeInteger(call.durationMs) && call.durationMs >= 0
    && call.durationMs <= MAX_RETELL_CALL_DURATION_MS,
  'REPORT_DATA_INVALID', 'Canonical Retell call duration is invalid.');
  return call.durationMs / 1000;
}

function nullableCanonicalText(value, name, maximum) {
  invariant(value === null || (typeof value === 'string' && value.length >= 1
    && value.length <= maximum && value === value.trim()),
  'REPORT_DATA_INVALID', `Canonical ${name} is invalid.`);
  return value;
}

function persistedValueEvidence(value) {
  invariant(isPlainObject(value), 'REPORT_DATA_INVALID',
    'Canonical value evidence is invalid.');
  const required = ['evidenceClass', 'valueMinorUnits', 'currency', 'methodId', 'methodVersion'];
  const allowed = new Set([...required, 'source']);
  invariant(required.every((field) => Object.hasOwn(value, field))
    && Object.keys(value).every((field) => allowed.has(field)),
  'REPORT_DATA_INVALID', 'Canonical value evidence shape is invalid.');
  const source = Object.hasOwn(value, 'source') ? value.source : null;
  invariant(source === null || MVP_REPORT_VALUE_EVIDENCE_SOURCES.has(source),
    'REPORT_DATA_INVALID', 'Canonical value evidence source is invalid.');
  invariant(MVP_REPORT_VALUE_EVIDENCE_CLASSES.has(value.evidenceClass),
  'REPORT_DATA_INVALID', 'Canonical value evidence is unauthorized for its source.');
  const supplied = value.valueMinorUnits !== null;
  invariant(!supplied || (Number.isSafeInteger(value.valueMinorUnits)
    && value.valueMinorUnits >= 0 && value.valueMinorUnits <= 1_000_000_000),
  'REPORT_DATA_INVALID', 'Canonical value amount is invalid.');
  invariant(value.currency === null || (typeof value.currency === 'string'
    && /^[A-Z]{3}$/.test(value.currency)),
  'REPORT_DATA_INVALID', 'Canonical value currency is invalid.');
  nullableCanonicalText(value.methodId, 'value method ID', 100);
  nullableCanonicalText(value.methodVersion, 'value method version', 100);
  if (value.evidenceClass === 'unknown') {
    invariant(!supplied && value.currency === null && value.methodId === null
      && value.methodVersion === null,
    'REPORT_DATA_INVALID', 'Unknown canonical value evidence carries unsupported detail.');
  } else {
    invariant(supplied && value.currency !== null,
      'REPORT_DATA_INVALID', 'Canonical value evidence lacks amount or currency.');
    invariant(value.methodId === null && value.methodVersion === null,
      'REPORT_DATA_INVALID', 'Canonical value evidence carries an unauthorized method.');
  }
  return Object.freeze({ ...value, source });
}

function structuredReportFields(call) {
  invariant(OUTCOMES.has(call.outcome) && COVERAGE_TRIGGERS.has(call.coverageTrigger),
    'REPORT_DATA_INVALID', 'Canonical outcome or coverage trigger is invalid.');
  for (const [field, maximum] of [
    ['callerName', 120], ['callerIntent', 160], ['issueSummary', 500],
    ['cityOrZip', 120], ['specificPersonRequested', 120],
  ]) nullableCanonicalText(call[field], field, maximum);
  invariant(call.callbackNumber === null || (typeof call.callbackNumber === 'string'
    && E164_PATTERN.test(call.callbackNumber)),
  'REPORT_DATA_INVALID', 'Canonical callback number is invalid.');
  invariant(new Set(['new', 'existing', 'unknown']).has(call.customerType)
    && new Set(['routine', 'urgent', 'immediate_danger', 'unknown']).has(call.urgency),
  'REPORT_DATA_INVALID', 'Canonical customer or urgency classification is invalid.');
  assertOutcomeUrgencyConsistency(call.outcome, call.urgency, 'REPORT_DATA_INVALID');
  const bookableOpportunity = call.bookableOpportunity ?? null;
  const officeFollowUpRequired = call.officeFollowUpRequired ?? null;
  const workflowFailureCode = call.workflowFailureCode ?? null;
  const workflowFailureText = call.workflowFailureText ?? null;
  invariant((bookableOpportunity === null || typeof bookableOpportunity === 'boolean')
    && (officeFollowUpRequired === null || typeof officeFollowUpRequired === 'boolean'),
    'REPORT_DATA_INVALID', 'Canonical report flags are invalid.');
  invariant(workflowFailureCode === null
    || (typeof workflowFailureCode === 'string'
      && /^[a-z][a-z0-9_]{0,63}$/.test(workflowFailureCode)),
  'REPORT_DATA_INVALID', 'Canonical workflow failure code is invalid.');
  invariant(workflowFailureText === null
    || (typeof workflowFailureText === 'string' && workflowFailureText.length <= 240
      && workflowFailureCode !== null),
  'REPORT_DATA_INVALID', 'Canonical workflow failure text is invalid.');
  invariant(bookableOpportunity !== true || QUALIFIED_OUTCOMES.has(call.outcome),
  'REPORT_DATA_INVALID', 'Canonical bookable opportunity conflicts with its outcome.');
  invariant(typeof call.sensitiveDataMinimized === 'boolean',
    'REPORT_DATA_INVALID', 'Canonical sensitive-data state is invalid.');
  invariant(call.sensitiveDataMinimized === (call.outcome === 'sensitive_data_ended'),
    'REPORT_DATA_INVALID', 'Canonical sensitive-data outcome and minimization state conflict.');
  const valueEvidence = persistedValueEvidence(call.value);
  if (call.sensitiveDataMinimized) invariant(call.outcome === 'sensitive_data_ended'
    && call.callerName === null && call.callbackNumber === null && call.callerIntent === null
    && call.issueSummary === null && call.cityOrZip === null
    && call.specificPersonRequested === null && call.customerType === 'unknown'
    && call.urgency === 'unknown' && bookableOpportunity !== true
    && officeFollowUpRequired !== true && workflowFailureCode === null
    && workflowFailureText === null && valueEvidence.evidenceClass === 'unknown',
  'REPORT_DATA_INVALID', 'Canonical minimized call retains unsupported analysis detail.');
  return Object.freeze({
    bookableOpportunity, officeFollowUpRequired, workflowFailureCode, workflowFailureText,
    analysisEvidenceComplete: typeof bookableOpportunity === 'boolean'
      && typeof officeFollowUpRequired === 'boolean',
    valueEvidence,
  });
}

async function queryClientReport(store, config, clientId, deploymentId, asOfMs = Date.now()) {
  invariant(Number.isSafeInteger(asOfMs) && asOfMs >= 0,
    'REPORT_DATA_INVALID', 'Report as-of timestamp is invalid.');
  const deploymentRow = await store.unique(config.tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', deploymentId);
  const deployment = await loadDeployment(store, deploymentRow, config);
  invariant(typeof clientId === 'string' && clientId.length > 0
    && deployment.clientId === clientId,
  'REPORT_OWNERSHIP_CONFLICT', 'Report client does not own the deployment.');
  const callRows = await store.query(config.tables.CANONICAL_CALL_TABLE, 'DEPLOYMENT_ID', deploymentId);
  const notificationRows = await store.query(config.tables.NOTIFICATION_TABLE, 'DEPLOYMENT_ID', deploymentId);
  for (const row of [...callRows, ...notificationRows]) invariant(row.CLIENT_ID === deployment.clientId
    && row.CONFIGURATION_VERSION_ID === deployment.configurationVersionId
    && row.CONFIGURATION_VERSION === deployment.configurationVersion
    && row.ENGAGEMENT_TYPE === deployment.engagementType
    && row.CAPABILITY_PROFILE === deployment.capabilityProfile
    && row.SOURCE_ENVIRONMENT === config.environment,
  'REPORT_OWNERSHIP_CONFLICT', 'Report row crosses deployment ownership.');
  const metrics = {
    totalCallsHandled: callRows.filter((row) => row.HANDLED_RECORDED === true).length,
    potentialJobs: 0, urgentPotentialJobs: 0, existingCustomers: 0, spam: 0,
    unsupportedCalls: 0, outOfAreaCalls: 0, otherCalls: 0, unresolvedCalls: 0,
  };
  const callsByKey = new Map();
  const handledCallKeys = new Set();
  const reportCounts = {
    qualifiedOpportunities: 0,
    existingCustomerCalls: 0,
    outOfAreaOrWrongFitCalls: 0,
    urgentRequests: 0,
    bookableOpportunities: 0,
    officeFollowUpCalls: 0,
    observedWorkflowFailures: 0,
  };
  let handledDurationSeconds = 0;
  let handledDurationCallCount = 0;
  let legacySchemaCallsWithheld = 0;
  let bookableEvidenceComplete = true;
  let officeFollowUpEvidenceComplete = true;
  const calls = callRows.map((row) => {
    invariant(!callsByKey.has(row.CALL_KEY), 'REPORT_RECONCILIATION_REQUIRED',
      'Report contains duplicate call ownership.');
    callsByKey.set(row.CALL_KEY, row);
    const call = assertCanonicalCallIntegrity(row, parseCanonical(row), deployment,
      'REPORT_OWNERSHIP_CONFLICT');
    invariant(row.OUTCOME === call.outcome, 'REPORT_RECONCILIATION_REQUIRED',
      'Durable outcome conflicts with canonical analysis.');
    const { valueEvidence, ...structured } = structuredReportFields(call);
    const durationSeconds = callDurationSeconds(call);
    const legacySchema = call.schemaVersion === 1;
    if (row.HANDLED_RECORDED === true) {
      handledCallKeys.add(row.CALL_KEY);
      if (legacySchema) legacySchemaCallsWithheld += 1;
      const metric = METRIC_BY_OUTCOME[call.outcome] || 'unresolvedCalls';
      metrics[metric] += 1;
      if (durationSeconds !== null) {
        handledDurationSeconds += durationSeconds;
        handledDurationCallCount += 1;
      }
      if (QUALIFIED_OUTCOMES.has(call.outcome)) reportCounts.qualifiedOpportunities += 1;
      if (call.outcome === 'existing_customer') reportCounts.existingCustomerCalls += 1;
      if (WRONG_FIT_OUTCOMES.has(call.outcome)) reportCounts.outOfAreaOrWrongFitCalls += 1;
      if (URGENT_LEVELS.has(call.urgency)) reportCounts.urgentRequests += 1;
      if (structured.bookableOpportunity === null) bookableEvidenceComplete = false;
      else if (structured.bookableOpportunity) reportCounts.bookableOpportunities += 1;
      if (structured.officeFollowUpRequired === null) officeFollowUpEvidenceComplete = false;
      else if (structured.officeFollowUpRequired) reportCounts.officeFollowUpCalls += 1;
      if (structured.workflowFailureCode) reportCounts.observedWorkflowFailures += 1;
    }
    return Object.freeze({
      correlationId: row.CORRELATION_ID,
      callStartedAt: call.startedAt,
      callEndedAt: call.endedAt,
      callDurationSeconds: durationSeconds,
      coverageTrigger: call.coverageTrigger,
      customerType: call.customerType,
      urgency: call.urgency,
      safetyFlag: call.urgency === 'immediate_danger',
      outcome: call.outcome,
      bookableOpportunity: structured.bookableOpportunity,
      officeFollowUpRequired: structured.officeFollowUpRequired,
      workflowFailureCode: structured.workflowFailureCode,
      analysisEvidenceComplete: structured.analysisEvidenceComplete,
      evidenceWithheldReason: legacySchema ? 'legacy_schema_v1'
        : structured.analysisEvidenceComplete ? null : 'structured_analysis_incomplete',
      notificationState: row.NOTIFICATION_STATE,
      valueEvidenceClass: valueEvidence.evidenceClass,
      valueMinorUnits: valueEvidence.valueMinorUnits,
      valueCurrency: valueEvidence.currency,
    });
  }).sort((left, right) => left.callStartedAt.localeCompare(right.callStartedAt));
  invariant(metrics.totalCallsHandled === deployment.handledCount
    && handledCallKeys.size === deployment.countedCallKeys.length
    && deployment.countedCallKeys.every((callKey) => handledCallKeys.has(callKey)),
    'REPORT_RECONCILIATION_REQUIRED', 'Handled-call identities require reconciliation.');
  const notificationStates = {};
  const notificationsByCallKey = new Map();
  for (const row of notificationRows) {
    invariant(!notificationsByCallKey.has(row.CALL_KEY)
      && callsByKey.has(row.CALL_KEY)
      && callsByKey.get(row.CALL_KEY).NOTIFICATION_STATE === row.STATUS,
    'REPORT_RECONCILIATION_REQUIRED', 'Notification state requires reconciliation.');
    notificationsByCallKey.set(row.CALL_KEY, row);
    notificationStates[row.STATUS] = (notificationStates[row.STATUS] || 0) + 1;
  }
  for (const row of callRows) invariant(
    (row.NOTIFICATION_STATE === null || row.NOTIFICATION_STATE === undefined)
      ? !notificationsByCallKey.has(row.CALL_KEY)
      : notificationsByCallKey.has(row.CALL_KEY),
    'REPORT_RECONCILIATION_REQUIRED', 'Call notification state requires reconciliation.',
  );
  const start = Date.parse(deployment.actualStartAt);
  const scheduledEnd = Date.parse(deployment.expiresAt);
  const stoppedAt = deployment.stoppedAt ? Date.parse(deployment.stoppedAt) : null;
  const observationBoundary = stoppedAt === null ? scheduledEnd : Math.min(stoppedAt, scheduledEnd);
  const observationEnd = Math.max(start, Math.min(asOfMs, observationBoundary));
  const observedCalendarDays = (observationEnd - start) / DAY_MS;
  const durationEvidenceComplete = metrics.totalCallsHandled > 0
    && handledDurationCallCount === metrics.totalCallsHandled;
  const structuredAnalysisComplete = metrics.totalCallsHandled > 0
    && bookableEvidenceComplete && officeFollowUpEvidenceComplete;
  const durationWithheldCalls = metrics.totalCallsHandled - handledDurationCallCount;
  const bookableOpportunities = bookableEvidenceComplete
    ? reportCounts.bookableOpportunities : null;
  const officeFollowUpCalls = officeFollowUpEvidenceComplete
    ? reportCounts.officeFollowUpCalls : null;
  const observedConnectedMinutes = handledDurationSeconds / 60;
  const projectionAvailable = durationEvidenceComplete && observedCalendarDays > 0;
  const expectedMonthlyConnectedMinutesMin = projectionAvailable
    ? roundTwo((observedConnectedMinutes / observedCalendarDays)
      * CONTRACT.reporting.monthly_min_calendar_days) : null;
  const expectedMonthlyConnectedMinutesMax = projectionAvailable
    ? roundTwo((observedConnectedMinutes / observedCalendarDays)
      * CONTRACT.reporting.monthly_max_calendar_days) : null;
  const actualAverageCallDurationSeconds = durationEvidenceComplete
    ? roundTwo(handledDurationSeconds / handledDurationCallCount) : null;
  const recommendationEvidence = reportCounts.qualifiedOpportunities
    + reportCounts.existingCustomerCalls
    + (officeFollowUpEvidenceComplete ? reportCounts.officeFollowUpCalls : 0);
  const recommendedPaidCoverage = recommendationEvidence > 0
    ? COVERAGE_MODE_TO_LABEL.get(deployment.coverageMode) : null;
  invariant(recommendedPaidCoverage !== undefined,
    'REPORT_DATA_INVALID', 'Recommended coverage mapping is unavailable.');
  const expiredAtAsOf = asOfMs >= scheduledEnd;
  const testEndReasonInternal = deployment.stopReason
    || (expiredAtAsOf ? 'seven_day_limit_reached' : null);
  const testEndReason = testEndReasonInternal === null
    ? null : STOP_REASON_TO_CRM.get(testEndReasonInternal);
  invariant(testEndReasonInternal === null || testEndReason,
    'REPORT_DATA_INVALID', 'Test end reason mapping is unavailable.');
  const testEnd = deployment.stoppedAt || (expiredAtAsOf ? deployment.expiresAt : null);
  const sourceModifiedAt = new Date(Math.max(...[
    deployment.stoppedAt || deployment.actualStartAt,
    ...callRows.map((row) => row.UPDATED_AT),
    ...notificationRows.map((row) => row.UPDATED_AT),
  ].map((value) => {
    const parsed = Date.parse(value);
    invariant(Number.isFinite(parsed), 'REPORT_DATA_INVALID',
      'Report source watermark is invalid.');
    return parsed;
  }))).toISOString();
  const callsRemaining = Math.max(0, deployment.callLimit - deployment.handledCount);
  const limitReached = deployment.handledCount >= deployment.callLimit;
  const inFlightOvershoot = Math.max(0, deployment.handledCount - deployment.callLimit);
  const testProgress = Math.max(0, Math.min(1, (observationEnd - start) / (scheduledEnd - start)));
  const dataConfidenceNotes = [
    'Counts include only handled calls whose exact call-key set reconciles to the deployment.',
    durationEvidenceComplete
      ? `Duration evidence covers all ${metrics.totalCallsHandled} handled calls and uses Retell's authoritative duration_ms persisted in each canonical call.`
      : `Duration-based results are withheld because ${durationWithheldCalls} of ${metrics.totalCallsHandled} handled calls lack schema-v2 authoritative Retell duration evidence; no legacy duration is inferred.`,
    projectionAvailable
      ? `The connected-minute run-rate uses ${roundTwo(observedConnectedMinutes)} observed minutes across ${roundTwo(observedCalendarDays)} elapsed approved test days.`
      : 'Expected monthly connected minutes are unavailable until duration and elapsed-test evidence are complete.',
    recommendedPaidCoverage
      ? 'Recommended coverage reflects the approved coverage mode tested and requires observed qualified, existing-customer, or office-follow-up evidence.'
      : 'Recommended coverage is withheld because the report has insufficient opportunity or follow-up evidence.',
    structuredAnalysisComplete
      ? 'Bookable-opportunity and office-follow-up evidence is complete for every handled call.'
      : 'Bookable-opportunity and office-follow-up totals are withheld where required because at least one handled call lacks explicit Boolean evidence.',
    legacySchemaCallsWithheld > 0
      ? `${legacySchemaCallsWithheld} handled legacy schema-v1 calls are preserved but marked withheld for unsupported duration or new structured evidence.`
      : 'All handled calls use the current canonical schema.',
    inFlightOvershoot > 0
      ? `${inFlightOvershoot} call(s) are reported as in-flight overshoot admitted before the stored limit became visible; this is not an exact concurrent-admission claim.`
      : 'No in-flight call-limit overshoot is present.',
    'Opportunity value remains source-qualified per call and is not converted into a generic revenue claim.',
  ];
  return Object.freeze({
    schemaVersion: 2,
    clientId: deployment.clientId,
    deploymentId: deployment.deploymentId,
    configurationVersion: deployment.configurationVersion,
    configurationVersionId: deployment.configurationVersionId,
    engagementType: deployment.engagementType,
    capabilityProfile: deployment.capabilityProfile,
    coverageMode: deployment.coverageMode,
    metrics: Object.freeze(metrics),
    notificationStates: Object.freeze(notificationStates),
    handledCallCount: deployment.handledCount,
    callLimit: deployment.callLimit,
    callLimitProgress: deployment.handledCount / deployment.callLimit,
    testStartedAt: deployment.actualStartAt,
    testExpiresAt: deployment.expiresAt,
    testPeriodProgress: testProgress,
    callsCaptured: metrics.totalCallsHandled,
    actualAverageCallDurationSeconds,
    ...reportCounts,
    bookableOpportunities,
    officeFollowUpCalls,
    durationEvidenceComplete,
    structuredAnalysisComplete,
    legacySchemaCallsWithheld,
    durationWithheldCalls,
    recommendedPaidCoverage,
    expectedMonthlyConnectedMinutesMin,
    expectedMonthlyConnectedMinutesMax,
    expectedMonthlyConnectedMinutesMethodology:
      CONTRACT.reporting.monthly_connected_minutes_methodology,
    testStart: deployment.actualStartAt,
    testEnd,
    testEndReason,
    sourceModifiedAt,
    callsRemaining,
    limitReached,
    inFlightOvershoot,
    dataConfidenceNotes: Object.freeze(dataConfidenceNotes),
    calls: Object.freeze(calls),
  });
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value).replaceAll('\r', ' ').replaceAll('\n', ' ')
    .replace(/[\u0000-\u0009\u000B\u000C\u000E-\u001F]/g, ' ');
  // Caller-supplied values are untrusted. Quoting alone does not stop spreadsheet
  // applications from executing cells beginning with a formula sigil.
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function reportToCsv(report) {
  invariant(report && Array.isArray(report.calls), 'REPORT_DATA_INVALID', 'Report is unavailable.');
  const columns = [
    'recordType', 'clientId', 'deploymentId', 'configurationVersionId',
    'configurationVersion', 'engagementType', 'capabilityProfile', 'coverageMode',
    'totalCallsHandled', 'potentialJobs', 'urgentPotentialJobs', 'existingCustomers', 'spam',
    'unsupportedCalls', 'outOfAreaCalls', 'otherCalls', 'unresolvedCalls',
    'notificationStates', 'handledCallCount', 'callLimit', 'callLimitProgress',
    'testStartedAt', 'testExpiresAt', 'testPeriodProgress',
    'callsCaptured', 'actualAverageCallDurationSeconds', 'qualifiedOpportunities',
    'existingCustomerCalls', 'outOfAreaOrWrongFitCalls', 'urgentRequests',
    'bookableOpportunities', 'officeFollowUpCalls', 'observedWorkflowFailures',
    'durationEvidenceComplete', 'structuredAnalysisComplete', 'legacySchemaCallsWithheld',
    'durationWithheldCalls',
    'recommendedPaidCoverage', 'expectedMonthlyConnectedMinutesMin',
    'expectedMonthlyConnectedMinutesMax', 'expectedMonthlyConnectedMinutesMethodology',
    'testStart', 'testEnd', 'testEndReason', 'callsRemaining', 'limitReached',
    'inFlightOvershoot',
    'dataConfidenceNotes',
    'correlationId', 'callStartedAt', 'callEndedAt', 'callDurationSeconds',
    'coverageTrigger', 'customerType', 'urgency', 'safetyFlag', 'outcome',
    'bookableOpportunity', 'officeFollowUpRequired', 'analysisEvidenceComplete',
    'evidenceWithheldReason', 'workflowFailureCode', 'notificationState', 'valueEvidenceClass',
    'valueMinorUnits', 'valueCurrency',
  ];
  const summary = {
    recordType: 'summary', clientId: report.clientId, deploymentId: report.deploymentId,
    configurationVersionId: report.configurationVersionId,
    configurationVersion: report.configurationVersion,
    engagementType: report.engagementType, capabilityProfile: report.capabilityProfile,
    coverageMode: report.coverageMode,
    ...report.metrics,
    notificationStates: JSON.stringify(Object.fromEntries(
      Object.entries(report.notificationStates || {}).sort(([left], [right]) => left.localeCompare(right)),
    )),
    handledCallCount: report.handledCallCount, callLimit: report.callLimit,
    callLimitProgress: report.callLimitProgress, testStartedAt: report.testStartedAt,
    testExpiresAt: report.testExpiresAt, testPeriodProgress: report.testPeriodProgress,
    callsCaptured: report.callsCaptured,
    actualAverageCallDurationSeconds: report.actualAverageCallDurationSeconds,
    qualifiedOpportunities: report.qualifiedOpportunities,
    existingCustomerCalls: report.existingCustomerCalls,
    outOfAreaOrWrongFitCalls: report.outOfAreaOrWrongFitCalls,
    urgentRequests: report.urgentRequests,
    bookableOpportunities: report.bookableOpportunities,
    officeFollowUpCalls: report.officeFollowUpCalls,
    observedWorkflowFailures: report.observedWorkflowFailures,
    durationEvidenceComplete: report.durationEvidenceComplete,
    structuredAnalysisComplete: report.structuredAnalysisComplete,
    legacySchemaCallsWithheld: report.legacySchemaCallsWithheld,
    durationWithheldCalls: report.durationWithheldCalls,
    recommendedPaidCoverage: report.recommendedPaidCoverage,
    expectedMonthlyConnectedMinutesMin: report.expectedMonthlyConnectedMinutesMin,
    expectedMonthlyConnectedMinutesMax: report.expectedMonthlyConnectedMinutesMax,
    expectedMonthlyConnectedMinutesMethodology: report.expectedMonthlyConnectedMinutesMethodology,
    testStart: report.testStart, testEnd: report.testEnd, testEndReason: report.testEndReason,
    callsRemaining: report.callsRemaining, limitReached: report.limitReached,
    inFlightOvershoot: report.inFlightOvershoot,
    dataConfidenceNotes: JSON.stringify(report.dataConfidenceNotes || []),
  };
  const calls = report.calls.map((call) => ({
    recordType: 'call', clientId: report.clientId, deploymentId: report.deploymentId,
    configurationVersionId: report.configurationVersionId,
    configurationVersion: report.configurationVersion,
    engagementType: report.engagementType, capabilityProfile: report.capabilityProfile, ...call,
  }));
  return [columns.join(','), summary, ...calls]
    .map((row) => typeof row === 'string' ? row : columns.map((column) => csvCell(row[column])).join(','))
    .join('\r\n');
}

module.exports = { queryClientReport, reportToCsv, csvCell };
