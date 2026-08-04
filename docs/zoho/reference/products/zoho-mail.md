# Zoho Mail Reference

## Status And Scope

- Artifact class: **Reference**
- Research cutoff: **2026-07-20**
- Sylvara adoption: **Unknown**
- Effective Sylvara access: **Unknown**
- Evidence basis: official Zoho Mail API and administration documentation reviewed in the audited source material.

This handbook covers organization administration, mailbox API behavior, sending, bounded polling, attachments, retention, and audit controls. It does not prove that a Sylvara domain, mailbox, sender, API client, retention policy, or integration exists.

Live account state, regional routing, current endpoint documentation, and approved communications policy outrank this reference.

## Role And Ownership

Mail owns organization email domains, employee mailboxes, messages, folders, labels, threads, delivery state, users, groups, policies, and approved administrative mail controls.

Mail is a communications and evidence source. It must not replace CRM relationship and consent state, accounting records, contract/signature evidence, WorkDrive document custody, or a purpose-built marketing or high-volume transactional delivery service.

Automate mailbox metadata and bounded workflows more readily than message content. Reading, searching, exporting, sending, deleting, or administering mail can expose or alter highly sensitive information.

## Authentication And Discovery

Mail API uses OAuth 2.0 and regional API hosts. Bind one approved client or Connection to the correct regional base, request endpoint-specific scopes, and reject caller-selected hosts.

Separate read-only mailbox access, sending, and organization administration. Routine integrations should not use a super-administrator's refresh token.

Discovery sequence:

1. confirm organization, region, current user, role, and permitted operation;
2. resolve the approved mailbox account and authorized sender addresses;
3. retrieve folder and label metadata rather than relying on names;
4. verify domain, user, group, and policy state before administrative proposals;
5. inspect rate, size, sending, retention, recovery, and plan constraints;
6. confirm search, pagination, attachment, and response contracts; and
7. document consent, retention, legal-hold, and downstream ownership boundaries.

Keep organization, user, account, group, folder, label, message, thread, and attachment identifiers private and scoped to their owning resource.

## Resource And Workflow Model

| Resource | Purpose | Control requirement |
|---|---|---|
| Organization | Domain and administrative boundary | Verify exact region and administrator role |
| Domain | Email identity and delivery configuration | Change MX, SPF, DKIM, aliases, and hosting only under controlled review |
| User/account | Mailbox principal and address context | Bind authorized user, mailbox, aliases, and status |
| Group | Distribution and membership | Review recipient expansion and membership periodically |
| Folder | Hierarchical mailbox state | Use opaque identifier; names can change |
| Label | Message classification | Keep distinct from folders and downstream tags |
| Message | One email artifact | Scope body and attachment access to an approved purpose |
| Thread | Related message collection | Do not infer one message's authority from the whole thread |
| Attachment | File associated with a message | Inspect metadata, scan, hash, and store only when approved |
| Retention/hold | Compliance preservation control | Require records or legal authority and audit evidence |

Subjects, snippets, participants, message identifiers, filenames, and search terms are sensitive metadata even when the body is not retrieved.

## Automation And Webhooks

For an approved API send:

1. resolve the mailbox and allowed sender from trusted configuration;
2. resolve recipients and communication basis from the authoritative system;
3. preview To, CC, BCC, subject, purpose, template revision, attachments, and schedule;
4. validate suppression, consent, content, links, attachment type, and size;
5. acquire a durable outbox operation key;
6. send once and persist the returned message reference privately; and
7. reconcile delivery or ambiguous results before another send.

No general mailbox new-message webhook was identified in the reviewed public documentation. Use bounded polling for approved accounts and folders: maintain a watermark plus overlap, paginate deterministically, deduplicate by account and message identifier, and advance the watermark only after durable processing.

The documented SIEM integration is an administrative audit-event surface, not a complete mailbox-message event feed. Do not use it as a substitute for message retrieval.

Inspect attachment metadata first, stream content, enforce type and size policy, malware scan, hash for duplicate/evidence correlation, and store one approved copy in the proper private repository.

## Failure, Retry, And Idempotency

Parse HTTP status and the Mail response body's status and error details. Refresh an expired token once. Stop on permission, policy, invalid sender, validation, restricted account, or bad-address failures.

Queue rate-limited work with capped exponential backoff and jitter. Retry selected read failures only. A timeout or server error during send is ambiguous: search and reconcile using the private outbox operation and narrow time window before retrying.

Do not rotate senders or mailboxes to evade restrictions. Stop new sends, preserve the outbox, and investigate account reputation, policy, content, or security causes.

## Validation

Use synthetic accounts and messages to test:

- correct region, organization, account, sender, token, scopes, and roles;
- folder, label, message, thread, search, pagination, and watermark behavior;
- send preview, To/CC/BCC disclosure, HTML sanitization, schedule, and timezone;
- exact duplicate, concurrent send, timeout-before/after acceptance, and reconciliation;
- invalid address, revoked token, permission, policy, rate limit, and sending restriction;
- attachment metadata, blocked type, size boundary, malware, hash, and cleanup;
- poll overlap, delayed/moved messages, partial page failure, and replay;
- domain, group, user, and policy changes only in a controlled administrative test;
- retention, hold, export, recovery, and access audit boundaries; and
- disabling the integration without deleting mailbox evidence.

Never use real mailbox content in repository fixtures, logs, prompts, or screenshots.

## Official Sources

- [Zoho Mail API index](https://www.zoho.com/mail/help/api/)
- [Getting started with Mail API](https://www.zoho.com/mail/help/api/getting-started-with-api.html)
- [OAuth 2.0](https://www.zoho.com/mail/help/api/using-oauth-2.html)
- [Organization API](https://www.zoho.com/mail/help/api/organization-api.html)
- [Domain API](https://www.zoho.com/mail/help/api/domain-api.html)
- [Users API](https://www.zoho.com/mail/help/api/users-api.html)
- [Email messages API](https://www.zoho.com/mail/help/api/email-api.html)
- [Send an email](https://www.zoho.com/mail/help/api/post-send-an-email.html)
- [Search emails](https://www.zoho.com/mail/help/api/get-search-emails.html)
- [Rates and limits](https://www.zoho.com/mail/help/adminconsole/rates-and-limits.html)
- [Retention and eDiscovery](https://www.zoho.com/mail/help/adminconsole/retention-and-ediscovery.html)
- [Backup and recovery](https://www.zoho.com/mail/help/adminconsole/backup-and-recovery.html)

## Exclusions

This public reference intentionally excludes domains, addresses, organization and mailbox identifiers, groups, folders, labels, messages, threads, subjects, recipients, bodies, attachments, searches, sending schedules, policies, retention matters, webhook endpoints, connection names, credentials, tokens, logs, and organization-specific communication rules.

Limits, plan eligibility, regional hosts, sending restrictions, retention, audit, and SIEM behavior are volatile. Verify them before implementation.
