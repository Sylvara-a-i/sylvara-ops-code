"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadConfig } = require("../lib/config");
const {
  SUMMARY_FIELDS,
  parseReportSummary,
  reportSummaryIdentity,
  reportSummaryPatch,
} = require("../lib/report-summary");
const { SUMMARY_FIELDS: PRODUCER_SUMMARY_FIELDS } = require(
  "../../../../revenue-desk-call-runtime/functions/revenue_desk_call_gateway/lib/crm-report-outbox",
);
const { REVISION, baseEnvironment } = require("./helpers");

function summary(overrides = {}) {
  return {
    schemaVersion: 1,
    dealId: "100000000000001",
    deploymentId: "deployment_A",
    configurationVersion: "cfg_A_v1",
    reportSchemaVersion: 2,
    callSetDigest: "a".repeat(64),
    testStatus: "Completed",
    testStartAt: "2026-08-21T15:00:00.000Z",
    testEndAt: "2026-08-22T16:00:00.000Z",
    testEndReason: "Call Limit Reached",
    callTotalsReconciled: true,
    callsCaptured: 25,
    qualifiedOpportunities: 8,
    existingCustomerCalls: 4,
    actualAverageCallDurationSeconds: 60.6,
    outOfAreaOrWrongFitCalls: 2,
    urgentRequests: 3,
    bookableOpportunities: 6,
    officeFollowUpCalls: 2,
    observedWorkflowFailures: 1,
    recommendedPaidCoverage: "No Answer / Overflow Only",
    expectedMonthlyConnectedMinutesMin: 100.9,
    expectedMonthlyConnectedMinutesMax: 200.1,
    dataConfidenceNotes: "Synthetic terminal evidence is complete.",
    ...overrides,
  };
}

test("runtime producer and CRM consumer use the same canonical summary fields", () => {
  assert.deepEqual(PRODUCER_SUMMARY_FIELDS, SUMMARY_FIELDS);
});

test("report-summary patch matches verified CRM field families and never fabricates review or Stage", () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const parsed = parseReportSummary(summary());
  const patch = reportSummaryPatch(config, parsed);
  assert.equal(patch.Test_Actual_Avg_Call_Duration_Seconds, 61);
  assert.equal(patch.Test_Calls_Reaching_Route, 25);
  assert.equal(patch.Test_Qualified_Opportunities, 8);
  assert.equal(patch.Test_Existing_Customer_Calls, 4);
  assert.equal(patch.Expected_Monthly_Connected_Minutes_Min, 100);
  assert.equal(patch.Expected_Monthly_Connected_Minutes_Max, 201);
  assert.equal(patch.Test_Observed_Workflow_Failures, "Observed workflow failure count: 1.");
  assert.equal(patch.Recommended_Paid_Coverage, "No Answer / Overflow Only");
  assert.equal(Object.hasOwn(patch, "Stage"), false);
  assert.equal(Object.hasOwn(patch, "Results_Review_At"), false);
  assert.match(reportSummaryIdentity(config, parsed).operationKey, /^[a-f0-9]{64}$/);
});

test("report revision identity changes when classification changes within the same call set", () => {
  const config = loadConfig(baseEnvironment(), { artifactRevision: REVISION });
  const first = parseReportSummary(summary());
  const revised = parseReportSummary(summary({
    qualifiedOpportunities: 7,
    existingCustomerCalls: 5,
  }));
  assert.equal(first.callSetDigest, revised.callSetDigest);
  assert.notEqual(
    reportSummaryIdentity(config, first).operationKey,
    reportSummaryIdentity(config, revised).operationKey,
  );
});

test("report-summary identifiers, confidence text, and paired range bounds fail closed at CRM limits", () => {
  const allowed = "a".repeat(100);
  assert.equal(parseReportSummary(summary({ deploymentId: allowed })).deploymentId.length, 100);
  assert.throws(() => parseReportSummary(summary({ deploymentId: `${allowed}a` })));
  assert.throws(() => parseReportSummary(summary({ configurationVersion: `${allowed}a` })));
  assert.throws(() => parseReportSummary(summary({ dataConfidenceNotes: "é".repeat(1001) })));
  assert.throws(() => parseReportSummary(summary({ expectedMonthlyConnectedMinutesMax: null })));
  assert.throws(() => parseReportSummary(summary({
    expectedMonthlyConnectedMinutesMin: 201,
    expectedMonthlyConnectedMinutesMax: 200,
  })));
});
