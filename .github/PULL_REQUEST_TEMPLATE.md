## Purpose

Describe the business or operational problem and the smallest reliable change that solves it.

## What Changed

List the meaningful implementation, documentation, or repository changes.

## Source Of Truth Check

Confirm that the change preserves system ownership: CRM for relationships; Books for accounting; Billing for approved subscription lifecycle; Creator for approved workflow UI; Forms/Sites for bounded intake and public presentation; WorkDrive for private documents; Contracts/Sign for legal lifecycle and execution evidence; Mail for mailbox/delivery state; Analytics for derived reporting; Catalyst for secure middleware; Retell for voice runtime; Make for non-critical orchestration; and GitHub for sanitized source. Call out any exception.

For a governed Zoho artifact, state its owning product, authoritative source, sanitized schema or rule version, trigger, inputs, preconditions, idempotency key, side effects, failure behavior, readback, rollback, deployment status, and private evidence location.

## Validation

List the exact tests, lint, builds, and manual checks run. Do not claim checks that were not run.

## Security / Privacy Check

- [ ] No secrets, credentials, `.env` files, private keys, or credential-bearing URLs are included.
- [ ] No caller, prospect, client, payment, banking, health, or government-ID data is included.
- [ ] Examples and fixtures are synthetic; logs and payloads are sanitized.
- [ ] New or changed GitHub Actions use immutable commit SHAs, read-only permissions, bounded timeouts, and non-persisted checkout credentials.

## Manual Zoho Setup Required

List any CRM module/field/layout, Books accounting/configuration, Billing plan/webhook, Creator app/report/workflow, Forms integration, WorkDrive hierarchy, Contracts/Sign template or signer routing, Sites setup, Mail sender/webhook, Analytics source/refresh/access, Catalyst table/route/environment, OAuth connection, or MCP identity that must be configured manually. State `None` when no Zoho setup is required.

## Deployment Status

State `Not deployed` when no external system changed. Otherwise identify the exact approved environment, immutable artifact or commit, validation, and readback evidence without exposing private identifiers.

## Risks

Describe realistic operational, security, privacy, duplicate-processing, billing, API-limit, schema, and maintenance risks.

## Rollback

Describe the smallest safe source and deployment rollback. Do not imply that reverting Git automatically rolls back a live platform.

## Not Included

Name anything intentionally deferred so the pull request stays reviewable.
