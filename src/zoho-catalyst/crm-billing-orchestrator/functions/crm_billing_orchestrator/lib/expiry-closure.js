"use strict";

const crypto = require("node:crypto");
const { ReportSummaryError } = require("./report-summary");

const ACTION = "record_test_expiry";
const REASON = "Seven-Day Limit Reached";
const MUTABLE = Object.freeze(["Test_Status", "Test_End_At", "Test_End_Reason"]);
const PRESERVED = Object.freeze([
  "id", "Deal_Name", "Account_Name", "Contact_Name", "Intake_Submission_ID", "Pipeline", "Stage", "Entry_Offer", "Type",
  "Deployment_Record_ID", "Approved_Deployment_Record_ID", "Configuration_Version", "Approved_Configuration_Version",
  "Test_Start_At", "Rollback_Completed_At", "QA_Passed", "Go_Live_Approval_Status", "Call_Totals_Reconciled",
  "Results_Review_At", "Subscription_Acceptance_Status", "Subscription_Accepted_At", "Subscription_Acceptance_Version",
  "Subscription_Start_Date", "Subscription_Status", "Billing_Customer_ID", "Billing_Subscription_ID", "Plan",
  "Billing_Frequency", "Monthly_Recurring_Revenue", "Setup_Fee",
  "Billing_Automation_Status", "Billing_Last_Sync_At", "Billing_Automation_Error",
  "Test_Calls_Reaching_Route", "Test_Qualified_Opportunities", "Test_Existing_Customer_Calls",
  "Test_Actual_Avg_Call_Duration_Seconds", "Test_Out_Of_Area_Or_Wrong_Fit_Calls", "Test_Urgent_Requests",
  "Test_Bookable_Opportunities", "Test_Office_Follow_Up_Calls", "Test_Observed_Workflow_Failures",
  "Recommended_Paid_Coverage", "Expected_Monthly_Connected_Minutes_Min", "Expected_Monthly_Connected_Minutes_Max",
  "Test_Data_Confidence_Notes",
]);
const ID = /^[1-9][0-9]{7,29}$/;
const HASH = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const canonical = value => JSON.stringify(Array.isArray(value) ? value.map(item => JSON.parse(canonical(item)))
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))]))
    : value);
const digest = value => crypto.createHash("sha256").update(canonical(value)).digest("hex");
function check(ok) {
  if (!ok) throw new ReportSummaryError("Expiry closure requires reconciliation", {
    publicCode: "expiry_closure_held", ambiguous: true, status: 503,
  });
}
function time(value) { check(typeof value === "string" && TIME.test(value) && new Date(value).toISOString() === value); return value; }
function crmTime(value) { return time(value).replace(/\.\d{3}Z$/, "+00:00"); }
function sameCrmTime(left, right) { return typeof left === "string" && Math.floor(Date.parse(left) / 1000) === Math.floor(Date.parse(right) / 1000); }
function mac(config, purpose, value) {
  check(typeof config.analyticsPartitionSecret === "string" && config.analyticsPartitionSecret.length >= 32);
  return crypto.createHmac("sha256", config.analyticsPartitionSecret)
    .update(`sylvara.crm-expiry-closure.v1\0${purpose}\0${canonical(value)}`).digest("hex");
}
function equalMac(a, b) { return typeof a === "string" && HASH.test(a) && crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
function normalizedPreserved(deal) {
  return Object.fromEntries(PRESERVED.map(field => {
    check(Object.hasOwn(deal, field));
    let value = deal[field];
    if (["Account_Name", "Contact_Name"].includes(field)) { check(value && ID.test(value.id)); value = value.id; }
    if (field === "Test_Start_At") { check(Number.isFinite(Date.parse(value))); value = Math.floor(Date.parse(value) / 1000); }
    return [field, value];
  }));
}
function bindingOf(deal, accountId) {
  check(ID.test(deal.id) && ID.test(accountId) && deal.Account_Name?.id === accountId
    && ID.test(deal.Contact_Name?.id || "") && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(deal.Intake_Submission_ID || "")
    && deal.Approved_Deployment_Record_ID === deal.Deployment_Record_ID);
  return { dealId: deal.id, accountId, deploymentId: deal.Deployment_Record_ID,
    configurationVersion: deal.Configuration_Version, approvedConfiguration: deal.Approved_Configuration_Version,
    contactId: deal.Contact_Name.id, journeyId: deal.Intake_Submission_ID };
}
function syntheticContext(context) {
  check(context && /^ZZZ SYNTHETIC(?:\s|$)/.test(context.account?.Account_Name || "")
    && /^ZZZ SYNTHETIC(?:\s|$)/.test(context.deal?.Deal_Name || ""));
  return context;
}
function keys(config, binding) {
  return { claim: mac(config, "attempt", binding), outcome: mac(config, "outcome", binding) };
}
function patchFor(endAt) { return { Test_Status: "Completed", Test_End_At: crmTime(endAt), Test_End_Reason: REASON }; }
function patchMatches(deal, endAt) {
  return deal.Test_Status === "Completed" && deal.Test_End_Reason === REASON && sameCrmTime(deal.Test_End_At, endAt);
}
function validatePatch(patch) {
  check(patch && Object.keys(patch).sort().join() === [...MUTABLE].sort().join()
    && patch.Test_Status === "Completed" && patch.Test_End_Reason === REASON
    && typeof patch.Test_End_At === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00$/.test(patch.Test_End_At)
    && Number.isFinite(Date.parse(patch.Test_End_At)));
  return patch;
}
function row(config, key, payload, completed) {
  const json = canonical(payload); check(Buffer.byteLength(json) <= 9000);
  return { OPERATION_KEY: key, OPERATION_FINGERPRINT: mac(config, "payload", payload), ACTION,
    CRM_DEAL_ID: payload.binding.dealId, STATUS: completed ? "completed" : "processing",
    LAST_OUTCOME: completed ? "expiry_only_crm_readback_confirmed" : "expiry_only_attempt_consumed",
    SOURCE_REVISION: config.sourceRevision, SOURCE_ENVIRONMENT: "development", OPERATION_PAYLOAD_JSON: json,
    OPERATION_VERSION: 1, CREATED_AT: payload.observedAt, UPDATED_AT: payload.observedAt };
}
function parseRow(config, stored, key, completed) {
  check(stored && stored.OPERATION_KEY === key && stored.ACTION === ACTION && REVISION.test(stored.SOURCE_REVISION)
    && stored.SOURCE_ENVIRONMENT === "development" && Number(stored.OPERATION_VERSION) === 1
    && stored.STATUS === (completed ? "completed" : "processing")
    && stored.LAST_OUTCOME === (completed ? "expiry_only_crm_readback_confirmed" : "expiry_only_attempt_consumed")
    && typeof stored.OPERATION_PAYLOAD_JSON === "string" && Buffer.byteLength(stored.OPERATION_PAYLOAD_JSON) <= 9000);
  let payload; try { payload = JSON.parse(stored.OPERATION_PAYLOAD_JSON); } catch { check(false); }
  check(equalMac(stored.OPERATION_FINGERPRINT, mac(config, "payload", payload))
    && stored.CRM_DEAL_ID === payload.binding?.dealId && stored.SOURCE_REVISION === payload.sourceRevision
    && stored.CREATED_AT === payload.observedAt && stored.UPDATED_AT === payload.observedAt);
  return payload;
}

/** Private server composition only: no action-contract entry, route or env toggle.
 * policy is a reviewed artifact binding, never caller-supplied. Native metadata,
 * no-delivery trigger behavior and conditional writes require separate qualification. */
function createExpiryClosure({ config, policy, operationStore, crmClient, readRetiredDeployment, now = Date.now }) {
  async function run() {
    // Compatibility qualifies the authenticated summary projection and its fixed
    // closure-proof reader, never the separate manual Blueprint/Results Review.
    // Current identity, field-lock, automation and transport evidence still apply.
    check(policy?.enabled === true && config.deploymentEnvironment === "development"
      && policy.sourceRevision === config.sourceRevision && REVISION.test(config.sourceRevision)
      && policy.schemaVersion === 1 && HASH.test(policy.metadataSha256 || "")
      && typeof policy.expectedStageApiValue === "string" && policy.expectedStageApiValue.length > 0
      && policy.expectedStageApiValue === config.reportMutableStageValue
      && HASH.test(policy.retiredDeploymentSha256 || "") && HASH.test(policy.beforeDealSha256 || "")
      && HASH.test(policy.beforeAccountSha256 || "") && policy.reportCompatibilityQualified === true
      && HASH.test(policy.reportCompatibilitySha256 || "")
      && HASH.test(policy.nativeTransportSha256 || "") && operationStore.expiryClosureTransportQualified === true
      && typeof operationStore.assertExpiryClosureTransport === "function"
      && typeof policy.authorityReference === "string" && policy.authorityReference.length > 0);
    check(await operationStore.assertExpiryClosureTransport(policy.nativeTransportSha256) === true);
    const at = new Date(now()).toISOString();
    const retired = await readRetiredDeployment();
    check(digest(retired) === policy.retiredDeploymentSha256 && retired.TEST_STATUS === "Completed"
      && retired.STOP_REASON === "seven_day_limit_reached" && retired.STOPPED_AT === retired.EXPIRES_AT
      && Date.parse(retired.EXPIRES_AT) <= now() && Date.parse(retired.EXPIRES_AT) - Date.parse(retired.ACTUAL_START_AT) === 604800000
      && Number(retired.CALL_LIMIT) === 25 && Number(retired.HANDLED_COUNT) >= 0 && Number(retired.HANDLED_COUNT) <= 25);
    const first = syntheticContext(await crmClient.getExpiryClosureContext(policy.dealId));
    const deal = first.deal; const binding = bindingOf(deal, first.account.id);
    check(canonical(binding) === canonical(policy.binding) && policy.dealId === binding.dealId
      && retired.DEPLOYMENT_ID === binding.deploymentId && retired.ACTIVE_CONFIGURATION_VERSION_ID === binding.approvedConfiguration
      && digest(deal) === policy.beforeDealSha256 && digest(first.account) === policy.beforeAccountSha256
      // The metadata-bound API value may differ from the displayed stage label.
      && deal.Stage === policy.expectedStageApiValue && deal.Test_Status === "Live"
      && deal.Test_End_At === null && deal.Test_End_Reason === null && deal.Rollback_Completed_At === null
      && deal.QA_Passed === false && deal.Go_Live_Approval_Status === "Approved"
      && deal.Call_Totals_Reconciled !== true && sameCrmTime(deal.Test_Start_At, retired.ACTUAL_START_AT)
      && /^ZZZ SYNTHETIC(?:\s|$)/.test(first.account.Account_Name || "")
      && /^ZZZ SYNTHETIC(?:\s|$)/.test(deal.Deal_Name || ""));
    for (const field of ["Results_Review_At", "Subscription_Acceptance_Status", "Subscription_Accepted_At", "Subscription_Acceptance_Version",
      "Subscription_Start_Date", "Subscription_Status", "Billing_Customer_ID", "Billing_Subscription_ID", "Plan"]) check(deal[field] === null);
    const preserved = normalizedPreserved(deal);
    const operationKeys = keys(config, binding);
    const payload = { schemaVersion: 1, binding, observedAt: at, sourceRevision: config.sourceRevision, authorityReference: policy.authorityReference,
      metadataSha256: policy.metadataSha256, retiredDeploymentSha256: policy.retiredDeploymentSha256,
      reportCompatibilitySha256: policy.reportCompatibilitySha256,
      beforeDealSha256: policy.beforeDealSha256, preservedSha256: digest(preserved),
      originalStartAt: time(retired.ACTUAL_START_AT), originalEndAt: time(retired.EXPIRES_AT),
      reportSettlementReady: false, reportDeliveryAuthorized: false };
    // Immutable unique insert consumes the one allowance. Duplicate or uncertain
    // acknowledgement never permits the CRM write, even if bytes happen to match.
    const claim = row(config, operationKeys.claim, payload, false);
    check((await operationStore.insertExpiryClosure(claim)).inserted === true);
    check(canonical(parseRow(config, await operationStore.readByKey(operationKeys.claim), operationKeys.claim, false)) === canonical(payload));
    const freshRetired = await readRetiredDeployment();
    const fresh = syntheticContext(await crmClient.getExpiryClosureContext(policy.dealId));
    check(digest(freshRetired) === policy.retiredDeploymentSha256 && digest(fresh.deal) === policy.beforeDealSha256
      && digest(fresh.account) === policy.beforeAccountSha256
      && canonical(bindingOf(fresh.deal, fresh.account.id)) === canonical(binding));
    check(await operationStore.assertExpiryClosureTransport(policy.nativeTransportSha256) === true);
    let rejected = false;
    try { await crmClient.updateDealExpiryClosure(fresh.deal, patchFor(payload.originalEndAt)); } catch { rejected = true; }
    // A single authoritative readback may resolve a lost acknowledgement. No
    // second PUT and no read retry are permitted by this private transport.
    const after = syntheticContext(await crmClient.getExpiryClosureContext(policy.dealId));
    check(canonical(bindingOf(after.deal, after.account.id)) === canonical(binding)
      && digest(after.account) === policy.beforeAccountSha256
      && patchMatches(after.deal, payload.originalEndAt) && digest(normalizedPreserved(after.deal)) === payload.preservedSha256);
    check(digest(await readRetiredDeployment()) === policy.retiredDeploymentSha256);
    check(await operationStore.assertExpiryClosureTransport(policy.nativeTransportSha256) === true);
    const outcome = row(config, operationKeys.outcome, { ...payload, claimKey: operationKeys.claim }, true);
    check((await operationStore.insertExpiryClosure(outcome)).inserted === true);
    check(canonical(parseRow(config, await operationStore.readByKey(operationKeys.outcome), operationKeys.outcome, true))
      === canonical({ ...payload, claimKey: operationKeys.claim }));
    return Object.freeze({ state: "EXPIRY_ONLY_CRM_CLOSED", reportSettlementReady: false,
      reportDeliveryAuthorized: false, acknowledgementReconciled: rejected, crmWrites: 1 });
  }
  return Object.freeze({ run });
}

/** The existing first-summary guards remain intact except for this exact signed
 * expiry-only predecessor, revalidated before the report writer takes any effect. */
async function isExpiryClosurePredecessor(config, operationStore, state, summary) {
  if (config.expiryClosureCompatibility?.enabled !== true) return false;
  try {
    check(config.deploymentEnvironment === "development" && summary.schemaVersion === 3
      && summary.testStatus === "Completed" && summary.testEndReason === REASON);
    const binding = bindingOf(state.deal, state.accountId);
    check(config.expiryClosureCompatibility.bindingSha256 === digest(binding));
    const ids = keys(config, binding);
    const proof = parseRow(config, await operationStore.readByKey(ids.outcome), ids.outcome, true);
    const attempt = parseRow(config, await operationStore.readByKey(ids.claim), ids.claim, false);
    check(proof.schemaVersion === 1 && proof.claimKey === ids.claim
      && canonical({ ...attempt, claimKey: ids.claim }) === canonical(proof)
      && canonical(proof.binding) === canonical(binding) && proof.reportSettlementReady === false && proof.reportDeliveryAuthorized === false
      && summary.dealId === binding.dealId && summary.deploymentId === binding.deploymentId
      && summary.configurationVersion === binding.configurationVersion
      && summary.testStartAt === proof.originalStartAt && summary.testEndAt === proof.originalEndAt
      && patchMatches(state.deal, proof.originalEndAt)
      && digest(normalizedPreserved(state.deal)) === proof.preservedSha256);
    return true;
  } catch { return false; }
}

module.exports = { ACTION, MUTABLE, PRESERVED, digest, keys, patchFor, validatePatch,
  createExpiryClosure, isExpiryClosurePredecessor };
