# ADR 0006: Shared Seven-Day Monitor With Client Number Isolation

- Status: Accepted as the current architecture decision
- Date: 2026-08-18
- Supersedes: [ADR 0005](0005-client-specific-retell-test-agent-isolation.md)
- Clarifies and supersedes: the agent-lifecycle and evaluation-to-paid-agent sections of [ADR 0004](0004-retell-catalyst-crm-analytics-integration-boundary.md)
- Deployment status: Documentation only; no Retell, Catalyst, CRM, Analytics, phone number, forwarding route, or customer configuration changed

## Context

Sylvara has two different agent products with different purposes:

1. the **Seven-Day Call-Gap Monitor**, which receives only the approved after-hours or no-answer/overflow calls needed to measure the call gap and produce evidence; and
2. the **Revenue Desk**, which is the separately approved paid operational agent that handles the bounded receptionist and front-office workflow.

The monitor and Revenue Desk do not need to be the same Retell agent. The key design question is whether every test client needs a cloned monitor agent or whether one shared monitor can remain cleanly partitioned.

Retell provides two capabilities that make the smaller shared-monitor design viable:

- every purchased or imported Retell number can have its own inbound-agent and inbound-webhook configuration; and
- the inbound-call webhook always provides `to_number` and can override the agent or version and inject call-specific metadata and dynamic variables before the call connects.

A unique Retell number therefore provides a stable client route even when multiple numbers use the same monitor agent. One shared Retell number would not provide that isolation because `to_number` would be identical for every client and `from_number` identifies the caller rather than the contractor.

This is a narrow routing service for the validated acquisition workflow, not a generalized multi-tenant voice platform. If the required isolation cannot be proven with two synthetic clients, Sylvara will use client-specific monitor clones rather than expand an unsafe abstraction.

## Decision Summary

Use one shared monitor agent, one dedicated Retell number and deployment per active test client, and one dedicated Revenue Desk agent per converted client.

```text
Client A Public Number                      Client B Public Number
        | after-hours / no-answer                    | after-hours / no-answer
        v                                             v
Client A Dedicated Retell Number           Client B Dedicated Retell Number
        |                                             |
        +--------------- same inbound resolver ------+
                              |
                              v
                 Shared Seven-Day Monitor Agent
                              |
                              v
               Catalyst Post-Call And Reporting Path
```

After conversion:

```text
Client A Public Number
        |
        v
Client A Existing Dedicated Retell Number
        |
        v
Client A Dedicated Revenue Desk Agent
```

The client keeps the same forwarding destination. Sylvara changes the agent bound behind the client-specific Retell number after the Revenue Desk clone passes its separate approval and acceptance gates.

## Agent Roles

### Shared Seven-Day Call-Gap Monitor

Maintain one versioned shared monitor agent for the approved environment.

A suitable public label is:

```text
Sylvara Plumbing — Seven-Day Call-Gap Monitor
```

The monitor:

- may receive calls from multiple dedicated client Retell numbers;
- handles only the approved temporary call-gap measurement workflow;
- uses one generic, fail-safe baseline rather than persistent client-specific defaults;
- receives approved client context per call through the inbound resolver;
- performs only the approved minimal disclosure, capture, classification, and post-call analysis needed for the test;
- does not book, dispatch, quote, collect payment, send outbound messages, or use client operating-system tools;
- does not act as the Revenue Desk;
- does not use Retell `agent_id` as the client-tenancy key; and
- remains versioned so one accepted release can be pinned and rolled back.

No client receives direct access to the shared Retell agent history. Client reporting is produced from the partitioned Catalyst and Analytics records.

### Revenue Desk Master And Client Clones

Maintain one reusable Revenue Desk master that never receives client traffic directly.

A suitable public label is:

```text
Sylvara Plumbing — Revenue Desk — Master
```

When a client converts:

1. clone the Revenue Desk master into one client-specific Revenue Desk agent;
2. apply the approved client configuration, tools, destinations, and operating rules;
3. publish and pin the accepted version;
4. run the separate synthetic and controlled acceptance suite;
5. rebind the client's existing Retell number to the client-specific Revenue Desk agent; and
6. preserve the monitor test deployment and report as historical evidence under the approved retention policy.

The monitor and Revenue Desk remain separate agents because they have different purposes, permissions, integrations, risk, and rollback behavior.

## Client Number Boundary

Every active test client receives one dedicated Retell number or an equivalent imported number controlled by the same routing contract.

The client's existing public number forwards only the approved after-hours or no-answer/overflow calls to that client-specific Retell number.

Required rules:

- one active client deployment per Retell `to_number`;
- no active Retell number shared by two clients;
- the Retell number is private forwarding infrastructure, not the client's advertised public number;
- all approved client numbers may use the same shared monitor agent;
- all approved client numbers may use the same inbound-webhook endpoint;
- the number remains with the client deployment through the test-to-paid conversion when practical; and
- number release, reassignment, or deletion requires the applicable retention, rollback, and authorization controls.

The additional number is intentional. It is the stable client-routing boundary that allows the monitor agent and Catalyst infrastructure to be shared safely.

## Inbound Resolver

Use one Catalyst endpoint for all approved client numbers. Do not build one webhook implementation per client.

```text
POST /retell/inbound
```

For each inbound request, Catalyst must:

1. authenticate the Retell request under the approved verification contract;
2. validate `to_number` and reject malformed input;
3. resolve `to_number` to exactly one active deployment;
4. verify the deployment is inside its approved test window and call limit;
5. return the approved shared monitor agent and pinned version or environment tag;
6. inject only the allowlisted metadata and string dynamic variables required for that call;
7. record a bounded resolver result without caller or client PII in ordinary logs; and
8. fail closed on zero matches, multiple matches, conflicting status, stale configuration, or an unauthorized test window.

Proposed metadata:

```text
client_id
deployment_id
configuration_version
engagement_type
capability_profile
coverage_mode
resolver_status
```

Proposed dynamic variables are limited to the client context actually required by the monitor, such as an approved company label, time zone, test mode, and disclosure text. Secrets, credentials, internal URLs, raw phone-system configuration, and unnecessary client data never belong in metadata or dynamic variables.

## Resolver Failure And Fallback

Each client number may keep the shared monitor as its default inbound agent so Retell can fall back when the inbound resolver times out or fails.

The fallback monitor configuration must be neutral:

- no client-specific company claim;
- no client-specific transfer or fallback destination;
- no booking, dispatch, quote, payment, outbound message, or external-system tool;
- no client-specific service-area or schedule claim; and
- no assumption that resolver metadata is present.

Because the Retell number remains unique, the post-call processor can still resolve the client by `to_number`. The call must be marked with a degraded or missing-resolver status and routed to review. A resolver failure must never cause one client's variables or destinations to be reused for another client.

A stricter disconnect-on-resolver-failure policy may be selected later if legal, privacy, or workflow requirements make a neutral fallback unacceptable. That is an environment-specific deployment decision, not a prompt default.

## Post-Call Routing Order

For the shared monitor, Catalyst resolves call ownership in this order:

1. validated explicit `deployment_id` from Retell call metadata;
2. the existing immutable call-to-deployment binding for later lifecycle events;
3. the unique Retell `to_number` mapping;
4. Retell `agent_id` only when that agent maps to exactly one active deployment.

The shared monitor `agent_id` intentionally maps to multiple deployments and is therefore not a valid client-routing key. The processor must not quarantine a call merely because the shared monitor agent has multiple deployments when a validated deployment ID, existing call binding, or unique `to_number` resolves exactly one client.

Zero matches, multiple matches, conflicting identifiers, stale mappings, and unauthorized test windows are quarantined. The processor never silently selects the first match.

## Reporting Contract

The reporting key is:

```text
client_id + deployment_id + call_id
```

Every normalized call and analytical fact must carry the resolved client and test deployment. Reports are filtered by the approved client, deployment, and test window—not by the shared monitor agent alone.

Acceptance requires:

- one client per report;
- exact source-to-Analytics call-count reconciliation;
- one active deployment per Retell number;
- no cross-client metadata, dynamic variables, transcript, artifact, or report row;
- a visible resolver and data-watermark status; and
- manual review before the first client report is delivered.

The shared Retell agent's dashboard history is an operator surface, not the client reporting boundary.

## Conversion Flow

1. Close the seven-day test window and freeze the reconciled report.
2. Disable new test handling for the deployment while preserving evidence.
3. Clone the client-specific Revenue Desk agent from the approved Revenue Desk master.
4. Configure and test the paid workflow separately.
5. Verify the prior phone route and shared-monitor binding remain available for rollback.
6. Rebind the client's existing Retell number to the accepted Revenue Desk agent and version.
7. Retain the same inbound resolver when it is needed for explicit deployment identity and per-call context.
8. Run controlled calls and independently read back the number, agent, version, Catalyst deployment, and downstream state.
9. Activate only after the exact live route receives separate approval.

The client should not need to change its forwarding destination again merely because the agent behind the Retell number changed.

## Validation Gate

Before the shared monitor is used for a client test, prove the topology with at least two synthetic clients and two dedicated Retell numbers.

The test must prove:

1. both numbers reach the same pinned monitor version;
2. each `to_number` resolves to exactly one deployment;
3. each call receives the correct metadata and dynamic variables;
4. a resolver timeout or failure uses only the neutral fallback and records degraded status;
5. post-call events resolve correctly without treating shared `agent_id` as the client key;
6. duplicate, stale, conflicting, and out-of-window events fail closed;
7. Catalyst and Analytics contain no cross-client rows or artifacts;
8. each report contains one client only;
9. one synthetic client's number can be rebound to a dedicated Revenue Desk clone without changing the client's forwarding destination; and
10. the prior monitor binding or prior route can be restored.

If any isolation, fallback, reconciliation, or rollback test fails, stop the shared-monitor deployment and use one monitor clone per client until the defect is corrected and the complete test passes.

## Rejected Alternatives

### One Shared Retell Number

Rejected because the called `to_number` would be identical for every client and the caller's `from_number` does not identify the contractor. Optional forwarding headers are not a sufficient tenancy contract.

### One Monitor Clone Per Client As The Default

Rejected as the default because unique client numbers and a bounded inbound resolver provide deterministic identity without duplicating a low-capability monitor agent. Per-client clones remain the containment fallback if the shared topology fails acceptance.

### Convert The Monitor Into The Revenue Desk

Rejected because the acquisition monitor and paid Revenue Desk have different permissions, tools, operating rules, integrations, risk, and rollback requirements.

### Build A General Multi-Tenant Voice Platform

Rejected. The only approved abstraction is one number-to-deployment resolver and one reporting partition directly required by the current offer. A generalized tenant administration platform, customer portal, arbitrary agent provisioning framework, or broad configuration service remains deferred until repeated paid demand proves it necessary.

## Consequences

This decision reduces Retell agent duplication while preserving client isolation through the number and deployment records. It adds one critical pre-call resolver, but the resolver is narrow, deterministic, reusable, and directly tied to the free-test acquisition workflow.

Each client still incurs one Retell number and one deployment record. Converted clients receive one dedicated Revenue Desk agent. The architecture must be proven through synthetic two-client isolation, resolver-failure, report-reconciliation, conversion, and rollback tests before any live client route.

This decision does not authorize a live seven-day test, recording, transcription, forwarding change, number purchase, customer report, or Revenue Desk activation.

## Official References

- [Retell inbound-call webhook](https://docs.retellai.com/features/inbound-call-webhook)
- [Retell dynamic variables](https://docs.retellai.com/build/dynamic-variables)
- [Retell receive inbound calls](https://docs.retellai.com/deploy/inbound-call)
- [Retell purchase phone number](https://docs.retellai.com/deploy/purchase-number)
- [Retell update phone number](https://docs.retellai.com/api-references/update-phone-number)
- [Retell agent versioning and environment tags](https://docs.retellai.com/agent/version)
- [Retell call-event webhook overview](https://docs.retellai.com/features/webhook-overview)
