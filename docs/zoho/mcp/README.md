# Zoho MCP Knowledge Base

## Purpose

This folder separates MCP design policy from dated evidence. A large catalog does not mean the tools are installed, authorized, safe, or appropriate for Sylvara.

## Evidence Layers

| Layer | Location | Meaning |
|---|---|---|
| Server design standard | [`server-standard.md`](server-standard.md) | How Sylvara should design least-privilege MCP roles |
| Official Tool Manual snapshot | [`reference/tool-manual-service-catalog-2026-07-24.md`](reference/tool-manual-service-catalog-2026-07-24.md) | Dated service coverage and row counts documented by the provider |
| Preconfigured portal templates | [`reference/preconfigured-template-catalog-2026-07-25.md`](reference/preconfigured-template-catalog-2026-07-25.md) | Dated template names and captured memberships, not a recommendation |
| Configured-session contracts | [`snapshots/configured/2026-08-03/`](snapshots/configured/2026-08-03/) | Sanitized contracts advertised in one inspected session |
| Effective Sylvara access | Not stored as a blanket claim | Requires a current identity check and authorized acceptance call |

## Current Configured Snapshot

The 2026-08-03 snapshot contains 403 advertised contracts across 10 neutral server roles. It records 245 reads and 158 write/action tools. No Zoho operation was called during discovery, and source server identities and endpoints were removed.

- [Capability analysis](snapshots/configured/2026-08-03/capability-catalog.md)
- [Machine-readable inventory](snapshots/configured/2026-08-03/observed-tool-inventory.json)

## Tool Manual Snapshot

The dated Tool Manual catalog records 10,533 service-qualified rows across 59 documented services. The repository preserves the complete service/count index but does not republish the other repository's large name-level export. Exact names and contracts must be refreshed from the current official Tool Manual before server design. The configured-session snapshot separately preserves the 403 contracts that passed the public sanitization review.

## Server Design Sequence

1. Define one concrete Sylvara workflow and its authoritative system.
2. Identify the minimum official capabilities required.
3. Compare the Tool Manual, template membership, and currently advertised contracts without conflating them.
4. Split metadata/content reads from writes and high-risk actions.
5. Bind organization, environment, and data center inside the server boundary where possible.
6. Exclude delete, public-sharing, arbitrary secret, unrestricted execution, and break-glass operations by default.
7. Verify identity with the least-sensitive call.
8. Acceptance-test only the approved bounded capability.
9. Validate response shape and read authoritative state back.
10. Record a dated sanitized result without secrets, records, or private identifiers.

See the [MCP Server Standard](server-standard.md) for the complete control contract.
