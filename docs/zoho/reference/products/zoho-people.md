# Zoho People Reference

- **Reference ID:** `SYLVARA-ZOHO-PEOPLE-REFERENCE`
- **Research cutoff:** 2026-07-20
- **Repository status:** Reference only
- **Sylvara adoption:** Unknown
- **Effective organization, edition, permissions, and connector access:** Unknown

## Status And Scope

This handbook summarizes durable Zoho People HRIS, metadata, API, workflow, and integration behavior. It is not an employee directory, form export, attendance log, compensation record, or employment policy.

People API versions, scope grammar, form layouts, feature editions, and regional hosts can differ. Current metadata and endpoint documentation control implementation.

## Product Role

Zoho People may own approved workforce identity, employment lifecycle, leave, attendance, shifts, time, performance, and HR documents. Zoho One may own application access, while Books owns accounting and payroll-related financial truth where configured.

People must not be used as a general customer database or as authorization to post accounting entries from unapproved time data.

## Authentication And Discovery

- Use OAuth scopes documented for the exact People API version and service.
- Resolve organization, data center, edition, principal, role, and service availability before reading workforce data.
- Fetch forms, form components, fields, and views before designing record operations.
- Use returned form links, field names, and opaque identifiers; do not derive them from labels.
- Distinguish employee APIs from generic form-record APIs and current v3 service APIs.
- Verify field type, requiredness, picklists, permissions, and view filters from live metadata.
- Begin with minimum read scopes and expand only after a reviewed endpoint need.

## Core Model And Capabilities

- Employee and organizational records are represented through standard and custom forms.
- Forms contain fields and expose views that can change independently of repository assumptions.
- Leave APIs manage requests, grants, balances, and status transitions subject to policy.
- Attendance APIs cover check-in, check-out, entries, devices, and approved corrections.
- Shift APIs expose schedules and assignments with time-zone implications.
- Timesheets track projects, jobs, hours, approvals, and integration outcomes.
- Performance APIs can expose goals, competencies, skills, and review-related data.
- File APIs handle sensitive HR artifacts and require strict access and retention controls.

## Automation And Events

- Workflows can react to approved record events and run alerts, webhooks, custom functions, or field actions.
- Schedulers and custom buttons support bounded administrative automation.
- Connections delegate access to external services and must be least privilege.
- Webhook delivery must be validated against the exact People contract; do not assume universal signature or retry semantics.
- Books, CRM, Projects, Sign, Mail, Recruit, and Analytics integrations require explicit field and ownership mapping.
- Time or attendance data must pass approval and reconciliation before any financial consequence.

## Reliability And Security

- Treat all workforce data as confidential and apply least-privilege role, form, field, and record access.
- Never log personal details, attendance events, leave reasons, compensation, documents, access tokens, or raw payloads.
- Use deterministic external operation keys for create or synchronization workflows where supported.
- Reconcile ambiguous writes before retrying and preserve per-record partial failures.
- Test data-center migration, sandbox, backup, and recovery behavior before relying on them.
- Ensure offboarding disables access without destroying required HR and audit evidence.
- Separate Development data and connections from Production.

## Validation

Before enabling an integration, verify:

1. organization, data center, edition, principal, scopes, role, and service availability;
2. form, field, view, identifier, requiredness, and permission metadata;
3. employee, leave, attendance, shift, time, performance, and file operations actually used;
4. approval, duplicate, pagination, partial-failure, timeout, and reconciliation behavior;
5. workflow, webhook, scheduler, custom-function, and connection ownership;
6. confidential-data redaction, retention, backup, and audit visibility; and
7. rollback plus independent post-change readback.

Use synthetic workforce records in an approved sandbox when available. Repository review is not authorization to alter employment or HR data.

## Official Sources

- [People API v3](https://www.zoho.com/people/api/v3/overview.html)
- [People OAuth](https://www.zoho.com/people/api/oauth.html)
- [People API scopes](https://www.zoho.com/people/api/v3/scopes.html)
- [Fetch forms](https://www.zoho.com/people/api/forms-api/fetch-forms.html)
- [Workflow automation](https://help.zoho.com/portal/en/kb/people/administrator-guide/common-settings/articles/workflow-zoho-people)
- [User access control](https://help.zoho.com/portal/en/kb/people/administrator-guide/settings/manage-accounts/articles/user-access-control-zoho-people)

## Exclusions

This reference contains no employee, applicant, manager, form layout, field value, attendance entry, leave request, shift, timesheet, performance record, document, connection, live identifier, or deployment claim. Sylvara adoption and effective access remain Unknown.
