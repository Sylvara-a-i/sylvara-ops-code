# Revenue Desk Call Runtime

Status: **the immutable source candidate now contains gateway, worker, and private Development route-control targets. Route control implements separate approval, activation, and rollback operations, provider-bounded version/state CAS with exact readback and audit recovery, CRM Blueprint readback, provider ownership verification, and telephony-disabled installation. It is not yet installed or read back. Historical Development parity for gateway and worker revision 288a93c remains valid only within its recorded scope; it does not prove the new target or current release. Production and live traffic remain dark.**

The complete visible `All Time` Jobs UI result, with `All Status` selected, displayed 15 rows, no pagination controls, and zero references to the canonical pools. Provider-complete all-history Job inventory remains unproven. Both canonical Function Job pools matched exact at 512 MB, while their function-target binding was unavailable from the inspected surfaces. All nine required Connections were Connected with their exact least-privilege scope sets, and the complete Cron inventory contained zero canonical references. A relative prior-24-hour access and application log query ran after the final disabled-Gateway readback and returned zero rows for all six canonical functions; its exact UTC bounds were not retained, and it does not prove exact all-history execution. Direct caller and webhook bindings remain unproven.

The preceding pool, Connection, log, and visible Job-history paragraph is historical 2026-08-27 route-continuation evidence, not a claim that those surfaces were freshly revalidated by either the e1da1bc predecessor packet or the 288a93c reconvergence packet. During these executions, the operator invoked no route, function, Job, or Cron; that statement applies to the historical route continuation and both definition-convergence packets within their separately recorded scopes.

This shared Zoho Catalyst package contains exactly three deployable functions:

- `revenue_desk_call_gateway` — Advanced I/O ingress.
- `revenue_desk_call_worker` — private Function Job target.
- `revenue_desk_route_control` — private Development-only Advanced I/O approval, activation, and rollback target.

The canonical source profile is `free_test/call_gap_monitor_v1`. Registered paid-service profiles `launch_v1`, `growth_v1`, and `scale_v1` remain disabled drafts and fail closed. The Development definition deployment and subsequent reconciliation do not authorize route invocation or further route mutation, a customer test, paid offer, Production traffic, migration, mail send, binding, Retell test, or Retell change.

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

The existing explicit `rebuild_report` and `reconcile_deployment` Jobs also support an activated free test stopped by the existing rollback control. The source requires the original completed rollback claim, its signed revoke decision, exact activation/Deal/journey/configuration binding, original stop reason/time and unchanged control state. A bare `Stopped` row cannot authorize a closeout. Pending admitted calls, provider receipts or notifications withhold final artifacts. After settlement, the same final-result outbox and exact CRM summary readback must reconcile before the held document callback runs. Catalyst stays `Stopped`/`Revoked` with reconciliation status `NotRequired`; CRM stays `Rolled Back`/`Closed Lost`. No new automatic Stopped scan, schedule, route activation or stop-state rewrite is introduced.

For an independently approved Development manual closeout, run the existing rebuild Job for the exact private deployment, let its existing CRM-summary operation reach authoritative readback, then run the existing reconcile Job. Repeating those Jobs reuses the same source artifacts; an ambiguous CRM write remains readback-only. Fresh source revisions still require a fresh report. Source tests cover zero calls, already-admitted late settlement, missing or altered rollback proof, duplicate reconciliation and preservation of terminal facts. Installation, authenticated invocation, original carrier restoration and any durable document destination remain separate acceptance gates.


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

[`config/datastore-schema.json`](config/datastore-schema.json) remains an activation contract, not live authorization. Full-table pagination confirms 35 retained tables, 466 aggregate rows, and complete zero/nonzero classification; this does not authorize migration or deletion. On 2026-08-28, the gateway and worker definitions converged at revision `288a93c7773acaf82fab277702e6b4e3d7354564` with Node 24, 256 MB, exact configuration, and Catalyst archive pullback parity by path set and file content. The gateway's exact 31-variable private map read back with deployment mode active while Gateway ingress remained disabled. The worker's complete 28-variable Development map read back with dry-run notification. Neither function nor the worker Job was invoked, so runtime behavior remains unproven.

The earlier API Gateway execution began from zero routes, created and independently read back only `RETELL_INBOUND`, then stopped on provider modal-flow drift and restored Gateway to disabled. That exact one-route state is historical, not current. Under a separate consumed creation approval, `RETELL_EVENTS` was created and immediately contained when exact readback exposed one duplicate separator in its target endpoint. A separate single-use remediation approval corrected only that defect, independently read back the exact route, restored Gateway to disabled, and established the exact two-route prestate; both approvals were exhausted and are not reusable. A fresh ten-route continuation approval then created the remaining routes serially and established exact twelve-route parity without deleting or recreating an existing route. That continuation approval is also consumed.

The operator used the historical route configuration actions without invoking a route or function. API Gateway remains independently confirmed disabled and fail-closed; its latest disabled readback returned no route payload and therefore did not revalidate route parity. The complete visible `All Time` Jobs UI result remains bounded historical evidence, not provider-complete all-history inventory. Both canonical Function Job pools are present, but no inspected surface proves their function-target binding. Earlier readback recorded all nine required Connections with exact least-privilege scopes; the latest release packet did not revalidate them. The complete current Cron inventory contains zero canonical references. Earlier bounded log evidence does not prove exact all-history execution. Direct caller and webhook bindings remain unproven. During the historical e1da1bc convergence, the operator invoked no route, function, Job, or Cron and performed no Retell-provider or agent test, call, simulation, publish, phone-route, other provider-side change, customer action, or Production action; the 288a93c reconvergence preserved the same boundary. Migration, reconciliation, synthetic acceptance, and rollback acceptance remain mandatory, and live ingress stays dark until the separately scoped Retell task. The historical [execution record](../evidence/free-revenue-leak-test-development-packet-a-execution-2026-08-26.json), [ADR 0008](../../../docs/adr/0008-single-key-analytics-outbox-fence.md), sanitized [Packet A resolution evidence](../evidence/free-revenue-leak-test-development-packet-a-resolution-2026-08-26.json), [six-function Development deployment evidence](../evidence/free-revenue-leak-test-development-six-function-deployment-2026-08-27.json), [twelve-route continuation evidence](../evidence/free-revenue-leak-test-development-route-continuation-2026-08-27.json), [historical PR-head convergence evidence](../evidence/free-revenue-leak-test-development-pr-head-convergence-2026-08-28.json), and [current convergence evidence](../evidence/free-revenue-leak-test-development-pr-head-convergence-2026-08-28-288a93c.json) preserve their bounded conclusions.

The 288a93c deployment reconfirmed the required consumer-first six-function upload order. Runtime consumer compatibility remains a separate release gate: the operator did not invoke the Development compatibility probe because no verified private Advanced I/O invocation channel was available. A later scoped synthetic proof must show that the consumer accepts a v2 null workflow-failure total and still validates a retained v1 non-null row; do not use a real Deal or Retell traffic. Keep the gateway and retry trigger dark until compatibility readback passes. This ordering remains mandatory because an older v1-only consumer correctly rejects a v2 payload and would leave terminal reconciliation pending.

[`config/retry-job.json`](config/retry-job.json) is the provider-native Development contract for the disabled `RevenueDeskRetry1m` Cron. It binds only the private `RevenueDeskCallJobs` Function pool and `revenue_desk_call_worker` target, supplies only `{ "mode": "retry_scan" }`, and sets provider retries to zero. Provisioning remains blocked until a fresh pre-defined inventory proves one complete untruncated array, every item exposes a lossless ID/name/execution-type/status, pagination behavior is known, and a separate all-execution-type check excludes same-name collisions. An empty pre-defined list alone never proves absence. Exact comparison then requires the singular get-by-ID call and a lossless Cron-ID projection plus the documented numeric schedule/retry normalization.

The installed Changes connector advertises a full Cron body for status changes, while the official provider operation is status-only. Do not discover the accepted shape by mutation. Exact classification exhaustively buckets every advertised schedule, end, notification, request, header, URL, retry, provider-identity, and metadata field; canonical-absent fields must be literally absent, and nulls, empty values, defaults, unknown keys, or unproven absence fail closed. The current full-body templates are not execution-ready until read-only evidence proves status-only/nonreplacement semantics, and they must never be applied to a drifted or duplicate predecessor. Without a proven safe status-only shape, keep the worker mode dark, preserve those predecessor definitions, mark Cron containment unproven, and stop. A Cron create/resource `data.id`, persisted Job-definition or `cron_detail.jobId`, or pool/target/function identifier is not a submitted execution Job ID. Terminal canary evidence must bind the exact lossless manual-submit `data.job_id` through the get-by-ID request/response and bind `source_type=Cron` plus the exact source Cron ID, name, and `pre-defined` execution type; pool/target/params/time matching is insufficient. The contract does not authorize a live write or activation. Its dark-worker containment canary remains blocked until the provider exposes a lossless Job-to-execution identifier binding and callable execution-scoped log readback; it would not prove `retry_scan` business behavior. Conditional rollback deletion additionally needs fresh exact authority, permanently destroys Cron history, is never retried after ambiguity, and succeeds only after complete name/ID inventory absence plus shape-proven get-by-ID not-found readback.

### Held local draft reconciliation

The existing `Completed` deployment scan can invoke a trusted
`terminalDraftReconcilerFactory` supplied when constructing the worker. Its
default is `null`; no Job parameter or environment switch enables it. The
Analytics-owned [local reporting implementation](../revenue-desk-analytics/LOCAL-REPORTING-V1.md)
validates all three reconciled partitions and canonical call details, then
prepares an owner-review draft. Incomplete evidence waits; a failed generation
retries on the next fair completed-deployment scan without resending completed
CRM or Analytics work. Callback errors are sanitized, and cancellation prevents
a late callback from writing a draft after the bounded worker timeout.

Synthetic tests compose the actual worker, runtime, Analytics service and local
renderer. The provider's complete-partition reader, approved durable destination,
deployment construction and live acceptance remain unbound. This source path
does not authorize upload or customer delivery.

## Private approval, activation, and rollback control

The control Host guard accepts only the configured Development hostname, matched
case-insensitively, with either no port or exactly `:443`. This bounded transport
correction handles Catalyst retaining HTTPS's default port without trusting a
forwarded host or accepting another authority. Header cardinality/type checks,
the protected caller credential, project digest, environment, SDK consistency,
and method/path restrictions remain unchanged and precede business side effects.
The configured hostname and configuration digest do not change. Offline
regressions cover both accepted forms, rejected variants, and pre-provider
Journey-core dispatch; an immutable Development deployment and native approval
readback remain separate acceptance gates. Roll back to the prior artifact to
restore the fail-closed rejection; do not relax configuration or reuse a consumed
diagnostic allocation. No dependency, recurring cost, or Retell scope is added.

The `free-test-journey-core-v1` path validates CRM record reads against the stored
`Entry_Offer` value `Free 7-Day Missed-Call`, not the `7-Day Revenue Leak Test`
display/workflow label. Its synthetic fixture uses that stored value; regression
coverage rejects the display label, unrelated values, and missing values before
any control receipt or CRM write. This changes no CRM picklist, workflow criteria,
or full-automation contract. Approval replay after blocked activation and
idempotent rollback remain separate from provider execution. Passing these local
checks does not prove live Form 2 submission or internal approval acceptance.

`revenue_desk_route_control` exposes exactly three authenticated Development `POST` operations: approve configuration, activate free test, and stop or roll back free test. It uses the shared evaluators in [`lib/approval-control.js`](functions/revenue_desk_call_gateway/lib/approval-control.js), while keeping operator controls off the Retell gateway. Every command binds Deal, journey, deployment, configuration, idempotency identity, and rollback reason where applicable. Prepared receipts recover exact CAS poststate after interruption; command drift conflicts. Approval moves only to `Scheduled`; activation requires the exact approval plus fresh authoritative route readback; rollback stops Catalyst before provider unbinding and preserves all evidence.

`RETELL_ROUTE_MODE=disabled` is the install-safe default. It requires no Retell number or Connection, activation fails with `ISOLATED_RETELL_TEST_NUMBER_REQUIRED`, and rollback returns the approved manual instructions. `isolated_test` additionally requires the exact test number, shared agent/version, Development webhook, and Retell Connection. Rollback performs no PATCH unless fresh readback proves the `ZZZ SYNTHETIC` number belongs to the exact deployment and route. Neither mode publishes an agent, buys a number, calls, sends SMS, or permits Production.

The exact prestate, mutation predicates, readback, ambiguity, invalidation, containment, rollback, and legacy retirement rules are in [`route-approval-control-plane-runbook.md`](route-approval-control-plane-runbook.md). Legacy deletion and activation remain blocked until the legacy source export, dependency map, and live route/Job/webhook/caller binding proof are reconciled. The legacy boundary remains stopped but recoverable; legacy status or receipt rows are historical/quarantine evidence and never authorize a canonical route.

## Release artifact and migration gates

The checkout contains an unbuilt revision sentinel; an environment SHA alone cannot claim parity. Build a separate release tree after selecting final main:

```powershell
node scripts/build-release.js --revision <40-character-final-main-sha> --output <new-release-directory>
```

The builder accepts only the exact clean checked-out Git `HEAD`, reads the deployable allowlist from that commit's blobs, refuses existing or in-repository output, rejects non-regular paths, stamps only an atomic outside-repository artifact, validates the exact three targets and linked local dependencies, and writes deterministic hashes in `release-manifest.json`. Materialize dependencies only in that staged tree. Never deploy the mutable or unstamped checkout.

The worker artifact also contains the allowlisted Analytics report tools, contracts and libraries under `reporting/revenue-desk-analytics`. Both source-revision modules are stamped from the same release commit. Its small runtime import bridges resolve the worker's one materialized `revenue_desk_call_gateway` package; they never copy the reporting trust module or fall back to a sibling checkout. The manifest records the original source path/hash and final artifact hash, including generated bridges. The trusted `lib/terminal-draft-composition.js` export is packaged for later approved application composition; `index.js` still leaves the report factory unbound. The release test extracts a self-contained worker archive outside the checkout and exercises canonical evidence through the actual worker, assembler and renderer.

A reporting-only source revision is not approval to replace a separately installed authentication change. A deployment proposal must identify a separately reviewed composed artifact that preserves that behavior and its exact source provenance. This builder neither imports another branch automatically nor authorizes merging its pull request, installing the artifact, binding the factory, or enabling a schedule.

For a separately reviewed auth-preserving candidate, use `scripts/compose-reporting-artifact.js` with the exact reporting/auth commit SHAs and runtime/CRM artifact roots from the reporting revision. It requires clean reporting `HEAD`, the auth commit's single common-base parent, no reporting edits to the five fixed auth paths, and exact base-artifact source bytes. It preserves the CRM artifact's existing protected proof stamp without reading credentials or recomputing that stamp. No source checkout, input artifact, branch or pull request is changed.

If the reviewed CRM artifact comes from an older revision, first use the helper's `--prepare-crm-base` mode. It verifies every allowlisted source file in that artifact against the explicitly selected proof-source commit, exports fresh reporting Git blobs, and carries forward only the existing opaque Development proof value. It copies no old auth code or dependencies. The new `crm-source-base-manifest.json` records both revisions and source/output hashes without the proof value; retain it in the private packet with the immutable proof-source artifact. This is a held source base, not renewed live binding acceptance. It needs no protected credential input, HMAC recomputation, install or network call, and refuses a dirty reporting checkout.

```text
node scripts/compose-reporting-artifact.js --reporting-revision <reporting-sha> --auth-revision <auth-sha> --runtime-artifact <absolute-runtime-root> --crm-artifact <absolute-crm-root> --output <new-absolute-outside-repository-root>
```

The new `composition-manifest.json` identifies the common base, reporting and auth revisions, exact selected blobs, source hashes and output hashes. The original runtime manifest is retained under `provenance/` and cannot be presented as final composed parity. Source-revision stamps still identify the reporting base; the explicit composition manifest is required to identify all shipped source. The output is a held **source** candidate: materialize reviewed dependencies afterward, with the auth-overlay gateway copied into the worker/control packages, then rehash and independently verify the complete archive. The helper performs no install, provider request, protected-input read, factory binding or deployment. A standard single-revision release approval cannot silently approve this two-revision candidate.

`release-builder.test.js` covers deterministic reporting packaging and synthetic composition drift/rejection. To qualify a specific already available auth revision locally, set the nonsecret `SYLVARA_AUTH_COMPOSITION_TEST_REVISION` to its full SHA and run the extracted-worker test. That mode exercises the selected application's auth configuration and producer against its matching CRM consumer, then executes the actual reporting/durable composition. Ordinary CI does not depend on an unmerged external PR/ref; it does not claim that separate revision was qualified.

From the repository root, the source packaging and qualification commands are:

```powershell
node src/zoho-catalyst/revenue-desk-call-runtime/scripts/build-release.js --revision <reporting-sha> --output <new-absolute-runtime-root>
node src/zoho-catalyst/revenue-desk-call-runtime/scripts/compose-reporting-artifact.js --prepare-crm-base --reporting-revision <reporting-sha> --proof-source-revision <reviewed-crm-source-sha> --proof-artifact <absolute-reviewed-crm-root> --output <new-absolute-reporting-crm-root>
node src/zoho-catalyst/revenue-desk-call-runtime/scripts/compose-reporting-artifact.js --reporting-revision <reporting-sha> --auth-revision <auth-sha> --runtime-artifact <absolute-runtime-root> --crm-artifact <absolute-reporting-crm-root> --output <new-absolute-composed-root>
$env:SYLVARA_AUTH_COMPOSITION_TEST_REVISION = '<auth-sha>'
node --test --test-name-pattern 'extracted worker archive' src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_call_gateway/test/release-builder.test.js
Remove-Item Env:SYLVARA_AUTH_COMPOSITION_TEST_REVISION
```

For the composed candidate's `runtime` and `crm` projects, materialize dependencies **only from an already verified local dependency directory**. The following bounded Node script checks the exact lockfile versions, refuses existing target `node_modules`, dereferences source junctions into ordinary files, and copies the overlaid gateway into both consumers. It runs no package-manager or lifecycle script and cannot download a missing package. Use explicit absolute reviewed paths; failure leaves an incomplete candidate held for inspection, never permission to overwrite it.

```powershell
$runtimeArtifact = '<absolute-composed-root>\runtime'
$crmArtifact = '<absolute-composed-root>\crm'
$reviewedDependencies = '<absolute-verified-node_modules-root>'
@'
const fs = require('node:fs');
const path = require('node:path');
const [runtime, crm, dependencies] = process.argv.slice(2).map(value => fs.realpathSync(value));
const targets = ['revenue_desk_call_gateway', 'revenue_desk_route_control', 'revenue_desk_call_worker']
  .map(name => path.join(runtime, 'functions', name));
targets.push(path.join(crm, 'functions', 'crm_billing_orchestrator'));
const names = ['agent-base', 'debug', 'https-proxy-agent', 'ms', 'zcatalyst-sdk-node'];
for (const target of targets) {
  if (fs.existsSync(path.join(target, 'node_modules'))) throw new Error('Target dependencies already exist');
  const lock = JSON.parse(fs.readFileSync(path.join(target, 'package-lock.json')));
  for (const name of names) {
    const installed = JSON.parse(fs.readFileSync(path.join(dependencies, name, 'package.json')));
    if (installed.version !== lock.packages[`node_modules/${name}`]?.version) throw new Error('Dependency version mismatch');
  }
}
for (const target of targets) {
  const modules = path.join(target, 'node_modules');
  fs.mkdirSync(modules);
  for (const name of names) fs.cpSync(path.join(dependencies, name), path.join(modules, name),
    { recursive: true, dereference: true, force: false, errorOnExist: true });
  if (['revenue_desk_route_control', 'revenue_desk_call_worker'].includes(path.basename(target))) {
    const core = path.join(modules, 'revenue_desk_call_gateway');
    fs.mkdirSync(core);
    for (const name of ['index.js', 'package.json', 'lib', 'contracts']) {
      fs.cpSync(path.join(runtime, 'functions', 'revenue_desk_call_gateway', name), path.join(core, name),
        { recursive: true, dereference: true, force: false, errorOnExist: true });
    }
  }
}
'@ | node - $runtimeArtifact $crmArtifact $reviewedDependencies
```

After materialization, hash each complete project with the existing strict tree hasher (which rejects links) and preserve the results in the private packet **outside** the hashed projects. Record the compressed archive's separate SHA-256, extract it into a new outside-repository directory, and require exact tree digest/file-count equality before considering provider readback. The composition manifest describes source provenance; these post-materialization digests describe the actual archives. Neither authorizes installation.

```powershell
node -e "const h=require('./src/zoho-catalyst/revenue-desk-release/lib/release-manifest').hashArtifact; console.log(JSON.stringify(h(process.argv[1])))" $runtimeArtifact
node -e "const h=require('./src/zoho-catalyst/revenue-desk-release/lib/release-manifest').hashArtifact; console.log(JSON.stringify(h(process.argv[1])))" $crmArtifact
Get-FileHash -Algorithm SHA256 -LiteralPath '<absolute-final-archive-path>'
```

Observed Development counts require preservation: `FreeTestDeployments=3`, `FreeTestCalls=30`, `FreeTestNotifications=6`, `FreeTestRetellEventReceipts=39`, plus nonempty generic resolver/call/Analytics tables. No deletion, rename, truncate, in-place rewrite, or cutover is safe. A future one-way migration must preserve keys, environment/engagement ownership, configuration-version IDs, receipt kinds/idempotency, call attribution, notifications, authorization chains, handled counts, and outbox lineage, then prove counts, per-partition keyed digests, samples, every conflict, rollback, and a recovery window.

## Verification

```powershell
cd functions/revenue_desk_call_gateway
npm ci --ignore-scripts
npm run ci

cd ../revenue_desk_call_worker
npm ci --ignore-scripts --install-links
npm run ci

cd ../revenue_desk_route_control
npm ci --ignore-scripts --install-links
npm run ci
```

Tests cover the SDK Job payload/readback, fast durable ingress, the exact three gateway routes and four worker modes, replay/reordering, inbound audit, tenant/configuration/capability isolation, approval-versus-activation timing, receipt/readback invalidation, call limits, minimized notifications/outbox facts, report reconciliation, source-stamp mismatch, isolated release building, and no-access Production dark containment.

No live call, route invocation, further Catalyst route mutation, Retell-provider or agent change, provider-side phone or route change, migration, deletion, Production access, real mail, CRM write, Analytics reverse-write, booking, dispatch, transfer, quote, payment, SMS, outbound communication, private ID, or secret is authorized or included.
