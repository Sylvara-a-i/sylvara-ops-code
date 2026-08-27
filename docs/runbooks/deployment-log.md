# Deployment Log

## Purpose

This public log records sanitized deployment outcomes. It must not contain client names, production identifiers, endpoints, secrets, payloads, logs, exact runtime prompts, or sensitive configuration. Detailed evidence belongs in the approved private audit system.

A merged pull request is not a deployment. Record an entry only after an authorized deployment attempt or rollback attempt occurs.

## Current State

The Development events recorded here are the 2026-08-27 six-function Revenue Desk definition deployment and subsequent read-only Catalyst/Retell boundary reconciliation with no operator invocation performed, the contained 2026-08-26 datastore schema attempt, and its superseding bounded Packet A resolution. The production configuration events are the 2026-08-14 Free-Test CRM workflow and Blueprint work; the 2026-08-05 Sylvara Zoho CRM schema/layout/address work; and the same-day Zoho Books chart deployment, Schedule C hierarchy amendment, and final tax-preparer description correction. The Free-Test CRM event configured intake and Deal automation but did not automate native Lead conversion or prove Zoho Forms settings. The Books events wrote chart metadata and active status only; no transaction record, journal, bank, clearing, tax-engine, or integration was written. Chart metadata can change historical report presentation even when transaction records remain unchanged.

## 2026-08-27 — Revenue Desk Canonical Development Definitions Deployed Without Invocation

```text
Date (UTC): 2026-08-27
Environment class: development
Change reference: pull request #49; source commit 7fb101d60e4480a2aaa88de70d82d6b1ddc9e989
Immutable artifact reference: sanitized path src/zoho-catalyst/evidence/free-revenue-leak-test-development-six-function-deployment-2026-08-27.json
Approval reference: explicit owner approval retained in the private task record; exhausted after this verified poststate and not reusable
Operator role: connector-first Catalyst discovery and independent metadata/configuration readback; because the connector exposed no source/archive download operation, the authenticated first-party Catalyst UI Download fallback supplied the six archive pullbacks; later provider reads reconciled bounded log, scheduler, pool, function-inventory, and provider-neutral Retell boundary status only
Pre-deployment state: two canonical definitions already existed, four canonical definitions were absent, API Gateway was disabled, both canonical Function Job pools existed at 512 MB, and the canonical retry Cron was absent
Action: deploy or update the six canonical Development function definitions from the exact reviewed revision; preserve safe CRM and Analytics gates; require Catalyst authentication and POST-only access on all four Advanced I/O Security Rules; keep API Gateway disabled and the retry Cron absent; perform no function or Job invocation, Retell action, customer workflow, or Production action
Smoke-test result: not invoked; the operator performed no function, Job, compatibility probe, Retell call, Retell simulation, customer workflow, or Production workflow invocation
Readback result: all six canonical definitions reported Node 24, 256 MB, and the exact source-revision stamp; all six Catalyst-pulled archives matched their exact uploaded archives byte for byte by SHA-256 and length, with private release-manifest artifact verification passed; the complete function inventory contained the six canonical and six known legacy definitions and no other functions; the provider's generic `is_deployed` flag was false for all six canonical definitions and was recorded without treating it as a source-installation failure or Production result; environment-variable counts were 0/0/0/0/45/54 in canonical function order; CRM had 45 live variable names versus 42 public-registry names, and Analytics had 54 versus 26, with extra names privately unclassified and omitted; the CRM paid and compatibility-probe gates were false; Analytics had a disabled-mode configuration readback, not a runtime DisabledNoOp proof; all four Advanced I/O rules were POST-only with authentication required; API Gateway remained disabled; four Function Job pools existed, comprising the two exact canonical pools and two noncanonical pools; the only Cron was inactive, targeted a legacy function through a noncanonical pool, and referenced neither canonical pool; RevenueDeskRetry1m remained absent; provider logs contained zero access or application records in the 24-hour post-update window covering all six latest updates, while the full seven-day Development retention window contained 24 older access records on only the two preexisting definitions and zero application records. Read-only Retell reconciliation proved the provider-neutral variable, post-call analysis, webhook-event, and timeout contracts, while the phone webhook remained on the legacy Catalyst boundary and the required no-retained-content, pre-assent media/DTMF, and static-notice controls remained unproven. No Retell change, test, simulation, call, publish, or route change occurred.
Evidence limitation: exact six-archive upload parity does not prove final-main or configuration-registry parity; the generic provider deployment flag does not by itself characterize Development source installation or Production deployment; Security Rule posture is configuration readback only; route-count readback was unavailable; and the twelve-route API Gateway contract, canonical Job target binding, live report v1/v2 compatibility, synthetic lifecycle acceptance, and legacy caller retirement remain unproven. Zero post-update provider logs prove only a bounded no-execution observation after the latest definition updates. Historical access records establish prior reachability, so negative direct-caller inventory and callable-surface inertness remain unproven. CRM paid/probe gates do not disable sync_report_summary. Archive digests, private paths, Retell identifiers, prompts, topology, and runtime values remain outside Git.
Rollback target: keep API Gateway disabled, the retry Cron absent, Analytics configured disabled, and CRM paid/probe gates false; do not invoke any definition until the outstanding caller, route, binding, configuration, and runtime gates pass. Two existing definitions were overwritten. Their exact predecessor deployed archives were not preserved or restore-rehearsed, so this containment posture is not an executable source rollback. A future source restore, deletion, route change, invocation, or binding requires predecessor recovery evidence, fresh scoped approval, and independent readback.
Outcome: canonical_definitions_deployed_exact_upload_and_bounded_no_post_update_log_activity_runtime_acceptance_pending; the operator performed no Retell-agent, customer-workflow, or Production change, while complete caller inventory and callable-surface inertness remain unproven
Follow-up: classify the live-versus-registry variable gaps privately; prove exact configuration and provider bindings, route count and API Gateway routes, canonical Job binding, compatibility through a verified private invocation channel, synthetic Development lifecycle, migration, rollback, cleanup, and final-main parity before any activation; preserve the inactive legacy Cron and noncanonical pools until dependency and rollback reconciliation; move the phone webhook only in the separate Retell task after its storage, notice, media/DTMF, route, and rollback controls pass
```

The provider log scope and seven-day Development retention used for this bounded readback were reverified on 2026-08-27 against the official [Catalyst Logs documentation](https://docs.catalyst.zoho.com/en/devops/help/logs/introduction/). The generic deployment flag is preserved without extrapolation because Catalyst treats [Development and Production as separate environments](https://docs.catalyst.zoho.com/en/deployment-and-billing/environments/development-environment/).

## 2026-08-26 — Revenue Desk Development Packet A Superseding Resolution

This entry supersedes only the unresolved architecture and Job-pool status conclusions in the partial-execution entry below. That earlier entry remains verbatim historical evidence.

```text
Date (UTC): 2026-08-26
Environment class: development
Change reference: docs/adr/0008-single-key-analytics-outbox-fence.md
Evidence reference: sanitized path src/zoho-catalyst/evidence/free-revenue-leak-test-development-packet-a-resolution-2026-08-26.json
Approval reference: explicit owner approval retained in the private task record
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
