# Zoho CRM Schema Standard

## Status

- Repository standard: **Proposed**
- Official capability evidence: Zoho CRM API V8 documentation, subject to current-product verification
- Field-type documentation rechecked: **2026-08-05**
- Configured-selection evidence: dated 2026-08-04 Sylvara service-plus-operation-key snapshot, superseded for CRM by a callable-role refresh on 2026-08-05
- Effective access verified on 2026-08-05: organization identity plus scoped module, field, layout, picklist, record, and Lead-conversion-map reads; bounded field, layout, picklist, help-text, and record mutations with independent readback
- Effective write access unavailable on 2026-08-05: direct typed native Convert Lead, Lead Conversion Mapping mutation, and workflow-rule mutation; a readable workflow action named Convert does not establish any of those write contracts
- Edition, comprehensive permissions, validation rules, formula dependencies, pipeline metadata, and unexercised contracts: **Unknown**

This standard is reviewed design guidance. Dated effective-access evidence proves only the scoped contracts exercised for the exact verified target; it is not continuing approval or proof of an unlisted capability.

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

## CRM Field-Type Crosswalk

Zoho's administrator-facing field label, Fields Metadata `data_type`, Create Custom Field API value, and formula return type are separate concepts. Do not use them interchangeably. The following is a portable working crosswalk, not proof that the type is enabled for a particular module, layout, edition, data center, or MCP role.

| Administrator/UI type | API or metadata type | Design rule |
|---|---|---|
| Single Line / Text | `text` | Use for short text, codes, identifiers, and postal codes that may contain leading zeroes or non-numeric characters |
| Multi-Line | `textarea` | Choose plain-small, plain-large, or rich-text subtype deliberately |
| Email | `email` | Normalize only for matching under an approved policy; preserve the supplied value |
| Phone | `phone` | Treat as text/contact data, not a number used for arithmetic |
| URL | `website` | Validate scheme and destination; never place secrets in URLs |
| Pick List | `picklist` | Record exact ordered values, scope, default, actual/reference values, history, and color behavior |
| Multi-Select Pick List | `multiselectpicklist` | Use sparingly because queries, automation, reporting, retirement, and cross-product mappings are more complex |
| Checkbox | `boolean` | Define the meaning of false, null, and default separately |
| Number | `integer` | Whole-number quantity; do not use for identifiers |
| Long Integer | `bigint` | Large whole number; text is still safer for non-arithmetic identifiers |
| Decimal | `double` | Define allowed range, precision, scale, and rounding |
| Currency | `currency` | Monetary amount only; name the owning currency and accounting source |
| Percent | `percent` | Verify live metadata, range, storage, and display semantics before automation |
| Date | `date` | Calendar date without an implied time or time zone |
| Date/Time | `datetime` | Record the source time zone and normalization/display rule |
| Lookup | `lookup` | Resolve target module API name, related-list behavior, filter, permissions, and deletion semantics |
| User | `userlookup` | Distinguish a custom user lookup from the system owner field |
| Multi-User | `multiuserlookup` | Define allowed users, cardinality, related-list behavior, permissions, limits, and create/update semantics separately from `userlookup` |
| Auto-Number | `autonumber` | Define prefix, suffix, start, existing-record behavior, and external-reference suitability |
| Formula | `formula` | Define expression, return type, null behavior, precision, dependencies, and refresh behavior |
| Rollup Summary | `rollup_summary` | Define parent/related module, related list, function, criteria, return type, and stale/recalculation behavior |
| File Upload | `fileupload` | Confirm count, size, extension, permissions, retention, and whether WorkDrive should own the document |
| Image Upload | `imageupload` | Confirm count, size, portal exposure, retention, and image-content risk |
| Multi-Select Lookup | `multiselectlookup` in metadata | Treat as a linking relationship with an explicit linking module and related lists; verify the creation contract live |
| Subform | `subform` in metadata | Maintain a separate child-field dictionary and test row IDs, order, limits, updates, and deletion semantics |
| Radio Button | UI field; API mapping requires live readback | Do not assume it is interchangeable with `picklist`; verify the created field's metadata and API behavior |
| Address | UI/composite field; API mapping requires live readback | Do not assume one writable scalar field or cross-product compatibility; inspect its returned component model |

Fields Metadata can also return system or component types such as `ownerlookup`, `profileimage`, and `territories`. Their presence does not make them valid custom-field creation types.

The current [Create Custom Field API](https://www.zoho.com/crm/developer/docs/api/v8/create-custom-field.html) documents these configurable lengths or counts: text 1–255, textarea 2,000/32,000/50,000, email 1–100, phone 1–30, integer 1–9 digits, auto-number 1–255, currency 1–16 digits, percent 1–5 digits, bigint 1–18 digits, double 1–18 digits, website 1–450, file upload 1 or 5 files, and image upload 1–10 images. These are dated API-documentation facts, not safe defaults; recheck the exact module, edition, layout, and live metadata before use.

### Multi-Line Subtypes

| Subtype | Documented capacity | Important behavior |
|---|---:|---|
| Plain Text Small | Up to 2,000 characters | Can be mandatory, encrypted, and used in filters/criteria according to current help |
| Plain Text Large | Up to 32,000 characters | Can be mandatory; current help says it is not encrypted or supported in filters/criteria |
| Rich Text | Up to 50,000 characters including markup | Cannot be mandatory or encrypted and has substantial view, search, mobile, formula, export, and integration limitations |

Do not default to Rich Text. Confirm allowed markup, template behavior, edition support, search/export behavior, and sanitization for the exact workflow.

## Agent Module And Field Specification Contract

When module creation, rename, mapping, or automation is in scope, identify it as `Display Label — Module Type` and provide:

| Module Display Label — Module Type | Zoho Base Module | API Name | API Status | Purpose | Relationships |
|---|---|---|---|---|---|

When field creation or material revision is in scope, identify it as `Field Label — Field Type` and provide:

| Field Label — Field Type | API Name | API Status | Required / Unique | Help Text | Default / Choices | Owner And Dependencies |
|---|---|---|---|---|---|---|

Use the returned `api_name` for an actual field. Use `TBD_FROM_ZOHO_METADATA` when unresolved. A proposed API name must remain in a separate `proposed_api_name` value and must not be used in code, Deluge, webhooks, merge maps, or environment variables until verified.

For each proposed field, also record layout/section, source of truth, sensitivity, retention, profile access, external-ID behavior, integration mappings, migration/backfill behavior, and rollback or containment. A record export or screen label is not API-name or field-type evidence.

### Help Text

Use an internal maximum of 255 characters for field-creation help text. This is a Sylvara authoring constraint, not a claim that every Zoho interface uses the same limit. The current API documents `static_text` tooltips up to 35 characters and `info_icon` tooltips up to 255 characters. Name the tooltip mode and validate the saved/read-back text.

Help text should tell the user what to enter, identify the authoritative source when ambiguous, explain special formatting, and avoid secrets, customer data, legal advice, or policy prose.

### Choice Fields

Every proposed picklist, multi-select picklist, Stage, radio-style choice, or similar choice field must specify:

- exact values in entered order;
- local, global, or standard-module scope;
- exact default or `None`;
- actual/reference-value behavior;
- history-tracking decision;
- retirement/replacement behavior; and
- color behavior: either explicit `None` or, only when the verified field type supports it and an approved semantic/accessibility need exists, a six-digit `#RRGGBB` value for each affected option.

The repository does not establish a brand palette. If color is supported and materially improves an approved workflow, the following optional semantic palette is a starting point; otherwise record `None` and omit color configuration:

| Meaning | Hex |
|---|---|
| New or informational | `#2563EB` |
| Waiting or pending | `#D97706` |
| Contract or approval workflow | `#7C3AED` |
| Approved, active, or complete | `#16A34A` |
| Caution or nonstandard | `#EA580C` |
| Failed, denied, terminated, or urgent | `#DC2626` |
| Inactive, archived, unknown, or not applicable | `#6B7280` |

This is not a Zoho default, brand palette, or proof of live colors. Verify contrast and non-color status cues. If live metadata returns no color, preserve that evidence; do not assign a cosmetic color merely to complete the specification.

### Complex-Type Minimum Design

- **Lookup/User/Multi-User:** target module or user population, verified API name, direction, related-list behavior, filters, cardinality, permissions, limits, and delete or deactivation behavior. Do not conflate `userlookup` with `multiuserlookup`.
- **Formula:** exact expression, return type, precision, null handling, referenced API names, refresh behavior, workflow implications, and backfill/recalculation test.
- **Auto-Number:** prefix/suffix, starting value, digit length, existing-record behavior, reset behavior, uniqueness, and whether external consumers may rely on it.
- **Rollup Summary:** parent, related module/list, aggregation, source field, criteria, empty-set behavior, edition support, recalculation timing, and workflow-loop risk.
- **File/Image Upload:** allowed count/types/size, malware/content controls, profile and portal permissions, sensitivity, retention, deletion, and WorkDrive ownership decision.
- **Subform/Multi-Select Lookup:** separate child/linking schema, stable row/link keys, permissions, ordering, limits, create/update/delete semantics, and reconciliation.

The [Create Custom Field API](https://www.zoho.com/crm/developer/docs/api/v8/create-custom-field.html) currently documents a maximum of five fields per call, no more than two unique fields per module, one auto-number field per module, and edition-dependent field limits. These are API documentation limits, not permission to create fields.

Subforms have separate edition and row limits, and their module/field API names must be discovered. The [Subform API](https://www.zoho.com/crm/developer/docs/api/v8/subforms.html) does not prove that the active MCP server exposes a typed create or placement contract.

## Current MCP Capability Limit

The 2026-08-05 CRM role refresh supersedes the CRM portion of the older configured-selection snapshot. The verified surface supported scoped organization, module, field, layout, picklist, record, workflow, and Lead-conversion-map reads plus the bounded field, layout, picklist, help-text, and record mutations exercised during the approved CRM change. A workflow read exposed a Convert action, but the change surface did not expose a direct typed native Convert Lead write, Lead Conversion Mapping mutation, or workflow-rule mutation. Therefore:

- treat only an exercised typed operation as verified and recheck the target before reuse;
- do not guess a field, layout, workflow, conversion, module, or subform payload;
- do not substitute generic record creation for native Lead conversion or a configuration endpoint;
- do not infer absent conversion or workflow writes from official REST API support; and
- require private prestate, scoped approval, rollback, and independent readback for every live change.

The sanitized [CRM schema and Lead-conversion package](../../../src/zoho-crm/README.md) records the dated field and mapping contract without publishing private identifiers. Official API capability does not expand the active MCP tool contract.

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

GitHub may contain approved sanitized schema proposals, field labels and API names, generic metadata catalogs, field-purpose descriptions, dependency maps, synthetic fixtures, migration plans, and reviewed API-name conventions. It must not contain live numeric or opaque organization, module, layout, field, record, workflow, user, profile, pipeline, connection, or deployment identifiers; customer records; field values; raw submissions; documents; financial data; credentials; or unredacted metadata exports.

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

The dated CRM package verifies only the scoped 2026-08-05 schema, mapping-read, and completed-change evidence it names. Native Lead conversion mapping, pilot/subscription conversion automation, comprehensive dependency discovery, and any future live setup remain undeployed or **Unknown**. Before relying on this standard for another Sylvara change, verify or configure:

- the exact CRM organization, data center, edition, environment, administrators, and least-privilege audit/change identities;
- module, layout, section, field, profile, workflow, picklist, lookup, and dependency metadata required by the change;
- authoritative-system ownership, duplicate keys, trigger policy, migration/backfill behavior, retention, and reporting impact;
- a typed write contract, one-change approval, rollback or containment procedure, and independent audit readback; and
- a private deployment record containing the approved current/proposed diff and sanitized validation result.

Repository review does not authorize a live schema or record mutation.
