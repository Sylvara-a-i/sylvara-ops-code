# Zoho Catalyst Standard

## Status

- Repository standard: **Proposed**
- Sylvara Catalyst organizations, projects, environments, routes, functions, pipelines, variables, and deployments: **Unknown**

Use Catalyst only when a defined integration needs controls that a managed connector cannot safely provide. Zoho documents [Catalyst resource deployment](https://docs.catalyst.zoho.com/en/cli/v1/deploy-resources/introduction/) and [function implementation and variables](https://docs.catalyst.zoho.com/en/serverless/help/functions/implementation/). Product capability does not establish a live Sylvara project or authorize deployment.

## Ownership

Catalyst may own verification, payload normalization, idempotency claims, durable retry state, API mediation, and approved middleware release artifacts. It does not own CRM relationships, Billing subscriptions, Books accounting facts, WorkDrive documents, legal execution state, or Mail delivery policy.

Each function must belong to one integration and one business outcome. Do not create a generalized integration platform when a smaller managed workflow is sufficient.

## Runtime Controls

Every externally reachable workflow must:

- authenticate the caller and verify signatures and timestamps before parsing business data;
- allowlist method, route, content type, payload fields, size, and supported event versions;
- reject unknown fields where practical and minimize stored data;
- derive or validate a stable idempotency key before side effects;
- claim that key atomically or through durable conditional state;
- use explicit timeouts, bounded retries, deterministic ordering, and backoff;
- distinguish retry-safe failures from ambiguous outcomes;
- persist only the minimum durable state needed for recovery and audit; and
- avoid logging secrets, signatures, raw payloads, response bodies, PII, document content, or financial data.

Development and Production must use separate configuration, credentials, routes, storage, and approval paths. Environment variables belong in the approved Catalyst secret/configuration surface, not GitHub.

## Release Controls

- Build and test from a reviewed immutable source revision.
- Confirm the exact organization, project, environment, active deployment, and release role before action.
- Record the current and proposed artifact references and configuration shape without publishing private values.
- Deploy to Development first and complete synthetic smoke tests.
- Treat production promotion as a separate approved action; a Development deployment is not production deployment.
- Keep release and break-glass credentials separate from routine audit access.
- Prepare rollback or safe containment before promotion.
- Read deployment, route, function, pipeline, and downstream state back after every live action.

## Repository Boundary

GitHub owns sanitized function source, tests, dependency manifests, API contracts, architecture decisions, and runbooks. GitHub does not own live variables, tokens, secrets, project or deployment IDs, private routes, raw logs, production payloads, data-store exports, or proof of deployment.

Archived Catalyst artifacts remain non-authoritative until their source, dependencies, environment assumptions, tests, and deployment path are revalidated.

## Failure And Readback

Fail closed on identity or environment mismatch, invalid or stale signature, unsupported event version, missing idempotency protection, duplicate claims with conflicting payloads, unknown target, unavailable prerequisite, malformed downstream response, stale state, rate limit, or ambiguous write result.

Do not acknowledge an external event as complete before the durable downstream outcome is known. After a side effect, read the authoritative downstream system independently. After a release action, read the actual deployment and route state; do not infer success from a pipeline or transport status alone.

## Validation

Required synthetic or Development coverage includes:

- valid, invalid, missing, expired, and replayed signatures;
- supported, unsupported, oversized, malformed, and unknown-field payloads;
- first execution, exact replay, and conflicting duplicate keys;
- downstream success, rejection, rate limit, timeout before commit, and timeout after possible commit;
- durable retry recovery after process restart;
- redaction and log-safety checks;
- Development deployment, invocation, route, and downstream readback; and
- rollback or containment from a known prior artifact.

Production promotion and break-glass exercises require separately scoped approval.

## Manual Setup

All live setup is currently **Unknown**. Before deployment, verify or configure:

- the intended organization, project, data center, Development and Production environments, and roles;
- secret and variable names in the private platform configuration;
- API Gateway routes, authentication, size limits, and allowlists;
- durable idempotency and retry storage with retention and access controls;
- audit, release, and break-glass identities and narrowly scoped permissions;
- pipeline, promotion, rollback, monitoring, and incident procedures; and
- independent downstream readback and a private deployment record.
