# Sylvara Chart Of Accounts Audit

## Status

| Item | Status |
|---|---|
| Audit date | 2026-08-05 |
| Repository and official-source review | Reviewed |
| Live Zoho Books inspection | Scoped read/write deployment completed; sanitized findings only |
| Entity and operating location | Single-member LLC; Overland Park, Johnson County, Kansas |
| Target chart | 111-row trigger-based design; bounded active subset deployed |
| Accounting and tax policy approval | Owner-approved scoped chart presentation only; no professional tax, GAAP, election, or filing conclusion; fact-dependent policies remain unresolved |
| Live deployment | Initial deployment plus Schedule C successor amendment completed 2026-08-05; current sanitized state is 83 active and 11 inactive accounts with independent Audit reconciliation |

This document is a sanitized audit and deployment record. It is not legal or tax advice, a U.S. GAAP assertion, a tax election, an import file, or continuing authorization to change the live ledger. Organization and account identifiers, balances, transactions, bank details, tax identifiers, and raw responses are intentionally excluded.

The initial operational-root design and execution record below remain historical evidence. The later owner-requested P&L hierarchy is controlled by the [`Schedule C successor register`](schedule-c-tax-rollup-2026-08-05.csv) and [`exact amendment record`](chart-of-accounts-schedule-c-change-plan-2026-08-05.md). Those artifacts supersede the earlier P&L parent recommendations without changing the balance-sheet design or rewriting the first deployment result.

## Outcome

A redesign was warranted. The original chart contained useful Zoho control accounts, but it also contained uncoded system accounts, product-language assumptions, excess template categories, broad catch-alls, mixed tax categories, and no useful cost-of-service hierarchy. The trigger-based register and deployed subset:

- retains protected Zoho control accounts and gives each a management reference code, even when Zoho may not permit that code to be written to a locked field;
- separates direct managed-service costs from operating overhead so contribution margin can be reviewed;
- aligns revenue labels with the approved after-hours and overflow managed-reception direction;
- separates categories with materially different substantiation or tax treatment;
- tracks domestic and foreign software-development and research costs without claiming a deduction or credit;
- uses a noncorporate owner-equity model unless a federal corporate election is evidenced, while keeping payroll, income tax, software capitalization, credit losses, and other fact-dependent matters conditional; and
- prefers inactivation over deletion after scoped activity and dependency checks, while preserving the broader reconciliation deferral.

The detailed trigger-based target register is [`proposed-chart-of-accounts.csv`](proposed-chart-of-accounts.csv). Conditional rows remain design controls rather than claims that every account exists live. The conservative routing rules for the deployed subset are in the [`post-deployment posting guide`](chart-of-accounts-post-deployment-posting-guide-2026-08-05.md).

## Confirmed Entity And Scope

- Sylvara is a single-member LLC operating from Overland Park in Johnson County, Kansas.
- The [IRS single-member LLC guidance](https://www.irs.gov/businesses/small-businesses-self-employed/single-member-limited-liability-companies) treats a domestic single-member LLC as disregarded for federal income-tax purposes unless it elects corporate treatment. The proposed equity accounts use that default model, but evidence of any effective Form 2553 or Form 8832 election overrides the assumption.
- This phase covers chart design and bounded chart configuration only. Bank, clearing, and transaction reconciliation is deferred at the owner's direction. That deferral does not permit an account with history or an unresolved dependency to be inactivated.
- Customer tax sourcing still depends on each customer's place of primary use. Sylvara's Overland Park location does not establish the rate for every customer or eliminate other-state nexus review.

## Evidence Reviewed

The local checkout was compared with the current `main` revision on GitHub before this proposal was prepared. The following repository standards govern the result:

- [Accounting Knowledge Base](../../../docs/accounting/README.md)
- [Accounting Authority And Research Standard](../../../docs/accounting/authority-and-research.md)
- [Federal Tax Reference](../../../docs/accounting/federal-tax-reference.md)
- [U.S. GAAP Topic Reference](../../../docs/accounting/us-gaap-reference.md)
- [Zoho Accounting Practices Standard](../../../docs/zoho/standards/accounting.md)
- [Zoho Books Automation Standard](../../../docs/zoho/standards/books-automation.md)

The public 2026-08-03 snapshot contains 72 active account rows. Fresh private prestate verified 72 active and zero inactive accounts in the intended organization, plus the current user role, base currency, fiscal-year start, Zoho accounting-basis setting, complete account list, system-account flags where returned, hierarchy, bank and clearing dependencies, and item count. After the authorized deployment, a complete private readback verified 79 active and 11 inactive accounts. Private financial state was not copied here.

## Live Execution Result

The owner approved the exact Phase 1 plan, rollback, independent readback, and remaining bounded chart-cleanup phases. The deployment produced this sanitized result:

| Control | Verified result |
|---|---|
| Created accounts | 18 active; exact name, code, type, parent, description, status, and mutability read back where returned |
| Existing accounts updated | 34 total: 27 named updates and seven description-only updates |
| Protected seeded exceptions | `Furniture and Equipment` and `Lodging` remained unchanged because fresh full-chart prestate showed `is_user_created=false` |
| Custom accounts inactivated | 11; each passed fresh activity, balance, transaction-list, child, and item-mapping checks |
| Deletions | None |
| Final chart | 79 active and 11 inactive accounts |
| Structural reconciliation | No active blank descriptions, no blank codes on editable active custom accounts, and no duplicate active/inactive names or nonblank codes |

The first create sequence stopped when a single-account Audit response omitted a mutability flag available in the complete chart response. Fourteen known-created accounts were inactivated and independently verified as contained. That reversed their active-state exposure but did not restore the exact 72-active/zero-inactive prestate because the 14 rows remained inactive. After the full-list schema was reconciled, those exact accounts were safely reactivated and read back before the serialized deployment resumed. No existing account was changed during the stopped attempt, and the final full-chart comparison matched the approved after-state.

No journal, transaction, balance, bank, clearing, item, template, rule, recurring record, tax mapping, or integration was changed. Inactivation was reversible and no delete tool was used.

The failed-closed attempt and successful completion are also preserved as separate append-only entries in the public-safe [`deployment log`](../../../docs/runbooks/deployment-log.md).

## Primary-Source Findings That Shape The Chart

Sources were verified on 2026-08-05. Applicability still depends on Sylvara's actual entity, contracts, customer locations, tax year, and approved policies.

### Kansas sales and use tax

The highest-priority issue is Kansas sales tax. [K.S.A. 79-3603(t)](https://ksrevisor.gov/statutes/chapters/ch79/079_036_0003.html) taxes gross receipts from telephone answering services. [KDOR EDU-65](https://www.ksrevenue.gov/pdf/edu65.pdf) states that the service is taxable when performed by human operators or automated machines. Sylvara's managed inbound receptionist offering is therefore highly likely to fall within the taxable category for Kansas-sourced customers.

- Collected sales tax belongs in the Zoho tax liability control, not revenue. See [KDOR Publication KS-1510](https://www.ksrevenue.gov/pub1510.html/index.html).
- Non-call-by-call telecommunications are generally sourced to the customer's place of primary use under [K.S.A. 79-3673](https://ksrevisor.gov/statutes/chapters/ch79/079_036_0073.html).
- Bundled taxable and nontaxable components can make the full charge taxable unless a supportable allocation applies under [K.S.A. 79-3686](https://ksrevisor.gov/statutes/chapters/ch79/079_036_0086.html).
- Local rates must come from the current [KDOR address tax-rate locator](https://www.ksrevenue.gov/atrl.html), never from a permanent GL code or description.
- The actual bundle may include answering, routing, scheduling, implementation, software, and reporting. Obtain a KDOR opinion or private letter ruling under [K.S.A. 79-3646](https://ksrevisor.gov/statutes/chapters/ch79/079_036_0046.html) before live Kansas invoicing rather than assuming that invoice-line separation changes taxability.

Zoho's system `Tax Payable` account should be retained. Tax authorities, rates, customer place of primary use, taxable items, exemptions, and returns belong in the tax engine and private tax workpapers, not in proliferating revenue accounts.

### Federal and Kansas income-tax controls

The chart improves evidence capture; account names do not create deductions.

- Ordinary and necessary business expenses require facts and substantiation under [26 U.S.C. 162](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title26-section162). Personal expenses remain nondeductible under [26 U.S.C. 262](https://uscode.house.gov/view.xhtml?req=%28title%3A26+section%3A262+edition%3Aprelim%29).
- Meals, travel, gifts, entertainment, and listed property require separate evidence under [26 U.S.C. 274](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title26-section274). The proposed chart therefore separates meals, gifts, entertainment, and vehicle and mileage costs.
- The disregarded owner is self-employed rather than Sylvara's employee. Owner withdrawals and personal estimated income or self-employment taxes belong in `Drawings`, not payroll, wage expense, `Advance Tax`, or employee-reimbursement accounts. See the [IRS single-member LLC guidance](https://www.irs.gov/businesses/small-businesses-self-employed/single-member-limited-liability-companies) and [Publication 3402](https://www.irs.gov/pub/irs-pdf/p3402.pdf).
- A written accountable plan must satisfy business-connection, substantiation, and return-of-excess rules under [26 CFR 1.62-2](https://www.ecfr.gov/current/title-26/chapter-I/subchapter-A/part-1/subject-group-ECFR064ad1fa7d3cb20/section-1.62-2). That employee rule is not the basis for reimbursing the disregarded owner. Substantiated owner-paid business costs instead post to their natural expense or asset account against `Due to Owner` when repayment is intended or `Owner Contributions` when it is not.
- A qualifying owner home office requires exclusive and regular business use and a private allocation workpaper under [26 U.S.C. 280A](https://uscode.house.gov/view.xhtml?edition=prelim&f=treesort&fq=true&granuleId=USC-prelim-title26-section280A&hl=true&num=7&req=26+U.S.+Code+280A) and the [Form 8829 instructions](https://www.irs.gov/instructions/i8829). Do not post general household utilities as business expenses.
- Startup expenditures require separate active-business-date and method review under [26 U.S.C. 195](https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title26-section195).
- For tax years beginning after 2024, domestic research and software-development expenditures are generally addressed under Section 174A, while foreign research remains subject to the separate Section 174 treatment. [IRS Revenue Procedure 2025-28](https://www.irs.gov/pub/irs-drop/rp-25-28.pdf) supplies current transition procedures. The chart separates domestic and foreign costs but does not assert qualification, timing, or an election.
- Federal research-credit qualification requires business-component and activity evidence under the [Form 6765 instructions](https://www.irs.gov/instructions/i6765). Kansas has a separate potential research credit under [K.S.A. 79-32,182b](https://ksrevisor.gov/statutes/chapters/ch79/079_032_0182b.html) and [Schedule K-53](https://www.ksrevenue.gov/pdf/k-53.pdf). Projects, time records, work location, and cost detail are required in addition to GL accounts.
- Sylvara's confirmed single-member LLC form does not by itself support a Kansas pass-through entity election. If an effective S-corporation election exists, annual Kansas PTE treatment may warrant professional modeling under [K.S.A. 79-32,286](https://ksrevisor.gov/statutes/chapters/ch79/079_032_0286.html) through [79-32,288](https://ksrevisor.gov/statutes/chapters/ch79/079_032_0288.html) and [IRS Notice 2020-75](https://www.irs.gov/pub/irs-drop/n-20-75.pdf). Related accounts remain conditional until the federal classification and Kansas election are evidenced.
- Depreciation and Kansas expensing choices belong in a private asset and tax register. Current federal guidance includes [IRS Notice 2026-11](https://www.irs.gov/newsroom/treasury-irs-issue-guidance-on-the-additional-first-year-depreciation-deduction-amended-as-part-of-the-one-big-beautiful-bill); the separate Kansas election is in [K.S.A. 79-32,143a](https://ksrevisor.gov/statutes/chapters/ch79/079_032_0143a.html). The same investment may interact with credits, so alternatives must be modeled before filing.
- Section 199A, when applicable, is an owner-return deduction rather than a ledger expense. See [26 U.S.C. 199A](https://uscode.house.gov/view.xhtml?req=%28title%3A26+section%3A199a+edition%3Aprelim%29).
- Overland Park's general business-and-occupations tax chapter is repealed, so no generic city income or occupation-tax account is proposed. Specialized licenses, permits, and home-occupation rules remain fact-specific under the [current municipal code](https://codes.opkansas.org/municipal-code/doc-view.aspx). Johnson County separately requires business personal-property reporting when applicable; see the [County Appraiser guidance](https://www.jocogov.org/department/appraiser/property-information/personal-property).

### U.S. GAAP readiness

Sylvara's reporting basis is not yet approved, so this proposal does not assert U.S. GAAP compliance. Conditional accounts make the chart capable of supporting later professional conclusions for:

- customer contracts, deferred revenue, contract assets, credits, and contract costs under [ASC 606](https://asc.fasb.org/606/) and [ASC 340](https://asc.fasb.org/340/);
- expected credit losses under [ASC 326](https://asc.fasb.org/326/);
- research, internal-use software, and software offered externally under [ASC 730](https://asc.fasb.org/730/), [ASC 350](https://asc.fasb.org/350/), and [ASC 985](https://asc.fasb.org/985/); and
- related-party balances under [ASC 850](https://asc.fasb.org/850/).

[FASB ASU 2025-06](https://asc.fasb.org/layoutComponents/getPdf?fileName=ASU+2025-06.pdf&isSitesBucket=true) changes internal-use software guidance for annual periods beginning after December 15, 2027, with early adoption permitted. Sylvara must document whether and when it adopts that guidance before capitalizing software costs under a U.S. GAAP reporting basis.

Customers, states, tax jurisdictions, service variants, R&D business components, and departments should generally use Zoho items, projects, tags, tax authorities, and private workpapers rather than one GL account per dimension.

## Current-Account Disposition

### Retain protected Zoho controls

Retain and reuse, when applicable: `Accounts Receivable`, `Accounts Payable`, `Undeposited Funds`, `Tax Payable`, `Unearned Revenue`, `Sales`, `Sales Discounts`, `Interest Income`, `Bad Debt`, `Bank Fees and Charges`, `Exchange Gain or Loss`, `Retained Earnings`, `Opening Balance Offset`, and `Opening Balance Adjustments`.

Protected system accounts that are not applicable should remain no-post accounts because Zoho does not allow default/system accounts to be deleted or marked inactive. Their target codes in the proposed register are management references; apply them in Zoho only if the exact field is editable.

### Rename, recode, or reparent disposition

| Current account | Proposed use |
|---|---|
| `Subscriptions` | `Managed Reception Service Revenue` |
| `AI Receptionist Subscriptions` | `After-Hours Managed Reception Revenue` |
| `AI Receptionist Add-Ons` | `Overflow Managed Reception Revenue`; do not preserve unapproved line/user/number packaging |
| `One-Time Services` | `Implementation and Onboarding Revenue` |
| `AI Receptionist Setup / Onboarding` | `Setup and Launch Revenue` |
| `Advertising` | `Sales and Marketing` |
| `Online Advertising` | `Paid Advertising` |
| `Photography / Videography` | `Content and Creative` |
| `Legal And Professional Fees` | `Professional Services` |
| `Accounting Fees` | `Accounting and Tax` |
| `Consulting Fees` | `Business and Strategy Consulting` |
| `Licensing Fees` | Move to `Taxes, Licenses and Compliance` |
| `Utilities` | `Occupancy and Office`; only dedicated business-premises costs belong here |
| `Software Subscriptions` | `General Software and SaaS`; direct customer-delivery tools belong in cost of revenue |
| `Education` | `Training and Education` |
| `Lodging` | Unchanged: fresh prestate identified a Zoho-seeded, non-user-created default, and rollback-to-root is undocumented |
| `Furniture and Equipment` | Unchanged: fresh prestate identified a Zoho-seeded, non-user-created default; target code remains a management reference |
| `Credit Union Dividend` | `Bank and Credit Union Interest` |

### Split or replace

- Replace the current operating-expense `Payment Processing Fees` and `Stripe Fees` with cost-of-revenue accounts only if the approved presentation treats merchant fees as direct costs. Do not try to change an account type in place when Zoho or history prevents it.
- Separate `Business Gifts - Section 274 Review` from the retired mixed `Gifts / Donations` account. `Charitable Contributions - Tax Review` remains CPA-trigger-only; under the default disregarded-owner tax-basis treatment, charitable payments are generally owner-return items and ordinarily route to `Drawings`, not Schedule C.
- Split direct voice, AI/model, hosting, customer software, contractors, and human exception coverage from general software and overhead.
- Track domestic and foreign software-development/research costs separately, with project and location evidence outside the account name.
- Use vendor credits or the underlying expense/asset account instead of a generic `Purchase Adjustments` bucket.

### Inactivated only after dependency review

The final cleanup inactivated only the 11 custom accounts named in the Phase 1 execution record. Fresh prestate for every candidate confirmed user-created/non-system status, no transaction involvement, zero balance, no transaction-list rows, no children, and no item mappings. Bank and payment-clearing accounts remained active because reconciliation was deferred. Broader rule, template, recurring-record, tax, report, workflow, and integration changes were not authorized.

Do not delete existing accounts. Delete has no true rollback and should be reserved for a newly created custom account made in error and proven unused.

## Blocking Facts And Decisions

The following unresolved facts and professional decisions remain before any related conditional account, posting policy, tax setting, or filing position is activated:

1. Evidence of whether Sylvara has an effective Form 2553 or Form 8832 election, plus its tax year and active-business start date. Without election evidence, the proposal uses the default disregarded single-member LLC model.
2. The approved book basis and whether any financial statements must comply with U.S. GAAP.
3. The exact operating address, each customer's place of primary use, and Kansas, Missouri, and other-state registrations or nexus. Overland Park and Johnson County are confirmed, but no permanent local rate belongs in the ledger.
4. Actual contracts, invoice bundles, performance obligations, refund terms, and whether any software or integration is sold separately.
5. Actual employees, contractors, foreign development, payroll provider, accountable plan, benefits, and retirement plan. The default disregarded owner is not an employee.
6. Prior research expenditures, assets, leases, debt, related-party balances, tax elections, and credit carryforwards.
7. Bank and clearing reconciliation is deferred from this design phase. It must be completed with uncategorized activity resolved before changing any account with history or a bank, processor, or clearing dependency. The 11 inactivated custom accounts had no transaction history or identified dependency in the scoped checks.
8. Qualified CPA review of equity, owner compensation, revenue, software/research costs, capitalization, depreciation, Kansas sales tax, Kansas PTE tax, payroll, and income-tax accounts.

## Deployment Record

The exact bounded first-write scope and its verified result are recorded in [`chart-of-accounts-phase-1-change-plan-2026-08-05.md`](chart-of-accounts-phase-1-change-plan-2026-08-05.md). The executed work excluded deletion, transaction, balance, bank, clearing, tax-engine, and integration changes. A later bounded cleanup inactivated only the 11 custom accounts that passed the documented scoped eligibility checks listed in that record.

### Authorized read and controller path used

Use only the Sylvara Books Audit role:

1. `list_organizations({})` and privately select the exact active organization.
2. `get_organization({ path_variables: { organization_id } })`.
3. `get_current_user({ query_params: { organization_id } })`.
4. Paginate `list_chart_of_accounts` for active and inactive accounts. Prestate returned 72 active and zero inactive; final readback returned 79 active and 11 inactive in the bound live organization.
5. Read each mutation candidate with `get_chart_of_account` and inspect its transactions and dependencies.
6. Independently reconcile the complete active/inactive chart after mutation. General-ledger reports, A/R, A/P, bank and processor clearing, sales-tax configuration, and retained-earnings reconciliation remain deferred because this request was chart-only.

### Verified scoped mutation path

The Sylvara Books Controller now advertises and supplies typed wrappers for:

- `create_chart_of_account`;
- `update_chart_of_account` using an explicit `parent_account_id` contract;
- `mark_chart_of_account_inactive`; and
- `mark_chart_of_account_active` for rollback.

The controller connection, same-organization Admin identity, create, update, mark-inactive, and mark-active operations all succeeded within this scoped chart deployment on 2026-08-05. Every mutation was independently read through Audit. This proves only the bounded contracts and tenant access exercised here; it is not blanket authorization for other Books writes. Bulk operations and delete remain disconnected. Create calls used only `account_name`, `account_code`, `account_type`, `description`, and a verified `parent_account_id`; updates sent only approved mutable fields and never changed `account_type`.

The controller does not accept a documented null value for removing a parent. An existing root account must not be reparented through this path because rollback-to-root is unproven. Existing child-to-child reparenting is allowed only after capturing the prior parent identifier for rollback. Do not substitute Browser, direct REST, shell automation, another tenant, or another connector.

### Mutation sequence

1. Freeze the approved CSV revision and private current-to-target crosswalk.
2. Reread the exact organization, current user, account, period, balance, transaction involvement, children, and dependencies immediately before each change.
3. Create required parent accounts first and independently read each back.
4. Create new child accounts and read each back.
5. Rename, recode, or reversibly reparent one existing custom account at a time; read back the full account after every write. Keep current root accounts such as `Lodging` at root until parent removal is acceptance-tested.
6. Update items, templates, bank rules, recurring records, tax mappings, reports, and integrations through separately approved workflows.
7. Inactivate obsolete custom accounts last. Do not delete historical accounts.
8. Finish the executed chart-only scope with the complete active/inactive chart reconciliation. General-ledger, trial-balance, financial-statement, A/R, A/P, bank/processor, sales-tax, and retained-earnings reconciliation requires a separately approved transaction-and-close workflow.

### Rollback

- Reactivate an inactivated custom account with the captured prestate.
- Reverse an approved name, code, description, or child-to-child parent change using the captured before values, subject to fresh dependency and transaction checks. Do not perform a root-to-child move while rollback-to-root is undocumented.
- Delete a newly created account only when it remains unused and a separately approved break-glass delete is available; otherwise inactivate it.
- A deleted historical account cannot be restored with its original identity or relationships. No existing account is approved for deletion by this proposal.

## Approval Boundary

The owner explicitly authorized the chart deployment recorded here. This record does not authorize a Zoho change beyond that completed scope. The approval did not authorize tax registration, a customer invoice, tax election, return position, journal, transaction reclassification, account merge, or deletion. Any future live write must still bind its exact private target, immutable input, fresh per-account prestate and expected after-state, authorized controller operation, rollback, and independent readback plan.
