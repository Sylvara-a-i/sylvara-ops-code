# Retell, Catalyst, CRM, And Analytics Reporting Runbook

## Status

- Runbook status: **Proposed**
- Implementation status: **Not implemented**
- Live Retell, Catalyst, CRM, or Analytics change authorized by this file: **No**
- Production call path: **Blocked pending the product, legal, vendor, environment, and deployment gates**

This runbook implements the boundary in [ADR 0004](../adr/0004-retell-catalyst-crm-analytics-integration-boundary.md). It describes the order of work and acceptance evidence. It does not contain live names, URLs, identifiers, credentials, customer data, call content, or deployment values.

## Objective

Build the smallest secure reporting path that can:

1. accept approved Retell post-call events;
2. preserve replay-safe and auditable call state in Catalyst;
3. keep CRM limited to relationship and commercial summaries;
4. reconcile downstream outcomes to the customer's authoritative system;
5. batch minimized facts into Zoho Analytics; and
6. produce one reviewed client-isolated report.

Do not build a client portal, general event platform, shared live agent, or CRM call warehouse.

## Prerequisites

Before implementation work:

- the exact Development Retell account and intended agent are identified privately;
- the approved internal-QA or later client-call legal profile is known;
- the exact Catalyst Development project and environment are identified;
- CRM organization identity and approved summary fields are read back;
- the Analytics organization, region, plan, and Development workspace strategy are verified;
- separate Audit and Changes identities or non-overlapping grants are available;
- an approved secret store exists for every credential;
- a synthetic scenario set and expected outcomes exist; and
- containment can restore the prior carrier route and agent configuration.

Stop when any identity, environment, authority, route, or rollback target is ambiguous.

## Phase 1: Reverify Current Contracts

### Retell

Privately verify:

- account identity;
- agent identity and environment;
- account-level and agent-level webhook configuration;
- enabled webhook events;
- signature verification contract;
- timeout and retry behavior;
- recording and transcription settings;
- data-storage mode and retention;
- signed artifact URL settings;
- model-training and data-use settings;
- number and carrier routing; and
- current agent version and rollback target.

Do not publish the values.

### Zoho Catalyst

Verify:

- project and environment identity;
- function type and runtime;
- route ownership and authentication boundary;
- Data Store and job capabilities;
- connection support for Analytics;
- timeout, concurrency, and retry limits;
- log and APM retention;
- Development and Production separation; and
- the independent readback path.

### Zoho CRM

Verify:

- organization identity;
- client/account and commercial-object ownership;
- stable internal `client_id`;
- evaluation or paid-service state;
- approved report-recipient fields;
- approved high-level result fields;
- duplicate and workflow behavior; and
- that no raw-call or transcript fields are required.

### Zoho Analytics

Verify:

- organization and regional API host;
- plan and API availability;
- Development and Production workspaces;
- exact managed MCP tool contract;
- OAuth scopes;
- table, query-table, report, sharing, export, schedule, activity-log, and API-log capabilities;
- asynchronous import and job-status contracts; and
- non-admin row-level access behavior.

Record a private dated evidence package. GitHub receives only the sanitized status.

## Catalyst Packaging Decision

Default to one voice-integration Catalyst project per environment, not one project per client or evaluation. Before creating or modifying a function, inventory every current function, trigger, route, runtime, secret grant, deployment unit, and rollback target in the intended project.

Implement three logical responsibilities:

```text
Retell ingress
Post-call processing and reconciliation
Analytics outbox synchronization
```

Choose physical packaging from the observed contract:

- combine responsibilities only when their trust boundary, runtime, secret access, scaling, failure isolation, and rollback lifecycle match;
- separate the synchronous ingress from slow or retrying work;
- do not create a function per client;
- do not place Retell processing inside the Billing webhook gateway; and
- preserve independent disablement of webhook ingress, customer-system writes, CRM writes, and Analytics sync.

Document the decision and read the final function inventory back before deployment.

## Phase 2: Establish Private Configuration

Create separate Development and Production configuration. The following public names are proposed keys, not proof that a live variable exists:

```text
DEPLOYMENT_ENVIRONMENT
RETELL_WEBHOOK_API_KEY
RETELL_ALLOWED_EVENT_TYPES
RETELL_ALLOWED_AGENT_IDS
CATALYST_CALL_EVENT_TABLE
CATALYST_CALL_TABLE
CATALYST_CALL_ARTIFACT_TABLE
CATALYST_OUTCOME_TABLE
CATALYST_REPORTING_OUTBOX_TABLE
CATALYST_REPORT_RUN_TABLE
ZOHO_ANALYTICS_API_BASE_URL
ZOHO_ANALYTICS_ORG_ID
ZOHO_ANALYTICS_WORKSPACE_ID
ZOHO_ANALYTICS_CALL_FACTS_VIEW_ID
ZOHO_ANALYTICS_DAILY_FACTS_VIEW_ID
ZOHO_ANALYTICS_CONNECTION_NAME
REPORTING_SYNC_INTERVAL_MINUTES
REPORTING_BATCH_SIZE
```

Classification:

| Key class | Storage rule |
|---|---|
| Secret | `RETELL_WEBHOOK_API_KEY` and any OAuth credential material stay only in platform-native secret or Connection storage |
| Private identifier | Organization, workspace, view, table, agent, route, connection, and project identifiers stay in private environment configuration |
| Non-secret behavior | Event allowlists, interval, batch size, and environment labels remain environment-specific and are reviewed before deployment |

Do not commit a populated `.env` file or configuration export.

## Phase 3: Model Client And Agent State

Create one stable client record outside the voice platform and one effective mapping for each client agent and environment.

Required mapping facts:

```text
client_id
crm_relationship_reference
retell_agent_id
agent_version
environment
coverage_mode
effective_from
effective_to
status
```

Acceptance:

- one active mapping per client and environment;
- one client per active agent;
- no mapping by mutable name or prompt text;
- conflicting or missing mapping fails closed;
- promotion preserves the prior accepted agent version; and
- the master template has no client binding and no live number route.

## Phase 4: Build The Catalyst Ingress

The ingress accepts one exact `POST` route and the approved Retell event envelope.

Required processing order:

1. reject the wrong method, route, query shape, media type, or oversized body;
2. capture the unchanged raw body;
3. verify the Retell signature and signed timestamp;
4. parse JSON only after signature success;
5. validate the event type, call identifier, agent identifier, and schema;
6. resolve exactly one active client-agent mapping;
7. derive a stable idempotency key;
8. durably claim a minimized event row;
9. enqueue or persist the normalized call update;
10. return an empty 2xx response inside the provider timeout; and
11. process downstream work asynchronously.

Logging is limited to:

```text
synthetic_request_id
coarse_stage
outcome_class
elapsed_milliseconds
source_revision
```

Do not log signatures, headers, raw bodies, event keys, call IDs, agent IDs, client IDs, phone numbers, transcripts, summaries, artifact URLs, response bodies, or configuration values.

### Duplicate Behavior

- Identical completed duplicate: acknowledge without a second side effect.
- Same key with conflicting normalized facts: mark reconciliation required.
- Existing processing or ambiguous row: do not replay blindly.
- Unknown provider error code: do not classify as a duplicate.
- Timed-out insert or update: read by stable key before deciding whether to retry.

## Phase 5: Normalize Call State

Create one normalized call row per `client_id + call_id`.

Minimum proposed fields:

```text
client_id
call_id
retell_agent_id
agent_version
environment
coverage_mode
started_at_utc
ended_at_utc
duration_seconds
call_status
intent
eligibility_status
urgency_class
disposition
booking_status
transfer_status
human_escalation_required
call_success
qa_status
outcome_version
source_modified_at
reporting_updated_at
```

Optional commercial facts require separate methods and labels:

```text
estimated_opportunity_value
estimated_value_method_version
verified_customer_record_id
verified_booked_value
verified_completed_value
verified_invoiced_value
verified_paid_value
verified_at
```

Do not store payment credentials or infer a later outcome from a voice-analysis field.

## Phase 6: Handle Artifacts

Recordings and transcripts are outside the default analytical path.

When separately authorized, store only a private artifact record:

```text
client_id
call_id
artifact_type
storage_provider
private_object_reference
content_hash
privacy_classification
retention_delete_at
created_at
deleted_at
```

Controls:

- finite provider retention;
- signed expiring URLs;
- no non-expiring URL copied into CRM or Analytics;
- no audio duplication by default;
- no raw transcript in logs;
- role-limited access;
- deletion readback; and
- incident and legal-hold behavior defined privately.

## Phase 7: Reconcile Customer Outcomes

For each approved customer-system integration:

1. identify the exact authoritative object;
2. define the stable call-to-object match;
3. perform the minimum idempotent write or read;
4. read the customer object back independently;
5. preserve pending, verified, corrected, rejected, and unresolved states;
6. avoid retry after ambiguous timeout until target state is reconciled; and
7. record only the minimum opaque customer-system reference in Catalyst.

Do not write a derived Analytics value back into the customer system.

## Phase 8: Update CRM

CRM receives only bounded relationship or commercial summaries.

Candidate summary categories:

- current evaluation or paid-service state;
- approved coverage mode;
- report period and delivery state;
- latest reconciled high-level results;
- approved report recipients; and
- unresolved implementation or review status.

Every CRM write requires:

- exact organization and object identity;
- stable record match;
- fresh prestate;
- workflow and duplicate-impact review;
- idempotency;
- independent readback; and
- no raw call content.

Do not create one CRM record per call merely to support reporting.

## Phase 9: Create Managed Analytics MCP Roles

Use private server names. Public role labels are only conventions.

### Audit Role

Enable the exact current equivalents of:

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

Verify the identity first and prove that every write is rejected.

### Changes Role

For initial setup, enable the exact current equivalents of:

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

Remove `createWorkspace` after the approved workspaces exist. Read every result back through Audit.

### Controller Role

Keep disconnected. Connect only the exact required delete tool for an approved cleanup, then disconnect and revoke it.

MCP is not the scheduled ingestion mechanism.

## Phase 10: Build The Synthetic Development Model

Create only synthetic Development data.

Proposed model:

```text
Dim_Client
Dim_Date
Fact_Calls
Fact_Outcomes
Fact_Client_Daily
Fact_QA
```

Required controls:

- immutable `Client ID`;
- stable `Call ID`;
- explicit environment;
- UTC source times and approved local reporting date;
- outcome and metric versions;
- source modified time and load time;
- data watermark;
- reconciliation status; and
- no direct caller PII.

Test:

- zero rows;
- duplicate calls;
- cross-client joins;
- multiple transfer attempts;
- late and corrected outcomes;
- missing mappings;
- import rejections;
- stale watermark;
- query-table drift; and
- non-admin sharing and export restrictions.

## Phase 11: Build Direct Catalyst-To-Analytics Sync

Use the direct Analytics API with a dedicated least-privilege Connection.

Proposed batch behavior:

1. select pending outbox records in deterministic order;
2. lock or claim one bounded batch;
3. export a minimized synthetic or Production-approved payload;
4. submit asynchronous `updateadd`;
5. match on `Client ID` and `Call ID`;
6. persist the provider job identifier;
7. poll with bounded backoff;
8. parse rejected rows and job totals;
9. read target counts and watermarks;
10. mark outbox records complete only after reconciliation; and
11. move unknown outcomes to operator review.

The initial operational hypothesis is hourly incremental sync plus periodic full reconciliation. The interval and batch size remain private configuration and must be adjusted from observed volume, API units, source capacity, and staleness requirements.

## Phase 12: Build Reports

### Evaluation Report

Build one fixed-client report set and generate it manually.

Acceptance:

- one client only;
- correct environment and period;
- exact source/Analytics count reconciliation;
- current watermark;
- no unresolved import;
- estimated and verified outcomes separated;
- no prohibited data;
- approved recipients; and
- human review recorded.

### Paid Monthly Report

Enable scheduling only after repeated clean manual cycles.

Before each scheduled delivery:

- close the reporting period;
- finish late-event and outcome reconciliation;
- verify the recipient set from CRM;
- verify one-client isolation;
- verify link and export restrictions;
- verify the data watermark;
- suppress delivery on unresolved failures; and
- preserve delivery and correction evidence.

A visually plausible dashboard is not acceptance evidence.

## Phase 13: End-To-End Synthetic Acceptance

Run synthetic scenarios for:

- valid analyzed call;
- call ended before analysis;
- identical duplicate;
- conflicting duplicate;
- unknown agent;
- inactive mapping;
- invalid signature;
- stale signature timestamp;
- malformed JSON;
- oversized body;
- multiple transfer attempts;
- missing customer outcome;
- ambiguous customer-system write;
- CRM duplicate or workflow conflict;
- Analytics import rejection;
- Analytics job timeout;
- cross-client report attempt;
- wrong recipient;
- stale watermark; and
- artifact deletion.

For each scenario, record expected HTTP result, durable state, downstream side effects, logs, report visibility, and containment action.

## Production Approval Package

Before Production, present privately:

- immutable source commit and artifact;
- exact Retell account, agent version, number, events, retention, and webhook target;
- exact Catalyst project, environment, function, route, tables, Connections, and configuration;
- exact CRM organization, records, fields, workflows, and recipient controls;
- exact Analytics organization, workspaces, views, roles, scopes, shares, exports, and schedules;
- legal and vendor approvals;
- synthetic and Development acceptance evidence;
- load and cost observations;
- rollback targets;
- report suppression behavior; and
- independent readback plan.

Approval is limited to the exact package. It does not authorize another client, agent, number, environment, workflow, report, recipient, retry, or expansion.

## Containment And Rollback

When a path is unsafe or uncertain:

1. disable the Retell webhook or Catalyst route so new events stop;
2. restore the last approved carrier route when caller handling is affected;
3. disable the Analytics sync worker and external report schedule;
4. preserve event, outbox, import-job, and report-run evidence;
5. do not delete, reset, or automatically replay unresolved records;
6. revoke the affected Connection when outbound writes must stop;
7. reconcile Retell, Catalyst, CRM, customer-system, and Analytics state independently;
8. restore the prior accepted agent version, function artifact, model definition, or report schedule only when it is an approved rollback target;
9. run one synthetic end-to-end test; and
10. re-enable in the smallest approved order.

A historical artifact, screenshot, or prior Git commit is not automatically a safe rollback target.

## Ongoing Operations

- Sample calls under the approved QA policy.
- Review unresolved and human-escalation reason codes.
- Monitor provider, Catalyst, CRM, customer-system, and Analytics failures separately.
- Reconcile report totals to source systems.
- Recertify roles, OAuth grants, MCP tools, shares, exports, and recipients.
- Review retention and deletion execution.
- Track support labor and recurring exceptions.
- Version metric definitions and agent configuration.
- Reopen legal, privacy, vendor, and security review after a material change.
- Keep public GitHub status synchronized without publishing private evidence.

## Exit Criteria For The Reporting Build

Continue only when:

- the bounded report materially supports evaluation conversion, renewal, or workflow correction;
- the same model works across multiple clients without bespoke formulas;
- report preparation and correction burden remains supportable;
- client isolation and source reconciliation are reliable; and
- the report uses verified downstream outcomes where the customer contract makes them available.

Narrow or stop when:

- reporting becomes a custom BI project for each customer;
- Analytics cannot isolate clients safely;
- source outcomes cannot be reconciled;
- support labor exceeds the commercial value;
- customers do not use the report in a decision; or
- a simpler fixed summary would achieve the same commercial result.

## Related Documents

- [ADR 0004](../adr/0004-retell-catalyst-crm-analytics-integration-boundary.md)
- [Call Reporting Metric Contract](../zoho/standards/call-reporting-metric-contract.md)
- [Zoho Analytics Managed MCP Tool Catalog](../zoho/mcp/reference/zoho-analytics-managed-mcp-catalog-2026-08-18.md)
- [System Overview](../architecture/system-overview.md)
- [Product Direction](../product/README.md)
- [Legal And Compliance Control Archive](../legal-compliance/README.md)
