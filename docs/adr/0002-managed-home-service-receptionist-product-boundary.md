# ADR 0002: Managed Residential Plumbing Receptionist Product Boundary

- Status: Accepted for validation
- Date: 2026-08-04

## Context

Generic call answering, transfers, frequently asked questions, and basic scheduling are insufficient foundations for a durable Sylvara product. They are capabilities that established voice, communications, and self-service platforms can supply. Building a proprietary voice model or a horizontal automation agency would consume capital and founder attention without creating a repeatable customer outcome.

Sylvara needs one initial audience, one operational problem, and one controlled delivery model. A private strategy review recommended residential-plumbing call conversion as the strongest first validation path within home services. Its private research, vendor comparisons, commercial models, source material, and detailed roadmap are not publication evidence and remain outside this public repository.

This strategy is subordinate to the [AI Receptionist Legal And Compliance Control Archive](../legal-compliance/README.md). The only current telephone proposal is controlled internal non-sales QA; this decision does not authorize a prospect-facing telephone demonstration, client pilot, or production call.

## Decision

Sylvara will use the following boundary for product and technical work during validation:

1. Focus first on independent residential plumbing companies in Kansas City with meaningful inbound-call and dispatch needs.
2. Begin with after-hours and overflow workflows before accepting primary reception responsibility. Evaluate missed-call follow-up only through its separate consent, messaging, and readback gate.
3. Deliver a managed productized service that qualifies, books, routes, records, or safely escalates eligible calls according to approved customer rules.
4. Measure completed operational outcomes and reconcile them with the customer's authoritative system; do not treat calls answered or estimated value as proof of revenue.
5. Store critical business rules in validated structured configuration or code rather than relying only on prompts.
6. Keep telephony, voice runtime, Sylvara workflow logic, data, and customer integrations modular enough to replace a vendor without redesigning the product.
7. Use progressive deployment, bounded human exception handling, quality review, fallback routing, and explicit rollback before expanding call coverage.
8. Defer other home-service trades, property management, and unrelated verticals until the residential-plumbing operating template is repeatable and a separate reviewed decision authorizes expansion.
9. Reject custom work that does not advance a reusable supported workflow or justify its implementation and maintenance burden.

The detailed operating contract is [Managed Receptionist Product Direction](../product/README.md).

## Consequences

### Positive

- Engineering and sales-support work share one audience and outcome.
- After-hours and overflow deployment reduces initial customer and operational risk.
- Structured rules, outcome reconciliation, and quality review create value beyond access to a voice model.
- Vendor boundaries reduce dependence on one runtime or communications provider.
- A productized scope makes implementation effort, support load, failure rates, and customer value measurable.

### Costs

- Sylvara must decline otherwise available custom projects and simultaneous vertical expansion.
- Managed quality assurance and exception handling require operating discipline before they scale.
- Customer-system integrations introduce authorization, data-quality, idempotency, and readback obligations.
- Outcome attribution is harder than reporting call counts and must distinguish estimates from completed work or collected revenue.
- The initial geographic and vertical focus limits the near-term prospect pool by design.

## Rejected Alternatives

### Generic AI Receptionist

Rejected because generic voice features do not provide a durable implementation, workflow, quality, or outcome advantage.

### Broad Custom-Automation Agency

Rejected as the default model because unrelated projects create inconsistent scope, founder dependency, and weak reuse. A separately priced project is acceptable only when it strengthens the supported vertical product.

### Simultaneous Multi-Vertical Launch

Rejected because plumbing, other home-service trades, property management, healthcare, legal, and other industries have materially different workflows, integrations, escalation risks, and compliance requirements.

### Proprietary Voice Or Telephony Platform

Rejected during validation because managed providers can supply those layers while Sylvara validates workflow and customer value. Portability is required; premature infrastructure ownership is not.

### Internal Human Call Center

Rejected during validation because unbounded human coverage would replace a repeatable managed automation service with a labor-intensive answering service. Human participation remains limited to defined exceptions and approved coverage.

## Review Triggers

Amend or replace this decision when validated customer evidence shows that:

- the residential-plumbing problem or initial coverage mode does not create measurable value;
- delivery effort, exception labor, or acquisition cost prevents a durable managed service;
- another workflow or vertical consistently produces stronger retention and repeatability;
- a provider boundary prevents safe operation or portability; or
- legal, privacy, payment, recording, or platform constraints materially change the permitted service.

Research, a repository merge, or an enthusiastic pilot conversation alone is not sufficient evidence to expand the boundary.
