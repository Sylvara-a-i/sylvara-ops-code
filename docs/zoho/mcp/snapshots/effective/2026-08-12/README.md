# Sylvara CRM MCP Effective-Access Snapshot — 2026-08-12

## Scope

This is a sanitized, Sylvara-only snapshot of the two CRM roles visible and acceptance-tested on the observation date. Both roles independently resolved to the same authorized target before metadata or mutation work. Private organization, environment, user, profile, connection, and resource identifiers are omitted.

The machine-readable inventory is [crm-tool-inventory.json](crm-tool-inventory.json).

| Role | Access class | Current callable operations | Purpose |
|---|---|---:|---|
| CRM Audit | Read-only | 48 | Independent identity, metadata, dependency, workflow, pipeline, and record readback |
| CRM Changes | Bounded schema change | 14 | Narrow field and layout configuration plus same-target identity/readback |

## Effective Operations In This Deployment

Audit calls verified during this deployment:

- getOrganization
- getUsers
- getFeatureDetails
- getFields
- getLayouts
- getPickListValues
- getPipelines
- getRecordCount
- getWorkflowRules
- getLayoutRules

Changes calls verified during this deployment:

- getOrganization and getUsers for independent target/identity checks
- createFields for bounded custom-field creation
- putFieldsWithId for custom-field label and help-text repair
- updateLayout for section placement and ordering

Every mutation was reconciled through the separate Audit role. A connector success response was not treated as proof of state.

## Known Contract And Effective-Access Limits

- The current MCP projection exposes createFields and putFieldsWithId field items without a concrete item schema. Their bounded successful use in this deployment does not authorize arbitrary future payloads.
- A system Lead Source option update returned connector success but independent Audit readback showed no change. It was not retried.
- deleteCustomField is callable but was not invoked. No deletion is safe without value and dependency proof.
- The current Changes role has no pipeline create/update operation. The proposed consolidated pipeline is therefore not deployed.
- Operations listed as advertised but not exercised remain unverified for effective access and side effects.
- Tool membership can change after a connector refresh; this snapshot is evidence, not a current allowlist.

## Publication Boundary

The JSON uses prefix-free catalog operation keys. It deliberately excludes generated namespaces, transport identifiers, connection aliases, endpoints, authentication details, raw schemas and payloads, tenant IDs, and returned business data.
