# Bounded Billing read evidence collector

`functions/crm_billing_orchestrator/lib/billing-read-collector.js` is an unwired,
noncharging preparation module. It is not an API endpoint, a deployed collector,
a trusted snapshot producer, or the Retell-to-Billing synchronization integration.
Synthetic tests prove the local behavior only. No provider request is made by the
module itself, and the tests require no credentials, SDK, network or paid action.

## Input seam

Call `collectBillingReadEvidence({ target, reads, limits })` using trusted code.
`target` contains only `crmAccountId` and `subscriptionReference`; these are search
criteria, never attestation of caller, tenant, organization or deployment identity.
Historical attribution and scope overrides are not supported inputs.

`reads` must contain exactly four injected functions:

- `readCustomerPage({ page, perPage, signal })`
- `readCustomer({ customerId, signal })`
- `readSubscriptionPage({ page, perPage, filterBy, signal })`
- `readSubscription({ subscriptionId, signal })`

The eventual adapters must be independently reviewed fixed-origin, fixed-Billing-
organization GET-only readers. They must not share a client exposing financial or
CRM writes. The collector rejects additional reader methods but cannot inspect
the implementation or authority of injected functions. It does not authenticate
the caller or supply an organization, token, URL or credential.

Readers return parsed **native response bodies**, not MCP/connector transport
envelopes: `code: 0`, the appropriate `customers`, `customer`, `subscriptions` or
`subscription` member, and explicit native `page_context` for lists. The adapter
must independently enforce byte/decode bounds and cancellation. This module bounds
items after parsing, not the bytes downloaded or memory used by an adapter.

## Current observation rules

- Every listed customer is independently hydrated. Customer lists alone cannot
  establish CRM linkage. Native detail must explicitly supply `customer_id`,
  `zcrm_account_id`, `zcrm_contact_id` and boolean `is_linked_with_zohocrm`.
- Explicit empty CRM IDs mean unlinked. Missing fields mean unread. A contact ID
  never substitutes for an account ID; contradictory IDs/linked flags are held.
- Subscription pages are always requested with `SubscriptionStatus.All` and are
  exact-filtered by `reference_id`. Substring matches are not selected. Empty
  references on unrelated subscriptions are allowed; missing reference fields
  fail closed. Subscription status is not interpreted as entitlement or payment.
- Page number, page size and boolean final marker are required. Duplicate IDs,
  ambiguous exact matches, empty continuing pages, malformed rows and exceeded
  bounds produce a hold, not a truncated success. No automatic retry occurs.
- The selected subscription is independently read and selected customer reread.
  Any observed identity disagreement is held. These checks can detect some drift,
  but matching observations never establish a consistent atomic snapshot.
- Only selected identity/linkage fields leave the module. Customer names, email,
  financial fields, raw response bodies and provider errors are not returned or
  logged. The resulting identities are still private operational evidence and
  must not be published in fixtures, logs or repository artifacts.

## Unwired native GET adapter

`lib/billing-read-adapter.js` implements the four-reader seam using the existing
bounded JSON transport. Construct it with `createBillingReadAdapter(configuration,
dependencies)` and pass its frozen return value as the collector's `reads`.
Both `readAuthorizationProvider` and `fetchImpl` must be supplied explicitly;
there is no SDK initialization, credential discovery or default network binding.
The factory performs no I/O. Invoking a reader is a provider read and requires
the separately qualified execution boundary before live use.

Configuration accepts only `billingOrganizationId`, optional `timeoutMs` (default
3,000; ceiling 3,000 milliseconds), and optional `maximumBytes` (default 262,144;
ceiling 524,288). It captures these values and dependencies before any await.
The US origin/path prefix is fixed to `https://www.zohoapis.com/billing/v1`, matching
the existing approved US integration boundary. Reader requests cannot override
origin, organization, headers, HTTP method or credentials. Numeric record IDs are
validated before interpolation. No write methods or generic request method exist.

Customer pages always use `filter_by=Status.All`; subscription pages always use
`filter_by=SubscriptionStatus.All`. Internal `page`/`perPage` become the native
`page`/`per_page`. No customer or substring filter narrows the inventory. Customer
status-filter defaults are not documented, so omitting that filter would not
establish inactive-record coverage. The documented default page size is 200;
the adapter's ceiling of 200 is a local safety bound, not a claimed API maximum.

Each read performs at most one authorization lookup and one GET. One monotonic
deadline covers authorization, headers, streamed bytes and decoding. Caller abort
propagates through `requestJson` to fetch and body cancellation; late authorization,
headers or body results cannot start later work. Abort listeners are removed on
completion. Cancellation remains best effort for a dependency that ignores it.
No retry, redirect, unbounded body read or provider error text is permitted.

The adapter returns the private native response body to the collector, which
minimizes it to identity observations. Do not log or publish adapter responses or
authorization values. HTTP error status, missing expected members, nonzero native
code and malformed/oversized responses produce a fixed sanitized error. A native
list response without explicit `page_context` remains rejected by the collector.

Official contract references: [US API and organization header](https://www.zoho.com/billing/api/v1/introduction/),
[customer reads and Status.All](https://www.zoho.com/billing/api/v1/customers/),
[subscription reads and SubscriptionStatus.All](https://www.zoho.com/billing/api/v1/subscription/),
and [pagination](https://www.zoho.com/billing/api/v1/pagination/). These describe
capability, not the installed connection's identity, effective scopes or behavior.
The read scopes documented are `ZohoSubscriptions.customers.READ` and
`ZohoSubscriptions.subscriptions.READ`; no grant is created or expanded here.

End-to-end synthetic adapter/collector tests intentionally still return
`held_evidence_only`, `readStatus: incomplete`, null historical mapping and false
billing authority. Configured organization, successful GETs and current IDs do
not satisfy the remaining execution, consistency, CRM-join or historical gates.

The collector defaults are 100 items per page, five pages **per collection**, 250 total
customer-plus-subscription items, 300 read calls and a three-second total deadline.
Explicit limits may lower or raise these up to the immutable ceilings of 200,
25, 1,000, 1,100 and 3,000 milliseconds respectively. Reads are sequential. A single
shared AbortSignal is aborted on completion/failure/deadline; late resolutions
cannot launch subsequent reads. Actual cancellation requires adapter cooperation.
An event-loop-blocking adapter cannot be interrupted by a JavaScript timer.

## Output and nonnegotiable holds

Successful collection returns `held_evidence_only`, not `verified` or `complete`.
Missing exact relationships return `missing`. Malformed, unavailable, conflicting
and bounded-out reads discard partial observations and return fixed hold codes.
Every result has `readStatus: incomplete`, null `historicalMapping`, null billable
minutes/charge and `billingAuthority: false`. There is no completeness override.

An available `observation` is explicitly `current_only`; `sweepEnded: true` means
the final pages observed `has_more_page: false`, **not** that all records existed
together at one time. Current customer/CRM IDs, subscription creation/start dates,
two matching sweeps, provider event history and today's absence of subscriptions
must never be promoted into historical ownership. Calls require independently
established effective mappings covering their entire interval.

The output deliberately does not implement the joined CRM/Billing snapshot shape.
Passing it to `reconcileBillingLink` remains held. Runtime wiring still requires:

1. Independently qualified read-only execution/caller/project/environment/tenant/
   deployment/configuration and Billing organization/mode binding.
2. Qualified bounded raw-duration records and explicit consistency/completeness
   semantics for both CRM and Billing, not merely this ended sweep.
3. Authoritative effective historical mappings covering each whole call interval.
4. Existing commercial acceptance and financial-operation gates, separately from
   read evidence. This collector does not activate them or select pricing rules.

These gates preserve v0.5 priorities and free-test independence. Nothing here
starts a subscription, writes usage, invoices, charges, changes a catalog, calls
Books, retries a financial operation, deploys, or authorizes provider execution.

## Offline verification

Run `node --test test/billing-read-collector.test.js` from the function directory,
then the component `npm run ci` and repository canonical verifier before merging.
The collector tests install the repository offline guard and assert no blocked
network, SDK, subprocess or credential boundary was attempted. Fixtures are
synthetic; never replace them with actual account/customer/subscription IDs.
