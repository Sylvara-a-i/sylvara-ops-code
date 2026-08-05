# Configured-Session Snapshots

## Purpose

`configured/` stores sanitized, dated observations of role and operation names advertised in an inspected configured session. These snapshots do not establish request or response contracts, effective tenant access, successful execution, or approval for live use.

See the broader [snapshot index](../README.md) and [MCP knowledge base](../../README.md) for evidence boundaries and server-design controls.

## Snapshot Index

| Observation date | Artifacts |
|---|---|
| [`2026-08-04/`](2026-08-04/) | [Capability catalog](2026-08-04/capability-catalog.md) and [machine-readable advertised-name inventory](2026-08-04/sylvara-observed-tool-inventory.json) |

## Placement Rules

- Create one `YYYY-MM-DD/` sibling directory per distinct configured-session observation date.
- Keep the observation method, scope, sanitization, and limitations in the dated artifacts.
- Preserve prior snapshots for comparison; never silently rewrite an older date to represent a later inspection.
- Exclude runtime namespaces, generated transport identifiers, private endpoints, authentication material, connection aliases, target identifiers, returned data, and production configuration.
