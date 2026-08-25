# Revenue Desk Analytics Sync Runbook

## Authority And Current State

This runbook is repository guidance. It does not authorize a Catalyst deployment, Analytics import, Connection change, schedule, table mutation, dashboard publication, Production change, or deletion.

Keep `ANALYTICS_SYNC_MODE=disabled` until the full gate below passes. The 2026-08-24 readback established only current row counts: `AnalyticsSyncOutbox=307`, `AnalyticsSyncCheckpoints=10`, `ClientDailyMetrics=10`, `ReportRuns=1`, `Calls=13`, and `FreeTestCalls=30`. Current columns, row semantics, producer/consumer lineage, normalized keys, target matches, and watermarks still require private readback.

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
4. Add only compatible physically nullable columns required by [`config/datastore-schema.json`](config/datastore-schema.json). Never recreate, truncate, rename, or delete a nonempty table. Use `SYNC_STATUS` for v2 outbox state; do not add `STATUS`, which collides case-insensitively with live v1 `Status`. Add provider-enforced nullable unique constraints on `CHECKPOINT_KEY`, `OUTBOX_KEY`, and `PROVIDER_VERSION_KEY`; application-side preflight queries are not a concurrency boundary.
5. Prove Catalyst permits those unique nullable columns while preserving multiple legacy nulls. Backfill `PROVIDER_VERSION_KEY` for every retained v2 row using the reviewed domain and provider identity columns. Read every added column and constraint back, compare key counts/digests, and block activation on any duplicate key with a different outbox key or payload hash. Confirm legacy rows retain a null or non-v2 `ROW_SCHEMA_VERSION` and that the Job query selects only version 2.
6. Write a bounded synthetic v2 fixture through the approved worker path. Read its immutable payload hash and ownership columns back before invoking this Job.
7. Reconcile source count, normalized-key count/digest, immutable fact hashes, Analytics accepted/rejected counts, exact target readback rows, and watermarks.
8. Rehearse containment and rollback while the old source and rows remain recoverable.

Any mismatch blocks activation. Do not “fix” an ambiguous legacy row in place.

## Development Configuration

1. Select the exact final reviewed `main` commit. From a clean checkout, set `APPROVED_SOURCE_REVISION` to that lowercase 40-character revision and run `node tools/build-release-artifact.js`. The builder must return an isolated temporary `projectRoot` and manifest; it never deploys or stamps the checkout.
2. In the exported `projectRoot/functions/analytics_sync`, explicitly set `APPROVED_SOURCE_REVISION` again to that exact lowercase 40-character revision, run `npm ci --omit=dev --ignore-scripts`, and then run `npm run artifact:verify`. The release-only check requires that explicit approval input, compares it to the stamped source exactly, and validates the target descriptor, deployable JavaScript, package/lock binding, artifact boundaries, and installed production dependency tree without requiring the intentionally excluded source tests or builder. Verify the manifest and stamped source readback, and deploy only from that isolated export. Remove the temporary artifact after independent deployment readback.
3. Create or verify one private Function Job target named `analytics_sync` in the shared Revenue Desk project.
4. Create or verify the `RevenueDeskAnalyticsJobs` Function Job pool. Disable platform retries; the package owns durable retries.
5. Bind separate least-privilege Analytics read and write Connections. Each Connection must expose exactly one OAuth `Authorization` header and no query parameters.
6. Configure every variable in [`functions/analytics_sync/.env.example`](functions/analytics_sync/.env.example) privately. Use lowercase `DEPLOYMENT_ENVIRONMENT`, replace every placeholder, and set `SOURCE_REVISION` to the exact stamped revision plus the reviewed migration-evidence digest.
7. Leave the mode `disabled`, deploy only the exact `analytics_sync` target, and independently read the deployed source identity back.
8. Move to `readiness`; run once and verify exactly two additive v2 table contracts with zero Analytics calls.
9. Move to `active` only after live-source parity and additive migration acceptance. Submit one synthetic partition and drive its durable states across separate Job executions.

## Synthetic Acceptance

Acceptance must cover:

- concurrent exact duplicate outbox creation converges on one provider-version key, while a changed payload at the same provider identity and source watermark is rejected before provider submission;
- raw names, phone/email fields, transcripts, audio/recording references, URLs, tokens, secrets, arbitrary nested JSON, and unknown fields are rejected;
- no cross-environment, cross-client, cross-deployment, or mixed-record-type batch;
- concurrent claim loses cleanly and fencing prevents a stale claimant from updating;
- a process loss after `Submitting` with no provider Job ID enters reconciliation rather than resubmission;
- bounded retry delays and terminal exhaustion;
- import pending, error, missing/expired, complete, rejected-row, and count-mismatch behavior;
- readback pending, error, missing/expired, duplicate, missing, extra, cross-partition, hash, and watermark mismatch behavior;
- an older unresolved row prevents checkpoint advancement;
- checkpoint update is monotonic and resumes safely after partial completion;
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

1. Set the mode to `disabled`.
2. Disable the Cron or other Job submitter.
3. Preserve outbox, checkpoint, daily metric, report-run, legacy call, and canonical call rows.
4. Revoke or disconnect the write Connection only after confirming no other approved dependency uses it.
5. Record the last source count, normalized-key digest, provider Job IDs, target count, watermark, and unresolved state privately.

Rollback is a reviewed redeploy of the previously proven source plus independent source/runtime and table readback. Do not roll back by truncating Analytics, deleting Catalyst rows, decrementing a checkpoint, or replaying an ambiguous submission.

Production remains dark regardless of a configured `readiness` label. A dark Production artifact requires only the lowercase environment, mode, exact stamped source revision, project ID, Job-pool ID, and the native title-case Catalyst environment identity. It requires no table, Connection, SDK initialization, or provider setup. Production enablement requires a separate reviewed code change, independent credentials and target tables, a fresh parity/migration package, and explicit approval.
