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

The consolidated Catalyst/Zoho release is **NOT READY FOR RETELL AGENT TESTING**. On 2026-08-28, all six canonical Development definitions converged at release-candidate revision `288a93c7773acaf82fab277702e6b4e3d7354564` with exact source stamps, Node 24, 256 MB, exact private configuration, and byte-for-byte Catalyst archive pullback parity by path set and file content. Exact private-map readback returned 30/34/31/28/30/7 variables in canonical order. Form 2 remains stub-only, the worker has its complete Development map with dry-run notification, CRM paid/probe gates remain false, and Analytics remains disabled. The Gateway function's configured deployment mode is active while API Gateway ingress is independently disabled and fail-closed. Because disabled Gateway readback returned no route payload, the latest packet did not revalidate the separately recorded twelve-route configuration.

Form 1 has a separate fail-closed release gate. Its authenticated no-save readbacks prove all 30 native CRM mappings and the exact 26-field builder policy dictionary, but do not prove runtime respondent editability, form-entry retention, or retry/duplicate behavior. Five desired UTM fields are absent from the builder despite retained CRM mappings. The existing `Assisted Intake Token` field is hidden, unaliased, inert, and not safe to repurpose. Repository source removes the unsafe token-bearing URL path and Issue now fails closed before token, CRM, or Data Store work; the installed 288a93c revision predates that correction. Gateway and both Form 1 routes remain disabled, the CRM button and Forms prefill caller remain unbound, and no safe Form 1 live mutation packet exists. See the sanitized [CRM mapping readback](../../src/zoho-forms/free-revenue-leak-test/evidence/form1-crm-mapping-readback-2026-08-28.json) and [field-policy readback](../../src/zoho-forms/free-revenue-leak-test/evidence/form1-field-policy-readback-2026-08-28.json).

Billing catalog mutation has its own fail-closed gate. Schema v4 requires fresh complete paginated target absence for product and usage-add-on creation, one concrete exact normalized inventory entry for every present plan tier, and all three exact plan IDs and terms before add-on assembly. A plan packet authorizes one missing tier; partial or ambiguous success is never retried. A fresh post-ambiguity packet must bind the prior packet digest and authoritative resolution, and a resolution proving the target exists authorizes no creation. Packet- or environment-provided capability hashes are not authority: the registry must match the digest in the committed capability-authority record, which is currently non-executable because the installed Sylvara Billing Changes connector has no product, plan, add-on, Usage Billing settings, or mark-inactive tools. `singleUse` remains declarative; a future executor must atomically claim the stable operation-authorization ID as a UNIQUE key, store the validator-returned digest that binds that ID and the exact packet, and retain the claim after every outcome. See the [Billing validator contract](../../src/zoho-catalyst/crm-billing-orchestrator/README.md), [committed capability authority](../../src/zoho-catalyst/crm-billing-orchestrator/config/billing-catalog-capability-authority.json), and [sanitized TEST catalog preflight](../../src/zoho-catalyst/crm-billing-orchestrator/config/billing-test-catalog-preflight-2026-08-28.json).

The route configuration chronology is finite and approval-scoped: the first phase ended at the single exact `RETELL_INBOUND` route; a separately approved `RETELL_EVENTS` creation was contained when exact readback exposed one duplicate-separator defect; a separate single-use remediation approval corrected only that defect and established the exact two-route prestate; and a fresh ten-route continuation approval created the remaining routes and established exact twelve-route parity. Each approval was consumed and is not reusable. These were configuration actions, not route executions. During this execution, the operator invoked no route, function, Job, or Cron and performed no Retell-provider or agent test, call, simulation, publish, phone-route, or other provider-side change, customer action, or Production action.

Historical 2026-08-27 route-continuation evidence remains unchanged: both canonical Function Job pools matched exact at 512 MB. A relative prior-24-hour access and application log query ran after the final disabled-Gateway readback and returned zero rows; exact UTC bounds were not retained. Provider-complete all-history Job inventory remains unproven. These historical observations were not freshly revalidated by either the e1da1bc predecessor packet or the 288a93c reconvergence packet. A later connector-first read-only preflight reconfirmed both canonical pools and proved every repository-required application-schema projection exact across all thirteen canonical tables, without reading table rows or proving pool function targets, caller/webhook inventory, complete Jobs/executions, endpoint privacy, or runtime acceptance.

The complete visible `All Time` Jobs UI result, with `All Status` selected, displayed 15 rows, no pagination controls, and zero references to the canonical pools. Provider-complete all-history Job inventory remains unproven. Both canonical Function Job pools are present, but the available surfaces do not prove their function-target binding. Earlier readback recorded all nine required Connections with exact least-privilege scopes; the latest release packet did not revalidate that provider state. The complete current Cron inventory contains zero canonical references. Earlier bounded log evidence does not prove exact all-history execution, and direct caller and webhook bindings remain unproven. A separate CRM preflight closes the historical 25-field metadata/layout gap, and a later connector readback independently proves the Draft candidate is bound to the exact `Revenue Desk Sales` pipeline. The Blueprint is still two required transitions short with one legacy combined transition, and workflow, caller, validator, save/readback, and synthetic acceptance gates remain open. Live ingress stays dark until the separate Retell task and the remaining binding, acceptance, reconciliation, and rollback gates are complete. The [final release contract](../product/free-revenue-leak-test-release-contract.md), [current convergence evidence](../../src/zoho-catalyst/evidence/free-revenue-leak-test-development-pr-head-convergence-2026-08-28-288a93c.json), [execution-surface and table-schema preflight](../../src/zoho-catalyst/evidence/free-revenue-leak-test-development-execution-surface-preflight-2026-08-28.json), [CRM topology and layout preflight](../../src/zoho-crm/free-revenue-leak-test/evidence/live-topology-layout-preflight-2026-08-28.json), [CRM pipeline-binding readback](../../src/zoho-crm/free-revenue-leak-test/evidence/live-blueprint-pipeline-binding-readback-2026-08-28.json), [historical PR-head convergence evidence](../../src/zoho-catalyst/evidence/free-revenue-leak-test-development-pr-head-convergence-2026-08-28.json), [historical six-function evidence](../../src/zoho-catalyst/evidence/free-revenue-leak-test-development-six-function-deployment-2026-08-27.json), [twelve-route continuation evidence](../../src/zoho-catalyst/evidence/free-revenue-leak-test-development-route-continuation-2026-08-27.json), and [current reconciliation](../runbooks/free-revenue-leak-test-e2e-reconciliation-2026-08-24.md) are authoritative within their recorded limits.

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

The 2026-08-05 CRM role refresh verified organization identity plus scoped module, field, layout, picklist, record, workflow, and Lead-conversion-map reads. That change surface did not provide a direct typed native Convert Lead write, Lead Conversion Mapping mutation, or workflow-rule mutation. A later, separately scoped 2026-08-14 automation surface was used for authorized bounded workflow and Blueprint configuration, followed by independent readback. The immutable schema and automation snapshots are documented in the [CRM metadata snapshot](../../src/zoho-crm/reference/snapshots/2026-08-14/README.md) and [effective automation snapshot](mcp/snapshots/effective/2026-08-14/free-test-crm-automation.md); the later current-state delta is in the [2026-08-28 sanitized topology preflight](../../src/zoho-crm/free-revenue-leak-test/evidence/live-topology-layout-preflight-2026-08-28.json). Configuration and execution markers are not runtime acceptance: the Blueprint has no enrolled records, its inactive topology is divergent, native conversion remains human-approved, and the Forms/controller path remains unverified.

Billing, Books, Catalyst, Creator, CRM, Mail, Payments, and WorkDrive were observed at the configured-selection layer. Forms, Contracts, Sign, and Sites were not observed. Analytics was not observed in the 2026-08-04 configured selection, but the official managed Analytics MCP page was reviewed on 2026-08-18 and its 24 published tool names are preserved in the dated catalog. The earlier Tool Manual service catalog counted 25 Analytics rows; those separate evidence layers remain unreconciled. Analytics configured selection, identity, authorization, plan, workspace, and effective access are **Unknown**, not unsupported. A selection, advertised contract, or past successful call does not grant continuing approval for live use.

## Live Change Boundary

Repository review is not live-system approval. Before any production Zoho write, show the exact current state, proposed state, authorized integration or governed browser action, constrained parameters, rollback, and readback plan; obtain approval scoped to that action. Prefer the correct plugin, MCP server, or connector. If current discovery proves it unavailable, inaccessible, failed for the operation, or capability-incomplete, the authenticated in-app browser may be used under the connector-first fallback in [`AGENTS.md`](AGENTS.md). Stop when neither surface can prove exact identity, semantics, outcome, and safe rollback, or when evidence is stale, incomplete, or ambiguous.
