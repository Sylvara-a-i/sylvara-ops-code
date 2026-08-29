# Deployment Log

## Purpose

This public log records sanitized deployment outcomes. It must not contain client names, production identifiers, endpoints, secrets, payloads, logs, exact runtime prompts, or sensitive configuration. Detailed evidence belongs in the approved private audit system.

A merged pull request is not a deployment. Record an entry only after an authorized deployment attempt or rollback attempt occurs.

## Current State

The latest live-system event is the 2026-08-29 Development CRM workflow containment: one superseded Form 2 rule was deactivated and independently read back, leaving both Form 2 rules inactive. The next trigger-repair payload was rejected by the installed connector before any provider request; the consumed packet stopped without retry or later writes. Lead Intake, Controls, and Limits therefore remained active with create-or-edit triggers, and the Lead scheduled action remained unchanged. The prior event was the Form 1 Development containment convergence: the exact dependency-free artifact and reviewed ten-variable map were read back, Gateway and assisted routes remained disabled, and the retained `Start Free-Test Request` CRM button remained bound only to the exact local fail-closed function. The button is not a remote route caller; no function, route, form, CRM-record, Retell, customer, or Production invocation occurred. Earlier Development events include the bounded 2026-08-28 Form 2 containment sequence, the six-function release-head convergences, the contained route and worker-binding work, and the datastore schema resolution. The production configuration events remain the 2026-08-14 Free-Test CRM workflow and Blueprint work and the 2026-08-05 CRM and Zoho Books configuration work. No customer record, function, route, submission, Retell agent, Billing, payment, customer communication, or Production runtime was invoked by the latest CRM containment event.

## 2026-08-29 — Development CRM Workflow Containment And Partial Repair

```text
Date (UTC): 2026-08-29
Environment class: Development CRM workflow configuration only
Change reference: pull request #49; source revision 0f661bf1ef68f585c9a131f0ffd1d342543227f5
Evidence reference: sanitized path src/zoho-crm/free-revenue-leak-test/evidence/development-workflow-repair-partial-execution-2026-08-29.json
Approval reference: exact owner-approved single-use workflow packet retained in the private task record; durably consumed, exhausted, and not reusable
Operator role: connector-first CRM read, bounded workflow update, and independent readback
Pre-deployment state: candidate Form 2 rule inactive; superseded Form 2 rule active; Lead Intake, Controls, and Limits active with create-or-edit triggers; Form 2 public surface disabled, submission webhook disabled, and zero submissions
Action: deactivate only the superseded Form 2 rule while retaining its scheduled-execution setting; then attempt the packet-bound Lead trigger and scheduled-action repair
Readback result: the superseded Form 2 rule deactivation succeeded and both Form 2 rules read inactive. The Lead payload was rejected by the connector input clamp before any provider request because the condition sequence number was absent and the legacy scheduled-period token was not accepted. No retry or later packet operation occurred. A final read-only reconciliation proved Lead Intake, Controls, and Limits unchanged.
Smoke-test result: configuration readback only; no CRM record, form submission, function, route, Retell agent, Billing, Analytics, Catalyst runtime, customer communication, or Production action occurred
Rollback target: retain both Form 2 rules inactive. Never reactivate either rule or retry the consumed packet. Use a fresh successor packet for trigger-only changes; defer scheduled-action deletion to a separately reviewed one-write packet.
Outcome: contained_partial_success_both_form2_rules_inactive_remaining_triggers_unchanged
Follow-up: use the version-2 trigger-only contract with exact fresh prestate, durable single-use claim, at most three writes, immediate readback after each write, and all-five-rule failure reconciliation
```

## 2026-08-29 — Form 1 Development Containment Convergence

```text
Date (UTC): 2026-08-29
Environment class: Development containment only
Change reference: pull request #49; source revision 57bd6e84e1c9ad802b0115e3e151f77f822844b2
Immutable artifact reference: sanitized path src/zoho-catalyst/evidence/free-revenue-leak-test-development-form1-containment-2026-08-29.json
Approval reference: exact single-use owner-approved Form 1 contained-state cleanup packet retained in the private task record; consumed, exhausted, and not reusable
Operator role: connector-first Catalyst and CRM read/write/readback; authenticated first-party Development console fallback only where the installed connectors lacked source-bundle or settings-page readback capability
Pre-deployment state: the reviewed dependency-free containment source, exact private prestate, disabled Gateway, inactive assisted routes, zero canonical Cron references, retained table counts, and exact local CRM function were verified before mutation
Action: update only revenue_leak_test_request_form to the reviewed containment artifact, remove exactly the approved superseded variables in bounded checkpoints, preserve the retained CRM button on the exact local fail-closed function, and perform no runtime invocation
Readback result: Node 24, 256 MB, source revision, dependency-free archive, reviewed ten-variable map, disabled Gateway, zero function triggers, zero canonical Cron references, retained table counts, absent Forms Prefill Webhook field, exact CRM function source, and exact retained button binding all matched. Private values, identifiers, routes, and configuration digests remain outside Git.
Smoke-test result: not invoked; zero function, route, form submission, CRM-record, Retell, customer, billing, payment, or Production actions occurred
Rollback target: preserve this exact local fail-closed CRM function and retained button binding while the remote CRM route caller, Forms Prefill Webhook, Gateway, and both assisted route generations remain disabled or unbound; never restore a pre-containment artifact or capability map
Outcome: form1_containment_exact_crm_button_retained_local_fail_closed_no_runtime_invocation
Follow-up: complete public native Form 1 acceptance separately; this event does not close Form 2, CRM, Billing TEST, Analytics, migration, final-main, dark-Production, or Retell gates
```

## 2026-08-28 — Form 2 Live-Surface Containment

```text
Date (UTC): 2026-08-28
Environment class: live Zoho Forms containment only; no customer or Production workflow
Change reference: source HEAD 605208993873ab1c53723ade1c5c87216fa67fc8
Evidence reference: sanitized path src/zoho-forms/free-revenue-leak-test/evidence/form2-containment-2026-08-28.json; private targets, identities, locations, authentication material, configuration values, and digests remain outside Git
Approval reference: three exact single-use approvals retained in the private task record; the first two attempts and the final confirmation packet are consumed, exhausted, and non-reusable
Operator role: bounded first-party Forms containment with independent and anonymous readback; no value entry, submission, or runtime invocation
Pre-deployment state: exact private target matched; historical review had already established that Form 2 reconfiguration and acceptance gates were blocked
Action: preserve dashboard Disabled; attempt submission-webhook disablement once by toggle alone and once by toggle plus Save; stop after each failed persistence result; then use a separately approved native-confirmation packet without Save
Readback result: dashboard Disabled persisted. The first two webhook attempts did not persist. The final native confirmation persisted Disabled. Anonymous readback matched the privately retained disabled message with zero visible fields and zero submit controls. No owner email was sent. The complete private destination, content, authentication, connection, 38-mapping, and custom-parameter configuration shape remained digest-equal without publishing private values or digests.
Smoke-test result: not invoked; no value entry, form submission, webhook test, function, route, CRM, Billing, Analytics, Catalyst, Retell, customer, or Production action occurred
Rollback target: exact private prestate remains retained outside Git; no rollback was required because the bounded desired containment state persisted without changing the private configuration shape
Outcome: bounded_live_surface_contained_reconfiguration_and_acceptance_blocked
Follow-up: do not reuse any consumed approval; keep every Form 2 contract, authentication, destination, caller, runtime, and acceptance gate blocked until a fresh exact packet and independent readback close it
```

## 2026-08-28 — Revenue Desk Development Release-Head Convergence

```text
Date (UTC): 2026-08-28
Environment class: development
Change reference: pull request #49; source revision 288a93c7773acaf82fab277702e6b4e3d7354564
Immutable artifact reference: sanitized path src/zoho-catalyst/evidence/free-revenue-leak-test-development-pr-head-convergence-2026-08-28-288a93c.json
Approval reference: exact single-use owner-approved Development release packet retained in the private task record; consumed, exhausted, and not reusable
Operator role: connector-first Catalyst identity, prestate, configuration write, and independent readback; authenticated first-party Development console fallback only for source-bundle upload and archive pullback because the installed connectors exposed neither operation
Pre-deployment state: the clean approved source revision, all six predecessor definitions and exact private maps, exact predecessor archives, disabled API Gateway, and zero canonical Cron references were verified before the first durable write
Action: build the six exact source bundles, upload them in consumer-first order, pull each bundle back, replace only SOURCE_REVISION in each retained full private map, and perform fresh bounded infrastructure readback; do not invoke any function, Job, route, Cron, Retell, customer, billing, payment, or Production workflow
Packaging result: upload path sets matched the predecessor path sets. Tests and environment files were excluded. Consumer-first archive file counts were 220/218/227/27/4/16 for CRM, request form, setup form, gateway, worker, and Analytics.
Readback result: all six definitions matched Node 24, 256 MB, the approved source revision, their exact retained private maps apart from the approved revision change, and every uploaded archive path and file byte. Consumer-first environment-variable counts were 30/30/34/31/28/7. Form 2 remained stub-only, the worker remained Development/dry-run notification, CRM paid preparation and compatibility probing remained false, and Analytics remained disabled.
Infrastructure result: API Gateway remained disabled and returned the positive disabled signal without route data. One observed Cron retained zero canonical name, pool, or function references. All thirteen canonical tables were present exactly once among thirty-five observed tables, and both canonical Job pools were present exactly once among four observed pools. Table schemas, rows, Job-pool function targeting, and runtime behavior were not exercised.
Smoke-test result: not invoked; this packet proved definition and configuration convergence only
Operator-event containment: a stale row action opened a delete confirmation and was canceled without a destructive confirmation. A hidden input did not open a chooser and caused no write. An editor-level file-upload attempt was stopped after immediate pullback proved the exact predecessor remained; no configuration write had begun. One Update-dialog validation attempt was not treated as success; the dialog was reopened, Node 24 and 256 MB were freshly verified, and only the later exact archive pullback was accepted.
Rollback target: exact predecessor source archives and configuration maps remain preserved privately; no rollback was invoked or rehearsed
Outcome: six_function_release_head_source_and_configuration_convergence_exact_ingress_disabled_no_runtime_invocation
Follow-up: use a fresh exact packet for the smallest non-Retell synthetic Development lifecycle, prove Job-pool targeting and typed invocation before any submission, complete the remaining system acceptance and rollback gates, and keep Retell work in its separate task
```

## 2026-08-28 — Revenue Desk Development Release-Candidate Convergence

```text
Date (UTC): 2026-08-28
Environment class: development
Change reference: pull request #49; source revision e1da1bc3457e506faf64c71db38869c8b26c1bbc
Immutable artifact reference: sanitized path src/zoho-catalyst/evidence/free-revenue-leak-test-development-pr-head-convergence-2026-08-28.json
Approval reference: exact single-use owner-approved Development release packet retained in the private task record; consumed, exhausted, and not reusable
Operator role: connector-first Catalyst prestate, configuration write, and independent readback; authenticated first-party Development UI fallback only for source upload and archive pullback because the installed connectors exposed neither operation
Pre-deployment state: the exact clean source revision, six function prestates, private current and predecessor artifacts, private current and predecessor maps, disabled API Gateway, and zero canonical Cron references were verified before the first write
Action: upload the six exact source bundles in consumer-first order, pull each bundle back, replace only the six approved private configuration maps, and perform bounded poststate infrastructure readback; do not invoke any function, Job, route, Cron, Retell, customer, billing, payment, or Production workflow
Smoke-test result: not invoked; this packet proved definition and configuration convergence only
Readback result: all six definitions matched Node 24, 256 MB, exact source revision, exact approved private maps, and exact uploaded archive path sets and file contents. Environment-variable counts were 30/34/31/28/30/7 in canonical function order. Form 2 remained stub-only, the worker remained Development/dry-run notification, CRM paid preparation and compatibility probing remained false, and Analytics remained disabled. API Gateway ended disabled, so its connector returned the positive disabled signal without route data; this packet does not claim a current route count. Zero canonical Cron references remained, all thirteen canonical tables were present among thirty-five observed tables, and both canonical Job pools were present among four observed pools. Table schemas, table rows, Job-pool function targeting, and runtime behavior were not exercised.
Operator-event containment: the first file chooser timed out before selecting a file and caused no write. A stale row action later opened a delete confirmation; no destructive confirmation text was entered, Confirm was never clicked, Cancel was clicked, and no function was deleted or changed.
Rollback target: exact predecessor source archives and configuration maps remain preserved privately; no rollback was invoked or rehearsed, and deleting the worker's complete map back to empty remains unproven
Outcome: six_function_source_and_configuration_convergence_exact_ingress_disabled_no_runtime_invocation
Follow-up: use a fresh exact packet for the smallest non-Retell synthetic Development lifecycle; prove a typed invocation channel rather than enabling Gateway merely to compensate for an inadequate connector; complete Forms, CRM, Billing TEST, Analytics, migration, reconciliation, replay, isolation, rollback, final-main, and dark-Production gates; keep Retell work in its separate task
```

## 2026-08-28 — Revenue Desk Development Worker UI Packet Consumed And Exactly Rolled Back

```text
Date (UTC): 2026-08-28
Environment class: development
Change reference: pull request #49; installed source revision remained aab7c18c27f4ff5e1468da51eae433ede9b852f6
Evidence reference: sanitized UI rollback record; private packet material, variable names and values, identifiers, endpoints, paths, and raw provider responses remain outside Git
Approval reference: exact single-use owner approval retained in the private task record; consumed by the first successful variable save, exhausted, and not reusable
Operator role: bounded first-party Catalyst Development configuration fallback with preauthorized exact rollback and independent Audit readback; no runtime invocation
Pre-deployment state: revenue_desk_call_worker was a Node 24 Job function at 256 MB with exactly zero environment variables; Gateway was disabled and there were zero canonical Cron references
Action: create the exact approved 28-variable Development map serially, stop on the first provider-flow mismatch, and remove only variables created by the packet in reverse order; do not perform the page-level configuration save, invoke any runtime surface, mutate Gateway, touch Retell, or perform a customer or Production action
Execution result: the first variable save succeeded and consumed the approval. The next Create control was unavailable, so execution stopped immediately without another save or retry.
Rollback result: the operator opened the exact created row action, removed only that one variable, confirmed the row absent, and confirmed the normal Create control returned. No other variable or configuration was changed.
Readback result: independent Catalyst Audit readback proved exactly zero worker variables, memory unchanged at 256 MB, Gateway disabled and fail-closed without a route payload, and zero canonical Cron references.
Smoke-test result: not invoked; the operator performed no route, function, Job, or Cron invocation and no Retell-agent development, test, simulation, call, publish, customer action, or Production action.
Outcome: single_variable_created_then_exactly_rolled_back
Follow-up: do not retry under the consumed approval. Finish the immutable PR-head release first, then use a fresh exact packet to bind the complete map once to the exact read-back artifact because SOURCE_REVISION is artifact-bound.
```

## 2026-08-27 — Revenue Desk Development Worker Binding Attempt Consumed And Contained

This entry supersedes the earlier route-continuation record only on the status of its then-future worker-binding approval. The route observations in that record remain historical evidence. A later fresh connector readback independently confirmed that Gateway remained disabled and failed closed without returning a route payload.

```text
Date (UTC): 2026-08-27
Environment class: development
Change reference: pull request #49; canonical source revision aab7c18c27f4ff5e1468da51eae433ede9b852f6
Evidence reference: sanitized worker-binding containment record; private packet material, environment names and values, identifiers, endpoints, paths, and raw provider responses remain outside Git
Approval reference: exact single-use owner approval retained in the private task record; consumed by the one attempt, exhausted, and not reusable
Operator role: bounded Development worker environment-map replacement with independent definition readback; no runtime invocation
Pre-deployment state: revenue_desk_call_worker was a Node 24 Job function at 256 MB with exactly zero environment variables
Action: attempt once to replace only the exact zero-variable Development worker map with the approved 28-variable private map and independently read back the definition; do not retry, invoke any runtime surface, mutate Gateway, touch Retell, or perform a customer or Production action
Execution result: the operator-visible orchestration result was truncated before a deterministic provider-write or conditional in-packet rollback result was available, and the expected private in-packet execution-status record was unavailable for reconciliation. Neither sequence is claimed.
Readback result: independent worker-definition readback showed revenue_desk_call_worker remained a Node 24 Job function at 256 MB with exactly zero environment variables. The approved map did not persist, no partial map was present, and the exact empty prestate was preserved or restored.
Smoke-test result: not invoked by the operator; provider-complete post-attempt Job and direct-caller inventory remains unavailable, so a transient active binding or invocation cannot be excluded. The operator performed no route, function, Job, or Cron invocation and no Retell-agent development, test, simulation, call, publish, customer action, or Production action.
Gateway evidence: the worker attempt performed no Gateway mutation. A later independent Catalyst Audit readback captured at `2026-08-28T00:02:44.582Z` confirmed API Gateway disabled and fail-closed without returning a route payload.
Rollback target: already contained at the exact empty worker map; no additional rollback write was needed during reconciliation
Outcome: single_use_worker_binding_attempt_consumed_non_persisted_and_contained
Follow-up: do not retry under the consumed approval. Before any later worker write, obtain a fresh exact single-use packet bound to a fresh zero-variable prestate and independently revalidate the disabled-Gateway state; keep Retell and runtime invocation out of scope.
```

## 2026-08-27 — Revenue Desk Development Gateway Continuation Completed And Contained

This entry supersedes only the route-count, gateway-key, and immediate route-follow-up conclusions in the earlier 2026-08-27 six-function entry. That earlier entry remains historical evidence of its bounded execution.

```text
Date (UTC): 2026-08-27
Environment class: development
Change reference: pull request #49; canonical source revision aab7c18c27f4ff5e1468da51eae433ede9b852f6
Evidence reference: exact private execution/readback record plus the sanitized current-state reconciliation; secrets, private paths, digests, identifiers, endpoints, and raw provider responses remain outside Git
Approval reference: exact single-use owner approval retained in the private task record; consumed and not reusable
Operator role: scoped first-party Catalyst Gateway configuration with connector-first prestate and exact poststate readback; browser control was used only for the Gateway UI operations the connector did not expose
Pre-deployment state: Gateway was disabled; the two canonical routes established by the one-route deployment and the separate RETELL_EVENTS creation/remediation recorded below were preserved; the worker had exact zero-variable UI readback and was unconfigured; no call ingress was authorized
Action: temporarily enable Development Gateway, preserve the two existing canonical routes, create the remaining ten canonical routes serially, read back the complete route inventory, retrieve and validate the Development ZCFKEY privately, then restore Gateway to disabled; do not invoke a route, function, Job, Cron, Retell workflow, customer workflow, or Production workflow
Smoke-test result: not invoked; route configuration actions occurred, but the operator performed no route, function, Job, or Cron invocation and no Retell-agent test, call, simulation, customer action, or Production action as part of this execution
Readback result: exactly twelve unique canonical Development routes matched their approved full route tuples. The Development ZCFKEY was retrieved and format-validated only in private runtime handling; no value or related private metadata was printed or committed. Gateway ended disabled, its UI state independently showed disabled, and connector access failed closed without returning route data. Bounded prior-24-hour access-log and application-log reads queried after final disabled-Gateway readback returned zero records for each of the six canonical functions; exact UTC window bounds were not retained. Both canonical Function Job pools remained exact at 512 MB. Their provider metadata exposed no function-target binding attribute. The complete current Cron inventory contained one Cron and zero references to a canonical function or canonical pool. The first-party All Time Jobs view showed fifteen rows across all statuses, no pagination controls, and zero canonical-pool references. All nine required Connections were connected with their exact approved scopes. The worker UI independently showed exactly zero variables.
Evidence limitation: exact route parity proves configuration only; it does not prove route, function, Job, caller, webhook, or end-to-end runtime acceptance. The negative function-log evidence is limited to that provider-relative prior-24-hour window and is not exactly reproducible without retained UTC bounds. The complete visible All Time Jobs UI result has zero canonical-pool references, but provider-complete all-history Job inventory, Job-pool function targeting, and direct caller/webhook inventory remain unproven. The worker remains zero-variable, unconfigured, statically fail-closed, and was not invoked as part of this execution.
Rollback target: already contained; keep Development Gateway disabled, the worker unconfigured, canonical Cron references absent, Retell and customer traffic dark, and Production untouched. Any worker configuration, target binding, invocation, Retell action, customer action, or Production action requires its own verified prerequisites and scoped authority.
Outcome: twelve_canonical_routes_exact_gateway_disabled_private_key_contained_no_runtime_acceptance; no Retell-agent, customer-workflow, or Production change occurred
Follow-up: establish a provider-verifiable Job-target and direct caller/webhook inventory contract before any worker write or Job submission; keep live ingress dark; complete synthetic Development acceptance, migration, cleanup, rollback, final-main, and dark-Production proof without treating route installation as runtime acceptance; resume Retell work only in its separate task
```

## 2026-08-27 — RETELL_EVENTS Development Route Created, Contained, And Remediated

This entry bridges the one-route state in the six-function entry below to the two-route prestate used by the later ten-route continuation above.

```text
Date (UTC): 2026-08-27
Environment class: development
Change reference: pull request #49; approved canonical route contract at the recorded source revision
Evidence reference: exact private prestate, creation, containment, remediation, and full-tuple readback record; private identifiers, endpoints, approval material, and raw provider responses remain outside Git
Approval reference: the initial route packet and the fresh post-containment remediation packet were separately approved, single-use, consumed, and exhausted; neither is reusable
Operator role: bounded first-party Catalyst route configuration with independent connector readback
Pre-deployment state: exactly the previously approved RETELL_INBOUND route existed and Gateway was disabled
Action: temporarily enable Development Gateway, preserve the existing route, create RETELL_EVENTS under the initial single-use packet, contain the resulting duplicate-separator target defect, then use the separately approved fresh remediation packet to correct only that defect without deleting or recreating either route; restore Gateway to disabled after each bounded execution
Smoke-test result: not invoked; route configuration actions occurred, but the operator performed no route, function, Job, or Cron invocation and no Retell-provider, customer, or Production workflow action as part of this execution
Readback result: the first execution ended contained after exact readback identified the target defect. The remediation preserved the route identity, method, source, authentication, throttles, and target binding while correcting only the approved duplicate separator. Independent full-tuple readback then proved both canonical routes exact, and Gateway ended disabled with connector access failing closed.
Evidence limitation: two-route configuration parity did not prove runtime acceptance, worker binding, caller/webhook absence, or end-to-end behavior
Rollback target: already contained; keep Gateway disabled, preserve both exact canonical routes without invocation, and keep Retell, customer, and Production traffic dark
Outcome: second_route_created_defect_contained_exactly_remediated_two_routes_exact_gateway_disabled_no_invocation
Follow-up: proceed only through a fresh, exact, single-use continuation packet for any additional route configuration
```

## 2026-08-27 — Revenue Desk Canonical Development Definitions Deployed Without Invocation

```text
Date (UTC): 2026-08-27
Environment class: development
Change reference: pull request #49; source commit aab7c18c27f4ff5e1468da51eae433ede9b852f6
Immutable artifact reference: sanitized path src/zoho-catalyst/evidence/free-revenue-leak-test-development-six-function-deployment-2026-08-27.json
Approval reference: explicit owner approval retained in the private task record; exhausted after this verified poststate and not reusable
Operator role: connector-first Catalyst discovery and independent metadata/configuration readback; because the connector exposed no source/archive download operation, the authenticated first-party Catalyst UI Download fallback supplied the six archive pullbacks; later provider reads reconciled bounded log, scheduler, pool, function-inventory, and provider-neutral Retell boundary status only
Pre-deployment state: all six canonical definitions existed at an earlier reviewed revision; API Gateway was disabled; no API Gateway route inventory was available while disabled; the worker had zero variables; and the remaining five functions had bounded Development maps that required convergence or minimization
Action: deploy the exact aab7c18 revision to all six canonical Development definitions; independently pull back all six archives; read back the exact bounded Development maps; keep Form 2 stub-only, the gateway dry-run, CRM paid preparation and compatibility probing false, Analytics disabled, and the unconfigured worker fail-closed; temporarily enable API Gateway, prove the zero-route prestate, create and independently read back the first exact approved route, stop before a second save when the provider modal flow changed, then immediately restore Gateway to disabled; perform no function, Job, route, Retell, customer, or Production invocation
Smoke-test result: not invoked; the operator performed no function, Job, compatibility probe, Retell call, Retell simulation, customer workflow, or Production workflow invocation
Readback result: all six canonical definitions reported Node 24, 256 MB, and the exact aab7c18 source-revision stamp; all six Catalyst-pulled archives matched their exact uploaded archives byte for byte by SHA-256 and length. Environment-variable counts were 30/34/31/0/30/7 in canonical function order. Form 1, Form 2, the gateway, CRM, and Analytics matched their approved private maps exactly without publishing values. Form 2 remained stub-only, the gateway remained dry-run, CRM paid preparation and compatibility probing remained false with its rotated artifact-bound runtime proof read back exactly, and Analytics remained disabled. The worker remained unconfigured and therefore fail-closed by static contract; the operator performed no runtime fail-closed invocation. API Gateway initially contained zero routes. Exactly `RETELL_INBOUND` was created, and independent audit readback proved a one-route inventory with its approved method, target, authentication, and throttle contract exact. No second save was attempted after the modal-flow change; the operator did not update, delete, or invoke a route; and Gateway was immediately restored to disabled with independent readback. The operator performed no function, Job, route, Retell, customer, or Production invocation.
Evidence limitation: exact six-archive upload parity and exact private-map comparison do not prove final-main parity, twelve-route parity, worker runtime readiness, or lifecycle acceptance. The worker's fail-closed conclusion is static-contract evidence because the operator did not invoke the Job. The earlier bounded provider-log snapshot does not cover the later aab7c18 convergence; current-revision route/function invocation inventory, caller inventory, and callable-surface inertness remain unproven. Archive digests, private paths, identifiers, routes, prompts, topology, configuration values, and raw provider responses remain outside Git.
Rollback target: API Gateway is already restored to disabled; keep the retry Cron absent, Form 2 stub-only, the gateway dry-run, Analytics disabled, CRM paid/probe gates false, and the worker uninvoked. Private predecessor maps and the current exact archives remain outside Git. Any future route creation, worker binding, invocation, source restore, deletion, Retell action, customer workflow, or Production action requires fresh scoped authority and independent readback.
Outcome: canonical_revision_and_sanitized_configuration_readback_exact_one_route_created_ingress_disabled_runtime_acceptance_pending; the operator performed no Retell-agent, customer-workflow, or Production change
Follow-up: bind and independently read back the worker before any Job submission; preserve the one exact route while creating and reading back the remaining eleven routes only under a fresh scoped packet and revalidated provider flow; complete synthetic Development lifecycle, migration, rollback, cleanup, and final-main parity before activation; move the phone webhook only in the separate Retell task after its storage, notice, media/DTMF, route, and rollback controls pass
```

The provider log scope and seven-day Development retention used for this bounded readback were reverified on 2026-08-27 against the official [Catalyst Logs documentation](https://docs.catalyst.zoho.com/en/devops/help/logs/introduction/). The generic deployment flag is preserved without extrapolation because Catalyst treats [Development and Production as separate environments](https://docs.catalyst.zoho.com/en/deployment-and-billing/environments/development-environment/).

## 2026-08-26 — Revenue Desk Development Packet A Superseding Resolution

This entry supersedes only the unresolved architecture and Job-pool status conclusions in the partial-execution entry below. That earlier entry remains verbatim historical evidence.

```text
Date (UTC): 2026-08-26
Environment class: development
Change reference: docs/adr/0008-single-key-analytics-outbox-fence.md
Evidence reference: sanitized path src/zoho-catalyst/evidence/free-revenue-leak-test-development-packet-a-resolution-2026-08-26.json
Approval reference: explicit finite owner approval retained in the private task record; exhausted after verified poststate and not reusable
Operator role: scoped typed Job-pool change role and bounded first-party Console fallback, each with independent connector readback
Pre-deployment state: verified; the current table count was 35, the outbox held 307 legacy rows with zero version-2 rows and zero nonnull OUTBOX_KEY rows under the exact single-key contract, the checkpoint table held 10 legacy rows with zero version-2 rows and its exact schema, and both canonical Job pools were absent
Action: configuration change and disposable proof; confirm that the retained outbox rejected both bounded second-key sequences without changing a retained row, prove nullable-unique behavior and same-key concurrency on two disposable tables, delete both proof tables with absence readback, retain the existing unique OUTBOX_KEY as the sole provider-version fence, and create exactly the two canonical Function Job pools at 512 MB
Smoke-test result: bounded proof passed; simultaneous same-key/different-payload writes produced exactly one durable owner, exact replay was rejected without changing that owner, no canonical function was deployed by this packet, no Job was submitted, and no Retell or Production behavior was exercised. The packet created no Cron but did not prove complete scheduler or caller absence.
Readback result: matched; the table count returned from 36 to 35 with both disposable table names absent, both retained Analytics row counts and zero version-2/non-null-key counts were unchanged, the checkpoint schema remained exact, and both canonical pools existed as Function/512. Function-pool metadata does not bind a function target; Packet A did not prove a Job target or complete Cron/caller inventory. The later 2026-08-27 complete Cron inventory separately found zero canonical-pool Cron references.
Rollback target: leave both generic pools unchanged and submit no Job; deletion or any other destructive rollback requires separate scoped approval and independent absence readback
Outcome: succeeded for the bounded Packet A resolution; temporary disposable tables and synthetic proof rows were created and deleted, while no retained or canonical business record, function, route, Retell agent, or Production state was changed
Follow-up: commit and verify the coherent single-key packages, build immutable supported-runtime artifacts, prove private variables and Connections, deploy functions inertly, read back exact source/runtime identity, and complete synthetic Development reconciliation before any binding or activation
```

## 2026-08-26 — Revenue Desk Development Packet A Partial Execution And Containment

```text
Date (UTC): 2026-08-26
Environment class: development
Change reference: pull request #49; approved source commit d68d589c455618756ae9ed812e3d27ce059eecb4
Immutable artifact reference: src/zoho-catalyst/evidence/free-revenue-leak-test-development-packet-a-execution-2026-08-26.json
Approval reference: explicit owner approval retained in the private Codex task
Operator role: first-party Catalyst UI fallback for the untyped column-write gap, with independent Sylvara Catalyst Audit connector readback
Pre-deployment state: verified; the configuration-version table was empty and lacked exactly seven approved columns, the Analytics outbox contained 307 legacy rows and lacked PROVIDER_VERSION_KEY, and both requested Job pools were absent
Action: configuration change; create and read back the seven approved configuration-version columns, then attempt the approved nullable unique PROVIDER_VERSION_KEY addition before any Job-pool creation
Smoke-test result: blocked; no function, route, Job, caller, migration, or runtime was bound or exercised
Readback result: matched for the seven successful columns; the configuration table remained empty with 23 total columns, the outbox attempt created no column, the fully paginated outbox row count remained 307 with no row mutation attempted, permissions and scopes remained unchanged, and neither requested Job pool existed
Rollback target: leave the successful additive columns unused in the empty table; no destructive rollback is authorized or required
Outcome: contained partial success; the packet stopped on the outbox-column mismatch and did not invoke either typed Job-pool creation
Follow-up: verify a provider-supported rollback-safe path for adding the nullable unique column to the nonempty table, capture fresh prestate, and obtain new scoped approval before any retry or remaining Packet A write
```

## 2026-08-14 — Zoho CRM Free-Test Workflows And Deal Blueprint

```text
Date (UTC): 2026-08-14
Environment class: production
Change reference: pull request #22; merged commit cf96445f04bc516b0e75be4c9ab40fd8fa996102
Immutable artifact reference: commit cf96445f04bc516b0e75be4c9ab40fd8fa996102 and the fingerprints recorded in that revision’s 2026-08-14 CRM snapshot
Approval reference: owner authorization retained in the private task record
Operator role: separately scoped CRM automation roles with independent CRM Audit readback
Pre-deployment state: exact organization identity and current workflow, Blueprint, module, field, layout, picklist, and pipeline metadata verified privately
Action: configuration change; update and activate the Form 1 intake-review workflow; create and activate the Deal Form 2 submission, Deal control-initialization, and Deal limit-initialization workflows; and create and activate the Revenue Desk Free Test Delivery Blueprint
Smoke-test result: blocked for a runtime path; all four new workflows report no prior execution and the Blueprint has zero enrolled records, so no task, initialization, Lead conversion, Form submission, or transition was proven end to end
Readback result: four active workflows and one active eight-state, twelve-transition Deal Blueprint observed; all approved CRM destination fields and Lead-conversion mappings are present, while the Zoho Forms/controller implementation remains unverified
Rollback target: captured private prestate only; inactive drafts are explicitly excluded as rollback targets, and any deactivation or replacement requires fresh record-count, state-impact, and replacement readback approval
Outcome: configuration present; runtime acceptance blocked because Deal creation requires an unmapped `Type`, three unconditional Blueprint inputs conflict with valid Form 2 conditions, every transition has no after-action, Stage can drift from Test Status, safe-stop and Closed Won evidence are under-controlled, and Deal submission IDs are not metadata-unique
Follow-up: set and read back `Type = Initial Sale` during Deal creation; reconcile the three Form 2/Blueprint requirements; define Stage/Test Status, stop/rollback, and Closed Won controls; verify Forms/controller security and replay behavior; then run a separately approved synthetic canary while keeping native Lead conversion human-approved
```

## 2026-08-14 — Zoho CRM Free-Test Idempotency, Type Normalization, And Safe-Stop Remediation

```text
Date (UTC): 2026-08-14
Environment class: production
Change reference: owner-authorized same-day remediation; repository publication pending
Immutable artifact reference: updated 2026-08-14 CRM metadata and effective-automation snapshots
Approval reference: owner authorization retained in the private task record
Operator role: separately scoped CRM automation roles with independent CRM Audit readback
Pre-deployment state: both Deal submission-ID fields were not unique; the create-only limits workflow had two field updates; Close Live Test required only a loss reason; every Blueprint transition had no after-action
Action: configuration change; make Deal Intake Submission ID and Setup Form Submission ID case-insensitive unique; add Type = Initial Sale to the existing create-only limits workflow; require Test End At, Test End Reason, and Rollback Completed At during Close Live Test; and test a bounded Blueprint status-action association
Smoke-test result: blocked for an end-to-end runtime path; no record submission, workflow execution, native conversion, or Blueprint transition was exercised
Readback result: the two uniqueness changes, three-action limits workflow, and four-field Close Live gate matched; Blueprint action association was rejected, all twelve transitions still had no after-action, and two unassociated inert Setup Pending field-update definitions remained
Rollback target: captured private prestate for the two field uniqueness settings, workflow action set, transition inputs, and unassociated diagnostic definitions
Outcome: succeeded for the bounded uniqueness, normalization, and safe-stop changes; the Blueprint action attempt failed closed without association. The Type update is post-create normalization and cannot satisfy pre-save validation.
Follow-up: supply Type during Deal creation; reconcile Form 2 and Blueprint requirements; use a supported native Blueprint after-action path; separately approve cleanup of the two inert definitions; tighten Closed Won; verify controller replay behavior; then run a separately approved synthetic canary
```

## 2026-08-14 — Zoho CRM Confirm Authorization Criteria Hardening Attempt

```text
Date (UTC): 2026-08-14
Environment class: production
Change reference: owner-authorized bounded remediation attempt; repository publication pending
Immutable artifact reference: immediate post-attempt Blueprint readback retained in the private audit record
Approval reference: owner authorization retained in the private task record
Operator role: separately scoped CRM automation role with independent CRM Audit readback
Pre-deployment state: Confirm Authorization used the signed-status criterion, required five during-transition inputs, and had no after-actions
Action: attempt to require signed status plus confirmed authority and accepted scope in the transition criterion
Smoke-test result: failed; Zoho rejected the transition update during validation
Readback result: unchanged; the signed-status-only criterion, five required inputs, and absent after-actions remained intact
Rollback target: not applicable because Zoho accepted no configuration change
Outcome: contained with no partial mutation
Follow-up: do not retry until a supported transition-criteria contract and rollback-safe test path are verified
```

## 2026-08-05 — Zoho CRM Lead Schema, Layout, And Address Migration

```text
Date (UTC): 2026-08-05
Environment class: production
Change reference: pull request #18; source commit 7c6d1eacaafabfbc6c785a454e03a559999779d6
Immutable artifact reference: modules 5b21ffef4d7a0434e612d039400a446b8fdbc9eff2ccdd6925c58332b6fcbb3d; fields 228e92a52009ab1556a70f51c218829807d73eed35ab89452125f808ab94176a; mappings 05b2f1c8d143105f76bfda2aa19f4cf6f0126a8e799f8e951ff118890ea22c09
Approval reference: not durably archived; task-local owner-approval evidence is insufficient for later audit
Evidence limitation: private prestate and readback are not durably archived; treat provenance as incomplete and do not use this entry to authorize a repeat or rollback
Operator role: scoped CRM change role with separate audit readback
Pre-deployment state: verified for the affected Leads, Contacts, Accounts, Deals, layouts, fields, picklists, mappings, and populated legacy address values
Action: configuration change; polish Leads, update Industry and Rating choices, organize layouts, add supported help text, and migrate populated legacy address values into the consolidated Address field
Smoke-test result: passed for supported mutations; Zoho-managed compound, coordinate, and nearby-address components that rejected direct help-text mutation remained unchanged
Readback result: matched for completed metadata changes and every migrated populated address; legacy schema fields were retained, and their migrated values were cleared after readback
Rollback target: captured private prestate; restore prior labels, choices, help text, and layout placement, and reverse-copy consolidated components into retained legacy fields if reconciliation requires it
Outcome: succeeded for the scoped schema, layout, and address work
Follow-up: historical recommendation at the time of this event. The 2026-08-14 readback shows the four unsafe mappings absent and the current fields/mappings in the dated 2026-08-14 package; use that package rather than this superseded follow-up. Native conversion remains human-approved and runtime automation acceptance remains incomplete.
```

## 2026-08-05 — Zoho Books Chart Initial Attempt And Containment

```text
Date (UTC): 2026-08-05
Environment class: production
Change reference: codex/sylvara-chart-of-accounts-audit; repository publication pending
Immutable artifact reference: approved target SHA-256 fef217939293aef4ba59a4398da7a9365b81b619814ae964cfedd2acafac9ad9
Approval reference: explicit owner approval retained in the private Codex task
Operator role: Sylvara Books Controller with separate Audit readback
Pre-deployment state: verified; 72 active and zero inactive accounts
Action: configuration change; initial serialized create-set validation
Smoke-test result: failed closed when the single-account read omitted a mutability flag supplied by the complete-chart read
Readback result: matched after 14 known-created accounts were marked inactive
Rollback target: the known-created account set from the immutable approved plan
Outcome: contained; active-state exposure was reversed, but the 14 inactive rows meant this was not an exact return to the 72-active/zero-inactive prestate
Follow-up: reconcile the two Audit response schemas before any retry
```

## 2026-08-05 — Zoho Books Chart Deployment Completion

```text
Date (UTC): 2026-08-05
Environment class: production
Change reference: codex/sylvara-chart-of-accounts-audit; repository publication pending
Immutable artifact reference: approved target SHA-256 fef217939293aef4ba59a4398da7a9365b81b619814ae964cfedd2acafac9ad9
Approval reference: explicit owner approval retained in the private Codex task
Operator role: Sylvara Books Controller with separate Audit readback
Pre-deployment state: verified after full-chart mutability reconciliation; the contained 14-account set remained known and unused
Action: configuration change; reactivate contained creates, complete 18 creates and 34 existing-account updates, then inactivate 11 custom accounts that passed the documented scoped eligibility checks
Smoke-test result: passed
Readback result: every mutation received Audit readback; the initial response-schema omission was contained and reconciled; final complete active/inactive chart matched
Rollback target: captured private prestate; updates reverse to before-values, new accounts inactivate, retired accounts reactivate
Outcome: succeeded; final chart contained 79 active and 11 inactive accounts
Follow-up: bank/clearing reconciliation, tax-engine configuration, and all transaction-level work remain deferred
```

## 2026-08-05 — Zoho Books Schedule C Hierarchy Amendment

```text
Date (UTC): 2026-08-05T19:30:57Z
Environment class: production
Change reference: codex/sylvara-chart-of-accounts-audit; repository publication pending
Immutable artifact reference: Schedule C successor target SHA-256 6f3004a0c56aba7436a37298cc011b8345288082976b17a8211436f2b393c936
Approval reference: owner standing chart-only authorization and express instruction to use federal tax-form parents retained in the private Codex task
Operator role: Sylvara Books Controller with separate Sylvara Books Audit readback
Pre-deployment state: verified; 79 active and 11 inactive accounts in the same active paid organization with Admin role
Action: configuration change; create four accounts and update 18 existing editable accounts to use Schedule C category parents
Smoke-test result: passed after one stopped payload-omission correction; the Internet code field was independently identified as the only omitted target field and then applied alone
Readback result: every mutation matched independent Audit readback; final complete active/inactive chart and unchanged non-target reconciliation matched
Rollback target: captured private prestate; reverse the 18 updates and inactivate Business Lodging before the three new roots
Outcome: succeeded; final chart contained 83 active and 11 inactive accounts with maximum hierarchy depth two
Follow-up: reverify the final Schedule C for the filing year; configure any separate management gross-margin report only after its reporting purpose is approved
```

Account activity and historical report-presentation effects were not reconciled in the chart-only amendment. No claim of zero historical financial activity is made.

## 2026-08-05 — Zoho Books Tax-Preparer Description Correction

```text
Date (UTC): 2026-08-05T20:35:31Z
Environment class: production
Change reference: codex/finalize-tax-preparer-chart; repository publication pending
Immutable artifact reference: final sanitized register SHA-256 e24ea2795d2bcb11828d510e5c6028a1f74ad92b1d5820a6a036c7742c695e3a
Approval reference: owner standing chart authorization and current instruction to complete the final tax-preparer chart retained in the private Codex task
Operator role: Sylvara Books Controller with separate Sylvara Books Audit readback
Pre-deployment state: verified; 83 active and 11 inactive accounts, with exact prior descriptions captured privately for five custom accounts
Action: configuration change; update five descriptions covering owner reimbursement, source-specific bank interest, carrier telecommunications, meals parent, and full-cost meals detail
Smoke-test result: passed; all five Controller responses succeeded serially
Readback result: matched; independent Audit returned all 83 active accounts and all five descriptions matched
Rollback target: captured private five-description prestate; no name, code, type, parent, status, balance, transaction, tax setting, or organization setting changed
Outcome: succeeded
Follow-up: tax professional must still confirm the federal accounting method and filing-year workpapers; live Zoho remains configured accrual pending that review
```

## Entry Template

Copy this section for each approved event and replace placeholders with sanitized values only.

```text
Date (UTC): YYYY-MM-DD
Environment class: development | staging | production
Change reference: pull request number and merged commit SHA
Immutable artifact reference: sanitized digest or release reference
Approval reference: private audit reference, no sensitive detail
Operator role: sanitized role, not a personal credential
Pre-deployment state: verified | blocked, with sanitized evidence reference
Action: deploy | rollback | configuration change
Smoke-test result: passed | failed | blocked
Readback result: matched | mismatched | unknown
Rollback target: sanitized immutable reference
Outcome: succeeded | rolled back | contained | blocked
Follow-up: sanitized issue or decision reference
```

## Recording Rules

- Append outcomes; do not rewrite a failed attempt to look successful.
- Use UTC dates and immutable source references.
- Do not claim success without post-action readback.
- Record `unknown` when a timeout or incomplete response prevents confirmation.
- A failed or unknown result must name the containment or rollback decision.
- Financial, destructive, or externally visible rollback requires its own approval.
