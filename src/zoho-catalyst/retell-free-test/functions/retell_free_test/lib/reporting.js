'use strict';

const { invariant } = require('./errors');
const { deploymentFromRow, assertCanonicalCallIntegrity } = require('./runtime-service');

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

async function queryClientReport(store, config, deploymentId, asOfMs = Date.now()) {
  const deploymentRow = await store.unique(config.tables.DEPLOYMENT_TABLE, 'DEPLOYMENT_ID', deploymentId);
  const deployment = deploymentFromRow(deploymentRow, config);
  const callRows = await store.query(config.tables.CANONICAL_CALL_TABLE, 'DEPLOYMENT_ID', deploymentId);
  const notificationRows = await store.query(config.tables.NOTIFICATION_TABLE, 'DEPLOYMENT_ID', deploymentId);
  for (const row of [...callRows, ...notificationRows]) invariant(row.CLIENT_ID === deployment.clientId
    && row.CONFIGURATION_VERSION === deployment.configurationVersion
    && row.SOURCE_ENVIRONMENT === 'development',
  'REPORT_OWNERSHIP_CONFLICT', 'Report row crosses deployment ownership.');
  const metrics = {
    totalCallsHandled: callRows.filter((row) => row.HANDLED_RECORDED === true).length,
    potentialJobs: 0, urgentPotentialJobs: 0, existingCustomers: 0, spam: 0,
    unsupportedCalls: 0, outOfAreaCalls: 0, otherCalls: 0, unresolvedCalls: 0,
  };
  const calls = callRows.map((row) => {
    const call = assertCanonicalCallIntegrity(row, parseCanonical(row), deployment,
      'REPORT_OWNERSHIP_CONFLICT');
    if (row.HANDLED_RECORDED === true) {
      const metric = METRIC_BY_OUTCOME[call.outcome] || 'unresolvedCalls';
      metrics[metric] += 1;
    }
    return Object.freeze({
      correlationId: row.CORRELATION_ID,
      callStartedAt: call.startedAt,
      callEndedAt: call.endedAt,
      coverageTrigger: call.coverageTrigger,
      callerName: call.callerName,
      callbackNumber: call.callbackNumber,
      customerType: call.customerType,
      cityOrZip: call.cityOrZip,
      issueSummary: call.issueSummary,
      urgency: call.urgency,
      safetyFlag: call.urgency === 'immediate_danger',
      specificPersonRequested: call.specificPersonRequested,
      outcome: call.outcome,
      notificationState: row.NOTIFICATION_STATE,
      valueEvidenceClass: call.value?.evidenceClass || 'unknown',
      valueMinorUnits: call.value?.valueMinorUnits ?? null,
      valueCurrency: call.value?.currency ?? null,
    });
  }).sort((left, right) => left.callStartedAt.localeCompare(right.callStartedAt));
  const notificationStates = {};
  for (const row of notificationRows) notificationStates[row.STATUS] = (notificationStates[row.STATUS] || 0) + 1;
  const start = Date.parse(deployment.actualStartAt);
  const end = Date.parse(deployment.expiresAt);
  const testProgress = Math.max(0, Math.min(1, (asOfMs - start) / (end - start)));
  return Object.freeze({
    schemaVersion: 1,
    clientId: deployment.clientId,
    deploymentId: deployment.deploymentId,
    configurationVersion: deployment.configurationVersion,
    coverageMode: deployment.coverageMode,
    metrics: Object.freeze(metrics),
    notificationStates: Object.freeze(notificationStates),
    handledCallCount: deployment.handledCount,
    callLimit: deployment.callLimit,
    callLimitProgress: deployment.handledCount / deployment.callLimit,
    testStartedAt: deployment.actualStartAt,
    testExpiresAt: deployment.expiresAt,
    testPeriodProgress: testProgress,
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
    'correlationId', 'callStartedAt', 'callEndedAt', 'coverageTrigger', 'callerName',
    'callbackNumber', 'customerType', 'cityOrZip', 'issueSummary', 'urgency', 'safetyFlag',
    'specificPersonRequested', 'outcome', 'notificationState', 'valueEvidenceClass',
    'valueMinorUnits', 'valueCurrency',
  ];
  return [columns.join(','), ...report.calls.map((call) => columns.map((column) => csvCell(call[column])).join(','))]
    .join('\r\n');
}

module.exports = { queryClientReport, reportToCsv, csvCell };
