# Archived Zoho Catalyst Records

## Purpose

`archive/zoho-catalyst/` contains sanitized historical and forensic records for Zoho Catalyst. It inherits the repository's [archive policy](../README.md): archived material is reference-only, non-executable, and not evidence of current configuration or deployment.

## Record Index

| Record | Status |
|---|---|
| [Billing webhook gateway review](billing-webhook-gateway/README.md) | Historical security and provenance record only |

The separately maintained [proposed replacement](../../src/zoho-catalyst/billing-webhook-gateway/README.md) belongs under `src/` and has its own validation and deployment boundaries.

## Placement Rules

- Add a record here only when its sanitized history remains useful for provenance, security review, or design context.
- Keep each Catalyst record in its own sibling directory with an explicit status and link to any governed successor.
- Do not import, execute, deploy, or use archived material as a rollback artifact.
- Never add original exports, dependency trees, credentials, private configuration, payloads, logs, production identifiers, or customer data.
