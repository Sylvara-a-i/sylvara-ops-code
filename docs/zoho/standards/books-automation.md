# Zoho Books Automation Standard

## Status

- Repository standard: **Proposed**
- Official capability evidence: current Zoho Books API documentation, subject to operation-specific verification
- Advertised MCP evidence: dated 2026-08-04 historical snapshot plus a 2026-08-05 Books refresh exposing 91 Audit, 24 Changes, and 67 Controller operations
- Sylvara Books organization and read access: **Verified 2026-08-05** for the active live organization, Admin identity, and complete active/inactive chart
- Chart mutation access: **Verified for the bounded 2026-08-05 chart deployment**; create, update, mark-active, and mark-inactive succeeded with independent Audit readback, but every future use still requires fresh scoped authorization and controls

This standard governs engineering controls. It does not establish a live accounting fact, approve accounting treatment, or authorize a Books mutation.

## Risk Boundary

Zoho Books is Sylvara's accounting source of truth. A tool that can create, update, apply, void, reconcile, approve, publish, or lock accounting state is high-risk even when the API operation appears routine.

This standard governs MCP tools, Deluge functions, Catalyst middleware, and other integrations that read or change Books. It does not authorize a live accounting change.

## Ownership

Zoho Books owns Sylvara's general ledger, subledgers, recorded invoices and payments, credits, reconciliations, and financial reporting. Billing may own an approved subscription lifecycle, CRM owns commercial relationships, and middleware may verify and route events; none may silently replace or independently recreate the accounting outcome recorded in Books.

The authorized financial owner and qualified professional, when appropriate, retain responsibility for accounting policy, tax treatment, entity classification, period close, and material corrections. Automation enforces an approved treatment; it does not invent one.

## Required Control Layer

Native tool selection is insufficient. Every write path must add:

1. **Fixed target binding:** hard-bind the approved organization, data center, and environment inside the server. Do not accept a caller-selected organization.
2. **Fresh prestate:** reread the exact transaction, account, period, related records, and current user immediately before writing.
3. **Immutable plan:** hash the normalized target, expected prestate, proposed mutation, approval scope, and short expiry.
4. **Stale-state abort:** reject any material difference between approved and current state.
5. **Stable idempotency:** derive a key from the business event and intended outcome; enforce it durably.
6. **Serialization:** prevent conflicting writes to the same customer, document, payment, account, or reconciliation scope.
7. **Durable ledger:** privately record plan hash, idempotency key, attempt, returned ID, outcome, and readback without sensitive payloads.
8. **Ambiguous-timeout handling:** never blindly retry; search and reconcile authoritative Books state first.
9. **Independent readback:** use a read-only audit identity to verify the created or changed object.
10. **Reconciliation:** tie the result to the relevant subledger, account, report, or bank state before declaring completion.

## Server Roles

- **Audit:** read-only and always separated from mutation identities.
- **Bookkeeping:** only the smallest approved routine draft or record operations; no broad controller authority.
- **Controller:** disconnected or explicitly approval-gated for journals, credits, refunds, reconciliation, opening balances, tax/configuration, period state, and similar high-impact operations.

Do not default to module-level `.ALL` operation scopes or assemble an all-modules grant. Avoid generic raw-request tools, generic delete or bulk-delete, journal approval/publication, and transaction-lock mutation unless a narrowly documented exceptional workflow proves the need and adds stronger independent approval. OAuth scopes are broader than individual tools, so select the exact documented module and operation scopes, then enforce narrower paths, verbs, payloads, and roles in code.

Use the current official [Zoho Books OAuth scope reference](https://www.zoho.com/books/api/v3/oauth/) and [organization API reference](https://www.zoho.com/books/api/v3/organizations/) when designing access. A documented scope or `organization_id` parameter is API capability, not fixed-target enforcement.

## Pre-Write Evidence

A financial write requires:

- exact organization and environment identity;
- exact record IDs stored privately and fresh state;
- source documents or authoritative transaction evidence;
- duplicate search across relevant transaction classes;
- open, reconciled, and locked-period checks;
- the full accounting effect, including currency, tax, account, customer/vendor, and linked-document impact;
- explicit proposed entries and totals; and
- scoped approval for that one plan.

Do not invent a monthly allocation from an annual total, infer payment status from an invoice alone, plug a balance to income or expense, or create a balancing record merely to force agreement.

## Automation Ownership

Each transaction class has one owner. Generic invoice, payment, credit, refund, or journal tools must reject a class already owned by a dedicated automation. This prevents overlapping schedules, double charging, duplicate sending, and conflicting corrections.

Dry-run or non-posting mode is the default. Posting, sending, applying, approving, voiding, or reconciling requires a separate explicit enablement and smoke test.

## Failure And Readback

The public 2026-08-04 name inventory does not establish a complete response schema. Treat response typing and completeness as **Unknown** until the current private runtime contract is inspected. Validate the Zoho response code, required returned fields, object status, amounts, links, and side effects. A transport success indicator alone is insufficient.

Stop on the first mismatch. Authorization failure, partial response, malformed data, rate limit, stale state, or missing evidence is not an empty result and must not be converted into a write.

After an approved mutation, use the independent audit identity to read the exact transaction, account, status, totals, currency, tax treatment, linked records, and audit trail. Reconcile the result to the relevant subledger, account, report, or bank state. An ambiguous timeout requires authoritative search and reconciliation before any retry or corrective entry.

## Validation

Every workflow needs synthetic or Development coverage for:

- first execution and exact duplicate replay;
- partial payment, credit, refund, tax, and multi-currency behavior where applicable;
- zero, one, and multiple record matches;
- locked, reconciled, voided, deleted, disputed, and stale states;
- API rejection, rate limit, timeout before commit, and timeout after possible commit;
- readback mismatch and reconciliation failure;
- dry-run output and live-mode double guard; and
- rollback or safe containment without deleting evidence.

Production smoke tests require separate approval and must use the smallest reversible action available.

## Repository Boundary

Never commit organization IDs, account IDs or suffixes, balances, transactions, tax details, bank-feed rows, invoices, attachments, OAuth material, or raw exports. The sanitized chart of accounts is reference material only; it is not an import contract and does not prove current live configuration.

GitHub may contain sanitized control logic, account-purpose descriptions, synthetic tests, decision tables, and setup or rollback runbooks. Logs and public evidence must exclude private identifiers, counterparties, amounts, source documents, raw responses, and financial state.

## Manual Setup

Except for the scoped chart identity/read/create/update/activate/inactivate evidence recorded above, live automation setup remains **Unknown**. Before relying on any other workflow, verify or configure:

- the exact Books organization, data center, accounting method, base currency, fiscal period, tax settings, and authoritative financial owner;
- least-privilege audit, bookkeeping, and controller identities with a fixed organization and environment;
- approved transaction ownership, evidence requirements, duplicate keys, posting versus draft behavior, locks, reconciliation, and materiality rules;
- durable idempotency, serialization, private write ledger, ambiguous-outcome reconciliation, and independent readback;
- synthetic or Development tests, dry-run controls, monitoring, rollback or safe containment, and support escalation; and
- a private approval and deployment record binding the immutable plan, exact prestate, proposed accounting effect, source revision, and readback result.

Repository review does not authorize posting, sending, applying, approving, voiding, reconciling, locking, or changing accounting configuration.
