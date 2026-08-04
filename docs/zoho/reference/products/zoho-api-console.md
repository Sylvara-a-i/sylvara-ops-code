# Zoho API Console Reference

- **Reference ID:** `SYLVARA-ZOHO-API-CONSOLE-REFERENCE`
- **Research cutoff:** 2026-07-20
- **Repository status:** Reference only
- **Sylvara adoption:** Unknown
- **Effective organization, client inventory, permissions, and connector access:** Unknown

## Status And Scope

This handbook summarizes durable Zoho API Console and Zoho Accounts OAuth behavior. It is not a client inventory, credential register, scope approval, deployment record, or proof that any integration is connected.

Official documentation establishes general OAuth capability. Effective access requires an approved client, an authorized principal, exact product scopes, correct regional routing, product-level permission, and a safe runtime test.

## Product Role

The API Console registers OAuth clients. Zoho Accounts authenticates users, collects consent, issues and revokes tokens, and directs clients to the correct data center. Each Zoho product owns its endpoints, object model, scopes, limits, and authorization rules.

Use the console as credential infrastructure only. It is not a source of operational facts, product metadata, application health, or authorization to widen access.

## Authentication And Discovery

- Select the client type from the runtime and consent model: server, browser, native, device, or self client.
- Prefer Authorization Code with PKCE where supported; a confidential backend may also hold a client secret.
- Use a self client only for a controlled owner-authorized integration, never as a shortcut for delegated multi-user access.
- Register exact callbacks and origins; do not use broad callbacks or inferred regional hosts.
- Preserve the returned accounts server, location, and API domain rather than forcing a remembered `.com` address.
- Build scopes from the current endpoint documentation for the target product.
- Treat OAuth scope and product permission as separate checks.
- Discover the principal, organization, plan, and product access after token issuance using the least-sensitive supported call.

## Core Model And Capabilities

- A client registration defines client type, callbacks or origins, data-center options, ownership, and secret material.
- An authorization grant binds a principal, client, approved scopes, and product access.
- Authorization codes are short-lived and single-use.
- Access tokens are short-lived and should be cached until near expiry.
- Refresh tokens support durable delegated access when the selected flow returns one.
- Multi-DC clients may require region-specific accounts servers, secrets, and API domains.
- Instance-level authorization is product-specific and must not be inferred from generic OAuth support.
- Product APIs may require organization or portal selectors in addition to the OAuth token.

## Automation And Events

- Centralize token refresh behind a small broker or equivalent controlled component.
- Serialize refresh for each grant so concurrent workers do not create a token storm.
- Record only sanitized client aliases, scope-manifest versions, owner roles, environment, and review dates in GitHub.
- Treat token issuance, rotation, revocation, and consent changes as security-controlled lifecycle events.
- Do not generate a new access token for every product request.
- Do not automate client registration or scope expansion without a documented supported interface and scoped approval.

## Reliability And Security

- Never commit or log client secrets, codes, access tokens, refresh tokens, device codes, or credential-bearing URLs.
- Validate OAuth `state`; make it random, short-lived, single-use, and bound to the initiating session.
- Keep Development and Production clients, callbacks, grants, stores, and authorized users separate.
- Use bounded refresh retries and distinguish transient failure from revocation or invalid configuration.
- Rotate credentials through a staged procedure that proves the replacement before retiring the prior credential.
- On suspected compromise, contain use, revoke affected grants, rotate secrets, inspect audit evidence, and reconcile downstream activity.
- Revalidate volatile token limits, regional support, and client-type behavior before implementation.

## Validation

Before enabling an integration, verify:

1. exact client type, owner, environment, callback, and data center;
2. least-privilege product scopes from current endpoint documentation;
3. consent principal and effective product permission;
4. code exchange, refresh, expiry, revocation, and wrong-region behavior;
5. secure token storage, redacted logs, and single-flight refresh;
6. read-only identity and organization discovery; and
7. rollback, credential rotation, and incident-response ownership.

Repository approval is not authorization to register a client, issue a grant, reveal a secret, or change Production access.

## Official Sources

- [Introduction to OAuth 2.0](https://www.zoho.com/developer/oauth/introduction.html)
- [Server-based apps](https://www.zoho.com/developer/oauth/web-server-apps/overview.html)
- [Access-token exchange](https://www.zoho.com/developer/oauth/web-server-apps/get-access-token.html)
- [Refresh access token](https://www.zoho.com/developer/oauth/web-server-apps/refresh-access-token.html)
- [Multi-DC support](https://www.zoho.com/developer/oauth/multi-dc-support.html)
- [OAuth token limits](https://www.zoho.com/developer/oauth/token-limits.html)

## Exclusions

This reference contains no client identifier, secret, callback, origin, token, scope grant, regional configuration, product organization identifier, connection name, live principal, or deployment claim. Current console state and Sylvara adoption remain Unknown until verified through authorized read-only discovery.
