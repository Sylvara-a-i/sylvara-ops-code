# Zoho Forms Form 2 Controller

Reusable platform policy is centralized in the [Catalyst Standard](../../../docs/zoho/standards/catalyst.md), [workflow-intake standard](../../../docs/zoho/standards/workflow-and-intake.md), and [Zoho knowledge base](../../../docs/zoho/README.md). This file stays beside the package because it governs this exact implementation, Form 2 contract, deployment gates, validation, containment, and rollback.

**Repository status: Development schema verified, controller not cut over. On 2026-08-24, the four exact operational targets—`Form2SessionsV3Runtime`, `Form2PrefillsV3`, `Form2SubmissionsV3`, and `Form2VerificationProofsV3`—were independently read back in the existing Retell Catalyst Development project with 81 application columns, five unique columns, 25 audit-consent columns, zero schema mismatches, zero rows, no App User access, and four administrator permissions per table. Three empty probe artifacts remain quarantined and unbound; they must never be used or deleted by this release. Fresh read-only reconciliation still authorizes zero version-2 promotion. On 2026-08-23, both Form 2 CRM Connections were read back as Connected with the exact approved scopes; their private link names remain outside Git, and CRM-organization binding and runtime behavior are still unverified. The version-2 stores and legacy Form 2 path remain live. The Retell-target function, variables, six API routes, Catalyst Mail sender, and Forms callers have not been deployed, cut over, or runtime-tested. Production remains code-blocked.**

This Advanced I/O function issues expiring Form 2 links, serves secure dynamic prefill data, and applies one idempotent Form 2 submission to an existing Zoho CRM Contact, Account, and Deal. It does not create or convert Leads, send a link, change a phone route, approve go-live, sign an authorization, or replace CRM as the record system.

The implementation is based on the canonical [2026-08-14 Form 2 CRM contract](../../zoho-crm/reference/snapshots/2026-08-14/README.md), merged to `main` in PR #22. Older CRM field snapshots directly under `src/zoho-crm/reference/` are immutable historical evidence and are not sufficient implementation evidence.

## Ownership And Data Flow

- Zoho CRM owns Contact, Account, Deal, relationship, approved-route, test-control, workflow, Blueprint, and delivery state.
- Zoho Forms owns the respondent experience and an immutable Unique ID generated for each submitted entry.
- Catalyst owns opaque invitation-session state, durable email-OTP proof, prefill-revision binding, durable submission receipts, bounded CRM mediation, and reconciliation state. The proof destination is always the current CRM-bound Contact email. Development provider sending additionally requires its domain-separated destination HMAC in the private recipient allowlist; stub mode never invokes Mail. CAPTCHA is optional bot mitigation, not identity proof. SMS is outside the approved workflow.
- GitHub owns sanitized source, tests, schemas, and runbooks. It does not own live routes, project IDs, form aliases, Connection names, secrets, tokens, endpoints, payloads, logs, or record data.

One Node.js 24 Advanced I/O function accepts six exact paths:

1. **Issue (`POST`):** an administrator-restricted caller provides one Deal ID and an immutable UUID v4 request ID. The function derives a retry-stable bearer token, binds its HMAC and restricted CRM context to one durable session, conditionally marks setup access issued, and returns the Catalyst access URL with the token only in its URL fragment.
2. **Access (`GET`):** Catalyst serves a self-contained, nonce-CSP, no-store email-verification page. The browser removes the token fragment immediately and sends no token through a query string.
3. **OTP request (`POST`):** the controller resolves the session and current CRM records, selects only the current Contact email, durably claims one send, and invokes Catalyst Mail only in the explicitly configured Development send mode. The browser says that a code was sent only after an authoritative provider acceptance; in-flight, retryable, stubbed, ambiguous, and terminal outcomes remain distinct. It stores no email address or raw OTP.
4. **OTP verify (`POST`):** the controller serializes code comparisons with a short durable lease, validates the bound OTP HMAC with bounded attempts and expiry, records a durable verified proof, and returns the exact stamped Zoho Forms destination.
5. **Prefill (`POST`):** Zoho Forms supplies the bearer token. The controller consumes one exact verified proof, verifies CRM relationships and versions, marks setup access verified, creates an immutable prefill revision, and returns only allowlisted fields plus an opaque `prefillId`.
6. **Submission (`POST`):** Zoho Forms supplies the token, `prefillId`, server-generated Unique ID, and allowlisted fields. The controller claims one durable receipt, rejects a stale revision, consumes the prefill once, and sends one ordered rollback-enabled CRM Composite request: Contact, Account, then Deal. Success requires independent CRM readback and a durable succeeded receipt.

Possession of the opaque invitation token alone cannot set setup access to Verified. A fresh email OTP must be delivered to the current CRM-bound Contact email, verified within the configured lifetime and attempt ceiling, and durably consumed for the exact session and CRM binding. Destination changes, replay, provider ambiguity, and state conflicts fail closed or enter reconciliation. Native Forms Email OTP and CAPTCHA are not trusted proof for this controller. Do not configure an SMS provider or SMS OTP.

The Deal subrequest is last so the active Form 2 workflow evaluates only after the related Contact and Account changes succeed. CRM's documented rollback behavior defers automation until all subrequests succeed; a rollback does not trigger the automation.

## Security Contract

- Production is rejected in `loadConfig()`. No variable can bypass the source-level block.
- The Catalyst access URL contains one 256-bit opaque bearer token in its fragment and no CRM ID or PII. Its host must be an approved Catalyst Development host. The token is never stored or logged; only a domain-separated HMAC is stored.
- An immutable issuance UUID produces the same token on an exact retry while the pepper is unchanged. A mandatory unique, domain-separated SHA-256 digest of that UUID is the durable issuance identity and remains stable across `TOKEN_PEPPER` rotation. The separately stored token HMAC is the bearer lookup key; a rotated pepper therefore invalidates the prior bearer without allowing the same UUID to mint a new one.
- A mandatory unique, domain-separated SHA-256 digest of the Deal ID is stable across token-pepper rotation and is the atomic active-generation lock. After exact expiry synchronization, the controller salts the released generation digest with the stable issuance-request digest so prior tombstones can coexist. The restricted session row already contains the bound Deal ID; the digests and every payload-derived `submitting_<fingerprint>` outcome are therefore private operational data.
- API Gateway authentication and throttling are required. Issue, prefill, and submission additionally verify independently generated static custom headers in constant time. The same-origin access and OTP browser routes expose no shared secret and remain protected by the high-entropy token, strict schemas, and tighter throttles.
- Query strings are rejected by every function route. The setup token reaches the access page only in a URL fragment; the verified redirect assigns it to the exact Zoho Forms Prefill-Webhook field alias.
- `SESSION_TTL_SECONDS` is the invitation lifetime. `FORM2_PROOF_TTL_SECONDS`, send/attempt ceilings, and resend cooldown independently bound email proof. On the first verified prefill transition, the controller replaces `EXPIRES_AT` with exactly 30 minutes from `VERIFIED_AT`; retries cannot extend it.
- Business Email is locked after verification. Mobile changes are rejected until a separate reverification workflow is approved and built.
- Current call handling, requested route, and approved route are display-only snapshots. The assigned test phone number is omitted from Form 2 and preserved as Setup/QA-owned state. Test duration, call limit, scope version, entry offer, intake provenance, and request notes remain server/workflow-owned and are independently checked during CRM readback.
- The client cannot submit CRM IDs, server timestamps, form versions, scope versions, test limits, or arbitrary fields.
- The two confirmations must be literal `true`. Their timestamps and the form version are generated by the controller. `Authorized_Representative_Confirmed` and `Authority_Confirmed_At` record respondent attestation only; they are not a signature, signed-authorization evidence, or go-live approval.
- Raw bodies, tokens, headers, secrets, CRM responses, PII, routes, endpoints, record IDs, HMACs, and submission IDs are never logged. Logs contain only a random request ID, reviewed source revision, coarse stage/outcome, and elapsed time.
- No CORS header is emitted. Browser calls are same-origin; Issue, Prefill, and Submission are server-to-server.
- The checked-in Catalyst pipeline cannot invoke the deployment script. Its Development job unconditionally exits with failure until Catalyst's native secret-binding contract is independently verified and a separately reviewed source change restores deployment.

## Durable State

[`config/datastore-schema.json`](config/datastore-schema.json) defines four new additive Development version-3 tables. Neither existing version-2 store is renamed, updated, deleted, or backfilled.

- The version 3 session table uses exactly two unique varchar columns: `ISSUE_REQUEST_KEY` for immutable issuance identity and `DEAL_ISSUANCE_KEY` for the active Deal generation. `ACCESS_TOKEN_HASH` is mandatory and private but deliberately non-unique; any non-unique lookup still fails closed if more than one row is returned. The table stores the minimum CRM relationship context, expiry, attempts, and coarse state. A new row begins in a non-live `issuing` phase; the token is returned only after the optimistic CRM write and an exact `issued` row transition. Concurrent exact retries share one row and token, while the unique active Deal digest prevents a distinct generation from being inserted. Every distinct prefill preparation is bounded; concurrent exact requests converge on the same durable attempt and revision, while a later repeat consumes another attempt. Before any receipt claim, submission changes the session atomically to `submitting_<fingerprint>`; an exact succeeded receipt can repair that owner after a crash, while ownership is released only after an exact failed-receipt transition is durably read back. An elapsed `issued` or `verified` session records `crm_expiry_pending`; an elapsed `issuing` session records `issuing_expiry_pending` and conditionally fences CRM to Expired before any release. Only exact CRM convergence permits the active digest to rotate to an issuance-request-key-salted terminal digest with `crm_expiry_synced`. `submitting`, submitted, failed, revoked, pending, and reconciliation rows keep the active digest and block reissue. The configured attempt ceiling is at least two so one post-verification prefill-store failure can still receive one bounded retry.
- The prefill table uses a unique `PREFILL_KEY` and stores the durable session-attempt number, the exact three CRM revision timestamps, and an HMAC of the allowlisted prefill snapshot. Its opaque prefill UUID and key are deterministic only from the server pepper, session row, and bounded attempt, so concurrent requests that share one successful attempt converge on one revision instead of multiplying rows. It does not store the prefill values.
- The submission table uses a unique `SUBMISSION_KEY`, a domain-separated HMAC `SUBMISSION_FINGERPRINT` over the canonical submission binding and values, a bounded lease, and a terminal receipt. It does not store the raw Zoho Forms Unique ID or body. A completed replay must match that fingerprint before CRM readback; changed data under the same ID is a conflict, and a new ID cannot create a receipt after the session is terminal. Only an explicitly recorded, unambiguous pre-commit dependency failure can be reclaimed, through a conditional lease rotation and up to the configured attempt ceiling; an expired in-flight lease is never replayed automatically. A lost failed-result response is not assumed to have committed: the exact row identity, lease, binding, attempt, failure outcome, and terminal timestamps must read back before the controller returns an ordinary error or releases the session. Otherwise all related durable state enters reconciliation and the caller receives an ambiguous 503.
- The proof table uses a unique `PROOF_KEY` and stores only domain-separated binding, destination, and OTP HMACs plus bounded send/attempt state and provider-result evidence. It never stores the raw OTP or email. Mail uses a two-phase durable claim: `claimed` proves that no provider invocation began, while `invoking` records the invocation boundary before Catalyst Mail is called. `FORM2_PROOF_SEND_LEASE_SECONDS` bounds either phase. A stale pre-invocation claim can be released for a bounded retry; a stale or interrupted post-invocation claim becomes ambiguous and is never blindly resent. An accepted code that expires at the send ceiling becomes terminal rather than continuing to report sent.

When an unused session expires, the issue, prefill, or submission route first records a recoverable Data Store expiry phase, then conditionally updates and independently reads back the bound Deal's exact private Expired status, and finally rotates the unique active digest while recording the synchronized terminal outcome. A process restart resumes either pending phase. For stale `issuing` with exact CRM Initial state, the conditional Expired write carries the session's issued timestamp and fences a delayed concurrent Issued writer; if that writer wins first, the controller rereads exact Issued and expires it while still holding the active lock. Exact CRM Issued is finalized before expiry. Unknown or competing outcomes retain the active lock and enter reconciliation instead of returning a false terminal success. Only a fresh issuance UUID may create a replacement token after exact Expired convergence and absence of the active digest; the old token is never extended or revived.

The mandatory unique issuance-request digest and active Deal digest inserts are the issuance concurrency boundaries; the non-unique access-token lookup is not. A timeout or duplicate issuance is resolved only by the unique issuance-request key. State transitions use one conditional ZCQL `UPDATE` whose `WHERE` clause includes the current state and lease or attempt value, followed by exact row readback. Cache and process memory are never authoritative.

CRM record IDs, the issuance-request digest, token HMAC, Deal issuance digest, and payload-derived fingerprints are restricted linkable context even though they are not direct form fields. Block client table access, restrict operator reads, and enforce the privacy flags in the schema. Every session row is an issuance tombstone: do not delete or alter it under this controller, including a rotated expired row, because later reuse of the same immutable issuance UUID could otherwise recreate a bearer after key rotation. Session removal requires a separately reviewed migration; prefill and receipt cleanup remains a separate private procedure.

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

The Catalyst MCP catalog cannot create a project, create a function, or upload function source. The existing Retell Development project contains the preserved Form 2 version-2 stores and the four empty operational version-3 targets described above. `Form2SessionsV3` and the two `ZZZ_Quarantined_*` artifacts are empty schema probes only; the controller must bind to `Form2SessionsV3Runtime` and must never bind or delete a probe. The two target CRM Connections have current console evidence for their private link names, Connected status, and exact grants, but not for the bound CRM organization or runtime behavior. The legacy Form 2 path remains live; none of this proves the Retell-target function, variable binding, routes, Catalyst Mail behavior, Forms callers, deployment, or runtime state. The checked-in pipeline remains containment-only.

The canonical [2026-08-14 189-action catalog](../../../docs/zoho/mcp/reference/zoho-catalyst-tool-manual-catalog-2026-08-14.md), merged to `main` in PR #22, confirms that the complete Functions family is limited to Delete, five HTTP executions, Get, List, and runtime-only Update. It has no project creation, function creation, source upload, repository link, or Connection creation action. `Create Pipeline` creates a pipeline definition; it does not provision the first function or authorize GitHub.

If a later audit or recovery requires provider-mediated table work, keep the bounded Catalyst roles limited to:

- read: `List All Tables`, `Get Table By Id`, `List All Columns`, `Get Column By Id`, `Get Table Permissions`, and `Get Table Scopes`;
- schema write: `Update Column`, `Update Table Permissions`, and `Update Table Scopes`; and
- release, only after the console prerequisites exist: `Execute Pipeline Manually`.

Keep table, column, row, pipeline, deployment, route, and function deletion disabled. None of Execute Function via GET, PUT, PATCH, or DELETE is needed. `Update Function` cannot change source and should be used only for a reviewed stack or memory correction. The currently observed Execute Function via POST schema exposes no request-body argument, so it cannot run the required Form 2 smoke payload; use the disabled Development API route or a corrected provider schema instead.

1. Confirm and use the existing **Retell Catalyst project in Development**. Inventory and independently read back its current functions, routes, tables, Connections, variables, Security Rules or API Gateway state, and deployments before any cutover. Keep the copied version-2 tables and legacy Form 2 project live and Production untouched.
2. Do not create, enable, or manually execute a GitHub-sourced Catalyst deployment pipeline from this repository yet. If one already references [`catalyst-pipelines.yaml`](../../../catalyst-pipelines.yaml), keep it disabled. The checked-in Development job exits unconditionally and is containment, not deployment authorization. Before future activation, pin the exact repository and reviewed `main` revision, grant minimum repository permission, prohibit force-push and direct push, and enforce independent pull-request and CODEOWNERS approval for the pipeline and [`scripts/deploy-development.sh`](scripts/deploy-development.sh). The current sole-owner CODEOWNERS configuration is not independent approval.
3. The prior pipeline design interpolated `PROJECT_ID`, `CATALYST_ORG`, `CATALYST_TOKEN`, and `APPROVED_SOURCE_REVISION` directly into shell command text. Shell quoting and masking cannot make pre-script substitution safe. Keep the unconditional failure step until current Catalyst documentation and a harmless isolated Development test independently prove a native secret/config binding that supplies exact process-environment values—including `APPROVED_FORM2_DESTINATION_SHA256`—without rendering them into command text, validates the reviewed revision and normalized Form URL digest outside attacker-controlled shell text, prevents disclosure, and supports a least-privilege deployer. Restoring script invocation requires a separate security review, regression tests, and reviewed source change. Never paste a credential into chat, GitHub, source, command text, or logs.
4. **Connection-console check completed on 2026-08-23:** both Form 2-specific CRM Connections are Connected with exactly the scopes above. Re-read their private link names and grants, then prove the intended CRM organization through harmless authenticated reads before binding variables. Do not treat legacy Connections as target evidence or reuse Form 1 or Retell call-processing Connections. If the UI cannot express the composite scope, stop rather than broadening access.
5. **Version 3 targets verified but not bound:** the four exact operational targets are empty and match [`config/datastore-schema.json`](config/datastore-schema.json). Re-read them immediately before deployment and abort on any row or schema drift. Preserve every version-2 row; do not rename, overwrite, backfill, or promote it. The current sanitized reconciliation remains zero-promotion: two terminal sessions, one reconciliation quarantine, one state conflict, eight missing prefills, 13 retained prefills, and no submissions. Both nonterminal sessions are time-expired. Keep all three probe artifacts quarantined and unbound.
6. Set every variable name in [`functions/form2_controller/.env.example`](functions/form2_controller/.env.example) in Catalyst Development. Set `SOURCE_REVISION` to the reviewed commit. Normalize the reviewed `FORM2_PUBLIC_URL`, calculate its lowercase SHA-256, and provide it only to the isolated artifact-stamping step as `APPROVED_FORM2_DESTINATION_SHA256`; a checkout remains unstamped and fails closed. Use independent values for every secret, exact endpoints and statuses, and private identifiers. Never upload a populated environment file.
7. Keep [`scripts/deploy-development.sh`](scripts/deploy-development.sh) unreachable while the native secret-binding contract is unverified. It remains a reviewed Development-only candidate: it rejects a dirty or different checkout, verifies pinned Node and Catalyst CLI versions, runs the safety scanner, proves artifact equivalence, and stamps the reviewed revision and approved Form destination only into isolated temporary exports. A separately reviewed pipeline change plus independent post-deployment readback are still required.
8. After function and deployment readback, create the six exact routes in [`config/routes.json`](config/routes.json): one `GET` Access route and five `POST` routes. Never use `ANY`. Apply the listed authentication and both general/IP throttles. Because this shared project contains other workloads, leave API Gateway disabled until every existing route has an equivalent preservation and rollback plan.
9. Record the Development function, deployment, pipeline, routes, table schemas, Connection scope readback, source revision, and smoke-test result in the private deployment log. Do not publish identifiers or screenshots containing values.

The Retell Development project already contains other workloads. Enabling API Gateway can disable Security Rules and make old URLs inaccessible until equivalent APIs exist. Inventory the current project-wide routing mode and every existing route first. Do not enable, reset, or replace API Gateway to add Form 2; preserve and verify every existing Retell route, create only the six unique Form 2 routes, and stop if the platform cannot provide a non-disruptive migration with rollback.

## Zoho Forms Configuration

Use one dedicated Form 2. Disable any native Forms-to-CRM update integration for these same fields so only this controller writes CRM.

1. Add a Prefill-Webhook field backed by a Single Line value and give it the exact private alias configured in `FORM2_TOKEN_FIELD_ALIAS`. Mark it personal/encrypted and hidden or locked if the current Forms UI supports that combination. The live acceptance test must prove that Field Alias prefill still auto-triggers while the value is not respondent-editable.
2. Configure the Prefill-Webhook as `POST` to the private prefill route with JSON containing only `setupToken`. Add `ZCFKEY` and the configured Forms header with the prefill-specific secret. Do not place either secret in the URL.
3. Map the returned flat keys to the 33 approved Form 2 client fields. Add one hidden, locked `prefillId` field and map the response `prefillId` into it. The 34 total mappings remain below Zoho Forms' documented 50-mapping limit. Do not add a respondent-controlled test-number field; Setup/QA owns that assignment. Configure Phone Provider or System as a dropdown whose stored values exactly match `FORM2_PHONE_SYSTEM_PROVIDERS`; the controller rejects unknown values and values longer than its 120-character CRM boundary.
4. Keep Business Email, Mobile, Current Call Handling, Originally Requested Route, and Approved Test Route read-only after prefill. Mobile is intentionally locked until reverification exists.
5. Use the Catalyst access page and email-OTP routes before redirecting to Form 2. The controller selects only the current CRM-bound Contact email, enforces proof expiry, resend and attempt ceilings, consumes the proof once, and rejects replay or tampering. Disable native Forms Email OTP after cutover so there is one proof authority. CAPTCHA may remain optional bot mitigation only. SMS is outside this workflow.
6. Add Zoho Forms' server-generated **Unique ID** field for immutable submission identity. Configure a numeric counter only, with no field-derived prefix or suffix, and keep the emitted value to 30 decimal digits or fewer. Do not use respondent-controlled hidden text as the submission ID; the controller rejects decorated identifiers.
7. Configure the submission webhook as JSON `POST` to the private submission route. Send flat `setupToken`, `prefillId`, `submissionId`, and every approved camelCase field listed in `lib/form-contract.js`. Add `ZCFKEY` and the submission-specific Forms secret header.
8. Configure `servicesHandled` as a JSON array. If the current Forms merge engine emits a delimited string instead, stop and capture a private synthetic fixture; do not loosen parsing based on a guess.
9. Keep all CRM IDs and original request provenance out of the Form URL, fields, rules, and webhook body.

## Development Acceptance Gates

Activation requires current synthetic evidence for every item below:

- both version-2 stores are independently re-read and preserved without rename, update, deletion, backfill, or promotion;
- all four additive version-3 tables are independently read back against the full 81-column contract, including privacy, uniqueness, permissions, and client-access denial;
- the read-only reconciliation output matches the approved zero-promotion counts and contains no row, CRM ID, token, email, or platform identifier;
- the Development pipeline job still exits unconditionally, or a separately reviewed replacement uses an independently verified native binding that never renders credentials, secrets, or release identifiers into shell command text;
- the hosted runtime injects or overwrites `x-zc-environment`, and the SDK reports the same Development environment;
- both Connections return exactly one approved Authorization header and the composite scope succeeds;
- the Catalyst access page proves one CRM-destination email OTP before Prefill can mark setup access Verified; wrong, expired, replayed, changed-destination, unexpected, or bypassed proofs fail closed without CRM disclosure;
- the first successful verification sets an exact 30-minute deadline and later retries do not extend it; post-deadline Prefill and submission both fail closed;
- the stable issuance-request and active-Deal unique conflicts, duplicate access-token lookup failure, prefill and submission unique conflicts, and conditional ZCQL behaviors match the pinned SDK under concurrent requests;
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

Activation blockers: the four empty version-3 operational targets now have independent Development schema readback, but the function artifact, runtime table binding, six routes, Catalyst Mail sender, exact Forms mappings, and full live lifecycle do not. The current `Begin Setup and QA` Blueprint transition also requires separate correction and proof against the email-only contract. Keep every route disabled until those blockers are repaired and synthetic bypass, expiry, transition, and rollback tests pass. Do not add SMS, treat native UI controls as server proof, force irrelevant placeholder values, or weaken approved conditions.

Other known CRM gaps remain outside this controller: current Blueprint transitions have no after-actions, so Deal Stage and `Test_Status` can drift. Form 2 completion is not go-live approval and must not advance phone routing automatically.

## Containment And Rollback

If Development misbehaves:

1. Disable the six API Gateway routes first.
2. Revoke the write Connection if CRM mutation must stop independently.
3. Preserve session, proof, prefill, receipt, deployment, and CRM readback evidence; do not delete rows or blindly re-push uncertain submissions.
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

The eight deploy-artifact integration cases intentionally skip on non-Linux hosts. GitHub's `repo-checks` job runs on `ubuntu-24.04` and executes this same component `npm run ci`, so those cases must run—not skip—on every pull request before deployment evidence is accepted.

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
