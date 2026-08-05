# Zoho Forms Reference

## Status And Scope

- Artifact class: **Reference**
- Research cutoff: **2026-07-20**
- Field-family refresh: **2026-08-05**
- Sylvara adoption: **Unknown**
- Effective Sylvara access: **Unknown**
- Evidence basis: official Zoho Forms documentation reviewed in the audited source material.

This handbook describes Forms as a bounded intake and workflow surface. It does not prove that any form, integration, webhook, approval, connection, or subscription capability exists for Sylvara.

No comprehensive official public contract for arbitrary form and submission CRUD was identified at the research cutoff. Do not invent REST paths, OAuth scopes, schemas, limits, or retry guarantees.

## Role And Ownership

Forms supports published forms, field validation, conditional logic, save and resume, notifications, approvals, tasks, reports, PDF output, payments, sharing, embedding, and documented integrations.

Use Forms to collect the minimum information required for an approved process. A submission is an intake event, not authoritative CRM, accounting, subscription, contract, signature, or document-vault state.

The receiving system owns validation, duplicate resolution, acceptance, and durable operational state. Sensitive content should move only through an approved private integration and remain outside GitHub and public logs.

## Authentication And Discovery

Before implementation, inspect the live form and document:

1. form owner, edition, region, and administrators;
2. exact field link names, types, required rules, aliases, and validation;
3. conditional field and form rules;
4. publishing, sharing, embedding, CAPTCHA, and access settings;
5. prefill, save/resume, and respondent identity behavior;
6. approvals, tasks, notifications, reports, and PDFs;
7. webhooks, connections, and downstream integrations; and
8. retention, encryption, audit, and export settings.

Connections can provide managed OAuth-capable access to supported services. Resolve the correct regional callback and service contract from current official documentation; never copy a callback, credential, or connection name from another environment.

## Resource And Workflow Model

| Resource | Purpose | Control requirement |
|---|---|---|
| Form | Published intake definition | Version fields, rules, privacy notices, and release state |
| Field | Typed submitted value | Record link name, type, purpose, sensitivity, and retention |
| Rule | Conditional visibility or action | Test every branch and server-side revalidation |
| Submission | Respondent-provided event | Treat as untrusted until accepted downstream |
| Approval | Human review state | Keep approval distinct from submission and integration completion |
| Task | Assigned follow-up | Define owner, due state, escalation, and completion evidence |
| Report | Operational view/export | Restrict access and minimize downloadable content |
| PDF | Rendered submission artifact | Classify, protect, and avoid treating as authoritative by default |
| Webhook | Outbound submission delivery | Authenticate where supported, deduplicate, and reconcile |
| Connection | Managed integration authorization | Use least privilege and separate environments |

Maintain a field dictionary for every adopted form: business purpose, authoritative destination, link name, type, requiredness, sensitivity, validation, retention, downstream mapping, and deletion rule.

## Field Families And Dictionary

The current field-types overview groups the form builder's fields as follows. These are authoring categories, not a public arbitrary-submission API schema.

| Family | Documented fields |
|---|---|
| Grid | 1-Column, 2-Column, 3-Column |
| Basic Info | Name, Address, Phone, Email, Website |
| Textbox | Single Line, Multi Line |
| Number | Number, Decimal, Formula, Currency |
| Choices | Dropdown, Radio, Checkbox, Multiple Choice, Image Choices |
| Matrix Choices | Radio, Checkbox, Dropdown, Textbox, Number, Currency |
| Date & Time | Date, Time, Date-Time, Month-Year |
| Uploads | File Upload, Image Upload, Audio/Video Upload |
| Rating Scales | Rating, Slider |
| Instructions | Description, Audio/Video Embed |
| Identifier | Unique ID, Random ID |
| Legal and Consent | Terms & Conditions, Signature, Decision Box |
| Page Elements | Section, Page Break |
| Advanced | Subform, Zoho CRM, Payment |

For each adopted field, record at minimum: display label, verified link name, family and exact type, business purpose, authoritative destination, required/optional/conditional state, default or choices, validation, sensitivity, encryption/personal-field classification, retention, conditional rules, prefill exposure, downstream mapping, and deletion behavior.

Apply additional controls by family:

- composite, matrix, and subform fields require a component or child schema rather than a flat-value assumption;
- formulas, unique IDs, and random IDs require generation and read-only behavior to be verified;
- uploads, signatures, payments, and CRM fields require the exact product-specific integration and privacy contract;
- hidden, prefilled, and conditionally displayed values remain untrusted inputs; and
- sections, page breaks, and instructional content are presentation elements, not submitted business facts unless the live export proves otherwise.

## Automation And Webhooks

Forms documents webhooks, native Zoho integrations, and automation-platform connections. Select the simplest supported path that preserves validation and observability.

- Send only an allowlisted payload; never forward every field by default.
- Keep authentication material outside URLs and repository files.
- Treat static or query-string prefill as public and non-secret.
- Validate prefill-webhook responses before display or submission.
- Distinguish submission, approval, payment, and downstream acceptance states.
- Use native integrations only after verifying field mappings and duplicate behavior.
- Keep notifications free of unnecessary sensitive values and unsafe attachments.

If the current webhook contract does not document message signing, do not invent a signature scheme. Use the strongest supported authentication, a private high-entropy endpoint, strict schema and size validation, and authoritative downstream reconciliation.

## Failure, Retry, And Idempotency

Assume webhook delivery can be duplicated, delayed, reordered, or manually re-pushed. Create a durable receipt key from stable submission metadata available in the verified contract, then persist processing state before applying side effects.

Return success only after the event is durably accepted for processing. If a downstream write times out, read the authoritative system before retrying. A successful webhook transport response does not prove that an approval, integration, payment, or business process completed.

Route validation, authorization, mapping, and conflicting-duplicate failures to review. Bound transient retries with backoff and keep a reconciliation queue for unresolved submissions.

## Validation

Test with synthetic submissions:

- every required, optional, conditional, hidden, repeated, file, signature, and date field;
- browser and mobile rendering, accessibility, CAPTCHA, save/resume, and expiration;
- static, query-string, and webhook prefill without sensitive URL exposure;
- valid, invalid, duplicate, delayed, and replayed webhook deliveries;
- native integration mapping, zero/multiple matches, and downstream rejection;
- approval, task, notification, and manual re-push behavior;
- report, PDF, export, encryption, and role access;
- rate, storage, attachment, and submission limits for the selected plan; and
- rollback by disabling publication/integration without deleting evidence.

Record only sanitized test outcomes in GitHub. Keep real submissions, exports, administrative links, and audit evidence private.

## Official Sources

- [Zoho Forms overview](https://help.zoho.com/portal/en/kb/forms/overview/articles/zoho-forms-welcomes-you)
- [Field types overview](https://help.zoho.com/portal/en/kb/forms/field-types/overview/articles/field-types-overview)
- [Webhook configuration](https://help.zoho.com/portal/en/kb/forms/integrations/webhooks/articles/webhook-configuration)
- [Connections control panel](https://help.zoho.com/portal/en/kb/forms/adminguide/articles/connections-control-panel)
- [Zoho CRM integration overview](https://help.zoho.com/portal/en/kb/forms/integrations/zoho-crm/articles/overview-zoho-crm-integration)
- [Zoho Creator integration](https://help.zoho.com/portal/en/kb/forms/integrations/zoho-creator/articles/zoho-creator-integration-setup)
- [Approval levels](https://help.zoho.com/portal/en/kb/forms/form-approvals/configuring-approvals/articles/setting-up-levels-of-approval)
- [Prefill webhook](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/prefill/articles/prefill-webhook)
- [Encryption and personal fields](https://help.zoho.com/portal/en/kb/forms/form-settings/privacy-features/personal-and-encrypted-fields/articles/encryption-at-zoho-forms)
- [Record audit](https://help.zoho.com/portal/en/kb/forms/form-settings/compliance-audit/record-audit/articles/record-audit)

## Exclusions

This public reference intentionally excludes live form names, links, field dictionaries, aliases, respondent data, prefill values, submission exports, payment details, files, approval participants, notification addresses, webhook endpoints, connection names, credentials, and organization-specific rules.

Plan features, limits, integration behavior, and UI steps are volatile. Verify them in the intended account before adoption.
