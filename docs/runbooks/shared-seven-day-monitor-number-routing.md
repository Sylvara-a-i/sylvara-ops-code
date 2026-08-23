# Shared 7-Day Free-Test Agent Runbook

## Status And Authority

- Architecture: [ADR 0006](../adr/0006-shared-seven-day-monitor-with-client-number-isolation.md)
- Runtime contract: [`free-test-contract.json`](../../src/zoho-catalyst/retell-free-test/functions/retell_free_test/contracts/free-test-contract.json)
- Environment registry: [`variables.json`](../../src/zoho-catalyst/retell-free-test/config/variables.json)
- Sanitized Development audit: [2026-08-22 reconciliation](free-test-development-reconciliation-2026-08-22.md)
- Current readiness: **NOT READY**
- Production authorization: **Not granted**

This runbook supersedes the client-agent mapping and shared-agent prohibition in the generic [Retell/Catalyst/Analytics runbook](retell-catalyst-analytics-reporting.md). It also supersedes every earlier free-test instruction that permitted neutral/degraded intake after failed resolution. Configuration uncertainty must reach only Configuration Unavailable before caller-data collection.

The current legal profile does not authorize this telephone workflow. Synthetic Development processing may use synthetic numbers, clients, events, notification results, and Analytics facts. It is not permission to bind a number, expose a route, send a message, place/receive a call, or retain call content.

The repository currently contains the deterministic resolver/processor core and synthetic adapters, but the real Catalyst HTTP request boundary, durable Data Store adapter with atomic conditional semantics, durable queue/worker handoff, deployed routes, and runtime readback remain absent or unproven. The core currently invokes synthetic notification/Analytics work inside `processEvent`; passing in-memory tests does not prove provider-timeout acknowledgement, deployability, or durability.

## Operational Model

```text
Approved contractor forwarding rule
        |
Client-specific Retell number
        |
Shared 7-Day Free Test agent
        |
Exact pre-call Catalyst resolution/admission
        |
Bounded intake
        |
Authenticated Retell post-call event
        |
Catalyst durable call/outcome processing
        +--> durable approved-recipient notification
        +--> client-partitioned Analytics outbox
        +--> bounded CRM summary only when approved
```

There is one shared free-test agent and flow. Each active test has one dedicated Retell number, one `client_id`, one `deployment_id`, and one immutable configuration version. The shared `agent_id` identifies the product, never the tenant. Do not create a free-test clone when isolation or resolution fails.

CRM owns the prospect/client relationship, setup and route-approval source, approved recipient, and bounded aggregate/commercial summary. Catalyst owns the operational deployment snapshot, number assignment history, admission slots/count, raw-event references, immutable call binding, canonical outcome, notification state, processing state, deduplication, and reporting outbox. Analytics is derived reporting and never reverse-writes. Retell never sends the client notification or mutates CRM/customer systems.

## Canonical Configuration

Each deployment snapshot must contain the fields in ADR 0006, including company identity, coverage rules, services/scope, service area, urgency rules, callback expectation, approved recipient, test timestamps/limit/count, assigned number, route approval, and status. Real values stay in Catalyst private configuration. Git contains schemas and synthetic fixtures only.

Coverage labels map exactly:

| Display label | Canonical value |
| --- | --- |
| After Hours Only | `AfterHoursOnly` |
| No Answer / Overflow Only | `NoAnswerOverflowOnly` |
| After Hours + Overflow | `AfterHoursAndOverflow` |

Do not accept aliases, alternate spacing/case, or `CoverageTrigger` as coverage mode.

The component registry documents every required variable, consumer, secret classification, format, Development behavior, and Production prohibition. Do not use obsolete root Retell/Make variables. Missing/invalid required variables fail at startup or request boundary; there are no insecure defaults. This revision permits only `DEPLOYMENT_ENVIRONMENT=development`, synthetic notifications/Analytics, and disabled CRM summary writes.

## Exact Pre-Call Gate

Before client greeting or caller-data collection, all seven values must pass exactly:

```text
resolver_status = Resolved
client_id = nonempty
deployment_id = nonempty
configuration_version = nonempty
engagement_type = free_test
capability_profile = call_gap_monitor_v1
coverage_mode = AfterHoursOnly | NoAnswerOverflowOnly | AfterHoursAndOverflow
```

The same immutable snapshot must also prove a unique current `to_number` assignment; matching client/deployment/version; approved route; `Live` test and `Approved` go-live state; valid actual start and expiration; available reservation capacity under the 25-call limit; and complete typed configuration. Unknown/ambiguous numbers, stale or overlapping assignments, missing approval, inactive/expired/stopped deployment, exhausted capacity, version mismatch, identity conflict, invalid mode/profile/type, missing runtime variables, or resolver failure must return Configuration Unavailable.

Configuration Unavailable is a direct neutral termination. Do not greet as a client, collect details, use cached variables, guess ownership, fall back to another deployment, or perform degraded generic intake.

## Seven-Day / 25-Call Admission

The explicitly approved activation sets `actual_start_at`; request/setup/QA/publishing does not. Derive `expires_at` once. At request time, atomically reserve one of 25 slots before returning configuration. Reserved capacity prevents concurrent over-admission; the finalized eligible handled-call count is a separate field updated once by post-call processing.

- Admit only while `now < expires_at` and fewer than 25 unique eligible calls have been admitted.
- The 25th unique admission may enter; a concurrent 26th fails closed. Rejected pre-workflow requests release or never consume a slot under the explicit state machine; an admitted caller-abandoned outcome finalizes once.
- In the source model, an identical signed-request fingerprint returns its reservation without another slot or count. Because Retell inbound requests do not expose a verified `call_id`, retry signature/timestamp stability and Catalyst atomic conditional updates remain Development evidence gates.
- Conflicting identity reuse is quarantined.
- An orphaned reservation remains capacity-blocking until provider evidence deterministically releases or finalizes it; elapsed time alone never frees ambiguous capacity.
- Rejected configuration attempts do not consume a handled-call slot.
- Reaching either boundary records the exact stop reason and blocks later intake even if cleanup fails.
- Never auto-extend, auto-convert, or start a Revenue Desk.

Use a deterministic clock and fixed call identities in tests.

## Synthetic Client Setup

Create fixtures only; do not allocate live provider objects.

| Field | Client A | Client B |
| --- | --- | --- |
| `client_id` | `synthetic-client-a` | `synthetic-client-b` |
| `deployment_id` | `synthetic-deployment-a-v1` | `synthetic-deployment-b-v1` |
| `configuration_version` | `cfg-a-001` | `cfg-b-009` |
| company | Northwind Plumbing Test | Contoso Plumbing Test |
| service area | Synthetic ZIP set A | Synthetic ZIP set B |
| urgent rule | Synthetic rule A | Different synthetic rule B |
| recipient | Synthetic recipient A | Different synthetic recipient B |
| assigned number | reserved synthetic E.164 A | different reserved synthetic E.164 B |
| Retell agent | same shared synthetic agent | same shared synthetic agent |

Store separate immutable configurations and non-overlapping number assignments. Ensure fixtures contain no real company, person, number, address, or recipient.

To add another synthetic client, copy the fixture shape, generate new opaque synthetic client/deployment/configuration/assignment values, choose a disjoint service area and recipient reference, keep the shared agent/version unchanged, and add explicit isolation assertions against every existing fixture. Do not add Retell nodes or client-specific agent code. Validate the schema and rerun the full suite before using the fixture as evidence.

## Inbound Operator Proof

1. Verify the immutable source revision and Development-only variable contract.
2. Validate the request method/path/media type/body size and Retell authenticity against the unchanged raw body.
3. Normalize and hash the called number for lookup without routine raw-number logging.
4. Resolve exactly one assignment effective at call time.
5. Validate deployment/client/configuration ownership and the exact gate.
6. Atomically admit the call under the seven-day/25-call rule.
7. Return only allowlisted metadata, shared agent/version, and approved dynamic variables.
8. Persist a minimized admission/correlation record.
9. Prove the client-facing greeting and rules match only that configuration.

Record sanitized pass/fail evidence; do not print signatures, keys, raw requests, phone numbers, recipient details, or call content.

## Caller Experience Proof

The shared flow must use the approved client identity, disclose automation and possible recording truthfully, invite the caller to explain first, ask one concise question at a time, use supplied information without repetition, accept interruption/correction, confirm uncertain callback details, and avoid excessive empathy. Conservative backchanneling, interruption sensitivity, responsiveness, pacing, turn-taking, and expressiveness require native Retell validation.

The greeting structure is:

> Thanks for calling [Company Name]. I'm an automated assistant helping while the team is unavailable. This call may be recorded. I can take a few details for the team.

Use the recording sentence only when the approved settings and legal/consent profile make it true. Do not impersonate a human or overemphasize AI.

Every normal completion must summarize material facts, confirm uncertainty, state that the information was recorded for team review, state that no appointment or dispatch is confirmed, ask whether anything else should be added, and say goodbye. Never promise an immediate callback or claim downstream delivery. The free test performs no booking, dispatch, assignment, pricing, payment, transfer, outbound call, SMS, direct notification, or system mutation.

The closing structure is:

> I have this as [issue] in [city/ZIP], and the best callback number is [number]. Is that correct?

> Thanks. I've recorded this for the [Company Name] team to review. This does not confirm an appointment or dispatch. Before I let you go, is there anything else you'd like the team to know?

## Post-Call Lifecycle

Resolve ownership in this strict order:

1. validated `deployment_id` metadata;
2. existing durable call-to-deployment binding;
3. unique validated number assignment effective for the call time;
4. `agent_id` only when it maps to exactly one deployment.

The shared free-test `agent_id` normally maps to multiple deployments and is insufficient. Quarantine zero, multiple, conflicting, stale, or unverifiable matches. Derive one opaque `call_lookup_key` as a keyed-HMAC of the provider call identifier; never retain or expose the raw identifier. Bind the opaque key once to immutable client, deployment, configuration, assignment, and admission ownership. A later conflict fails closed.

For an authenticated event, durably claim the minimized event before provider acknowledgement, bind the call once, normalize exactly one canonical outcome, and create notification and reporting outbox records in the same retry-safe lifecycle. Duplicate, delayed, reordered, malformed, and partially processed events must not create duplicate side effects.

### Notification

Use only the recipient already approved in the deployment snapshot. Store call/deployment correlation, template/version, destination reference, state, attempt count, next-attempt time, sanitized provider result, acceptance reference, and terminal outcome. Use one stable idempotency key per call/destination/template. Reconcile ambiguous results before retry; bound retries and expose terminal failure. In Development, the deterministic synthetic adapter changes durable state but contacts nobody.

The concise payload may contain only caller name, callback number, new/existing classification, city/ZIP signal, issue summary, routine/urgent, specific-person request, timestamp, and outcome when each field is allowed. Never use a caller-supplied destination or log a message body/provider secret.

### Analytics And CRM

Create one minimized Analytics fact partitioned by `client_id`, `deployment_id`, test window, and configuration version. Track the exact call outcome, notification state, coverage trigger where known, dates, call-limit/test-period progress, and defensible value status. Do not send caller numbers, raw transcripts, recordings, raw events, or unrestricted configuration. A replay updates neither count nor duplicate fact.

CRM receives only an approved idempotent aggregate/commercial summary. It never receives raw events or transcripts and is disabled in the current Development package. A client report must contain exactly one client/deployment and reconcile to Catalyst counts/watermark with no unresolved jobs.

## Run The Test Suite

From the repository root, run the canonical offline verifier:

```powershell
.\tools\verify.ps1
```

For isolated Catalyst evidence, use the component package:

```powershell
Set-Location src\zoho-catalyst\retell-free-test\functions\retell_free_test
npm ci
npm run check
npm run test:unit
npm run test:integration
npm run test:acceptance
```

The unit/integration/acceptance scripts use only the in-memory store and synthetic adapters. Do not populate Development credentials merely to run them. Record the observed test counts and failures; script names are not evidence that a test passed.

## Required Acceptance Scenarios

The machine-readable [`acceptance-cases.json`](../../src/retell/agents/7-day-free-test/tests/fixtures/acceptance-cases.json) declares input, expected routing, extracted fields, terminal state, persistence, notification behavior, Analytics behavior, and a machine-verifiable pass condition for each case. The summary below is the operator index. These are minimum cases, not authorization for a phone test.

| # | Scenario | Required result |
| ---: | --- | --- |
| 1 | Normal potential job | Correct client; useful fields; `potential_job`; one call/notification/fact |
| 2 | Existing customer | `existing_customer`; no false new lead; one downstream lifecycle |
| 3 | Urgent callback | Client urgency rule applied; `urgent_potential_job`; no dispatch promise |
| 4 | Immediate danger | Approved safety instruction; no incorrect operational routing; canonical safe terminal outcome |
| 5 | Unsupported service | Clarified once; `unsupported_service`; no unsupported promise |
| 6 | Out of area | Correct client service area; `out_of_area`; no other-client rule |
| 7 | Spam/solicitation | `spam`; minimal retention; one recipient-scoped notification/fact, never a potential job |
| 8 | Sensitive-data attempt | Redirect/end; prohibited value absent; `sensitive_data_ended` |
| 9 | Ambiguous intent | One-at-a-time clarification; resolved category or `unresolved` |
| 10 | Caller changes answer | Latest confirmed fact wins; no contradictory duplicate field |
| 11 | Caller interrupts | Interruption accepted; no repeated questionnaire loop |
| 12 | Noisy/incomplete answer | Clarify/mark unknown without invention |
| 13 | Invalid callback then correction | Only corrected confirmed callback retained |
| 14 | Callback refused | Refusal represented; call can close without fabricated number |
| 15 | Specific person requested | Request captured; no transfer promise |
| 16 | Service and location in first utterance | Values reused; no redundant questions |
| 17 | Configuration unavailable | No client greeting/intake; Configuration Unavailable; configuration-failure audit only |
| 18 | Missing `client_id` | Same fail-closed result as 17 |
| 19 | Missing `deployment_id` | Same fail-closed result as 17 |
| 20 | Invalid `coverage_mode` | Same fail-closed result as 17 |
| 21 | Wrong `engagement_type` | Same fail-closed result as 17 |
| 22 | Wrong `capability_profile` | Same fail-closed result as 17 |
| 23 | Expired test | No intake/slot/notification/fact; exact stop reason retained |
| 24 | 25-call limit reached | 26th blocked; count remains 25; no duplicate downstream work |
| 25 | Unknown number | No ownership guess; Configuration Unavailable |
| 26 | Duplicate post-call webhook | One event claim/call/notification/fact; B unchanged |
| 27 | Delayed webhook | Historical assignment/binding used; never current-owner guess |
| 28 | Malformed webhook | Safe rejection/quarantine; no call/notification/fact or secret log |
| 29 | Processing retry | Same immutable binding and idempotency keys; exactly one result |
| 30 | Notification provider failure | Durable retry then success or terminal failure; never silent/duplicate |

The two-client suite must additionally prove A/B greeting, service-area, urgency, persistence, transcript-metadata, notification-recipient, report, replay, and number-reassignment isolation. Any cross-client result, safety error, gate bypass, limit bypass, prohibited sensitive retention, Production action, or uncontrolled route is P0. Incorrect urgency/new-existing, missing callback, duplicate call/notification, silently lost notification, incorrect outcome, broken closing, or malformed configuration accepted is P1. No P0/P1 may remain before controlled telephone evaluation.

## Number Reassignment

1. Stop the old deployment and close its assignment interval.
2. Preserve every existing call binding and configuration snapshot.
3. Create a new deployment/configuration version and assignment record; never overwrite ownership history.
4. Prove intervals do not overlap and the new client/deployment/version owns the number.
5. Read back Retell and Catalyst state.
6. Replay an old-client event and a delayed unbound event. The bound call stays with the old deployment; an ambiguous unbound event is quarantined.
7. Rerun the complete two-client suite before any activation.

## Development Lifecycle Trace

For one synthetic call, the operator must correlate the same immutable identifiers through: resolver request and admission claim; number assignment/deployment/configuration; provider call/event claim; canonical call and outcome; notification record/attempt; reporting outbox/fact; and any approved CRM summary. Capture sanitized state, timestamp, source revision, and pass criterion at each stage. Missing correlation or unreconciled counts fails acceptance.

| Stage | Operator proof | Pass condition |
| --- | --- | --- |
| Synthetic caller fixture | Fixture case ID and immutable source revision | Approved case uses no real identity/data |
| Dedicated synthetic number | Assignment version and effective interval readback | Exactly one client/deployment/configuration owns the number at call time |
| Shared agent | Accepted agent/version reference | Same shared version is used for A and B; it is not the tenant key |
| Pre-call resolver | Signed-request fingerprint, resolution decision, and reservation ID | Exact gate passes from one snapshot; one slot reserved once |
| Conversation contract | Case assertions and Retell-native result when authorized | Correct client identity/rules, bounded intake, deliberate close, no prohibited capability |
| Post-call ingress | Provider call reference and durable event claim | Authentic event claimed once; replay is acknowledged without new work |
| Canonical outcome | Opaque call lookup key, immutable ownership fields, and processing state | One client/deployment/configuration binding and exactly one canonical outcome; no raw provider identifier |
| Notification | Notification ID/idempotency key, attempts, and synthetic provider result | Correct approved recipient reference; one durable terminal result; no external send |
| Analytics | Reporting outbox ID and synthetic fact key/watermark | One fact under the same client/deployment/opaque Call Key binding; report counts reconcile |
| CRM summary | Summary outbox/key and mode | Current Development mode is disabled; no request occurred |
| Exit/rollback | Stop reason, inactive assignment/deployment, and readback | Route remains inactive and evidence/outboxes remain preserved |

## Later Real-Client Gates

Do not create/bind a real number or change forwarding until all synthetic acceptance, runtime/source parity, security, legal/privacy/vendor, approved client configuration, recipient verification, route/rollback, environment, and explicit route-approval evidence is complete. The contractor phone system must forward directly after hours or after the approved no-answer delay to the dedicated Retell number; never chain an already completed voicemail interaction into Retell.

The prospect's request may move into setup without another commercial acceptance gate. It still does not authorize the phone route; an authorized operator must explicitly approve and read back the exact forwarding configuration and rollback target.

Document, but do not apply, the exact client phone-system requirement:

- `AfterHoursOnly`: the business phone system decides the after-hours state and directly forwards to the client-specific Retell number;
- `NoAnswerOverflowOnly`: the system rings for the explicitly approved delay and, only when nobody answers, directly forwards to the Retell number; and
- `AfterHoursAndOverflow`: both rules use the same dedicated number under the approved configuration.

Sylvara is the approved fallback destination, not an extra step after voicemail has already answered or collected a message. Record the prior carrier destination and exact restoration procedure before any future authorized change.

## Stop, Containment, And Rollback

1. Disable the affected client forwarding/number route where authorized, then mark route approval revoked/blocked and deployment stopped.
2. If the shared agent/resolver is suspect, stop every affected assignment; do not switch to a client clone or degraded intake.
3. Stop notification/reporting workers for affected records without deleting outboxes.
4. Preserve events, assignments, bindings, configurations, counts, failures, and correlation evidence.
5. Determine impact by immutable deployment/call binding, never display name or current number owner.
6. Verify no cross-client delivery/report occurred; treat any contamination as P0.
7. Restore only a previously approved carrier route or inactive Retell state and independently read it back.
8. Confirm subsequent calls reach Configuration Unavailable or the carrier's approved inactive behavior.
9. Re-enable only after root cause is fixed and the full acceptance suite, reassignment test, and rollback rehearsal pass with new approval.

The test never continues because cleanup failed and never converts to paid service automatically.

## Manual Actions Requiring Separate Authority

Only an authorized operator with the relevant UI/credential access may, after the applicable approvals: configure Catalyst secrets and private table names; deploy/read back Development functions and routes; publish/pin a Retell Development agent version; bind a Development number; configure a carrier forwarding rule; authorize a real notification provider/destination; or approve a telephone test. Source implementation and synthetic validation require none of these external actions.

## Launch Prohibition

Do not advance beyond **READY FOR DEVELOPMENT END-TO-END TEST** while runtime/source parity, exact route/deployment readback, native conversation tests, immutable lifecycle tracing, or any P0/P1 evidence is missing. Do not advance even to that Development classification while reproducible source, offline two-client acceptance, or rollback instructions are incomplete. Never describe this architecture as Production-ready. Once the approved Development acceptance path works, stop building and request the separate controlled-test approvals.
