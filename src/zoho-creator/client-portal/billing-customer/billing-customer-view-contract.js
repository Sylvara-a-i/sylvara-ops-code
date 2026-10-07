"use strict";

const { assertCompanyIdentity } = require("../company-settings-requests/service-area-request-contract");
const PROVIDERS = Object.freeze(["google_sheets", "csv", "jobber"]);

function deny() { throw new TypeError("Invalid billing customer view evidence"); }

function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) deny();
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) deny();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
  }
}

function array(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1) deny();
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
  }
}

function id(value) {
  if (typeof value !== "string" || !value || value !== value.trim() ||
      /[\u0000-\u0020\u007f]/.test(value)) deny();
}

function label(value) {
  if (typeof value !== "string" || value !== value.trim() ||
      !/^[A-Za-z0-9][A-Za-z0-9 &()/.-]{0,79}$/.test(value)) deny();
}

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) deny();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) deny();
  return ms;
}

function date(value) {
  if (value === null) return;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) deny();
  timestamp(value + "T00:00:00.000Z");
}

function fresh(value, asOf, maxAgeMs) {
  const observed = timestamp(value);
  if (observed > asOf || asOf - observed > maxAgeMs) deny();
}

function minor(value) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0))) deny();
}

function money(value, exponents) {
  record(value, ["totalMinor", "balanceMinor", "amountUnit", "currency"]);
  minor(value.totalMinor); minor(value.balanceMinor);
  if (value.amountUnit !== null && value.amountUnit !== "minor") deny();
  if (value.amountUnit === null && (value.totalMinor !== null || value.balanceMinor !== null)) deny();
  let currency = null;
  if (value.currency !== null) {
    record(value.currency, ["code", "minorUnitExponent", "source"]);
    const c = value.currency;
    if (typeof c.code !== "string" || !/^[A-Z]{3}$/.test(c.code) ||
        !Number.isSafeInteger(c.minorUnitExponent) || c.minorUnitExponent < 0 || c.minorUnitExponent > 4 ||
        !["invoice-response", "verified-invoice-metadata"].includes(c.source)) deny();
    if (exponents.has(c.code) && exponents.get(c.code) !== c.minorUnitExponent) deny();
    exponents.set(c.code, c.minorUnitExponent);
    currency = Object.freeze({ code: c.code, minorUnitExponent: c.minorUnitExponent, source: c.source });
  }
  const available = currency !== null && value.amountUnit === "minor";
  return Object.freeze({
    totalMinor: available ? value.totalMinor : null,
    balanceMinor: available ? value.balanceMinor : null,
    amountUnit: available ? "minor" : null, currency,
  });
}

function collection(value, project, uniqueKey) {
  if (value === null) return Object.freeze({ state: "unknown", items: null });
  record(value, ["complete", "items"]);
  if (value.complete !== true) deny();
  array(value.items);
  const seen = new Set();
  const items = value.items.map((item) => {
    const projected = project(item);
    const key = uniqueKey(item);
    if (seen.has(key)) deny();
    seen.add(key);
    return projected;
  });
  return Object.freeze({ state: items.length ? "available" : "empty", items: Object.freeze(items) });
}

// Pure consistency projection, NOT an authenticator or permission engine.
// The server must independently establish session identity, complete company
// mappings, operation permission, bindings and source provenance before calling.
// Passing these ordinary objects cannot establish any of those prerequisites.
function prepareBillingCustomerView(input, trusted, evidence, policy) {
  record(input, ["Account"]);
  record(policy, ["expectedEnvironment", "expectedOrganizationId", "asOf", "maxAgeMs",
    "featureCode", "featurePolicyRevision"]);
  if (!["development", "stage", "production"].includes(policy.expectedEnvironment) ||
      !Number.isSafeInteger(policy.maxAgeMs) || policy.maxAgeMs < 0) deny();
  id(policy.expectedOrganizationId); id(policy.featureCode); id(policy.featurePolicyRevision);
  const asOf = timestamp(policy.asOf);
  record(trusted, ["environment", "organizationId", "observedAt", "complete", "company", "readGrant", "billingBinding"]);
  if (trusted.environment !== policy.expectedEnvironment || trusted.organizationId !== policy.expectedOrganizationId ||
      trusted.complete !== true) deny();
  fresh(trusted.observedAt, asOf, policy.maxAgeMs);
  // Validate array descriptors before the shared company validator iterates.
  record(trusted.company, ["principalId", "contact", "companyMappings", "auditActorId"]);
  array(trusted.company.companyMappings);
  const accountId = assertCompanyIdentity(trusted.company, input.Account);
  const crmAccountId = trusted.company.contact.accountId;
  record(trusted.readGrant, ["principalId", "creatorAccountId", "operation", "active"]);
  const grant = trusted.readGrant;
  if (grant.principalId !== trusted.company.principalId || grant.creatorAccountId !== accountId ||
      grant.operation !== "billing.read" || grant.active !== true) deny();
  record(evidence, ["environment", "organizationId", "observedAt", "complete",
    "customer", "subscriptions", "invoices", "integrations"]);
  if (evidence.environment !== policy.expectedEnvironment ||
      evidence.organizationId !== policy.expectedOrganizationId || evidence.complete !== true) deny();
  fresh(evidence.observedAt, asOf, policy.maxAgeMs);
  let customerId = null;
  if (trusted.billingBinding !== null) {
    record(trusted.billingBinding, ["creatorAccountId", "crmAccountId", "organizationId", "customerId"]);
    const binding = trusted.billingBinding;
    id(binding.customerId);
    if (binding.creatorAccountId !== accountId || binding.crmAccountId !== crmAccountId ||
        binding.organizationId !== policy.expectedOrganizationId) deny();
    if (evidence.customer !== null) {
      record(evidence.customer, ["customerId", "crmAccountId"]);
      if (evidence.customer.customerId !== binding.customerId ||
          evidence.customer.crmAccountId !== crmAccountId) deny();
      customerId = binding.customerId;
    }
  } else if (evidence.customer !== null) deny();
  // An unresolved customer cannot certify empty or available customer resources.
  if (customerId === null && [evidence.subscriptions, evidence.invoices, evidence.integrations].some((v) => v !== null)) deny();
  const subscriptionIds = new Set();
  const subscriptions = collection(evidence.subscriptions, (item) => {
    record(item, ["subscriptionId", "customerId", "status", "planCode", "planLabel", "termStart", "termEnd"]);
    id(item.subscriptionId); id(item.planCode); label(item.planLabel);
    if (item.customerId !== customerId || !["active", "live", "trial", "future", "past_due", "unpaid",
      "non_renewing", "cancelled", "expired", "trial_expired", "unknown"].includes(item.status)) deny();
    date(item.termStart); date(item.termEnd);
    if (item.termStart !== null && item.termEnd !== null && item.termEnd < item.termStart) deny();
    subscriptionIds.add(item.subscriptionId);
    return Object.freeze({ status: item.status, planLabel: item.planLabel,
      termStart: item.termStart, termEnd: item.termEnd });
  }, (item) => item.subscriptionId);
  const exponents = new Map();
  const invoices = collection(evidence.invoices, (item) => {
    record(item, ["invoiceId", "customerId", "number", "status", "issuedOn", "dueOn", "money"]);
    id(item.invoiceId); label(item.number);
    if (item.customerId !== customerId ||
        !["draft", "sent", "paid", "partially_paid", "overdue", "void", "unpaid", "unknown"].includes(item.status)) deny();
    date(item.issuedOn); date(item.dueOn);
    return Object.freeze({ number: item.number, status: item.status, issuedOn: item.issuedOn,
      dueOn: item.dueOn, money: money(item.money, exponents) });
  }, (item) => item.invoiceId);
  const integrations = collection(evidence.integrations, (item) => {
    record(item, ["provider", "featureGrant", "connection"]);
    if (!PROVIDERS.includes(item.provider)) deny();
    let eligibility = "unknown";
    if (item.featureGrant !== null) {
      record(item.featureGrant, ["provider", "customerId", "subscriptionId", "featureCode", "policyRevision",
        "decision", "observedAt", "validUntil"]);
      const feature = item.featureGrant;
      if (feature.provider !== item.provider || feature.customerId !== customerId || !subscriptionIds.has(feature.subscriptionId) ||
          feature.featureCode !== policy.featureCode || feature.policyRevision !== policy.featurePolicyRevision ||
          !["eligible", "ineligible"].includes(feature.decision)) deny();
      fresh(feature.observedAt, asOf, policy.maxAgeMs);
      if (timestamp(feature.observedAt) > timestamp(evidence.observedAt)) deny();
      if (timestamp(feature.validUntil) <= asOf || timestamp(feature.validUntil) <= timestamp(feature.observedAt)) deny();
      eligibility = feature.decision;
    }
    let authorizationStatus = "unknown", connectionStatus = "unknown", destinationConfigured = null, dataScope = null;
    if (item.connection !== null) {
      record(item.connection, ["creatorAccountId", "provider", "authorizationStatus",
        "connectionStatus", "destinationConfigured", "dataScope", "observedAt"]);
      const connection = item.connection;
      if (connection.creatorAccountId !== accountId || connection.provider !== item.provider ||
          !["authorized", "revoked", "not_authorized"].includes(connection.authorizationStatus) ||
          !["connected", "disconnected", "degraded"].includes(connection.connectionStatus) ||
          typeof connection.destinationConfigured !== "boolean") deny();
      fresh(connection.observedAt, asOf, policy.maxAgeMs);
      if (timestamp(connection.observedAt) > timestamp(evidence.observedAt)) deny();
      array(connection.dataScope);
      const scopes = new Set();
      for (const scope of connection.dataScope) { label(scope); if (scopes.has(scope)) deny(); scopes.add(scope); }
      authorizationStatus = connection.authorizationStatus;
      connectionStatus = connection.connectionStatus;
      destinationConfigured = connection.destinationConfigured;
      dataScope = Object.freeze([...connection.dataScope]);
    }
    // These are independent facts. Neither eligibility nor a connected provider
    // grants OAuth, destination edits, provisioning, or delivery authority.
    return Object.freeze({ provider: item.provider, eligibility, authorizationStatus,
      connectionStatus, destinationConfigured, dataScope });
  }, (item) => item.provider);
  return Object.freeze({
    environment: evidence.environment, observedAt: evidence.observedAt,
    customerState: customerId === null ? "unknown" : "verified",
    subscriptions, invoices, integrations,
  });
}

module.exports = { prepareBillingCustomerView };
