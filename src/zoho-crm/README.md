# Zoho CRM

## Purpose

This area contains Sylvara-owned, sanitized CRM schema and Lead-conversion documentation. Zoho CRM is authoritative for prospect, contact, company, opportunity, and approved commercial-relationship state. It is not authoritative for accounting balances, subscription billing events, document contents, or integration secrets.

## Evidence Status

- Snapshot date: **2026-08-05**
- Target: the verified Sylvara CRM organization, with private organization and object identifiers excluded
- Modules in scope: Leads, Contacts, Accounts, and Deals
- Metadata status: module, field, layout-requirement, help-text-presence, and current Lead-conversion mapping metadata verified
- Live changes: the scoped field, layout, picklist, supported help-text, and consolidated-address work was read back after mutation
- Help-text exception: 12 used compound Address, Coordinates, or Distance entries still report no help text and require a separately verified mutation path
- Conversion automation: **not deployed**

The snapshot proves only what the authorized CRM audit surface returned on the observation date. It does not grant continuing permission to change CRM and does not establish unsupported workflow, formula-dependency, profile, or validation-rule behavior.

## Artifacts

| Artifact | Purpose |
|---|---|
| [Reference contract](reference/README.md) | Scope, provenance, conversion findings, deployment boundary, and rollback |
| [Module catalog](reference/modules.csv) | Module labels, API names, field counts, and conversion roles |
| [Field dictionary](reference/crm-field-dictionary.csv) | One sanitized row for every verified field in the four governed modules |
| [Lead-conversion matrix](reference/lead-conversion-mapping.csv) | One row for every Lead field and target module, including explicit intentional non-mappings |
| [Proposed Form 1/Form 2 MCP allowlist](../../docs/zoho/mcp/proposals/2026-08-14/sylvara-free-test-crm-mcp-allowlist.md) | Proposed Blueprint, workflow, function, and verification tool split; not configured or deployed by this reference |

The CSV files are deterministic review artifacts, not import files and not live configuration payloads.

## Commercial Conversion Rule

The owner-approved rule for this snapshot is to convert at the earlier of a pilot start or an approved direct-subscription start. Zoho's native conversion creates or updates the Contact and Account and creates or associates the first Deal in the same operation; a Lead cannot become a Deal first and a Contact later.

A Lead already converted for a pilot is not converted again at subscription. Subscription is then a follow-on commercial relationship or Deal from the existing Account and Contact. Keeping pre-pilot qualification on the Lead is an intentional reporting tradeoff under the current rule.

This trigger remains an open design gate before automation: if the Deal pipeline is intended to manage discovery, qualification, proposal, or commitment, conversion must move earlier to the approved sales-qualified-opportunity boundary. Do not deploy the trigger until the intended reporting model and every required conversion input are approved together.

Lead lifecycle values do not become Deal Stage values. Deal Stage and Pipeline remain Deal-owned, and Pilot Outcome plus billing/subscription lifecycle fields remain unset at initial conversion. Native conversion, conversion-map mutation, and the workflow trigger were unavailable through the verified write surface, so no automation was simulated with generic record creation.

## Address Rule

The consolidated Address field and its Zoho-managed components are the canonical conversion bundle across Leads, Contacts, Accounts, and Deals. Every populated legacy address discovered in the scoped migration was copied and independently read back before its legacy value was cleared. The legacy schema fields were not deleted, but they no longer retain rollback values. Rollback requires the private prestate or a controlled reverse-copy from the consolidated components.

## Live-Change Boundary

Before any future CRM mutation:

1. verify the organization and exact current metadata through the named audit role;
2. compare live state with these dated references;
3. capture a private prestate without publishing identifiers or record data;
4. obtain approval for the exact bounded operation;
5. apply the smallest typed change; and
6. perform independent readback before continuing.

For rollback, restore the private prestate for labels, help text, picklist values, layout placement, and mappings. Address rollback must use the private prestate or a controlled reverse-copy into the structurally retained legacy fields without discarding the consolidated values. Native Lead conversion is irreversible and requires a separate dry-run and acceptance plan before deployment.

## Validation

Run:

```powershell
python -m unittest tools.safety.tests.test_zoho_crm_schema_package -v
python -m unittest tools.safety.tests.test_zoho_standards -v
```

Repository validation checks row counts, uniqueness, module and field joins, mapping-state invariants, controlled vocabulary, and the absence of opaque identifiers, record data, email addresses, and URLs in the CSV artifacts.

## Public Boundary

This package intentionally excludes organization IDs, module IDs, field IDs, layout IDs, workflow IDs, record values, picklist internal IDs, permissions, profiles, raw metadata, connection details, endpoints, credentials, and private audit evidence. Labels and API names are included because they are the approved sanitized integration contract for this Sylvara-owned schema.
