# Free-test preparation and operator walkthrough

Owner: Sylvara operator (Gabriel). Updated: 2026-09-12. Status: local preparation;
not a customer launch, provider change, or spending authorization.

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
Switch between the two fictional businesses to show isolation. Read an unknown
report value as **unknown**, not zero. The synthetic JSON beside the page retains
the derived report and reconciliation evidence. Do not upload private exports
into the demo or present its examples as customer results.

The preparation history is illustrative. The connected backend harness executes
real repository logic with fake adapters and an explicitly simulated activation
state. It does not recreate the accepted live Lead/Form 1/conversion/Form 2 chain,
prove model extraction, or prove carrier forwarding and restoration.

The desktop browser policy blocked opening this local file during verification.
HTML safety, escaping and all seven navigation states are tested offline, but
actual iPad/mobile visual acceptance is pending an owner-opened local preview.
This limitation does not authorize serving the same file through a workaround.

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

## Unapplied provider correction proposal

Compare fresh secret-safe metadata to `free-test-provider-check.js`. This check
uses all fifteen supported fields; the historical eleven-field snapshot is not
the completion contract. No raw provider export is accepted by the demo.

| Required result | Last verified observation | Unapplied next action |
| --- | --- | --- |
| Fifteen supported analysis definitions | Historical shared agent has eleven | Freshly verify, then propose adding `bookable_opportunity`/`office_follow_up_required` as booleans and `workflow_failure_code`/`workflow_failure_text` as bounded strings |
| Exact analysis value schema | Four canonical enum sets are checked locally; `caller_intent` is bounded text in the backend, but historically an enum in the provider | Resolve the provider's exact caller-intent value contract without inventing choices; unknown stays unverified |
| Missing evidence remains unknown | Backend preserves null and failure-field presence | Never add false/zero defaults to fill absent analysis; no-failure needs explicit field-presence evidence |
| Canonical event binding | Historical event path differs | Bind an approved isolated draft to the exact current events endpoint, using private configuration only |
| Exact number/version/resolver/fallback binding | Prior UI disabled inbound/outbound; API projection incomplete | Obtain complete machine readback and isolated-number ownership; do not infer omitted fields as empty |
| Approved data-handling scope | Earlier UI retained content with PII exclusion for 30 days | Reconcile against the exact controlled-test scope before any voice; do not silently alter policy |
| Fifteen prompt-visible variables only | Prior projection matched | Freshly recheck names/types/defaults/gate; exclude contacts, credentials and signed ownership evidence |

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
Journey next-action association have not all been read back. Keep that entry
gate pending; do not add another writer or a new automation as a shortcut.
The public free-test CTA resolves to the existing intake entry. Its short
"25 calls" wording should be clarified, under separate website publication
approval, to "25 unique connected calls or seven days, whichever comes first;
already-admitted calls may finish." Paid-plan pages remain outside this sprint.

## Finite future live-acceptance packet — NOT AUTHORIZED

Release target: the exact reviewed successor to the PR #84 candidate, with its
new immutable manifest; **not** the unchanged accepted Journey-core label. The
private packet must name the exact existing isolated agent, number, configuration,
approved testers and owner-controlled destinations. Missing identity, complete
machine readback or cost confirmation blocks execution; it does not justify
buying a number or borrowing a customer route.

Prerequisites: close both source findings and independent review; install/read
back only the specifically approved artifacts; reconcile report-only CRM runtime
parity; obtain fresh metadata through an approved secret-safe path; approve any
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

Current public rates checked 2026-09-12: standard voice pricing is roughly
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

## Change and rollback boundary

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
