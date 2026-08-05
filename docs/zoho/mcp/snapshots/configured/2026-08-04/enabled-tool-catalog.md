# Sylvara Zoho MCP Enabled Tool Catalog

## Evidence Status

- Observation date: **2026-08-04**
- Scope: **294 configured selections across 18 neutral Sylvara MCP server roles**
- Verification: **configured selection observed; no Zoho tool was called**
- Canonical machine source: [`sylvara-observed-tool-inventory.json`](sylvara-observed-tool-inventory.json)

“Enabled” in this catalog means selected on the inspected role at the observation date. It does not prove current authorization, tenant binding, plan availability, successful execution, or approval for live use.

## Naming Contract

The documented tool name is `annotated_tool_name`, such as `list vendor credits`. A product or server prefix is never part of that annotation. `catalog_operation_key`, such as `list_vendor_credits`, is retained separately for exact catalog matching. Service qualification comes from the role’s `product` field.

## Role Summary

| Sylvara MCP server role | Product | Access class | Read | Write / action | Total |
|---|---|---|---:|---:|---:|
| `billing-audit` | Zoho Billing | read-only | 32 | 0 | 32 |
| `billing-changes` | Zoho Billing | mixed-read-write | 6 | 13 | 19 |
| `books-audit` | Zoho Books | read-only | 40 | 0 | 40 |
| `books-changes` | Zoho Books | mixed-read-write | 9 | 6 | 15 |
| `books-controller` | Zoho Books | controller | 10 | 22 | 32 |
| `catalyst-audit` | Zoho Catalyst | read-only | 13 | 0 | 13 |
| `catalyst-break-glass` | Zoho Catalyst | break-glass | 0 | 5 | 5 |
| `catalyst-release` | Zoho Catalyst | release | 0 | 7 | 7 |
| `creator-audit` | Zoho Creator | read-only | 17 | 0 | 17 |
| `creator-changes` | Zoho Creator | mixed-read-write | 5 | 6 | 11 |
| `crm-audit` | Zoho CRM | read-only | 35 | 0 | 35 |
| `crm-changes` | Zoho CRM | mixed-read-write | 5 | 4 | 9 |
| `mail-audit` | Zoho Mail | read-only | 12 | 0 | 12 |
| `mail-changes` | Zoho Mail | mixed-read-write | 2 | 2 | 4 |
| `payments-audit` | Zoho Payments | read-only | 10 | 0 | 10 |
| `payments-changes` | Zoho Payments | mixed-read-write | 3 | 4 | 7 |
| `workdrive-audit` | Zoho WorkDrive | read-only | 21 | 0 | 21 |
| `workdrive-changes` | Zoho WorkDrive | mixed-read-write | 1 | 4 | 5 |

## `billing-audit`

- Product: **Zoho Billing**
- Access class: **read-only**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| Get a Customer | `Get_a_Customer` | read |
| Get a Customer by Reference | `Get_a_Customer_by_Reference` | read |
| Get a Payment | `Get_a_Payment` | read |
| Get a Plan | `Get_a_Plan` | read |
| Get a Product | `Get_a_Product` | read |
| Get a Subscription | `Get_a_Subscription` | read |
| Get Active Customers Report | `Get_Active_Customers_Report` | read |
| Get an Addon | `Get_an_Addon` | read |
| Get an Event | `Get_an_Event` | read |
| Get an Invoice | `Get_an_Invoice` | read |
| Get an Organization | `Get_an_Organization` | read |
| Get ARR Report | `Get_ARR_Report` | read |
| Get Churned Subscriptions Report | `Get_Churned_Subscriptions_Report` | read |
| Get MRR Report | `Get_MRR_Report` | read |
| Get Payment Failures Report | `Get_Payment_Failures_Report` | read |
| Get Subscription Custom Fields | `Get_Subscription_Custom_Fields` | read |
| Get Subscriptions Summary Report | `Get_Subscriptions_Summary_Report` | read |
| Get Upcoming Renewal Details Report | `Get_Upcoming_Renewal_Details_Report` | read |
| List all Addons | `List_all_Addons` | read |
| List all Customers | `List_all_Customers` | read |
| List all Events | `List_all_Events` | read |
| List all Invoices | `List_all_Invoices` | read |
| List all Organizations | `List_all_Organizations` | read |
| List all Payments | `List_all_Payments` | read |
| List all Plans | `List_all_Plans` | read |
| List all Products | `List_all_Products` | read |
| List all Subscriptions | `List_all_Subscriptions` | read |
| List Recent Activities of a Subscription | `List_Recent_Activities_of_a_Subscription` | read |
| Search Customers | `Search_Customers` | read |
| Search Plans | `Search_Plans` | read |
| Search Products | `Search_Products` | read |
| View Scheduled Changes of a Subscription | `View_Scheduled_Changes_of_a_Subscription` | read |

## `billing-changes`

- Product: **Zoho Billing**
- Access class: **mixed-read-write**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| Add a Contact Person to a Subscription | `Add_a_Contact_Person_to_a_Subscription` | write/action |
| Add Subscription Notes | `Add_Subscription_Notes` | write/action |
| Cancel a Subscription | `Cancel_a_Subscription` | write/action |
| Create a Customer | `Create_a_Customer` | write/action |
| Create a Subscription | `Create_a_Subscription` | write/action |
| Get a Customer | `Get_a_Customer` | read |
| Get a Plan | `Get_a_Plan` | read |
| Get a Subscription | `Get_a_Subscription` | read |
| Get an Addon | `Get_an_Addon` | read |
| Get an Organization | `Get_an_Organization` | read |
| Pause a Subscription | `Pause_a_Subscription` | write/action |
| Reactivate a Subscription | `Reactivate_a_Subscription` | write/action |
| Resume a Subscription | `Resume_a_Subscription` | write/action |
| Update a Contact Person | `Update_a_Contact_Person` | write/action |
| Update a Customer | `Update_a_Customer` | write/action |
| Update a Subscription | `Update_a_Subscription` | write/action |
| Update Custom Fields in a Subscription | `Update_Custom_Fields_in_a_Subscription` | write/action |
| Update the Reference of a Subscription | `Update_the_Reference_of_a_Subscription` | write/action |
| View Scheduled Changes of a Subscription | `View_Scheduled_Changes_of_a_Subscription` | read |

## `books-audit`

- Product: **Zoho Books**
- Access class: **read-only**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| get activity logs report | `get_activity_logs_report` | read |
| get ar aging summary report | `get_ar_aging_summary_report` | read |
| get balance sheet report | `get_balance_sheet_report` | read |
| get bank account | `get_bank_account` | read |
| get bank transaction | `get_bank_transaction` | read |
| get bill | `get_bill` | read |
| get cash flow report | `get_cash_flow_report` | read |
| get chart of account | `get_chart_of_account` | read |
| get contact | `get_contact` | read |
| get credit note | `get_credit_note` | read |
| get current user | `get_current_user` | read |
| get customer balance summary report | `get_customer_balance_summary_report` | read |
| get customer payment | `get_customer_payment` | read |
| get estimate | `get_estimate` | read |
| get expense | `get_expense` | read |
| get fields meta | `get_fields_meta` | read |
| get invoice | `get_invoice` | read |
| get item | `get_item` | read |
| get organization | `get_organization` | read |
| get profit and loss report | `get_profit_and_loss_report` | read |
| get recurring invoice | `get_recurring_invoice` | read |
| get reports metadata | `get_reports_metadata` | read |
| get sales summary report | `get_sales_summary_report` | read |
| get transaction lock | `get_transaction_lock` | read |
| list bank accounts | `list_bank_accounts` | read |
| list bank transactions | `list_bank_transactions` | read |
| list bills | `list_bills` | read |
| list chart of account transactions | `list_chart_of_account_transactions` | read |
| list chart of accounts | `list_chart_of_accounts` | read |
| list contacts | `list_contacts` | read |
| list credit notes | `list_credit_notes` | read |
| list customer payments | `list_customer_payments` | read |
| list estimates | `list_estimates` | read |
| list expenses | `list_expenses` | read |
| list invoice credits applied | `list_invoice_credits_applied` | read |
| list invoice payments | `list_invoice_payments` | read |
| list invoices | `list_invoices` | read |
| list items | `list_items` | read |
| list organizations | `list_organizations` | read |
| list recurring invoices | `list_recurring_invoices` | read |

## `books-changes`

- Product: **Zoho Books**
- Access class: **mixed-read-write**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| create contact | `create_contact` | write/action |
| create estimate | `create_estimate` | write/action |
| create invoice | `create_invoice` | write/action |
| get current user | `get_current_user` | read |
| get estimate | `get_estimate` | read |
| get invoice | `get_invoice` | read |
| get item | `get_item` | read |
| get organization | `get_organization` | read |
| list contacts | `list_contacts` | read |
| list estimates | `list_estimates` | read |
| list invoices | `list_invoices` | read |
| list items | `list_items` | read |
| update contact | `update_contact` | write/action |
| update estimate | `update_estimate` | write/action |
| update invoice | `update_invoice` | write/action |

## `books-controller`

- Product: **Zoho Books**
- Access class: **controller**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| apply credit note to invoice | `apply_credit_note_to_invoice` | write/action |
| cancel write off invoice | `cancel_write_off_invoice` | write/action |
| create bank reconciliation | `create_bank_reconciliation` | write/action |
| create credit note | `create_credit_note` | write/action |
| create credit note refund | `create_credit_note_refund` | write/action |
| create customer payment | `create_customer_payment` | write/action |
| create customer payment refund | `create_customer_payment_refund` | write/action |
| create journal | `create_journal` | write/action |
| exclude bank transaction | `exclude_bank_transaction` | write/action |
| get bank reconciliation | `get_bank_reconciliation` | read |
| get bank transaction | `get_bank_transaction` | read |
| get bill | `get_bill` | read |
| get credit note | `get_credit_note` | read |
| get current user | `get_current_user` | read |
| get customer payment | `get_customer_payment` | read |
| get invoice | `get_invoice` | read |
| get journal | `get_journal` | read |
| get organization | `get_organization` | read |
| get transaction lock | `get_transaction_lock` | read |
| mark bill void | `mark_bill_void` | write/action |
| mark credit note void | `mark_credit_note_void` | write/action |
| mark invoice void | `mark_invoice_void` | write/action |
| restore bank transaction | `restore_bank_transaction` | write/action |
| reverse journal | `reverse_journal` | write/action |
| submit journal for approval | `submit_journal_for_approval` | write/action |
| uncategorize bank transaction | `uncategorize_bank_transaction` | write/action |
| unmatch bank transaction | `unmatch_bank_transaction` | write/action |
| update bank reconciliation | `update_bank_reconciliation` | write/action |
| update credit note | `update_credit_note` | write/action |
| update customer payment | `update_customer_payment` | write/action |
| update journal | `update_journal` | write/action |
| write off invoice | `write_off_invoice` | write/action |

## `catalyst-audit`

- Product: **Zoho Catalyst**
- Access class: **read-only**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| Get API route | `Get_API_route` | read |
| Get Deployment | `Get_Deployment` | read |
| Get Function | `Get_Function` | read |
| Get Logs | `Get_Logs` | read |
| Get Pipeline By Id | `Get_Pipeline_By_Id` | read |
| Get Project By Id | `Get_Project_By_Id` | read |
| List All API route | `List_All_API_route` | read |
| List All Deployments | `List_All_Deployments` | read |
| List All Env Variables | `List_All_Env_Variables` | read |
| List All Functions | `List_All_Functions` | read |
| List All Organizations | `List_All_Organizations` | read |
| List All Pipelines | `List_All_Pipelines` | read |
| List All Projects | `List_All_Projects` | read |

## `catalyst-break-glass`

- Product: **Zoho Catalyst**
- Access class: **break-glass**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| Configure API Gateway Route | `Configure_API_Gateway_Route` | write/action |
| Create Env Variables | `Create_Env_Variables` | write/action |
| Create Pipeline | `Create_Pipeline` | write/action |
| Update Environment Variable | `Update_Environment_Variable` | write/action |
| Update Pipeline | `Update_Pipeline` | write/action |

## `catalyst-release`

- Product: **Zoho Catalyst**
- Access class: **release**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| Cancel Build | `Cancel_Build` | write/action |
| Execute Automation Test | `Execute_Automation_Test` | write/action |
| Execute Function Via POST | `Execute_Function_Via_POST` | write/action |
| Execute Pipeline Manually | `Execute_Pipeline_Manually` | write/action |
| Redeploy a deployment | `Redeploy_a_deployment` | write/action |
| Rollback Build | `Rollback_Build` | write/action |
| Update Function | `Update_Function` | write/action |

## `creator-audit`

- Product: **Zoho Creator**
- Access class: **read-only**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| get Applications | `getApplications` | read |
| get Applications By Workspace | `getApplicationsByWorkspace` | read |
| get Application Summary | `getApplicationSummary` | read |
| get Approvals | `getApprovals` | read |
| get Blueprint Transitions | `getBlueprintTransitions` | read |
| get Comments | `getComments` | read |
| get Creator Records | `getCreatorRecords` | read |
| get Form Metadata | `getFormMetadata` | read |
| get Forms | `getForms` | read |
| get Pages | `getPages` | read |
| get Record By ID | `getRecordByID` | read |
| get Report Metadata | `getReportMetadata` | read |
| get Reports | `getReports` | read |
| get Sections | `getSections` | read |
| get Usage Summary | `getUsageSummary` | read |
| get Usage Trend | `getUsageTrend` | read |
| get Workspaces | `getWorkspaces` | read |

## `creator-changes`

- Product: **Zoho Creator**
- Access class: **mixed-read-write**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| add Comment | `addComment` | write/action |
| add Records | `addRecords` | write/action |
| add Reply To Comment | `addReplyToComment` | write/action |
| execute Approval Action | `executeApprovalAction` | write/action |
| execute Blueprint Transition | `executeBlueprintTransition` | write/action |
| get Applications | `getApplications` | read |
| get Application Summary | `getApplicationSummary` | read |
| get Form Metadata | `getFormMetadata` | read |
| get Record By ID | `getRecordByID` | read |
| get Report Metadata | `getReportMetadata` | read |
| update Record By ID | `updateRecordByID` | write/action |

## `crm-audit`

- Product: **Zoho CRM**
- Access class: **read-only**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| execute COQLQuery | `executeCOQLQuery` | read |
| get Bulk Global Picklists | `getBulkGlobalPicklists` | read |
| get Custom Views | `getCustomViews` | read |
| get Fields | `getFields` | read |
| get Fields With ID | `getFieldsWithID` | read |
| get Field Update By Id | `getFieldUpdateById` | read |
| get Field Updates | `getFieldUpdates` | read |
| get Global Pick List Field Associations | `getGlobalPickListFieldAssociations` | read |
| get Layout By Id | `getLayoutById` | read |
| get Layout Rules | `getLayoutRules` | read |
| get Layout Rules By Id | `getLayoutRulesById` | read |
| get Layouts | `getLayouts` | read |
| get Module By Api Name | `getModuleByApiName` | read |
| get Modules | `getModules` | read |
| get Note By Id | `getNoteById` | read |
| get Organization | `getOrganization` | read |
| get Pipeline | `getPipeline` | read |
| get Pipelines | `getPipelines` | read |
| get Record | `getRecord` | read |
| get Record Count | `getRecordCount` | read |
| get Records | `getRecords` | read |
| get Related Lists | `getRelatedLists` | read |
| get Related Record | `getRelatedRecord` | read |
| get Related Records | `getRelatedRecords` | read |
| get Related Records Count | `getRelatedRecordsCount` | read |
| get Single Global Picklists | `getSingleGlobalPicklists` | read |
| get Tags | `getTags` | read |
| get Task By Id | `getTaskById` | read |
| get Timelines | `getTimelines` | read |
| get Users | `getUsers` | read |
| get Workflow Configurations | `getWorkflowConfigurations` | read |
| get Workflow Rule By Id | `getWorkflowRuleById` | read |
| get Workflow Rules | `getWorkflowRules` | read |
| get Workflow Tasks | `getWorkflowTasks` | read |
| search Records | `searchRecords` | read |

## `crm-changes`

- Product: **Zoho CRM**
- Access class: **mixed-read-write**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| create Notes Module | `createNotesModule` | write/action |
| create Records | `createRecords` | write/action |
| get Notes By Id | `getNotesById` | read |
| get Organization | `getOrganization` | read |
| get Record | `getRecord` | read |
| get Related Records | `getRelatedRecords` | read |
| search Records | `searchRecords` | read |
| update Note By Id | `updateNoteById` | write/action |
| update Record | `updateRecord` | write/action |

## `mail-audit`

- Product: **Zoho Mail**
- Access class: **read-only**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| get Account Details | `getAccountDetails` | read |
| get All Folders | `getAllFolders` | read |
| get Folder | `getFolder` | read |
| get Mail Accounts | `getMailAccounts` | read |
| get Message Attachment Info | `getMessageAttachmentInfo` | read |
| get Message Content | `getMessageContent` | read |
| get Message Details | `getMessageDetails` | read |
| get Message Header | `getMessageHeader` | read |
| get Org Details | `getOrgDetails` | read |
| get Original Message | `getOriginalMessage` | read |
| list Emails | `listEmails` | read |
| Search Emails | `SearchEmails` | read |

## `mail-changes`

- Product: **Zoho Mail**
- Access class: **mixed-read-write**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| get All Folders | `getAllFolders` | read |
| get Mail Accounts | `getMailAccounts` | read |
| send Email | `sendEmail` | write/action |
| send Reply Email | `sendReplyEmail` | write/action |

## `payments-audit`

- Product: **Zoho Payments**
- Access class: **read-only**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| get Customer | `getCustomer` | read |
| get Payment | `getPayment` | read |
| get Payment Link | `getPaymentLink` | read |
| get Payment Session | `getPaymentSession` | read |
| get Payout | `getPayout` | read |
| get Payout Transactions | `getPayoutTransactions` | read |
| get Refund | `getRefund` | read |
| list Merchant Accounts | `listMerchantAccounts` | read |
| list Payments | `listPayments` | read |
| list Payouts | `listPayouts` | read |

## `payments-changes`

- Product: **Zoho Payments**
- Access class: **mixed-read-write**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| create Customer | `createCustomer` | write/action |
| create Payment Link | `createPaymentLink` | write/action |
| create Payment Session | `createPaymentSession` | write/action |
| get Customer | `getCustomer` | read |
| get Payment Link | `getPaymentLink` | read |
| get Payment Session | `getPaymentSession` | read |
| update Payment Link | `updatePaymentLink` | write/action |

## `workdrive-audit`

- Product: **Zoho WorkDrive**
- Access class: **read-only**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| Breadcrumbs Of File | `Breadcrumbs_Of_File` | read |
| Download Server File | `Download_Server_File` | read |
| Download Server File Version | `Download_Server_File_Version` | read |
| download Work Drive File | `downloadWorkDriveFile` | read |
| Fetch Files Folders | `Fetch_Files_Folders` | read |
| File Property | `File_Property` | read |
| Get All Team Folders | `Get_All_Team_Folders` | read |
| Get All Teams Of User | `Get_All_Teams_Of_User` | read |
| Get Current Team User | `Get_Current_Team_User` | read |
| Get File List | `Get_File_List` | read |
| Get File Preview | `Get_File_Preview` | read |
| Get List Of Recent Changes | `Get_List_Of_Recent_Changes` | read |
| Get Shared Links | `Get_Shared_Links` | read |
| Get Shared Users | `Get_Shared_Users` | read |
| Get Start Token | `Get_Start_Token` | read |
| Get Team Folder Setting | `Get_Team_Folder_Setting` | read |
| Get Team Folder Shared Users | `Get_Team_Folder_Shared_Users` | read |
| Get Team Folders Info | `Get_Team_Folders_Info` | read |
| Get User Info | `Get_User_Info` | read |
| Get Version | `Get_Version` | read |
| Search Records | `Search_Records` | read |

## `workdrive-changes`

- Product: **Zoho WorkDrive**
- Access class: **mixed-read-write**
- Status: **configured-selection-not-call-verified**

| Annotated tool name | Catalog operation key | Effect |
|---|---|---|
| Create Folder | `Create_Folder` | write/action |
| move File Or Folder | `moveFileOrFolder` | write/action |
| rename File Or Folder | `renameFileOrFolder` | write/action |
| Upload File | `Upload_File` | write/action |
| Upload Status | `Upload_Status` | read |
