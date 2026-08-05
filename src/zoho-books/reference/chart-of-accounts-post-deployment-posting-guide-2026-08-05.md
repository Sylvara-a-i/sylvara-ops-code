# Sylvara Chart Of Accounts Post-Deployment Posting Guide

## Status

- Effective for chart governance: 2026-08-05
- Entity assumption: domestic disregarded single-member LLC unless an effective Form 2553 or Form 8832 is evidenced
- Scope: account-routing and evidence controls only
- Excluded: tax elections, return positions, journals, historical reclassifications, depreciation methods, software-capitalization methods, and tax-engine configuration

This guide clarifies how the deployed chart should be used. It does not make an expense deductible, establish U.S. GAAP compliance, replace source documentation, or authorize a posting. Fact-dependent treatments require a private workpaper and qualified review.

## Owner And Equity Routing

| Fact pattern | Account | Control |
|---|---|---|
| Owner pays a substantiated Sylvara business cost and repayment is intended | `2130 Due to Owner - Substantiated Business Costs` | Debit the approved natural expense or asset; retain receipt, business purpose, date, vendor, and allocation evidence. This is not an employee accountable-plan reimbursement. |
| Owner pays a substantiated Sylvara business cost and repayment is not intended | `3010 Owner Contributions` | Debit the approved natural expense or asset and credit owner capital. |
| Owner withdrawal or Sylvara payment of the owner's federal/Kansas estimated income or self-employment tax | `3020 Drawings` | Never post the disregarded owner's personal income or self-employment tax to wage, payroll-tax, `Advance Tax`, or business-tax expense. |
| Actual employee compensation or reimbursement | Zoho employee/payroll controls after payroll setup | `6310 Salaries and Employee Wages` is no-post until Sylvara has an actual employee and approved payroll workflow; never use it for the disregarded owner. |

The owner is self-employed rather than an employee of the disregarded entity. See [IRS single-member LLC guidance](https://www.irs.gov/businesses/small-businesses-self-employed/single-member-limited-liability-companies) and [IRS Publication 3402](https://www.irs.gov/pub/irs-pdf/p3402.pdf).

## Taxes, Licenses, And Compliance

`6700 Taxes and Licenses` is a no-post Schedule C parent for reporting structure. Use an approved natural child or control account:

| Tax or fee | Route |
|---|---|
| Owner federal or Kansas estimated income tax and self-employment tax | `3020 Drawings` |
| Customer-collected sales tax | Zoho system `Tax Payable`; never revenue |
| Self-assessed Kansas consumer use tax | Conditional `2210 Kansas Consumer Use Tax Payable`, only after the workflow is approved |
| Kansas entity filing fee, license, or registration | `6710 Licenses Registrations and Filing Fees` under `6700 Taxes and Licenses` |
| Actual tax imposed on Sylvara as an entity | Conditional approved child such as `6720 State and Local Business Taxes` |
| Sales or use tax paid on a purchase | Follow the underlying expense or asset when required; do not default to a generic tax expense |

Kansas telephone answering service remains highly likely taxable, including automated answering, under [K.S.A. 79-3603(t)](https://ksrevisor.gov/statutes/chapters/ch79/079_036_0003.html) and [KDOR EDU-65](https://www.ksrevenue.gov/pdf/edu65.pdf). The chart deployment did not configure tax registration, customer place-of-primary-use sourcing, bundled-service treatment, item mappings, rates, exemptions, returns, or invoice testing. Those controls must be completed before live Kansas invoicing.

## Meals, Gifts, Travel, Phone, And Internet

| Account | Required evidence and treatment |
|---|---|
| `6550 Business Meals - Tax Review` under `6540 Deductible Meals` | Record the full actual qualifying business-meal cost plus business purpose, attendees, date, location, and receipt. Apply the tax-year-specific deductible percentage in the tax workpaper; do not reduce the book posting to the expected tax deduction. |
| `6930 Business Gifts - Section 274 Review` | Record recipient, business relationship, business purpose, date, item, and cost; apply the current per-recipient tax limit in the tax workpaper. |
| `Charitable Contributions - Tax Review` if later approved | CPA-trigger-only. For default tax-basis treatment, owner charitable payments are generally owner-return items and ordinarily route to `Drawings`, not Schedule C. A genuine advertising sponsorship follows its economic facts. |
| `6500 Travel` and `6510 Business Lodging` | Require a business purpose, itinerary, dates, receipts, and allocation of any personal portion. The locked Zoho-seeded `Lodging` account is no-post for new activity. |
| `6451 Internet` under `6450 Utilities` | Post only supported business charges or a documented owner business-use allocation. Owner-paid amounts follow the `Due to Owner`/`Owner Contributions` routing above; employee reimbursements require a separate employee policy. |
| `6452 Phone` under `6450 Utilities` | Apply the same owner-versus-employee distinction and exclude unsupported personal use. The first residential line is not converted into a business expense by account coding. |
| `6453 Voice and Telephony Usage` under `6450 Utilities` | Use for substantiated carrier and voice-runtime charges. Preserve provider evidence and a consistent allocation for shared usage. |

See [26 U.S.C. 162](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title26-section162), [26 U.S.C. 262](https://uscode.house.gov/view.xhtml?req=%28title%3A26+section%3A262+edition%3Aprelim%29), and [26 U.S.C. 274](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title26-section274).

## Software, Research, Startup, And Fixed Assets

- Current AI usage, customer-delivery hosting, and customer software detail rolls up under Zoho system `Other Expenses` for Schedule C Part V. Current independent-contractor service, escalation, quality, and implementation labor rolls up under `6300 Contract Labor`. The locked `Cost of Goods Sold` root is no-post unless a later approved Part III or book COGS policy applies.
- Create `1600 Capitalized Software Development Costs` only after the ledger reporting basis and capitalization/amortization policy are approved. Only costs capitalized under that ledger basis post there; tax-only differences stay in private tax workpapers.
- Keep `1700 Deferred Startup and Pre-opening Costs` uncreated/no-post until the reporting basis, active-business date, source costs, and Section 195 method are approved.
- Domestic and foreign research/software-development capture accounts do not establish a Section 174/174A method or a federal/Kansas research credit. Maintain project, activity, worker, and location support outside the GL.
- Fixed-asset, depreciation, and amortization accounts remain trigger-only until ownership, placed-in-service date, cost basis, useful life, book method, and tax treatment are approved.

## Monthly Control

At month end, review all activity in `Drawings`, `Due to Owner`, `Owner Contributions`, `Business Meals - Tax Review`, `Business Gifts - Section 274 Review`, `Other Expenses`, and `Uncategorized`. Resolve personal amounts, missing evidence, mixed-use allocations, and conditional-account use before close. Chart structure improves capture; complete substantiation and correct tax workpapers are what support lawful deductions.
