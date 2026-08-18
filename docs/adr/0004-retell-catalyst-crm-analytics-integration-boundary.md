# ADR 0004: Retell, Catalyst, CRM, And Analytics Integration Boundary

- Status: Accepted as a proposed integration boundary
- Date: 2026-08-18
- Deployment status: Not implemented, not deployed, and not approved for live calls
- Product scope: `after-hours-new-residential-service-request-v1` and later separately approved extensions

## Context

[ADR 0003](0003-initial-after-hours-service-request-workflow.md) fixes the first provider-neutral plumbing workflow for offline synthetic validation. The next architectural question is how a future approved call should move through a voice runtime, Sylvara-controlled middleware, relationship systems, customer operating systems, and client reporting without creating duplicate sources of truth or a premature platform.

The current implementation plan uses Retell as the voice-runtime candidate, Zoho Catalyst as the secure middleware and durable integration-state layer, Zoho CRM as Sylvara's relationship and commercial system, and Zoho Analytics as the derived reporting and distribution layer. The customer's approved scheduling or field-service system remains authoritative for appointments, jobs, work orders, completion, and revenue outcomes.

This decision remains subordinate to the [product boundary](../product/README.md) and [legal and compliance control archive](../legal-compliance/README.md). It does not authorize a prospect-facing telephone demonstration, customer pilot, number forwarding, recording, retained transcription, live transfer, booking, message, CRM write, Analytics delivery, or production deployment.

## Decision

Sylvara will use one small, explicit post-call integration path rather than placing all behavior in Retell, CRM, Catalyst, or Analytics.

```text
Approved carrier route
        |
        v
Dedicated Retell client agent
        |
        | signed account-level webhook
        v
Zoho Catalyst ingress and durable call state
        |
        +----> approved customer operating system reconciliation
        |
        +----> bounded CRM relationship and commercial summaries
        |
        +----> batched Zoho Analytics reporting facts
                         |
                         v
              fixed-client reviewed report
```

The boundaries below are architectural intent. Current tenant identities, permissions, agents, numbers, projects, functions, tables, workspaces, views, OAuth grants, schedules, and runtime behavior remain **Unknown** until independently verified.

## Agent Lifecycle

1. Maintain one sanitized, versioned master template as an authoring baseline. The template does not receive client calls.
2. Create one dedicated Retell agent per client per environment. Do not share one live agent across clients.
3. Within one environment, use the same client-specific agent through bounded evaluation and paid-service states by promoting reviewed configuration versions. Do not create a second "free-test agent" by default.
4. Create separate evaluation and paid agents for the same client only when an approved rollback, provider, contractual, or environment-isolation requirement makes that separation necessary.
5. Bind each agent to one stable internal `client_id` through Catalyst-controlled configuration. Never infer tenancy from a caller-provided company name, phone number, prompt text, or mutable display label.
6. Keep service areas, schedules, eligibility, urgency, routing, fallback, and integration rules in versioned structured configuration. The Retell prompt may present those rules but is not their sole authority.
7. Preserve the last accepted agent version and prior carrier route so every promotion has a tested rollback target.

## Source-Of-Truth Matrix

| System | Authoritative for | Must not own |
|---|---|---|
| Retell | Real-time voice execution, vendor call object, and approved runtime configuration | Customer relationship truth, job completion, revenue, CRM state, or unrestricted business rules |
| Zoho Catalyst | Webhook verification, event normalization, stable client-agent mapping, durable call and integration state, idempotency, retries, artifact metadata, reconciliation state, and reporting outbox | CRM relationship state, customer schedule truth, accounting truth, or analytical presentation |
| Zoho CRM | Prospect, client, contact, opportunity, evaluation authorization, approved report recipients, and bounded commercial summary state | Raw webhook payloads, per-call event ledgers, recordings, or full transcripts |
| Customer operating system | Services, availability, appointments, jobs, work orders, completion, invoices, or payments within its approved contract | Voice-runtime state or Sylvara relationship state |
| Zoho Analytics | Derived datasets, formulas, reports, dashboards, refresh state, exports, and scheduled analytical delivery | Transactional decisions, reverse writes, or authoritative booking and revenue truth |
| GitHub | Sanitized code, schemas, tests, decisions, and runbooks | Secrets, live identifiers, customer or caller data, call content, production configuration, or deployment proof |

## Catalyst Project And Function Boundary

Use one Sylvara-owned voice-integration project per environment for the approved client set. Do not create a Catalyst project or function stack for every client or every bounded evaluation. Client isolation is enforced through fixed environment binding, stable `client_id`, agent mapping, typed payloads, and row-level ownership.

The logical components are:

1. **Retell ingress**: verify and durably claim the provider event inside the webhook timeout.
2. **Post-call processor**: normalize call state, classify outcomes, reconcile approved customer-system and CRM side effects, and create reporting outbox rows.
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

A lifecycle event uses a stable key derived from `event_type` and `call_id`. A transfer key must also include a stable provider transfer identifier or a reviewed sequence value so multiple legitimate transfer attempts are not collapsed. A conflicting duplicate ends in reconciliation rather than blind replay.

## Proposed Catalyst Data Contract

The following names are conceptual public labels, not live table names:

| Dataset | Grain and purpose |
|---|---|
| `client_agent_map` | One effective client-agent-environment-version binding |
| `call_events` | One immutable, minimized provider event claim |
| `calls` | One normalized current call row per client and call |
| `call_artifacts` | One private artifact reference, classification, hash, and retention record |
| `outcome_reconciliation` | One call-to-customer-system outcome reconciliation record |
| `reporting_outbox` | One versioned analytical change awaiting confirmed delivery |
| `report_runs` | One client, period, watermark, reconciliation, and delivery result |

The analytical call key is `client_id + call_id`. The event ledger stores only the minimum metadata required for replay safety and reconciliation. Raw provider bodies are not retained by default and never belong in function logs. Recordings and transcripts stay outside Analytics and CRM; Catalyst stores only approved private references and retention metadata when those artifacts are separately authorized.

## Post-Call Processing

The synchronous webhook path ends after durable acceptance. Downstream work runs outside the provider timeout:

1. normalize the current call;
2. classify the call against the approved outcome taxonomy;
3. reconcile booking, work-order, completion, invoice, or payment state from the authoritative customer system when available;
4. update only approved client-level or commercial summary fields in CRM;
5. place one versioned row in the reporting outbox;
6. batch analytical facts into Zoho Analytics;
7. poll asynchronous import status and reconcile row counts, keys, watermarks, and rejected rows before marking the outbox item complete.

No ambiguous write is blindly retried. The worker first reads the target or job status and determines whether the prior attempt completed, failed, or requires operator reconciliation.

## Reporting Boundary

Catalyst is the durable integration and operational evidence layer. Zoho Analytics is the client-reporting layer.

Use separate Development and Production workspaces. The proposed Production model uses one central workspace with an immutable `Client ID` partition unless a contract requires stronger physical separation. Clients receive fixed-client outputs; they do not receive source-table access, a selectable all-client dashboard, or a public link.

The first evaluation report is manually reviewed. Scheduled monthly delivery is enabled only after repeated clean manual cycles and after all report acceptance gates pass:

- source and Analytics call counts reconcile;
- the report contains exactly one client;
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

Actual server names, URLs, identities, OAuth grants, and enabled-tool configuration remain private. Production call facts move from Catalyst through the direct Zoho Analytics API using a least-privilege connection and batched `updateadd` imports matched on `Client ID` and `Call ID`.

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

### Separate Evaluation And Paid Agents By Default

Rejected because duplicating every client agent creates configuration drift and unnecessary maintenance. One client agent per environment is promoted through reviewed versions unless a concrete isolation or rollback requirement proves otherwise.

### Build A Client Portal Now

Rejected because fixed-client reviewed reports are sufficient for validation. A portal is deferred until repeated paid demand proves that scheduled reports cannot support retention and renewal.

## Activation Gates

No live path is authorized until all applicable gates pass:

1. current Retell contract, account, agent, number, recording, transcription, retention, training, webhook, and data-region settings are verified;
2. legal, privacy, vendor, customer, disclosure, consent, and call-path approvals are recorded privately;
3. Catalyst Development proves signature verification, timeout behavior, duplicate handling, agent-client binding, minimized logging, and durable readback with synthetic events;
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
