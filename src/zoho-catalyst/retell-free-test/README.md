# Shared Retell 7-Day Free Test — Catalyst Development Runtime

Source status: **READY FOR DEVELOPMENT REDEPLOYMENT**. The latest historical readback proved the two functions, four tables, private configuration, signed lifecycle, retry path, one controlled Catalyst Mail delivery, and rollback controls at revision `8df5d8abc93a81dcbb714c0980c26a675209568b`. That observation does not establish parity for later source. The current release candidate must be deployed and independently read back before restoring a live readiness classification. One non-customer Retell Development number was bound to the shared agent at the historical observation; a second number, paid/native voice testing, provider-fallback testing, and further agent refinement remain deliberately deferred. This source does not authorize a prospect, customer, contractor forwarding route, Production deployment, or PR merge.

This package is the bounded Catalyst Development runtime for one shared Retell free-test agent. Each active synthetic deployment has one dedicated Retell number and one versioned configuration snapshot. The runtime performs fail-closed resolution, durable post-call convergence, one handled-call count per provider call, and an email notification **dry run** by default. The committed configuration does not send mail, mutate CRM, import Analytics, activate a route, touch Production, or provide paid Revenue Desk behavior.

## Runtime boundary

The Advanced I/O entrypoint exposes:

- `POST /retell/inbound` — verifies Retell's raw-body HMAC and timestamp, resolves the called-number HMAC to exactly one eligible deployment, and returns client variables plus integrity-bound ownership metadata.
- `POST /retell/events` — accepts only `call_ended` and `call_analyzed`, verifies the same raw-body contract, and converges receipts, calls, handled count, and a dry-run notification.
- `GET /internal/readiness` — private Development dependency check authenticated with `X-Free-Test-Readiness-Token`.

No other HTTP route exists. [`retell_free_test_retry`](functions/retell_free_test_retry/) is a separate Catalyst Function Job target for due `RetryRequired`/expired-processing event receipts and pending/retryable notification rows. It imports the reviewed core package as a materialized local package, reads a minimized encrypted event record rather than a raw webhook, uses bounded backoff, and does not blindly resend an ambiguous Mail attempt.

Known resolver failures return Retell's exact rejection object, `{ "call_inbound": { "reject": true } }`. Transport/authentication failure can cause Retell to fall back to the number-bound shared agent. Development readback proves the published shared version, exact first-node gate, direct no-data fallback, deliberate close, and absence of client-specific intake when ownership variables are missing. The existing non-customer number is pinned to that version. Paid/native voice behavior and provider fallback under timeout, 503, malformed response, invalid override, or unavailability remain later controlled Retell tests, not Catalyst-readiness blockers.

## Four-table model

Only these new Development tables are supported:

1. `FreeTestDeployments` — current number HMAC, immutable configuration snapshot, activation gate, call-key set, handled count, and stop state.
2. `FreeTestRetellEventReceipts` — minimized event identity/fingerprint, ownership correlation, lease, retry, and terminal state. Development already contains an incompatible legacy `RetellEventReceipts` table; preserve it untouched and do not point this runtime at it.
3. `FreeTestCalls` — one tenant-bound canonical call and outcome per provider call.
4. `FreeTestNotifications` — one email-only durable delivery-state record per analyzed call; committed mode is dry-run.

[`config/datastore-schema.json`](config/datastore-schema.json) is the exact source schema. Catalyst Development readback proved all four runtime tables, every declared column and constraint, and `audit_consent=true` on all four caller- or recipient-bearing encrypted JSON columns. Independent permissions readback proved that the default App User has no access to any runtime table. Signed requests, inserts, conditional updates, event reordering, replay convergence, one-count behavior, expiry, and practical 25-call stopping were then exercised against the deployed Development runtime.

Catalyst currently permits at most two unique `varchar` columns on one table. `FreeTestDeployments` therefore places database uniqueness on `DEPLOYMENT_KEY` and the resolver-critical `NUMBER_LOOKUP_HASH`. `DEPLOYMENT_ID` remains mandatory and every runtime lookup uses `store.unique()`, which rejects more than one matching row as `AMBIGUOUS_DURABLE_OWNERSHIP`; an ambiguous deployment ID cannot resolve, count, notify, or report.

## Eligibility and counting

Inbound resolution requires all approved gate values plus:

- `Live` and `Approved` state;
- explicit `actualStartAt` and an expiration exactly seven days later;
- current time at or after start and strictly before expiration;
- handled count below 25;
- internally consistent client, deployment, configuration, number binding, shared agent, agent version, and source revision.

A valid terminal `ended` post-call event counts the handled call, whether first observed as `call_ended` or `call_analyzed`. `error` and `not_connected` lifecycle records remain durable but are not counted or notified as handled calls. The call key set makes replay idempotent. Notification waits for analysis.

The Catalyst runtime supports a target surface of exactly these 15 canonical `custom_analysis_data` names: `outcome`, `coverage_trigger`, `caller_name`, `callback_number`, `customer_type`, `caller_intent`, `issue_summary`, `city_or_zip`, `urgency`, `specific_person_requested`, `sensitive_data_detected`, `bookable_opportunity`, `office_follow_up_required`, `workflow_failure_code`, and `workflow_failure_text`. The latest live shared-agent readback still exposes 11 fields; aligning the additional four fields is intentionally deferred to Retell Agent QA. Until that readback matches, missing Boolean evidence remains `null`; it is never converted to false, and the affected aggregate is withheld rather than fabricated. Workflow failure text is optional, bounded, and cannot exist without a bounded lowercase canonical code. Outcome and urgency must remain semantically consistent, including `urgent_potential_job` with `urgent` and `immediate_danger` with the unresolved safety outcome. Five separately governed optional value-evidence fields remain in the runtime contract; they do not expand Retell's authority. This MVP accepts only `unknown` or a Retell/customer-supplied estimate. Confirmed, booked, verified-downstream, and internal-method values are rejected rather than inferred or promoted by the report.

There is intentionally no pre-call reservation or admission table. Sequential calls stop at 25. Calls already resolved and in flight when the 25th result converges can create a visible practical overshoot. This is the approved MVP tradeoff; reporting shows the actual handled count and stop state. The runtime never starts paid service.

## Notification and reporting

Committed configuration uses `FREE_TEST_NOTIFICATION_MODE=dry_run`, and the latest historical Development readback confirmed that mode. The normal dry-run path records `DryRunRecorded` with `ATTEMPT_COUNT=0` without calling Mail. `ATTEMPT_COUNT` bounds the complete delivery pipeline, so a transient pre-provider Data Store read can consume an attempt without implying a provider invocation; `PROVIDER_CODE` and `PROVIDER_RESULT_REFERENCE` remain the provider evidence. The tightly bounded `send_development` path models `Sending`, `Sent`, `RetryRequired`, `Ambiguous`, and `TerminalFailure`; a timeout or unclassified result after invocation becomes `Ambiguous` and is never automatically resent. One authorized historical Development test produced one provider-accepted `Sent` record and one inbox message, and replay produced no second provider invocation or message. The mode was then read back as `dry_run`.

Development reporting uses client-partitioned queries against `FreeTestCalls`, `FreeTestDeployments`, and `FreeTestNotifications`, with JSON and spreadsheet-safe CSV projections. It reconciles the exact handled call-key set and durable outcome before producing results, uses Retell's validated authoritative `duration_ms` for actual and connected duration, validates persisted analysis and value-evidence provenance, distinguishes qualified, urgent, wrong-fit/out-of-area, bookable, office-follow-up, and workflow-failure evidence, and reports the test window, end reason, call-limit progress, and explicit in-flight overshoot. New canonical calls use schema v2. A schema-v1 row remains byte-for-byte preserved on later events and is marked withheld for duration and new structured evidence; the runtime never derives legacy duration from timestamps. Missing Boolean evidence makes the affected totals `null` and completeness false. The expected monthly connected-minute range is emitted only when every handled call has authoritative duration evidence: observed handled minutes are divided by elapsed approved test days and multiplied by 28 and 31, with the inputs and limitations stated in the evidence notes. Recommended paid coverage is the tested approved coverage label and is withheld unless qualified, existing-customer, or complete office-follow-up evidence exists. Ordinary JSON/CSV exports omit callback number, caller name, issue narrative, city/ZIP, requested person, workflow-failure text, the called Retell ownership number, raw provider payload, transcript, recording URL, recipient, secret, generic revenue promise, Analytics write, and CRM write. The canonical store and approved notification retain only the bounded callback details needed for operations.

## Deliberate exclusions

The runtime does not book, dispatch, quote, price, transfer, collect payment, send SMS, call outbound, mutate CRM/FSM, ingest transcripts or recordings, or add prospect-specific Retell branches. It stores no raw webhook body, raw provider call ID, Retell number, transcript, recording URL, or notification email outside encrypted configuration.

Number reassignment is not a launch dependency or runtime API. The current controlled-internal scope uses one non-customer Development number for one active phone deployment. Do not reuse or move it during validation. When a test completes, stop the route, preserve the binding and historical call ownership, and place the number into a documented cooldown. A second number and live two-number isolation proof are deferred until they are commercially useful and remain required before claiming the separate two-number prospect gate.

## Security controls

- Development requires the configured private Advanced I/O host before SDK initialization, then the pinned SDK's Development environment and exact project identity before Data Store or Mail access. The public request's internal environment header is deliberately ignored because Catalyst can expose it in a non-scalar form; no caller-controlled header can select the SDK project or environment.
- `GET /internal/readiness` uses the private `X-Free-Test-Readiness-Token` header. The standard `Authorization` header is not used because Catalyst reserves it for platform OAuth and intercepts it before Advanced I/O execution. Missing, duplicate, or ambiguous readiness-token headers fail closed.
- The retry Job validates Catalyst's platform-injected `X_ZOHO_CATALYST_ENVIRONMENT` as `Development`, then matches the exact private project and Function Job pool identifiers from the Job Request before SDK initialization. Job parameters and undocumented Context headers cannot select a project or pool. Catalyst currently documents both `getJobPoolDetails()` and `getJobpoolDetails()` casing, so the boundary accepts either method but requires the same exact returned ID and `Function` type. The exact live environment and Job Request shapes still require Development readback before enabling the schedule.
- The Advanced I/O target is deployed in Catalyst Development on Node.js 24 with 256 MB function memory. The independently packaged retry target is deployed on Node.js 18 with 256 MB function memory, and its Function Job pool is provisioned with 512 MB. All were independently read back. The shared core declares compatibility with both stacks.
- Production is rejected by source.
- Retell verification uses the unmodified UTF-8 request bytes, `HMAC-SHA256(raw_body + timestamp)`, exact millisecond header parsing, constant-time comparison, and a 300-second window.
- Bodies, strings, tables, columns, routes, timestamps, event types, configuration objects, and extracted fields are bounded and validated.
- Number, call, event, notification, and public correlation identifiers are keyed digests; ordinary logs contain only public correlation, event/state, route, status, and safe error code.
- Obvious volunteered card, SSN, bank, government-ID, authentication, or off-scope medical data is minimized before canonical or notification persistence.
- Retell extraction may assert only unknown or caller-supplied estimated value; confirmed/booked revenue and internal estimates require separate authoritative sources.

## Configuration

[`functions/retell_free_test/.env.example`](functions/retell_free_test/.env.example), [`functions/retell_free_test_retry/.env.example`](functions/retell_free_test_retry/.env.example), and [`config/variables.json`](config/variables.json) are the exact public registry. The two target-specific files enforce least privilege: the retry Job does not receive the Retell webhook key, number-lookup key, readiness token, route paths, request limits, or Advanced I/O host. Real secrets, private agent IDs, sender address, client identifiers, phone numbers, and customer data stay outside Git. Missing, malformed, placeholder, mismatched, or Production values fail closed.

The two private Catalyst identity variables use the `FREE_TEST_` namespace. Catalyst rejects custom names beginning with its reserved `CATALYST_` prefix; the platform-provided `X_ZOHO_CATALYST_ENVIRONMENT` value is the only Catalyst-owned environment signal in the registry.

Catalyst Development has the required Advanced I/O and retry-Job variables configured through the platform's private configuration, including independent secret material, a verified `FREE_TEST_MAIL_FROM`, the pinned source revision, and `FREE_TEST_NOTIFICATION_MODE=dry_run`. The positive readiness check returns non-cacheable HTTP 200 for Development with the exact revision and all four tables readable. Missing, wrong, malformed, or duplicate readiness credentials and unsupported methods, paths, query strings, or hosts fail closed. Values remain outside Git and ordinary logs.

## Tests

From `functions/retell_free_test`:

```powershell
npm ci --ignore-scripts
npm run test:unit
npm run test:integration
npm run test:acceptance
npm run ci
```

Then prove the independently packaged Function Job target from `functions/retell_free_test_retry`:

```powershell
npm ci --ignore-scripts --install-links
npm run ci
```

The root [`catalyst.json`](catalyst.json) repeats the retry package's `npm ci --install-links` step as a `predeploy` hook. `--install-links` is required: it materializes the reviewed local core package inside the Job archive instead of leaving a sibling-directory link that Catalyst cannot deploy. [`config/retry-job.json`](config/retry-job.json) fixes the Development Function Job pool, no-parameter job, disabled-first one-minute Cron, activation readback, and rollback. The Cron—not the pool alone—submits the recurring retry Job.

The Cron resource is named `FreeTestRetry1m`; Catalyst enforces a 20-character Cron-name limit. Development readback proved an every-one-minute predefined Cron with zero platform retries, the intended Function Job pool and retry-function target, and disabled status. It remains disabled. Manual empty and controlled retryable-state Job runs completed without duplicate calls, duplicate notifications, cross-client processing, or real mail in `dry_run`.

The suites cover contract/environment/schema validation, raw signatures, sensitive-data minimization, revenue-source restrictions, Data Store SDK calls, two-client resolution and lifecycle isolation, cross-client rejection, replay, reordered events, 7-day/25-call enforcement, documented in-flight overshoot, dry-run containment, bounded transient pre-provider retries, exact handled-call key reconciliation, duration and connected-minute methodology, structured report classifications, private retry/readiness, and Production pre-access rejection.

## Historical Catalyst Development evidence

- Both functions were read back at revision `8df5d8abc93a81dcbb714c0980c26a675209568b`: `retell_free_test` was Node.js 24 Advanced I/O at 256 MB, and `retell_free_test_retry` was a Node.js 18 Job Function at 256 MB.
- Sanitized pullback comparison matched 24 Advanced I/O and five retry-package source files to Git, with normalized manifests matching after platform-injected variables were excluded.
- The four Data Store tables, exact columns and constraints, required `audit_consent`, and no App User access were independently read back.
- Positive readiness returned HTTP 200 with Development identity, exact source revision, four readable tables, `dry_run`, and `Cache-Control: no-store`; negative credential/method/path/host cases failed closed.
- Signed inbound and event matrices proved exact resolution, rejection, immutable ownership, replay/reorder convergence, sensitive-data minimization, seven-day expiry, and the practical 25-call stop.
- Manual retry Jobs proved empty and retryable-state behavior while the recurring Cron remained disabled.
- One controlled internal email was provider-accepted and observed once in the internal mailbox; replay caused no second provider invocation, and notification mode was restored to `dry_run`.
- One Retell Development number was unbound/rebound to the reviewed shared version as a rollback exercise, and the signed resolver passed after restoration.

The remaining product work is intentionally Retell-focused: minimum controlled voice/audio behavior and provider fallback, plus a second Development number only when live two-number isolation is needed before the first prospect gate. No further Catalyst architecture is required. Before handoff, deploy the exact final reviewed revision, update both `SOURCE_REVISION` values and synthetic rows, re-run readiness, and repeat the sanitized source pullback comparison. [`config/runtime-readiness.json`](config/runtime-readiness.json) defines that live-evidence contract and deliberately does not claim mutable current status from source control.
