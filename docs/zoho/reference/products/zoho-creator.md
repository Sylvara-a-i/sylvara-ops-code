# Zoho Creator Reference

## Status And Scope

- Artifact class: **Reference**
- Research cutoff: **2026-07-20**
- Sylvara adoption: **Unknown**
- Effective Sylvara access: **Unknown**
- Evidence basis: official Zoho documentation reviewed in the audited source material.

This handbook describes portable Creator behavior for architecture and implementation planning. It is not proof that an application, portal, connection, workflow, environment, or API grant exists for Sylvara.

Live metadata, the selected edition, and current official documentation outrank this reference. Repository review does not authorize a Creator change or deployment.

## Role And Ownership

Creator is a low-code workflow and application layer built from forms, reports, pages, workflows, functions, approvals, blueprints, schedules, batch workflows, portals, and connections.

Creator may own explicitly approved application-local workflow state, human tasks, draft intake, and presentation state. It must not silently replace:

- CRM relationship and commercial state;
- Books accounting and reconciliation;
- Billing subscription state;
- WorkDrive document custody;
- Contracts authoring and lifecycle state; or
- Sign execution evidence.

Every synchronized field needs one write authority, a stable external key, a conflict rule, and a reconciliation owner. Browser, portal, page, and widget logic is untrusted and cannot enforce server-side authorization by itself.

## Authentication And Discovery

Creator API v2.1 uses OAuth 2.0. Use a managed connection or secret store, obtain the correct regional API domain from the authorization flow, and request only the operation-specific scopes needed by the workflow.

Before coding, discover and record sanitized metadata for:

1. organization, application, and environment identity;
2. application and workspace link names;
3. forms and their field link names and types;
4. reports used for reads or updates;
5. pages, sections, workflows, approvals, and blueprints;
6. portal roles and permission sets; and
7. connections and custom API contracts.

Display labels are not API contracts. Never infer a link name, record identifier, environment, or connection from an example or another organization.

## Resource And Workflow Model

| Resource | Purpose | Control requirement |
|---|---|---|
| Form | Schema and data-entry surface | Validate field link names, types, requiredness, and duplicate rules |
| Report | Query and record-operation surface | Confirm access context, criteria, pagination, and row scope |
| Page | Composed user interface | Keep authorization and sensitive decisions server-side |
| Workflow | Event or time-based automation | Document trigger order, skipped actions, and side effects |
| Function | Reusable Deluge logic | Bound inputs, calls, execution time, and logging |
| Approval | Human decision state | Do not treat submission as approval |
| Blueprint | Governed state transition model | Verify allowed transitions from current state |
| Batch workflow | Sequential asynchronous processing | Expect partial completion and reconcile each item |
| Portal | External-user application surface | Enforce component, action, field, and row authorization |
| Connection | Managed authorization boundary | Separate environments and apply least privilege |
| Custom API | HTTP surface backed by a function | Treat as an external API with authentication and schema controls |

Use the metadata APIs before data APIs. Select record, file, bulk, or custom API operations only after confirming their current contract and capacity.

## Automation And Webhooks

Creator automation can run through local Deluge, cross-application tasks, workflows, schedules, batch workflows, custom APIs, or external callers using API v2.1. These surfaces have different trigger, transaction, permission, and limit behavior.

- Separate decision logic from record mutation and external calls.
- Make Development the first deployment target and verify environment routing explicitly.
- Use custom APIs only for bounded, typed workflows with least-privilege authentication.
- Treat bulk jobs as asynchronous and reconcile their status and result files.
- Keep portal and widget requests behind server-side identity and row-access checks.
- Do not assume an API workflow-skip option bypasses approvals or blueprint behavior.

Published or public surfaces require a separate privacy and abuse review. A hidden field, filtered report, URL parameter, or client check is not an authorization boundary.

## Failure, Retry, And Idempotency

Validate both transport status and the Creator response body. Classify validation, authorization, capacity, dependency, transient, and ambiguous-outcome failures separately.

Use a durable operation key derived from the approved source event and intended outcome. Lock or claim the key before a write, store the returned opaque identifier privately, and independently read the result back.

Do not blindly retry create, update, delete, file, or custom API operations after a timeout. Search by the stable key and reconcile authoritative state first. Batch workflows may partially complete; a failed batch does not imply earlier items rolled back.

## Validation

Before adoption or deployment, verify with synthetic data:

- correct organization, region, edition, application, and environment;
- metadata discovery and link-name drift detection;
- required, null, lookup, subform, file, date, currency, and choice handling;
- zero, one, and multiple-match criteria behavior;
- workflow, approval, blueprint, and batch side effects;
- portal role, row, field, and action authorization;
- duplicate, concurrent, stale, timeout, rate-limit, and partial-result handling;
- redacted logs and bounded request, response, and file sizes; and
- exact readback, reconciliation, containment, and rollback.

Record the reviewed source revision and live publication evidence privately. A saved application version is not proof of Production publication.

## Official Sources

- [Creator API v2.1](https://www.zoho.com/creator/help/api/v2.1/)
- [OAuth authentication and scopes](https://www.zoho.com/creator/help/api/v2.1/oauth-overview.html)
- [API limits](https://www.zoho.com/creator/help/api/v2.1/api-limits.html)
- [Metadata: get forms](https://www.zoho.com/creator/help/api/v2.1/get-forms.html)
- [Metadata: get fields](https://www.zoho.com/creator/help/api/v2.1/get-fields.html)
- [Bulk API overview](https://www.zoho.com/creator/help/api/v2.1/bulk-api/overview.html)
- [Creator environments](https://help.zoho.com/portal/en/kb/creator/developer-guide/environments/articles/understand-environments)
- [Custom APIs](https://help.zoho.com/portal/en/kb/creator/developer-guide/microservices/custom-api/articles/understand-custom-apis)
- [Portal user permissions](https://help.zoho.com/portal/en/kb/creator/developer-guide/application-settings/portal-permissions/articles/understand-portal-user-permissions)
- [Creator Deluge tasks](https://www.zoho.com/deluge/help/creator-tasks.html)

## Exclusions

This public reference intentionally excludes live application names, link names, field selections, record identifiers, connection names, schedules, portal identities, workflows, payloads, files, logs, credentials, customer data, and organization-specific business rules.

It does not establish current pricing, capacity, plan eligibility, regional availability, API access, or a complete production design. Recheck volatile details immediately before implementation.
