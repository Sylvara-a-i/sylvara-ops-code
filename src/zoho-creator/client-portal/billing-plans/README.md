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

## Annual management-fee comparison

The separate `annual-management-savings-view-contract.js` exports `prepareAnnualManagementSavingsView(evidence, policy)`. Existing catalog, customer and history exports, signatures and output shapes remain unchanged. This is a source-only display projection with no portal wiring, quote, checkout, permission or plan-change capability.

Inputs are strict ordinary data records (own data properties only; no extra keys, accessors, symbols or custom prototypes):

- Policy uses the existing catalog shape: `{ expectedEnvironment, asOf, maxAgeMs }`.
- Evidence is `{ environment, observedAt, complete, pairing, monthly, annual }`. The existing environment, canonical UTC timestamp, freshness and completeness rules apply to the entire producer snapshot.
- Each row is null (unknown) or `{ planId, plan }`. The opaque server-side ID is nonempty text without whitespace/control characters and is never returned. `plan` uses the exact existing catalog row shape and validation, including currency provenance.
- Pairing is null (unknown) or `{ monthlyPlanId, annualPlanId, equivalent, scope }`. IDs must be distinct and match the designated row IDs exactly. `equivalent` is true/false/null; `scope` is management-fee-only/null. Only true and management-fee-only qualify.

**Producer pairing is a trust-boundary requirement, not proof created by this validator.** A trusted server producer must independently bind the correct tenant/environment, stable authoritative plan IDs and their exact rows, verify equivalent service scope, isolate the recurring management fee from usage/setup/taxes/other charges, reconcile supported currency and exponent, and observe the pairing and rows together under the approved freshness policy. Never pair by display name, suffix, amount similarity or array order. Do not reuse a cached pairing with newly fetched or reordered row data, or relabel stale facts with a new observation time. Matching IDs, source strings, complete and equivalent flags only establish structural consistency; arbitrary objects can fabricate them. Authentication, correct organization mapping, safe visibility and actual source verification remain external prerequisites. Private identifiers stay server-side and out of Git, logs and display output.

For active one-month and one-year rows with the same verified currency/exponent and positive safe-integer recurring minor amounts, the projection returns frozen `{ environment, observedAt, comparison }`. Comparison contains only:

- `monthlyLabel`, `annualLabel` (sanitized display text; escape when rendering);
- `monthlyAnnualizedMinor` = monthly recurring amount times 12, `annualRecurringMinor`, and `savingsMinor` = their positive difference;
- `amountUnit: "minor"`, `currency: { code, minorUnitExponent }`, `basisMonths: 12`, and `scope: "management-fee-only"`;
- `savingsPercentHundredths` and `percentageRounding: "floor"`.

The percentage rule is `floor(savingsMinor * 10000 / monthlyAnnualizedMinor)`, calculated with BigInt intermediates and returned as an integer number of hundredths of a percentage point (1200 means 12%). It is exact when divisible, otherwise conservative to 0.01 percentage points; never round it upward or use a fixed catalog discount. Positive savings below 0.01% return zero percentage hundredths with the exact positive money saving; a renderer can omit the percentage in that case. Annualization must fit a safe integer before arithmetic; there is no float price conversion, currency default or exchange calculation. Both validated input currency sources may differ; the output retains only their matching code/exponent.

Unknown/missing pairing or rows, mismatched IDs, unproven equivalence/scope, inactive rows, unsupported comparison intervals, unknown or differing currencies, unknown/zero recurring amounts, annualization overflow and nonpositive savings return `comparison: null`. Malformed/extra fields, conflicting exponents, invalid amounts/provenance, incomplete/wrong-environment or future/stale snapshots throw TypeError under the existing fail-closed convention. **Both null and validation failure mean suppress the offer; never retain an older successful comparison.** Setup amounts are validated by the existing catalog contract but never included in the calculation, even when unknown or different; usage fields are not accepted. This is a 12-month comparison of recurring management fees, not a total bill, invoice, proration, personalized quote or promised customer saving.

Catalog activity and savings do not establish native portal visibility, customer eligibility or ability to switch. A renderer may place these facts beside separately governed plan options only after its own gates are satisfied; it must not infer `canUpgrade`, `canChangePlan`, a checkout URL or permission from this result. Native portal visibility can be false even for every compared active row. This change does not enable switching or alter customer-specific change flow, native pricing/settings, subscriptions, storage or permissions.

Focused validation (synthetic fixtures only):

```sh
node --check src/zoho-creator/client-portal/billing-plans/annual-management-savings-view-contract.js
node --test src/zoho-creator/client-portal/billing-plans/test/annual-management-savings-view-contract.test.js
node --test src/zoho-creator/client-portal/company-settings-requests/test/service-area-request-contract.test.js
```

The new suite is imported by the existing billing-plan test file without changing the shared portal entrypoint or customer/history imports. Canonical verification remains `tools/verify.cmd` on Windows (Node 24.19.0, Python 3.12, short TEMP/TMP). No live/provider validation was performed or is implied. Rollback is to revert this isolated source change; no live system rollback or manual Zoho setup is required.
