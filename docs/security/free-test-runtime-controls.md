# 7-Day Free Test Runtime Security Controls

## Status

These controls are retained as historical Development evidence and contribute to the [final consolidated release contract](../product/free-revenue-leak-test-release-contract.md). They are not a security certification, legal conclusion, Production authorization, prospect/customer approval, or phone-test authorization. The earlier Catalyst proof must be migrated and repeated against final `main` before readiness.

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

- The shared runtime [`variables.json`](../../src/zoho-catalyst/revenue-desk-call-runtime/config/variables.json) is the public name/classification/format registry; real values stay in Catalyst secrets or private environment configuration.
- The Catalyst Mail adapter consumes `FREE_TEST_NOTIFICATION_MODE` with the reviewed Development values `dry_run` or `send_development` and `FREE_TEST_MAIL_FROM` with a privately configured verified Development sender. The committed/default operating mode is `dry_run`; `send_development` is allowed only for the single controlled delivery/readback, after which mode returns to `dry_run`. Do not substitute `CATALYST_MAIL_MODE` or silently default either variable.
- Use distinct HMAC keys for provider verification, event/call identity, and number lookup where the contract specifies them. Never log or reuse them across purposes.
- Development and Production identities, projects, tables, numbers, agents, providers, recipients, Connections, and keys remain separate.
- The call runtime permits active behavior only in reviewed Development state. Dark Production permits disabled/readiness behavior only and returns before SDK or data access. CRM/Billing mutation and Analytics synchronization remain independently gated outside the call path.
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

Before a controlled internal Development phone test, prove two-client isolation with distinct synthetic number values in Catalyst and use the single existing non-customer Development number only for the active phone deployment. A second live number is deferred and is not required to begin this one-number internal test. Before activating two concurrent deployments or claiming the first-controlled-prospect technical gate, bind two dedicated numbers to the same reviewed shared agent version and repeat live isolation proof.

The current Catalyst acceptance evidence covers:

1. authenticity rejection and timestamp/replay defense;
2. exact configuration gate and fail-closed missing-variable behavior;
3. strict seven-day eligibility and the practical handled-count stop, including honest in-flight overshoot;
4. no cross-client state in resolution, calls, metadata, email rows, queries, or CSV exports;
5. one durable result under event replay/retry/reordering;
6. current-number freeze, documented post-completion cooldown, and delayed-event ownership safety without reassignment;
7. one controlled `send_development` delivery with provider/inbox readback, no duplicate on replay, safe ambiguity handling, and restoration to `dry_run`;
8. redacted logs/errors/provider responses;
9. least-privilege Development identities and no Production reachability;
10. immutable lifecycle correlation; and
11. rehearsed containment with preserved evidence.

Current classification is **NOT READY FOR RETELL AGENT TESTING**. The earlier four-table/two-function proof is migration evidence, not proof of the canonical six-function runtime, CRM/Billing and Analytics boundaries, canonical table generation, cleanup, key rotation, final-main parity, or dark-Production isolation.

Retell voice/audio quality and provider behavior for timeout, 503, malformed response, invalid override, and endpoint unavailability remain P2 deferred evidence to collect during later controlled internal calls. A second live number is also deferred. Neither deferral authorizes a prospect call or weakens the one-number ownership rule. The [legal archive](../legal-compliance/README.md) is research and a historical conservative profile, not legal advice or an automatic approval/prohibition; prospect-facing review and route approval remain separate.
