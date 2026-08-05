# Sanitized Chart Of Accounts Reference

`chart-of-accounts.csv` is a public-safe reference derived from a Zoho Books chart-of-accounts export supplied on 2026-08-03.

The private source was `Chart_of_Accounts.xlsx` with SHA-256 `86554b639e91453aceab3553149f3d2a2041e21517e399c634fc5c268f1b3191`. The source workbook is intentionally not stored in GitHub. The conversion preserved 72 of 72 account rows after removing prohibited columns.

## Sanitization

The repository copy retains only:

- account name;
- account code;
- description;
- account type;
- account status;
- currency; and
- parent account name.

The conversion intentionally removed Zoho account IDs, bank-account suffixes, mileage configuration, workbook metadata, and every column not required to explain the accounting structure. The source workbook remains outside GitHub.

## Use

- Treat this as a reviewed reference, not an import file or live-state certification.
- Verify account names, codes, types, and hierarchy directly in the intended Zoho Books organization before proposing a change.
- Do not infer balances, transaction history, tax treatment, or posting behavior from this file.
- Accounting classifications require appropriate bookkeeping or tax review when the correct treatment is uncertain.

## Proposed Redesign

- [`proposed-chart-of-accounts.csv`](proposed-chart-of-accounts.csv) is the sanitized 111-row, trigger-based target account register proposed on 2026-08-05. It is not an import file and does not authorize a live change or imply that all conditional accounts should be created now.
- [`chart-of-accounts-audit-2026-08-05.md`](chart-of-accounts-audit-2026-08-05.md) records the audit conclusions, primary-source tax and accounting triggers, current-account disposition rules, deployment gates, and rollback/readback plan.
- [`chart-of-accounts-phase-1-change-plan-2026-08-05.md`](chart-of-accounts-phase-1-change-plan-2026-08-05.md) preserves the approved first live-write scope and immutable target hash, plus the verified execution, containment/rollback event, bounded cleanup, exclusions, and final independent readback.
- [`chart-of-accounts-post-deployment-posting-guide-2026-08-05.md`](chart-of-accounts-post-deployment-posting-guide-2026-08-05.md) defines conservative owner-equity, tax, substantiation, and conditional-account routing after deployment without asserting a deduction or election.

Authorized prestate on 2026-08-05 verified 72 active and zero inactive accounts in the bound live Sylvara Books organization. The approved chart-only deployment created 18 accounts, updated 34 existing accounts, and reversibly inactivated 11 custom accounts after the documented scoped activity and dependency checks. Final independent Audit reconciliation matched 79 active and 11 inactive accounts. Two Zoho-seeded, non-user-created defaults remained unchanged. Organization and account identifiers, balances, transactions, and raw responses remain private.

Keep the observed export, trigger-based proposal, and executed subset separate. The observed file records what was supplied on 2026-08-03; the proposal contains the complete design including deferred rows; the Phase 1 record identifies exactly what was implemented, skipped, inactivated, contained, reactivated, and independently verified.
