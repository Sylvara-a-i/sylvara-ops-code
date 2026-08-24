"use strict";

const {
  TEST_CUSTOMER_PROVISIONING_ACTION,
  deriveOperationIdentity,
  deriveTestCustomerProvisioningIdentity,
} = require("./idempotency");
const {
  moneyMinor,
  selectCommercialTerms,
} = require("./commercial-terms");

const PAID_ACTION = "prepare_paid_subscription";
const AUTOMATION_STATUS = "Paid Verified";
const SOURCE_REVISION = /^[a-f0-9]{40}$/;
const RECONCILABLE_OPERATION_STATES = new Set([
  "completed",
  "processing",
  "reconciliation_required",
]);

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

function calendarDate(value, name) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${name} is invalid`);
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    fail(`${name} is invalid`);
  }
  return parsed;
}

function timestamp(value, name) {
  if (
    typeof value !== "string" || value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) fail(`${name} is invalid`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(`${name} is invalid`);
  return parsed;
}

function acceptanceVersion(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value)
  ) fail("Subscription_Acceptance_Version is invalid");
  return value;
}

function syntheticName(value, name) {
  if (
    typeof value !== "string" || value.length > 255 ||
    !/^ZZZ SYNTHETIC(?:$|[ :/_-])/.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) fail(`${name} is outside the ZZZ SYNTHETIC boundary`);
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
    deal.Pipeline !== config.revenueDeskPipelineValue ||
    deal.Entry_Offer !== config.freeTestEntryOfferValue ||
    deal.Type !== config.initialSaleTypeValue
  ) fail("Deal is outside the approved free-test conversion lifecycle");
  const accountId = lookupId(deal.Account_Name, "Deal Account relationship");
  if (account.id !== accountId) {
    fail("Authoritative CRM Account state is incomplete");
  }
  syntheticName(deal.Deal_Name, "Deal");
  syntheticName(account.Account_Name, "Account");
  return Object.freeze({ deal, account, accountId });
}

function validatePaidAction(state, config, currentTimestamp, { reconciliation = false } = {}) {
  if (!reconciliation && !config.enablePaidSubscriptionPreparation) {
    fail("Paid subscription preparation is disabled", {
      publicCode: "operation_invalid",
      status: 409,
    });
  }
  const permittedStages = reconciliation
    ? new Set([config.subscriptionProposedStageValue, config.closedWonStageValue])
    : new Set([config.subscriptionProposedStageValue]);
  if (
    !permittedStages.has(state.deal.Stage) ||
    state.deal.Test_Status !== config.testCompletedStatusValue ||
    state.deal.Subscription_Acceptance_Status !== config.paidAcceptanceValue
  ) fail("Deal does not contain explicit paid acceptance");

  const resultsReviewAt = timestamp(state.deal.Results_Review_At, "Results_Review_At");
  const subscriptionAcceptedAt = timestamp(
    state.deal.Subscription_Accepted_At,
    "Subscription_Accepted_At",
  );
  const subscriptionAcceptanceVersion = acceptanceVersion(
    state.deal.Subscription_Acceptance_Version,
  );

  const plan = String(state.deal.Plan ?? "");
  const billingFrequency = String(state.deal.Billing_Frequency ?? "");
  const commercialTerms = selectCommercialTerms(
    config.paidCommercialTerms,
    plan,
    billingFrequency,
  );
  const selectedPlanCode = config.paidPlanCodeMap[`${plan}::${billingFrequency}`];
  if (!commercialTerms || !selectedPlanCode) {
    fail("Deal Plan and Billing Frequency are outside the approved monthly catalog");
  }
  if (
    moneyMinor(state.deal.MRR) !== commercialTerms.recurringMinor ||
    moneyMinor(state.deal.Setup_Fee) !== commercialTerms.setupMinor ||
    moneyMinor(state.deal.Connected_AI_Minute_Rate) !==
      config.paidCommercialTerms.commonUsageRateMinor
  ) fail("Deal commercial terms do not match the approved catalog");

  const subscriptionStartDate = state.deal.Subscription_Start_Date;
  const subscriptionStartAt = calendarDate(subscriptionStartDate, "Subscription_Start_Date");
  const currentTime = new Date(currentTimestamp);
  if (!Number.isFinite(currentTime.getTime())) {
    fail("Lifecycle clock is invalid", { publicCode: "configuration_invalid", status: 503 });
  }
  const currentDate = Date.parse(`${currentTime.toISOString().slice(0, 10)}T00:00:00Z`);
  if (
    resultsReviewAt > subscriptionAcceptedAt ||
    subscriptionAcceptedAt > currentTime.getTime()
  ) fail("Paid acceptance chronology is invalid");
  // The rolling date window admits a new subscription mutation only. Reconciliation
  // is already bound to the exact durable operation fingerprint and performs readback,
  // so a later UTC date must not make an existing operation impossible to converge.
  if (!reconciliation) {
    const maximumStartDate = currentDate + (366 * 24 * 60 * 60 * 1000);
    if (subscriptionStartAt < currentDate || subscriptionStartAt > maximumStartDate) {
      fail("Subscription_Start_Date is outside the approved range");
    }
  }
  return Object.freeze({
    commercialTerms,
    selectedPlanCode,
    subscriptionAcceptanceVersion,
    subscriptionAcceptedAt: state.deal.Subscription_Accepted_At,
    resultsReviewAt: state.deal.Results_Review_At,
    subscriptionStartDate,
  });
}

function operationMaterial(state, validation, config) {
  return {
    accepted: true,
    accountId: state.accountId,
    billingFrequency: validation.commercialTerms.billingFrequency,
    billingOrganizationId: config.billingOrganizationId,
    currency: config.paidCommercialTerms.currency,
    interval: config.paidCommercialTerms.interval,
    intervalUnit: config.paidCommercialTerms.intervalUnit,
    plan: validation.commercialTerms.plan,
    planCode: validation.selectedPlanCode,
    recurringMinor: validation.commercialTerms.recurringMinor,
    resultsReviewAt: validation.resultsReviewAt,
    setupMinor: validation.commercialTerms.setupMinor,
    subscriptionAcceptanceVersion: validation.subscriptionAcceptanceVersion,
    subscriptionAcceptedAt: validation.subscriptionAcceptedAt,
    subscriptionStartDate: validation.subscriptionStartDate,
    usageAddonCode: config.paidUsageAddonCode,
    usageAddonProductId: config.paidUsageAddonProductId,
    usageAddonUnit: config.paidUsageAddonUnit,
    usageRateMinor: config.paidCommercialTerms.commonUsageRateMinor,
  };
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

  function successPatch(customerId, subscriptionId, subscriptionStatus) {
    return {
      Billing_Customer_ID: customerId,
      Billing_Subscription_ID: subscriptionId,
      Subscription_Status: subscriptionStatus,
      Billing_Automation_Status: AUTOMATION_STATUS,
      Billing_Last_Sync_At: lastSyncAt(),
      Billing_Automation_Error: null,
    };
  }

  function rejectPreexistingSubscription(value) {
    if (value) fail("CRM paid subscription already exists and requires reconciliation", {
      ambiguous: true,
      publicCode: "reconciliation_required",
      status: 503,
    });
  }

  async function refreshPaidState(originalState) {
    const refreshed = validateCommon(await crmClient.getContext(originalState.deal.id), config);
    if (refreshed.accountId !== originalState.accountId) fail(
      "Deal Account relationship changed during the operation",
      { publicCode: "record_stale", status: 409 },
    );
    const validation = validatePaidAction(refreshed, config, now());
    return Object.freeze({ state: refreshed, validation });
  }

  function paidIdentity(state, validation) {
    return deriveOperationIdentity(
      config,
      PAID_ACTION,
      state.deal.id,
      operationMaterial(state, validation, config),
    );
  }

  function assertClaimStillMatches(state, validation, identity) {
    const refreshedIdentity = paidIdentity(state, validation);
    if (
      refreshedIdentity.operationKey !== identity.operationKey ||
      refreshedIdentity.operationFingerprint !== identity.operationFingerprint
    ) fail("Authoritative CRM or catalog inputs changed after the operation claim", {
      publicCode: "record_stale",
      status: 409,
    });
  }

  async function resolveCustomer(state) {
    const result = await billingClient.ensureCustomer({ crmAccountId: state.accountId });
    const customerId = billingId(result.customer.customer_id, "Billing customer ID");
    if (state.deal.Billing_Customer_ID && state.deal.Billing_Customer_ID !== customerId) {
      fail("CRM and Billing customer IDs conflict", {
        ambiguous: true,
        publicCode: "reconciliation_required",
        status: 503,
      });
    }
    return customerId;
  }

  async function executePaid(state, identity) {
    rejectPreexistingSubscription(state.deal.Billing_Subscription_ID);
    const customerId = await resolveCustomer(state);
    const refreshed = await refreshPaidState(state);
    rejectPreexistingSubscription(refreshed.state.deal.Billing_Subscription_ID);
    if (
      refreshed.state.deal.Billing_Customer_ID &&
      refreshed.state.deal.Billing_Customer_ID !== customerId
    ) fail("CRM and Billing customer IDs conflict", {
      ambiguous: true,
      publicCode: "reconciliation_required",
      status: 503,
    });
    assertClaimStillMatches(refreshed.state, refreshed.validation, identity);

    const subscription = await billingClient.ensurePaidSubscription({
      customerId,
      deterministicReference: identity.billingReference,
      selectedPlanCode: refreshed.validation.selectedPlanCode,
      commercialTerms: refreshed.validation.commercialTerms,
      subscriptionStartDate: refreshed.validation.subscriptionStartDate,
    });
    const subscriptionId = billingId(subscription.subscription_id, "Paid subscription ID");
    const subscriptionStatus = config.paidSubscriptionStatusMap[subscription.status];
    if (!subscriptionStatus) fail("Billing paid subscription status is unsupported", {
      ambiguous: true,
      publicCode: "reconciliation_required",
      status: 503,
    });
    await crmClient.updateDealIntegration(
      refreshed.state.deal,
      successPatch(customerId, subscriptionId, subscriptionStatus),
    );
    return "paid_subscription_readback_confirmed";
  }

  function exactOperationRow(operation, identity, state) {
    return Boolean(operation) &&
      operation.OPERATION_KEY === identity.operationKey &&
      operation.OPERATION_FINGERPRINT === identity.operationFingerprint &&
      operation.ACTION === PAID_ACTION &&
      String(operation.CRM_DEAL_ID ?? "") === state.deal.id &&
      SOURCE_REVISION.test(String(operation.SOURCE_REVISION ?? "")) &&
      operation.SOURCE_ENVIRONMENT === config.deploymentEnvironment;
  }

  async function reconcile(state) {
    const validation = validatePaidAction(state, config, now(), { reconciliation: true });
    const identity = paidIdentity(state, validation);
    const operation = await operationStore.readByKey(identity.operationKey);
    if (
      !exactOperationRow(operation, identity, state) ||
      !RECONCILABLE_OPERATION_STATES.has(operation.STATUS)
    ) fail("Paid lifecycle operation is unresolved", {
      ambiguous: true,
      publicCode: "reconciliation_required",
      status: 503,
    });

    const provisioningIdentity = deriveTestCustomerProvisioningIdentity(config, state.accountId);
    const provisioningOperation = await operationStore.readByKey(provisioningIdentity.operationKey);
    if (!provisioningOperation || (
      provisioningOperation.OPERATION_KEY !== provisioningIdentity.operationKey ||
      provisioningOperation.OPERATION_FINGERPRINT !== provisioningIdentity.operationFingerprint ||
      provisioningOperation.ACTION !== TEST_CUSTOMER_PROVISIONING_ACTION ||
      String(provisioningOperation.CRM_DEAL_ID ?? "") !== state.accountId ||
      !SOURCE_REVISION.test(String(provisioningOperation.SOURCE_REVISION ?? "")) ||
      provisioningOperation.SOURCE_ENVIRONMENT !== config.deploymentEnvironment ||
      !RECONCILABLE_OPERATION_STATES.has(provisioningOperation.STATUS)
    )) fail("TEST customer provisioning operation is unresolved", {
      ambiguous: true,
      publicCode: "reconciliation_required",
      status: 503,
    });

    const customer = await billingClient.findCustomerByCrmReference(state.accountId);
    if (!customer) fail("Billing customer is missing", {
      ambiguous: true,
      publicCode: "reconciliation_required",
      status: 503,
    });
    const customerId = billingId(customer.customer_id, "Billing customer ID");
    if (provisioningOperation.STATUS !== "completed") {
      await operationStore.mark(
        provisioningOperation.ROWID,
        "completed",
        "customer_readback_confirmed",
      );
    }
    if (state.deal.Billing_Customer_ID && state.deal.Billing_Customer_ID !== customerId) {
      fail("CRM and Billing customer IDs conflict", {
        ambiguous: true,
        publicCode: "reconciliation_required",
        status: 503,
      });
    }

    const subscription = await billingClient.findVerifiedPaidSubscription({
      customerId,
      deterministicReference: identity.billingReference,
      selectedPlanCode: validation.selectedPlanCode,
      commercialTerms: validation.commercialTerms,
      subscriptionStartDate: validation.subscriptionStartDate,
    });
    if (!subscription) fail("Billing paid subscription is missing", {
      ambiguous: true,
      publicCode: "reconciliation_required",
      status: 503,
    });
    const subscriptionId = billingId(subscription.subscription_id, "Paid subscription ID");
    if (state.deal.Billing_Subscription_ID && state.deal.Billing_Subscription_ID !== subscriptionId) {
      fail("CRM and Billing subscription IDs conflict", {
        ambiguous: true,
        publicCode: "reconciliation_required",
        status: 503,
      });
    }
    const subscriptionStatus = config.paidSubscriptionStatusMap[subscription.status];
    if (!subscriptionStatus) fail("Billing paid subscription status is unsupported", {
      ambiguous: true,
      publicCode: "reconciliation_required",
      status: 503,
    });

    const expectedPatch = successPatch(customerId, subscriptionId, subscriptionStatus);
    const integrationMatches = Object.entries(expectedPatch).every(([field, expected]) => (
      field === "Billing_Last_Sync_At" ||
      (expected === null ? state.deal[field] == null : state.deal[field] === expected)
    ));
    if (!integrationMatches) await crmClient.updateDealIntegration(state.deal, expectedPatch);
    if (operation.STATUS !== "completed") {
      await operationStore.mark(
        operation.ROWID,
        "completed",
        "paid_subscription_readback_confirmed",
      );
    }
    return Object.freeze({ outcome: "authoritative_readback_confirmed", duplicate: false });
  }

  async function handle(payload) {
    const context = await crmClient.getContext(payload.dealId);
    const state = validateCommon(context, config);
    if (payload.action === "reconcile") return reconcile(state);
    if (payload.action !== PAID_ACTION) {
      fail("Lifecycle action is unsupported", { publicCode: "operation_invalid" });
    }
    const validation = validatePaidAction(state, config, now());
    const identity = paidIdentity(state, validation);
    const claim = await operationStore.claim({
      operationKey: identity.operationKey,
      operationFingerprint: identity.operationFingerprint,
      action: payload.action,
      scopeId: payload.dealId,
    });
    if (claim.outcome === "duplicate-completed") {
      await reconcile(state);
      return Object.freeze({ outcome: "duplicate_completed", duplicate: true });
    }
    if (claim.outcome !== "claimed") fail("Lifecycle operation requires reconciliation", {
      ambiguous: true,
      publicCode: "reconciliation_required",
      status: 503,
    });

    let outcome;
    try {
      outcome = await executePaid(state, identity);
    } catch (error) {
      const lastOutcome = String(error?.publicCode ?? "lifecycle_failed");
      try {
        await operationStore.mark(
          claim.rowId,
          "reconciliation_required",
          /^[a-z0-9_]{1,80}$/.test(lastOutcome) ? lastOutcome : "lifecycle_failed",
        );
      } catch {
        throw new LifecycleError("Lifecycle result requires reconciliation", {
          ambiguous: true,
          publicCode: "reconciliation_required",
          status: 503,
        });
      }
      throw new LifecycleError("Lifecycle side-effect outcome requires reconciliation", {
        ambiguous: true,
        publicCode: "reconciliation_required",
        status: 503,
      });
    }
    try {
      await operationStore.mark(claim.rowId, "completed", outcome);
    } catch {
      throw new LifecycleError("Lifecycle completion requires reconciliation", {
        ambiguous: true,
        publicCode: "reconciliation_required",
        status: 503,
      });
    }
    return Object.freeze({ outcome, duplicate: false });
  }

  return Object.freeze({ handle });
}

module.exports = { LifecycleError, createLifecycleHandler };
