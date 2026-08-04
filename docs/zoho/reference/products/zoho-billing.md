# Zoho Billing Platform Reference

- **Reference ID:** `SYLVARA-ZOHO-BILLING-REFERENCE`
- **Research cutoff:** 2026-07-20
- **Repository status:** Reference only
- **Sylvara adoption:** Unknown
- **Effective organization, edition, permissions, and connector access:** Unknown

## Status And Scope

This handbook summarizes Zoho Billing platform behavior for subscription and recurring-revenue integration design. It is not a live catalog, subscription policy, pricing decision, tax conclusion, or deployment record.

Official API capability does not prove that a feature, product, plan, event type, webhook contract, or connector action is enabled for Sylvara. Verify live configuration and effective access before implementation.

## Platform Model

Billing can own approved product catalogs, plans, add-ons, coupons, customers used for billing, subscription lifecycle, recurring invoices, hosted pages, payment collection state, credits, refunds, and dunning configuration when adopted.

Billing does not replace the general ledger. Define the Books integration and reconciliation boundary before treating a Billing event as an accounting outcome.

Keep catalog configuration, customer identity mapping, subscription state, entitlement state, payment state, and accounting state distinct. An event in one domain must not silently overwrite another domain's authoritative state.

## Authentication, Data Centers, And Scopes

- Billing API v1 uses OAuth 2.0 and organization-scoped requests.
- Authorization, API, and help domains can vary by data center and locale.
- Resolve the exact organization and environment before building a request.
- Request only the catalog, customer, subscription, transaction, settings, or automation scopes required.
- Store client credentials, refresh tokens, webhook secrets, and private endpoints outside GitHub.
- Verify the effective user role and product permission in addition to OAuth scope.
- Separate test-organization, Development, and Production configuration and credentials.
- Treat organization identifiers and connection names as private deployment configuration.

## Core Resources And Tasks

Major resource families include:

- organizations and settings;
- items, products, plans, add-ons, coupons, price books, and reporting tags;
- customers, contact persons, cards, and supported bank-account references;
- quotes, invoices, subscriptions, and unbilled charges;
- payments, payment links, credit notes, refunds, and hosted pages;
- events and event types;
- custom modules; and
- workflows, webhooks, custom functions, and Deluge tasks.

Subscription operations can include creation, activation, upgrades, downgrades, renewal, cancellation, reactivation, pause/resume, trial handling, plan or quantity changes, and end-of-term behavior. Exact operations, proration, billing-cycle effects, and availability must be read from current endpoint documentation and live settings.

Do not infer catalog compatibility from labels. Resolve the configured product, plan, add-on, coupon, currency, tax treatment, billing frequency, collection method, and effective dates from approved live configuration.

### Hosted Pages And Collection

- Hosted pages can reduce direct handling of payment credentials but still require approved configuration.
- Generate or reuse a page only from a validated customer, catalog, amount, currency, and operation context.
- Keep privileged page URLs out of logs, analytics, support tickets, and public repository artifacts.
- Do not treat page creation, page opening, or browser return as payment completion.
- Confirm final payment and subscription state through an authoritative API read or verified event.
- Define expiration, abandonment, duplicate-page, customer-cancel, and replay behavior.
- Reconcile gateway, Billing, Books, and entitlement outcomes independently.
- Keep collection-mode changes and automatic charging behind explicit approval.

## Subscription And Accounting Boundaries

Before a subscription mutation:

1. confirm the organization, environment, customer mapping, and catalog revision;
2. read the current subscription, invoice, payment, credit, and cancellation state needed for the decision;
3. validate currency, tax, trial, billing cycle, quantity, proration, collection mode, and effective date;
4. create a stable operation key and exact proposed-state plan;
5. check for an existing equivalent outcome;
6. apply one bounded lifecycle action;
7. read the subscription and resulting transactions back; and
8. reconcile the downstream accounting integration separately.

An invoice, payment, event, or hosted-page result is not interchangeable with a settled accounting entry or active customer entitlement.

## Automation And Webhooks

Billing supports outgoing events, workflow webhooks, custom functions, and incoming webhooks, subject to current product configuration.

- Determine the exact event family, payload version, delivery behavior, and retry contract from current official documentation.
- Verify authenticity and freshness using Billing's product-specific contract; never reuse assumptions from another provider.
- Preserve the raw request only in short-lived protected memory when verification requires exact bytes.
- Claim a durable event key before applying downstream side effects.
- Expect duplicate, delayed, missing, and out-of-order delivery unless current evidence proves stronger guarantees.
- Fetch authoritative current state when an event is incomplete or order-sensitive.
- Return success only after the durable required outcome is known, or return a retryable failure according to the verified contract.
- Keep raw payloads, signatures, customer details, invoice data, and response bodies out of logs.

## Failure, Retry, And Idempotency

Inspect HTTP status, Billing response code, message, and per-resource details. Classify validation, authorization, rate-limit, duplicate, catalog mismatch, lifecycle conflict, payment, dependency, transport, partial, and ambiguous-outcome failures.

- Retry demonstrably safe reads with bounded exponential backoff and jitter.
- Do not blindly retry customer, subscription, payment, refund, hosted-page, invoice, or credit mutations.
- Reconcile current state after a timeout or malformed success response.
- Use stable external or custom references only after their uniqueness and write behavior are verified.
- Store event and operation claims durably and atomically.
- Prevent two workflows from owning the same subscription or charge outcome.
- Route permanent business rejection to review rather than converting it into technical success.

## Validation And Change Control

Use an approved test organization or non-production environment. Validate:

- organization, data center, edition, scopes, role, tax, currency, gateways, and Books integration;
- every catalog reference and allowed subscription transition;
- trial, renewal, upgrade, downgrade, pause, resume, cancel, reactivate, and end-of-term cases actually in scope;
- proration, quantity, coupon, tax, failed collection, credit, refund, and dunning behavior;
- duplicate requests, repeated events, out-of-order events, stale state, and concurrent changes;
- signature or authenticity failure, timestamp failure, malformed payload, rate limit, and timeout;
- exact readback of subscription and transaction state; and
- separate reconciliation to accounting and approved entitlement state.

Repository approval does not authorize a live catalog, subscription, payment, refund, webhook, or workflow change.

## Official Sources

- [Billing API v1 introduction](https://www.zoho.com/billing/api/v1/introduction/)
- [OAuth and scopes](https://www.zoho.com/billing/api/v1/oauth/)
- [Errors](https://www.zoho.com/billing/api/v1/errors/)
- [Pagination](https://www.zoho.com/billing/api/v1/pagination/)
- [Products](https://www.zoho.com/billing/api/v1/products/)
- [Plans](https://www.zoho.com/billing/api/v1/plans/)
- [Subscriptions](https://www.zoho.com/billing/api/v1/subscription/)
- [Events](https://www.zoho.com/billing/api/v1/events/)
- [Hosted pages](https://www.zoho.com/billing/api/v1/hosted-pages/)
- [Automation](https://www.zoho.com/us/billing/help/settings/automation.html)
- [Incoming webhooks](https://www.zoho.com/us/billing/help/settings/developer-space/incoming-webhooks.html)

## Exclusions

This reference contains no Sylvara product, plan, price, coupon, customer, subscription, tax, gateway, organization identifier, connection name, webhook endpoint, secret, event payload, accounting treatment, entitlement rule, or deployment claim. Revalidate volatile lifecycle behavior, limits, editions, scopes, and webhook details before implementation.
