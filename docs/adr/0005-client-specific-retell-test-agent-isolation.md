# ADR 0005: Client-Specific Retell Agent Isolation For Live Seven-Day Tests

- Status: Accepted as the current architecture decision
- Date: 2026-08-18
- Clarifies: [ADR 0004](0004-retell-catalyst-crm-analytics-integration-boundary.md)
- Deployment status: Documentation only; no Retell, Catalyst, CRM, number, route, or customer configuration changed

## Context

Two different concepts were being described with the phrase "the seven-day test agent":

1. one reusable authoring master from which Sylvara starts each implementation; and
2. the live Retell agent that actually handles one company's forwarded calls during its seven-day test.

Those are not the same object. One reusable master is appropriate. One shared live agent handling calls for multiple companies is not appropriate for the current Sylvara architecture.

The current public architecture already requires one dedicated Retell client agent per environment and one client per active agent mapping. This decision makes that isolation rule explicit so it cannot be misread as permission to send multiple clients through one shared live test agent.

## Evidence Reviewed

### Official Retell Capability

Retell supports a shared-agent design only when a pre-call resolver is deliberately implemented. Its inbound-call webhook is configured per phone number and can override the agent or version and inject dynamic variables and metadata before the call connects. The endpoint has a ten-second response window and Retell may retry a failed request. If the webhook ultimately fails and the number has an inbound agent configured, Retell can fall back to that assigned agent.

Retell also provides immutable published agent versions and per-agent environment tags. The default tags are `prod` and `staging`; tags point phone numbers and other integrations to a selected version and can inject environment-specific dynamic variables. They are deployment controls inside one agent, not a durable customer-tenancy boundary.

Official references:

- [Inbound call and SMS webhook](https://docs.retellai.com/features/inbound-call-webhook)
- [Dynamic variables](https://docs.retellai.com/build/dynamic-variables)
- [Agent versioning and environment tags](https://docs.retellai.com/agent/version)
- [Receive inbound calls](https://docs.retellai.com/deploy/inbound-call)
- [Call-event webhook overview](https://docs.retellai.com/features/webhook-overview)

### Current Sylvara Repository Evidence

[ADR 0004](0004-retell-catalyst-crm-analytics-integration-boundary.md) already says to create one dedicated Retell agent per client per environment, never bind the master template to a client, and never share one live agent across clients. The reporting runbook also requires one client per active agent and a fail-closed result when a mapping is missing or conflicting.

The exact deployed Catalyst resolver order and the exact `ROUTE_AMBIGUOUS` implementation were not independently read from deployed source during this review. They remain **Unknown** at the public-repository evidence layer. The reported behavior is consistent with this decision, but this ADR does not present an inaccessible code path as independently verified.

## Decision

### Master Template

Maintain one private, reusable, versioned free-test master.

The master:

- is an authoring and cloning baseline;
- contains only sanitized reusable plumbing logic;
- must not receive live client calls;
- must not be bound to a client phone number or forwarding route;
- must not have an active Catalyst client deployment mapping; and
- must not contain a real client's company data, transfer number, fallback number, service area, hours, or recipients.

A suitable public label is:

```text
Sylvara Plumbing 7-Day Test — Master Template
```

### Client Test Agent

For every company whose real calls enter a seven-day test, create one client-specific Retell agent in the approved environment from a pinned master version.

A suitable public naming pattern is:

```text
<Client> — Plumbing 7-Day Test
```

The client-specific agent must have:

- one stable Retell `agent_id`;
- one active Catalyst deployment mapping;
- one stable internal `client_id`;
- one approved capability profile, initially `plumbing_free_test_v1` or its approved successor;
- one pinned published agent version or approved environment-tag reference;
- one client-specific number or approved forwarding route;
- one approved configuration version;
- client-specific business rules and destinations; and
- a tested prior route or other rollback target.

An active Retell `agent_id` must resolve to exactly one active client deployment. A missing or multiple match must fail closed and be quarantined under the implementation's approved ambiguity code, whether that code is named `ROUTE_AMBIGUOUS` or another reviewed equivalent.

### Conversion To Paid Service

Do not create both a free-test agent and a paid agent for every client by default.

When a client converts, prefer to keep the same client-specific Retell agent and promote it through a new immutable version and approved environment tag when all of the following remain true:

- the environment and security boundary are unchanged;
- the client identity and phone route are unchanged;
- the new capability profile is separately reviewed;
- the previous accepted version remains available for rollback; and
- Catalyst records the new configuration and capability version.

Create a separate paid-service agent only when a real environment, contractual, rollback, provider, data, or capability-isolation requirement justifies it. This prevents unnecessary drift while preserving one client per active agent.

### Environment Tags

Use environment tags for environments and release lanes, such as:

```text
staging
prod
```

Do not use tags such as `client-a`, `client-b`, or one tag per customer as the tenancy model. Tags are limited per agent, move between versions, and inject environment-specific values. They are not an access-control boundary and do not eliminate the need for a unique client deployment mapping.

## Why This Wins

### Correct Client Behavior Before Catalyst

The voice agent needs the correct company name, services, service area, business hours, urgency rules, transfer destination, fallback destination, disclosure, and callback expectations before or during the live conversation. A post-call processor cannot repair a call that already used another company's configuration.

### Deterministic Routing

A one-to-one active agent-to-client mapping makes Retell `agent_id` a safe routing signal and preserves explicit deployment identity as defense in depth. Sharing one agent creates ambiguity whenever deployment metadata is missing, delayed, malformed, or not injected before the call.

### Smaller Blast Radius

A bad prompt version, transfer number, service-area rule, knowledge source, or provider setting affects one client instead of every active test.

### Cleaner QA And Reporting

Client-specific agents keep versions, call history, test evidence, phone assignments, QA samples, alerts, and report reconciliation attributable to one company.

### Simpler Rollback

Each client can return to its prior agent version or prior phone route without changing another client's calls.

### Lower Current Complexity

Cloning a pinned master is operationally simpler than building a highly available multi-tenant pre-call configuration service before paid demand proves that the extra critical-path dependency is necessary.

## Rejected Alternative: One Shared Live Test Agent

A shared live multi-client agent is rejected for the current stage.

It would become acceptable for reconsideration only after Sylvara has implemented and validated all of the following:

1. a per-number inbound-call webhook or equivalent pre-call resolver;
2. deterministic phone-route-to-deployment resolution;
3. explicit `deployment_id`, `client_id`, configuration version, and capability profile injection before connection;
4. complete validated client configuration injection rather than mutable prompt defaults;
5. fail-closed behavior with no cross-client fallback when the resolver is unavailable;
6. bounded latency and availability that fit Retell's inbound-webhook timeout;
7. replay, duplicate, stale-state, and conflicting-route controls;
8. independent readback proving the selected client and configuration for every test call;
9. per-client QA, reporting, retention, and deletion isolation; and
10. measured evidence that client-specific cloning creates more operating cost than the resolver saves.

Until those gates are met, a shared live agent is premature abstraction and an avoidable cross-client risk.

## Routing And Data Rules

- Treat explicit deployment identity as the strongest route when it is securely injected and validated.
- Preserve the existing call-to-deployment mapping for later lifecycle events.
- Require the provider agent identifier to resolve to one active deployment.
- Use the called-number or normalized route only as a bounded, independently validated fallback.
- Never infer a client from company name, prompt text, caller statements, mutable display labels, or an environment tag.
- Quarantine zero-match, multiple-match, conflicting-identity, and stale-configuration events.
- Never silently select the first matching deployment.
- Keep the master template outside active routing and reporting datasets.

## Provisioning Sequence

For each approved seven-day test:

1. qualify and authorize the test in CRM;
2. freeze one approved master version;
3. clone a client-specific Retell agent;
4. apply the approved client configuration;
5. publish and pin the accepted version;
6. create the one-to-one Catalyst deployment mapping;
7. assign the client-specific Retell number or forwarding route;
8. run synthetic and controlled test calls;
9. prove the post-call event resolves to exactly one client;
10. prove the report contains exactly one client; and
11. preserve and test the rollback route before activation.

At the end of the test, disable or roll back the route if the client does not convert. Preserve only the approved operational and audit evidence under the applicable retention policy.

## Acceptance Criteria

The topology is accepted only when:

- one reusable master exists and has no live number route;
- every active client test has its own Retell `agent_id`;
- every active agent maps to exactly one active client deployment;
- no active client deployment shares an agent identifier with another client;
- the assigned number or forwarding route points to the intended client agent and pinned version;
- client-specific variables and destinations are correct before the call begins;
- Catalyst resolves each event to one deployment without ambiguity;
- QA and reporting contain one client only;
- the prior route and prior accepted version can be restored; and
- no live activation occurs without the separate legal, privacy, vendor, environment, and production approvals.

## Consequences

Sylvara will have more Retell agent records, but the additional objects are cheap compared with the cost of one cross-client call, transfer, report, or rollback failure. The operating burden is controlled by a pinned master, standardized configuration, automated provisioning where justified, and versioned promotion—not by sharing one live agent before the required resolver exists.

This decision does not authorize a live seven-day test. It defines the required isolation model for a separately approved test.