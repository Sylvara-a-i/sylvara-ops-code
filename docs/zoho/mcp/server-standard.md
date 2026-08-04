# Zoho MCP Server Standard

## Objective

Build the smallest server set that supports a defined Sylvara workflow while preventing cross-organization access, accidental financial writes, duplicate records, unsafe deployment actions, and public disclosure.

The [Codex MCP manual](https://learn.chatgpt.com/docs/extend/mcp) documents streamable HTTP and STDIO servers, tool allowlists, per-tool approval modes, required-server behavior, timeouts, and `codex mcp` commands. Zoho-specific controls in this standard are stricter because native endpoint selection alone cannot enforce business safety.

## Required Separation

| Role | Default state | Purpose |
|---|---|---|
| Audit | Enabled when needed | Read-only identity, metadata, and bounded operational evidence |
| Changes / Bookkeeping | Disabled until a workflow is approved | Narrow record or routine draft changes |
| Controller | Disconnected or approval-gated | High-risk accounting and structural configuration |
| Release | Disabled until release approval | Test, deploy, invoke, roll back, or pipeline actions |
| Break-glass | Disabled; just-in-time only | Incident-scoped containment or recovery |

Use distinct Zoho identities, OAuth grants, and server definitions for audit and mutation roles. If a platform constraint prevents distinct human identities, use separate tokens or connections with non-overlapping allowlists and obtain documented risk approval before production use. Independent readback must not rely on the mutation credential. Never reuse another business's identity, token, endpoint, or server configuration.

## Server-Side Controls

Every write-capable server must enforce controls in code, not only in tool descriptions:

- fixed Sylvara organization, project, data center, and environment allowlists;
- rejection of caller-supplied target substitutions;
- exact HTTP method, path, tool, and payload allowlists;
- typed input schemas with unknown-field rejection and size limits;
- current-user and permission verification;
- fresh prestate read and stale-state abort;
- short-lived immutable plan hash for approved high-risk writes;
- stable idempotency key and serialized conflicting writes;
- durable write ledger and returned-identifier persistence outside GitHub;
- no blind retry after an ambiguous timeout;
- post-write readback through an independent audit path; and
- centralized redaction that excludes credentials, raw payloads, PII, financial data, and response bodies.

A tool description is guidance, not enforcement. Do not rely on the model to remember a server's target or safety rule.

## Codex Configuration

Use the desktop MCP settings or the installed CLI. Run configuration and inspection commands only in a trusted local terminal with output capture disabled. They can reveal private server names, endpoints, headers, or authentication metadata and must not run in public CI or be pasted into a Codex task, issue, pull request, or repository file.

Streamable HTTP syntax is:

```powershell
codex mcp add <server-name> --url <streamable-http-mcp-url>
codex mcp list --json
codex mcp get <server-name> --json
```

The placeholders above are documentation only. Never paste the real command, output, private endpoint, bearer token, or populated header into a repository file, issue, pull request, or task transcript. When bearer authentication is supported, reference an environment-variable name rather than storing the value in configuration.

For finer control, use private Codex configuration similar to this synthetic example:

```toml
[mcp_servers.zoho_crm_audit]
url = "<private-streamable-http-url>"
enabled = true
required = true
enabled_tools = ["<approved-metadata-read-tool>"]
default_tools_approval_mode = "prompt"
startup_timeout_sec = 10
tool_timeout_sec = 60
```

The example name is a role convention, not proof of a production connection. Actual endpoints, headers, scopes, and connection names stay private.

`codex mcp login` works only when the streamable HTTP server supports Codex-managed OAuth. The 2026-08-03 source snapshot reported authentication as not managed by the CLI. Do not repeatedly retry that login path or substitute Browser automation; use the server's approved provisioning method and verify access afterward.

## Acceptance Sequence

Run acceptance separately for every role and environment:

1. Confirm the exact server name and advertised tool allowlist.
2. Call the least-sensitive identity endpoint first.
3. Verify organization, environment, data center, current user, and intended role.
4. Confirm the server rejects another organization, project, or environment.
5. Confirm audit roles reject every write.
6. Confirm write roles reject tools and payload fields outside their allowlist.
7. Test duplicate requests, stale state, zero matches, multiple matches, missing fields, rate limits, malformed responses, and timeouts using synthetic or Development data.
8. Verify ambiguous writes are reconciled instead of retried.
9. Verify logs and errors contain no secret, PII, document content, or financial detail.
10. Record only a sanitized result in GitHub; keep evidence in the approved private audit system.

No production mutation belongs in acceptance testing unless Gabriel separately approves the exact target, payload, prestate, rollback, and readback.

## Pre-Write Contract

Before one external write, present:

- authenticated organization, environment, and role;
- exact target and fresh current state;
- proposed state and expected side effects;
- exact server, tool, and constrained parameters;
- duplicate, trigger, and idempotency behavior;
- rollback or safe containment path; and
- independent readback and reconciliation plan.

Approval is limited to that target, state, payload, and action. It does not authorize adjacent records, another product, schema cleanup, bulk mutation, deletion, retry, or deployment.

## Fail-Closed Conditions

Stop without writing when identity is ambiguous, a prerequisite tool is missing, output is truncated, OAuth scope is insufficient, a payload schema is untyped, state drifted, a target has zero or multiple matches, the response is malformed, or a timeout leaves success unknown.

Do not substitute another connector, infer a payload from official API documentation alone, or use a write-capable server merely because it is visible.

## Review And Decommissioning

Review server need, OAuth grants, enabled tools, identities, logs, and private audit evidence at least quarterly and after incidents, personnel changes, or workflow retirement. Disable before removing, verify no workflow depends on the server, revoke credentials, and preserve only a sanitized decommission record.
