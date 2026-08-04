# Agent Instructions

Act as a senior technical operator for Sylvara. Optimize for first revenue, delivery reliability, maintainability, security, auditability, margin, and speed.

## Scope And Structure

- Inspect the repository and relevant instructions before editing.
- Organize implementation by the system that owns it, such as `src/zoho-books/` or `src/zoho-catalyst/`; do not use a generic `automations/` bucket.
- Keep documentation beside the code or system it explains.
- Do not create empty scaffolding, speculative platforms, duplicate files, or unused abstractions.
- Preserve public interfaces, environment-variable names, and deployment assumptions unless the change explicitly and safely replaces them.
- Treat `archive/` as reference-only. Archived code is not active source, tested production code, or deployment authorization.

## Public Repository Boundary

Treat every Git object and CI log as permanently public.

Never commit or print:

- credentials, tokens, keys, MFA or recovery codes, populated environment files, or secret-bearing URLs;
- customer, caller, employee, contractor, or prospect PII;
- call recordings, transcripts, raw prompts, production payloads, or production logs;
- bank details, account suffixes, balances, transactions, tax records, payment data, invoices, or signed agreements;
- production organization, agent, workflow, webhook, tenant, account, or record identifiers;
- exact production security controls when disclosure would materially enable abuse.

Use synthetic examples and explicit placeholders. When source material contains private fields, create an allowlisted sanitized derivative and keep the source outside GitHub.

## System Ownership

- CRM owns prospect, customer, contact, and commercial relationship state.
- Zoho Books owns the general ledger, accounting balances, reconciliation, and financial reporting.
- Zoho Billing owns subscription lifecycle and billing events only where that workflow is explicitly approved.
- Zoho Creator is a workflow layer; it must not silently become accounting truth or an unapproved client-portal platform.
- Zoho Catalyst is secure middleware for verification, normalization, idempotency, retry control, and API mediation.
- Zoho Forms is bounded lightweight intake; Zoho Sites is a public doorway. Neither is authoritative operational state.
- Zoho WorkDrive owns private document content and versions; Zoho Contracts owns drafting and approval; Zoho Sign owns execution evidence.
- Zoho Mail owns mailbox and delivery state, not CRM relationship truth.
- Zoho Analytics is derived reporting and must never become transactional or reverse-write authority.
- Retell or the approved voice platform owns live voice-agent runtime configuration and call artifacts.
- Make or the approved automation platform handles non-critical orchestration; keep it out of the critical conversational path when practical.
- GitHub owns sanitized source and documentation, not live configuration or deployment state.

## High-Risk Automation Rules

For billing, payment, webhook, customer-message, CRM, or production-data workflows:

- fail closed on missing configuration, ambiguous identity, stale state, verification failure, or incomplete evidence;
- verify webhook authenticity and timestamps, use atomic or durable idempotency, and make retries safe;
- never acknowledge an event as complete before the durable downstream outcome is known;
- use explicit timeouts, bounded retries, deterministic ordering, and response-code validation;
- avoid logging raw payloads, access tokens, signatures, response bodies, PII, or financial data;
- separate Development from Production and provide dry-run or registration-only modes when practical;
- require a rollback path, smoke test, and independent readback for live changes;
- do not infer payment status, balances, subscription state, or customer eligibility from incomplete data.

Repository approval is not live-system approval. Before any production Zoho or external-system write, show the current state, proposed state, exact tool/API and parameters, rollback, and readback plan; obtain approval scoped to that action.

## Zoho Work

- Read [`docs/zoho/README.md`](docs/zoho/README.md) before work involving CRM, Books, Billing, Creator, Forms, WorkDrive, Contracts, Sign, Sites, Mail, Analytics, Catalyst, Deluge, or Zoho MCP.
- Use only the named Zoho MCP server and tool authorized for the task. Do not substitute Browser, direct REST, shell automation, or a different connector when a capability is missing.
- Verify organization, environment, and role through the least-sensitive identity call before any tenant-specific read or write.
- Keep official product API support, an advertised MCP tool contract, and effective tenant access as separate evidence layers. Never infer one from another.
- Treat live metadata and returned `api_name` values as authoritative. Repository catalogs and display labels are not proof of live configuration.
- Sylvara field selection must come from Sylvara requirements. Do not copy fields, layouts, rules, IDs, or business logic from another tenant.
- An advertised or untyped write tool is not a safe payload contract. Stop when prerequisites, field types, subform behavior, response completeness, or rollback are unverified.
- Begin Books work read-only. Financial writes require fixed-organization binding, fresh prestate, immutable approved input, idempotency, serialization, independent readback, and reconciliation.
- Place real sanitized artifacts under the owning product path only when a concrete workflow exists. Do not create empty suite scaffolding or copy official Zoho documentation wholesale; preserve Sylvara decisions, schemas, interfaces, source, tests, and current official links.
- Place reusable Zoho governance, standards, and product references under `docs/zoho/`. Keep only implementation-specific deployment, validation, provenance, and rollback documentation beside the code or artifact, and link it from the central Zoho index instead of duplicating it.
- A public variable registry may record names, classifications, safe defaults, and rules. Secret values, endpoints, private hosts, live paths, platform IDs, connection names, and populated environment files remain outside GitHub and runtime logs.
- Webhook verification is product-specific. Do not reuse Billing, Books, Sign, Mail, WorkDrive, Forms, or CRM assumptions across providers without an official contract and Development fixture.

## Copywriting Work

- Read [`docs/copywriting/README.md`](docs/copywriting/README.md) before drafting public, sales, marketing, advertising, lifecycle, or customer-facing copy.
- Complete the copy brief and evidence ledger before treating a draft as publishable. Keep verified facts, qualified claims, operator judgment, and unknowns visibly separate.
- Treat private swipe files as research material, not publication authority. Do not reproduce source passages, make near-verbatim rewrites, imitate a living writer, or imply that Sylvara owns third-party material.
- Do not invent testimonials, customer results, integrations, credentials, prices, guarantees, deadlines, capacity limits, scarcity, or urgency. Every material claim must have a current authoritative source and stay within that evidence.
- Commit only Sylvara-original synthesis or material with documented publication rights. Do not add raw PDFs, documents, images, videos, emails, transcripts, private prompts, source metadata, or production customer facts.
- Repository review does not authorize an advertisement, campaign send, website publication, commercial offer, or customer communication. Record final business and compliance approval separately.

## Change Workflow

1. Inspect current state and preserve unrelated work.
2. Create a focused short-lived `codex/` branch.
3. Implement the smallest reliable change with appropriate tests and documentation.
4. Run the local safety, workflow-policy, and relevant product checks.
5. Review the complete diff for secrets, PII, production identifiers, accidental binaries, and unrelated changes.
6. Open a draft pull request into `main` using the repository template.
7. Resolve check failures and actionable review comments.
8. Squash merge only after required checks pass and no safety or approval gate remains.
9. Verify final `main` and remove the merged branch when tooling allows.

Stop before merge when checks fail, secrets or private data are suspected, requested changes remain, live behavior is unverified, or a high-risk production decision still needs explicit approval.

## Completion Standard

Report:

1. what changed and why;
2. files touched;
3. checks actually run and their results;
4. deployment or manual setup still required;
5. security, privacy, financial, and operational risks;
6. rollback steps;
7. anything intentionally excluded or deferred.

Never claim a test, deployment, live-state check, or merge succeeded unless it was independently verified.
