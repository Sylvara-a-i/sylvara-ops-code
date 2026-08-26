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
| [`mcp/`](mcp/) | MCP server design, dated catalogs, and configured-selection snapshots | Evidence-layer specific; never an implicit tool allowlist |

## Start Here

1. Read [System Ownership](governance/system-ownership.md) to identify the authoritative system.
2. Read [Evidence And Publication](governance/evidence-and-publication.md) before relying on any reference or publishing a derivative.
3. For accounting-policy, federal-tax, or U.S. GAAP questions, start with the product-neutral [Accounting Knowledge Base](../accounting/README.md).
4. Read the relevant document under [`standards/`](standards/).
5. Use the matching product handbook under [`reference/`](reference/) for platform vocabulary, API families, and official-source links.
6. For MCP work, read the [MCP index](mcp/README.md) and keep its six evidence layers separate.
7. Before a live change, verify the exact Sylvara organization, environment, role, metadata, permissions, and current state through the preferred integration or the governed browser fallback in [`AGENTS.md`](AGENTS.md).

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
- [Call Reporting Metric Contract](standards/call-reporting-metric-contract.md)

## Product Reference Index

The [product reference collection](reference/README.md) covers the currently governed suite plus reference-only products that may become relevant later. Every handbook is dated, links to official sources, and remains non-authoritative until current Sylvara requirements and live metadata verify adoption.

## MCP Index

- [MCP Evidence And Navigation](mcp/README.md)
- [MCP Server Standard](mcp/server-standard.md)
- [Sylvara configured-session capability catalog, 2026-08-04](mcp/snapshots/configured/2026-08-04/capability-catalog.md)
- [Sylvara configured-session machine-readable inventory, 2026-08-04](mcp/snapshots/configured/2026-08-04/sylvara-observed-tool-inventory.json)
- [Tool Manual service catalog, 2026-07-24](mcp/reference/tool-manual-service-catalog-2026-07-24.md)
- [Zoho CRM Tool Manual catalog, 2026-08-14](mcp/reference/zoho-crm-tool-manual-catalog-2026-08-14.md)
- [Historical Form 1/Form 2 CRM MCP allowlist, 2026-08-14](mcp/proposals/2026-08-14/sylvara-free-test-crm-mcp-allowlist.md)
- [Effective Form 1/Form 2 CRM automation snapshot, 2026-08-14](mcp/snapshots/effective/2026-08-14/free-test-crm-automation.md)
- [Current CRM field, picklist, layout, conversion, and form map snapshot, 2026-08-14](../../src/zoho-crm/reference/snapshots/2026-08-14/README.md)
- [Zoho Catalyst 189-action Tool Manual catalog, 2026-08-14](mcp/reference/zoho-catalyst-tool-manual-catalog-2026-08-14.md)
- [Zoho Analytics managed MCP tool catalog, 2026-08-18](mcp/reference/zoho-analytics-managed-mcp-catalog-2026-08-18.md)
- [Preconfigured template catalog, 2026-07-25](mcp/reference/preconfigured-template-catalog-2026-07-25.md)

## Code-Adjacent Zoho Artifacts

- [Sanitized CRM schema and Lead-conversion reference](../../src/zoho-crm/README.md)
- [Zoho Books implementation area](../../src/zoho-books/README.md)
- [Sanitized chart-of-accounts reference](../../src/zoho-books/reference/README.md)
- [Proposed Billing webhook gateway](../../src/zoho-catalyst/billing-webhook-gateway/README.md)
- [Historical, non-executable Billing gateway review record](../../archive/zoho-catalyst/billing-webhook-gateway/README.md)
- [Retell, Catalyst, CRM, and Analytics integration boundary](../adr/0004-retell-catalyst-crm-analytics-integration-boundary.md)
- [Authoritative shared 7-Day Free Test architecture](../adr/0006-shared-seven-day-monitor-with-client-number-isolation.md)
- [Shared free-test Development, acceptance, and rollback runbook](../runbooks/shared-seven-day-monitor-number-routing.md)
- [Sanitized 2026-08-22 Development runtime/source reconciliation](../runbooks/free-test-development-reconciliation-2026-08-22.md)
- [Free-test runtime security controls](../security/free-test-runtime-controls.md)
- [Retell-to-reporting deployment and containment runbook](../runbooks/retell-catalyst-analytics-reporting.md)
- [Revenue Desk shared call-runtime contract](../../src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_call_gateway/contracts/revenue-desk-call-contract.json)
- [Revenue Desk call-runtime environment-variable registry](../../src/zoho-catalyst/revenue-desk-call-runtime/config/variables.json)
- [Revenue Desk canonical Catalyst Data Store schema](../../src/zoho-catalyst/revenue-desk-call-runtime/config/datastore-schema.json)

These files stay beside their artifacts because they describe exact source, validation, deployment, provenance, or rollback behavior. Reusable policy belongs here under `docs/zoho/`.

The consolidated Catalyst/Zoho release is **NOT READY FOR RETELL AGENT TESTING**. The prior Development revision and four-table/two-function proof are migration evidence only; they do not prove the canonical six-function, two-pool, thirteen-table, CRM/Billing, Analytics, cleanup, rotation, final-main, or dark-Production state. The [final release contract](../product/free-revenue-leak-test-release-contract.md) and [current reconciliation](../runbooks/free-revenue-leak-test-e2e-reconciliation-2026-08-24.md) are authoritative.

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

Official documentation establishes general product capability. A Tool Manual row establishes a dated service and catalog operation key. A preconfigured template establishes dated template membership. A configured-selection snapshot establishes only that one inspected role contained the service-plus-operation-key selection on the observation date. A currently advertised description and input schema establish a bounded contract, not authorization or successful execution. Only an exact identity check, current private contract inspection, and authorized acceptance call can establish effective Sylvara access.

## Current MCP Snapshot

The dated 2026-08-04 configured-session snapshot contains 294 Sylvara-only Zoho selections across 18 neutral roles and eight products: 221 reads and 73 write-capable actions. An earlier 2026-08-05 export matched that snapshot. Later same-day callable-registry refreshes superseded the Books and CRM portions. Each historical row separates the exact prefix-free catalog operation key from its prefix-free annotation. Runtime namespaces, generated transport IDs, service-prefixed adapter labels, endpoints, authentication details, connection aliases, and production target identifiers are excluded.

The refreshed Books Controller advertises chart-account create, update, mark-active, and mark-inactive operations. The Audit and Controller connections, same-organization identity, and those four operations were verified in an approved bounded chart deployment on 2026-08-05; every mutation received independent Audit readback. This proves only the scoped chart contracts exercised in that deployment, not other Books writes or continuing approval. The older 2026-08-04 inventory remains a historical snapshot, not the current Books allowlist.

The 2026-08-05 CRM role refresh verified organization identity plus scoped module, field, layout, picklist, record, workflow, and Lead-conversion-map reads. That change surface did not provide a direct typed native Convert Lead write, Lead Conversion Mapping mutation, or workflow-rule mutation. A later, separately scoped 2026-08-14 automation surface was used for authorized bounded workflow and Blueprint configuration, followed by independent readback. The current schema and automation contract are documented in the [CRM metadata snapshot](../../src/zoho-crm/reference/snapshots/2026-08-14/README.md) and [effective automation snapshot](mcp/snapshots/effective/2026-08-14/free-test-crm-automation.md). Configuration readback is not runtime acceptance: the four new workflows have not executed, the Blueprint has no enrolled records, native conversion remains human-approved, and the Forms/controller path remains unverified.

Billing, Books, Catalyst, Creator, CRM, Mail, Payments, and WorkDrive were observed at the configured-selection layer. Forms, Contracts, Sign, and Sites were not observed. Analytics was not observed in the 2026-08-04 configured selection, but the official managed Analytics MCP page was reviewed on 2026-08-18 and its 24 published tool names are preserved in the dated catalog. The earlier Tool Manual service catalog counted 25 Analytics rows; those separate evidence layers remain unreconciled. Analytics configured selection, identity, authorization, plan, workspace, and effective access are **Unknown**, not unsupported. A selection, advertised contract, or past successful call does not grant continuing approval for live use.

## Live Change Boundary

Repository review is not live-system approval. Before any production Zoho write, show the exact current state, proposed state, authorized integration or governed browser action, constrained parameters, rollback, and readback plan; obtain approval scoped to that action. Prefer the correct plugin, MCP server, or connector. If current discovery proves it unavailable, inaccessible, failed for the operation, or capability-incomplete, the authenticated in-app browser may be used under the connector-first fallback in [`AGENTS.md`](AGENTS.md). Stop when neither surface can prove exact identity, semantics, outcome, and safe rollback, or when evidence is stale, incomplete, or ambiguous.
