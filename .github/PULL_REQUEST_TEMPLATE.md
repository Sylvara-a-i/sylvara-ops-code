## Purpose

Describe the business or operational problem and the smallest reliable change that solves it.

## What Changed

List the meaningful implementation, documentation, or repository changes.

## Source Of Truth Check

Confirm that the change preserves system ownership: CRM for relationships, Zoho Books for accounting, Zoho Billing for approved subscription lifecycle, Creator for approved workflow UI, Catalyst for secure middleware, Retell for voice runtime, Make for non-critical orchestration, and GitHub for sanitized source. Call out any exception.

## Validation

List the exact tests, lint, builds, and manual checks run. Do not claim checks that were not run.

## Security / Privacy Check

- [ ] No secrets, credentials, `.env` files, private keys, or credential-bearing URLs are included.
- [ ] No caller, prospect, client, payment, banking, health, or government-ID data is included.
- [ ] Examples and fixtures are synthetic; logs and payloads are sanitized.
- [ ] New or changed GitHub Actions use immutable commit SHAs, read-only permissions, bounded timeouts, and non-persisted checkout credentials.

## Manual Zoho Setup Required

List any CRM, Books, Billing, Creator, Catalyst, OAuth, webhook, or environment configuration that must be completed manually. State `None` when no Zoho setup is required.

## Deployment Status

State `Not deployed` when no external system changed. Otherwise identify the exact approved environment, immutable artifact or commit, validation, and readback evidence without exposing private identifiers.

## Risks

Describe realistic operational, security, privacy, duplicate-processing, billing, API-limit, schema, and maintenance risks.

## Rollback

Describe the smallest safe source and deployment rollback. Do not imply that reverting Git automatically rolls back a live platform.

## Not Included

Name anything intentionally deferred so the pull request stays reviewable.
