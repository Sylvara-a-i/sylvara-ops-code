# CRM Report and Paid Conversion Orchestrator

**Status: active Development plus dependency-free dark Production; Production activation is not authorized.**

This package consumes the terminal free-test report summary and, later, performs one bounded paid operation after explicit acceptance. Billing is not used to start, run, stop, measure, or review the free test. CRM owns the relationship, report summary, human Results Review, and accepted commercial state; Billing owns the resulting customer, catalog, subscription, and subscription status. Zoho Books is deliberately absent.

## Public Contract

| Action | Required authoritative CRM state | Bounded outcome |
| --- | --- | --- |
| `sync_report_summary` | Exact revision-specific `CRMBillingOperations` row and matching Deal deployment/configuration; no conflicting reviewed or accepted state | Atomically claim once, write only verified terminal summary fields, and complete only after exact Deal readback; never write Stage or Results Review |
| `prepare_paid_subscription` | `ZZZ SYNTHETIC` Deal and Account; Revenue Desk free-test Deal; Initial Sale; Subscription Proposed; test Completed; results-review timestamp; acceptance Accepted with timestamp and version; exact current/approved deployment and configuration binding; exact approved monthly terms | Create or reconcile one TEST customer and one deterministic TEST subscription, then update only CRM integration fields after complete Billing readback |
| `reconcile` | Same synthetic accepted Deal, including Subscription Proposed or Closed Won | Read and reconcile the existing paid operation without creating another customer or subscription |

The request body contains only:

```json
{"schemaVersion":"crm-billing-lifecycle-v2","action":"prepare_paid_subscription","dealId":"100000000000001"}
```

For report synchronization the exact body is `{"schemaVersion":"crm-billing-lifecycle-v2","action":"sync_report_summary","dealId":"100000000000001","operationKey":"<64-hex-revision-key>"}`. The runtime worker sends only that binding; it never sends the report body or receives authority for paid actions. `ensure_customer`, `start_evaluation`, and `end_evaluation` are not public actions. Customer provisioning is private to accepted paid conversion. No Billing evaluation subscription is created for the free test.

The report caller uses the API Gateway `ZCFKEY` plus `SHARED_HEADER_NAME: REPORT_SUMMARY_HEADER_VALUE`. That secret is distinct from `SHARED_HEADER_VALUE`: report credentials cannot authorize `prepare_paid_subscription` or `reconcile`, and the paid caller credential cannot authorize `sync_report_summary`. Pending and crashed `report_claim_*` pre-write rows are claimed or reclaimed with an `OPERATION_VERSION` fence. Exact `report_write_started_*` readback is required before CRM PUT; after that boundary, only exact Deal readback may complete the row and the write is never repeated. Completion and containment use a report-specific compare-and-set over the observed row, status, outcome, and version, so a stale completion cannot erase newer containment and stale containment cannot reverse completion. After observing the operation cursor, every transition to completed and every already-completed replay fresh-reads the authoritative Deal account, deployment/configuration binding, and exact patch. Mismatch or unavailable readback CAS-keeps or demotes that cursor in `reconciliation_required`; if a stale containment attempt instead observes that completion won, it fresh-reads the Deal and performs at most one bounded repair CAS when the conflict remains. An exact fresh match remains a no-write replay. Only an unreviewed `Live` test may receive a differing terminal patch; `Completed` is exact-replay-only, while `Failed`, `Rolled Back`, reviewed, or accepted evidence is contained for reconciliation. `Results_Review_At` remains human-only, and the human-controlled **Complete Free Test** Blueprint transition occurs only after report readback.

The temporary `validate_report_summary_contract` action exists only for immutable Development deployment evidence. It accepts exactly one of two built-in synthetic cases: legacy schema v1 with a non-null workflow-failure count, or schema v2 with unavailable workflow-failure evidence represented as null. It requires the report-only credential, the exact artifact-bound Development host/project, and `ENABLE_DEVELOPMENT_COMPATIBILITY_PROBE=true`; it parses and maps the built-in summary, returns only safe schema/mapping enums, and exits before Catalyst SDK, CRM, Billing, Connection, or Data Store initialization. Set the flag back to `false` immediately after both cases and verify the action rejects. It is unavailable in dark Production and is never an authorization path for report synchronization or paid actions.

## Approved Commercial Contract

Exact paid amounts are not duplicated in this component. Catalyst Development must provide
`PAID_COMMERCIAL_TERMS_JSON` as a private secret containing exactly one currency, a one-month
interval, one content-addressed acceptance version, one common usage rate in minor units, and
recurring/setup minor units for exactly `Launch::Monthly`, `Growth::Monthly`, and
`Scale::Monthly`. The acceptance version is exactly `terms-v1:<64 lowercase hex>`: its SHA-256
digest is derived from a deterministic fixed-order serialization of the currency, interval,
interval unit, common usage rate, and every recurring/setup pair. Reordering JSON properties does
not change it; changing any commercial term requires a new digest. A reused or caller-chosen label
is rejected. The Deal's `Subscription_Acceptance_Version` must exactly match that derived private
contract version, which binds the accepted terms to the private common usage rate without
depending on a nonexistent CRM rate field. When
`ENABLE_PAID_SUBSCRIPTION_PREPARATION=true`, unknown, missing, extra, fractional, zero, or
malformed values fail configuration before any CRM, Data Store, or Billing operation. When the
gate is `false`, the paid catalog, paid acceptance value, and Closed Won mapping may be absent;
both paid preparation and reconciliation reject before any dependency read while report-summary
synchronization remains available.
The runtime separately maps those three keys to private Billing plan codes plus one private
monthly recurring add-on code, exact unit, and product ID. The add-on must use unit pricing with
usage tracking enabled; annual plans and Enterprise are outside this runtime.

CRM currently returns the Plan picklist's API values rather than its display labels. The paid
boundary maps only `Option 1` to Launch, `Option 2` to Growth, and `Pro` to Scale. Display labels,
including `Launch`, `Growth`, and `Scale`, and every other value fail closed before Billing access.

## Ordering And Readback

The handler:

1. Re-reads the Deal and Account, requires both authoritative names to remain inside the `ZZZ SYNTHETIC` boundary, and validates pipeline, offer, type, stage, completed test, results review, exact configured acceptance version, monthly plan, `Monthly_Recurring_Revenue`, `Setup_Fee`, and start date. The connected-minute rate comes only from the version-bound private contract and is independently verified against the Billing add-on.
2. Claims a durable Deal/action operation whose fingerprint binds the Account, approved deployment/configuration version, Billing organization, acceptance evidence, selected plan code, add-on code/unit/product, recurring/setup/usage minor units, currency, interval, and start date.
3. Creates or verifies the TEST customer without updating CRM.
4. Re-reads CRM and revalidates every accepted input.
5. Reads the Billing TEST organization, plan, and metered add-on before subscription creation. The plan and add-on must share the configured product ID and exact `USD` currency. The add-on must read back as monthly `type=recurring`, `pricing_scheme=unit`, `is_usage_supported=true`, with unit exactly `minute`.
6. Creates or reconciles one deterministic subscription with `auto_collect=false`, no payment method, the selected plan, and the common usage add-on.
7. Reads the full subscription and the catalog again. The customer, reference, product association, plan, recurring price, setup fee, exact `USD` currency, monthly interval, add-on identity/`minute` unit/product, metered rate, original start date, collection mode, payment boundary, and provider `future` or `live` status must all match. The immutable CRM mapping is `future` to `Scheduled` and `live` to `Active`; Closed Won reconciliation additionally requires raw provider status `live` and CRM status `Active`. A returned `current_term_starts_at` may advance on renewal but can never precede or substitute for the separately verified original start.
8. Makes one CRM integration update with the verified customer ID, subscription ID, mapped subscription status, `Paid Verified`, sync timestamp, and cleared safe error. Readback must contain `Billing_Automation_Error` as its own property with the exact value `null`; an omitted field is unresolved, not proof that CRM cleared it.
9. Marks the operation complete only after CRM readback succeeds.
10. Only after that completion readback, deterministically inserts or confirms one sanitized `conversion_status` v2 fact in `AnalyticsSyncOutbox`. The fact preserves `ENGAGEMENT_TYPE=free_test` as the originating evidence partition and records `TARGET_ENGAGEMENT_TYPE=paid_service` separately, so paid acceptance remains visible in free-test operations reporting. Its only unique identity is `OUTBOX_KEY`, derived as SHA-256 over the NUL-delimited `analytics-provider-version-v1` domain, record type, environment, client key, deployment key, record key, and `SOURCE_MODIFIED_AT` after `Date.toISOString()` normalization. Exact replay converges; the same key with a different immutable payload fails closed for reconciliation.

Missing or unfamiliar plan, add-on, or subscription evidence fails closed. The Billing TEST organization currently has Metered Billing disabled and no approved connected-minute add-on. Development paid preparation must remain disabled until a separately approved TEST-only settings change enables Metered Billing, an approved recurring usage-tracked add-on exists, and provider readback proves its code, `recurring` type, `is_usage_supported=true`, monthly interval, unit pricing, exact unit, product association, price bracket, and subscription representation. The organization connector exposes no metering field; the settings prerequisite therefore requires a separate private UI attestation with the exact TEST organization, authenticated-settings source, enabled value, canonical capture time, and SHA-256 of the private evidence. The approval binds the domain-separated digest of that attestation plus the complete packet and readback-evidence digest. Source tests use synthetic fixtures and do not replace that evidence.

## Security And Idempotency

- Production activation is code-blocked by the `production`/`dark` matrix. Dark mode returns unavailable before route parsing, SDK initialization, stores, Connections, CRM, Billing, or secrets.
- The exact API Gateway route requires `ZCFKEY`. The function also requires an action-scoped private route header: `REPORT_SUMMARY_HEADER_VALUE` for report sync and `SHARED_HEADER_VALUE` for paid/reconcile.
- CRM and Billing use separate read/write Connections and a fixed Billing organization.
- The TEST-only direct customer adapter attests `mode=test`, requires Billing as the sole joined app, uses a deterministic reserved `example.com` identity, disables portal and ACH, and stores no CRM Account data in Billing.
- `OPERATION_KEY` is mandatory and unique. A changed accepted term produces a fingerprint conflict, not another subscription.
- Component v2 uses a stable operation key and Billing `reference_id` derived only from the explicit `sylvara.crm-billing.idempotency.v1` domain, Development environment, Deal, and paid action. Acceptance version, plan/frequency, prices, start date, meter, Account, and Billing organization are bound to the immutable fingerprint. This stable-reference plus conflicting-fingerprint rule supersedes any design that puts mutable acceptance or commercial fields directly in the subscription reference: a changed acceptance cannot generate a second Billing lookup key.
- Stored `SOURCE_REVISION` remains immutable audit evidence but is not an equality gate during reconciliation; a later reviewed deployment can reconcile an older operation with the same exact identity and Development environment.
- `ANALYTICS_PARTITION_HMAC_SECRET` is a dedicated cross-producer partition key and must match the call runtime's private value while remaining distinct from `IDEMPOTENCY_PEPPER`. The outbox fact contains only opaque hashes, safe status enums, approved configuration identity, environment, revision, and timestamps—never raw CRM/Billing IDs, names, commercial amounts, PII, or secrets.
- Subscription lookup paginates `reference_contains` results and exact-filters `reference_id`.
- Any unresolved state after a possible customer, subscription, or CRM side effect is marked `reconciliation_required`, never ordinary failed. Exact `processing` rows are also eligible for non-creating reconciliation after an uncertain completion mark. With the paid gate enabled, `reconcile` performs authoritative Billing readback, can complete an unresolved TEST-customer claim after exact readback, and may repair only non-conflicting CRM integration fields.
- Read-only CRM and Billing requests retry at most once for a transient connection, network, timeout, rate-limit, or provider response; writes never auto-retry. Fallible customer and organization reads occur before the private customer mutation claim, so exhausted pre-write reads leave no durable wedge and a later request can retry safely.
- `prepare_paid_subscription` never resumes a `processing` or `reconciliation_required` row. This intentionally avoids a second mutation owner when the original invocation or claim-insert response is uncertain. Only `reconcile` may inspect those rows, and it never creates a customer or subscription. If either authoritative resource is absent, reconciliation fails closed and leaves the operation untouched for operator containment.
- CRM Stage, acceptance, plan, price, and free-test state are never mutated here.
- Logs contain only request ID, source revision, coarse action, outcome, stage, and elapsed time.

`IDEMPOTENCY_PEPPER` is durable key-derivation material, not a route or transport credential. Rotating it changes operation keys, Billing references, and direct TEST-customer identity. Keep the route and paid-mutation gate disabled until every nonterminal operation is reconciled, every synthetic Billing side effect is independently cleaned up, and each retained operation scope is either migrated with exact key/fingerprint/reference readback or permanently retired with its synthetic CRM records. Because the currently exposed value must be revoked, it may not remain configured as a final previous-key overlap. If those gates cannot be proven, keep the route dark and stop; do not rotate blindly or create a second namespace.

## Development Setup

1. Use the existing Catalyst Development project, dedicated `CRMBillingOperations` table, and shared additive-v2 `AnalyticsSyncOutbox` contract. Keep Production untouched.
2. Point only to the isolated Zoho Billing TEST organization. For TEST customer creation use `CUSTOMER_PROVISIONING_MODE=test_direct_customer` with its explicit gate enabled. Do not attempt catalog creation until a separately approved TEST-only settings action has enabled Metered Billing and an independent UI readback has been bound into the private catalog packet.
3. Configure every report-sync-required variable through private Catalyst configuration. Keep `ENABLE_PAID_SUBSCRIPTION_PREPARATION=false` until the paid catalog and commercial contract are separately approved; in this mode neither paid preparation nor reconciliation can read CRM, Data Store, or Billing.
4. Before enabling the paid gate, derive and configure the strict private `PAID_COMMERCIAL_TERMS_JSON` with its exact content-addressed acceptance version, `USD` currency, exactly three monthly plan-code mappings, the common usage add-on code, add-on unit exactly `minute`, exact associated product ID, immutable CRM status map `future` to `Scheduled` and `live` to `Active`, paid acceptance value, and Closed Won mapping. The enabled configuration rejects a missing, malformed, stale, reused, or mismatched version. Never copy populated commercial configuration into Git, logs, or test output.
5. Stamp the artifact source revision and Development ZAID binding during immutable packaging.
6. Before enabling paid preparation, independently read the TEST product, all three plans, common usage add-on, route, Connections, and function artifact. The add-on readback must prove `type=recurring` and `is_usage_supported=true`. Then run one ZZZ SYNTHETIC Growth conversion, duplicate replay, negative acceptance cases, and reconciliation.
7. Keep the populated schema-v2 catalog packet outside the public repository. Bind `testOrganization.subscriptionsOnly=true` to the isolated Billing TEST mutation target. Bind `liveOrganization.subscriptionsOnly=false` to the existing Books-integrated live Billing organization only as the independently read, no-write `Revenue Desk` product reference; the approval target must remain the distinct TEST organization. Its exact `meteredBillingAttestation` must contain schema v1, the same TEST organization ID, `environment: TEST`, `source: authenticated_billing_settings_ui`, `meteredBillingEnabled: true`, a canonical UTC capture time, and the SHA-256 of the private UI evidence. The attestation must be no older than 15 minutes at validation and cannot postdate approval. The schema-v2 approval must contain the exact domain-separated attestation digest, while the complete packet digest also binds the attestation and the combined readback-evidence digest. Validate the definition phase before one TEST-product creation execution, independently read back and bind that exact TEST product ID, then obtain fresh evidence and approval for the bound phase before one execution that creates only the three TEST plans and common TEST usage add-on:

   ```text
   node tools/validate-private-catalog-packet.js <absolute-private-catalog-path> <absolute-private-approval-path>
   ```

   Both files must stay outside every checkout registered to the public Git repository; resolving outside the current worktree but into another attached checkout is rejected. The separately approved schema-v2 envelope binds the canonical digest of the complete packet, exact TEST organization, domain-separated Metered Billing attestation digest, phase-specific operations, commercial terms, source revision, and readback evidence without publishing price values in source or tests. It must also contain canonical UTC `capturedAt` and `expiresAt` timestamps no more than 15 minutes apart and `singleUse: true`; it is valid only at or after capture and before expiry. The validator checks that declaration and time window but does not maintain a replay database or authenticate the UI itself: the private evidence hash fingerprints separately preserved evidence bytes for review, while the approved digest prevents later substitution. Use each envelope for exactly one catalog-creation execution, discard it, and independently read back every resource immediately. Never reuse an approval for a retry. After a partial, timed-out, or ambiguous result, read back first and obtain a fresh packet/evidence/approval before any still-required write. A definition approval authorizes only `create_test_product`; a bound approval authorizes only `create_test_plans` and `create_test_usage_addon`. Neither authorizes configuration, subscription creation, the live organization, Metered Billing settings, or Production. The validator emits only the phase, plan count, and canonical SHA-256 packet digest. It rejects Production, live/TEST organization ambiguity, a missing, false, stale, post-approval, target-mismatched, source-mismatched, or digest-unbound Metered Billing attestation, commercial-term drift, any add-on type other than `recurring`, missing usage-tracking support, a non-monthly interval, non-unit pricing, a unit other than `minute`, code collisions, missing product bindings, extra fields, and either private file being placed inside any attached public-repository worktree.

## Reproducible Development Artifact

From the function directory, `npm run artifact:build` is the default build-and-verify path. It requires `APPROVED_SOURCE_REVISION`, `CATALYST_DEVELOPMENT_ZAID`, and `DEVELOPMENT_RUNTIME_PROOF` in the process environment. The builder accepts only a clean checkout whose `HEAD` exactly equals the approved SHA, exports that commit into a private temporary directory, rejects unsupported Git entries and dependency sources, installs the lockfile with lifecycle scripts disabled, validates symlinks remain inside the artifact, and stamps the source SHA plus Development ZAID HMAC only in the exported copy. It returns the isolated artifact and manifest paths without printing the private inputs or digest; the checkout remains unstamped. Build-only success intentionally retains that exact temporary artifact for inspection. After inspection, remove only the returned `artifactRoot` after verifying that it is beneath the operating-system temporary directory and its basename starts with `sylvara-crm-billing-artifact-`; failed builds clean their own temporary root.

The default command cannot deploy. `npm run artifact:deploy-development` additionally requires the private Catalyst Development project, organization, and token variables plus `CONFIRM_CATALYST_DEVELOPMENT_DEPLOY=crm_billing_orchestrator`. Its CLI invocation is fixed to `functions:crm_billing_orchestrator`, US Development, and `--ignore-scripts`. The token is supplied only through the Catalyst CLI's supported `CATALYST_TOKEN` child environment, never through command-line arguments or emitted output. A nonzero or interrupted CLI result is ambiguous: independently read back the exact Development function before any retry. This command is not a Production deployment path.

The function never collects payment and never advances the Deal to Closed Won. The Blueprint may do so only after verified paid fields are present.

## Containment

Set `ENABLE_PAID_SUBSCRIPTION_PREPARATION=false` to stop both new paid mutations and runtime reconciliation while preserving report-summary synchronization. Disable the API Gateway route for complete containment, then revoke the Billing write Connection if needed. Preserve operation rows and reconcile CRM and Billing only after the paid catalog is approved, fully configured, independently read back, and the gate is deliberately re-enabled; do not delete evidence or retry unresolved rows blindly.

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

Passing tests prove local policy behavior only. They do not prove the live CRM fields, Billing TEST Metered Billing setting, catalog or recurring usage-tracked add-on shape, Catalyst Connections, Data Store, API Gateway, Blueprint, or deployed artifact.
