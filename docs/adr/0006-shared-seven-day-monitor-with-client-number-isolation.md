# ADR 0006: Shared Seven-Day Free-Test Agent With Client Number And Deployment Isolation

- Status: Accepted as the current architecture decision
- Date: 2026-08-18
- Reconciled: 2026-08-22
- Supersedes: [ADR 0005](0005-client-specific-retell-test-agent-isolation.md)
- Supersedes within [ADR 0004](0004-retell-catalyst-crm-analytics-integration-boundary.md): the client-specific evaluation-agent lifecycle, agent-first tenancy model, and evaluation-to-paid-agent promotion model
- Environment: Development implementation and synthetic validation only
- Production authorization: Not granted
- Current evidence: [sanitized Development reconciliation, 2026-08-22](../runbooks/free-test-development-reconciliation-2026-08-22.md)

## Context

Sylvara has two different agent products:

1. the shared **7-Day Free Test** agent, which performs bounded intake and classifies calls reaching an approved call gap; and
2. the **Revenue Desk**, a separately approved paid operational agent with client-specific behavior and integrations.

The free test is not a small Revenue Desk. Its commercial purpose is to show what opportunities, existing-customer calls, urgent requests, spam, and out-of-scope calls reach a contractor's after-hours or approved no-answer/overflow gap. Routine client variation therefore belongs in a versioned deployment configuration, not cloned Retell agents or duplicated conversation nodes.

Retell's called `to_number` identifies the dedicated forwarding destination. Catalyst binds that number to exactly one client deployment, supplies the approved call-specific context, and owns the durable operational state. The shared Retell `agent_id` identifies the free-test product; it is not sufficient evidence of client ownership.

This is one narrow acquisition workflow, not a generalized multi-tenant voice platform. Failure of isolation or configuration validation disables the affected route. It does not authorize a client-specific free-test clone as an alternate architecture.

## Decision Summary

Use one shared free-test agent, one dedicated Retell number per active test client, one versioned Catalyst deployment/configuration record per active test, and one shared inbound resolver.

```text
Contractor main number
        |
        | approved after-hours or no-answer/overflow forwarding
        v
Client-specific Retell number
        |
        v
Shared Sylvara 7-Day Free Test agent
        |
        | pre-call resolution and exact configuration gate
        v
Client-specific Catalyst deployment configuration
        |
        v
Bounded intake conversation
        |
        | signed post-call event
        v
Catalyst durable processing
        |
        +--> approved client notification
        +--> canonical call and outcome record
        +--> Analytics outbox and reporting fact
        +--> bounded CRM summary where separately approved
```

After a separately approved paid conversion, the client's number may be rebound to a dedicated Revenue Desk agent only after that agent passes its own acceptance and route-approval gates. The shared free-test agent is never promoted into a Revenue Desk.

## Shared And Client-Specific State

The following remain shared, version controlled, and accepted as one release:

- the Retell free-test agent and conversation flow;
- greeting and disclosure structure;
- bounded intake and natural closing structure;
- caller-intent, new/existing, urgency, spam, sensitive-data, safety, unsupported-service, and out-of-area rules;
- capability denials;
- configuration-failure behavior;
- post-call extraction schema;
- call-outcome and reporting taxonomies; and
- QA and acceptance cases.

Each Catalyst deployment stores a versioned snapshot of only the approved client context required for one test:

- `client_id`, `deployment_id`, and `configuration_version`;
- approved company identity and optional description;
- business hours, coverage mode, services handled, unsupported services, service area, urgency definitions, and callback expectation;
- approved notification recipient name, email, and mobile destination;
- approved start, actual start, expiration, call limit, eligible handled-call count, and stop reason;
- assigned Retell number and immutable number-assignment version;
- route approval state and timestamp;
- deployment status; and
- source revision and audit timestamps.

Configuration values are private runtime data. GitHub contains schemas, validation, and synthetic examples only.

## Canonical Coverage Modes

The machine-readable authority is [`coverage-mode-contract.json`](../../src/zoho-catalyst/retell-inbound-resolver/contracts/coverage-mode-contract.json).

| Approved display label | Canonical `coverage_mode` |
| --- | --- |
| `After Hours Only` | `AfterHoursOnly` |
| `No Answer / Overflow Only` | `NoAnswerOverflowOnly` |
| `After Hours + Overflow` | `AfterHoursAndOverflow` |

There are no alternate internal spellings. Unknown, blank, padded, wrong-case, partial, or unsupported values fail closed. `CoverageTrigger` remains a separate per-call fact with only `AfterHours` and `NoAnswerOverflow`; it is never accepted as `coverage_mode`.

## Existing Route And Test States

The existing CRM control values remain the operator-facing source values. Do not create competing lifecycle semantics.

- `Test_Status`: `Not Started`, `Setup Pending`, `QA In Progress`, `Ready for Approval`, `Scheduled`, `Live`, `Paused`, `Completed`, `Stopped`, `Rolled Back`, `Failed`
- `Go_Live_Approval_Status`: `Not Ready`, `Pending Internal Approval`, `Approved`, `Blocked`, `Revoked`
- `Test_End_Reason`: `Seven-Day Limit Reached`, `Call Limit Reached`, `Client Requested Stop`, `Sylvara Stopped`, `Technical Failure`, `Converted Early`, `Other`

Catalyst stores the approved source values in the immutable deployment snapshot and derives admission from them. Normal free-test handling requires `Test_Status = Live`, `Go_Live_Approval_Status = Approved`, the exact approved number assignment, and the applicable timestamps. A status mapping used in code must be one deterministic versioned mapping; it must not invent a second business lifecycle.

Form submission, setup completion, a requested test, or a published agent version never activates routing by itself.

A requested free test may enter setup without a second commercial acceptance gate. That does not approve telephony: the exact number, forwarding mode, deployment/configuration, rollback target, and route still require explicit route approval before activation.

## Exact Pre-Call Configuration Gate

Before any client greeting, disclosure, or caller-data collection, the shared flow requires all seven fields below:

```text
resolver_status = Resolved
client_id = nonempty
deployment_id = nonempty
configuration_version = nonempty
engagement_type = free_test
capability_profile = call_gap_monitor_v1
coverage_mode = AfterHoursOnly | NoAnswerOverflowOnly | AfterHoursAndOverflow
```

The resolver must also prove, from one internally consistent snapshot, that:

1. the called `to_number` maps to exactly one eligible number assignment;
2. the assignment belongs to the resolved deployment and client;
3. the Retell number is current for that deployment and configuration version;
4. route approval is present and not revoked;
5. the deployment is `Live`, active for the Development test, and not stopped;
6. the actual start and expiration timestamps are valid and the test has not expired;
7. admission capacity remains after accounting for finalized eligible handled calls and active reservations;
8. `engagement_type`, `capability_profile`, and coverage mode match the approved constants; and
9. every required configuration field is present, typed, and consistent with the same configuration version.

Any zero match, multiple match, mismatch, missing field, stale assignment, invalid status, expired window, exhausted limit, unavailable runtime variable, or untrusted configuration fails closed. The agent uses the neutral **Configuration Unavailable** termination and collects no caller details. It never guesses, falls back to another client, reuses prior dynamic variables, or continues with a degraded generic intake.

The number may retain the shared agent as its provider-level default only when the shared agent's no-configuration path is this direct neutral termination. A resolver outage is not permission to perform intake.

## Seven-Day And 25-Call Admission

The test ends after seven days or 25 eligible handled calls, whichever occurs first.

- `actual_start_at` is set only by the explicitly approved activation action, not by request, setup, publishing, or QA.
- `expires_at` is derived once from the approved actual start and is not extended by retries or cleanup failures.
- Admission requires `now < expires_at` and the pre-admission count to be below 25.
- The resolver atomically reserves one of 25 admission slots before returning normal client configuration. Reserved capacity and the finalized eligible handled-call count are distinct fields; reservation prevents concurrent over-admission, while post-call processing finalizes the handled count once.
- The 25th unique eligible admission may enter the workflow and blocks a concurrent 26th. A rejected pre-workflow request releases or never consumes a slot under the explicit state machine; an admitted call is finalized once even if its later outcome is caller abandoned.
- In the source model, an identical signed-request fingerprint returns the original reservation without another slot or count. Retell inbound requests do not provide a verified `call_id`; live retry signature/timestamp stability and Catalyst atomicity therefore remain Development evidence gates. A conflicting fingerprint reuse enters reconciliation and does not continue.
- Configuration failures, unknown numbers, and calls rejected before successful admission do not count as eligible handled calls.
- An orphaned reservation is reconciled against provider evidence before release or finalization. It remains capacity-blocking while ambiguous; no timer silently frees it and risks a 26th handled call.
- Request-time admission remains authoritative even if a scheduled cleanup or status-synchronization job fails.
- Reaching either limit records the exact stop reason and blocks later normal intake. It never starts paid service or activates a Revenue Desk.

The signed-request fingerprint and reservation identity used for the atomic claim must be verified before activation. If Retell retry material is not stable enough to identify the same request, or Catalyst cannot prove an atomic conditional reservation, admission fails closed rather than using an approximate counter.

## Number Assignment And Reassignment

One active client deployment may own a Retell number at a time. Assignments are immutable records with an assignment version and non-overlapping effective interval; a mutable row must not erase prior ownership evidence.

To reassign a number:

1. stop and close the old assignment;
2. preserve every existing call-to-deployment binding;
3. create a new deployment or configuration version and a new assignment interval;
4. prove no active interval overlaps;
5. read back the Retell number binding and Catalyst assignment; and
6. run the complete two-client isolation and delayed-event tests before activation.

A later event for an already bound call remains with its original deployment after reassignment. An unbound delayed event may use `to_number` only when the event time and assignment history resolve exactly one deployment; otherwise it is quarantined. It must never be attributed to the number's current client merely because ownership changed later.

## Post-Call Ownership

Catalyst resolves each lifecycle event in this order:

1. validated `deployment_id` from call metadata;
2. existing durable call-to-deployment binding;
3. unique validated `to_number` assignment effective for the call;
4. `agent_id` only if it maps to exactly one deployment.

The shared free-test `agent_id` maps to multiple deployments and therefore is not sufficient ownership evidence. Conflicting identifiers, zero matches, multiple matches, stale mappings, and unverifiable event times are quarantined. The processor never selects the first match.

The canonical lookup key is an opaque keyed-HMAC of the provider call identifier:

```text
call_lookup_key = HMAC(environment event key, provider call identifier)
```

The raw provider identifier is not stored, logged, or sent to reporting. The canonical row binds that opaque lookup key to immutable `client_id`, `deployment_id`, `configuration_version`, and assignment/admission references. A later event with conflicting ownership is rejected; it cannot move the call to another client. Analytics facts carry the opaque call key plus the client/deployment partitions, never the shared agent as ownership.

The earlier `client_id + deployment_id + call_id` key wording is superseded. Client and deployment identifiers remain immutable ownership attributes on the canonical row; they are not concatenated with a raw provider call identifier to form the lookup key.

## Catalyst Operational State

Catalyst is authoritative for minimized Retell event references, immutable call bindings, normalized calls, processing and retry state, configuration versions, call outcomes, notification state, Analytics outbox state, deduplication claims, and audit/correlation fields.

Webhook delivery is assumed to be duplicated, delayed, retried, reordered, and partially malformed. The accepted runtime target verifies authenticity before parsing business data, durably claims a minimized event inside the provider timeout, acknowledges only that durable acceptance, and performs post-call notification/reporting work through a durable worker boundary. A replay never creates a second call, count increment, notification, Analytics fact, or CRM summary.

The current Development core does not prove that boundary: `processEvent` directly invokes only synthetic notification and Analytics adapters, and no HTTP ingress, durable queue/worker, or Catalyst Data Store adapter has been accepted. Until those components and atomic readback are implemented and tested, asynchronous durable processing is a required model, not observed runtime behavior.

CRM remains authoritative for prospect, client, contact, commercial relationship, approved setup source, and bounded aggregate summaries. It is not a per-call event store. Analytics remains derived reporting, not transactional truth. Retell never directly mutates CRM, Analytics, a field-service system, or the notification channel.

## Notification

After one eligible call is durably processed, Catalyst may enqueue one notification to destinations already approved in that deployment configuration.

The notification record carries the call and deployment correlation keys, template/version, channel, approved recipient reference, attempt count, next-attempt time, provider acceptance reference, sanitized provider outcome, and one terminal state. It uses a stable idempotency key so webhook replay cannot send again. Retry is bounded, an ambiguous provider result is reconciled before another send, and terminal failure remains visible.

Caller-supplied destinations are never used. Provider responses, secrets, raw bodies, full transcripts, and unrestricted PII are not logged. If Development credentials are unavailable, the deterministic synthetic adapter persists the same state transitions without contacting a real recipient. Production sending is not authorized.

## Reporting And Value Boundary

Every call receives exactly one high-level canonical outcome under the shared taxonomy. Reporting remains partitioned by `client_id`, `deployment_id`, test window, and configuration version. The shared agent alone is never a report filter.

Analytics receives minimized structured facts and notification results, not caller numbers, raw transcripts, recordings, raw events, or unrestricted client configuration. Reports separate confirmed, booked, customer-supplied estimated, internally estimated, and unknown value. An estimate requires a documented method version; calls are never multiplied by an arbitrary value and labeled revenue.

## Caller And Capability Boundary

The shared agent performs concise bounded intake only. It may capture caller name, callback number, new/existing status, intent, issue summary, city or ZIP signal, urgency, specific-person request, and disposition when permitted by the approved workflow.

It does not book, dispatch, assign technicians, quote, estimate, collect payment, transfer arbitrarily, initiate outbound calls, send SMS or email, or write customer systems. It refuses and redirects prohibited sensitive data and minimizes any volunteered sensitive content. Every normal intake uses a deliberate summary, fact confirmation when needed, truthful next step, explicit no-appointment/no-dispatch statement, final opportunity to add information, and polite goodbye.

Conversation settings such as backchanneling, interruption sensitivity, responsiveness, pacing, turn-taking, and expressiveness remain conservative and require Retell-native tests. A repository contract is not proof of spoken behavior.

## Development Acceptance Gate

Before any telephone route, prove with two synthetic clients, two distinct synthetic numbers, and the same shared agent that:

1. each number resolves only its client, deployment, version, company, service area, urgency rules, and recipient;
2. invalid configuration reaches only Configuration Unavailable;
3. both seven-day and 25-call limits fail closed, including concurrent admission at the boundary;
4. call, transcript metadata, outcome, notification, Analytics fact, and CRM summary never cross clients;
5. webhook replay creates no duplicate call, count, notification, or downstream fact;
6. delayed and reordered events preserve immutable ownership;
7. number reassignment cannot resolve stale ownership;
8. provider failures reach durable retry or terminal failure states;
9. the complete lifecycle is traceable through immutable correlation identifiers; and
10. containment and rollback leave the route disabled and evidence preserved.

Any P0 or P1 defect blocks telephone evaluation. Failure does not authorize monitor clones, broader fallback, or Production action.

## Legal And Deployment Boundary

This decision authorizes source-controlled Development implementation and synthetic validation only. The [legal and compliance archive](../legal-compliance/README.md) currently permits only a separately controlled internal non-sales telephone profile with a carrier media gate, keypad assent, synthetic conversation data, and no retained call content or post-call handoff. The free-test call, data, recording, notification, and prospect workflow described here is not approved under that profile.

Do not purchase or assign a real prospect number, change forwarding, expose a real webhook, send a real notification, connect a client system, or place a prospect/customer call without the exact separate legal, privacy, vendor, client, route, environment, and deployment approvals.

## Rejected Alternatives

### One Shared Retell Number

Rejected because `to_number` would not identify the contractor deployment.

### One Free-Test Agent Clone Per Client

Rejected because client variation belongs in versioned configuration and clones create drift. If shared isolation fails, disable the route and correct the defect.

### Continue Intake When Resolution Fails

Rejected because even a neutral intake could collect caller data without trustworthy ownership or approved client behavior. Configuration failure terminates before collection.

### Convert The Free-Test Agent Into The Revenue Desk

Rejected because the products have different capabilities, integrations, risks, and acceptance gates.

### Build A General Voice Platform

Rejected. The approved abstraction is only the number-to-deployment resolver and durable post-call path required for this offer.

## Consequences

The architecture minimizes Retell drift and preserves strict client isolation through dedicated numbers, immutable deployment configuration, fail-closed admission, durable event processing, and client-partitioned reporting. It adds one critical resolver and operational datastore, but it does not add self-service provisioning, a customer portal, arbitrary client flows, or speculative provider abstractions.

Once the Development acceptance gate passes, stop expanding the system. The next work is the separately approved controlled evaluation process, not additional platform features.

## Official References

- [Retell inbound-call webhook](https://docs.retellai.com/features/inbound-call-webhook)
- [Retell dynamic variables](https://docs.retellai.com/build/dynamic-variables)
- [Retell receive inbound calls](https://docs.retellai.com/deploy/inbound-call)
- [Retell purchase phone number](https://docs.retellai.com/deploy/purchase-number)
- [Retell update phone number](https://docs.retellai.com/api-references/update-phone-number)
- [Retell agent versioning and environment tags](https://docs.retellai.com/agent/version)
- [Retell call-event webhook overview](https://docs.retellai.com/features/webhook-overview)
