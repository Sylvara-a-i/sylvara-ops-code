# Free Revenue Leak Test Field Setup Runbook

- Status: Source-only candidate — `NOT_READY`
- Revision date: 2026-08-25
- Owner: Sylvara founder/operator
- Branch dependency: PR #49 exact head `654937f5707cdf4bedc04583b38b78ef181e30d8`
- Live install status: `NOT_AUTHORIZED`

## Outcome And Boundary

This runbook defines the temporary operator-led mobile setup journey that keeps existing Form 1 and Form 2, performs controlled qualification and conversion, coordinates number/forwarding/verification work, and returns Gabriel to CRM for final approval. It creates no Form 3, portal, client login, seventh Catalyst function, Retell clone, or browser activation path.

This source lane authorizes local code, tests, sanitized screenshots, and read-only preflight only. It does not authorize a CRM button execution or install, Lead conversion, Catalyst provisioning/deployment/publication, Forms change/submission, number reservation, Retell action, call, email/SMS, route change, merge, or Production traffic.

## Current Read-Only Facts

Verified on 2026-08-25 through bounded sanitized read-only CRM, Retell, and connector-capability evidence:

- a private pre-cutover security-remediation gate remains open for the existing Form 1 launch path; exact evidence remains in ignored private audit material, the live function remains untouched, and the approved gate must pass before cutover;
- actual button placement, label, layout, profile access, and argument mapping are unavailable from the connector;
- CRM still uses display `7-Day Revenue Leak Test` with actual/reference `Free 7-Day Missed-Call`; no `Free Revenue Leak Test` CRM choice exists;
- both Leads and Deals have one active Standard layout;
- Deal save requires `Deal_Name`, `Stage`, `Pipeline`, `Account_Name`, `Closing_Date`, and `Type` because the active Type validation rule makes Type effectively mandatory;
- the Free-Test Blueprint candidate is Draft with zero enrollment; no active Free-Test Blueprint was returned;
- Lead and Form 2 workflows are active and have current successful task/action evidence, while both initializer rules still have zero successful condition/action use;
- conversion mappings exist for the core company/contact/offer/source/route fields, but no safely identifiable synthetic Lead was available, so record-specific conversion options and duplicate candidates were intentionally not read;
- the target Retell agent and conversation flow are both published version 0; the flow has 47 nodes and zero transfer nodes or tools, and its configured webhook events are only `call_ended` and `call_analyzed`;
- exactly one inbound Retell-Twilio number is bound to that agent, but the number, provider identifiers, destinations, and endpoints remain private and carrier forwarding state was not exposed;
- the authenticated Retell configuration contract confirms native `transfer_call` destinations, cold/warm/agentic-warm options, and the exact transfer-failure edge prompt `Transfer failed`; current official webhook documentation confirms the canonical `transfer_started`, `transfer_bridged`, `transfer_cancelled`, and `transfer_ended` events. This does not prove complete raw event variations, import, deployment, forwarding, or live routing.

| Lane | Authorized connector/tool | Observed result | Evidence layer | Status / blocker | Observed |
|---|---|---|---|---|---|
| CRM identity and metadata | Authorized CRM read-only audit connector | Least-sensitive organization read matched Sylvara; Lead/Deal metadata and the active button-category function were read without execution | Live tenant metadata | Partial; exact custom-button placement and access metadata are unavailable from the advertised tool contract | 2026-08-25 |
| CRM Lead conversion | Authorized CRM read-only audit connector | No safely identifiable synthetic Lead was returned | Live record search | `NOT_READY`; record-specific conversion options were not called against a real Lead | 2026-08-25 |
| Zoho Forms 1 and 2 | None available | No authorized Zoho Forms read connector exists in the callable inventory | Connector capability | `NOT_READY`; definitions and saved text cannot be independently read back | 2026-08-25 |
| Catalyst Development | Authorized Catalyst read-only audit connector | Connection authorization failed at the least-sensitive identity call | Connector authorization | `NOT_READY`; organization, project, function, table, and hosted-client inventory remain unverified | 2026-08-25 |
| Retell configuration and routing | Authorized Retell read-only development connector | Agent, flow, number binding, settings, and transfer configuration schema were read without mutation | Live provider configuration plus advertised API schema | Partial; raw lifecycle serialization, import, carrier forwarding, and live route behavior remain unverified | 2026-08-25 |

No browser, direct REST call, or substitute connector was used to bypass a missing or unauthorized Zoho capability.

## Architecture

```text
CRM Lead or Deal — Open Free-Test Setup
        |
        | named Connection; 60-second digest-only nonce
        v
Catalyst hosted /field-setup/ — temporary operator-led session
        |-- existing Form 1: request + contact consent
        |-- Gabriel-only qualification
        |-- preview + explicit native Lead conversion confirmation
        |-- existing Form 2: email proof + authorization
        |-- existing-number reservation only
        |-- forwarding + rollback instructions
        `-- isolated QA route-verification receipt
        |
        v
CRM Deal — Approve & Start Free Test (separate Gabriel-only action)
        |
        v
Dedicated number -> shared 7-Day Free Test agent
        |-- routine actionable call -> one durable notification intent
        `-- bounded eligible handoff -> provider-event convergence + one monotone notification intent
```

The browser cannot convert, reserve, verify, activate, stop a live route, or roll back a live route without an independently authenticated operator/control-plane decision.

## Journey State Diagram

```text
01 Validate session -> 02 Company/progress -> 03 Hand to client
  -> 04 Open Form 1 -> 05 Confirm Form 1 -> 06 Return to Gabriel
  -> 07 Qualification -> 08 Conversion preview -> 09 Confirm conversion
  -> 10 Hand to client -> 11 Email verification -> 12 Open Form 2
  -> 13 Confirm Form 2 -> 14 Return to Gabriel -> 15 Reserve number
  -> 16 Forwarding instructions -> 17 Rollback instructions
  -> 18 Route verification -> 19 Ready for approval
  -> 20 Live read-only status -> 21 Stop/rollback status
  -> 22 Recoverable blocked/error
```

Every screen has one primary action, a visible `Stop Setup`, keyboard/focus support, and a minimum 44-pixel action target. Forms open by top-level navigation; no iframe is used.

## Launch And Session Controls

1. The CRM function reads the selected Lead or Deal and calls the private Development launch endpoint through a named Connection.
2. Catalyst generates a cryptographically random 256-bit nonce and stores only a keyed SHA-256 digest.
3. Bind the row to Development, exact operator, exact module/record, one journey, issue time, and an expiry of no more than 60 seconds.
4. Return only `/field-setup/#launch=<nonce>`. Never place a CRM ID, email, phone, environment ID, durable token, endpoint, or secret in the URL.
5. The client removes the fragment synchronously with `history.replaceState` before asynchronous work.
6. Exchange requires Gabriel's authenticated Catalyst user context and exact binding.
7. On one successful exchange, consume the nonce and issue a `Secure; HttpOnly; SameSite=Strict; Path=/` session cookie with bounded idle and absolute expiry.
8. Replay, wrong operator, wrong record, wrong environment, malformed token, expiration, and ambiguous storage fail closed without CRM disclosure.

The current deployed Request Form instruction limits its controller to issue and prefill routes. The new field-setup route manifest remains a disabled proposal until that repository/deployment boundary is explicitly reconciled. Existing Form 1 behavior is unchanged.

The browser submits intent only. Every guarded transition requires an injected server prerequisite resolver to return one exact receipt bound to the current action, environment, journey, module, operator, record, revision, session, state, statuses, and required fingerprints. Browser-supplied receipts and authority fields are rejected. The server verifies the stored invariants before compare-and-set persistence and then performs exact readback. The committed default composition injects no resolver and registers no routes, so guarded progression stops at the first server-required state and remains `NOT_READY`.

## Form And Conversion Rules

### Form 1

- Keep native Forms-to-Lead upsert as the only Form 1 submission writer.
- In person: set trusted source semantics server-side, skip Bookings, and send no Form 1 invitation.
- Public website: retain existing invitation/scheduling behavior.
- Prefill supported non-consent facts only; never precheck consent or overwrite populated CRM values with blanks.
- Allow the current Lead review workflow to create its task once. Do not duplicate the task or email from the button/controller.

Use exact live values until the entry-offer migration is separately approved: `Submission Channel=In Person`; Lead Source display `In-Person Walk In`/actual `Inbound`; Lead Status `Free Test Requested`; Entry Offer display `7-Day Revenue Leak Test`/actual `Free 7-Day Missed-Call`. Customer copy may say `Free Revenue Leak Test`; do not claim the CRM rename is complete.

### Qualification

Gabriel must explicitly decide all six factors: meaningful call volume, capacity for profitable work, repeatable intake, controlled forwarding authorization, accountable callback/handoff owner, and decision-maker present. `Not Ready` and `Disqualified` never convert.

### Lead Conversion

Before confirmation, read the current Lead, record-specific conversion options, current Deal metadata/picklists, matching Account/Contact/Deal candidates, lock state, and permissions. Stop on ambiguity, duplicates, missing mandatory values, or an existing matching Deal. Show a sanitized preview with no record IDs.

The confirmation uses an immutable preview fingerprint and revision bound to Gabriel. Claim it durably before one CRM V8 native conversion call through a named Connection. Associate at most one exact Account and Contact match. Read back Account, Contact, Deal, relationships, Type, Pipeline, Stage, authorization, test status, no routing, and no email. An ambiguous write is never retried; it enters reconciliation.

### Form 2

Retain the Deal-bound email proof and require both authorization boxes. Form 2 creates authorization evidence only. It does not use Zoho Sign, approve, activate, route, send SMS, or create paid service.

## Number, Forwarding, Verification, And Rollback

- Reserve only an already approved `Available` number. Never purchase automatically.
- Reservation must be atomic, idempotent, Development-bound, deployment-bound, and client-isolated.
- If none is available, stop at `Test Number Required — Sylvara Must Assign A Number Before Continuing`.
- A provider receives instructions only after current official forwarding and rollback evidence is reviewed. Unknown provider means `Technical Setup Required`; invent no star code.
- Never request a password, MFA code, token, recovery code, or remote-control session.
- Human handoff, Retell infrastructure fallback, and customer rollback are separate fields and runtime flags. Do not promote legacy fallback values automatically.
- The authenticated setup controller issues one exact 300-second `Open` verification window bound to the exact Development environment, journey, deployment/configuration fingerprints, assigned-number fingerprint, route fingerprint, approved QA-caller fingerprint, issue time, and expiry. The browser cannot supply or extend the window. Before a fresh issue, the server atomically closes a stale `Open` row as `Expired`; concurrent fresh requests can leave only one `Open` window.
- The call gateway alone may atomically consume or expire that `Open` window. Verification success produces one immutable receipt, rejects every consumed-window replay, starts no agent intake, increments no handled-call count, sends no client notification, and leaves the deployment non-live. Expired, corrupt, underlong, or overlong windows close as `Expired` and produce no receipt; an old-operation replay remains rejected after expiry.
- If the provider cannot prove the route before agent start, verification remains `NOT_READY`.

## Retell V2 Boundary

`call_gap_monitor_v1` remains unchanged. The `call_gap_capture_handoff_v2` source remains `NOT_READY`; its capability profile is Draft, disabled, unwired, bound to no traffic environment, and non-importable from public source. The authenticated Retell tool contract confirms the required transfer-node shape and exact `Transfer failed` edge, while official documentation confirms the four canonical transfer lifecycle envelopes. Exact sanitized live webhook fixtures remain absent.

Routine actionable calls never transfer and may project one bounded Catalyst-owned notification intent. An urgent/existing-customer/specific-person transfer requires exact configuration, safe direct human destination, loop checks, coverage eligibility, and caller consent. Immediate danger uses the safety path; vendors, spam, applicants, routine calls, and configuration failures never transfer. Structured provider events are authoritative; model analysis cannot claim connection or success.

The source service requires an injected durable handoff-event ledger that returns one complete cumulative snapshot and rejects conflicting or over-limit claims. Its immutable call binding includes the server-authoritative configured destination fingerprint before consent, so one target can progress from offered to accepted while a later target rebind is rejected before claim mutation. Lifecycle state converges monotonically as `Bridged > Failed > Ended > Cancelled > Started`, independent of event order; caller-supplied prior state is forbidden. A separate injected notification store must atomically reconcile exactly one row before any delivery claim. Sensitive or nonactionable classification irreversibly replaces or precedes an actionable dry-run intent with a payload-null suppression tombstone, preventing retained caller content and later intent resurrection across replay or concurrency. A strict minimizing parser now normalizes only the four documented Retell transfer events after exact provider/call/agent/scope/target/configuration binding, derives target evidence through an injected private HMAC boundary, and never retains the key, raw call, target, option, transcript, prompt, or number. These are still source contracts only: no live ledger adapter, notification adapter, delivery path, webhook ingress, parser wiring, or route registration is supplied.

## Development Installation Checklist

- [ ] PR #49 remains the exact valid parent or is reconciled to an equivalent immutable base.
- [ ] Every other writer on overlapping files is stopped or coordinated.
- [ ] The live Catalyst project identity and Development environment are independently read back.
- [ ] Confirm whether a hosted web client already exists; do not create a second one.
- [ ] Reconcile the Request Form two-route instruction before wiring launch/status/decision routes.
- [ ] Provision only `RevenueLeakTestFieldSetupJourneys`; read back every column, unique constraint, privacy flag, permission, and zero-row state.
- [ ] Replace the legacy launch function with the reviewed private-binding artifact only after the separate security-remediation gate passes and a parallel rollback target exists.
- [ ] Read back exact custom-button placement, arguments, profile access, and module binding without execution.
- [ ] Confirm record-specific conversion options and duplicate behavior on `ZZZ SYNTHETIC` data only.
- [ ] Confirm exact Forms 1/2 values, callbacks, return navigation, and saved consent/thank-you text.
- [ ] Confirm current number inventory and atomic reservation behavior without purchasing.
- [ ] Add provider instructions only from current official sources.
- [ ] Prove pre-agent QA-call interception and immutable route receipt.
- [x] Validate one disabled private review candidate against the exact Retell update schema and implement the strict unwired provider parser.
- [ ] Under separate approval, create/read back an isolated Retell Draft and capture sanitized complete event variations before runtime wiring.
- [ ] Keep v2 disabled and v1 unchanged.
- [ ] Run zero-network component, scenario, mutation, screenshot, safety, and full repository verification.

## Authoritative Readback Checklist

- [ ] CRM organization, operator role, Lead/Deal layouts, mandatory fields, validation rules, picklists, mappings, workflows, Blueprint state/actions, and exact button metadata.
- [ ] Forms names, aliases, stored values, required/private flags, consent defaults, exact saved copy, native integrations, webhook mappings, return behavior, and no SMS/Sign action.
- [ ] Catalyst project, environment, six-function inventory, hosted-client inventory, all routes, tables, columns, permissions, Connections, variables, Security Rules/API Gateway mode, and exact source revision.
- [ ] Retell agent/version, v1 rollback snapshot, v2 Draft JSON, dynamic variables, number binding, webhook/event subscriptions, transfer node/failure edges, lifecycle payloads, settings, and no traffic binding.
- [ ] Dedicated number ownership, route fingerprint, forwarding and rollback state, verification receipt, configuration approval, activation receipt, exact start/expiry, and limits.

## Parallel Button Cutover Plan

1. Preserve the current Lead button/function as the rollback target; do not edit or delete it in place.
2. Complete the separate approved private security-remediation plan before installing any replacement.
3. Render private endpoint and Connection placeholders into a private install artifact. Never commit the values.
4. Install the Lead and Deal `Open Free-Test Setup` candidates in parallel with Gabriel-only access and no automatic effect.
5. Read back label, module, layout, placement, profile access, arguments, function revision, endpoint binding, and named Connection without execution.
6. Under separate approval, execute only against one disposable `ZZZ SYNTHETIC` record; prove that it opens a nonce-only URL and performs no form submission, task, email, conversion, reservation, route, or activation.
7. Cut over only after synthetic replay, expiry, rollback, and source-revision evidence passes.
8. Keep `Approve & Start Free Test` and `Stop / Roll Back Test` separately disabled until their exact provider readback contracts are proven and approved.

## Rollback And Containment

If the source or future Development install misbehaves:

1. Disable the field-setup launch/exchange/status/decision routes and hosted client first.
2. Revoke the field-setup Connection if an external mutation boundary must be stopped independently.
3. Restore the prior CRM button assignment; do not delete either function or evidence row.
4. Stop new number reservations and close open verification windows.
5. Preserve journey, conversion, reservation, route, notification, approval, and provider evidence for reconciliation.
6. For an active route, use only the separately approved Gabriel stop/rollback action, restore the customer route, and independently read it back.
7. Keep v2 disabled or remove its Draft binding; v1 remains the source rollback profile.
8. Do not blindly replay an ambiguous conversion, reservation, route, transfer, notification, or activation action.

## Current Stop Conditions

Field setup remains `NOT_READY` because the live hosted-client inventory, exact button metadata, Catalyst authenticated-user contract, record-specific conversion options on a safely identified synthetic Lead, live Forms readback, provider forwarding evidence, number-reservation API, and pre-agent route-verification behavior are not all proven. The available Catalyst connector currently denies the required project readback, and the CRM connector exposes no custom-button metadata operation.

Retell remains `NOT_READY`: the update schema accepts the ignored private review candidate, the strict keyed minimizing parser and deterministic oracle pass locally, and v1 remains unchanged, but no Draft was imported/read back and exact sanitized webhook variations, authentication/delivery integration, and live behavior remain unverified. The v2 capability profile and gateway remain disabled, unwired, unbound, and unauthorized for runtime use.

Live installation remains `NOT_AUTHORIZED`.
