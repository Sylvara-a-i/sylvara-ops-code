# Route Approval Control Plane

Status: **private Development source complete; immutable release, installation, and synthetic readback pending**.

This runbook governs the private `revenue_desk_route_control` target. It adds exactly three authenticated Development operations—approve configuration, activate free test, and stop or roll back—without changing the three-route Retell gateway or four-mode worker. CRM exposes two simple operator controls: `Approve And Start Free Test` calls approval and then activation as separate requests; `Stop Or Roll Back Free Test` calls rollback. No operation is public or customer-controlled.

## Development execution gates

Stop before any mutation unless all of the following are independently available in an approved private evidence system:

1. A sanitized release artifact whose stamped source revision exactly matches the intended Development runtime.
2. Fresh Data Store metadata proving schema version 5, unique `EVENT_KEY`, and the nullable authorization columns in this package's [`config/datastore-schema.json`](config/datastore-schema.json).
3. Exact Development project, function, Job-pool, table, variable-name, permission, route, and disabled-schedule readback. Never record secret values or private identifiers in Git or logs.
4. Exact readback of the three CRM controls and separate `Record Internal Approval` / `Activate Test Route` Blueprint transitions.
5. `RETELL_ROUTE_MODE=disabled`, unless fresh provider readback proves the configured number is isolated, `ZZZ SYNTHETIC`, unassigned to real traffic, and bound only to the exact Development agent/version and route.
6. Fresh source/runtime/configuration readback for the private target and its CRM Connections. Every live write remains Development-only and ZZZ SYNTHETIC.

Legacy source export and live-binding proof remain deletion gates, not blockers to installing the canonical private target in parallel. The legacy function stays stopped but recoverable and non-authoritative.

When an approved connector cannot perform a listed Development configuration write or authoritative readback, the governed fallback is the authenticated in-app browser. Bind the UI action to the same fresh prestate and the same conditional predicates as the manifest; perform only the exact listed save. Apply the same ambiguity handling as the API path, including stop-and-reconcile behavior for an uncertain save. Completion requires independent readback through a fresh provider view, never the save response alone.

## Governed identity

The route fingerprint is deterministic SHA-256 over these canonical fields, in this exact order:

`client_id`, `deployment_id`, `configuration_version_id`, `configuration_snapshot_fingerprint`, `number_lookup_hash`, `binding_id`, `binding_version`, `monitor_agent_id`, `monitor_agent_version`, `coverage_mode`, `call_limit`, `source_revision`, `environment`.

The configuration snapshot fingerprint is a separately domain-separated SHA-256 digest of the exact configuration version label, encrypted configuration JSON projection, engagement type, capability profile, status, approval status, source revision, and environment. The implementation prefixes the route digest with `route_` and domain-separates it as `revenue-desk-route-authorization-v1`. Neither fingerprint is derived from a rotatable runtime secret. A change to any listed field, configuration content, active configuration reference, configuration approval/status/profile, or source artifact invalidates prior approval. Approval receipts are historical evidence only; they are never edited or reused for a changed route.

## Executable boundary

The CRM callers invoke only the exact authenticated Catalyst routes. The private target fresh-reads CRM, configuration, deployment, receipt history, conflicting client deployments, and provider state where applicable. It creates signed internal decisions, writes a Prepared immutable receipt, performs one provider-bounded deployment CAS, reads it back, and finalizes the receipt. A crash resumes the same Prepared receipt and exact poststate; a changed Deal, journey, configuration, idempotency identity, or rollback reason conflicts.

Catalyst permits at most five `WHERE` conditions. The shared adapter reserves one for exact `ROWID` and rejects more than four explicit predicates before sending ZCQL. Deployment transitions fence both `COUNT_VERSION` and `REPORT_RECONCILIATION_VERSION` plus `TEST_STATUS` and `GO_LIVE_APPROVAL_STATUS`; full business prestate is validated before mutation, and every intended patch field is verified through authoritative readback. Receipt transitions use four mutable state/version fences while immutable receipt identity is verified before mutation and again after readback.

Every event key is generated once and contains no provider/customer identifier. Signing keys, bearer values, OAuth authorization, raw operator identity, CRM payloads, provider payloads, and private IDs never enter Git or runtime logs.

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
2. Conditionally update the deployment by exact `ROWID` with the observed `COUNT_VERSION`, `REPORT_RECONCILIATION_VERSION`, `TEST_STATUS`, and `GO_LIVE_APPROVAL_STATUS`. The prior step has already validated the full active-configuration, capacity, source/environment, governed-route, authorization-null, and stop-null prestate.
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
3. After that readback, choose one canonical activation instant. Conditionally update the deployment by exact `ROWID` with the observed count and reconciliation versions plus both lifecycle statuses. The complete approval, route, source, capacity, timing-null, and stop-null prestate has already been validated, and exact intended poststate must read back.
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
5. Code rollback means redeploying the last reviewed canonical seven-function artifact, or the exact prior verified Development release when the new target itself failed installation, then repeating source/route/pool/readiness readback. The unexported or unreconciled legacy approval function is not an authorized rollback target.

## Legacy retirement proof

Deletion of `retell_route_approval_control` is allowed only after all source/export and live-binding blockers are closed, canonical Development approval/activation is exercised with synthetic data, rollback is rehearsed, and an independent audit proves:

- exact canonical receipts and deployment transitions for approve, activate, revoke, replay, stale evidence, concurrent mutation, and governed-route change;
- no gateway route, Job mode, schedule, webhook, internal caller, credential, or dependency still names the legacy function;
- source-to-destination event/key mapping, counts, deterministic digests, conflicts, and quarantine disposition are reconciled;
- the legacy route remains absent after the observation window.

Until then, the safe disposition is **stopped, access-restricted, source-export pending, binding-proof pending, recoverable, and not deletion-authorized**.
