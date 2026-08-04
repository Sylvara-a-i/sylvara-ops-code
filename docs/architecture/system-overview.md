# System Overview

## Purpose

This document defines ownership boundaries for Sylvara's public technical repository and connected business systems. It is a sanitized boundary model, not proof that any integration is deployed or that any live setting is configured.

## Operating Principles

- Keep the customer-facing call path small and reliable.
- Use managed platforms before custom infrastructure.
- Keep Make.com outside the critical conversational path where practical.
- Give each business fact one authoritative owner.
- Fail closed when identity, authorization, target, state, or response completeness is uncertain.
- Treat a GitHub merge as source-control completion, not production deployment.
- Require explicit approval for production changes, external publication, and financial or destructive actions.
- Use synthetic data in this repository. Production data and secrets stay in approved private systems.

## Source-Of-Truth Boundaries

| System | Authoritative For | Not Authoritative For | Current Status |
|---|---|---|---|
| GitHub | Sanitized source code, tests, public runbooks, architecture decisions, schemas, and example configuration | Secrets, client records, call content, live platform configuration, production state, or proof of deployment | Repository is the intended technical source of truth; live repository settings remain unverified until checked and recorded |
| Approved CRM | Account, contact, opportunity, and approved operational relationship records | Accounting balances, subscription billing, call recordings, secrets, or raw production payloads | CRM product, tenant, schema, and live integration are unverified |
| Zoho Books | General ledger, invoices, payments, credits, and accounting reconciliation | Voice behavior, CRM relationship ownership, subscription entitlement logic, or source code | A supplied chart-of-accounts export confirms prior configuration evidence; current organization, balances, and integration state remain unverified |
| Zoho Billing | Subscription plans, subscription lifecycle, renewals, and entitlements when adopted | General ledger truth, payment reconciliation, CRM relationship ownership, or source code | Use and integration state are unverified; its boundary with Books must be documented before implementation |
| Zoho Creator | Approved operational forms, portals, workflow views, and human task state when adopted | Accounting truth, secrets, raw call content, or canonical source code | Use and integration state are unverified |
| Zoho Catalyst | Approved middleware, API gateway functions, webhook verification, retry-safe processing, and durable integration state when adopted | Business-system records owned by CRM, Books, or Billing; secret documentation; or proof that a Git commit is deployed | A non-executable review record preserves historical design evidence; the supplied handler is excluded and current environment layout and deployment state remain unverified |
| Retell AI | Voice runtime behavior, call execution, and approved runtime configuration | CRM, accounting, subscription, source-control, or secret ownership | Default target voice runtime for initial pilots; exact live agents, prompts, numbers, and configuration are private and unverified |
| Make.com | Approved post-call orchestration and system handoffs | Critical conversational availability, accounting truth, source code, or secret ownership | Default target post-call workflow layer for initial pilots; exact live scenarios are private and unverified |
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

Retell handles the real-time voice interaction. Make handles approved post-call work. A Make outage should not unnecessarily break an active conversation. Handoffs must be idempotent, validate required fields, avoid raw sensitive payloads, and route uncertain results to review instead of guessing.

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
