# Connector Access Standard

## Purpose

This standard applies to GitHub Apps, OAuth apps, MCP servers, automation accounts, CI workflows, deployment tools, and connectors that can read or change Sylvara systems.

## Access Principles

- Use a Sylvara-approved business identity and a narrowly scoped installation.
- Grant access only to the required repository, system, environment, operation, and duration.
- Separate read-only audit access from write or deployment access where supported.
- Do not grant organization owner, repository administrator, billing administrator, secrets administrator, or branch-protection bypass unless a documented requirement and explicit approval justify it.
- Do not reuse identities, credentials, or app installations from unrelated businesses.
- Store credentials only in approved encrypted secret stores.
- Review and revoke unused access promptly.

## Required GitHub Path

Connectors that write repository content must use:

```text
read current main -> create short-lived branch -> make focused change
-> open pull request -> pass required checks -> obtain required review
-> squash merge -> verify main -> delete branch
```

A connector must not push directly to `main`, bypass required checks, approve its own change where independent approval is required, or treat merge as authorization to deploy.

## Pre-Write Gate For External Systems

Before any production, financial, destructive, externally visible, or client-affecting write, record:

- the authenticated organization, account, tenant, and environment;
- the exact target object or resource;
- the current state from a fresh read;
- the proposed state and expected side effects;
- the exact connector, operation, and constrained parameters;
- duplicate and idempotency behavior;
- the rollback or safe containment path;
- the required approval and its scope.

Approval is limited to the named action, payload, target, and observed state. It does not authorize adjacent records, environments, systems, schema changes, retries, or cleanup.

## Fail-Closed Conditions

Stop without writing when any of the following is true:

- authenticated identity, organization, tenant, environment, or permissions are unclear;
- the requested connector or operation is unavailable;
- a target has zero matches, multiple matches, or a stale identifier;
- live state differs materially from the approved prestate;
- a response is truncated, malformed, ambiguous, or reports an authorization error;
- a timeout makes write success unknown;
- required approval is missing, expired, or broader than the evidence supports;
- secrets, PII, client data, or unrelated changes may be exposed.

Do not substitute a different connector or guess a production payload to bypass a stopped operation.

## Safe Write And Verification

- Prefer one bounded write at a time for high-risk workflows.
- Use a stable idempotency key and immutable approved input where supported.
- Serialize conflicting writes and reject stale-state changes.
- Never blindly retry after an ambiguous timeout; read authoritative state first.
- Persist returned resource identifiers in the approved private audit system.
- Immediately read the changed object through an independent read path when available.
- Reconcile downstream authoritative systems before reporting success.
- Keep public logs sanitized; do not print raw payloads or secrets.

## Access Review

Review connector installations and permissions at least quarterly and after personnel, vendor, incident, or architecture changes. Record the review date and sanitized outcome without exposing credential metadata or production identifiers.
