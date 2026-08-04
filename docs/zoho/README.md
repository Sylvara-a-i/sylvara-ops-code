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

- [MCP Server Standard](mcp/server-standard.md)
- [Observed MCP Capability Catalog](mcp/capability-catalog.md)
- [CRM Schema Standard](crm-schema-standard.md)
- [Deluge Engineering Standard](deluge-standard.md)
- [Billing Standard](billing-standard.md)
- [Catalyst Standard](catalyst-standard.md)
- [Workflow And Intake Standard](workflow-and-intake-standard.md) for Creator, Forms, and Sites
- [Document Lifecycle Standard](document-lifecycle-standard.md) for WorkDrive, Contracts, and Sign
- [Mail Standard](mail-standard.md)
- [Analytics Standard](analytics-standard.md)
- [Accounting Practices Standard](accounting-practices-standard.md)
- [Zoho Books Automation Standard](../../src/zoho-books/automation-standard.md)
- [Machine-readable observed tool inventory](mcp/observed-tool-inventory.json)
- [Machine-readable Zoho suite ownership registry](suite-registry.json)

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
| Mail | Mailbox messages, delivery state, and approved mail administration | Not CRM relationship truth; message bodies and attachments remain private |
| Analytics | Reporting models, dashboards, and derived analytical data | Not a transactional source of truth; synchronized data may be stale |

## Governed Artifact Contract

A reusable Zoho artifact is governed only when it makes the following review boundaries explicit:

1. its purpose, owning product, operational source of truth, and systems it must not replace;
2. its evidence status and observation date, including whether it is Verified, Proposed, Legacy, or Unknown;
3. its capability layer: official Zoho API support, an advertised MCP tool contract, or effective access in the intended Sylvara tenant;
4. its prerequisites, accepted inputs, expected outcomes, side effects, failure behavior, and idempotency requirements;
5. its public-repository and logging rules, using synthetic examples and excluding secrets, private identifiers, PII, financial data, and document contents;
6. its reproducible validation, independent readback, rollback, and required manual setup; and
7. its deployment and approval boundary, including an explicit statement that repository review is not authorization for a live change.

An archived file, example, tool inventory, or official API link does not become a governed production artifact by association. If a required part of this contract is missing or stale, the artifact remains **Proposed**, **Legacy**, or **Unknown** and must fail closed for live use.

## Evidence Rules

Use the repository's status labels consistently:

- **Verified:** confirmed through current, dated, read-only evidence;
- **Proposed:** designed but not proven configured or deployed;
- **Legacy:** retained only as historical reference; and
- **Unknown:** missing, stale, ambiguous, truncated, or incomplete evidence.

Live metadata outranks this repository. An MCP tool's presence proves only that a contract was advertised in the inspected session. It does not prove OAuth scope, target identity, permissions, response completeness, or successful execution.

Official API documentation proves general product capability, not that an MCP tool exists. An advertised MCP tool proves only the inspected tool contract, not effective tenant access. Effective tenant scope requires a current identity binding, least-privilege grant, plan and feature availability, a safe acceptance call, and authoritative readback. See the [capability evidence layers](mcp/capability-catalog.md#capability-evidence-layers).

## Current Snapshot

On 2026-08-03, read-only discovery found 10 enabled Zoho MCP server roles and 403 advertised tools: 245 reads and 158 write-capable actions. No Zoho tool was called. Source server identities, endpoints, and production target identifiers were excluded. Dated, normalized tool IDs were retained only to distinguish the advertised contracts and are not stable names or live identifiers.

No Creator, Forms, Billing, Contracts, Sign, Sites, Mail, or Analytics MCP role was observed in that inspection. Their availability is **Unknown**, not unsupported.
