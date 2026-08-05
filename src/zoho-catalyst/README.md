# Zoho Catalyst Implementations

## Purpose

`src/zoho-catalyst/` contains sanitized, governed implementation artifacts owned by Zoho Catalyst. Repository presence establishes source history and reviewability only; it does not prove platform configuration, deployment, live access, or production approval.

Reusable Catalyst rules remain in the [Catalyst standard](../../docs/zoho/standards/catalyst.md) and the central [Zoho knowledge base](../../docs/zoho/README.md).

## Project Index

| Project | Repository status |
|---|---|
| [Billing webhook gateway](billing-webhook-gateway/README.md) | Proposed sanitized replacement; see the project README for exact validation and deployment gates |

The related historical review record remains indexed under [`archive/zoho-catalyst/`](../../archive/zoho-catalyst/README.md) and is not a deployment or rollback artifact.

## Placement Rules

- Give each bounded Catalyst project its own sibling directory under `src/zoho-catalyst/`.
- Keep project-specific source, tests, schemas, deployment gates, validation, and rollback guidance together.
- Keep reusable Zoho policy and product guidance under `docs/zoho/` rather than duplicating it in projects.
- Do not add speculative project folders, live identifiers, populated configuration, credentials, payloads, or production logs.
- Record the exact repository, validation, deployment, and approval status in each project's README.
