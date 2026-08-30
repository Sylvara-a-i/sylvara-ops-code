# Revenue Desk Analytics Sync Runbook

## Authority And Current State

This runbook is repository guidance. It does not authorize a Catalyst deployment, Analytics import, Connection change, schedule, table mutation, dashboard publication, Production change, or deletion.

Keep `ANALYTICS_SYNC_MODE=disabled` until the full gate below passes. The 2026-08-24 readback established the retained row counts: `AnalyticsSyncOutbox=307`, `AnalyticsSyncCheckpoints=10`, `ClientDailyMetrics=10`, `ReportRuns=1`, `Calls=13`, and `FreeTestCalls=30`. Packet A then proved the exact required checkpoint application columns, the outbox's 71-column count, and the nullable-unique `OUTBOX_KEY` contract without rewriting a retained row; that historical packet did not prove the full outbox application schema. A later 2026-08-28 connector-first read-only preflight proved that the current repository-required application-schema projections for both tables match exactly while preserving the documented additive legacy columns. Fresh activation-time drift readback, retained-row semantics, producer/consumer lineage, normalized keys, target matches, and watermarks remain mandatory before activation.

## Blocking Live-Source Parity Gate

Before replacing the current function:

1. Export its source into an approved private location without printing it into a task, terminal log, CI log, or public Git object.
2. Sanitize only structure and original Sylvara decisions that are safe for Git.
3. Complete every row in [`config/live-source-parity.json`](config/live-source-parity.json).
4. Preserve or explicitly rehome the live daily-rollup, mapping, checkpoint, synthetic-guard, confirmation, reconciliation, watermark, CSV/hash/time, and safe-log behavior.
5. Run old-versus-new differential fixtures. A thinner candidate is not an acceptable replacement merely because its isolated tests pass.

If the live source cannot be exported or a behavior cannot be classified, stop with the current function disabled or unchanged. Do not infer behavior from module names.

## Additive v2 Migration Gate

1. Read the exact Development project and environment identity through the least-sensitive path.
2. Read both Analytics table schemas, constraints, encrypted-text audit consent, permissions, counts, and current producer/consumer references.
3. Record source counts by environment and a deterministic normalized-key digest. The private evidence must state the normalization algorithm and stable key set.
4. Add only compatible physically nullable columns required by [`config/datastore-schema.json`](config/datastore-schema.json). Never recreate, truncate, rename, or delete a nonempty table. Use `SYNC_STATUS` for v2 outbox state; do not add `STATUS`, which collides case-insensitively with live v1 `Status`. Add provider-enforced nullable unique constraints on `CHECKPOINT_KEY` and `OUTBOX_KEY`; application-side preflight queries are not a concurrency boundary.
5. Prove Catalyst permits those unique nullable columns while preserving multiple legacy nulls. For every retained v2 row, normalize all accepted UTC timestamps with `new Date(value).toISOString()`, recompute the reviewed single-key `OUTBOX_KEY` and `PAYLOAD_HASH`, and compare counts/digests before activation. Block on more than one row for an `OUTBOX_KEY`, one provider identity mapped to a different key, or one key and identity bound to a different payload hash or immutable ownership. Confirm legacy rows retain a null or non-v2 `ROW_SCHEMA_VERSION` and that the Job query selects only version 2.
6. Write a bounded synthetic v2 fixture through the approved worker path. Read its immutable payload hash and ownership columns back before invoking this Job.
7. Reconcile source count, normalized-key count/digest, immutable fact hashes, Analytics accepted/rejected counts, exact target readback rows, and watermarks.
8. Rehearse containment and rollback while the old source and rows remain recoverable.

Any mismatch blocks activation. Do not “fix” an ambiguous legacy row in place.

## Development Configuration

1. Select the exact final reviewed `main` commit. From a clean checkout, set `APPROVED_SOURCE_REVISION` to that lowercase 40-character revision and run `node tools/build-release-artifact.js`. The builder must return an isolated temporary `projectRoot` and manifest; it never deploys or stamps the checkout.
2. In the exported `projectRoot/functions/analytics_sync`, explicitly set `APPROVED_SOURCE_REVISION` again to that exact lowercase 40-character revision, run `npm ci --omit=dev --ignore-scripts`, and then run `npm run artifact:verify`. The release-only check requires that explicit approval input, compares it to the stamped source exactly, and validates the target descriptor, deployable JavaScript, package/lock binding, artifact boundaries, and installed production dependency tree without requiring the intentionally excluded source tests or builder. Verify the manifest and stamped source readback, and deploy only from that isolated export. Remove the temporary artifact after independent deployment readback.
3. Create or verify one private Function Job target named `analytics_sync` in the shared Revenue Desk project.
4. Create or verify the `RevenueDeskAnalyticsJobs` Function Job pool. Disable platform retries; the package owns durable retries.
5. Classify Development Cron prestate as absent, exact, drifted, or duplicate only after satisfying the complete-inventory gates in [`config/analytics-sync.json`](config/analytics-sync.json). An empty list is never absence until fresh proof establishes the response as one complete untruncated array, validates every item ID/name/execution-type/status, resolves pagination behavior, and excludes same-name collisions across execution types outside the documented pre-defined-only inventory. Before any create, also prove the fresh `Sylvara Catalyst Audit` singular Cron response shape: provider readback uses nested `cron_detail` with numeric schedule values, `target_details`, `jobpool_details`, and a numeric retry count rather than the create-request strings and flat request fields. Normalize only the documented fields through the tested projection and stop if any path, type, or lossless private ID is unavailable. For absent prestate only after those proofs, use the named `Sylvara Catalyst Changes` `create_cron_job` tool with the exact materialized argument template: `cron_execution_type=pre-defined`, `cron_type=Periodic`, `cron_status=false`, string schedule values `hour=0`, `minute=1`, `second=0`, `repetition_type=every`, and Job `RevenueAnalyticsSync` from source type `Cron` to target `analytics_sync` through `RevenueDeskAnalyticsJobs`, with `{}` parameters and `number_of_retries="0"`. Resolve organization, project, pool, and function IDs only from fresh private readback. Require the normalized exact disabled projection after create. Do not activate it in the provisioning packet.
6. Bind separate least-privilege Analytics read and write Connections. Each Connection must expose exactly one OAuth `Authorization` header and no query parameters.
7. Render [`config/analytics-model-contract.json`](config/analytics-model-contract.json) with `node tools/render-analytics-model-contract.js`. Build a schema-v3 `asset_creation` packet from complete fresh existing/missing inventory and a separate approval. Create or uniquely verify only the exact root folders `Revenue Desk - Data Model`, `Revenue Desk - Operations`, and `Revenue Desk - Customer Results`; keep `makeDefaultFolder=false` and omit `parentFolderId`. Stop on duplicate exact names, a non-root same-name folder, access ambiguity, or unexpected existing membership. The Changes connector has no folder-delete operation, so a partial empty folder is containment evidence rather than implicit cleanup authority.
8. In the exact Development workspace, create only the five absent fixed target names and their complete connector-compatible schemas. The connected `createTable` contract accepts only column name and type; `MANDATORY` and `PII` remain source-validation and classification rules and must not be sent or claimed as provider-enforced metadata. Stop on a same-name asset, unexpected column, type mismatch, existing share, or nonzero target row count. Independently read back and privately bind each returned view ID; never commit an organization, workspace, folder, table, query-view, report, or dashboard ID.
9. Create the four exact derived query views from the rendered SQL, then create every exact report payload still listed by the same `asset_creation` packet. Read back names, base views, report types, chart types, axes/operations, filters, user filters, and dependencies after every operation. A success response is not sufficient. The optional-evidence view must preserve `available` versus `not_available` state so a verified numeric zero cannot collapse into missing evidence. Any partial or ambiguous result stops the phase; build a new packet from fresh exact inventory so already created assets are omitted. A post-ambiguity packet must bind the prior packet digest, exact operation fingerprint, and its current authoritative evidence; it may classify the target only as proven absent or exact existing. Do not place any view until both dashboards exist and the separate placement phase has fresh concrete IDs.
10. Configure every variable in [`functions/analytics_sync/.env.example`](functions/analytics_sync/.env.example) privately. Use lowercase `DEPLOYMENT_ENVIRONMENT`, replace every placeholder, preserve the five fixed public table names inside `ANALYTICS_TARGETS_JSON`, insert only their independently read-back private view IDs, and set `SOURCE_REVISION` to the exact stamped revision plus the reviewed migration-evidence digest.
11. Leave the mode `disabled`, deploy only the exact `analytics_sync` target, and independently read the deployed source identity back.
12. Before requesting a canary approval, prove the exact Audit Job response shape and a lossless Job-to-execution-ID correlation. The documented Job response provides `job_id`, `job_status`, and `job_meta_details`, but no execution-ID field; a time-window or unscoped log search is not an acceptable substitute. If exact correlation is unavailable, the canary remains blocked. Under a separate exact canary approval only after that gate, manually submit the disabled Cron once with the exact headers, Cron/project path IDs, and same Job metadata. Require terminal `job_status=SUCCESS`, normalized exact Job metadata, and the `analytics_sync_disabled` event from an application-log query scoped to the proven exact execution ID. Keep the mode and Cron disabled. Treat no SDK, Data Store, Connection, or Analytics I/O as an inference from exact deployed-archive parity plus the reviewed disabled code path, not as direct provider I/O telemetry.
13. Move to `readiness`; run once and verify exactly two additive v2 Catalyst table contracts with zero Analytics calls.
14. Move to `active` only after live-source parity and additive migration acceptance. Submit one synthetic partition and drive its durable states across separate Job executions; activate the Cron only through a separate exact packet after this manual acceptance passes.

## Report And Dashboard Assembly Gate

The Changes connector may create tables, query views, formulas, folders, and reports, but it does not assemble dashboards. Use the browser only after those connector operations and Audit readbacks are exhausted.

1. Verify all three folder IDs and all 20 rendered report IDs exist once and match [`config/analytics-model-contract.json`](config/analytics-model-contract.json) exactly. Build and separately approve a fresh schema-v3 `dashboard_assembly` packet that binds those concrete dependencies and current authoritative evidence plus an approval-bound operator attestation to the prior asset-creation operation-authorization ID and packet digest. The validator does not independently prove that history; verify the referenced private record before execution. List only dashboards still missing.
2. Assemble the exact titles `Free-Test Operations Dashboard` and `Customer Results Dashboard` in the signed-in Analytics console. Do not create a workspace or duplicate a report. Stop after each operation for independent readback; a partial or ambiguous result requires a new packet from fresh exact inventory.
3. After both dashboards pass readback, build and separately approve a fresh schema-v3 `folder_placement` packet. It must bind current authoritative evidence, all three destination folder IDs, all 31 canonical view IDs including both dashboards, every view's exact current/prior folder ID, and an approval-bound operator attestation to the prior dashboard-assembly authority ID and packet digest. Verify that private prior record independently. Use `moveViewsToFolder` for one canonical view per operation, omit views already in the correct folder, and verify membership after each move. An ambiguous move requires a new authority ID plus a fresh resolution binding and matching approval attestation to the prior authority and packet that proves the view is at its exact prior or target folder. Do not move a dashboard through the browser when the connector operation is available.
4. On the operations dashboard, lock hidden `ENVIRONMENT=development` and `ENGAGEMENT_TYPE=free_test`, keep optional client/deployment selectors, and lock `Tests Ending Soon` to the next 48 hours.
5. Before any customer-result render, bind exactly one opaque `CLIENT_KEY` and one opaque `DEPLOYMENT_KEY`; keep both controls hidden and locked.
6. With an independent Audit identity, read back dashboard dependencies, access, shares, public/private links, embeds, export schedules, direct-user access, and exact folder membership. Require administrator-only workspace access, no public link, no embed, no scheduled export, and no direct customer access.
7. Build the private pre-render evidence envelope from fresh Catalyst checkpoint/outbox reads and independent Analytics reads for the complete included scope inventory. Keep both JSON files outside every Git working tree and run `node tools/evaluate-dashboard-pre-render-gate.js --evidence <absolute-private-evidence.json> --approval <absolute-private-approval.json>` from this component root. The command emits only the coarse verdict and reason codes, exits nonzero when blocked or invalid, and never prints a private payload or path. Require `ready`; missing evidence, timestamp-only evidence, a non-`Healthy` checkpoint, any checkpoint error/rejection, any unresolved v2 outbox row, a stale checkpoint deadline, scope omission/duplication, unverified binding/isolation, a duplicate key, a payload-hash mismatch, or a revision/watermark mismatch blocks operator acceptance. The evaluator does not change Analytics visibility. Until the verdict is `ready` and access readback passes, keep both dashboards unshared, unpublished, and unavailable to non-administrators. The Data Freshness report may show observed watermarks but must never emit or imply `Healthy` itself.
8. Run a synthetic two-client isolation test. Each fixed-client render must contain one client and one deployment; a missing/stale record type, unresolved checkpoint, incomplete evidence flag, null mandatory measure, or cross-partition row blocks operator acceptance and publication authorization.
9. Exercise both nullable customer widgets with two fixtures: analysis evidence complete plus explicit numeric zero must render `available` and `0`; missing/incomplete evidence must render `not_available` and **Not Available**. The state group must remain visible and unfiltered.

Browser assembly and visual inspection do not prove the data model. Preserve screenshots and returned IDs only in the approved private evidence package; commit only sanitized pass/fail readback.

## Synthetic Acceptance

Acceptance must cover:

- concurrent exact duplicate outbox creation converges on one provider-version-fenced `OUTBOX_KEY`, while a changed payload at the same provider identity and normalized source watermark is rejected before provider submission;
- a duplicate or swapped private target view ID, wrong table name/type, wrong workspace, wrong organization, or incomplete Get View Details response is rejected before write authorization or an import POST;
- raw names, phone/email fields, transcripts, audio/recording references, URLs, tokens, secrets, arbitrary nested JSON, and unknown fields are rejected;
- no cross-environment, cross-client, cross-deployment, or mixed-record-type batch;
- concurrent claim loses cleanly and fencing prevents a stale claimant from updating;
- a process loss after `Submitting` with no provider Job ID enters reconciliation rather than resubmission;
- bounded retry delays and terminal exhaustion;
- import pending, error, missing/expired, complete, rejected-row, and count-mismatch behavior;
- readback pending, error, missing/expired, duplicate, missing, extra, cross-partition, hash, and watermark mismatch behavior;
- an older unresolved row prevents checkpoint advancement;
- checkpoint update is monotonic and resumes safely after partial completion;
- timestamp-only dashboard evidence is blocked, and only a complete authoritative checkpoint/outbox plus exact Analytics readback envelope can return a ready pre-render verdict;
- optional bookable and office-follow-up evidence distinguishes a verified zero from missing evidence after report aggregation;
- Development readiness never calls Analytics;
- Production `disabled` and `readiness` never initialize the SDK or touch Data Store, Connections, or Analytics;
- caller-selected Job params are rejected; and
- logs contain only coarse state/count/revision fields.

## Readback And Completion

An import is not complete when the HTTP request succeeds. Keep every row nonterminal until:

1. an async import Job ID is durably stored;
2. official Job status is `1004` complete;
3. total and accepted rows equal the claimed batch and rejected rows equal zero;
4. a separate read Connection exports the exact record/client/deployment/environment keys, payload hashes, and source watermarks;
5. the returned set equals the expected set exactly;
6. no older unresolved row exists in the partition; and
7. the version-fenced checkpoint advances monotonically.

Official Job codes `1001` and `1002` remain pending; `1003` is an import failure; `1005`, an unknown code, an expired summary, or an ambiguous response requires reconciliation. Import summaries are short-lived, so polling is bounded and durable rather than an unbounded in-process wait.

## Containment And Rollback

Containment:

1. Set `ANALYTICS_SYNC_MODE=disabled` and independently read back the exact function configuration before changing a Cron.
2. Disable a `RevenueAnalytics1m` match and independently read back `cron_status=false` only when the safe status shape is proven. Otherwise retain mode disabled, record Cron containment unproven, and stop before another mutation.
3. Accept a Job execution ID only from a shape-proven manual-submit `data.job_id` or a separately proven provider-complete Cron execution-history field. Cron create/resource `data.id`, `cron_detail.jobId`, and Job metadata/pool/target/function IDs are not execution IDs. Read every proven Job ID to a terminal state. If the surface cannot prove complete execution inventory, keep containment in place and treat the drain as unproven.
4. Preserve outbox, checkpoint, daily metric, report-run, legacy call, and canonical call rows.
5. Revoke or disconnect the write Connection only after confirming no other approved dependency uses it.
6. Record the last source count, normalized-key digest, provider Job IDs, target count, watermark, and unresolved state privately.

The Changes connector currently advertises a complete Cron body for `update_cron_job_status`, while the provider status-only operation is narrower. Prove the connector's accepted status shape without a mutation before using it. The full-body templates are not execution-ready until read-only evidence proves status-only/nonreplacement semantics and the closed-world policy accounts for every advertised schedule, end, notify, request, header, URL, retry, identity, and metadata field. Canonical-absent fields must be literally absent; nulls, empty values, defaults, unknown fields, and unproven absence fail closed. Never apply a full-body template to a drifted or duplicate Cron. If a safe status-only shape is unavailable, retain `ANALYTICS_SYNC_MODE=disabled`, mark disabled-Cron containment unproven, and stop; do not substitute browser control or an untyped write.

Prestate handling is exact and fail closed:

- **Absent:** create the exact disabled contract once, then independently read back every provider field.
- **Exact:** perform no write; preserve the one exact Cron disabled and repeat the readback.
- **Drifted:** contain mode first; disable and read back the one match only with a proven safe status shape. Otherwise record Cron containment unproven. Drain only proven Job IDs, preserve the predecessor definition privately, and stop for a fresh remediation packet.
- **Duplicate:** contain mode first; disable and read back every match only with a proven safe status shape. Otherwise record Cron containment unproven. Drain only proven Job IDs, preserve every definition privately, and stop without selecting or deleting a winner.

Rollback begins with mode-first containment, disabled-Cron readback only when the safe status shape is proven, and drain of only proven Job IDs. Preserve a preexisting exact Cron. A Cron created from absent prestate may be deleted only when a fresh live packet explicitly authorizes conditional rollback deletion of that exact created Cron ID; otherwise preserve it disabled. Deletion permanently destroys the Cron and associated execution history, so first preserve required sanitized private evidence and prove provider-complete terminal drain. After a delete, prove both complete name/ID inventory absence and the shape-proven get-by-ID not-found result. An ambiguous delete is never retried: retain mode containment, repeat both readbacks, and stop for fresh authority. Drifted, duplicate, and ambiguous-create states authorize no update, consolidation, retry, or deletion. Repository instructions alone never authorize deletion.

Source rollback is a reviewed redeploy of the previously proven source plus independent source/runtime and table readback. Do not roll back by truncating Analytics, deleting Catalyst rows, decrementing a checkpoint, or replaying an ambiguous submission.

Production remains dark regardless of a configured `readiness` label. A dark Production artifact requires only the lowercase environment, mode, exact stamped source revision, project ID, Job-pool ID, and the native title-case Catalyst environment identity. It requires no table, Connection, SDK initialization, or provider setup. Production enablement requires a separate reviewed code change, independent credentials and target tables, a fresh parity/migration package, and explicit approval.
