# Sylvara CRM Schema And Lead Conversion Reference

## Status And Provenance

This is a sanitized metadata snapshot observed and reconciled on **2026-08-05** through the authorized Sylvara CRM audit and change roles. Live metadata supplied every recorded module and field API name. Private IDs, raw responses, record values, and picklist internals were removed before publication.

Immutable public artifact fingerprints:

| Artifact | SHA-256 |
|---|---|
| `modules.csv` | `5b21ffef4d7a0434e612d039400a446b8fdbc9eff2ccdd6925c58332b6fcbb3d` |
| `crm-field-dictionary.csv` | `228e92a52009ab1556a70f51c218829807d73eed35ab89452125f808ab94176a` |
| `lead-conversion-mapping.csv` | `05b2f1c8d143105f76bfda2aa19f4cf6f0126a8e799f8e951ff118890ea22c09` |

The current state and the recommended state are deliberately separate:

- `current_mapping_status=mapped` means the mapping was verified live on the snapshot date.
- `mapping_review_status=safe_keep` means a current mapping is semantically and technically safe to retain.
- `mapping_review_status=remove` means a current mapping should be removed before the next native Lead conversion.
- `mapping_review_status=safe_add` means an existing target field can safely receive the source field after an approved mapping change.
- `mapping_review_status=target_creation_required` means no suitable target exists and a complete field proposal is required. These are reviewed candidates, not deployment-ready field specifications. Target API names remain blank until an approved creation and Zoho readback.
- `mapping_review_status=intentional_unmapped` means the source value should remain on the retained converted Lead or be handled by a separately approved workflow.

Recommendations in this package are **not deployed**.

## Module Inventory

| Module label | Module API name | Fields | Used | Unused | Conversion role |
|---|---|---:|---:|---:|---|
| Leads | `Leads` | 120 | 112 | 8 | Source prospect |
| Contacts | `Contacts` | 83 | 65 | 18 | Person record |
| Accounts | `Accounts` | 80 | 58 | 22 | Company record |
| Deals | `Deals` | 91 | 69 | 22 | Commercial opportunity |

The authoritative machine-readable catalog is [modules.csv](modules.csv).

## Field Dictionary Contract

[crm-field-dictionary.csv](crm-field-dictionary.csv) contains 374 unique `module_api_name + field_api_name` rows. It records:

- module and field labels plus API names;
- Zoho metadata data type;
- standard or custom origin;
- current used or unused classification;
- writable or protected status;
- system-required and standard-layout-required status;
- concrete or virtual/compound-component status;
- whether help text is present; and
- the metadata verification state.

Help-text content, field values, picklist choices, internal choice values, colors, profile access, and numeric IDs are intentionally excluded. The live system remains authoritative for those details.

Help-text coverage reconciles across all 374 fields: 171 have help text, 124 do not support it through the verified field contract, and 79 show no text. Of the 79, 67 are unused fields and the remaining 12 are compound Address, Coordinates, or Distance entries marked read-only by the verified metadata. All used fields marked writable have help text, but the 12 used exceptions remain an unresolved capability gap; this is not full help-text completion.

## Lead Conversion Matrix

[lead-conversion-mapping.csv](lead-conversion-mapping.csv) contains 360 unique rows: every one of the 120 Lead fields reviewed against Contacts, Accounts, and Deals. Explicit non-mapping rows prevent silence from being mistaken for an incomplete review.

### Review Summary

| Review result | Rows | Deployment meaning |
|---|---:|---|
| Safe current mappings | 50 | Keep |
| Unsafe current mappings | 4 | Remove before conversion |
| Safe additions to existing targets | 18 | Add after approval |
| New target fields required | 11 | Blocked pending complete field proposals |
| Intentional non-mappings | 277 | Preserve as intentionally unmapped |

The live configuration contains 54 mapped pairs. The reviewed target state would contain 79 pairs after removing four unsafe mappings, adding 18 existing-target mappings, creating 11 approved targets, and mapping those targets. That target state is a recommendation only.

### Current Mappings To Remove

| Lead source | Source API name | Current target | Target API name | Reason |
|---|---|---|---|---|
| Designation | `Designation` | Accounts: Title | `Title` | Person data must not populate company metadata |
| Phone | `Phone` | Accounts: Phone | `Phone` | Person phone must not overwrite company phone |
| Mobile | `Mobile` | Accounts: Mobile | `Mobile` | Person mobile must remain Contact-owned |
| Service Interest | `Service_Interest` | Accounts: Active Services | `Active_Services` | Prospect interest is not an active customer service |

The Account phone replacement is Lead `Company_Phone` to Account `Phone`.

### Safe Additions To Existing Fields

| Target module | Lead source API name | Existing target API name |
|---|---|---|
| Contacts | `Email_Opt_Out` | `Email_Opt_Out` |
| Contacts | `Salutation` | `Salutation` |
| Contacts | `Time_Zone` | `Time_Zone` |
| Accounts | `Company_Email` | `Email` |
| Accounts | `Company_Phone` | `Phone` |
| Accounts | `No_of_Employees` | `Employees` |
| Accounts | `Annual_Revenue` | `Annual_Revenue` |
| Deals | `Pain_Point_Summary` | `Pain_Point_Summary` |
| Deals | `Timeline_Fit` | `Timeline_Fit` |
| Deals | `Budget_Fit` | `Budget_Fit` |
| Deals | `Current_Call_Handling` | `Current_Call_Handling` |
| Deals | `Coverage_Needs` | `Coverage_Needs` |
| Deals | `Primary_Operating_System` | `Primary_Operating_System` |
| Deals | `Scheduling_Process` | `Scheduling_Process` |
| Deals | `Integration_Readiness` | `Integration_Readiness` |
| Deals | `Monthly_Inbound_Call_Band` | `Monthly_Inbound_Call_Band` |
| Deals | `After_Hours_Call_Band` | `After_Hours_Call_Band` |
| Deals | `Average_Job_Value_Band` | `Average_Job_Value_Band` |

### Candidate Targets Requiring Complete Field Proposals

| Target module | Lead source label | Source API name | Target status |
|---|---|---|---|
| Contacts | Text Opt Out | `Text_Opt_Out` | Candidate; complete field proposal required |
| Contacts | Decision-Maker Role | `Decision_Maker_Role` | Candidate; complete field proposal required |
| Contacts | Decision Authority | `Decision_Authority` | Candidate; complete field proposal required |
| Contacts | Contact Location Link | `Contact_Location_Relationship` | Candidate; complete field proposal required |
| Contacts | Contact Verification | `Contact_Verification_Status` | Candidate; complete field proposal required |
| Contacts | Contact Source URL | `Contact_Source_URL` | Candidate; complete field proposal required |
| Contacts | Contact Verified At | `Contact_Verified_At` | Candidate; complete field proposal required |
| Deals | Pain Signals | `Pain_Signals` | Candidate; complete field proposal required |
| Deals | After-Hours Audit At | `After_Hours_Audit_At` | Candidate; complete field proposal required |
| Deals | After-Hours Audit Outcome | `After_Hours_Audit_Outcome` | Candidate; complete field proposal required |
| Deals | After-Hours Audit Notes | `After_Hours_Audit_Notes` | Candidate; complete field proposal required |

`After_Hours_Audit_Outcome` must receive its own Deal field. The existing Deal `Pilot_Outcome` field has a different lifecycle meaning and incompatible choices.

No row in this section authorizes creation. Before any target can be created, a separate proposal must define its final label, intended data type and subtype, length or precision, choices and stored values, help text, permissions, layout section and order, required/default behavior, migration impact, rollback, and independently verified API name.

## Consolidated Address Bundle

The following verified Lead fields currently map to same-purpose fields in Contacts, Accounts, and Deals:

| Label | Lead API name |
|---|---|
| Address | `Address` |
| Address - City | `Address_City` |
| Address - Coordinates | `Address_Coordinates` |
| Address - Latitude | `Address_Coordinates_Latitude` |
| Address - Longitude | `Address_Coordinates_Longitude` |
| Address - Country / Region | `Address_Country_Region` |
| Address - Flat / House No./ Building / Apartment Name | `Address_Flat_House_No_Building_Apartment_Name` |
| Address - State / Province | `Address_State_Province` |
| Address - Street Address | `Address_Street_Address` |
| Address - Zip / Postal Code | `Address_Zip_Postal_Code` |

These 10 components account for 30 of the 50 safe current mappings. The Account Address is the authoritative business or operating location. Contact and Deal Address values are conversion-time associated-business-site snapshots, not a Contact residential address or independent location masters. No continuing cross-module synchronization was verified; if this semantic contract is not intended, remove the Contact mappings before conversion.

Legacy address schema fields were structurally retained, but their migrated values were cleared after consolidated-field readback. Rollback requires the private prestate or a controlled reverse-copy from the consolidated components.

## Intentional Non-Mapping Rules

- Lead lifecycle/status must not map to Deal `Stage` or Pipeline.
- Lead `Rating` must not map to Contact Priority or Account Rating; their live meanings and choice contracts differ.
- Lead `Next_Action` must not map to Deal `Next_Steps`.
- Lead `Service_Interest` must not map to a Deal service or plan field.
- banded estimates must not populate exact numeric or currency fields.
- person-owned values remain on Contacts, company-owned values on Accounts, and opportunity-specific qualification values on Deals.

Lead `Pain_Point_Summary` is a deliberate scoped copy: Account `Pain_Point_Summary` is the evolving company-level relationship summary, while Deal `Pain_Point_Summary` is the opportunity-specific conversion snapshot. There is no bidirectional synchronization, and later divergence is expected by scope.

## Native Conversion Prerequisites

The owner-approved boundary is the earlier of a pilot start or an approved direct-subscription start. Native conversion must create or update the Contact and Account and create or associate the first Deal without treating Lead lifecycle state as Deal pipeline state. A Lead converted for a pilot is already a Contact at later subscription; that subscription becomes a follow-on relationship or Deal, not a second conversion.

This boundary is blocked on a final reporting-model decision. If discovery, qualification, proposal, or commitment must be managed in the Deal pipeline, the trigger must move earlier to an approved sales-qualified-opportunity event. The current pilot/direct-subscription rule intentionally keeps those earlier activities on the Lead.

The complete required-field contract is:

| Resolution | Module | Field label | Field API name |
|---|---|---|---|
| Source-derived | Contacts | First Name | `First_Name` |
| Source-derived | Contacts | Last Name | `Last_Name` |
| Source-derived | Accounts | Account Name | `Account_Name` |
| Approved conversion value | Contacts | Contact Type | `Contact_Type` |
| Approved conversion value | Accounts | Account Type | `Account_Type` |
| Approved conversion value | Accounts | Onboarding Status | `Onboarding_Status` |
| Relationship-resolved | Deals | Account Name | `Account_Name` |
| Relationship-resolved | Deals | Contact Name | `Contact_Name` |
| Explicit conversion input | Deals | Deal Name | `Deal_Name` |
| Explicit conversion input | Deals | Pipeline | `Pipeline` |
| Explicit conversion input | Deals | Stage | `Stage` |
| Explicit conversion input | Deals | Closing Date | `Closing_Date` |

Do not rely silently on the current default Pipeline, Stage, or type/status values. The approved conversion contract must supply or prove each value. `Pilot_Outcome` and billing/subscription lifecycle fields remain blank at initial conversion.

The verified connector surface did not expose a typed Lead Conversion Mapping write, native Convert Lead write, or workflow-rule mutation. Generic record creation is not a safe substitute because it can bypass native conversion semantics, duplicate records, and leave the Lead unconverted. Native conversion is irreversible; deployment remains blocked until those exact contracts, duplicate behavior, trigger behavior, and rollback/containment are verified.

## Source And Verification

Official product behavior was checked against:

- [Zoho CRM API V8: Convert Lead](https://www.zoho.com/crm/developer/docs/api/v8/convert-lead.html)
- [Zoho CRM API V8: Lead Conversion Options](https://www.zoho.com/crm/developer/docs/api/v8/lead-conversion-options.html)
- [Zoho CRM Help: Convert Leads](https://help.zoho.com/portal/en/kb/crm/sales-force-automation/leads/articles/convert-leads)
- [Zoho CRM API V8: Fields Metadata](https://www.zoho.com/crm/developer/docs/api/v8/field-meta.html)

Official documentation establishes product behavior, not tenant access or deployment. Live metadata and returned API names remain authoritative.

## Public Exclusions

This package does not publish organization, module, field, layout, record, workflow, user, or picklist internal IDs; record values; customer or prospect data; raw metadata; option internals; profile permissions; private endpoints; authentication details; or plugin runtime names. Detailed prestate and readback evidence remains in the approved private audit record.
