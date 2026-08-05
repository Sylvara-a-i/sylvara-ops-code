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

| System | Authoritative For | Not Authoritative For | Current Status |
|---|---|---|---|
| GitHub | Sanitized source code, tests, public runbooks, architecture decisions, schemas, and example configuration | Secrets, client records, call content, live platform configuration, production state, or proof of deployment | Repository security controls were reviewed and recorded on 2026-08-04; reverify after material settings, ownership, plan, or app-access changes |
| Sylvara managed service layer | Approved structured call rules, workflow orchestration, outcome taxonomy, integration state, quality-control evidence, and bounded operational configuration when implemented | The customer's schedule, job, payment, relationship, or completed-revenue truth; voice transport; or proof that a proposed capability is live | Product boundary is accepted for validation; implementation, runtime, data model, and deployment are unverified |
| Approved telephony carrier | Number routing, call transport, carrier events, and transport-level delivery state for the selected deployment | Customer eligibility, booking truth, dispatch policy, commercial relationship, or Sylvara source code | Carrier, number, forwarding behavior, regions, and live state are unverified |
| Approved CRM | Account, contact, opportunity, and approved operational relationship records | Accounting balances, subscription billing, call recordings, secrets, or raw production payloads | CRM product, tenant, schema, and live integration are unverified |
| Customer field-service or scheduling system | Approved services, service area, staff availability, appointment capacity, jobs, work orders, and dispatch state within that customer's operating contract | Voice behavior, Sylvara subscription state, accounting truth, or source code | Product, tenant, schema, permissions, and integration state are unverified; live metadata and readback are required per customer |
| Zoho Books | General ledger, invoices, payments, credits, and accounting reconciliation | Voice behavior, CRM relationship ownership, subscription entitlement logic, or source code | A supplied chart-of-accounts export confirms prior configuration evidence; current organization, balances, and integration state remain unverified |
| Zoho Billing | Subscription plans, subscription lifecycle, renewals, and entitlements when adopted | General ledger truth, payment reconciliation, CRM relationship ownership, or source code | Use and integration state are unverified; its boundary with Books must be documented before implementation |
| Zoho Creator | Approved operational forms, portals, workflow views, and human task state when adopted | Accounting truth, secrets, raw call content, or canonical source code | Use and integration state are unverified |
| Zoho Forms | Lightweight external intake before authoritative validation and acceptance | Relationship, subscription, or accounting truth | Use, configuration, and integration state are unverified |
| Zoho WorkDrive | Private document contents, versions, hierarchy, and controlled sharing metadata | CRM relationship or accounting facts | Advertised MCP tool-name evidence was observed, but current tenant identity, grants, hierarchy, response contracts, and effective access remain unverified |
| Zoho Contracts | Contract drafting, clauses, approvals, and legal lifecycle state | Signature execution evidence, public storage, or CRM relationship truth | Use, templates, contract types, and integration state are unverified |
| Zoho Sign | Signer routing, execution status, and signature evidence | Contract drafting or CRM relationship truth | Use, templates, signer rules, and integration state are unverified |
| Zoho Sites | Public presentation and approved doorway behavior | Operational, relationship, subscription, or accounting truth | Use and administration capability are unverified |
| Zoho Mail | Mailbox messages, approved send transport, and delivery state | CRM relationship truth, consent truth, or financial state | Use, sender identities, scopes, webhooks, and integration state are unverified |
| Zoho Analytics | Derived reporting models, refresh state, dashboards, and controlled exports | Transactional truth or reverse-write authority | Use, source lineage, refresh timing, access controls, and integration state are unverified |
| Zoho Catalyst | Approved middleware, API gateway functions, webhook verification, retry-safe processing, and durable integration state when adopted | Business-system records owned by CRM, Books, or Billing; secret documentation; or proof that a Git commit is deployed | A sanitized Billing gateway replacement and proposed Data Store schema exist in GitHub; current Catalyst project, route, variables, deployment, and runtime state remain unverified |
| Approved voice platform; Retell is a candidate | Voice runtime behavior, call execution, and approved runtime configuration for the selected deployment | Structured customer business-rule ownership, downstream job truth, CRM, accounting, subscription, legal approval, consent truth, source-control, or secret ownership | No platform is approved by this repository; vendor/legal review and exact live agents, prompts, numbers, recording, retention, and training settings are private and unverified |
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

The [legal and compliance control archive](../legal-compliance/README.md) governs proposed voice, consent, recording, data, vendor, and launch boundaries. No voice runtime is legally approved merely because it is named in this architecture. The only proposed telephone test is internal, non-sales QA: it requires prior written tester authorization, a carrier-level one-way media gate and keypad assent before inbound audio reaches any AI, speech, or model system, no retained call content, no outbound channel or production integration, and no post-call handoff. Prospect-facing telephone demonstrations remain blocked.

For a future separately approved pilot, the approved voice platform would handle the real-time interaction and call artifacts while the telephony carrier owns transport state. Sylvara-owned logic must represent critical eligibility, routing, escalation, and outcome rules in structured, testable form; it must not bury the complete operating contract in one provider-specific prompt. Make or another approved automation platform may handle non-critical post-call work. An orchestration outage should not unnecessarily break an active conversation. Handoffs must be idempotent, validate required fields, minimize private data, and route uncertain results to review instead of guessing.

New deployments begin with synthetic and shadow tests, then after-hours or overflow coverage, then selected call types. Primary reception requires separate sustained evidence and production approval. Each expansion preserves a tested fallback and a rollback route.

Call disposition and estimated value are Sylvara operational evidence. A booking, work order, completed job, invoice, payment, or collected revenue becomes authoritative only in the customer system that owns that fact. Attribution must reconcile those layers rather than equate an answered call with revenue.

### Middleware

Use Catalyst only when a concrete integration requires controls that a managed connector cannot safely provide, such as signature verification, payload allowlisting, idempotency, durable retry state, or audited readback. Do not add middleware merely to mirror platform features.

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
