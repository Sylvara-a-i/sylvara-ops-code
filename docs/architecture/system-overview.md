# System Overview

## Purpose

This document defines ownership boundaries for Sylvara's public technical repository, initial managed receptionist product, and connected business systems. The product scope is governed by [Managed Receptionist Product Direction](../product/README.md). This is a sanitized boundary model, not proof that any integration is deployed or that any live setting is configured.

## Operating Principles

- Keep the customer-facing call path small and reliable.
- Optimize the initial path for after-hours and overflow residential-plumbing calls; expand coverage only through the approved progressive-deployment gates.
- Treat a completed and reconciled customer workflow as the outcome. An answered call or generated summary is intermediate evidence, not business completion.
- Keep eligibility, service area, schedules, emergency conditions, routing, appointment types, and fallback behavior in validated structured rules rather than solely in prompts.
- Use managed platforms before custom infrastructure.
- Preserve explicit boundaries between telephony, voice runtime, Sylvara-owned workflow logic, and customer systems so one provider can be replaced without redefining the product.
- Keep Make.com outside the critical conversational path where practical.
- Give each business fact one authoritative owner.
- Fail closed when identity, authorization, target, state, or response completeness is uncertain.
- Treat a GitHub merge as source-control completion, not production deployment.
- Require explicit approval for production changes, external publication, and financial or destructive actions.
- Use synthetic data in this repository. Production data and secrets stay in approved private systems.

## Source-Of-Truth Boundaries

This table defines durable ownership boundaries. Current Zoho capability evidence is maintained in the [suite registry](../zoho/governance/suite-registry.json), and completed live changes are recorded in the [deployment log](../runbooks/deployment-log.md); those dated records supersede any older status summary.

| System | Authoritative For | Not Authoritative For | Current Status |
|---|---|---|---|
| GitHub | Sanitized source code, tests, public runbooks, architecture decisions, schemas, and example configuration | Secrets, client records, call content, live platform configuration, production state, or proof of deployment | Repository security controls were reviewed and recorded on 2026-08-04; reverify after material settings, ownership, plan, or app-access changes |
| Sylvara managed service layer | Approved structured call rules, workflow orchestration, outcome taxonomy, integration state, quality-control evidence, and bounded operational configuration when implemented | The customer's schedule, job, payment, relationship, or completed-revenue truth; voice transport; or proof that a proposed capability is live | Product boundary is accepted for validation; implementation, runtime, data model, and deployment are unverified |
| Approved telephony carrier | Number routing, call transport, carrier events, and transport-level delivery state for the selected deployment | Customer eligibility, booking truth, dispatch policy, commercial relationship, or Sylvara source code | Carrier, number, forwarding behavior, regions, and live state are unverified |
| Approved CRM | Account, contact, opportunity, and approved operational relationship records | Accounting balances, subscription billing, call recordings, secrets, or raw production payloads | On 2026-08-14, Zoho CRM organization identity, the current four-module schema, conversion mappings, four active Free-Test workflows, and the active Deal Blueprint were read back. Schema/configuration acceptance passed, but no new workflow has executed and the Blueprint has zero enrolled records. Zoho Forms/controller behavior and native human-approved conversion remain outside runtime proof; see the dated suite registry and effective snapshot. |
| Customer field-service or scheduling system | Approved services, service area, staff availability, appointment capacity, jobs, work orders, and dispatch state within that customer's operating contract | Voice behavior, Sylvara subscription state, accounting truth, or source code | Product, tenant, schema, permissions, and integration state are unverified; live metadata and readback are required per customer |
| Zoho Books | General ledger, invoices, payments, credits, and accounting reconciliation | Voice behavior, CRM relationship ownership, subscription entitlement logic, or source code | Zoho Books organization identity and scoped chart read, create, update, activate, and inactivate capabilities were verified on 2026-08-05. Balances, transactions, reconciliation, tax settings, and product integration are not thereby verified; see the dated suite registry and deployment log. |
| Zoho Billing | Subscription plans, subscription lifecycle, renewals, and entitlements when adopted | General ledger truth, payment reconciliation, CRM relationship ownership, or source code | Use and integration state are unverified; its boundary with Books must be documented before implementation |
| Zoho Creator | Approved operational forms, portals, workflow views, and human task state when adopted | Accounting truth, secrets, raw call content, or canonical source code | Use and integration state are unverified |
| Zoho Forms | Lightweight external intake before authoritative validation and acceptance | Relationship, subscription, or accounting truth | Use, configuration, and integration state are unverified |
| Zoho WorkDrive | Private document contents, versions, hierarchy, and controlled sharing metadata | CRM relationship or accounting facts | Configured-selection evidence was observed on 2026-08-04, but the current advertised contract, tenant identity, grants, hierarchy, response contracts, and effective access remain unverified |
| Zoho Contracts | Contract drafting, clauses, approvals, and legal lifecycle state | Signature execution evidence, public storage, or CRM relationship truth | Use, templates, contract types, and integration state are unverified |
| Zoho Sign | Signer routing, execution status, and signature evidence | Contract drafting or CRM relationship truth | Use, templates, signer rules, and integration state are unverified |
| Zoho Sites | Public presentation and approved doorway behavior | Operational, relationship, subscription, or accounting truth | Use and administration capability are unverified |
| Zoho Mail | Zoho Mail mailbox messages and their delivery state | Catalyst Mail function sends, CRM relationship truth, consent truth, or financial state | Use, sender identities, scopes, webhooks, and integration state are unverified |
| Zoho Analytics | Derived reporting models, refresh state, dashboards, and controlled exports | Transactional truth or reverse-write authority | The official managed Analytics MCP tool page was reviewed on 2026-08-18 and the proposed reporting roles and metric contract are documented. Sylvara organization, plan, workspace, configured selection, effective access, model, schedules, and client isolation remain unverified. |
| Zoho Catalyst | Free-test deployment/configuration snapshots, current number binding, pre-call eligibility, handled count, webhook verification, retry-safe canonical calls/outcomes, durable Catalyst Mail state, Function Job recovery, and query/CSV reporting | Business-system records owned by CRM, Books, or Billing; secret documentation; optional later analytical presentation; or proof that a Git commit is deployed | Four exact Development tables, two 256 MB functions, a 512 MB Job pool, a disabled one-minute Cron, non-secret configuration, source parity, and function rollback were read back at revision `430f4ae628c9b5f3e8e068c802016bc0513e80b5`. Required secrets and a verified mail sender remain absent, so readiness fails closed and the Catalyst phase is incomplete; see the [free-test reconciliation](../runbooks/free-test-development-reconciliation-2026-08-22.md). |
| Approved voice platform; Retell is the current implementation candidate | Voice runtime behavior, call execution, and approved runtime configuration for the selected deployment | Client ownership, structured customer business-rule ownership, downstream job truth, CRM, accounting, subscription, legal approval, consent truth, source-control, or secret ownership | ADR 0006 selects one shared draft free-test agent with dedicated client numbers and Catalyst configurations. A sanitized Development inspection is recorded in the [free-test reconciliation](../runbooks/free-test-development-reconciliation-2026-08-22.md); binding, routing, publication, legal approval, and telephone behavior remain unproven. |
| Make.com or approved orchestration platform | Approved non-critical post-call orchestration and system handoffs | Critical conversational availability, accounting truth, legal approval, consent truth, source code, or secret ownership | Disabled in the proposed controlled demo; any future workflow and exact live scenario remain unverified and separately gated |
| Approved human escalation destination | Human handling and disposition of explicitly transferred exceptions during the approved coverage window | Default handling of every call, Sylvara workflow truth, or downstream system-of-record state | Disabled in the proposed controlled demo; destination, coverage, privacy terms, transfer behavior, and capacity for a future pilot are unverified |
| Approved secret stores | Credential values, signing secrets, tokens, and environment-specific sensitive configuration | Business records, source code, deployment evidence, or public documentation | Secret values must remain in platform-native encrypted stores; the approved store inventory is unverified |

## Boundary Rules

Portable Zoho integration, schema, Deluge, and MCP controls are indexed in [`docs/zoho/README.md`](../zoho/README.md). Those standards describe engineering behavior only; they do not establish a live tenant, field selection, connection, or deployment.

### GitHub

GitHub may contain sanitized templates, code, tests, runbooks, interface contracts, and examples. Repository artifacts must use placeholders or synthetic values. A pull request and commit SHA establish what was reviewed; they do not establish what is running.

### CRM And Operational Systems

The CRM owns customer relationship facts. Zoho Creator may present or coordinate operational work, but it must reference authoritative records rather than silently creating a second source of truth. Any synchronization must define direction, conflict behavior, duplicate handling, and readback verification.

### Accounting And Subscription Systems

Zoho Books owns accounting facts when adopted. Zoho Billing may own subscription lifecycle facts when adopted. Before connecting them, document which system creates each invoice, payment, credit, refund, and entitlement event. Never repair a mismatch by inventing a balancing record or retrying an ambiguous financial write.

### Voice And Workflow Runtime

The [legal and compliance control archive](../legal-compliance/README.md) preserves dated research and a conservative historical internal-QA proposal; it is not legal advice or a legal conclusion for a particular test. That historical profile specified no post-call handoff. Keep offline/synthetic Development testing, a controlled internal Development phone test, and a prospect/customer launch as separate approvals. A controlled internal call requires an owner-approved scope, synthetic facts, Development provider/settings readback, data-handling decision, and rollback; its exact data path must be stated rather than inherited silently from the historical profile. Prospect-facing telephone demonstrations remain blocked by repository authority while their operating approval is unresolved.

For a future separately approved pilot, the approved voice platform would handle the real-time interaction and call artifacts while the telephony carrier owns transport state. Sylvara-owned logic must represent critical eligibility, routing, escalation, and outcome rules in structured, testable form; it must not bury the complete operating contract in one provider-specific prompt. Make or another approved automation platform may handle non-critical post-call work. An orchestration outage should not unnecessarily break an active conversation. Handoffs must be idempotent, validate required fields, minimize private data, and route uncertain results to review instead of guessing.

New deployments begin with synthetic and shadow tests, then separately approved after-hours or overflow coverage, then selected call types. Primary reception requires separate sustained evidence and production approval. Each expansion preserves a tested containment and rollback route. Configuration uncertainty fails closed; it does not authorize degraded intake.

Call disposition and estimated value are Sylvara operational evidence. A booking, work order, completed job, invoice, payment, or collected revenue becomes authoritative only in the customer system that owns that fact. Attribution must reconcile those layers rather than equate an answered call with revenue.

### Middleware

Use Catalyst only when a concrete integration requires controls that a managed connector cannot safely provide, such as signature verification, payload allowlisting, idempotency, durable retry state, or audited readback. Do not add middleware merely to mirror platform features.

## Proposed Call And Reporting Flow

[ADR 0006](../adr/0006-shared-seven-day-monitor-with-client-number-isolation.md) governs the free-test topology and tenancy model. [The shared-agent runbook](../runbooks/shared-seven-day-monitor-number-routing.md) sequences Development validation, acceptance, containment, and rollback. ADR 0004 and the generic reporting runbook retain the compatible system-ownership and reporting controls. The dated reconciliation records the bounded Catalyst Development deployment evidence; these documents do not prove a signed request, durable lifecycle, Retell route, email, call, or Production deployment.

```text
Approved carrier route
        |
        v
Client-specific Retell number
        |
        v
One shared 7-Day Free Test agent
        |
        | exact pre-call configuration gate
        v
Client-specific Catalyst deployment/configuration snapshot
        |
        | signed account-level post-call events
        v
Catalyst verification, immutable call/deployment binding, minimized event
ledger, normalized call/outcome, handled count, and durable email state
        |
        +----> Catalyst Mail email record (`dry_run` by default)
        |
        +----> Catalyst Function Job for due retryable state
        |
        +----> client-partitioned query and sanitized CSV report
```

All active free tests use the same accepted Retell agent and flow. Each client has a dedicated Retell number and a versioned Catalyst deployment/configuration snapshot. A known authenticated invalid, unknown, ambiguous, inactive, expired, or exhausted resolution returns HTTP 200 explicit rejection, starts no agent, and creates no resolver-side write. Transport/authentication/timeout/503/malformed/invalid-override failure may fall back only to the number-bound shared agent, whose exact Configuration Unavailable gate ends without intake. The seven-field gate, strict seven-day boundary, practical 25-handled-call stop, and ownership priority are defined in ADR 0006. Calls already in flight may create a reported count overshoot; the MVP does not claim a concurrency-perfect cap. The shared `agent_id` is never sufficient tenancy evidence. A separately accepted Revenue Desk agent is appropriate only after paid conversion requires deeper client-specific workflow behavior.

Catalyst is the canonical free-test operational store: deployment ownership, configuration versions, current number binding, event claims, immutable call bindings, canonical outcomes, handled count, email notification record, and reportable fields. Development email defaults to `dry_run`: one `DryRunRecorded` row, zero attempts, no `sendMail` invocation. Before internal-phone readiness, one controlled `send_development` delivery must receive provider/inbox readback, replay must produce no duplicate, and the mode must return to `dry_run`. CRM is disabled in the MVP call path. Internal reporting uses client-partitioned queries and sanitized CSV; Analytics is deferred and is not an internal-test blocker. The free test does not book, dispatch, quote, take payment, or mutate a customer operating system.

Use one voice-integration Catalyst project per environment rather than one project or function stack per client. Keep ingress, the separate retry Job, post-call processing, Catalyst Mail state, and query/CSV responsibilities small and explicit. The Billing gateway remains separate.

Initial internal validation requires two dedicated synthetic numbers pinned to the same reviewed shared agent version. Do not reuse either number during initial validation. After completion, preserve its binding evidence and place it into a documented cooldown; automatic reassignment remains deferred and is not an internal-test blocker.

Managed Analytics MCP roles remain reference material for a later reporting phase. The free-test MVP does not depend on an Analytics workspace, connection, import, job, or dashboard. The [dated managed MCP catalog](../zoho/mcp/reference/zoho-analytics-managed-mcp-catalog-2026-08-18.md) remains separate evidence and does not imply adoption.

The first report is a manually reviewed Catalyst query/CSV export for exactly one client/deployment. Any later external delivery requires approved recipients, restricted export handling, reconciled counts, and clear separation between estimated opportunity value and verified booked, completed, invoiced, or paid value. Scheduled Analytics delivery and a client portal remain deferred.

## Change And Data Flow

1. A source change is reviewed and merged in GitHub.
2. The exact merged commit or immutable artifact is selected for deployment.
3. An authorized operator verifies target identity, environment, current state, proposed state, and rollback target.
4. Explicit production approval is recorded outside sensitive public detail.
5. The smallest approved change is applied.
6. Runtime and downstream state are independently read back.
7. The public deployment log receives only a sanitized result; sensitive evidence stays in the approved private audit system.

For event-driven integrations, persist or derive a stable idempotency key, reject duplicates, avoid blind retry after an ambiguous timeout, and reconcile the authoritative downstream system before declaring success.

## Status Labels For Diagrams And Runbooks

Use these labels whenever documenting an integration:

- **Verified:** Confirmed through current, dated, read-only evidence.
- **Proposed:** Designed but not proven deployed.
- **Legacy:** Retained only for historical reference; not an approved current path.
- **Unknown:** Evidence is missing, stale, ambiguous, or incomplete.

Unlabeled paths must be treated as **Unknown**.

## Legacy And Uncertain Artifacts

- Archived functions, exports, screenshots, and imported configuration are reference evidence only.
- A filename, repository path, or old deployment note does not prove a component is active.
- Do not copy a legacy identifier, connection name, endpoint, field name, or prompt into a current implementation without live metadata verification.
- If current and archived evidence conflict, stop and resolve ownership before writing to any live system.
- Promote a legacy path to current only through an architecture decision, tests, deployment approval, and post-deployment readback.
