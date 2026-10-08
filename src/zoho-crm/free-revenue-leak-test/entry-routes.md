# Free-Test Entry Routes

Both routes are required subchecks of G1. Exactly three Zoho Forms are retained:
two physical Form 1 entry surfaces and one shared Form 2 setup/authorization form.
The assisted entry originates in CRM; only the website entry includes Bookings.
Both converge on the same protected Form 2 and setup contract.
This map describes source ownership and retained acceptance; it does not enable
public intake, make an appointment, or authorize another fixture.

| Boundary | Route A — CRM-assisted, scheduling bypassed | Route B — website intake and setup appointment |
| --- | --- | --- |
| Form identity | Existing CRM-assisted physical surface of logical `RevenueLeakTestRequestForm` | Existing public physical surface of the same logical Form 1; no replacement form |
| Entry and client | Existing Leads `Start Free-Test Request` Client Script button, through the CRM function and Catalyst access page; iPad interaction remains to be accepted | Existing website CTA and public Form 1; exact current scheduling handoff requires provider readback |
| Prefill authority | CRM record bound server-side through Issue → fragment Exchange → one-time Prefill; contractor consent remains unset | Existing public entry fields and fixed native metadata; no assisted credential or caller-selected CRM identity |
| Submission owner | Catalyst updates only the bound Lead after session, revision and submission checks; native CRM writer disabled | Existing Forms native CRM integration is the sole intake writer; Catalyst's public acknowledgment does not write CRM |
| CRM mapping | Original Lead and journey, qualification, then the existing controlled native conversion into Account, Contact and Deal | Original Forms entry/intake identity and Lead, authoritative setup appointment correlation, then the existing qualification/conversion relationship |
| Redirect and scheduling | Exchange opens only the configured assisted Form 1. No scheduling page, slot, booking ID, calendar prerequisite or automatic appointment creation | Continue through the existing setup scheduling flow. A redirect or thank-you page is not a confirmed booking; verify the existing service, staff, calendar and time-zone binding |
| Convergence | Existing eligible Deal Form 2 launcher after conversion; no booking detour | Existing eligible Deal Form 2 launcher on the original website-originated relationship; no second Form 1 or repeat booking |
| Shared authority | Form 2 verification and exact Contact/Account/Deal readback, immutable setup, separate internal approval, separate activation | The same protected setup/runtime contract; appointment confirmation grants neither setup authority nor activation |

Actual form, button, entry, booking, calendar and relationship identifiers belong
in the private execution record. Source locations are the [CRM callers](README.md),
[Form 1 controller](../../zoho-catalyst/revenue-leak-test-request-form/README.md),
[Forms manifest](../../zoho-forms/free-revenue-leak-test/forms-manifest.json), and
[operator runbook](../../zoho-catalyst/revenue-desk-release/free-test-operator-runbook.md).

## Public Native Writer Evidence Boundary

The **2026-10-08 21:43 UTC read-only audit** observed Route B's native integration
as Leads / Standard, New Record, Upsert unchecked, and Automation & Process
Management checked. All 30 mappings matched source; `Intake_Submission_ID` mapped
to native `RandomId`. Match order and blank-overwrite policy were hidden and
remain **Unknown**. Public sharing and CAPTCHA were untouched and not freshly
reverified. No cause or approval for the unchecked Upsert setting is inferred.

The intended contract preserves intake/journey identity, company ownership,
consent and safe duplicate/retry behavior. The earlier intake-ID-only Upsert
proposal was cancelled because native controls allowed ordering, not exclusion
of unique Email. Email fallback can replace Company, journey identity and consent;
blank-overwrite protection does not prevent nonblank replacement. Upsert-off's
unique-field behavior remains unresolved and is not public acceptance evidence.
Validate operation, Upsert, match order and blank policy explicitly; hidden,
missing or unknown controls cannot pass public acceptance. Preserve the public
hold until a supported writer design, exact saved-state readback and controlled
acceptance establish these safeguards. Accepted assisted lineage remains accepted;
G1 remains partial and still requires both routes.

## Relationship And Retry Rules

- Preserve the original entry and native conversion lineage. Current mutable
  Deal links, matching email or matching phone do not establish company ownership.
- Keep public and assisted writers separate. An invalid, ambiguous or unavailable
  assisted session cannot fall back to public discovery; only authoritative
  absence permits the existing exact public journey lookup.
- A website request survives abandoned scheduling. Reconcile the original intake
  before continuing the existing scheduling flow; never manufacture another
  request to work around an incomplete appointment.
- Reschedule, cancellation and uncertain booking outcomes require authoritative
  readback of the existing appointment, calendar event and CRM relationship before
  any retry. Do not assume an email match, redirect, event title or scheduled time
  uniquely joins these records. No new booking writer or API contract is supplied
  by this source change.
- Once native conversion has occurred, continue the same eligible Deal through
  Form 2. The installed assisted Form 1 launcher is Leads-only. Do not reopen an
  accepted Form 2 submission, reconvert, duplicate a Deal, or force another Form 1.
- Duplicate or ambiguous downstream staging retains its durable claim and needs
  reconciliation; it cannot obtain a fresh write allocation by retrying.

## Retained Acceptance And Remaining Subchecks

The private September 24–25 records supersede older G1 labels that described all
public recovery and new-business conversion as unexecuted. They retain selected
same-entry native recovery with identity/timestamp preservation, one new-business
native conversion with exact lineage, and delayed duplicate-email non-overwrite
readback. The owner accepted a contained existing-relationship operating
alternative. These are scoped facets, not unrestricted public-entry acceptance.
Provider-generated duplicate-intake-ID tenant execution remains unexercised;
intended task effects and other unresolved public cases remain explicit. Preserve
the existing public-intake hold and consumed allocations.

| G1 subcheck | Evidence retained | Required remaining evidence |
| --- | --- | --- |
| Route A | Accepted assisted intake/conversion and shared setup evidence; source has no scheduling dependency | Exact iPad CRM button/browser handoff and confirmation that the configured assisted form has no scheduling redirect or side effect |
| Route B | Selected native intake/recovery/conversion and negative collision evidence | Current website/form scheduling handoff; authoritative confirmed booking → intended staff/service/calendar → original CRM relationship; abandonment, cancellation/reschedule and ambiguous retry behavior |
| Shared convergence | Existing canonical journey/conversion/Form 2 checks, inactive staging, exact replay and company-isolation regressions | Any changed live binding must be read back under its own allocation; reuse unchanged accepted setup and backend evidence |

Read-only CRM discovery on September 29 confirmed the expected organization and
current Administrator role, native conversion fields, Deal journey/setup fields,
and CRM Events relationship/time fields. It did not establish an appointment join.
The callable inventory had no Forms, Bookings or Zoho Calendar connector. CRM's
single-module metadata tool rejected its duplicated `oneOf` schema; the module
inventory and field metadata alternatives worked. No new booking API, endpoint,
Connection, notification policy or calendar provider is inferred from those facts.
Fresh read-only Forms and Bookings UI discovery also confirmed the three existing
forms, the public native Lead writer, and the assisted webhook-only integration.
The assisted form's saved thank-you page contains no scheduling link or redirect;
this agrees with the source's negative scheduling tests. The exact iPad handoff
still needs device acceptance.

The public form's saved thank-you page currently acknowledges intake without a
scheduling link or redirect. This is a demonstrated configuration gap in Route B,
not a reason to remove appointment booking from scope. The existing fifteen-minute
setup service is active and assigned to the operator; the existing CRM integration
maps customers to Leads and appointments to Events. Its customer sync checks
existing Leads/Contacts and otherwise creates a Lead. No intake-identity custom
mapping was displayed for the setup service. That behavior alone cannot prove
safe original-relationship correlation or wrong-company isolation. Calendar
destination and conflict calendars were read privately; no provider was changed.
Before adding the website handoff, qualify the native appointment identity and
relationship join, confirm the intended effects, and approve the exact existing
form/service configuration delta. Never solve it with a second intake writer,
email-only ownership, another form or automatic appointment creation in Route A.

During the next separately approved Route A access/verification allocation,
Gabriel should open the exact eligible Lead in his usual iPad CRM surface, press
`Start Free-Test Request`, and verify the correct assisted form, record prefill,
unchecked consent and absence of scheduling. Record the CRM/browser surface and
result privately. The button can issue a session, so this is not a read-only
click. Submit or request verification only when that allocation includes it.
Desktop tests do not establish iPad acceptance.

Gabriel owns device and appointment acceptance; the operator owns metadata
reconciliation and failure containment. Any later booking fixture must separately
bound appointment, invitation, calendar and CRM effects, retries and cost before
execution. This source change adds no service dependency or scheduled operation
and installs nothing. Source rollback restores the prior documentation/tests; live containment
keeps existing holds and preserves original entries, relationships and evidence.
G1–G8 and H1–H10 remain the fixed denominators. These route subchecks add no gate,
do not erase prior passes, and do not turn setup booking into caller-job booking.
