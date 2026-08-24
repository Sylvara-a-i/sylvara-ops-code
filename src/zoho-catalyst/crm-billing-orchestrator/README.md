# CRM-to-Billing Paid Conversion Orchestrator

**Status: Development-only and not authorized for Production.**

This package performs one bounded operation after the Free Revenue Leak Test: an explicitly accepted CRM Deal may create or reconcile one Zoho Billing TEST customer and one paid TEST subscription. Billing is not used to start, run, stop, or measure the free test. CRM owns the relationship and accepted commercial state; Billing owns the resulting customer, catalog, subscription, and subscription status. Zoho Books is deliberately absent.

## Public Contract

| Action | Required authoritative CRM state | Bounded outcome |
| --- | --- | --- |
| `prepare_paid_subscription` | `ZZZ SYNTHETIC` Deal and Account; Revenue Desk free-test Deal; Initial Sale; Subscription Proposed; test Completed; results-review timestamp; acceptance Accepted with timestamp and version; exact approved monthly terms | Create or reconcile one TEST customer and one deterministic TEST subscription, then update only CRM integration fields after complete Billing readback |
| `reconcile` | Same synthetic accepted Deal, including Subscription Proposed or Closed Won | Read and reconcile the existing paid operation without creating another customer or subscription |

The request body contains only:

```json
{"schemaVersion":"crm-billing-lifecycle-v2","action":"prepare_paid_subscription","dealId":"100000000000001"}
```

`ensure_customer`, `start_evaluation`, and `end_evaluation` are not public actions. Customer provisioning is private to accepted paid conversion. No Billing evaluation subscription is created for the free test.

## Approved Commercial Contract

Exact paid amounts are not duplicated in this component. Catalyst Development must provide
`PAID_COMMERCIAL_TERMS_JSON` as a private secret containing exactly one currency, a one-month
interval, one common usage rate in minor units, and recurring/setup minor units for exactly
`Launch::Monthly`, `Growth::Monthly`, and `Scale::Monthly`. Unknown, missing, extra, fractional,
zero, or malformed values fail configuration before any CRM, Data Store, or Billing operation.
The runtime separately maps those three keys to private Billing plan codes plus one private
metered add-on code, exact unit, and product ID. Annual plans and Enterprise are outside this runtime.

CRM currently returns the Plan picklist's API values rather than its display labels. The CRM boundary maps only `Option 1` to Launch, `Option 2` to Growth, and `Pro` to Scale. Any other API value fails closed before Billing access.

## Ordering And Readback

The handler:

1. Re-reads the Deal and Account, requires both authoritative names to remain inside the `ZZZ SYNTHETIC` boundary, and validates pipeline, offer, type, stage, completed test, results review, acceptance status/timestamp/version, monthly plan, MRR, setup fee, connected-minute rate, and start date.
2. Claims a durable Deal/action operation whose fingerprint binds the Account, Billing organization, acceptance evidence, selected plan code, add-on code/unit/product, recurring/setup/usage minor units, currency, interval, and start date.
3. Creates or verifies the TEST customer without updating CRM.
4. Re-reads CRM and revalidates every accepted input.
5. Reads the Billing TEST organization, plan, and metered add-on before subscription creation. The plan and add-on must share the configured product ID, and the add-on unit must match exactly.
6. Creates or reconciles one deterministic subscription with `auto_collect=false`, no payment method, the selected plan, and the common usage add-on.
7. Reads the full subscription and the catalog again. The customer, reference, product association, plan, recurring price, setup fee, monthly interval, add-on identity/unit/product, metered rate, original start date, collection mode, payment boundary, and `future` or `live` status must all match. A returned `current_term_starts_at` may advance on renewal but can never precede or substitute for the separately verified original start.
8. Makes one CRM integration update with the verified customer ID, subscription ID, mapped subscription status, `Paid Verified`, sync timestamp, and cleared safe error.
9. Marks the operation complete only after CRM readback succeeds.

Missing or unfamiliar plan, add-on, or subscription evidence fails closed. The Billing TEST catalog currently has no approved connected-minute usage add-on, so Development paid preparation must remain disabled until an approved add-on exists and live readback proves its code, unit, product association, pricing, and subscription representation. Source tests use synthetic fixtures and do not replace that readback.

## Security And Idempotency

- Production is code-blocked by environment, host, Catalyst project, and immutable artifact bindings.
- The exact API Gateway route must require an API key. The function also requires its private route header.
- CRM and Billing use separate read/write Connections and a fixed Billing organization.
- The TEST-only direct customer adapter attests `mode=test`, requires Billing as the sole joined app, uses a deterministic reserved `example.com` identity, disables portal and ACH, and stores no CRM Account data in Billing.
- `OPERATION_KEY` is mandatory and unique. A changed accepted term produces a fingerprint conflict, not another subscription.
- Component v2 uses a stable operation key and Billing `reference_id` derived only from Development environment, Deal, and paid action. Acceptance version, plan/frequency, prices, start date, meter, Account, and Billing organization are bound to the immutable fingerprint. This stable-reference plus conflicting-fingerprint rule supersedes any design that puts mutable acceptance or commercial fields directly in the subscription reference: a changed acceptance cannot generate a second Billing lookup key.
- Stored `SOURCE_REVISION` remains immutable audit evidence but is not an equality gate during reconciliation; a later reviewed deployment can reconcile an older operation with the same exact identity and Development environment.
- Subscription lookup paginates `reference_contains` results and exact-filters `reference_id`.
- Any unresolved state after a possible customer, subscription, or CRM side effect is marked `reconciliation_required`, never ordinary failed. Exact `processing` rows are also eligible for non-creating reconciliation after an uncertain completion mark. `reconcile` performs authoritative Billing readback, can complete an unresolved TEST-customer claim after exact readback, and may repair only non-conflicting CRM integration fields.
- Read-only CRM and Billing requests retry at most once for a transient connection, network, timeout, rate-limit, or provider response; writes never auto-retry. Fallible customer and organization reads occur before the private customer mutation claim, so exhausted pre-write reads leave no durable wedge and a later request can retry safely.
- `prepare_paid_subscription` never resumes a `processing` or `reconciliation_required` row. This intentionally avoids a second mutation owner when the original invocation or claim-insert response is uncertain. Only `reconcile` may inspect those rows, and it never creates a customer or subscription. If either authoritative resource is absent, reconciliation fails closed and leaves the operation untouched for operator containment.
- CRM Stage, acceptance, plan, price, and free-test state are never mutated here.
- Logs contain only request ID, source revision, coarse action, outcome, stage, and elapsed time.

## Development Setup

1. Use the existing Catalyst Development project and dedicated `CRMBillingOperations` table. Keep Production untouched.
2. Point only to the isolated Zoho Billing TEST organization. For TEST customer creation use `CUSTOMER_PROVISIONING_MODE=test_direct_customer` with its explicit gate enabled.
3. Configure all blank `.env.example` variables through private Catalyst configuration. `ENABLE_PAID_SUBSCRIPTION_PREPARATION=false` is the new-Billing-mutation kill switch; the catalog remains configured so reconciliation can read Billing and repair only verified CRM integration fields.
4. Configure the strict private `PAID_COMMERCIAL_TERMS_JSON`, exactly three monthly plan-code mappings, the common usage add-on code, exact add-on unit, exact associated product ID, and the exact `future`/`live` CRM status map. Never copy the populated terms JSON into Git, logs, or test output.
5. Stamp the artifact source revision and Development ZAID binding during immutable packaging.
6. Before enabling paid preparation, independently read the TEST product, all three plans, common usage add-on, route, Connections, and function artifact. Then run one ZZZ SYNTHETIC Growth conversion, duplicate replay, negative acceptance cases, and reconciliation.

## Reproducible Development Artifact

From the function directory, `npm run artifact:build` is the default build-and-verify path. It requires `APPROVED_SOURCE_REVISION`, `CATALYST_DEVELOPMENT_ZAID`, and `DEVELOPMENT_RUNTIME_PROOF` in the process environment. The builder accepts only a clean checkout whose `HEAD` exactly equals the approved SHA, exports that commit into a private temporary directory, rejects unsupported Git entries and dependency sources, installs the lockfile with lifecycle scripts disabled, validates symlinks remain inside the artifact, and stamps the source SHA plus Development ZAID HMAC only in the exported copy. It returns the isolated artifact and manifest paths without printing the private inputs or digest; the checkout remains unstamped. Build-only success intentionally retains that exact temporary artifact for inspection. After inspection, remove only the returned `artifactRoot` after verifying that it is beneath the operating-system temporary directory and its basename starts with `sylvara-crm-billing-artifact-`; failed builds clean their own temporary root.

The default command cannot deploy. `npm run artifact:deploy-development` additionally requires the private Catalyst Development project, organization, and token variables plus `CONFIRM_CATALYST_DEVELOPMENT_DEPLOY=crm_billing_orchestrator`. Its CLI invocation is fixed to `functions:crm_billing_orchestrator`, US Development, and `--ignore-scripts`. The token is supplied only through the Catalyst CLI's supported `CATALYST_TOKEN` child environment, never through command-line arguments or emitted output. A nonzero or interrupted CLI result is ambiguous: independently read back the exact Development function before any retry. This command is not a Production deployment path.

The function never collects payment and never advances the Deal to Closed Won. The Blueprint may do so only after verified paid fields are present.

## Containment

Set `ENABLE_PAID_SUBSCRIPTION_PREPARATION=false` to stop new paid mutations while preserving reconciliation. Disable the API Gateway route for complete containment, then revoke the Billing write Connection if needed. Preserve operation rows and independently reconcile CRM and Billing; do not delete evidence or retry unresolved rows blindly.

An insert timeout can leave an exact operation row in `processing` even though the caller did not receive the claim result. There is deliberately no public reset or reclaim action. For an operator-contained Development reset:

1. Disable the route and paid-mutation switch, confirm no invocation is still running, and preserve the exact row, key, fingerprint, status, timestamps, source revision, and Development environment in private evidence.
2. Read CRM integration fields, the deterministic TEST customer marker, the complete paginated subscription lookup for the exact stable reference, and the relevant Billing audit/history. Record the read time and evidence source privately.
3. If an exact customer and subscription exist, use only `reconcile`; never reset the claim. If either exists ambiguously or conflicts, keep the row contained for manual investigation.
4. Only when authoritative readback proves that neither customer nor subscription mutation occurred may an authorized operator remove the one exact Development operation row through the Data Store control plane, preserving the exported prestate and approval. Re-enable the route only after independent readback proves the row is absent and the kill switch/configuration are correct.

This reset is a controlled Development recovery procedure, not runtime behavior. It must never be inferred from a dependency error alone, and it is not authorized for Production.

## Local Validation

From `functions/crm_billing_orchestrator` with Node.js 24:

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run ci
```

Passing tests prove local policy behavior only. They do not prove the live CRM fields, Billing TEST catalog or metered-addon shape, Catalyst Connections, Data Store, API Gateway, Blueprint, or deployed artifact.
