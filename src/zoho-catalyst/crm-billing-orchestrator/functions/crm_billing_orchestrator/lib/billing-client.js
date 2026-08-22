"use strict";

const { HttpBoundaryError, requestJson } = require("./http");

const RECORD_ID = /^[1-9][0-9]{7,29}$/;
const PLAN_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const REFERENCE = /^syl-(?:customer|evaluation|paid)-[a-f0-9]{32}$/;

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
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof readAuthorizationProvider !== "function" || typeof writeAuthorizationProvider !== "function") {
    fail("Billing authorization providers are unavailable", { publicCode: "configuration_invalid" });
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

  async function findCustomerByCrmReference(crmAccountId) {
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
    if (
      customer.zcrm_account_id !== undefined &&
      String(customer.zcrm_account_id) !== selectedAccountId
    ) {
      fail("Billing customer reference readback does not match", { publicCode: "billing_state_invalid" });
    }
    return customer;
  }

  async function ensureCustomer({ crmAccountId }) {
    const selectedAccountId = id(crmAccountId, "CRM Account identifier");
    let existing = await findCustomerByCrmReference(selectedAccountId);
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
    existing = await findCustomerByCrmReference(selectedAccountId);
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
  }) {
    if (!plainObject(subscription)) fail("Billing subscription is unavailable", {
      publicCode: "billing_state_invalid",
    });
    id(subscription.subscription_id, "Billing subscription identifier");
    if (
      String(subscription.customer_id ?? "") !== customerId ||
      subscription.reference_id !== deterministicReference ||
      (subscription.plan?.plan_code ?? subscription.plan_code) !== selectedPlanCode ||
      subscription.auto_collect !== false ||
      !Array.isArray(subscription.addons) || subscription.addons.length !== 0 ||
      subscription.card_id || subscription.payment_method_id || subscription.payment_source_id
    ) fail("Billing subscription violates the approved boundary", {
      ambiguous: true,
      publicCode: "reconciliation_required",
    });
    if (evaluation && decimal(
      subscription.amount ?? subscription.recurring_price ?? 0,
      "Evaluation subscription amount",
    ) !== 0) fail("Evaluation subscription has financial exposure", {
      ambiguous: true,
      publicCode: "reconciliation_required",
    });
    return subscription;
  }

  async function ensureSubscription({ customerId, deterministicReference, selectedPlanCode, evaluation }) {
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
    });
  }

  const ensureEvaluationSubscription = (input) => ensureSubscription({
    ...input,
    selectedPlanCode: config.evaluationPlanCode,
    evaluation: true,
  });
  const ensurePaidSubscription = (input) => ensureSubscription({ ...input, evaluation: false });

  async function cancelEvaluation(subscriptionId) {
    const selectedId = id(subscriptionId, "Billing subscription identifier");
    const before = await getSubscription(selectedId);
    if (new Set(["cancelled", "expired"]).has(before.status)) return before;
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
    if (!new Set(["cancelled", "expired"]).has(readback.status)) {
      fail("Billing evaluation cancellation outcome is unresolved", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
    }
    return readback;
  }

  return Object.freeze({
    cancelEvaluation,
    ensureCustomer,
    ensureEvaluationSubscription,
    ensurePaidSubscription,
    findCustomerByCrmReference,
    findSubscriptionByReference,
    getPlan,
    getSubscription,
  });
}

module.exports = { BillingClientError, REFERENCE, createBillingClient };
