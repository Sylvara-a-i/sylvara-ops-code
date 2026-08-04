# Deluge Engineering Standard

## Status

- Repository standard: **Proposed**
- Official capability evidence: current Deluge task and statement documentation, subject to owning-product verification
- Sylvara functions, connections, schedules, runtime limits, deployments, and effective permissions: **Unknown**

This standard defines portable engineering behavior. It does not prove that a function imports, saves, is connected, is scheduled, or is deployed in any Zoho environment.

## Objective

Deluge functions must be importable, readable, fail-closed, and owned by one Zoho product and one business workflow. This standard applies to CRM functions, Books custom functions, Creator workflows, and cross-product integration tasks.

Do not copy another organization's field names, connection names, IDs, endpoints, schedules, fee rules, or transaction logic into Sylvara.

## Ownership

Deluge is an execution language, not a system of record. Each function must have one owning Zoho product and one bounded business workflow. CRM, Books, Billing, Creator, WorkDrive, or another approved product retains ownership of its authoritative state; Deluge may validate, coordinate, or mutate that state only through an explicitly approved contract.

Cross-product orchestration must define direction, conflict handling, duplicate ownership, and the authoritative readback system. A Deluge function must not create a second accounting, subscription, relationship, document, or legal source of truth.

## Required File Header

Each function must document:

- owning Zoho product and workflow;
- trigger or schedule and expected frequency;
- input names, types, required API names, and authoritative source;
- connection requirements without secret values or production connection names;
- external systems called and expected response contract;
- idempotency key and duplicate behavior;
- dry-run or non-posting behavior;
- logs and data that are deliberately excluded;
- rollback or containment path; and
- manual Zoho setup and smoke tests.

Comments explain non-obvious business rules and failure decisions, not syntax that is already clear.

## Function Flow

Use this order unless a product constraint requires a documented exception:

1. Load and validate configuration.
2. Validate input presence, type, allowed values, and size.
3. Use API names verified during setup or deployment, then read authoritative current record state.
4. Reject zero matches, multiple matches, stale state, and unsupported status.
5. Compute the decision without side effects.
6. Return the proposed action in dry-run mode.
7. Claim a stable idempotency key atomically or through a durable mediator.
8. Apply one bounded mutation and validate the Zoho/API response code.
9. Read the result back and reconcile downstream state.
10. Emit a minimal sanitized outcome.

Separate decision logic from `invokeurl`, record creation, invoice mutation, and message sending. Avoid hiding important business rules behind generic helpers.

## Inputs And Null Handling

- Treat missing maps, keys, lists, IDs, dates, and API responses as expected failure cases.
- Check collection shape before indexing or iterating.
- Normalize strings deliberately; do not convert null into a meaningful business value.
- Validate picklist values, currency/decimal precision, time zones, and date boundaries.
- Discover API names from the live target during setup, verify them during deployment, and store them as reviewed versioned configuration. At runtime, obtain record or resource IDs from validated inputs or authoritative reads; never copy names or IDs from exports.
- Limit loop size, pagination, and API calls; do not place unbounded `invokeurl` calls in loops.

## Connections And `invokeurl`

Use Zoho Connections or an approved secret mechanism for authentication. Do not embed credentials in URLs, headers, code, comments, or variables stored in GitHub. Zoho's [invokeURL documentation](https://www.zoho.com/deluge/help/webhook/invokeurl-api-task.html) documents request syntax, per-execution call usage, response behavior, and service-dependent time and size limits. Verify current limits in the product where the function will run.

For every external call:

- allowlist method, scheme, host, path, content type, and response size;
- design within Deluge's documented fixed socket-timeout ceiling for remote resources, currently 40 seconds, and route longer work asynchronously rather than implying a caller-configurable timeout;
- send only allowlisted fields;
- validate HTTP and Zoho response codes separately;
- treat parse failures and partial responses as failures;
- redact authentication and response bodies; and
- do not retry an ambiguous create or update until authoritative state is read.

## Failure And Readback

Use explicit result checks and [try-catch](https://www.zoho.com/deluge/help/misc-statements/try-catch.html) around operations that can fail. Classify failures as validation, authorization, rate limit, dependency, transient transport, ambiguous outcome, or permanent business rejection.

Retries must be bounded, delayed where supported, limited to demonstrably retry-safe failures, and protected by idempotency. Never convert an error into a successful result merely to keep a schedule green.

After an approved side effect, read the authoritative object independently and compare the idempotency key, returned identifier, status, intended fields, linked records, and expected downstream effects. A timeout or malformed success response remains unresolved until readback establishes the outcome; never blindly repeat a create, send, payment, credit, or record mutation.

## Logging And Privacy

Allowed logs contain synthetic or non-sensitive correlation IDs, function version, coarse stage, outcome class, retry count, and elapsed time. Do not log raw inputs, request/response bodies, tokens, headers, signatures, customer data, document content, accounting data, or full Zoho errors that may echo those values.

Hashing content can support correlation only when the input, hash purpose, access, and retention are approved. A hash is not automatic anonymization.

## Financial And Customer-Facing Functions

Default to dry-run or non-posting mode. Creating invoices, applying payments or credits, sending messages, changing subscriptions, or mutating customer records requires explicit enablement, current-state verification, duplicate protection, and readback.

Each transaction or communication class has one owning automation. Do not let two schedules or functions independently create the same business outcome.

## Repository Boundary

GitHub may contain sanitized `.deluge` source, function headers, typed input contracts, decision tables, synthetic fixtures, setup instructions, and rollback runbooks. It must not contain live connection names, organization or record IDs, private endpoints, schedules that disclose production behavior, credentials, tokens, raw payloads, customer or employee data, document contents, financial records, or production logs.

Repository source is reviewed intent, not proof of import, save, connection, schedule, execution, or deployment. Environment-specific configuration and private evidence stay in approved Zoho and audit systems.

## Validation

Before deployment, record:

- syntax/import validation in the owning Zoho product;
- a synthetic decision table covering success, duplicates, missing data, stale state, partial state, rate limits, and timeouts;
- Development dry-run output with sanitized evidence;
- idempotency and repeated-trigger behavior;
- permission and connection failure behavior;
- exact manual setup, rollback, and readback steps; and
- the deployed immutable source revision in the private deployment record.

If Deluge cannot be unit-tested outside Zoho, use a documented decision matrix and repeatable Development smoke test. Do not invent a test result or claim that a saved function is deployed.

## Manual Setup

All live setup is currently **Unknown**. Before relying on a function, verify or configure:

- the owning Zoho product, Development and Production locations, function name, trigger, schedule, runtime limits, and administrator;
- exact input API names, authoritative records, allowed statuses, idempotency storage, and duplicate rules;
- least-privilege Zoho Connections, permitted hosts and methods, environment-specific variables, and secret storage;
- dry-run or non-posting defaults, failure alerts, monitoring, support owner, and bounded retry behavior;
- repeatable import/syntax validation, Development fixtures, readback, rollback or containment, and disabled-state behavior; and
- a private deployment record tying the reviewed source revision to the exact saved and activated function.

Repository review does not authorize a live connection, schedule, function activation, or business-system write.
