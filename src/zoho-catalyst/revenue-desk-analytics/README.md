# Revenue Desk Analytics Sync

`analytics_sync` is the one private Zoho Catalyst Job target for Revenue Desk-to-Zoho Analytics synchronization. It has no HTTP route, accepts no caller-selected Job parameters, and targets the shared Revenue Desk Catalyst project through the dedicated `RevenueDeskAnalyticsJobs` Function Job pool.

## Status

- Repository candidate: **implemented and synthetic-testable**
- Live replacement authorization: **blocked**
- Development activation: **blocked pending private fixture differential results, immutable function deployment/readback, Connection and Analytics target proof, version-2 write/readback, Job binding, and migration reconciliation**
- Production: **dark only**; `disabled` and `readiness` both return `DarkNoOp` before SDK initialization, Data Store access, Connection access, or Analytics access

Production dark startup requires only lowercase `DEPLOYMENT_ENVIRONMENT`, the mode, the source revision, and Catalyst project/Job-pool identity. It maps `production` to the native `X_ZOHO_CATALYST_ENVIRONMENT=Production` identity and returns before parsing any table, retry, timeout, Connection, organization, workspace, target, or regional-host setting. No Data Store schema, SDK initialization, Connection, or provider setup is a prerequisite for that return.

A 2026-08-24 Development readback found 307 existing `AnalyticsSyncOutbox` rows and 10 existing `AnalyticsSyncCheckpoints` rows. It also found 10 `ClientDailyMetrics`, one `ReportRuns`, 13 `Calls`, and 30 `FreeTestCalls` rows. Those stores are durable evidence, not empty scaffolding. This package never claims a legacy row, and this repository change authorizes no deletion, truncation, rename, backfill, or live write.

The superseding 2026-08-26 Packet A resolution kept the current table count at 35. Exact readback found 307 legacy outbox rows, zero version-2 outbox rows, zero nonnull `OUTBOX_KEY` rows, and the required nullable-unique single-key contract; it also found 10 legacy checkpoint rows, zero version-2 checkpoint rows, and the exact checkpoint schema. `RevenueDeskAnalyticsJobs` now exists as a 512 MB Function Job pool but remains unbound and has no Cron reference. No function, route, record, Retell, or Production state changed. See [ADR 0008](../../../docs/adr/0008-single-key-analytics-outbox-fence.md) and the sanitized [Packet A resolution evidence](../evidence/free-revenue-leak-test-development-packet-a-resolution-2026-08-26.json).

The current live `analytics_sync` source is structurally present and substantially broader than the prior public inventory indicated. All 15 live modules and the live synthetic-test surface were captured and reviewed privately on 2026-08-25; no raw code, private configuration, identifiers, endpoints, or payloads were emitted to this public repository. [`config/live-source-parity.json`](config/live-source-parity.json) records the behavior map, existing Analytics workspace/table evidence, and remaining fixture, binding, schema, and reconciliation gates. Do not deploy this candidate over that function until every blocking row is resolved.

## Boundary

The canonical call-runtime producer creates immutable minimized v2 call/deployment facts and emits `final_test_result` only after terminal report reconciliation. The CRM/Billing orchestrator emits `conversion_status` only after accepted-state Billing and CRM readback plus durable operation completion. `ENGAGEMENT_TYPE` always means the engagement that originated the evidence and therefore remains the immutable dashboard partition. A free-test conversion emits `ENGAGEMENT_TYPE=free_test` and separately emits `TARGET_ENGAGEMENT_TYPE=paid_service`; paid acceptance never moves the historical row out of the Free-Test Operations Dashboard. Because Catalyst functions package independently, each producer keeps a bounded package-local encoder/store adapter and tests byte-for-byte parity against this package's canonical fact implementation. They share only the dedicated private Analytics partition HMAC value, not broader runtime or idempotency secrets. The provider-unique `OUTBOX_KEY` is the single atomic fence over record type, provider match identity, and normalized `SOURCE_MODIFIED_AT`; `PAYLOAD_HASH` independently binds the full immutable canonical payload. All accepted UTC timestamp fields are normalized with `new Date(value).toISOString()` before payload or key construction, so whole-second and millisecond spellings converge. Concurrent exact replays converge, same-watermark payload conflicts fail closed, and later corrections receive a new key. The additive v2 state column is `SYNC_STATUS`, not `STATUS`, because the existing v1 outbox has a camel-case `Status` column and Catalyst column identity must be treated case-insensitively for provisioning safety. Every v2 column is physically nullable so the 307 legacy outbox rows and 10 legacy checkpoint rows remain untouched; `required_for_v2_rows` plus runtime validation enforce the v2 contract. Schema and single-key compatibility are proven. Activation remains blocked until immutable producers and the consumer are deployed inertly, exact version-2 write/readback and concurrency pass, legacy exclusion is reconfirmed, and private bindings and migration reconciliation are complete. `analytics_sync` reads and mutates only:

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
- [`config/analytics-sync.json`](config/analytics-sync.json) is the Job/pool/provider contract.
- [`config/analytics-model-contract.json`](config/analytics-model-contract.json) is the mutation-ready, public-safe Analytics model: five fixed physical target-table names, complete typed schemas, four derived query views, and the exact create-report payload source for all 20 dashboard widgets. Workspace and returned view IDs remain private bindings. Its fail-closed pre-render gate requires fresh authoritative Catalyst checkpoint/outbox evidence plus exact independent Analytics readback; timestamps alone cannot label either dashboard healthy or reconciled.
- [`config/dashboard-contract.json`](config/dashboard-contract.json) defines the exact internal operations and fixed-client result dashboards, their metric semantics, privacy boundary, creation order, and rollback gates.
- [`config/datastore-schema.json`](config/datastore-schema.json) is the additive v2 row contract, not a destructive provisioning script.
- [`functions/analytics_sync/catalyst-config.json`](functions/analytics_sync/catalyst-config.json) declares one Node 18 Job.
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

That renderer emits public-safe create payloads only. Its `createTable` columns remain limited to connector-supported `COLUMNNAME` and `DATATYPE`; repository-only mandatory/PII assertions never leak into the provider request. It does not connect to Analytics, insert IDs, or perform a write. Dashboard creation is not exposed by the approved Analytics Changes surface: after the reports exist and pass Audit readback, the two exact dashboards must be assembled in the signed-in Analytics console. Acceptance still requires independent readback of every table/query/report/dashboard dependency, administrator-only access, required and locked filters, no public link, no embed, no scheduled export, and no direct customer access.

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
