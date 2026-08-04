# Zoho Catalyst Platform Reference

- **Reference ID:** `SYLVARA-ZOHO-CATALYST-REFERENCE`
- **Research cutoff:** 2026-07-20
- **Repository status:** Reference only
- **Sylvara adoption:** Unknown
- **Effective project, environment, permissions, and connector access:** Unknown

## Status And Scope

This handbook summarizes durable Catalyst platform behavior for middleware, webhook, API, storage, scheduling, and deployment design. It is not proof of a project, function, route, environment, secret, deployment, or production capability.

Official documentation establishes platform capability. Effective use requires current project and environment binding, role permission, enabled component, region support, authenticated acceptance, and independent readback.

## Platform Model

Catalyst is a cloud application platform. Relevant component families include:

- Serverless Functions for event, integration, and Advanced I/O execution;
- AppSail for supported long-running application services;
- API Gateway for routing, authentication, throttling, and policy enforcement;
- Data Store, NoSQL, ZCQL, File Store, Stratus, and Cache for state and content;
- Authentication and User Management for application identity;
- Cron, Event Listeners, Circuits, Job Scheduling, and Signals for asynchronous work;
- Mail and web-client hosting for bounded application needs; and
- Pipelines, CLI, and repository integration for build and release workflows.

Catalyst can mediate verification, normalization, idempotency, retries, and API access. It must not become a second CRM, subscription, accounting, or document source of truth.

## Authentication, Regions, Data Centers, And Scopes

- Catalyst projects and components are environment- and region-sensitive.
- Keep Development and Production isolated; do not treat a Development result as production evidence.
- Management APIs, runtime SDKs, application users, service principals, Connections, and inbound webhook callers have different authentication models.
- Request only the component scopes and project roles required by the workflow.
- Store tokens, private keys, connection secrets, webhook secrets, and environment values in approved secret configuration.
- Do not embed private endpoints, project identifiers, connection names, or secret-bearing URLs in source or logs.
- Verify runtime version, component availability, quotas, timeouts, payload limits, and region support before choosing an execution model.

## Core Resources And Tasks

### Compute And Routing

- Use Functions for bounded event-driven work with explicit input, timeout, memory, and retry expectations.
- Use AppSail only when its process model and operational overhead are justified.
- Define API Gateway routes explicitly by method, path, authentication, validation, throttling, and backend.
- Use Circuits for governed multi-step orchestration with clear state and compensating behavior.

### State And Content

- Choose Data Store or NoSQL from query, consistency, indexing, access-pattern, and transaction requirements.
- Use ZCQL only within its documented syntax and limitations.
- Use File Store or Stratus for approved binary content with explicit access, retention, CORS, and version behavior.
- Use Cache only for disposable acceleration; never make it the sole idempotency or business ledger.
- Apply least-privilege component permissions and server-side authorization for every data access path.

### Events And Background Work

- Cron and Job Scheduling support time-based or queued work, subject to current limits.
- Event Listeners consume component events; delivery semantics and payload contracts require current verification.
- Circuits and jobs must persist enough durable state to resume, reconcile, or safely stop.
- Keep event order, duplicate handling, poison-message behavior, and retry exhaustion explicit.

## Webhook Gateway Pattern

A secure inbound webhook path should:

1. accept only the expected method, content type, route, and body size;
2. capture exact request bytes only as long as signature verification requires;
3. verify provider authenticity, timestamp, replay window, and required headers before parsing business fields;
4. validate a strict allowlisted schema and reject ambiguous identity;
5. derive a stable event key and claim it atomically in durable storage;
6. retrieve authoritative upstream state when the event is incomplete or order-sensitive;
7. apply one bounded downstream action with explicit timeouts and response validation;
8. persist outcome, attempt count, and sanitized error class;
9. acknowledge only according to the verified provider retry contract; and
10. expose a controlled replay or recovery path that cannot bypass verification.

Never log raw bodies, signatures, tokens, private headers, customer data, accounting data, or full downstream responses.

## Automation And Deployment

- Keep component configuration, environment variables, route definitions, source revision, and release evidence versioned without secret values.
- Build immutable artifacts and promote reviewed revisions rather than editing Production ad hoc.
- Validate CLI and pipeline behavior against the active Catalyst CLI and runtime version.
- Require a deployment plan, smoke test, monitoring window, rollback or disable path, and exact post-deploy readback.
- Use separate release and emergency authorities when the operating model requires them.
- Restrict repository integrations to the intended repository and minimum permissions.
- Treat a successful build as distinct from deployment, route activation, runtime health, and business success.

## Failure, Retry, And Idempotency

Classify validation, authentication, authorization, rate-limit, quota, dependency, timeout, partial, stale-state, duplicate, poison-event, deployment, and ambiguous-outcome failures.

- Use explicit connect and response timeouts for outbound calls.
- Retry only transient, demonstrably safe operations with bounded backoff and jitter.
- Do not retry an ambiguous downstream mutation until authoritative readback resolves it.
- Store idempotency claims durably and atomically; process memory and cache are insufficient.
- Make every retry observe the prior attempt and return the established outcome when already complete.
- Quarantine or alert exhausted events without leaking their content.
- Prefer compensating actions over destructive rollback when an external side effect cannot be reversed safely.

## Validation And Change Control

In Development, validate:

- project, environment, region, component, role, scope, runtime, quotas, and enabled services;
- route authentication, method/path allowlists, body limits, schema validation, and CORS where relevant;
- valid, invalid, expired, replayed, duplicate, delayed, and out-of-order webhook delivery;
- atomic idempotency under concurrent requests;
- downstream rate limits, timeouts, malformed responses, and ambiguous success;
- job retry, poison-event, recovery, and replay behavior;
- secret redaction and privacy-safe logs;
- build, deploy, smoke test, monitoring, rollback or disable, and independent readback; and
- exact source revision and private deployment evidence.

Repository review is not authorization to create, deploy, route, schedule, configure, or invoke a live Catalyst resource.

## Official Sources

- [Catalyst REST API overview](https://docs.catalyst.zoho.com/en/api/introduction/overview-and-prerequisites/)
- [Functions](https://docs.catalyst.zoho.com/en/serverless/help/functions/introduction/)
- [AppSail](https://docs.catalyst.zoho.com/en/serverless/help/appsail/introduction/)
- [API Gateway](https://docs.catalyst.zoho.com/en/cloud-scale/help/api-gateway/introduction/)
- [Connections](https://docs.catalyst.zoho.com/en/cloud-scale/help/connections/introduction/)
- [Data Store](https://docs.catalyst.zoho.com/en/cloud-scale/help/data-store/introduction/)
- [Authentication](https://docs.catalyst.zoho.com/en/cloud-scale/help/authentication/introduction/)
- [Event Listeners](https://docs.catalyst.zoho.com/en/cloud-scale/help/event-listeners/introduction/)
- [Job Scheduling](https://docs.catalyst.zoho.com/en/job-scheduling/getting-started/introduction/)
- [Pipelines](https://docs.catalyst.zoho.com/en/pipelines/getting-started/introduction/)
- [CLI deployment](https://docs.catalyst.zoho.com/en/cli/v1/deploy-resources/introduction/)

## Exclusions

This reference contains no project, environment, function, route, table, bucket, user, pipeline, repository integration, connection, private endpoint, secret, schedule, production payload, deployment status, or live capability claim. Revalidate component names, regions, runtimes, quotas, limits, authentication, and delivery semantics before implementation.
