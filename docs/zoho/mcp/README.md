# Zoho MCP Knowledge Base

## Purpose

This folder separates MCP design policy from dated evidence. A large catalog does not mean the tools are installed, authorized, safe, or appropriate for Sylvara.

## Evidence Layers

| Layer | Location | Meaning |
|---|---|---|
| Server design standard | [`server-standard.md`](server-standard.md) | How Sylvara should design least-privilege MCP roles |
| Official Tool Manual snapshot | [`reference/tool-manual-service-catalog-2026-07-24.md`](reference/tool-manual-service-catalog-2026-07-24.md) | Dated service coverage and row counts documented by the provider |
| Preconfigured portal templates | [`reference/preconfigured-template-catalog-2026-07-25.md`](reference/preconfigured-template-catalog-2026-07-25.md) | Dated template names and captured memberships, not a recommendation |
| Configured-session advertised names | [`snapshots/configured/2026-08-04/`](snapshots/configured/2026-08-04/) | Sanitized Sylvara-only role and operation names advertised in one inspected session |
| Effective Sylvara access | Not stored as a blanket claim | Requires a current identity check and authorized acceptance call |

## Current Configured Snapshot

The 2026-08-04 snapshot contains 294 advertised Sylvara-only tool names across 18 neutral roles and eight products. It records 221 reads and 73 write/action tools. The supplied export was cross-checked against the current callable registry; no Zoho operation was called, and runtime server names, generated transport IDs, endpoints, authentication details, connection aliases, target identifiers, and returned data were removed.

- [Capability analysis and broader official-family crosswalk](snapshots/configured/2026-08-04/capability-catalog.md)
- [Complete machine-readable advertised-name inventory](snapshots/configured/2026-08-04/sylvara-observed-tool-inventory.json)

## Tool Manual Snapshot

The dated Tool Manual catalog records 10,533 service-qualified rows across 59 documented services. Eight products in the current Sylvara snapshot account for 3,222 of those dated rows. The repository preserves the complete service/count index and links the relevant product handbooks instead of copying provider-owned manuals. Exact current names, parameters, scopes, and side effects must be refreshed from the official interactive Tool Manual before server design. The configured-session snapshot separately preserves all 294 role-qualified names that passed the public sanitization review.

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
