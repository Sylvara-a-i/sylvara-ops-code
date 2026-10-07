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
