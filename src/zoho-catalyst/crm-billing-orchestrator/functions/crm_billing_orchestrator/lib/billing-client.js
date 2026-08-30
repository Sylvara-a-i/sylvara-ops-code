"use strict";

const crypto = require("node:crypto");
const { HttpBoundaryError, requestJson } = require("./http");
const {
  TEST_CUSTOMER_PROVISIONING_ACTION,
  deriveTestCustomerProvisioningIdentity,
} = require("./idempotency");
const {
  containsCommercialTerms,
  moneyMinor,
} = require("./commercial-terms");

const RECORD_ID = /^[1-9][0-9]{7,29}$/;
const PLAN_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const REFERENCE = /^syl-paid-[a-f0-9]{32}$/;
const TEST_CUSTOMER_MARKER = /^syl-test-customer-[a-f0-9]{32}$/;
const TEST_CUSTOMER_IDENTITY_DOMAIN = "sylvara.crm-billing.test-customer.v1";

class BillingClientError extends Error {
  constructor(message, {
    ambiguous = false,
    publicCode = "billing_dependency_failed",
    status = 503,
  } = {}) {
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
    .update(
      `${TEST_CUSTOMER_IDENTITY_DOMAIN}\0${config.deploymentEnvironment}\0${selectedAccountId}`,
    )
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

function calendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed
    : null;
}

function authorization(value) {
  if (typeof value !== "string" || !/^Zoho-oauthtoken [A-Za-z0-9._-]{16,4096}$/.test(value)) {
    fail("Billing Connection authorization is invalid", { publicCode: "connection_unavailable" });
  }
  return value;
}

function classifyStatus(status, sideEffecting) {
  if (!sideEffecting && retryableReadStatus(status)) {
    return { publicCode: "billing_dependency_failed", status: 503 };
  }
  if (!sideEffecting || [400, 401, 403, 404, 409, 422].includes(status)) {
    return { publicCode: "billing_rejected", status: 502 };
  }
  return { ambiguous: true, publicCode: "reconciliation_required", status: 503 };
}

function retryableReadStatus(status) {
  return new Set([408, 425, 429, 500, 502, 503, 504]).has(status);
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
    const maximumAttempts = sideEffecting ? 1 : 2;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      let token;
      try {
        token = authorization(await (write ? writeAuthorizationProvider() : readAuthorizationProvider()));
      } catch (error) {
        if (attempt < maximumAttempts) continue;
        if (error instanceof BillingClientError) throw error;
        fail("Billing Connection is unavailable", { publicCode: "connection_unavailable" });
      }
      try {
        const response = await requestJson(url.toString(), {
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
        if (attempt < maximumAttempts && retryableReadStatus(response.status)) continue;
        return response;
      } catch (error) {
        if (attempt < maximumAttempts && error instanceof HttpBoundaryError) continue;
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
    fail("Billing read retry boundary was exhausted", { publicCode: "billing_dependency_failed" });
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

  async function findCustomerByCrmReference(crmAccountId) {
    return findDirectTestCustomer(crmAccountId);
  }

  async function ensureCustomer({ crmAccountId }) {
    const selectedAccountId = id(crmAccountId, "CRM Account identifier");
    const identity = directTestCustomerIdentity(config, selectedAccountId);
    const operationIdentity = deriveTestCustomerProvisioningIdentity(config, selectedAccountId);
    // All fallible read-only checks happen before the durable mutation claim. A transient
    // dependency failure can therefore be retried without leaving an unresolved claim.
    let existing = await findDirectTestCustomer(selectedAccountId);
    const claim = await operationStore.claim({
      operationKey: operationIdentity.operationKey,
      operationFingerprint: operationIdentity.operationFingerprint,
      action: TEST_CUSTOMER_PROVISIONING_ACTION,
      scopeId: selectedAccountId,
    });
    if (claim.outcome === "duplicate-completed") {
      if (!existing) throw reconciliationError("Completed direct TEST customer claim has no customer");
      return Object.freeze({
        customer: existing,
        created: false,
        imported: false,
        testDirect: true,
        duplicateProvisioning: true,
      });
    }
    if (claim.outcome !== "claimed") {
      throw reconciliationError("Direct TEST customer claim is unresolved");
    }
    if (existing) {
      await markDirectTestCustomerClaim(
        claim.rowId,
        "completed",
        "customer_readback_confirmed",
      );
      return Object.freeze({
        customer: existing,
        created: false,
        imported: false,
        testDirect: true,
      });
    }
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
      // A response is not authoritative after a write. The deterministic readback below is.
      void response;
    } catch {
      // The request may have committed. Resolve only through deterministic readback.
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
      return Object.freeze({
        customer: existing,
        created: true,
        imported: false,
        testDirect: true,
      });
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

  async function getAddon(code) {
    const selectedCode = planCode(code);
    const response = await authorizedRequest(`/addons/${selectedCode}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200) fail(
      "Billing rejected usage add-on lookup",
      classifyStatus(response.status, false),
    );
    const addon = response.json?.addon;
    if (!plainObject(addon) || addon.addon_code !== selectedCode) {
      fail("Billing usage add-on readback is unavailable", {
        publicCode: "billing_state_invalid",
      });
    }
    return addon;
  }

  function exactMoney(value, expectedMinor, name, { ambiguous = false } = {}) {
    if (moneyMinor(value) !== expectedMinor) {
      fail(`${name} does not match the approved commercial terms`, {
        ambiguous,
        publicCode: "billing_state_invalid",
      });
    }
  }

  function assertPaidPlan(plan, selectedPlanCode, commercialTerms, expectedProductId) {
    if (
      !plainObject(plan) ||
      !containsCommercialTerms(config.paidCommercialTerms, commercialTerms) ||
      plan.plan_code !== selectedPlanCode ||
      plan.status !== "active" ||
      plan.currency_code !== config.paidCommercialTerms.currency ||
      String(plan.product_id ?? "") !== expectedProductId ||
      Number(plan.interval) !== config.paidCommercialTerms.interval ||
      plan.interval_unit !== config.paidCommercialTerms.intervalUnit ||
      Number(plan.trial_period ?? 0) !== 0
    ) fail("Billing paid plan does not match the approved catalog", {
      publicCode: "billing_state_invalid",
    });
    exactMoney(
      plan.recurring_price ?? plan.price,
      commercialTerms.recurringMinor,
      "Billing recurring price",
    );
    exactMoney(plan.setup_fee, commercialTerms.setupMinor, "Billing setup fee");
    return plan;
  }

  function assertUsageAddon(addon, selectedAddonCode, expectedUnit, expectedProductId) {
    const brackets = addon?.price_brackets;
    const bracket = Array.isArray(brackets) && brackets.length === 1 ? brackets[0] : null;
    if (
      !plainObject(addon) ||
      addon.addon_code !== selectedAddonCode ||
      addon.status !== "active" ||
      addon.type !== "recurring" ||
      addon.is_usage_supported !== true ||
      addon.pricing_scheme !== "unit" ||
      addon.currency_code !== config.paidCommercialTerms.currency ||
      Number(addon.interval) !== config.paidCommercialTerms.interval ||
      addon.interval_unit !== config.paidCommercialTerms.intervalUnit ||
      addon.unit !== expectedUnit ||
      String(addon.product_id ?? "") !== expectedProductId ||
      !plainObject(bracket) || Number(bracket.start_quantity) !== 1
    ) fail("Billing usage add-on does not prove the approved metered contract", {
      publicCode: "billing_state_invalid",
    });
    exactMoney(
      bracket.price,
      config.paidCommercialTerms.commonUsageRateMinor,
      "Billing connected-minute rate",
    );
    return addon;
  }

  async function readPaidCatalog(selectedPlanCode, commercialTerms) {
    await assertDirectTestOrganization();
    const plan = assertPaidPlan(
      await getPlan(selectedPlanCode),
      selectedPlanCode,
      commercialTerms,
      config.paidUsageAddonProductId,
    );
    const addon = assertUsageAddon(
      await getAddon(config.paidUsageAddonCode),
      config.paidUsageAddonCode,
      config.paidUsageAddonUnit,
      config.paidUsageAddonProductId,
    );
    return Object.freeze({ plan, addon });
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

  function verifyPaidSubscription(subscription, {
    customerId,
    deterministicReference,
    selectedPlanCode,
    commercialTerms,
    startsAt,
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
    const originalStartDates = [
      subscription.start_date,
      subscription.starts_at,
    ].filter((value) => typeof value === "string" && value.length > 0);
    const expectedStartAt = calendarDate(startsAt);
    const currentTermValue = subscription.current_term_starts_at;
    const currentTermStart = currentTermValue === undefined || currentTermValue === null || currentTermValue === ""
      ? null
      : calendarDate(currentTermValue);
    const hasNestedCard = plainObject(subscription.card) && Object.keys(subscription.card).length > 0;
    const hasNestedBankAccount = plainObject(subscription.bank_account) &&
      Object.keys(subscription.bank_account).length > 0;
    const subscriptionPlan = subscription.plan;
    const subscriptionAddons = subscription.addons;
    const usageAddon = Array.isArray(subscriptionAddons) && subscriptionAddons.length === 1
      ? subscriptionAddons[0]
      : null;
    const hasCoupon = Boolean(
      subscription.coupon_id || subscription.coupon_code || subscription.coupon ||
      (Array.isArray(subscription.coupons) && subscription.coupons.length),
    );
    const hasDiscount = Boolean(
      subscription.discount ||
      (Array.isArray(subscription.discounts) && subscription.discounts.length),
    );
    if (
      returnedCustomerIds.length === 0 || returnedCustomerIds.some((value) => value !== customerId) ||
      subscription.reference_id !== deterministicReference ||
      String(subscription.product_id ?? "") !== config.paidUsageAddonProductId ||
      !plainObject(subscriptionPlan) || subscriptionPlan.plan_code !== selectedPlanCode ||
      !Object.hasOwn(config.paidSubscriptionStatusMap, subscription.status) ||
      subscription.auto_collect !== false ||
      !plainObject(usageAddon) || usageAddon.addon_code !== config.paidUsageAddonCode ||
      Number(usageAddon.quantity) !== 1 ||
      usageAddon.unit !== config.paidUsageAddonUnit ||
      subscription.card_id || subscription.payment_method_id || subscription.payment_source_id ||
      subscription.bank_account_id || hasNestedCard || hasNestedBankAccount ||
      hasCoupon || hasDiscount ||
      subscription.trial_end || Number(subscription.trial_remaining_days ?? 0) !== 0 ||
      expectedStartAt === null ||
      originalStartDates.length === 0 || originalStartDates.some((value) => value !== startsAt) ||
      (currentTermValue !== undefined && currentTermValue !== null && currentTermValue !== "" && (
        currentTermStart === null || currentTermStart < expectedStartAt
      ))
    ) fail("Billing subscription violates the approved boundary", {
      ambiguous: true,
      publicCode: "reconciliation_required",
    });
    exactMoney(
      subscriptionPlan.recurring_price ?? subscriptionPlan.price,
      commercialTerms.recurringMinor,
      "Subscription recurring price",
      { ambiguous: true },
    );
    exactMoney(
      subscriptionPlan.setup_fee,
      commercialTerms.setupMinor,
      "Subscription setup fee",
      { ambiguous: true },
    );
    exactMoney(
      usageAddon.price,
      config.paidCommercialTerms.commonUsageRateMinor,
      "Subscription connected-minute rate",
      { ambiguous: true },
    );
    if (
      subscription.currency_code !== config.paidCommercialTerms.currency ||
      Number(subscriptionPlan.interval) !== config.paidCommercialTerms.interval ||
      subscriptionPlan.interval_unit !== config.paidCommercialTerms.intervalUnit
    ) fail("Billing subscription commercial readback is incomplete", {
      ambiguous: true,
      publicCode: "reconciliation_required",
    });
    return subscription;
  }

  async function ensurePaidSubscription({
    customerId,
    deterministicReference,
    selectedPlanCode,
    commercialTerms,
    subscriptionStartDate,
  }) {
    id(customerId, "Billing customer identifier");
    reference(deterministicReference);
    planCode(selectedPlanCode);
    if (!containsCommercialTerms(config.paidCommercialTerms, commercialTerms)) {
      fail("Paid commercial terms are invalid", { publicCode: "configuration_invalid" });
    }
    await readPaidCatalog(selectedPlanCode, commercialTerms);

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
            starts_at: subscriptionStartDate,
            plan: { plan_code: selectedPlanCode, quantity: 1 },
            addons: [{ addon_code: config.paidUsageAddonCode, quantity: 1 }],
          }),
        });
        // A response is not authoritative after a write. The deterministic readback below is.
        void response;
      } catch {
        // The request may have committed. Resolve only through deterministic readback.
      }
      try {
        subscription = await findSubscriptionByReference(deterministicReference);
      } catch {
        fail("Billing subscription post-create readback is unresolved", {
          ambiguous: true,
          publicCode: "reconciliation_required",
        });
      }
    }
    if (!subscription) fail("Billing subscription creation outcome is unresolved", {
      ambiguous: true,
      publicCode: "reconciliation_required",
    });
    const readback = await getSubscription(subscription.subscription_id);
    try {
      // A second catalog read detects a plan or meter edit racing the subscription create.
      await readPaidCatalog(selectedPlanCode, commercialTerms);
      return verifyPaidSubscription(readback, {
        customerId,
        deterministicReference,
        selectedPlanCode,
        commercialTerms,
        startsAt: subscriptionStartDate,
      });
    } catch (error) {
      if (error instanceof BillingClientError && error.ambiguous) throw error;
      fail("Paid subscription post-create readback requires reconciliation", {
        ambiguous: true,
        publicCode: "reconciliation_required",
      });
    }
  }

  async function findVerifiedPaidSubscription({
    customerId,
    deterministicReference,
    selectedPlanCode,
    commercialTerms,
    subscriptionStartDate,
  }) {
    const selectedCustomerId = id(customerId, "Billing customer identifier");
    const selectedReference = reference(deterministicReference);
    planCode(selectedPlanCode);
    if (!containsCommercialTerms(config.paidCommercialTerms, commercialTerms)) {
      fail("Paid commercial terms are invalid", { publicCode: "configuration_invalid" });
    }
    await readPaidCatalog(selectedPlanCode, commercialTerms);
    const candidate = await findSubscriptionByReference(selectedReference);
    if (!candidate) return null;
    const readback = await getSubscription(candidate.subscription_id);
    return verifyPaidSubscription(readback, {
      customerId: selectedCustomerId,
      deterministicReference: selectedReference,
      selectedPlanCode,
      commercialTerms,
      startsAt: subscriptionStartDate,
    });
  }

  return Object.freeze({
    ensureCustomer,
    ensurePaidSubscription,
    findCustomerByCrmReference,
    findSubscriptionByReference,
    findVerifiedPaidSubscription,
    getAddon,
    getPlan,
    getSubscription,
    readPaidCatalog,
  });
}

module.exports = {
  BillingClientError,
  REFERENCE,
  createBillingClient,
  directTestCustomerIdentity,
};
