# Shared Retell 7-Day Free Test — Catalyst Development Runtime

Status: **READY FOR DEVELOPMENT DEPLOYMENT; not deployed and not ready for a controlled phone or prospect test**.

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

[`config/datastore-schema.json`](config/datastore-schema.json) is the exact source schema. It is not evidence that the tables or constraints exist in Catalyst. Table/column provisioning, unique-constraint readback, ZCQL compare-and-set behavior, encrypted-field access, the PII/ePHI validator (`audit_consent=true`) on all four caller- or recipient-bearing JSON columns, and SDK response shapes must be proven in Development before routing.

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
- The Advanced I/O target uses Catalyst's supported Node.js 24 stack with 256 MB function memory. Catalyst's current Job Function contract supports Node.js 18, so the independently packaged retry target is pinned to `node18` with 256 MB function memory and a 512 MB Function Job pool; the shared core declares compatibility with both. Memory is a Catalyst resource setting, so deployment must set and independently read back these values even though the function package manifest does not encode them.
- Production is rejected by source.
- Retell verification uses the unmodified UTF-8 request bytes, `HMAC-SHA256(raw_body + timestamp)`, exact millisecond header parsing, constant-time comparison, and a 300-second window.
- Bodies, strings, tables, columns, routes, timestamps, event types, configuration objects, and extracted fields are bounded and validated.
- Number, call, event, notification, and public correlation identifiers are keyed digests; ordinary logs contain only public correlation, event/state, route, status, and safe error code.
- Obvious volunteered card, SSN, bank, government-ID, authentication, or off-scope medical data is minimized before canonical or notification persistence.
- Retell extraction may assert only unknown or caller-supplied estimated value; confirmed/booked revenue and internal estimates require separate authoritative sources.

## Configuration

[`functions/retell_free_test/.env.example`](functions/retell_free_test/.env.example), [`functions/retell_free_test_retry/.env.example`](functions/retell_free_test_retry/.env.example), and [`config/variables.json`](config/variables.json) are the exact public registry. The two target-specific files enforce least privilege: the retry Job does not receive the Retell webhook key, number-lookup key, readiness token, route paths, request limits, or Advanced I/O host. Real secrets, private agent IDs, sender address, client identifiers, phone numbers, and customer data stay outside Git. Missing, malformed, placeholder, mismatched, or Production values fail closed.

The two private Catalyst identity variables use the `FREE_TEST_` namespace. Catalyst rejects custom names beginning with its reserved `CATALYST_` prefix; the platform-provided `X_ZOHO_CATALYST_ENVIRONMENT` value is the only Catalyst-owned environment signal in the registry.

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

The Cron resource is named `FreeTestRetry1m`; Catalyst enforces a 20-character Cron-name limit. It is provisioned disabled and remains disabled throughout this Development phase.

The suites cover contract/environment/schema validation, raw signatures, sensitive-data minimization, revenue-source restrictions, Data Store SDK calls, two-client resolution and lifecycle isolation, cross-client rejection, replay, reordered events, 7-day/25-call enforcement, documented in-flight overshoot, dry-run containment, private retry/readiness, and Production pre-access rejection.

## Required Development proof

Before any phone test:

1. Provision the four tables exactly and independently read back every column, uniqueness rule, private/encrypted access control, and required PII/ePHI validator.
2. Serve and deploy only to Catalyst Development; prove raw bytes, headers, SDK environment, insert conflict, conditional update/readback, timeout, and replay behavior.
3. Deploy `retell_free_test_retry` to the exact Development Function Job pool in `config/retry-job.json`; run one immediate synthetic Job, then enable/read back its one-minute predefined Cron and exercise event and notification backoff, terminal failure, and ambiguity readback.
4. Confirm both synthetic numbers still resolve to the reviewed shared Retell version whose exact gate, no-data fallback, and natural close passed native simulation.
5. Run two synthetic clients through the complete Development phone lifecycle and inspect canonical rows/correlation IDs.
6. Prove `dry_run`, configure only a verified Development sender and approved synthetic recipient, deliver/read back one controlled email, prove replay creates no second email, then restore `dry_run`.

See [`config/runtime-readiness.json`](config/runtime-readiness.json) for the machine-tested blockers. No repository change is deployment or routing approval.
