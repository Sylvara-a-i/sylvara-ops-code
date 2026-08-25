# Free Revenue Leak Test E2E Reconciliation

- **Status:** NOT READY FOR RETELL AGENT TESTING
- **Evidence environment:** Catalyst Development and Zoho Billing TEST only
- **Required final environments:** Development and dark Production
- **Revision date:** 2026-08-25
- **Production traffic authorized:** No

This record reconciles current repository and sanitized Development evidence against the superseding six-function Revenue Desk architecture. It replaces the former five-function release decision. Earlier Retell-only evidence remains historical proof for behavior that is deliberately migrated; it is not approval to retain the old topology or to claim current source/runtime parity.

The final state is not yet present. Existing Form, Retell free-test, reporting, and CRM/Billing code contains useful tested behavior, but canonical gateway/worker separation, Analytics, shared free/paid configuration, canonical tables, migrations, cleanup, final-main deployments, and dark-Production proof remain release blockers.

## Approved names

| Boundary | Required name |
| --- | --- |
| Form 1 function | `revenue_leak_test_request_form` |
| Form 1 customer-facing title | Free Revenue Leak Test Request |
| Form 2 function | `revenue_leak_test_setup_form` |
| Form 2 customer-facing title | Free Revenue Leak Test Setup and Authorization |

The former generic controller names are historical migration aliases only and are not deployment targets.

## Canonical target topology

The existing Retell Catalyst project becomes the single Revenue Desk backend. Its final active function inventory is exactly:

1. `revenue_leak_test_request_form` — Advanced I/O.
2. `revenue_leak_test_setup_form` — Advanced I/O.
3. `revenue_desk_call_gateway` — Advanced I/O.
4. `revenue_desk_call_worker` — Job Function.
5. `crm_billing_orchestrator` — Advanced I/O.
6. `analytics_sync` — Job Function.

The final Function Job pools are exactly:

- `RevenueDeskCallJobs`
- `RevenueDeskAnalyticsJobs`

No separate free-test, paid-service, retry, event-receiver, inbound-resolver, route-approval, or call-processing function remains after cutover.

`RevenueDeskAnalyticsJobs` accepts no caller-controlled Job parameters. Its function chooses durable batch, poll, readback, checkpoint, and retry work from stored state. Private runtime configuration permits `disabled`, `readiness`, or `active` in Development and only `disabled` or `readiness` in dark Production.

## Current-state reconciliation

| Component | Required final state | Current repository or sanitized evidence | Status |
| --- | --- | --- | --- |
| Form 1 | Canonical function and one canonical session table | Canonical source and an empty session table exist. The hosted title, consent/submission timestamps, fixed audit versions, exact calls-and-email consent copy, and truthful confirmation copy are configured and independently read back; native CRM upsert remains the sole writer. Assisted prefill, function/routes/variables, and synthetic CRM readback remain blocked. | P1 blocked |
| Form 2 | Canonical function and four canonical v3 stores | Canonical source and the hosted title/scope/confirmation copy exist, but the legacy controller remains the active webhook rollback path. The required email field is still rule-dependent rather than globally mandatory, prohibited mobile/test-number fields remain for rollback, and the canonical function/callers are not cut over. | P1 blocked |
| Call gateway | Fast verification, durable receipt, Job submission, and readiness only | Existing `retell_free_test` performs event processing synchronously and uses the predecessor name | P1 blocked |
| Call worker | One private Job target with four explicit modes | Existing retry behavior is a separate `retell_free_test_retry` function; no canonical four-mode worker is deployed | P1 blocked |
| Route approval control | Out-of-band private control plane; immutable approval then post-readback activation receipts; no extra function, route, or Job mode | Canonical source/tests/runbook exist locally, but the legacy `retell_route_approval_control` source, dependencies, callers, live bindings, and historical authorization mapping have not been exported or reconciled; no canonical live exercise/readback exists | P1 blocked |
| Shared free/paid runtime | `free_test` active; `paid_service` schema present only behind Disabled/Draft profile | Existing runtime accepts only the free-test profile and rejects `paid_service` | P1 blocked |
| Canonical call stores | Five `RevenueDesk*` tables with immutable version authority | The six additive canonical Revenue Desk tables are present and empty, and `CRMBillingOperations` has the exact additive schema. Legacy nonzero stores remain. Migration, reconciliation, live-reader binding, and rollback proof do not exist. | P1 blocked |
| Reporting | Worker rebuild/reconciliation plus CRM and Analytics outboxes | Deterministic JSON/CSV library exists but is not a canonical worker mode | P1 blocked |
| CRM/Billing | Accepted-only TEST subscription path with authoritative readback | CRM has all 17 required Deal fields. The live review rule creates both immediate and scheduled tasks; initialization remains split because the 2026-08-25 Sylvara workflow-configuration readback reports a maximum of five associated field updates per condition, with five in Controls and three in Limits; the setup candidate is locked; and the connected workflow writer exposes no typed payload contract. The Draft Blueprint collapses approval with activation and lacks terminal/commercial guards. Billing TEST lacks the Revenue Desk product, all three paid monthly plans, and the metered add-on. Live has the exact hidden product and monthly plans, but only tier-specific one-time, non-usage add-ons rather than one common metered add-on. No connected typed catalog writer exists. | P1 blocked |
| Analytics | Canonical `analytics_sync`, checkpoints, outbox, dashboards, retry, and freshness | Analytics Audit is callable, but two plausible owned workspaces share the legacy tables and neither required dashboard exists, so the target binding is ambiguous. Development retains 10 checkpoints and 307 outbox rows; the outbox still lacks the required unique provider-version column. Runtime Connections, write rights, destination identity, Job binding, migration, and dashboard readback are unproven. | P1 blocked |
| Development deployment | Exact final-main six-function source/runtime parity and synthetic E2E | Historical partial revisions only | P1 blocked |
| Production deployment | Dark final-main deployment with independent credentials and zero traffic | Existing component source blocks Production and no dark-Production E2E or rollback evidence exists | P1 blocked |
| Cleanup | No legacy runtime, tables, probes, standalone Form projects, or stale credentials | The 29-table Development inventory has not been fully classified; aggregate counts do not authorize migration, truncation, or deletion | P1 blocked |
| Client-portal gateway | Retained as a separate trust boundary pending source-webhook, dependency, and use proof | Separate project has one Development function and two Production functions across three differing revisions; route use and external dependencies are not proven | `retain_separate_pending_source_webhook_and_dependency_proof`; P1 blocked |

### Sanitized Development Data Store baseline

The corrected paginated Development baseline on 2026-08-24 used the server-supported 300-row page size, continued past the first page, and observed 29 tables. Sixteen were nonzero. Additive schema work after that baseline does not alter these historical row counts:

| Table | Rows |
| --- | ---: |
| `AnalyticsSyncCheckpoints` | 10 |
| `AnalyticsSyncOutbox` | 307 |
| `Calls` | 13 |
| `ClientDailyMetrics` | 10 |
| `ClientDeployments` | 2 |
| `ConfigurationVersions` | 2 |
| `Form1AssistedSessions` | 8 |
| `Free_Test_Setup_Prefills` | 13 |
| `Free_Test_Setup_Sessions` | 4 |
| `FreeTestCalls` | 30 |
| `FreeTestDeployments` | 3 |
| `FreeTestNotifications` | 6 |
| `FreeTestRetellEventReceipts` | 39 |
| `InboundResolverEvents` | 13 |
| `OutcomeLinks` | 5 |
| `ReportRuns` | 1 |

The remaining 13 tables returned zero rows in this count readback. Zero rows do not establish that a table is obsolete: it may still have an active reader, writer, route, Job, Cron, migration dependency, or rollback role. Conversely, a nonzero count does not prove that every row should be retained in the active canonical generation. This evidence includes names and aggregate counts only; it does not include row contents, private project identity, customer/caller data, active dependency proof, or row digests.

No one may migrate, merge, rename, truncate, or delete any of the 29 tables from this snapshot until every table has a recorded owner/purpose/generation/disposition, every active reader and writer is identified, source keys are mapped to a canonical destination or approved quarantine, fresh pre-migration counts and deterministic sanitized row digests are captured, the additive migration is read back by exact key set/count/digest/environment, and rollback has been rehearsed. Any later deletion also requires scoped approval and independent absence readback.

## Shared runtime contract

`revenue_desk_call_gateway` owns only:

- raw-body signature and freshness verification;
- method, content type, host, and body-size enforcement;
- number ownership and immutable configuration resolution;
- deployment, capability-profile, and version-specific go-live validation;
- event-receipt persistence and idempotency-key creation;
- `RevenueDeskCallJobs` submission; and
- fast acknowledgment and readiness.

It exposes exactly three routes: `POST /retell/inbound`, `POST /retell/events`, and authenticated `GET /internal/readiness`. Approval is not an HTTP route and is not a Job mode.

`revenue_desk_call_worker` owns the validated modes:

- `process_event`;
- `retry_scan`;
- `rebuild_report`; and
- `reconcile_deployment`.

It performs event convergence, call classification, one-row-per-call enforcement, seven-day and 25-connected-call enforcement, notifications, retry, report reconciliation, CRM-summary outbox work, Analytics-outbox creation, and the disabled future paid-service foundation. It has no public HTTPS route.

The active free-test profile is `call_gap_monitor_v1`. It is published and enabled only for bounded after-hours and/or overflow coverage, with booking, dispatch, SMS, payment, and paid-product actions prohibited.

The paid-service profiles are `launch_v1`, `growth_v1`, and `scale_v1`. Each remains Disabled and Draft, has no implemented conversation behavior, and cannot route. Unknown, unpublished, disabled, or engagement-mismatched profiles fail closed.

### Approval and activation state

The smallest canonical control is the out-of-band operator procedure in [`src/zoho-catalyst/revenue-desk-call-runtime/route-approval-control-plane-runbook.md`](../../src/zoho-catalyst/revenue-desk-call-runtime/route-approval-control-plane-runbook.md). Approval binds the exact active configuration, deterministic route fingerprint, source revision, evidence, and deployment version in an immutable receipt, then moves the row only to `Scheduled` / `Approved`. It leaves activation, actual-start, and expiry fields null.

Activation is a distinct signed event chained to approval. It requires a fresh authoritative route readback, then sets `Live`, `ACTUAL_START_AT`, and an `EXPIRES_AT` exactly 604800000 milliseconds later. Runtime validates both receipts and their configuration/route/source/readback chain; status strings alone fail closed. Any governed configuration, number hash, binding, agent/version, coverage, call limit, fingerprint, or source change requires containment, cleared authorization references, and a fresh approval/activation chain. No capacity-reservation subsystem is retained; practical already-admitted in-flight overshoot remains explicit and reconciled.

## Canonical Data Store generation

The shared call runtime migrates to:

- `RevenueDeskDeployments`
- `RevenueDeskConfigurationVersions`
- `RevenueDeskEventReceipts`
- `RevenueDeskCalls`
- `RevenueDeskNotifications`

`RevenueDeskConfigurationVersions` is the only immutable configuration-version authority. Deployment approval is version-specific. Nullable deployment fields bind the approved configuration, approval event, approved route, approval time, activation event, actual start, and expiry; nullable receipt fields bind configuration, route, route readback, and the related approval event without changing non-authorization receipt kinds. Calls retain the exact engagement, client, environment, and configuration version used at admission.

Form and supporting stores are:

- `RevenueLeakTestRequestFormSessions`
- `Form2SessionsV3Runtime`
- `Form2PrefillsV3`
- `Form2VerificationProofsV3`
- `Form2SubmissionsV3`
- `CRMBillingOperations`
- `AnalyticsSyncCheckpoints`
- `AnalyticsSyncOutbox`

No App User access is permitted. No raw phone number, personal email address, transcript, audio, recording URL, raw webhook payload, or secret belongs in Analytics or shared call state.

`CRMBillingOperations` is also the executable terminal-summary handoff, not a passive operator queue. After exact terminal settlement, the worker writes a revision-specific encrypted `sync_report_summary` row. The existing one-minute `retry_scan` is the sole automatic caller and selects at most five report operations per run. It calls the existing `crm_billing_orchestrator` Advanced I/O route with only `schemaVersion`, `action`, Deal ID, and exact operation key; the transport requires Catalyst `ZCFKEY` plus the report-only second factor paired between worker `CRM_BILLING_SHARED_HEADER_VALUE` and orchestrator `REPORT_SUMMARY_HEADER_VALUE`. Pending is atomically claimed by version. Processing or reconciliation-required state never repeats a CRM write and completes only through exact Deal readback.

Do not accept runtime readiness until the exact terminal Analytics fact exists and the exact report operation reads back `STATUS=completed` and `LAST_OUTCOME=report_summary_readback_confirmed`. A stale Completed deployment marker must be counted pending and explicit reconciliation must rebuild/read back the artifacts. The CRM summary update does not write `Stage`, `Results_Review_At`, acceptance, or Billing fields. After summary readback, a human operator owns the valid **Complete Free Test** Blueprint transition and later Results Review. `Test_New_Service_Inquiries` is not inferred because the current report has no separate authoritative metric with that semantic.

## Migration and cleanup gates

### Legacy function extraction

Do not delete a legacy function merely because its route or Job is currently unbound. Before deletion:

1. export sanitized source and configuration-name evidence;
2. review dependencies, validation, normalization, ownership, configuration-version, outcome, and tests;
3. migrate useful behavior into the gateway, worker, or canonical Analytics function;
4. prove source/runtime parity and direct behavior in Development;
5. remove routes, webhooks, Jobs, Crons, and exclusive credentials;
6. independently verify no dependency; and
7. delete and read back absence.

This sequence applies to `retell_events`, `retell_inbound_resolver`, `retell_route_approval_control`, and `process_retell_events`. For `retell_route_approval_control`, deletion additionally requires its full source/dependency/test export, fresh proof of every route, internal caller, Job, schedule, webhook, and credential binding, historical approval disposition as non-authoritative evidence, canonical synthetic approve/activate/revoke/readback coverage, and rollback rehearsal. Until then it remains stopped, access-restricted, recoverable, and not deletion-authorized. It also applies to removing `retell_free_test` and folding `retell_free_test_retry` into the worker. Historical wrappers may be archived only under a clearly non-deployable **Historical — Not Deployment Approved** boundary with no secrets or deployment manifest.

The historical `analytics_sync` implementation is not a deletion target by name. Replace it with canonical reviewed source, remove obsolete triggers, and bind only `RevenueDeskAnalyticsJobs`.

### Table migration

The 2026-08-24 aggregate count snapshot is evidence for planning only and does not authorize a write. First classify and map all 29 observed tables, including the 13 zero-row tables. Capture fresh counts and deterministic sanitized digests immediately before migration. Then create the canonical generation additively, without renaming, truncating, rewriting, or deleting a source table. Migrate and reconcile by environment, client, engagement, deployment, configuration version, event key, call key, exact key set, count, and row digest. Preserve ambiguous source evidence outside active readers. Prove destination readback, source/runtime parity, Development E2E, and rollback before requesting approval to delete the old generation.

After those gates pass and removal receives scoped approval, but before first Production deployment, remove:

- superseded `FreeTest*` call tables;
- duplicate Form 2 session stores;
- v2 stores after their retained/quarantined rows receive an approved disposition;
- all zero-row runtime and column probes; and
- any copied legacy-project table not used by a canonical function.

### Project and credential cleanup

Delete standalone Form projects only after the canonical functions and callers pass direct tests, CRM synthetic tests, Development E2E, rollback rehearsal, final-main Development deployment, and dark-Production smoke testing. Export sanitized evidence first, disable callers and routes, revoke credentials, verify no references, then delete and read back absence.

Rotate retained Development credentials after every consumer is final. Revoke credentials exclusive to deleted functions or projects. Production credentials must be independently created and must not reuse Development values.

## Dark-Production boundary

Dark Production is a required deployment target, not a live launch. It must use final `main`, independent credentials, inactive deployment records, disabled recurring triggers, no Retell number or webhook binding, no real records, and no externally reachable customer workflow.

The synthetic dark-Production E2E must prove function identity, source revision, table binding, environment isolation, disabled paid profiles, fail-closed routing, Analytics isolation, rollback, and zero traffic. It must not place a call, run a Retell simulation, send SMS, create a live subscription, invoice, charge, payment, or activate Production traffic.

## Client-portal gateway audit

**Classification:** `required_hardening_pending`.

The Client Portal remains a separate Catalyst project and trust boundary. A read-only 2026-08-25 audit established an active Billing Subscriptions webhook whose private target exactly matches the Development snake-case route. That active source makes deletion unsafe even though no delivery rows were visible across a one-year Billing history query. The current evidence does not authorize merging it into Revenue Desk, deleting either Production function, promoting an observed revision, changing a route, or rotating credentials.

| Evidence area | Sanitized finding | Decision impact |
| --- | --- | --- |
| Functions | Development has one `sylvara_client_portal_hmac_gateway_function`. Production has that function plus the duplicate `SylvaraClientPortalHMACGateway`. | Preserve both live revisions until immutable Development replacement, rollback, and dependency readback pass. |
| Source revisions | All three observed source revisions differ and were fully scanned privately. They directly reference Billing, Creator, and raw OAuth refresh material; they do not directly reference CRM, Books, Analytics, or the website, and they do not use Catalyst Connections. | Replace raw OAuth material with a least-privilege Connection in the hardened Development artifact; never publish the source or credential material. |
| Billing source | The Subscriptions webhook is active and its target exactly matches the Development route. | The gateway is required; route mapping alone does not prove every Creator dependency or authorize promotion. |
| Billing history | No delivery rows, statuses, or timestamps were visible from 2025-08-25 through 2026-08-25. | Silence is not proof of inactivity and is not deletion authority. |
| Creator target | Basic Creator Audit now authenticates and proves a nonempty account, but the connected tool surface cannot inventory Custom APIs or read their authentication contract. | Live deployment and duplicate removal remain blocked until exact Custom API ownership, auth, and rollback are read back. |
| Repository package | `src/zoho-catalyst/billing-webhook-gateway` builds one deterministic clean-HEAD Development target and retains the Production code block. | The package is a candidate for the remaining hardening work, not release-ready evidence; the builder never deploys and live use still requires scoped approval. |

Before any live change, independently verify the Creator target and authentication contract, every remaining external reference or dependency, the exact reviewed source revision, route state, and rollback. Preserve sanitized evidence of those mappings and readbacks. The classification cannot advance until immutable Development deployment/readback, duplicate-removal proof, webhook and fingerprint-secret rotation, least-privilege Connection-grant rotation, old raw-OAuth revocation, and final Billing/Catalyst/Creator/Connection/inbox readback also pass.

Deploy only the hardened snake-case package under `sylvara_client_portal_hmac_gateway_function`, pin its SDK dependency, and replace static OAuth refresh material with a least-privilege Zoho Connection. Remove the duplicate `SylvaraClientPortalHMACGateway` only after Creator dependency, immutable Development deployment, route, rollback, and independent absence-readback proof. Until those gates and scoped approval pass, do not delete, promote, rotate credentials, or otherwise change the live project.

## Release blockers

1. Implement and test the exact six-function inventory, two Job pools, three call-gateway routes, and four call-worker modes.
2. Build the shared free/paid configuration and disabled paid profile.
3. Build, migrate, reconcile, and rollback the canonical tables.
4. Deploy and cut over both Form functions and exact hosted Form titles.
5. Redesign the CRM workflow set within the verified five-field-update-per-condition limit, obtain a typed writer contract and unlock/readback path, then prove the workflow and Blueprint through a fresh synthetic Lead-to-Deal lifecycle.
6. Complete Billing TEST and hidden live catalog readback without payment or charge.
7. Complete Analytics sync, retry, freshness, and both dashboards.
8. Run replay, failure, client, engagement, and environment isolation tests.
9. Export and reconcile legacy route-approval source/live bindings; exercise canonical approval, post-readback activation, revocation, ambiguity, and rollback in Development.
10. Complete staged legacy function, table, project, route, Job, and credential cleanup.
11. Merge the PR, deploy final `main` to Development, and prove parity.
12. Deploy final `main` to dark Production with independent credentials and prove zero-traffic E2E and rollback.
13. Close all P0/P1 defects.

## Rollback and containment

- Keep Production traffic dark throughout this release.
- Stop synthetic deployments and unbind Retell routes before runtime rollback.
- Disable call and Analytics Jobs or Crons before restoring code.
- Disable paid acceptance before CRM/Billing containment.
- Preserve idempotency, migration, call, outbox, Billing TEST, and readback evidence.
- Restore only a previously reviewed canonical revision.
- Roll table readers back through the reconciled generation mapping; never delete ambiguous rows to make counts match.
- Independently repeat function, route, pool, table, source-revision, and synthetic lifecycle readback after restoration.

## Classification

Current status is **NOT READY FOR RETELL AGENT TESTING**. Repository, Catalyst, Forms, CRM, Billing, Analytics, migration, deployment, cleanup, security, isolation, and rollback work remains.
