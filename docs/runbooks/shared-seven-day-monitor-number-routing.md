# Shared 7-Day Free-Test Agent Runbook

## Status And Authority

- Current architecture: [final consolidated release contract](../product/free-revenue-leak-test-release-contract.md)
- Historical architecture evidence: [ADR 0006](../adr/0006-shared-seven-day-monitor-with-client-number-isolation.md)
- Catalyst component manifest: [`catalyst.json`](../../src/zoho-catalyst/revenue-desk-call-runtime/catalyst.json)
- Retell contract: [`conversation-contract.json`](../../src/retell/agents/7-day-free-test/contracts/conversation-contract.json)
- Sanitized audit: [Development reconciliation](free-test-development-reconciliation-2026-08-22.md)
- Offline/synthetic Development testing: permitted by this repository workflow; verify the current suite before relying on it
- Catalyst Development deployment: **Canonical definitions and five bounded private maps converged with no operator invocation and exact-upload archive parity**; revision `aab7c18c27f4ff5e1468da51eae433ede9b852f6` has exact six-function source/runtime readback and 6/6 Catalyst-pullback byte parity. Environment-variable counts are 30/34/31/0/30/7 in canonical order; the worker remains statically fail-closed and uninvoked. Gateway initially contained zero routes; exactly `RETELL_INBOUND` was created and read back before execution stopped on provider-flow drift, and Gateway ended disabled. The remaining eleven routes, worker binding, invocation acceptance, synthetic E2E, final-main, and current-revision callable-surface proof remain incomplete
- Retell agent testing: **Not ready**; read-only reconciliation proves the provider-neutral variable, post-call analysis, webhook-event, and timeout contracts, but the phone remains bound to the legacy Catalyst boundary and required no-retained-content, pre-assent media/DTMF, and static-notice controls are unproven. The operator performed no Retell agent change, call, simulation, publish, or route change
- Controlled prospect test: approval unresolved; not authorized by this runbook
- Production authorization: **Not granted**

This runbook is retained as migration and provider-routing evidence. The [consolidated E2E reconciliation](free-revenue-leak-test-e2e-reconciliation-2026-08-24.md) supersedes its deployment and stopping-point instructions. Do not execute a phone test from this file.

The current target uses the same gateway/worker for free and paid engagements; paid profiles remain disabled and Draft. The historical separate-agent guidance below is non-authoritative migration context.

Configuration uncertainty must never reach client-specific intake. Known authenticated resolver failures use Retell's explicit successful rejection response with zero resolver writes; transport, authentication, timeout, 503/unavailable, malformed-response, or invalid-override fallback may reach only the shared agent's no-data Configuration Unavailable termination. Do not switch to a client clone or degraded intake.

## What The MVP Does

The MVP uses:

- one shared Retell free-test agent;
- one dedicated Retell number for each active client deployment;
- one versioned Catalyst configuration per active test;
- one shared resolver keyed by the called number;
- bounded intake and exactly one canonical outcome;
- one durable Catalyst call record per provider call;
- one email-only Catalyst Mail notification record per eligible call; and
- client-partitioned Catalyst queries and sanitized CSV exports.

It does not book, dispatch, quote, collect payment, transfer arbitrarily, call outbound, send SMS, mutate CRM, import Zoho Analytics, or become a paid Revenue Desk.

## Operating Topology

```text
Approved contractor forwarding rule
        |
Client-specific Retell number
        |
Shared 7-Day Free Test agent
        |
Exact Catalyst resolution and eligibility gate
        |
Bounded intake with deliberate close
        |
Authenticated Retell post-call event
        |
Catalyst canonical call and outcome
        +--> Catalyst Mail email record
        +--> client query / CSV report
```

CRM owns relationship and commercial state. Catalyst owns operational deployment, configuration, event/call, notification, operation, checkpoint, and outbox state. Zoho Analytics is derived reporting. CRM/Billing mutation and Analytics synchronization are separate fail-closed boundaries outside the critical call path and must pass the consolidated Development E2E before Retell agent testing.

## Three Validation Lanes

Do not collapse these lanes into one readiness claim.

| Lane | Allowed scope | Required approval/evidence | Current boundary |
| --- | --- | --- | --- |
| Offline/synthetic Development | Local or isolated tests with synthetic clients, numbers, events, email dry-run results, queries, and CSV | Reviewed source revision and passing test evidence | No call, external route, email, or client data |
| Retell agent testing | Designated internal testers and synthetic facts only after the consolidated release gate | Final-main parity, provider/route/settings readback, migration, cleanup, rotation, dark-Production proof, rollback, and zero open P0/P1 | Blocked |
| Controlled prospect test | Real prospect route and caller workflow | Separate business, privacy, security, vendor, client, data, notification, route, rollback, and any professional review required for the actual facts | Unresolved; this runbook does not approve it |

The [legal and compliance archive](../legal-compliance/README.md) preserves a conservative historical internal-QA proposal and source research. It is not legal advice and is not, by itself, approval or prohibition for a specific test. The responsible owner records the actual approval basis and any required professional review privately.

## Client Configuration

Keep client variation in one validated configuration record. At minimum it contains:

- `client_id`, `deployment_id`, and `configuration_version`;
- company name and approved description;
- business hours and canonical coverage mode;
- handled and unsupported services;
- service area and urgency rules;
- approved callback wording;
- one approved email recipient;
- approved start, nullable actual start, nullable expiration, handled count, and limit;
- current assigned Retell number;
- active and approved configuration-version IDs, approval event, approved route fingerprint, approval timestamp, activation event, and route-readback evidence; and
- deployment status and stop reason.

Use only these canonical values:

```text
AfterHoursOnly
NoAnswerOverflowOnly
AfterHoursAndOverflow
```

Display labels may be “After Hours Only,” “No Answer / Overflow Only,” and “After Hours + Overflow.” Do not accept alternate internal spellings.

The component-owned environment registry documents every required variable, consumer, classification, and format. The Advanced I/O and retry Job have separate `.env.example` profiles; do not copy the webhook key, number-lookup key, readiness token, HTTP routes/limits, or Advanced I/O host into the retry Job. For notification, the exact names are `FREE_TEST_NOTIFICATION_MODE` (non-secret; `dry_run` or tightly bounded `send_development`; Production rejected) and `FREE_TEST_MAIL_FROM` (non-secret variable whose verified sender value remains private; required in Development; Production unsupported). The committed/default test mode is `dry_run`; use `send_development` only for the single controlled internal delivery/readback, then restore `dry_run`. Do not use `CATALYST_MAIL_MODE` or obsolete root Retell/Make variables. Missing or malformed required configuration fails closed; real values stay outside GitHub.

The retry path uses the exact Development-only Function Job and disabled-first predefined one-minute Cron in `src/zoho-catalyst/revenue-desk-call-runtime/config/retry-job.json`. Run and read back one immediate synthetic Job before enabling the Cron. The Cron supplies no caller-selectable parameters, uses no platform retry overlap, and must be disabled first during rollback.

## Exact Resolver Gate

The resolver must return:

```text
resolver_status = Resolved
client_id = nonempty
deployment_id = nonempty
configuration_version = nonempty
engagement_type = free_test
capability_profile = call_gap_monitor_v1
coverage_mode = AfterHoursOnly | NoAnswerOverflowOnly | AfterHoursAndOverflow
```

The same consistent read must prove a unique current `to_number` binding, matching client/deployment/version, active deployment, an exact approval receipt, a later chained activation receipt produced only after authoritative route readback, `now < expires_at`, durable `handled_call_count < 25`, and complete typed configuration. Status strings alone never prove authorization.

The Retell-facing `dynamic_variables` object is an exact allowlist of 15 reviewed fields: `configuration_version`, `company_description`, `callback_expectation`, `client_id`, `unsupported_services_json`, `business_hours`, `coverage_mode`, `capability_profile`, `service_area_json`, `company_name`, `resolver_status`, `deployment_id`, `engagement_type`, `urgent_conditions_json`, and `services_handled_json`. Internal proof fields such as the configuration-version ID, binding ID/version, correlation ID, resolution timestamp, and ownership token remain only in `call_inbound.metadata`; never spread the metadata object into conversation variables.

For a known authenticated invalid, unknown, ambiguous, mismatched, unapproved, inactive, expired, or exhausted resolution, Catalyst returns HTTP 200 with `{ "call_inbound": { "reject": true } }`, creates no resolver-side call or failure row, and Retell does not start the agent. Retell's current inbound-webhook contract requires that explicit field to decline the call; omitting `reject` may continue with the number-bound agent. The authenticated `X-Retell-Signature` timestamp is authoritative; Retell documents `event_timestamp` among body fields that might be provided, and the runtime cross-checks it whenever present. Both Retell ingress routes enforce an eight-second end-to-end response budget, preserving two seconds of margin under the current ten-second provider timeout; exhaustion returns a sanitized retryable 503. If transport or authentication fails, the request times out, the endpoint returns 503/is unavailable, JSON is malformed, or the agent override is invalid, Retell may fall back to the number-bound shared agent; its first node accepts normal intake only with every exact ownership variable and otherwise enters a direct neutral Configuration Unavailable termination. Neither path may greet as a client, collect details, use cached variables, guess ownership, select another deployment, or perform degraded intake. Official contracts were reverified on 2026-08-27: [Inbound webhook](https://docs.retellai.com/features/inbound-call-webhook) and [Secure the webhook](https://docs.retellai.com/features/secure-webhook).

Configuration Unavailable is a direct neutral termination; it is not a second intake path.

An inbound resolution that commits after Catalyst has already returned the response-deadline 503 is ambiguous, not a successful admission. The durable `Resolved` receipt remains an unmatched terminal-settlement gate and keeps the deployment at `AwaitingSettlement`; the runtime must not age it into a no-call conclusion or emit final CRM/Analytics artifacts. Retell's inbound request has no call identifier, and its current webhook documentation defines up to three retries without an authoritative retry-spacing or no-call receipt. Live ingress stays dark until the separate Retell task verifies a provider-readback procedure that can bind the receipt to a created call or prove that no call was created across the retry series. Timer-based alerting may escalate the ambiguity but cannot settle it.

## Seven-Day And Practical 25-Call Stop

The MVP intentionally does not use pre-call reservation slots.

1. Approval leaves `actual_start_at` and `expires_at` null. Only explicit activation after fresh authoritative route readback sets `actual_start_at` and derives `expires_at` once, exactly seven days later.
2. Every resolver request fails closed when `now >= expires_at`.
3. Every resolver request fails closed when the durable handled count is already 25 or more.
4. Post-call processing increments the count once for each unique eligible handled call.
5. The call that changes the count from 24 to 25 marks the deployment completed with `call_limit_reached`.
6. Any call already admitted while the count was below 25 may finish. Count it, retain it, and report the resulting overshoot.

The possible overshoot equals the calls already in flight or not yet reflected in the durable handled count when the threshold was reached. Do not invent a fixed maximum. The pass condition is that no new call proceeds after the resolver observes expiration or a count of 25+, not that concurrency can never produce a 26th completed call.

Failure to enforce the observed stop is P0. Exact-cap reservations, orphan reservation reconciliation, and time-based slot cleanup are outside the MVP.

Never auto-extend, auto-convert, or start a Revenue Desk.

## Synthetic Client Setup

Use two fixtures with different values and the same reviewed shared agent version:

| Field | Client A | Client B |
| --- | --- | --- |
| `client_id` | `synthetic-client-a` | `synthetic-client-b` |
| `deployment_id` | `synthetic-deployment-a-v1` | `synthetic-deployment-b-v1` |
| `configuration_version` | `cfg-a-001` | `cfg-b-009` |
| Company | Northwind Plumbing Test | Contoso Plumbing Test |
| Service area | Synthetic ZIP set A | Disjoint synthetic ZIP set B |
| Urgency rule | Synthetic rule A | Different synthetic rule B |
| Email reference | Synthetic recipient A | Different synthetic recipient B |
| Assigned number | Reserved synthetic E.164 A | Different reserved synthetic E.164 B |
| Retell agent/version | Same reviewed shared synthetic version | Same reviewed shared synthetic version |

Fixtures must not contain a real company, person, number, address, or recipient. Adding another synthetic client means adding a new configuration fixture and isolation assertions; it never means adding Retell nodes or cloning the agent.

For backend isolation, the two fictional E.164 values remain distinct without purchasing a second live number. The current controlled-internal phone scope binds the existing non-customer Development number to one active synthetic deployment and pins it to the reviewed shared agent version. Do not reuse or move it during validation. Before activating a second deployment or claiming the first-controlled-prospect technical gate, add a second dedicated number and repeat live same-version isolation proof.

## Inbound Resolution Proof

1. Verify the immutable source revision and Development-only configuration contract.
2. Validate request method, path, content type, body size, and authenticity against the unchanged raw body.
3. Normalize/hash the called number without routine raw-number logging.
4. Resolve exactly one current binding.
5. validate client/deployment/configuration ownership and the exact gate.
6. Read the durable handled count and expiration.
7. Return only allowlisted metadata, shared agent/version, and approved dynamic variables.
8. Prove the client-facing greeting and rules match only that configuration.

Record sanitized pass/fail evidence. Never print signatures, keys, raw payloads, phone numbers, email addresses, or call content.

The sanitized Development readback exposes 11 post-call field names: `outcome`, `coverage_trigger`, `caller_name`, `callback_number`, `customer_type`, `caller_intent`, `issue_summary`, `city_or_zip`, `urgency`, `specific_person_requested`, and `sensitive_data_detected`. It did not expose an authoritative complete `caller_intent` value catalog, so the runtime retains that field as bounded text rather than inventing a closed enum. The runtime can validate four later expanded-reporting fields, but their absence is incomplete evidence: preserve null and withhold affected aggregates, including `observed_workflow_failures`, instead of inferring zero. This field-name readback does not prove the provider's per-field required flags or authorize Retell agent testing.

## Caller Experience Proof

The shared agent must:

- identify the configured company and disclose automation truthfully;
- let the caller explain the request first;
- ask one concise question at a time;
- reuse facts already provided;
- accept interruptions and corrections;
- confirm an uncertain callback number;
- clarify ambiguous intent without inventing an answer;
- minimize sensitive data; and
- close deliberately.

Functional greeting:

> Thanks for calling [Company Name]. I'm an automated assistant helping while the team is unavailable. This call may be recorded. I can take a few details for the team.

Use the recording sentence only when it is true for the approved test configuration. Do not impersonate a human or claim unavailable capabilities.

Functional closing:

> I have this as [issue] in [city/ZIP], and the best callback number is [number]. Is that correct?

> Thanks. I've recorded this for the [Company Name] team to review. This does not confirm an appointment or dispatch. Before I let you go, is there anything else you'd like the team to know?

Retell-native tests must validate conservative backchanneling, interruption sensitivity, responsiveness, turn-taking, pacing, and expressiveness.

## Post-Call Lifecycle

Resolve ownership in this strict order:

1. validated `deployment_id` metadata;
2. existing durable call-to-deployment binding;
3. unique validated number binding effective for the call;
4. `agent_id` only when it maps to exactly one deployment.

The shared `agent_id` identifies the product, never the tenant. Quarantine or fail closed on zero, multiple, or conflicting matches. Derive an opaque HMAC lookup key from the provider call identifier, bind it once to the client/deployment/configuration, and omit the raw provider identifier from reports and ordinary logs.

For an authenticated event, claim the minimized event durably, normalize exactly one canonical outcome, create/update the call once, increment the eligible handled count once, and create one notification row. Duplicate, delayed, reordered, malformed, or retried events must not duplicate any of those effects.

Function Job dispatch is fenced in the receipt before external submission. A timed-out original request cannot submit after a concurrent retry has already claimed dispatch. An ambiguous submit remains `Queued` with no confirmed job reference; HTTP replay acknowledges that durable state without another submit, and the worker's `retry_scan` processes the queued receipt directly. The retry trigger must therefore be deployed, read back, and kept operator-disabled until the full Development package is ready; gateway/event ingress cannot activate while queued-receipt recovery is absent.

## Catalyst Mail Email-Only Notification

Only the email destination already approved in the deployment configuration may be used. Callers cannot supply a destination, and Retell never sends the notification.

Committed Development behavior is deliberately non-delivering:

```text
channel = email
state = DryRunRecorded
attempts = 0
provider_code = CATALYST_MAIL_DRY_RUN
sendMail invoked = false
```

The durable dry-run row proves recipient isolation, payload minimization, correlation, replay idempotency, and operator visibility without contacting anyone. Do not describe it as sent, delivered, queued with Catalyst Mail, retried, or provider-accepted.

The internal-phone acceptance gate then requires one `send_development` attempt using only the verified Development sender and approved synthetic recipient. Read back provider acceptance, inbox delivery, durable call/notification state, and replay with no second delivery; ambiguous outcomes are never blindly resent. Restore `dry_run` afterward. Prospect delivery remains a later separate decision. SMS and multi-provider abstraction remain out of scope.

## Query And CSV Reporting

For the internal MVP, query canonical Catalyst call rows by both `client_id` and `deployment_id`. Export a sanitized CSV only after verifying every row belongs to that partition.

Minimum report columns/metrics:

- Total Calls Handled;
- Potential Jobs and Urgent Potential Jobs;
- Existing Customers;
- Spam;
- Unsupported Service and Out Of Area;
- Other / General Inquiry and Unresolved;
- durable notification state, distinguishing `DryRunRecorded`, `Sent`, retry, ambiguity, and terminal failure;
- calls by timestamp;
- after-hours versus overflow when known;
- test-period progress;
- handled-call count, limit, and any in-flight overshoot; and
- value evidence class, defaulting to unknown unless supported.

Exclude raw events, transcripts, recordings, callback numbers, recipient addresses, and secrets from the ordinary client summary export. A detailed operator view may show approved callback fields only under the same tenant partition and access control.

Zoho Analytics import, dashboards, outboxes, retry states, and watermarks are deferred. They are not required to approve an internal Development phone test. CRM remains disabled and receives no call summary.

## Acceptance Scenarios

The machine-readable [`acceptance-cases.json`](../../src/retell/agents/7-day-free-test/tests/fixtures/acceptance-cases.json) remains the detailed input/expected-state authority. At minimum exercise:

1. normal potential job;
2. existing customer;
3. urgent callback;
4. immediate-danger safety boundary;
5. unsupported service;
6. out of area;
7. spam;
8. sensitive-data attempt;
9. ambiguous intent;
10. corrected answer;
11. interruption;
12. noisy/incomplete answer;
13. invalid callback then correction;
14. callback refused;
15. specific person requested;
16. request and location in the first utterance;
17. configuration unavailable;
18. missing `client_id`;
19. missing `deployment_id`;
20. invalid `coverage_mode`;
21. wrong `engagement_type`;
22. wrong `capability_profile`;
23. expired test;
24. count already 25, plus a separate transparent in-flight overshoot case;
25. unknown number;
26. duplicate post-call webhook;
27. delayed/reordered webhook with immutable embedded ownership;
28. malformed webhook;
29. processing retry; and
30. Catalyst Mail provider failure, bounded retry or ambiguity handling, and terminal durable state without duplicate delivery.

For every case record inputs, expected routing, extracted fields, terminal state, persistence, notification behavior, query/CSV visibility, and explicit pass/fail criteria.

The two-client suite must additionally prove greeting, service-area, urgency, persistence, call metadata, email-recipient/delivery isolation, query/CSV partition, and replay isolation. Cross-client configuration, call ownership, notification, or reporting is P0.

Treat cross-client exposure, incorrect safety behavior, configuration-gate bypass, failure to stop after expiration or an observed handled count of 25+, prohibited sensitive retention, Production action, and uncontrolled routing as P0. Treat incorrect urgency/new-existing classification, missing callback data, duplicate call/count/email, silently lost notification, incorrect outcome, broken closing, or malformed configuration accepted as P1. A transparently counted call that was already in flight at the threshold is neither P0 nor P1 by itself. Missing Analytics, CRM mutation, automatic number reassignment, or exact-cap reservation machinery is not an MVP defect.

## Initial Number Freeze And Cooldown

The MVP has no automatic number-reassignment workflow.

1. Assign the existing non-customer Development number once to the active phone-test deployment and pin it to the shared reviewed version.
2. Do not reuse, exchange, or move the number between deployments during validation.
3. When a deployment completes or stops, disable its route and preserve canonical calls plus embedded client/deployment/configuration ownership.
4. Record the completed number's cooldown start, owner, prior deployment/configuration, and earliest separately reviewed reuse point in the private operator record.
5. Keep the number inactive throughout cooldown. Any later reuse requires a separately controlled stopped-route update, readback, ownership re-QA, and new route approval.

Automatic reassignment, live rebinding, and assignment-history automation are deferred. Their absence is not an internal-test blocker; the initial test does not exercise reassignment.

## Development Lifecycle Trace

For one synthetic call, follow the same immutable correlation through:

| Stage | Operator proof | Pass condition |
| --- | --- | --- |
| Fixture | Case ID and source revision | No real identity or data |
| Number/config | Number reference, deployment, version | Exactly one tenant configuration |
| Shared agent | Agent/version readback | Reviewed shared version; live A/B same-version proof is deferred until a second number exists |
| Resolver | Decision and configuration version | Exact gate, time, and count pass |
| Conversation | Case/native result | Correct identity, bounded intake, natural close |
| Event | Authenticated deduplication key | One durable claim |
| Canonical call | Opaque call key and ownership | One call, one outcome, one count increment |
| Email | Notification and provider/inbox readback | Dry-run first; then one controlled Development delivery with replay producing no second send; restore dry-run |
| Report | Query parameters and CSV hash | Only the intended client/deployment rows |
| CRM/Analytics | Disabled/deferred mode | No mutation or import |
| Rollback | Disabled route and readback | No new intake; evidence preserved |

Missing correlation, mixed tenant rows, or unexplained counts fails acceptance.

## Controlled Internal Development Phone Test

Catalyst prerequisites 1–4 below are complete at the recorded revision; repeat parity/readiness if the final reviewed revision changes. When the Retell test lane resumes:

1. read back the four tables, both functions, disabled Cron, HTTP 200 readiness, `dry_run`, and exact final source revision;
2. read back the published shared Retell version, the existing non-customer number binding, inbound webhook, and shared-agent event webhook;
3. document the approved tester, synthetic script, data-handling settings, test window, kill switch, and rollback;
4. place only the minimum approved internal test calls needed for voice and provider-fallback evidence;
5. trace each call, outcome, notification state, count, and query/CSV result; and
6. disable or return the route to its approved inactive state immediately after the test.

Do not buy a second number for this one-number internal test. Add it only before two concurrent deployments or the first-controlled-prospect technical gate.

This procedure does not authorize a prospect, customer, business-line forwarding rule, external email, Production resource, or retained content beyond the separately approved Development test configuration.

## Later Prospect Setup

Do not create/bind a real prospect number or change a contractor phone system until the prospect workflow, caller/data treatment, Catalyst Mail delivery, approved recipient, route, rollback, and all required business, privacy, security, vendor, client, and professional-review decisions are explicit and privately recorded.

The phone-system requirement remains simple:

- `AfterHoursOnly`: the business phone system directly forwards after hours;
- `NoAnswerOverflowOnly`: it forwards after the approved no-answer delay; and
- `AfterHoursAndOverflow`: both approved rules point directly to the dedicated number.

Do not route through a completed voicemail interaction before Retell. Record the prior carrier destination and exact restoration procedure before any later authorized change.

## Stop And Rollback

1. Disable the retry Cron, conditionally mark the deployment stopped/revoked and read it back first, then disable the affected forwarding/Retell route and independently prove it is inactive.
2. If the shared agent or resolver is suspect, stop every affected deployment.
3. Preserve events, calls, counts, all notification states, and correlation evidence.
4. Verify no cross-client email record or query/CSV row exists.
5. Restore only a previously approved inactive or carrier route and read it back.
6. Confirm new requests fail closed or never reach the agent.
7. Re-enable only after the defect is fixed, the scoped suite passes, a new exact-version approval receipt is recorded, the route is authoritatively read back active, and a separate chained activation receipt starts a new exact seven-day interval.

Do not delete evidence, switch to a client-specific free-test clone, leave `send_development` enabled, reuse a cooling number, silently enable prospect/customer email, or activate paid service.

## Remaining External Actions

Catalyst functions, canonical tables, Jobs, migrations, external bindings, cleanup, rotation, final-main parity, and dark-Production proof remain incomplete. A phone call is not the next action. Contractor forwarding and every prospect/customer action remain outside this runbook.

Deployment is consumer-first: deploy and read back `crm_billing_orchestrator` before the call gateway or worker. The consumer must accept current report-summary schema/domain v2 with a null workflow-failure total and retain v1 compatibility only for a non-null legacy count. Prove this with isolated synthetic Development evidence that does not touch a real Deal or Retell. Keep call ingress and the retry trigger dark until the exact consumer revision and both compatibility cases are read back.

## Readiness Rule

Current deployment status is **NOT READY FOR RETELL AGENT TESTING**. The prior four-table/two-function evidence is insufficient for the superseding canonical topology. Do not call, simulate, forward traffic, or treat the historical one-number proof as current route authority.

The only permitted stopping status is `READY FOR RETELL AGENT TESTING ONLY`, and only after every repository, Development, cleanup, rotation, final-main, dark-Production, security, isolation, and rollback gate in the consolidated release contract passes. SMS, calls, simulations, paid capability activation, and Production traffic remain outside the release execution itself.

## Official Retell References

- [Inbound-call webhook](https://docs.retellai.com/features/inbound-call-webhook)
- [Dynamic variables](https://docs.retellai.com/build/dynamic-variables)
- [Receive inbound calls](https://docs.retellai.com/deploy/inbound-call)
- [Purchase phone number](https://docs.retellai.com/deploy/purchase-number)
- [Update phone number](https://docs.retellai.com/api-references/update-phone-number)
- [Agent versioning and environment tags](https://docs.retellai.com/agent/version)
- [Call-event webhook overview](https://docs.retellai.com/features/webhook-overview)
