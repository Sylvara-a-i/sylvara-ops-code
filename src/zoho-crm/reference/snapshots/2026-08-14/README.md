# Sylvara CRM Live Metadata Snapshot — 2026-08-14

## Status And Scope

- Classification: **Sanitized effective-tenant metadata evidence**
- Observation date: **2026-08-14**
- Method: authorized read-only CRM metadata, layout, picklist, pipeline, workflow, and Blueprint inspection
- Modules: Leads, Contacts, Accounts, and Deals
- Live CRM mutation in this audit: **none**
- Zoho Forms readback: **not available in this audit**

This package records the current CRM field contract without production identifiers, record values, private payloads, credentials, or customer data. It supplements rather than overwrites the immutable [2026-08-05 reference](../../README.md).

## Reconciled Inventory

| Module | Total fields | Enabled/used | Unused | Enabled custom | Default-layout sections |
|---|---:|---:|---:|---:|---:|
| Leads | 138 | 131 | 7 | 80 | 13 |
| Contacts | 91 | 73 | 18 | 31 | 10 |
| Accounts | 95 | 77 | 18 | 53 | 11 |
| Deals | 142 | 111 | 31 | 81 | 14 |

Every enabled field appears on the active Standard layout. The layout artifact records the exact returned Standard-layout section, field sequence, and source ordinal for all four modules. It also includes independently verified Quick Create and Business Card selections/order for each module. Raw layout read-only flags, field read-only flags, and API writability are separate columns and must not be conflated.

## Artifacts

| Artifact | Contract |
|---|---|
| [modules.csv](modules.csv) | Module totals and roles |
| [crm-field-dictionary.csv](crm-field-dictionary.csv) | All 466 fields, labels, API names, types, usage, write flags, requiredness, uniqueness, encryption status, dimensions, help-text state, and choice counts |
| [crm-picklist-options.csv](crm-picklist-options.csv) | Publishable display, stored/actual, reference, order, active/retired, and color values; internal option IDs and restricted sets excluded |
| [crm-layout-field-order.csv](crm-layout-field-order.csv) | Canonical and rendered labels plus exact layout section/field order |
| [lead-conversion-mapping.csv](lead-conversion-mapping.csv) | 414 observed Lead-to-target rows; 76 current mapped pairs; no desired-state recommendation inferred |
| [free-test-form-field-map.csv](free-test-form-field-map.csv) | 27 Form 1, 51 Form 2, and 35 Blueprint/delivery coverage rows; live Zoho Forms readback remains pending |

The live schema has 113 choice fields. The public option artifact covers 90; 23 are deliberately represented by count/status only. Omitted sets are private user references, private qualification thresholds, or high-cardinality vendor-managed Time Zone/Country/State catalogs. Deal Stage still includes both global field metadata and the authoritative Revenue Desk Sales pipeline order.

## Form 1 Findings

- All destinations in the latest approved 14-field visible Form 1 and its 13 hidden/server rows are enabled and type-compatible. The approved combined Full Name input maps explicitly to Lead First Name and Last Name components.
- Lead Source is workflow-owned and intentionally is not a visible or hidden Form 1 field. The receiving controller/workflow must set and verify it from the trusted intake route.
- Middle Name, Company Logo, Plan Interest, Assisted By, and a separate Contact Phone are not part of the latest approved Form 1 contract. Their absence is not treated as a schema defect.
- `Lead_Status` and `Lifecycle_Status` are separate. Current active Lead Status display values include **Attempted Contact**, **Free Test Requested**, **Free Test Setup Scheduled**, **Contacted**, **Qualified for Free Test**, **New**, **Not Qualified**, and **Converted**. Nurture and Disqualified are Lifecycle Status values.
- Display and stored values differ for several system choices. Automations must use the actual value contract where the publishable option artifact supplies it; restricted choices require fresh private metadata readback.
- The Free Test Request and Attribution sections are sections 11 and 12, after Visit Summary. This is valid but inefficient for operators; no layout reorder was authorized in this audit.
- Contact conversion must explicitly set `Contact_Type = Customer – Decision Maker` and `Is_Primary_Contact = true`; those facts have no Lead source mapping.

## Form 2 And Deal Findings

- Every CRM destination in the 51-row approved Form 2 coverage contract exists, including secure-prefill Contact/Account identity fields, Requested Start Date to Deal `Target_Start_Date`, setup controls, authority/scope timestamps, secure record context, and original-request preservation.
- `Setup_Form_Submission_ID` and Deal `Intake_Submission_ID` are not unique, so Deal-side idempotency must be enforced by deterministic lookup/readback rather than assumed from CRM metadata.
- The authoritative Revenue Desk Sales order is Setup and Authorization, Test Authorized, Setup and QA, Test Live, Results Review, Subscription Proposed, Closed Won, and Closed Lost. Stored Stage values differ from the displayed labels and are recorded separately.
- Free Test sections are 10–13 in Deals; `Target_Start_Date` remains in Pilot Scope and Outcome. Account Front-Office Profile is section 10. These are schema-complete but not optimal operator placement.
- An active Deal validation rule rejects records whose `Type` is empty. No Lead field maps to `Deals.Type`, so the conversion/controller contract must set `Type = Initial Sale` when it creates the Deal and independently read it back.
- The active delivery Blueprint has eight states and twelve transitions, but transition `actions` are absent. It is controlled by `Stage`, so Stage can advance while `Test_Status` remains unchanged. Treat status synchronization as an unresolved automation defect.
- `Begin Setup and QA` unconditionally requires `No_Answer_Delay`, `Approved_Fallback_Number`, and `Alert_Recipient_Email`. The Form 2 contract makes the first two conditional and permits alert mobile or email, so a valid Form 2 submission can be blocked until those Blueprint requirements are reconciled.
- Blueprint transitions do not enforce every provenance/setup, safe-stop, rollback, or Closed Won evidence field. The exact current workflow and transition contract is recorded in the [effective automation snapshot](../../../../../docs/zoho/mcp/snapshots/effective/2026-08-14/free-test-crm-automation.md).
- All four new workflows report no prior execution, and the Blueprint has zero enrolled records. Schema and configuration readback passed; end-to-end runtime acceptance did not.

## Other Deferred Schema Drift

- Deal Plan and Deal Service Line retain legacy generic choices that are not aligned with the current Revenue Desk offer vocabulary.
- Account Active Services retains the older generic AI-service catalog.
- Account Company Email and Company LinkedIn are enabled and writable but have missing help text.
- Deal Address fields are now unused; the old four-module Deal-address snapshot statement does not describe current layout state. Accounts use Billing Address plus a separate Shipping Address bundle.

## Forms Verification Boundary

The CRM audit proves destination fields and current automation metadata. The form map records the latest approved field/behavior order, but it does not prove the current Zoho Forms implementation, link names, page structure, hidden/default expressions, personal/encryption settings, confirmation behavior, or replay behavior. Rows therefore retain a Forms-readback-pending status until an authorized Forms audit is available.

## Immutable Public Fingerprints

| Artifact | SHA-256 |
|---|---|
| `modules.csv` | `6c92c4b2458ffcb33347d5fe4b2ffe460889c1d5c0a31ee790eab2bdbf19934d` |
| `crm-field-dictionary.csv` | `3595efe10e1093f09cb4c6bfeef5f7a95a6647242f57b9f02f7c7373f72372e7` |
| `crm-picklist-options.csv` | `c96a790203728ba06a07b663c732c8013a2b10c6d365d2154eed47647575b71e` |
| `crm-layout-field-order.csv` | `272ab7fc6975bb7dd40d4c2dda7b06c2b312d9c2592d028d83243a1dfb9a63ea` |
| `lead-conversion-mapping.csv` | `1f7cdb07c1f8209f0b4e41125d0ec43ee70c75ebcbf7786e57a39133b2c2a89c` |
| `free-test-form-field-map.csv` | `c30017105feee1b76f24dc1869ed852fee6234e5f755e45904b487f2ef524247` |

## Publication Boundary

Numeric or opaque organization, module, layout, field, picklist, pipeline, workflow, Blueprint, user, profile, and record identifiers are excluded. Private user-reference options, qualification thresholds, and raw vendor-managed high-cardinality catalogs are withheld. The private working snapshots and raw API responses are not repository artifacts.
