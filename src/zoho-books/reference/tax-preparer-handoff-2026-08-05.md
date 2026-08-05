# Sylvara Tax-Preparer Handoff And Lawful Tax-Opportunity Review

## Status

- Research and live-chart verification date: **2026-08-05**
- Entity assumption: individual-owned domestic single-member LLC, disregarded for federal income tax unless an effective election proves otherwise
- Location assumption: Overland Park, Johnson County, Kansas
- Current filing map: final 2025 Schedule C; the available 2026 Schedule C is draft and not filing authority
- Sanitized live-metadata fingerprint: `4217410201cd1101e09b5e4249cb1e237a99c564fa63cf0cbb3dc2afc38e9fb3`
- Scope: sanitized chart structure, return crosswalk, evidence controls, questions for a qualified preparer, and the bounded live-description correction recorded below
- Excluded: return preparation, legal advice, a tax election, a guaranteed deduction or credit, transaction review, journal entries, sales-tax registration, and changes to account names, codes, types, parents, statuses, balances, or transactions

The independent readback found **83 active and 11 inactive** Zoho Books accounts. The live chart is structurally sound for the known managed-service business. Schedule C is a profit-and-loss tax form, not a chart-of-accounts standard and not a balance sheet. Assets, liabilities, clearing accounts, and owner equity therefore remain conventional balance-sheet accounts and are supplied to the preparer through the trial balance and supporting schedules.

The business fact pattern was cross-checked against Sylvara's current [product direction](../../../docs/product/README.md): a managed inbound receptionist/front-office service, beginning with after-hours and overflow conversion—not resale of model minutes, generic software access, or physical merchandise.

### Bounded live-description correction

Under the standing chart authorization, the Sylvara Books Controller changed only the descriptions of `2130 Due to Owner - Substantiated Business Costs`, `4510 Bank and Credit Union Interest`, `6453 Voice and Telephony Usage`, `6540 Deductible Meals`, and `6550 Business Meals - Tax Review`. The old descriptions were preserved as rollback input. An independent Sylvara Books Audit read returned all 83 active accounts and matched all five proposed descriptions. No other field or record was authorized or changed.

The exact sanitized live register is [`final-chart-of-accounts-tax-preparer-2026-08-05.csv`](final-chart-of-accounts-tax-preparer-2026-08-05.csv). The narrower [`schedule-c-tax-rollup-2026-08-05.csv`](schedule-c-tax-rollup-2026-08-05.csv) is preserved as the immutable deployment input; the final register and this handoff supersede it for current descriptions, source-specific interest treatment, telecommunications scope, and exact live `Cost Of Goods Sold` capitalization.

## Final Classification Decision: Customer Usage Is Expense, Not Tax COGS

Sylvara currently sells a managed AI receptionist and front-office service. It does not sell merchandise or maintain inventory as an income-producing factor. Under the current facts:

| Cost | Live account | Federal tax presentation | Management presentation |
|---|---|---|---|
| AI inference, transcription, automation, and AI voice-agent runtime | `6990.10 AI Model and Automation Usage` | Schedule C Part V other expense | Direct Service Delivery Costs |
| Customer-delivery hosting and integrations | `6990.11 Direct Hosting and Integration Costs` | Schedule C Part V other expense | Direct Service Delivery Costs |
| Customer-specific third-party software and licenses | `6990.12 Direct Customer Software and Licenses` | Schedule C Part V other expense | Direct Service Delivery Costs |
| Carrier, PSTN/SIP, phone numbers, call routing, and telecommunications transport | `6453 Voice and Telephony Usage` | Schedule C line 25 utilities | Direct Service Delivery Costs |
| Independent delivery, escalation, quality, and implementation workers | `6301` through `6303` under `6300 Contract Labor` | Schedule C line 11 contract labor | Direct Service Delivery Costs |

Customer overage billing changes revenue quantity; it does not turn these costs into inventory. Keep Zoho's locked `Cost Of Goods Sold` account no-post under the present service model. A custom Zoho report may subtotal the rows above as cost of service for margin analysis without reclassifying them as Schedule C COGS. Reopen the COGS conclusion only if Sylvara later sells physical equipment or merchandise, maintains inventory, or adopts a separately approved book-cost policy supported by new facts.

Putting the same deductible service cost on Schedule C line 4 instead of line 25, line 11, or Part V does not create a larger deduction. The current routing is designed for accurate substance, auditability, and easy preparation—not cosmetic tax reduction.

Split bundled provider invoices only when reliable evidence supports the allocation. If carrier transport and AI runtime cannot be separated, apply a documented method consistently; the conservative default is the named AI/model expense rather than inventing a utility allocation.

## 2025 Schedule C Crosswalk

| Schedule C destination | Current state | Sylvara routing or preparer action |
|---|---|---|
| Line 1, gross receipts or sales | Active | `Sales` children for managed reception and implementation. Reconcile invoices, deposits, clearing accounts, Forms 1099-K/1099-NEC, refunds, and collected sales tax on the approved accounting method. |
| Line 2, returns and allowances | Active system control | `Sales Discounts`; require linkage to the originating customer document. |
| Line 4 and Part III, cost of goods sold | Locked exception; no-post | `Cost Of Goods Sold` and `Inventory Asset` remain unused unless a merchandise or inventory fact pattern is approved. |
| Line 6, other income | Source-specific | Late fees and other business income may map here. Operating-checking interest may be line 6; savings, certificate, or other deposit interest may instead require Schedule B/return-level review. |
| Line 8, advertising | Active | `Advertising` children. Separate gifts, charity, entertainment, capital assets, and political activity. |
| Line 9, car and truck | Workpaper-only until triggered | Do not place local vehicle costs under `Travel`. Use a contemporaneous mileage/actual-cost workpaper and create `6530 Car and Truck Expenses - Tax Review` only when business vehicle activity exists. |
| Line 10, commissions and fees | Preparer decision | Current payment-processing accounts are named Part V expenses. Line 10 is an available presentation; changing lines does not change the deduction. Reparent only after settlement and preparer review. |
| Line 11, contract labor | Active | `6300 Contract Labor` children; worker classification, W-9, payment-method, and information-return controls apply. |
| Line 12, depletion | Not applicable on known facts | No account. Create only if a qualifying natural-resource fact pattern arises. |
| Line 13, depreciation and section 179 | Asset workpaper-only | Use `Furniture and Equipment` and the private fixed-asset register. Create depreciation/amortization accounts only after the book and tax methods are approved. |
| Line 14, employee benefit programs | Conditional | No current employees are evidenced. Create only after payroll and employee-benefit facts exist; never use for owner health insurance. |
| Line 15, insurance other than health | Active | `Insurance (Other Than Health)`; separate owner health and multi-period prepaids. |
| Lines 16a and 16b, business interest | Conditional/workpaper | Keep principal off expense and trace debt proceeds to business use. Create dedicated interest detail when borrowing exists. Vehicle-interest presentation must be reverified against the final form for the filing year. |
| Line 17, legal and professional services | Active | `Legal and Professional Services` children; treatment follows the underlying matter. |
| Line 18, office expense | Active | `Office Expense` and `Office Supplies`; longer-lived property goes to the asset register. |
| Line 19, pension and profit-sharing | Conditional | Schedule C is for qualifying employee-plan contributions. Owner retirement generally belongs on Schedule 1, not in a Sylvara expense account. |
| Lines 20a and 20b, rent or lease | Conditional | Create equipment/property rent detail only when actual business rent exists. Home-office costs do not default here. |
| Line 21, repairs and maintenance | Conditional | Create only for actual repair activity; exclude improvements and capital assets. |
| Line 22, supplies | Conditional | Create for non-office consumables when triggered; existing office supplies remain line 18. |
| Line 23, taxes and licenses | Active | `Taxes and Licenses` children. Exclude collected sales tax and the owner's federal, Kansas, and self-employment income taxes. |
| Line 24a, travel | Active | `Travel` and `Business Lodging`; require tax-home, overnight, business-purpose, itinerary, and allocation evidence. |
| Line 24b, deductible meals | Active with tax adjustment | Post the full actual qualifying cost to `Business Meals - Tax Review`; the tax workpaper computes the deductible amount. |
| Line 25, utilities | Active | Internet, phone, and carrier/telecommunications transport. Exclude unsupported personal use and AI/model runtime. |
| Line 26, wages | Locked conditional account | `Salaries and Employee Wages` is no-post until payroll exists; never use for the disregarded owner. |
| Line 27a, energy-efficient commercial buildings deduction | Not applicable on known facts | Form 7205/workpaper only if a qualifying commercial-building fact pattern is established. |
| Line 27b, other expenses | Active named detail | Software, internal technology, training, gifts review, processing fees, AI usage, hosting, customer software, bank fees, and approved bad debt are separately identified. |
| Line 30, business use of home | Owner-return workpaper | Compare the current simplified and actual methods from Form 8829 facts. Do not duplicate personal home costs in ordinary business accounts. |

Lines 3, 5, 7, and 28 through 31 are calculated from the mapped amounts and tax workpapers; they are not ledger accounts.

## Conditional Account Catalog — Do Not Create Until Triggered

These codes preserve a clean future design without adding empty live accounts. Each row requires fresh Zoho type/parent validation and a bounded change plan before creation.

| Code | Account name | Type | Parent | Trigger and return destination |
|---|---|---|---|---|
| `1510` | Computer Equipment | Fixed Asset | Furniture and Equipment | Owned qualifying equipment; asset register and Form 4562/Kansas review. |
| `1520` | Office Furniture and Equipment | Fixed Asset | Furniture and Equipment | Owned qualifying furniture/equipment; asset register and property-rendition review. |
| `1590` | Accumulated Depreciation - Equipment | Fixed Asset | Furniture and Equipment | Approved book depreciation policy only. |
| `1600` | Capitalized Software Development Costs | Other Asset | — | Approved book capitalization or tax-ledger policy; maintain a separate book-tax schedule. |
| `1690` | Accumulated Amortization - Software | Other Asset | Capitalized Software Development Costs | Approved book amortization policy only. |
| `1700` | Deferred Startup and Pre-opening Costs | Other Asset | — | Pre-active-business costs and Section 195 workpaper. |
| `2210` | Kansas Consumer Use Tax Payable | Other Current Liability | — | Taxable purchase with required self-accrual after Kansas review. |
| `2310` | Owner Loan Payable | Other Current Liability | — | Bona fide owner financing with note, terms, interest, funding evidence, and debt schedule. |
| `4130` | Usage and Overage Revenue | Income | Managed Reception Service Revenue | Approved contract, price, invoice item, and Kansas sales-tax treatment; Schedule C line 1. |
| `6050` | Commissions and Fees | Expense | — | Preparer selects Schedule C line 10 and transaction dependencies are reviewed; no-post parent. |
| `6051` | Payment Processing Fees | Expense | Commissions and Fees | Reclassify existing processing-fee detail only after settlement review. |
| `6051.01` | Stripe Fees | Expense | Payment Processing Fees | Reclassify existing Stripe detail only with the parent decision. |
| `6320` | Employee Benefit Programs | Expense | — | Actual employee benefits; Schedule C line 14. |
| `6330` | Pension and Profit-Sharing - Employees | Expense | — | Actual non-owner employee plan contributions; Schedule C line 19. |
| `6410` | Rent or Lease | Expense | — | Actual business lease; no-post parent. |
| `6411` | Equipment Rent or Lease | Expense | Rent or Lease | Schedule C line 20a. |
| `6412` | Business Property Rent or Lease | Expense | Rent or Lease | Schedule C line 20b; exclude unsupported home-office amounts. |
| `6430` | Materials and Supplies | Expense | — | Non-office consumables; Schedule C line 22. |
| `6460` | Repairs and Maintenance | Expense | — | Repairs that are not improvements or capital assets; Schedule C line 21. |
| `6530` | Car and Truck Expenses - Tax Review | Expense | — | Business vehicle activity with mileage/actual-cost workpaper; Schedule C line 9. |
| `6720` | State and Local Business Taxes | Expense | Taxes and Licenses | Tax legally imposed on Sylvara; exclude owner income and self-employment tax. |
| `6800` | Depreciation and Amortization | Expense | — | Approved book policy; no-post parent. |
| `6810` | Depreciation Expense | Expense | Depreciation and Amortization | Approved book depreciation and asset register; Schedule C line 13 tax workpaper. |
| `6820` | Amortization Expense | Expense | Depreciation and Amortization | Approved book amortization and asset register; return-specific workpaper. |
| `6960` | Business Interest Expense | Expense | — | Actual business debt; no-post parent. |
| `6961` | Mortgage Interest | Expense | Business Interest Expense | Qualifying business-property mortgage interest; final-form mapping required. |
| `6962` | Vehicle Loan Interest - Tax Review | Expense | Business Interest Expense | Traced business vehicle debt and business-use allocation; final-form mapping required. |
| `6963` | Other Business Interest | Expense | Business Interest Expense | Traced business debt; Schedule C/current limitation review. |
| `6970` | Nondeductible Expenses - Tax Review | Expense | — | Trigger-only book-tax parent; no-post. |
| `6971` | Entertainment - Nondeductible Review | Expense | Nondeductible Expenses - Tax Review | Separately capture potentially nondeductible entertainment. |
| `6972` | Penalties and Fines - Nondeductible Review | Expense | Nondeductible Expenses - Tax Review | Separately capture penalties/fines for tax review. |
| `6973` | Political and Club Dues - Nondeductible Review | Expense | Nondeductible Expenses - Tax Review | Separately capture political, lobbying, social, athletic, or similar dues. |
| `6990.13` | Domestic Software Development and R&E - Tax Review | Expense | Other Expenses | Domestic experimental development distinct from production usage; Section 174A/credit workpaper. |
| `6990.14` | Foreign Software Development and R&E - Tax Review | Expense | Other Expenses | Foreign experimental development; Section 174 and credit workpaper. |

## Highest-Value Lawful Tax Opportunities

Account names do not reduce tax. The useful levers are complete capture, substantiation, timely elections, and avoiding duplicate or lost deductions.

| Opportunity | Required action | Why it matters |
|---|---|---|
| Federal accounting method | Compare live Zoho accrual configuration with the prior return, first return, and any Form 3115/method evidence. | Cash versus accrual changes timing and cannot be chosen by toggling Zoho. |
| Domestic and foreign R&E | Track each project, technical uncertainty, experimentation, dates, worker/vendor, rights/risk, and work location. Keep production usage separate. Have the preparer immediately review any 2022–2024 domestic Section 174 balance and the 2025 return; the special small-business retroactive-election deadline passed on 2026-07-06. | Current Section 174A generally permits deduction of post-2024 domestic R&E and allows an amortization election, while foreign R&E remains under Section 174. Transition methods and federal/Kansas credits require stronger evidence than a GL label. |
| Kansas R&D credit | Add a private `R&D candidate` project/tag and Kansas-location fields; screen Form K-53 eligibility before filing. | A qualifying credit may be valuable, but ordinary production inference, hosting, support, and customer adaptation do not automatically qualify. Some incentive information may be publicly reported under Kansas law; review privacy before claiming or transferring. |
| Startup costs | Establish the active-business date and identify pre-opening costs separately from R&E, assets, interest, and taxes. | Section 195 treatment is election- and timing-sensitive. |
| Equipment and software | Maintain cost, acquisition, placed-in-service, business-use, situs, disposition, and book-tax basis data. Compare regular depreciation, Section 179, current federal bonus rules, and Kansas K-120EX. | Current IRS guidance generally provides full additional first-year depreciation for eligible property acquired after 2025-01-19, but elections and eligibility are fact-specific. Accelerated tax treatment does not justify expensing assets directly in the books; Kansas elections can be original-return and irrevocable. |
| Tangible-property safe harbor | Maintain a consistent capitalization policy and make the annual return election when beneficial and eligible. | Proper process can reduce unnecessary asset capitalization; current thresholds must be reverified each year. |
| Home office | Preserve exclusive/regular-use, principal-place, area, and eligible-cost facts; compare methods annually. | This is generally a line 30/Form 8829 owner workpaper, not ordinary rent or utility double-counting. |
| Vehicle | Keep contemporaneous mileage, destination, date, and business-purpose evidence plus actual costs. | The preparer can compare permitted methods; current mileage rates are period-specific and should not be embedded in the chart. |
| Owner health, retirement, and QBI | Give the preparer Form 7206 facts, retirement/HSA documents, and qualified-business-income data. | These are primarily owner-return calculations, not Schedule C expense accounts. Spending merely to lower profit can also reduce QBI and cash. |
| Worker and information-return controls | Obtain current W-9s, classify workers from actual facts, track payment method, and reconcile reportable payments. | Correct treatment preserves deductions and reduces payroll/1099 exposure. |
| Kansas answering-service sales tax | Map every invoice item to base service, usage/overage, implementation, or genuinely standalone software; capture the customer's service address, tax status, jurisdiction, rate evidence, exemption certificate, and tax collected. | Kansas expressly taxes telephone answering services. Renaming the managed service as SaaS or splitting a bundle does not control the legal result. |
| Kansas purchase exemptions | Screen tangible inputs actually consumed in providing a taxable service and the temporary communications-provider infrastructure exemption, but obtain qualified review or a written KDOR conclusion before claiming either. | Cloud, AI API, SaaS, and telecom subscriptions are not automatically consumed-in-production property, and Sylvara should not assume it is a qualifying communications provider. |
| Johnson County property | Maintain the complete asset register and confirm the required rendition/exemption posture with the County Appraiser. | Home-business property can be reportable even when an exemption ultimately produces no tax. |
| Entity-election modeling | Model an S corporation only when sustained profit, reasonable compensation, payroll, compliance cost, benefits, and state effects justify it. | An election may or may not save tax; it is not a chart-of-accounts optimization. |

## Kansas And Overland Park Handoff

- A default disregarded SMLLC's federal business result generally reaches the owner's Kansas K-40 through federal adjusted gross income, subject to Kansas Schedule S modifications. Do not create a second set of Kansas expense parents.
- Treat Kansas-address managed receptionist subscriptions, included usage, and overage charges as taxable telephone answering service unless qualified review or a written KDOR conclusion supports a different result for Sylvara's exact contract. Pure hosted software analysis does not override the answering-service statute when that is the substance of the product.
- Do not hardcode an Overland Park sales-tax rate. Source each sale using the current customer service/business address and KDOR tools; special districts and rates change.
- The live `Tax Payable` account is the correct liability control. Collected sales tax is not revenue. Sales-tax registration, tax items, sourcing, returns, and invoice tests remain outside this chart review.
- No general Overland Park business license applicable to the known AI receptionist service was found in the current municipal code. Specialized activities and home-occupation rules remain separate operational checks.
- Johnson County says tangible business personal property, including home-business property, can require a rendition even when an exemption applies. Preserve the asset register and confirm filing with the County Appraiser.
- The current Kansas local-intangibles schedule does not list Johnson County or Overland Park, but the owner's dwelling controls and must be rechecked if residence changes.

## H&R Block / Tax-Professional Package

H&R Block's current checklist asks self-employed filers for all income records, all expense records and receipts, business-use asset cost/placed-in-service information, home-office information, and estimated-tax payments. Give the preparer:

1. Tax-basis trial balance and P&L using the confirmed federal accounting method, plus this Schedule C crosswalk.
2. Balance sheet and general-ledger detail, with A/R, A/P, clearing, prepaid, unearned-revenue, sales-tax, and owner-account reconciliations.
3. Gross-receipts reconciliation across invoices, deposits, processor settlements, Forms 1099-K/1099-NEC, discounts, refunds, and collected tax.
4. Source-by-source interest statements and classification.
5. Fixed-asset/depreciation register and Kansas property/expensing fields.
6. Debt and traced-interest schedule.
7. Startup and domestic/foreign R&E schedules, including any pre-2025 balance and credit support.
8. W-9, worker-classification, payroll, and information-return reports as applicable.
9. Vehicle, home-office, meals, gifts, owner health, retirement/HSA, and estimated-tax workpapers.
10. Kansas sales/use-tax registrations, returns, invoice-item mapping, sourcing evidence, exemption certificates, and reconciliations.
11. Prior federal/Kansas returns and evidence of entity, accounting-method, depreciation, capitalization, or other elections.

Do not place populated returns, tax IDs, customer records, asset addresses, balances, transactions, or private workpapers in GitHub.

## Current Primary Sources

Federal sources verified 2026-08-05:

- [IRS single-member LLC guidance](https://www.irs.gov/businesses/small-businesses-self-employed/single-member-limited-liability-companies)
- [Final 2025 Schedule C](https://www.irs.gov/pub/irs-pdf/f1040sc.pdf) and [instructions](https://www.irs.gov/instructions/i1040sc)
- [Draft 2026 Schedule C — not for filing](https://www.irs.gov/pub/irs-dft/f1040sc--dft.pdf)
- [IRS Publication 334](https://www.irs.gov/publications/p334) and [recordkeeping guidance](https://www.irs.gov/businesses/small-businesses-self-employed/recordkeeping)
- [26 U.S.C. Section 174A](https://uscode.house.gov/view.xhtml?req=%28title%3A26+section%3A174a+edition%3Aprelim%29), [Section 174](https://uscode.house.gov/view.xhtml?req=%28title%3A26+section%3A174+edition%3Aprelim%29), [Rev. Proc. 2025-28](https://www.irs.gov/irb/2025-38_IRB), and [Form 6765 instructions](https://www.irs.gov/instructions/i6765)
- [IRS Publication 946](https://www.irs.gov/publications/p946), [current bonus-depreciation guidance](https://www.irs.gov/newsroom/treasury-irs-issue-guidance-on-the-additional-first-year-depreciation-deduction-amended-as-part-of-the-one-big-beautiful-bill), and [tangible-property regulations guidance](https://www.irs.gov/businesses/small-businesses-self-employed/tangible-property-final-regulations)
- [IRS Publication 587](https://www.irs.gov/publications/p587), [Publication 463](https://www.irs.gov/publications/p463), [Form 7206 instructions](https://www.irs.gov/instructions/i7206), and [Publication 560](https://www.irs.gov/publications/p560)
- [26 U.S.C. Section 199A](https://uscode.house.gov/view.xhtml?req=%28title%3A26+section%3A199a+edition%3Aprelim%29) and [Form 8995 instructions](https://www.irs.gov/instructions/i8995)

Kansas/local sources verified 2026-08-05:

- [2025 Kansas individual income-tax booklet](https://www.ksrevenue.gov/incomebook25.html)
- [K.S.A. 79-3603(t)](https://kslegislature.gov/b2025_26/laws/079_000_0000_chapter/079_036_0000_article/079_036_0003_section/079_036_0003_k/), [KDOR telephone-answering fact sheet](https://www.ksrevenue.gov/factsheets/fstelephone.pdf), [KS-1510](https://www.ksrevenue.gov/pub1510.html), [sourcing rules](https://www.ksrevenue.gov/sourcingrules.html), and [address-tax-rate locator](https://www.ksrevenue.gov/atrl.html)
- [K.S.A. 79-32,117](https://kslegislature.gov/b2025_26/laws/079_000_0000_chapter/079_032_0000_article/079_032_0117_section/079_032_0117_k/), [K.S.A. 79-32,182b](https://www.kslegislature.gov/b2025_26/laws/079_000_0000_chapter/079_032_0000_article/079_032_0182b_section/079_032_0182b_k/), [KDOR research-credit guidance](https://www.ksrevenue.gov/prtaxcredits-research.html), [Form K-53](https://www.ksrevenue.gov/pdf/k-53.pdf), and [Kansas incentive-disclosure statute](https://www.ksrevisor.gov/statutes/chapters/ch74/074_050_0227.html)
- [K.S.A. 79-32,143a](https://www.kslegislature.gov/b2025_26/laws/079_000_0000_chapter/079_032_0000_article/079_032_0143a_section/079_032_0143a_k) and [Kansas K-120EX](https://www.ksrevenue.gov/pdf/k-120ex25.pdf)
- [KDOR Notice 24-13](https://www.ksrevenue.gov/taxnotices/notice24-13.pdf) and [Form ST-63](https://www.ksrevenue.gov/pdf/st63.pdf) for narrow purchase-exemption research
- [Johnson County business personal-property guidance](https://www.jocogov.org/department/appraiser/property-information/personal-property), [2026 Kansas local-intangibles form/rates](https://www.ksrevenue.gov/pdf/20026.pdf), [Overland Park municipal code](https://codes.opkansas.org/municipal-code/doc-view.aspx), and [Overland Park home-occupation rules](https://online.encodeplus.com/regs/overlandpark-ks/export2doc.aspx?pdf=1&tocid=018)

Workflow reference verified 2026-08-05: [H&R Block tax-preparation checklist](https://www.hrblock.com/tax-prep-checklist/what-do-i-need-to-file-taxes/). H&R Block material is a handoff aid, not tax authority; the controlling sources above govern.

## Unresolved Decisions For The Preparer

1. Confirm the federal and Kansas tax year, prior entity elections, and the principal-business code; `561420 Telephone call centers` is a candidate, not an adopted conclusion.
2. Confirm the federal tax accounting method. Live Zoho is configured accrual, but no prior return or method-election evidence was reviewed.
3. Decide payment-processing presentation: Schedule C line 10 or named Part V detail.
4. Establish the active-business date and any pre-opening/startup or pre-2025 R&E balance.
5. Review domestic/foreign R&E, federal credit, Kansas credit, and disclosure/privacy consequences before claiming.
6. Model each asset's federal and Kansas depreciation/expensing elections without changing the book ledger to force the tax result.
7. Confirm Kansas sales-tax registration, sourcing, item treatment, and filing cadence before customer invoicing.
8. Confirm home-office, vehicle, owner health, retirement/HSA, QBI, estimated-tax, and possible future S-election facts outside the GL.

This package is designed to make preparation fast and auditable. It does not replace the preparer's review of facts, current forms, elections, or the actual books.
