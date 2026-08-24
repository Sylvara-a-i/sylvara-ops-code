# Shared Retell 7-Day Free Test — Catalyst Development Runtime

Status: **NOT READY**. The two function packages and four-table schema are deployed and read back in Catalyst Development from source revision `430f4ae628c9b5f3e8e068c802016bc0513e80b5`, but required private configuration and runtime behavior tests remain incomplete. This is not ready for Retell Development configuration, a controlled phone test, a prospect test, or Production.

This package is the bounded Catalyst Development runtime for one shared Retell free-test agent. Each active synthetic deployment has one dedicated Retell number and one versioned configuration snapshot. The runtime performs fail-closed resolution, durable post-call convergence, one handled-call count per provider call, and an email notification **dry run** by default. The committed configuration does not send mail, mutate CRM, import Analytics, activate a route, touch Production, or provide paid Revenue Desk behavior.

## Runtime boundary

The Advanced I/O entrypoint exposes:

- `POST /retell/inbound` — verifies Retell's raw-body HMAC and timestamp, resolves the called-number HMAC to exactly one eligible deployment, and returns client variables plus integrity-bound ownership metadata.
- `POST /retell/events` — accepts only `call_ended` and `call_analyzed`, verifies the same raw-body contract, and converges receipts, calls, handled count, and a dry-run notification.
- `GET /internal/readiness` — private bearer-authenticated Development dependency check.

No other HTTP route exists. [`retell_free_test_retry`](functions/retell_free_test_retry/) is a separate Catalyst Function Job target for due `RetryRequired`/expired-processing event receipts and pending/retryable notification rows. It imports the reviewed core package as a materialized local package, reads a minimized encrypted event record rather than a raw webhook, uses bounded backoff, and does not blindly resend an ambiguous Mail attempt.

Known resolver failures return Retell's exact rejection object, `{ "call_inbound": { "reject": true } }`. Transport/authentication failure can cause Retell to fall back to the number-bound shared agent. The reviewed Development agent readback and 25-of-25 native simulations now prove the exact first-node gate, direct no-data fallback, deliberate close, and absence of client-specific intake when ownership variables are missing. Keep every number pinned to that reviewed shared version and re-prove fallback after the Catalyst endpoint is deployed.

## Four-table model

Only these new Development tables are supported:

1. `FreeTestDeployments` — current number HMAC, immutable configuration snapshot, activation gate, call-key set, handled count, and stop state.
2. `FreeTestRetellEventReceipts` — minimized event identity/fingerprint, ownership correlation, lease, retry, and terminal state. Development already contains an incompatible legacy `RetellEventReceipts` table; preserve it untouched and do not point this runtime at it.
3. `FreeTestCalls` — one tenant-bound canonical call and outcome per provider call.
4. `FreeTestNotifications` — one email-only durable delivery-state record per analyzed call; committed mode is dry-run.

[`config/datastore-schema.json`](config/datastore-schema.json) is the exact source schema. Catalyst Development readback proved all four runtime tables, every declared column and constraint, and `audit_consent=true` on all four caller- or recipient-bearing encrypted JSON columns. Independent permissions readback also proved that the default App User has no access to any runtime table. This schema readback does not prove signed request handling, inserts, conditional ZCQL updates, replay convergence, or SDK response shapes; those runtime behaviors remain blocked by missing private configuration.

Catalyst currently permits at most two unique `varchar` columns on one table. `FreeTestDeployments` therefore places database uniqueness on `DEPLOYMENT_KEY` and the resolver-critical `NUMBER_LOOKUP_HASH`. `DEPLOYMENT_ID` remains mandatory and every runtime lookup uses `store.unique()`, which rejects more than one matching row as `AMBIGUOUS_DURABLE_OWNERSHIP`; an ambiguous deployment ID cannot resolve, count, notify, or report.

## Eligibility and counting

Inbound resolution requires all approved gate values plus:

- `Live` and `Approved` state;
- explicit `actualStartAt` and an expiration exactly seven days later;
- current time at or after start and strictly before expiration;
- handled count below 25;
- internally consistent client, deployment, configuration, number binding, shared agent, agent version, and source revision.

A valid terminal `ended` post-call event counts the handled call, whether first observed as `call_ended` or `call_analyzed`. `error` and `not_connected` lifecycle records remain durable but are not counted or notified as handled calls. The call key set makes replay idempotent. Notification waits for analysis.

The reviewed shared Retell draft emits exactly these 11 canonical `custom_analysis_data` names: `outcome`, `coverage_trigger`, `caller_name`, `callback_number`, `customer_type`, `caller_intent`, `issue_summary`, `city_or_zip`, `urgency`, `specific_person_requested`, and `sensitive_data_detected`. Legacy analysis names are not aliases and fail validation or remain unknown. Opportunity value remains `unknown` at this stage; the Catalyst model can accept separately authorized, source-qualified attribution later without inventing revenue.

There is intentionally no pre-call reservation or admission table. Sequential calls stop at 25. Calls already resolved and in flight when the 25th result converges can create a visible practical overshoot. This is the approved MVP tradeoff; reporting shows the actual handled count and stop state. The runtime never starts paid service.

## Notification and reporting

Committed configuration uses `FREE_TEST_NOTIFICATION_MODE=dry_run`. The adapter validates the approved email-only recipient and configured sender, creates a durable `Pending` row, then records `DryRunRecorded` with `ATTEMPT_COUNT=0` without calling Mail. Source also contains the tightly bounded `send_development` path using `app.email().sendMail({from_email,to_email:[...],subject,content,html_mode:true})`. That path models `Sending`, `Sent`, `RetryRequired`, `Ambiguous`, and `TerminalFailure`; a timeout or unclassified result after invocation becomes `Ambiguous` and is never automatically resent. No provider send occurred in this change because no verified Development sender and approved synthetic recipient were available. The internal-phone gate requires one controlled delivery/readback, followed by restoration to `dry_run`.

Development reporting uses client-partitioned queries against `FreeTestCalls`, `FreeTestDeployments`, and `FreeTestNotifications`, with a sanitized operator CSV export where required. There is no Analytics outbox/import and no CRM write. Catalyst remains canonical; CRM and Analytics are deferred.

## Deliberate exclusions

The runtime does not book, dispatch, quote, price, transfer, collect payment, send SMS, call outbound, mutate CRM/FSM, ingest transcripts or recordings, or add prospect-specific Retell branches. It stores no raw webhook body, raw provider call ID, Retell number, transcript, recording URL, or notification email outside encrypted configuration.

Number reassignment is not a launch dependency or runtime API. Do not reuse or move either number during initial validation. When a test completes, stop the route, preserve the binding and historical call ownership, and place the number into a documented cooldown. Any later reuse is a separately reviewed stopped-route administrative action with readback and re-QA; automatic reassignment remains deferred.

## Security controls

- Development requires the configured private Advanced I/O host as an early check, then the platform `x-zc-environment`, SDK environment, and exact SDK project identity before Data Store or Mail access. No request header alone is sufficient authority.
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

Catalyst Development currently has all 21 Advanced I/O and 15 retry-Job **non-secret** variables configured, including the pinned source revision and `FREE_TEST_NOTIFICATION_MODE=dry_run`. The required secret variables `RETELL_WEBHOOK_API_KEY`, `EVENT_HMAC_SECRET`, `NUMBER_LOOKUP_HMAC_SECRET`, and `INTERNAL_READINESS_TOKEN` are intentionally absent, and `FREE_TEST_MAIL_FROM` is also absent because no verified Development sender exists. Until those values are entered through the private operator path, the Advanced I/O readiness route deliberately returns non-cacheable `503 INVALID_RUNTIME_CONFIGURATION` without touching Data Store or Mail.

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

The Cron resource is named `FreeTestRetry1m`; Catalyst enforces a 20-character Cron-name limit. Development readback proved an every-one-minute predefined Cron with zero platform retries, the intended Function Job pool and retry-function target, and disabled status. It remains disabled. No immediate retry Job has been run.

The suites cover contract/environment/schema validation, raw signatures, sensitive-data minimization, revenue-source restrictions, Data Store SDK calls, two-client resolution and lifecycle isolation, cross-client rejection, replay, reordered events, 7-day/25-call enforcement, documented in-flight overshoot, dry-run containment, private retry/readiness, and Production pre-access rejection.

## Catalyst Development evidence

- Both functions are deployed from source revision `430f4ae628c9b5f3e8e068c802016bc0513e80b5`: `retell_free_test` is Node.js 24 Advanced I/O at 256 MB, and `retell_free_test_retry` is a Node.js 18 Job Function at 256 MB.
- A sanitized pullback comparison matched all 29 deployed source files to Git without exposing private runtime configuration.
- The four Data Store tables, their columns and constraints, all required `audit_consent` settings, and no App User access were independently read back.
- The `FreeTestRetryDevelopment` Function Job pool is provisioned at 512 MB. `FreeTestRetry1m` targets the intended pool and function, repeats every minute with zero platform retries, and is disabled.
- The fail-closed readiness response is HTTP 503 with `INVALID_RUNTIME_CONFIGURATION` and `Cache-Control: no-store`, as expected while required values are absent.
- The function rollback primitive was exercised by deletion, independent absence readback, and redeployment. The final deployed source was then matched to Git.

This evidence does **not** prove a valid signed inbound request, invalid-signature rejection, a durable call row, replay/count convergence, an immediate retry Job, Mail delivery, a Retell route, a phone call, or any Production behavior.

## Remaining Development proof

Before Retell Development configuration or any phone test:

1. Enter the four required secrets through the private Catalyst operator path and configure a verified Development-only `FREE_TEST_MAIL_FROM`; never place values in Git, logs, chat, or evidence files.
2. Prove raw bytes, signature and freshness rejection, SDK environment identity, insert conflict, conditional update/readback, timeout, and webhook replay behavior against the deployed Development runtime.
3. Run one immediate synthetic retry Job and exercise event and notification backoff, terminal failure, and ambiguity readback while the recurring Cron remains disabled.
4. Reconcile Retell Development configuration without creating a route or number binding, then separately prove the shared agent's safe missing-configuration behavior before any controlled phone test.
5. Create two synthetic deployment records and prove one durable call, one count increment, replay convergence, seven-day expiry, practical 25-call stop, isolation, reporting ownership, and rollback.
6. After separate approval of a verified Development sender and synthetic recipient, deliver/read back one controlled email exactly once and restore `dry_run`.

See [`config/runtime-readiness.json`](config/runtime-readiness.json) for the machine-tested blockers. No repository change is deployment or routing approval.
