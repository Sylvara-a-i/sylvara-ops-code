# Sylvara Operations Code

Public, sanitized technical source of truth for Sylvara's managed inbound-reception product and the business systems that support its delivery.

This repository is publicly viewable but is not open source. See [`NOTICE.md`](NOTICE.md).

## Current Product Direction

Sylvara is validating a managed inbound receptionist and front-office service for independent residential plumbing companies, beginning in Kansas City with after-hours and overflow calls that staff cannot answer reliably. The product must complete and attribute bounded business workflows; it is not a generic voice-agent subscription or a broad custom-automation agency. Dispatch activity remains limited to separately approved intake, routing, and integration behavior.

The canonical public boundary is [`docs/product/README.md`](docs/product/README.md), supported by [ADR 0002](docs/adr/0002-managed-home-service-receptionist-product-boundary.md). [ADR 0003](docs/adr/0003-initial-after-hours-service-request-workflow.md) selects `after-hours-new-residential-service-request-v1` for offline synthetic validation. Those documents govern product scope, progressive rollout, explicit non-goals, evidence gates, and deferred verticals. They do not establish a live service, current pricing, a customer deployment, or approval for customer-facing publication.

## Repository Boundary

GitHub owns versioned code and sanitized technical context. It does not own live customer data, accounting records, call data, credentials, production configuration, or deployment state.

| Area | Operational source of truth |
|---|---|
| Prospects, customers, and commercial relationships | Approved CRM |
| Structured call rules, workflow orchestration, outcome taxonomy, and quality evidence | Sylvara managed service layer when implemented; currently proposed and unverified |
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
| Secure middleware, webhook verification, and retry controls | Zoho Catalyst or the approved middleware runtime |
| Credentials and tokens | Platform secret stores only |
| Sanitized code, tests, schemas, runbooks, and decisions | This repository |

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
- [`docs/product/README.md`](docs/product/README.md) is the public implementation filter for the managed plumbing-first receptionist product. It records the initial audience and use case, progressive deployment model, proposed capability gates, validation dimensions, non-goals, and the private research boundary without publishing the source report or commercial model.
- [`docs/adr/0003-initial-after-hours-service-request-workflow.md`](docs/adr/0003-initial-after-hours-service-request-workflow.md) fixes the first provider-neutral workflow, four offline dispositions, exclusions, expansion gates, and kill criteria without authorizing calls or downstream writes.
- [`docs/legal-compliance/`](docs/legal-compliance/) is the dated telephony, recording, consent, privacy, security, state-jurisdiction, regulated-use, vendor, and launch-control archive for the proposed AI receptionist. Its only proposed telephone profile is internal, non-sales QA by authorized staff/contractors using a carrier media gate, keypad assent, synthetic conversation data, and no retained content, outbound channel, real-world side effect, or production integration. Prospect-facing telephone demonstrations remain blocked. The archive is not legal advice or launch approval.
- [`docs/accounting/`](docs/accounting/) is the product-neutral front door for Sylvara accounting authority, federal tax research, U.S. GAAP topic navigation, policy controls, and dated source provenance. It contains original operational summaries and official links, not copied standards text, tax advice, financial records, or another business's accounting conclusions.
- [`docs/copywriting/`](docs/copywriting/) is the public front door for original copywriting principles, channel playbooks, structure cards, briefing, and claim review. It contains no raw swipe files, source passages, customer facts, or third-party publication claims.
- [`docs/zoho/`](docs/zoho/) is the single front door for portable Zoho governance, operating standards, dated product references, and MCP evidence without copying another tenant's fields or configuration.
- [`docs/zoho/governance/suite-registry.json`](docs/zoho/governance/suite-registry.json) is the machine-readable Zoho ownership and evidence-status map. Official product support, Tool Manual catalogs, preconfigured-template membership, configured MCP selections, advertised MCP contracts, and effective tenant access remain separate layers.
- [`docs/zoho/mcp/snapshots/configured/2026-08-04/sylvara-observed-tool-inventory.json`](docs/zoho/mcp/snapshots/configured/2026-08-04/sylvara-observed-tool-inventory.json) preserves all 294 configured selections across 18 neutral Sylvara roles as prefix-free catalog operation keys and annotations; it is dated selection evidence, not proof of a current input contract, tenant access, or live-use approval.
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
8. Voice, telephony, consent, recording, privacy, security, messaging, and regulated-workflow changes must satisfy [`docs/legal-compliance/`](docs/legal-compliance/) and a separately recorded qualified legal approval; repository review alone never authorizes a call.

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

Prioritize the initial managed residential-plumbing receptionist workflow. Build only what supports a validated demo, qualified pilot, customer commitment, or paid delivery inside that boundary. Custom work must strengthen a reusable plumbing capability and justify its implementation and maintenance cost.

Do not create a generalized agent platform, custom telephony stack, client portal, multi-tenant SaaS layer, simultaneous second vertical, or regulated call workflow without evidence that the simpler managed-service path is insufficient and a separate reviewed decision approves expansion.

## Security

Read [`SECURITY.md`](SECURITY.md) and [`docs/security/public-repository-boundary.md`](docs/security/public-repository-boundary.md) before adding code, configuration, exports, screenshots, logs, or integration examples.
