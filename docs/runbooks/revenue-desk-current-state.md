# Revenue Desk Current Delivery State

- Reviewed: **2026-11-10**
- Scope: sanitized repository decisions, completed source work, and remaining qualification
- Overall classification: **v0.5 completion and live acceptance remain open**
- This record grants no deployment, activation, spending, charging, customer-delivery, or launch authority.

Use this record for the current delivery checkpoint. The [release contract](../product/free-revenue-leak-test-release-contract.md) defines required target behavior, not installed state. Dated deployment records remain evidence only for their recorded revision, environment, observation, and limits. A source merge, offline test, or green CI run does not prove native deployment or acceptance.

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

Provider-recommended NoSQL conditional updates are a candidate for investigation, not a selected or deployed replacement. Qualify the exact contract, concurrent winner/loser behavior, retry and ambiguous-outcome semantics, persistence, access controls, limits, and cost before choosing an operational route. Do not weaken a safety guard or assume free capacity to make a test pass. Spending remains separately authorized.

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

## Deferred Scope

Direct-paid onboarding remains a separate eligible path, not a fabricated trial
completion. Full subscription transitions and refund automation remain v1.0
follow-on work. A custom client portal is deferred until after v1.0. These roadmap
boundaries do not authorize implementation, financial actions, or customer launch.
No new site or legal-compliance change is claimed by this reconciliation.

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
