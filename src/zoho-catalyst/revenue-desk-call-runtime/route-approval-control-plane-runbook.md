# Route Approval Control Plane

Status: **repository contract only; no live mutation, route activation, migration, or deletion is authorized**.

This runbook is the only proposed operator path for approving and activating a Revenue Desk route. It is intentionally out of band: it adds no gateway endpoint, deployable function, Job target, worker mode, public form action, or customer-controlled input. The gateway remains limited to `POST /retell/inbound`, `POST /retell/events`, and authenticated `GET /internal/readiness`; the worker remains limited to `process_event`, `retry_scan`, `rebuild_report`, and `reconcile_deployment`.

## Non-negotiable blockers

Stop before any mutation unless all of the following are independently available in an approved private evidence system:

1. A sanitized release artifact whose stamped source revision exactly matches the intended Development runtime.
2. Fresh Data Store metadata proving schema version 5, unique `EVENT_KEY`, and the nullable authorization columns in this package's [`config/datastore-schema.json`](config/datastore-schema.json).
3. Exact Development project, function, Job-pool, table, variable-name, permission, route, and disabled-schedule readback. Never record secret values or private identifiers in Git or logs.
4. A complete source export for the legacy `retell_route_approval_control` function, including its dependency lock, entrypoint, configuration-variable names, sanitized logic map, and tests.
5. Fresh live-binding proof for the legacy function: inbound routes, internal callers, Jobs, schedules, webhooks, credentials, and any other invocation path. Absence from this repository and recent log silence are not proof of no dependency.
6. Scoped approval for the exact external route mutation, including provider/tool, current state, proposed state, parameters, rollback, and independent readback. Repository approval is insufficient.

Items 4 and 5 remain explicit activation and deletion blockers until reconciled against the canonical control below. The legacy function must remain stopped but recoverable; it must not be deleted, silently reactivated, or treated as authoritative approval history.

## Governed identity

The route fingerprint is deterministic SHA-256 over these canonical fields, in this exact order:

`deployment_id`, `configuration_version_id`, `configuration_snapshot_fingerprint`, `number_lookup_hash`, `binding_id`, `binding_version`, `monitor_agent_id`, `monitor_agent_version`, `coverage_mode`, `call_limit`, `source_revision`, `environment`.

The configuration snapshot fingerprint is a separately domain-separated SHA-256 digest of the exact configuration version label, encrypted configuration JSON projection, engagement type, capability profile, status, approval status, source revision, and environment. The implementation prefixes the route digest with `route_` and domain-separates it as `revenue-desk-route-authorization-v1`. Neither fingerprint is derived from a rotatable runtime secret. A change to any listed field, configuration content, active configuration reference, configuration approval/status/profile, or source artifact invalidates prior approval. Approval receipts are historical evidence only; they are never edited or reused for a changed route.

## Approved tool boundary

After the blockers above are closed, use only the separately authorized Catalyst change-control capability for append-only receipt insertion and conditional ZCQL mutation (the reviewed `Insert Rows` and `Execute Query` operations). Use a separately authorized Catalyst audit/readback capability for independent verification. Do not substitute a browser, direct REST call, shell automation, another connector, or an untyped write tool.

Every event key is generated once, contains no provider/customer identifier, and is never reused. Signed intents and operator identity hashes remain in the approved private change record; no signing key or raw operator identity enters Git or runtime logs.

## 1. Approve the reviewed route without activating it

### Exact prestate

Read the deployment by its private key and the configuration by `ACTIVE_CONFIGURATION_VERSION_ID`. Reject unless every predicate is true:

- environment is Development and both rows equal the stamped source revision;
- configuration belongs to the deployment, is immutable `Active` / `Approved`, and is `free_test` / active `call_gap_monitor_v1`;
- deployment is `Ready for Approval` / `Pending Internal Approval`, has no stop state, and has positive remaining capacity;
- `APPROVED_CONFIGURATION_VERSION_ID`, `APPROVAL_EVENT_KEY`, `APPROVED_ROUTE_FINGERPRINT`, `GO_LIVE_APPROVED_AT`, `ACTIVATION_EVENT_KEY`, `ACTUAL_START_AT`, and `EXPIRES_AT` are null;
- the observed row `COUNT_VERSION`, `HANDLED_COUNT`, configuration ID, source revision, binding, agent/version, coverage, call limit, number hash, and route fingerprint exactly match the signed intent and fresh readiness evidence.

### Mutation and readback

1. Insert one immutable `authorization_event` receipt whose key is the signed `approval_…` event key, action is `approve`, decision is `Approved`, and configuration/route/source fields match the prestate. Read it back by exact `EVENT_KEY` through the audit boundary and compare every immutable field plus the decrypted allowlisted event projection.
2. Conditionally update the deployment by exact `ROWID` with predicates for the observed `COUNT_VERSION`, active configuration ID, both statuses, `HANDLED_COUNT`, source/environment, all governed route fields, null authorization fields, and null stop state.
3. Set only `TEST_STATUS=Scheduled`, `GO_LIVE_APPROVAL_STATUS=Approved`, the four approval references, `UPDATED_AT`, and `COUNT_VERSION=expected+1`. Keep `ACTIVATION_EVENT_KEY`, `ACTUAL_START_AT`, and `EXPIRES_AT` null.
4. Independently read the deployment and receipt again. Approval is complete only when both match exactly. It does not authorize or prove an active provider route and does not start the seven-day clock.

## 2. Activate only after authoritative route readback

### External route mutation

With separately scoped approval, read the provider route immediately before mutation and confirm it is stopped/unbound from this gateway. Apply only the approved Development binding. Do not enable Production, outbound calls, callbacks, SMS, email, booking, dispatch, transfer, payment, or another capability.

Read the route back through an independent provider read operation. The readback must prove the exact called-number ownership, binding identity/version, shared agent identity/version, coverage behavior, Development environment, and destination route. Normalize the allowlisted result in the private change record and compute a `readback_…` fingerprint. A timeout, partial result, conflicting route, unknown caller jurisdiction/control, or non-authoritative response is failure—not activation evidence.

### Exact prestate, mutation, and timing

Reject unless the Data Store row is still `Scheduled` / `Approved`; its active and approved configuration IDs, approval event, route fingerprint, source revision, count version, route fields, and remaining capacity still match; its activation/timing fields remain null; and the provider readback is no older than 15 minutes.

1. Create a signed `activate` intent bound to the approval event, route fingerprint, route-readback fingerprint, readback timestamp, source revision, and exact current `COUNT_VERSION`.
2. Insert its immutable `authorization_event` receipt with decision `Activated` and `RELATED_EVENT_KEY` equal to the approval event. Read it back independently and require its `PREVIOUS_EVENT_HASH` to equal the approval event hash.
3. After that readback, choose one canonical activation instant. Conditionally update the deployment using all observed approval, route, source, status, count, capacity, timing-null, and stop-null predicates.
4. Set `TEST_STATUS=Live`, `ACTIVATION_EVENT_KEY`, `ACTUAL_START_AT=activation instant`, `EXPIRES_AT=activation instant + exactly 7 calendar days (604800000 ms)`, `UPDATED_AT`, and `COUNT_VERSION=expected+1`.
5. Independently read the route, activation receipt, approval receipt, deployment, and authenticated readiness response. Require `active_authorized_deployment_count` to include the route and require the exact seven-day difference. The clock never starts at request, setup, approval, provider mutation submission, or an ambiguous response; it starts only after authoritative route-activation readback.

The route may briefly point at a `Scheduled` deployment between provider mutation and the final Data Store update. That interval fails closed at the gateway and is preferable to admitting a call without activation proof.

## Ambiguous outcomes and idempotency

- **Receipt insert timeout:** read by the immutable event key. If every immutable field matches, treat it as inserted. If absent, retry the same insert. If any field differs or more than one row resolves, stop and reconcile; never mint a new decision to hide ambiguity.
- **Conditional update timeout:** read the deployment. Exact intended fields plus `COUNT_VERSION=expected+1` prove convergence. Exact prestate permits the same conditional retry. Any mixed or third state requires immediate containment and reconciliation.
- **Provider mutation timeout:** do not guess or repeat. Independently read the route. If exact activation is proven, continue with activation evidence; if exact stopped state is proven, no activation occurred; otherwise stop the Data Store deployment and escalate for provider reconciliation.
- **Readback timeout or partial response:** no approval or activation transition is complete. Preserve receipts and the private change record; do not weaken predicates.
- **Replay:** the same event key and identical intent returns the prior result. Reuse with any different intent is an idempotency conflict.

## Configuration or source change

Before changing any governed field, fail closed first:

1. Conditionally set the current deployment to `Stopped` / `Revoked`, with `STOP_REASON=sylvara_stopped` and `STOPPED_AT`, using the last known version and route predicates.
2. Independently read that stopped state, then unbind/stop the external route and independently prove it no longer sends traffic.
3. Preserve all authorization receipts. In a separate conditional reconfiguration, set the new active configuration/route/source values and reset the lifecycle to `Ready for Approval` / `Pending Internal Approval`; clear every approval and activation reference plus `GO_LIVE_APPROVED_AT`, `ACTUAL_START_AT`, `EXPIRES_AT`, `STOP_REASON`, and `STOPPED_AT`.
4. Require a new approval and a new post-route-mutation activation receipt. Never copy, relabel, or migrate a legacy approval into the canonical current authorization chain.

## Revoke, rollback, and containment

For suspected misrouting, invalid evidence, capacity exhaustion, source drift, or any ambiguous state, containment precedes cleanup:

1. Conditionally stop/revoke the Data Store deployment first and read it back. Runtime then rejects inbound traffic even if the provider route still points to the gateway.
2. Stop/unbind the provider route with separately scoped approval and independently read back absence.
3. Append the signed revoke evidence and reconcile approval/activation receipts, calls already admitted, counts, notifications, Jobs, and outbox state. Never delete ambiguous rows.
4. Disable any affected schedule or Job producer while preserving tables and evidence.
5. Code rollback means redeploying the last reviewed canonical six-function artifact and repeating source/route/pool/readiness readback. The unexported or unreconciled legacy approval function is not an authorized rollback target.

## Legacy retirement proof

Deletion of `retell_route_approval_control` is allowed only after all source/export and live-binding blockers are closed, canonical Development approval/activation is exercised with synthetic data, rollback is rehearsed, and an independent audit proves:

- exact canonical receipts and deployment transitions for approve, activate, revoke, replay, stale evidence, concurrent mutation, and governed-route change;
- no gateway route, Job mode, schedule, webhook, internal caller, credential, or dependency still names the legacy function;
- source-to-destination event/key mapping, counts, deterministic digests, conflicts, and quarantine disposition are reconciled;
- the legacy route remains absent after the observation window.

Until then, the safe disposition is **stopped, access-restricted, source-export pending, binding-proof pending, recoverable, and not deletion-authorized**.
