# Free-test preparation and operator walkthrough

Owner: Sylvara operator (Gabriel). Updated: 2026-09-15. Status: local preparation;
not a customer launch, provider change, or spending authorization.

## Current execution boundary

The current continuation is **local-only, with no Retell access**, including
read-only dashboard, API, MCP or SDK access. Older provider observations and the
future packet below are retained evidence, not current permission. Do not open a
provider page, save the prepared draft, test an agent, invoke a live webhook/queue,
or change a binding. Local synthetic adapters are the only execution path here.
The demo builder installs its deny guard before importing the harness; missing
dependencies or unexpected outbound access fail instead of falling back to a
provider. No populated environment file or real credential is an input.

Keep **Code Complete**, **Development Verified**, **Deployed**, and **Live Verified**
separate. Retained acceptance carries forward only for unchanged executable
behavior. A local demo is neither new CRM acceptance nor telephone evidence.
Preserve current holds and consumed allocations. Publication, deployment and
runtime admission still require their exact outstanding approvals.

## Safe local demonstration

From the repository root, using the installed pinned Node runtime:

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" src/zoho-catalyst/revenue-desk-release/scripts/build-free-test-demo.js
```

Open `.codex-tmp/free-test-demo/index.html` after the command succeeds. It is a
standalone local file, not a hosted service. No server, account, microphone,
credential, external font, email or provider connection is needed. The command
accepts no input files and fails rather than falling back to live services.

Walk through Request → Setup → Authorization → Capture → Alert → Results → Stop.
Within **Alert**, follow Capture → Alert → Business Follow-Up. The separate
memory-only rehearsal shows provider acceptance, exhausted definite rejection,
and an ambiguous send held for reconciliation. Each uses the existing worker,
outbox and mail adapter with a fake delivery boundary. Human acknowledgment and
completed callback remain unobserved: the demo does not invent a completed job.
Switch between the two fictional businesses to show isolation. Read an unknown
report value as **unknown**, not zero. The synthetic JSON beside the page retains
the derived report and reconciliation evidence. Do not upload private exports
into the demo or present its examples as customer results.

At **Stop**, inspect the separate early/operator-stop rehearsal. It reuses one
fictional setup in fresh memory without changing the two baseline expiry and
call-limit examples. The existing control service performs the revoke claim and
durable transition through fake storage/CRM/route adapters. A previously admitted
call can settle; a new admission is rejected; replay preserves the terminal
evidence. The derived report must still reconcile both independently admitted
calls and show the original stop time and `Sylvara Stopped` reason. This proves
backend containment, report reconciliation and replay behavior only, not actual
carrier restoration. The report JSON separates this rehearsal's simulated
effects from the baseline report scenario; neither is real activity.

The preparation history is illustrative. The connected backend harness executes
real repository logic with fake adapters and an explicitly simulated activation
state. It does not recreate the accepted live Lead/Form 1/conversion/Form 2 chain,
prove model extraction, or prove carrier forwarding and restoration.

Gabriel accepted the previous `570638f` demo as readable and working. That
acceptance remains valid for its unchanged sections; it does not cover the new
handoff panel. HTML safety, escaping and navigation are tested offline. The
desktop browser policy blocks agent-opened local-file visual inspection; this
does not authorize serving the same file through a workaround. The new panel's
visual acceptance remains separate from its passed executable assertions.

## First-client operating checklist

1. **Join the correct relationship.** A public Form 1 request has exactly one
   native CRM writer. An existing Lead uses CRM-assisted Form 1, whose sole writer
   is Catalyst. Preserve the exact original conversion lineage; do not create a
   second Lead or Deal to evade duplicates. A setup appointment is only a meeting:
   verify its CRM deduplication owner and next action before using it as an entry.
2. **Obtain setup and authority.** Use the accepted Form 2 access/verification
   path. Fresh-read the successful receipt, consumed proof, submitted session and
   exact Contact/Account/Deal. A hash or prefill snapshot is not submitted truth.
   Keep representative authority, scope acceptance, internal approval, activation
   and test-start evidence separate. Do not replay consumed QA allocations.
3. **Prepare the business rules.** Confirm one number and primary location,
   country/E.164 interpretation, current phone provider, exact original handling,
   weekly hours/timezone/DST/exceptions, services/territory/exclusions, urgency,
   existing-customer handling and truthful callback wording. Confirm the email
   recipient, forwarding administrator, fallback and rollback contact/procedure.
   The local preparation validator rejects stale or inconsistent input and length
   overflow; it neither authenticates an export nor grants deployment authority.
   A candidate normalized to E.164 does not silently change CRM: reconcile any
   reported phone-format differences before live approval. The current free-test
   runtime can express `Alert + Capture Callback` for urgent/existing callers;
   incompatible transfer/fallback or notification-suppression preferences remain
   blocked rather than being replaced with that policy.
4. **Review the phone-system capability.** Obtain provider documentation and
   owner access for the specific after-hours/no-answer behavior. For overflow or
   combined coverage, retain the submitted ring preference and obtain the actual
   provider value, explicit unit and evidence source. Never convert rings to
   seconds by assumption. These modes remain execution-blocked until a reviewed
   timing-binding implementation and evidence exist; their advertised scope is
   not deleted merely because after-hours is tested first.
5. **Pre-activation gate.** Bind immutable release/configuration, exact isolated
   number/agent/version, current resolver/event endpoints, complete machine
   readback and approved data-handling scope. Review the required fifteen
   conversation variables and fifteen supported analysis fields. Preserve missing
   values as unavailable. Require separate installation/configuration approval
   and the finite live-test allocation below. Do not enable the Full Blueprint or
   competing Form 2 workflows.
6. **Approve, then activate separately.** Internal approval does not start a
   clock or mark Live. Only successful independently verified activation may start
   the existing exact 604800000-ms interval. The implementation uses seven elapsed
   24-hour days across DST, not seven local-midnight boundaries. Do not reinterpret
   that accepted rule silently. Follow the existing
   [control-plane runbook](../revenue-desk-call-runtime/route-approval-control-plane-runbook.md).
7. **Operate and report.** Intake/classification and approved email alerts only.
   No booking, transfer, dispatch, SMS, payment or guaranteed callback. Reconcile
   durable receipt → canonical call → notification outbox → report-only CRM
   summary. Keep the `sync_report_summary` path in `crm_billing_orchestrator`;
   financial actions remain disabled. Review failed/unknown deliveries before
   retry; use existing bounded recovery, not new events to disguise ambiguity.
   **Late terminal evidence:** the local v3 candidate can revise an unreviewed
   Completed summary after a verified source-version advance, including an
   already-admitted 26th call or late analysis. It preserves the original terminal
   dates, status and receipts. A per-Deal guard serializes writes; ambiguous outcomes
   remain readback-only. Missing/reviewed/paid state, unrelated or regressed evidence
   stays contained. This is offline acceptance, not an installed runtime claim.
   Cutover requires the report-only consumer and shared producer at the intended
   revision, existing-table guard support and an independently verified stored
   `REPORT_MUTABLE_STAGE_VALUE`. Retained v1/v2 Completed summaries are not silently
   migrated. Do not reset a guard, reopen Live or overwrite reviewed results.
8. **Stop and restore.** Stop/revoke backend admission first for early/customer
   stop, expiry, call limit, wrong binding or ambiguity. Settle already-admitted
   calls and disclose in-flight overshoot. Preserve receipts and late revisions.
   Separately restore the exact recorded original carrier handling, independently
   read it back and perform the approved restoration test. Backend rejection alone
   is not proof the telephone returned to its original destination.
9. **Review results.** Explain opportunities, existing customers, wrong-fit/spam,
   urgent cases, failures, follow-up and unknown evidence. Duration comes from
   explicit provider duration, not guessed elapsed timestamps. Potential jobs are
   not appointments, invoices, confirmed revenue or recovered revenue. Paid
   conversion is a different, deferred scope.

## Deferred — Retell configuration proposal

Only after a later explicit change of scope may an operator compare fresh
secret-safe metadata to `free-test-provider-check.js`. This local check
uses all fifteen supported fields; the historical eleven-field snapshot is not
the completion contract. No raw provider export is accepted by the demo.

| Required result | Last verified observation | Unapplied next action |
| --- | --- | --- |
| Fifteen supported analysis definitions | Historical shared agent has eleven | Freshly verify, then propose adding `bookable_opportunity`/`office_follow_up_required` as booleans and `workflow_failure_code`/`workflow_failure_text` as bounded strings |
| Exact analysis value schema | Four canonical enum sets are checked locally; `caller_intent` remains bounded text in the backend | Compare provider choices against a separately reviewed private export contract; absent or malformed expected evidence remains unknown |
| Missing evidence remains unknown | Backend preserves null and failure-field presence | Never add false/zero defaults to fill absent analysis; no-failure needs explicit field-presence evidence |
| Canonical event binding | Historical event path differs | Bind an approved isolated draft to the exact current events endpoint, using private configuration only |
| Exact number/version/resolver/fallback binding | Prior UI disabled inbound/outbound; API projection incomplete | Obtain complete machine readback and isolated-number ownership; do not infer omitted fields as empty |
| Approved data-handling scope | Earlier UI retained content with PII exclusion for 30 days | Reconcile against the exact controlled-test scope before any voice; do not silently alter policy |
| Fifteen prompt-visible variables only | Prior projection matched | Freshly recheck names/types/defaults/gate; exclude contacts, credentials and signed ownership evidence |

The local comparator optionally takes a separate `reviewedCallerIntentContract`
argument with exactly `schemaVersion: 1`, `evidenceClass: reviewed_export_snapshot`,
a lowercase 64-character `sourceSha256`, and unique, nonempty `choices` of at most
160 characters each, without surrounding whitespace or control characters. Keep
the reviewed choices, export and hash-linked review record private; do not copy
them into the runtime contract. The comparator does not read an export or verify
the hash against a file: the hash identifies the source reviewed by the operator.
It never infers an expected set from the observed metadata. A match only compares
the supplied projection to that snapshot; it is not current provider readback,
model acceptance or permission to execute. Other binding and privacy gates remain.

These are proposals, not a deployable Retell payload or permission to edit a
published version. Keep private identifiers, endpoints, prompt text and secrets
out of Git. The current attempt to refresh full-agent metadata was rejected by
the tool safety reviewer; this is an unverified gate, not a successful read.

## Published-entry readback and remaining handoff

Read-only Bookings UI inspection on 2026-09-12 confirmed the intended organization
and an existing Connected CRM integration. Customer data maps to Lead; its rule
checks both Leads and Contacts for an existing match, updates a match, or creates
a Lead. The visible mappings are first/last name, Contact Email and Contact Phone;
appointments map to CRM Events. No Sync, Save, appointment, email or record action
was performed. This metadata is not proof of a successful deduplicated booking.

The service-specific match keys, notification recipients/content and exact
Journey next-action association have not all been read back. Optional public
scheduling acceptance remains deferred; it is not a prerequisite for the
mandatory public/assisted Form 1 → native conversion → Form 2 Journey. Keep the
assisted form's booking detour removed. Do not add another writer or automation
as a shortcut or silently represent the optional scheduling entry as verified.
The public free-test CTA resolves to the existing intake entry. Its short
"25 calls" wording should be clarified, under separate website publication
approval, to "25 unique connected calls or seven days, whichever comes first;
already-admitted calls may finish." Paid-plan pages remain outside this sprint.

## Finite future live-acceptance packet — NOT AUTHORIZED

Release target: the exact reviewed runtime delta recorded below, with its
retained immutable manifests; **not** an operator-utility commit relabeled as a
runtime deployment. The
private packet must name the exact existing isolated agent, number, configuration,
approved testers and owner-controlled destinations. Missing identity, complete
machine readback or cost confirmation blocks execution; it does not justify
buying a number or borrowing a customer route.

Prerequisites: preserve the closed source findings, independent review, verified
CRM artifact parity and spent pre-SDK binding proof. At a later authorized
admission, freshly read back the exact hold/nonsecret configuration and prove
runtime report outcomes in the controlled provider packet. Obtain fresh metadata
only under a later approved secret-safe path; approve any
isolated draft edits/publication/binding separately; confirm data handling and
tester participation; preserve original routing and verify the stop procedure.
Resolve the historical account-standing warning privately without inferring its
cause or authorizing payment. Public Form 1's retained Development replay exception
does not transfer automatically to a new release or customer traffic.

| Allocation | Maximum | Observable pass criteria |
| --- | --- | --- |
| Initial after-hours rehearsal | Six calls, three minutes each | Routine new request; existing customer; urgent/uncertain request; wrong-fit/spam; resolver rejection/fallback; early-stop/restoration. Check correct company/number, truthful close, exact structured output, recipient, durable report and safe original handling |
| Overflow and combined follow-up | Four calls, three minutes each | Only after timing-binding code/evidence exists: answered-first suppression and no-answer behavior for each mode; exact unit/value, correct trigger and safe fallback |
| Total ceiling | Ten calls / thirty connected minutes | No automatic retries, extras, simulations, previews, analysis reruns or customer traffic |

Historical public rates checked 2026-09-12: standard voice pricing was roughly
$0.07–$0.31/minute, plus the displayed $0.015/minute telephone rate where applicable.
Thirty minutes at that illustrative upper subtotal is $9.75. Add-ons, the actual
model/voice/country/carrier, existing rental, taxes and account terms may differ.
Proposed **all-in incremental ceiling: $15**, not authorized and not a quotation.
Before approval, establish every applicable component and demonstrate it fits
that ceiling. Unknown cost means stop; do not consume credits as a workaround.
See [Retell pricing](https://www.retellai.com/pricing) and
[testing charges](https://docs.retellai.com/test/testing-pricing).

Stop immediately for wrong business/number, unexpected tool or outbound action,
sensitive-data retention mismatch, delivery ambiguity, missing receipt, unsafe
fallback, unknown cost, or approaching either limit. Preserve evidence; contain
admission and restore original handling with fresh readback. A failed test does
not authorize another attempt. Separate approval remains mandatory before any
prospect/customer traffic, even if this internal packet later passes.

## Current release and rollback boundary

**2026-09-15 installed-state correction:** the private held-installation record
supersedes the older local-only early-stop paragraphs below. The existing gateway,
route control and worker received the reviewed `570638f` PR #88 packages under
containment. Independent pullback compared all 698 members (229/238/231), including
exact paths and uncompressed contents. Source-revision holds and disabled provider
mode remained in place; no functional invocation occurred. Therefore the
early-stop correction is **installed under hold, not Development-runtime verified**.
The later reporting-baseline and call-to-owner changes on
`codex/free-test-analytics-reporting` are local candidates, not those installed
packages. Do not relabel or redeploy unchanged Forms or the report-only consumer.

The private 2026-09-14 checkpoint supersedes the older coordinated-rebuild
proposal: five Journey-core artifacts at `7dd3491` and the report-only CRM
consumer at `8b7dd31` were installed and independently compared. All 1,145 core
manifest entries and 222 report-consumer entries matched. The report protocol
and guard semantics are unchanged across that delta. This is artifact evidence,
not successful live SDK, notification, report/CAS or telephone acceptance.

Form 1 has a consumed, bounded launcher-to-prefill acceptance allocation at its
installed revision. Form 2's prior functional acceptance carries forward: its
executable source is identical to the accepted version, and the retained artifact
comparison found only the generated revision stamp changed. Its intentional
admission hold is not grounds for another OTP or submission. Other runtime holds
remain in place, and the report consumer's one-shot pre-SDK binding check is spent.

The current early-stop regression exposed one additional shared-runtime defect:
the controller stores rollback reasons such as `operator_requested`, but the
report mapper recognized only ordinary test-end reasons. A valid stopped
deployment could therefore fail report generation. The local correction uses
the existing rollback-reason mapping as a fallback and still rejects unknown
values. It changes reporting behavior, not the report protocol, Form 1/Form 2,
the CRM consumer, or the approval/activation boundary. Previously accepted form
behavior and installed artifact parity remain valid; early-stop report acceptance
must be established for the corrected runtime before operational use.

Prepare the corrected shared runtime with the existing three-target builder
(gateway, route control, worker). Its source manifest is not a dependency-complete
upload package and is not the closed five-function Journey-core manifest. Keep
the source-only candidate separate from installed artifacts. A future exact delta
rollout must approve dependency-complete packaging and cross-revision compatibility
with the retained Form 1/Form 2 and report consumer. Do not relax the five-target
validator or change revision labels to imply a coordinated deployment.

Do not rebuild or redeploy unchanged functions merely because the local demo,
comparator or runbook changes. Local source commits do not move runtime
revision labels. Any future cutover must name the actual artifact digests,
compatible producer/consumer revisions, target holds, allowed invocation count,
readback and rollback. Restore containment on ambiguity; never restore exposed
credentials, consumed claims, retired controls or a known unsafe timing path.

### Historical alternatives — not current required work

This subsection is historical rationale only. None of its build/cutover steps
is current required work or authority; the verified delta above supersedes them.

The smallest offline package is the shared runtime's three-target candidate
(gateway, route control, worker), with exact source and full dependency hashes.
It is **not** a new five-function Journey-core release manifest. The closed
Journey-core manifest requires all five source stamps at one revision; never mix
old Form 1/Form 2 packages with this candidate and claim that parity. Their
unchanged owning builders create empty npm caches and run installation/tests;
no supported offline-cache flag exists. No builder is patched to bypass that gate.

Proposed later cutover: retain containment; approve the exact release profile and
packaging method; build all artifacts required by that profile; independently
verify them; install changed targets under the hold; verify nonsecret bindings;
reopen only under its own bounded acceptance allocation. Completed Form 2 evidence
retains its original revision. The report-only CRM path needs an explicit
supplemental free-test reporting packet because Journey-core preserves its route
as deferred. This does not authorize the seven-function commercial profile,
financial actions, Analytics, or a live worker invocation.

The proposed coordinated package is the existing five Journey-core targets at
one approved revision plus `crm_billing_orchestrator` at that revision: six
artifacts, not the seven-function commercial profile. The reporting supplement
must reference the exact Journey-core manifest digest and independently bind
the report artifact digest, operation-table/CAS evidence, permitted action,
configuration readback, and bounded acceptance allocation. It is a proposed
exception for `sync_report_summary` only, not a silent change to the currently
deferred `CRM_BILLING` route. If a later approval chooses a delta rollout instead,
its exact cross-revision compatibility must be established first; the current
five-function validator must not be relabeled or relaxed. Form 1/Form 2 rebuilds
in the coordinated option serve that immutable revision contract, not a claim
that their previously accepted business behavior was defective.

For that report-only supplement, explicitly keep
`ENABLE_PAID_SUBSCRIPTION_PREPARATION`,
`ENABLE_TEST_DIRECT_CUSTOMER_PROVISIONING`, and
`ENABLE_DEVELOPMENT_COMPATIBILITY_PROBE` false. The corrected consumer omits
financial configuration and constructs only its CRM and operation-store
dependencies for reports. Do not enable the TEST customer gate to satisfy an
older artifact's configuration loader. Its stable partition secret is still
required for report identity, not Analytics execution. Install and read back the
report consumer before admitting any new schema-v3 producer dispatch; stop at
any missing consumer proof, ambiguous artifact identity, or unsupported profile.

The local follow-up also changes report producer/consumer lineage and per-Deal
serialization. The demo now preserves three confirmed synthetic report receipts,
uses three simulated CRM writes for 32 calls, and shows post-completion late
analysis without re-opening a route. It does not change live Forms, CRM records,
secrets or provider state. The report-only path is tested, not financially
enabled. The existing accepted release remains installed. Current tests establish
source behavior only; affected runtime acceptance must be reassessed for the new
revision. Keep the current hold/disabled-provider posture through cutover.
Rollback must not restore exposed secrets, consumed claims, removed legacy
controls or the known unsafe timing path. Preserve the immutable prior artifacts
as evidence, not blanket authority to reactivate them.

## Call-to-owner handoff — fixed acceptance checklist

Owner: Gabriel for configuration/release; the approved business recipient's named
person for human follow-up. Scope: bounded capture → approved email → human
review/callback. No automatic transfer, booking, dispatch, outbound call, SMS,
guaranteed response or emergency-response promise. A preference requiring one of
those actions blocks activation; historical transfer templates grant no authority.

These **ten fixed gates** measure this handoff delta, not the entire Journey,
product, prospect launch or paid plans. Source Complete means implementation,
deterministic tests and independent review pass at the recorded candidate
revision. Development Verified requires matching installed artifacts plus the
specific scoped runtime/readback evidence; a merge, dry-run or OTP cannot pass it.
The private checkpoint records the exact revision and numerator/denominator.
Required unknowns remain unpassed. Do not substitute test/file counts for gates.

| Gate | Source acceptance / evidence | Development acceptance still needed |
| --- | --- | --- |
| H1 Recipient lineage | Form 2 `alertRecipientEmail` → controller `Alert_Recipient_Email` → immutable `notificationRecipient.email`; preparation and binding tests | Exact accepted receipt/CRM/configuration/recipient readback for chosen release |
| H2 Named monitored owner | `notificationRecipient.name` + typed `notificationHandoff`; preparation, new-approval/activation/admission regressions | Business acknowledgment, approved immutable configuration and negative gate check |
| H3 Action boundaries | `FREE_TEST_HANDLING_POLICY_UNSUPPORTED`; incompatible urgent/existing preferences rejected | Matching approved setup, no competing writer or enabled paid capability |
| H4 Actionable minimal alert | `analysis.js`, `catalyst-mail.js`, handoff unit tests: identity, confirmed callback or unknown, issue/location/urgency/type/person/timezone/next action | Exact rendered QA email through actual call-alert adapter, not OTP |
| H5 Late/missing analysis | Runtime awaiting-analysis, late terminal, cap/expiry/stop settlement regressions | Durable pending evidence then one scoped analyzed-event settlement |
| H6 Durable one-effect identity | Versioned new-call payload; original legacy key/payload preserved; exact replay and race regressions | Outbox/call agreement across scoped replay, no second mail effect |
| H7 Bounded recovery | Definite pre-send rejection retries bounded; ambiguous/legacy unsent state held; no blind resend | Authorized safe failure/reconciliation evidence and operator recovery ownership |
| H8 Isolation/authentication | Two-business fixtures, signed ownership, invalid authentication and wrong-recipient tests | Exact isolated QA target and sender/recipient bindings |
| H9 Honest reporting | Canonical call/outbox reconciliation; missing analysis unknown; demo separates acceptance/inbox/acknowledgment/callback | Runtime report and CRM summary match durable evidence; mailbox evidence separate |
| H10 Operator handoff/demo/release | Existing demo extended with failure, caller-close draft and finite packet below | New-panel visual review, runtime operator checklist and approved rollback readback |

### Configuration and data lineage

Reuse `notificationRecipient` in the immutable configuration; no new CRM field,
outbox, scheduler, integration or transactional writer. Form 2's recipient entry
alone does not prove monitoring. Optional `notificationHandoff` records
`schemaVersion: 1`, IANA `timeZone`, `channel: email`, matching `recipientId`,
`monitored`, canonical `acknowledgedAt`, and an opaque `acknowledgmentReference`.
The existing configuration approval binds these bytes along with the recipient.
The reference is not authentication or inbox-delivery proof. Local preparation
copies only supplied review evidence and never approves its own output.

New approval and activation also re-read the existing CRM
`Urgent_Call_Handling` and `Existing_Customer_Call_Handling` fields. Both must be
exactly `Alert + Capture Callback`; missing or incompatible preferences block the
new decision, and subsequent CRM snapshot checks reject preference drift. Exact
historical replay and safe rollback do not require rewriting those preferences.

New approval, activation and unproven new admission require a named approved
email recipient and a nonfuture monitoring acknowledgment. Optional structural
parsing preserves old immutable configurations for replay, rollback and settlement
of already-admitted calls. Installing new code does not authorize filling this
envelope or creating/promoting an immutable configuration; the pending
configuration-review/promotion contract remains a separate gate.

Authenticated event → canonical minimized call → durable notification outbox →
existing Catalyst Mail adapter → report/CRM summary is the single processing
path. Recipient and business/owner/timezone come from server configuration, not
caller/model instructions. An absent optional `callback_number_confirmed` field
means unknown; a syntactically valid number or caller ID is not confirmation.
The source accepts explicit boolean confirmation but the provider field and its
extraction behavior are **unapplied and unverified**, requiring later approval.
No number is sent as a confirmed callback until that evidence exists.
The offline metadata comparator still requires the original fifteen fields and
accepts this additional boolean definition when present; it reports missing
confirmation as callback-unknown, never as successful live extraction.

New canonical calls select `free_test_call_summary_v2`; historical calls retain
their original template/key/payload. Existing terminal sends replay unchanged.
Unsent legacy v1 alerts move to `ReconciliationRequired` before any new provider
attempt, rather than changing their payload or issuing a second key. Operators
must review that evidence; do not reset claims or recreate calls to bypass it.

`call_ended` without analysis remains visibly awaiting analysis. It is not a
successful alert or a zero-opportunity result. `call_analyzed` may settle later,
including after admission stops. All connected analyzed outcomes remain visible;
uncertain/incomplete requests are not suppressed as spam. Sensitive content is
withheld. No recording or full transcript is included. Mail status meanings:

| Durable status | What it proves / next action |
| --- | --- |
| `DryRunRecorded` | Local recording only; nothing sent |
| `Sent` | Provider accepted the request; not inbox delivery, human acknowledgment or callback |
| `RetryRequired` | Definite retry-safe failure; existing bounded retry only |
| `Ambiguous` / `ReconciliationRequired` | Outcome needs authoritative reconciliation; no blind resend |
| `TerminalFailure` | Automatic attempts ended; operator must investigate, with business follow-up still unresolved |

Existing worker status, outbox state/error/attempt count and reconciled report are
the failure signals. The operator reviews pending analysis and nonterminal/failed
alerts, reconciles ambiguous outcomes through an approved mailbox evidence path,
and coordinates with the named business owner. No new watchdog is installed.
`PROVIDER_RESULT_REFERENCE` is a hashed acceptance-shape reference, not a unique
mail message ID or delivery receipt; it cannot establish inbox delivery by itself.
If the channel cannot be monitored or delivery is unresolved, contain new
admission; preserve and settle admitted requests through approved recovery.

### Caller closing — source draft, NOT applied or approved for publication

Original operational wording for later business/provider review:

> “This is a callback request, not an appointment. The team will need to review
> it and decide the next step. I can't confirm when someone will respond.”

If no number was confirmed, add: “I don't have a confirmed callback number, so I
can't confirm that the team can reach you.” Do not claim the alert was delivered
while the conversation is still running, promise a callback time, or imply a
booking, dispatch or emergency response. This draft does not override approved
notice/safety wording. The existing published agent is untouched.

### Smallest later mail/inbox packet — prepared only, NOT AUTHORIZED

1. Review and merge the exact source candidate; prepare dependency-complete
   gateway/control/worker artifacts, retain hashes and compatibility evidence with
   unchanged accepted Forms/report consumer. Approve a held Development delta
   installation separately. Restore the existing hold on any mismatch.
2. Privately bind one approved synthetic configuration and its exact owner-controlled
   mailbox, verified sender and named monitor; approve the missing configuration
   review/promotion operation before any record is created. Verify allowance and
   incremental cost for the precise invocation chain. Unknown cost stops execution.
3. Allocate **one call-alert email maximum**, zero Retell calls/sessions/inference,
   zero SMS and zero customer mail. Use the supported authenticated synthetic
   event/worker path with exact isolated identity and a fresh allocation. This is
   injected mail-path acceptance, not live voice or complete Journey acceptance.
   The exact method/target must be verified in the private packet before approval.
4. Read back one receipt, canonical call, outbox, matching report and CRM summary
   only within that allocation. One exact replay may prove no second intended mail;
   no replacement send is authorized. Gabriel privately verifies inbox arrival,
   correct content/recipient and timestamps without sharing caller data or secrets.
   Inbox arrival, human acknowledgment and a completed callback stay separate facts.
5. Keep failure/timeout/concurrency tests offline. If the live result is ambiguous,
   reconcile first and stop; do not retry, replace the call or clear evidence.
   Restore dry-run/containment with readback under the same approved packet.

Zero-charge local development adds no service or recurring cost. The future
transport check needs confirmed non-charging allowance, exact approval and an
owner inbox handoff. Prospect launch still requires provider timing binding for
overflow/combined, actual voice/telephony/fallback/restore acceptance, complete
reporting/configuration wiring and customer-specific approval. It is not accurate
to say that only Retell testing remains.
