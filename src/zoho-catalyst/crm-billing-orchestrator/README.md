# CRM-to-Billing Lifecycle Orchestrator

**Status: proposed, Development-only, not deployed, and code-blocked from Production.**

This package mediates the approved CRM Deal lifecycle into bounded Zoho Billing customer and subscription operations. CRM remains authoritative for the commercial relationship and pipeline. Billing remains authoritative for subscription state. Zoho Books is deliberately absent from the runtime.

## Lifecycle Contract

| Action | Required authoritative CRM state | Bounded outcome |
| --- | --- | --- |
| `ensure_customer` | Free-test Deal, Initial Sale, valid Account | Reconcile or import one CRM-linked Billing customer and read the ID back into the Deal |
| `start_evaluation` | Setup and QA (or an idempotent replay after Test Live), go-live approved, configured duration/call limit, start timestamp | Reconcile or create one zero-exposure evaluation subscription in the dedicated evaluation fields before the Deal can move to Test Live |
| `end_evaluation` | Test Live (or an idempotent replay after Results Review/Closed Lost), end timestamp/reason, evaluation subscription ID | Cancel the evaluation immediately, verify `Ended`, and only then permit Results Review |
| `prepare_paid_subscription` | Subscription Proposed, completed evaluation, explicit paid acceptance, allowlisted Plan and Billing Frequency | Reconcile or create a paid subscription in the paid-only fields with collection disabled; do not close the Deal |
| `reconcile` | Valid free-test Deal | Read Billing customer/subscription state without mutation |

The request body contains only:

```json
{"schemaVersion":"crm-billing-lifecycle-v1","action":"ensure_customer","dealId":"100000000000001"}
```

The handler rejects unknown fields, re-reads CRM, derives its own deterministic operation identity, and never trusts caller-supplied stage, plan, price, status, customer, or subscription facts.

## Safety Boundary

- Catalyst, the route, and configured environment must all report Development.
- The API Gateway must require an API key. The function also requires one route-specific shared header stored only in private platform configuration.
- Separate read and write Catalyst Connections are required for CRM and Billing. Each must return exactly one OAuth `Authorization` header and no query parameters.
- Billing organization identity is fixed in private configuration and sent only in the required organization header.
- Evaluation plan readback must prove zero recurring price, zero setup fee, exactly one billing cycle, the approved trial duration, and active status. Created subscription readback must prove no add-ons, card, payment method, setup charge, or automatic collection.
- Billing customer reconciliation uses `GET /customers/reference/{CRM Account ID}?reference_id_type=zcrm_account_id`. If absent, it invokes `POST /crm/account/{CRM Account ID}/import` and then re-reads that exact reference. This requires the native CRM-to-Billing sync in the test organization and never posts a generic `/customers` record.
- Billing plan readback uses `GET /plans/{plan_code}`. Subscription reconciliation uses paginated `reference_contains` queries followed by an exact `reference_id` filter; missing pagination metadata, an incomplete traversal, or more than one exact match fails closed.
- This source revision code-blocks paid-subscription preparation. `ENABLE_PAID_SUBSCRIPTION_PREPARATION` must be `false`, the paid-plan map must remain empty, and the paid action rejects before any CRM or Billing mutation. A later reviewed revision must bind exact recurring price, setup fee, currency, interval, billing cycles, discount/coupon absence, and readback evidence before paid creation can be enabled.
- CRM stage is never mutated here. `prepare_paid_subscription` runs while the Deal remains Subscription Proposed; the later Blueprint transition may require the verified Billing ID and status before Closed Won.
- The Blueprint is sequenced around authoritative readback: `start_evaluation` runs while the Deal is still Setup and QA, and `Approve Go Live` requires `Billing_Automation_Status = Evaluation Verified`; `end_evaluation` runs while the Deal is still Test Live, and `Complete Free Test` requires `Billing_Evaluation_Status = Ended`. Replays after the transition are permitted only so the same deterministic operation can be reconciled safely.
- `Billing_Evaluation_Subscription_ID` and `Billing_Evaluation_Status` are evaluation-only. `Billing_Subscription_ID` and `Subscription_Status` are paid-only. Successful readback also clears the sanitized automation error and records the last sync timestamp.

## Durable Processing

`config/datastore-schema.json` defines one operation inbox. `OPERATION_KEY` is mandatory and unique. The function inserts `processing` before a side effect, classifies an exact completed replay as success, and treats a conflict or unresolved row as reconciliation-required. Every terminal state is independently read back.

Ambiguous Billing creates are resolved by the deterministic `reference_id`; cancellation is resolved by subscription readback; CRM writes use `If-Unmodified-Since` and exact field readback. No uncertain mutation is blindly replayed.

The operation key and Billing reference are stable for one environment, Deal, and action. Mutable Deal inputs are held only in the operation fingerprint, so an altered replay hits the same unique key and fails before another side effect. `IDEMPOTENCY_PEPPER` is an immutable environment identity secret: never rotate it without a separately reviewed versioned migration and authoritative reconciliation of every prior operation/reference.

## Development Setup

1. Use the existing **Retell** Catalyst project in Development. Keep this orchestrator in its own function and `CRMBillingOperations` table, with function-specific private configuration, four least-privilege Connections, and one exact API Gateway route. Do not reuse the Retell call/event tables, routes, or credentials. Keep Production untouched.
2. Create or select a dedicated Billing test organization. Do not point Development at the live Billing organization.
3. Enable and verify native CRM-to-Billing account sync, exact CRM Account customer lookup/import, paginated deterministic-reference subscription lookup, the reviewed create shapes, immediate cancellation, and every readback field enforced by this source.
4. Configure every variable in the blank `.env.example` through Catalyst private configuration. Never upload a populated environment file.
5. Stamp `lib/source-revision.js` with the exact reviewed 40-character Git commit during immutable packaging; `SOURCE_REVISION` must match it.
6. Configure CRM Blueprint/custom-function calls only after the route and Development fixtures pass. Blueprint enrollment and transition attachment require separate CRM readback.
7. Prove exact duplicate, conflict, timeout-before-commit, timeout-after-possible-commit, zero-exposure evaluation, explicit paid acceptance, cancellation, CRM readback, and sanitized logging with synthetic records.

The seven-day clock may be represented by Billing only after the test organization proves the plan cannot produce a paid renewal. The call-limit trigger must come from the authoritative call workflow; this function does not count calls or infer that the limit was reached.

## Containment

Disable the API Gateway route first, then revoke the Billing write Connection if mutation must stop independently. Preserve operation rows and reconcile them against CRM and Billing. Do not delete evidence or retry unresolved rows. Restore only a separately reviewed Development artifact and re-enable the route only after the complete synthetic replay/readback suite passes.

## Local Validation

From `functions/crm_billing_orchestrator` with Node.js 24:

```powershell
npm ci --ignore-scripts
npm run ci
```

Passing tests prove local policy behavior only. They do not prove a live CRM, Billing, Catalyst, Connection, Data Store, API Gateway, Blueprint, or plan contract.
