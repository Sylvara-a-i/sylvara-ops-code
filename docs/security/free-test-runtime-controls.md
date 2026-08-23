# 7-Day Free Test Runtime Security Controls

## Status

These controls govern Development source and synthetic validation for the architecture in [ADR 0006](../adr/0006-shared-seven-day-monitor-with-client-number-isolation.md). They are not a security certification, legal approval, Production authorization, or proof of runtime configuration. The current evidence gaps are recorded in the [Development reconciliation](../runbooks/free-test-development-reconciliation-2026-08-22.md).

## Trust And Tenant Boundary

- Resolve the called number to exactly one immutable assignment, deployment, client, and configuration version before client-specific intake.
- Require the complete seven-field gate and approval/status/expiry/count invariants from one consistent snapshot.
- Treat the shared Retell `agent_id` as product identity, never tenant evidence.
- Derive an opaque call lookup key with a keyed HMAC of the provider call identifier; do not retain/log the raw identifier. Bind that key once to immutable client/deployment/configuration ownership and reject later attempts to move it.
- Fail through Configuration Unavailable on zero/multiple matches, conflict, stale state, or missing trust evidence. Do not perform degraded intake.
- Partition calls, notifications, reporting facts, queries, exports, caches, retries, and operator readback by both client and deployment.

Cross-client configuration, call ownership, notification, or Analytics exposure is a P0 incident. Stop every affected route and follow the [rollback checklist](../runbooks/rollback-checklist.md).

## Request And Replay Controls

- Accept only exact allowlisted methods, paths, media types, event types, agent/version, and bounded body sizes.
- Verify Retell authenticity against the unchanged raw body before parsing business data; enforce the approved timestamp window and constant-time digest comparison.
- Reject malformed, unauthenticated, stale, oversized, or unsupported requests without side effects or detailed public errors.
- Durably claim a minimized event fingerprint before provider acknowledgement. Duplicate, delayed, reordered, retrying, and conflicting delivery must remain safe.
- Pre-call admission uses an atomic reserved-slot state distinct from finalized handled count. Source-model deduplication by identical signed-request fingerprint is not live proof; Retell retry stability and Catalyst atomicity require Development readback.
- Apply bounded concurrency, request timeouts, payload limits, and coarse abuse/rate controls. Do not let throttling fail open to generic intake.

## Secrets And Least Privilege

- The component-owned [`variables.json`](../../src/zoho-catalyst/retell-free-test/config/variables.json) is the public name/classification/format registry; real values stay in Catalyst secrets or private environment configuration.
- Use distinct HMAC keys for provider verification, admission identity, event identity, and number lookup where the contract specifies them. Never log or reuse them across purposes.
- Development and Production identities, projects, tables, numbers, agents, providers, recipients, Connections, and keys remain separate.
- The Development package rejects Production mode, uses only synthetic notification/Analytics adapters, and disables CRM summary writes.
- Grant ingress only the tables/secrets it requires; grant workers only their specific outbox/destination access. Provider delivery credentials must not be available to Retell.
- Missing required variables, secret-store access, table contract, or target identity fails at startup or request boundary.

## Data Minimization And Logging

- Store only allowlisted structured caller fields necessary for callback and classification. Do not intentionally collect card/bank data, SSNs/government IDs, passwords/codes, unrelated medical data, or unrelated sensitive PII.
- Redirect or end sensitive-data attempts and omit prohibited values from events, call records, notifications, Analytics, CRM, logs, and test output.
- Do not log raw bodies, signatures, headers, tokens, phone numbers, recipient destinations, transcripts, recordings, summaries, provider response bodies, private IDs, or configuration values.
- Use opaque immutable correlation identifiers and coarse stages/outcome classes for observability.
- Store sanitized provider status/acceptance references without secrets. An ambiguous notification result remains unresolved until reconciled.
- Apply finite retention and governed deletion/correction in the owning private system. GitHub contains only synthetic fixtures and sanitized contracts.

## Security Acceptance

Before any telephone evaluation, prove with two synthetic clients:

1. authenticity rejection and timestamp/replay defense;
2. exact configuration gate and fail-closed missing-variable behavior;
3. atomic seven-day/25-call enforcement under concurrency;
4. no cross-client state in resolution, calls, metadata, notifications, or reports;
5. one durable result under event replay/retry/reordering;
6. safe number reassignment and delayed-event handling;
7. redacted logs/errors/provider responses;
8. least-privilege Development identities and no Production reachability;
9. immutable lifecycle correlation; and
10. rehearsed containment with preserved evidence.

No P0/P1 may remain. Telephone testing additionally requires the separate legal, privacy, vendor, consent, carrier-media-gate, data-use/retention, route, and deployment approvals in the [legal control archive](../legal-compliance/README.md).
