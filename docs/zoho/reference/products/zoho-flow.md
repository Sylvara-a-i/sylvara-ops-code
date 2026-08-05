# Zoho Flow Reference

- **Reference ID:** `SYLVARA-ZOHO-FLOW-REFERENCE`
- **Research cutoff:** 2026-07-20
- **Custom-function refresh:** 2026-08-05
- **Repository status:** Reference only
- **Sylvara adoption:** Unknown
- **Effective organization, edition, permissions, and connector access:** Unknown

## Status And Scope

This handbook summarizes durable Zoho Flow orchestration, connection, webhook, retry, and governance behavior. It is not a flow export, connection inventory, task-usage report, or deployment record.

Connector fields, trigger behavior, plan limits, history retention, and regional features are dynamic. The live connector interface and each connected product's current API are authoritative.

## Product Role

Zoho Flow is a low-code orchestration layer for moving bounded events between systems. It must not become the source of relationship, accounting, identity, document, or payment truth.

Use Flow for understandable, supportable integration paths. Keep cryptographic verification, durable idempotency, and critical conversational or financial processing in a controlled middleware layer when Flow cannot prove those guarantees.

## Authentication And Discovery

- Inventory flow owner, trigger, connection, action sequence, environment, region, plan, and task usage through authorized views.
- Treat each connection as a separate credential and permission boundary.
- Verify the connected principal and least-privilege scopes in the target product.
- Inspect connector fields and action behavior in the live builder; do not infer them from names or another organization.
- Verify outgoing webhook authentication and incoming webhook behavior for the exact trigger.
- No supported general management or deployment REST API was established at the cutoff; do not invent one.

## Core Model And Capabilities

- A flow begins with an application event, schedule, URL trigger, webhook, or polling trigger.
- Actions call supported connector operations or outgoing webhooks.
- Logic elements provide branching, decisions, delays, and iteration subject to plan limits.
- Custom functions add bounded Deluge transformations when ordinary mapping is insufficient.
- Connections store delegated authorization outside the flow definition.
- Version history, execution history, diagnostics, rerun, and usage views support operations.
- An on-premises agent can bridge approved internal services with additional security obligations.
- Task consumption and execution limits affect cost and throughput.

## Custom Function Type Contract

Flow's current custom-function interface documents the following argument and return vocabulary:

| Type | Use and control |
|---|---|
| `int` | Whole number; verify range and avoid using it for identifiers |
| `float` | Decimal number; define precision and rounding before financial use |
| `string` | Text; validate length, encoding, sensitivity, and accepted format |
| `bool` | Boolean; define false, missing, and null behavior separately |
| `date` | Date value; verify input format, locale, and time-zone assumptions |
| `map` | Key/value object; validate required keys and reject unexpected structure where practical |
| `list` | Ordered collection; validate element type, count, and empty behavior |
| `file` | File value; enforce type, size, privacy, retention, and malware controls |
| `void` | Return type only; it is not available as an input argument type |

Declare inputs and return type explicitly, keep functions small, and treat mapped inputs as untrusted. App connections are not passed directly into the function; current guidance uses `invokeurl` for connection-backed calls. Confirm the named connection, scopes, regional host, timeout, response contract, and logging behavior before enabling such a call.

Shared functions create cross-flow dependencies. Inventory dependent flows before editing or deletion, because deleting a shared function can affect every flow that references it.

## Automation And Events

- Incoming webhooks should terminate at a validating edge when authenticity is not proven by the exact Flow trigger.
- Outgoing webhooks need explicit authentication, timeout handling, response validation, and redacted payloads.
- Polling should use bounded windows and a durable high-water mark with overlap reconciliation.
- URL triggers must require authentication and input validation appropriate to the consequence.
- Custom functions should transform or route data, not hide an entire application inside one script.
- Assign a single writer for each destination object and event to prevent loops and duplicate updates.

## Reliability And Security

- Create a durable operation key before a non-idempotent destination action.
- Treat a timeout after a write as ambiguous; reconcile before manual or automatic rerun.
- Understand whether rerun starts the whole flow or resumes at a failed step before using it.
- Use bounded retries with backoff for demonstrably transient failures only.
- Route permanent failures to a visible exception queue with safe context and an accountable owner.
- Never expose connection tokens, raw webhook bodies, customer data, financial data, or private URLs in GitHub or logs.
- Restrict support access and on-premises agents; review their network reach and revoke them when no longer required.

## Validation

Before enabling a flow, verify:

1. owner, environment, region, plan, task budget, trigger, and every connection principal;
2. exact source event and destination action contracts;
3. zero, one, duplicate, out-of-order, and malformed event behavior;
4. timeout ambiguity, retry, rerun, and partial-completion handling;
5. loop prevention, operation keys, and destination readback;
6. redacted execution history and exception handling; and
7. disable, version rollback, connection revocation, and reconciliation steps.

Use synthetic events and non-production connections. Repository approval is not authorization to publish or enable a live flow.

## Official Sources

- [Zoho Flow overview](https://help.zoho.com/portal/en/kb/flow/user-guide/overview/articles/general-overview)
- [Webhook trigger](https://help.zoho.com/portal/en/kb/flow/user-guide/create-a-flow/articles/webhook-trigger)
- [Outgoing webhooks](https://help.zoho.com/portal/en/kb/flow/user-guide/create-a-flow/articles/outgoing-webhooks)
- [Custom functions](https://help.zoho.com/portal/en/kb/flow/user-guide/create-a-flow/articles/using-custom-functions)
- [Fix Flow errors](https://help.zoho.com/portal/en/kb/flow/user-guide/troubleshooting/articles/fix-errors-in-flows)
- [Rerun behavior](https://help.zoho.com/portal/en/kb/flow/user-guide/troubleshooting/articles/rerun)

## Exclusions

This reference contains no flow, connection, webhook URL, owner, task history, payload, connector field map, private network configuration, live identifier, or deployment claim. Sylvara adoption and effective access remain Unknown.
