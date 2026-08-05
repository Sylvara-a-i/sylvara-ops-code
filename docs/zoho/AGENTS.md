# Zoho Documentation Agent Instructions

These instructions apply under `docs/zoho/` and supplement the repository-root `AGENTS.md`.

## Required Reading And Evidence Order

1. Read [`README.md`](README.md) and the standard for the product in scope before editing.
2. Use current official Zoho documentation for generic product behavior.
3. Use verified live Sylvara metadata for organization-specific API names, field types, permissions, limits, and configuration.
4. Use an approved Sylvara schema, interface, or runbook for desired state.
5. Treat reference handbooks and dated MCP catalogs as orientation evidence only.

When sources disagree, stop and preserve the conflict. Do not let a reference, UI label, example payload, advertised tool name, or prior tenant override current official documentation or verified live Sylvara metadata.

## Editing Rules

- Keep reusable governance and product-neutral standards under `docs/zoho/`. Keep implementation-specific deployment, rollback, and validation guidance beside the owning code.
- Preserve the distinction among official product support, a tool's advertised contract, effective tenant access, approved desired state, and verified deployed state.
- Date volatile facts such as limits, field-type mappings, scopes, endpoint behavior, and edition constraints. Link the exact official source and recheck it immediately before implementation.
- Prefer tables for exact type mappings, field dictionaries, ownership maps, and current/proposed comparisons. Use `Unknown` for missing evidence; never convert absence of evidence into `None`, `False`, or unsupported.
- Use returned `api_name`, link name, opaque identifier, and type metadata. Keep proposals visibly separate and use explicit placeholders such as `TBD_FROM_ZOHO_METADATA` until readback succeeds.
- Do not copy another tenant's modules, fields, layouts, options, roles, connections, workflows, identifiers, examples, or business rules. Sylvara requirements determine selection.
- Do not reproduce official documentation wholesale. Preserve the minimum durable behavior, Sylvara decision, verification date, and official link needed to implement safely.
- Do not add product scaffolding or schemas without a concrete approved Sylvara workflow.

## High-Risk Work

For schema, record, billing, payment, contract, signature, email, webhook, or production-data work:

- begin with the least-sensitive identity and metadata reads;
- require a typed operation contract, exact target, fresh prestate, approved proposed state, idempotency or duplicate control, rollback or containment, and independent readback;
- fail closed on unknown organization, environment, permissions, field semantics, workflow triggers, subform behavior, verification, or response completeness;
- use synthetic fixtures and Development first; and
- keep private identifiers, raw payloads, customer data, documents, signatures, financial data, endpoints, and credentials outside GitHub and logs.

Repository editing, test success, or pull-request approval never authorizes a live Zoho read or write.

## Documentation Completion Check

Before finishing a Zoho documentation change, verify:

- the owning standard and central index still agree;
- every relative link resolves;
- current facts carry a review date and official source;
- no tenant-specific or private material entered the diff;
- relevant safety and Zoho regression tests pass; and
- exclusions, unknowns, manual setup, rollback, and deployment authority remain explicit.
