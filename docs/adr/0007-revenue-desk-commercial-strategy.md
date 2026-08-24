# ADR 0007: Revenue Desk Commercial Strategy

- Status: Accepted
- Effective: 2026-08-24T13:39:38-05:00 (America/Chicago)
- Decision owner: Sylvara founder/operator
- Canonical operating document: [Sylvara Revenue Desk Official Product And Commercial Strategy](../product/README.md)
- Supersedes in part: [ADR 0002](0002-managed-home-service-receptionist-product-boundary.md)
- Deployment authorization: Not granted by this decision

## Context

Sylvara previously had a sound plumbing-first managed-receptionist direction but an inconsistent commercial architecture. The earlier package treated Launch as limited to one call gap, bundled minutes into tier prices, reserved basic booking for higher plans, and later considered reducing management fees when usage became separately metered.

Those choices confused two different questions:

1. How much inbound coverage does the customer route to Sylvara?
2. How much of the customer's revenue process does Sylvara manage?

Under hybrid billing, more eligible coverage creates more metered usage. It does not justify forcing a customer into a higher management plan merely for permission to route more calls. The management tier should instead represent the operational scope Sylvara owns after answering: reception, recovery, omnichannel conversion, attribution, multi-team operations, and continuous optimization.

The current strategy review also narrowed the initial ICP and clarified that managed implementation alone is not a durable differentiator. The business needs plumbing specialization, a controlled free entry point, revenue-recovery workflows, closed-loop outcome reporting, fair metering, and accumulated operating knowledge.

## Decision

Sylvara adopts the following operating strategy:

1. **Primary ICP:** One-location residential service plumbing companies with approximately 5–15 active field technicians, approximately $1.5M–$6M in annual revenue, meaningful inbound demand, a repeatable scheduling process, usable operating software, and capacity for additional profitable work.
2. **Free entry point:** A Revenue Leak Test on after-hours and/or no-answer/overflow for up to seven days or 25 connected calls, followed by a results review and expected paid-usage range.
3. **Paid coverage:** Every paid plan may handle the customer's entire eligible inbound call stream, including optional 24/7 AI-first coverage after acceptance. Coverage volume is not the primary tier gate.
4. **Launch:** Managed AI Receptionist at $349/month plus $0.40 per connected AI minute and $750 implementation. Launch includes one number, one primary location, full standard plumbing intake, safe routing/fallback, basic outcome reporting, managed monitoring, and direct booking into one supported calendar or FSM after technical review.
5. **Growth:** Managed Revenue Desk at $749/month plus $0.40 per connected AI minute and $1,500 implementation. Growth is the recommended plan and adds missed-call recovery, web-lead speed-to-lead, website chat, approved SMS continuation, one supported CRM/FSM connection, attribution, monthly QA, and closed-loop opportunity reporting.
6. **Scale:** Managed Revenue Operations at $1,299/month plus $0.40 per connected AI minute and $2,500 implementation. Scale adds up to three numbers, multiple teams/on-call groups, multi-calendar routing, up to two supported system connections, limited standardized multi-location support, approved estimate/reactivation workflows, human-call intelligence, advanced attribution, and priority QA.
7. **Enterprise:** From $2,500/month and $5,000 implementation for materially complex multi-location, multi-brand, high-volume, custom-compliance, custom-integration, or data-warehouse requirements. Enterprise is not unlimited fixed-price custom work.
8. **Annual terms:** Ten percent off management fees only. Usage and implementation remain unchanged. The prior two-month-free structure is rejected.
9. **Calibration:** Ordinary prospects do not need two months of phone logs. Use free-test observations and a rough inbound-volume estimate to quote a range; cap only the first paid month at the quoted upper amount unless the customer expands coverage.
10. **Differentiation:** Sell plumbing specialization, managed operating ownership, controlled rollout, revenue recovery, closed-loop outcome reporting, metered fairness, and continuous optimization—not generic AI access or the claim that “managed” alone is unique.
11. **Primary future differentiator:** Build a Revenue Recovery Ledger that distinguishes interactions, opportunities, bookings, unresolved leakage, customer-confirmed revenue, and potential value using authoritative data.
12. **Economics:** Maintain at least 70% loaded recurring gross margin, prefer 72%–78%, and reprice, narrow, move to Enterprise, or terminate accounts that remain below 65%, require more than roughly two recurring support hours per month after stabilization, or demand continuous bespoke engineering.
13. **Execution order:** Sell and deliver the Revenue Leak Test, Launch, and the first paid Growth workflow before building the complete Scale roadmap. Commercial approval of a plan feature is not a mandate to build it before paid demand.
14. **Non-goals:** Do not expand into payment collection by voice, final plumbing quotes, diagnostic advice, unrestricted outbound marketing, autonomous emergency dispatch, bookkeeping, invoicing, website/social services, unlimited integrations, a broad agent platform, or an internal human call center.

## Consequences

### Positive

- The customer can start with a complete receptionist without an artificial coverage restriction.
- Usage and management scope are economically legible and easier to quote fairly.
- The original management fees remain high enough to fund real operating ownership rather than only voice cost.
- Growth has a clear reason to exist: recovery, omnichannel conversion, integration, attribution, and monthly optimization.
- The free test stays low-friction and measurable while remaining operationally narrower than the paid product.
- The narrower ICP improves prospecting, workflow reuse, onboarding, and proof quality.
- Revenue Recovery Ledger work creates a path from commodity call answering to accountable revenue operations.

### Costs And Risks

- Launch must deliver a credible complete managed receptionist; it cannot justify its fee through artificial feature withholding.
- Hybrid billing requires an exact connected-minute definition, usage metering, correction process, and no-surprise invoice presentation.
- The first-month calibration cap creates limited underestimation risk that must be controlled by a documented quoted range.
- Growth and Scale contain capabilities that are commercially approved but not automatically implemented or launch-ready.
- Closed-loop revenue attribution depends on customer-system access and disciplined reconciliation.
- Support and customer-specific exceptions remain the largest margin risk.

## Rejected Alternatives

### Lower Management Fees Because Minutes Are Unbundled

Rejected. Metered usage removes voice-cost uncertainty but does not remove workflow design, implementation, monitoring, QA, reporting, integration maintenance, change control, or accountability.

### Restrict Launch To One Call Gap

Rejected for the paid plan. The free test remains controlled to one or both approved call gaps, but a paid Launch customer may route the full eligible stream and pay for the resulting usage.

### Hold Basic Booking For Growth

Rejected. Basic direct booking has become an expected receptionist capability. Growth must earn its premium through recovery, omnichannel conversion, deeper system ownership, attribution, and optimization.

### Bundle Large Minute Allowances Into Every Plan

Rejected. The target ICP may consume thousands of minutes, making bundles either misleading or margin-risky. Transparent metered usage is fairer and easier to calibrate.

### Require Two Months Of Phone Logs Before Quoting

Rejected for ordinary Launch and Growth sales. The free test and a rough call estimate provide enough evidence for a range and one-month calibration cap.

### Differentiate Only Through Voice Quality Or “Managed For You”

Rejected. Voice and basic reception are commoditizing, and other providers also offer managed setup. Sylvara must differentiate through vertical operating knowledge, recovery workflows, attribution, and ongoing operational ownership.

## Evidence And Review Triggers

This is the approved operating hypothesis, not proof that the market will buy or retain it. Verified customer behavior outranks the decision.

Review, amend, or replace this ADR when evidence shows that:

- the selected plumbing ICP does not grant workflow access or pay;
- the Revenue Leak Test does not reveal repeated economic leakage;
- Launch or Growth does not convert after qualified demonstrations;
- measured usage, support, or integration cost breaks the margin gate;
- customers do not renew, expand, or refer;
- outcome attribution cannot be established reliably;
- a different segment repeatedly produces stronger paid evidence; or
- legal, carrier, platform, or customer-system constraints materially change the service.

Do not revive a generic AI receptionist, broad custom-automation agency, simultaneous multi-vertical launch, or speculative platform build without material new evidence and a separate decision.

## Technical And Publication Boundary

This ADR approves strategy and public commercial terms only. It does not establish that every listed capability is implemented, supported by a specific provider, legally approved for every customer, deployed, or available for immediate activation.

No raw research report, competitor dossier, vendor-cost worksheet, private projection, account list, customer record, credential, production identifier, or private implementation detail is committed by this decision. The public derivative records only the approved Sylvara strategy.

A repository merge does not authorize a contract, invoice, charge, production deployment, live number route, customer communication, outbound message, or real-caller interaction.
