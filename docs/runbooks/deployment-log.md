# Deployment Log

## Purpose

This public log records sanitized deployment outcomes. It must not contain client names, production identifiers, endpoints, secrets, payloads, logs, exact runtime prompts, or sensitive configuration. Detailed evidence belongs in the approved private audit system.

A merged pull request is not a deployment. Record an entry only after an authorized deployment attempt or rollback attempt occurs.

## Current State

The production configuration events recorded here are the 2026-08-14 Free-Test CRM workflow and Blueprint work; the 2026-08-05 Sylvara Zoho CRM schema/layout/address work; and the same-day Zoho Books chart deployment, Schedule C hierarchy amendment, and final tax-preparer description correction. The Free-Test CRM event configured intake and Deal automation but did not automate native Lead conversion or prove Zoho Forms settings. The Books events wrote chart metadata and active status only; no transaction record, journal, bank, clearing, tax-engine, or integration was written. Chart metadata can change historical report presentation even when transaction records remain unchanged.

## 2026-08-14 — Zoho CRM Free-Test Workflows And Deal Blueprint

```text
Date (UTC): 2026-08-14
Environment class: production
Change reference: draft pull request #22
Immutable artifact reference: current sanitized schema fingerprints in src/zoho-crm/reference/snapshots/2026-08-14/README.md
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
