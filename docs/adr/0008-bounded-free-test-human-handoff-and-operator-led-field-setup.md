# ADR 0008: Bounded Free-Test Human Handoff And Operator-Led Field Setup

- Status: Accepted for source design; live installation not authorized
- Effective: 2026-08-25 (America/Chicago)
- Decision owner: Sylvara founder/operator
- Scope: Free Revenue Leak Test source candidate only
- Depends on: [ADR 0006](0006-shared-seven-day-monitor-with-client-number-isolation.md) and the [release contract](../product/free-revenue-leak-test-release-contract.md)
- Deployment, publication, CRM installation, Retell import, call, message, route, and merge authorization: Not granted

## Context

The Free Revenue Leak Test already has two bounded forms, one shared internal Retell agent, and a Catalyst runtime that isolates clients by dedicated number, deployment, and immutable configuration version. Field setup still requires an operator to move among CRM, the two forms, forwarding instructions, route proof, and final approval without handing a client CRM access or creating a permanent customer portal.

The current published/historical voice contract is `call_gap_monitor_v1`. It does not support human transfer. Broadening that profile in place would erase the rollback boundary and make historical tests ambiguous. At the same time, routine messages should reach the office without making every caller wait through a transfer attempt. Urgent transfer can be useful only when the exact client, destination, coverage window, consent, route, configuration version, and failure behavior are bounded.

Fresh read-only CRM evidence on 2026-08-25 also confirmed that the legacy Form 1 button function embeds two credential literals and does not use a named Connection. The live function was not changed. The replacement must remove that pattern before any cutover.

## Decision

1. Keep existing Form 1 and Form 2. Do not create Form 3.
2. Add one temporary, operator-led Catalyst-hosted mobile journey for setup. It is not a customer portal, durable client account, generalized workflow engine, or native iPad application.
3. The client never logs into CRM or Catalyst. Gabriel selects the Lead or Deal and performs qualification, conversion confirmation, final approval, and live stop/rollback actions.
4. Form pages open by top-level navigation. No iframe is required.
5. Use one narrowly scoped cross-Form journey table only because the existing Form 1 and Form 2 stores cannot safely represent operator identity, qualification, conversion reconciliation, number state, forwarding, rollback, and route-verification evidence.
6. Keep one shared internal `7-Day Free Test` agent. Dedicated number, client, deployment, configuration version, coverage, recipient, handoff policy, route approval, and reporting partition remain the tenancy boundary.
7. Preserve `call_gap_monitor_v1` unchanged. Add `call_gap_capture_handoff_v2` as a distinct Draft, disabled, no-traffic capability candidate.
8. Routine actionable calls produce one durable Catalyst email summary and do not transfer. This is more reliable, less disruptive, and easier to reconcile than making ordinary intake depend on a human being available in real time.
9. Human handoff is bounded to explicitly eligible urgent, existing-customer, or specific-person paths after configuration and caller consent. Vendors, spam, applicants, routine calls, immediate-danger calls, invalid destinations, route loops, and configuration failures never transfer.
10. Human handoff destination, Retell infrastructure fallback, and customer phone-system rollback remain three separate concepts. No legacy fallback value is automatically promoted into another role.
11. Structured provider lifecycle events outrank post-call model analysis. The model may report only a secondary disposition and may never claim that a human answered or a transfer succeeded.
12. Route verification uses a short, exact QA window and one immutable receipt. A recognized QA call must be intercepted before normal intake, create no handled-call count or client notification, and leave the deployment non-live.
13. The mobile journey never exposes activation. `Ready For Approval` returns Gabriel to the Deal button `Approve & Start Free Test`.
14. Source remains fail-closed and `NOT_READY` where live metadata, authenticated Retell schema, telephony behavior, or exact provider readback is unavailable.

## Why No Form 3

Form 1 already owns the request and contact-consent event. Form 2 already owns setup review, email proof, and both authorization attestations. Number reservation, forwarding, verification, and approval are controlled operational steps, not another respondent submission. A third form would add duplicate evidence, more replay cases, and unclear authority without improving the decision boundary.

## Why The Journey Is Not A Portal

The journey is short-lived, operator-launched, bound to one CRM record and one authenticated operator, and backed by an expiring HttpOnly session. It exposes no durable account, client login, unrelated CRM data, record IDs, deployment IDs, configuration IDs, or activation control. Its job is to coordinate a single in-person setup session and then disappear.

## Why One Shared Agent Remains Correct

Client identity comes from the called-number resolution and immutable Catalyst configuration—not from cloning an agent. One reviewed agent reduces prompt drift and rollback burden while dedicated numbers, exact deployment/configuration bindings, destination fingerprints, recipient fingerprints, and reporting partitions prevent cross-client state.

## Consequences

### Positive

- Existing forms and their evidence remain authoritative.
- The operator has one resumable mobile flow without exposing CRM.
- v1 remains a clean rollback target.
- Routine call handling does not depend on human availability.
- Urgent transfer failure has a truthful closure and still produces one actionable notification.
- Route proof cannot be confused with client intake or activation.

### Costs And Risks

- The one journey table and four disabled control-plane routes require new Development provisioning and readback.
- Native CRM conversion remains high risk and must resolve options, required fields, duplicates, locks, ambiguous writes, and readback before use.
- Transfer lifecycle convergence adds event-ordering, replay, and provider-adapter work.
- Provider-specific forwarding instructions cannot be published until current official evidence is reviewed.
- The static web client cannot be registered if the live Catalyst project already owns a different hosted client.

## Rejected Alternatives

### Form 3

Rejected because it duplicates operational state and weakens evidence ownership.

### Permanent Customer Portal Or Native iPad App

Rejected because the field workflow is temporary and operator-led. A portal or native app adds authentication, account lifecycle, support, and privacy surface without current revenue value.

### Clone One Agent Per Client

Rejected because it makes drift and rollback harder while failing to replace dedicated-number and configuration isolation.

### Broaden `call_gap_monitor_v1`

Rejected because it would silently change published/historical behavior and remove the clean rollback profile.

### Transfer Every Actionable Call

Rejected because routine calls should complete predictably even when no human is available. One durable email summary is the bounded routine outcome.

### Treat A Checkbox As Route Verification

Rejected because a customer statement does not prove the main number reached the assigned route and exact configuration.

## Readiness And Review Triggers

This decision does not prove that exact Retell transfer JSON, lifecycle event payloads, pre-agent rejection, carrier forwarding, warm transfer, voicemail detection, human detection, call quality, latency, or live rollback works. Review or amend this ADR after authoritative Retell draft readback, current provider documentation, isolated Development import review, approved synthetic call evidence, or a material change to CRM, Forms, Catalyst hosting, or telephony behavior.

Repository approval does not authorize a real Lead conversion, number reservation, web-client publication, button installation, email, SMS, phone call, route change, Retell import/publication, Production traffic, or merge.
