# Revenue Desk Analytics Sync

`analytics_sync` is the one private Zoho Catalyst Job target for Revenue Desk-to-Zoho Analytics synchronization. It has no HTTP route, accepts no caller-selected Job parameters, and targets the shared Revenue Desk Catalyst project through the dedicated `RevenueDeskAnalyticsJobs` Function Job pool.

## Status

- Repository candidate: **implemented and synthetic-testable**
- Live replacement authorization: **blocked**
- Development activation: **blocked pending private fixture differential results, additive schema readback, live binding proof, and migration reconciliation**
- Production: **dark only**; `disabled` and `readiness` both return `DarkNoOp` before SDK initialization, Data Store access, Connection access, or Analytics access

Production dark startup requires only lowercase `DEPLOYMENT_ENVIRONMENT`, the mode, the source revision, and Catalyst project/Job-pool identity. It maps `production` to the native `X_ZOHO_CATALYST_ENVIRONMENT=Production` identity and returns before parsing any table, retry, timeout, Connection, organization, workspace, target, or regional-host setting. No Data Store schema, SDK initialization, Connection, or provider setup is a prerequisite for that return.

A 2026-08-24 Development readback found 307 existing `AnalyticsSyncOutbox` rows and 10 existing `AnalyticsSyncCheckpoints` rows. It also found 10 `ClientDailyMetrics`, one `ReportRuns`, 13 `Calls`, and 30 `FreeTestCalls` rows. Those stores are durable evidence, not empty scaffolding. This package never claims a legacy row, and this repository change authorizes no deletion, truncation, rename, backfill, or live write.

The current live `analytics_sync` source is structurally present and substantially broader than the prior public inventory indicated. All 15 live modules and the live synthetic-test surface were captured and reviewed privately on 2026-08-25; no raw code, private configuration, identifiers, endpoints, or payloads were emitted to this public repository. [`config/live-source-parity.json`](config/live-source-parity.json) records the behavior map, existing Analytics workspace/table evidence, and remaining fixture, binding, schema, and reconciliation gates. Do not deploy this candidate over that function until every blocking row is resolved.

## Boundary

The canonical call-runtime producer creates immutable minimized v2 call/deployment facts and emits `final_test_result` only after terminal report reconciliation. The CRM/Billing orchestrator emits `conversion_status` only after accepted-state Billing and CRM readback plus durable operation completion. `ENGAGEMENT_TYPE` always means the engagement that originated the evidence and therefore remains the immutable dashboard partition. A free-test conversion emits `ENGAGEMENT_TYPE=free_test` and separately emits `TARGET_ENGAGEMENT_TYPE=paid_service`; paid acceptance never moves the historical row out of the Free-Test Operations Dashboard. Because Catalyst functions package independently, each producer keeps a bounded package-local encoder/store adapter and tests byte-for-byte parity against this package's canonical fact implementation. They share only the dedicated private Analytics partition HMAC value, not broader runtime or idempotency secrets. A provider-unique `PROVIDER_VERSION_KEY` atomically binds the provider match identity plus `SOURCE_MODIFIED_AT` to exactly one payload; concurrent exact replays converge and same-watermark payload conflicts fail closed. The additive v2 state column is `SYNC_STATUS`, not `STATUS`, because the existing v1 outbox has a camel-case `Status` column and Catalyst column identity must be treated case-insensitively for provisioning safety. Every proposed v2 column is physically nullable so the 307 legacy outbox rows and 10 legacy checkpoint rows remain untouched; `required_for_v2_rows` plus runtime validation enforce the v2 contract. Activation remains blocked until the new columns and provider-enforced nullable unique constraints are independently read back and proven to permit multiple legacy nulls. `analytics_sync` reads and mutates only:

- `AnalyticsSyncOutbox`
- `AnalyticsSyncCheckpoints`

It does not read raw Retell payloads, audio, transcripts, phone numbers, personal email addresses, names, CRM records, Billing records, or secrets. Each fact is a strict flat allowlist containing opaque SHA-256 client/deployment/call partitions, source and metric versions, bounded classifications, counts, and UTC watermarks. Unknown fields fail closed.

The Job processes one bounded client/deployment/record-type partition at a time. It uses an additive `ROW_SCHEMA_VERSION=2` lane, deterministic payload and outbox hashes, durable lease tokens, monotonically increasing fence versions, bounded submit attempts, bounded import/readback polling, exact import counts, and an independent exact key/hash/environment readback before checkpoint advancement. Unknown submission outcomes, missing provider jobs, expired summaries, count mismatches, readback mismatches, and checkpoint gaps enter `ReconciliationRequired`; they are never blindly replayed.

[`lib/daily-rollup.js`](functions/analytics_sync/lib/daily-rollup.js) provides the canonical pure v2 UTC-day rollup: it deduplicates replayed calls, applies only the newest correction, rejects same-watermark conflicts and mixed partitions/dates, counts only handled calls, and withholds incomplete structured evidence instead of converting it to zero. After a call batch passes provider readback and checkpointing, the Job queries one bounded partition/date through the immutable non-PII `SOURCE_DATE_UTC`, deterministically inserts or confirms its daily-metric outbox row, and only then completes the call row. Differential parity with the private live rollup and additive live-column readback remain activation blockers.

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

## Official References

- [Catalyst Job Functions](https://docs.catalyst.zoho.com/en/serverless/help/functions/job-functions/)
- [Catalyst Connections](https://docs.catalyst.zoho.com/en/cloud-scale/help/connections/introduction/)
- [Zoho Analytics asynchronous import](https://www.zoho.com/analytics/api/v2/bulk-api/import-data-async.html)
- [Create import Job for an existing table](https://www.zoho.com/analytics/api/v2/bulk-api/import-data-async/create-import-job/existing-table.html)
- [Get import Job details](https://www.zoho.com/analytics/api/v2/bulk-api/import-data-async/get-import-job.html)
- [Zoho Analytics asynchronous export](https://www.zoho.com/analytics/api/v2/bulk-api/export-data-async.html)
