# Billing & Plans read-only view contract

Source-only, pure projection; no portal wiring, endpoint, provider call, database, authentication or payment operation. The existing paid conversion commercial-terms module serves a different contract and is unchanged.

`prepareBillingPlanView(evidence, policy)` accepts only a server producer's exact sanitized catalog projection:

- Evidence: `{ environment, observedAt, complete: true, plans }`. Environment is development/stage/production; observation is canonical UTC with milliseconds. Complete means the producer verified all required pages/joins; a Boolean alone does not prove it.
- Policy: `{ expectedEnvironment, asOf, maxAgeMs }`. The trusted caller supplies evaluation time and approved freshness bound; future, stale, incomplete and wrong-environment evidence deny. No clock or permanent price constants are used.
- Each plan: `{ label, catalogStatus, recurringMinor, setupMinor, amountUnit, interval, currency }`. Status is active/inactive/unavailable. Label is sanitized display text, not a provider identifier. Exact interval is null or `{ count, unit }` with positive safe integer and months/years. Label plus interval must be unique, including identical duplicates.
- Amounts are null or nonnegative safe integer minor units; unit is minor or null. Unknown unit requires null amounts. Currency is null or `{ code, minorUnitExponent, source }`, with uppercase three-letter code, exponent 0–4, and source plan-response/verified-catalog-metadata. The producer must verify an actual supported currency and its exponent; syntax is not currency authentication. Conflicting exponents for one currency deny, as does an unknown interval alongside another observation of the same label. No float conversion or USD fallback occurs. Unknown currency suppresses both amounts and amount unit. Unknown individual amounts remain null, never zero.

Output contains only observation/environment, overall catalog availability, copied plan projections and a customer projection whose subscription, entitlement, termStart, termEnd and usage are always null (unavailable). Catalog availability means catalog rows were observed; active/inactive status is not purchase availability, service activation or customer entitlement. A renderer must present null as unavailable and escape display text. Freeze protects copied projections in process; it is not durable storage.

No checkout link, activation/upgrade/cancel/payment control, provider ID, raw payload, customer context or stale allowance/add-on copy is accepted. Free-test lifecycle is outside Billing. Plan units/usage, dates, subscription and entitlement cannot be inferred from a catalog or owner preview. Missing currency_code from provider GET responses remains an unresolved adapter issue; only independently verified catalog metadata may supply it, never a guessed default. Mixed currencies are per-plan facts, not a conversion or combined total.

A passed evidence/policy object is not authentication or trusted provenance. Before real portal rendering, separately prove stable principal, active company-operation grants, correct tenant/environment catalog mapping, safe evidence visibility, complete authoritative currency/unit reconciliation and freshness policy. Tenant-specific subscription/usage reads remain unavailable until those contracts exist. The initial grant operator decision does not implement these gates. No live catalog, converter, schema, permissions or commercial terms are changed.

Validation (synthetic fixtures only):

```sh
node --check src/zoho-creator/client-portal/billing-plans/billing-plan-view-contract.js
node --test src/zoho-creator/client-portal/billing-plans/test/billing-plan-view-contract.test.js
```

The existing portal test entrypoint imports these tests for canonical and hosted check discovery. Source rollback is removal/reversion of this isolated change; no live rollback is needed.
