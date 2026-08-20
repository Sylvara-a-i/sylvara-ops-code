# Zoho Forms Form 2 Controller

Reusable platform policy is centralized in the [Catalyst Standard](../../../docs/zoho/standards/catalyst.md), [workflow-intake standard](../../../docs/zoho/standards/workflow-and-intake.md), and [Zoho knowledge base](../../../docs/zoho/README.md). This file stays beside the package because it governs this exact implementation, Form 2 contract, deployment gates, validation, containment, and rollback.

**Repository status: proposed Development controller. On 2026-08-20, after all three Development tables were independently proven empty and the project was proven to have no function or API Gateway workload, the existing unique `ISSUE_KEY` column was renamed in place to `DEAL_ISSUANCE_KEY` and the session `LAST_OUTCOME` privacy flag was enabled. The complete 54-application-column schema, both session unique keys, empty state, table access, scopes, and both least-privilege CRM Connections were independently read back. Function, pipeline, runtime variables, and API routes: not deployed. Production: code-blocked.**

This Advanced I/O function issues expiring Form 2 links, serves secure dynamic prefill data, and applies one idempotent Form 2 submission to an existing Zoho CRM Contact, Account, and Deal. It does not create or convert Leads, send a link, change a phone route, approve go-live, sign an authorization, or replace CRM as the record system.

The implementation is based on the canonical [2026-08-14 Form 2 CRM contract](../../zoho-crm/reference/snapshots/2026-08-14/README.md), merged to `main` in PR #22. Older CRM field snapshots directly under `src/zoho-crm/reference/` are immutable historical evidence and are not sufficient implementation evidence.

## Ownership And Data Flow

- Zoho CRM owns Contact, Account, Deal, relationship, approved-route, test-control, workflow, Blueprint, and delivery state.
- Zoho Forms owns the respondent experience and an immutable Unique ID generated for each submitted entry.
- Catalyst owns opaque session verification, prefill-revision binding, durable submission receipts, bounded CRM mediation, and reconciliation state.
- GitHub owns sanitized source, tests, schemas, and runbooks. It does not own live routes, project IDs, form aliases, Connection names, secrets, tokens, endpoints, payloads, logs, or record data.

One Node.js 24 Advanced I/O function accepts three separately configured `POST` paths:

1. **Issue:** an internal caller provides one Deal ID and an immutable UUID v4 request ID. The function derives a retry-stable 256-bit bearer token, binds its HMAC and the restricted Contact, Account, and Deal IDs to one session, acquires the Deal's unique active-generation digest, conditionally marks setup access issued, then durably finalizes the session before returning the expiring Form URL.
2. **Prefill:** Zoho Forms provides the bearer token in a JSON body. The function verifies the session, marks setup access verified, reads the three current CRM records, creates an immutable prefill revision from their exact `Modified_Time` values and an HMAC snapshot fingerprint, and returns only the allowlisted Form 2 fields plus an opaque `prefillId`.
3. **Submission:** Zoho Forms supplies the token, `prefillId`, its server-generated Unique ID, and the flat allowlisted Form 2 fields. The function claims a unique durable receipt, rejects a stale revision, consumes the prefill once, and sends one ordered CRM Composite request: Contact, Account, then Deal, with rollback on failure and `If-Unmodified-Since` on every record. It acknowledges success only after independent CRM readback and a durable succeeded receipt.

The Deal subrequest is last so the active Form 2 workflow evaluates only after the related Contact and Account changes succeed. CRM's documented rollback behavior defers automation until all subrequests succeed; a rollback does not trigger the automation.

## Security Contract

- Production is rejected in `loadConfig()`. No variable can bypass the source-level block.
- The Form URL contains one 256-bit opaque bearer token and no CRM ID or PII. The token is never stored or logged; only a domain-separated HMAC is stored.
- An immutable issuance UUID produces the same token on an exact retry, allowing safe recovery if the first response is lost. The unique stored token HMAC is both the durable exact-retry identity and the bearer-token lookup key.
- A mandatory unique, domain-separated SHA-256 digest of the Deal ID is stable across token-pepper rotation and is the atomic active-generation lock. After exact expiry synchronization, the controller salts the released generation digest with the unique token HMAC so prior tombstones can coexist. The restricted session row already contains the bound Deal ID; the digests and every payload-derived `submitting_<fingerprint>` outcome are therefore private operational data.
- API Gateway authentication and throttling are required. Each route also verifies its own static custom header in constant time. Issue, prefill, and submission secrets are independently generated.
- Query strings are rejected by the function routes. The only query string is the outbound Zoho Forms link, where the token is assigned to the exact Prefill-Webhook field alias.
- Business Email is locked after verification. Mobile changes are rejected until a separate reverification workflow is approved and built.
- Current call handling, requested route, and approved route are display-only snapshots. Test duration, call limit, scope version, entry offer, intake provenance, and request notes remain server/workflow-owned and are independently checked during CRM readback.
- The client cannot submit CRM IDs, server timestamps, form versions, scope versions, test limits, or arbitrary fields.
- The two confirmations must be literal `true`. Their timestamps and the form version are generated by the controller.
- Raw bodies, tokens, headers, secrets, CRM responses, PII, routes, endpoints, record IDs, HMACs, and submission IDs are never logged. Logs contain only a random request ID, reviewed source revision, coarse stage/outcome, and elapsed time.
- No CORS header is emitted. All three supported callers are server-to-server.

## Durable State

[`config/datastore-schema.json`](config/datastore-schema.json) defines three Development tables.

- The session table uses exactly two unique varchar columns: `TOKEN_HASH` for exact issuance retries and bearer lookup, and `DEAL_ISSUANCE_KEY` for the active Deal generation. It stores the minimum CRM relationship context, expiry, attempts, and coarse state. A new row begins in a non-live `issuing` phase; the token is returned only after the optimistic CRM write and an exact `issued` row transition. Concurrent exact retries share one row and token, while the unique active Deal digest prevents a distinct generation from being inserted. Every distinct prefill preparation is bounded; concurrent exact requests converge on the same durable attempt and revision, while a later repeat consumes another attempt. Before any receipt claim, submission changes the session atomically to `submitting_<fingerprint>`; an exact succeeded receipt can repair that owner after a crash, while ownership is released only after an exact failed-receipt transition is durably read back. An elapsed `issued` or `verified` session records `crm_expiry_pending`; an elapsed `issuing` session records `issuing_expiry_pending` and conditionally fences CRM to Expired before any release. Only exact CRM convergence permits the active digest to rotate to a token-HMAC-salted terminal digest with `crm_expiry_synced`. `submitting`, submitted, failed, revoked, pending, and reconciliation rows keep the active digest and block reissue. The configured attempt ceiling is at least two so one post-verification prefill-store failure can still receive one bounded retry.
- The prefill table uses a unique `PREFILL_KEY` and stores the durable session-attempt number, the exact three CRM revision timestamps, and an HMAC of the allowlisted prefill snapshot. Its opaque prefill UUID and key are deterministic only from the server pepper, session row, and bounded attempt, so concurrent requests that share one successful attempt converge on one revision instead of multiplying rows. It does not store the prefill values.
- The submission table uses a unique `SUBMISSION_KEY`, a domain-separated HMAC `SUBMISSION_FINGERPRINT` over the canonical submission binding and values, a bounded lease, and a terminal receipt. It does not store the raw Zoho Forms Unique ID or body. A completed replay must match that fingerprint before CRM readback; changed data under the same ID is a conflict, and a new ID cannot create a receipt after the session is terminal. Only an explicitly recorded, unambiguous pre-commit dependency failure can be reclaimed, through a conditional lease rotation and up to the configured attempt ceiling; an expired in-flight lease is never replayed automatically. A lost failed-result response is not assumed to have committed: the exact row identity, lease, binding, attempt, failure outcome, and terminal timestamps must read back before the controller returns an ordinary error or releases the session. Otherwise all related durable state enters reconciliation and the caller receives an ambiguous 503.

When an unused session expires, the issue, prefill, or submission route first records a recoverable Data Store expiry phase, then conditionally updates and independently reads back the bound Deal's exact private Expired status, and finally rotates the unique active digest while recording the synchronized terminal outcome. A process restart resumes either pending phase. For stale `issuing` with exact CRM Initial state, the conditional Expired write carries the session's issued timestamp and fences a delayed concurrent Issued writer; if that writer wins first, the controller rereads exact Issued and expires it while still holding the active lock. Exact CRM Issued is finalized before expiry. Unknown or competing outcomes retain the active lock and enter reconciliation instead of returning a false terminal success. Only a fresh issuance UUID may create a replacement token after exact Expired convergence and absence of the active digest; the old token is never extended or revived.

The mandatory unique token HMAC and active Deal digest inserts are the issuance concurrency boundaries; non-unique history queries are not. A timeout or duplicate is resolved only by an exact unique-key point read. State transitions use one conditional ZCQL `UPDATE` whose `WHERE` clause includes the current state and lease or attempt value, followed by exact row readback. Cache and process memory are never authoritative.

CRM record IDs, the token HMAC, the Deal issuance digest, and payload-derived fingerprints are restricted linkable context even though they are not direct form fields. Block client table access, restrict operator reads, and enforce the privacy flags in the schema. Every session row is an issuance tombstone: do not delete or alter it under this controller, including a rotated expired row, because later reuse of the same immutable issuance UUID could otherwise recreate an old bearer token. Session removal requires a separately reviewed migration or an upstream UUID-deduplication design; prefill and receipt cleanup remains a separate private procedure.

## CRM Contract

The read Connection needs only:

- `ZohoCRM.modules.contacts.READ`
- `ZohoCRM.modules.accounts.READ`
- `ZohoCRM.modules.deals.READ`

The separate write Connection needs only:

- `ZohoCRM.modules.contacts.UPDATE`
- `ZohoCRM.modules.accounts.UPDATE`
- `ZohoCRM.modules.deals.UPDATE`
- `ZohoCRM.composite_requests.CUSTOM`

The Catalyst Connection must expose exactly one OAuth `Authorization` header and no query parameters. Raw OAuth client IDs, client secrets, access tokens, and refresh tokens are prohibited in source and function variables.

The controller updates Contact and Account respondent fields, then these Deal fields through one rollback Composite request:

- setup details, fallback, rollback, call handling, and alert recipients;
- both literal confirmations and their trusted timestamps;
- trusted Form submission identity, version, and submission timestamp; and
- the exact privately configured submitted setup-access status.

It deliberately does not update `Test_Duration_Days`, `Test_Call_Limit`, or `Test_Scope_Version`; current CRM initialization workflows own those values. The active Form 2 submitted workflow is expected to create the internal review task after the successful Deal update. It must not be duplicated in Catalyst.

`Setup_Form_Submission_ID` is case-insensitive unique in the current CRM snapshot. The globally namespaced Forms identity and unique Catalyst receipt remain the primary concurrency and replay boundaries because CRM uniqueness alone cannot atomically bind the full three-record submission. If CRM returns the documented rollback response with the Deal update failing as `DUPLICATE_DATA`, the controller treats it as a replay only after independent Contact, Account, and Deal reads match every intended update, relationship, and protected field. Any different response shape or readback enters normal rejection or reconciliation handling.

## Manual Development Setup

The Catalyst MCP catalog cannot create a project, create a function, or upload function source. The dedicated Development project, two CRM Connections, complete 54-column table schema, session-column rename, session `LAST_OUTCOME` privacy flag, empty table state, scopes, and permissions have current readback evidence. The GitHub pipeline, function, runtime variables, and routes do not. The reviewed Git pipeline will use the Catalyst CLI to create or update only `form2_controller` from this source; it does not rely on a nonexistent MCP source-upload action.

The canonical [2026-08-14 189-action catalog](../../../docs/zoho/mcp/reference/zoho-catalyst-tool-manual-catalog-2026-08-14.md), merged to `main` in PR #22, confirms that the complete Functions family is limited to Delete, five HTTP executions, Get, List, and runtime-only Update. It has no project creation, function creation, source upload, repository link, or Connection creation action. `Create Pipeline` creates a pipeline definition; it does not provision the first function or authorize GitHub.

If a later audit or recovery requires provider-mediated table work, keep the bounded Catalyst roles limited to:

- read: `List All Tables`, `Get Table By Id`, `List All Columns`, `Get Column By Id`, `Get Table Permissions`, and `Get Table Scopes`;
- schema write: `Update Column`, `Update Table Permissions`, and `Update Table Scopes`; and
- release, only after the console prerequisites exist: `Execute Pipeline Manually`.

Keep table, column, row, pipeline, deployment, route, and function deletion disabled. None of Execute Function via GET, PUT, PATCH, or DELETE is needed. `Update Function` cannot change source and should be used only for a reviewed stack or memory correction. The currently observed Execute Function via POST schema exposes no request-body argument, so it cannot run the required Form 2 smoke payload; use the disabled Development API route or a corrected provider schema instead.

1. Confirm and use the existing **dedicated Development Catalyst project** for this integration. Do not repurpose another project. Keep Production untouched.
2. In Catalyst Settings, connect the exact GitHub repository with the minimum repository permission. Create a GitHub-sourced pipeline pinned to the exact reviewed repository and `main` branch, with [`catalyst-pipelines.yaml`](../../../catalyst-pipelines.yaml) at the repository root. Protect `main`: prohibit force-push and direct push, require an independent pull-request approval, and require CODEOWNERS review for the pipeline file and [`scripts/deploy-development.sh`](scripts/deploy-development.sh). A Git-linked Catalyst pipeline starts automatically on a matching push or merge; the checked-in approval job must pause it before deployment. A repository writer can change pipeline code, so branch protection and independent review are part of the credential boundary—not optional process notes.
3. Before creating the pipeline, independently prove that every Catalyst global interpolated into command text—especially `CATALYST_TOKEN`—has an authoritative charset restricted to a conservative shell-safe, quote-free, and newline-free subset. Masking is only a log control and does not prevent pre-script interpolation injection. If the token's authoritative charset cannot be proven, stop or move it to a native non-text secret binding; do not create the pipeline with text interpolation. After that gate passes, configure globals `PROJECT_ID`, `CATALYST_ORG`, `CATALYST_TOKEN`, `APPROVED_SOURCE_REVISION`, and `DEPLOY_APPROVER_EMAIL`. `APPROVED_SOURCE_REVISION` must be the lowercase 40-character commit reviewed for this release, and the approver must independently compare it with the pipeline checkout. Generate the non-expiring Catalyst CLI token in a protected local session and use a dedicated least-privilege deployer. If the current console exposes a secret/masking control, enable it and verify masking in a harmless failed run; if it cannot prevent the token from appearing in logs, stop. Never paste the value into chat, GitHub, source, or logs.
4. Confirm the two existing Development CRM Connections still have exactly the scopes above. Select the correct Zoho organization and independently read back the private link names and granted scopes. If the connection UI cannot express the composite scope, stop; do not substitute broad CRM access without a new review.
5. **Completed in Development on 2026-08-20:** all three tables were empty and no function or API Gateway workload existed; the existing private, mandatory, unique `ISSUE_KEY` varchar(64) column was renamed in place to `DEAL_ISSUANCE_KEY`; the private-data flag was enabled on session `LAST_OUTCOME`; and the complete 54-column schema, type, length, mandatory, unique, privacy, scope, permission, and client-access state were independently read back. `TOKEN_HASH` and `DEAL_ISSUANCE_KEY` are the session table's only unique varchar columns. Any future schema replacement still requires a new zero-row proof or a reviewed migration.
6. Set every variable name in [`functions/form2_controller/.env.example`](functions/form2_controller/.env.example) in Catalyst Development. Set `SOURCE_REVISION` to the same reviewed 40-character commit as `APPROVED_SOURCE_REVISION`. Use independent random values for all four secrets, the exact US CRM V8 base URL, the exact default `forms.zohopublic.com` Form URL, all five current private setup-access status values, the private phone-system-provider and field-team-size allowlists, and private paths/identifiers. The provider list accepts 1–256 distinct exact trimmed values; every provider value must be 120 characters or fewer. The field-team list remains limited to 1–20 values. Custom Forms domains and non-US data-center hosts are deliberately rejected; adding one requires an exact source allowlist change and security review. Never upload a populated environment file.
7. Approve the pipeline only after its checkout exactly matches `APPROVED_SOURCE_REVISION`. Use an x86-64 Catalyst Ubuntu runner that provides Bash, the preinstalled Catalyst CLI, curl, Git, Python 3, SHA-256 tooling, tar, and xz; the script checks each prerequisite and fails before deployment rather than silently changing the runner. The checked-in [`scripts/deploy-development.sh`](scripts/deploy-development.sh) rejects a dirty or different checkout, verifies the pinned Node.js 24.19.0 archive checksum, requires the runner's preinstalled Catalyst CLI to report exactly 1.26.1, and runs the repository safety scanner. It then creates separate immutable Git-object exports for testing and deployment, installs the exact locked dependency tree in isolated credential-free npm environments, proves the tested and deployable dependency manifests are identical, rejects source drift or escaping symlinks, physically removes tests and environment examples, stamps and verifies the otherwise fail-closed artifact revision, and executes one US-region Development-only deploy with `--only functions:form2_controller`. It never packages ignored runner files, copies `.catalystrc`, mutates the checkout, or installs a mutable CLI dependency graph. The package root contains `catalyst.json`; the function contains `catalyst-config.json`, exact Node 24 runtime metadata, and an exact-version SDK lockfile. It does not deploy tables, routes, another function, or Production.
8. After function and deployment readback, create three custom API Gateway routes. Use `POST` only—never `ANY`—target the matching Advanced I/O paths, enable API Key authentication, pass the key only through `ZCFKEY` headers, and configure both general and IP throttling. Use different route-specific application secrets in addition to the API key.
9. Record the Development function, deployment, pipeline, routes, table schemas, Connection scope readback, source revision, and smoke-test result in the private deployment log. Do not publish identifiers or screenshots containing values.

In a project that already serves traffic, enabling API Gateway disables Security Rules and makes old URLs inaccessible until APIs exist. The required dedicated project should have no prior workload, but still create and verify all routes before treating the gateway as ready.

## Zoho Forms Configuration

Use one dedicated Form 2. Disable any native Forms-to-CRM update integration for these same fields so only this controller writes CRM.

1. Add a Prefill-Webhook field backed by a Single Line value and give it the exact private alias configured in `FORM2_TOKEN_FIELD_ALIAS`. Mark it personal/encrypted and hidden or locked if the current Forms UI supports that combination. The live acceptance test must prove that Field Alias prefill still auto-triggers while the value is not respondent-editable.
2. Configure the Prefill-Webhook as `POST` to the private prefill route with JSON containing only `setupToken`. Add `ZCFKEY` and the configured Forms header with the prefill-specific secret. Do not place either secret in the URL.
3. Map the returned flat keys to the 35 approved Form 2 fields. Add one hidden, locked `prefillId` field and map the response `prefillId` into it. The 36 total mappings remain below Zoho Forms' documented 50-mapping limit. Configure Phone Provider or System as a dropdown whose stored values exactly match `FORM2_PHONE_SYSTEM_PROVIDERS`; the controller rejects unknown values and values longer than its 120-character CRM boundary.
4. Keep Business Email, Mobile, Current Call Handling, Originally Requested Route, and Approved Test Route read-only after prefill. Mobile is intentionally locked until reverification exists.
5. Add Zoho Forms' server-generated **Unique ID** field for immutable submission identity. Configure a numeric counter only, with no field-derived prefix or suffix, and keep the emitted value to 30 decimal digits or fewer. Do not use respondent-controlled hidden text as the submission ID; the controller rejects decorated identifiers.
6. Configure the submission webhook as JSON `POST` to the private submission route. Send flat `setupToken`, `prefillId`, `submissionId`, and every approved camelCase field listed in `lib/form-contract.js`. Add `ZCFKEY` and the submission-specific Forms secret header.
7. Configure `servicesHandled` as a JSON array. If the current Forms merge engine emits a delimited string instead, stop and capture a private synthetic fixture; do not loosen parsing based on a guess.
8. Keep all CRM IDs and original request provenance out of the Form URL, fields, rules, and webhook body.

## Development Acceptance Gates

Activation requires current synthetic evidence for every item below:

- the session table is independently proven empty before the schema change, the existing `ISSUE_KEY` column is renamed to mandatory unique `DEAL_ISSUANCE_KEY`, and the private session `LAST_OUTCOME` flag is provisioned and read back as part of the full 54-column contract;
- every global interpolated into pipeline command text has an independently proven conservative shell-safe, quote-free, newline-free charset, or is moved to a native non-text secret binding before pipeline creation;
- the hosted runtime injects or overwrites `x-zc-environment`, and the SDK reports the same Development environment;
- both Connections return exactly one approved Authorization header and the composite scope succeeds;
- the session token-HMAC and active-Deal unique conflicts, the prefill and submission unique conflicts, and conditional ZCQL behaviors match the pinned SDK under concurrent requests;
- the Prefill-Webhook auto-search fires from the Field Alias link while the token cannot be edited;
- the Unique ID exists before the submission webhook, is a 1–30 digit server counter with no prefix or suffix, is immutable, and remains stable across both permitted failed-entry re-pushes;
- Forms sends the exact flat JSON types, especially the multi-select array and literal booleans;
- valid prefill returns no CRM IDs, stale prefill fails with no write, and an old browser tab cannot overwrite a newer snapshot;
- an exact duplicate submission produces one CRM outcome and a successful duplicate acknowledgment;
- changed data under a completed submission ID and a new ID after session completion both fail before a receipt claim or CRM call;
- invalid, expired, revoked, conflicting, oversized, malformed, unknown-field, wrong-header, and wrong-route requests fail closed;
- issue-route recovery converges unused `issued`, unused `verified`, restarted pending, and stale `issuing` generations in both durable session state and the bound Deal before releasing the active digest; a fresh issuance UUID can safely reissue from exact Expired state, and an old token cannot revive;
- a failed middle CRM subrequest rolls back all three writes and does not trigger the Form 2 workflow;
- a successful Composite triggers the existing internal review task exactly once, and independent readback matches every updated and preserved field;
- timeout-before-commit and timeout-after-possible-commit paths enter reconciliation without blind replay, and no ordinary submission error or ownership release occurs until the exact failed receipt is independently proven;
- logs and platform traces contain no bearer token, custom header, route, endpoint, ID, form data, CRM response, or secret; and
- route disablement, Connection revocation, immutable redeploy/rollback, and reconciliation procedures work as documented.

Activation blocker: the current `Begin Setup and QA` Blueprint transition unconditionally requires `No_Answer_Delay`, `Approved_Fallback_Number`, and `Alert_Recipient_Email`, while the approved Form 2 contract correctly makes the first two conditional and permits either alert mobile or email. Keep every route disabled until the Blueprint or an equivalent transition control implements those same conditions and independent readback plus synthetic transition tests pass. Do not force irrelevant placeholder values or weaken the approved Form 2 conditions to satisfy the current Blueprint defect.

Other known CRM gaps remain outside this controller: current Blueprint transitions have no after-actions, so Deal Stage and `Test_Status` can drift. Form 2 completion is not go-live approval and must not advance phone routing automatically.

## Containment And Rollback

If Development misbehaves:

1. Disable the three API Gateway routes first.
2. Revoke the write Connection if CRM mutation must stop independently.
3. Preserve session, prefill, receipt, deployment, and CRM readback evidence; do not delete rows or blindly re-push uncertain submissions.
4. Reconcile every `processing`, `failed`, or `reconciliation_required` receipt against the exact CRM records and Forms entry in a private operator workflow.
5. Redeploy only the last separately reviewed immutable Development artifact. If none exists, leave the routes disabled.
6. Re-enable only after the full synthetic issue, prefill, submit, readback, and duplicate sequence passes.

Production requires a separate source change that removes the hard block, a new security review, isolated Production tables/routes/secrets/Connections, Development evidence, an immutable artifact, explicit approval, monitoring, containment, and independent post-deploy readback.

## Local Validation

From `functions/form2_controller` with Node.js 24:

```powershell
npm ci --ignore-scripts
npm run ci
```

Then run the repository verifier from the repository root:

```powershell
pwsh -NoProfile -File ./tools/verify.ps1
```

Tests use synthetic records only. Passing tests prove local policy behavior, not a live Forms, CRM, Connection, Data Store, API Gateway, pipeline, or deployment contract.

## Official References

- [Zoho Forms Prefill-Webhook](https://help.zoho.com/portal/en/kb/forms/field-types/form-fields/prefill/articles/prefill-webhook)
- [Zoho Forms webhook configuration](https://help.zoho.com/portal/en/kb/forms/integrations/webhooks/articles/webhook-configuration)
- [Catalyst Advanced I/O](https://docs.catalyst.zoho.com/en/serverless/help/functions/advanced-io/)
- [Catalyst API Gateway key concepts](https://docs.catalyst.zoho.com/en/cloud-scale/help/api-gateway/key-concepts/)
- [Catalyst Connections](https://docs.catalyst.zoho.com/en/cloud-scale/help/connections/introduction/)
- [Catalyst ZCQL execution](https://docs.catalyst.zoho.com/en/sdk/nodejs/v2/cloud-scale/zcql/execute-zcql-query/)
- [Catalyst Pipelines](https://docs.catalyst.zoho.com/en/pipelines/help/catalyst-pipelines.yaml/introduction/)
- [Catalyst pipeline images](https://docs.catalyst.zoho.com/en/pipelines/help/catalyst-pipelines.yaml/build-the-pipeline/images/)
- [Catalyst deployment pipeline](https://docs.catalyst.zoho.com/en/pipelines/help/deployments/deploy-to-catalyst/)
- [Catalyst CLI deployment scope](https://docs.catalyst.zoho.com/en/cli/v1/deploy-resources/introduction/)
- [Catalyst CLI deploy options](https://docs.catalyst.zoho.com/en/cli/v1/deploy-resources/deploy-options/)
- [Catalyst CLI release notes](https://docs.catalyst.zoho.com/en/release-notes/cli/)
- [Zoho CRM V8 get records](https://www.zoho.com/crm/developer/docs/api/v8/get-records.html)
- [Zoho CRM V8 update records](https://www.zoho.com/crm/developer/docs/api/v8/update-records.html)
- [Zoho CRM V8 Composite API](https://www.zoho.com/crm/developer/docs/api/v8/composite-api.html)
