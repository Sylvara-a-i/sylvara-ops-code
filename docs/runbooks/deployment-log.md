# Deployment Log

## Purpose

This public log records sanitized deployment outcomes. It must not contain client names, production identifiers, endpoints, secrets, payloads, logs, exact runtime prompts, or sensitive configuration. Detailed evidence belongs in the approved private audit system.

A merged pull request is not a deployment. Record an entry only after an authorized deployment attempt or rollback attempt occurs.

## Current State

No production deployment is recorded by this repository baseline.

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
