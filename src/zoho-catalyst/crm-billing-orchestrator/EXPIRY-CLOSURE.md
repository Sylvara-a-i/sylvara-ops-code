# Private expiry-only CRM synchronization

This is disabled source preparation, not an installable native operation. It has no public action, route, environment toggle, migration, or new credential. The fixed private composition and its evidence bindings remain to be qualified. `config/expiry-closure-contract.json` records these gates; changing its `enabled` field alone cannot invoke anything.

## Scope and reporting

The operation projects an already authenticated, expired seven-day deployment into exactly three CRM Deal fields: `Test_Status = Completed`, `Test_End_At = original expiry`, and `Test_End_Reason = Seven-Day Limit Reached`. CRM datetime precision is seconds; the immutable evidence retains the original start and expiry including milliseconds.

`Stage` stays unchanged. The private `policy.expectedStageApiValue` must be the exact value returned by the CRM record API, corroborated by the bound picklist/layout metadata, and must equal `config.reportMutableStageValue`. Display labels such as `Test Live` are not API-value authority and must not be substituted or normalized into the guard. The disabled contract leaves this binding null until actual native evidence establishes it. This is a pipeline awaiting results review, not proof that telephone answering remains active. QA approval, report metrics, confidence notes, unresolved admissions, analyzed-event failure history, configuration pointers, counters, trial clocks, billing fields and paid acceptance remain unchanged. No report is settled or delivered. No number is released and no new window is created.

The existing manual `Complete Free Test` transition is not invoked. Native enrollment, field locks and update permissions must permit the three-field conditional update. An inactive Blueprint and `RECORD_NOT_IN_PROCESS` are not proof of a valid future transition, but a Blueprint transition is not used by either this closure or the existing authenticated summary writer. If the manual transition is unavailable, retain an explicit Results Review stage hold; do not activate a Blueprint, force Stage, or treat the record update as completion of that manual process. Unknown current field locks or automation behavior still block closure.

`reportCompatibilityQualified` and its evidence hash attest only the existing authenticated `sync_report_summary` -> `syncVersionedReport` -> `updateDealReportSummary` path, with the fixed closure-proof reader enabled and the configured mutable Stage equal to the verified private Stage API binding. They do not attest a manual Blueprint transition. This writer projects report fields directly and never writes `Stage` or `Results_Review_At`. Its first version-three report from a closed state still requires a separately validated summary, existing protected-state/report guards and both authenticated closure records. The private flag and exact binding are revalidated before report effects. Closure proof alone cannot produce a report, waive source validation, assert total reconciliation, or freeze later legitimate report source versions. Manual Results Review remains held until an independently valid transition and human action exist.

## One-use composition

`createExpiryClosure().run()` accepts no caller arguments. A reviewed private artifact supplies fixed scope, authority reference, source revision and evidence hashes. Use the orchestrator's existing server-held analytics partition secret with a distinct HMAC domain; do not copy a signing secret into another function. The default public runtime does not enable this service or the report compatibility exception.

The private `readRetiredDeployment` adapter must authenticate the retired deployment and immutable configuration/lineage privately, check the fixed Deal, Account, Contact and Journey binding (including Contact-to-Account ownership), and return only the reviewed deployment projection. A raw row hash or caller-supplied role is insufficient. The operation checks exact fresh Deal/Account projections and synthetic name scope on all three context reads. Approved and current deployment pointers must match.

Sequence:

1. Verify all native metadata, transport and paired report compatibility evidence. Read and authenticate the fixed retired deployment and exact CRM context.
2. Insert one unique immutable attempt in the existing operation table, then read it back. The attempt consumes the allowance; any duplicate or uncertain acknowledgement stops before CRM. It remains `processing` as historical attempt evidence, not a resumable task.
3. Re-read the deployment and Deal/Account. Any drift stops. Dispatch at most one CRM PUT with `If-Unmodified-Since`, `trigger: []` and cadence suppression.
4. Read the Deal/Account once after the PUT, including an uncertain PUT acknowledgement. Require the exact three-field change and all preserved fields unchanged; re-read the deployment unchanged.
5. Append one separate authenticated completed outcome and read it back. No attempt update, reset, deletion or automatic retry exists. An outcome failure leaves the exact effects for read-only operator reconciliation; it must not trigger a second PUT.

Successful service bounds are six CRM GETs, one CRM PUT, two operation-table insert calls, four exact operation-row reads with the provided store (insert readbacks plus service authentication), and three private deployment-adapter invocations. Actual SDK/network dispatch and each private adapter's internal read budget require a separately reviewed native composition. Organization/metadata qualification is a prior read-only gate, not hidden in these bounds.

## Required native gates

- Current CRM organization, existing read/write identities, exact Deal/Account/Contact/Journey ownership and expected synthetic scope; no credential values in evidence.
- Effective layout/profile updateability and exact API values for the three fields; current Blueprint enrollment and field restrictions, approval/review locks and automation suppression behavior. No Blueprint or workflow edits are included. Unavailable manual Results Review is a separate explicit hold, not a reason to invent a transition or to bypass current update restrictions.
- Complete current `CRMBillingOperations` metadata: every mandatory column/default, unique operation key, types/lengths of all twelve fields below, and existing application access. Synthetic builders do not prove live insertion compatibility. No new columns or relaxed constraints are proposed.
- A qualified private no-retry transport which settles all dispatched SDK operations before returning. The ordinary SDK store explicitly reports `expiryClosureTransportQualified: false`; its insert helper alone is not such proof. SDK socket retries and timeout races must not be mistaken for a one-dispatch guarantee. No global retry configuration mutation is included.
- Exact authenticated retired reader and paired report-compatibility artifact bindings for the direct summary projection, including the actual deployed reader and its fixed configuration. A valid summary remains a later prerequisite; none is fabricated by this gate. Read back the current orchestrator archive and relevant nonsecret configuration before proposing an installation or rollback baseline; none is assumed by this source package.

The twelve inserted fields are `OPERATION_KEY`, `OPERATION_FINGERPRINT`, `ACTION`, `CRM_DEAL_ID`, `STATUS`, `LAST_OUTCOME`, `SOURCE_REVISION`, `SOURCE_ENVIRONMENT`, `OPERATION_PAYLOAD_JSON`, `OPERATION_VERSION`, `CREATED_AT`, and `UPDATED_AT`. Key/fingerprint values are 64 hex characters; action is `record_test_expiry`; the two outcomes are `expiry_only_attempt_consumed` and `expiry_only_crm_readback_confirmed`. The private payload is bounded to 9,000 UTF-8 bytes and requires the existing protected/encrypted storage contract. The public source and fixtures contain no real target IDs.

## Installation and containment order

First qualify native contracts read-only and capture the current orchestrator baseline. Then review the fixed private composition, finite output, exact operation-row shape and transport budget. Install the compatible report reader with its fixed binding before any closure execution, while keeping public paid/direct routes unchanged and closure invocation disabled. Only a specifically scoped operator execution gate may enable the private one-use invocation. No such wrapper or gate is delivered here.

Before any possible effect, exact archive restoration is sufficient containment. After an attempt insert or CRM PUT may have occurred, preserve both evidence and compatible report support, stop, and reconcile exact operation keys and Deal fields read-only. Never restore `Live`, clear the claim, alter the original expiry, or replay automatically. A later code rollback must retain the closure-proof reader whenever a completed closure outcome exists; reverting to a reader that rejects all closed first-report states would strand legitimate reporting.

## Offline verification

Focused tests cover exact field allowlisting, conditional one-attempt HTTP transport, fresh synthetic and ownership guards, immutable unique attempts and concurrent contenders, lost acknowledgements, drift/partial failure, failed transport qualification, proof tampering and the actual first versioned-report flow after authenticated closure. They do not qualify native CRM Blueprint behavior, operation-table schema/uniqueness, SDK dispatch semantics, or live private lineage.
