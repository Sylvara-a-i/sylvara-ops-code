# Sylvara Schedule C Chart Amendment

## Status

- Prepared: 2026-08-05
- Entity assumption: domestic single-member LLC disregarded for federal income tax unless an effective Form 2553 or Form 8832 is later evidenced
- Live organization: privately rebound and independently verified before this plan; identifiers are excluded
- Scope: chart names codes descriptions account types and parents only
- Excluded: transaction-record edits journals reconciliations activity review tax-engine settings tax returns and elections; chart metadata can change historical report presentation
- Target register: [`schedule-c-tax-rollup-2026-08-05.csv`](schedule-c-tax-rollup-2026-08-05.csv)
- Target SHA-256: `6f3004a0c56aba7436a37298cc011b8345288082976b17a8211436f2b393c936`
- Live execution: completed with independent Audit readback; 83 active and 11 inactive accounts

This is a successor amendment to the completed 2026-08-05 chart deployment. The earlier deployment record remains unchanged as historical evidence. An internal comparator informed only the generic parent-child mechanics; no comparator accounts identifiers records tax-form families or entity conclusions are published or imported.

## Conclusion

The current Sylvara chart is operationally useful but its editable top-level expense parents do not consistently match the federal return categories requested by the owner. A bounded P&L amendment is warranted.

The IRS does not prescribe a chart of accounts. It permits any recordkeeping system that clearly shows income and expenses. The latest final Schedule C is the 2025 form; the 2026 form available on 2026-08-05 is a draft marked not for filing. Account names therefore use stable category labels while line references remain in this annually reviewed register rather than in live account names.

## Design Rule

For editable Sylvara P&L accounts the design is:

`Schedule C category parent -> operational child -> optional activity detail`

Zoho system and seeded accounts remain exceptions when their name parent code or status is locked. Each exception has a management code and federal mapping in the target register. Balance-sheet accounts do not roll into Schedule C and remain unchanged.

The standard Zoho `Cost of Goods Sold` account remains active because it is locked but becomes no-post. The current direct service technology and contractor accounts are not automatically Schedule C Part III costs. Contractor accounts move to `Contract Labor`; communication costs move to `Utilities`; software AI and hosting costs move to separately stated `Other Expenses`. A later approved book gross-margin report can group direct costs without changing their federal return parent.

## Exact Create Scope - 4 Accounts

| Code | Account name | Type | Parent | Brief description |
|---|---|---|---|---|
| `6300` | Contract Labor | Expense | Root | Schedule C parent for services performed by workers not treated as employees. |
| `6450` | Utilities | Expense | Root | Schedule C parent for substantiated business utility and communications costs. |
| `6540` | Deductible Meals | Expense | Root | Schedule C parent for the deductible portion of qualifying business meals. |
| `6510` | Business Lodging | Expense | Travel | Substantiated lodging during qualifying overnight business travel. |

Every create body is limited to `account_name`, `account_code`, `account_type`, `description`, and `parent_account_id` only for `Business Lodging`.

## Exact Existing-Account Update Scope - 18 Accounts

| Current account | Target code and name | Target type | Target parent | Changed fields |
|---|---|---|---|---|
| Sales and Marketing | `6000 Advertising` | Expense | Root | name description |
| Sales Software and Prospect Data | `6030 Sales Software and Prospect Data` | Expense | Technology and Operations | parent description |
| Technology and Operations | `6100 Technology and Operations` | Expense | Other Expenses | parent description |
| Professional Services | `6200 Legal and Professional Services` | Expense | Root | name description |
| Occupancy and Office | `6400 Office Expense` | Expense | Root | name description |
| Internet | `6451 Internet` | Expense | Utilities | code parent description |
| Phone | `6452 Phone` | Expense | Utilities | code parent description |
| Business Insurance | `6600 Insurance (Other Than Health)` | Expense | Root | name description |
| Taxes Licenses and Compliance | `6700 Taxes and Licenses` | Expense | Root | name description |
| Business Meals - Tax Review | `6550 Business Meals - Tax Review` | Expense | Deductible Meals | parent description |
| Business Gifts - Section 274 Review | `6930 Business Gifts - Section 274 Review` | Expense | Other Expenses | parent description |
| Voice and Telephony Usage | `6453 Voice and Telephony Usage` | Expense | Utilities | code type parent description |
| AI Model and Automation Usage | `6990.10 AI Model and Automation Usage` | Expense | Other Expenses | code type parent description |
| Direct Hosting and Integration Costs | `6990.11 Direct Hosting and Integration Costs` | Expense | Other Expenses | code type parent description |
| Direct Customer Software and Licenses | `6990.12 Direct Customer Software and Licenses` | Expense | Other Expenses | code type parent description |
| Direct Service Contractors | `6301 Direct Service Contractors` | Expense | Contract Labor | code type parent description |
| Human Escalation and Quality Assurance | `6302 Contract Human Escalation and Quality Assurance` | Expense | Contract Labor | code name type parent description |
| Direct Implementation Labor | `6303 Contract Implementation Labor` | Expense | Contract Labor | code name type parent description |

No other active or inactive account is changed. No system account is renamed reparented inactivated or deleted.

## Fresh Prestate And Acceptance Gates

Immediately before the first write:

1. Reverify the active paid organization and Admin identity through Sylvara Books Audit.
2. Read the complete active and inactive chart and require the expected 79 active and 11 inactive rows.
3. Require exact current name code type parent description status and mutability for every target.
4. Require target names and codes to be absent from all non-target active and inactive accounts.
5. Freeze the target register hash shown above.
6. Stop on stale prestate ambiguity duplicate error timeout or incomplete response.

## Execution And Independent Readback

Use only Sylvara Books Controller `create_chart_of_account` and `update_chart_of_account`. Serialize every write and use the private fixed organization identifier. After each write use the independent Sylvara Books Audit connector to compare the exact name code type parent description active status and system or user-created flags before continuing.

Order:

1. Create `Contract Labor`, `Utilities`, and `Deductible Meals`; read each back.
2. Create `Business Lodging` under the verified `Travel` parent; read it back.
3. Rename the five existing category roots.
4. Reparent the six type-stable expense accounts.
5. Convert and reparent the seven current cost-of-goods-sold children one at a time.
6. Read the complete active and inactive chart and compare it to the target register and unchanged balance-sheet prestate.

Expected final sanitized state is 83 active and 11 inactive accounts with no deletions.

## Execution Result

The owner had already authorized completion of the chart-only work and expressly authorized redoing the hierarchy to use tax-form parents. Fresh preflight matched the documented 79-active/11-inactive prestate and verified the same active paid organization and Admin role through both Controller and Audit.

| Control | Verified result |
|---|---|
| Creates | Four; every name code type parent description status and mutability flag matched independent Audit readback |
| Existing-account updates | 18; all exact target fields matched independent Audit readback |
| System-account mutations | None |
| Deletions or inactivations | None |
| Final chart | 83 active and 11 inactive accounts |
| Unchanged non-target reconciliation | 68 prior accounts retained the same stable name code type description parent identifier status currency and system/user-created flags |
| Hierarchy | Maximum depth two; no active account is parented to Cost of Goods Sold and the locked root remains no-post |
| Editable expense roots | Advertising; Contract Labor; Deductible Meals; Insurance (Other Than Health); Legal and Professional Services; Office Expense; Taxes and Licenses; Travel; Utilities |

One readback correctly stopped the sequence during the `Internet` update. Its approved parent and description had been written but the approved code was omitted from the operator payload. Audit established the exact partial state with no ambiguity. The sequence remained stopped while the omitted approved code field was sent alone; the complete account then matched the immutable target. No duplicate create or blind retry occurred and no rollback was required. This contained payload omission did not write any transaction or balance value; chart metadata can still affect report presentation.

Final complete active/inactive reads matched the target and showed no unexpected stable-field change outside the 18 approved updates and four creates. No transaction record journal bank clearing item tax-engine template or integration was written. Account activity and the effect of metadata changes on historical report presentation were not reconciled in this chart-only scope.

## Rollback

Private prestate captures every target account identifier and its exact prior fields. If any update succeeds but its Audit readback fails the sequence stops and completed updates are restored in reverse order with `update_chart_of_account`, followed by independent Audit readback. New accounts are contained by marking `Business Lodging` inactive before the three new roots and independently verifying each status. Delete is not authorized.

Rollback restores chart metadata only. No transaction record or journal was written; reversing the metadata would also restore the former report labels types and hierarchy. Historical report-presentation effects remain outside this chart-only reconciliation.

## Annual And Professional Review Triggers

- Reverify the final Schedule C and instructions for the actual filing year before tax preparation.
- An effective Form 2553 or Form 8832 election supersedes this Schedule C mapping.
- COGS Part III treatment requires an approved inventory or tax method; managerial cost of service alone is not enough.
- Worker classification controls whether labor belongs under Contract Labor or Wages. Owner labor is neither.
- Software research startup capitalization depreciation home-office meals gifts and mixed-use costs remain fact-dependent and require supported workpapers.
- A chart structure does not create a deduction. Complete records and correct classification are what preserve lawful deductions.

## Sources Verified 2026-08-05

- [IRS Schedule C for 2025](https://www.irs.gov/pub/irs-pdf/f1040sc.pdf)
- [IRS Instructions for Schedule C for 2025](https://www.irs.gov/instructions/i1040sc)
- [IRS draft Schedule C for 2026](https://www.irs.gov/pub/irs-dft/f1040sc--dft.pdf)
- [IRS single-member LLC guidance](https://www.irs.gov/businesses/small-businesses-self-employed/single-member-limited-liability-companies)
- [IRS recordkeeping guidance](https://www.irs.gov/businesses/small-businesses-self-employed/recordkeeping)
- [Zoho Books sub-accounts](https://www.zoho.com/us/books/help/accountant/sub-accounts.html)
- [Zoho Books custom reports](https://www.zoho.com/us/books/help/reports/custom-reports.html)
