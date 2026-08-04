# Zoho Analytics Reference

## Status And Scope

- Artifact class: **Reference**
- Research cutoff: **2026-07-20**
- Sylvara adoption: **Unknown**
- Effective Sylvara access: **Unknown**
- Evidence basis: official Zoho Analytics API and help documentation reviewed in the audited source material.

This handbook describes Analytics API v2, discovery, data movement, modeling, sharing, connectors, and governance. It does not prove that a Sylvara organization, workspace, data source, report, schedule, share, or API grant exists.

Live metadata, source-system authority, current API documentation, and the selected edition outrank this reference.

## Role And Ownership

Analytics owns derived data models, reports, dashboards, scheduled analytical outputs, and reporting access. It is not a transactional source of truth and must not reverse-write decisions into operational systems without a separately approved workflow.

Source systems retain ownership of relationship, accounting, subscription, workflow, document, and communication facts. Every analytical column and metric needs a source, grain, definition, refresh expectation, sensitivity, and owner.

Use stable source keys and lineage timestamps. Do not join authoritative data by mutable names, email addresses, or display labels.

## Authentication And Discovery

Analytics API v2 uses OAuth 2.0, regional hosts, operation-specific scopes, and organization context required by the current API contract. Use separate credentials for Development and Production and avoid broad full-access scopes.

Minimum discovery sequence:

1. resolve the authorized organization and regional API host;
2. list owned or shared workspaces and select the approved workspace;
3. retrieve workspace details and permissions;
4. list views and retrieve the intended view's metadata;
5. inspect columns, types, dependencies, formulas, data sources, and import state;
6. inspect users, groups, shares, embeds, schedules, and public/private links; and
7. record live opaque identifiers privately with provenance and refresh rules.

If a view or column disappears, stop for schema reconciliation. Never fall back to the first similarly named object.

## Resource And Workflow Model

| Resource | Purpose | Control requirement |
|---|---|---|
| Organization | Account and API context | Confirm region, edition, and authorization |
| Workspace | Model, access, and governance boundary | Classify data and restrict membership |
| View | Table, query table, report, or dashboard | Retrieve live type and dependencies |
| Column | Typed analytical field | Define source, type, null, sensitivity, and lineage |
| Formula | Derived metric or dimension | Version expression, dependencies, and business definition |
| Data source | Imported connector, file, API, or live connection | Record owner, refresh, credentials, and reconciliation |
| Import/export job | Synchronous or asynchronous data movement | Persist job state and rejected-row summary |
| Share/group | User access and distribution | Apply least privilege and periodic recertification |
| Embed/private link | Presentation capability | Authorize server-side and disable public/no-login access by default |
| Schedule | Refresh, export, or email timing | Treat as delayed analytical delivery, not an operational trigger |

Choose row APIs, synchronous bulk, asynchronous bulk, batch import, connector sync, or Live Connect based on volume, latency, source capacity, and recovery requirements.

## Automation And Webhooks

Analytics automation is request, job, connector, and schedule oriented. No generalized source-record change webhook was identified in the reviewed API.

- Use source-system events for operational automation, then load an approved analytical fact.
- Preserve source record/event key, source modified time, load time, and schema version.
- Validate criteria column names against metadata and construct values with a tested allowlist.
- Prevent untrusted callers from supplying raw criteria or all-row update/delete behavior.
- Poll asynchronous jobs with bounded backoff and persist job identifiers.
- Parse rejected rows and reconcile counts and totals to the authoritative source.
- Treat connector sync as lagged and expose refresh time to report users.
- Generate embed or private access only after server-side authorization and approved row filtering.

Analytics email schedules and dashboards are not guaranteed transactional notifications.

## Failure, Retry, And Idempotency

Validate HTTP status and the Analytics response envelope. Stop on authorization, wrong organization, invalid criteria, missing metadata, schema drift, or permission failures.

Delay rate or API-unit failures until the documented reset and reduce request cost. Retry selected network and server failures with capped backoff only after checking replay safety. For asynchronous jobs, inspect job status and result before resubmission.

The reviewed API did not establish a universal idempotency or optimistic-concurrency contract. Use stable source keys, source version columns, lookup-before-write, serialized mutations to the same resource, and post-write reconciliation.

## Validation

Use synthetic or de-identified data to test:

- correct region, organization, workspace, view, token, scopes, and roles;
- metadata drift, missing columns, changed types, and dependency discovery;
- criteria escaping, operator allowlists, time zones, currency, nulls, and all-row protection;
- add, update, delete, batch, import, export, rejected rows, and ambiguous timeout;
- duplicate source key, stale source version, late-arriving changes, and deterministic replay;
- connector initial load, incremental sync, failure, recovery, and source reconciliation;
- API-unit budget, job concurrency, bounded polling, and rate-limit behavior;
- formulas, aggregates, row counts, uniqueness, referential integrity, and totals against source;
- workspace roles, shares, exports, email schedules, embeds, public/private links, and activity logs; and
- rollback through model restoration and a tested data reload path.

Do not use derived reports to certify a live financial or operational action without checking the authoritative source.

## Official Sources

- [Analytics API v2 introduction](https://www.zoho.com/analytics/api/v2/introduction.html)
- [API specification](https://www.zoho.com/analytics/api/v2/api-specification.html)
- [Prerequisites, scopes, and criteria](https://www.zoho.com/analytics/api/v2/prerequisites.html)
- [Authentication](https://www.zoho.com/analytics/api/v2/authentication.html)
- [Add row](https://www.zoho.com/analytics/api/v2/data-api/add-row.html)
- [Update rows](https://www.zoho.com/analytics/api/v2/data-api/update-row.html)
- [Bulk API](https://www.zoho.com/analytics/api/v2/bulk-api.html)
- [API units](https://www.zoho.com/analytics/api/v2/api-limits-pricing/api-units.html)
- [Embed URL](https://www.zoho.com/analytics/api/v2/embed-api/embed-url.html)
- [Security controls](https://www.zoho.com/analytics/help/connectors/security-controls.html)
- [Activity logs](https://www.zoho.com/analytics/help/accounts/audit-logs/activity-logs.html)
- [Live Connect](https://www.zoho.com/analytics/help/datasources/live-connect.html)

## Exclusions

This public reference intentionally excludes organization and workspace identifiers, source names, view and column schemas, formulas, metrics, reports, dashboards, rows, exports, schedules, users, shares, embed or private links, connection names, credentials, tokens, job results, activity logs, and organization-specific analytical rules.

Plans, API units, operation costs, connector coverage, refresh schedules, pagination, job limits, Live Connect behavior, and sharing features are volatile. Verify them before adoption.
