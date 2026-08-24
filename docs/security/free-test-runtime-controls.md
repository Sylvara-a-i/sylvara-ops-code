# 7-Day Free Test Runtime Security Controls

## Status

These controls govern offline/synthetic Development validation and any separately approved controlled internal Development phone test for [ADR 0006](../adr/0006-shared-seven-day-monitor-with-client-number-isolation.md). They are not a security certification, legal conclusion, Production authorization, or proof of runtime configuration. Prospect/customer approval remains a separate unresolved decision. Current evidence gaps are recorded in the [Development reconciliation](../runbooks/free-test-development-reconciliation-2026-08-22.md).

## Trust And Tenant Boundary

- Resolve the called number to exactly one current binding, deployment, client, and configuration version before client-specific intake.
- Require the complete seven-field gate and approval/status/expiry/count invariants from one consistent snapshot.
- Treat the shared Retell `agent_id` as product identity, never tenant evidence.
- Derive an opaque call lookup key with a keyed HMAC of the provider call identifier; do not retain/log the raw identifier. Bind that key once to immutable client/deployment/configuration ownership and reject later attempts to move it.
- For a known authenticated invalid, unknown, ambiguous, conflicting, inactive, expired, or exhausted resolution, return HTTP 200 explicit rejection, start no agent, and create no resolver-side write. Transport/authentication/timeout/503/malformed/invalid-override failure may fall back only to the number-bound shared agent's exact Configuration Unavailable no-intake gate. Do not perform degraded intake.
- Partition calls, email notification rows, queries, CSV exports, caches, retries, and operator readback by both client and deployment.

Cross-client configuration, call ownership, email notification, query, or CSV exposure is a P0 incident. Stop every affected route and follow the [rollback checklist](../runbooks/rollback-checklist.md).

## Request And Replay Controls

- Accept only exact allowlisted methods, paths, media types, event types, agent/version, and bounded body sizes.
- Verify Retell authenticity against the unchanged raw body before parsing business data; enforce the approved timestamp window and constant-time digest comparison.
- Reject malformed, unauthenticated, stale, oversized, or unsupported post-call events without side effects or detailed public errors. For the pre-call resolver, an authentication or transport failure may trigger Retell fallback and therefore must be paired with the shared agent's exact no-intake gate.
- Durably claim a minimized event fingerprint before provider acknowledgement. Duplicate, delayed, reordered, retrying, and conflicting delivery must remain safe.
- Pre-call eligibility reads the durable handled count and fails closed at 25 or more. Post-call processing increments once per unique eligible handled call. Calls already in flight may create a documented overshoot; do not misrepresent the MVP as an exact concurrency cap.
- Apply bounded concurrency, request timeouts, payload limits, and coarse abuse/rate controls. Do not let throttling fail open to generic intake.

## Secrets And Least Privilege

- The component-owned [`variables.json`](../../src/zoho-catalyst/retell-free-test/config/variables.json) is the public name/classification/format registry; real values stay in Catalyst secrets or private environment configuration.
- The Catalyst Mail adapter consumes `FREE_TEST_NOTIFICATION_MODE` with the reviewed Development values `dry_run` or `send_development` and `FREE_TEST_MAIL_FROM` with a privately configured verified Development sender. The committed/default operating mode is `dry_run`; `send_development` is allowed only for the single controlled delivery/readback, after which mode returns to `dry_run`. Do not substitute `CATALYST_MAIL_MODE` or silently default either variable.
- Use distinct HMAC keys for provider verification, event/call identity, and number lookup where the contract specifies them. Never log or reuse them across purposes.
- Development and Production identities, projects, tables, numbers, agents, providers, recipients, Connections, and keys remain separate.
- The Development package rejects Production mode, restricts notification to Catalyst Mail email, disables CRM, and has no Analytics integration.
- Grant ingress, the retry Job, and notification processing only the tables/secrets each requires. Catalyst Mail send capability remains unreachable in `dry_run`; Retell never receives a delivery credential.
- Missing required variables, secret-store access, table contract, or target identity fails at startup or request boundary.

## Data Minimization And Logging

- Store only allowlisted structured caller fields necessary for callback and classification. Do not intentionally collect card/bank data, SSNs/government IDs, passwords/codes, unrelated medical data, or unrelated sensitive PII.
- Redirect or end sensitive-data attempts and omit prohibited values from events, call records, email rows, CSV exports, CRM, logs, and test output.
- Do not log raw bodies, signatures, headers, tokens, phone numbers, recipient destinations, transcripts, recordings, summaries, provider response bodies, private IDs, or configuration values.
- Use opaque immutable correlation identifiers and coarse stages/outcome classes for observability.
- Default Development email rows store `DryRunRecorded`, zero attempts, and `CATALYST_MAIL_DRY_RUN`. The one controlled `send_development` proof may use `Pending`, `Sending`, `Sent`, `RetryRequired`, `Ambiguous`, or `TerminalFailure`; provider/inbox readback is required, and ambiguous or stale `Sending` state is never blindly resent.
- Apply finite retention and governed deletion/correction in the owning private system. GitHub contains only synthetic fixtures and sanitized contracts.

## Security Acceptance

Before a controlled internal Development phone test, prove with two synthetic clients, two dedicated synthetic numbers, and the same reviewed shared agent version:

1. authenticity rejection and timestamp/replay defense;
2. exact configuration gate and fail-closed missing-variable behavior;
3. strict seven-day eligibility and the practical handled-count stop, including honest in-flight overshoot;
4. no cross-client state in resolution, calls, metadata, email rows, queries, or CSV exports;
5. one durable result under event replay/retry/reordering;
6. initial-validation number freeze, documented post-completion cooldown, and delayed-event ownership safety without reassignment;
7. one controlled `send_development` delivery with provider/inbox readback, no duplicate on replay, safe ambiguity handling, and restoration to `dry_run`;
8. redacted logs/errors/provider responses;
9. least-privilege Development identities and no Production reachability;
10. immutable lifecycle correlation; and
11. rehearsed containment with preserved evidence.

Current classification is **NOT READY**: the Catalyst Development phase is incomplete and controlled internal phone testing is not ready. The four-table schema and App User denial, two-function source parity, disabled retry Cron, non-secret `dry_run` configuration, fail-closed 503 readiness response, and function delete/redeploy rollback are proven. The four runtime secrets and verified mail sender are absent, and no signed request, durable row, immediate Job, email, Retell route, or call has been exercised. No scoped P0/P1 may remain before **READY FOR CONTROLLED INTERNAL PHONE TEST**. A phone test additionally requires an explicit owner-approved scope, Development route/settings readback, data-handling decision, tester/script boundary, and rollback. The [legal archive](../legal-compliance/README.md) is research and a historical conservative profile, not legal advice or an automatic approval/prohibition; record any professional review required for the actual facts privately.
