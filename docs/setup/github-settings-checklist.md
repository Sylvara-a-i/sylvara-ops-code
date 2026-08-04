# GitHub Settings Checklist

## Status

Last live review: **2026-08-04**

Reviewer role: **Sylvara organization owner / repository administrator**

Outcome: **Core public-repository hardening enabled; deliberate exceptions and organization-level unknowns remain below.**

Checked items were read back from the live GitHub administration interface during the review. Unchecked items are either unverified or intentionally deferred; the notes explain deliberate exceptions. Repository files alone do not prove that a live setting remains unchanged after this review.

Do not create or document access links to unrelated business identities. Use only Sylvara-approved accounts, teams, and app installations.

## Repository Identity

- [x] Repository owner and name match the approved Sylvara repository.
- [x] Visibility is intentionally Public.
- [x] Default branch is `main`.
- [ ] **UNVERIFIED:** Description, website, and topics contain only approved public information.
- [ ] **UNVERIFIED:** No open-source license is present unless separately approved.

## General Settings

- [x] Issues are disabled unless a public issue process is explicitly approved.
- [x] Discussions, Wiki, and Projects are disabled unless required.
- [x] Squash merge is enabled.
- [x] Merge commits are disabled.
- [x] Rebase merging is disabled.
- [x] Automatic head-branch deletion is enabled.
- [x] GitHub Pages is disabled unless a separate publication approval exists.

## Collaborators And Apps

- [x] No people or teams have organization-based repository access; organization owners retain inherent administration.
- [x] No base organization role is assigned.
- [ ] **UNVERIFIED:** Repository creation, deletion, transfer, and visibility changes are restricted to approved owners.
- [x] The required GitHub App is installed only on the selected Sylvara repository.
- [x] The installed GitHub App has no repository administration, organization administration, secrets, billing, or ruleset-bypass permission.
- [ ] **UNVERIFIED:** Unused collaborators, teams, deploy keys, OAuth apps, GitHub Apps, and tokens have been revoked.
- [ ] **UNVERIFIED:** Organization two-factor authentication requirements are enabled and enforced.

## Actions

- [x] Actions policy permits only required, reviewed actions.
- [x] Third-party actions are pinned to full immutable commit SHAs.
- [x] Default workflow token permissions are read-only.
- [x] Workflows cannot create or approve pull requests unless separately justified.
- [x] Fork pull-request workflows require approval for all external contributors.
- [ ] **UNVERIFIED:** Workflow logs and artifacts cannot expose secrets or production data.
- [ ] **UNVERIFIED:** Required repository safety checks exist and pass on a controlled test pull request.

## Protect `main`

- [x] An active ruleset targets the default branch.
- [x] Direct pushes are blocked for routine work.
- [x] Pull requests are required before merge.
- [ ] **DEFERRED:** At least one independent approval is required. The repository currently has one trusted human identity, so requiring approval would deadlock same-identity pull requests. Enable one approval after adding a second trusted reviewer or a distinct PR-authoring app identity.
- [ ] **DEFERRED:** Stale approvals are dismissed after reviewable changes. Enable with the independent-review requirement.
- [ ] **DEFERRED:** The most recent reviewable push requires approval. Enable with the independent-review requirement.
- [x] Required conversations must be resolved.
- [x] Required status checks are configured and branches must be current.
  - `Public repository safety scan`
  - `Safety regression tests`
  - `Workflow security policy`
- [x] Force pushes and branch deletion are blocked.
- [x] Linear history is required.
- [x] No connector, app, team, or routine administrator is listed for ruleset bypass.

## Security And Analysis

- [x] Dependency graph is enabled.
- [x] Dependabot alerts, malware alerts, security updates, and grouped security updates are enabled.
- [x] Secret scanning is enabled.
- [x] Push protection is enabled.
- [x] CodeQL default setup is enabled for detected GitHub Actions, JavaScript/TypeScript, and Python code.
- [x] Private vulnerability reporting is enabled.
- [x] Public interaction settings match the no-external-contributions policy; pull requests remain available for controlled change review.

## Environments And Deployment

- [ ] **UNVERIFIED:** Production environments, if any, require explicit approval.
- [ ] **UNVERIFIED:** Environment secrets are stored only in approved encrypted stores.
- [ ] **UNVERIFIED:** Deployment credentials are environment-scoped and least privilege.
- [ ] **UNVERIFIED:** A merge to `main` cannot implicitly deploy to production without the approved deployment gate.
- [ ] **UNVERIFIED:** Deployment and rollback produce sanitized audit evidence.

## Verification Record

Record the completed review in a private audit system. In this public file, record only a sanitized review date, reviewer role, and outcome; do not list personal identifiers, app installation IDs, token metadata, or production configuration.

| Date | Reviewer role | Sanitized outcome |
| --- | --- | --- |
| 2026-08-04 | Organization owner / repository administrator | Enabled protected-main, least-privilege app scope, hardened Actions, dependency and secret protections, and CodeQL. Independent approval remains deferred until a second trusted reviewer or distinct PR-authoring identity exists. |
