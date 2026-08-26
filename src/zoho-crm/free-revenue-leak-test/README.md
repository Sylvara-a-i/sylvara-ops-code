# Free Revenue Leak Test CRM Controls

This directory is the sanitized, version-controlled desired state for the Free Revenue Leak Test lifecycle in Zoho CRM. CRM remains the relationship, qualification, commercial-acceptance, and summary system. Catalyst owns call events, deployment ownership, notification processing, counters, and detailed reports.

[`config/automation-contract.json`](config/automation-contract.json) records the 17 required Deal fields that a 2026-08-24 read-only live metadata audit verified already exist, the now-empty additive-field set, three logical workflows realized by four provider rules, the single Revenue Desk Blueprint, distinct version-specific approval and post-route-readback activation invariants, paid-acceptance gates, and the disposable `ZZZ SYNTHETIC` acceptance path. The Deal initializer is an explicit provider-safe 5+3 split: Controls owns five field updates and Limits owns three. Both remain create-only, share the same entry contract, and have disjoint actions. A separate fail-closed post-create reconciliation contract may repair only one group when the other group is exact, every present value in the missing group already equals its default, and at least one group field is absent or null. It writes the complete missing group only; a conflict, ambiguous read, or two incomplete groups blocks without a write. Approval leaves the Deal's test status `Scheduled` and its actual timing empty; activation alone may set `Live` after Catalyst validates the chained receipt. For migration safety, the CRM display value remains `7-Day Revenue Leak Test` while its actual/reference value and the mapped Zoho Forms choice remain `Free 7-Day Missed-Call`; independently read-back workflow and Blueprint criteria use the display value, and every customer-facing label uses **Free Revenue Leak Test**.

This contract is desired state, not deployment authorization. The repository topology now respects the five-associated-field-update limit reported by the 2026-08-25 Sylvara workflow-configuration readback. The post-create repair matrix is policy and synthetic test logic only: this repository adds no repair Deluge, callable CRM function, scheduler, or live write. A typed writer contract, fresh pre-write read, one bounded group-only write, ambiguous-write containment, exact eight-field readback, and a disposable `ZZZ SYNTHETIC` canary remain mandatory before deployment. The connected workflow writer still exposes no reviewed typed payload contract, so no live workflow change is safe from this source alone. `Type = Initial Sale` must also be supplied before Deal creation because a create-only workflow cannot satisfy the active pre-save validation rule; the repair classifier therefore permits a present exact `Type` while the other Limits defaults are absent, but any non-default value blocks.

## CRM Button Caller Templates

[`config/caller-manifest.json`](config/caller-manifest.json) and [`functions/`](functions/) define exact reviewed repository templates for the two administrator-restricted Development callers:

- Form 1 accepts only the current Lead ID, sends exactly `leadId`, requires the exact 201 response, validates the privately rendered Zoho Forms destination and its isolated 43-character base64url token, and opens no URL on any mismatch.
- Form 2 accepts only the current Deal ID plus a retry-stable lowercase UUID v4, sends exactly `dealId` and `issueRequestId`, requires the exact 200 response, validates the privately rendered Catalyst access destination and its isolated 43-character base64url fragment, and opens no URL on any mismatch.

The templates contain no URL, credential, connection name, record identifier, email address, or production value. A private deployment process must replace every `{{...}}` token without committing or logging rendered source. Authentication is supplied only by caller-specific Zoho Connections; the functions set only `Content-Type`. Neither caller retries automatically after an ambiguous response, and both log only coarse outcome names.

These are not deployable evidence. The Form 1 and Form 2 Connection header-injection contracts require harmless Development proof and exact readback. Form 2 also requires a verified trusted UUID-v4 minter and retry-stable argument binding; no such CRM button binding has been proven. Until those gates pass, leave the button associations and canonical issue routes disabled.

Terminal reports use an automatic, durable handoff without another function or worker mode. The existing `revenue_desk_call_worker` `retry_scan` reads a revision-specific `sync_report_summary` row from `CRMBillingOperations`, sends only its Deal ID and exact operation key to the existing `crm_billing_orchestrator` route using Catalyst `ZCFKEY` plus a distinct report-only credential, and waits for exact CRM and operation-row readback. A scan dispatches at most five report operations. A crashed `report_claim_*` pre-write owner can be safely version-fenced and replaced; after exact `report_write_started_*` readback, ambiguous or conflicting state never repeats the CRM write and converges only through exact Deal readback. Report completion and containment are compare-and-set transitions over the observed status, outcome, and version, so neither stale path can overwrite the other. After observing the operation cursor, every completion transition and completed replay revalidates the authoritative Deal account, deployment/configuration binding, and exact patch. Mismatch or unavailable readback CAS-keeps or demotes reconciliation, and a stale containment loser gets one fresh read plus at most one repair CAS when completion won but the conflict remains.

The summary write maps the authoritative report counts to `Test_Calls_Reaching_Route`, `Test_Qualified_Opportunities`, and `Test_Existing_Customer_Calls`. It does not infer `Test_New_Service_Inquiries`, because the current report has no separate metric with that exact semantic. The orchestrator never writes `Stage` or `Results_Review_At`. After exact summary readback, a human operator owns the valid **Complete Free Test** Blueprint transition and later Results Review timestamp; normal Deal update is not treated as a Blueprint transition.

The CRM organization is production-type, so acceptance work is restricted to clearly labeled synthetic records. The contract does not authorize Production traffic, real customer/prospect mutation, Zoho Sign, SMS, phone routing, Billing before paid acceptance, or automatic Closed Won.

Live configuration is authoritative only after independent readback. The immutable 2026-08-14 snapshot remains historical evidence and must not be edited to imply a later deployment.

## Local Verification

Run the package-owned contract tests from the repository root:

```powershell
python src/zoho-crm/free-revenue-leak-test/tests/test_contract.py
```

Passing tests prove only the checked-in JSON and sanitized Deluge-template contracts. Zoho CRM save/syntax validation, private rendering, Connection behavior, route execution, and synthetic readback remain separate Development gates.
