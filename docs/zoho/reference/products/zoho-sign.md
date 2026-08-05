# Zoho Sign Reference

## Status And Scope

- Artifact class: **Reference**
- Research cutoff: **2026-07-20**
- Document-field refresh: **2026-08-05**
- Sylvara adoption: **Unknown**
- Effective Sylvara access: **Unknown**
- Evidence basis: official Zoho Sign API and help documentation reviewed in the audited source material.

This handbook describes portable electronic-signature engineering behavior. It is not legal advice and does not establish a Sylvara Sign account, template, sender, webhook, credit allocation, or API grant.

Legal suitability depends on jurisdiction, document type, consent, identity controls, retention, and approved policy. A successful API test does not establish enforceability.

## Role And Ownership

Sign owns signature requests, documents within a request, recipient actions, assigned fields, signing status, completion evidence, and certificates.

Contracts may own authoring and orchestrate its native Sign lifecycle. A standalone workflow may use Sign when the document is already final. Do not create a Contracts-managed request and a standalone request for the same agreement.

WorkDrive may retain the approved completed packet. Upstream systems should store only the required status projection and private cross-reference, not become a second signature evidence source.

## Authentication And Discovery

Sign uses OAuth 2.0 and data-center-specific API roots. Use a managed client or Connection, the account's verified region, operation-specific document or template scopes, and a durable approved sender.

Before automation, discover and verify:

1. account, region, plan, available credits, owner, and sender permissions;
2. whether Contracts-managed or standalone Sign owns the request;
3. request/template details, roles, documents, field types, and folders;
4. intended recipients, action types, signing order, and authentication;
5. reminders, expiration, correction, recall, and completion policy;
6. webhook configuration, secret ownership, events, and delivery health; and
7. controlled archive location, retention, and downstream consumers.

All request, template, document, action, field-type, folder, and user identifiers are live metadata. Never copy them from documentation or another account.

## Resource And Workflow Model

| Resource | Purpose | Control requirement |
|---|---|---|
| Request/envelope | Top-level signature workflow | Persist returned opaque identifier and intended operation key |
| Document | One file in a request | Freeze content, order, checksum, page count, and approved version |
| Action/recipient | Sign, view, in-person, or approval participation | Validate identity, authority, order, and authentication |
| Field | Assigned signature or data-entry control | Bind to one action and validate page/position/type |
| Template | Repeatable document and role topology | Retrieve current version and roles before use |
| Embed token | Short-lived privileged browser capability | Bind server-side to the authorized session and never log |
| Webhook | Request/action event notification | Verify raw body before parsing and reconcile through API |
| Completion certificate | Execution evidence | Archive with completed documents under retention policy |

Treat unknown future request or action statuses as unresolved. Completion normally requires the expected request status plus all required action evidence retrieved from Sign.

## Document Fields And Text Tags

The current Sign field palette documents these signer or workflow controls:

| Family | Documented fields |
|---|---|
| Execution | Signature, Initial, Stamp |
| Identity and organization | Full Name, Email, Company, Job Title |
| Date and data entry | Sign Date, Date, Text, Split Text |
| Choice | Checkbox, Checkbox Group, Dropdown, Radio |
| Evidence and content | Image, Attachment |
| Calculation and payment | Formula, Payment |

Each placed field must identify its intended action/recipient, type, mandatory state, page, position, dimensions, source document version, and any validation or option set. Do not infer that a visible field is assigned to the correct recipient or that an unassigned field will fail closed.

Automatic field addition supports long and shorthand text-tag syntax. Keep each tag on one line, prefer shorthand when document-generation tools may insert line breaks, and name the intended recipient explicitly. If a tag omits the recipient, Sign assigns it to the first recipient; that fallback is unsafe for generated multi-party documents. The shorthand `*` marker makes supported text or checkbox fields mandatory. Current guidance limits text tags to documents of fewer than 75 pages; recheck this volatile limit before generation. Every generated template still requires a final merged-document test and Sign readback before release.

Text tags are control markup, not authorization or identity proof. Freeze and checksum the exact rendered source document, confirm no tag text remains visible, then verify every field assignment and required state in the created request.

## Automation And Webhooks

Sign supports direct document requests, templates, text tags, embedded signing, embedded sending, and plan-dependent bulk capabilities.

- Freeze and hash the approved document before creating a request.
- Create the draft, retrieve identifiers, and verify every recipient and field before submission.
- Use test mode with synthetic documents during validation; watermarked tests have no production legal effect.
- Bind embedded signing to the intended authenticated user and action on the server.
- Restrict embedded sending to strongly authenticated authorized staff.
- Rate-limit reminders and never automate harassment after decline or expiration.
- Preserve the original request when correcting, recalling, or superseding a document.

Official webhook security uses HMAC-SHA256 over the unchanged raw body with a Base64 signature header. Compare in constant time, keep the secret private, acknowledge quickly, enqueue work, then retrieve authoritative request state.

Webhooks can be delayed, duplicated, reordered, or disabled after repeated receiver failures. Monitor health and maintain reconciliation independent of webhook delivery.

## Failure, Retry, And Idempotency

Parse HTTP status and the response body's code, message, and resource result. Refresh an expired token once; stop on invalid client, revoked token, permission, schema, recipient, field, document, or state errors.

The reviewed API did not document one universal idempotency header. Maintain a private ledger keyed by the approved business operation and document version. Record document hash, intended actions hash, template version, returned request identifier, and lifecycle timestamps.

Lock before create and submit. Retry rate limits and selected transient failures with capped backoff and jitter. After ambiguous create, submit, recall, delete, reminder, or extension outcomes, retrieve request state before retrying.

## Validation

Use synthetic identities and documents to test:

- wrong region, expired/revoked token, missing scope, and unauthorized sender;
- test mode, watermarking, credits, and plan limits;
- one and multiple documents, invalid type, size boundary, malware, and checksum mismatch;
- sequential and parallel recipients, every adopted action type, and recipient limits;
- every adopted field type, coordinates, requiredness, text tags, clipping, and role assignment;
- template drift, stale roles, prefills, and quick-send behavior;
- authentication options, invalid recipient data, reminders, expiration, decline, recall, and correction;
- embedded token wrong user/action/origin, expiration, abandonment, and replay;
- webhook valid/invalid signature, changed body, duplicate, delayed, reordered, and disabled delivery;
- ambiguous create/submit timeout and exact API reconciliation; and
- completed document/certificate download, checksum, archive, retention, and downstream readback.

## Official Sources

- [Document fields](https://help.zoho.com/portal/en/kb/zoho-sign/user-guide/sending-a-document/articles/document-fields-in-zoho-sign)
- [Automatic field addition and text tags](https://help.zoho.com/portal/en/kb/zoho-sign/user-guide/sending-a-document/articles/automatic-field-addition-in-zoho-sign)
- [Zoho Sign API](https://www.zoho.com/sign/api/)
- [OAuth](https://www.zoho.com/sign/api/oauth.html)
- [API endpoints and data centers](https://www.zoho.com/sign/api/api-endpoint.html)
- [API limitations](https://www.zoho.com/sign/api/api-limitations.html)
- [Create document](https://www.zoho.com/sign/api/document-managment/create-document.html)
- [Send document for signature](https://www.zoho.com/sign/api/document-managment/send-document-for-signature.html)
- [Get document details](https://www.zoho.com/sign/api/document-managment/get-details-of-a-particular-document.html)
- [Download completed PDF](https://www.zoho.com/sign/api/document-managment/download-pdf.html)
- [Template management](https://www.zoho.com/sign/api/template-managment.html)
- [Webhook management](https://help.zoho.com/portal/en/kb/zoho-sign/admin-guide/webhooks/articles/webhooks-management)
- [Webhook HMAC security](https://help.zoho.com/portal/en/kb/zoho-sign/admin-guide/webhooks/articles/securing-zoho-sign-webhooks-with-hmac-authentication)

## Exclusions

This public reference intentionally excludes account and request identifiers, templates, fields, documents, recipients, authentication details, signing URLs, embed tokens, completion certificates, webhook endpoints and secrets, credits, connection names, credentials, payloads, audit trails, and organization-specific legal or business rules.

Plans, credits, limits, signing providers, authentication methods, status values, regional behavior, and legal suitability are volatile and require live verification.
