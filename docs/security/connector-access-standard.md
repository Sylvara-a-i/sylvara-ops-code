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
- the preferred connector or operation is unavailable and the audited browser-fallback gate below cannot be satisfied;
- a target has zero matches, multiple matches, or a stale identifier;
- live state differs materially from the approved prestate;
- a response is truncated, malformed, ambiguous, or reports an authorization error;
- a timeout makes write success unknown;
- required approval is missing, expired, or broader than the evidence supports;
- secrets, PII, client data, or unrelated changes may be exposed.

Do not substitute a different connector or guess a production payload to bypass a stopped operation.

## Audited Browser Fallback

Use the matching purpose-built integration first. The authenticated in-app browser is an approved fallback only after current tool discovery records that the preferred plugin, MCP server, connector, API, or CLI is unavailable, cannot access the target, fails for the required operation, or lacks that capability.

The fallback must preserve every applicable pre-write and verification control in this standard. Confirm the visible tenant and environment, capture a fresh sanitized prestate, bind approval to one exact UI action, prevent duplicates, define rollback or containment, and perform authoritative post-write readback separate from the save response. Use an independent read-only connector or credential when the action's risk standard requires it. Otherwise, prefer that independent path when available; if it is unavailable, leave the edited view and perform a fresh provider-UI read without mislabeling that same-session read as independent. Treat a partial page, stale session, validation warning, timeout, unexpected navigation, or unclear save result as ambiguous and reconcile before retrying.

Use only ordinary visible controls in the provider's first-party authenticated UI. Do not inject scripts, use developer tools, call private APIs, or inspect browser credentials, cookies, or storage.

Do not place credentials, secret values, private payloads, or customer data in chat, command text, screenshots, Git, or logs. Secret entry requires an approved private or human-controlled path; automation may verify only the variable name and masked presence. Browser fallback does not authorize a live action, resolve unknown field semantics, make an unsafe rollback acceptable, or permit a different tenant, direct REST request, shell workaround, or untyped payload.

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
