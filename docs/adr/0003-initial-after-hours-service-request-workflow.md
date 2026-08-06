# ADR 0003: Initial After-Hours Residential Service-Request Workflow

- Status: Accepted for offline validation
- Date: 2026-08-05
- Workflow ID: `after-hours-new-residential-service-request-v1`

## Context

[ADR 0002](0002-managed-home-service-receptionist-product-boundary.md) chooses independent residential plumbing and after-hours or overflow coverage, but it intentionally leaves the first executable workflow unresolved. The first workflow must test a result a plumbing operator may pay for without prematurely requiring a live voice route, field-service integration, outbound messaging, payment handling, or generalized agent platform.

Scoped Zoho CRM and Books capabilities were verified on 2026-08-05. That evidence does not make either system necessary or authorize a live write. Books has no role in this workflow. A future CRM or customer-system handoff remains a separate side effect with its own minimum-field, duplicate, idempotency, least-privilege, and readback contract.

This decision remains subordinate to the [legal and compliance control archive](../legal-compliance/README.md). It authorizes offline, synthetic product validation only. It does not authorize a live call, prospect-facing telephone demo, customer pilot, recording, transcript, transfer, callback, message, booking, dispatch, or production-system write.

## Decision

Sylvara will validate `after-hours-new-residential-service-request-v1` before building broader receptionist behavior.

The workflow covers only a new inbound residential-plumbing service request received during a customer-approved after-hours or overflow window. Its initial purpose is to determine whether bounded qualification and reliable disposition can create a sellable callback-capture service while keeping uncertainty and unsafe cases explicit.

The provider-neutral contract will classify synthetic requests using only these minimum facts:

- service-area eligibility band, without public customer or caller addresses;
- residential versus excluded property type;
- approved service category;
- a caller-stated, non-diagnostic symptom;
- active property damage as `yes`, `no`, or `unknown`; and
- preferred callback window;
- callback-contact status as `available`, `missing`, or `invalid`, plus an opaque synthetic contact reference when available; and
- a stable synthetic request key used only to evaluate duplicate and conflicting retry behavior.

Offline fixtures must never contain a real name, address, phone number, customer identifier, or production contact reference. The synthetic contact reference represents the minimum privacy-classified handoff fact; it does not authorize contact or reveal a destination.

Each evaluation must also supply one fictional synthetic operator profile and environment containing:

- coverage mode as `after_hours` or `overflow` and the synthetic coverage window state;
- named synthetic service-area eligibility bands;
- allowed and excluded property types and service categories;
- an explicit urgency and escalation table for the approved synthetic symptoms and damage states;
- human-route state as `available` or `unavailable`; and
- an injected queue result as `accepted`, `rejected`, or `ambiguous`.

Fixtures must not contain or infer a real customer's rules, schedule, service area, destination, contact details, or queue state. The deterministic evaluator receives both the synthetic request and this complete profile; a missing profile field ends in `unresolved_fallback` rather than an invented default.

Every evaluated request must end in exactly one disposition:

| Disposition | Meaning during offline validation |
|---|---|
| `eligible_callback_queue` | The request meets the approved synthetic eligibility rules and contains the minimum callback facts. No callback is sent. |
| `urgent_human_route_requested` | A bounded rule indicates that an approved human route would be requested. The result does not claim a completed transfer, diagnosis, emergency response, or dispatch. |
| `ineligible` | An explicit rule excludes the request. The evaluator records a reason code and performs no side effect. |
| `unresolved_fallback` | Required facts, classification, urgency, or downstream state are uncertain. The evaluator fails closed and performs no side effect. |

An identical retry with the same request key and normalized facts must return the original disposition with a duplicate marker and must not create a second queue item. Reuse of the same key with conflicting facts must end in `unresolved_fallback` with an identity-conflict reason. A missing or invalid callback contact cannot reach `eligible_callback_queue`.

The first implementation artifact, when separately requested, should be structured rules, a small explicit state machine, 25–30 synthetic scenarios, expected dispositions and reason codes, and a deterministic evaluator. Scenarios must cover ambiguity, spam, out-of-area requests, active damage, excluded hazards, missing or invalid callback contact, volunteered payment data, identical duplicate attempts, conflicting request-key reuse, unavailable human routing, and uncertain downstream writes. No voice-provider prompt is the authoritative contract.

## Exclusions

Version 1 excludes:

- existing-customer billing, warranty, rescheduling, cancellation, complaint, or account questions;
- commercial work and properties outside the approved residential boundary;
- gas, fire, electrical, medical, imminent-danger, or other excluded safety conditions;
- diagnosis, safety assurances, pricing, quotes, payment or card-data collection, and revenue estimates;
- live booking, dispatch promises, calendar or field-service writes, CRM writes, transfers, callbacks, SMS, or email;
- recording, retained transcription, production observability, and real caller data; and
- primary reception, multiple trades, a client portal, or a generalized voice-agent platform.

A known excluded condition ends in `ineligible` with an explicit limitation reason code and static limitation output. A condition that cannot be classified from the complete synthetic contract ends in `unresolved_fallback`. Neither path improvises a new workflow or performs a side effect.

## Why This Workflow Wins

This workflow reaches the core commercial question—whether after-hours service demand can be qualified and handed back reliably—with the smallest integration, privacy, legal, and support surface. It creates a reusable plumbing rule and outcome contract before vendor selection.

Direct booking was rejected for version 1 because authoritative availability, conflict handling, duplicate protection, idempotency, and independent readback are not yet specified for a customer system. Missed-call SMS was rejected because it adds a separate consent, template, opt-out, sender, and delivery-state workflow. Full receptionist coverage was rejected because it combines too many intents and exceptions to identify why validation succeeds or fails.

## Expansion Gates

Work advances in this order:

1. Confirm through documented plumbing-operator evidence that the bounded call types, dispositions, and callback outcome are operationally useful and commercially credible.
2. Complete the provider-neutral rules, state machine, synthetic scenarios, deterministic evaluation, and failure review.
3. Begin telephone-path testing only after the proposed internal-QA control profile receives every required separate approval and its exact environment is verified. Repository approval alone is insufficient.
4. Add one customer-system side effect only after its authoritative contract, least privilege, idempotency, ambiguous-timeout behavior, rollback, and independent readback are approved and tested.
5. Consider direct booking before any broader platform expansion, and only when qualified demand shows callback capture is insufficient but booking would preserve a viable offer.

## Kill Or Pivot Criteria

Stop this workflow rather than adding features when evidence shows any of the following:

- operators will not pay for the bounded callback outcome and a single approved booking integration does not materially change willingness to buy;
- customer rules cannot be represented without recurring one-off prompt customization;
- unresolved or human-exception handling prevents a reliable, supportable service;
- outcomes cannot be reconciled to the customer's authoritative booked or completed-job state;
- implementation and recurring support burden prevent durable contribution margin;
- the approved vendor, privacy, consent, disclosure, retention, and fallback chain cannot support the exact inbound workflow; or
- prospects require primary reception, multiple trades, or broad custom automation before the plumbing workflow is repeatable.

Private thresholds, interviews, account evidence, economics, and decision ownership remain in the approved private operating system. A repository test pass is not demand proof.

## Consequences

The decision gives Codex one bounded contract to implement and test later, and every observed failure can become a regression scenario. It intentionally postpones a more impressive demo in exchange for clearer commercial learning and lower support risk. Provider, price, live human destination, integration, offer, pilot, and production deployment remain undecided and unauthorized.
