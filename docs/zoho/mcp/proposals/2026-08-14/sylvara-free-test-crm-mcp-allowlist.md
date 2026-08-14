# Free-Test CRM MCP Proposed Allowlist — 2026-08-14

## Status And Scope

- Classification: **Proposed server design**
- Owning product: **Zoho CRM**
- Workflow: public free-test intake, qualification, controlled Lead conversion, secure setup, authorization, QA, go-live approval, limited-test operation, and results review
- Catalog evidence: [Zoho CRM Tool Manual Catalog — 2026-08-14](../../reference/zoho-crm-tool-manual-catalog-2026-08-14.md)
- Live deployment: **Not established by this document**

This allowlist corrects an earlier inference from the configured Sylvara runtime subset. The current Tool Manual catalog contains CRM Blueprint, transition, function, custom-button, workflow, validation, conversion, record, and sandbox actions. Their absence from a connected server is an enablement gap, not proof that the catalog lacks them.

Catalog membership still does not prove a complete current input contract, OAuth permission, effective tenant access, or authorization for a live write. Every selected operation remains subject to the [MCP Server Standard](../../server-standard.md).

Every operation name in backticks is the exact MCP Tool Manual key from the dated capture. Do not silently substitute a similar OpenAPI `operationId`; some official OAS names differ from the Tool Manual keys.

## Intended Process Coverage

| Process component | CRM mechanism | Intended MCP coverage |
|---|---|---|
| Form 1 registration | Create/edit Lead workflow | Workflow rule, task, field-update, and readback operations |
| Qualification control | Non-continuous Lead Blueprint | Blueprint, state, transition, checklist/field-input, activation, and readback operations |
| Duplicate review and conversion | Native Lead conversion | Conversion-options read; conversion remains human-approved and irreversible |
| Post-conversion initialization | Deal create workflow plus Deluge function | Workflow, automation function, record read/write, task, and failure-read operations |
| Form 2 setup and authorization | Existing Contact, Account, and Deal fields | Record reads, Blueprint transition requirements, function-backed side effects, and timeline readback |
| QA and go-live control | Non-continuous Deal Blueprint on test status | Blueprint states/transitions and function-backed after-actions |
| Setup access, signature, activation, stop, and rollback | Restricted transitions/functions with external authoritative systems | Function and connection discovery/configuration; external systems remain authoritative for tokens, signatures, and routing state |
| Validation and promotion | CRM Sandbox when available | Read-only sandbox discovery; narrowly scoped validation and deployment on a separate Release role |

Blueprint required fields, reviewer notes, checklists, and transition validations are configured inside transition `during_inputs`, criteria, validation filters, and validation messages. They are not separate checklist tools.

## `crm-audit` — Read-Only Selection

### Keep Existing Core Reads

These are prerequisites for identity, metadata resolution, fresh prestate, duplicate review, and independent readback:

`getOrganization`, `getUsers`, `getProfiles`, `getRoles`, `getUserGroups`, `getGroup`, `getModules`, `getFields`, `getLayouts`, `getLayoutById`, `getPickListValues`, `getPipelines`, `getPipeline`, `getRecords`, `getRecord`, `searchRecords`, `getRelatedRecords`, and `getTimelines`.

Profiles, roles, groups, and users are needed to resolve Blueprint ownership and transition visibility from returned identifiers rather than guessing access targets.

### Add Workflow And Reusable-Action Reads

`getWorkflowConfigurations`, `getWorkflowRulesCount`, `getWorkflowRulesActionsCount`, `getWorkflowRules`, `getWorkflowRuleById`, `getWorkflowRuleUsage`, `getWorkflowTasks`, `getTaskById`, `getFieldUpdates`, and `getFieldUpdateById`.

### Add Blueprint Reads

`getBlueprintProcessConfigurationMeta`, `getBlueprint`, `getBlueprintId`, `getBlueprintStates`, `getBlueprintStateById`, `getBlueprintTransitions`, `getBlueprintTransitionById`, `getBlueprintUsageConfigurations`, and `getBlueprintRecordsCount`.

Enable `getRecordBlueprintTransition` only for controlled testing or troubleshooting of one record's currently available transitions. It reads runtime transition availability; it does not configure a Blueprint.

### Add Function Reads

`getFunctions`, `getFunction`, `getFunctionCode`, `getAllAutomationFunctions`, `getAutomationFunctions`, and `getAutomationFunctionFailures`.

### Add Connection Reads

`getConnections`, `getConnection`, `getConnectionServices`, and `getConnectionService`.

These expose configured connection metadata and authorization state, not secret values. Use them before authoring a function that calls Zoho Sign, Catalyst, or a phone provider. Never place access tokens, client secrets, provider credentials, or secret-bearing URLs in function source, CRM fields, repository files, prompts, or logs.

Custom-button reads are optional because the initial design uses Blueprint transitions and Zoho's standard Lead Convert action. Add `listCustomButtons`, `getCustomButtonById`, `getCustomButtonCount`, and `getCustomButtonAssociations` only if a later approved design introduces custom buttons.

### Add Conversion, Duplicate, Validation, Notification, And Webhook Reads

`getLeadConversionOptions`, `getDuplicateCheckPreference`, `getValidationRules`, `getValidationRule`, `getEmailNotifications`, `getEmailNotificationsById`, `getWebhooks`, `getWebhookById`, `getWebhookFailures`, and `getWebhookUsageReports`.

The Tool Manual catalog does not contain a Lead Conversion Mapping configuration action. `getLeadConversionOptions` is record-level duplicate/match evidence, not the module's conversion-mapping editor.

### Add Sandbox Discovery Reads When A CRM Sandbox Exists

`getAllSandbox`, `getSandboxById`, `getSandboxSupportedComponents`, `getSandboxChanges`, `getSpecificSandboxChange`, `getSandboxChangeAssociations`, `getSandboxChangesAssociations`, and `summaryOfAllSandboxes`.

Do not infer that a sandbox exists or supports a component until these reads confirm it. These production-connection discovery calls do not make ordinary Blueprint, workflow, function, or record operations target the sandbox. Authoring and testing in CRM Sandbox requires separate sandbox-authorized `crm-sandbox-audit` and `crm-sandbox-changes` connections with the same least-privilege subsets.

## `crm-automation-changes` — Configuration Selection

### Workflow, Task, And Field-Update Authoring

`postWorkflowRule`, `updateWorkflowRuleById`, `createWorkflowTasks`, `updateWorkflowTaskById`, `createFieldUpdates`, and `updateFieldUpdateById`.

Creation order is metadata and limits first, then reusable task/field-update actions, then the inactive workflow rule that references their returned identifiers. Activation is not proof of correct execution; verify with a disposable record and Audit readback.

### Blueprint Authoring

`postBlueprint`, `createBlueprintStates`, `createBlueprintTransitions`, `putBlueprintId`, `updateBlueprintStateById`, `updateBlueprintTransitionById`, `activateBlueprint`, and `deactivateBlueprint`.

Add `cloneBlueprint` only when an activated Blueprint requires structural replacement and the current contract has been inspected. The provider capture contains additional clone/editability cautions that are not stated as universal guarantees in Zoho's public API documentation; treat them as contract annotations to verify, not official prerequisites. Keep bulk Blueprint mutation operations disabled initially.

Before first activation, read the created Blueprint, states, transitions, usage configuration, and record count. Zoho marks `chart_data` optional in the request schema but says it is practically required before first activation so the Blueprint renders correctly; it must match the logical states, transitions, and connections. Inspect the current advertised contract and do not rely on a successful HTTP envelope without authoritative readback. Activation is high impact: `move_records=true` requires explicit state mapping, while `move_records=false` exits affected records from the current Blueprint at their last state. Deactivation is also state-changing: its `exit_records` choice can remove records from the process, so require fresh record counts and explicit approval immediately before use.

### Function Authoring And Automation Association

`createFunctions`, `updateFunction`, `postAutomationFunctions`, and `putAutomationFunctions`.

The intended initializer and restricted operational actions use Deluge, which the catalog describes as auto-published on create/update. Enable `publishFunction` only if the selected current contract or a non-Deluge runtime requires an explicit publish step. Use `getAutomationFunctionFailures` on Audit for acceptance and production exception review.

### Connection Configuration — Enable Only When A Required Connection Is Missing

`postConnections` and `putConnections`.

Connection authorization or reauthorization can require a protected user authentication handoff and must not accept credentials through chat. Prefer an existing, correctly scoped system service. Keep `postConnectionServices` disabled unless a separately reviewed custom service definition is genuinely required; it expands the authentication surface and may require confidential provider configuration.

### Duplicate Control And Global Validation — Enable Only If The Approved Design Uses Them

`createDuplicateCheckPreference`, `updateDuplicateCheckPreference`, `createValidationRule`, and `updateValidationRule`.

Prefer Blueprint transition requirements and server-side Form validation for the free-test process. A global validation rule can unexpectedly block Forms, conversion, functions, imports, or other API writes; add one only after tracing every writer.

### Internal Notifications And External Actions — Enable Only When Required

`postEmailNotifications`, `updateEmailNotification`, `createWebhooks`, `updateWebhookById`.

Use automation tasks and in-CRM notifications first. Enable outbound email or webhook definitions only for a named, approved recipient or endpoint and after confirming retry, authentication, payload minimization, failure reporting, and idempotency.

## Just-In-Time Runtime Actions

Keep these disabled until a controlled test or an exact live action is approved:

- `convertLead` — irreversible; call `getLeadConversionOptions` first and explicitly choose new or existing Contact and Account targets.
- `createRecords` — limited to a disposable acceptance record or an approved exception Task.
- `updateRecord` — exact ID-targeted post-conversion reconciliation or bounded operational update.
- `putRecordBlueprintTransition` — executes one record transition; it does not configure the Blueprint.
- `createCustomButton` and `updateCustomButton` — configure custom buttons only if Blueprint transitions cannot provide the approved action surface.
- `executeCustomButtonWithId` — executes a single-record button and may cause external side effects; enable only after such a button is approved and read back.

Do not substitute `upsertRecords` for an ID-targeted correction. Do not enable bulk record writes, merge, delete, recycle-bin, mass action, or multi-record custom-button execution for this workflow.

## Optional `crm-release` — Sandbox Promotion Only

Create a separate approval-gated Release role only when CRM Sandbox reads confirm the environment and supported components. The narrow initial selection is:

`validateSpecificChangeInSandbox`, `resolveSpecificSandboxChange`, and `deploySpecificChangeInSandbox`.

Do not enable bulk deployment, sandbox deletion, or production deployment until the exact change set, dependencies, validation output, rollback/containment, and post-deployment readback are approved. Zoho Forms and Zoho Flow integrations are not deployed through CRM Sandbox, so their configuration and acceptance tests remain separate. Sandbox-triggered emails are not delivered externally; verify them in CRM's Email related list or Outbox.

## Operations Intentionally Excluded

- all Blueprint, workflow, task, field-update, function, button, validation, webhook, record, and sandbox delete operations;
- `deleteConnections` and custom connection-service authoring by default;
- `putBlueprint`, `updateBlueprintStates`, and `updateBlueprintTransitions` bulk variants until a demonstrated need exists;
- `reorderBlueprints` and `reorderWorkflowRules` unless current precedence conflicts are proven;
- `executeCustomButton`, bulk record actions, mass updates, merges, owner changes, and record deletes;
- connected workflows, kiosks, review processes, approval processes, scoring, cadences, and wizards, because the approved free-test design does not require them;
- CRM Webforms, because Form 1 and Form 2 are owned by Zoho Forms; and
- speculative conversion-mapping payloads through field or layout APIs; and
- every `x...` record-operation alias when its canonical non-`x` key is available.

## Safe Build Order

1. Refresh Audit metadata and record the exact advertised contracts for every selected operation.
2. Resolve the five unsafe Lead Conversion Mapping entries manually in CRM because no catalog action was captured for that configuration surface; read field metadata back afterward.
3. Create reusable tasks and field updates, then create the Form 1 intake workflow inactive and acceptance-test it.
4. Build the Lead qualification Blueprint in draft, including mandatory fields, reviewer note, checklist, transition criteria, and post-actions; read every created object back before activation.
5. Keep Lead conversion a named human approval gate. Test `convertLead` only on a disposable canary after duplicate-option review.
6. Audit required CRM Connections, complete any protected authorization manually, then create and test the post-conversion initializer function and Deal workflow. Verify linked Contact, Account, and Deal postconditions and function-failure reporting.
7. Build the Deal limited-test Blueprint and restricted transition functions. Add custom buttons only if an approved action cannot be represented safely as a Blueprint transition. External setup access, signature, and phone-routing systems remain authoritative.
8. Test duplicate submissions, existing-record matches, missing consent, disqualification, function failure, repeated button clicks, stale state, callback replay, activation ambiguity, caps, stop, rollback, and reconciliation.
9. Promote through the Release role only when Sandbox support and an exact validated change set are proven; otherwise keep production rules inactive until a separately approved canary.
10. Perform independent Audit readback after every mutation and record only sanitized evidence.

## Official References

- [Zoho CRM API V8 index](https://www.zoho.com/crm/developer/docs/api/v8/)
- [Create Blueprint](https://www.zoho.com/crm/developer/docs/api/v8/create-blueprint.html)
- [Create Blueprint States](https://www.zoho.com/crm/developer/docs/api/v8/create-blueprint-states.html)
- [Create Blueprint Transitions](https://www.zoho.com/crm/developer/docs/api/v8/create-blueprint-transitions.html)
- [Update Blueprint Transitions](https://www.zoho.com/crm/developer/docs/api/v8/update-blueprint-transitions.html)
- [Activate Blueprint](https://www.zoho.com/crm/developer/docs/api/v8/activate-blueprint.html)
- [Clone Blueprint](https://www.zoho.com/crm/developer/docs/api/v8/clone-blueprint.html)
- [Configure Workflow Rule](https://www.zoho.com/crm/developer/docs/api/v8/config-workflow.html)
- [Workflow Configurations](https://www.zoho.com/crm/developer/docs/api/v8/workflow-configurations.html)
- [Automation Tasks](https://www.zoho.com/crm/developer/docs/api/v8/automation-tasks.html)
- [Create Field Update](https://www.zoho.com/crm/developer/docs/api/v8/create-field-update.html)
- [Lead Conversion Options](https://www.zoho.com/crm/developer/docs/api/v8/lead-conversion-options.html)
- [Convert Lead](https://www.zoho.com/crm/developer/docs/api/v8/convert-lead.html)
- [Update Records](https://www.zoho.com/crm/developer/docs/api/v8/update-records.html)
- [Enable Duplicate Check Preference](https://www.zoho.com/crm/developer/docs/api/v8/enable-duplicate-record-check.html)
- [CRM Sandbox deployment](https://help.zoho.com/portal/en/kb/crm/data-administration/sandbox/articles/deploy-sandbox)

## Deployment Boundary

Repository approval authorizes only this sanitized design record. It does not select tools in the Zoho portal, change OAuth grants, create CRM automation, alter conversion mappings, convert a Lead, execute a Blueprint transition, send a message, issue setup access, create a signature request, change a phone route, deploy a sandbox change, or authorize production traffic.
