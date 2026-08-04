# ADR 0001: Public Repository Security Boundary

- Status: Accepted
- Date: 2026-08-03

## Context

Sylvara needs a durable technical source of truth that supports review, automation, and maintainability. The repository is public, while Sylvara's connected platforms may process credentials, client configuration, call data, customer records, financial information, and production-only behavior.

Git history, pull requests, workflow logs, forks, caches, releases, and artifacts can persist after a file is removed. Therefore, repository access controls alone cannot make sensitive material safe to publish.

## Decision

Use this repository only for sanitized technical artifacts. The repository may hold source code, tests, public runbooks, architecture boundaries, decision records, schemas, and synthetic examples. It must not hold secrets, client data, caller PII, recordings, transcripts, raw production payloads or logs, private commercial material, production identifiers, or exact production prompts that create abuse risk.

Live platforms remain authoritative for runtime configuration and business records. Approved encrypted secret stores remain authoritative for credentials. A merge to `main` does not deploy or authorize a production change.

All changes use short-lived branches, required checks, pull-request review, squash merge, final-state verification, and branch cleanup. Production, external publication, financial, destructive, or client-affecting actions require separate explicit approval, bounded scope, rollback readiness, and post-action readback.

When identity, authorization, target, state, data classification, or write outcome is uncertain, the operation fails closed.

## Consequences

### Positive

- Public review and connector workflows can operate without making GitHub a sensitive data store.
- System ownership and deployment authority remain explicit.
- Sanitized tests and runbooks improve repeatability without exposing clients.
- Approval, rollback, idempotency, and readback requirements reduce operational risk.

### Costs

- Production configuration cannot be reconstructed from this repository alone.
- Sanitization and private evidence management add review work.
- Some incidents and deployment details must be referenced privately rather than fully documented here.
- Imported or archived artifacts require review before they can be retained.

## Rejected Alternatives

### Store Encrypted Secrets In Git

Rejected. Key management, accidental decryption, history retention, and connector exposure create unnecessary risk. Platform secret stores are the appropriate authority.

### Mirror Full Production Configuration Publicly

Rejected. Exact identifiers, prompts, routing, payloads, and client configuration create privacy, security, and abuse risks.

### Treat Merge As Automatic Production Approval

Rejected. Source review does not verify live identity, environment, current state, authorization, or rollback readiness.

### Keep No Technical Record

Rejected. Without sanitized code, tests, decisions, and runbooks, delivery becomes difficult to review, reproduce, and maintain.

## Compliance

The supporting controls are defined in:

- [Data Classification](../security/data-classification.md)
- [Public Repository Boundary](../security/public-repository-boundary.md)
- [Connector Access Standard](../security/connector-access-standard.md)
- [Security Incidents](../security/security-incidents.md)
- [GitHub Settings Checklist](../setup/github-settings-checklist.md)
- [Deployment Log](../runbooks/deployment-log.md)
- [Rollback Checklist](../runbooks/rollback-checklist.md)
- [Smoke-Test Checklist](../runbooks/smoke-test-checklist.md)
