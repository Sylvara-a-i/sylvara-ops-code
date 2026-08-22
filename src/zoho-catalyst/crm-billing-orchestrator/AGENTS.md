# CRM Billing Orchestrator Instructions

These rules apply to the proposed Development-only CRM-to-Billing orchestrator.

- Production is code-blocked. Source review, tests, a merge, or a Development deployment never authorizes Production.
- CRM owns relationship and Deal state. Billing owns customers and subscriptions. Books must never be called or mutated by this package.
- Accept only the exact lifecycle route and the three-field request contract. Re-read the Deal and Account before every business decision.
- Claim a deterministic operation key durably before a side effect. Conflicting or unresolved duplicates require reconciliation.
- Never blindly retry an ambiguous customer, subscription, cancellation, or CRM write. Resolve it through authoritative readback.
- A free evaluation must have zero recurring price, zero setup fee, one bounded billing cycle, no add-ons, no payment method, and `auto_collect=false`. It must never convert to a paid plan.
- Resolve Billing customers only through the exact `zcrm_account_id` reference endpoint and native CRM Account import endpoint. Never post a generic Billing customer.
- Resolve deterministic subscription references with paginated `reference_contains` reads and an exact `reference_id` post-filter. Missing pagination proof or duplicate exact matches require reconciliation.
- Keep evaluation state in `Billing_Evaluation_Subscription_ID` and `Billing_Evaluation_Status`. Reserve `Billing_Subscription_ID` and `Subscription_Status` for paid service only.
- Preparing a paid subscription requires explicit `Subscription_Acceptance_Status`, an allowlisted private Plan-plus-Billing-Frequency mapping, and completed test state. It does not move the Deal stage or collect payment.
- Log only a synthetic request identifier, source revision, coarse action, outcome, and elapsed time. Never log records, identifiers, plan codes, endpoints, headers, credentials, or response bodies.
- Use synthetic fixtures only. Run `npm run ci` from the function directory, then the repository verifier before handoff.
