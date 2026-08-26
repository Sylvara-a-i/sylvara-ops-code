# Free Revenue Leak Test End-to-End Release Contract

This document summarizes the machine-readable [release contract](free-revenue-leak-test-release-contract.json). The JSON contract is authoritative for the target repository architecture. It describes required final state, not evidence that the functions, tables, routes, credentials, dashboards, or deployments currently exist.

## Purpose

The Free Revenue Leak Test covers one business number and one primary location for seven calendar days or 25 unique connected calls, whichever happens first. It measures an actual inbound call gap. It does not book, dispatch, send SMS, collect payment, or automatically create paid service.

Approval alone never activates the route or starts the clock. The clock begins only after an authoritative route-activation readback, a chained activation receipt, and the final conditional deployment update. Billing begins only after the test is completed, Results Review occurs, and a separate paid-service acceptance is recorded.

## Approved Form function names

- `revenue_leak_test_request_form` owns the customer-facing **Free Revenue Leak Test Request** workflow.
- `revenue_leak_test_setup_form` owns the customer-facing **Free Revenue Leak Test Setup and Authorization** workflow.

The former generic controller names are historical migration aliases only. They are not deployment targets.

## Canonical Catalyst topology

One existing Catalyst project hosts exactly six active Revenue Desk functions:

1. `revenue_leak_test_request_form` — Advanced I/O for Form 1 issuance and prefill.
2. `revenue_leak_test_setup_form` — Advanced I/O for Form 2 issuance, durable email proof, prefill, and bounded authorization submission.
3. `revenue_desk_call_gateway` — Advanced I/O for `POST /retell/inbound`, `POST /retell/events`, and `GET /internal/readiness`.
4. `revenue_desk_call_worker` — Job Function for event processing, retry scans, report rebuilds, deployment reconciliation, and bounded automatic terminal-summary dispatch.
5. `crm_billing_orchestrator` — Advanced I/O for terminal CRM summary write/readback and later accepted-state CRM and Billing TEST orchestration.
6. `analytics_sync` — Job Function for sanitized Catalyst-to-Zoho Analytics synchronization.

The only canonical Function Job pools are:

- `RevenueDeskCallJobs`
- `RevenueDeskAnalyticsJobs`

The gateway verifies and durably records an event, submits a `process_event` Job, and acknowledges quickly. Heavy event convergence, call classification, limit enforcement, notifications, reporting, CRM-summary outbox work, and Analytics-outbox creation belong to the worker. The worker accepts only the explicit modes `process_event`, `retry_scan`, `rebuild_report`, and `reconcile_deployment`.

`RevenueDeskAnalyticsJobs` accepts an empty Job-parameter object only. No caller-controlled action can select its behavior. Private environment configuration allows `disabled`, `readiness`, or `active` in Development and only `disabled` or `readiness` in dark Production; the Production path returns before SDK initialization or data access.

## Terminal CRM report handoff

Terminal settlement creates an encrypted, sanitized `sync_report_summary` row in `CRMBillingOperations`. Its `sylvara.crm-report-summary.v1` identity binds environment, Deal, deployment, configuration, report schema, canonical call-set digest, the full canonical report-revision digest, and action. A legitimate late event therefore creates a new immutable report revision; it cannot overwrite or collide with the completed prior row.

The existing `revenue_desk_call_worker` `retry_scan` is the automatic recovery owner and dispatches at most five report rows per scan to the existing `crm_billing_orchestrator` route. It sends only `schemaVersion`, `action`, `dealId`, and exact `operationKey`, authenticated by Catalyst `ZCFKEY` plus a separate report-only header secret. The consumer version-fences a `pending` row into a reclaimable `report_claim_*` pre-write state; a crashed pre-write owner can be fenced out and safely replaced. An exact `report_write_started_*` marker must be read back before CRM PUT, and that state or `reconciliation_required` can converge only through exact Deal readback and never repeats the write. Completion and containment compare the observed row, status, outcome, and version and read back the incremented version; a single bounded retry tolerates only an unchanged semantic cursor, so stale completion and containment cannot overwrite each other. After observing the operation cursor, every transition to completed and every already-completed replay fresh-reads the authoritative Deal account, deployment/configuration binding, and exact patch. Mismatch or unavailable readback CAS-keeps or demotes the cursor in `reconciliation_required`; if stale containment instead observes a winning completion, it fresh-reads and performs at most one repair CAS when the conflict persists. An exact fresh match remains a no-write replay. A differing report may transition only an unreviewed `Live` Test Status to `Completed`; `Completed` is exact-replay-only, while `Failed`, `Rolled Back`, reviewed, or accepted evidence is contained for reconciliation. Deployment readiness remains pending until both the exact Analytics fact and `CRMBillingOperations STATUS=completed / LAST_OUTCOME=report_summary_readback_confirmed` are read back.

The CRM patch includes authoritative calls-reaching-route, qualified-opportunity, and existing-customer counts. It does not infer `Test_New_Service_Inquiries`, because the report has no separate metric with that exact semantic. The orchestrator never writes `Stage` or `Results_Review_At`; a human owns the valid **Complete Free Test** Blueprint transition after summary readback and later records Results Review.

## Shared free and paid runtime

`revenue_desk_call_gateway` and `revenue_desk_call_worker` are the only call-runtime functions for both `free_test` and `paid_service` engagements. Routing is selected through immutable, versioned deployment configuration containing the required engagement, profile, plan, version, status, approval, limit, billing, number-ownership, environment, and source-revision fields.

The free-test capability profile is published and enabled only for the bounded seven-day/25-connected-call workflow. It allows narrow after-hours and/or overflow intake and prohibits booking, dispatch, SMS, payment, and paid-product actions.

The paid-service profiles are `launch_v1`, `growth_v1`, and `scale_v1`. Each exists only as Disabled and Draft and cannot route calls or activate Launch, Growth, or Scale behavior in this release. Unknown, unpublished, disabled, or engagement-mismatched profiles fail closed.

## Route approval and activation

Route control is an out-of-band private operator workflow, not a seventh function, fourth gateway route, or fifth worker mode. Approval records an immutable receipt bound to the exact active configuration, deterministic route fingerprint, source revision, and observed row version, then moves the deployment only to `Scheduled`. A separate activation decision is allowed only after fresh authoritative provider-route readback; its receipt chains to approval, and only then may the deployment become `Live` with `ACTUAL_START_AT` and `EXPIRES_AT` separated by exactly 604800000 milliseconds.

The gateway validates both receipts at runtime. Status strings alone fail closed. Any governed configuration, binding, agent/version, coverage, call limit, number hash, source revision, or fingerprint change invalidates approval and requires containment plus a fresh approval/activation chain. The operational predicates, ambiguity handling, readback, and rollback sequence are maintained beside the runtime in [`route-approval-control-plane-runbook.md`](../../src/zoho-catalyst/revenue-desk-call-runtime/route-approval-control-plane-runbook.md).

## Canonical Data Store generation

The shared call runtime uses:

- `RevenueDeskDeployments`
- `RevenueDeskConfigurationVersions`
- `RevenueDeskEventReceipts`
- `RevenueDeskCalls`
- `RevenueDeskNotifications`

`RevenueDeskConfigurationVersions` is the sole immutable version-history source. Deployments reference one exact version; every approval is version-specific; calls retain historical attribution. Nullable deployment authorization fields allow preapproval and scheduled states without inventing activation time, while nullable receipt binding fields preserve other receipt kinds. Engagement, client, and environment isolation are mandatory.

Form-specific stores remain separate:

- `RevenueLeakTestRequestFormSessions`
- `Form2SessionsV3Runtime`
- `Form2PrefillsV3`
- `Form2VerificationProofsV3`
- `Form2SubmissionsV3`

Supporting stores are limited to `CRMBillingOperations`, `AnalyticsSyncCheckpoints`, and `AnalyticsSyncOutbox` unless a separately justified sync-health or report-run store is proven necessary.

Legacy FreeTest stores, Form 2 v2 stores, duplicate sessions, and probe tables remain only through migration reconciliation and rollback rehearsal. Before any migration or deletion, every observed table must be classified by owner, purpose, generation, active readers/writers, and final disposition; source keys must be mapped to a canonical destination or approved quarantine; and fresh counts and deterministic sanitized digests must be captured. Zero rows alone never establish obsolescence. Superseded stores must be removed before the first Production deployment only after additive destination readback, source/runtime parity, Development E2E, and rollback evidence pass.

## Environment and traffic boundary

Development receives the complete synthetic E2E proof. Production receives the independently configured final-main artifact only as a dark deployment: independent credentials, no Retell number or webhook binding, no enabled recurring trigger, no real data, and no public or customer traffic. Dark-Production verification uses synthetic isolated inputs and must prove that every external call path remains fail-closed or explicitly disabled.

Production deployment is in scope. Production traffic activation is not.

## Analytics release boundary

The Analytics release must produce exactly five sanitized record types: `deployment`, `call`, `daily_metric`, `final_test_result`, and `conversion_status`. `ENGAGEMENT_TYPE` is the originating engagement and immutable dashboard partition: a free-test conversion remains `free_test`, while the distinct `TARGET_ENGAGEMENT_TYPE=paid_service` field records the destination commercial state. It must create and independently read back the exact dashboard titles **Free-Test Operations Dashboard** and **Customer Results Dashboard** under the [dashboard contract](../../src/zoho-catalyst/revenue-desk-analytics/config/dashboard-contract.json). The existing workspace and assets are migration evidence and may be reused only after private identity, schema, permission, share, row-count, and watermark readback; they are not overwrite or deletion authority.

Both dashboards remain internal. Public links, embeds, scheduled exports, and direct customer access are prohibited. Readiness also requires a five-record-type Development import with exact key/hash/count/watermark reconciliation, stale-data suppression, and cross-client isolation.

## Staged cleanup gate

No legacy runtime function, table, route, Job, or exclusive credential is deleted until its source and dependency review is preserved, every live route/Job/schedule/webhook/internal-caller binding is independently proven, and the exact pull-request head passes direct tests, Development E2E, migration reconciliation, rollback rehearsal, and a separately scoped destructive-action approval. Legacy status and approval rows are historical or quarantine evidence; they never authorize a canonical route.

After those gates:

1. remove `retell_events`, `retell_inbound_resolver`, and `process_retell_events` after reusable logic and tests are migrated; keep `retell_route_approval_control` stopped but recoverable until its full source export, dependency map, live binding proof, canonical approval/activation reconciliation, synthetic exercise, and rollback readback are complete;
2. remove `retell_free_test` and merge `retell_free_test_retry` behavior into `revenue_desk_call_worker`;
3. replace the historical `analytics_sync` implementation with canonical reviewed source and the exact `RevenueDeskAnalyticsJobs` binding;
4. remove legacy FreeTest stores, duplicate/probe Form stores, obsolete routes, Jobs, Crons, and exclusive credentials;
5. retain the standalone Form projects through pull-request merge, final-main Development parity, and dark-Production smoke testing, then delete them only after target-project cutover, row disposition, caller/route absence readback, sanitized evidence export, rollback rehearsal, and a separately scoped destructive-action approval; and
6. complete the [key-rotation contract](free-revenue-leak-test-key-rotation-contract.json) and [operator runbook](../runbooks/free-revenue-leak-test-key-rotation.md), revoke every superseded previous key or grant, prove old-key rejection with no overlap, and keep Production credentials independent.

The Client Portal Billing webhook gateway remains a separate trust boundary classified `required_hardening_pending`; it is not one of the exact six Revenue Desk functions. The active Billing webhook maps to its Development route, all three live revisions were privately scanned, and the candidate repository package is maintained at [`billing-webhook-gateway`](../../src/zoho-catalyst/billing-webhook-gateway). Visible delivery history contained no rows over one year, but silence is not deletion evidence. Creator Custom API/auth proof, immutable Development deployment/readback, route proof, duplicate-removal proof, webhook and fingerprint-secret rotation, least-privilege Connection-grant rotation, old raw-OAuth revocation, and final readback remain blocking. No gateway deployment, credential rotation, Production activation, or duplicate deletion is currently authorized.

## Release gate

`READY FOR RETELL AGENT TESTING ONLY` is permitted only after PR merge, final-main Development and dark-Production parity, six-function and two-pool inventory readback, Forms, CRM, Billing TEST, live hidden Billing catalog, Analytics, security rotation, replay safety, migration, cleanup, rollback, and synthetic E2E all pass with zero P0/P1 defects.

Only Retell simulations, voice/audio testing, latency and interruption testing, provider caller-experience testing, and prompt, wording, or conversation-flow refinement may remain.

## Operator-Led Field Setup And Retell V2 Source Candidate

The bounded field-setup and handoff decision is recorded in [ADR 0008](../adr/0008-bounded-free-test-human-handoff-and-operator-led-field-setup.md) and the [field-setup runbook](../runbooks/free-revenue-leak-test-field-setup.md).

This addition is source-only and currently `NOT_READY`. It keeps existing Form 1 and Form 2, creates no Form 3, adds no seventh Catalyst function, and treats the mobile web journey as a temporary operator-led session rather than a client portal. The journey uses a 256-bit single-use fragment nonce, digest-only storage, Gabriel's authenticated Development context, and a bounded Secure/HttpOnly/SameSite session. Guarded transitions require exact server-authoritative receipts and compare-and-set readback; the browser cannot supply authority. The default composition injects no prerequisite resolver and registers no routes. It cannot approve or activate a test.

Fresh sanitized CRM readback on 2026-08-25 confirmed that a private pre-cutover security-remediation gate remains open for the existing Form 1 launch path. Exact evidence remains private. The source replacement uses private install-time bindings and a parallel rollback-safe cutover plan; the live function remains unchanged. The CRM connector exposes no custom-button metadata operation, no safely identified synthetic Lead was available for record-specific conversion-option readback, and the available Catalyst connector denied the required project readback. The live hosted-client inventory and Forms/Catalyst route contracts therefore remain unresolved.

`call_gap_monitor_v1` remains unchanged. The distinct `call_gap_capture_handoff_v2` source remains `NOT_READY`; its capability profile is Draft, disabled, unwired, bound to no traffic environment, and not importable from public source. It defines exactly 17 analysis fields, an order-independent handoff state machine, authoritative intent/eligibility/destination/loop gates, required injected interfaces for a durable cumulative event ledger and one monotone Catalyst notification row, irreversible payload-null suppression for sensitive/nonactionable outcomes, 100 deterministic synthetic scenarios, and mutation/network guards. On 2026-08-25, authenticated read-only schema inspection confirmed the transfer-node/update contract and a private disabled candidate passed that schema locally. A strict minimizing parser accepts only the four documented transfer lifecycle event names, requires a private keyed fingerprint boundary and verified scope, and retains no raw target. The default source still supplies no live ledger, notification, delivery, route, webhook ingress, or active provider adapter; exact sanitized live event fixtures, Draft import/readback, authentication/delivery integration, and live behavior remain unverified.

Live install status is `NOT_AUTHORIZED`. Passing local source tests does not authorize a CRM install, Catalyst deploy/publish, Forms change, Retell import, call, number reservation, route change, message, Production traffic, or merge.
