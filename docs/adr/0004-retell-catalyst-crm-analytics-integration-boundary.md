# ADR 0004: Retell, Catalyst, CRM, And Analytics Integration Boundary

- Status: Accepted as a proposed integration boundary; free-test topology and tenancy sections superseded by [ADR 0006](0006-shared-seven-day-monitor-with-client-number-isolation.md)
- Date: 2026-08-18
- Deployment status: **READY FOR CONTROLLED INTERNAL PHONE TEST** for one non-customer Development number; Catalyst/Zoho lifecycle proof is complete, while Retell voice/fallback and a second live number are deferred
- Product scope: `after-hours-new-residential-service-request-v1` and later separately approved extensions

## Context

[ADR 0003](0003-initial-after-hours-service-request-workflow.md) fixes the first provider-neutral plumbing workflow for offline synthetic validation. The next architectural question is how a future approved call should move through a voice runtime, Sylvara-controlled middleware, relationship systems, customer operating systems, and client reporting without creating duplicate sources of truth or a premature platform.

The general implementation boundary uses Retell as the voice-runtime candidate, Zoho Catalyst as secure middleware and durable integration state, Zoho CRM as Sylvara's relationship/commercial system, and Zoho Analytics as an optional later derived reporting layer. ADR 0006 deliberately narrows the free-test MVP to Catalyst Mail email records plus Catalyst query/CSV reporting, with CRM disabled and Analytics deferred. The customer's approved scheduling or field-service system remains authoritative for appointments, jobs, work orders, completion, and revenue outcomes.

ADR 0006 is now authoritative for the 7-Day Free Test. It replaces this ADR's former client-specific evaluation-agent lifecycle, agent-first tenancy model, and evaluation-to-paid-agent promotion model. The system ownership, webhook, reconciliation, data-minimization, and reporting boundaries below remain current where they do not conflict with ADR 0006.

This decision remains subordinate to the [product boundary](../product/README.md). The [legal and compliance archive](../legal-compliance/README.md) is dated research with a conservative historical profile, not legal advice or a decision for a particular test. This ADR does not authorize a prospect-facing demonstration, customer pilot, number forwarding, recording, retained transcription, live transfer, booking, message, CRM write, Analytics delivery, or Production deployment.

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
        +----> Catalyst Mail email record
        |
        +----> Catalyst query / sanitized CSV report
```

The boundaries below are implemented for the Catalyst/Zoho Development lane. The dated [Development reconciliation](../runbooks/free-test-development-reconciliation-2026-08-22.md) verifies the four tables, both functions, private configuration, HTTP 200 readiness, signed lifecycle, practical time/count enforcement, manual retry, one internal email with replay suppression, restored `dry_run`, one non-customer Retell number binding, source parity at the recorded revision, and rollback. Voice/provider-fallback behavior, a second live number, prospects/customers, and Production remain deferred or unauthorized. The separately documented 2026-08-22 Form 1/Form 2 copy readback remains unrelated legacy evidence and does not activate this path.

## Free-Test Lifecycle

1. Maintain one sanitized, versioned shared 7-Day Free Test agent and conversation flow.
2. Assign one dedicated Retell number and one versioned Catalyst deployment/configuration record to each active test client.
3. Resolve ownership from the called number and exact approved configuration gate before any client-specific conversation. Never use the shared `agent_id` as the tenant key.
4. Keep service areas, schedules, eligibility, urgency, route approval, notification destinations, and test limits in the immutable deployment snapshot. Retell presents approved values but is not their authority.
5. For a known authenticated invalid, unknown, ambiguous, inactive, expired, or exhausted resolution, return HTTP 200 with `{ "call_inbound": { "reject": true } }`, start no agent, and create no resolver-side write. Transport, authentication, timeout, 503/unavailable, malformed-response, or invalid-override failure may instead cause Retell to use the number-bound shared agent; its exact first-node gate must terminate through Configuration Unavailable with no intake. There is no degraded intake or client-clone fallback.
6. After a separately approved conversion, create and accept a dedicated Revenue Desk agent if deeper client-specific behavior is required. The shared free-test agent is not promoted into paid service.
7. Do not reuse the number assigned to an active deployment during validation. When a test completes, preserve its binding evidence and place the number into a documented cooldown. Any later reuse is a separately reviewed stopped-route administrative process; automatic reassignment is deferred. Historical calls retain embedded deployment/configuration ownership.

## Source-Of-Truth Matrix

| System | Authoritative for | Must not own |
|---|---|---|
| Retell | Real-time voice execution, vendor call object, and approved runtime configuration | Customer relationship truth, job completion, revenue, CRM state, or unrestricted business rules |
| Zoho Catalyst | Pre-call resolution, current number/deployment/configuration binding, time/count eligibility, webhook verification, event normalization, durable calls/outcomes/email records, idempotency, and query/CSV reporting | CRM relationship state, customer schedule truth, accounting truth, or optional later analytical presentation |
| Zoho CRM | Prospect, client, contact, opportunity, and commercial relationship state outside the MVP call lifecycle | Raw webhook payloads, per-call event ledgers, recordings, transcripts, or free-test runtime mutation |
| Customer operating system | Services, availability, appointments, jobs, work orders, completion, invoices, or payments within its approved contract | Voice-runtime state or Sylvara relationship state |
| Zoho Analytics | Derived datasets, formulas, reports, dashboards, refresh state, exports, and scheduled analytical delivery | Transactional decisions, reverse writes, or authoritative booking and revenue truth |
| GitHub | Sanitized code, schemas, tests, decisions, and runbooks | Secrets, live identifiers, customer or caller data, call content, production configuration, or deployment proof |

## Catalyst Project And Function Boundary

Use one Sylvara-owned voice-integration project per environment for the approved client set. Do not create a Catalyst project or function stack for every client or every bounded evaluation. Client isolation is enforced through fixed environment binding, stable `client_id` and `deployment_id`, one unambiguous current number binding per active deployment, immutable configuration/call ownership, typed payloads, and row-level partitions.

The logical components are:

1. **Retell ingress**: verify and durably claim the provider event inside the webhook timeout.
2. **Catalyst Function Job**: the separate `retell_free_test_retry` target processes due minimized event receipts and retryable notification state with bounded backoff and authoritative readback; ambiguous Mail attempts are not blindly resent.
3. **Post-call processor**: normalize call state, classify outcomes, update the handled count once, create one Catalyst Mail email record, and expose reportable fields. Customer-system and CRM mutations are disabled.
4. **Query/CSV reporting**: read a fixed client/deployment partition and create a sanitized, manually reviewed export. Analytics import is a deferred later phase.

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

The following names are conceptual future integration labels, not live table names and not the free-test provisioning contract. ADR 0006's MVP uses only the four tables named in the component-owned schema.

| Dataset | Grain and purpose |
|---|---|
| `deployment_configurations` | One immutable client-deployment-configuration snapshot |
| `number_assignments` | One immutable Retell-number assignment and non-overlapping effective interval |
| `call_events` | One immutable, minimized provider event claim |
| `calls` | One normalized current call row per client, deployment, and call |
| `call_artifacts` | One private artifact reference, classification, hash, and retention record |
| `outcome_reconciliation` | One call-to-customer-system outcome reconciliation record |
| `notifications` | One durable, idempotent email record per eligible call and approved destination; committed/default Development mode terminates at `DryRunRecorded`, while one controlled `send_development` proof uses the modeled send/retry/ambiguous/terminal states |

The canonical lookup key is a keyed-HMAC of the provider call identifier. The raw provider identifier is not retained or logged. The canonical row binds the opaque key to immutable `client_id`, `deployment_id`, `configuration_version`, and ownership references; conflicts fail closed. Analytical facts use that opaque Call Key plus Client ID and Deployment ID partitions. The event ledger stores only the minimum metadata required for replay safety and reconciliation. Raw provider bodies are not retained by default and never belong in function logs. Recordings and transcripts stay outside Analytics and CRM; Catalyst stores only approved private references and retention metadata when those artifacts are separately authorized.

## Post-Call Processing

The current free-test deployment includes the separate Catalyst Function Job target for due minimized event receipts and retryable notification rows. Its 256 MB Function, 512 MB pool, and disabled one-minute Cron with zero platform retries are read back. Development must still prove one immediate synthetic execution, trigger/request shape, bounded backoff, lease/conditional-write behavior, and ambiguous-result readback before an internal phone test.

The current bounded processing sequence is:

1. normalize the current call;
2. classify the call against the approved outcome taxonomy;
3. increment the deployment's handled count once;
4. create one idempotent Catalyst Mail email record for the pre-approved deployment recipient; and
5. make the minimized row available to fixed-partition query/CSV reporting.

The free test does not book, dispatch, quote, collect payment, or mutate the customer operating system. Development defaults to `dry_run`; durable dry-run state was proved, one controlled `send_development` email received provider/inbox readback, replay caused no second provider invocation, and configuration returned to `dry_run`. CRM is disabled and Analytics is outside the MVP. Current runtime evidence and deferred Retell work are recorded in the Development reconciliation.

No ambiguous write is blindly retried. The worker first reads the target or job status and determines whether the prior attempt completed, failed, or requires operator reconciliation.

## Reporting Boundary

Catalyst is the durable integration and operational evidence layer. For the free-test MVP it is also the internal reporting source through fixed-partition queries and sanitized CSV exports. Zoho Analytics is an optional later presentation layer.

Use separate Development and Production workspaces. The proposed Production model uses one central workspace with immutable `Client ID` and `Deployment ID` partitions unless a contract requires stronger physical separation. Clients receive fixed-client outputs; they do not receive source-table access, a selectable all-client dashboard, or a public link.

The first free-test report is a manually reviewed Catalyst CSV. Any later Analytics or scheduled delivery is enabled only after repeated clean manual cycles and after all applicable report acceptance gates pass:

- source and exported call counts reconcile;
- the report contains exactly one client and only its approved deployment(s);
- the data watermark is current and visible;
- no query/export reconciliation item is unresolved;
- no raw transcript, recording, phone number, address, or webhook payload is present;
- any external recipient set is separately approved; and
- estimated opportunity value is visibly separated from verified booked, completed, invoiced, or paid value.

Catalyst query/CSV is intentionally sufficient for internal validation. It is not a commitment to build a dashboard or portal.

## MCP And Production API Boundary

Use Zoho's managed Analytics MCP only for bounded operator discovery and report-model maintenance. MCP is not the production data pipeline.

Public role labels are:

- **Analytics Audit**: organization, workspace, view, folder, query-table, and bounded export reads.
- **Analytics Changes**: workspace initialization, tables, folders, formulas, query tables, and reports.
- **Analytics Controller**: destructive cleanup only, disconnected unless an exact cleanup is approved.

Actual server names, URLs, identities, OAuth grants, and enabled-tool configuration remain private. A separately approved later path could move minimized call facts through the direct Zoho Analytics API, but no Analytics adapter or import is required for the free-test MVP.

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

### Use Catalyst Alone For Long-Term Client Reporting

Deferred as a long-term reporting decision. Catalyst logs/APM are not reports, but fixed client/deployment queries and sanitized CSV exports are sufficient for the internal MVP. Analytics or another presentation layer should be added only after evidence shows that manual reviewed exports are inadequate.

### Use Analytics As The Event Store

Rejected because Analytics is lagged derived reporting, not a transactional ingress, retry, or reverse-write system.

### Use MCP For Production ETL

Rejected because MCP is an operator-assistance interface. The direct Analytics API provides the bulk import, job-status, scope, and reconciliation contracts required for repeatable ingestion.

### One Free-Test Agent Per Client

Rejected by ADR 0006 because routine client variation belongs in versioned Catalyst configuration. Client-specific free-test clones create drift and are not an isolation fallback. Paid Revenue Desk agents remain separate and require their own acceptance.

### Build A Client Portal Now

Rejected because fixed-client reviewed reports are sufficient for validation. A portal is deferred until repeated paid demand proves that scheduled reports cannot support retention and renewal.

## Activation Gates

No prospect/customer or Production path is authorized until all applicable gates pass. A one-number controlled internal Development test may begin after the narrower ADR 0006 Development gate and test-specific route/readback boundary pass:

1. current Retell contract, account, agent, number, recording, transcription, retention, training, webhook, and data-region settings are verified;
2. the business, privacy, security, vendor, customer, disclosure, consent, and any professional review required for the actual call path are recorded privately;
3. Catalyst Development proves signature verification, explicit known-failure rejection, safe provider-fallback gating, duplicate handling, exact configuration gating, number/deployment ownership, seven-day eligibility, the practical 25-handled-call stop and visible overshoot, minimized logging, Job retry/readback, email state, tenant-partitioned query/CSV, and durable readback with synthetic events;
4. two synthetic called-number values prove Catalyst client isolation; before two simultaneous live deployments or the first-controlled-prospect technical gate, two dedicated Retell numbers on the same shared agent version must repeat that proof;
5. CRM mutation and Analytics import are verified disabled;
6. one controlled `send_development` email is independently read back, replay sends no duplicate, and mode is restored to `dry_run`;
7. each completed validation number enters documented cooldown and is not reused during its validation window;
8. containment and rollback are rehearsed; and
9. Gabriel separately approves the exact external artifact, target, route, configuration, and readback plan.

## Consequences

This boundary keeps the initial call path small, preserves vendor portability, makes replay and attribution auditable, and proves reporting value without turning CRM into a call database or building a custom dashboard.

It also creates deliberate manual work during validation: reports remain reviewed, customer-system outcomes require reconciliation, and live delivery stays blocked until the exact operating evidence and approvals exist. That is preferable to automating an unverified call and reporting path.

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
