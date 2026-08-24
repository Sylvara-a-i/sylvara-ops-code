# 7-Day Free Test Development Reconciliation

Last updated: 2026-08-24

Environment: Development only

Current classification: **READY FOR CONTROLLED INTERNAL PHONE TEST**

This sanitized record reconciles the repository, Catalyst Development, and the minimum Retell configuration needed to hand the system to a later controlled internal phone test. It contains no private identifiers, endpoints, phone numbers, recipients, secrets, payloads, transcripts, recordings, or caller content. Production, prospects, customers, contractor forwarding, CRM, Analytics, SMS, billing, booking, dispatch, transfers, pricing, and payments remained untouched.

[ADR 0006](../adr/0006-shared-seven-day-monitor-with-client-number-isolation.md) remains authoritative: one shared free-test agent, one dedicated number per active deployment, and client variation in immutable Catalyst configuration. The present scope uses one non-customer Retell Development number for one active phone deployment. A second live number and paid/native voice or provider-fallback testing are deferred; this document does not claim the first-controlled-prospect technical gate.

## Current-State Audit

| Component | Expected state | Actual Development state | Gap | Action taken | Final status |
| --- | --- | --- | --- | --- | --- |
| Retell shared agent | One shared bounded-intake agent | Exactly one shared agent is published at reviewed version 0 | Voice/audio refinement deferred | Read back agent, flow, version, capabilities, storage, retention, naturalness, and post-call fields | Ready for later controlled voice testing |
| Retell flow | Exact first-node gate, neutral failure, natural close | Published 47-node flow has the seven-field gate, no-data Configuration Unavailable path, client greeting, and deliberate close | Paid/native voice behavior not run | Final full native text batch passed 25/25; no prohibited tools found | Text/readback accepted; voice deferred |
| Retell number model | One dedicated number per active deployment | One non-customer Development number is bound to the shared version and inbound webhook | Second live number intentionally deferred | Unbound, read back, rebound, and resolved the existing number | One-number internal route ready; two-number prospect proof not claimed |
| Inbound resolver | Signed, unique called-number resolution and exact gate | Valid signed A/B synthetic requests resolved only their deployment; invalid cases failed closed | Public edge buffers bodies before function execution | Exercised signature, freshness, media type, size, ownership, state, expiry, count, configuration, and agent-binding cases | Accepted for controlled internal test |
| Configuration store | Four exact private Development tables | All tables, columns, constraints, encrypted/audited JSON fields, and empty App User permissions match source | None in current scope | Read back schema; legacy `RetellEventReceipts` left untouched | Verified |
| Approval control | Only approved active routes resolve | Unapproved, inactive, stopped, expired, exhausted, and mismatched deployments rejected without intake | None | Exercised durable row-state matrix | Verified |
| Seven-day stop | Reject at expiration | Expired synthetic deployment rejected | None | Exercised exact Development boundary | Verified |
| Practical 25-call stop | Count each unique handled call once and stop at 25 | Unique calls reached 25, deployment completed with `call_limit_reached`, and later inbound rejected | In-flight overlap can still overshoot | Exercised durable sequential limit; no reservation system added | Verified within approved MVP tradeoff |
| Event ingestion | Signed, minimized, idempotent receipts | `call_ended` and `call_analyzed` were accepted in either order; malformed/ownership conflicts quarantined | None | Exercised replay, reorder, conflict, and minimization paths | Verified |
| Event/call processor | One canonical call and count under replay | Replays remained duplicate-safe with one canonical call, one count, and one notification row | None | Exercised both event orders and full replay | Verified |
| Retry Job | Bounded manual recovery; recurring schedule disabled | Empty and controlled retryable-state runs completed; `FreeTestRetry1m` remains disabled | None | Read back Job pool/target/source and durable result | Verified; Cron intentionally disabled |
| Canonical call store | Tenant-bound, minimized call record | A and B synthetic calls remained partitioned; raw payload, transcript, recording URL, and plaintext called number were not retained | One stopped historical synthetic binding artifact is excluded from active reports | Preserved immutable evidence instead of rewriting history | Active-deployment behavior verified; archival artifact is P2 |
| Email notification | Catalyst Mail only, durable state, replay-safe | Verified sender; one internal Development message accepted and observed once; replay made no second provider invocation; mode restored to `dry_run` | No prospect/customer sending authorized | Exercised `send_development` once and restored containment | Verified for internal Development |
| Internal reporting | Deterministic per-client query and JSON/CSV projection | Client/deployment allowlist and sanitized export source/tests are complete; a private active-deployment JSON/CSV export reconciled to Catalyst | Later phone-test data is not yet present | Added fixed summary plus call rows; Analytics remains deferred | Verified for current Development data |
| CRM summary path | Disabled | No CRM read or write in free-test runtime | None | Kept disabled | Verified |
| Analytics path | Not required for internal test | No Analytics integration or write | Prospect report readback remains later work | Kept reporting in Catalyst | Correctly deferred |
| Security | Development-only, verified, bounded, redacted | Positive readiness is 200; negative token/method/path/query/host cases fail closed; logs use opaque correlation | Retell provider-fallback phone behavior deferred | Exercised signed matrices, minimization, isolation, and Production rejection | Catalyst controls accepted; fallback is P2 |
| Runtime/source parity | Exact reviewed revision deployed and independently read back | Revision `d4f5af31be310df400532641ef163c16de31066c` matched 24 Advanced I/O and five retry-package files | Any later final commit requires redeploy/readback | Sanitized pullback comparison completed | Proven for recorded revision; repeat after final commit |

## Catalyst Development Snapshot

- `retell_free_test`: Advanced I/O, Node.js 24, 256 MB.
- `retell_free_test_retry`: Job Function, Node.js 18, 256 MB.
- Function Job pool: 512 MB.
- `FreeTestRetry1m`: every minute, zero platform retries, disabled.
- Tables: `FreeTestDeployments`, `FreeTestRetellEventReceipts`, `FreeTestCalls`, and `FreeTestNotifications`.
- Readiness: HTTP 200, Development identity, exact source revision, all four tables readable, notification mode `dry_run`, non-cacheable response.
- Notification: one provider-accepted internal Development send, one inbox message, no second provider invocation on replay, restored `dry_run`.
- Rollback: function delete/absence/redeploy was previously proven; the current Retell number was unbound/read back/rebound and the signed resolver passed after restoration.

Secrets and private sender/recipient values remain only in platform configuration. Do not publish or reproduce them.

## Signed Lifecycle Evidence

The deployed handler was exercised with valid and invalid Retell-compatible signatures without exposing the verification key.

- Valid inbound A and B requests returned only their configuration and did not increment handled count.
- Invalid, stale, missing, or malformed signatures; malformed JSON; incorrect content type; oversized bodies; unknown numbers; invalid deployment states; ownership/version/capability/coverage/agent mismatches; expiry; and stored count 25 all failed closed.
- The Catalyst edge completed public-body buffering before Advanced I/O execution. A stalled public body therefore reached the function only after buffering, while a truncated request terminated at the gateway. Local stream tests cover application timeout/abort codes; the public acceptance criterion is fail-closed with zero unintended writes.
- `call_ended` then `call_analyzed` and the reverse order converged.
- Duplicate delivery produced no duplicate call, count, notification, or provider send.
- Shared `agent_id` alone never established client ownership.
- Sensitive synthetic content was minimized; raw payloads, transcripts, recordings, and plaintext called numbers were not retained.

## Readiness Lanes

| Lane | Status | Evidence boundary |
| --- | --- | --- |
| Catalyst/Zoho Development lifecycle | **Complete** | Four tables, two functions, readiness, signatures, durable lifecycle, retry, email, count/expiry, and rollback controls proven |
| Controlled internal Development phone test | **READY** | One existing non-customer number may be used for the minimum internal voice/fallback work later; no prospect/customer route |
| Live two-number isolation | **Deferred** | Backend two-client isolation is proven; purchase and live second-number proof were declined for now |
| Controlled prospect test | **NOT READY** | Requires live two-number evidence if multiple deployments are active, phone/voice/fallback acceptance, prospect-facing legal/privacy review, approved recipient, and explicit route approval |
| Production | **Not authorized** | Outside this PR and task |

## Deferred Work And Defect Classification

No scoped Catalyst P0 or P1 behavior defect remains.

- **P2 — Retell controlled voice/fallback evidence:** interruption/noise/correction quality and timeout/503/malformed/invalid-override/unavailable number-webhook behavior remain untested by a real inbound call. Deferred by owner to conserve Retell credits.
- **P2 — Second Development number:** live two-number/same-version isolation is deferred. This is not required to begin a one-number internal test, but the first-controlled-prospect technical gate cannot be claimed without it when two deployments are to be active.
- **P2 — Historical synthetic evidence artifact:** one stopped synthetic record reflects an earlier temporary binding. It is excluded from active-deployment reporting; immutable evidence was preserved rather than rewritten.
- **P3 — Analytics/CRM presentation:** automated Analytics ingestion and CRM summaries remain intentionally absent.

## Operating Boundary

The current Development number remains frozen to its active synthetic phone deployment. Do not reuse it during validation. On completion, stop the deployment, unbind the number, preserve immutable ownership evidence, and place the number into cooldown before any separately reviewed reuse.

Before any real contractor call, separately record the prospect-facing legal/privacy decision, approved caller/data/retention treatment, approved recipient, exact route and rollback, and explicit route approval. This record makes no legal conclusion and grants no Production or prospect authorization.

Before final PR handoff, if the reviewed commit differs from `d4f5af31be310df400532641ef163c16de31066c`, redeploy that exact revision, update both `SOURCE_REVISION` variables and synthetic deployment rows, re-run readiness and one signed resolver/lifecycle smoke test, and repeat sanitized source pullback parity. Keep the retry Cron disabled and notification mode `dry_run`.
