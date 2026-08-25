# ADR 0006: Shared Seven-Day Free-Test Agent With Client Number Isolation

- Status: Superseded by the [final consolidated release contract](../product/free-revenue-leak-test-release-contract.md)
- Date: 2026-08-18
- Reconciled: 2026-08-24 for the Development MVP
- Current deployment status: **NOT READY FOR RETELL AGENT TESTING**; the recorded Development proof is historical migration evidence only
- Supersedes: [ADR 0005](0005-client-specific-retell-test-agent-isolation.md)
- Supersedes within [ADR 0004](0004-retell-catalyst-crm-analytics-integration-boundary.md): the client-specific evaluation-agent lifecycle, agent-first tenancy model, and Analytics-first free-test reporting path
- Production authorization: Not granted

This ADR is retained as historical number-isolation and provider-failure evidence. Its separate free-test/Revenue-Desk runtime, Analytics deferral, Production rejection, and stopping-point decisions are no longer authoritative. Use the consolidated release contract and current E2E reconciliation for execution.

## Context

Sylvara has two different agent products:

1. the shared **7-Day Free Test** agent, which performs bounded intake and classifies calls reaching an approved call gap; and
2. the **Revenue Desk**, a separately approved paid operational agent with client-specific behavior and integrations.

The free test is not a small Revenue Desk. Its purpose is to show which opportunities, existing-customer calls, urgent requests, spam, and out-of-scope calls reach a contractor's after-hours or approved no-answer/overflow gap. Routine client variation belongs in configuration, not cloned Retell agents or duplicated conversation nodes.

Retell's called `to_number` identifies the dedicated forwarding destination. Catalyst binds that number to exactly one client deployment and supplies approved call-specific context. The shared Retell `agent_id` identifies the free-test product; it is not sufficient evidence of client ownership.

This is one narrow acquisition workflow, not a generalized multi-tenant voice platform.

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
        | authenticated post-call event
        v
Catalyst durable processing
        |
        +--> Catalyst Mail email record for the approved recipient
        +--> canonical call and outcome record
        +--> client-partitioned query and CSV reporting
```

CRM mutation is disabled for the MVP. Zoho Analytics is deferred; it is not required for offline testing or a controlled internal Development phone test. After a separately approved paid conversion, the client's number may be bound to a dedicated Revenue Desk only after that product passes its own acceptance and route gates. The shared free-test agent is never promoted into a Revenue Desk.

## Shared And Client-Specific State

The following remain shared and version controlled:

- the Retell free-test agent and conversation flow;
- greeting, disclosure, bounded intake, and natural closing structure;
- caller-intent, new/existing, urgency, spam, sensitive-data, safety, unsupported-service, and out-of-area rules;
- capability denials;
- configuration-failure behavior;
- post-call extraction schema;
- call-outcome and reporting taxonomies; and
- QA and acceptance cases.

Each Catalyst deployment stores a versioned snapshot of the client context required for one test:

- `client_id`, `deployment_id`, and `configuration_version`;
- approved company identity and optional description;
- business hours, coverage mode, services, service area, urgency definitions, and callback expectation;
- approved email notification recipient;
- approved start, actual start, expiration, handled-call count, limit, and stop reason;
- assigned Retell number;
- route approval state;
- deployment status; and
- source revision and audit timestamps.

Configuration values are private runtime data. GitHub contains schemas, validation, and synthetic examples only.

## Canonical Coverage Modes

The machine-readable authority is the canonical [`revenue-desk-call-contract.json`](../../src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_call_gateway/contracts/revenue-desk-call-contract.json), including its exact display-label mapping, per-mode trigger compatibility matrix, and explicit `Unknown` trigger policy.

| Approved display label | Canonical `coverage_mode` |
| --- | --- |
| After Hours Only | `AfterHoursOnly` |
| No Answer / Overflow Only | `NoAnswerOverflowOnly` |
| After Hours + Overflow | `AfterHoursAndOverflow` |

There are no alternate internal spellings. Unknown, blank, padded, wrong-case, partial, or unsupported values fail closed.

## Exact Configuration Gate

Before normal intake, the resolver must return all seven fields exactly:

```text
resolver_status = Resolved
client_id = nonempty
deployment_id = nonempty
configuration_version = nonempty
engagement_type = free_test
capability_profile = call_gap_monitor_v1
coverage_mode = AfterHoursOnly | NoAnswerOverflowOnly | AfterHoursAndOverflow
```

The same consistent configuration read must also prove:

- the called `to_number` maps to exactly one eligible number assignment;
- the deployment belongs to the resolved client;
- the Retell number belongs to that deployment;
- the route is explicitly approved;
- the deployment is active;
- `now < expires_at`;
- durable `handled_call_count < 25`; and
- the configuration version is complete and internally consistent.

For a known authenticated invalid, unknown, ambiguous, mismatched, unapproved, inactive, expired, or exhausted resolution, Catalyst returns HTTP 200 with `{ "call_inbound": { "reject": true } }`, Retell starts no agent, and the resolver creates no call or failure row. Transport or authentication failure, timeout, 503/unavailable endpoint, malformed response, invalid agent override, or missing runtime configuration may instead cause Retell to use the number-bound shared agent. The neutral **Configuration Unavailable** termination collects no caller details and ends immediately without client identity. Neither path guesses, selects another client, reuses stale variables, or continues with a degraded generic intake.

## Seven-Day And Practical 25-Call Enforcement

The MVP uses simple durable handled-call counting rather than pre-call admission reservations.

- An explicitly approved activation sets `actual_start_at`; setup, publishing, and QA do not start the clock.
- `expires_at` is derived once as seven days after actual start. Every pre-call resolution requires `now < expires_at`.
- Every pre-call resolution requires the current durable handled count to be below 25.
- Post-call processing increments the handled count once for each unique eligible handled call.
- Processing the 25th handled call marks the deployment completed with `call_limit_reached`. Later resolver requests fail closed.
- Calls that already passed the resolver while the count was below 25 may still finish after another call reaches 25. The final handled total may therefore exceed 25 by the number of already-in-flight calls. Reports show that overshoot honestly.

The offer is still “seven days or 25 handled calls, whichever occurs first,” but the MVP does not claim an exact concurrency cap. Failure to reject new calls after the durable threshold or expiration is observed remains a P0 defect. Exact reservation/orphan reconciliation is deferred because it adds platform complexity without improving the first controlled test enough to justify it.

The test never auto-extends, auto-converts, or starts a Revenue Desk.

## Number Ownership, Freeze, And Cooldown

Each active deployment owns one dedicated number. Normal request processing never selects between overlapping assignments and never changes number ownership.

The current controlled-internal scope uses one existing non-customer Development number for one active phone deployment. It is not reused or moved during validation. When a test completes or stops, preserve the binding and ownership evidence, disable the route, and place the number into a documented cooldown before any separately reviewed future reuse. Historical call rows retain their embedded client, deployment, and configuration ownership. A second live number is required before activating a second concurrent deployment, but it is deferred from the present one-number internal test.

Automatic reassignment and live rebinding are deferred. A future post-cooldown reuse process requires its own stopped-route administration, readback, and re-QA, including proof that number reassignment cannot resolve stale ownership, but that future feature is not an internal MVP blocker.

## Post-Call Ownership And Canonical Call Key

Resolve post-call ownership in this order:

1. validated `deployment_id` from call metadata;
2. existing durable call-to-deployment binding;
3. unique validated `to_number` assignment effective for the call;
4. `agent_id` only if it maps to exactly one deployment.

The shared free-test `agent_id` maps to multiple deployments and therefore is not sufficient ownership evidence. Conflicts, zero matches, and multiple matches fail closed or enter an operator-visible unresolved state; the processor never selects the first match.

The canonical lookup key is an opaque keyed HMAC:

```text
call_lookup_key = HMAC(environment event key, provider call identifier)
```

The raw provider identifier is not stored in reports or ordinary logs. The canonical row binds the opaque key to immutable `client_id`, `deployment_id`, and `configuration_version`. Later conflicting ownership is rejected. Reporting remains partitioned by `client_id`, `deployment_id`, and the opaque call key, never by the shared agent alone.

## Catalyst State And Idempotent Processing

Catalyst is the canonical operational store for minimized Retell event references, immutable call bindings, normalized calls, processing status, configuration versions, call outcomes, handled count, notification state, deduplication claims, reporting fields, and correlation/audit fields.

Webhook delivery may be duplicated, delayed, retried, reordered, or malformed. The runtime target verifies authenticity against the raw body, validates the schema, claims the event durably, and makes post-call processing idempotent. Replay must not create a duplicate canonical call, handled-count increment, email record, or report row.

The current source/runtime evidence is documented in the dated [Development reconciliation](../runbooks/free-test-development-reconciliation-2026-08-22.md). It proves the four-table schema and App User denial, two-function parity at the recorded revision, private configuration, HTTP 200 readiness, signed inbound/event behavior, durable replay-safe state, manual Job recovery, seven-day and practical 25-call stops, one controlled internal email with replay suppression, restored `dry_run`, one Development number binding, and rollback. It does not prove a completed voice test, provider-fallback fault cases, two live-number isolation, prospect behavior, legal approval, or Production behavior.

## Email Notification MVP

The MVP notification channel is email only through Catalyst Mail. The approved destination comes only from the deployment configuration; a caller cannot supply or change it.

The committed/default Development mode is `dry_run`:

- create one durable notification row correlated to the call and deployment;
- terminate it as `DryRunRecorded`;
- record `attempts = 0` and provider code `CATALYST_MAIL_DRY_RUN`;
- never invoke `app.email().sendMail` while in `dry_run`; and
- never claim delivery, retry, or provider acceptance.

The adapter consumes `FREE_TEST_NOTIFICATION_MODE` with the reviewed values `dry_run` or `send_development` and `FREE_TEST_MAIL_FROM` with a privately configured verified Development sender. Both are required and validated; do not substitute `CATALYST_MAIL_MODE` or an undocumented default. The committed mode is `dry_run`, and this package rejects Production mode.

The internal-phone readiness proof used `send_development` once with only the verified Development sender and approved synthetic recipient, independently read back the provider result and inbox delivery, proved replay did not invoke the provider again, and restored `dry_run`. Retell never sends the email directly. Prospect delivery remains a separate unresolved decision.

The future email body remains limited to approved useful fields: caller name, callback number, new/existing classification, city or ZIP signal, issue summary, routine/urgent, requested person, timestamp, and outcome.

## Reporting MVP And System Ownership

Internal Development reporting uses client-partitioned Catalyst queries and a sanitized CSV export. It must show total handled calls, outcome counts, durable notification state, calls by date/time, known coverage trigger, test-period progress, handled-call progress, and any documented overshoot. The export excludes raw event bodies, recordings, transcripts, recipient addresses, and secrets.

Zoho Analytics is deferred and is not an internal-test launch blocker. If it is added later, it remains derived reporting and must reconcile to Catalyst. CRM remains relationship/configuration oriented, but the MVP performs no CRM read or write in the call lifecycle. Catalyst remains the operational source of truth.

Revenue/value reporting distinguishes `confirmed_revenue`, `booked_revenue`, `customer_supplied_estimate`, `internal_estimate_with_method`, and `unknown`. The MVP defaults to `unknown` unless evidence supports another value. It never multiplies calls by an arbitrary amount and labels the result revenue.

## Caller And Capability Boundary

The shared agent performs concise bounded intake only. It may capture caller name, callback number, new/existing status, intent, issue summary, city/ZIP signal, urgency, a requested person, and disposition when appropriate.

It does not book, dispatch, assign technicians, quote, estimate, collect payment, transfer arbitrarily, initiate outbound calls, send SMS or email, or mutate CRM, Analytics, or a field-service system. It refuses or redirects prohibited sensitive data and minimizes any volunteered sensitive content.

Every normal intake summarizes material facts, confirms uncertainty, states the next step truthfully, states that no appointment or dispatch is confirmed, asks whether the caller has anything else to add, and closes politely. Conversation settings remain conservative and require Retell-native validation; a repository contract is not proof of spoken behavior.

## Validation Lanes

Keep three decisions separate:

1. **Offline/synthetic Development testing** uses synthetic clients, events, email dry-run records, and query/CSV reports. It makes no phone call and contacts nobody.
2. **Controlled internal Development phone testing** uses only designated internal testers, Development resources, synthetic client facts, a non-customer route, and the single controlled Development email delivery/readback required by this gate. Record the exact number, route, data handling, vendor settings, test script, and rollback before the call.
3. **Controlled prospect testing** remains unresolved. It requires a separate decision covering the real prospect, route, caller population, notices, data handling, retention, approved recipient, actual email delivery, and operational rollback.

The [legal and compliance archive](../legal-compliance/README.md) contains a conservative historical internal-QA proposal and source research. It is not legal advice and does not itself grant or deny approval for a particular test. Record the actual business, privacy, security, vendor, and any professional review required for the chosen workflow privately. Production and real prospect/customer traffic remain outside this ADR.

## Development Acceptance Gate

Before an internal phone test, prove with two synthetic clients, two distinct synthetic numbers, and the same shared agent and reviewed version in Catalyst that:

1. each number resolves only its client, deployment, version, company, service area, urgency rules, and approved email reference;
2. understood invalid configuration is explicitly rejected with zero writes, while transport/response failure reaches only the shared agent's no-data Configuration Unavailable branch;
3. the seven-day boundary and practical handled-count stop work, including documented in-flight overshoot;
4. calls, outcomes, email states, the single controlled delivery, queries, and CSV exports never cross clients;
5. webhook replay creates no duplicate call, count, email record, or report row;
6. delayed and reordered events preserve immutable ownership;
7. malformed events and processing failures remain visible and retry-safe;
8. the caller experience has a deliberate natural close; and
9. containment disables new intake while preserving evidence.

The backend A/B proof does not require purchasing a second live number. The current controlled-internal phone lane may use one existing non-customer number for one active phone deployment. Before two deployments are active simultaneously or the first-controlled-prospect technical gate is claimed, bind a second dedicated number to the same shared version and repeat live number/greeting/ownership/notification/report isolation.

Any cross-client state, safety failure, configuration-gate bypass, failure to stop after an observed limit/expiration, prohibited sensitive retention, Production action, or uncontrolled route is P0. No P0/P1 may remain for the scoped lane being approved.

## Rejected Alternatives

### One Shared Retell Number Across Multiple Active Clients

Rejected because `to_number` would not identify the contractor deployment. Using one dedicated number for one active controlled-internal deployment is compatible with this ADR; reusing that number for two simultaneous deployments is not.

### One Free-Test Agent Clone Per Client

Rejected because client variation belongs in versioned configuration and clones create drift. If shared isolation fails, disable the route and fix the defect.

### Continue Intake When Resolution Fails

Rejected because even neutral intake could collect caller data without trustworthy ownership or approved client behavior. A known authenticated failure is rejected before an agent starts. If Retell falls back after transport/authentication/response failure, the shared agent's exact Configuration Unavailable gate terminates before collection.

### Exact Reservation Platform For The First MVP

Deferred. Durable pre-call reservations, orphan reconciliation, and a guaranteed no-overshoot cap add platform-specific concurrency work. The practical handled-count gate is adequate for a small controlled test when overshoot is visible and no new call is admitted after the durable threshold is observed.

### Make Analytics Or CRM Part Of Internal Acceptance

Rejected for the MVP. Catalyst query/CSV proves the reporting value with less integration risk; CRM remains disabled and Analytics can be added after real evidence justifies it.

## Consequences

The architecture keeps one shared flow, strict tenant resolution, durable canonical calls, email-only notification records, and simple client reporting while removing concurrency and integration work that does not help the first controlled test. It does not add a portal, generalized provisioning, automatic number reassignment, CRM mutation, Analytics ETL, SMS, or paid-service behavior.

Once the scoped Development acceptance path works, stop expanding the technical system and request the next explicit operating approval.

## Official Retell References

- [Inbound-call webhook](https://docs.retellai.com/features/inbound-call-webhook)
- [Dynamic variables](https://docs.retellai.com/build/dynamic-variables)
- [Receive inbound calls](https://docs.retellai.com/deploy/inbound-call)
- [Purchase phone number](https://docs.retellai.com/deploy/purchase-number)
- [Update phone number](https://docs.retellai.com/api-references/update-phone-number)
- [Agent versioning and environment tags](https://docs.retellai.com/agent/version)
- [Call-event webhook overview](https://docs.retellai.com/features/webhook-overview)
