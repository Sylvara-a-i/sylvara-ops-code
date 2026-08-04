# Accounting Operating Controls

## Purpose

These controls govern how an approved accounting conclusion becomes a repeatable operating process. They are system-neutral; the [Zoho Accounting Practices Standard](../zoho/standards/accounting.md) adds product-specific posting, reconciliation, and readback rules.

## Policy Register

Maintain approved policies in a private controlled register. Each policy needs:

- a stable policy ID, title, owner, reviewer, status, effective date, and superseded-policy link;
- the legal entity, reporting basis, jurisdictions, transaction classes, and exclusions it covers;
- current authority citations and the date each source was verified;
- required facts, evidence, approvals, calculation method, accounts, disclosures, and book-tax treatment;
- any election, estimate, materiality threshold, safe harbor, transition method, or exception with its applicable period;
- implementation owners across Books, Billing, payroll, banking, contracts, and automation;
- test cases, reconciliation, rollback or correction method, and failure behavior; and
- scheduled and event-driven review triggers.

Unknown fields remain explicit. A partially completed policy is **Proposed** or **Unresolved**, not silently operational.

## Transaction Evidence

Before classification or posting, establish the entity, counterparty, date, amount, currency, service or asset, business purpose, contract terms, approval, payment path, tax attributes, related records, and duplicate status. Evidence must support both the economic event and the proposed treatment.

- Keep source documents and detailed calculations in the approved private accounting or document system.
- A bank or card charge proves payment activity, not business purpose, deductibility, capitalization, or the receiving entity.
- Customer billing proves a claim for payment, not necessarily recognized revenue.
- Processor settlement totals must reconcile to gross activity, fees, refunds, disputes, reserves, and cash.
- Personal, owner, employee, related-party, loan, equity, payroll, tax, and uncertain transactions require explicit routing and approval.
- Do not force an unexplained difference into income, expense, equity, a journal, or a suspense account merely to clear a queue.

## Posting Controls

Every posting process must define the source event, accounting effect, draft-versus-post behavior, duplicate key, approval, period checks, linked records, expected reports, and safe response to an ambiguous timeout.

For manual or automated entries:

1. Verify the fixed legal entity and ledger organization.
2. Refresh the exact prestate and search for exact and near duplicates.
3. Validate policy, period, currency, tax, account purpose, and required approvals.
4. Preserve an immutable input or plan identifier for the approved action.
5. Serialize conflicting writes and use durable idempotency for retryable workflows.
6. Persist the returned record identity before acknowledging completion.
7. Read back through an independent path and reconcile the complete accounting effect.
8. Stop on the first mismatch. Never hide it with a second compensating guess.

Journal entries receive stronger review because they write directly to the general ledger. They must balance, state the business purpose, reference private evidence, respect locks and reconciliations, and identify the approved correction or policy.

## Reconciliation And Close

The close owner must use a dated checklist and evidence completion, exceptions, review, and locks. At minimum:

- reconcile cash, cards, payment clearing, receivables, payables, payroll, tax, debt, equity, and other material control accounts;
- reconcile processor gross activity to fees, refunds, disputes, reserves, and deposits;
- evaluate cutoff for revenue, expenses, payroll, cash, credits, refunds, assets, liabilities, and taxes;
- review manual journals, unusual balances, related parties, suspense, stale items, duplicates, estimates, and prior-period activity;
- reconcile subledgers and authoritative reports to the general ledger;
- assess required accruals, deferrals, credit losses, contingencies, subsequent events, and disclosures under the approved reporting basis;
- document unresolved items, materiality decisions, reviewer approval, and the exact reports used; and
- apply the approved period lock only after reconciliation and review.

Do not unlock, rewrite, delete, or backdate a closed-period item without an impact analysis, scoped approval, preserved audit trail, and reissued reconciliations or reports where required.

## Corrections And Method Changes

Correct the underlying record when the system, period, audit trail, and governing policy permit it. Otherwise use the professionally approved correction method. Never delete evidence or manufacture a replacement transaction to make history look clean.

An error correction, estimate change, accounting-principle change, tax accounting-method change, election, and operational mapping fix are different actions. Classify the change first. Method changes and period effects may require professional analysis, disclosure, amended filings, consent, or transition calculations.

## Automation Boundary

Accounting automation may validate, route, calculate under an approved deterministic rule, prepare a draft, reconcile, or flag an exception. It must fail closed on missing facts, stale state, duplicate ambiguity, unknown tax or reporting treatment, locked periods, authorization failure, partial responses, or unavailable readback.

Automation must not independently decide:

- whether financial statements comply with U.S. GAAP;
- revenue performance obligations, variable consideration, principal-versus-agent status, or collectability;
- software, research, cloud-implementation, asset, repair, or expense classification;
- worker status, payroll correction, accountable-plan qualification, or information-return treatment;
- accounting-method changes, tax elections, depreciation choices, or filing positions; or
- credit-loss methodology, contingencies, going concern, related parties, or subsequent-event conclusions.

Use Development, synthetic fixtures, dry-run or draft-only behavior, bounded retries, redacted logs, and independent reconciliation before any approved live use.

## Retention And Privacy

Retention follows current law, filing limitations, employment-tax requirements, contracts, audit needs, legal holds, and the approved records schedule. Do not encode one universal period. Preserve records long enough to support asset basis, elections, returns, payroll, ownership, contracts, and open disputes where applicable.

Private evidence remains in the approved accounting or document system with least privilege. GitHub stores only sanitized controls, schemas, tests, and source locators.
