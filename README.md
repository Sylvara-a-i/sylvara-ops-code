# Sylvara Operations Code

Public, sanitized technical source of truth for Sylvara's managed Revenue Desk product and the business systems that support its delivery.

This repository is publicly viewable but is not open source. See [`NOTICE.md`](NOTICE.md).

## Current Product Direction

Sylvara's official strategy is a managed Revenue Desk for one-location residential service plumbing companies with approximately 5–15 active field technicians. The acquisition offer is a 7-Day / 25-Call Revenue Leak Test on an approved after-hours and/or no-answer/overflow route. Paid Launch is a complete managed AI receptionist with metered usage; Growth is the recommended managed Revenue Desk; Scale and Enterprise add broader revenue operations only when paid scope and delivery evidence justify them. The product completes and attributes bounded business workflows; it is not a generic voice-agent subscription or a broad custom-automation agency.

The direct strategy pointer is [`STRATEGY.md`](STRATEGY.md). The canonical operating document is [`docs/product/README.md`](docs/product/README.md), adopted by [ADR 0007](docs/adr/0007-revenue-desk-commercial-strategy.md). [ADR 0002](docs/adr/0002-managed-home-service-receptionist-product-boundary.md) remains historical rationale for the plumbing-first managed-product boundary. [ADR 0003](docs/adr/0003-initial-after-hours-service-request-workflow.md) selects `after-hours-new-residential-service-request-v1` for offline synthetic validation. [ADR 0004](docs/adr/0004-retell-catalyst-crm-analytics-integration-boundary.md) fixes the general system-ownership boundary. [ADR 0006](docs/adr/0006-shared-seven-day-monitor-with-client-number-isolation.md) is authoritative for the free-test MVP: one shared agent, one dedicated Retell number and versioned Catalyst deployment/configuration per active client, the exact fail-closed resolver gate, practical seven-day/25-handled-call enforcement, Catalyst Mail email-only notification records, and Catalyst query/CSV reporting.

The strategy establishes the approved ICP, public commercial terms, plan architecture, differentiation, margin gates, and expansion sequence. It does not establish a live service, customer deployment, telephone route, customer-specific legal approval, or production readiness.

Current free-test classification is **READY FOR DEVELOPMENT DEPLOYMENT**. It is **NOT READY** for a controlled internal phone test until the deployed Catalyst and Retell paths are independently read back with two synthetic numbers on the same shared agent version, provider fallback is proved safe, one controlled Development email is delivered exactly once and read back, and the notification mode is restored to `dry_run`.

## Repository Boundary

GitHub owns versioned code, approved public commercial terms, and sanitized technical context. It does not own live customer data, accounting records, call data, credentials, production configuration, or deployment state.

| Area | Operational source of truth |
|---|---|
| Prospects, customers, and commercial relationships | Approved CRM |
| Free-test deployment ownership, configuration versions, handled-call count, call/outcome, email notification record, and query/CSV reporting | Zoho Catalyst in the approved environment; Development runtime/source parity requires current readback |
| Call transport and carrier delivery state | Approved telephony carrier for the selected deployment |
| Services, appointment capacity, jobs, work orders, and dispatch state | Customer's approved field-service or scheduling system |
| Human handling of explicitly escalated exceptions | Approved customer or partner destination for the selected coverage window |
| General ledger, accounting balances, and financial reporting | Zoho Books |
| Subscription lifecycle and billing events | Zoho Billing, when used for the approved workflow |
| Voice-agent runtime | Retell or the approved voice platform |
| Non-critical workflow orchestration | Make or the approved automation platform |
| Custom workflow UI and records | Zoho Creator only for an explicitly approved use case |
| Private document storage and versions | Zoho WorkDrive |
| Contract drafting, approval, execution, and evidence | Zoho Contracts and Zoho Sign, with separate lifecycle ownership |
| Lightweight intake and public doorway | Zoho Forms and Zoho Sites, without becoming systems of record |
| Mailbox message and delivery state | Zoho Mail |
| Derived reporting and dashboards | Zoho Analytics, never transactional authority |
| Secure middleware, webhook verification, deduplication, and retry controls | Zoho Catalyst or the approved middleware runtime |
| Credentials and tokens | Platform secret stores only |
| Sanitized code, tests, schemas, runbooks, decisions, and approved public commercial terms | This repository |

The detailed ownership map is in [`docs/architecture/system-overview.md`](docs/architecture/system-overview.md).

## Current Contents

```text
.github/       Pull-request ownership, templates, dependency updates, and CI
archive/       Sanitized historical references that are not deployment-approved
docs/          Architecture, security, setup, and reusable runbooks
src/           Active or governed system-specific technical artifacts
tools/safety/  Public-repository and workflow-policy validation
```

Current governed artifacts:

- [`docs/standards/README.md`](docs/standards/README.md) contains durable operator-facing drafting and code-review standards. Portable documents use Inter by default; San Francisco is preferred only when supplied natively or separately licensed.
- [`STRATEGY.md`](STRATEGY.md) is the root pointer to the official Revenue Desk strategy and its effective timestamp.
- [`docs/product/README.md`](docs/product/README.md) is the approved product and commercial source of truth for the plumbing-first Revenue Desk. It controls the ICP, Revenue Leak Test, management fees, metered usage, implementation fees, plan architecture, positioning, margin gates, expansion sequence, non-goals, and implementation boundary.
- [`docs/adr/0007-revenue-desk-commercial-strategy.md`](docs/adr/0007-revenue-desk-commercial-strategy.md) records the current commercial decision, rejected alternatives, review triggers, and explicit separation between strategy approval and live deployment authority.
- [`docs/adr/0003-initial-after-hours-service-request-workflow.md`](docs/adr/0003-initial-after-hours-service-request-workflow.md) fixes the first provider-neutral workflow, four offline dispositions, exclusions, expansion gates, and kill criteria without authorizing calls or downstream writes.
- [`docs/adr/0004-retell-catalyst-crm-analytics-integration-boundary.md`](docs/adr/0004-retell-catalyst-crm-analytics-integration-boundary.md) defines the proposed Retell event ingress, Catalyst call state, CRM summary boundary, customer-system reconciliation, Analytics reporting path, and direct-API-versus-MCP split. Its earlier agent-lifecycle choice is superseded by ADR 0006.
- [`docs/adr/0006-shared-seven-day-monitor-with-client-number-isolation.md`](docs/adr/0006-shared-seven-day-monitor-with-client-number-isolation.md) defines the exact seven-field gate, explicit resolver rejection versus shared-agent fallback, practical seven-day/25-handled-call stop with transparent in-flight overshoot, immutable call ownership, Catalyst Mail email-only state, client query/CSV reporting, and no-degraded-intake Configuration Unavailable path.
- [`src/retell/`](src/retell/README.md) contains sanitized Retell contracts and offline validation. Runtime-derived private controls, prompts, routing values, identifiers, and call content remain excluded; repository state is not publication or phone-test evidence.
- [`docs/legal-compliance/`](docs/legal-compliance/) preserves dated telephony, recording, consent, privacy, security, state-jurisdiction, regulated-use, vendor, and launch research plus a conservative historical internal-QA profile using a carrier media gate, keypad assent, and synthetic facts. It is not legal advice and does not itself authorize or prohibit a particular test. Offline/synthetic Development work, a controlled internal Development phone test, and a prospect launch require separate evidence and approval records. Prospect-facing telephone demonstrations remain blocked by repository authority while that operating approval is unresolved.
- [`docs/accounting/`](docs/accounting/) is the product-neutral front door for Sylvara accounting authority, federal tax research, U.S. GAAP topic navigation, policy controls, and dated source provenance. It contains original operational summaries and official links, not copied standards text, tax advice, financial records, or another business's accounting conclusions.
- [`docs/copywriting/`](docs/copywriting/) is the public front door for original copywriting principles, channel playbooks, structure cards, briefing, and claim review. It contains no raw swipe files, source passages, customer facts, or third-party publication claims.
- [`docs/zoho/`](docs/zoho/) is the single front door for portable Zoho governance, operating standards, dated product references, and MCP evidence without copying another tenant's fields or configuration.
- [`docs/zoho/governance/suite-registry.json`](docs/zoho/governance/suite-registry.json) is the machine-readable Zoho ownership and evidence-status map. Official product support, Tool Manual catalogs, preconfigured-template membership, configured MCP selections, advertised MCP contracts, and effective tenant access remain separate layers.
- [`docs/zoho/mcp/snapshots/configured/2026-08-04/sylvara-observed-tool-inventory.json`](docs/zoho/mcp/snapshots/configured/2026-08-04/sylvara-observed-tool-inventory.json) preserves all 294 configured selections across 18 neutral Sylvara roles as prefix-free catalog operation keys and annotations; it is dated selection evidence, not proof of a current input contract, tenant access, or live-use approval.
- [`docs/zoho/mcp/reference/zoho-analytics-managed-mcp-catalog-2026-08-18.md`](docs/zoho/mcp/reference/zoho-analytics-managed-mcp-catalog-2026-08-18.md) records the 24 names on the official managed Analytics MCP tool page, preserves the unresolved difference from the earlier 25-row Tool Manual count, and defines proposed Audit, Changes, and temporary Controller role allowlists without claiming configured access.
- [`docs/zoho/standards/call-reporting-metric-contract.md`](docs/zoho/standards/call-reporting-metric-contract.md) defines the free-test Catalyst query/CSV metrics, handled-call/overshoot disclosure, outcome/value taxonomy, one-client partition, privacy, and export gates. Analytics remains an optional later presentation layer.
- [`docs/runbooks/retell-catalyst-analytics-reporting.md`](docs/runbooks/retell-catalyst-analytics-reporting.md) sequences Development verification, webhook ingress, durable call state, CRM summaries, customer-system reconciliation, Analytics bulk sync, fixed-client reports, containment, and Production approval except where ADR 0006 supersedes its earlier agent-first routing assumptions.
- [`docs/runbooks/shared-seven-day-monitor-number-routing.md`](docs/runbooks/shared-seven-day-monitor-number-routing.md) defines synthetic client setup, exact resolution, practical count enforcement, explicit reject/fallback behavior, post-call ownership, Catalyst Mail states and controlled Development delivery, query/CSV reporting, 30 minimum scenarios, initial number freeze/cooldown, validation lanes, containment, and rollback.
- [`docs/runbooks/free-test-development-reconciliation-2026-08-22.md`](docs/runbooks/free-test-development-reconciliation-2026-08-22.md) records the sanitized Development runtime-versus-source audit and missing evidence without implying deployment.
- [`docs/security/free-test-runtime-controls.md`](docs/security/free-test-runtime-controls.md) defines the tenant, authenticity, replay, secret, least-privilege, logging, PII-minimization, environment, and containment controls for the Development free-test path.
- [`src/zoho-catalyst/revenue-desk-call-runtime/catalyst.json`](src/zoho-catalyst/revenue-desk-call-runtime/catalyst.json) anchors the canonical shared free/paid call gateway and worker. The free-test profile is bounded to seven days or 25 connected calls; paid profiles remain disabled and Draft. [`src/zoho-catalyst/revenue-desk-analytics/`](src/zoho-catalyst/revenue-desk-analytics/) owns derived Analytics synchronization. Development E2E, cleanup, key rotation, final-main parity, and dark-Production proof remain required before `READY FOR RETELL AGENT TESTING ONLY`.
- [`src/zoho-crm/reference/snapshots/2026-08-14/`](src/zoho-crm/reference/snapshots/2026-08-14/README.md) is the current sanitized Leads, Contacts, Accounts, and Deals package: 466 fields, 438 layout-placement rows, 719 publishable choice rows, 414 observed Lead-conversion rows, and the approved Form 1/Form 2/Free-Test delivery field contract. The files directly under [`src/zoho-crm/reference/`](src/zoho-crm/reference/README.md) remain immutable 2026-08-05 historical evidence rather than a competing current schema.
- [`src/zoho-books/reference/chart-of-accounts.csv`](src/zoho-books/reference/chart-of-accounts.csv) is a sanitized reference with system IDs and bank-account suffixes removed.
- [`src/zoho-catalyst/billing-webhook-gateway`](src/zoho-catalyst/billing-webhook-gateway) contains a proposed sanitized replacement for the historical Billing gateway, repository-level unit tests, a variable-name registry attested against the supplied export and replacement source, and a proposed Data Store schema. It is not platform-validated, live-tested, deployed, or deployment-approved.
- [`archive/zoho-catalyst/billing-webhook-gateway`](archive/zoho-catalyst/billing-webhook-gateway) preserves the original export's non-executable review record and source hashes. The supplied handler, private manifest metadata, installed dependencies, and deployment configuration remain excluded.
- [`archive/README.md`](archive/README.md) explains why historical review records remain separate from active source and reusable documentation.
- [`tools/codex-evals/`](tools/codex-evals/) contains opt-in synthetic behavior evaluations for Codex; deterministic harness checks may run in CI, but model calls remain local and manual.

## Operating Rules

1. Keep changes focused and reviewable.
2. Use short-lived branches and pull requests; do not make routine direct changes to `main`.
3. Run repository and workflow safety checks before publication.
4. Treat every public commit, branch, pull request, log, and artifact as permanently disclosed.
5. Use synthetic examples only. Never commit secrets, customer data, call data, raw payloads, production identifiers, or financial records.
6. A merged pull request does not authorize or perform a production deployment, live Zoho change, billing action, or customer communication.
7. Live changes require an explicit deployment plan, scoped approval, rollback path, and independent readback.
8. Voice, telephony, consent, recording, privacy, security, messaging, and regulated-workflow changes require a separately recorded owner-approved scope, provider/settings readback, data-handling decision, and any professional review required for the actual facts; repository review alone never authorizes a call.

## Local Validation

Run the offline local verification path after dependencies have been bootstrapped:

```powershell
.\tools\verify.cmd
```

For a new checkout, run `.\tools\verify.cmd -Bootstrap`. Before publication,
use `.\tools\verify.cmd -Mode All` to reproduce dependency installation and the
production dependency audit. Both commands may contact the Python and npm
registries; default Quick mode remains offline. The verifier requires 64-bit
CPython 3.12 and Node.js 24. See [`tools/README.md`](tools/README.md) for modes,
runtime selection, and direct CI-script ownership.

## Commercial Constraint

Prioritize selling and delivering the Revenue Leak Test, Launch, and the first paid Growth workflow for the approved plumbing ICP. Build only what supports a qualified prospect conversation, controlled test, customer commitment, paid implementation, reliable delivery, or measurable retention inside that boundary. Custom work must strengthen a reusable Revenue Desk capability and justify its implementation and maintenance cost.

Do not create a generalized agent platform, custom telephony stack, client portal, multi-tenant SaaS layer, simultaneous second vertical, or regulated call workflow without evidence that the simpler managed-service path is insufficient and a separate reviewed decision approves expansion.

## Security

Read [`SECURITY.md`](SECURITY.md) and [`docs/security/public-repository-boundary.md`](docs/security/public-repository-boundary.md) before adding code, configuration, exports, screenshots, logs, or integration examples.
