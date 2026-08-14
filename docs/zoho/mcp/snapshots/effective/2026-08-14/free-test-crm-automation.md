# Free-Test CRM Automation Effective Snapshot — 2026-08-14

## Status And Scope

- Classification: **Sanitized effective-tenant configuration evidence**
- Product: Zoho CRM
- Environment class: production
- Verification method: authorized identity check plus current module, field, layout, picklist, pipeline, validation-rule, workflow, action, Blueprint, and record-count reads
- Record or customer data published: none
- Live write in this acceptance pass: none
- Configuration acceptance: **Passed**
- End-to-end runtime acceptance: **Blocked**

This snapshot reconciles the [historical least-privilege design](../../../proposals/2026-08-14/sylvara-free-test-crm-mcp-allowlist.md) with the active configuration observed after the authorized Form 1/Form 2 automation work. It proves only the named state on the observation date. It is not evidence that Zoho Forms submissions, Lead conversion, task creation, field initialization, or Blueprint transitions work end to end.

## Acceptance Summary

- All 98 expanded CRM destinations required by the Form 1/Form 2 contract exist, are enabled, type-compatible, writable where required, and placed on the active Standard layouts.
- All intended Form 1 Lead-conversion mappings match current metadata.
- The Revenue Desk Sales pipeline contains the eight documented stages in the documented order.
- Four active Free-Test workflows and one active Deal Blueprint were read back.
- All four workflows report no prior execution, and the Blueprint reports zero enrolled records. Runtime acceptance therefore remains unproven.
- Native Lead conversion remains a named human-approved, irreversible action. The active workflows do not convert Leads.
- The latest approved Form 1 contains 14 visible inputs and 13 hidden/server values. Lead Source is workflow-owned rather than a form field. Middle Name, Company Logo, Plan Interest, Assisted By, and a separate Contact Phone are intentionally excluded.

The current field, layout, picklist, conversion, and form map is the [2026-08-14 CRM metadata snapshot](../../../../../../src/zoho-crm/reference/snapshots/2026-08-14/README.md).

## Active Workflow Contract

| Workflow | Module | Status | Trigger | Repeat | Criteria | Immediate actions | Scheduled actions |
|---|---|---|---|---|---|---|---|
| Leads Free Test Intake Review | Leads | Active | Create or edit | False | All: `Entry_Offer = Free 7-Day Missed-Call`; `Intake_Submission_ID` is not empty; `Lead_Status = Free Test Requested`; `Free_Test_Contact_Consent = true` | Create high-priority, not-started task `Review Free-Test Request — ${Leads.Company}` for the configured CRM operator; due current day; notification enabled | After one business day, create high-priority, not-started task `Follow Up — Free-Test Setup Not Scheduled — ${Leads.Company}`; due on execution day; notification enabled |
| Deals Free Test Form 2 Submitted | Deals | Active | Create or edit | False | All: `Entry_Offer = Free 7-Day Missed-Call`; `Setup_Form_Submission_ID` is not empty; `Setup_Form_Submitted_At` is not empty; `Authorized_Representative_Confirmed = true`; `Test_Scope_Accepted = true` | Create high-priority, not-started task `Review Free-Test Setup and Send Authorization — ${Deals.Deal Name}` for the configured CRM operator; due current day; notification enabled | None |
| Deals Free Test Initialize Controls | Deals | Active | Create only | Not applicable | `Entry_Offer = Free 7-Day Missed-Call` | Apply the five field updates below | None |
| Deals Free Test Initialize Limits | Deals | Active | Create only | Not applicable | `Entry_Offer = Free 7-Day Missed-Call` | Apply the two field updates below | None |

The two task workflows have no email, webhook, function, or field-update action beyond the actions shown. The Form 2 workflow does not send a signature request or authorize go-live. The two initialization workflows run only when `Entry_Offer` is present during Deal creation; adding it later does not invoke their create-only triggers.

### Initialization Field Updates

| Workflow | Field | Configured value |
|---|---|---|
| Deals Free Test Initialize Controls | `Setup_Access_Status` | `Not Issued` |
| Deals Free Test Initialize Controls | `Free_Test_Authorization_Status` | `Not Sent` |
| Deals Free Test Initialize Controls | `Go_Live_Approval_Status` | `Not Ready` |
| Deals Free Test Initialize Controls | `Test_Status` | `Not Started` |
| Deals Free Test Initialize Controls | `Test_Duration_Days` | `7` |
| Deals Free Test Initialize Limits | `Test_Call_Limit` | Private configured limit; value intentionally withheld |
| Deals Free Test Initialize Limits | `Test_Scope_Version` | `free-test-scope-v1.0` |

## Active Blueprint Contract

- Name: **Revenue Desk Free Test Delivery**
- Module/layout/pipeline: Deals / Standard / Revenue Desk Sales
- Control field: `Stage`
- Entry criterion: `Entry_Offer = Free 7-Day Missed-Call`
- Status: Active
- Continuous: False
- Transition execution: manual, record-owner, standalone
- Configured after-actions: none on every transition
- Enrolled records observed: zero

### States And Pipeline Values

| Sequence | Displayed stage | Stored/actual `Stage` value |
|---:|---|---|
| 1 | Setup and Authorization | `New Lead` |
| 2 | Test Authorized | `Demo Scheduled` |
| 3 | Setup and QA | `Demo Completed` |
| 4 | Test Live | `Value Proposition` |
| 5 | Results Review | `Checkout Sent` |
| 6 | Subscription Proposed | `Trial Started` |
| 7 | Closed Won | `Paid Subscription Active` |
| 8 | Closed Lost | `Closed Lost` |

### Transitions

| Transition | From → To | Criterion | Required during inputs | After-actions |
|---|---|---|---|---|
| Confirm Authorization | Setup and Authorization → Test Authorized | `Free_Test_Authorization_Status = Signed` | `Authorized_Representative_Confirmed`; `Test_Scope_Accepted`; `Setup_Form_Submission_ID`; `Setup_Form_Submitted_At`; `Authorization_Signed_At` | None |
| Begin Setup and QA | Test Authorized → Setup and QA | `Setup_Access_Status = Verified` | `Approved_Test_Route`; `Test_Phone_Number`; `No_Answer_Delay`; `Approved_Fallback_Destination`; `Approved_Fallback_Number`; `Forwarding_Administrator_Name`; `Forwarding_Administrator_Mobile`; `Alert_Recipient_Email`; `Setup_Access_Verified_At` | None |
| Approve Go Live | Setup and QA → Test Live | `Go_Live_Approval_Status = Approved` | `Go_Live_Approved_At`; `Test_Start_At` | None |
| Complete Free Test | Test Live → Results Review | None | `Test_End_At`; `Test_End_Reason`; `Test_Calls_Reaching_Route`; `Test_New_Service_Inquiries`; `Test_Existing_Customer_Calls`; `Test_Urgent_or_Person_Requested_Calls`; `Test_Qualified_Opportunities`; `Test_Callback_Requests`; `Test_Company_Confirmed_Outcomes`; `Test_Company_Confirmed_Value` | None |
| Propose Subscription | Results Review → Subscription Proposed | None | `Results_Review_At` | None |
| Activate Subscription | Subscription Proposed → Closed Won | None | None | None |
| Close During Authorization | Setup and Authorization → Closed Lost | None | `Reason_For_Loss__s` | None |
| Close After Authorization | Test Authorized → Closed Lost | None | `Reason_For_Loss__s` | None |
| Close During QA | Setup and QA → Closed Lost | None | `Reason_For_Loss__s` | None |
| Close Live Test | Test Live → Closed Lost | None | `Reason_For_Loss__s` | None |
| Close After Results Review | Results Review → Closed Lost | None | `Reason_For_Loss__s` | None |
| Decline Subscription | Subscription Proposed → Closed Lost | None | `Reason_For_Loss__s` | None |

## Blocking Gaps

1. **Deal creation can fail on `Type`.** An active Deal validation rule rejects a save when `Deals.Type` is empty. `Type` is not a Form 1 or Form 2 input, no Lead field maps to it, and neither initializer sets it. The conversion/controller contract must set the active value `Initial Sale` during Deal creation and read it back.
2. **Three Blueprint inputs conflict with valid Form 2 conditions.** Form 2 requires `No_Answer_Delay` only for a route that uses no-answer behavior and `Approved_Fallback_Number` only for a fallback destination that needs a number. It permits either alert mobile or alert email. `Begin Setup and QA` instead requires both conditional fields and specifically requires `Alert_Recipient_Email` on every record. A contract-valid Form 2 submission can therefore be blocked.
3. **Stage and operational status can drift.** The Blueprint is controlled by `Stage`, not `Test_Status`, and every transition has no after-action. Advancing Stage does not update `Test_Status` or its related operational timestamps/statuses.
4. **Stopping a live test is under-controlled.** `Close Live Test` requires only a loss reason. It does not require `Test_End_At`, `Test_End_Reason`, or `Rollback_Completed_At`, and it does not synchronize Test Status. A Deal can reach Closed Lost while routing or rollback remains unresolved.
5. **Closed Won is under-controlled.** `Activate Subscription` has no criterion, required evidence, or action. It can mark a Deal Closed Won without authoritative payment or subscription evidence.
6. **Deal-side idempotency is not metadata-enforced.** `Intake_Submission_ID` and `Setup_Form_Submission_ID` are not unique on Deals. The controller must perform deterministic lookup, replay detection, and post-write readback.
7. **Runtime evidence is absent.** The four workflows have not executed and the Blueprint has zero enrolled records. Configuration readback does not prove task creation, field initialization, criteria behavior, or transitions.
8. **The Forms/controller path is unverified.** Current Form 1/Form 2 link names, page order, conditions, hidden/default expressions, secure context, personal/encryption settings, confirmation behavior, retry/replay handling, and live CRM mappings were not available through the CRM audit role.

One unrelated legacy workflow, `Big Deal Rule`, remains active and can send a generic alert when its private configured criteria are met. Its interaction with a future Closed Won acceptance record must be contained during testing.

## Acceptance Gate

Before calling this workflow operational, a separately approved change must resolve the `Deals.Type` write and the three Form 2/Blueprint requirement conflicts, define Stage-to-`Test_Status` and stop/rollback controls, and tighten Closed Won evidence. Then use one synthetic disposable path to verify Form 1 intake and task creation, named human conversion with `Type = Initial Sale`, both initialization workflows, secure Form 2 update, task creation, every success transition, each loss transition, duplicate/replay handling, and authoritative readback. Contain the unrelated Big Deal rule before exercising a Closed Won canary.

## Capability And Authority Boundary

The exercised Audit calls established organization identity, module/field/layout/picklist/pipeline metadata, validation-rule behavior, workflow and Blueprint configuration, task and field-update action metadata, and bounded record-count readbacks. The separately scoped automation roles supplied the typed workflow and Blueprint configuration actions used for the earlier authorized deployment. No claim is made here for unexercised read families or continuing write authorization.

This evidence does not authorize a CRM mutation, native Lead conversion, record transition, Forms mutation, connection authorization, external message, signature request, phone-route change, or sandbox deployment. Reverify identity, current prestate, exact contract, rollback or containment, and independent readback before every future mutation.
