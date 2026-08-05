# Sylvara Chart Of Accounts Phase 1 Change Plan

## Status

- Prepared: 2026-08-05
- Live status: **Executed and independently verified on 2026-08-05**
- Target: the single active live Sylvara Books organization verified through both Audit and Controller identity reads
- Verified prestate: 72 active accounts, zero inactive accounts, USD, January fiscal-year start, Zoho organization setting returned as Accrual, Admin role
- Final sanitized state: 79 active accounts and 11 inactive accounts
- Approved target register at execution: [`proposed-chart-of-accounts.csv`](proposed-chart-of-accounts.csv)
- Immutable approved target SHA-256: `fef217939293aef4ba59a4398da7a9365b81b619814ae964cfedd2acafac9ad9`

Organization and account identifiers, balances, transactions, bank details, and raw responses remain private. This plan identifies accounts by sanitized current name and target code only.

## Approved Accounting Assumptions Required

Phase 1 uses the default disregarded single-member LLC model represented by `Owner's Equity`, `Owner Contributions`, and `Drawings`. It does not authorize an S-corporation election, Kansas pass-through entity election, tax filing position, journal, or transaction reclassification.

Direct voice, AI, hosting, customer software, delivery contractors, human quality assurance, and implementation labor will be presented as cost of goods sold for internal gross-margin reporting. That presentation does not change total taxable profit. Existing merchant-processing accounts remain operating expenses until their history and presentation are separately reviewed.

The [`post-deployment posting guide`](chart-of-accounts-post-deployment-posting-guide-2026-08-05.md) governs the deployed owner, tax, meals, gifts, travel, phone/internet, and conditional-account routing. In particular, `6700 Taxes Licenses and Compliance` is a no-post parent; customer-collected tax routes to Zoho `Tax Payable`, owner income/self-employment taxes route to `Drawings`, and account coding alone does not establish deductibility.

## Verified Execution Result

The owner explicitly approved this Phase 1 plan, independent readback, rollback, and the remaining bounded chart-cleanup phases. Execution used the Controller for each serialized mutation and the separate Audit role for every readback.

- Created all 18 approved accounts.
- Updated 27 of the 29 named existing-account candidates and all seven description-only candidates, for 34 verified existing-account updates.
- `Furniture and Equipment` and `Lodging` remained unchanged after fresh full-chart prestate showed that both were Zoho-seeded, non-user-created defaults. Their target codes remain management references only.
- Inactivated 11 custom accounts after fresh scoped checks found no transaction involvement, nonzero balance, transaction-list rows, children, or item mappings. Broader rule, template, recurring-record, tax, report, workflow, and integration dependencies were not independently enumerated. No account was deleted.
- Completed a final full-chart reconciliation with zero active blank descriptions, zero blank codes on editable active custom accounts, and zero duplicate active/inactive names or nonblank codes.

The first create sequence exposed a schema difference: the single-account Audit response omitted the user-created flag that the complete chart response supplied. The operator stopped, inactivated all 14 accounts created in that attempt, and independently verified compensating containment. This reversed their active-state exposure but did not restore the exact 72-active/zero-inactive prestate because the 14 rows remained inactive. After reconciling mutability from the complete chart response, the same known-created accounts were reactivated and verified before execution continued. No existing account was changed during the stopped attempt, and final full-chart readback matched the approved after-state.

The public target register is the immutable approved execution fixture and must not be edited in place. Any later policy clarification belongs in a separately dated addendum or successor register so the hash and authorization evidence remain reproducible.

## Kansas Sales-Tax Go-Live Blocker

This chart deployment and its revenue-account renames did not register Sylvara for tax, configure the Zoho tax engine, determine customer sourcing, map item taxability, or authorize Kansas invoices. Telephone answering service remains highly likely taxable in Kansas, including automated service, under [K.S.A. 79-3603(t)](https://ksrevisor.gov/statutes/chapters/ch79/079_036_0003.html) and [KDOR EDU-65](https://www.ksrevenue.gov/pdf/edu65.pdf). Customer place of primary use drives sourcing. Tax registration, bundle treatment, item mapping, rates, exemptions, and invoice testing require a separate controlled workflow before live Kansas invoicing.

## Exact Create Scope — 18 Accounts

The exact name, code, account type, parent, and description are the matching rows in the frozen target register.

| Code | Account | Type | Parent |
|---|---|---|---|
| `2130` | Due to Owner - Substantiated Business Costs | Other Current Liability | — |
| `3010` | Owner Contributions | Equity | Owner's Equity |
| `5010` | Voice and Telephony Usage | Cost Of Goods Sold | Cost of Goods Sold |
| `5020` | AI Model and Automation Usage | Cost Of Goods Sold | Cost of Goods Sold |
| `5030` | Direct Hosting and Integration Costs | Cost Of Goods Sold | Cost of Goods Sold |
| `5040` | Direct Customer Software and Licenses | Cost Of Goods Sold | Cost of Goods Sold |
| `5050` | Direct Service Contractors | Cost Of Goods Sold | Cost of Goods Sold |
| `5060` | Human Escalation and Quality Assurance | Cost Of Goods Sold | Cost of Goods Sold |
| `5070` | Direct Implementation Labor | Cost Of Goods Sold | Cost of Goods Sold |
| `6030` | Sales Software and Prospect Data | Expense | Sales and Marketing |
| `6100` | Technology and Operations | Expense | — |
| `6120` | Internal Technology and Infrastructure | Expense | Technology and Operations |
| `6420` | Office Supplies | Expense | Occupancy and Office |
| `6500` | Travel | Expense | — |
| `6550` | Business Meals - Tax Review | Expense | Travel |
| `6600` | Business Insurance | Expense | — |
| `6700` | Taxes Licenses and Compliance | Expense | — |
| `6930` | Business Gifts - Section 274 Review | Expense | — |

Every create body is limited to `account_name`, `account_code`, `account_type`, `description`, and a verified `parent_account_id` when shown. No currency, custom-field, dashboard, Zoho Expense, or VAT field is included.

## Exact Existing-Account Update Scope — 29 Accounts

For target-coded rows, update only the target name, target code, target description, and the two explicitly identified reversible parent changes. Do not send `account_type`.

| Current account | Target code and name | Parent action |
|---|---|---|
| Business Checking | `1010 Business Checking` | Keep root |
| Business Savings | `1020 Business Savings` | Keep root |
| Stripe Clearing | `1050 Stripe Clearing` | Keep root |
| Zoho Payments Clearing | `1060 Zoho Payments Clearing` | Keep root |
| Prepaid Expenses | `1200 Prepaid Expenses` | Keep root |
| Furniture and Equipment | `1500 Property and Equipment` | Keep root |
| Subscriptions | `4100 Managed Reception Service Revenue` | Keep existing Sales parent |
| AI Receptionist Subscriptions | `4110 After-Hours Managed Reception Revenue` | Keep existing renamed revenue parent |
| AI Receptionist Add-Ons | `4120 Overflow Managed Reception Revenue` | Keep existing renamed revenue parent |
| One-Time Services | `4200 Implementation and Onboarding Revenue` | Keep existing Sales parent |
| AI Receptionist Setup / Onboarding | `4210 Setup and Launch Revenue` | Keep existing renamed revenue parent |
| Credit Union Dividend | `4510 Bank and Credit Union Interest` | Keep Interest Income parent |
| Advertising | `6000 Sales and Marketing` | Keep root |
| Online Advertising | `6010 Paid Advertising` | Keep existing renamed marketing parent |
| Photography / Videography | `6020 Content and Creative` | Keep existing renamed marketing parent |
| Promotions & Giveaways | `6040 Events Sponsorships and Promotions` | Keep existing renamed marketing parent |
| Software Subscriptions | `6110 General Software and SaaS` | Move from Other Expenses to Technology and Operations |
| Legal And Professional Fees | `6200 Professional Services` | Keep root |
| Accounting Fees | `6210 Accounting and Tax` | Keep existing renamed professional-services parent |
| Bookkeeping Services | `6220 Bookkeeping` | Keep existing renamed professional-services parent |
| Legal Fees | `6230 Legal` | Keep existing renamed professional-services parent |
| Consulting Fees | `6240 Business and Strategy Consulting` | Keep existing renamed professional-services parent |
| Education | `6380 Training and Education` | Keep current Other Expenses parent until a Personnel trigger exists |
| Utilities | `6400 Occupancy and Office` | Keep root |
| Internet | `6430 Internet` | Keep existing renamed occupancy parent |
| Phone | `6440 Phone` | Keep existing renamed occupancy parent |
| Lodging | `6520 Lodging` | Keep root because API rollback-to-root is undocumented |
| Licensing Fees | `6710 Licenses Registrations and Filing Fees` | Move from Professional Services to Taxes Licenses and Compliance |
| Gifts / Donations | `6990.03 Legacy Gifts / Donations - Review` | Keep Other Expenses parent; description: `Legacy mixed account for prior gifts or donations; do not use for new activity pending transaction review and inactivation.` |

The old parent identifier is captured privately before each of the two child-to-child parent changes. Root-to-child moves are excluded because the controller has no documented null-parent rollback.

Fresh preflight overrode two planned rows: `Furniture and Equipment` and `Lodging` were Zoho-seeded with `is_user_created=false`, so neither was mutated. The executed named-update count was therefore 27, not 29. `Software Subscriptions` and `Licensing Fees` were the only child-to-child parent changes, and both were independently read back.

## Description-Only Cleanup — 7 Accounts

Keep each current name, code, type, and parent. Set only the stated description.

| Account | Description |
|---|---|
| Electricity | Legacy dedicated-premises electricity category; do not use without a dedicated business location; pending dependency review. |
| Gas | Legacy dedicated-premises gas category; do not use without a dedicated business location; pending dependency review. |
| Trash And Recycling | Legacy dedicated-premises waste category; do not use without a dedicated business location; pending dependency review. |
| Wastewater | Legacy dedicated-premises wastewater category; do not use without a dedicated business location; pending dependency review. |
| Water Supply | Legacy dedicated-premises water category; do not use without a dedicated business location; pending dependency review. |
| Payment Processing Fees | Legacy operating-expense account for merchant processing charges; retain until direct-cost presentation and dependencies are reviewed. |
| Stripe Fees | Legacy Stripe processing-fee detail; retain until settlement reconciliation, presentation, and dependencies are reviewed. |

## Protected Zoho Accounts

Thirty-one accounts classified as default or system controls in the proposal remain active and unchanged. Fresh execution prestate also identified `Furniture and Equipment` and `Lodging` as Zoho-seeded, non-user-created defaults, so those two planned updates were skipped. Where Zoho locks a code field, the four-digit code in the target register is a management reference only. Creating coded duplicates would weaken the receivables, payables, tax, equity, inventory, revenue, wage, clearing, and close controls.

## Execution, Readback, And Rollback

The following approved control sequence was executed:

1. Reverify the active organization, Admin identity, 72 active/zero inactive prestate, and exact approved target SHA-256.
2. Preflight every target name and code across active and inactive accounts.
3. Use Controller `create_chart_of_account` for the first reversible acceptance write: `6100 Technology and Operations`.
4. Immediately read it independently through Audit and compare name, code, type, parent, description, active status, and system/user-created flags.
5. Continue serially: create parents, update existing parents, create children, then update/reparent existing children. Read back every write before the next one.
6. Stop on the first error, timeout, ambiguous response, duplicate, stale prestate, or readback mismatch. Never retry a create blindly.
7. Roll back completed updates in reverse order using captured prestate. Roll back newly created unused accounts by marking children inactive before parents, then independently verify each status. Delete is not authorized.
8. Finish with complete active/inactive chart reads and an exact sanitized comparison to this plan.

## Post-Phase-1 Cleanup — 11 Accounts

After Phase 1, the owner authorized the remaining bounded chart cleanup. Each account below was user-created, non-system, active, uninvolved in transactions, zero-balance, without transaction-list rows, without children, and without item mappings immediately before inactivation. Controller inactivated each account and Audit independently verified the inactive state.

Bank rules, templates, recurring records, tax/report configuration, workflows, and integrations were not independently enumerated in this chart-only phase. Successful inactivation and status readback do not prove those broader dependencies absent; any later dependency issue uses the documented reactivation rollback.

| Inactivated custom account |
|---|
| Purchase Adjustments |
| Employee Gym Memberships |
| Print Advertising |
| Signage |
| Cable / TV |
| Electricity |
| Gas |
| Trash And Recycling |
| Wastewater |
| Water Supply |
| Legacy Gifts / Donations - Review |

Rollback remains `mark_chart_of_account_active` followed by independent Audit readback. No delete operation was used or authorized.

## Explicitly Deferred From The Executed Work

- No existing account was deleted. Inactivation was limited to the 11 custom accounts that passed the documented scoped eligibility checks listed above.
- No transaction, balance, bank, clearing, item, template, rule, recurring record, tax mapping, or integration is changed.
- Payroll, employee-benefit, home-office, vehicle, fixed-asset, depreciation, amortization, startup, domestic/foreign R&E, customer-deposit, consumer-use-tax, charitable-contribution, club-dues, fines, lobbying, debt, and other trigger-only accounts are not created.
- Existing merchant-processing accounts are not converted to cost of goods sold.
- `Lodging` is not moved under `Travel` until rollback-to-root is proven.

Approval received on 2026-08-05 explicitly covered the Phase 1 creates and updates, automatic reverse rollback when required, independent Audit readback, and the remaining bounded chart-cleanup phases. It did not authorize any operation listed as deferred above.
