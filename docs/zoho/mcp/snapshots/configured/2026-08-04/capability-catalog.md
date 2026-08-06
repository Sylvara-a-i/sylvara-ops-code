# Sylvara Zoho MCP Capability Catalog

## Scope And Evidence

This catalog is a sanitized historical snapshot of the Zoho tool names advertised to Codex for Sylvara on 2026-08-04. An earlier 2026-08-05 export matched its 294 role-qualified names. Later same-day callable-registry refreshes superseded the Books and CRM portions. The Books refresh exposed 91 Books Audit, 24 Books Changes, and 67 Books Controller operations, including chart create, update, mark-active, and mark-inactive. The separately recorded CRM refresh verified scoped metadata and record operations but no direct typed native conversion write. The rows below intentionally preserve the dated snapshot and are not a current Books or CRM allowlist. No Zoho chart-of-accounts write was invoked during the initial capability reconciliation; a later separately approved deployment exercised the four bounded chart operations with independent Audit readback.

Current scoped CRM evidence is indexed in the [suite registry](../../../../governance/suite-registry.json) and the [product-owned CRM package](../../../../../../src/zoho-crm/README.md); it is not merged into the historical rows below.

The complete role-qualified name inventory is in [`sylvara-observed-tool-inventory.json`](sylvara-observed-tool-inventory.json). Runtime server names, generated transport IDs, endpoints, authentication details, connection aliases, organization or account identifiers, record identifiers, sample values, and returned data are excluded.

This is **advertised tool-name evidence**, not proof of effective tenant access. The source export establishes role and operation names; it does not establish successful authorization, target binding, plan availability, response completeness, or safe write semantics.

## Capability Evidence Layers

| Evidence layer | What it establishes | What it does not establish |
|---|---|---|
| Official Zoho documentation | A generally documented product capability, API family, scope, limit, or behavior | That the capability is selectable in the current Tool Manual, enabled for Sylvara, or authorized for one identity |
| Dated Tool Manual catalog | A provider catalog row existed for a service at the recorded cutoff | That the row is still present, selected on a Sylvara server, or callable |
| Advertised Sylvara tool name | One neutral role exposed that operation name in the inspected Codex surface | Complete request or response semantics, successful execution, tenant binding, or approval to use it |
| Effective Sylvara capability | A specific identity, target, environment, role, grant, plan, and feature passed an authorized acceptance check | Permission for an adjacent tool, target, or future call |

Never promote evidence to a higher layer by assumption.

## Reconciliation On 2026-08-05

The snapshot records 40 `books-audit`, 15 `books-changes`, and 32 `books-controller` operations. Those historical counts do not match the later 2026-08-05 callable registry described above.

The specific chart-of-accounts surface is:

| Neutral role | Advertised capability | Current status |
|---|---|---|
| `books-audit` | Get one account, list accounts, and list account transactions | Refreshed role advertised; organization, identity, and complete active/inactive chart reads verified |
| `books-changes` | None | No chart capability advertised |
| `books-controller` | Create, update, mark active, and mark inactive | Refreshed typed wrappers; scoped operations exercised on 2026-08-05 and final independent Audit readback matched |

The official [Zoho Books Chart of Accounts API](https://www.zoho.com/books/api/v3/chart-of-accounts/) documents the same separate operations. The approved 2026-08-05 chart deployment established scoped effective access, but every future live mutation still requires fixed-organization binding, approved exact fields, fresh prestate, serialized writes, rollback, and independent Audit readback. Delete and bulk-status operations remain intentionally unnecessary.

## Observed Role Surface

| Neutral role | Read | Write / action | Total | Primary risk |
|---|---:|---:|---:|---|
| `billing-audit` | 32 | 0 | 32 | Subscription, invoice, payment, event, and revenue-report data |
| `billing-changes` | 6 | 13 | 19 | Customer and subscription lifecycle mutation |
| `books-audit` | 40 | 0 | 40 | Sensitive accounting records and reports |
| `books-changes` | 9 | 6 | 15 | Contact, estimate, and invoice mutation |
| `books-controller` | 10 | 22 | 32 | Credits, payments, journals, reconciliation, voids, and write-offs |
| `catalyst-audit` | 13 | 0 | 13 | Logs, routes, deployments, functions, pipelines, and environment metadata |
| `catalyst-break-glass` | 0 | 5 | 5 | Environment, route, and pipeline configuration |
| `catalyst-release` | 0 | 7 | 7 | Execution, test, deployment, rollback, pipeline, and build actions |
| `creator-audit` | 17 | 0 | 17 | Application metadata, records, approvals, comments, and usage |
| `creator-changes` | 5 | 6 | 11 | Record, comment, approval, and blueprint mutation |
| `crm-audit` | 35 | 0 | 35 | Metadata plus customer and commercial record content |
| `crm-changes` | 5 | 4 | 9 | Record and note creation or update |
| `mail-audit` | 12 | 0 | 12 | Mailbox, message, header, content, and attachment metadata |
| `mail-changes` | 2 | 2 | 4 | External email and reply delivery |
| `payments-audit` | 10 | 0 | 10 | Customer, payment, refund, payout, link, and session state |
| `payments-changes` | 3 | 4 | 7 | Customer, payment-link, and payment-session mutation |
| `workdrive-audit` | 21 | 0 | 21 | Document metadata, content search, preview, sharing, and download |
| `workdrive-changes` | 1 | 4 | 5 | Folder creation, upload, move, and rename |
| **Total** | **221** | **73** | **294** | Advertised names; no operation was called |

The 294 entries contain 257 unique product operation names. Thirty-four operation names appear in more than one role, creating 37 additional role-qualified entries. Those overlaps are intentional readback or discovery helpers; never deduplicate them across privilege boundaries.

## Product Coverage And Broader Possible Surface

The official Tool Manual is the provider's complete, changing tool-definition source. The dated 2026-07-24 catalog recorded 3,222 rows for the eight products observed here. Those rows are **possible provider catalog entries**, not enabled Sylvara tools, and they are not one-to-one comparable with this inventory because the same operation can be exposed in multiple roles.

| Product | Observed roles | Read | Write / action | Advertised total | Unique operation names | Dated Tool Manual rows | Product handbook |
|---|---:|---:|---:|---:|---:|---:|---|
| Zoho Billing | 2 | 38 | 13 | 51 | 45 | 453 | [Billing reference](../../../../reference/products/zoho-billing.md) |
| Zoho Books | 3 | 59 | 28 | 87 | 70 | 1,090 | [Books reference](../../../../reference/products/zoho-books.md) |
| Zoho Catalyst | 3 | 13 | 12 | 25 | 25 | 176 | [Catalyst reference](../../../../reference/products/zoho-catalyst.md) |
| Zoho Creator | 2 | 22 | 6 | 28 | 23 | 37 | [Creator reference](../../../../reference/products/zoho-creator.md) |
| Zoho CRM | 2 | 40 | 4 | 44 | 40 | 1,089 | [CRM reference](../../../../reference/products/zoho-crm.md) |
| Zoho Mail | 2 | 14 | 2 | 16 | 14 | 183 | [Mail reference](../../../../reference/products/zoho-mail.md) |
| Zoho Payments | 2 | 13 | 4 | 17 | 14 | 16 | [Payments reference](../../../../reference/products/zoho-payments.md) |
| Zoho WorkDrive | 2 | 22 | 4 | 26 | 26 | 178 | [WorkDrive reference](../../../../reference/products/zoho-workdrive.md) |
| **Total** | **18** | **221** | **73** | **294** | **257** | **3,222** | [Complete dated service catalog](../../../reference/tool-manual-service-catalog-2026-07-24.md) |

The product handbooks summarize the broader official API families, scopes, failure modes, and current official links. Copying Zoho's full manuals into this repository would become stale, blur the evidence boundary, and duplicate provider-owned documentation. Refresh the [Zoho MCP knowledge-base index](https://help.zoho.com/portal/en/kb/mcp), [implementation guide](https://help.zoho.com/portal/en/kb/mcp/implementation-guide/articles/zoho-mcp-implementation-guide), and [supported-services list](https://www.zoho.com/mcp/services/zoho-services.html) before selecting a new tool.

## Advertised Capability Families

### Zoho Billing

Observed reads cover organizations, customers, products, plans, add-ons, subscriptions, invoices, payments, events, custom fields, recent activity, scheduled changes, and recurring-revenue reports. The change role exposes bounded customer and subscription creation or update, contact-person changes, notes, pause/resume/reactivation, cancellation, and subscription reference or custom-field updates.

### Zoho Books

The dated snapshot covers identity and organization, contacts, items, estimates, invoices, bills, expenses, credit notes, customer payments, recurring invoices, bank transactions and accounts, chart-of-account transactions, locks, metadata, and financial reports. The later 2026-08-05 refresh adds chart-account creation, update, activation, and inactivation through the Controller, while preserving Audit readback separation.

### Zoho Catalyst

Observed reads cover organizations, projects, deployments, functions, routes, pipelines, environment-variable listings, and logs. Release actions cover function execution, automation tests, pipeline runs, redeployment, rollback, runtime changes, and build cancellation. Break-glass actions can modify environment variables, routes, and pipelines and must remain incident-scoped and disabled by default.

### Zoho Creator

Observed reads cover workspaces, applications, forms, reports, pages, sections, records, approvals, blueprint transitions, comments, metadata, and usage. Changes cover record creation or update, comments and replies, approval actions, and blueprint transitions.

### Zoho CRM

Observed reads cover organization, modules, fields, layouts, layout rules, picklists, pipelines, users, workflows, tasks, notes, tags, records, related records, timelines, search, counts, and COQL queries. Changes are limited to note creation/update and record creation/update. No schema-mutation or delete operation is advertised in this snapshot.

### Zoho Mail

Observed reads cover organization and account details, folders, message lists, search, content, headers, source messages, details, and attachment information. The change role exposes external send and reply actions plus the minimum folder/account discovery required by those operations.

### Zoho Payments

Observed reads cover merchant accounts, customers, payments, payment links, payment sessions, payouts, payout transactions, and refunds. Changes cover customer creation, payment-link creation/update, and payment-session creation. No refund, capture, or payout mutation is advertised.

### Zoho WorkDrive

Observed reads cover teams, team folders, users, hierarchy, file and folder lists, properties, versions, previews, changes, sharing, search, and download. Changes cover folder creation, file upload, upload status, move, and rename. Content search, preview, and download are read operations but remain high-risk data egress.

## Contract Limitations

- Runtime callable names contain generated or truncated transport identifiers. The inventory preserves the provider operation spelling and neutral role because those are the stable review keys.
- Every current runtime declaration returns a generic data/status envelope rather than a typed product response. A transport success value is not proof of the intended downstream outcome.
- Some discovery tools accept open argument objects, and several request schemas contain partially unknown fields. An advertised write with an open or incomplete payload remains blocked until its exact contract is verified.
- Download tools can return binary or content-bearing data; WorkDrive uploads use multipart behavior. These require separate redaction, size, malware, and content-handling controls.
- Read-only does not mean low sensitivity. Reports, messages, records, logs, previews, downloads, payments, and accounting data can all expose restricted information.

## Classification Rules

Operations that only get, list, search, fetch, view, report, preview, download, query, or check status are classified as reads. CRM COQL execution and WorkDrive upload-status retrieval are explicit read exceptions despite action-like names.

Create, add, update, send, execute, cancel, pause, resume, reactivate, apply, mark, write off, reverse, submit, exclude, restore, uncategorize, unmatch, configure, redeploy, roll back, move, rename, and upload operations are classified as write/actions. Ambiguous operations fail closed as write/actions until their method and side effects are verified.

## Unobserved Sylvara Surfaces

No Sylvara Forms, Contracts, Sign, Sites, or Analytics tool name was present in the inspected surface. Their current MCP availability is **Unknown**, not unsupported. Product API documentation or a Tool Manual row does not prove that a Sylvara server advertises or can execute the capability.

## Live Use Gate

Repository documentation is not live-system approval. Before calling any Zoho operation:

1. verify the exact target identity, product, organization or account, environment, role, and current grant;
2. inspect the current request and response schema and reject untyped or incomplete writes;
3. show fresh prestate, proposed state, side effects, idempotency behavior, rollback, and independent readback;
4. obtain approval scoped to the exact live action; and
5. stop on ambiguity, stale evidence, missing prerequisites, partial responses, or unsafe rollback.

## Refresh Procedure

1. Export the current configured tool list in a trusted local session without publishing raw namespaces, endpoints, or authorization data.
2. Filter to the intended business and Zoho products before any comparison.
3. Cross-check role counts and advertised names against the current callable registry without invoking Zoho.
4. Preserve exact operation spelling, neutralize server roles, classify side effects, and retain role-qualified duplicates.
5. Refresh the official Tool Manual and product documentation separately.
6. Replace this dated snapshot, update navigation and governance status, and run all safety checks.
7. Perform effective-access acceptance only through a separately approved, least-sensitive workflow.
