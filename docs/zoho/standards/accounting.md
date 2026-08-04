# Zoho Accounting Practices Standard

## Status

- Repository standard: **Proposed**
- Sylvara accounting method, tax settings, close calendar, approval roles, reconciliation state, and current Zoho Books configuration: **Unknown**

This standard governs evidence, classification, reconciliation, and close practices around Zoho Books. It complements the automation controls without prescribing tax or legal conclusions. The official [Chart of Accounts API](https://www.zoho.com/books/api/v3/chart-of-accounts/), [Journals API](https://www.zoho.com/books/api/v3/journals/), [bank account API](https://www.zoho.com/books/api/v3/bank-accounts/), and [organization API](https://www.zoho.com/books/api/v3/organizations/) describe product capabilities, not approved accounting treatment.

This is the Zoho Books implementation standard for the product-neutral [Sylvara Accounting Knowledge Base](../../accounting/README.md). Federal tax authority, U.S. GAAP topic research, and approved accounting policy take precedence over software configuration. A Books setting or automation is never evidence that a treatment is legally or professionally correct.

## Ownership

Zoho Books owns Sylvara's general ledger, subledgers, recorded invoices and payments, credits, reconciliations, and financial reports. Bank, payment processor, vendor, customer, payroll, tax, and source documents provide evidence; they do not replace the Books ledger. Billing owns approved subscription lifecycle state, not general-ledger truth.

Accounting policy, tax treatment, entity classification, equity treatment, period close, and material correcting entries require the authorized financial owner and qualified professional review when appropriate.

## Evidence And Classification

For every classification or correction, retain private evidence sufficient to establish the entity, date, amount, currency, counterparty, business purpose, tax treatment where applicable, payment path, and duplicate status. Use the most authoritative available source and reconcile conflicting evidence before posting.

- Do not categorize evidence-poor activity merely to clear a queue.
- Do not plug an unexplained balance to income, expense, equity, or a suspense account to force agreement.
- Do not infer payment, refund, credit, or invoice status from only one side of the transaction.
- Keep mixed personal/business, owner, related-party, tax, payroll, financing, fixed-asset, and opening-balance questions unresolved until evidence and approval support treatment.
- Use stable account purpose and type; do not create near-duplicate accounts to avoid resolving policy.
- Treat an exclusion from an unposted feed as a workflow decision, not a general-ledger entry.

The public sanitized chart of accounts is a design reference only. Live account type, currency, parent, activity, and system restrictions must be verified before proposing a change.

## Posting And Close Controls

Every posting workflow must define its transaction owner, evidence, duplicate search, accounting effect, approval, posting versus draft behavior, and readback. Journal entries require balanced debits and credits, an explicit business purpose, source evidence, period checks, and stronger review because they write directly to the general ledger.

Before period close:

- reconcile bank, credit-card, payment-clearing, accounts-receivable, accounts-payable, and other material control accounts;
- resolve or document outstanding deposits, credits, refunds, transfers, and duplicate candidates;
- verify invoice, payment, credit, and tax cutoffs;
- review unusual, manual, related-party, suspense, fixed-asset, liability, and equity activity;
- compare subledgers and authoritative reports to the general ledger; and
- record approval and then apply the approved period lock when appropriate.

Never unlock or rewrite a closed period, opening balance, reconciliation, tax setting, or published journal without an exact impact analysis and separately scoped approval.

## Repository Boundary

GitHub may contain sanitized accounting policies, account-purpose descriptions, automation code, synthetic examples, test matrices, and close/runbook structure. It must not contain balances, transactions, bank-feed rows, statements, invoices, receipts, tax records, payroll data, account or organization IDs, bank suffixes, reconciliations, journal evidence, OAuth material, or raw reports.

GitHub review does not authorize a Books entry, reconciliation, lock, tax decision, or close. Private evidence and approvals stay in the approved accounting or audit system.

## Failure And Readback

Fail closed on uncertain entity or business purpose, missing evidence, duplicate ambiguity, stale transaction state, unreconciled linked records, unknown currency or tax treatment, locked or reconciled periods, unexplained imbalance, authorization failure, incomplete response, or ambiguous write result.

After any approved change, read the exact transaction, account, status, totals, links, and audit trail through an independent read path. Re-run the relevant subledger, account, reconciliation, or financial report and compare the intended full accounting effect. Stop on the first mismatch; do not post a second entry to conceal it.

## Validation

Use synthetic or Development data and decision tables to cover:

- exact duplicate, near-duplicate, split, grouped, transfer, refund, credit, and reversal cases;
- cash and noncash evidence paths where applicable;
- missing, conflicting, and corrected source evidence;
- multi-currency, tax, rounding, date cutoff, and period-lock behavior where relevant;
- draft, posted, voided, reconciled, and deleted states;
- timeout before commit and timeout after possible commit;
- subledger and report reconciliation; and
- rollback or safe containment that preserves audit evidence.

Tests prove workflow behavior only; they do not approve an accounting or tax conclusion.

## Manual Setup

All live setup is currently **Unknown**. Before relying on this standard operationally, verify or configure:

- the legal entity, Books organization, data center, accounting method, fiscal year, base currency, and tax settings;
- the chart of accounts, opening balances, bank and payment-clearing accounts, and subledger ownership;
- accountant, bookkeeper, approver, audit, and automation roles with least privilege;
- invoice, payment, credit, expense, bill, journal, reconciliation, and close procedures;
- evidence retention, materiality, approval, exception, and escalation policies;
- report definitions, close calendar, period locks, and independent reconciliation; and
- qualified accounting or tax review for judgments outside routine approved policy.
