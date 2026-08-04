# Zoho Billing Standard

## Status

- Repository standard: **Proposed**
- Sylvara live configuration, organization, plans, subscriptions, webhooks, and integrations: **Unknown**

This standard governs any future Sylvara use of Zoho Billing. The official [Billing API introduction](https://www.zoho.com/billing/api/v1/introduction/), [subscription reference](https://www.zoho.com/billing/api/v1/subscription/), [event reference](https://www.zoho.com/billing/api/v1/events/), and [OAuth scope reference](https://www.zoho.com/billing/api/v1/oauth/) describe product capabilities. They do not prove that a capability is enabled, authorized, or appropriate for Sylvara.

## Ownership

Zoho Billing may own approved product, plan, subscription, renewal, dunning, and entitlement lifecycle state. Zoho Books remains the accounting source of truth for the general ledger, accounting balances, recorded invoices and payments, credits, reconciliation, and financial reporting.

Before implementation, define one owner for every invoice, payment, credit, refund, tax result, customer balance, and entitlement event. Billing and Books must not independently create or mutate the same accounting outcome. CRM owns the commercial relationship and sales context; it may reference a subscription but must not calculate subscription or ledger truth.

## Subscription And Event Contract

Every approved workflow must define:

- the authoritative customer and subscription keys;
- allowed source and destination states;
- immediate versus end-of-term change behavior;
- trial, pause, resume, cancellation, expiration, dunning, and reactivation rules;
- which event creates an accounting or entitlement side effect;
- a stable event or business idempotency key;
- duplicate, out-of-order, delayed, and replay behavior;
- the reconciliation path to Billing, Books, and CRM; and
- the manual-review state for incomplete or contradictory evidence.

An event notification is evidence that processing should begin, not proof that the intended downstream outcome is complete. Verify authenticity and timestamp, allowlist the event type and minimum fields, then read authoritative state before applying a side effect.

## Change Controls

- Bind the approved organization, data center, and environment in the control layer.
- Separate read-only audit access from subscription or financial mutation access.
- Reject caller-supplied organization substitutions and unknown fields.
- Require fresh subscription, invoice, payment, credit, and entitlement state as applicable.
- Use one bounded write and validate the HTTP response, Zoho result code, returned identifier, and resulting status.
- Do not blindly retry a create, charge, cancellation, credit, refund, or renewal after an ambiguous timeout.
- Treat plan, price, tax, currency, payment-collection, dunning, and customer-communication changes as high-risk.
- Default new integrations to Development, dry-run, or registration-only behavior where the product supports it.

## Repository Boundary

GitHub may contain sanitized state diagrams, event contracts, field mappings, implementation code, synthetic tests, and runbooks. It must not contain customer or subscription records, prices that are not approved for publication, invoices, payment data, tax details, portal links, event payloads, organization or subscription IDs, webhook URLs or secrets, OAuth material, or live plan configuration.

A merged pull request is not evidence that Billing is configured, a webhook is registered, or a subscription behavior is deployed.

## Failure And Readback

Fail closed on ambiguous customer identity, an unsupported transition, stale state, missing accounting ownership, unknown currency or tax behavior, invalid signature, duplicate ownership, incomplete response, insufficient OAuth scope, rate limit, or unknown write outcome.

After a mutation, read the subscription or event through an independent audit path. If Books or CRM should change, read those authoritative records separately and reconcile exact identifiers, statuses, dates, currency, and totals. A successful transport response or webhook acknowledgment alone is insufficient.

## Validation

Use synthetic or Development data to cover:

- initial creation and exact duplicate replay;
- immediate and end-of-term plan changes;
- trial conversion, pause, resume, cancellation, expiration, and reactivation;
- dunning, failed collection, partial downstream failure, and out-of-order events;
- timeout before commit and timeout after possible commit;
- Books and CRM readback mismatch;
- unsupported currency, tax, customer, plan, and status values; and
- sanitized logging and rollback or containment.

Production validation requires separate approval for the exact target, mutation, prestate, expected accounting effect, rollback, and readback.

## Manual Setup

All live setup is currently **Unknown**. Before adoption, an authorized operator must verify or configure, as applicable:

- the intended Billing organization, data center, environment, roles, and OAuth scopes;
- product, plan, addon, coupon, tax, currency, payment, dunning, and portal settings;
- the Billing-to-Books and Billing-to-CRM ownership map;
- approved event types, webhook authentication, destination, retry behavior, and secret storage;
- customer communications and legal or finance review requirements; and
- Development smoke tests, production approval, rollback, and independent readback.
