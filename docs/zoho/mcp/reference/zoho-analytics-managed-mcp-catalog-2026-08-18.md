# Zoho Analytics Managed MCP Tool Catalog

## Evidence Status

- Classification: **Reference**
- Official managed-tool page reviewed: **2026-08-18**
- Managed tool names observed: **24**
- Sylvara configured selection: **Unknown**
- Sylvara organization, plan, workspace, authorization, and effective access: **Unknown**
- Deployment decision: Use managed MCP for bounded operator work; use the direct API for production ingestion

This catalog records the tool names published on Zoho Analytics' managed MCP page on the review date. It does not prove that a Sylvara MCP server exists, that any tool is enabled, that the selected plan supports an operation, or that a connected identity can reach the intended organization or workspace.

The dated [Tool Manual service catalog](tool-manual-service-catalog-2026-07-24.md) counted 25 Zoho Analytics rows on 2026-07-24. The official managed Analytics MCP page reviewed here listed 24 callable names on 2026-08-18. These are different evidence layers and may differ by product surface, publication date, or catalog maintenance. This repository does not silently reconcile the difference. Reinspect both surfaces before configuration.

## Official Managed Tool Inventory

### Workspace And View

| Tool | Published purpose | Initial Sylvara role |
|---|---|---|
| `createWorkspace` | Create a workspace | Changes during approved initialization only |
| `getAllWorkspaces` | List available workspaces | Audit |
| `getOwnedWorkspaces` | List owned workspaces | Deferred as redundant unless a concrete distinction is required |
| `getOrganizations` | List Analytics organizations | Audit identity check |
| `createTable` | Create a table | Changes |
| `getViews` | List workspace views | Audit |
| `getViewDetails` | Retrieve view details | Audit |
| `deleteView` | Delete a view | Controller only |

### Folder

| Tool | Published purpose | Initial Sylvara role |
|---|---|---|
| `getFolders` | List folders | Audit |
| `createFolder` | Create a folder | Changes |
| `deleteFolder` | Delete a folder | Controller only |
| `renameFolder` | Rename a folder | Changes |
| `moveViewsToFolder` | Move views into a folder | Changes |

### Data

| Tool | Published purpose | Initial Sylvara role |
|---|---|---|
| `addRow` | Add a row | Not enabled for production ingestion |
| `updateRows` | Update rows | Not enabled for production ingestion |
| `deleteRows` | Delete rows | Controller only |
| `createExportJobSQLQuery` | Start a SQL-query export job | Audit |
| `getExportJobDetails` | Read export-job status and details | Audit |
| `downloadExportedData` | Download completed exported data | Audit, with data-minimization controls |

### Analytics And Reports

| Tool | Published purpose | Initial Sylvara role |
|---|---|---|
| `addAggregateFormula` | Add an aggregate formula | Changes |
| `createQueryTable` | Create a query table | Changes |
| `editQueryTable` | Edit a query table | Changes |
| `getQueryTableDetails` | Retrieve query-table details | Audit |
| `createReport` | Create a report | Changes |

## Proposed Role Allowlists

Role names below are public conventions, not live server names.

### Analytics Audit

Enable only:

```text
getOrganizations
getAllWorkspaces
getViews
getViewDetails
getFolders
getQueryTableDetails
createExportJobSQLQuery
getExportJobDetails
downloadExportedData
```

Purpose:

- verify the exact organization, region, workspace, view, folder, and query-table identity;
- inspect the minimum metadata required to design or reconcile reports;
- execute bounded read-only analytical queries; and
- independently read back changes made through a separate credential.

Controls:

- use a distinct read-only identity or non-overlapping grant;
- restrict access to the approved Development or Production reporting workspace;
- do not expose recordings, transcripts, caller contact details, raw CRM tables, or unrestricted all-client exports;
- bind query templates and criteria in code or an approved operator procedure; and
- treat export results as sensitive even when the MCP call itself is read-only.

### Analytics Changes

Enable initially:

```text
createWorkspace
createTable
createFolder
renameFolder
moveViewsToFolder
addAggregateFormula
createQueryTable
editQueryTable
createReport
```

Purpose:

- initialize the approved Development workspace and synthetic model;
- create the bounded Production model after Development acceptance;
- maintain formulas, query tables, folders, and reports; and
- preserve repeatable client-report definitions.

After the approved workspaces exist, remove or disable `createWorkspace`. This role does not receive row mutation or delete tools.

Every write requires:

- exact organization and workspace identity;
- fresh prestate;
- typed inputs and fixed targets;
- a reviewed proposed definition;
- an independent Audit readback; and
- a rollback or replacement path.

### Analytics Controller

Keep disconnected. When a specific cleanup is approved, connect a temporary role containing only the required subset of:

```text
deleteRows
deleteView
deleteFolder
```

Do not keep destructive tools attached to routine operator sessions. A cleanup approval is limited to the exact target and does not authorize adjacent views, folders, tables, rows, or retries after an ambiguous result.

## Tools Not Enabled Initially

| Tool | Reason |
|---|---|
| `getOwnedWorkspaces` | `getAllWorkspaces` plus an identity check is sufficient until a concrete ownership-only use case appears |
| `addRow` | Row-by-row MCP writes are not the production ingestion design |
| `updateRows` | Row-by-row MCP writes are not the production ingestion design |
| `deleteRows` | Destructive and unnecessary for routine reporting work |
| `deleteView` | Destructive and unnecessary for routine reporting work |
| `deleteFolder` | Destructive and unnecessary for routine reporting work |

## Managed MCP Limitations

The reviewed managed tool page did not list tools for:

- asynchronous bulk import;
- dashboard composition;
- dashboard or report PDF generation;
- email-schedule creation or maintenance;
- workspace user or group administration;
- row-level sharing configuration;
- public or private link administration; or
- activity-log or API-log retrieval.

Absence from this managed page does not prove that the underlying Analytics product or API lacks the capability. It means the capability was not in the reviewed managed MCP tool contract. Use the product UI or direct API only through a separately approved, least-privilege workflow.

## Production Data Movement

MCP is not the Retell-to-Analytics ETL path.

The proposed production worker runs in Catalyst and uses the direct Zoho Analytics API with separate least-privilege connections:

| Connection purpose | Minimum proposed scopes |
|---|---|
| Reporting ingestion | `ZohoAnalytics.metadata.read`, `ZohoAnalytics.data.create`, and `ZohoAnalytics.data.read` only when reconciliation requires it |
| Model deployment | `ZohoAnalytics.metadata.read`, `ZohoAnalytics.modeling.create`, and `ZohoAnalytics.modeling.update` |
| Audit/readback | `ZohoAnalytics.metadata.read` and `ZohoAnalytics.data.read` |

Avoid `ZohoAnalytics.fullaccess.all`.

Use asynchronous bulk `updateadd` imports matched on stable `Client ID` and `Call ID`. Persist the import job identifier, poll the result with bounded backoff, capture rejected-row summaries, and reconcile row counts and watermarks before marking an outbox item complete. Do not resubmit an import whose outcome is ambiguous until the existing job and target rows are checked.

## Acceptance Sequence

1. Verify the current official managed-tool page and Tool Manual catalog again.
2. Create a private Audit role with the exact enabled-tool names returned by the live server.
3. Call `getOrganizations` first and verify organization, region, current user, and role.
4. List workspaces and select one exact approved target; never fall back to the first similarly named workspace.
5. Verify the Audit role rejects every write.
6. Create the Changes role with a separate credential and the minimum initialization allowlist.
7. Build only a synthetic Development model.
8. Read back every table, folder, formula, query table, and report through Audit.
9. Test duplicate definitions, stale metadata, missing views, wrong organization, permission failures, truncated exports, and ambiguous write results.
10. Test non-admin client isolation and export restrictions before any Production report.
11. Record only sanitized outcomes in GitHub. Keep server URLs, OAuth material, live identifiers, and response data private.

## Refresh Procedure

1. Record the current managed-tool page date privately.
2. Compare the published names with this file and the current Tool Manual catalog.
3. Inspect additions, removals, renames, input schemas, scopes, side effects, and limits.
4. Compare the intended role allowlists with the exact configured selections.
5. Verify effective tenant access through least-sensitive identity and metadata reads.
6. Update this dated reference only when preserving the historical observation is useful; otherwise add a new dated file.
7. Run repository safety and documentation checks before publication.

## Official References

- [Zoho Analytics managed MCP tool catalog](https://www.zoho.com/analytics/api/v2/zoho-analytics-mcp-server/tools.html)
- [Zoho Analytics managed MCP overview](https://www.zoho.com/analytics/api/v2/zoho-analytics-mcp-server/remote-mcp/zoho-mcp.html)
- [Zoho Analytics API prerequisites and scopes](https://www.zoho.com/analytics/api/v2/prerequisites.html)
- [Zoho Analytics asynchronous bulk import into an existing table](https://www.zoho.com/analytics/api/v2/bulk-api/import-data-async/create-import-job/existing-table.html)
- [Zoho Analytics API limits and units](https://www.zoho.com/analytics/api/v2/api-limits-pricing/api-units.html)
