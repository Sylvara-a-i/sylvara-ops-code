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
