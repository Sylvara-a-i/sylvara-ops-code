# RevenueLeakTestRequestForm

This isolated Node.js 24 Advanced I/O function supports the CRM record-details button **Start Free Revenue Leak Test Request** without expanding into the setup-form workflow. Active behavior is Development-only and exposes exactly two JSON `POST` routes. Production supports only dependency-free dark installation and returns unavailable before route, SDK, store, CRM, or secret access. The exact desired authentication, throttling, caller, and rollback controls are versioned in [`config/routes.json`](config/routes.json); the cross-system Forms configuration is in [`../../zoho-forms/free-revenue-leak-test/forms-manifest.json`](../../zoho-forms/free-revenue-leak-test/forms-manifest.json).

**Development status, 2026-08-24:** The legacy `Form1AssistedSessions` source has aggregate readback evidence and remains preserved. The canonical `RevenueLeakTestRequestFormSessions` target still requires additive provisioning, migration, and independent readback. Both Request Form CRM Connections were read back in the Retell Development console as Connected with the exact approved scopes; their private link names remain outside Git, and CRM-organization binding and runtime behavior are still unverified. The legacy project remains live under its former Form 1 name. The Retell-target `revenue_leak_test_request_form`, routes, variables, CRM button, and Forms Prefill Webhook have not been cut over or runtime-tested. Production activation remains code-blocked; only dark installation is supported.

The operator-led `/field-setup/` journey is also present as a disabled source candidate. The committed listener claims no field-setup routes and the committed client selects a synthetic, zero-network preview. A separately reviewed composition can inject exact Development route, operator-identity, Data Store, CSRF, conversion, and Form-destination mappings. That composition claims exactly six dark source routes: server-to-server launch plus browser exchange, status, operator decision, conversion preview, and conversion confirmation. The canonical contract is protocol `free_revenue_leak_test_field_setup_v1`, numeric schema version `1`: launch bodies and every successful response carry both values, while browser requests require exact headers before identity or persistence work. A Lead launch atomically creates or resumes the one keyed record-bound journey; after independently confirmed conversion, only its mapped Deal can resume that same row and authoritative step. Each resume rotates launch and session material without resetting evidence. The client accepts exactly ten distinct injected same-origin runtime paths across the request and setup function owners. Conversion confirmation remains locked until the bounded preview is loaded for display. If a committed browser mutation response is lost, the client repeats the exact same-body request once; the server may return only the action-bound immediately prior committed transition, including the original Form navigation receipt, without another compare-and-set. Older, different-action, or conflicting evidence fails closed, and no status-only readback may claim that an action succeeded. The preview route likewise accepts only the immediately prior revision as a readback of an already committed confirmation preview, so a retry cannot rebuild it. If authoritative pre-write evidence changes, the preview route atomically replaces only the exact current receipt, increments the revision, and returns the refreshed display; the superseded receipt cannot convert. Conversion confirmation uses only its dedicated exact-request replay path; `write_started`, ambiguous CRM/write-readback evidence, and `reconciliation_required` remain operator-stop outcomes and are never masked by journey status. Only exact injected Form paths on `forms.zohopublic.com` may be returned for top-level navigation. Guarded steps still require an exact server-authoritative receipt before compare-and-set persistence, and the browser has no activation operation. No such private mapping is committed or registered by this package.

The disabled persistence contract permits only one unprovisioned additive table, `RevenueLeakTestFieldSetupJourneys`. A strict `recordType` discriminator separates the exact canonical journey projection from current-control, control-operation, number-inventory, reservation-receipt, verification-attempt, and verification-window/receipt families. The request store must project only canonical journey properties before executable validation. Number-claim receipts bind both the accepted pre-claim and recomputed post-claim control fences under one stable route-and-reservation-binding operation key, so replay cannot repeat the inventory transition. One private `stateCoordinator` must prove a serializable cross-record transaction domain inside this table before any install. Source tests do not prove that Data Store capability or live provisioning.

1. **Issue** accepts one Lead ID from the CRM button, reads that Lead, creates a fresh intake identity and a 256-bit opaque token, stores only the token HMAC, updates and reads back `Intake_Submission_ID`, then returns the existing Form 1 permalink with the token field alias.
2. **Prefill** receives the token from Zoho Forms' server-side Prefill Webhook, validates expiry and bounded disclosure state, reads the bound Lead, proves the Lead still has the session intake identity, and returns only the allowlisted Form 1 values.

Form 1's existing native CRM integration remains the only submission writer. Its current upsert order is `Intake Submission ID` first and `Contact Email` second, with blank overwrite disabled. There is no Catalyst submission route.

## Security contract

- Production activation is blocked in source. Only `production`/`dark` is accepted, loads no operational dependencies, and returns unavailable; an unstamped or source-revision-mismatched artifact still fails configuration.
- Every new issue rotates the Lead intake identity, which invalidates older still-unexpired tokens.
- The URL contains no Lead ID or PII. Raw tokens, request bodies, CRM responses, headers, and secrets are never logged or stored.
- API Gateway route secrets are independent, verified before parsing business input, and kept out of source.
- The read Connection has only `ZohoCRM.modules.leads.READ`; the write Connection has only `ZohoCRM.modules.leads.UPDATE`.
- A unique Data Store reservation is acquired before each CRM prefill read, preventing concurrent requests from bypassing the configured disclosure ceiling.
- Consent fields, consent timestamps, and `Free_Test_Request_Notes` are excluded from prefill.
- Only the exact US Zoho CRM V8 and Zoho Forms public hosts are accepted.

## Prefill allowlist

The current allowlist is: first and last name, company, decision-maker role, exact job title, contact email, mobile phone, company phone, the existing CRM Lead Source, current call handling, requested test route, phone-system provider, primary service area, field-team-size band, the fresh intake identity, and the assisted-mode provenance values held only in Catalyst Development configuration. The original Lead Source is preserved; assisted intake is attributed separately through Submission Channel and Source Page.

## Development setup

1. Confirm the exact existing Retell Catalyst project and Development environment, inventory its current functions, routes, tables, Connections, and variables, and independently read back the preserved legacy source plus the additive `RevenueLeakTestRequestFormSessions` target before deployment. Keep the legacy project live and Production untouched.
2. Create or update only `revenue_leak_test_request_form`. Upload only a clean reviewed artifact whose `lib/source-revision.js` sentinel is stamped with the matching Git commit; do not add the Setup Form or any Retell function to this package's `catalyst.json` target list.
3. Configure the variables in `config/variables.json` on this function. Keep all private values in Catalyst and bind `SESSION_TABLE_NAME` exactly to `RevenueLeakTestRequestFormSessions`; the function rejects every other table name.
4. **Connection-console check completed on 2026-08-23:** both Form 1-specific Catalyst CRM Connections are Connected with the exact scopes above. Re-read their private link names and grants, then prove the intended CRM organization through a harmless authenticated read before binding the function variables. Do not reuse the Form 2 or Retell call-processing Connections.
5. Create the two exact private routes from `config/routes.json`, with the declared throttling and independent shared-header authentication. Preserve every existing Retell route and do not enable or reconfigure API Gateway until a complete project-wide route/security snapshot and rollback test exist. No CORS is required.
6. Add one hidden or locked Zoho Forms Prefill-Webhook field with the configured alias. POST `{"token":"<field value>"}` to the prefill route, send the prefill shared header, and map only `lib/form-contract.js` outputs.
7. Create a CRM Button-category Deluge function that receives the Lead ID plus runtime-held issue URL and secret, POSTs `{"leadId":"..."}`, validates the 201 JSON response and exact Form host/path, then calls `openUrl(..., "new window")`.
8. Associate it with a Leads **View page** button named **Start Free-Test Request**, initially restricted to the Administrator profile.
9. Run a clearly synthetic canary: issue link, verify prefill, submit Form 1, prove the same Lead was updated and no duplicate Lead was created. Do not create a Bookings appointment. Cut over callers only after function, route, Connection, table, variable, source-revision, and downstream readback all pass; legacy cleanup is a separate destructive action.

## Verification

Run from `functions/revenue_leak_test_request_form` with Node.js 24:

```text
npm ci --ignore-scripts
npm run ci
```

The tests cover Development/source binding, credential separation, destination allowlists, opaque-token handling, fresh intake rotation, prefill-before-read reservation, stale binding rejection, exact request contracts, live table columns, bounded concurrent reservations, and separate CRM read/write credentials.

For a separately authorized Catalyst CLI release, build a complete immutable project outside the repository. The output child directory must not already exist:

```powershell
$approvedRevision = git rev-parse HEAD
$artifactParent = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ("sylvara-request-cli-artifact-" + [guid]::NewGuid()))
$artifactRoot = Join-Path $artifactParent.FullName "revenue-leak-test-request-form"
node src/zoho-catalyst/revenue-leak-test-request-form/tools/build-release-artifact.js --approved-revision $approvedRevision --output $artifactRoot
```

This build-only command never invokes Catalyst. It exports the exact clean approved commit, runs the function CI before excluding tests and environment templates, installs only locked production dependencies with lifecycle scripts disabled, stamps only the artifact source revision, and writes `artifact-manifest.json` with canonical per-file SHA-256 values and an aggregate digest. The resulting directory is a Catalyst CLI project root; deployment remains a separate approved action.

When Catalyst's console rejects a valid multi-file ZIP, `tools/build-single-file.js` produces a deterministic editor-safe `index.js`. It is a build-and-verify tool only; it never invokes Catalyst or deploys anything. The builder requires a clean checkout whose `HEAD` exactly matches the approved SHA, exports that immutable Git tree into a private temporary directory, stamps only the exported `lib/source-revision.js`, validates module containment, and writes a new artifact outside the checkout without overwriting an existing file.

From the repository root, create a new empty external directory and run:

```powershell
$approvedRevision = git rev-parse HEAD
$artifactDirectory = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ("sylvara-revenue-leak-test-request-form-" + [guid]::NewGuid()))
node src/zoho-catalyst/revenue-leak-test-request-form/tools/build-single-file.js --approved-revision $approvedRevision --output (Join-Path $artifactDirectory.FullName "index.js")
```

The command fails closed for dirty or mismatched revisions, linked or special Git entries, dependency escape, linked output directories, in-repository output, or an existing destination. Review and read back the resulting artifact before any separately authorized Development upload. The committed checkout keeps the unstamped sentinel and remains unchanged.
