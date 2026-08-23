# Shared Retell 7-Day Free Test — Catalyst Development Core

Status: **source-complete deterministic core; Catalyst HTTP/Data Store runtime intentionally disabled**.

This package implements the approved shared-agent policy in pure, dependency-free modules and synthetic adapters. It does not activate a Retell route, send a real notification, mutate CRM, import Analytics, or touch Production. `functions/retell_free_test/index.js` is a deliberate `503` deployment barrier until the Development datastore and request boundary are implemented and independently read back.

## Boundary

The free test performs bounded missed-call intake only. It does not book, dispatch, quote, collect payment, transfer arbitrarily, send Retell SMS, mutate CRM or a field-service system, call outbound, or enable paid Revenue Desk behavior.

One shared Retell agent is selected by every approved deployment. Each active deployment owns one dedicated effective-dated Retell number. All client differences live in an immutable, versioned configuration record. A number must resolve to exactly one current assignment; the shared agent ID alone is accepted post-call only when exactly one eligible deployment and one historical assignment exist.

## Implemented policy

- Exact gate: `Resolved`, nonempty ownership/version fields, `free_test`, `call_gap_monitor_v1`, and one of the three approved coverage modes.
- Exact CRM `Test_Status`, `Go_Live_Approval_Status`, and deterministic internal-to-CRM test-end-reason mappings.
- Explicit activation timestamps; `Live` cannot start its own clock on first call.
- Seven days from explicit `actualStartAt`, with expiration checked on every admission.
- Twenty-five **handled** calls. Atomic reservations prevent a 26th concurrent admission, but do not end the test until 25 admitted calls obtain durable post-call evidence.
- Orphan reservations remain capacity-blocking unless the reconciliation adapter returns final provider-authoritative `NoCallCreated` evidence bound to the exact immutable admission. Time alone never frees capacity. A released admission leaves a durable tombstone, cannot be revived by resolver replay, and does not increment the handled-call count.
- Effective-dated number reassignment at a current, non-zero cutover; historical calls keep their old binding and a deployment cannot own two active numbers.
- Authenticated-event primitives for Retell's raw-body `HMAC-SHA256(raw_body + timestamp)` contract, exact `v=<milliseconds>,d=<hex>` parsing, constant-time comparison, and a 300-second maximum age.
- Durable receipt, call, notification, and Analytics-outbox state machines in the tested MemoryStore contract.
- `call_ended` creates `AwaitingAnalysis`; `call_analyzed` enriches in either order. After a 15-minute deterministic grace period, the reconciler emits one `unresolved` notification/fact if analysis never arrives.
- One immutable correlation ID from admission through event receipt, canonical call, notification, and Analytics projection.
- Notification and Analytics idempotency, bounded backoff, terminal failure, and `ReconciliationRequired` for ambiguous/Sending outcomes unless provider readback proves success.
- One current client-partitioned Analytics call fact with outcome, urgency/safety flag, time, coverage trigger, notification state, test/call-limit progress, and explicit value evidence class.
- CRM summary adapter hard-disabled; notification and Analytics adapters synthetic-only and reject Production.
- Sensitive-data minimization before persistence/notification and no raw webhook, transcript, recording URL, phone number, recipient, or tenant value in ordinary logs.

## Development blockers

The following are launch blockers, not hidden implementation claims:

1. No authenticated Catalyst HTTP adapter is enabled. The package entrypoint always returns `503`.
2. No Catalyst SDK Data Store adapter is implemented for this domain. MemoryStore proves policy, not platform durability.
3. Catalyst Development must prove global uniqueness for nullable `ADMISSION_ID`, unique event/call/notification/outbox keys, conditional slot claims, processing leases with fencing across every side-effect claim, encrypted/private field behavior, and cold-start retry recovery.
4. The actual Development table/API names are private and intentionally absent from Git.
5. No Development notification provider credentials exist in this package; only deterministic synthetic delivery is available.
6. No scheduled Catalyst invocation has been installed for incomplete-call or orphan-admission reconciliation.
7. Retell pre-call requests contain no call ID. The deterministic admission key uses signed body `event_timestamp + to_number + from_number`; Retell retry timestamp stability has not been proven in Development.
8. No Retell-authoritative admission-reconciliation adapter has been implemented or read back. The synthetic adapter proves the state machine only and cannot release real capacity.
9. No Development deployment, phone call, provider send, Analytics import, CRM write, or runtime/source readback occurred in this change.

Do not point a Retell number or phone-system forward at this package while any blocker remains.

### Runtime source decision — no-go

The 2026-08-22 source/API review concluded **no-go** for adding a deployable HTTP/Data Store/worker/provider boundary now. [`config/runtime-readiness.json`](config/runtime-readiness.json) is the machine-tested decision record.

Current official Catalyst documentation establishes several building blocks:

- [Advanced I/O](https://docs.catalyst.zoho.com/en/serverless/help/functions/advanced-io/) supports native Node.js request/response objects and a blank `createServer` template.
- The Node SDK documents [single-row inserts](https://docs.catalyst.zoho.com/en/sdk/nodejs/v2/cloud-scale/data-store/insert-rows/) and [ROWID-based updates](https://docs.catalyst.zoho.com/en/sdk/nodejs/v2/cloud-scale/data-store/update-rows/).
- Data Store documents the [IsUnique column constraint](https://docs.catalyst.zoho.com/en/cloud-scale/help/data-store/columns/).
- Job Scheduling documents [Function Job submission](https://docs.catalyst.zoho.com/en/sdk/nodejs/v2/job-scheduling/jobs/create-job/).

Those contracts do **not** prove the behaviors this workflow needs: an atomic 25th/26th admission claim across multiple durable facts, nullable-unique slot behavior, the exact duplicate error and conditional-update affected-row shapes, timeout-after-commit recovery, lease fencing across every side effect, or the pinned worker SDK's delivery/input/readback behavior. No notification provider or Analytics import contract has been approved either.

The repository's [billing raw-body boundary](../billing-webhook-gateway/lib/http.js) and [Form 2 conditional Data Store adapter](../form2-controller/functions/form2_controller/lib/catalyst-datastore-adapter.js) are useful patterns, not runtime proof. Their own deployment controls require Development readback of duplicate conflicts, conditional updates, and SDK response shapes. Copying them here would create a plausible-looking adapter while leaving the free test's P0 concurrency and recovery guarantees unproven.

For that reason, the dependency-free deterministic core and fixed `503` barrier remain the safest source state. No SDK dependency, worker manifest, or provider stub is added until the readiness record's evidence gaps are closed with one concrete Development design.

## Configuration

`.env.example` lists every name. `config/variables.json` is the public registry with consumer, secret classification, exact format, and Development/Production handling. Missing, malformed, placeholder, duplicate-table, or Production values fail at configuration load. Real values and table names stay in Catalyst secrets/private configuration.

`config/datastore-schema.json` is a proposed Development schema, not proof of live tables. Its deployment gates are mandatory.

## Tests

From `functions/retell_free_test`:

```powershell
npm run test:unit
npm run test:integration
npm run test:acceptance
npm run ci
```

The acceptance suite uses two synthetic clients with different IDs, versions, companies, service areas, urgency rules, recipients, and numbers on the same shared agent. It covers resolution, conversation variables, persistence, notification, Analytics, replay, concurrency, reassignment/history, malformed and reordered events, seven-day/25-handled-call enforcement, sensitive-data minimization, missing-analysis reconciliation, provider failure states, and provider-authoritative orphan-admission release with ambiguity and stale-lease containment.

## Safe next implementation step

Close [`config/runtime-readiness.json`](config/runtime-readiness.json) in order: prove the admission/conditional-write contract in Catalyst Development, verify the exact pinned worker SDK and durable scanner design, then approve one notification provider and one Analytics handoff. Only then build a queue-only authenticated Advanced I/O ingress plus an out-of-band worker. The ingress must verify the raw Retell signature, durably insert/claim a minimized receipt, and return within the provider timeout; it must not send notification or Analytics synchronously. Removing the fixed `503` requires separate review. Production remains out of scope.
