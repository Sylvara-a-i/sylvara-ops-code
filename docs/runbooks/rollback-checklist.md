# Rollback Checklist

## Before Deployment

- [ ] Define the exact rollback trigger and decision owner.
- [ ] Record the last known-good immutable artifact or configuration.
- [ ] Confirm backups, exports, or version history are usable without copying sensitive data into GitHub.
- [ ] Identify irreversible effects, including sent messages, calls, financial records, or third-party side effects.
- [ ] Confirm rollback permissions and target environment through a read-only check.
- [ ] Test the rollback in a non-production environment when practical.
- [ ] Define how authoritative downstream systems will be reconciled.

Do not deploy when no safe containment path exists for a material failure.

## Rollback Triggers

Initiate containment and evaluate rollback when:

- smoke tests fail or required readback does not match;
- caller routing, escalation, or booking behavior is unsafe;
- duplicate or unauthorized records are created;
- authentication, signature verification, or authorization fails;
- error rate or latency exceeds the approved threshold;
- secrets, PII, client data, or production configuration may be exposed;
- the deployed artifact differs from the reviewed artifact;
- the target identity or environment cannot be confirmed.

For the 7-Day Free Test, also contain immediately on unknown/ambiguous number resolution, configuration-gate bypass, count/expiry bypass, stale number ownership, cross-client configuration/call/notification/reporting state, duplicate notification, or loss of immutable correlation evidence.

## Execution

1. Stop further automated writes or traffic expansion when safe.
2. Read current state and determine whether the last action succeeded, failed, or is unknown.
3. Obtain explicit approval for the exact rollback or compensating action.
4. Apply the smallest reversible action using the approved immutable target.
5. Do not blindly retry an ambiguous write.
6. Read back runtime configuration and each authoritative downstream system.
7. Run the focused smoke tests with synthetic data.
8. Record a sanitized outcome in [Deployment Log](deployment-log.md).

## 7-Day Free-Test Containment

1. Fail closed in Data Store first: conditionally set the affected deployment to `TEST_STATUS=Stopped`, `GO_LIVE_APPROVAL_STATUS=Revoked`, `STOP_REASON=sylvara_stopped`, and a canonical `STOPPED_AT`, then independently read back the exact row and version. Never clear evidence to manufacture a clean rollback.
2. Disable the affected number assignment/forwarding route only with separately scoped authorization, then independently prove the provider route is stopped or restored to the approved fallback. An ambiguous provider response remains contained and unreconciled.
3. If the shared agent or resolver is suspect, stop every affected deployment. Never switch to a client-specific free-test clone or degraded intake.
4. Restore the canonical notification mode to `dry_run`, independently read it back, and pause query/CSV export without deleting calls, bindings, counts, authorization receipts, or notification rows.
5. Determine scope from immutable deployment, approval, activation, and call bindings—not display names, the shared Agent ID, or the number's current owner.
6. Do not reuse or move the current validation number. Preserve historical ownership, keep the stopped number inactive, and record its cooldown. Any later reuse is a separately reviewed stopped-route action with readback and re-QA.
7. Verify no email record, query, or CSV crossed clients and treat any contamination as a P0 incident.
8. Restore only a previously approved inactive/provider route or carrier destination, then independently read it back.
9. Confirm known authenticated failures receive explicit rejection or no traffic, and provider fallback reaches only the shared Configuration Unavailable gate; neither path may collect degraded intake.
10. Re-enable the current one-number internal route only after its practical limit/overshoot, replay, notification-state, query/CSV, correlation, cooldown, and rollback checks pass with zero scoped P0/P1, a fresh exact-version approval receipt, authoritative route-activation readback, and a chained activation receipt. Set `ACTUAL_START_AT` only after that readback and require `EXPIRES_AT - ACTUAL_START_AT = 604800000` milliseconds. Before enabling two simultaneous deployments or a first controlled prospect test, also complete live two-number/same-version isolation.

Stopping a test never activates paid service or a Revenue Desk.

## Data And Financial Safety

- Do not delete records merely to make counts match.
- Prefer traceable compensating actions where the authoritative system requires them.
- Never invent an accounting balance, payment state, call outcome, or customer record.
- Serialize high-risk corrections and stop on the first mismatch.
- Escalate legal, financial, privacy, or customer-notification decisions to an authorized human.

## Completion Criteria

- [ ] Traffic or automation is stable at the approved state.
- [ ] Runtime configuration matches the approved rollback target.
- [ ] Authoritative systems reconcile.
- [ ] Duplicate and retry queues are contained.
- [ ] Smoke tests pass or the system remains safely disabled.
- [ ] Incident and deployment records are complete in the approved private system.
- [ ] A regression test or follow-up change is assigned before normal rollout resumes.

## Free-Test Field Setup And Handoff Containment

- [ ] Disable the field-setup launch, exchange, status, and decision routes and unpublish the hosted client before changing data.
- [ ] Revoke the field-setup Connection when external mutation must stop independently.
- [ ] Restore the preserved prior CRM button assignment; do not delete either function or evidence.
- [ ] Close open verification windows and stop new number reservations.
- [ ] Preserve journey, conversion, number, verification, notification, approval, activation, and provider-event evidence.
- [ ] Never replay an ambiguous conversion, reservation, route, transfer, notification, or activation write.
- [ ] Keep `call_gap_capture_handoff_v2` disabled/unbound or remove only its Draft binding; do not modify the `call_gap_monitor_v1` rollback profile.
- [ ] Distinguish human handoff, Retell infrastructure fallback, and customer phone-system rollback during every readback.
- [ ] For a future active route, use only the separately approved Gabriel stop/rollback action and independently verify the restored customer route.
