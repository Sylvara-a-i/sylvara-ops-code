# Zoho MCP Knowledge Base

## Purpose

This folder separates MCP design policy from dated evidence. A large catalog does not mean the tools are installed, authorized, safe, or appropriate for Sylvara.

## Evidence Layers

| Layer | Location | Meaning |
|---|---|---|
| Official product capability | [`../reference/README.md`](../reference/README.md) | What current official product documentation says the underlying product can do |
| Official Tool Manual snapshot | [`reference/tool-manual-service-catalog-2026-07-24.md`](reference/tool-manual-service-catalog-2026-07-24.md) | Dated service coverage and row counts documented by the provider |
| Dated Catalyst provider-picker catalog | [`reference/zoho-catalyst-tool-manual-catalog-2026-08-14.md`](reference/zoho-catalyst-tool-manual-catalog-2026-08-14.md) | 189 captured display labels, connector-description derivatives, practical use cases, and official-family source routes; not a configured selection or runtime contract |
| Preconfigured portal templates | [`reference/preconfigured-template-catalog-2026-07-25.md`](reference/preconfigured-template-catalog-2026-07-25.md) | Dated template names and captured memberships, not a recommendation |
| Configured-session selections | [`snapshots/configured/2026-08-04/`](snapshots/configured/2026-08-04/) | Sanitized Sylvara-only role membership, prefix-free catalog operation keys, and annotations observed in one inspected session |
| Advertised MCP contract | Not stored as a blanket claim | Requires current inspection of the selected operation's description and input schema |
| Effective Sylvara access | Not stored as a blanket claim | Requires a current identity check and authorized acceptance call |

Dated snapshots are append-only evidence under `<evidence-class>/YYYY-MM-DD`. A later observation creates a new dated directory and updates navigation; it never silently overwrites an older observation. A correction or reconciliation of historical evidence must record its date, scope, and reason without relabeling it as a new observation.

## Current Configured Snapshot

The complete 2026-08-04 snapshot contains 294 configured Sylvara-only selections across 18 neutral roles and eight products. It records 221 reads and 73 write/action tools. An earlier 2026-08-05 export matched that snapshot, but later same-day callable-registry refreshes superseded its Books and CRM portions. Runtime server names, generated transport IDs, service-prefixed adapter labels, endpoints, authentication details, connection aliases, target identifiers, and returned data are removed.

The refreshed Books Controller advertises chart-account create, update, mark-active, and mark-inactive operations. Same-organization Audit and Controller identity reads and all four bounded chart operations succeeded in the approved 2026-08-05 deployment, with independent Audit readback after every mutation. This is scoped effective-access evidence only; it does not prove or authorize other Books writes. The dated machine inventory remains useful historical evidence and must not be treated as the current Books allowlist.

The separate CRM refresh verified scoped metadata, record, workflow, and conversion-map reads plus the exact bounded schema, picklist, layout, help-text, and record writes recorded in the [sanitized CRM package](../../../src/zoho-crm/README.md). It did not expose direct typed native conversion, conversion-map mutation, or workflow-rule mutation. The dated machine inventory is not a current CRM allowlist.

- [Capability analysis and broader official-family crosswalk](snapshots/configured/2026-08-04/capability-catalog.md)
- [Complete machine-readable configured-selection inventory](snapshots/configured/2026-08-04/sylvara-observed-tool-inventory.json)

## Tool Manual Snapshot

The dated Tool Manual catalog records 10,533 service-qualified rows across 59 documented services. Eight products in the current Sylvara snapshot account for 3,222 of those dated rows. The repository preserves the compact service/count index and links the relevant product handbooks instead of copying provider-owned manuals. Exact current names, parameters, scopes, and side effects must be refreshed from the official interactive Tool Manual before server design. The configured-session snapshot separately preserves all 294 role-qualified selections that passed the public sanitization review.

The supplied authenticated Catalyst `All Tools` interface displayed 189 actions on 2026-08-14, 13 more than the 176 Catalyst rows in the 2026-07-24 aggregate snapshot. The [dated Catalyst catalog](reference/zoho-catalyst-tool-manual-catalog-2026-08-14.md) preserves all 189 display labels, concise connector-description derivatives, an official Zoho documentation-family crosswalk, practical use cases, and exact public action-page gaps. It proves only dated provider-picker membership. It does not establish prefix-free operation keys, selection in a configured server, an advertised input schema, connection permission, effective access, or authorization to invoke an action.

## Server Design Sequence

1. Define one concrete Sylvara workflow and its authoritative system.
2. Identify the minimum official capabilities required.
3. Compare the Tool Manual, template membership, configured selections, and currently advertised contracts without conflating them or inferring missing request and response behavior.
4. Split metadata/content reads from writes and high-risk actions.
5. Bind organization, environment, and data center inside the server boundary where possible.
6. Exclude delete, public-sharing, arbitrary secret, unrestricted execution, and break-glass operations by default.
7. Verify identity with the least-sensitive call.
8. Acceptance-test only the approved bounded capability.
9. Validate response shape and read authoritative state back.
10. Record a dated sanitized result without secrets, records, or private identifiers.

See the [MCP Server Standard](server-standard.md) for the complete control contract.
