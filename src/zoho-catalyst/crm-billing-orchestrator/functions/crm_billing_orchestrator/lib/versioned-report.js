"use strict";

const crypto = require("node:crypto");
const { isReportSummaryPreWrite } = require("./idempotency");
const {
  ReportSummaryError, isNewerReport, reportSummaryPatch, validateReportOperation,
} = require("./report-summary");

const CONFIRMED = "report_summary_readback_confirmed";
const PROTECTED_FIELDS = Object.freeze([
  "Results_Review_At", "Subscription_Acceptance_Status", "Subscription_Accepted_At",
  "Subscription_Acceptance_Version", "Subscription_Start_Date", "Subscription_Status",
  "Billing_Customer_ID", "Billing_Subscription_ID", "Plan",
]);

function fail() {
  throw new ReportSummaryError("Terminal report revision requires reconciliation", {
    ambiguous: true, publicCode: "reconciliation_required", status: 503,
  });
}

function patchMatches(deal, patch) {
  return Object.entries(patch).every(([field, expected]) => (
    expected === null ? Object.hasOwn(deal, field) && deal[field] === null
      : ["Test_Start_At", "Test_End_At"].includes(field)
        ? Number.isFinite(Date.parse(deal[field])) && Date.parse(deal[field]) === Date.parse(expected)
        : deal[field] === expected
  ));
}

/** Serialize terminal revisions without re-opening a test or retrying an unknown write.
 * The guard is per Deal, permanently bound to the first verified Account and
 * deployment. Its confirmed operation is an exact predecessor, not a timestamp.
 */
async function syncVersionedReport({
  config, state, operation, summary, crmClient, operationStore, validateContext, nowIso,
}) {
  const key = operation.OPERATION_KEY;
  const binding = Object.freeze({
    dealId: state.deal.id, accountId: state.accountId,
    deploymentId: summary.deploymentId, configurationVersion: summary.configurationVersion,
  });
  const patch = reportSummaryPatch(config, summary);
  const success = (duplicate) => Object.freeze({ outcome: CONFIRMED, duplicate });
  const sameBinding = (fresh) => fresh.deal.id === binding.dealId
    && fresh.accountId === binding.accountId
    && fresh.deal.Deployment_Record_ID === binding.deploymentId
    && fresh.deal.Configuration_Version === binding.configurationVersion;
  const freshState = async () => {
    const fresh = validateContext(await crmClient.getContext(binding.dealId));
    if (!sameBinding(fresh)) fail();
    return fresh;
  };
  const protectedState = (deal) => !config.reportMutableStageValue
    || deal.Stage !== config.reportMutableStageValue
    || PROTECTED_FIELDS.some((field) => !Object.hasOwn(deal, field) || deal[field] !== null);
  const contain = async (cursor, outcome = "report_summary_readback_required") => {
    // Completed receipts are historical evidence. Failure to prove current
    // supersession must not erase or demote an earlier confirmed outcome.
    if (cursor.STATUS !== "completed") {
      try {
        await operationStore.transitionReportSummary(cursor, "reconciliation_required", outcome, nowIso());
      } catch { /* A lost containment CAS still fails closed; never send again. */ }
    }
    fail();
  };
  const head = async (guard) => {
    if (!guard?.confirmedOperationKey) return null;
    const row = await operationStore.readByKey(guard.confirmedOperationKey);
    const parsed = validateReportOperation(config, row, binding.dealId).summary;
    if (row.STATUS !== "completed" || row.LAST_OUTCOME !== CONFIRMED
      || parsed.schemaVersion !== 3 || parsed.deploymentId !== binding.deploymentId
      || parsed.configurationVersion !== binding.configurationVersion) fail();
    return { row, summary: parsed, patch: reportSummaryPatch(config, parsed) };
  };
  const finish = async (cursor) => {
    if (!patchMatches((await freshState()).deal, patch)) await contain(cursor);
    let completed = cursor;
    if (cursor.STATUS !== "completed") {
      const result = await operationStore.transitionReportSummary(cursor, "completed", CONFIRMED, nowIso());
      if (!result.transitioned) fail();
      completed = result.row;
    }
    if (completed.LAST_OUTCOME !== CONFIRMED) fail();
    // If this CAS/readback is uncertain, the same operation may reconcile; a
    // different operation cannot steal or expire the guard in the meantime.
    const result = await operationStore.completeReportGuard(binding, key, nowIso());
    if (!result.completed) fail();
  };

  let guard = await operationStore.readReportGuard(binding);
  const previous = await head(guard);
  if (operation.STATUS === "completed") {
    const fresh = await freshState();
    if (guard?.inflightOperationKey === key && patchMatches(fresh.deal, patch)) {
      await finish(operation);
      return success(true);
    }
    if (guard?.inflightOperationKey) fail();
    if (previous && patchMatches(fresh.deal, previous.patch)
      && (previous.row.OPERATION_KEY === key || isNewerReport(summary, previous.summary))) {
      return success(true);
    }
    fail();
  }
  const readbackOnly = operation.STATUS === "reconciliation_required"
    || (operation.STATUS === "processing" && !isReportSummaryPreWrite(operation));
  if (readbackOnly) {
    if (guard?.inflightOperationKey !== key) fail();
    await finish(operation);
    return success(true);
  }
  const eligible = (current, currentHead) => {
    if (protectedState(current.deal)) return "report_revision_protected";
    if (current.deal.Test_Status === "Live" && !currentHead) return null;
    if (current.deal.Test_Status !== config.testCompletedStatusValue) return "report_test_status_conflict";
    if (!currentHead || !patchMatches(current.deal, currentHead.patch)
      || !isNewerReport(currentHead.summary, summary)) return "report_summary_readback_required";
    return null;
  };
  const initialFailure = eligible(state, previous);
  if (initialFailure) await contain(operation, initialFailure);
  const reservation = await operationStore.claimReportGuard(
    binding, key, guard?.confirmedOperationKey ?? null, nowIso(),
  );
  if (!reservation.claimed) fail();
  guard = reservation.guard;
  const claimToken = `report_claim_${crypto.randomBytes(16).toString("hex")}`;
  const claim = await operationStore.claimReportSummary(operation, claimToken, nowIso());
  if (!claim.claimed) fail();
  // A failed read before write-start leaves a reclaimable same-operation claim,
  // not permission for any other revision to acquire the Deal guard.
  const refreshed = await freshState();
  const latestGuard = await operationStore.readReportGuard(binding);
  if (latestGuard?.inflightOperationKey !== key
    || latestGuard.confirmedOperationKey !== guard.confirmedOperationKey) fail();
  const refreshedFailure = eligible(refreshed, await head(latestGuard));
  if (refreshedFailure) await contain(claim.row, refreshedFailure);
  // Some raw analysis changes round to an identical CRM projection. They still
  // advance verified source history, but do not need a redundant CRM mutation.
  if (patchMatches(refreshed.deal, patch)) {
    await finish(claim.row);
    return success(true);
  }
  const started = await operationStore.beginReportSummaryWrite(claim.row, claimToken, nowIso());
  if (!started.started) fail();
  try {
    await crmClient.updateDealReportSummary(refreshed.deal, patch);
  } catch {
    await contain(started.row);
  }
  await finish(started.row);
  return success(false);
}

module.exports = { PROTECTED_FIELDS, patchMatches, syncVersionedReport };
