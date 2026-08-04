# Deluge Language And Runtime Reference

- **Reference ID:** `SYLVARA-DELUGE-REFERENCE`
- **Research cutoff:** 2026-07-20
- **Repository status:** Reference only
- **Sylvara adoption:** Unknown
- **Effective host, runtime, connections, permissions, and deployment state:** Unknown

## Status And Scope

This handbook summarizes portable Deluge language and runtime behavior for design and review. It complements the repository's engineering standard; it is not production source, an import result, a saved function, a schedule, or deployment evidence.

Deluge is embedded in multiple Zoho products. Official language support does not prove that a task, function, runtime feature, limit, or authentication mechanism is available in a particular host.

## Platform And Runtime Model

Resolve the host before writing code. Creator, CRM, Books, Billing, Flow, WorkDrive, Sites, Sign, and other supported products expose different:

- trigger contexts and implicit variables;
- native task families and signatures;
- supported statements and built-in functions;
- transaction and workflow behavior;
- execution identity and authorization;
- time, memory, statement, API-call, file, and payload limits; and
- import, testing, logging, scheduling, and deployment surfaces.

Do not generate “generic Deluge” and assume it will save everywhere. A language feature can be documented globally but unsupported or behave differently in the intended host.

## Authentication, Data Centers, Scopes, And Connections

- Deluge itself does not provide one universal organization or data-center binding.
- Native integration tasks inherit host and connection behavior defined by their product contract.
- Use Zoho Connections or another approved product-specific secret mechanism for external calls.
- Never embed tokens, credentials, signatures, private endpoints, or connection names in source.
- Resolve target data center, organization, application, and resource metadata during controlled setup.
- Request only the scopes and methods required by the function.
- Treat a saved Connection, a Deluge task signature, and effective target access as separate evidence.
- Verify how the host executes the function: invoking user, owner, schedule principal, service account, or application context.

## Language Core

Deluge supports scalar and structured values such as text, number, decimal, boolean, date/time, list, map, collection, file, and null-like states, subject to host support.

- Distinguish missing keys, null, blank text, empty lists or maps, zero, and false.
- Test collection shape before indexing, casting, or iterating.
- Use explicit conversion and validate the result; implicit coercion can hide malformed input.
- Treat date-only, date-time, time zone, locale, and daylight-saving behavior deliberately.
- Use decimal-safe rules for money and never rely on binary floating-point assumptions.
- Keep conditional logic readable and bounded.
- Use supported `for each` patterns and pagination rather than unbounded loop designs.
- Use `try/catch` around operations that can fail, then inspect returned status instead of assuming no exception means success.

Lists, maps, and collections are not interchangeable in every task or built-in. Read the exact function signature for the target runtime.

## Built-In Functions And Tasks

The official catalog groups functions for text, number, date-time, time, list, map, collection, conversion, logical checks, type checks, XML/JSON, utilities, files, encoding, hashing, and encryption.

Task families can include:

- Creator-native data operations and subform tasks;
- CRM v8 record and search tasks;
- Books and Billing integration tasks;
- Sign and WorkDrive tasks;
- notification and file-transfer tasks;
- `invokeUrl` for governed HTTP calls; and
- `invokeAPI` for supported Zoho API routing.

Native tasks are conveniences over product behavior, not an exemption from metadata discovery, permission checks, response validation, idempotency, or readback.

## Inputs, Configuration, And Output

Every function should define:

- owning product and one bounded workflow;
- trigger, schedule, or caller context;
- input names, expected types, requiredness, allowed values, and size limits;
- authoritative source and API-name discovery method;
- configuration keys and safe defaults without secret values;
- expected output schema and caller interpretation;
- idempotency key and duplicate behavior;
- dry-run or non-posting behavior;
- sanitized logging contract; and
- rollback, containment, and manual setup.

Return structured outcomes when the host permits them. Distinguish success, no-op, validation rejection, retryable dependency failure, permanent rejection, and unresolved ambiguous outcome.

## HTTP And Integration Calls

For `invokeUrl`, `invokeAPI`, or a native integration task:

1. allowlist method, scheme, host, path, content type, and expected response size;
2. send only the minimum approved fields;
3. use a Connection rather than inline authentication;
4. define behavior within the documented fixed timeout and host limits;
5. inspect HTTP status and provider response code separately;
6. validate response type and required fields before use;
7. redact headers, credentials, bodies, and private errors from logs;
8. retry only safe failures with a bounded policy; and
9. read authoritative state after a possible side effect.

Route work that can exceed the host timeout to an asynchronous system rather than pretending the timeout is caller-configurable.

## Automation, Triggers, And Side Effects

- Specify whether API or task writes should run workflows, approvals, Blueprint, email, or other automation.
- Protect against trigger recursion and duplicate scheduling.
- Separate decision computation from record creation, transaction mutation, file upload, and message delivery.
- Give each business outcome one owning automation.
- Default financial and externally visible operations to dry-run or non-posting behavior until explicitly enabled.
- Do not infer completion from a successful task call; read the authoritative object or state back.
- Treat file overwrite, document sending, payment action, deletion, and external messaging as high-risk operations.

## Failure, Retry, And Idempotency

Classify validation, authorization, rate-limit, dependency, transport, timeout, malformed response, partial success, duplicate, stale-state, and permanent business rejection separately.

- Catching an exception must not convert failure into success.
- Use bounded backoff only where the host supports waiting or rescheduling safely.
- Do not blindly retry a create, update, send, payment, credit, upload, or delete after an ambiguous timeout.
- Claim a stable operation key in durable storage before side effects when possible.
- Make repeats return the established result or a safe no-op.
- Stop when required metadata, identity, state, response completeness, or rollback is unknown.
- Emit only coarse stage, result class, safe correlation value, elapsed time, and retry count.

## Validation And Deployment

For the exact host, validate:

- current language, task, runtime, and limit documentation;
- import or compile behavior and function signature;
- required input, null, blank, malformed, oversized, and unsupported values;
- zero, one, and multiple authoritative matches;
- pagination, batching, rate limits, permission denial, and response parsing;
- repeated trigger, concurrent trigger, recursion, and idempotency behavior;
- dependency timeout, ambiguous side effect, recovery, and readback;
- secret and private-data redaction; and
- Development save, dry run, controlled activation, smoke test, monitoring, disable or rollback, and deployed revision evidence.

If local unit testing is not possible, use a documented decision table and repeatable Development smoke test. Repository source is reviewed intent, not proof that Zoho accepted or activated it.

## Official Sources

- [Deluge overview](https://www.zoho.com/deluge/help/)
- [Release notes](https://www.zoho.com/deluge/help/release-notes.html)
- [Data types](https://www.zoho.com/deluge/help/datatypes.html)
- [Built-in functions](https://www.zoho.com/deluge/help/built-in-functions.html)
- [Tasks](https://www.zoho.com/deluge/help/deluge-tasks.html)
- [Try/catch](https://www.zoho.com/deluge/help/misc-statements/try-catch.html)
- [`invokeUrl`](https://www.zoho.com/deluge/help/webhook/invokeurl-api-task.html)
- [`invokeUrl` limitations](https://www.zoho.com/deluge/help/web-data/invokeurl-task/limitations.html)
- [`invokeAPI`](https://www.zoho.com/deluge/help/webhook/invokeapitask.html)
- [Connections](https://www.zoho.com/deluge/help/connections.html)
- [CRM v8 tasks](https://www.zoho.com/deluge/help/crm-integration-tasks-V8.html)
- [Books tasks](https://www.zoho.com/deluge/help/books-tasks.html)

## Exclusions

This reference contains no live function, API name, module or form selection, organization or resource identifier, connection name, endpoint, schedule, secret, customer data, accounting rule, payload, log, compiler result, deployment status, or claim of effective access. Revalidate volatile host support, function names, signatures, limits, scopes, and runtime behavior before implementation.
