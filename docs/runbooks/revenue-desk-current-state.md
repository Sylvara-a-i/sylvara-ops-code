# Revenue Desk Current Delivery State

- Reviewed: **2026-11-24** (earlier dated evidence retained)
- Scope: sanitized repository decisions, completed source work, and remaining qualification
- Overall classification: **v0.5 completion and live acceptance remain open**
- This record grants no deployment, activation, spending, charging, customer-delivery, or launch authority.

Use this record for the current delivery checkpoint. The [release contract](../product/free-revenue-leak-test-release-contract.md) defines required target behavior, not installed state. Dated deployment records remain evidence only for their recorded revision, environment, observation, and limits. A source merge, offline test, or green CI run does not prove native deployment or acceptance.

## November 24 Qualification Checkpoint

| Area | Verified | Still held |
| --- | --- | --- |
| v0.5 Foundation | One storage-only Development run verified a scoped synthetic insert and independent complete readback; previously observed test rows were preserved. Earlier single-winner contention evidence remains valid within its observed scope. | The product closure path, real operation-ledger durability, CRM mutation, and ambiguous-effect recovery have not qualified. Do not repeat the synthetic run as a substitute. |
| v0.5 assisted setup | The existing Form 2 build was independently matched to its Development installation and remains inactive. | Effective provider authentication, saved field behavior and sender/route isolation still need qualification before assisted acceptance. |
| v0.5 voice and reporting | Retained internal call evidence was matched to the canonical projection. The CRM timestamp/report change passed its component suite; canonical repository verification on the composed change is pending. Historical PDF readback and verification of returned bytes have offline evidence only. | Native PDF version readback and CRM/Analytics reporting parity remain open. No customer delivery or additional call is implied. |
| v1 Calendar | Offline reconciliation is merged on main. | Live Family and iCloud visibility, supported collector coverage, and Bookings behavior remain unqualified. |
| v1 Billing | Noncharging usage preview is merged on main. | Exact provider lookup, TEST qualification and commercial approvals remain open; no usage posting, invoices, collection, or customer notification is authorized. |

Nothing in this checkpoint authorizes enablement, delivery or launch.

## November 23 Foundation Evidence

- **Live serial SQL check passed in Development.** On a dedicated synthetic-only Data Store table, the first claim succeeded, a distinct attempt for the same required UNIQUE key returned a key-specific duplicate error, and a separate terminal read found the original row unchanged.
- **Live two-writer connector check produced one winner.** Two distinct calls were outstanding at the connector caller before either completed. Catalyst accepted one claim and returned a key-specific duplicate error for the other. A separate terminal read confirmed one unchanged winner for the new key and an unchanged original serial test row.
- **The logged connector executions did not overlap.** A separate vendor activity-log readback showed non-overlapping intervals for these two tool executions, even though both calls were outstanding at the caller. It does not provide direct API wire timing or establish why they ran apart. Do not promote this result to native contention, ambiguous-effect recovery, production authority, or customer acceptance. The direct test below provided the missing client-side timing evidence without repeating the connector path.
- **Direct Development SQL contention check passed.** Two distinct requests for the same synthetic UNIQUE key started about 2.3 ms apart; both had started before either response began. One returned HTTP 200 and one returned a key-specific HTTP 409. An independent readback matched the stored winner and confirmed the baseline row was unchanged. No retry. This proves one winner under client-observed request overlap, not simultaneous execution inside the database.
- **Closure target metadata matched.** The existing Development operations table matched all 12 application columns in the source contract on name, type, required/unique flags, and defined lengths. This includes the mandatory unique operation key and the encrypted payload column. This was metadata only, not validation of the runtime identity or permission to write. The closure candidate on main is disabled and designed for a fixed private caller; there is no public closure caller to enable.
- **Private closure verification passed 12 offline tests.** The fixtures showed one winner, no CRM write after an unclassified claim or failed readback, and no second CRM write after a lost effect acknowledgement. The restart tests exposed a separate gap: with an unsettled first claim and no visible row, another process could dispatch again despite the unique key still ruling out two winners. A private one-use guard passed the follow-up tests with a simulated admission ledger: it rejected competing/restarted attempts and kept recovery read-only. The guard and fixtures are not deployed; the simulated ledger is not production durability evidence.
- **Next decision:** Qualify one storage-only attempt and readback using the existing synthetic Development SQL table and a fresh slot, preserving the retained rows and excluding CRM, Forms, calls, messages, and product activation. Verify the exact principal, isolation, one-dispatch transport, request budget, and independent restart evidence first. Do not add an unreviewed grant-row type to the existing shared operations table. NoSQL, the private runtime binding, actual unknown-outcome recovery, release acceptance, and customer effects remain separate and unqualified.

## November 23 Parallel Work Checkpoint

- **Form 2:** Private configuration review completed. Preserve the current alias, prefill expression, mapping sets, and caller destinations unless supported readback proves a mismatch. The pinned handler confirms the expected payload field, not what the provider's saved expression resolves to. Confirm the field association, compatible reversible handle settings, sender readiness, route enforcement, and no-contact isolation before applying any correction. Encryption remains a separate irreversible decision. Form 2 remains inactive.
- **Voice and reporting:** Private retained-evidence audit tied the historical transcript to its canonical call. Source-lineage and settlement gaps still block terminal report acceptance. Qualify native PDF versions and CRM/Analytics readbacks on retained calls if eligible before buying another call.
- **Calendar:** The offline availability reconciler is recorded in [PR #226](https://github.com/Sylvara-a-i/sylvara-ops-code/pull/226). All 131 focused tests passed, and the exact PR head passed repository Quick verification, Security Checks, and CodeQL. Native Family/iCloud visibility, collector permissions, and freshness through Google and Bookings remain unqualified. No live integration was enabled.
- **Billing:** Synthetic, noncharging usage preview completed in [PR #225](https://github.com/Sylvara-a-i/sylvara-ops-code/pull/225). Commercial approval and billing authority remain held; there is no posting capability.

## November 22 Qualification Update (Historical)

The first priority remains the shared v0.5 foundation and the assisted trial workflow. Keep the existing Development project and reviewed containment as the operating boundary; do not create parallel delivery infrastructure to make a qualification result easier to obtain. Calendar and noncharging Billing preparation may advance independently. The remainder of this runbook preserves earlier dated source and acceptance context; the newer dated evidence above controls where the status differs.

| Area | Verified or decided | Still open |
| --- | --- | --- |
| Foundation artifact | The existing held Development export matched the retained reference byte for byte and passed complete member verification. This was artifact readback only. | A new candidate still needs independent install/readback evidence if the selected test requires a function update. A connector inspection or a post-pull working tree does not replace complete exported-package evidence. |
| Native claim | Use the existing synthetic Development table. NoSQL is the candidate for this specific test, not an adopted production replacement. The serial runner and separate contention evidence checks passed offline. | The provider serial and concurrent runs have not occurred. Short-lived authorization, cost review, first real response classification, and independent persisted state still need to qualify. |
| Assisted Form 2 | The prepared function package and independent inventory checks can be reused. Native saved-configuration reads narrowed the work to field behavior, sender/route contract, and isolation checks. | Retain the existing hold. Saved mapping and wiring do not establish effective authentication, actual webhook behavior, or safe activation. |
| Voice and reporting | Retained internal-call evidence now ties one historical call to its exact canonical projection and interim private HTML. This closes that historical correlation gap without repeating the call. Offline capture-ordering and composition-inventory checks passed. | Current gateway composition, exact deployment and assignment, final PDF version/readback, Analytics settlement, and delivery remain unverified. The HTML is not the final PDF. |
| Calendar | Apple remains the operator interface and Bookings remains the confirmed-appointment authority. Retained native evidence supports Bookings-originated export, not reverse appointment mutation or all-calendar conflict coverage. | Qualify the remaining strict-blocking sources and notification ownership. A private attendee-free control event is a candidate, not a selected or deployed integration. |
| Billing | A read-only metadata check independently confirmed the selected organization is in TEST mode. Existing preview work remains noncharging. | TEST does not establish Usage Billing entitlement or notification isolation. Verify the feature and exact API contract before any authorized synthetic posting. No invoicing or collection is admitted. |

### Qualification Decisions

- **Native ownership:** Begin with a serial conditional claim, a duplicate attempt, and a consistent readback. An unrecognized response is inconclusive, not a rejection or proof of absence. Only then test two distinct, observably overlapping attempts for the same new synthetic key. Require one attributable success, one definitive rejection, and independent readback of exactly the stored winner. Write intent is recorded before dispatch; an unknown write outcome does not trigger a retry. A local simulation, a serial result, or one remaining row alone does not prove atomicity. The database proof does not qualify the deployed workflow.
- **Form configuration:** Coordinate the work as one decision package without treating changes as atomic. Reversible field settings, irreversible field encryption, sender configuration, route enforcement, and internal acceptance have separate preconditions and recovery boundaries. Reuse reviewed bytes; resolve the demonstrated configuration and isolation questions before any live change.
- **Transcript and report:** The authenticated gateway is the composition boundary for private capture before event minimization and queue admission. Keep raw transcript content out of downstream jobs, receipts, and Analytics. An exact replay may resume pending work but must not dispatch a second effect. Qualification must cover missing or interrupted capture and a lost acknowledgment. Reuse the existing reporting implementation and verify the authorized final artifact and settled receivers rather than paying to repeat historical evidence.
- **Booking lifecycle:** Distinguish availability blocks from host intent. Preserve original calendar events; an ordinary Busy change must not mutate a booking or send a notice. A host move proposes a replacement without changing the confirmed booking until acceptance. Keep guest invitations separate from any private host-controlled event. If the workflow cannot establish one notification owner, use native Bookings for host appointment actions.
- **Commercial and release controls:** Keep billing preview, usage submission, invoice creation, collection, and communication as separate effects. Document uncertainty and independently reconcile receiver state before retrying. Existing permissions, historic receipts, source merges, and this checkpoint grant no new native access, spending, deployment, customer effects, or launch authority.

## Completed Repository Work

The following changes are merged. Their completion is source-level only unless a separate, scoped native acceptance record proves more.

| Work | Repository evidence | What remains outside that evidence |
| --- | --- | --- |
| Disabled expiry closure and authenticated report continuity | [PR #208](https://github.com/Sylvara-a-i/sylvara-ops-code/pull/208) | Native closure deployment, activation, persistence, caller qualification, and report delivery |
| Offline all-calendar conflict comparison | [PR #209](https://github.com/Sylvara-a-i/sylvara-ops-code/pull/209), [owning contract](../../src/zoho-bookings/calendar-conflicts/README.md) | Authenticated source collection, ongoing synchronization, live availability, and booking writes |
| Versioned commercial terms and noncharging usage previews | [PR #210](https://github.com/Sylvara-a-i/sylvara-ops-code/pull/210), [v2 preparation](../../src/zoho-catalyst/crm-billing-orchestrator/tools/commercial-terms-v2.md) | Accepted customer terms, operational metering, durable submission, subscriptions, invoices, and charges |
| Historical commercial-term clarification | [PR #211](https://github.com/Sylvara-a-i/sylvara-ops-code/pull/211), [commercial boundary](../product/README.md#commercial-reconciliation-boundary) | Approval to quote or publish replacement terms |
| Concurrency regression coverage and sanitized diagnostics | [PR #212](https://github.com/Sylvara-a-i/sylvara-ops-code/pull/212) | A proven root-cause fix for the historical intermittent assertion |

At the reconciliation checkpoint, main revision `644e26a13f88553284108e8fefe96f2665c3616e` passed [Repo Checks](https://github.com/Sylvara-a-i/sylvara-ops-code/actions/runs/42857280418), [Security Checks](https://github.com/Sylvara-a-i/sylvara-ops-code/actions/runs/42857280070), and [CodeQL](https://github.com/Sylvara-a-i/sylvara-ops-code/actions/runs/42857281299). These links are dated verification evidence, not a promise about a later commit.

The recent failed-check notifications were traced to historical runs. The latest fixture failure was corrected before #208 merged. Five older ledger-concurrency failures were identified; four passed unchanged on retry. A hosted investigation passed 200 fresh ten-worker races, and #212 retained ten independent trials with strict one-winner/nine-replay assertions. The intermittent cause was not reproduced or proven eliminated. Production safety guards were not weakened.

## v0.5 Closure And Forms

Closure remains **disabled and unqualified for live use**. The report-owner binding guard is a separate prerequisite: a merged closure path does not admit report delivery. Native persistence and concurrency, fixed caller/access boundaries, retirement of superseded writers, and settlement of ambiguous external effects still require qualification.

The required Forms source inputs are available privately. Missing source upload is no longer the blocker. Private Forms preparation has passed source-level review; native qualification and cutover remain open. That source-level result is not a delivered or deployed capability, and its implementation is not published here. Complete native qualification before any cutover. Keep existing containment until exact source/configuration parity, independent readback, failure handling, and rollback or containment are established for the authorized target.

No v0.5 deployment, launch, or customer delivery is established by this checkpoint. Historical environment descriptions in the [August E2E reconciliation](free-revenue-leak-test-e2e-reconciliation-2026-08-24.md) must not be read as a fresh inventory or current acceptance result.

## Retell And End-to-End Acceptance

The callback-template and city/ZIP foundation remains unassigned/disabled and has
not passed end-to-end acceptance. Coverage must follow contractor-approved service
areas, with clarification for uncertain locations; it is not a comprehensive
geocoder or permission to dispatch. Existing-trial CRM reconciliation and safe
reuse of already available resources remain open. Preserve original expiry and
history rather than resetting them to manufacture a new trial or completion.

Full acceptance must bring together controlled call evidence under the approved
data-handling policy, exactly-once handled-call accounting, owner/internal views,
notifications, and settled final reporting. Source tests for individual parts do
not prove that combined outcome. No new transcript retention or real-call scope
is approved here.

## Native Concurrency Qualification

Provider-support guidance reviewed on 2026-11-10 states that conditional ZCQL updates are not guaranteed atomic under concurrent requests. A predicate, affected-row count, or read-then-update sequence is not proof of compare-and-set or an exclusive claim. Existing native qualification holds remain required.

Provider NoSQL conditional operations are the qualification candidate described in the November 22 update, not a selected or deployed production replacement. Qualify the exact contract, concurrent winner/loser behavior, retry and ambiguous-outcome semantics, persistence, access controls, limits, and cost before choosing an operational route. Do not weaken a safety guard or assume free capacity to make a test pass. Spending remains separately authorized.

The [Catalyst standard](../zoho/standards/catalyst.md#native-atomicity-qualification) owns the reusable concurrency requirement. This checkpoint publishes no private topology, security analysis, or native artifact.

## Calendar Decisions And Acceptance Gates

### Required behavior

- Keep Apple Calendar available as the primary operator client. An app displaying several accounts is not proof of provider-to-provider synchronization or Bookings conflict coverage.
- Cover every designated source calendar, including shared, subscribed, and otherwise hidden sources. Designated strict-blocking sources must block appointments even when a source event is marked Free.
- Prefer native integration when it meets the complete requirement. Add custom behavior only for a verified gap; no calendar bridge or storage migration has been selected by this record.
- Qualify both directions independently: appointment creation, movement, and cancellation must reach the operator's calendar; relevant operator changes must produce the correct authoritative booking state and prospect communication.
- A host-initiated move or cancellation must send a neutral host-side apology and ask the prospect to choose or accept a replacement time. It must not silently confirm a new appointment or describe the change as customer-initiated. Do not disclose the private conflict reason.
- Treat the original appointment, pending change request, and newly accepted appointment as distinct states. Define availability while acceptance is pending, cancellation behavior, timeout handling, and duplicate-notification prevention before enabling the flow.
- Validate sender identity, time zones, rendered template fields, recurrence exceptions, all-day/DST behavior, buffers, deletion, freshness, revocation, and failure handling.

### Evidence and remaining work

A bounded self-only native test observed Bookings-originated updates reaching a connected calendar and email. External calendar moves and deletion did not update the authoritative booking within the observed windows. This is bounded negative evidence, not proof that every provider or configuration is unsupported. Apple-client behavior remains untested. Observed native notices also require correction for host/customer attribution, replacement-time acceptance, time zones, and unresolved template fields.

Compare complete native options before selecting a bridge. Reuse verified native behavior and qualify only the missing behavior. The existing offline checker accepts normalized intervals; it does not collect provider events, implement strict-blocking policy, synchronize calendars, reserve slots, send notices, or enforce a live booking decision. Its [acceptance checklist](../../src/zoho-bookings/calendar-conflicts/README.md#collection-and-acceptance-still-required) remains open.

## Billing, Subscription Links, And Usage

Keep all current reconciliation and preview work **noncharging**. [Billing link reconciliation](../../src/zoho-catalyst/crm-billing-orchestrator/README.md#noncharging-billing-link-reconciliation) and [v2 previews](../../src/zoho-catalyst/crm-billing-orchestrator/tools/commercial-terms-v2.md) do not establish operational subscription synchronization or authority to bill Retell usage.

Before an operational adapter is enabled, qualify effective CRM/Billing/Retell ownership, the native catalog and entitlement contract, complete bounded reads, historical attribution, and a durable submission ledger. Monthly allowances must remain monthly even on annual base terms. Versioned policy and service-scope references are not proof that their rules are implemented or approved.

Cross-write idempotency, ambiguous submissions, late usage, invoice void/regeneration, correction history, refunds, customer notices, and Billing/Books ownership require explicit qualification. A changed snapshot or invoice status must not create a new usage identity or justify duplicate submission. Direct-paid onboarding requires its own eligibility evidence and must not invent a completed free test.

Historical public prices remain historical. Replacement working prices, margins, vendor-cost assumptions, and private commercial evidence are deliberately not published. Follow the [commercial reconciliation boundary](../product/README.md#commercial-reconciliation-boundary) before any quote or public offer update.

## v1.0 And Deferred Scope

Direct-paid onboarding remains a separate eligible path, not a fabricated trial
completion. Full subscription transitions and refund automation remain v1.0
follow-on work.

The approved v1.0 scope includes shared backend workflows, client-specific
configuration, Retell agents using those shared tools, an internal operations
view, and a small read-only client portal built on the verified core workflow.
The portal covers bookings, pending work, outcomes, usage, and connection health,
with tested separation between clients. Broader client self-service remains
deferred. v0.5 remains the immediate priority.

Scope inclusion is not proof of native acceptance, deployment, or authority for
financial actions or customer launch. No new site or legal-compliance change is
claimed by this reconciliation.

## Remaining Completion Gates

1. Complete reviewed source/private preparation without claiming native installation.
2. Qualify provider persistence, concurrency, ownership, and exact access contracts.
3. Select the smallest calendar option that satisfies all required lifecycle and prospect-acceptance behavior; verify notification fixes with a controlled scope.
4. Prove the approved native source/configuration state, failure paths, independent readback, and rollback or containment before cutover.
5. Keep paid execution, real customer delivery, spending, telephone testing, and launch behind their separate applicable approvals and evidence. An approved source change does not consume or renew any of those permissions.

Work can proceed in parallel when files, source writers, native targets, and effects do not conflict. Unqualified native contracts block only their affected execution paths; independent research and offline preparation can continue.

## Maintenance And Privacy

Update this checkpoint when decisions or verified outcomes change. Preserve dated evidence rather than relabeling it as current. Link the owning source contract instead of duplicating executable schemas or inventing a new architecture here.

Private account identities, calendar names and events, uploaded sources, evidence artifacts, native identifiers and bindings, credentials, customer data, health or personal information, and confidential commercial terms remain outside public GitHub. This is a sanitized delivery record, not the private working dashboard or a complete live-system inventory.
