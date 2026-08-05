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

- [`proposed-chart-of-accounts.csv`](proposed-chart-of-accounts.csv) is the sanitized 111-row historical target used for the initial 2026-08-05 deployment. Its P&L names and parents are superseded by the Schedule C successor register below. It is not a current-state import file and does not imply that conditional accounts should be created.
- [`chart-of-accounts-audit-2026-08-05.md`](chart-of-accounts-audit-2026-08-05.md) records the audit conclusions, primary-source tax and accounting triggers, current-account disposition rules, deployment gates, and rollback/readback plan.
- [`chart-of-accounts-phase-1-change-plan-2026-08-05.md`](chart-of-accounts-phase-1-change-plan-2026-08-05.md) preserves the approved first live-write scope and immutable target hash, plus the verified execution, containment/rollback event, bounded cleanup, exclusions, and final independent readback.
- [`chart-of-accounts-post-deployment-posting-guide-2026-08-05.md`](chart-of-accounts-post-deployment-posting-guide-2026-08-05.md) defines conservative owner-equity, tax, substantiation, and conditional-account routing after deployment without asserting a deduction or election.
- [`schedule-c-tax-rollup-2026-08-05.csv`](schedule-c-tax-rollup-2026-08-05.csv) is the immutable public-safe P&L input used for the completed Schedule C hierarchy amendment. It preserves the exact approved deployment hash and is retained as execution history; the complete final register below supersedes it for current tax-preparer metadata and exact live naming.
- [`chart-of-accounts-schedule-c-change-plan-2026-08-05.md`](chart-of-accounts-schedule-c-change-plan-2026-08-05.md) records the sanitized internal structural comparison, current IRS form review, exact bounded chart amendment, rollback, and independent readback controls. It supersedes the earlier operational-root design only for future P&L hierarchy; it does not rewrite the completed deployment record.
- [`final-chart-of-accounts-tax-preparer-2026-08-05.csv`](final-chart-of-accounts-tax-preparer-2026-08-05.csv) is the complete sanitized 83-active/11-inactive live-chart register independently read back on 2026-08-05. It separates actual Zoho codes from documentation-only management references for locked blank-code accounts and distinguishes exact live descriptions from governed posting descriptions.
- [`tax-preparer-handoff-2026-08-05.md`](tax-preparer-handoff-2026-08-05.md) gives the every-line Schedule C crosswalk, Kansas and Overland Park review, AI/telephony/hosting-versus-COGS conclusion, conditional account catalog, tax-opportunity evidence matrix, and H&R Block/qualified-preparer export package.

The final re-audit made no structural chart change. It updated five custom-account descriptions only—owner reimbursement, source-specific bank interest, carrier telecommunications, meals parent, and meals detail—and independently read back all 83 active accounts with all five descriptions matching. The prior descriptions remain the documented rollback input; no name, code, type, parent, status, balance, transaction, tax setting, or organization setting changed.

The successor amendment was executed through the bounded Books Controller and independently read back through Books Audit. It added four accounts and updated 18 existing accounts without changing any system account or inactivating or deleting anything. Final private reconciliation matched 83 active and 11 inactive accounts; identifiers and financial state remain outside GitHub.

Authorized prestate on 2026-08-05 verified 72 active and zero inactive accounts in the bound live Sylvara Books organization. The approved chart-only deployment created 18 accounts, updated 34 existing accounts, and reversibly inactivated 11 custom accounts after the documented scoped activity and dependency checks. Final independent Audit reconciliation matched 79 active and 11 inactive accounts. Two Zoho-seeded, non-user-created defaults remained unchanged. Organization and account identifiers, balances, transactions, and raw responses remain private.

Keep the observed export, historical trigger-based proposal, immutable Schedule C deployment input, final readback register, and executed subsets separate. The observed file records what was supplied on 2026-08-03; the initial proposal preserves the original complete design including deferred rows; the Schedule C register preserves the approved deployment input; the final register controls current tax-preparer metadata; and the two execution records identify exactly what was implemented, skipped, inactivated, contained, corrected, and independently verified.

The final tax-preparer register is a dated, public-safe readback of chart metadata only. A management reference is not a hidden live Zoho code, and the register contains no account IDs, balances, transactions, tax-return facts, or customer/vendor data. The handoff's conditional accounts are deliberately uncreated until their stated facts and approval gates exist.
