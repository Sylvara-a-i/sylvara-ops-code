# Billing customer read-context projection

Status: **proposed source-only preparation**, synthetic tests. No authenticated
portal, server adapter, provider call, durable grant, deployment or customer
delivery is implemented. Passing the checks proves projected-fact consistency
only. It never proves that an ordinary JavaScript payload is trusted.

## Ownership and boundaries

CRM remains authoritative for the contact/company relationship. Independently
verified company-operation grants control visibility. Billing owns customer,
subscription, plan and invoice facts. A separately approved explicit feature
policy owns integration eligibility. A company-bound provider connection record
owns authorization, connection health and approved data scope. None substitutes
for another.

The existing Billing & Plans catalog contract and output shape are preserved.
A separately identified pre-existing bug is repaired by explicitly copying its
three validated currency fields, including non-enumerable data fields, instead
of object spread; a seven-combination regression covers that minimal repair.
This module is a separate customer read projection, not the paid-conversion orchestrator. It does
not reuse that orchestrator's TEST-only customer lookup or its write-capable
client. It never provisions a customer, subscription, invoice or integration.

The client sees subscription/plan/invoice facts and Connected Systems status/data
scope. Integration mapping/configuration belongs in Gabriel's managed operator
wizard. No client mapping-edit permission is implied. Security authorization and
reconnect are separate future protected flows, not implemented or enabled here.
There is no new role policy and no mapping from Admin/Billing Only/Member to
operations.

## Input contract

prepareBillingCustomerView(input, trusted, evidence, policy) accepts exact plain
data shapes; unknown, symbol, inherited and accessor fields are rejected.

- input is exactly { Account }. This is a Creator account selector, not identity.
- policy is { expectedEnvironment, expectedOrganizationId, asOf, maxAgeMs,
  featureCode, featurePolicyRevision }. These are independently supplied server
  policy, not request parameters. No freshness duration or commercial feature
  code is selected here.
- trusted contains { environment, organizationId, observedAt, complete, company,
  readGrant, billingBinding }. The server must independently establish fresh,
  complete facts in the pinned environment/organization before constructing it.
- company is the existing company-context semantic projection: { principalId,
  contact: { id, accountId }, companyMappings: [{ creatorAccountId, crmAccountId,
  active }], auditActorId }. The shared assertion export from the existing service-area module requires
  exactly one active match
  for the selector and exact CRM Contact.Account_Name equality. The service-area planner retains its separate baseline requirement and existing
  public API. Its module remains standalone; no new import is required by its
  existing VM consumers.
- readGrant is { principalId, creatorAccountId, operation: "billing.read",
  active: true }. This checks that independently obtained read permission is
  scoped consistently. It does not issue permission, verify a session or infer
  anything from a role name. billing.read is a proposed contract operation.
- billingBinding is null (unknown/unmapped) or { creatorAccountId, crmAccountId,
  organizationId, customerId }. Every identifier must join exactly.
- evidence is { environment, organizationId, observedAt, complete, customer,
  subscriptions, invoices, integrations }. customer is null or exactly
  { customerId, crmAccountId }. It must match the independent binding.

Both top-level envelopes require complete=true and canonical UTC observation
timestamps. A Boolean does not prove pagination, join completeness or provenance:
the producer must actually establish those facts. Stale, future, wrong-tenant,
wrong-environment and inconsistent evidence rejects with a non-sensitive error.
There is no fallback to email, company name, Deal or Primary_Contact matching.

Each resource collection is null (unknown), or { complete: true, items: [...] }.
An empty complete array produces state=empty; null produces state=unknown with
items=null. Empty is never a transport-error fallback. With no verified customer,
all collections must remain unknown. A verified customer may have independently
unknown collections.

Subscription items contain { subscriptionId, customerId, status, planCode,
planLabel, termStart, termEnd }. Multiple subscriptions remain a collection;
nothing chooses a primary subscription. Dates are canonical calendar dates or
null; known terms cannot be reversed. Provider statuses must be deliberately
normalized by the producer to the module's allowlist, otherwise stay unknown or
be rejected. Subscription status alone never computes eligibility.

Invoice items contain { invoiceId, customerId, number, status, issuedOn, dueOn,
money }. All invoice owners must match the bound customer. money is exactly
{ totalMinor, balanceMinor, amountUnit, currency }, using nonnegative safe-integer
minor units or null. Currency is null or { code, minorUnitExponent, source } with
source invoice-response or verified-invoice-metadata. Unknown currency suppresses
both amounts and the unit. Unknown unit requires null amounts. No floating-point
conversion, USD default, currency conversion, payment URL or invoice download is
provided. Currency syntax is not proof of a valid source currency.

Integration items contain { provider, featureGrant, connection }. Only the initial
internal labels google_sheets, csv and jobber are accepted. HCP, Workiz and Excel
remain qualified-later; ServiceTitan is excluded. An absent provider row is not
evidence of ineligibility, disconnection or support. Empty integration evidence
means no observed entries, not a paid-plan restriction.

- featureGrant is null, or { provider, customerId, subscriptionId, featureCode,
  policyRevision, decision, observedAt, validUntil }. It must bind this provider,
  exact customer and a subscription in the complete observed collection; feature
  code/revision must match trusted policy. decision is eligible or ineligible.
  Validity is exclusive at validUntil. A stale, expired or inconsistent assertion
  rejects; no catalog name, price, description or active status is interpreted.
- connection is null, or { creatorAccountId, provider, authorizationStatus,
  connectionStatus, destinationConfigured, dataScope, observedAt }. Scope labels
  are bounded sanitized display text. The producer must verify their meaning.
  Authorization and connection states are separate observations. For CSV,
  authorization means the separately approved export destination/scope; it does
  not imply OAuth.
- Individual observations must be fresh and no later than the evidence snapshot.

The output strips principal, contact, company, organization, customer,
subscription, invoice, plan-code and grant identifiers. It returns sanitized
display facts with separate eligibility, authorization and connection fields,
never a canWrite, activation or authorization command. Display strings still
need escaping at the renderer. Copies are frozen in process; this is not durable
storage, revocation enforcement or security isolation.

An ineligible feature does not erase saved connection metadata or historical
invoices. The eventual delivery executor must independently pause future writes
on revocation while retaining destination and queued/reconciliation evidence.
This view has no queue or execution authority.

## Verification and remaining gates

From the repository root:

    node --check src/zoho-creator/client-portal/billing-customer/billing-customer-view-contract.js
    node --test src/zoho-creator/client-portal/company-settings-requests/test/service-area-request-contract.test.js

The unchanged portal test entrypoint imports the catalog tests, which discover
the new customer tests. Tests cover
unknown versus empty, multiple subscriptions, all exact joins, scope/freshness,
duplicates, malformed shapes, amount suppression, separate grant/authorization
facts, revocation-preserved metadata and zero transport/writer capability. All
fixtures are synthetic. No test establishes actual authentication or live
permissions.

Before live wiring: verify the stable principal resolver and authoritative
principal/company/CRM/Billing binding store; establish independently verified
operation grants and role policy; specify feature codes, revision authority,
subscription-lifecycle/grace rules and multi-subscription eligibility policy;
approve freshness; implement customer-scoped GET-only reads with complete
pagination and ownership checks; reconcile money provenance; verify server-only
visibility, renderer escaping, provider-connection evidence and secure protected
authorization/reconnect flows. These are not established by this preparation.

The first usable adapter should be read-only. Keep any live rendering unavailable
until its identity, visibility, provenance, permission and acceptance checks pass.
No paid activation, payment collection, provision, OAuth grant, delivery or launch
is authorized by this module. Rollback is reverting these source files; there is
no live rollback in this slice.

## Additive billing-history projection

`prepareBillingCustomerHistoryView(input, trusted, evidence, policy)` shares the
original implementation's checks and accepts an explicit history shape. The
original `prepareBillingCustomerView` signature, exact accepted shape and output
are unchanged; it rejects history-only fields. The history export requires:

- `evidence.payments`: null for unknown, or `{ complete: true, items: [...] }`.
- `nextBillingOn` on every subscription: a provider-observed calendar date or
  null. It is not inferred from term end, status, plan frequency or today's date.
- Each payment: `{ paymentId, customerId, number, status, recordedOn, mode, money }`.
  `number` and `recordedOn` may be null. Status is `success`, `failure`, or
  `unknown`; the producer deliberately normalizes provider evidence. Mode is
  `check`, `cash`, `creditcard`, `banktransfer`, `bankremittance`,
  `autotransaction`, `others`, or `unknown`.
- Payment money: `{ amountMinor, amountUnit, currency }`, following the existing
  nonnegative safe-integer-or-null minor-unit rules. Currency uses the same
  `{ code, minorUnitExponent, source }` shape, with resource-specific source
  `payment-response` or `verified-payment-metadata`. Invoice provenance cannot
  be substituted for payment provenance. Conflicting exponents for the same
  currency across invoices and payments reject; currencies are never summed or
  converted by the view.

The output adds `payments` and `nextBillingOn` but strips payment/customer IDs,
provider tokens, payment URLs and raw metadata. Failed/unknown entries are not
represented as collected revenue. A recorded payment date is not proof of bank
settlement. No total cash, balance, refund, entitlement or action is inferred.
Payment history remains independent of subscription availability and is not
erased by cancellation. Missing customer authority cannot certify empty history.

This is a pure normalized read-model increment, not a live adapter or a rendered
Creator screen. Input labels must still be safely rendered. The future producer
must reconcile Billing read facts with the approved Books accounting owner;
this preparation does not select a second ledger or assume synchronization.

The canonical portal test entrypoint discovers the additive history suite through
the existing customer suite. It covers strict backward compatibility, unknown
versus empty, independent collections, explicit dates, owner/identity mismatches,
duplicate payments, source mutation, immutable outputs, failure statuses,
currency provenance and suppression, unsafe amounts, exponent conflicts,
non-enumerable data properties, hostile shapes/accessors, and zero side effects.

## Next source increment: bounded review and confirmation

The following is the implementation contract for a later slice. No endpoint,
provider-write client, authenticated identity resolver, quote store or payment
wrapper is implemented by this preparation.

1. Resolve the native portal session on the server, then resolve the current
   principal, CRM contact/company, Creator account, Billing customer and operation
   grant from authoritative stores. An account, subscription or plan submitted by
   the browser is only a selector. Never accept `trusted` JSON, an email match,
   role label, query-string customer ID or cached view as authentication.
2. Build the read producer first. It must pin organization/environment, complete
   each collection's pagination, verify every record owner and refresh source
   facts. Read failures remain unknown and must not become empty arrays. Use the
   existing read model for rendering; do not duplicate its money conversion or
   display contracts. Decimal-to-minor normalization must reject precision loss,
   unsupported currency metadata and disagreement with the authoritative owner.
3. Proposed review request: exactly `{ Account, subscriptionSelector,
   planSelector }`. Resolve both selectors server-side against the bound customer
   and approved catalog. Reject caller-supplied price, discount, tax, organization,
   customer, effective date, cancellation, pause or immediate-change overrides.
   Re-read the selected subscription, current scheduled changes and the allowed
   end-of-term transition before producing a review.
4. Obtain authoritative quote terms. The documented Billing Quotes API supports
   `estimate_type=update_subscription`, `subscription_id`, `end_of_term=true`
   and an explicit `send=false` option. Creating even an unsent quote is an
   external mutation, not a read-only calculation. Do not create it in a read-only
   test or use an undocumented compute endpoint. Availability and side effects
   must be qualified before implementing the adapter.
5. A server-stored review binds principal, company, customer, subscription,
   provider quote, catalog/policy revisions, prestate, expiry and exact proposed
   changes. Browser output may include an opaque `reviewRef`, expiry, plan labels,
   authoritative effective date, billing cadence and separately labelled quoted
   due-now/recurring amounts with resource-specific currency provenance. Reuse the
   minor-unit and unknown-money rules; do not copy invoice provenance onto a
   quote. Do not present an unknown tax or amount as zero. `reviewRef` identifies
   the stored review; possession never grants access or execution authority.
6. Proposed confirmation request: exactly `{ Account, reviewRef, confirm: true }`.
   The server re-resolves identity and permission, checks review ownership/expiry,
   and refreshes quote and subscription prestate. Any material difference requires
   a new review. Enforce end-of-term-only changes and no cancellation in server
   policy independently of the native portal's preferences.
7. Before a future write, atomically claim a durable operation identity bound to
   the review and exact change. Retain its claim across every outcome. Select one
   provider execution path only after verifying quote-acceptance semantics;
   acceptance may itself trigger a change, so never accept and independently
   update on the assumption that both are required. The update API supports a
   `subscription_estimate_id` and `end_of_term=true`. After an ambiguous result,
   reconcile authoritative scheduled changes before retrying. Show success only
   after independent readback establishes the requested result.
8. Payment forms, if separately implemented, require the same customer binding.
   Use provider-hosted entry and server-generated scoped pages rather than raw
   card data in Creator. A browser return parameter or success screen is not
   payment proof: verify the hosted page and resulting provider transaction on the
   server and reconcile the invoice. Do not promise iframe support for every
   hosted action or treat a page URL as a native-portal SSO token.

Before that next slice is executable, tests must cover unauthenticated/revoked
principals, cross-company selectors/reviews, quote tampering and expiration,
changed subscription/catalog/policy prestate, disabled transitions, unknown
tax/currency, multiple subscriptions, double-clicks/concurrent claims, replay,
timeout before and after a possible commit, readback mismatch and forged payment
return parameters. Unit fixtures can model these inputs but cannot qualify the
actual identity resolver, connection, durable store or provider behavior.

Keep the existing native-portal fallback until authenticated read views and each
replacement action pass their independent acceptance checks. Production,
customer delivery, access grants and financial actions remain separately gated.

Official capability references, reviewed 2026-10-07:

- [Subscriptions and scheduled changes](https://www.zoho.com/billing/api/v1/subscription/)
- [Invoices](https://www.zoho.com/billing/api/v1/invoices/)
- [Payment history](https://www.zoho.com/billing/api/v1/payments/)
- [Subscription quotes](https://www.zoho.com/billing/api/v1/quotes/)
- [Hosted payment pages](https://www.zoho.com/billing/api/v1/hosted-pages/)
- [Documented plan-checkout embedding](https://www.zoho.com/ca/billing/help/settings/hosted-payment-pages/embedding-and-sharing.html)
- [Creator managed connections](https://help.zoho.com/portal/en/kb/creator/developer-guide/microservices/understand-connections/articles/understand-connections)
