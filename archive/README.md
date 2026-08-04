# Archive Index

## Purpose

`archive/` preserves sanitized historical and forensic records that remain useful for lineage, security review, or design context but are not active source, reusable policy, deployment configuration, or evidence of live state.

## Placement Rule

| Location | Meaning |
|---|---|
| [`../src/`](../src/) | Active or governed implementation artifacts, each with its own status and deployment boundary |
| [`../docs/zoho/`](../docs/zoho/) | Reusable Zoho governance, standards, product references, and MCP evidence |
| [`./`](./) | Historical, non-executable records retained for provenance or review only |

An archived record must not be imported, deployed, or treated as current configuration. If a safe replacement is built, it belongs under the owning `src/` product path and links back to the archive only for provenance.

## Current Records

- [Historical Billing webhook gateway review](zoho-catalyst/billing-webhook-gateway/README.md) — sanitized provenance and security findings only.
- [Proposed active replacement](../src/zoho-catalyst/billing-webhook-gateway/README.md) — independently maintained source and tests; not platform-validated, deployed, or deployment-approved.
- [Central Zoho knowledge base](../docs/zoho/README.md) — reusable product and operating standards.

## Publication Boundary

Archived material follows the same permanent-public rule as every other Git object. Do not add original exports, executables, dependency trees, secrets, private endpoints, payloads, logs, production identifiers, customer data, or financial records. A hash or review record proves lineage only; it does not prove safety, currency, deployment, or approval.
