# Managed Residential Plumbing Receptionist Product Direction

## Status

- Classification: **Public product and engineering boundary**
- Decision state: **Accepted for validation**
- Delivery phase: **Validation; no live capability is established by this document**
- Customer-facing publication: **Not authorized by repository approval**
- Canonical decision record: [ADR 0002](../adr/0002-managed-home-service-receptionist-product-boundary.md)
- Initial workflow decision: [`after-hours-new-residential-service-request-v1`](../adr/0003-initial-after-hours-service-request-workflow.md), accepted for offline synthetic validation only
- Telephone and legal gate: [AI Receptionist Legal And Compliance Control Archive](../legal-compliance/README.md)

## Purpose

This document defines the product boundary that should guide Sylvara's public technical work. It is an implementation filter, not a sales page, price sheet, financial forecast, service-level agreement, or statement that a customer deployment exists.

> This strategy records an approved business direction. It is not evidence that any capability, integration, service level, price, customer result, or production deployment currently exists.

Sylvara is validating a managed inbound receptionist and front-office service for independent residential plumbing companies. Kansas City is the initial relationship and validation market. The first use case is after-hours and overflow coverage for calls that staff cannot answer reliably. Dispatch activity remains limited to separately approved intake, routing, and integration behavior. Other home-service trades remain deferred until the plumbing playbook is repeatable.

The product is not generic access to a voice agent. Its value must come from completing a bounded business workflow, recording the outcome, handling exceptions safely, and remaining accountable for implementation quality.

This product direction does not override the [legal and compliance control archive](../legal-compliance/README.md). The only current telephone proposal is controlled, inbound, internal, non-sales QA with synthetic conversation data. Prospect-facing telephone demonstrations, client pilots, and production calls remain blocked until the exact workflow passes separate legal, privacy, security, vendor, environment, and deployment gates. The progressive customer modes below describe a future gated sequence, not current authorization.

## Initial Product Boundary

| Decision | Current boundary |
|---|---|
| Initial audience | Independent residential plumbing companies in Kansas City with meaningful inbound demand and an existing scheduling or dispatch process |
| Initial buying situation | Staff cannot consistently handle after-hours, overflow, seasonal, or field-time calls |
| Initial operational result | Eligible calls are qualified and then booked, routed, recorded for follow-up, or safely escalated according to approved rules |
| Delivery model | Managed productized service with bounded implementation, monitoring, quality review, and change control |
| Initial rollout | Shadow tests, then after-hours or overflow, then selected call types; primary reception only after explicit acceptance evidence |
| Geographic intent | Prove one repeatable residential-plumbing playbook in Kansas City, then reuse it in other markets before adding another trade or vertical |
| Deferred expansion | Other home-service trades and property management remain later candidates and must not run in parallel with initial plumbing validation |

Qualification must use current operating evidence such as call volume, coverage gaps, workflow maturity, job types, escalation risk, and system readiness. Revenue, employee-count, pricing, and other commercial thresholds belong in the approved private operating system and must not be inferred from this repository.

## Service Contract Under Validation

The service may be designed to provide the following functions, but each function remains `Proposed` or `Unknown` until the exact customer workflow, platform contract, permissions, test evidence, and deployment state are verified.

| Function | Public status | Activation gate |
|---|---|---|
| Inbound call handling | Proposed | Approved voice runtime, telephony path, disclosure, fallback, and synthetic acceptance tests |
| After-hours or overflow coverage | Proposed initial mode | Customer-approved schedule, forwarding behavior, call eligibility, and rollback |
| Intent and lead qualification | Proposed | Versioned questions, bounded classifications, prohibited actions, and uncertainty handling |
| Booking or dispatch | Proposed; contract-dependent | Authoritative schedule or field-service contract, conflict handling, idempotency, and independent readback |
| CRM or field-service updates | Proposed; contract-dependent | Live metadata, minimum fields, duplicate policy, least privilege, and downstream readback |
| Summaries and operational alerts | Proposed | Approved recipients, data minimization, delivery-state ownership, and failure routing |
| Outcome attribution | Proposed | Defined outcome taxonomy and reconciliation with the authoritative customer system |
| Missed-call follow-up | Proposed | Consent, channel policy, template approval, opt-out handling, and delivery readback |
| Additional-language coverage | Unknown | End-to-end language, safety, escalation, and quality validation |
| Human exception handling | Proposed and bounded | Named destination, coverage window, transfer test, privacy boundary, and cost control |
| Customer reporting | Proposed | Approved metric definitions, source lineage, access control, and correction process |

No public or customer-facing material may claim continuous availability, a language capability, a named integration, a response time, recovered revenue, a guarantee, a price, or a support level until that exact statement has current authoritative evidence and publication approval.

## Product Operating Principles

1. **Complete workflows, not conversations.** An answered call is not a successful outcome. The workflow must end in a verified booking, routing, follow-up state, safe escalation, or explicit unresolved state.
2. **Keep rules structured.** Service areas, operating hours, eligibility, emergency handling, routing, appointment types, and escalation destinations belong in validated configuration or code, not solely in an open-ended prompt.
3. **Expand coverage progressively.** Start with synthetic and shadow testing. Increase live responsibility only after observed calls meet the agreed acceptance gate.
4. **Fail safely.** Missing configuration, uncertain identity, stale schedule data, ambiguous urgency, failed writes, and incomplete readback route to a bounded fallback instead of a guessed business action.
5. **Keep humans for exceptions.** Human escalation handles defined uncertainty, safety, distress, complaints, and customer-selected exceptions. It must not silently turn the product into an unbounded call center.
6. **Preserve vendor portability.** Telephony, voice runtime, business logic, storage, and integrations must have explicit boundaries. Critical workflow rules and exportable customer configuration must not depend on one voice vendor's prompt format.
7. **Limit integration scope.** Add a native integration only when paid demand, official support, repeatability, and maintenance economics justify it. Customer-specific code must not hide inside recurring support.
8. **Attribute outcomes honestly.** Separate call handling, qualification, booking, dispatch, completed work, and estimated commercial value. Never label an estimate as collected revenue.
9. **Keep source systems authoritative.** The customer's approved field-service, CRM, and calendar systems own their respective operational records. Sylvara coordinates the workflow and records evidence; it does not invent downstream truth.
10. **Design for remote, repeatable delivery.** Onboarding, testing, monitoring, support, and rollback should work without local physical presence or founder-only knowledge.

## Initial High-Risk Guardrails

These are conservative product controls, not legal conclusions. Before live activation, the exact jurisdictions, customer contract, vendor chain, call path, and data handling require current review.

- Keep the initial product inbound. Outbound artificial-voice or telemarketing workflows require a separate reviewed product, consent, platform, and compliance decision.
- Treat missed-call SMS as a separate communication workflow. Require an approved legal or consent basis, sender identification, timing rules, opt-out handling, templates, audit evidence, and delivery readback.
- Disclose automation and any recording or transcription clearly. Do not assume one script satisfies every call path or jurisdiction; provide configurable behavior and a tested no-record fallback where required.
- Do not request or collect payment-card numbers in the generative call path. If a caller volunteers card data, prevent avoidable retention in recordings, transcripts, summaries, or logs and redirect to an approved segregated payment flow.
- Keep medical, dental, and electronic protected-health-information workflows out of the initial product until the complete contract, vendor, security, retention, and incident chain is approved.
- For urgent or safety-sensitive calls, gather only bounded approved facts and escalate according to the customer's rule. The system must not diagnose, declare a situation safe, or suppress escalation to improve a metric.
- Store recordings, transcripts, and caller details only in approved private systems with purpose-limited access and retention. They never belong in GitHub, public issue text, test fixtures, or CI output.
- Do not advertise human fallback or additional-language coverage until hours, capacity, confidentiality, quality testing, incident ownership, and unsupported-case behavior are established.

## Future Progressive Deployment

| Mode | Allowed behavior | Exit gate |
|---|---|---|
| Shadow | Synthetic calls and scripts; no customer interaction or business-system write | Required paths, edge cases, disclosures, fallback, and observability pass |
| After-hours or overflow | Handle only the bounded periods when approved staff are unavailable | Sampled calls and downstream outcomes meet the private acceptance threshold |
| Selected call types | Handle only explicitly approved intents or campaign paths | Classification, routing, booking, and exception evidence remain within tolerance |
| Primary reception | Handle most eligible inbound calls | Separate production approval, sustained evidence, capacity, rollback, and independent readback |

Every deployment must preserve the prior working route or another tested fallback. Moving between modes is a production change and requires scoped approval; a GitHub merge does not authorize it.

## Validation And Pivot Gate

The private operating scorecard must track at least:

- qualified paid-pilot conversion;
- retention after the initial operating period;
- recurring contribution margin after support and exception labor;
- implementation effort and elapsed deployment time;
- eligible calls completed or correctly escalated;
- human-escalation share and repeat exception causes;
- outcome-attribution completeness;
- customer-acquisition payback;
- recurring founder or specialist support per account; and
- serious complaints, refunds, and preventable incidents.

Exact thresholds, account-level evidence, projections, and economics stay private. The public decision rule is that Sylvara must not expand coverage, geography, integrations, or verticals when customer value is not measurable, delivery is not repeatable, failures cannot be bounded, or support labor prevents a durable managed service.

If primary reception proves too risky or weakly valued, narrow first to after-hours, overflow, and missed-call conversion. If voice alone lacks value but reliable lead response and booking retain value, preserve the workflow and attribution layer rather than returning to unrestricted custom automation. Another trade or property management requires a new reviewed decision after the residential-plumbing quality, escalation, and integration system is stable.

## Explicit Non-Goals

- a broad agency that accepts any AI automation project;
- a commodity self-service receptionist sold on voice quality or minutes alone;
- a generalized agent platform, custom telephony network, or speculative multi-tenant SaaS layer;
- simultaneous launch across plumbing, other home-service trades, property management, medical, legal, restaurants, and other unrelated verticals;
- regulated healthcare handling before the complete vendor, contract, security, retention, and incident chain is approved;
- payment-card collection in recorded or generative call paths;
- unsolicited outbound artificial-voice marketing as an extension of inbound reception;
- an internal around-the-clock human call center during validation; or
- customer-specific software development concealed inside a standard recurring plan.

## Open Decisions

The initial workflow is now fixed by [ADR 0003](../adr/0003-initial-after-hours-service-request-workflow.md). The strategy still does not establish:

- the implemented structured rules, state machine, synthetic scenario suite, or deterministic evaluator for that workflow;
- the initial voice and telephony providers for a live deployment;
- the first field-service integration justified by qualified paid demand;
- the human escalation destination, coverage window, and commercial model;
- whether additional-language coverage belongs in the initial validated package;
- the authoritative method for matching a call to a booked, completed, invoiced, or paid outcome;
- approved offer names, prices, usage limits, overage protection, support terms, or service levels; or
- the private metric thresholds and decision owner for continuation, narrowing, expansion, or shutdown.

Keep these items `Unknown` until the responsible owner approves current evidence in the appropriate private system. Do not resolve them through website copy, repository examples, or assumptions inherited from the research report.

## Research, Claims, And Publication Boundary

This direction is Sylvara-original synthesis informed by a private strategy research report. The raw report, filename, filesystem path, metadata, source excerpts, competitor assessment, market estimates, proposed pricing, financial models, sales tactics, exact thresholds, and dated execution roadmap remain outside GitHub.

Research recommendations are not proof of product capability, tenant access, customer demand, legal compliance, or financial outcome. Public messaging must follow the [Copywriting Originality And Claims Standard](../copywriting/originality-and-claims-standard.md). Technical work must keep advertised platform support, the observed tool or API contract, effective customer access, and verified live deployment as separate evidence layers.

Repository approval authorizes only the sanitized source change. It does not authorize an offer, campaign, sales contact, customer onboarding, platform purchase, live call route, production integration, or external publication beyond the reviewed repository artifact.

## Change Filter

A proposed product change should answer all of these questions before implementation:

1. Which current residential-plumbing call outcome does it improve?
2. What paid or approved validation evidence justifies it?
3. Can it become a reusable vertical capability rather than one-off customer code?
4. Which system owns the resulting fact?
5. What is the smallest safe rollout mode?
6. How are uncertainty, duplicate actions, integration failure, and human escalation handled?
7. What metric proves value and what evidence triggers a stop or rollback?
8. Does it preserve vendor portability and the public-repository boundary?

If those answers are missing, the work remains research or a private commercial decision rather than an approved repository implementation.
