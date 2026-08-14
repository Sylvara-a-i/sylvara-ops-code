# Free-Test CRM Automation Effective Snapshot — 2026-08-14

## Status And Scope

- Classification: **Sanitized effective-tenant evidence**
- Product: Zoho CRM
- Environment class: production
- Verification method: authorized identity check, current metadata reads, configuration readback, and independent audit inspection
- Record or customer data published: none
- Live write in the field-audit pass: none

This snapshot reconciles the [least-privilege design](../../../proposals/2026-08-14/sylvara-free-test-crm-mcp-allowlist.md) with the configuration observed after the authorized Form 1/Form 2 automation work. It proves only the named state on the observation date.

## Observed Active Configuration

- Form 1 Lead intake-review workflow.
- Deal Form 2 submitted workflow.
- Deal free-test control initialization workflow.
- Deal free-test limit initialization workflow.
- Revenue Desk Free Test Delivery Blueprint with eight states and twelve transitions.
- Revenue Desk Sales pipeline with eight ordered stages from Setup and Authorization through Closed Won or Closed Lost.

Native Lead conversion remains a human-approved, irreversible action. The active workflows do not convert a Lead automatically.

The latest approved Form 1 intentionally excludes Middle Name, Company Logo, Plan Interest, Assisted By, and a separate Contact Phone. Their absence is not a current schema defect.

## Current Schema Contract

The [2026-08-14 live CRM snapshot](../../../../../../src/zoho-crm/reference/snapshots/2026-08-14/README.md) records:

- 466 fields across Leads, Contacts, Accounts, and Deals;
- every enabled field's Standard-layout placement;
- publishable display and stored picklist values, including pipeline-specific Stage order, with private user references, qualification thresholds, and high-cardinality vendor catalogs withheld;
- 414 current Lead-to-target rows with 76 observed mapped pairs; and
- the Form 1/Form 2 CRM destination and control map.

The four unsafe mappings identified in the historical 2026-08-05 review are absent from current metadata. Do not infer a fifth unsafe mapping.

## Known Gaps

1. Every observed Blueprint transition has no configured after-action. Advancing Deal Stage does not prove that `Test_Status` advanced, so the two fields can drift.
2. Transition requirements do not enforce every provenance and setup field. Authority/scope timestamps and versions, rollback contacts, several call-handling fields, and Target Start Date need an explicit validation decision.
3. Deal `Setup_Form_Submission_ID` and Deal `Intake_Submission_ID` are not unique. Replay protection requires deterministic matching and readback.
4. Zoho Forms link names, page order, hidden/default expressions, personal/encryption settings, confirmations, and replay behavior were not available through the CRM audit role and remain **Unknown**.
5. Deal Plan, Deal Service Line, and Account Active Services still use legacy generic offer vocabulary.

## Capability Boundary

The exercised Audit calls established organization identity, module/field/layout/picklist/pipeline metadata, workflow and Blueprint configuration, task and field-update action metadata, and bounded record-count readbacks. The separately scoped automation roles supplied the typed workflow and Blueprint configuration actions used for the authorized deployment. No claim is made here for unexercised read families.

This evidence does not authorize a new CRM write, native Lead conversion, record transition, Forms mutation, connection authorization, external message, signature request, phone-route change, or sandbox deployment. Reverify identity, current prestate, exact contract, rollback or containment, and independent readback before every future mutation.
