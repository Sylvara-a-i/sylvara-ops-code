"use strict";

const { deriveOperationIdentity } = require("./idempotency");

const AUTOMATION_STATUS = Object.freeze({
  customer: "Customer Verified",
  evaluation: "Evaluation Verified",
  paid: "Paid Verified",
});
const EVALUATION_STATUS = Object.freeze({
  trial: "Trial",
  cancelled: "Canceled",
  expired: "Ended",
});

class LifecycleError extends Error {
  constructor(message, { ambiguous = false, publicCode = "lifecycle_state_invalid", status = 409 } = {}) {
    super(message);
    this.name = "LifecycleError";
    this.ambiguous = ambiguous;
    this.publicCode = publicCode;
    this.status = status;
  }
}

function fail(message, options) {
  throw new LifecycleError(message, options);
}

function timestamp(value, name) {
  if (
    typeof value !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) fail(`${name} is invalid`);
  return value;
}

function lookupId(lookup, name) {
  const value = lookup?.id;
  if (typeof value !== "string" || !/^[1-9][0-9]{7,29}$/.test(value)) fail(`${name} is invalid`);
  return value;
}

function billingId(value, name) {
  if (typeof value !== "string" || !/^[1-9][0-9]{7,29}$/.test(value)) fail(`${name} is invalid`);
  return value;
}

function validateCommon(context, config) {
  const { deal, account } = context;
  if (
    deal.Entry_Offer !== config.freeTestEntryOfferValue ||
    deal.Type !== config.initialSaleTypeValue
  ) fail("Deal is outside the approved free-test lifecycle");
  const accountId = lookupId(deal.Account_Name, "Deal Account relationship");
  if (account.id !== accountId || typeof account.Account_Name !== "string" || !account.Account_Name.trim()) {
    fail("Authoritative CRM Account state is incomplete");
  }
  return Object.freeze({ deal, account, accountId });
}

function operationMaterial(action, state, config) {
  const { deal, accountId } = state;
  switch (action) {
    case "ensure_customer":
      return { accountId };
    case "start_evaluation":
      return {
        accountId,
        testStartAt: timestamp(deal.Test_Start_At, "Test_Start_At"),
        testScopeVersion: String(deal.Test_Scope_Version ?? ""),
      };
    case "end_evaluation":
      return {
        subscriptionId: billingId(
          deal.Billing_Evaluation_Subscription_ID,
          "Evaluation subscription ID",
        ),
        testEndAt: timestamp(deal.Test_End_At, "Test_End_At"),
        testEndReason: String(deal.Test_End_Reason ?? ""),
      };
    case "prepare_paid_subscription":
      return {
        accountId,
        plan: String(deal.Plan ?? ""),
        billingFrequency: String(deal.Billing_Frequency ?? ""),
        subscriptionStartDate: String(deal.Subscription_Start_Date ?? ""),
        accepted: deal.Subscription_Acceptance_Status === config.paidAcceptanceValue,
      };
    default:
      fail("Action does not create a durable mutation", { publicCode: "operation_invalid" });
  }
}

function createLifecycleHandler(config, { crmClient, billingClient, operationStore, now = Date.now }) {
  for (const dependency of [crmClient, billingClient, operationStore]) {
    if (!dependency || typeof dependency !== "object") {
      fail("Lifecycle dependency is unavailable", { publicCode: "configuration_invalid", status: 503 });
    }
  }

  if (typeof now !== "function") {
    fail("Lifecycle clock is unavailable", { publicCode: "configuration_invalid", status: 503 });
  }

  function lastSyncAt() {
    const value = new Date(now());
    if (!Number.isFinite(value.getTime())) {
      fail("Lifecycle clock is invalid", { publicCode: "configuration_invalid", status: 503 });
    }
    return value.toISOString();
  }

  function successPatch(status) {
    return {
      Billing_Automation_Status: status,
      Billing_Last_Sync_At: lastSyncAt(),
      Billing_Automation_Error: null,
    };
  }

  async function ensureCustomer(state) {
    const existingId = state.deal.Billing_Customer_ID;
    const result = await billingClient.ensureCustomer({
      crmAccountId: state.accountId,
    });
    const customerId = billingId(result.customer.customer_id, "Billing customer ID");
    if (existingId && existingId !== customerId) fail("CRM and Billing customer IDs conflict", {
      ambiguous: true,
      publicCode: "reconciliation_required",
      status: 503,
    });
    let deal = state.deal;
    const patch = successPatch(AUTOMATION_STATUS.customer);
    if (deal.Billing_Customer_ID !== customerId) patch.Billing_Customer_ID = customerId;
    deal = await crmClient.updateDealIntegration(deal, patch);
    return Object.freeze({ ...state, deal, customerId });
  }

  async function execute(action, state, identity) {
    if (action === "ensure_customer") {
      await ensureCustomer(state);
      return "customer_readback_confirmed";
    }
    if (action === "start_evaluation") {
      if (
        state.deal.Stage !== config.testLiveStageValue ||
        state.deal.Go_Live_Approval_Status !== config.goLiveApprovedValue ||
        Number(state.deal.Test_Duration_Days) !== config.freeTestDurationDays ||
        Number(state.deal.Test_Call_Limit) !== config.freeTestCallLimit ||
        !String(state.deal.Test_Scope_Version ?? "")
      ) fail("Deal is not approved to start an evaluation");
      timestamp(state.deal.Go_Live_Approved_At, "Go_Live_Approved_At");
      timestamp(state.deal.Test_Start_At, "Test_Start_At");
      const customerState = await ensureCustomer(state);
      const subscription = await billingClient.ensureEvaluationSubscription({
        customerId: customerState.customerId,
        deterministicReference: identity.billingReference,
      });
      const subscriptionId = billingId(subscription.subscription_id, "Evaluation subscription ID");
      if (
        customerState.deal.Billing_Evaluation_Subscription_ID &&
        customerState.deal.Billing_Evaluation_Subscription_ID !== subscriptionId
      ) fail("CRM already references a different Billing subscription", {
        ambiguous: true,
        publicCode: "reconciliation_required",
        status: 503,
      });
      await crmClient.updateDealIntegration(customerState.deal, {
        Billing_Customer_ID: customerState.customerId,
        Billing_Evaluation_Subscription_ID: subscriptionId,
        Billing_Evaluation_Status: EVALUATION_STATUS.trial,
        ...successPatch(AUTOMATION_STATUS.evaluation),
      });
      return "evaluation_readback_confirmed";
    }
    if (action === "end_evaluation") {
      if (!new Set([config.resultsReviewStageValue, config.closedLostStageValue]).has(state.deal.Stage)) {
        fail("Deal is not approved to end an evaluation");
      }
      timestamp(state.deal.Test_End_At, "Test_End_At");
      if (typeof state.deal.Test_End_Reason !== "string" || !state.deal.Test_End_Reason.trim()) {
        fail("Test_End_Reason is required");
      }
      const subscriptionId = billingId(
        state.deal.Billing_Evaluation_Subscription_ID,
        "Evaluation subscription ID",
      );
      const readback = await billingClient.cancelEvaluation(subscriptionId);
      const terminalStatus = EVALUATION_STATUS[readback.status];
      if (!terminalStatus) fail("Billing evaluation terminal status is invalid", {
        ambiguous: true,
        publicCode: "reconciliation_required",
        status: 503,
      });
      await crmClient.updateDealIntegration(state.deal, {
        Billing_Evaluation_Subscription_ID: subscriptionId,
        Billing_Evaluation_Status: terminalStatus,
        ...successPatch(AUTOMATION_STATUS.evaluation),
      });
      return "evaluation_end_readback_confirmed";
    }
    if (action === "prepare_paid_subscription") {
      if (
        state.deal.Stage !== config.subscriptionProposedStageValue ||
        state.deal.Test_Status !== config.testCompletedStatusValue ||
        state.deal.Subscription_Acceptance_Status !== config.paidAcceptanceValue
      ) fail("Deal does not contain explicit paid acceptance");
      const plan = String(state.deal.Plan ?? "");
      const billingFrequency = String(state.deal.Billing_Frequency ?? "");
      if (
        !plan || !billingFrequency || plan.length > 120 || billingFrequency.length > 120 ||
        /[\u0000-\u001f\u007f]/.test(`${plan}${billingFrequency}`)
      ) fail("Deal Plan and Billing Frequency are invalid");
      const selectedPlanCode = config.paidPlanCodeMap[`${plan}::${billingFrequency}`];
      if (!selectedPlanCode) fail("Deal Plan and Billing Frequency are outside the approved map");
      if (
        typeof state.deal.Subscription_Start_Date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(state.deal.Subscription_Start_Date) ||
        !Number.isFinite(Date.parse(`${state.deal.Subscription_Start_Date}T00:00:00Z`))
      ) fail("Subscription_Start_Date is invalid");
      const customerState = await ensureCustomer(state);
      const subscription = await billingClient.ensurePaidSubscription({
        customerId: customerState.customerId,
        deterministicReference: identity.billingReference,
        selectedPlanCode,
      });
      const subscriptionId = billingId(subscription.subscription_id, "Paid subscription ID");
      if (
        customerState.deal.Billing_Subscription_ID &&
        customerState.deal.Billing_Subscription_ID !== subscriptionId
      ) fail("CRM already references a different paid Billing subscription", {
        ambiguous: true,
        publicCode: "reconciliation_required",
        status: 503,
      });
      await crmClient.updateDealIntegration(customerState.deal, {
        Billing_Customer_ID: customerState.customerId,
        Billing_Subscription_ID: subscriptionId,
        Subscription_Status: config.paidReadyStatusValue,
        ...successPatch(AUTOMATION_STATUS.paid),
      });
      return "paid_subscription_readback_confirmed";
    }
    fail("Lifecycle action is unsupported", { publicCode: "operation_invalid" });
  }

  async function reconcile(state) {
    const customer = await billingClient.findCustomerByCrmReference(state.accountId);
    if (!customer) fail("Billing customer is missing", {
      ambiguous: true,
      publicCode: "reconciliation_required",
      status: 503,
    });
    const customerId = billingId(customer.customer_id, "Billing customer ID");
    if (state.deal.Billing_Customer_ID && state.deal.Billing_Customer_ID !== customerId) {
      fail("CRM and Billing customer IDs conflict", {
        ambiguous: true,
        publicCode: "reconciliation_required",
        status: 503,
      });
    }
    if (
      state.deal.Billing_Evaluation_Subscription_ID &&
      state.deal.Billing_Subscription_ID &&
      state.deal.Billing_Evaluation_Subscription_ID === state.deal.Billing_Subscription_ID
    ) fail("Evaluation and paid Billing subscription IDs are not separated", {
      ambiguous: true,
      publicCode: "reconciliation_required",
      status: 503,
    });
    for (const subscriptionId of [
      state.deal.Billing_Evaluation_Subscription_ID,
      state.deal.Billing_Subscription_ID,
    ].filter(Boolean)) {
      const subscription = await billingClient.getSubscription(subscriptionId);
      if (String(subscription.customer_id ?? "") !== customerId) fail(
        "Billing subscription belongs to a different customer",
        { ambiguous: true, publicCode: "reconciliation_required", status: 503 },
      );
    }
    return Object.freeze({ outcome: "authoritative_readback_confirmed", duplicate: false });
  }

  async function handle(payload) {
    const context = await crmClient.getContext(payload.dealId);
    const state = validateCommon(context, config);
    if (payload.action === "reconcile") return reconcile(state);
    const identity = deriveOperationIdentity(
      config,
      payload.action,
      payload.dealId,
      operationMaterial(payload.action, state, config),
    );
    const claim = await operationStore.claim({
      operationKey: identity.operationKey,
      operationFingerprint: identity.operationFingerprint,
      action: payload.action,
      dealId: payload.dealId,
    });
    if (claim.outcome === "duplicate-completed") {
      return Object.freeze({ outcome: "duplicate_completed", duplicate: true });
    }
    if (claim.outcome !== "claimed") fail("Lifecycle operation requires reconciliation", {
      ambiguous: true,
      publicCode: "reconciliation_required",
      status: 503,
    });
    try {
      const outcome = await execute(payload.action, state, identity);
      await operationStore.mark(claim.rowId, "completed", outcome);
      return Object.freeze({ outcome, duplicate: false });
    } catch (error) {
      const status = error?.ambiguous ? "reconciliation_required" : "failed";
      const outcome = String(error?.publicCode ?? "lifecycle_failed");
      try {
        await operationStore.mark(
          claim.rowId,
          status,
          /^[a-z0-9_]{1,80}$/.test(outcome) ? outcome : "lifecycle_failed",
        );
      } catch {
        throw new LifecycleError("Lifecycle result requires reconciliation", {
          ambiguous: true,
          publicCode: "reconciliation_required",
          status: 503,
        });
      }
      throw error;
    }
  }

  return Object.freeze({ handle });
}

module.exports = { LifecycleError, createLifecycleHandler };
