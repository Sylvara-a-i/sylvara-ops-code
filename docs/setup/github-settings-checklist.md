# GitHub Settings Checklist

## Status

All live settings below are **UNVERIFIED**. Every checkbox intentionally starts unchecked. Confirm each item in the Sylvara organization and repository before marking it complete; repository files do not prove live configuration.

Do not create or document access links to unrelated business identities. Use only Sylvara-approved accounts, teams, and app installations.

## Repository Identity

- [ ] **UNVERIFIED:** Repository owner and name match the approved Sylvara repository.
- [ ] **UNVERIFIED:** Visibility is intentionally Public.
- [ ] **UNVERIFIED:** Default branch is `main`.
- [ ] **UNVERIFIED:** Description, website, and topics contain only approved public information.
- [ ] **UNVERIFIED:** No open-source license is present unless separately approved.

## General Settings

- [ ] **UNVERIFIED:** Issues are disabled unless a public issue process is explicitly approved.
- [ ] **UNVERIFIED:** Discussions, Wiki, and Projects are disabled unless required.
- [ ] **UNVERIFIED:** Squash merge is enabled.
- [ ] **UNVERIFIED:** Merge commits are disabled.
- [ ] **UNVERIFIED:** Rebase merging is disabled.
- [ ] **UNVERIFIED:** Automatic head-branch deletion is enabled.
- [ ] **UNVERIFIED:** GitHub Pages is disabled unless a separate publication approval exists.

## Collaborators And Apps

- [ ] **UNVERIFIED:** Every collaborator is a currently approved Sylvara identity.
- [ ] **UNVERIFIED:** Base organization permission is the minimum practical level.
- [ ] **UNVERIFIED:** Repository creation, deletion, transfer, and visibility changes are restricted to approved owners.
- [ ] **UNVERIFIED:** GitHub Apps are installed only on selected required repositories.
- [ ] **UNVERIFIED:** Write-capable apps lack repository administration, organization administration, secrets, billing, and ruleset-bypass access.
- [ ] **UNVERIFIED:** Unused collaborators, teams, deploy keys, OAuth apps, GitHub Apps, and tokens have been revoked.
- [ ] **UNVERIFIED:** Organization two-factor authentication requirements are enabled and enforced.

## Actions

- [ ] **UNVERIFIED:** Actions policy permits only required, reviewed actions.
- [ ] **UNVERIFIED:** Third-party actions are pinned to full immutable commit SHAs.
- [ ] **UNVERIFIED:** Default workflow token permissions are read-only.
- [ ] **UNVERIFIED:** Workflows cannot create or approve pull requests unless separately justified.
- [ ] **UNVERIFIED:** Fork pull-request workflows require approval.
- [ ] **UNVERIFIED:** Workflow logs and artifacts cannot expose secrets or production data.
- [ ] **UNVERIFIED:** Required repository safety checks exist and pass on a controlled test pull request.

## Protect `main`

- [ ] **UNVERIFIED:** An active ruleset targets the default branch.
- [ ] **UNVERIFIED:** Direct pushes are blocked for routine work.
- [ ] **UNVERIFIED:** Pull requests are required before merge.
- [ ] **UNVERIFIED:** At least one independent approval is required.
- [ ] **UNVERIFIED:** Stale approvals are dismissed after reviewable changes.
- [ ] **UNVERIFIED:** The most recent reviewable push requires approval.
- [ ] **UNVERIFIED:** Required conversations must be resolved.
- [ ] **UNVERIFIED:** Required status checks are configured and branches must be current.
  - `Public repository safety scan`
  - `Safety regression tests`
  - `Workflow security policy`
- [ ] **UNVERIFIED:** Force pushes and branch deletion are blocked.
- [ ] **UNVERIFIED:** Linear history is required.
- [ ] **UNVERIFIED:** No connector, app, team, or routine administrator path can bypass protections.

## Security And Analysis

- [ ] **UNVERIFIED:** Dependency graph is enabled.
- [ ] **UNVERIFIED:** Dependabot alerts and security updates are enabled where supported.
- [ ] **UNVERIFIED:** Secret scanning is enabled.
- [ ] **UNVERIFIED:** Push protection is enabled.
- [ ] **UNVERIFIED:** Code scanning is enabled for supported languages when useful.
- [ ] **UNVERIFIED:** Private vulnerability reporting is enabled.
- [ ] **UNVERIFIED:** Public interaction and code-review limits match the no-external-contributions policy.

## Environments And Deployment

- [ ] **UNVERIFIED:** Production environments, if any, require explicit approval.
- [ ] **UNVERIFIED:** Environment secrets are stored only in approved encrypted stores.
- [ ] **UNVERIFIED:** Deployment credentials are environment-scoped and least privilege.
- [ ] **UNVERIFIED:** A merge to `main` cannot implicitly deploy to production without the approved deployment gate.
- [ ] **UNVERIFIED:** Deployment and rollback produce sanitized audit evidence.

## Verification Record

Record the completed review in a private audit system. In this public file, record only a sanitized review date, reviewer role, and outcome; do not list personal identifiers, app installation IDs, token metadata, or production configuration.
