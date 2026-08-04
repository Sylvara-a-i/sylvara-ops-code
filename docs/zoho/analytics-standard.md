# Zoho Analytics Standard

## Status

- Repository standard: **Proposed**
- Sylvara Analytics organizations, workspaces, data sources, tables, reports, dashboards, schedules, and integrations: **Unknown**

The official [Zoho Analytics API v2 introduction](https://www.zoho.com/analytics/api/v2/) and [API specification](https://www.zoho.com/analytics/api/v2/api-specification.html) describe product capabilities. They do not establish a verified Sylvara dataset or dashboard.

## Ownership

Zoho Analytics may own derived datasets, transformation logic configured in Analytics, reports, dashboards, and refresh status. It does not own the originating CRM relationship, Billing subscription, Books accounting, WorkDrive document, Mail message, or workflow state.

Every metric must name its authoritative source, business definition, grain, filters, time zone, currency treatment, refresh expectation, and reconciliation owner. Analytics must not write a derived value back as operational truth unless a separately approved workflow defines that write and its authority.

## Data And Metric Contract

For every imported table, query table, metric, report, or dashboard, document:

- source system and source object;
- stable source key and expected uniqueness;
- included and excluded fields;
- privacy classification and permitted audience;
- transformation, join, deduplication, and null behavior;
- date, time-zone, fiscal-period, currency, and rounding semantics;
- refresh method, schedule, watermark, and acceptable staleness;
- owner, validation threshold, and authoritative reconciliation report; and
- behavior when source data is late, deleted, corrected, or duplicated.

Do not combine records from different customers or environments without an explicit partition and access model. Do not publish a metric whose definition cannot be reproduced from documented sources and transformations.

## Access And Export Controls

Use least-privilege workspace and view access. Separate administrators, dataset maintainers, report authors, and consumers where practical. Apply row-level or audience controls appropriate to the data, and test them with non-admin accounts.

Exports inherit the classification of their source. Raw exports, scheduled attachments, public links, embedded dashboards, and API responses require separate review. Public GitHub may contain only synthetic query examples and sanitized metric definitions.

## Repository Boundary

GitHub may contain sanitized data contracts, metric definitions, transformation/query source, synthetic fixtures, expected aggregate examples, and runbooks. It must not contain workspace/table/report IDs, private share or embed URLs, live exports, customer or employee data, accounting detail, OAuth material, credentials, production queries that expose private topology, or screenshots with live values.

A committed metric definition is reviewed intent; live schema, formula, schedule, permissions, and refresh state remain authoritative in Analytics until independently read and reconciled.

## Failure And Readback

Fail closed on missing lineage, duplicate source keys, schema drift, stale watermark, incomplete refresh, unauthorized audience, cross-customer leakage, currency or time-zone ambiguity, reconciliation variance beyond the approved threshold, truncated API results, rate limit, or unknown import outcome.

After an import or refresh, read job status and target row counts, watermarks, rejected rows, and schema. Reconcile critical totals and counts to authoritative CRM, Billing, or Books reports. A successful API response or visually plausible dashboard is insufficient.

## Validation

Use synthetic datasets to test:

- empty, duplicate, missing, malformed, late, corrected, and deleted source records;
- schema additions, removals, type changes, and unexpected nulls;
- join cardinality and cross-customer partitioning;
- time-zone, period-boundary, currency, and rounding behavior;
- full and incremental refresh, retry, and partial failure;
- row-level access and export restrictions with non-admin users;
- exact aggregate reconciliation to known fixtures; and
- stale-data labels, rollback, and readback.

Financial dashboards must reconcile to the approved Books report and period; confidence or visual agreement cannot replace exact reconciliation.

## Manual Setup

All live setup is currently **Unknown**. Before use, verify or configure:

- the intended organization, workspace, administrators, roles, groups, and data-region requirements;
- data sources, connections, tables, keys, imports, schedules, and API grants;
- query tables, formulas, reports, dashboards, filters, fiscal settings, currencies, and time zones;
- row-level access, sharing, embedding, export, retention, and deletion policies;
- refresh monitoring, alerts, reconciliation owners, and incident handling; and
- synthetic validation, production approval, rollback, and independent source reconciliation.
