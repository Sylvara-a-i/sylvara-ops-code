'use strict';

const crypto = require('node:crypto');
const { invariant } = require('./errors');
const { MAX_CATALYST_TEXT_BYTES } = require('./catalyst-store');

const REPORT_SUMMARY_ACTION = 'sync_report_summary';
const REPORT_SUMMARY_SCHEMA_VERSION = 3;
const REPORT_SUMMARY_DOMAIN = 'sylvara.crm-report-summary.v3';
const REPORT_SUMMARY_DOMAINS = Object.freeze({
  1: 'sylvara.crm-report-summary.v1',
  2: 'sylvara.crm-report-summary.v2',
  3: REPORT_SUMMARY_DOMAIN,
});
const MAX_REPORT_SOURCE_VERSIONS = 100;
const CRM_RECORD_ID = /^[1-9][0-9]{7,29}$/;
const HASH = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const SUMMARY_FIELDS = Object.freeze([
  'schemaVersion', 'dealId', 'deploymentId', 'configurationVersion', 'reportSchemaVersion',
  'callSetDigest', 'testStatus', 'testStartAt', 'testEndAt', 'testEndReason',
  'callTotalsReconciled', 'callsCaptured', 'qualifiedOpportunities',
  'existingCustomerCalls',
  'actualAverageCallDurationSeconds', 'outOfAreaOrWrongFitCalls', 'urgentRequests',
  'bookableOpportunities', 'officeFollowUpCalls', 'observedWorkflowFailures',
  'recommendedPaidCoverage', 'expectedMonthlyConnectedMinutesMin',
  'expectedMonthlyConnectedMinutesMax', 'dataConfidenceNotes',
  'sourceVersions',
]);
const LEGACY_SUMMARY_FIELDS = Object.freeze(SUMMARY_FIELDS.slice(0, -1));

function validateSourceVersions(value) {
  invariant(Array.isArray(value) && value.length <= MAX_REPORT_SOURCE_VERSIONS,
    'REPORT_DATA_INVALID', 'CRM report source version evidence is invalid.');
  let previous = '';
  const result = value.map((entry) => {
    invariant(Array.isArray(entry) && entry.length === 2
      && typeof entry[0] === 'string' && /^c:[a-f0-9]{64}$/.test(entry[0])
      && entry[0] > previous && Number.isSafeInteger(entry[1]) && entry[1] > 0,
    'REPORT_DATA_INVALID', 'CRM report source version evidence is invalid.');
    previous = entry[0];
    return Object.freeze([entry[0], entry[1]]);
  });
  return Object.freeze(result);
}

function hmac(secret, purpose, material, schemaVersion = REPORT_SUMMARY_SCHEMA_VERSION) {
  invariant(Number.isSafeInteger(schemaVersion) && Object.hasOwn(REPORT_SUMMARY_DOMAINS, schemaVersion),
    'REPORT_DATA_INVALID', 'CRM report summary schema is invalid.');
  return crypto.createHmac('sha256', secret)
    .update(`${REPORT_SUMMARY_DOMAINS[schemaVersion]}\0${purpose}\0${material}`)
    .digest('hex');
}

function canonicalSummary(summary) {
  invariant(summary && typeof summary === 'object' && !Array.isArray(summary),
    'REPORT_DATA_INVALID', 'CRM report summary is invalid.');
  invariant(Number.isSafeInteger(summary.schemaVersion)
    && Object.hasOwn(REPORT_SUMMARY_DOMAINS, summary.schemaVersion),
  'REPORT_DATA_INVALID', 'CRM report summary schema is invalid.');
  // Retained v1/v2 operations must keep their original identity for dispatch
  // and reconciliation. Only the builder below may generate a new summary,
  // and it always emits v3; legacy identity support is not a migration write.
  const fields = summary.schemaVersion === 3 ? SUMMARY_FIELDS : LEGACY_SUMMARY_FIELDS;
  const keys = Object.keys(summary);
  invariant(keys.length === fields.length
    && fields.every((field, index) => keys[index] === field),
  'REPORT_DATA_INVALID', 'CRM report summary fields are invalid.');
  if (summary.schemaVersion === 3) validateSourceVersions(summary.sourceVersions);
  return JSON.stringify(fields.map((field) => [field, summary[field]]));
}

function nullableNumber(value, name) {
  invariant(value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0),
    'REPORT_DATA_INVALID', `${name} is invalid.`);
  return value;
}

function nullableCount(value, name) {
  invariant(value === null || (Number.isSafeInteger(value) && value >= 0),
    'REPORT_DATA_INVALID', `${name} is invalid.`);
  return value;
}

function buildCrmReportSummary(config, deployment, report) {
  invariant(deployment.engagementType === 'free_test'
    && CRM_RECORD_ID.test(deployment.crmDealId)
    && IDENTIFIER.test(deployment.deploymentId)
    && IDENTIFIER.test(deployment.configurationVersion),
  'REPORT_DATA_INVALID', 'Terminal report CRM ownership is invalid.');
  invariant(report && report.schemaVersion === 2
    && report.deploymentId === deployment.deploymentId
    && report.configurationVersion === deployment.configurationVersion
    && typeof report.testStart === 'string'
    && typeof report.testEnd === 'string'
    && typeof report.testEndReason === 'string'
    && report.callLimit >= 1
    && report.handledCallCount === deployment.handledCount,
  'REPORT_RECONCILIATION_REQUIRED', 'Terminal report is incomplete.');
  const countedCallKeys = [...deployment.countedCallKeys].sort();
  invariant(countedCallKeys.length === report.handledCallCount,
    'REPORT_RECONCILIATION_REQUIRED', 'Terminal report call identities are incomplete.');
  const callSetDigest = hmac(
    config.analyticsPartitionSecret,
    'call-set',
    JSON.stringify(countedCallKeys),
  );
  const confidence = report.dataConfidenceNotes.join(' | ');
  invariant(confidence.length <= 2000 && Buffer.byteLength(confidence, 'utf8') <= 2000,
    'REPORT_DATA_INVALID', 'CRM confidence evidence exceeds its approved bound.');
  const minutesMin = nullableNumber(
    report.expectedMonthlyConnectedMinutesMin, 'expectedMonthlyConnectedMinutesMin',
  );
  const minutesMax = nullableNumber(
    report.expectedMonthlyConnectedMinutesMax, 'expectedMonthlyConnectedMinutesMax',
  );
  invariant((minutesMin === null) === (minutesMax === null)
    && (minutesMin === null || minutesMin <= minutesMax),
  'REPORT_DATA_INVALID', 'Expected monthly connected-minute bounds are invalid.');
  const sourceVersions = validateSourceVersions(report.sourceVersions);
  invariant(sourceVersions.length === report.callsCaptured
    && sourceVersions.length === report.handledCallCount
    && sourceVersions.every(([key], index) => `call_${key.slice(2)}` === countedCallKeys[index]),
  'REPORT_RECONCILIATION_REQUIRED', 'CRM report source version evidence is incomplete.');
  return Object.freeze({
    schemaVersion: REPORT_SUMMARY_SCHEMA_VERSION,
    dealId: deployment.crmDealId,
    deploymentId: deployment.deploymentId,
    configurationVersion: deployment.configurationVersion,
    reportSchemaVersion: report.schemaVersion,
    callSetDigest,
    testStatus: 'Completed',
    testStartAt: report.testStart,
    testEndAt: report.testEnd,
    testEndReason: report.testEndReason,
    callTotalsReconciled: true,
    callsCaptured: report.callsCaptured,
    qualifiedOpportunities: report.qualifiedOpportunities,
    existingCustomerCalls: report.existingCustomerCalls,
    actualAverageCallDurationSeconds: nullableNumber(
      report.actualAverageCallDurationSeconds, 'actualAverageCallDurationSeconds',
    ),
    outOfAreaOrWrongFitCalls: report.outOfAreaOrWrongFitCalls,
    urgentRequests: report.urgentRequests,
    bookableOpportunities: nullableNumber(report.bookableOpportunities, 'bookableOpportunities'),
    officeFollowUpCalls: nullableNumber(report.officeFollowUpCalls, 'officeFollowUpCalls'),
    observedWorkflowFailures: nullableCount(
      report.observedWorkflowFailures, 'observedWorkflowFailures',
    ),
    recommendedPaidCoverage: report.recommendedPaidCoverage,
    expectedMonthlyConnectedMinutesMin: minutesMin,
    expectedMonthlyConnectedMinutesMax: minutesMax,
    dataConfidenceNotes: confidence,
    // The CRM projection derives only from handled calls. Its revision vector
    // binds that exact copied cohort, not unrelated unsuccessful attempts or
    // notification rows; the full report still validates and includes both.
    // The consumer can compare revisions without treating a later timestamp or
    // different HMAC as proof that a report supersedes an earlier report.
    sourceVersions,
  });
}

function reportSummaryOperationKey(config, summary) {
  const revisionDigest = hmac(
    config.analyticsPartitionSecret, 'report-revision', canonicalSummary(summary),
    summary.schemaVersion,
  );
  const stable = [config.environment, summary.dealId, summary.deploymentId,
    summary.configurationVersion, summary.reportSchemaVersion, summary.callSetDigest,
    revisionDigest, REPORT_SUMMARY_ACTION].join('\0');
  return hmac(config.analyticsPartitionSecret, 'operation', stable, summary.schemaVersion);
}

function reportSummaryIdentity(config, summary) {
  const canonical = canonicalSummary(summary);
  const revisionDigest = hmac(config.analyticsPartitionSecret, 'report-revision', canonical,
    summary.schemaVersion);
  const stable = [config.environment, summary.dealId, summary.deploymentId,
    summary.configurationVersion, summary.reportSchemaVersion, summary.callSetDigest,
    revisionDigest, REPORT_SUMMARY_ACTION].join('\0');
  return Object.freeze({
    operationKey: reportSummaryOperationKey(config, summary),
    reportRevisionDigest: revisionDigest,
    operationFingerprint: hmac(
      config.analyticsPartitionSecret,
      'fingerprint',
      `${stable}\0${canonical}`,
      summary.schemaVersion,
    ),
  });
}

async function ensureCrmReportSummary(store, config, deployment, report, createdAt) {
  const summary = buildCrmReportSummary(config, deployment, report);
  const identity = reportSummaryIdentity(config, summary);
  const payload = JSON.stringify(summary);
  invariant(HASH.test(identity.operationKey) && HASH.test(identity.operationFingerprint)
    && Buffer.byteLength(payload, 'utf8') <= MAX_CATALYST_TEXT_BYTES,
  'REPORT_DATA_INVALID', 'CRM report operation exceeds its durable contract.');
  const row = {
    OPERATION_KEY: identity.operationKey,
    OPERATION_FINGERPRINT: identity.operationFingerprint,
    ACTION: REPORT_SUMMARY_ACTION,
    CRM_DEAL_ID: summary.dealId,
    STATUS: 'pending',
    SOURCE_REVISION: config.sourceRevision,
    SOURCE_ENVIRONMENT: config.environment,
    LAST_OUTCOME: 'terminal_report_ready',
    OPERATION_PAYLOAD_JSON: payload,
    OPERATION_VERSION: 1,
    CREATED_AT: createdAt,
    UPDATED_AT: createdAt,
  };
  const result = await store.insertUnique(
    config.tables.OPERATION_TABLE,
    'OPERATION_KEY',
    row,
    [
      'OPERATION_KEY', 'OPERATION_FINGERPRINT', 'ACTION', 'CRM_DEAL_ID',
      'SOURCE_ENVIRONMENT', 'OPERATION_PAYLOAD_JSON',
    ],
  );
  return Object.freeze({ ...identity, inserted: result.inserted, status: result.row.STATUS });
}

module.exports = {
  REPORT_SUMMARY_ACTION,
  REPORT_SUMMARY_DOMAIN,
  REPORT_SUMMARY_DOMAINS,
  REPORT_SUMMARY_SCHEMA_VERSION,
  MAX_REPORT_SOURCE_VERSIONS,
  SUMMARY_FIELDS,
  LEGACY_SUMMARY_FIELDS,
  buildCrmReportSummary,
  canonicalSummary,
  ensureCrmReportSummary,
  reportSummaryIdentity,
  reportSummaryOperationKey,
  validateSourceVersions,
};
