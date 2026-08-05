# Zoho Books

Zoho Books is Sylvara's accounting source of truth for the general ledger, account balances, invoices recorded in Books, payments recorded in Books, bank reconciliation, and financial reporting.

This directory contains only sanitized, reviewable technical references. It must never contain bank account numbers, balances, transactions, customer or vendor records, organization IDs, OAuth material, tax identifiers, or raw exports.

## Repository Boundary

- Live Zoho Books configuration outranks this repository.
- Files here are documentation and change-review inputs, not proof that a live configuration matches.
- Any financial automation must fail closed on ambiguous state, support idempotent retries, and require readback and reconciliation before it is considered complete.
- A merged pull request does not authorize or perform a Zoho Books deployment or accounting change.

Read the centralized [Zoho Books Automation Standard](../../docs/zoho/standards/books-automation.md) before designing an MCP tool, Deluge function, webhook, or integration that reads or changes Books. Product reference material is indexed in the [Zoho knowledge base](../../docs/zoho/README.md).

See [`reference/README.md`](reference/README.md) for the sanitized chart-of-accounts catalog. The current tax-preparer package consists of the [complete live-chart register](reference/final-chart-of-accounts-tax-preparer-2026-08-05.csv) and [tax-preparer handoff](reference/tax-preparer-handoff-2026-08-05.md); neither file is an import payload or live-state write instruction.
