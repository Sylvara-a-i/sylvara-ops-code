# 7-Day Free Test Development Reconciliation — 2026-08-22

## Scope And Evidence Boundary

This is a sanitized, read-only reconciliation of repository contracts and observable Development metadata on 2026-08-22. It contains no private platform identifiers, endpoints, customer facts, credentials, call content, or deployment instructions. An observed object is not proof that its source is reproducible, its route is reachable, or its behavior passed acceptance.

No Production system, real prospect/client record, telephone route, notification destination, or billing state was changed. The governing architecture is [ADR 0006](../adr/0006-shared-seven-day-monitor-with-client-number-isolation.md).

## Current-State Audit

| Component | Expected state | Actual state observed | Gap | Action taken in repository | Final status |
| --- | --- | --- | --- | --- | --- |
| Retell shared agent | One accepted shared free-test agent | One shared Development draft was observed | Publication, immutable version selection, settings, and behavior are not accepted | Shared-agent and conversation contracts plus offline validator were reconciled and synthetic-tested | Source contract passed; live configuration parity unproven |
| Retell flow | Shared bounded intake, exact gate, natural close, and capability denials | A 46-node Development flow was observed | The observed live gate did not match the exact approved seven-field gate; native conversation behavior was not rerun | Exact gate, 30-case corpus (11 P0/19 P1), 220 shadow fixtures, and 11 canonical outcomes are source controlled; focused Python tests passed 41/41 and resolver coverage tests passed 6/6 | Source contract passed; observed Development flow still requires correction/readback/native tests |
| Retell number model | One dedicated number per active deployment | One Development number was observed and was not bound to the shared agent/deployment path | No two-client number binding, assignment history, or readback proof | Immutable assignment schema, history, isolation, and reassignment behavior are implemented in the synthetic core | Core source synthetic-tested; provider binding/readback unproven |
| Inbound resolver | Unique `to_number` resolution and Configuration Unavailable on any uncertainty | Coverage-mode source existed; a reproducible deployed resolver could not be proved | Exact ownership resolution, admission, and deployed route are unproven | Exact gate, number/deployment resolution, permanent fail-closed reservation, and two-client core tests are implemented | Core source synthetic-tested; HTTP/Catalyst boundary and deployed route absent/unproven |
| Configuration store | Versioned per-client deployment snapshots | Fourteen tables were observed in the relevant Development project | Table purpose/schema and parity with the approved configuration model were not established | Explicit Data Store schema and deterministic in-memory contract are source controlled | Schema/core synthetic-tested; Catalyst Data Store adapter/conditional uniqueness and live table parity unproven |
| Approval control | Explicit route approval plus active test status | CRM approval/status controls exist as setup evidence | Catalyst snapshot/readback and enforcement are unproven | Existing CRM values, explicit activation, and approval enforcement are implemented in the core | Core source synthetic-tested; CRM-to-Catalyst snapshot/readback unproven |
| Duration/count enforcement | Atomic seven days or 25 eligible calls, whichever occurs first | No accepted runtime enforcement was proved | Concurrency, replay, expiry, and cleanup-independent admission lack runtime evidence | Core uses permanent capacity-blocking reservations, distinct finalized handled count, exact seven-day boundary, and 25-slot concurrency tests | Core source synthetic-tested; Catalyst atomic conditional semantics unimplemented/unproven |
| Retell event ingestion | Authenticated, minimized, durable, idempotent ingress | Six function definitions were observed in the relevant Development project and all were undeployed | No reachable route or successful durable ingress readback; route listing failed | Raw-body verification, schema checks, minimized event claims, replay conflict, and retry states exist in the service core | Core source synthetic-tested; HTTP wrapper, durable claim/acknowledgement, Catalyst adapter, deployed route, and readback absent/unproven |
| Event processor | Retry-safe normalization and immutable ownership outside provider timeout | No accepted execution/readback evidence | Duplicate, delayed, reordered, malformed, and retry behavior unproven in runtime | Ownership priority, reordered analyzed/ended handling, deduplication, retry/reconciliation, notification, and final-only reporting projection are implemented; current `processEvent` invokes synthetic adapters synchronously | Core source synthetic-tested; durable queue/worker and Catalyst execution unimplemented/unproven |
| Canonical call store | One opaque keyed-HMAC Call Key with immutable client/deployment/configuration ownership | No accepted end-to-end call record was observed | Durable deduplication and tenant partition are unproven | Opaque key derivation, immutable ownership binding, exactly-one outcome, handled counting, and cross-client checks are implemented in memory | Core source synthetic-tested; Catalyst durable store/atomicity unimplemented/unproven |
| Notification pipeline | Durable, idempotent Catalyst notification with retry and terminal failure | No notification implementation or delivery evidence was observed | Adapter, outbox state, failure handling, and recipient isolation require proof | Deterministic synthetic adapter, approved-recipient binding, idempotency, backoff, ambiguous-result reconciliation, and terminal failure are implemented | Core source synthetic-tested; Catalyst durability unproven; real sending intentionally prohibited |
| CRM summary path | Approved bounded aggregate/relationship summary only | Free-test CRM setup controls exist | Approved summary fields, idempotency, and readback were not proved | Ownership boundary is reconciled and the Development adapter rejects CRM writes | Correctly disabled; any future summary contract/readback remains unproven |
| Analytics path | Minimized client-partitioned derived facts | Reporting contracts existed | Import job, rejection handling, reconciliation, and client isolation were not proved | Final-only synthetic projection and client/deployment/call idempotency are implemented | Core source synthetic-tested; real Analytics integration intentionally prohibited/unproven |
| Security rules | Authenticity, replay defense, validation, redaction, least privilege, environment separation | Repository security and legal controls exist | Runtime signatures, secrets, routes, logs, rate limits, and effective grants were not read back | Development-only configuration, HMAC identities, validation, redacted logging contract, PII minimization, and Production rejection are source controlled | Core source synthetic-tested; HTTP enforcement, least-privilege grants, secret binding, and runtime logs unproven |
| Runtime/source parity | Every Development function, flow, table contract, variable, route, and worker boundary reproducible from Git | Observed Development metadata did not map to an accepted deployable repository revision | Runtime/source parity is unproven; route inventory could not be listed | Retell contracts and Catalyst core are now represented; the HTTP function, Catalyst Data Store adapter, and durable queue/worker boundary remain incomplete | P0 launch blocker; Development end-to-end package not yet reproducible/deployable |

## Readiness Decision

**NOT READY** for a Development phone test or controlled prospect test.

The repository may exercise synthetic resolver, processor, notification-adapter, and reporting behavior without telephony or external delivery. That is not a telephone test and does not close the runtime/source-parity gap.

The current [legal and compliance control archive](../legal-compliance/README.md) also blocks this free-test phone path. Its only contemplated telephone profile is internal, non-sales QA with prior written tester authorization, a carrier-level one-way media gate and keypad assent before audio reaches an AI/data system, no retained call content, and no post-call handoff. It does not authorize prospect/customer calls, forwarding, recording, retained transcription, notifications, CRM/Analytics handoff, or the free-test lifecycle described here.

The current [product boundary](../product/README.md) allows this plumbing-first after-hours/overflow validation path only as bounded intake and outcome evidence. It does not authorize booking, dispatch, technician assignment, pricing, payment, arbitrary transfer, outbound/SMS behavior, direct Retell mutations, a generic voice platform, another trade, or a paid Revenue Desk. Any such capability in the free-test path blocks acceptance rather than expanding the offer.

## Evidence Still Required

Before **READY FOR DEVELOPMENT END-TO-END TEST**:

1. all runtime functions, schemas, configuration contracts, environment-variable names, and deployment manifests are sanitized and reproducible from one reviewed source revision;
2. offline/synthetic two-client tests prove the exact gate, seven-day/25-call admission model, immutable ownership, replay safety, durable notifications, reporting isolation, reassignment, retry, and rollback;
3. every P0 and P1 source/fixture test passes; and
4. the Development deployment, readback, lifecycle-trace, and rollback procedure is complete and does not require Production access.

The Development end-to-end test must then produce, rather than assume, exact route/function/table/variable/shared-agent readback, runtime/source parity, atomic Data Store behavior, and immutable correlation from resolver admission through event, canonical outcome, notification, Analytics outbox, and any approved summary.

Before any telephone test, the Development end-to-end evidence plus separate legal, privacy, vendor, consent, data-use/retention, carrier-media-gate, environment, number, and route approvals must close. Before a real prospect test, approved client configuration, recipient verification, forwarding rollback, and explicit route approval must be read back. Repository completion alone grants none of those approvals.

## Operator Evidence Record

For each future Development deployment or test, retain privately:

- immutable source revision and build artifact;
- sanitized environment and target identity;
- shared agent/version readback;
- dedicated number assignment/version and non-overlapping interval readback;
- deployment/configuration version and approval readback;
- test clock, limit, pre/post admission count, and stop reason;
- resolver, event, call, outcome, notification, reporting, and CRM-summary correlation identifiers;
- provider acceptance/reconciliation result with secrets and message bodies removed;
- test report, P0/P1 disposition, operator, approval reference, and rollback readback.

Keep private identifiers and evidence in the approved private audit system, not GitHub.
