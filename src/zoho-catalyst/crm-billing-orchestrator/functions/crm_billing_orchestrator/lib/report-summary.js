"use strict";

const crypto = require("node:crypto");

const REPORT_SUMMARY_ACTION = "sync_report_summary";
const REPORT_SUMMARY_DOMAIN = "sylvara.crm-report-summary.v1";
const REPORT_SUMMARY_SCHEMA_VERSION = 1;
const HASH = /^[a-f0-9]{64}$/;
const RECORD_ID = /^[1-9][0-9]{7,29}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const END_REASONS = new Set([
  "Seven-Day Limit Reached", "Call Limit Reached", "Client Requested Stop",
  "Sylvara Stopped", "Technical Failure", "Converted Early", "Other",
]);
const SUMMARY_FIELDS = Object.freeze([
  "schemaVersion", "dealId", "deploymentId", "configurationVersion", "reportSchemaVersion",
  "callSetDigest", "testStatus", "testStartAt", "testEndAt", "testEndReason",
  "callTotalsReconciled", "callsCaptured", "qualifiedOpportunities",
  "existingCustomerCalls",
  "actualAverageCallDurationSeconds", "outOfAreaOrWrongFitCalls", "urgentRequests",
  "bookableOpportunities", "officeFollowUpCalls", "observedWorkflowFailures",
  "recommendedPaidCoverage", "expectedMonthlyConnectedMinutesMin",
  "expectedMonthlyConnectedMinutesMax", "dataConfidenceNotes",
]);

class ReportSummaryError extends Error {
  constructor(message, { ambiguous = false, publicCode = "lifecycle_state_invalid", status = 409 } = {}) {
    super(message);
    this.name = "ReportSummaryError";
    this.ambiguous = ambiguous;
    this.publicCode = publicCode;
    this.status = status;
  }
}

function fail(message, options) {
  throw new ReportSummaryError(message, options);
}

function hmac(secret, purpose, material) {
  return crypto.createHmac("sha256", secret)
    .update(`${REPORT_SUMMARY_DOMAIN}\0${purpose}\0${material}`)
    .digest("hex");
}

function canonicalSummary(summary) {
  const keys = summary && typeof summary === "object" && !Array.isArray(summary)
    ? Object.keys(summary) : [];
  if (keys.length !== SUMMARY_FIELDS.length
    || !SUMMARY_FIELDS.every((field, index) => keys[index] === field)) {
    fail("CRM report summary fields are invalid");
  }
  return JSON.stringify(SUMMARY_FIELDS.map((field) => [field, summary[field]]));
}

function count(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name} is invalid`);
  return value;
}

function nullableNumber(value, name) {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    fail(`${name} is invalid`);
  }
  return value;
}

function parseReportSummary(value) {
  let summary;
  try {
    summary = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    fail("CRM report summary payload is invalid");
  }
  canonicalSummary(summary);
  if (summary.schemaVersion !== REPORT_SUMMARY_SCHEMA_VERSION
    || summary.reportSchemaVersion !== 2
    || !RECORD_ID.test(summary.dealId)
    || !IDENTIFIER.test(summary.deploymentId)
    || !IDENTIFIER.test(summary.configurationVersion)
    || !HASH.test(summary.callSetDigest)
    || summary.testStatus !== "Completed"
    || !TIMESTAMP.test(summary.testStartAt)
    || !TIMESTAMP.test(summary.testEndAt)
    || Date.parse(summary.testEndAt) < Date.parse(summary.testStartAt)
    || !END_REASONS.has(summary.testEndReason)
    || summary.callTotalsReconciled !== true) fail("CRM report summary identity is invalid");
  for (const [name, candidate] of [
    ["callsCaptured", summary.callsCaptured],
    ["qualifiedOpportunities", summary.qualifiedOpportunities],
    ["existingCustomerCalls", summary.existingCustomerCalls],
    ["outOfAreaOrWrongFitCalls", summary.outOfAreaOrWrongFitCalls],
    ["urgentRequests", summary.urgentRequests],
    ["observedWorkflowFailures", summary.observedWorkflowFailures],
  ]) count(candidate, name);
  for (const [name, candidate] of [
    ["actualAverageCallDurationSeconds", summary.actualAverageCallDurationSeconds],
    ["bookableOpportunities", summary.bookableOpportunities],
    ["officeFollowUpCalls", summary.officeFollowUpCalls],
    ["expectedMonthlyConnectedMinutesMin", summary.expectedMonthlyConnectedMinutesMin],
    ["expectedMonthlyConnectedMinutesMax", summary.expectedMonthlyConnectedMinutesMax],
  ]) nullableNumber(candidate, name);
  const minutesMin = summary.expectedMonthlyConnectedMinutesMin;
  const minutesMax = summary.expectedMonthlyConnectedMinutesMax;
  if ((minutesMin === null) !== (minutesMax === null)
    || (minutesMin !== null && minutesMin > minutesMax)) {
    fail("Expected monthly connected-minute bounds are invalid");
  }
  if (summary.recommendedPaidCoverage !== null
    && !new Set(["After Hours Only", "No Answer / Overflow Only", "After Hours + Overflow"])
      .has(summary.recommendedPaidCoverage)) fail("Recommended paid coverage is invalid");
  if (typeof summary.dataConfidenceNotes !== "string"
    || !summary.dataConfidenceNotes || summary.dataConfidenceNotes.length > 2000
    || Buffer.byteLength(summary.dataConfidenceNotes, "utf8") > 2000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(summary.dataConfidenceNotes)) {
    fail("CRM report confidence evidence is invalid");
  }
  return Object.freeze({ ...summary });
}

function reportSummaryOperationKey(config, summary) {
  const revisionDigest = hmac(
    config.analyticsPartitionSecret, "report-revision", canonicalSummary(summary),
  );
  const stable = [config.deploymentEnvironment, summary.dealId, summary.deploymentId,
    summary.configurationVersion, summary.reportSchemaVersion, summary.callSetDigest,
    revisionDigest, REPORT_SUMMARY_ACTION].join("\0");
  return hmac(config.analyticsPartitionSecret, "operation", stable);
}

function reportSummaryIdentity(config, summary) {
  const canonical = canonicalSummary(summary);
  const revisionDigest = hmac(config.analyticsPartitionSecret, "report-revision", canonical);
  const stable = [config.deploymentEnvironment, summary.dealId, summary.deploymentId,
    summary.configurationVersion, summary.reportSchemaVersion, summary.callSetDigest,
    revisionDigest, REPORT_SUMMARY_ACTION].join("\0");
  return Object.freeze({
    operationKey: reportSummaryOperationKey(config, summary),
    reportRevisionDigest: revisionDigest,
    operationFingerprint: hmac(
      config.analyticsPartitionSecret,
      "fingerprint",
      `${stable}\0${canonical}`,
    ),
  });
}

function validateReportOperation(config, operation, dealId) {
  const summary = parseReportSummary(operation?.OPERATION_PAYLOAD_JSON);
  const identity = reportSummaryIdentity(config, summary);
  if (!operation || operation.OPERATION_KEY !== identity.operationKey
    || operation.OPERATION_FINGERPRINT !== identity.operationFingerprint
    || operation.ACTION !== REPORT_SUMMARY_ACTION
    || String(operation.CRM_DEAL_ID ?? "") !== dealId
    || summary.dealId !== dealId
    || operation.SOURCE_ENVIRONMENT !== config.deploymentEnvironment
    || !/^[a-f0-9]{40}$/.test(String(operation.SOURCE_REVISION ?? ""))) {
    fail("CRM report operation identity is invalid", {
      ambiguous: true, publicCode: "reconciliation_required", status: 503,
    });
  }
  return Object.freeze({ summary, identity });
}

function reportSummaryPatch(config, summary) {
  const boundedInteger = (value, mode = "round") => {
    if (value === null) return null;
    const normalized = mode === "floor" ? Math.floor(value)
      : mode === "ceil" ? Math.ceil(value) : Math.round(value);
    if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > 999999999) {
      fail("CRM report integer is outside the verified field bound");
    }
    return normalized;
  };
  const normalizedMinutesMin = boundedInteger(
    summary.expectedMonthlyConnectedMinutesMin, "floor",
  );
  const normalizedMinutesMax = boundedInteger(
    summary.expectedMonthlyConnectedMinutesMax, "ceil",
  );
  if ((normalizedMinutesMin === null) !== (normalizedMinutesMax === null)
    || (normalizedMinutesMin !== null && normalizedMinutesMin > normalizedMinutesMax)) {
    fail("Normalized monthly connected-minute bounds are invalid");
  }
  return Object.freeze({
    Test_Status: config.testCompletedStatusValue,
    Test_Start_At: summary.testStartAt,
    Test_End_At: summary.testEndAt,
    Test_End_Reason: summary.testEndReason,
    Call_Totals_Reconciled: true,
    Test_Calls_Reaching_Route: boundedInteger(summary.callsCaptured),
    Test_Qualified_Opportunities: boundedInteger(summary.qualifiedOpportunities),
    Test_Existing_Customer_Calls: boundedInteger(summary.existingCustomerCalls),
    // The verified CRM fields are integers. Average duration uses nearest-second
    // rounding; range bounds round outward so normalization never narrows evidence.
    Test_Actual_Avg_Call_Duration_Seconds: boundedInteger(
      summary.actualAverageCallDurationSeconds,
    ),
    Test_Out_Of_Area_Or_Wrong_Fit_Calls: boundedInteger(summary.outOfAreaOrWrongFitCalls),
    Test_Urgent_Requests: boundedInteger(summary.urgentRequests),
    Test_Bookable_Opportunities: boundedInteger(summary.bookableOpportunities),
    Test_Office_Follow_Up_Calls: boundedInteger(summary.officeFollowUpCalls),
    Test_Observed_Workflow_Failures:
      `Observed workflow failure count: ${boundedInteger(summary.observedWorkflowFailures)}.`,
    Recommended_Paid_Coverage: summary.recommendedPaidCoverage,
    Expected_Monthly_Connected_Minutes_Min: normalizedMinutesMin,
    Expected_Monthly_Connected_Minutes_Max: normalizedMinutesMax,
    Test_Data_Confidence_Notes: summary.dataConfidenceNotes,
  });
}

module.exports = {
  REPORT_SUMMARY_ACTION,
  REPORT_SUMMARY_DOMAIN,
  REPORT_SUMMARY_SCHEMA_VERSION,
  SUMMARY_FIELDS,
  ReportSummaryError,
  canonicalSummary,
  parseReportSummary,
  reportSummaryIdentity,
  reportSummaryOperationKey,
  reportSummaryPatch,
  validateReportOperation,
};
