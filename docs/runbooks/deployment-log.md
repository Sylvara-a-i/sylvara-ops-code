# Deployment Log

## Purpose

This public log records sanitized deployment outcomes. It must not contain client names, production identifiers, endpoints, secrets, payloads, logs, exact runtime prompts, or sensitive configuration. Detailed evidence belongs in the approved private audit system.

A merged pull request is not a deployment. Record an entry only after an authorized deployment attempt or rollback attempt occurs.

## Current State

The 2026-08-05 Sylvara Zoho Books chart deployment is the only production configuration event recorded here. It changed chart metadata and active status only; no transaction, balance, journal, bank, clearing, tax-engine, or integration state was changed.

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
