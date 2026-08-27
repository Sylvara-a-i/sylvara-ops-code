"use strict";

const {
  DEVELOPMENT_COMPATIBILITY_PROBE_CASES,
} = require("./action-contract");
const { parseReportSummary, reportSummaryPatch } = require("./report-summary");

const [V1_NON_NULL_CASE, V2_NULL_CASE] = DEVELOPMENT_COMPATIBILITY_PROBE_CASES;

function syntheticSummary(selectedCase) {
  const schemaVersion = selectedCase === V1_NON_NULL_CASE ? 1 : 2;
  const observedWorkflowFailures = schemaVersion === 1 ? 2 : null;
  return Object.freeze({
    schemaVersion,
    dealId: "99999999",
    deploymentId: "synthetic-development-probe",
    configurationVersion: "synthetic-contract-v1",
    reportSchemaVersion: 2,
    callSetDigest: "0".repeat(64),
    testStatus: "Completed",
    testStartAt: "2026-08-01T00:00:00.000Z",
    testEndAt: "2026-08-02T00:00:00.000Z",
    testEndReason: "Seven-Day Limit Reached",
    callTotalsReconciled: true,
    callsCaptured: 3,
    qualifiedOpportunities: 1,
    existingCustomerCalls: 1,
    actualAverageCallDurationSeconds: 42,
    outOfAreaOrWrongFitCalls: 0,
    urgentRequests: 0,
    bookableOpportunities: 1,
    officeFollowUpCalls: 1,
    observedWorkflowFailures,
    recommendedPaidCoverage: "After Hours + Overflow",
    expectedMonthlyConnectedMinutesMin: 10,
    expectedMonthlyConnectedMinutesMax: 20,
    dataConfidenceNotes: "Synthetic Development compatibility probe; no CRM record is accessed.",
  });
}

function runDevelopmentCompatibilityProbe(config, selectedCase) {
  if (!DEVELOPMENT_COMPATIBILITY_PROBE_CASES.includes(selectedCase)) {
    throw new Error("Unsupported Development compatibility probe case");
  }
  const summary = parseReportSummary(syntheticSummary(selectedCase));
  const patch = reportSummaryPatch(config, summary);
  const expectedMapping = selectedCase === V2_NULL_CASE
    ? null
    : "Observed workflow failure count: 2.";
  if (patch.Test_Observed_Workflow_Failures !== expectedMapping) {
    throw new Error("Report-summary compatibility mapping did not match the expected contract");
  }
  return Object.freeze({
    outcome: "report_summary_contract_validated",
    duplicate: false,
    compatibilityCase: selectedCase,
    reportSummarySchemaVersion: summary.schemaVersion,
    workflowFailureMapping: expectedMapping === null ? "unavailable" : "counted",
  });
}

module.exports = { runDevelopmentCompatibilityProbe };
