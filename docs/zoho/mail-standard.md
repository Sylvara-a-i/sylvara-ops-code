# Zoho Mail Standard

## Status

- Repository standard: **Proposed**
- Sylvara Mail organizations, domains, accounts, policies, templates, OAuth grants, and automated senders: **Unknown**

The official [Zoho Mail API index](https://www.zoho.com/mail/help/api/), [getting-started guide](https://www.zoho.com/mail/help/api/getting-started-with-api.html), and [message API reference](https://www.zoho.com/mail/help/api/email-api.html) describe available capabilities. They do not establish an approved sender or production automation.

## Ownership

Zoho Mail may own mailbox, thread, draft, send, delivery-provider response, and organization mail-policy state. CRM owns the commercial relationship and approved communication history. A workflow-specific system owns the business event that justifies a message.

Mail acceptance is not proof of delivery, recipient action, customer eligibility, contract execution, payment, or subscription state. Do not use mailbox content as accounting truth.

## Message Contract

Every automated message class must define:

- business purpose and owning workflow;
- approved sender identity and reply path;
- recipient source and deterministic identity rule;
- template/version and allowlisted merge fields;
- consent, suppression, frequency, and legal-review requirements where applicable;
- stable idempotency key and duplicate-send window;
- attachment source, size, type, and access checks;
- reply, bounce, rejection, complaint, and escalation handling;
- CRM or workflow status recorded after verified send acceptance; and
- rollback or safe containment, including how to disable future sends.

Do not send from a broad generic tool when a dedicated workflow already owns the same communication. Separate transactional, operational, and marketing use cases and approvals.

## Access And Privacy Controls

- Use the narrowest Mail account, message operation, and organization permission needed.
- Separate read/search access from send and administrative access.
- Do not expose full mailbox search to an automation that only sends one message class.
- Allowlist From, Reply-To, destination domains where appropriate, subject/template, attachment type, and maximum recipients.
- Keep tokens, message bodies, recipient lists, attachments, thread content, and full provider errors out of public logs.
- Never treat Bcc as a security boundary or use email as a secret-delivery mechanism.

## Repository Boundary

GitHub may contain sanitized message contracts, approved public-safe template structure, code, synthetic fixtures, and runbooks. It must not contain real addresses, recipient lists, mailbox exports, private message bodies, attachments, signatures, domain-verification values, account or message IDs, OAuth material, organization policies, or raw send/bounce logs.

A committed template is reviewed source, not proof that it is configured, enabled, or legally approved in Zoho Mail.

## Failure And Readback

Fail closed on ambiguous recipient identity, missing consent or suppression evidence, stale customer state, unapproved sender/template, unresolved merge fields, unsafe attachment, duplicate key, recipient-limit breach, authorization failure, rate limit, partial batch result, malformed response, or ambiguous send outcome.

After sending, read the returned message or thread state through the approved Mail path and record only a sanitized outcome in the owning system. Reconcile bounce, rejection, or complaint signals before retry. Do not retry an ambiguous send merely because the CRM activity record is missing.

## Validation

Use controlled non-production mailboxes and approved test domains for end-to-end transport tests. Use reserved example-domain recipients only for validation and rejection cases. Test:

- approved sender and recipient resolution;
- all required and optional merge fields;
- missing, malformed, suppressed, unsubscribed, duplicate, and excessive recipients;
- safe and unsafe attachments;
- provider rejection, rate limit, partial batch, and ambiguous timeout;
- reply, bounce, complaint, and escalation routing;
- duplicate trigger and concurrent-worker behavior; and
- redacted logs, disablement, rollback, and readback.

Production smoke tests require explicit approval and the smallest safe recipient scope.

## Manual Setup

All live setup is currently **Unknown**. Before automation, verify or configure:

- the intended organization, data center, domains, accounts, aliases, sender authentication, and administrator roles;
- narrow OAuth scopes or connections for audit, send, and administration;
- mail policies, retention, forwarding, groups, signatures, and anti-spam settings;
- approved sender identities, reply ownership, templates, attachments, and suppression sources;
- bounce, complaint, failure, alerting, and support procedures;
- CRM or workflow activity mapping; and
- Development tests, production approval, disablement, and independent readback.
