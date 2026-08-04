# Zoho Payments Reference

- **Reference ID:** `SYLVARA-ZOHO-PAYMENTS-REFERENCE`
- **Research cutoff:** 2026-07-20
- **Repository status:** Reference only
- **Sylvara adoption:** Unknown
- **Effective organization, edition, permissions, and connector access:** Unknown

## Status And Scope

This handbook summarizes durable Zoho Payments API, hosted-checkout, widget, webhook, refund, payout, and security behavior. It is not a merchant configuration, transaction ledger, webhook registry, or proof that payment processing is available.

Market availability, supported methods, limits, onboarding status, and sandbox behavior are volatile. At the research cutoff, the reviewed United States documentation stated that no standard sandbox was available; revalidate before testing.

## Product Role

Zoho Payments processes payment methods, payment sessions, payments, links, refunds, payouts, and verified payment events when adopted. Zoho Billing may own subscription lifecycle, while Zoho Books remains the accounting and reconciliation source.

A successful API response or browser return is not sufficient accounting evidence. Reconcile authoritative payment state and downstream financial state separately.

## Authentication And Discovery

- Server APIs use Zoho OAuth with documented Payments scopes and an account selector.
- Resolve organization, region, onboarding status, account status, currency, and effective permission before a write.
- Browser widgets use a publishable widget key and server-created session; private credentials stay on the server.
- Discover supported payment methods and capabilities from the current account rather than assuming market parity.
- Treat customer, session, payment, refund, payout, link, and webhook identifiers as opaque runtime values.
- Verify regional API roots and response schemas from the exact current endpoint.
- Keep organization credentials, private keys, and webhook secrets in an approved secret system.

## Core Model And Capabilities

- Customers provide a reusable payment relationship without becoming the CRM source.
- Payment-method sessions collect and tokenize customer payment details through supported browser surfaces.
- Payment methods can be attached and used only within documented consent and authorization boundaries.
- Payment sessions prepare a server-controlled payment attempt for hosted checkout or widgets.
- Payments expose amount, currency, status, method, and processing outcomes.
- Payment links provide a hosted collection path with controlled parameters.
- Refunds reverse eligible payments under separate status and reconciliation behavior.
- Payouts describe settlement movement and are not equivalent to individual payment success.

## Automation And Events

- Create browser sessions on the server and pass only documented public values to the client.
- Verify hosted-checkout returns and widget outcomes against the server API.
- Configure only documented webhook events and verify each delivery cryptographically.
- Persist an event receipt before processing and deduplicate by the provider event identity plus expected resource transition.
- Return success only after the durable required outcome is committed, or return a retryable failure.
- Reconcile payment, refund, and payout state periodically even when webhooks are enabled.

## Reliability And Security

- Maintain a durable operation ledger because a universal caller-supplied idempotency contract was not established for every write.
- Serialize money-moving operations and reconcile ambiguous timeouts before retrying.
- Validate amount, currency, customer authority, expected status, and downstream reference on the server.
- Never log payment methods, raw payloads, signatures, private response bodies, customer data, or secret-bearing URLs.
- Enforce timestamp or replay controls exactly as documented for the selected webhook contract.
- Treat refunds and off-session charges as separately approved high-risk actions.
- Respect current rate limits with bounded backoff and explicit response-code handling.

## Validation

Before enabling payment processing, verify:

1. organization, region, account status, currency, permissions, OAuth scopes, and supported methods;
2. server/browser separation and key classification;
3. payment-method, session, payment, link, refund, and payout state transitions used;
4. webhook signature, replay, duplicate, ordering, retry, and failure behavior;
5. decline, timeout, partial failure, and ambiguous-outcome reconciliation;
6. accounting readback without duplicate financial entries; and
7. disable, secret rotation, refund containment, and incident-response procedures.

Use synthetic or minimal-value controlled testing under an approved plan. Repository review is not authorization to move funds, issue refunds, or enable Production processing.

## Official Sources

- [Payments API introduction](https://www.zoho.com/us/payments/api/v1/introduction/)
- [Organization OAuth](https://www.zoho.com/us/payments/developerdocs/web-integration/org-oauth/)
- [Payments API](https://www.zoho.com/us/payments/api/v1/payments/)
- [Webhooks API](https://www.zoho.com/us/payments/api/v1/webhooks/)
- [Webhook verification](https://www.zoho.com/us/payments/developerdocs/webhooks/verification/)
- [Hosted checkout](https://www.zoho.com/us/payments/developerdocs/web-integration/hosted-checkout/)

## Exclusions

This reference contains no account, customer, payment method, payment, refund, payout, link, webhook, secret, widget key, financial value, live identifier, or deployment claim. Sylvara adoption and effective access remain Unknown.
