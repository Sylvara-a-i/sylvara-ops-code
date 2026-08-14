# Zoho CRM

## Purpose

This area contains Sylvara-owned, sanitized CRM schema and Lead-conversion documentation. Zoho CRM is authoritative for prospect, contact, company, opportunity, and approved commercial-relationship state. It is not authoritative for accounting balances, subscription billing events, document contents, or integration secrets.

## Evidence Status

- Current snapshot date: **2026-08-14**
- Historical baseline: **2026-08-05**, retained immutably under the reference root
- Target: the verified Sylvara CRM organization, with private organization and object identifiers excluded
- Modules in scope: Leads, Contacts, Accounts, and Deals
- Current metadata status: 466 fields, every enabled field's Standard-layout placement, the selected Quick Create and Business Card fields/order, publishable choice-field values with restricted sets represented by count/status only, the Revenue Desk pipeline, and 414 Lead-to-target mapping rows verified read-only
- Current module counts: Leads 138, Contacts 91, Accounts 95, and Deals 142
- Automation status: four Form 1/Deal workflows plus the Deal delivery Blueprint are active and read back; all four workflows have no recorded execution and the Blueprint has zero enrolled records, so runtime acceptance is blocked; native Lead conversion remains human-approved and manual
- Current known defects: Deal creation can fail unless the controller sets `Type = Initial Sale`; three unconditional Blueprint inputs conflict with valid Form 2 conditions; transitions have no after-actions, so Deal Stage and `Test_Status` can drift; safe-stop and Closed Won evidence are under-controlled; exact Zoho Forms/controller behavior remains unverified
- Live changes in the 2026-08-14 audit: **none**

The snapshot proves only what the authorized CRM audit surface returned on the observation date. It does not grant continuing permission to change CRM and does not establish uninspected formula, profile, Forms, controller, or runtime behavior.

## Artifacts

| Artifact | Purpose |
|---|---|
| [Reference contract](reference/README.md) | Scope, provenance, conversion findings, deployment boundary, and rollback |
| [Current 2026-08-14 snapshot](reference/snapshots/2026-08-14/README.md) | All current fields, layout order, picklist values, conversion mappings, and Form 1/Form 2 CRM destinations |
| [Historical 2026-08-05 module catalog](reference/modules.csv) | Immutable pre-Free-Test module counts and roles |
| [Historical 2026-08-05 field dictionary](reference/crm-field-dictionary.csv) | Immutable 374-field baseline |
| [Historical 2026-08-05 Lead-conversion review](reference/lead-conversion-mapping.csv) | Immutable desired-state review that is no longer current-state evidence |
| [Historical Form 1/Form 2 MCP allowlist](../../docs/zoho/mcp/proposals/2026-08-14/sylvara-free-test-crm-mcp-allowlist.md) | Superseded least-privilege design record; use the linked effective snapshot for current state |

The CSV files are deterministic review artifacts, not import files and not live configuration payloads.

## Commercial Conversion Rule

The owner-approved rule for this snapshot is to convert at the earlier of a pilot start or an approved direct-subscription start. Zoho's native conversion creates or updates the Contact and Account and creates or associates the first Deal in the same operation; a Lead cannot become a Deal first and a Contact later.

A Lead already converted for a pilot is not converted again at subscription. Subscription is then a follow-on commercial relationship or Deal from the existing Account and Contact. Keeping pre-pilot qualification on the Lead is an intentional reporting tradeoff under the current rule.

This trigger remains an open design gate before automation: if the Deal pipeline is intended to manage discovery, qualification, proposal, or commitment, conversion must move earlier to the approved sales-qualified-opportunity boundary. Do not deploy the trigger until the intended reporting model and every required conversion input are approved together.

Lead lifecycle values do not become Deal Stage values. Deal Stage and Pipeline remain Deal-owned, and Pilot Outcome plus billing/subscription lifecycle fields remain unset at initial conversion. Current Form 1 and Deal initialization workflows do not perform native Lead conversion. Conversion remains an explicit human gate; generic record creation is not a safe substitute.

## Address Rule

The consolidated Address field and its Zoho-managed components are the current conversion bundle from Leads to Contacts and the Account Billing Address. Account Shipping Address is a separate bundle. Deal Address fields are now unused and absent from the Standard layout, so the historical four-module Deal-address statement must not drive current automation. The 2026-08-05 migration record and rollback boundary remain historical evidence for that completed change.

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
python -m unittest tools.safety.tests.test_zoho_crm_schema_snapshot_2026_08_14 -v
python -m unittest tools.safety.tests.test_zoho_standards -v
```

Repository validation checks row counts, uniqueness, module and field joins, mapping-state invariants, controlled vocabulary, and the absence of opaque identifiers, record data, email addresses, and URLs in the CSV artifacts.

## Public Boundary

This package intentionally excludes organization IDs, module IDs, field IDs, layout IDs, workflow IDs, record values, picklist internal IDs, permissions, profiles, raw metadata, connection details, endpoints, credentials, and private audit evidence. Labels and API names are included because they are the approved sanitized integration contract for this Sylvara-owned schema.
