# Zoho Workflow And Intake Standard

## Status

- Repository standard: **Proposed**
- Sylvara Creator apps, Development/Stage/Production environments, Forms, Sites pages, portals, integrations, and live workflows: **Unknown**

Use the smallest Zoho product that reliably supports the approved workflow. The [Creator API v2.1 overview](https://www.zoho.com/creator/help/api/v2.1/), [Creator API limits](https://www.zoho.com/creator/help/api/v2.1/api-limits.html), [Zoho Forms help](https://www.zoho.com/forms/help/), and [Zoho Sites help guide](https://help.zoho.com/portal/en/kb/zohosites/help-guide/welcome-to-sites) describe available product surfaces. They do not establish a Sylvara implementation.

## Ownership

- **Zoho Sites** may provide an approved public doorway and published informational content.
- **Zoho Forms** may collect lightweight external intake when a full workflow application is unnecessary.
- **Zoho Creator** may own approved workflow UI, human tasks, operational views, and app-local state that has no more authoritative owner.
- **Zoho CRM** owns prospect, customer, contact, opportunity, and commercial relationship state.
- **Zoho Books and Billing** retain their accounting and subscription ownership.
- **Zoho WorkDrive** stores approved private attachments and documents.

Creator must not silently become a second CRM, an accounting ledger, or an unapproved custom client platform. Sites and Forms are not systems of record merely because they receive data first.

## Product Selection

Choose Sites for public navigation or content, Forms for bounded external intake, and Creator only when the workflow needs authenticated views, human task state, multi-step operations, or product-native reports that simpler tools cannot provide.

Before building, document the commercial outcome, users, authoritative owner for each field, expected volume, privacy class, duplicate key, failure route, support burden, and kill criteria. Do not add a portal, custom app, or generalized workflow framework without evidence that the smaller option is insufficient.

## Creator Environment Promotion

When Zoho Creator Stage is available and adopted, use a controlled **Development -> Stage -> Production** promotion path. Development is for implementation and synthetic testing. Stage is the preproduction acceptance boundary for permissions, connections, schedules, integrations, migration behavior, and operator sign-off. Production remains separately configured and separately approved.

Do not treat Stage as a copy of Production, populate it with live customer data by default, or assume that a successful promotion proves environment-specific connections, IDs, URLs, schedules, or permissions are correct. Record the immutable source and schema version, validate Stage with sanitized fixtures, review the promotion diff, and independently read Production after an approved release. Forms and Sites use their own preview and publication controls; Creator Stage does not authorize those releases.

## Intake Contract

Every intake path must define:

- the minimum required fields and allowed values;
- server-side validation and normalization;
- consent, notice, retention, and deletion requirements where applicable;
- attachment type, size, malware-review, and WorkDrive routing rules;
- spam, abuse, rate-limit, and bot controls;
- deterministic matching and duplicate handling;
- the exact authoritative destination and trigger behavior;
- the manual-review state for incomplete or ambiguous submissions; and
- a stable correlation or idempotency key for downstream actions.

Do not infer identity from a name or email match alone when a wrong match could affect a customer, payment, contract, or private record.

## Repository Boundary

GitHub may contain sanitized desired-state schemas, validation rules, field mappings, Deluge source, synthetic fixtures, state diagrams, and setup/runbook documentation. It must not contain form submissions, portal users, customer records, uploaded documents, published private URLs, production app/report/form IDs, connection names, OAuth values, raw webhooks, or screenshots with live data.

A schema in GitHub describes reviewed intent; live Creator, Forms, Sites, and CRM metadata must be read before a change.

## Failure And Readback

Fail closed on missing required fields, ambiguous identity, duplicate ownership, invalid attachment, unsupported status, stale target state, failed authentication, quota or rate limit, partial downstream update, malformed response, or unknown write outcome.

Do not show a success confirmation until the durable intended outcome is known. If the intake is safely preserved but downstream processing is pending, present or record a truthful pending/manual-review state. Read the authoritative destination independently and compare the stable key, normalized fields, status, and expected links.

## Validation

Required synthetic or Development coverage includes:

- valid, missing, malformed, oversized, hostile, duplicate, and spam-like submissions;
- zero, one, and multiple identity matches;
- attachment acceptance, rejection, and storage failure;
- API quota, rate limit, authorization failure, and partial downstream failure;
- exact replay and concurrent submission behavior;
- truthful success, pending, and failure messaging;
- accessibility and mobile behavior for public intake; and
- redaction, retention, rollback, and authoritative readback.

Creator workflows must also test role permissions and record visibility in Development and, when adopted, Stage before Production promotion. Public Forms and Sites must be tested without authenticated operator privileges.

## Manual Setup

All live setup is currently **Unknown**. Before publication, verify or configure:

- the selected product and why simpler alternatives are insufficient;
- Development, Stage when adopted, and Production ownership, administrators, roles, sharing, API grants, promotion permissions, and separation controls;
- Forms fields, validation, spam controls, notices, integrations, and attachment behavior;
- Creator forms, reports, workflows, permissions, schedules, connections, and API limits;
- Sites page, domain, publishing, analytics, and embedded-form behavior;
- CRM and WorkDrive destination metadata and duplicate keys; and
- smoke tests, rollback, monitoring, support ownership, and independent readback.
