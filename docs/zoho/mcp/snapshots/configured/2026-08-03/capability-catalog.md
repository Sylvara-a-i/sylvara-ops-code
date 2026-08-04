# Observed Zoho MCP Capability Catalog

## Scope

This catalog is a sanitized snapshot of the Zoho tool contracts advertised to Codex on 2026-08-03. Discovery was read-only: no Zoho record, configuration, document, log, report, or organization endpoint was called.

The complete one-row-per-tool snapshot is in [`observed-tool-inventory.json`](observed-tool-inventory.json). Runtime source namespaces and endpoints were removed because they identify another business and are not portable. Normalized tool IDs are retained only as dated observations; generated or hashed names may change when a connector is regenerated.

## Capability Evidence Layers

Keep these evidence layers separate when designing, documenting, or approving a Sylvara integration:

| Evidence layer | What it establishes | What it does not establish |
|---|---|---|
| Official Zoho product or API documentation | A generally documented product capability, endpoint, scope, limit, or behavior | That Codex has an MCP tool for it, that the feature is enabled for Sylvara, or that a specific identity is authorized |
| Advertised MCP tool contract | The name, description, and input shape exposed by one inspected MCP server at a recorded time | Successful execution, complete response data, correct tenant binding, effective OAuth scope, plan availability, or safe write semantics |
| Effective Sylvara tenant capability | Current access for an exact server identity, tenant, environment, role, grant, plan, and feature configuration | Permission for unrelated operations or continuing access after configuration, authorization, or product state changes |

Record the evidence layer and observation date with every capability claim. Effective tenant capability requires a least-sensitive identity check, a bounded acceptance call when authorized, response validation, and authoritative readback. A lower layer must never be promoted to a higher one by assumption.

## Observed Surface

| Neutral server role | Read | Write / action | Total | Risk note |
|---|---:|---:|---:|---|
| `books-audit` | 168 | 0 | 168 | Read-only, but financial records and reports are sensitive |
| `books-bookkeeping` | 7 | 56 | 63 | Routine-looking writes still affect accounting state |
| `books-controller` | 1 | 64 | 65 | High-risk payments, credits, journals, reconciliation, configuration, and period state |
| `catalyst-audit` | 15 | 0 | 15 | Environment variables, logs, routes, and cache values can contain restricted data |
| `catalyst-break-glass` | 0 | 5 | 5 | Emergency configuration writes; keep disabled or just-in-time |
| `catalyst-release` | 0 | 7 | 7 | Function execution, tests, deployment, rollback, pipeline, and build actions |
| `crm-audit` | 19 | 0 | 19 | Includes both metadata and record-content reads |
| `crm-changes` | 8 | 19 | 27 | Schema, workflow, module, layout, and record writes |
| `workdrive-audit` | 21 | 0 | 21 | Search and download are content-bearing, not harmless metadata reads |
| `workdrive-changes` | 6 | 7 | 13 | Upload, create, move, rename, compress, and extract operations |
| **Total** | **245** | **158** | **403** | Advertised, not call-verified |

The 403 entries are endpoint contracts, not 403 independent business workflows. Some operations overlap across roles.

## Material Findings

### Response contracts

Every observed endpoint returns an untyped data object with a transport status. A success-shaped transport response is not proof that the intended record, financial entry, document, or deployment outcome occurred. Sylvara wrappers must validate the expected response shape, persist returned identifiers privately, and read authoritative state back.

### Zoho Books

The Books surface contains 296 tools across audit, bookkeeping, and controller roles. Almost every observed call accepts `organization_id` at request time instead of enforcing one fixed organization in the server contract. Do not copy that weakness into Sylvara. Bind organization and data center inside the control layer, reject caller-supplied target changes, and use the controls in the [Books Automation Standard](../../../../standards/books-automation.md).

Forty-one Books audit contracts explicitly advertise a report-metadata preflight requirement. Those reports must use the required metadata call, validate requested fields and periods, and fail closed when metadata is missing or stale. The snapshot does not assign a complete report taxonomy, so it does not claim a total number of report-like tools.

### Zoho CRM

The audit surface covers organization, module, field, layout, global-picklist, workflow, task, layout-rule, and record reads. Record reads should be separated from metadata-only audit access because they can expose customer data.

The change surface advertises 27 tools. Important limitations:

- `ZohoCRM_createFields` exposes `fields` as an untyped array. It is not a safe field-creation payload contract.
- `ZohoCRM_updateLayout` does not advertise `subform` in its field-type contract. Do not infer a subform payload.
- Workflow creation references prerequisite discovery that is not fully exposed by the observed server.
- Field-update actions depend on pipeline or user metadata that is not fully exposed.
- No CRM delete endpoint was observed.

Missing prerequisites block the affected write; they are not an invitation to guess or substitute another connector.

### Zoho WorkDrive

The audit role advertises metadata, hierarchy, membership, version, search, preview, sharing, and download reads. The change role adds create-folder, native-file creation, upload, move, rename, ZIP, and extraction operations. No delete, public-share mutation, or permission mutation was observed.

Separate metadata inspection from content search and download. A read-only label does not make document content public or low-risk.

Use the official [WorkDrive API scope reference](https://workdrive.zoho.com/apidocs/v1/teamfolder/getteamfolderfiles) when defining a new identity, then reduce the server allowlist further than the OAuth grant.

### Zoho Catalyst

Audit capabilities cover projects, organizations, deployments, functions, routes, pipelines, cache, environment variables, and logs. Release actions cover function invocation, tests, deployment, rollback, pipeline execution, runtime updates, and build cancellation. Break-glass actions can replace environment variables and change routes or pipelines.

Keep release and break-glass identities separate. Break-glass must be disabled or just-in-time, require explicit incident-scoped approval, preserve existing state, and receive independent readback.

The official Catalyst documentation separates [resource deployment](https://docs.catalyst.zoho.com/en/cli/v1/deploy-resources/introduction/) from production promotion and documents environment-specific [function variables](https://docs.catalyst.zoho.com/en/serverless/help/functions/implementation/). Treat those product workflows as manual approval boundaries even when an MCP action is advertised.

## This Is Not A Sylvara Allowlist

Do not reproduce all 403 tools. Start with the smallest metadata-only audit roles needed to design Sylvara. Add a write only when a defined workflow needs it, its prerequisites are exposed, its target is hard-bound, and its failure and rollback behavior are understood.

Recommended progression:

1. CRM metadata audit without record reads.
2. Books audit with a fixed organization and no exports by default.
3. WorkDrive metadata audit without content download.
4. Catalyst metadata audit with secret-bearing values redacted or omitted.
5. Narrow workflow-specific write roles.
6. Controller or release roles only when a reviewed business need exists.
7. Break-glass only with a tested incident runbook and just-in-time access.

## Refresh Procedure

1. Run `codex mcp list --json` only in a trusted local terminal outside recorded task or CI output; never paste or commit the raw output.
2. Inspect the active tool metadata with `/mcp` or the current tool-discovery surface.
3. Create an allowlisted derivative containing neutral roles, safe tool IDs, capability summaries, input-container names, and read/write classification.
4. Remove server names, endpoints, headers, credentials, connection names, organization IDs, record IDs, sample output, and cross-business configuration.
5. Validate counts, uniqueness, response typing, prerequisite coverage, and sanitization.
6. Record the observation date and mark live authorization and callability separately.
7. Replace the snapshot in one focused pull request; do not silently append stale tools.

## Unknown Surfaces

No Creator, Forms, Billing, Contracts, Sign, Sites, Mail, or Analytics server role was observed. Their current Codex availability and OAuth coverage remain **Unknown** until a named server, advertised tools, target identity, and effective grants are tested.
