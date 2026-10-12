"use strict";

const { prepareBillingCustomerHistoryView, BILLING_HISTORY_STATUSES } = require("./billing-customer-view-contract");
const DEFAULT_FILTERS = Object.freeze({ invoiceStatus: "all", paymentStatus: "all" });

function validateFilters(filters) {
  const keys = ["invoiceStatus", "paymentStatus"];
  const deny = () => { throw new TypeError("Invalid billing history filters"); };
  if (!filters || typeof filters !== "object" || Array.isArray(filters) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(filters))) deny();
  const actual = Reflect.ownKeys(filters);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) deny();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(filters, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) deny();
  }
  if (filters.invoiceStatus !== "all" && !BILLING_HISTORY_STATUSES.invoice.includes(filters.invoiceStatus)) deny();
  if (filters.paymentStatus !== "all" && !BILLING_HISTORY_STATUSES.payment.includes(filters.paymentStatus)) deny();
}

function select(collection, statusFilter) {
  const items = collection.items === null ? null : Object.freeze(
    collection.items.filter((item) => statusFilter === "all" || item.status === statusFilter));
  return Object.freeze({
    sourceState: collection.state,
    state: collection.state === "available" && items.length === 0 ? "no_matches" : collection.state,
    statusFilter,
    items,
  });
}

// Display filtering only. The existing history contract validates every row
// before selection; filters never establish identity, permission or entitlement.
function prepareBillingHistoryListView(input, trusted, evidence, policy, filters = DEFAULT_FILTERS) {
  validateFilters(filters);
  const view = prepareBillingCustomerHistoryView(input, trusted, evidence, policy);
  return Object.freeze({
    ...view,
    invoices: select(view.invoices, filters.invoiceStatus),
    payments: select(view.payments, filters.paymentStatus),
  });
}

module.exports = { prepareBillingHistoryListView };
