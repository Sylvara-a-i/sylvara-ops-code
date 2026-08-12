# Free-Test CRM Schema Deployment — 2026-08-12

## Outcome

The bounded Sylvara CRM deployment is complete for the approved Free-Test field set. Independent readback through the separate read-only CRM role verified all **84 fields** in the intended module, section, and order. Every field is optional and every field has live help text.

| Module | Verified fields | Intended sections |
|---|---:|---|
| Leads | 18 | Free Test Request; Free Test Attribution & Consent |
| Contacts | 8 | Authority & Verification |
| Accounts | 7 | Front-Office Profile |
| Deals | 51 | Free Test Request; Free Test Setup; Free Test Control & Authorization; Free Test Results |

Thirty-four absent fields were created. Help text was repaired on the 50 fields that already existed. The live metadata readback reported no missing field, section-order, optionality, or help-text exception in this 84-field scope.

The complete machine-readable contract is:

- [Free-Test field manifest](free-test-field-manifest.csv) — labels, authoritative API names, types, lengths, precision, section/order, required status, help text, profile status, and normalization notes.
- [Free-Test picklist values](free-test-picklist-values.csv) — authoritative value order, display labels, colors, usage state, and normalization notes.
- [Full four-module field dictionary](crm-field-dictionary.csv) — all 467 current fields, sanitized.
- [Current module inventory](modules.csv) — current module totals and used/unused counts.

## Current Module Totals

| Module | Total | Used | Unused |
|---|---:|---:|---:|
| Leads | 137 | 130 | 7 |
| Contacts | 91 | 73 | 18 |
| Accounts | 97 | 75 | 22 |
| Deals | 142 | 110 | 32 |

These counts and API names are a dated snapshot, not a perpetual live-state claim.

## Layout Contract

Free-Test request and setup data remain deliberately separate:

- Leads contain prospect research, initial Free-Test request, attribution, and contact-consent evidence.
- Contacts contain person-level authority, verification, opt-out, and retained consent evidence.
- Accounts contain the company front-office profile.
- Deals contain the opportunity-specific request, setup, authorization/control, and results sections.
- Setup fields do not belong on Leads.

The core Lead operating view should continue to prioritize company and service address, the main decision maker's name/role/authority/email/mobile, research and verification evidence, outreach state, and Free-Test intake. No duplicate generic “Name” field is required.

## Normalized Live Values

Connector and Zoho constraints required these bounded, meaning-preserving normalizations:

- 'Free 7-Day Missed-Call' is the live Free-Test entry-offer label.
- 'After Hours + Overflow' is the live combined-route label.
- 'Fixtures & Faucets' is the live service option.
- Long operational values were shortened to 'Attempt Approved Transfer', 'Alert + Capture Callback', 'Capture Callback Only', and 'Use Approved Fallback'.
- Three proposed 1,000-character textareas use Zoho's supported 2,000-character small-textarea capacity.
- Deal API name 'Test_Urgent_or_Person_Requested_Calls' is authoritative; the lowercase 'or' is intentional.
- 'Test_Duration_Days' and 'Test_Call_Limit' remain optional integer fields. Intake or workflow logic must explicitly supply 7 and 25; the field schema does not carry those operational defaults.
- Boolean automations must send explicit values instead of relying on an undocumented schema default.

## Picklist Exception

The new custom picklists and their help text were created and independently verified. A separate attempt to add 'Website - Free Test' and 'In Person - Free Test' to Zoho's system-defined Lead Source field returned connector success, but independent metadata readback showed no change. It was not retried.

The same fail-closed rule applies to Lead Status. Continue to reuse existing semantic equivalents where appropriate and treat these exact Free-Test statuses as undeployed until a system-picklist-capable mutation path is independently verified:

- 'Free Test Requested'
- 'Free Test Setup Scheduled'
- 'Qualified for Free Test'

## Deletion And Cleanup Boundary

No field was permanently deleted.

Unused or off-layout metadata does not prove that a field has no values or dependencies. The current read surface cannot rule out Zoho Forms, functions, templates, reports, Blueprints, Analytics, webhooks, or external API consumers. The off-layout Deal address bundle is also a current Lead-conversion target. Those fields remain quarantined rather than destroyed.

Before deleting any candidate field:

1. prove it is custom, empty, off-layout, unmapped, and dependency-free;
2. capture private prestate and exact field ID outside GitHub;
3. identify Forms, automation, templates, reporting, conversion, and external consumers;
4. obtain approval for the exact field;
5. delete one field at a time; and
6. independently reconcile metadata and downstream behavior.

## Pipeline Decision

Use one Deal pipeline for the acquisition journey. The recommended target is **Revenue Desk Acquisition**:

1. Setup and Authorization
2. Test Authorized
3. Setup and QA
4. Test Live
5. Results Review
6. Paid Service Proposed
7. Closed Won
8. Closed Lost

One opportunity should move from an accepted Free Test to the first paid commitment. 'Test_Status' owns operational trial state; Deal Stage is the commercial summary. 'Closed Won' means a paid agreement was accepted, not merely that a test finished. After that point, Zoho Billing owns active, paused, renewed, canceled, and dunning subscription state.

This pipeline recommendation is **not deployed**. The current bounded CRM Changes server exposes no pipeline create/update operation. Do not delete either existing pipeline until Deals, workflows, Blueprints, forecasts, and integrations are audited and a migration plan is approved.

## Verification And Rollback

Each field-create and layout-placement batch contained no more than five fields and received independent readback before continuation. Custom-field label and help-text repairs were also read back independently. Connector “success” alone was never treated as authoritative.

Containment is the default rollback:

- leave a newly created field empty and stop dependent automation;
- restore layout placement or custom-field metadata from private prestate;
- do not invoke permanent field deletion without separate approval and dependency proof; and
- reconcile ambiguous results through the independent Audit role before retrying.

Official behavior references:

- [Zoho CRM API V8 — Create Custom Fields](https://www.zoho.com/crm/developer/docs/api/v8/create-custom-field.html)
- [Zoho CRM API V8 — Update Custom Fields](https://www.zoho.com/crm/developer/docs/api/v8/update-custom-fields.html)
- [Zoho CRM API V8 — Picklist Values](https://www.zoho.com/crm/developer/docs/api/v8/picklist-values.html)

## Public Boundary

This artifact excludes organization, user, profile, module, layout, section, field, picklist, workflow, and record IDs; record values; raw responses; payloads; connection details; endpoints; and authentication material. Labels, API names, approved help text, and business choices are retained as Sylvara's sanitized integration contract.
