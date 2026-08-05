# Zoho MCP Knowledge Base

## Purpose

This folder separates MCP design policy from dated evidence. A large catalog does not mean the tools are installed, authorized, safe, or appropriate for Sylvara.

## Evidence Layers

| Layer | Location | Meaning |
|---|---|---|
| Official product capability | [`../reference/README.md`](../reference/README.md) | What current official product documentation says the underlying product can do |
| Official Tool Manual snapshot | [`reference/tool-manual-service-catalog-2026-08-05.md`](reference/tool-manual-service-catalog-2026-08-05.md) and [`reference/tool-manual-tool-catalog-2026-08-05.json`](reference/tool-manual-tool-catalog-2026-08-05.json) | Dated rendered service coverage plus the complete names-only provider catalog |
| Preconfigured portal templates | [`reference/preconfigured-template-catalog-2026-07-25.md`](reference/preconfigured-template-catalog-2026-07-25.md) | Dated template names and captured memberships, not a recommendation |
| Configured-session selections | [`snapshots/configured/2026-08-04/`](snapshots/configured/2026-08-04/) | Sanitized Sylvara-only role membership, exact catalog operation keys, and prefix-free annotations observed in one inspected session |
| Advertised MCP contract | Not stored as a blanket claim | Requires current inspection of the selected tool's description and input schema |
| Effective Sylvara access | Not stored as a blanket claim | Requires a current identity check and authorized acceptance call |

## Current Configured Snapshot

The 2026-08-04 snapshot contains 294 configured Sylvara-only selections across 18 neutral roles and eight products. It records 221 reads and 73 write/action tools. The supplied export was cross-checked against the callable registry available on the observation date; no Zoho operation was called, and runtime server names, generated transport IDs, service-prefixed adapter labels, endpoints, authentication details, connection aliases, target identifiers, and returned data were removed.

- [Capability analysis and broader official-family crosswalk](snapshots/configured/2026-08-04/capability-catalog.md)
- [Human-readable enabled-tool catalog by neutral server role](snapshots/configured/2026-08-04/enabled-tool-catalog.md)
- [Complete machine-readable configured-selection inventory](snapshots/configured/2026-08-04/sylvara-observed-tool-inventory.json)

## Tool Manual Snapshot

The 2026-08-05 Tool Manual snapshot records 10,817 rendered rows and 10,794 unique service-qualified operation keys across 61 services. Eight products in the configured Sylvara snapshot account for 3,331 of those rendered rows. The repository preserves service names, operation keys, generated prefix-free annotations, source order, duplicate rows, and minimal provenance only; it does not copy provider descriptions, parameters, schemas, examples, endpoints, or account state.

The annotated name never includes a product or server prefix. For example, `list_vendor_credits` is annotated as `list vendor credits`; service qualification is stored separately. Catalog presence remains reference evidence and does not establish that a tool is selected, authorized, callable, safe, or approved for live use.

## Server Design Sequence

1. Define one concrete Sylvara workflow and its authoritative system.
2. Identify the minimum official capabilities required.
3. Compare the Tool Manual, template membership, and configured tool selections without conflating them or inferring missing request and response contracts.
4. Split metadata/content reads from writes and high-risk actions.
5. Bind organization, environment, and data center inside the server boundary where possible.
6. Exclude delete, public-sharing, arbitrary secret, unrestricted execution, and break-glass operations by default.
7. Verify identity with the least-sensitive call.
8. Acceptance-test only the approved bounded capability.
9. Validate response shape and read authoritative state back.
10. Record a dated sanitized result without secrets, records, or private identifiers.

See the [MCP Server Standard](server-standard.md) for the complete control contract.
