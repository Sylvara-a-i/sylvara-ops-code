# RevenueLeakTestRequestForm

This isolated Node.js 24 Advanced I/O function supports the CRM record-details button **Start Free Revenue Leak Test Request** without expanding into the setup-form workflow. Active behavior is Development-only and exposes exactly two JSON `POST` routes. Production supports only dependency-free dark installation and returns unavailable before route, SDK, store, CRM, or secret access. The exact desired authentication, throttling, caller, and rollback controls are versioned in [`config/routes.json`](config/routes.json); the cross-system Forms configuration is in [`../../zoho-forms/free-revenue-leak-test/forms-manifest.json`](../../zoho-forms/free-revenue-leak-test/forms-manifest.json).

**Development status, updated 2026-08-28:** Fresh release readback proves that `revenue_leak_test_request_form` is installed at revision `e1da1bc3457e506faf64c71db38869c8b26c1bbc` with Node 24, 256 MB, its exact 30-variable approved private map, and Catalyst archive pullback parity by path set and file content. Earlier readback confirms that `RevenueLeakTestRequestFormSessions` exists with the exact 14 application columns, zero rows, no App User permissions, and no administrator DELETE permission; the legacy `Form1AssistedSessions` source remains preserved with eight rows. Earlier evidence also records both Request Form CRM Connections and both canonical routes exact, but the latest packet kept Gateway disabled and did not revalidate those provider surfaces. The CRM button and Forms Prefill Webhook have not been cut over. The operator invoked no route, function, Job, or Cron and did not runtime-test the workflow. Production activation remains code-blocked; only dark installation is supported.**

Shared-project release readback confirms that the call worker now has its exact complete 28-variable Development map with dry-run notification, but no Job was invoked. Both canonical Function Job pools are present, although their function-target binding remains unproven, and the complete current Cron inventory contains zero canonical references. Earlier visible Job-history evidence is bounded and does not prove provider-complete all-history inventory or direct caller/webhook absence. During this execution, the operator performed no Retell-provider or agent test, call, simulation, publish, phone-route, other provider-side change, customer action, or Production action.

Historical route-continuation evidence recorded that both canonical Function Job pools match exact at 512 MB. Provider-complete all-history Job inventory and direct caller and webhook bindings remain unproven. During this execution, the operator invoked no route, function, Job, or Cron; the historical statement is preserved without treating it as fresh e1da1bc pool or caller readback.

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

The current allowlist is: first and last name, company, decision-maker role, exact job title, contact email, mobile phone, company phone, the existing CRM Lead Source, current call handling, requested test route, phone-system provider, primary service area, field-team-size band, the fresh intake identity, and the assisted-mode provenance values held only in Catalyst Development configuration. The original Lead Source is preserved; assisted intake is attributed separately through Submission Channel and Source Page. The controller intentionally omits a redundant `assisted_by` value because it has no CRM destination or downstream consumer.

Two live Forms prerequisites remain unresolved and block any connector or browser change. First, the public Form 1 path must have an approved, non-respondent source that generates immutable, non-blank `Intake_Submission_ID` before the native CRM upsert and preserves it across an exact safe retry or re-push. Second, every Form 1 field—including audit, attribution, consent, and assisted-prefill inputs—requires a privately reviewed field-by-field dictionary covering type and alias, mandatory rule, personal classification, encryption, hidden or locked state, respondent editability, retention, and downstream mapping. Do not infer either setting from a neighboring field or apply a bulk privacy default.

## Development setup

1. Confirm the exact existing Retell Catalyst project and Development environment, inventory its current functions, routes, tables, Connections, and variables, and independently read back the preserved legacy source plus the additive `RevenueLeakTestRequestFormSessions` target before deployment. Keep the legacy project live and Production untouched.
2. Create or update only `revenue_leak_test_request_form`. Upload only a clean reviewed artifact whose `lib/source-revision.js` sentinel is stamped with the matching Git commit; do not add the Setup Form or any Retell function to this package's `catalyst.json` target list.
3. Configure the variables in `config/variables.json` on this function. Keep all private values in Catalyst, set `EXPECTED_CATALYST_PROJECT_ID_SHA256` to the lowercase SHA-256 of the separately reviewed target project ID, and bind `SESSION_TABLE_NAME` exactly to `RevenueLeakTestRequestFormSessions`. Before any store, Connection, or CRM access, the function requires the request project ID and SDK project ID to agree and match that digest.
4. **Connection-console readback current on 2026-08-27:** both Form 1-specific Catalyst CRM Connections are Connected with the exact scopes above and are included in the exact nine-Connection project-wide inventory. Re-read their private link names and grants, then prove the intended CRM organization through a harmless authenticated read before binding the function variables. Do not reuse the Form 2 or Retell call-processing Connections.
5. The two exact private routes from `config/routes.json` are present with exact Development readback. Before any future acceptance work, read them back again and compare their methods, targets, suffixes, independent shared-header authentication, and throttles to the contract. Do not recreate them or enable API Gateway until a complete project-wide route/security snapshot and rollback test exist. No CORS is required.
6. After the two live Forms prerequisites above have exact private readback and approval, add one hidden or locked Zoho Forms Prefill-Webhook field with the configured alias. POST `{"token":"<field value>"}` to the prefill route, send the prefill shared header, and map only `lib/form-contract.js` outputs.
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
