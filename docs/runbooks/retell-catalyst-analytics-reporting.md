# Retell, Catalyst, CRM, And Analytics Reporting Runbook

## Status

- Runbook status: **Proposed**
- Implementation status: **READY FOR DEVELOPMENT DEPLOYMENT; routes, runtime/source parity, controlled email delivery, and phone behavior remain unproven**
- Live Retell, Catalyst, CRM, or Analytics change authorized by this file: **No**
- Production call path: **Not authorized; required operating evidence and approvals are absent**

This runbook preserves the general future reporting boundary in [ADR 0004](../adr/0004-retell-catalyst-crm-analytics-integration-boundary.md). For the 7-Day Free Test, [ADR 0006](../adr/0006-shared-seven-day-monitor-with-client-number-isolation.md) and the [shared-agent runbook](shared-seven-day-monitor-number-routing.md) supersede this file's client-agent mapping, admission, notification, CRM, Analytics, number-change, and evaluation-agent lifecycle instructions. It does not contain live names, URLs, identifiers, credentials, customer data, call content, or deployment values.

### Free-Test MVP Override

The free-test MVP uses the exact configuration gate plus a durable handled-count check; it has no pre-call reservation/orphan state and may report calls already in flight after the 25th handled call. Its only notification channel is Catalyst Mail email. Committed/default Development mode records `DryRunRecorded`, zero attempts, and `CATALYST_MAIL_DRY_RUN` without invoking `sendMail`; one controlled `send_development` proof, provider/inbox readback, replay without a duplicate, and restoration to `dry_run` are required before internal-phone readiness. Internal reporting is a client/deployment-scoped Catalyst query and sanitized CSV export. CRM is disabled and Analytics is deferred; neither is an internal-test blocker. Initial validation numbers are frozen and enter documented cooldown after completion; reassignment is deferred.

## Objective

Build the smallest secure reporting path that can:

1. accept approved Retell post-call events;
2. preserve replay-safe and auditable call state in Catalyst;
3. keep CRM limited to relationship and commercial summaries;
4. preserve later outcome-attribution fields and, only for a separately approved paid workflow, reconcile them to the customer's authoritative system;
5. produce one reviewed client-isolated report; and
6. add Analytics only later if validated demand justifies it.

Do not build a client portal, general event platform, or CRM call warehouse. The free test deliberately uses one shared bounded-intake agent; it is not a generic shared-agent platform and never uses the shared `agent_id` as a tenant key.

## Prerequisites

Before implementation work:

- the exact Development Retell account and intended agent are identified privately;
- the owner-approved scope, data handling, provider settings, rollback, and any professional review required for the selected validation lane are recorded;
- the exact Catalyst Development project and environment are identified;
- any separately approved CRM/Analytics target is read back; neither target is required for the free-test MVP;
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

For the free test, implement four small logical responsibilities:

```text
Pre-call number resolution and time/handled-count eligibility
Retell event ingress
Post-call call/outcome/count and Catalyst Mail state processing
Separate retry Function Job for due event and notification state
Client-partitioned query and CSV export
```

Choose physical packaging from the observed contract:

- combine responsibilities only when their trust boundary, runtime, secret access, scaling, failure isolation, and rollback lifecycle match;
- deploy and independently read back the separate `retell_free_test_retry` Function Job for slow or retrying work;
- do not create a function per client;
- do not place Retell processing inside the Billing webhook gateway; and
- preserve independent disablement of webhook ingress and every external write; CRM and Analytics stay disabled.

Document the decision and read the final function inventory back before deployment.

## Phase 2: Establish Private Configuration

The free-test component owns its exact public variable registry at [`src/zoho-catalyst/retell-free-test/config/variables.json`](../../src/zoho-catalyst/retell-free-test/config/variables.json). It defines each consumer, secret classification, required format, Development behavior, and Production prohibition. Do not use old root Retell/Make variable lists or infer a live value from the registry.

Secrets and OAuth material stay only in platform-native secret/Connection storage. Private identifiers remain in environment configuration. Missing or invalid required values fail closed. Do not commit a populated `.env`, endpoint, platform identifier, or configuration export.

## Phase 3: Model Free-Test Deployment And Number State

For the free test, create one versioned deployment/configuration snapshot and one current number binding for each client test. The shared agent is product identity, not ownership.

Required mapping facts:

```text
client_id
deployment_id
configuration_version
crm_relationship_reference
retell_to_number_private_reference
number_assignment_version
retell_agent_id
agent_version
environment
coverage_mode
engagement_type
capability_profile
route_approval_state
actual_start_at
expires_at
eligible_handled_count
handled_call_limit
status
```

Acceptance:

- one active deployment per client test and one client per deployment;
- one current number binding per active deployment and no ambiguous/overlapping active mapping;
- the same accepted free-test agent may appear on multiple deployments;
- no mapping by mutable name or prompt text;
- a known authenticated invalid/unknown/ambiguous/inactive/expired/exhausted resolution returns HTTP 200 explicit rejection with no agent or resolver write; transport/authentication/timeout/503/malformed/invalid-override failure may reach only the shared agent's Configuration Unavailable no-intake gate;
- historical calls retain their embedded configuration/call ownership; initial validation numbers are not reused, completed numbers enter documented cooldown, and later reuse is separately reviewed; and
- conversion creates a separately accepted Revenue Desk agent rather than promoting or cloning the free-test flow.

## Phase 4: Build The Catalyst Ingress

The ingress accepts one exact `POST` route and the approved Retell event envelope.

Required processing order:

1. reject the wrong method, route, query shape, media type, or oversized body;
2. capture the unchanged raw body;
3. verify the Retell signature and signed timestamp;
4. parse JSON only after signature success;
5. validate the event type, call identifier, agent identifier, and schema;
6. resolve call ownership using validated deployment metadata, an existing immutable call binding, a unique effective `to_number` assignment, then `agent_id` only when it uniquely maps to one deployment;
7. derive a stable idempotency key;
8. durably claim a minimized event row;
9. enqueue or persist the normalized call update;
10. return an empty 2xx response inside the provider timeout; and
11. process slow or retrying downstream work asynchronously.

The current source includes the separate `retell_free_test_retry` Catalyst Function Job target, but repository presence is not deployment evidence. Before an internal phone test, prove the packaged Job identity, trigger/request shape, bounded backoff, event/notification recovery, and ambiguous-state readback in Development. Do not describe webhook acknowledgement, Catalyst persistence, or Job execution as durable until the exact boundary, failure recovery, and readback are observed.

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

Create one normalized call row per opaque keyed-HMAC-derived `call_lookup_key`. Bind it once to the immutable client, deployment, and configuration fields below. Do not retain the raw provider call identifier; reject any later ownership conflict.

Minimum proposed fields:

```text
client_id
deployment_id
configuration_version
call_lookup_key
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
call_lookup_key
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

## Free-Test Notification Boundary

After one eligible call is durably processed, Catalyst creates one idempotent email notification record for the destination already approved in that deployment snapshot. Callers cannot choose the destination and Retell never sends the message.

Development defaults to `dry_run`: the row terminates at `DryRunRecorded`, `attempts = 0`, provider code `CATALYST_MAIL_DRY_RUN`, and `app.email().sendMail` is not invoked. This proves correlation, minimization, recipient isolation, and replay idempotency but not delivery. Before internal-phone readiness, enable `send_development` only for one verified Development sender and approved synthetic recipient, read back provider acceptance and inbox delivery, prove replay creates no second delivery, handle ambiguity without blind resend, and restore `dry_run`. Prospect/customer delivery remains separately unresolved. See the [shared-agent runbook](shared-seven-day-monitor-number-routing.md).

## Phase 7: Reconcile Customer Outcomes

The 7-Day Free Test does not write a customer scheduling or field-service system. Apply this phase only to a separately approved paid Revenue Desk integration. For the free test, preserve the canonical outcome and later attribution fields in Catalyst without inventing booking, completion, or revenue.

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

The free-test MVP keeps CRM disabled. A future summary write requires its own approved field contract, idempotency, workflow-impact review, and readback; Retell never initiates it. CRM is not an internal-test dependency.

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

## Deferred Phase 9: Create Managed Analytics MCP Roles

This phase is not part of the free-test MVP and does not block offline or controlled internal Development testing.

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
Dim_Deployment
Dim_Date
Fact_Calls
Fact_Outcomes
Fact_Client_Daily
Fact_QA
```

Required controls:

- immutable `Client ID`;
- immutable `Deployment ID` and configuration version;
- stable opaque `Call Key`;
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

## Deferred Phase 11: Build Direct Catalyst-To-Analytics Sync

This phase is not part of the free-test MVP. Internal reporting uses Catalyst query/CSV.

Use the direct Analytics API with a dedicated least-privilege Connection.

Proposed batch behavior:

1. select pending outbox records in deterministic order;
2. lock or claim one bounded batch;
3. export a minimized synthetic or Production-approved payload;
4. submit asynchronous `updateadd`;
5. match later approved call facts on opaque `Call Key`, with `Client ID` and `Deployment ID` as mandatory partitions;
6. persist the provider job identifier;
7. poll with bounded backoff;
8. parse rejected rows and job totals;
9. read target counts and watermarks;
10. mark outbox records complete only after reconciliation; and
11. move unknown outcomes to operator review.

The initial operational hypothesis is hourly incremental sync plus periodic full reconciliation. The interval and batch size remain private configuration and must be adjusted from observed volume, API units, source capacity, and staleness requirements.

The free-test MVP has no Analytics adapter or reporting outbox. This direct-API sequence remains a separately approved future path.

## Phase 12: Build Reports

### Evaluation Report

Build one fixed-client report set and generate it manually.

Acceptance:

- one client and only its approved deployment(s);
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

For the 7-Day Free Test, run all 30 cases and the two-client isolation/replay lifecycle in the [shared-agent runbook](shared-seven-day-monitor-number-routing.md) and its linked machine-readable fixture. Reporting acceptance must additionally cover:

- valid analyzed call;
- call ended before analysis;
- identical duplicate;
- conflicting duplicate;
- unknown and ambiguous number;
- inactive/expired/exhausted deployment;
- conflicting deployment metadata and number assignment;
- invalid signature;
- stale signature timestamp;
- malformed JSON;
- oversized body;
- Catalyst Mail `DryRunRecorded` with zero attempts and no provider invocation;
- notification recipient crossover attempt;
- CRM remains disabled;
- client/deployment query and CSV reconciliation;
- transparent in-flight count overshoot;
- cross-client report attempt;
- malformed or cross-client export filters; and
- a delayed event that retains its embedded call ownership.

For each scenario, record expected HTTP result, durable state, downstream side effects, logs, report visibility, and containment action.

## Production Approval Package

Before Production, present privately:

- immutable source commit and artifact;
- exact Retell account, agent version, number, events, retention, and webhook target;
- exact Catalyst project, environment, function, route, tables, Connections, and configuration;
- proof that CRM and Analytics are disabled for the free-test MVP;
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
3. restore `FREE_TEST_NOTIFICATION_MODE=dry_run`, read it back, and stop query/CSV export while scope is uncertain;
4. preserve event, call, count, notification, and export evidence;
5. do not delete, reset, or automatically replay unresolved records;
6. revoke the affected Connection when outbound writes must stop;
7. reconcile Retell and Catalyst state and confirm CRM/Analytics remain untouched;
8. restore the prior accepted agent version, function artifact, model definition, or report schedule only when it is an approved rollback target;
9. run one synthetic end-to-end test; and
10. re-enable in the smallest approved order.

For a free-test identity, configuration, or isolation failure, do not switch to degraded intake or a client-specific free-test clone. Stop the affected deployment(s), restore `dry_run`, preserve current bindings, canonical calls, counts, notification rows, and export evidence, then verify explicit resolver rejection, safe shared-agent fallback, or the approved inactive carrier behavior. The [rollback checklist](rollback-checklist.md) contains the authoritative sequence.

A historical artifact, screenshot, or prior Git commit is not automatically a safe rollback target.

## Ongoing Operations

- Run phone samples only under a separately approved internal Development test record; this runbook makes no legal conclusion.
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
