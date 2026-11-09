"use strict";
const { createExpiryClosure, PRESERVED, digest } = require("../lib/expiry-closure");
const defaultConfig = { deploymentEnvironment: "development", sourceRevision: "a".repeat(40),
  analyticsPartitionSecret: "synthetic-only".repeat(3), testCompletedStatusValue: "Completed", reportMutableStageValue: "Test Live" };
function fixture() {
  const config = { ...defaultConfig };
  const retired = { DEPLOYMENT_ID: "synthetic_a", ACTIVE_CONFIGURATION_VERSION_ID: "approved_v1",
    TEST_STATUS: "Completed", STOP_REASON: "seven_day_limit_reached", CALL_LIMIT: 25, HANDLED_COUNT: 2, COUNT_VERSION: 20,
    ACTUAL_START_AT: "2026-09-01T00:00:00.246Z", EXPIRES_AT: "2026-09-08T00:00:00.246Z", STOPPED_AT: "2026-09-08T00:00:00.246Z",
    REPORT_RECONCILIATION_STATUS: "Pending", REPORT_VERSION: 1 };
  const deal = { ...Object.fromEntries(PRESERVED.map(key => [key, null])), id: "10000001",
    Deal_Name: "ZZZ SYNTHETIC Expiry", Modified_Time: "2026-09-08T00:01:00+00:00", Account_Name: { id: "10000002" },
    Contact_Name: { id: "10000003" }, Intake_Submission_ID: "synthetic_journey", Pipeline: "Revenue Desk", Stage: "Test Live",
    Entry_Offer: "7-Day Revenue Leak Test", Type: "New Business", Deployment_Record_ID: "synthetic_a", Approved_Deployment_Record_ID: "synthetic_a",
    Configuration_Version: "v1", Approved_Configuration_Version: "approved_v1", Test_Status: "Live",
    Test_Start_At: "2026-09-01T00:00:00+00:00", Test_End_At: null, Test_End_Reason: null,
    QA_Passed: false, Go_Live_Approval_Status: "Approved", Call_Totals_Reconciled: false,
    Test_Data_Confidence_Notes: "Historical failure and unresolved admissions retained." };
  const account = { id: "10000002", Account_Name: "ZZZ SYNTHETIC Account", Modified_Time: "2026-08-31T00:00:00+00:00" };
  const binding = { dealId: deal.id, accountId: account.id, deploymentId: "synthetic_a", configurationVersion: "v1", approvedConfiguration: "approved_v1",
    contactId: "10000003", journeyId: "synthetic_journey" };
  const policy = { schemaVersion: 1, enabled: true, dealId: deal.id, binding, expectedStageApiValue: config.reportMutableStageValue,
    sourceRevision: config.sourceRevision, metadataSha256: "b".repeat(64), beforeDealSha256: digest(deal),
    beforeAccountSha256: digest(account), retiredDeploymentSha256: digest(retired), reportCompatibilityQualified: true,
    reportCompatibilitySha256: "c".repeat(64), nativeTransportSha256: "d".repeat(64), authorityReference: "synthetic-expiry-authority" };
  const rows = new Map(); const counts = { crmGets: 0, crmPuts: 0, inserts: 0, reads: 0, retiredReads: 0 };
  const hooks = {};
  const store = { expiryClosureTransportQualified: true, async assertExpiryClosureTransport(pin) { return pin === "d".repeat(64); },
    async insertExpiryClosure(row) {
    counts.inserts += 1; if (rows.has(row.OPERATION_KEY)) return { inserted: false };
    rows.set(row.OPERATION_KEY, { ...structuredClone(row), ROWID: String(rows.size + 1) });
    if (hooks.insert) return hooks.insert(row, counts.inserts);
    return { inserted: true };
  }, async readByKey(key) { counts.reads += 1; return structuredClone(rows.get(key)); } };
  const client = { async getExpiryClosureContext() {
    counts.crmGets += 1; hooks.read?.(counts.crmGets, { deal, account }); return structuredClone({ deal, account });
  }, async updateDealExpiryClosure(_before, patch) {
    counts.crmPuts += 1;
    if (hooks.write) return hooks.write(patch);
    Object.assign(deal, patch, { Modified_Time: "2026-09-08T00:05:00+00:00" });
  } };
  return { config, retired, deal, account, binding, policy, rows, counts, hooks, store, client,
    service() { return createExpiryClosure({ config, policy, operationStore: store, crmClient: client,
      readRetiredDeployment: async () => { counts.retiredReads += 1; hooks.retired?.(counts.retiredReads); return structuredClone(retired); },
      now: () => Date.parse("2026-09-08T00:05:00.000Z") }); } };
}
module.exports = { fixture, config: defaultConfig };
