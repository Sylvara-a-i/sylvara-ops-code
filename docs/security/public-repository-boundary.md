# Public Repository Boundary

## Decision

This repository is a public, sanitized technical source of truth. Every commit, branch, pull request, review comment, issue, action log, artifact, tag, and release must be treated as permanently disclosed.

Public visibility is not permission to publish private business or client material, and it does not make live platform state part of the repository.

## Allowed Content

- Sanitized implementation code required for a specific approved capability
- Automated tests using synthetic fixtures
- Generic schemas and interface contracts without production identifiers
- Public architecture boundaries and accepted decision records
- Sanitized setup, smoke-test, deployment, rollback, and incident runbooks
- Blank environment-variable references and safe configuration examples
- Archived code that has been reviewed, sanitized, and clearly marked non-authoritative

## Prohibited Content

- Secrets, passwords, tokens, private keys, MFA or recovery codes, or `.env` files
- Caller names, phone numbers, addresses, recordings, transcripts, or other PII
- Client credentials, configurations, exports, contracts, or unapproved case-study material
- Raw production requests, responses, payloads, database extracts, or logs
- Payment, banking, health, government-ID, or other sensitive records
- Production agent IDs, phone numbers, webhook secrets, signed URLs, connection names, or environment identifiers
- Private sales research, pricing negotiations, or client onboarding details
- Exact production prompts, routing rules, or guardrails that would create abuse or security risk
- Website copy or marketing content that has not been explicitly approved for publication

## Repository Is Not Runtime Authority

- A merged change is not deployed until an authorized deployment is performed and verified.
- An archived configuration is not evidence of current live state.
- A repository example must not be used to infer a client setting, financial balance, or production identifier.
- Secrets must be resolved from approved encrypted stores at runtime.
- Detailed production evidence belongs in an approved private audit system; public logs contain sanitized outcomes only.

## Publication Gate

Before any branch is pushed or pull request is opened:

1. Review the complete diff, including filenames and deleted content.
2. Confirm every example is synthetic and every identifier is a placeholder.
3. Run repository safety and secret scans.
4. Confirm generated artifacts and workflow output do not embed sensitive values.
5. Stop if data provenance, consent, classification, or sanitization is uncertain.

External publication beyond the existing repository workflow requires explicit approval.

## If Sensitive Material Is Found

Do not paste it into a public issue or pull request. Stop further publication, preserve evidence privately, contain access, rotate exposed credentials, and follow [Security Incidents](security-incidents.md). Deleting the current file is not sufficient because prior Git objects, forks, caches, or logs may retain it.
