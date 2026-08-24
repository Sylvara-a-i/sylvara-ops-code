"use strict";

const crypto = require("node:crypto");
const { HttpBoundaryError, requestJson } = require("./http");
const {
  TEST_CUSTOMER_PROVISIONING_ACTION,
  deriveTestCustomerProvisioningIdentity,
} = require("./idempotency");

const RECORD_ID = /^[1-9][0-9]{7,29}$/;
const PLAN_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const REFERENCE = /^syl-(?:customer|evaluation|paid)-[a-f0-9]{32}$/;
const TEST_CUSTOMER_MARKER = /^syl-test-customer-[a-f0-9]{32}$/;

class BillingClientError extends Error {
  constructor(message, { ambiguous = false, publicCode = "billing_dependency_failed", status = 503 } = {}) {
    super(message);
    this.name = "BillingClientError";
    this.ambiguous = ambiguous;
    this.publicCode = publicCode;
    this.status = status;
  }
}

function fail(message, options) {
  throw new BillingClientError(message, options);
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function id(value, name) {
  const normalized = String(value ?? "");
  if (!RECORD_ID.test(normalized)) fail(`${name} is invalid`, { publicCode: "billing_state_invalid" });
  return normalized;
}

function planCode(value) {
  if (typeof value !== "string" || !PLAN_CODE.test(value)) {
    fail("Billing plan code is invalid", { publicCode: "configuration_invalid" });
  }
  return value;
}

function reference(value) {
  if (typeof value !== "string" || !REFERENCE.test(value)) {
    fail("Billing deterministic reference is invalid", { publicCode: "configuration_invalid" });
  }
  return value;
}

function directTestCustomerIdentity(config, crmAccountId) {
  const selectedAccountId = id(crmAccountId, "CRM Account identifier");
  const digest = crypto.createHmac("sha256", config.idempotencyPepper)
    .update(`test-customer\0${config.deploymentEnvironment}\0${selectedAccountId}`)
    .digest("hex");
  const token = digest.slice(0, 32);
  return Object.freeze({
    email: `billing-sandbox+${token}@example.com`,
    marker: `syl-test-customer-${token}`,
    displayName: `ZZZ SYNTHETIC Billing Customer ${token.slice(0, 12)} - DO NOT CONTACT`,
  });
}

function decimal(value, name, { optionalZero = false } = {}) {
  if ((value === undefined || value === null || value === "") && optionalZero) return 0;
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(raw)) {
    fail(`${name} is invalid`, { publicCode: "billing_state_invalid" });
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) fail(`${name} is invalid`, {
    publicCode: "billing_state_invalid",
  });
  return parsed;
}

function authorization(value) {
  if (typeof value !== "string" || !/^Zoho-oauthtoken [A-Za-z0-9._-]{16,4096}$/.test(value)) {
    fail("Billing Connection authorization is invalid", { publicCode: "connection_unavailable" });
  }
  return value;
}

function classifyStatus(status, sideEffecting) {
  if (!sideEffecting || [400, 401, 403, 404, 409, 422].includes(status)) {
    return { publicCode: "billing_rejected", status: 502 };
  }
  return { ambiguous: true, publicCode: "reconciliation_required", status: 503 };
}

function createBillingClient(config, {
  readAuthorizationProvider,
  writeAuthorizationProvider,
  operationStore,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof readAuthorizationProvider !== "function" || typeof writeAuthorizationProvider !== "function") {
    fail("Billing authorization providers are unavailable", { publicCode: "configuration_invalid" });
  }
  if (
    config.customerProvisioningMode === "test_direct_customer" &&
    (typeof operationStore?.claim !== "function" || typeof operationStore?.mark !== "function")
  ) fail("Direct TEST customer operation store is unavailable", {
    publicCode: "configuration_invalid",
  });

  async function markDirectTestCustomerClaim(rowId, status, lastOutcome) {
    try {
      await operationStore.mark(rowId, status, lastOutcome);
    } catch {
      fail("Direct TEST customer claim result requires reconciliation", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
    }
  }

  function reconciliationError(message) {
    return new BillingClientError(message, {
      ambiguous: true,
      publicCode: "reconciliation_required",
    });
  }

  async function authorizedRequest(path, { query = null, write = false, sideEffecting = false, ...options }) {
    const url = new URL(`${config.billingApiBaseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    }
    let token;
    try {
      token = authorization(await (write ? writeAuthorizationProvider() : readAuthorizationProvider()));
    } catch (error) {
      if (error instanceof BillingClientError) throw error;
      fail("Billing Connection is unavailable", { publicCode: "connection_unavailable" });
    }
    try {
      return await requestJson(url.toString(), {
        ...options,
        headers: {
          ...options.headers,
          Authorization: token,
          "X-com-zoho-subscriptions-organizationid": config.billingOrganizationId,
        },
      }, {
        timeoutMs: config.outboundTimeoutMs,
        maximumBytes: config.outboundMaxBytes,
        sideEffecting,
      }, fetchImpl);
    } catch (error) {
      if (error instanceof HttpBoundaryError) fail("Billing request did not return an authoritative result", {
        ambiguous: error.ambiguous,
        publicCode: error.publicCode === "dependency_failed"
          ? "billing_dependency_failed"
          : error.publicCode,
        status: error.status,
      });
      throw error;
    }
  }

  async function assertDirectTestOrganization() {
    if (
      config.customerProvisioningMode !== "test_direct_customer" ||
      config.enableTestDirectCustomerProvisioning !== true
    ) fail("Direct customer provisioning is not enabled", {
      publicCode: "configuration_invalid",
    });
    const response = await authorizedRequest(`/organizations/${config.billingOrganizationId}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200) fail(
      "Billing rejected test organization attestation",
      classifyStatus(response.status, false),
    );
    const organization = response.json?.organization;
    const joinedApps = organization?.org_joined_app_list;
    if (
      !plainObject(organization) ||
      String(organization.organization_id ?? "") !== config.billingOrganizationId ||
      organization.mode !== "test" ||
      !Array.isArray(joinedApps) || joinedApps.length !== 1 || joinedApps[0] !== "subscriptions"
    ) fail("Billing organization is not the isolated Billing TEST tenant", {
      ambiguous: true,
      publicCode: "billing_state_invalid",
    });
    return organization;
  }

  async function getCustomer(customerId) {
    const selectedId = id(customerId, "Billing customer identifier");
    const response = await authorizedRequest(`/customers/${selectedId}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200) fail("Billing rejected customer readback", classifyStatus(response.status, false));
    const customer = response.json?.customer;
    if (!plainObject(customer) || String(customer.customer_id ?? "") !== selectedId) {
      fail("Billing customer readback is incomplete", { publicCode: "billing_state_invalid" });
    }
    return customer;
  }

  function verifyDirectTestCustomer(customer, identity) {
    if (!plainObject(customer) || !plainObject(identity) || !TEST_CUSTOMER_MARKER.test(identity.marker)) {
      fail("Direct TEST customer boundary is invalid", { publicCode: "configuration_invalid" });
    }
    id(customer.customer_id, "Billing customer identifier");
    if (
      customer.email !== identity.email ||
      customer.display_name !== identity.displayName ||
      customer.company_name !== identity.displayName ||
      customer.notes !== identity.marker ||
      customer.status !== "active" ||
      customer.is_portal_enabled !== false ||
      customer.ach_supported !== false ||
      Number(customer.payment_terms) !== 0 ||
      customer.is_linked_with_zohocrm !== false ||
      String(customer.zcrm_account_id ?? "") !== "" ||
      decimal(customer.outstanding, "Direct TEST customer outstanding") !== 0 ||
      decimal(customer.unused_credits, "Direct TEST customer unused credits") !== 0
    ) fail("Direct TEST customer readback violates the isolated boundary", {
      ambiguous: true,
      publicCode: "reconciliation_required",
    });
    return customer;
  }

  async function findDirectTestCustomer(crmAccountId) {
    await assertDirectTestOrganization();
    const identity = directTestCustomerIdentity(config, crmAccountId);
    const candidates = [];
    for (let page = 1; page <= 25; page += 1) {
      const response = await authorizedRequest("/customers", {
        method: "GET",
        headers: { Accept: "application/json" },
        query: { filter_by: "Status.All", page: String(page), per_page: "200" },
      });
      if (response.status !== 200) fail("Billing rejected direct TEST customer lookup", {
        ...classifyStatus(response.status, false),
      });
      const customers = response.json?.customers;
      const pageContext = response.json?.page_context;
      if (
        !Array.isArray(customers) || customers.some((customer) => !plainObject(customer)) ||
        !plainObject(pageContext) || typeof pageContext.has_more_page !== "boolean" ||
        !Number.isInteger(Number(pageContext.page)) || Number(pageContext.page) !== page
      ) fail("Billing customer pagination is incomplete", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
      candidates.push(...customers.filter((customer) => customer.email === identity.email));
      if (candidates.length > 1) fail("Direct TEST customer identity is not unique", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
      if (!pageContext.has_more_page) {
        if (candidates.length === 0) return null;
        const customer = await getCustomer(candidates[0].customer_id);
        return verifyDirectTestCustomer(customer, identity);
      }
    }
    fail("Billing customer pagination exceeded the reconciliation bound", {
      ambiguous: true,
      publicCode: "reconciliation_required",
    });
  }

  async function findNativeCustomerByCrmReference(crmAccountId) {
    const selectedAccountId = id(crmAccountId, "CRM Account identifier");
    const response = await authorizedRequest(`/customers/reference/${selectedAccountId}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      query: { reference_id_type: "zcrm_account_id" },
    });
    if (response.status === 404) return null;
    if (response.status !== 200) fail("Billing rejected customer lookup", classifyStatus(response.status, false));
    const customer = response.json?.customer;
    if (!plainObject(customer)) fail("Billing CRM Account customer readback is incomplete", {
      publicCode: "billing_state_invalid",
    });
    id(customer.customer_id, "Billing customer identifier");
    if (String(customer.zcrm_account_id ?? "") !== selectedAccountId) {
      fail("Billing customer reference readback does not match", { publicCode: "billing_state_invalid" });
    }
    return customer;
  }

  async function findCustomerByCrmReference(crmAccountId) {
    return config.customerProvisioningMode === "test_direct_customer"
      ? findDirectTestCustomer(crmAccountId)
      : findNativeCustomerByCrmReference(crmAccountId);
  }

  async function ensureCustomer({ crmAccountId }) {
    const selectedAccountId = id(crmAccountId, "CRM Account identifier");
    let existing;
    if (config.customerProvisioningMode === "test_direct_customer") {
      const identity = directTestCustomerIdentity(config, selectedAccountId);
      const operationIdentity = deriveTestCustomerProvisioningIdentity(config, selectedAccountId);
      const claim = await operationStore.claim({
        operationKey: operationIdentity.operationKey,
        operationFingerprint: operationIdentity.operationFingerprint,
        action: TEST_CUSTOMER_PROVISIONING_ACTION,
        scopeId: selectedAccountId,
      });
      if (claim.outcome === "duplicate-completed") {
        try {
          existing = await findDirectTestCustomer(selectedAccountId);
        } catch {
          throw reconciliationError("Completed direct TEST customer claim could not be verified");
        }
        if (!existing) throw reconciliationError("Completed direct TEST customer claim has no customer");
        return Object.freeze({
          customer: existing,
          imported: false,
          testDirect: true,
          duplicateProvisioning: true,
        });
      }
      if (claim.outcome !== "claimed") {
        throw reconciliationError("Direct TEST customer claim is unresolved");
      }
      try {
        existing = await findDirectTestCustomer(selectedAccountId);
      } catch (error) {
        await markDirectTestCustomerClaim(
          claim.rowId,
          "failed",
          /^[a-z0-9_]{1,80}$/.test(error?.publicCode)
            ? error.publicCode
            : "billing_dependency_failed",
        );
        throw error;
      }
      if (existing) {
        await markDirectTestCustomerClaim(
          claim.rowId,
          "completed",
          "customer_readback_confirmed",
        );
        return Object.freeze({ customer: existing, imported: false, testDirect: true });
      }
      try {
        await assertDirectTestOrganization();
      } catch (error) {
        await markDirectTestCustomerClaim(
          claim.rowId,
          "failed",
          /^[a-z0-9_]{1,80}$/.test(error?.publicCode)
            ? error.publicCode
            : "billing_dependency_failed",
        );
        throw error;
      }
      let createFailure = null;
      try {
        const response = await authorizedRequest("/customers", {
          method: "POST",
          write: true,
          sideEffecting: true,
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            display_name: identity.displayName,
            company_name: identity.displayName,
            email: identity.email,
            notes: identity.marker,
            is_portal_enabled: false,
            ach_supported: false,
            payment_terms: 0,
          }),
        });
        if (![200, 201].includes(response.status)) {
          createFailure = new BillingClientError(
            "Billing rejected direct TEST customer creation",
            classifyStatus(response.status, true),
          );
        }
      } catch (error) {
        createFailure = error;
      }
      try {
        existing = await findDirectTestCustomer(selectedAccountId);
      } catch {
        const unresolved = reconciliationError(
          "Billing direct TEST customer post-create readback is unresolved",
        );
        await markDirectTestCustomerClaim(
          claim.rowId,
          "reconciliation_required",
          unresolved.publicCode,
        );
        throw unresolved;
      }
      if (existing) {
        await markDirectTestCustomerClaim(
          claim.rowId,
          "completed",
          "customer_readback_confirmed",
        );
        return Object.freeze({ customer: existing, imported: false, testDirect: true });
      }
      if (createFailure instanceof BillingClientError && !createFailure.ambiguous) {
        await markDirectTestCustomerClaim(
          claim.rowId,
          "failed",
          /^[a-z0-9_]{1,80}$/.test(createFailure.publicCode)
            ? createFailure.publicCode
            : "billing_dependency_failed",
        );
        throw createFailure;
      }
      const unresolved = reconciliationError(
        "Billing direct TEST customer creation outcome is unresolved",
      );
      await markDirectTestCustomerClaim(
        claim.rowId,
        "reconciliation_required",
        unresolved.publicCode,
      );
      throw unresolved;
    }
    existing = await findNativeCustomerByCrmReference(selectedAccountId);
    if (existing) return Object.freeze({ customer: existing, imported: false });
    let importFailure = null;
    try {
      const response = await authorizedRequest(`/crm/account/${selectedAccountId}/import`, {
        method: "POST",
        write: true,
        sideEffecting: true,
        headers: { Accept: "application/json" },
      });
      if (![200, 201].includes(response.status)) {
        importFailure = new BillingClientError(
          "Billing rejected CRM Account import",
          classifyStatus(response.status, true),
        );
      }
    } catch (error) {
      importFailure = error;
    }
    existing = await findNativeCustomerByCrmReference(selectedAccountId);
    if (existing) return Object.freeze({ customer: existing, imported: true });
    if (importFailure instanceof BillingClientError && !importFailure.ambiguous) throw importFailure;
    fail("Billing CRM Account import outcome is unresolved", {
      ambiguous: true,
      publicCode: "reconciliation_required",
    });
  }

  async function getPlan(code) {
    const selectedCode = planCode(code);
    const response = await authorizedRequest(`/plans/${selectedCode}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200) fail("Billing rejected plan lookup", classifyStatus(response.status, false));
    const plan = response.json?.plan;
    if (!plainObject(plan) || plan.plan_code !== selectedCode) fail("Billing plan readback is unavailable", {
      publicCode: "billing_state_invalid",
    });
    return plan;
  }

  function assertActivePlan(plan) {
    if (!plainObject(plan) || plan.status !== "active") {
      fail("Billing plan is not active", { publicCode: "billing_state_invalid" });
    }
  }

  function assertEvaluationPlan(plan) {
    assertActivePlan(plan);
    if (
      decimal(plan.recurring_price ?? plan.price, "Evaluation recurring price") !== 0 ||
      decimal(plan.setup_fee, "Evaluation setup fee", { optionalZero: true }) !== 0 ||
      Number(plan.billing_cycles) !== 1 ||
      Number(plan.trial_period) !== config.freeTestDurationDays
    ) fail("Evaluation plan does not prove zero bounded exposure", {
      publicCode: "billing_state_invalid",
    });
  }

  async function findSubscriptionByReference(deterministicReference) {
    const selectedReference = reference(deterministicReference);
    const exactMatches = [];
    for (let page = 1; page <= 25; page += 1) {
      const response = await authorizedRequest("/subscriptions", {
        method: "GET",
        headers: { Accept: "application/json" },
        query: {
          reference_contains: selectedReference,
          page: String(page),
          per_page: "200",
        },
      });
      if (response.status !== 200) {
        fail("Billing rejected subscription lookup", classifyStatus(response.status, false));
      }
      const subscriptions = response.json?.subscriptions;
      const pageContext = response.json?.page_context;
      if (
        !Array.isArray(subscriptions) ||
        subscriptions.some((subscription) => !plainObject(subscription)) ||
        !plainObject(pageContext) ||
        typeof pageContext.has_more_page !== "boolean" ||
        !Number.isInteger(Number(pageContext.page)) ||
        Number(pageContext.page) !== page
      ) fail("Billing subscription pagination is incomplete", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
      exactMatches.push(...subscriptions.filter(
        (subscription) => subscription.reference_id === selectedReference,
      ));
      if (exactMatches.length > 1) fail("Billing subscription reference is not unique", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
      if (!pageContext.has_more_page) return exactMatches[0] ?? null;
    }
    fail("Billing subscription pagination exceeded the reconciliation bound", {
      ambiguous: true,
      publicCode: "reconciliation_required",
    });
  }

  async function getSubscription(subscriptionId) {
    const selectedId = id(subscriptionId, "Billing subscription identifier");
    const response = await authorizedRequest(`/subscriptions/${selectedId}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200) fail("Billing rejected subscription readback", classifyStatus(response.status, false));
    const subscription = response.json?.subscription;
    if (!plainObject(subscription) || String(subscription.subscription_id ?? "") !== selectedId) {
      fail("Billing subscription readback is incomplete", { publicCode: "billing_state_invalid" });
    }
    return subscription;
  }

  function verifySubscription(subscription, {
    customerId,
    deterministicReference,
    selectedPlanCode,
    evaluation,
    startsAt,
    allowedStatuses,
  }) {
    if (!plainObject(subscription)) fail("Billing subscription is unavailable", {
      publicCode: "billing_state_invalid",
    });
    id(subscription.subscription_id, "Billing subscription identifier");
    const returnedCustomerIds = [
      subscription.customer_id,
      subscription.customer?.customer_id,
    ].filter((value) => value !== undefined && value !== null && String(value) !== "")
      .map(String);
    const returnedStartDates = [
      subscription.start_date,
      subscription.starts_at,
      subscription.current_term_starts_at,
    ].filter((value) => typeof value === "string" && value.length > 0);
    const hasNestedCard = plainObject(subscription.card) && Object.keys(subscription.card).length > 0;
    const hasNestedBankAccount = plainObject(subscription.bank_account) &&
      Object.keys(subscription.bank_account).length > 0;
    if (
      !Array.isArray(allowedStatuses) || allowedStatuses.length < 1 ||
      allowedStatuses.some((status) => typeof status !== "string" || !status)
    ) fail("Billing subscription status boundary is invalid", {
      publicCode: "configuration_invalid",
    });
    if (
      returnedCustomerIds.length === 0 || returnedCustomerIds.some((value) => value !== customerId) ||
      subscription.reference_id !== deterministicReference ||
      (subscription.plan?.plan_code ?? subscription.plan_code) !== selectedPlanCode ||
      !allowedStatuses.includes(subscription.status) ||
      subscription.auto_collect !== false ||
      !Array.isArray(subscription.addons) || subscription.addons.length !== 0 ||
      subscription.card_id || subscription.payment_method_id || subscription.payment_source_id ||
      subscription.bank_account_id || hasNestedCard || hasNestedBankAccount ||
      (startsAt && (
        returnedStartDates.length === 0 || returnedStartDates.some((value) => value !== startsAt)
      ))
    ) fail("Billing subscription violates the approved boundary", {
      ambiguous: true,
      publicCode: "reconciliation_required",
    });
    if (evaluation) {
      const amountEvidence = subscription.amount ?? subscription.recurring_price;
      const setupFeeEvidence = subscription.plan?.setup_fee;
      const trialDaysEvidence = subscription.plan?.trial_days;
      const billingCyclesEvidence = subscription.plan?.billing_cycles;
      if (
        amountEvidence === undefined || amountEvidence === null || amountEvidence === "" ||
        setupFeeEvidence === undefined || setupFeeEvidence === null || setupFeeEvidence === "" ||
        !Number.isInteger(Number(trialDaysEvidence)) ||
        Number(trialDaysEvidence) !== config.freeTestDurationDays ||
        !Number.isInteger(Number(billingCyclesEvidence)) ||
        Number(billingCyclesEvidence) !== 1 ||
        decimal(amountEvidence, "Evaluation subscription amount") !== 0 ||
        decimal(setupFeeEvidence, "Evaluation subscription setup fee") !== 0
      ) fail("Evaluation subscription has financial exposure", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
    }
    return subscription;
  }

  async function ensureSubscription({
    customerId,
    deterministicReference,
    selectedPlanCode,
    evaluation,
    subscriptionStartDate,
  }) {
    id(customerId, "Billing customer identifier");
    reference(deterministicReference);
    planCode(selectedPlanCode);
    const plan = await getPlan(selectedPlanCode);
    if (evaluation) assertEvaluationPlan(plan);
    else {
      assertActivePlan(plan);
      if (decimal(plan.recurring_price ?? plan.price, "Paid recurring price") <= 0) {
        fail("Paid plan does not have a positive recurring price", { publicCode: "billing_state_invalid" });
      }
    }

    let subscription = await findSubscriptionByReference(deterministicReference);
    if (!subscription) {
      try {
        const response = await authorizedRequest("/subscriptions", {
          method: "POST",
          write: true,
          sideEffecting: true,
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            customer_id: customerId,
            reference_id: deterministicReference,
            auto_collect: false,
            ...(evaluation ? {} : { starts_at: subscriptionStartDate }),
            plan: evaluation ? {
              plan_code: selectedPlanCode,
              quantity: 1,
              exclude_setup_fee: true,
              billing_cycles: 1,
              trial_days: config.freeTestDurationDays,
            } : { plan_code: selectedPlanCode, quantity: 1 },
          }),
        });
        if (![200, 201].includes(response.status)) fail(
          "Billing rejected subscription creation",
          classifyStatus(response.status, true),
        );
      } catch (error) {
        if (!(error instanceof BillingClientError) || !error.ambiguous) throw error;
      }
      subscription = await findSubscriptionByReference(deterministicReference);
    }
    if (!subscription) fail("Billing subscription creation outcome is unresolved", {
      ambiguous: true,
      publicCode: "reconciliation_required",
    });
    const readback = await getSubscription(subscription.subscription_id);
    return verifySubscription(readback, {
      customerId,
      deterministicReference,
      selectedPlanCode,
      evaluation,
      startsAt: evaluation ? undefined : subscriptionStartDate,
      allowedStatuses: evaluation ? ["trial"] : ["future", "live"],
    });
  }

  const ensureEvaluationSubscription = (input) => ensureSubscription({
    ...input,
    selectedPlanCode: config.evaluationPlanCode,
    evaluation: true,
  });
  const ensurePaidSubscription = (input) => ensureSubscription({ ...input, evaluation: false });

  async function findVerifiedEvaluationSubscription({ customerId, deterministicReference }) {
    const selectedCustomerId = id(customerId, "Billing customer identifier");
    const selectedReference = reference(deterministicReference);
    const candidate = await findSubscriptionByReference(selectedReference);
    if (!candidate) return null;
    const readback = await getSubscription(candidate.subscription_id);
    return verifySubscription(readback, {
      customerId: selectedCustomerId,
      deterministicReference: selectedReference,
      selectedPlanCode: config.evaluationPlanCode,
      evaluation: true,
      allowedStatuses: ["trial", "live", "cancelled", "expired", "trial_expired"],
    });
  }

  async function cancelEvaluation({ subscriptionId, customerId, deterministicReference }) {
    const selectedId = id(subscriptionId, "Billing subscription identifier");
    const selectedCustomerId = id(customerId, "Billing customer identifier");
    const selectedReference = reference(deterministicReference);
    const terminalStatuses = ["cancelled", "expired", "trial_expired"];
    const before = await getSubscription(selectedId);
    verifySubscription(before, {
      customerId: selectedCustomerId,
      deterministicReference: selectedReference,
      selectedPlanCode: config.evaluationPlanCode,
      evaluation: true,
      allowedStatuses: ["trial", "live", ...terminalStatuses],
    });
    if (terminalStatuses.includes(before.status)) return before;
    try {
      const response = await authorizedRequest(`/subscriptions/${selectedId}/cancel`, {
        method: "POST",
        write: true,
        sideEffecting: true,
        query: { cancel_at_end: "false" },
        headers: { Accept: "application/json" },
      });
      if (![200, 201].includes(response.status)) fail(
        "Billing rejected evaluation cancellation",
        classifyStatus(response.status, true),
      );
    } catch (error) {
      if (!(error instanceof BillingClientError) || !error.ambiguous) throw error;
    }
    const readback = await getSubscription(selectedId);
    return verifySubscription(readback, {
      customerId: selectedCustomerId,
      deterministicReference: selectedReference,
      selectedPlanCode: config.evaluationPlanCode,
      evaluation: true,
      allowedStatuses: terminalStatuses,
    });
  }

  return Object.freeze({
    cancelEvaluation,
    ensureCustomer,
    ensureEvaluationSubscription,
    ensurePaidSubscription,
    findCustomerByCrmReference,
    findSubscriptionByReference,
    findVerifiedEvaluationSubscription,
    getPlan,
    getSubscription,
  });
}

module.exports = {
  BillingClientError,
  REFERENCE,
  createBillingClient,
  directTestCustomerIdentity,
};
