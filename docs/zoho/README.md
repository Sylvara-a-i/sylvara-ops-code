# Zoho Engineering Standards

## Purpose

This area preserves reusable Zoho engineering behavior for Sylvara without copying another business's configuration. It documents how to discover capabilities, design least-privilege MCP servers, govern CRM schemas, write Deluge, and control accounting automation.

These documents are public technical standards. They are not exports of a live Zoho tenant, proof that a connection works, or authorization to change Zoho.

## Portability Boundary

Portable knowledge includes:

- metadata-first discovery and use of returned API names;
- read/write separation, fixed-target binding, approval gates, and independent readback;
- generic field-type, layout, lookup, picklist, workflow, and subform constraints;
- Deluge validation, error handling, redaction, idempotency, and test conventions;
- Books accounting controls and evidence requirements; and
- WorkDrive and Catalyst capability boundaries.

The following are deliberately excluded:

- field selections, modules, layouts, rules, and business logic chosen for another organization;
- source MCP server names, private endpoints, connection names, OAuth grants, and credentials;
- organization, project, account, record, resource, deployment, and workflow identifiers;
- records, documents, logs, payloads, reports, screenshots, and personal or financial data; and
- any assumption that an advertised tool is authorized, callable, complete, or safe for Sylvara.

Sylvara's CRM fields will be selected from Sylvara requirements after live metadata and collision checks. No field catalog from another tenant is an input to that decision.

## Standards Index

- [Observed MCP Capability Catalog](mcp/capability-catalog.md)
- [MCP Server Standard](mcp/server-standard.md)
- [CRM Schema Standard](crm-schema-standard.md)
- [Deluge Engineering Standard](deluge-standard.md)
- [Zoho Books Automation Standard](../../src/zoho-books/automation-standard.md)
- [Machine-readable observed tool inventory](mcp/observed-tool-inventory.json)

## System Ownership

| Zoho product | Intended ownership | Boundary |
|---|---|---|
| CRM | Prospects, customers, contacts, opportunities, and approved relationship state | Not accounting truth, a document vault, or a secret store |
| Books | General ledger, accounting balances, invoices recorded in Books, payments, credits, and reconciliation | Not CRM relationship ownership or workflow source code |
| Billing | Subscription lifecycle and entitlements only where explicitly adopted | Must not silently duplicate Books accounting ownership |
| Creator | Approved forms, workflow UI, human tasks, and operational views | Must not recreate Books or become an unapproved platform |
| WorkDrive | Approved private document storage and immutable resource references | Public links and raw documents do not belong in CRM or GitHub |
| Catalyst | Verification, normalization, idempotency, durable retry state, API mediation, and approved release artifacts | Not the owner of CRM or accounting facts |
| Forms | Lightweight external intake when Creator is unnecessary | Not a system of record unless explicitly approved |
| Contracts / Sign | Legal document generation, routing, execution, and evidence | Legal templates and signer data remain private |
| Sites | Public doorway when adopted | Not a source of operational truth |

## Evidence Rules

Use the repository's status labels consistently:

- **Verified:** confirmed through current, dated, read-only evidence;
- **Proposed:** designed but not proven configured or deployed;
- **Legacy:** retained only as historical reference; and
- **Unknown:** missing, stale, ambiguous, truncated, or incomplete evidence.

Live metadata outranks this repository. An MCP tool's presence proves only that a contract was advertised in the inspected session. It does not prove OAuth scope, target identity, permissions, response completeness, or successful execution.

## Current Snapshot

On 2026-08-03, read-only discovery found 10 enabled Zoho MCP server roles and 403 advertised tools: 245 reads and 158 write-capable actions. No Zoho tool was called. Source server identities, endpoints, and production target identifiers were excluded. Dated, normalized tool IDs were retained only to distinguish the advertised contracts and are not stable names or live identifiers.

No Creator, Forms, Billing, Contracts, Sign, Sites, or Mail MCP role was observed in that inspection. Their availability is **Unknown**, not unsupported.
