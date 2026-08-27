# Revenue Desk Call Runtime

Status: **canonical gateway and worker definitions are installed in Development with exact source-revision stamp/runtime readback and archive-pullback byte parity to their exact uploads; bounded provider logs show no post-update execution, but historical access, the legacy phone-webhook binding, configuration-registry parity, canonical Job binding, migration, rollback, and runtime acceptance remain unresolved**.

This shared Zoho Catalyst package contains exactly two deployable functions:

- `revenue_desk_call_gateway` — Advanced I/O ingress.
- `revenue_desk_call_worker` — private Function Job target.

The canonical source profile is `free_test/call_gap_monitor_v1`. Registered paid-service profiles `launch_v1`, `growth_v1`, and `scale_v1` remain disabled drafts and fail closed. The Development definition deployment and subsequent read-only provider reconciliation do not authorize a route, customer test, paid offer, Production traffic, migration, mail send, binding, invocation, Retell test, or Retell change.

## Boundaries

`POST /retell/events` verifies the raw-body signature, validates and minimizes the envelope, durably claims one `provider_event` receipt, and conditionally submits `{ mode: "process_event", event_key }` to `RevenueDeskCallJobs` without business processing. Before the external submit, a compare-and-set transition to `Queued` places a private dispatch token in the existing receipt lease field; only that token owner may submit. This fences a timed-out original request from submitting again after a provider retry has won the race. A submit/readback ambiguity clears the dispatch token but remains `Queued`; HTTP replay never re-submits, and `retry_scan` directly processes the durable receipt. Both Retell ingress routes enforce an eight-second end-to-end response budget, leaving two seconds of margin under Retell's current ten-second webhook timeout; exhaustion returns a sanitized retryable 503 rather than claiming completion. Catalyst SDK operations are not cancellable, so delayed completion and provider retry converge through this dispatch fence, the durable receipt, processing lease, idempotency, and readback controls. The pinned `zcatalyst-sdk-node@3.4.0` adapter uses `app.jobScheduling().JOB.submitJob()` with `target_type=Function` and `target_name=revenue_desk_call_worker`; there is no REST fallback.

`POST /retell/inbound` must return synchronously. It verifies the request, resolves one active immutable configuration version, applies route/capacity gates, returns bounded variables, and durably records the minimized `Resolved` or `ConfigurationUnavailable` decision as an `inbound_resolution` receipt. It does not write calls, notifications, or Analytics facts.

`GET /internal/readiness` is authenticated and Development-only. It reads capped, provider-ordered pages of source-bound deployments and configuration versions, validates local source/environment/status/timestamp/reconciliation relationships, and reports whether either 100-row evidence page was capped. Traffic is reported enabled only when an eligible active row is present, the scan is not capped, and no incomplete terminal reconciliation evidence is visible. Exact approval/activation evidence remains enforced on the call path; level-triggered `retry_scan` owns exact Completed-artifact verification and repair so readiness never performs an unbounded per-deployment report walk. Production has no callable readiness exception.

The worker accepts only exact string parameters:

| Mode | Parameters | Work |
| --- | --- | --- |
| `process_event` | `mode`, `event_key` | Converge one provider receipt. |
| `retry_scan` | `mode` | Retry due provider receipts/notifications, reconcile bounded terminal deployments, and dispatch at most five durable CRM report summaries. |
| `rebuild_report` | `mode`, `deployment_id` | Reconcile a report and sanitized outbox facts. |
| `reconcile_deployment` | `mode`, `deployment_id` | Return deployment reconciliation evidence. |

Unknown modes, extra keys, non-string values, malformed keys, wrong project/pool identity, and Production fail before SDK or durable access.

## Environment and capability isolation

Development requires `DEPLOYMENT_ENVIRONMENT=development`, `DEPLOYMENT_MODE=active`, reviewed private configuration, exact table names, and an artifact-stamped `SOURCE_REVISION`. Runtime rows must match the active and approved configuration-version IDs, engagement, capability, environment, revision, binding, shared agent/version, coverage, approval receipt, activation receipt, activation time, and handled-call state. Status strings never substitute for durable authorization evidence.

Production uses only:

```text
DEPLOYMENT_ENVIRONMENT=production
DEPLOYMENT_MODE=dark
SOURCE_REVISION=<release-stamped-40-character-sha>
```

Every Production gateway path and worker invocation returns 503 before host parsing, Job Request inspection, SDK initialization, Data Store, Mail, or outbox access. Dark provisioning never authorizes activation.

## Durable contract

Five tables are canonical operational state:

1. `RevenueDeskDeployments` — number ownership, active configuration-version reference, nullable approval/activation receipt references, activation-time/capacity gates, and handled-call convergence. `ACTUAL_START_AT` and `EXPIRES_AT` stay null through approval and are set only after route-activation readback.
2. `RevenueDeskConfigurationVersions` — authoritative immutable configuration with engagement/capability attribution.
3. `RevenueDeskEventReceipts` — append-only `inbound_resolution`, `provider_event`, or `authorization_event` evidence; provider rows use the private lease field first as a dispatch fence and later as the processing lease, authorization rows bind the configuration, route, route readback, and related approval event, and `CALL_KEY` remains optional for non-provider evidence.
4. `RevenueDeskCalls` — canonical calls with immutable `CONFIGURATION_VERSION_ID`, label, `ENGAGEMENT_TYPE`, and `CAPABILITY_PROFILE`, repeated in canonical JSON integrity checks.
5. `RevenueDeskNotifications` — bounded dry-run or authorized Development email state with the same immutable attribution.

The sixth runtime-consumed table, `AnalyticsSyncOutbox`, is shared delivery infrastructure, not transactional authority. Completed calls and deployment/report reconciliation create sanitized additive-v2 facts with deterministic keys, hashes, opaque partitions, immutable `SOURCE_DATE_UTC`, and exact duplicate readback. A `final_test_result` fact is emitted only after the reconciled report has an authoritative terminal timestamp and reason; an in-progress report emits none. The dedicated `ANALYTICS_PARTITION_HMAC_SECRET` produces the same opaque client/deployment partitions across approved package-local producers without sharing the broader runtime event secret. Each v2 fact normalizes every payload timestamp through `Date.toISOString()` before canonical JSON and hashing. Its sole provider-enforced identity is the existing unique `OUTBOX_KEY`, derived as SHA-256 over the NUL-delimited `analytics-provider-version-v1` domain, record type, environment, client key, deployment key, record key, and normalized `SOURCE_MODIFIED_AT`; a same-watermark payload conflict fails closed through exact immutable readback and `PAYLOAD_HASH`. The v2 state column is `SYNC_STATUS` to avoid a case-insensitive collision with the live v1 `Status` column. All additive outbox columns remain physically nullable for legacy-row preservation and are enforced for v2 rows in code. Facts contain no phone, email, name, narrative, transcript, recording, audio, prompt, or raw provider payload. Analytics cannot reverse-write runtime state.

The seventh runtime-consumed table, `CRMBillingOperations`, is shared producer/consumer infrastructure owned by `crm_billing_orchestrator`. A terminal free-test report creates an encrypted, sanitized, revision-specific `sync_report_summary` row. New rows use schema/domain `sylvara.crm-report-summary.v2`, which explicitly permits a null workflow-failure total; the consumer retains read compatibility with v1 only when that legacy count is a non-null integer. The key binds environment, Deal, deployment, configuration, report schema, canonical call set, full canonical report revision, and action. `retry_scan` is the sole automatic caller: it sends the exact Deal ID and operation key to the existing orchestrator route with Catalyst `ZCFKEY` and a separate report-only header credential, applies one end-to-end timeout and bounded JSON response, then requires the row at `STATUS=completed` with `LAST_OUTCOME=report_summary_readback_confirmed`. Pending or ambiguous CRM state keeps deployment reconciliation and readiness pending. Workflow-failure, bookable-opportunity, and office-follow-up totals remain null through the report when privacy minimization or missing provider fields withhold the underlying evidence; erased or absent evidence is never represented as zero. The worker never writes CRM `Stage`, `Results_Review_At`, paid acceptance, or Billing state.

An unmatched `Resolved` inbound receipt is never aged into a no-call conclusion. If Catalyst durably resolves a request after the eight-second response deadline, Retell may have received only the retryable 503 and used its number-bound fallback without the returned correlation metadata. Because the inbound request has no provider call identifier and Retell does not publish an authoritative retry-spacing or failed-call-absence receipt, terminal reporting remains `AwaitingSettlement`; no final Analytics fact or CRM report operation is created. Live ingress therefore remains dark until the separately scoped Retell task supplies and verifies an authoritative provider-readback reconciliation contract. A timer may escalate this state but must not complete it.

[`config/datastore-schema.json`](config/datastore-schema.json) remains an activation contract, not live authorization. Development readback confirms a current count of 35 tables; the five canonical operational tables are empty, and the seven reviewed additive `RevenueDeskConfigurationVersions` columns are present. `AnalyticsSyncOutbox` has 307 legacy rows, zero version-2 rows, zero nonnull `OUTBOX_KEY` rows, and the exact nullable-unique single-key contract. `AnalyticsSyncCheckpoints` has 10 legacy rows, zero version-2 rows, and its exact required application schema. The complete function inventory contains the six canonical definitions beside six known legacy definitions. The provider's generic `is_deployed` flag is false for all six canonical definitions and is recorded without interpreting it as Development-source absence or a Production-deployment result. Four Function Job pools exist: the two canonical 512 MB pools and two noncanonical pools. The only Cron is inactive and targets a legacy function through a noncanonical pool; neither canonical pool has a Cron reference, current canonical Job binding acceptance is not proven, and `RevenueDeskRetry1m` is absent. On 2026-08-27, the gateway and worker definitions were installed with Node 24, 256 MB, zero environment variables, and exact revision `7fb101d60e4480a2aaa88de70d82d6b1ddc9e989` source-stamp readback. Their Catalyst-pulled archives match their exact uploaded archives byte for byte by SHA-256 and length; digests and private paths remain outside Git. The gateway's direct-function Security Rule is POST-only and requires Catalyst authentication while API Gateway remains disabled. Provider logs contain zero access and application records in the 24-hour post-update window covering all six latest updates; older access records on the two preexisting definitions remain inside the seven-day Development retention window. This deployment performed no operator function or Job invocation and no API Gateway route, record, Retell, customer, or Production action. The bounded zero post-update log result does not prove a complete caller inventory or callable-surface inertness. Read-only Retell reconciliation proves provider-neutral contract parity, but the phone webhook remains on the legacy Catalyst boundary and required no-retained-content, pre-assent media/DTMF, and static-notice controls remain unproven. No Retell change, test, simulation, call, publish, or route change occurred. Exact-upload archive parity does not prove configuration-registry parity or the three-route gateway contract. Fresh metadata, permissions, counts, digests, samples, conflicts, configuration parity, version-2 write/readback, source/destination reconciliation, and scoped approval remain mandatory before binding a function or migrating data. The earlier contained attempt remains in the historical [execution record](../evidence/free-revenue-leak-test-development-packet-a-execution-2026-08-26.json); [ADR 0008](../../../docs/adr/0008-single-key-analytics-outbox-fence.md), the sanitized [Packet A resolution evidence](../evidence/free-revenue-leak-test-development-packet-a-resolution-2026-08-26.json), and the [six-function Development deployment evidence](../evidence/free-revenue-leak-test-development-six-function-deployment-2026-08-27.json) preserve the current bounded conclusions.

The required consumer-first deployment order remains a release gate; the sanitized deployment evidence does not prove the exact six-function sequence. The operator did not invoke the Development compatibility probe because no verified private Advanced I/O invocation channel was available. A later scoped synthetic proof must show that the consumer accepts a v2 null workflow-failure total and still validates a retained v1 non-null row; do not use a real Deal or Retell traffic. Keep the gateway, worker, and retry trigger dark until consumer-first order and compatibility readback pass. This ordering remains mandatory because an older v1-only consumer correctly rejects a v2 payload and would leave terminal reconciliation pending.

## Out-of-band approval and activation control

[`lib/approval-control.js`](functions/revenue_desk_call_gateway/lib/approval-control.js) is reusable control-plane validation code, not a seventh function, gateway route, or worker mode. It separates signed `approve`/`revoke` decisions from signed `activate` decisions; binds both to the exact immutable configuration, deterministic route fingerprint, source revision, optimistic row version, and fresh evidence; chains activation to approval; requires authoritative route readback; rejects Production; and projects append-only `authorization_event` receipts. Approval moves a row only to `Scheduled`; activation alone moves it to `Live` and starts the exact seven-day interval. Capacity is enforced from durable handled-call convergence, with only the already documented in-flight overshoot; there is no unused reservation subsystem.

The exact prestate, mutation predicates, readback, ambiguity, invalidation, containment, rollback, and legacy retirement rules are in [`route-approval-control-plane-runbook.md`](route-approval-control-plane-runbook.md). Legacy deletion and activation remain blocked until the legacy source export, dependency map, and live route/Job/webhook/caller binding proof are reconciled. The legacy boundary remains stopped but recoverable; legacy status or receipt rows are historical/quarantine evidence and never authorize a canonical route.

## Release artifact and migration gates

The checkout contains an unbuilt revision sentinel; an environment SHA alone cannot claim parity. Build a separate release tree after selecting final main:

```powershell
node scripts/build-release.js --revision <40-character-final-main-sha> --output <new-release-directory>
```

The builder accepts only the exact clean checked-out Git `HEAD`, reads the deployable allowlist from that commit's blobs, refuses existing or in-repository output, rejects non-regular paths, stamps only an atomic outside-repository artifact, validates the exact two targets and linked worker dependency, and writes deterministic hashes in `release-manifest.json`. Materialize dependencies only in that staged tree. Never deploy the mutable or unstamped checkout.

Observed Development counts require preservation: `FreeTestDeployments=3`, `FreeTestCalls=30`, `FreeTestNotifications=6`, `FreeTestRetellEventReceipts=39`, plus nonempty generic resolver/call/Analytics tables. No deletion, rename, truncate, in-place rewrite, or cutover is safe. A future one-way migration must preserve keys, environment/engagement ownership, configuration-version IDs, receipt kinds/idempotency, call attribution, notifications, authorization chains, handled counts, and outbox lineage, then prove counts, per-partition keyed digests, samples, every conflict, rollback, and a recovery window.

## Verification

```powershell
cd functions/revenue_desk_call_gateway
npm ci --ignore-scripts
npm run ci

cd ../revenue_desk_call_worker
npm ci --ignore-scripts --install-links
npm run ci
```

Tests cover the SDK Job payload/readback, fast durable ingress, the exact three gateway routes and four worker modes, replay/reordering, inbound audit, tenant/configuration/capability isolation, approval-versus-activation timing, receipt/readback invalidation, call limits, minimized notifications/outbox facts, report reconciliation, source-stamp mismatch, isolated release building, and no-access Production dark containment.

No live call, route, provider change, migration, deletion, Production access, real mail, CRM write, Analytics reverse-write, booking, dispatch, transfer, quote, payment, SMS, outbound communication, private ID, or secret is authorized or included.
