# ADR 0004: Retell, Catalyst, CRM, And Analytics Integration Boundary

- Status: Accepted as a proposed integration boundary; free-test topology and tenancy sections superseded by [ADR 0006](0006-shared-seven-day-monitor-with-client-number-isolation.md)
- Date: 2026-08-18
- Deployment status: Development free-test source is present; deployment, runtime/source parity, and live-call approval are unproven
- Product scope: `after-hours-new-residential-service-request-v1` and later separately approved extensions

## Context

[ADR 0003](0003-initial-after-hours-service-request-workflow.md) fixes the first provider-neutral plumbing workflow for offline synthetic validation. The next architectural question is how a future approved call should move through a voice runtime, Sylvara-controlled middleware, relationship systems, customer operating systems, and client reporting without creating duplicate sources of truth or a premature platform.

The current implementation plan uses Retell as the voice-runtime candidate, Zoho Catalyst as the secure middleware and durable integration-state layer, Zoho CRM as Sylvara's relationship and commercial system, and Zoho Analytics as the derived reporting and distribution layer. The customer's approved scheduling or field-service system remains authoritative for appointments, jobs, work orders, completion, and revenue outcomes.

ADR 0006 is now authoritative for the 7-Day Free Test. It replaces this ADR's former client-specific evaluation-agent lifecycle, agent-first tenancy model, and evaluation-to-paid-agent promotion model. The system ownership, webhook, reconciliation, data-minimization, and reporting boundaries below remain current where they do not conflict with ADR 0006.

This decision remains subordinate to the [product boundary](../product/README.md) and [legal and compliance control archive](../legal-compliance/README.md). It does not authorize a prospect-facing telephone demonstration, customer pilot, number forwarding, recording, retained transcription, live transfer, booking, message, CRM write, Analytics delivery, or production deployment.

## Decision

Sylvara will use one small, explicit post-call integration path rather than placing all behavior in Retell, CRM, Catalyst, or Analytics.

```text
Approved carrier route
        |
        v
Client-specific Retell number
        |
        v
Shared 7-Day Free Test agent and Catalyst deployment configuration
        |
        | signed account-level webhook
        v
Zoho Catalyst ingress and durable call state
        |
        +----> approved-recipient notification
        |
        +----> bounded CRM relationship and commercial summaries
        |
        +----> batched Zoho Analytics reporting facts
                         |
                         v
              fixed-client reviewed report
```

The boundaries below are architectural intent. Current tenant identities, permissions, agents, numbers, projects, functions, tables, workspaces, views, OAuth grants, schedules, and runtime behavior remain **Unknown** until independently verified.

## Free-Test Lifecycle

1. Maintain one sanitized, versioned shared 7-Day Free Test agent and conversation flow.
2. Assign one dedicated Retell number and one versioned Catalyst deployment/configuration record to each active test client.
3. Resolve ownership from the called number and exact approved configuration gate before any client-specific conversation. Never use the shared `agent_id` as the tenant key.
4. Keep service areas, schedules, eligibility, urgency, route approval, notification destinations, and test limits in the immutable deployment snapshot. Retell presents approved values but is not their authority.
5. Fail closed through Configuration Unavailable when ownership or configuration cannot be proved. There is no degraded intake or client-clone fallback.
6. After a separately approved conversion, create and accept a dedicated Revenue Desk agent if deeper client-specific behavior is required. The shared free-test agent is not promoted into paid service.
7. Preserve prior number assignments, configuration versions, call bindings, and routes so reassignment and rollback remain auditable.

## Source-Of-Truth Matrix

| System | Authoritative for | Must not own |
|---|---|---|
| Retell | Real-time voice execution, vendor call object, and approved runtime configuration | Customer relationship truth, job completion, revenue, CRM state, or unrestricted business rules |
| Zoho Catalyst | Pre-call resolution, immutable number/deployment/configuration binding, admission enforcement, webhook verification, event normalization, durable call and notification state, idempotency, retries, reconciliation state, and reporting outbox | CRM relationship state, customer schedule truth, accounting truth, or analytical presentation |
| Zoho CRM | Prospect, client, contact, opportunity, evaluation authorization, approved report recipients, and bounded commercial summary state | Raw webhook payloads, per-call event ledgers, recordings, or full transcripts |
| Customer operating system | Services, availability, appointments, jobs, work orders, completion, invoices, or payments within its approved contract | Voice-runtime state or Sylvara relationship state |
| Zoho Analytics | Derived datasets, formulas, reports, dashboards, refresh state, exports, and scheduled analytical delivery | Transactional decisions, reverse writes, or authoritative booking and revenue truth |
| GitHub | Sanitized code, schemas, tests, decisions, and runbooks | Secrets, live identifiers, customer or caller data, call content, production configuration, or deployment proof |

## Catalyst Project And Function Boundary

Use one Sylvara-owned voice-integration project per environment for the approved client set. Do not create a Catalyst project or function stack for every client or every bounded evaluation. Client isolation is enforced through fixed environment binding, stable `client_id` and `deployment_id`, immutable number assignments, configuration versions, typed payloads, and row-level ownership.

The logical components are:

1. **Retell ingress**: verify and durably claim the provider event inside the webhook timeout.
2. **Post-call processor**: normalize call state, classify outcomes, create durable notification state, and create reporting outbox rows. Customer-system or CRM mutations exist only in separately approved workflows; they are disabled for the Development free test.
3. **Analytics sync worker**: batch pending facts, submit and poll Analytics imports, reconcile results, and close report watermarks.

Logical separation does not require one function per component. Before implementation, read the exact current Catalyst function inventory and deployment contract. Components may share one deployable package only when they have the same environment, trust boundary, secret access, scaling profile, failure isolation, and rollback lifecycle. Otherwise keep them separate.

Do not create one function per client. Do not place this path inside the Billing webhook gateway: Billing has a different source, signature contract, business authority, secret set, retry semantics, and containment boundary.

## Retell Event Contract

Use one account-level webhook endpoint for the approved Retell account and leave agent-level webhook URLs unset unless a separately approved exception requires one. An agent-level URL can override the account-level route and create silent coverage gaps.

The proposed minimum event set is:

| Event | Use |
|---|---|
| `call_analyzed` | Canonical post-call reporting event after the approved analysis is available |
| `call_ended` | Optional operational signal when a faster completion notice is needed |
| `transfer_started` | Transfer-attempt evidence |
| `transfer_bridged` | Successful bridge evidence |
| `transfer_cancelled` | Cancelled or failed transfer evidence |
| `transfer_ended` | Transfer lifecycle completion |
| `call_started` | Disabled unless an approved live-concurrency or operations requirement justifies it |
| `transcript_updated` | Excluded from the reporting path |

Catalyst must verify the Retell signature against the unchanged raw body, enforce the signed timestamp window, compare digests in constant time, validate the event and agent allowlists, durably claim the event, and return a successful empty response inside the provider timeout. Provider retries must be safe.

A lifecycle event uses a keyed-HMAC receipt key derived from event type and provider call identifier; neither raw value is exposed in logs/reporting. A transfer key must also include a protected stable provider transfer identifier or a reviewed sequence value so multiple legitimate transfer attempts are not collapsed. A conflicting duplicate ends in reconciliation rather than blind replay.

## Proposed Catalyst Data Contract

The following names are conceptual public labels, not live table names:

| Dataset | Grain and purpose |
|---|---|
| `deployment_configurations` | One immutable client-deployment-configuration snapshot |
| `number_assignments` | One immutable Retell-number assignment and non-overlapping effective interval |
| `call_admissions` | One atomic seven-day/25-call admission claim per unique call |
| `call_events` | One immutable, minimized provider event claim |
| `calls` | One normalized current call row per client, deployment, and call |
| `call_artifacts` | One private artifact reference, classification, hash, and retention record |
| `outcome_reconciliation` | One call-to-customer-system outcome reconciliation record |
| `notifications` | One durable, idempotent notification state machine per eligible call and approved destination |
| `reporting_outbox` | One versioned analytical change awaiting confirmed delivery |
| `report_runs` | One client, period, watermark, reconciliation, and delivery result |

The canonical lookup key is a keyed-HMAC of the provider call identifier. The raw provider identifier is not retained or logged. The canonical row binds the opaque key to immutable `client_id`, `deployment_id`, `configuration_version`, and ownership references; conflicts fail closed. Analytical facts use that opaque Call Key plus Client ID and Deployment ID partitions. The event ledger stores only the minimum metadata required for replay safety and reconciliation. Raw provider bodies are not retained by default and never belong in function logs. Recordings and transcripts stay outside Analytics and CRM; Catalyst stores only approved private references and retention metadata when those artifacts are separately authorized.

## Post-Call Processing

The target synchronous webhook path ends after durable acceptance. Downstream work must run outside the provider timeout:

1. normalize the current call;
2. classify the call against the approved outcome taxonomy;
3. create one idempotent notification record for the pre-approved deployment recipient;
4. place one versioned row in the reporting outbox;
5. update only separately approved client-level or commercial summary fields in CRM; and
6. for a separately approved paid workflow, reconcile customer-system outcomes and later analytical imports.

The free test does not book, dispatch, quote, collect payment, or mutate the customer operating system. Its current Development core directly invokes deterministic synthetic notification and Analytics adapters against an in-memory test store, and CRM writes are disabled. It does not yet implement the HTTP durable-acceptance or queue/worker boundary described above; that gap blocks deployment/readiness.

No ambiguous write is blindly retried. The worker first reads the target or job status and determines whether the prior attempt completed, failed, or requires operator reconciliation.

## Reporting Boundary

Catalyst is the durable integration and operational evidence layer. Zoho Analytics is the client-reporting layer.

Use separate Development and Production workspaces. The proposed Production model uses one central workspace with immutable `Client ID` and `Deployment ID` partitions unless a contract requires stronger physical separation. Clients receive fixed-client outputs; they do not receive source-table access, a selectable all-client dashboard, or a public link.

The first evaluation report is manually reviewed. Scheduled monthly delivery is enabled only after repeated clean manual cycles and after all report acceptance gates pass:

- source and Analytics call counts reconcile;
- the report contains exactly one client and only its approved deployment(s);
- the data watermark is current and visible;
- no reporting job or reconciliation item is unresolved;
- no raw transcript, recording, phone number, address, or webhook payload is present;
- the recipient set matches the approved CRM record; and
- estimated opportunity value is visibly separated from verified booked, completed, invoiced, or paid value.

Catalyst OLAP may later support internal diagnostics or reconciliation. It does not replace Analytics dashboards, controlled exports, or scheduled client delivery.

## MCP And Production API Boundary

Use Zoho's managed Analytics MCP only for bounded operator discovery and report-model maintenance. MCP is not the production data pipeline.

Public role labels are:

- **Analytics Audit**: organization, workspace, view, folder, query-table, and bounded export reads.
- **Analytics Changes**: workspace initialization, tables, folders, formulas, query tables, and reports.
- **Analytics Controller**: destructive cleanup only, disconnected unless an exact cleanup is approved.

Actual server names, URLs, identities, OAuth grants, and enabled-tool configuration remain private. A separately approved Production path would move call facts through the direct Zoho Analytics API using a least-privilege connection and batched `updateadd` imports matched on opaque `Call Key` with `Client ID` and `Deployment ID` as mandatory partitions. The current free-test adapter is synthetic only.

The exact proposed tool inventory and role allowlists are recorded in the dated [managed Analytics MCP catalog](../zoho/mcp/reference/zoho-analytics-managed-mcp-catalog-2026-08-18.md).

## Data Minimization And Retention

- Configure the voice platform for the minimum approved data-storage mode and finite retention.
- Enable signed, expiring artifact URLs when artifacts are authorized.
- Do not duplicate audio into Catalyst by default.
- Do not load transcripts, recordings, caller contact details, or raw payloads into Analytics.
- Keep structured call outcomes only for the approved operational, contractual, and analytical period.
- Apply deletion and correction through the owning source and propagate a governed analytical correction; never silently rewrite source truth from a dashboard.
- Keep secrets and live identifiers in platform-native private configuration only.

## Rejected Alternatives

### Store Calls In CRM

Rejected because high-volume call events, payloads, transcripts, and recordings would turn the relationship system into an event store, increase API traffic, and blur ownership. CRM receives only bounded relationship and commercial summaries.

### Use Catalyst Alone For Client Reporting

Rejected because Catalyst is the middleware and operational state layer. Its logs and APM are operational diagnostics, not a durable client dashboard, access-control, export, and scheduled-delivery product.

### Use Analytics As The Event Store

Rejected because Analytics is lagged derived reporting, not a transactional ingress, retry, or reverse-write system.

### Use MCP For Production ETL

Rejected because MCP is an operator-assistance interface. The direct Analytics API provides the bulk import, job-status, scope, and reconciliation contracts required for repeatable ingestion.

### One Free-Test Agent Per Client

Rejected by ADR 0006 because routine client variation belongs in versioned Catalyst configuration. Client-specific free-test clones create drift and are not an isolation fallback. Paid Revenue Desk agents remain separate and require their own acceptance.

### Build A Client Portal Now

Rejected because fixed-client reviewed reports are sufficient for validation. A portal is deferred until repeated paid demand proves that scheduled reports cannot support retention and renewal.

## Activation Gates

No live path is authorized until all applicable gates pass:

1. current Retell contract, account, agent, number, recording, transcription, retention, training, webhook, and data-region settings are verified;
2. legal, privacy, vendor, customer, disclosure, consent, and call-path approvals are recorded privately;
3. Catalyst Development proves signature verification, timeout behavior, duplicate handling, exact configuration gating, number/deployment ownership, seven-day/25-call admission, minimized logging, durable notification state, and durable readback with synthetic events;
4. the approved CRM summary fields and recipient controls are read back in the correct tenant;
5. the Analytics organization, region, plan, workspaces, roles, scopes, tools, row-level controls, export restrictions, and schedules are verified;
6. synthetic imports prove `updateadd`, asynchronous job polling, duplicate behavior, rejected-row handling, and exact reconciliation;
7. non-admin tests prove one-client isolation and prohibited exports;
8. containment and rollback are rehearsed; and
9. Gabriel separately approves the exact live artifact, target, route, configuration, and readback plan.

## Consequences

This boundary keeps the initial call path small, preserves vendor portability, makes retries and attribution auditable, and gives clients a reporting layer without turning CRM into a call database or Catalyst into a custom dashboard product.

It also creates deliberate manual work during validation: reports remain reviewed, customer-system outcomes require reconciliation, and live delivery stays blocked until the exact vendor and legal gates close. That is preferable to automating an unverified call and reporting path.

## Official References

- [Retell webhook overview](https://docs.retellai.com/features/webhook-overview)
- [Retell secure webhook verification](https://docs.retellai.com/features/secure-webhook)
- [Retell post-call analysis](https://docs.retellai.com/features/post-call-analysis)
- [Retell data storage settings](https://docs.retellai.com/accounts/data-storage)
- [Zoho Analytics API prerequisites and scopes](https://www.zoho.com/analytics/api/v2/prerequisites.html)
- [Zoho Analytics asynchronous bulk import](https://www.zoho.com/analytics/api/v2/bulk-api/import-data-async/create-import-job/existing-table.html)
- [Zoho Analytics managed MCP tool catalog](https://www.zoho.com/analytics/api/v2/zoho-analytics-mcp-server/tools.html)
- [Zoho Analytics sharing filter criteria](https://www.zoho.com/analytics/help/sharing-collaboration/share-views.html)
- [Zoho Catalyst Data Store](https://docs.catalyst.zoho.com/en/cloud-scale/help/data-store/introduction/)
- [Zoho Catalyst OLAP database](https://docs.catalyst.zoho.com/en/cloud-scale/help/data-store/olap-database/introduction/)
