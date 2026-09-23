# Revenue Desk Analytics Sync

## Scoped Seven-Day Free-Test Report Candidate

The September 2026 reporting continuation is narrower than the historical
operations/paid-conversion dashboard package below. The existing
[operator acceptance record](../revenue-desk-release/free-test-operator-runbook.md)
records five empty Development targets and the held `5227abe` importer, plus
accepted assisted-lineage configuration staging/approval at `20bf11c`. These are
installation and bounded configuration evidence, **not successful Analytics
import, call-dependent reporting or customer-delivery acceptance**. The local
renderer correction below changes none of those deployed artifacts or holds.
Requirement owner: the Sylvara operator.

| Gate | Current evidence | Remaining action | Cost / authorization | Status |
|---|---|---|---|---|
| Call categories and required final metrics | Producer, minimized facts and exhaustive rollup regressions retained; local overshoot presentation correction | Review and publish the local report delta; keep installed runtime unchanged for this correction | Offline; no provider execution | Source verified; renderer delta awaiting review/publication |
| CRM pre-test context | Typed capture, immutable configuration and 16 minimized deployment columns tested; assisted-lineage staging/approval accepted at `20bf11c` | Preserve accepted configuration; supply only genuine business baseline/period evidence for each new test, leaving missing metrics unknown | New customer/configuration scope needs its exact authority; no repeat of consumed G2 acceptance | Accepted bounded staging; actual company report evidence remains test-specific |
| Simple results report | Fixed-test facts, rowset hashes, periods, counts, duration and baseline reconcile locally; printable single-test draft renderer | Verify one actual authorized partition and final export after call-dependent evidence exists | No customer delivery or public access authorized | Source verified; live/export acceptance pending |
| Analytics targets and worker | Five empty canonical targets / 141 columns and `5227abe` importer recorded installed; Analytics disabled | Verify active provider bindings, migration evidence and bounded import/UTC roundtrip/readback | Confirm allowance and exact execution allocation; preserve disabled scheduling and holds | Installation verified in acceptance record; functional wiring unverified |
| Client delivery | Manual PDF export visible in the Development Free-edition report menu; no export or send performed | Reconcile the new report, verify its filtered output and deliver once to the approved recipient | Manual export, no Analytics email schedule or upgrade | Procedure prepared; final output/delivery pending |

[`config/free-test-report-contract.json`](config/free-test-report-contract.json)
defines three canonical fact types (deployment, call, terminal result), one
client/test, six exhaustive display groups, and explicit zero-call evidence.
The existing five-type dashboard gate remains unchanged: paid conversion is not
a prerequisite for this distinct free-test report. Daily counts are derived
from call facts and labeled UTC; no additional query table or dashboard is needed.

The report also reconciles a recorded `IN_FLIGHT_OVERSHOOT` to unique connected
calls above the stored limit and explains that those calls were already admitted
before the threshold became visible. It makes no exact concurrency-cap claim.
An inconsistent supplied value blocks rendering; an absent historical value stays
**Not available**, not an inferred zero or a retroactively enriched fact.

`tools/build-free-test-report.js` returns minimized **operator-review data**, not
an email, import, PDF, authentication result, or publication authorization.
`tools/render-free-test-report.js` invokes that same gate and renders one private,
static printable HTML draft. It performs no network request, reads no credential
files, loads no remote fonts/assets, and sends nothing. It rejects an existing
output, paths inside a Git checkout, invalid evidence, and cross-test data.
`readbackRowsetDigest` needs only `RECORD_KEY`, `PAYLOAD_HASH`, and
`SOURCE_MODIFIED_AT` from the existing bounded readback. Partition, checkpoint,
single-record, watermark and isolation checks still apply; no raw call export.

CRM remains the baseline owner. `buildCrmReportBaseline` requires the approved
Deal/Account/Contact/intake/configuration binding, CRM revision, pre-test capture,
source period and fresh selected-field metadata. Preserve exact picklist actual
and reference values in that private projection; never substitute labels blindly.
Fields: current handling, monthly call count/band, after-hours band/share, average
job value/band, unanswered-call estimate and optional answering cost. Missing stays null; bands are not
midpoints. Private CRM IDs and arbitrary text are excluded from the reporting
snapshot. The capture adapter does **not** read CRM or fill missing fields.
The runtime now validates an optional snapshot in the immutable configuration;
the deployment producer maps it into 16 optional minimized Analytics columns.
The accepted assisted-lineage staging is recorded separately from still-pending
live sync acceptance; a source helper alone is not new capture authority.

`buildCrmPreTestSnapshot` validates fresh capture before activation without a
`testStartedAt` field. Its read/capture/metadata must be fresh against the current
clock. `buildCrmReportBaseline` is the separate historical-validation path: it
checks capture against the independently evidenced actual start and report time.
Neither function enforces durable once-only storage or authenticates its caller.
The physical `configurationVersionId` and CRM `configurationVersion` label are
separate required bindings. Analytics `CONFIGURATION_VERSION` contains the former;
matching only the label must never attach a baseline from another version row.

The same distinction now applies to the full deployment approval/rollback path:
the command selects the physical version row; its immutable label must match the
stored JSON and CRM `Configuration_Version`, while `Approved_Configuration_Version`
remains the physical ID. Distinct-value regressions reproduced three defects in
the old checks and now pass. The accepted Journey-core-only launchers and receipts
were not changed, and this source correction does not authorize provider activation.

### Baseline field lineage and current readback

| CRM source API field | Report context | Interpretation |
|---|---|---|
| `Current_Call_Handling` | How calls are handled today | Preserve the verified stored choice |
| `Monthly_Inbound_Calls`, `Monthly_Inbound_Call_Band` | Usual monthly call volume | Exact supplied count and/or range; no range midpoint |
| `Estimated_Unanswered_Call_Rate` | Estimated calls going unanswered | Percentage estimate, not measured improvement |
| `After_Hours_Call_Band`, `After_Hours_Call_Share` | Calls outside business hours | Supplied range/share, not the new test's count |
| `Average_Job_Value`, `Average_Job_Value_Band` | Typical gross job value | Context only, never multiplied into recovered revenue |
| `Current_Monthly_Answering_Cost` | Current answering cost | Optional supplied amount, not proven savings |

Only `Current_Call_Handling` is collected by the accepted Form 1. The reviewed
native Lead-conversion map also carries `Monthly_Inbound_Call_Band`,
`After_Hours_Call_Band` and `Average_Job_Value_Band` to the Deal, but those three
bands come from separate Lead qualification, not either accepted form. The five
exact count/percentage/currency fields above are Deal-only inputs in that
snapshot. Their presence in the CRM schema does not prove they are populated.
See the [conversion map](../../zoho-crm/reference/snapshots/2026-08-14/lead-conversion-mapping.csv)
and the [accepted Form 1 contract](../revenue-leak-test-request-form/functions/revenue_leak_test_request_form/lib/form-contract.js).

No reviewed form/CRM field records the baseline source period or evidence class.
The operator must capture these from the business's stated period or records;
CRM `Modified_Time`, test dates and a guessed prior month are not substitutes.
Missing values remain unavailable. Do not add mandatory questions to the accepted
forms or fill a legacy test's baseline retrospectively.

The implemented source persistence format is an optional typed snapshot inside
the **new** configuration's existing encrypted `CONFIGURATION_JSON`, after Form 2
readback and before route approval. Existing approval fingerprints cover those
exact bytes. Runtime validation and local preparation enforce the original
10,000-byte complete configuration limit without truncation. The deployment fact
producer independently checks the HMAC-derived client/deployment keys, physical
configuration ID, CRM label, coverage and capture-before-start relationship.
The report reconstructs the baseline only from its attested deployment fact;
optional later CRM input may corroborate it, never enrich an older row. Numeric
percentages use exact hundredths and amounts use integer minor units. Omitted
optional values reconstruct as unknown, not zero.

The pure preparation utility remains local-only and deliberately returns
configuration and notification-recipient approval as false. The authenticated
controller's separate content/recipient review and immutable staging flow is now
implemented and accepted for the exact assisted lineage recorded under G2 in the
operator runbook. Staging, internal deployment approval, provider activation and
test start remain separate; the accepted G2 readback has zero calls and no start
or expiry. Do not repeat that consumed acceptance or treat it as approval for a
different business configuration. Never append a baseline to an already approved
configuration. No new table, competing CRM writer, Retell variable or general
provisioning platform is required.

The September 15 read-only inspection verified these field definitions in the
Sylvara CRM tenant. The existing synthetic Form 2 phone-QA Deal showed these
baseline values blank while its configuration, intake and relationship bindings
were present. This proves missing baseline evidence on that fixture, **not** a
conversion-mapping defect or permission to fill it with invented values. The
field-limited connector request failed argument parsing; the already-authorized
browser fallback verified only the visible record, without a launch or save.

Current Analytics plan readback: Free, no purchased add-ons, 9,200 unused rows,
zero remaining query-table slots and zero scheduled-email allowance. Existing
legacy reporting assets are not the canonical target schema. No new query table,
upgrade, scheduled import, share, automatic send or customer delivery is part of
this candidate. Plan capacity must be rechecked before any later installation.

### One final report without an Analytics upgrade

The free test requires one final results review, not recurring customer reporting.
The Analytics **Free edition** and Sylvara's **free test** are different things.
Zoho's [report export documentation](https://www.zoho.com/analytics/help/export/exporting-a-report.html)
supports offline PDF export; the September 15 Development UI also exposed
**Export → As PDF**. This verifies an available control, not a successful export
of the new canonical report. No export or email was performed during inspection.
The existing legacy summary uses a different model and must not be substituted
for the reconciled free-test report merely because it exports successfully.

Use the following one-time operator procedure after the live wiring is accepted:

1. Confirm the test is terminal and its stop/restoration evidence is present.
   Finish import and independent readback for the exact client, deployment,
   configuration and final-result revision. Unknown analysis stays unknown;
   do not manufacture zero values to finalize the report.
2. Build the bounded operator-review report using the existing reconciled
   deployment, call and final-result facts. Check the pre-test snapshot, period,
   six call groups, overlapping urgency/follow-up flags, failures and limitations.
   Do not export the old unfiltered multi-client summary.
3. Render/export only the approved single-test result. Inspect every PDF page for
   correct client/test scope, readable content and no other client's data. The
   new local renderer consumes the reconciled evidence directly; it does not
   require a paid Analytics email schedule or another query table. HTML remains
   marked as a draft. Final PDF pagination, font, visual and delivery approval
   remain separate from source tests or the already accepted synthetic demo.
4. Record the approved revision and document hash in the existing private test
   closeout. Confirm the authorized recipient privately and send that reviewed
   attachment once through the existing approved mailbox workflow. Do not create
   a public link, schedule an email, upgrade Analytics or enable a new service.
5. Record delivery evidence in the same closeout. If the send outcome is unknown,
   reconcile mailbox state before any retry. Later analysis may revise internal
   evidence, but does not automatically send a second client report; a material
   correction needs an explicit operator decision and a clearly labeled revision.

This is a manual final-delivery path, not automatic reporting and not permission
to contact a prospect. Recurring paid-plan reports remain outside this sprint.

Local rendering command (replace the two example paths with the exact approved
private minimized evidence input and a **new** output filename outside Git):

```powershell
& "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" `
  .\src\zoho-catalyst\revenue-desk-analytics\tools\render-free-test-report.js `
  "C:\PrivateReportInput\approved-test-evidence.json" "C:\PrivateReports\test-review.html"
```

Run from the reviewed repository root. `--synthetic` additionally labels the
draft **Synthetic Demo — No Live Calls**; it does not bypass any report gate.
The JSON is the minimized existing builder input, not a raw CRM export or an
environment map. Fresh readback evidence remains required. The renderer does
not authenticate self-asserted evidence or approve its recipient. Local font
fallback is explicit; no font file is fetched. Keep the result private and draft
until the exact final document passes the review procedure above.

The remaining integration packet separates (1) genuine business baseline/period
context for any new test, with unknown metrics preserved and no historical
backfill; (2) active target/Connection bindings and migration evidence against the
already installed schema; and (3) bounded import/UTC readback, reconciled final
facts and CRM summary, followed by operator-reviewed export and separately
approved delivery. Actual call-dependent runtime acceptance belongs to the later
controlled-call packet, not a new synthetic execution mode or endpoint. Preserve
completed G2 staging and the held installation; no unchanged redeployment is
needed for this local renderer correction. Do not add a competing CRM writer or
use Analytics as CRM authority.

For any future runtime change only, publish and build the reviewed source before
proposing a fresh held installation of the affected package. This local report
renderer change requires no runtime deployment. Do not reuse consumed installation
allocations. Preserve existing holds, disabled scheduling and historical rows
until the exact cutover and current controlled-acceptance allocation are
authorized. On unknown import/delivery outcome, reconcile first; never retry
blindly or restore a known-defective release as rollback.

The current Job accepts no caller-selected parameters and chooses due rows from
the Development outbox. One invocation is therefore not inherently limited to
one synthetic test. Before active acceptance, prove the entire eligible v2 queue
is within the approved allocation, with Cron and other producers contained, or
review a separately bounded mechanism. Import submission, import polling,
export/readback and checkpoint completion are distinct stages; a successful Job
submission is not end-to-end reporting acceptance.

The September 15 count-only Development query returned **zero** outbox rows
with `ROW_SCHEMA_VERSION = 2` and `ENVIRONMENT = 'development'`. It did not read
payloads or claim tokens and did not modify historical rows. This is a point-in-
time preflight, not a durable queue fence, Cron proof, or import authorization;
recheck the eligible queue immediately before any approved acceptance allocation.

All eleven outcome codes are unchanged. Six client groups are new job
opportunities, existing customers, not a fit, spam, general questions, and
incomplete/needs review. Urgency and follow-up overlap them. Opportunities are not
bookings, completed jobs, revenue, cost savings, or before/after improvement.

Security/cost: synthetic adapters and outbound-denial tests; no new dependency,
metered provider call, import, schedule, customer share or send. Producer changes
require fresh immutable artifacts before later deployment. Historical payloads,
hashes, watermarks, counters and claims must remain intact. Rollback is existing
containment, never rewritten evidence. Reuse current checkpoint/failure signals;
no new monitoring platform. Retell, Production, paid conversion and the broader
dashboards stay excluded. Focused checks are the existing Analytics tests plus
`crm-report-baseline.test.js`, `free-test-report.test.js` and
`free-test-report-facts.test.js`, using pinned Node 24.19.0 and synthetic adapters.

### September 15 local verification

- Latest canonical `tools/verify.ps1 -Mode Quick`: **1,911 passed, zero failed,
  31 skipped**, including immutable baseline propagation and the narrow five-table
  mutation phase, distinct configuration-ID checks, and the printable renderer.
  The same thirty artifact/isolated-deployment checks and one
  Windows Bash check remain skipped; none count as deployment acceptance.
- The corrected full route-control/CRM adapter suites passed 97 tests, the
  unchanged Journey-core suite passed 16, and the report/renderer suites passed
  23 under outbound-denial checks. Independent review found no actionable
  defects. These overlap the canonical total; do not add them as unique cases.
- A local baseline-present synthetic HTML preview was generated and hashed.
  Browser policy blocked the local-file preview, so no workaround or upload was
  attempted. HTML/PDF visual, pagination and font acceptance remain unverified;
  the generated file stays a draft. The earlier accepted offline demo is unchanged.
- Independent final review found no actionable defects. Exact model/rendered
  digest pins and all sixteen baseline columns agree; the broad 32-asset bundle
  and its dashboard fingerprint remain unchanged. `git diff --check` passes.
- The latest metadata delta used five connector reads and one count-only
  Development query, plus read-only UI inspection. It performed no imports,
  cloud saves, deployments, CRM writes, sessions, emails or Retell operations.

Earlier checks on the predecessor local candidate (overlapping, not additive):

- Canonical `tools/verify.ps1 -Mode Quick`: **1,877 passed, zero failed, 31
  skipped** after correcting the stale local worker dependency and reviewed
  Analytics model/render fingerprint pins. Thirty artifact/isolated-deployment
  tests are intentionally skipped in offline Quick mode; one Bash syntax check
  is unavailable to Python child processes on this Windows host. These skips are
  not deployment evidence.
- Separate focused in-process outbound-denial run: **151 passed, zero failed or
  skipped, zero boundary attempts**. The full local Analytics mutation validator
  passed **24 tests**; independent review confirmed prior contract digests and
  approvals remain rejected. The broader dashboard fingerprint is unchanged.
- After the owner accepted the unchanged local demo, the baseline capture API
  and physical-ID report join were corrected. The latest targeted outbound-denial
  run passed **32 tests**, zero failed/skipped/boundary attempts; independent
  review passed **49 focused tests** with no actionable findings. These overlap
  the canonical total and must not be added to it as distinct acceptance cases.
- Local worker and route-control dependency copies were refreshed with
  `npm ci --offline --ignore-scripts --install-links`; lockfiles did not change.
- Source remains on `codex/free-test-analytics-reporting`, unpublished and
  undeployed. Runtime changes invalidate prior package parity for this candidate
  only; previously accepted deployed Journey evidence is preserved, not relabeled.
- This continuation performed fourteen connector read attempts (two rejected)
  plus read-only browser inspection; zero live imports, saves, deployments, CRM
  writes, sessions, emails, Retell/provider operations or purchases.

`analytics_sync` is the one private Zoho Catalyst Job target for Revenue Desk-to-Zoho Analytics synchronization. It has no HTTP route, accepts no caller-selected Job parameters, and targets the shared Revenue Desk Catalyst project through the dedicated `RevenueDeskAnalyticsJobs` Function Job pool.

## Historical August 28 Development Installation

This section records the earlier installed baseline, not deployment of the
September reporting candidate above. Do not infer current artifact parity or
runtime acceptance from this historical installation.

- Historical installed baseline: **implemented, synthetic-testable, and installed in Development at the reviewed source revision with no operator invocation performed and runtime acceptance pending**
- Development definition readback: **Node 24, 256 MB, an exact minimized seven-variable approved private map, exact source-revision stamp, disabled-mode configuration readback, and archive-pullback byte parity to the exact upload; the operator did not execute runtime `DisabledNoOp`**
- Development submitter contract: **one repository-defined `RevenueAnalytics1m` Cron whose exact `Sylvara Catalyst Changes` `create_cron_job` argument template targets `analytics_sync` through `RevenueDeskAnalyticsJobs`, with empty parameters, zero platform retries, and initial status disabled; all provider IDs are fresh private bindings, and the Cron is not deployed or active**
- Development activation: **blocked pending private fixture differential results, Connection and Analytics target proof, version-2 write/readback, Job binding, invocation acceptance, and migration reconciliation**
- Production: **dark only**; `disabled` and `readiness` both return `DarkNoOp` before SDK initialization, Data Store access, Connection access, or Analytics access

Production dark startup requires only lowercase `DEPLOYMENT_ENVIRONMENT`, the mode, the source revision, and Catalyst project/Job-pool identity. It maps `production` to the native `X_ZOHO_CATALYST_ENVIRONMENT=Production` identity and returns before parsing any table, retry, timeout, Connection, organization, workspace, target, or regional-host setting. No Data Store schema, SDK initialization, Connection, or provider setup is a prerequisite for that return.

A 2026-08-24 Development readback found 307 existing `AnalyticsSyncOutbox` rows and 10 existing `AnalyticsSyncCheckpoints` rows. It also found 10 `ClientDailyMetrics`, one `ReportRuns`, 13 `Calls`, and 30 `FreeTestCalls` rows. Those stores are durable evidence, not empty scaffolding. This package never claims a legacy row, and this repository change authorizes no deletion, truncation, rename, backfill, or live write.

The superseding 2026-08-26 Packet A resolution returned the table count from 36 to 35 after deleting both disposable proof tables and their synthetic rows. Exact readback found 307 legacy outbox rows, 71 total outbox columns, zero version-2 outbox rows, zero nonnull `OUTBOX_KEY` rows, and the exact nullable-unique `OUTBOX_KEY` contract. That historical packet did **not** prove the full outbox application schema. It separately found 10 legacy checkpoint rows, zero version-2 checkpoint rows, and the exact required checkpoint application columns. A later connector-first read-only preflight proved that the current repository-required application-schema projections for both `AnalyticsSyncOutbox` and `AnalyticsSyncCheckpoints` match exactly while preserving 28 and 18 noncontract legacy columns respectively. That proof covers schema only; retained-row semantics, producer/consumer lineage, source and target bindings, watermarks, imports, and runtime behavior remain unproven, and activation still requires fresh drift readback. `RevenueDeskAnalyticsJobs` exists as a Function Job pool, although no inspected surface or submitted Job has proved its exact function target. On 2026-08-28, `analytics_sync` converged in Development without a Job invocation at revision `288a93c7773acaf82fab277702e6b4e3d7354564` with Node 24, 256 MB, an exact minimized seven-variable private map, disabled-mode readback, and Catalyst archive pullback parity by path set and file content. The repository now defines one disabled-first `RevenueAnalytics1m` submitter contract, but no canonical Cron is deployed and no runtime `DisabledNoOp` was invoked. Job-target, scheduler, legacy-caller, execution-correlation, and runtime acceptance therefore remain unproven. The operator performed no Retell, customer, or Production action. See [ADR 0008](../../../docs/adr/0008-single-key-analytics-outbox-fence.md), the sanitized [Packet A resolution evidence](../evidence/free-revenue-leak-test-development-packet-a-resolution-2026-08-26.json), the [current table-schema and execution-surface preflight](../evidence/free-revenue-leak-test-development-execution-surface-preflight-2026-08-28.json), the historical [six-function Development deployment evidence](../evidence/free-revenue-leak-test-development-six-function-deployment-2026-08-27.json), the [historical PR-head convergence evidence](../evidence/free-revenue-leak-test-development-pr-head-convergence-2026-08-28.json), and the [current convergence evidence](../evidence/free-revenue-leak-test-development-pr-head-convergence-2026-08-28-288a93c.json).

The predecessor live `analytics_sync` source was structurally present and substantially broader than the prior public inventory indicated. All 15 predecessor modules and the synthetic-test surface were captured and reviewed privately on 2026-08-25; no raw code, private configuration, identifiers, endpoints, or payloads were emitted to this public repository. [`config/live-source-parity.json`](config/live-source-parity.json) records the behavior map, the later Packet A schema resolution, existing Analytics workspace/table evidence, and remaining fixture, fresh-readback, binding, and reconciliation gates. The 2026-08-27 Catalyst-pulled archive matches the exact uploaded revision `aab7c18c27f4ff5e1468da51eae433ede9b852f6` archive byte for byte by SHA-256 and length. That proves exact-upload archive parity, not provider behavior or runtime acceptance; keep the Job disabled until every blocking row is resolved.

A future disabled canary is accepted only after fresh Audit response-shape proof normalizes the provider's nested Cron response—numeric `cron_detail` schedule values, `target_details`, `jobpool_details`, and numeric retry count—to the exact repository contract. Terminal Job evidence must bind the lossless manual-submit `data.job_id` to both the get-by-ID request and response, then bind `source_type=Cron` plus the exact source Cron ID, name, and `pre-defined` execution type; matching only pool, target, parameters, name, or time window is insufficient. The official Job readback shape still provides no documented execution ID, so the canary remains blocked until a lossless Job-to-execution-ID binding is independently proven. Only then may the exact submitted Job be read to terminal `SUCCESS` and an application-log query scoped to that exact execution ID require the `analytics_sync_disabled` event. Even after that proof, no SDK, Data Store, Connection, or Analytics I/O is an inference from exact deployed-archive parity plus the reviewed disabled code path, not provider-level I/O telemetry. The Cron and mode stay disabled throughout this canary.

Cron status mutation has a separate stop gate. The installed Changes surface advertises a full Cron body for `update_cron_job_status`, while the provider's status-only operation is narrower. Exact classification now exhaustively buckets every advertised body field, including alternate schedules, end time, notification, request, header, URL, retry, provider identity, and metadata fields. Every canonical-absent field must be proven literally absent; a null, empty, zero, injected default, unknown key, or absence not established by a fresh response-shape proof blocks exact classification and mutation. The current full-body templates are not execution-ready until read-only evidence proves status-only/nonreplacement semantics. They remain forbidden for drifted or duplicate prestate because they could overwrite the predecessor definition. If safe status-only containment is unavailable, keep the runtime mode disabled, record disabled-Cron containment as unproven, and stop.

Cron inventory and Job drain also fail closed. An empty pre-defined Cron list cannot authorize create until the complete array, item shape, pagination behavior, and cross-execution-type name-collision boundary are proven. Cron resource, persisted Job-definition, pool, target, and function IDs are never treated as submitted Job execution IDs; only a shape-proven manual-submit `job_id` or a separately proven complete execution-history field may enter the drain set. Conditional rollback deletion requires fresh authority for the exact packet-created ID, destroys the Cron and its execution history permanently, and is never retried after an ambiguous result; success requires both complete name/ID inventory absence and a shape-proven get-by-ID not-found readback.

## Boundary

The canonical call-runtime producer creates immutable minimized v2 call/deployment facts and emits `final_test_result` only after terminal report reconciliation. The CRM/Billing orchestrator emits `conversion_status` only after accepted-state Billing and CRM readback plus durable operation completion. `ENGAGEMENT_TYPE` always means the engagement that originated the evidence and therefore remains the immutable dashboard partition. A free-test conversion emits `ENGAGEMENT_TYPE=free_test` and separately emits `TARGET_ENGAGEMENT_TYPE=paid_service`; paid acceptance never moves the historical row out of the Free-Test Operations Dashboard. Because Catalyst functions package independently, each producer keeps a bounded package-local encoder/store adapter and tests byte-for-byte parity against this package's canonical fact implementation. They share only the dedicated private Analytics partition HMAC value, not broader runtime or idempotency secrets. The provider-unique `OUTBOX_KEY` is the single atomic fence over record type, provider match identity, and normalized `SOURCE_MODIFIED_AT`; `PAYLOAD_HASH` independently binds the full immutable canonical payload. All accepted UTC timestamp fields are normalized with `new Date(value).toISOString()` before payload or key construction, so whole-second and millisecond spellings converge. Concurrent exact replays converge, same-watermark payload conflicts fail closed, and later corrections receive a new key. The additive v2 state column is `SYNC_STATUS`, not `STATUS`, because the existing v1 outbox has a camel-case `Status` column and Catalyst column identity must be treated case-insensitively for provisioning safety. Every v2 column is physically nullable so the 307 legacy outbox rows and 10 legacy checkpoint rows remain untouched; `required_for_v2_rows` plus runtime validation enforce the v2 contract. Packet A proved the exact required checkpoint application columns and the outbox's 71-column count plus nullable-unique `OUTBOX_KEY` contract, but not the full outbox application schema. The later read-only preflight now proves the current repository-required application-schema projection for both tables; fresh activation-time drift readback remains mandatory. Producers and the consumer now have Development source-stamp/runtime and exact-upload archive-pullback parity; no operator invocation was performed, but negative runtime-invocation inventory and callable-surface inertness remain unproven. Activation remains blocked until configuration-registry parity, exact version-2 write/readback and concurrency, legacy exclusion, private bindings, Job invocation acceptance, and migration reconciliation are complete. `analytics_sync` reads and mutates only:

- `AnalyticsSyncOutbox`
- `AnalyticsSyncCheckpoints`

It does not read raw Retell payloads, audio, transcripts, phone numbers, personal email addresses, names, CRM records, Billing records, or secrets. Each fact is a strict flat allowlist containing opaque SHA-256 client/deployment/call partitions, source and metric versions, bounded classifications, counts, and UTC watermarks. Unknown fields fail closed.

The Job processes one bounded client/deployment/record-type partition at a time. It uses an additive `ROW_SCHEMA_VERSION=2` lane, deterministic payload and outbox hashes, durable lease tokens, monotonically increasing fence versions, bounded submit attempts, bounded import/readback polling, exact import counts, and an independent exact key/hash/environment readback before checkpoint advancement. Unknown submission outcomes, missing provider jobs, expired summaries, count mismatches, readback mismatches, and checkpoint gaps enter `ReconciliationRequired`; they are never blindly replayed.

[`lib/daily-rollup.js`](functions/analytics_sync/lib/daily-rollup.js) provides the canonical pure v2 UTC-day rollup: it deduplicates replayed calls, applies only the newest correction, rejects same-watermark conflicts and mixed partitions/dates, counts only handled calls, and withholds incomplete structured evidence instead of converting it to zero. After a call batch passes provider readback and checkpointing, the Job queries one bounded partition/date through the immutable non-PII `SOURCE_DATE_UTC`, deterministically inserts or confirms its daily-metric outbox row, and only then completes the call row. Differential parity with the private live rollup plus exact deployed version-2 write/readback remain activation blockers.

## Runtime Modes

| Environment | Mode | Behavior |
|---|---|---|
| Development | `disabled` | No SDK, Data Store, Connection, or Analytics operation |
| Development | `readiness` | Additive v2 Data Store schema/readability check; no Analytics operation |
| Development | `active` | Bounded due-row claim, async `updateadd`, poll, independent readback, checkpoint |
| Production | `disabled` or `readiness` | Identical `DarkNoOp`; zero external reads and writes |
| Production | `active` | Rejected by configuration before SDK initialization |

The exact public registry is [`config/variables.json`](config/variables.json). Private project, Job-pool, Connection, organization, workspace, table/view, and regional-host values stay in Catalyst. A populated environment file must never enter Git.

`SOURCE_REVISION` is not trusted by itself. [`lib/source-revision.js`](functions/analytics_sync/lib/source-revision.js) contains a committed fail-closed sentinel, and configuration requires exact equality with the immutable revision stamped into an isolated release artifact. The checkout must remain unstamped.

## Package

- [`catalyst.json`](catalyst.json) contains exactly the `analytics_sync` target.
- [`config/analytics-sync.json`](config/analytics-sync.json) is the Job/pool/provider contract, including the exact public-safe `create_cron_job` argument template, private binding destinations, provider readback projection, prestate branches, disabled-canary proof, and rollback containment rules.
- [`config/analytics-model-contract.json`](config/analytics-model-contract.json) is the mutation-ready, public-safe Analytics model: three exact root folders, one complete placement for every canonical asset, five fixed physical target-table names, complete typed schemas, four derived query views, and the exact create-report payload source for all 20 dashboard widgets. Workspace, folder, and returned view IDs remain private bindings. Its fail-closed pre-render gate requires fresh authoritative Catalyst checkpoint/outbox evidence plus exact independent Analytics readback; timestamps alone cannot label either dashboard healthy or reconciled.
- [`config/dashboard-contract.json`](config/dashboard-contract.json) defines the exact internal operations and fixed-client result dashboards, their metric semantics, privacy boundary, creation order, and rollback gates.
- [`config/datastore-schema.json`](config/datastore-schema.json) is the additive v2 row contract, not a destructive provisioning script.
- [`functions/analytics_sync/catalyst-config.json`](functions/analytics_sync/catalyst-config.json) declares one Node 24 Job.
- [`RUNBOOK.md`](RUNBOOK.md) contains migration, activation, containment, readback, and rollback gates.
- [`tools/build-release-artifact.js`](tools/build-release-artifact.js) exports only the deployable project/function files from a clean exact Git revision into an isolated temporary release directory, stamps that export, verifies it, and never deploys or modifies the checkout. The export includes a self-contained `verify-artifact.js`, but excludes source tests and tools.

The general reporting boundary remains documented in the central [Retell/Catalyst/CRM/Analytics reporting runbook](../../../docs/runbooks/retell-catalyst-analytics-reporting.md) and [Zoho Analytics standard](../../../docs/zoho/standards/analytics.md). The v2 Job uses the official Zoho Analytics asynchronous `updateadd` import, import-Job polling, asynchronous export, and download APIs. These official contracts were reviewed on 2026-08-24; live Sylvara access and target metadata remain separate evidence.

## Local Verification

From `functions/analytics_sync`:

```powershell
npm ci --ignore-scripts
npm run ci
```

For an isolated export returned by the release builder, install only locked production dependencies and run the artifact-specific check instead of source CI:

```powershell
$env:APPROVED_SOURCE_REVISION = "<exact-lowercase-40-character-reviewed-revision>"
npm ci --omit=dev --ignore-scripts
npm run artifact:verify
```

The artifact check requires the explicit approved revision and compares it to the stamp exactly. It also validates the exact Catalyst Job descriptor, deployable JavaScript, package/lock binding, artifact filesystem boundaries, and installed production dependency tree. It does not require or copy the source-only tests or builder into the deployment artifact.

Tests are synthetic. Passing tests prove repository behavior only; they do not prove a Catalyst deployment, Connection scope, Analytics schema, provider response, migration, schedule, dashboard, or source/runtime parity.

The exact import targets are intentionally public names rather than private placeholders:

- `RevenueDeskAnalyticsDeploymentFacts`
- `RevenueDeskAnalyticsCallFacts`
- `RevenueDeskAnalyticsDailyMetricFacts`
- `RevenueDeskAnalyticsFinalTestResultFacts`
- `RevenueDeskAnalyticsConversionStatusFacts`

`ANALYTICS_TARGETS_JSON` must repeat those names exactly and bind only their private, unique, independently read-back `view_id` values. Configuration rejects a renamed, legacy, or duplicate target. Immediately before every import POST, the runtime uses the separate read-only Connection and the official Get View Details endpoint to verify that the configured view ID still resolves to the exact fixed table name, `Table` type, workspace ID, and organization ID. This binding is deliberately not cached; any incomplete or mismatched metadata blocks the write before write authorization is requested. Render the table, query-view, and report definitions locally with:

```powershell
node tools\render-analytics-model-contract.js
```

That renderer emits public-safe create payloads only. Its `createTable` columns remain limited to connector-supported `COLUMNNAME` and `DATATYPE`; repository-only mandatory/PII assertions never leak into the provider request. It also emits the three exact root-folder create payloads and an ID-free placement contract for all 31 canonical views. The private operator packet must resolve every folder and view ID through fresh independent readback before constructing `moveViewsToFolder`; the renderer never inserts IDs, connects to Analytics, or performs a write. Dashboard creation is not exposed by the approved Analytics Changes surface: after the reports exist and pass Audit readback, the two exact dashboards must be assembled in the signed-in Analytics console. Acceptance still requires independent readback of every table/query/report/dashboard dependency and folder membership, administrator-only access, required and locked filters, no public link, no embed, no scheduled export, and no direct customer access.

### Private Development mutation phases

Before any Analytics model write, keep one populated schema-v3 phase packet and its separate phase approval outside every Git worktree and validate them locally:

```powershell
node tools\validate-private-analytics-mutation-packet.js <absolute-private-packet-path> <absolute-private-approval-path>
```

The validator performs no network, Browser, Analytics, Catalyst, Retell, or filesystem write. It reads only the two supplied private JSON files, the package's public contracts, and the current Git revision/package status; Git inspection disables optional locks. The CLI rejects duplicate JSON object keys before parser last-key-wins behavior, rejects hard-linked private inputs, rejects an uncommitted or dirty Analytics package, rejects tracked package files hidden by `assume-unchanged` or `skip-worktree`, and requires `approvedSourceRevision` to equal the current committed `HEAD`. Every phase pins the reviewed contract and rule digests, the undisclosed organization/workspace IDs, a complete fresh post/prestate window of at most 15 minutes, a lowercase UUIDv4 operation-authorization ID, the exact operation count, and separate packet, operation-set, and consumption SHA-256 values. One phase-global provider asset-ID registry prevents a folder, table, query, report, or dashboard identity from being reused across otherwise separate inventory lists.

The scoped free-test phase is separate from the unchanged broader dashboard workflow:

- `free_test_tables` inventories exactly the five canonical tables as `existing` or `missing`, in the same table order and with the same reviewed payloads as `asset_creation`. Use `inventoryKind=fresh_free_test_tables_inventory` and null `phaseLineage`. Only missing tables become operations; a fully complete inventory authorizes no mutation. The phase explicitly excludes folder, query-table, report and dashboard creation and folder placement, in addition to the shared exclusions below. It does not consume query-table capacity or authorize a paid-plan upgrade, import, scheduled job, report publication or Retell action. Fresh plan/capacity and zero-incremental-charge evidence are still required before a separately approved live operation; validator success is not cost evidence.
- This narrow phase preserves the reviewed workspace baseline and requires a fresh complete inventory, exact empty-table readback and the same stable-authority consumption and ambiguity rules. Its phase-bound payload and packet digests cannot reuse broad-phase approval. It cannot serve as `asset_creation` lineage for dashboard assembly. The local final-results report requires neither dashboard assembly nor a query table.

The three broader phases remain deliberately independent and deferred from the table-only free-test scope:

1. `asset_creation` inventories all three folders, five tables, four query tables, and 20 reports as exact `existing` or `missing` assets. Its operations contain only the missing assets, in canonical order. A fresh continuation packet therefore omits every independently read-back asset already created.
2. `dashboard_assembly` is valid only after all three folder IDs and all 20 report IDs are concrete, unique, and evidence-bound. Its `phaseLineage` records the separately approved operator attestation to the prior `asset_creation` operation-authorization ID and packet digest, and binds that attestation to the current authoritative prestate evidence. It assembles only dashboards still missing. These are the only Browser fallback operations because the approved Analytics Changes connector has no dashboard-create capability.
3. `folder_placement` is valid only after all three folder IDs and all 31 table/query/report/dashboard view IDs are concrete. Its `phaseLineage` records the separately approved operator attestation to the prior `dashboard_assembly` operation-authorization ID and packet digest, and binds it to the same authoritative evidence as its current prestate. It captures each view's exact current/prior folder and expected destination, then authorizes at most one view per connector operation. Already placed views are omitted.

Create responses are never sufficient identity evidence. Each operation runs serially and must be independently read back before continuing. A partial result, ambiguous response, interruption, stale window, duplicate, changed identifier, or readback mismatch consumes the current authority and requires a new packet and approval derived from fresh exact inventory—never a retry or resume of the old operation set. When no prior ambiguous operation exists, the packet must say `no_prior_ambiguous_operation_attested` and the separate approval must carry the matching operator attestation; this is not mechanical history proof. After ambiguity, the fresh packet's `ambiguityResolution` must use a new authority ID and bind the prior authority ID, prior packet digest, exact action/asset/payload, and the same authoritative evidence as the current prestate, while the approval explicitly attests authoritative resolution. Creation may continue only after that evidence proves the asset absent; exact-existing resolution omits that creation. Placement may continue only after evidence proves the view remains at its exact prior folder; target-folder resolution omits that move. Any other or unresolved state remains blocked.

Production, Retell, imports, sharing, publication, deletion, rename, and legacy-asset movement are exact packet exclusions. Keep `analytics_sync` and its Cron disabled, create no rows, and leave every new asset unshared and unpublished. The connected surface has no general delete rollback, so a partially created empty asset remains contained in place pending separately approved cleanup. Only a folder move with an immediately captured exact prior folder ID may be reversed under the packet's containment rule.

The validation-only CLI emits only schema version, phase, operation counts, the domain-separated packet SHA-256, and a named `consumptionSha256`; it never emits target IDs, the private operation-authorization ID, paths, packet contents, or evidence. `declarativeSingleUse=true`, phase lineage, and prior-outcome state are approval-bound assertions, not durable replay or history proof. Safety comes from fresh complete current inventory and exact concrete dependency/readback binding; an authenticated operator and durable executor must separately verify the referenced prior records. The shared local execution boundary invokes this fixed committed validator, captures its result without relaying private output, keeps the returned authority/digest pair internal, and atomically claims that exact pair before returning only a coarse receipt. A future executor must privately pin one immutable `SYLVARA_APPROVAL_LEDGER_DIRECTORY`, one absolute `SYLVARA_APPROVAL_NODE_EXECUTABLE`, and its exact lowercase `SYLVARA_APPROVAL_NODE_EXECUTABLE_SHA256`, then invoke `python tools/safety/claim_approval_consumption.py analytics-mutation-v3 <private-packet-json> <private-approval-json>` immediately before the first mutation. The wrapper rechecks the regular single-link local executable and digest before and after validation, strips Node preload/module-path overrides, continues only on `claimed`, and rejects an existing key or digest conflict. It accepts no caller-supplied ledger path, authority ID, or digest. Do not invoke it merely to validate because a successful claim permanently consumes the approval even if no provider write follows. Neither validator nor wrapper authenticates a human approver, resists a malicious process that can modify its own code/configuration, executes an Analytics operation, proves provider behavior, or authorizes a later packet. Preserve the private prestate/readback bytes, approval record, and consumption evidence outside Git.

Before either dashboard is shown, evaluate a fresh private evidence envelope with [`tools/evaluate-dashboard-pre-render-gate.js`](tools/evaluate-dashboard-pre-render-gate.js). The envelope must cover the complete Catalyst/Analytics scope inventory, all five record types, one current `Healthy` checkpoint per scope/type, zero unresolved v2 outbox rows, zero rejected rows or checkpoint errors, non-stale checkpoint deadlines, exact source revisions/watermarks, verified target binding and partition isolation, and zero duplicate keys or payload-hash mismatches. The evaluator returns only `ready`/`blocked` plus coarse reason codes and never emits private scope values. It is an operator acceptance gate, not a runtime visibility control: until a `ready` verdict and independent access readback exist, operators must keep both dashboards unshared, unpublished, and unavailable to non-administrators. An observed `SOURCE_MODIFIED_AT` is not health evidence.

The customer Bookable Evidence and Office Follow-Up reports use the single `RevenueDeskAnalyticsOptionalEvidence` query view. Each report keeps its `*_EVIDENCE_STATE` group visible: `available` with numeric `0` is a verified zero, while `not_available` with a null measure displays **Not Available**. Removing or filtering out that discriminator is an acceptance failure.

## Official References

- [Catalyst Job Functions](https://docs.catalyst.zoho.com/en/serverless/help/functions/job-functions/)
- [Catalyst Connections](https://docs.catalyst.zoho.com/en/cloud-scale/help/connections/introduction/)
- [Zoho Analytics asynchronous import](https://www.zoho.com/analytics/api/v2/bulk-api/import-data-async.html)
- [Create import Job for an existing table](https://www.zoho.com/analytics/api/v2/bulk-api/import-data-async/create-import-job/existing-table.html)
- [Get import Job details](https://www.zoho.com/analytics/api/v2/bulk-api/import-data-async/get-import-job.html)
- [Zoho Analytics asynchronous export](https://www.zoho.com/analytics/api/v2/bulk-api/export-data-async.html)
- [Get view details](https://www.zoho.com/analytics/api/v2/metadata-api/view-details.html)
- [Create table](https://www.zoho.com/analytics/api/v2/modeling-api/create-table.html)
- [Create query table](https://www.zoho.com/analytics/api/v2/modeling-api/create-query-table.html)
- [Create report](https://www.zoho.com/analytics/api/v2/modeling-api/create-report.html)
