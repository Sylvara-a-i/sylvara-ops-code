# Free Revenue Leak Test End-to-End Release Contract

This document summarizes the machine-readable [release contract](free-revenue-leak-test-release-contract.json). The JSON contract is authoritative for Development implementation and acceptance.

## Purpose

The Free Revenue Leak Test covers one business number and one primary location for seven calendar days or 25 unique connected calls, whichever happens first. It measures an actual inbound call gap. It is not a paid Revenue Desk, does not book or dispatch, and cannot automatically create paid service.

The clock begins only when the approved route is actually activated. Billing begins only after the test is completed, Results Review occurs, and a separate paid-service acceptance is recorded.

## Function boundary decision

The final Development topology uses five cohesive boundaries:

1. `retell_free_test` — one internet-facing Retell signature boundary for inbound resolution, post-call events, readiness, canonical calls, notifications, and reporting.
2. `retell_free_test_retry` — a separate Job because scheduled retries have a different trigger and smaller secret set.
3. `revenue_leak_test_request_form` (`RevenueLeakTestRequestForm`) — separate because it owns Lead-only CRM access and assisted request-form sessions.
4. `revenue_leak_test_setup_form` (`RevenueLeakTestSetupForm`) — separate because it owns one-time email proof and Contact/Account/Deal setup authorization state.
5. `crm_billing_orchestrator` — separate because Billing write authority must never exist in intake or call-processing runtimes.

The split `retell_events`, `retell_inbound_resolver`, `retell_route_approval_control`, and `process_retell_events` units are replaced by the consolidated Retell runtime. Current Development readback proves that Retell uses the canonical inbound and event paths, Catalyst API Gateway is disabled, and the legacy event-processing Job pool is removed. `analytics_sync` is not part of this release; its seven disabled Crons and obsolete Job pool were removed because deterministic JSON/CSV reporting is sufficient. The five unbound legacy functions are approved for Development deletion, but the current Catalyst connector cannot perform function deletion.

This is the smallest safe topology. Combining the Form or Billing handlers with the Retell webhook would reduce the function count but expand credentials, caller types, and failure blast radius.

## Security and migration decisions

- Form 2 uses server-verifiable, one-time email proof. It stores only a keyed digest and immutable binding evidence; SMS is prohibited.
- Existing Form 2 v2 data is preserved. Nonempty and conflicting v2 stores require additive v3 tables; no row is promoted without trustworthy immutable identity.
- Every HTTP function permits only its declared method and route, authenticates the exact caller, bounds body size and read time, and rejects Production.
- Retell ownership requires validated deployment metadata or a unique number binding. The shared agent ID alone never establishes tenant ownership.
- CRM stores relationship, lifecycle, approval, report summary, and Billing readback state. Catalyst stores high-volume operational events and calls. CRM never stores raw Retell payloads, transcripts, or recordings.

## Connected-call and limit rule

A call counts once only after a unique Retell `call_id` reaches the approved shared-agent route, carries validated resolver ownership, and converges to an accepted canonical call row. Rejected, malformed, unauthorized, duplicate, or provider-failed attempts do not count.

Inbound checks reject a deployment whose stored count is already 25 or whose seven-day window has expired. Post-call processing stops the deployment immediately after the 25th unique accepted call. A rare already-in-progress overlap may cause a small overshoot; this MVP does not claim concurrency-perfect admission.

## Release gate

`READY FOR RETELL AGENT QA ONLY` is permitted only after Forms, CRM, Catalyst, reporting, Billing TEST, security rotation, replay safety, rollback, final-source deployment, and synthetic end-to-end readback all pass with no P0/P1 defect. Retell simulations, audio calls, and conversational refinement are deliberately deferred.
