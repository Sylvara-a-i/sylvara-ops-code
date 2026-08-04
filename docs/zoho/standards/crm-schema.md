# Zoho CRM Schema Standard

## Status

- Repository standard: **Proposed**
- Official capability evidence: Zoho CRM API V8 documentation, subject to current-product verification
- Advertised MCP evidence: dated 2026-08-03 contract snapshot only
- Sylvara CRM organization, edition, schema, permissions, workflows, and effective MCP access: **Unknown**

This standard is reviewed design guidance. It is not proof of a live field, layout, tool capability, deployment, or approved CRM change.

## Scope

This standard defines how Sylvara evaluates and changes Zoho CRM modules, fields, layouts, picklists, lookups, workflows, and records. It intentionally does not select Sylvara fields. Field selection follows Sylvara's sales and delivery requirements, not another tenant's schema.

The current reference is Zoho CRM API V8. Verify the live organization, edition, API version, metadata, and connector schema before implementation because limits and capabilities can change.

## Ownership

Zoho CRM owns approved prospect, customer, contact, opportunity, and commercial relationship state. It does not own accounting balances, subscription billing truth, private document contents, legal execution evidence, credentials, or middleware deployment state.

Each proposed module, field, workflow, or record must identify its authoritative owner and downstream consumers. CRM may index an external object by a private stable reference, but it must not silently duplicate facts owned by Books, Billing, WorkDrive, Contracts, Sign, Mail, or another approved system.

## Metadata-First Sequence

1. Read the organization identity and environment using the named audit server.
2. Read modules and use returned `api_name`, never a display label or repository guess.
3. Read the target module, layouts, sections, profiles, and permissions.
4. Read fields and capture API capability flags, data types, limits, sensitivity, and dependencies.
5. Read picklist or global-picklist values and their actual/reference mappings.
6. Read every dependency exposed by the audit contract, including workflow, lookup, layout-rule, and related-list context where available.
7. Check label and API-name collisions, unused fields, duplicate ownership, and authoritative-system boundaries.
8. Produce an exact current/proposed diff and stop for scoped approval.

Repository candidates are not proof of live field existence. Live metadata is authoritative for the target organization.

The observed audit surface does not establish validation-rule, formula-dependency, pipeline, user, or comprehensive related-list discovery. Those prerequisites remain **Unknown** and block an affected change until a future Sylvara audit server exposes and verifies them. A setup standard is not proof that the current server can complete every discovery step.

## Field Metadata To Capture

The [Fields Metadata API](https://www.zoho.com/crm/developer/docs/api/v8/field-meta.html) exposes generic capabilities such as:

- field ID, label, `api_name`, `data_type`, and JSON type;
- `api_create`, `api_update`, visibility, search, sort, mass-update, and webhook support;
- system-mandatory, read-only, virtual, encrypted, restricted, and profile permissions;
- length, decimal places, formula, lookup, subform, multi-user lookup, and textarea details;
- picklist values, ordering, IDs, actual/reference behavior, and color metadata; and
- creation source, layout association, uniqueness, and compliance settings where exposed.

The general Fields Metadata response spans all layouts and does not establish layout-specific mandatory behavior or every layout-specific picklist value. Read the [Layouts Metadata API](https://www.zoho.com/crm/developer/docs/api/v8/layouts-meta.html) for layout context.

## Generic Field Capabilities

| Capability family | Examples | Required design checks |
|---|---|---|
| Text | text, email, phone, website, textarea, rich text | Length, normalization, validation, sensitivity, external-ID support |
| Numeric | integer, bigint, double, currency, percent | Range, precision, scale, currency ownership, rounding |
| Temporal | date, datetime | Time zone, date-only semantics, source-system ownership |
| Choice | boolean, picklist, multiselect picklist, global picklist | Actual/reference values, ordering, defaults, dependencies, retired values |
| Relationship | lookup, user lookup, multi-user lookup, multi-select lookup | Target module, uniqueness, related-list label, filters, permission behavior |
| Generated | autonumber, formula, rollup summary | Immutability, calculation dependencies, backfill, API write restrictions |
| File | file upload, image upload, profile image | Storage boundary, permissions, size, retention, PII; prefer WorkDrive for documents |
| Repeating | subform and linking modules | Parent/child API contract, row limits, edition, duplicate rules, deletion semantics |
| Compliance | encryption, restricted/private data, consent lookup | Legal basis, access profiles, export behavior, audit requirements |

The [Create Custom Field API](https://www.zoho.com/crm/developer/docs/api/v8/create-custom-field.html) currently documents a maximum of five fields per call, no more than two unique fields per module, one auto-number field per module, and edition-dependent field limits. These are API documentation limits, not permission to create fields.

Subforms have separate edition and row limits, and their module/field API names must be discovered. The [Subform API](https://www.zoho.com/crm/developer/docs/api/v8/subforms.html) does not prove that the active MCP server exposes a typed create or placement contract.

## Current MCP Capability Limit

In the 2026-08-03 observed snapshot, `ZohoCRM_createFields` declares its `fields` input as an untyped array. `ZohoCRM_updateLayout` advertises many field types but omits `subform`. Therefore:

- do not guess a field-creation payload;
- do not treat an update schema as a creation schema;
- do not infer parent/child subform creation or placement; and
- do not write until a typed, target-verified contract and rollback path exist.

Official API capability does not expand the active MCP tool contract.

## Field Proposal Contract

Every proposed field must record, in sanitized form where public:

- business purpose and authoritative owner;
- module and layout API names from live metadata;
- field label, requested type, length, precision, default, and requiredness;
- unique/external-ID behavior and duplicate-resolution rule;
- picklist values or lookup target and filter behavior;
- profile permissions, sensitivity classification, retention, and logging rule;
- workflow, formula, layout-rule, import, integration, and reporting dependencies;
- migration or backfill plan; and
- rollback or safe containment plan.

The final API name is verified from the create/readback result. Never assume Zoho generated the requested API name.

## Record And Schema Writes

Use deterministic matching and an external or unique key where appropriate. Before writing, read the exact record or schema object, compare it with the approved prestate, and specify trigger behavior. Apply one bounded high-risk change at a time, then read it back through the audit role.

A write-capable tool's presence is not approval. Bulk updates, layout redesign, field deletion, duplicate cleanup, and record deletion require separate capability, impact, and authorization reviews.

## Repository Boundary

GitHub may contain sanitized schema proposals, generic metadata catalogs, field-purpose descriptions, dependency maps, synthetic fixtures, migration plans, and reviewed API-name conventions. It must not contain live organization, module, layout, field, record, workflow, user, profile, pipeline, connection, or deployment identifiers; customer records; raw submissions; documents; financial data; credentials; or unredacted metadata exports.

Repository schema is desired-state evidence only. Live metadata and returned `api_name` values remain authoritative for the exact Sylvara organization and environment.

## Failure And Readback

- `OAUTH_SCOPE_MISMATCH` is authorization failure, not an empty result.
- A rejected projection or `PATTERN_NOT_MATCHED` permits at most one documented, bounded fallback supported by the tool contract.
- Truncated metadata cannot certify completeness.
- A missing namespace or prerequisite remains **Unknown**; do not substitute another server.
- A timeout after a write requires authoritative readback before any retry.
- UI visibility is not an API security boundary; enforce permissions server-side.

After an approved write, use the independent audit role to read the exact schema object or record, returned API name, type, permissions, layout placement, dependencies, and intended trigger state. Stop on any mismatch, partial response, duplicate, or unexpected downstream effect; do not apply a compensating mutation until its full impact and approval are established.

## Validation

Use synthetic proposals and Development metadata to verify:

- zero, one, and multiple target matches;
- label and API-name collisions, reserved names, and unsupported field types;
- profile, layout, picklist, lookup, formula, workflow, and layout-rule dependencies where relevant;
- required, unique, external-ID, encrypted, restricted, and read-only behavior;
- stale metadata, missing prerequisites, rate limits, authorization failure, malformed responses, and ambiguous timeouts;
- trigger behavior, exact readback, rollback, and safe containment; and
- absence of customer data, private identifiers, credentials, and raw metadata exports from repository artifacts and logs.

A local test or official API example does not prove that a live MCP write contract is typed, authorized, or complete.

## Manual Setup

All live setup is currently **Unknown**. Before relying on this standard for a Sylvara change, verify or configure:

- the exact CRM organization, data center, edition, environment, administrators, and least-privilege audit/change identities;
- module, layout, section, field, profile, workflow, picklist, lookup, and dependency metadata required by the change;
- authoritative-system ownership, duplicate keys, trigger policy, migration/backfill behavior, retention, and reporting impact;
- a typed write contract, one-change approval, rollback or containment procedure, and independent audit readback; and
- a private deployment record containing the approved current/proposed diff and sanitized validation result.

Repository review does not authorize a live schema or record mutation.
