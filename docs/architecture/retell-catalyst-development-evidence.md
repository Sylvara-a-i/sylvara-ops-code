# Retell–Catalyst Development Evidence

## Status

- Observation date: **2026-08-18**
- Environment class: **Development**
- Evidence class: **Sanitized live metadata, bounded configuration change, and independent readback**
- Production impact: **None observed or authorized**
- Customer call route: **Not established**
- Governing contract: [Retell–Catalyst Voice Contract](../product/retell-catalyst-contract.md)

This record updates older repository summaries that treated all Retell and Catalyst implementation state as Unknown. It is deliberately sanitized and does not contain organization, project, environment, function, route, table, agent, account, or deployment identifiers; private endpoints; credentials; secret names or values; payloads; logs; caller data; or complete runtime prompts.

## Confirmed Development State

Current read-only inspection confirmed:

- one Catalyst Development project dedicated to the Retell integration;
- an externally reachable webhook-receiver function and a separate asynchronous processing function;
- structured Data Store tables for deployment records, immutable configuration versions, event receipts, canonical calls, restricted call-artifact references, downstream outcome links, reporting runs, daily client metrics, and client-system actions;
- no existing rows in the inspected deployment, configuration-version, canonical-call, or event-receipt tables at the time of inspection;
- API Gateway was disabled, so no API Gateway route was established by this work; and
- the current integration shape is post-call event intake and asynchronous processing, not a real-time inbound Retell configuration resolver.

An observed Development health request returned a successful service response. An unsigned request to the webhook receiver returned HTTP 401. These observations prove only basic reachability and fail-closed rejection of that unsigned request.

They do **not** prove Retell signature compatibility, valid signed-event acceptance, timestamp handling, replay protection, atomic idempotency, asynchronous job execution, event reconciliation, transfer-event ordering, canonical row creation, artifact handling, retention, log safety, reporting, or rollback.

## Development Schema Change

The following additive fields were created in Development and independently read back.

### Deployment Record

- `CapabilityProfile` — versioned behavior profile, defaulting to the bounded plumbing free-test profile;
- `HandledCallLimit` — bounded engagement call limit; and
- `ProviderAgentVersionRef` — pinned voice-provider agent version or version tag.

### Canonical Call Record

- `ProviderAgentVersionRef` — exact provider version reference that handled the call;
- `CallerName` — encrypted caller name;
- `ConfirmedCallbackPhone` — encrypted callback number confirmed during intake;
- `ConfirmedCallbackPhoneHash` — one-way normalized callback lookup hash;
- `ServiceCity` — encrypted service city;
- `ServiceZip` — encrypted service ZIP code; and
- `PreferredCallbackWindow` — encrypted caller-stated callback preference.

No row was created, modified, or deleted. No function source, environment variable, webhook target, phone route, provider agent, provider version, report delivery setting, or Production resource was changed.

## Architectural Finding

The inspected Retell export is already a bounded free-test intake flow rather than the future full-production agent. It prohibits appointment booking, technician dispatch promises, pricing commitments, payment collection, diagnosis, repair or utility shutoff instructions, and arbitrary reconfiguration. It captures intake facts, classifies urgency, attempts one approved urgent transfer, and otherwise records a callback or review outcome.

The free-test profile therefore answers calls intentionally routed through an approved after-hours or no-answer/overflow path. It is not silent monitoring. A separate production profile should not be built until a signed scope identifies the additional capabilities and their authoritative systems, safety controls, acceptance evidence, and rollback.

For the first controlled deployments, a client-specific agent cloned from a pinned master is the smaller and safer topology. A shared multi-client master with a real-time configuration resolver remains deferred because the resolver does not exist and would become a new dependency in the critical call path.

## Remaining Acceptance Work

Before any agent-level webhook, pinned published provider version, test number, or customer phone route is approved, complete and independently read back:

1. valid, invalid, missing, stale, and replayed signature tests;
2. signed `call_ended` and `call_analyzed` reconciliation into one canonical call row;
3. exact-replay and conflicting-duplicate behavior;
4. asynchronous job creation, execution, bounded retry, and terminal failure state;
5. late, duplicated, and out-of-order transfer events;
6. mapping, encryption, hashing, and omission rules for the canonical call contract;
7. log and artifact data-minimization tests;
8. deterministic deployment-status and engagement-limit enforcement outside prompt language;
9. fallback and rollback of the prior call route; and
10. post-change provider, Catalyst, and downstream readback.

Production promotion and any externally reachable customer call path require separate exact approval.
