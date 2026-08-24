# CRM Billing Orchestrator Instructions

These rules apply to the proposed Development-only CRM-to-Billing orchestrator.

- Production is code-blocked. Source review, tests, a merge, or a Development deployment never authorizes Production.
- CRM owns relationship and Deal state. Billing owns customers and subscriptions. Books must never be called or mutated by this package.
- Accept only the exact lifecycle route and the three-field request contract. Re-read the Deal and Account before every business decision, and reject either record unless its authoritative name is inside the exact `ZZZ SYNTHETIC` prefix boundary.
- Claim a deterministic operation key durably before a side effect. Conflicting or unresolved duplicates require reconciliation.
- Keep the paid operation key and Billing reference stable by Deal/action; bind acceptance, commercial, start-date, meter, Account, and organization state to the immutable fingerprint. A fingerprint change must conflict with the same key and can never produce a second subscription reference.
- Never blindly retry an ambiguous customer, subscription, or CRM write. After any possible external side effect, persist `reconciliation_required`; resolve it only through authoritative readback.
- Retry read-only CRM/Billing dependencies at most once for transient failures. Never retry a write automatically, and complete all fallible customer/organization reads before claiming the private customer mutation.
- Never resume mutation from a `processing` or `reconciliation_required` paid row. There is no runtime reclaim action; an ambiguous initial claim remains contained until an authorized operator proves through CRM, deterministic customer, exact paginated subscription-reference, and Billing history readback that no resource exists, preserves private reset evidence, and removes only the exact Development row while the route and mutation switch are disabled.
- Admit exact `processing` rows to non-creating reconciliation because a final operation mark may have been uncertain. Require complete customer, catalog, subscription, CRM, identity, environment, and audit-revision readback before convergence.
- Billing is absent from the free test. Public actions are limited to accepted paid subscription preparation and non-creating Billing reconciliation; customer provisioning is private to paid preparation.
- Provision only the deterministic synthetic customer shape behind the explicit `test_direct_customer` Development gate. Immediately attest the configured Billing organization through Zoho's organization API as `mode=test` and Billing-only, then authoritatively re-read the customer. Never send CRM Account data or use this path in a live or joined organization.
- Resolve deterministic subscription references with paginated `reference_contains` reads and an exact `reference_id` post-filter. Missing pagination proof or duplicate exact matches require reconciliation.
- Preparing a paid subscription requires explicit `Subscription_Acceptance_Status`, `Subscription_Accepted_At`, `Subscription_Acceptance_Version`, `Results_Review_At`, completed test state, the strict private `PAID_COMMERCIAL_TERMS_JSON`, an exact Launch/Growth/Scale Monthly mapping, and the common metered add-on. Bind all acceptance and commercial evidence to the operation fingerprint.
- Normalize only the verified CRM Plan API values `Option 1` to Launch, `Option 2` to Growth, and `Pro` to Scale at the CRM read boundary. Unknown values fail closed; UI labels are not authoritative API values.
- Update CRM only once, after authoritative customer, plan, setup-fee, meter, subscription, and status readback. Never move the Deal stage or collect payment.
- Unknown or missing Billing plan, add-on, exact connected-minute unit, product association, meter, price, setup-fee, or status evidence fails closed. Synthetic fixtures are not proof of the live Billing response shape.
- Treat stored source revision as audit evidence during reconciliation, not as an equality gate to the current reviewed deployment. The exact operation identity and Development environment must still match.
- Log only a synthetic request identifier, source revision, coarse action, outcome, and elapsed time. Never log records, identifiers, plan codes, endpoints, headers, credentials, or response bodies.
- Use synthetic fixtures only. Run `npm run ci` from the function directory, then the repository verifier before handoff.
