# Zoho Knowledge Base

## Purpose

This directory is the single front door for Sylvara's reusable Zoho knowledge. It contains operating standards, product references, MCP evidence, ownership rules, and publication controls without copying another organization's configuration or treating documentation as live-state proof.

Implementation-specific READMEs remain beside the code or artifact they govern so deployment, validation, and rollback instructions do not drift. Those exceptions are indexed here and are not duplicate standards.

## Directory Map

| Area | Purpose | Authority |
|---|---|---|
| [`governance/`](governance/) | System ownership, evidence rules, publication boundaries, and the machine-readable suite registry | Sylvara repository policy |
| [`standards/`](standards/) | Reusable engineering and operating standards | Governs proposed Sylvara work, subject to live verification |
| [`reference/`](reference/) | Dated product handbooks distilled from authorized research and current official links | Reference only; adoption and live access remain Unknown |
| [`mcp/`](mcp/) | MCP server design, complete dated tool-name catalogs, and configured-selection snapshots | Evidence-layer specific; never an implicit tool allowlist |

## Start Here

1. Read [System Ownership](governance/system-ownership.md) to identify the authoritative system.
2. Read [Evidence And Publication](governance/evidence-and-publication.md) before relying on any reference or publishing a derivative.
3. For accounting-policy, federal-tax, or U.S. GAAP questions, start with the product-neutral [Accounting Knowledge Base](../accounting/README.md).
4. Read the relevant document under [`standards/`](standards/).
5. Use the matching product handbook under [`reference/`](reference/) for platform vocabulary, API families, and official-source links.
6. For MCP work, read the [MCP index](mcp/README.md) and keep its six evidence layers separate.
7. Before a live change, verify the exact Sylvara organization, environment, role, metadata, permissions, and current state through the authorized tool.

## Standards Index

- [CRM Schema](standards/crm-schema.md)
- [Deluge Engineering](standards/deluge.md)
- [Zoho Books Automation](standards/books-automation.md)
- [Accounting Practices — Zoho Books implementation](standards/accounting.md)
- [Billing](standards/billing.md)
- [Catalyst](standards/catalyst.md)
- [Creator, Forms, And Sites Workflow And Intake](standards/workflow-and-intake.md)
- [WorkDrive, Contracts, And Sign Document Lifecycle](standards/document-lifecycle.md)
- [Mail](standards/mail.md)
- [Analytics](standards/analytics.md)

## Product Reference Index

The [product reference collection](reference/README.md) covers the currently governed suite plus reference-only products that may become relevant later. Every handbook is dated, links to official sources, and remains non-authoritative until current Sylvara requirements and live metadata verify adoption.

## MCP Index

- [MCP Evidence And Navigation](mcp/README.md)
- [MCP Server Standard](mcp/server-standard.md)
- [Sylvara configured-session capability catalog, 2026-08-04](mcp/snapshots/configured/2026-08-04/capability-catalog.md)
- [Sylvara enabled-tool catalog by neutral server role, 2026-08-04](mcp/snapshots/configured/2026-08-04/enabled-tool-catalog.md)
- [Sylvara configured-session machine-readable inventory, 2026-08-04](mcp/snapshots/configured/2026-08-04/sylvara-observed-tool-inventory.json)
- [Current Tool Manual service catalog, 2026-08-05](mcp/reference/tool-manual-service-catalog-2026-08-05.md)
- [Complete Tool Manual names-only catalog, 2026-08-05](mcp/reference/tool-manual-tool-catalog-2026-08-05.json)
- [Historical Tool Manual service-count catalog, 2026-07-24](mcp/reference/tool-manual-service-catalog-2026-07-24.md)
- [Preconfigured template catalog, 2026-07-25](mcp/reference/preconfigured-template-catalog-2026-07-25.md)

## Code-Adjacent Zoho Artifacts

- [Zoho Books implementation area](../../src/zoho-books/README.md)
- [Sanitized chart-of-accounts reference](../../src/zoho-books/reference/README.md)
- [Proposed Billing webhook gateway](../../src/zoho-catalyst/billing-webhook-gateway/README.md)
- [Historical, non-executable Billing gateway review record](../../archive/zoho-catalyst/billing-webhook-gateway/README.md)

These files stay beside their artifacts because they describe exact source, validation, deployment, provenance, or rollback behavior. Reusable policy belongs here under `docs/zoho/`.

## Portability Boundary

Portable knowledge includes:

- product vocabulary, documented API families, and current official links;
- metadata-first discovery and use of returned API names;
- read/write separation, fixed-target binding, approval gates, and independent readback;
- generic field-type, layout, lookup, picklist, workflow, and subform constraints;
- Deluge validation, error handling, redaction, idempotency, and test conventions;
- accounting, document, webhook, and customer-communication controls; and
- provider-neutral retry, reconciliation, rollback, and evidence rules.

The following are deliberately excluded:

- another organization's fields, modules, layouts, rules, workflows, prompts, or business logic;
- server names, private endpoints, connection aliases, OAuth grants, credentials, or live routes;
- organization, project, account, record, resource, deployment, workflow, customer, property, or financial identifiers;
- records, documents, screenshots, logs, payloads, reports, exports, or private source artifacts; and
- any claim that a documented API, tool name, template, or archived artifact is enabled or safe for Sylvara.

Sylvara field selection and workflow design must come from Sylvara requirements. No field catalog or business process from another tenant is an input to that decision.

## Governed Artifact Contract

A reusable Zoho artifact is governed only when it states:

1. its purpose, owning product, source of truth, and prohibited ownership;
2. its evidence status and observation date;
3. whether a claim comes from official documentation, a Tool Manual catalog, a preconfigured template, a configured MCP selection, an advertised MCP contract, or verified effective access;
4. prerequisites, inputs, side effects, failure behavior, idempotency, and reconciliation rules;
5. public-repository, logging, privacy, and secret-handling boundaries;
6. reproducible validation, readback, rollback, and manual setup; and
7. the exact deployment and approval boundary.

If any required element is missing or stale, the artifact remains **Reference**, **Proposed**, **Legacy**, or **Unknown** and must fail closed for live use.

## Evidence Status

- **Verified:** confirmed through current, dated, read-only evidence for the exact target.
- **Reference:** portable product knowledge with no claim of adoption or effective access.
- **Proposed:** designed for Sylvara but not proven configured or deployed.
- **Legacy:** retained only for historical or forensic reference.
- **Unknown:** missing, stale, ambiguous, truncated, or incomplete evidence.

Official documentation establishes general product capability. A Tool Manual row establishes a dated service-qualified operation key. A preconfigured template establishes dated template membership. A configured-selection snapshot establishes only that one inspected role contained the operation on the observation date; it does not establish current parameters, response schemas, side effects, authorization, or successful execution. Only an exact identity check, current private contract inspection, and authorized acceptance call can establish effective Sylvara access.

## Current MCP Snapshot

On 2026-08-04, configured-session discovery found 294 Sylvara-only Zoho selections across 18 neutral roles and eight products: 221 reads and 73 write-capable actions. The supplied export and callable registry available on the observation date agreed at the role-and-count level. No Zoho operation was called. Each row now separates the exact prefix-free catalog operation key from its human annotation; product or server prefixes are not part of annotated tool names. Runtime namespaces, generated transport IDs, service-prefixed adapter labels, endpoints, authentication details, connection aliases, and production target identifiers were excluded.

Billing, Books, Catalyst, Creator, CRM, Mail, Payments, and WorkDrive were observed at the configured-selection layer. Forms, Contracts, Sign, Sites, and Analytics were not observed; their MCP availability is **Unknown**, not unsupported. Observation does not establish product adoption, tenant binding, effective authorization, or permission for live use.

## Live Change Boundary

Repository review is not live-system approval. Before any production Zoho write, show the exact current state, proposed state, authorized server/tool and parameters, rollback, and readback plan; obtain approval scoped to that action. Stop on missing capability, ambiguous identity, stale evidence, incomplete responses, or unsafe rollback.
