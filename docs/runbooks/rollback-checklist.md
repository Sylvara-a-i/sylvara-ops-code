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

1. Disable the affected number assignment/forwarding route where authorized and set route approval to revoked or blocked and deployment to stopped.
2. If the shared agent or resolver is suspect, stop every affected deployment. Never switch to a client-specific free-test clone or degraded intake.
3. Restore `FREE_TEST_NOTIFICATION_MODE=dry_run`, independently read it back, and pause query/CSV export without deleting calls, bindings, counts, or notification rows.
4. Determine scope from immutable deployment and call bindings, not display names, the shared Agent ID, or the number's current owner.
5. Do not reuse or move the current validation number. Preserve historical ownership, keep the stopped number inactive, and record its cooldown. Any later reuse is a separately reviewed stopped-route action with readback and re-QA.
6. Verify no email record, query, or CSV crossed clients and treat any contamination as a P0 incident.
7. Restore only a previously approved inactive/provider route or carrier destination, then independently read it back.
8. Confirm known authenticated failures receive explicit rejection or no traffic, and provider fallback reaches only the shared Configuration Unavailable gate; neither path may collect degraded intake.
9. Re-enable the current one-number internal route only after its practical limit/overshoot, replay, notification-state, query/CSV, correlation, cooldown, and rollback checks pass with zero scoped P0/P1 and new route approval. Before enabling two simultaneous deployments or a first controlled prospect test, also complete live two-number/same-version isolation.

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
