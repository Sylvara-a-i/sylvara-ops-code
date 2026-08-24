# Sylvara Revenue Desk Official Product And Commercial Strategy

## Status

- Classification: **Approved operating strategy and public commercial source of truth**
- Decision state: **Accepted for validation and commercial execution**
- Effective: **2026-08-24T13:39:38-05:00 (America/Chicago)**
- Decision record: [ADR 0007](../adr/0007-revenue-desk-commercial-strategy.md)
- Technical deployment state: **Separate evidence required**
- Customer-facing publication state: Approved only for claims and prices stated in this document; do not imply that an unverified capability is live

This document controls Sylvara's current ICP, offer structure, pricing, differentiation, expansion path, and commercial kill criteria. It supersedes conflicting earlier descriptions that treated Launch as a one-call-gap product, bundled minutes into the plans, withheld basic booking from Launch, discounted annual service by two free months, or left the current price architecture unresolved.

> Strategy approval is not deployment evidence. A capability may be commercially approved while still requiring an authoritative platform contract, implementation, acceptance testing, legal or compliance review, customer-specific configuration, and live readback before it can be sold as active or routed to real callers.

## Executive Decision

Sylvara will build and sell a verticalized, managed **Revenue Desk for residential service plumbing companies**.

The business will not compete as a generic AI receptionist, a self-service voice tool, or a broad custom-automation agency. Basic answering, FAQ handling, transfers, 24/7 availability, and scheduling are becoming commodity capabilities. Sylvara's paid value must come from owning and continuously improving the contractor's revenue workflow around those capabilities.

The strategic center is:

> Capture existing demand → qualify it → take the approved action → recover what falls through → show the contractor what became revenue → continuously improve the process.

The initial acquisition product remains narrow: a **7-Day / 25-Call Revenue Leak Test** on an approved after-hours and/or no-answer/overflow route. The paid product is not narrow in the same way. Every paid plan may handle the customer's entire eligible inbound call stream, including optional 24/7 AI-first coverage. The plan tier determines how much of the revenue process Sylvara manages, not how much call volume the customer is permitted to route.

## Product Operating Principles

1. **Complete workflows, not conversations.** An answered call is not a successful outcome until it reaches a verified booking, route, callback, safe escalation, or explicit unresolved state.
2. **Expand coverage progressively.** Use synthetic tests, controlled call gaps, observed acceptance evidence, and rollback before increasing responsibility.
3. **Preserve vendor portability.** Keep telephony, voice runtime, workflow logic, data, and customer integrations separated enough to change providers without redesigning the product.
4. **Keep the initial product inbound.** Outbound calling or messaging is a separately approved workflow with its own consent, compliance, and delivery evidence.
5. **Keep rules structured and fail safely.** Service areas, hours, eligibility, urgency, schedules, routes, and fallback behavior must not depend only on an open-ended prompt.
6. **Attribute outcomes honestly.** Calls, qualified opportunities, bookings, completed jobs, invoiced revenue, collected revenue, and estimates are different facts.

Sylvara remains focused on independent residential plumbing companies. Other trades and property management remain later candidates. The company is not a broad agency that accepts any AI automation project.

## Primary ICP

The first repeatable sales motion targets:

| Attribute | Approved Initial ICP |
| --- | --- |
| Trade | Residential service plumbing |
| Company size | Approximately 5–15 active field technicians |
| Revenue planning range | Approximately $1.5M–$6M annual revenue |
| Locations | One primary location initially |
| Inbound demand | Meaningful phone demand; roughly 20–60 calls per day is a qualification planning range, not a market benchmark |
| Office structure | Small CSR, dispatcher, or administrative function with a repeatable scheduling process |
| Systems | A usable calendar, CRM, or field-service system |
| Marketing and capacity | Actively generates inbound demand and can accept additional profitable work |
| Buyer | Owner, General Manager, Operations Manager, or Call-Center/Office Manager |
| Core pain | Missed calls, overflow, slow response, after-hours leakage, inconsistent booking, and weak outcome visibility |

### Disqualifiers

Do not force the offer onto businesses that are mostly construction or project work, have extremely low relevant call volume, cannot accept more work, lack a repeatable intake and scheduling process, will not provide required system access, expect unlimited customization, or need materially different regulated or high-risk workflows.

A one-to-three-truck company may still qualify when the pain, call value, workflow maturity, and willingness to pay are unusually strong. A larger multi-location or multi-brand contractor belongs in Enterprise when the operating model is materially more complex.

## Positioning And Differentiation

Approved market position:

> **Sylvara is not another AI receptionist. It is a managed Revenue Desk for plumbing contractors: we answer the demand, follow the contractor's operating rules, book or route the opportunity, recover leads that fall through, connect the work to the office, measure what happened, and continuously manage the process for them.**

“Managed for you” is valuable but is not a moat by itself. Sylvara must combine:

- plumbing specialization;
- managed implementation and ongoing ownership;
- controlled rollout and safe fallback;
- revenue-recovery workflows;
- closed-loop outcome reporting;
- fair metered pricing; and
- continuous QA and optimization.

The durable switching cost should come from accumulated operational value: service-area rules, supported and unsupported work, schedules, appointment logic, new-versus-existing-customer policy, membership priority, urgency and on-call rules, routing, CRM/FSM mappings, lead-source outcomes, recovery workflows, failure patterns, conversion history, test cases, seasonal rules, and management reporting.

Do not claim that Sylvara is globally unique as a feature category. The defensible direction is to become the operating layer between inbound demand and the contractor's field-service system for a specific underserved plumbing-company profile.

## Free Revenue Leak Test

### Customer-Facing Offer

> **Choose your current call gap: after-hours, no-answer/overflow, or both. Up to seven days or 25 connected calls.**

The test uses one business number and one approved call-gap route. Its job is to find and work one real leak in inbound revenue with the contractor's own calls, not to imitate the complete paid Revenue Desk.

The current technical MVP remains a bounded shared free-test monitor governed by [ADR 0006](../adr/0006-shared-seven-day-monitor-with-client-number-isolation.md). It captures and classifies approved calls and produces evidence; it is not automatically promoted into a paid agent and does not inherit paid booking, dispatch, transfer, messaging, or integration authority.

[ADR 0003](../adr/0003-initial-after-hours-service-request-workflow.md) remains accepted for offline synthetic validation only as the first provider-neutral service-request workflow. It does not limit the approved paid-plan commercial architecture.

### Required Test Output

The results review should show:

- calls captured;
- actual average connected call duration;
- qualified opportunities;
- existing-customer calls;
- out-of-area or wrong-fit calls;
- urgent requests;
- bookable opportunities;
- calls that would otherwise have required office follow-up;
- observed workflow failures;
- recommended paid coverage; and
- expected monthly connected-minute range.

Use the contractor's own average ticket or known job values when discussing potential recovered value. Do not present a generic revenue guarantee or imply that an answered call became collected revenue.

## Approved Commercial Model

| Plan | Monthly Management Fee | Connected AI Usage | Implementation |
| --- | ---: | ---: | ---: |
| Launch | $349 | $0.40 per connected AI minute | $750 |
| Growth | $749 | $0.40 per connected AI minute | $1,500 |
| Scale | $1,299 | $0.40 per connected AI minute | $2,500 |
| Enterprise | From $2,500 | Negotiated after volume and workflow review | From $5,000 |

### Pricing Rules

1. **Coverage volume is not the primary feature gate.** More eligible coverage primarily creates more metered usage.
2. **Management fees pay for operational ownership.** They fund workflow design, configuration, monitoring, QA, reporting, supported integrations, approved changes, and accountability; they are not a markup on minutes alone.
3. **Usage remains transparent and metered.** The exact billable-minute definition, rounding, exclusions, corrections, and dispute process must be implemented in the approved Billing and contract terms before invoicing.
4. **Annual prepayment receives 10% off management fees only.** Usage and implementation remain unchanged.
5. **Do not provide two free months.** Retention and churn are not yet proven strongly enough to justify a 16.67% recurring discount.
6. **Do not eliminate implementation fees casually.** Any discount must buy a measurable concession such as prepaid term, simplified scope, a shorter decision deadline, or approved reference rights.
7. **Do not publish unlimited locations, integrations, support, or bespoke workflows at a fixed price.** Complex scope moves to Enterprise or a separately priced change order.

## Plan Architecture

### Launch — Managed AI Receptionist

**$349/month + $0.40 per connected AI minute · $750 implementation**

**Positioning:** Your entire plumbing phone desk, managed for you.

Launch is a complete managed inbound receptionist for one primary location and one business number. It is not a crippled one-gap product. The customer may route after-hours, overflow, no-answer, selected calls, or the entire eligible 24/7 inbound stream after the required acceptance gates pass.

| Capability | Launch Scope |
| --- | --- |
| Business numbers and locations | One number; one primary location |
| Coverage | After-hours, overflow, no-answer, or optional full 24/7 AI-first coverage |
| Intake | Standard plumbing intake; new-versus-existing customer; service-area, supported-service, and urgency qualification |
| Knowledge | Approved FAQs and business knowledge |
| Booking | Direct booking into one supported calendar or FSM after technical review |
| Next actions | Callback creation and approved warm transfer or on-call route |
| Records | Recording, transcript, summary, and spam/irrelevant-call categorization where approved |
| Safety | Safe fallback and bounded escalation |
| Reporting | Basic outcome dashboard |
| Management | Managed monitoring and quarterly Revenue Desk review |

### Growth — Managed Revenue Desk

**$749/month + $0.40 per connected AI minute · $1,500 implementation**

**Positioning:** Don't just answer demand. Recover and convert it.

Growth is the recommended plan. It is where Revenue Desk becomes more than an AI receptionist.

Everything in Launch, plus:

| Capability | Growth Scope |
| --- | --- |
| Qualification | Advanced company-specific qualification |
| Systems | One supported CRM or FSM connection |
| Recovery | Missed-call recovery and unbooked qualified-lead tracking |
| Digital response | Web-lead speed-to-lead and website AI chat |
| Messaging | Approved SMS continuation or follow-up where properly configured |
| Next actions | Multiple approved next actions |
| Recognition | Customer or membership recognition where supported |
| Attribution | Booking and lead-source attribution |
| Reporting | Revenue Recovery Dashboard |
| Management | Monthly QA, optimization, and Revenue Desk review |

A Growth customer should be able to say: “Sylvara manages inbound opportunities across my phone and digital channels and shows me which ones turned into work.”

### Scale — Managed Revenue Operations

**$1,299/month + $0.40 per connected AI minute · $2,500 implementation**

**Positioning:** Manage the front office as a revenue system.

Everything in Growth, plus:

| Capability | Scale Scope |
| --- | --- |
| Numbers and call paths | Up to three |
| Teams | Multiple teams or on-call groups |
| Scheduling | Multi-calendar routing |
| Systems | Up to two supported business-system connections |
| Operations | Advanced routing and escalation |
| Locations | Limited standardized multi-location support after review |
| Recovery | Open-estimate follow-up and approved customer reactivation where compliant |
| Human-call intelligence | CSR call scoring and leakage analysis |
| Attribution | Advanced source-to-booking attribution |
| Seasonal operations | Seasonal surge mode |
| Management | Priority QA and incident review |
| Reporting | Advanced Revenue Operations Report |

### Enterprise

Enterprise absorbs materially different workflows across locations, more than three locations, multiple brands, unusual SLA requirements, custom compliance requirements, deep custom integrations, custom data-warehouse or attribution work, and high-volume accounts where negotiated economics make sense.

Do not promise unlimited locations or integrations. Enterprise is a reviewed operating scope, not a loophole for unbounded consulting.

## No-Surprise Calibration Month

Ordinary Launch and Growth prospects should not be required to produce two months of phone logs before they can buy.

After the free test, ask only:

1. What coverage do you want?
2. Roughly how many total inbound calls do you believe you receive?
3. What system should bookings or records go into?

Use observed test duration and traffic to quote an expected usage range. Protect the first paid month with a one-time calibration cap at the quoted upper amount unless the customer explicitly expands coverage.

Example:

```text
Growth Management: $749/month
Usage: $0.40/connected AI minute
Expected usage: 1,500–2,000 connected minutes
Expected bill: $1,349–$1,549
First paid month cap: $1,549 unless coverage is expanded by the customer
```

Month two uses measured volume and the agreed coverage. The calibration cap is a sales-risk control, not a permanent discount or unlimited-use commitment.

## Revenue Recovery Ledger

The highest-priority differentiator beyond reception is a closed-loop **Revenue Recovery Ledger**.

Do not stop at “calls answered.” The operating report should show, as supported by authoritative data:

- eligible interactions;
- qualified opportunities;
- bookings created;
- urgent transfers;
- qualified opportunities not booked;
- opportunities recovered through follow-up;
- unresolved opportunities;
- customer-confirmed booked or won revenue; and
- potential value still requiring action.

Estimates, bookings, completed jobs, invoiced revenue, and collected revenue are different facts. Label them separately and reconcile to the customer's authoritative system.

## Product Ladder

Build expansion in this order:

| Stage | Product Capability | Commercial Reason |
| --- | --- | --- |
| Capture | Managed AI Receptionist | Immediate, obvious missed-call pain |
| Convert | Direct Booking And Qualification | Clear job outcome |
| Recover | Missed-Call And Web-Lead Recovery | Monetizes demand already purchased |
| Engage | Web Chat And Approved SMS | Low-cost incremental response |
| Prove | Revenue Recovery Ledger | Makes ROI visible |
| Nurture | Open-Estimate And Existing-Lead Follow-Up | Unlocks existing pipeline |
| Optimize | Human CSR Call Intelligence | Improves calls AI does not handle |
| Coordinate | Multi-Team And Multi-Location Revenue Operations | Creates expansion path |

This ladder is a commercial sequence, not authorization to build every stage now. Prioritize the smallest capability needed to sell and deliver the free test, Launch, and the first paid Growth account. Defer speculative feature work until paid demand and workflow access justify it.

## Margin And Support Gates

Approved recurring economics:

- target loaded recurring gross margin: **70% minimum**;
- preferred loaded recurring gross margin: **72%–78%**;
- implementation should be separately profitable; and
- support labor must be measured by account, not hidden in consolidated margin.

An account that consistently falls below **65% loaded recurring gross margin**, requires more than roughly **two recurring support hours per month after stabilization**, or requires continuous bespoke engineering must be repriced, narrowed, moved to Enterprise, or terminated.

“Loaded recurring gross margin” includes recurring revenue less direct voice and telephony, model and automation usage, hosting, payment processing, direct integration cost, and direct support/QA labor. Internal vendor-cost assumptions remain planning inputs and must be refreshed before quoting or changing usage rates.

## What Not To Build Or Sell Yet

Defer or reject:

- payment-card collection by voice;
- final plumbing price quotes;
- diagnostic advice;
- automated cold calling or unrestricted outbound marketing;
- fully autonomous dispatch of genuine emergencies;
- bookkeeping or invoicing as Revenue Desk features;
- website building or social-media management;
- unlimited bespoke workflows;
- unlimited integrations;
- a generalized agent platform or field-service-management system;
- a large internal human receptionist workforce; and
- unrelated verticals pursued in parallel with plumbing validation.

Outbound automated calls or SMS, estimate follow-up, reactivation, and similar workflows require a separately approved consent, compliance, platform, and customer-configuration process before activation.

## Continue, Reprice, Or Kill

Continue investing when qualified plumbing prospects provide real workflow access, the Revenue Leak Test exposes repeated economic leakage, paid Launch or Growth accounts close, implementations become repeatable, customers renew or expand, outcomes reconcile, and support burden remains inside the margin gate.

Narrow, reprice, or kill when prospects like the demonstration but will not pay, value collapses to commodity call answering, every implementation is bespoke, humans repeatedly rescue the workflow, required integrations are inaccessible or unreliable, outcome attribution cannot be established, support destroys margin, compliance burden exceeds economics, or customers do not renew.

Verified customer behavior, signed commercial scope, payment, usage, renewal, churn, referral, and account-level delivery data outrank this planning strategy. Material contrary evidence should trigger a new reviewed decision rather than silent drift.

## Technical, Legal, And Publication Boundary

- GitHub owns the approved sanitized strategy, code, schemas, tests, and decision records; it does not own customer data, private account economics, credentials, production configuration, or live deployment evidence.
- The approved CRM owns prospects, customers, pipeline, and commercial relationship state.
- The approved Billing and contract systems own subscription terms, usage definitions, invoices, and signed commitments.
- The customer's approved calendar, CRM, or FSM remains authoritative for availability, customers, appointments, jobs, work orders, and completed revenue states.
- Catalyst or approved middleware may own secure workflow state, idempotency, call/outcome evidence, and reconciliation logic.
- Retell or another approved provider owns voice runtime only; it does not define Sylvara's commercial or customer-system truth.
- Recording, messaging, transfer, booking, outbound follow-up, payment, and regulated workflows require their specific legal, security, consent, platform, and acceptance gates.
- Follow the [AI Receptionist Legal And Compliance Control Archive](../legal-compliance/README.md). Provide clear automation/recording behavior and a tested no-record fallback where the actual call path requires it.
- Do not request or collect payment-card numbers in the generative call path. Redirect to an approved segregated payment workflow.
- Controlled internal, non-sales QA and a real prospect launch are separate decisions. Prospect-facing telephone demonstrations require explicit operating approval and current technical readback.

No repository merge by itself authorizes a live call route, customer communication, contract, charge, production deployment, or claim that a proposed capability is currently available.

## Change Control

[ADR 0007](../adr/0007-revenue-desk-commercial-strategy.md) is the current decision record. [ADR 0002](../adr/0002-managed-home-service-receptionist-product-boundary.md) remains useful historical rationale for the plumbing-first, managed, workflow-completion boundary, but ADR 0007 controls the final ICP, free-test positioning, hybrid pricing, paid-plan coverage model, booking decision, annual discount, differentiation, margin gates, and expansion ladder.

Any future change to the primary ICP, the $349 / $749 / $1,299 management fees, the $0.40 connected-minute rate, the implementation fees, Growth as the recommended plan, or the free Revenue Leak Test requires an explicit owner-approved strategy decision with an effective date.
