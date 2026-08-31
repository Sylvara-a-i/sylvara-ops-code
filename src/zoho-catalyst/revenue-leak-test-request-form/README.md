# RevenueLeakTestRequestForm

This Node.js 24 Advanced I/O function provides the bounded record-assisted lane for Form 1 while preserving the ordinary public Zoho Forms lane. Source is complete; Development installation and authoritative readback remain pending.

The exact Development routes are:

1. **Issue** accepts only CRM module and record ID from an Administrator-restricted CRM caller. It reads the record through a CRM Connection and, only when the canonical journey is blank, initializes it with an `If-Unmodified-Since` write and exact readback. A concurrent valid CRM journey wins without a second write. The controller then issues a 256-bit bearer and stores only its HMAC digest.
2. **Access** serves a no-store Catalyst client page. The real journey credential arrives only in the URL fragment, so it is not sent with the `GET` request.
3. **Exchange** accepts that credential once through a same-origin `POST`, removes the fragment immediately, and issues a separate 256-bit Form prefill handle with a default ten-minute lifetime.
4. **Prefill** accepts only the Form prefill handle from Zoho Forms' authenticated Dynamic Prefill-Webhook, consumes it once, resolves the CRM binding server-side, and returns the minimum non-PII assisted constants plus a non-secret `prefillId` and immutable configuration revision.
5. **Submission** accepts Zoho Forms' fixed flat parameter map, derives the public lane only when both server-issued binding fields are blank, or nests the exact allowlisted Form data when both bindings are present. Partial bindings and extra fields fail closed. The canonical public lane is acknowledged without a write; the assisted lane validates `prefillId`, configuration revision, and submission identity server-side, writes only the exact server-resolved CRM record, and consumes the session only after exact CRM readback.

The Catalyst client URL contains the real journey credential only in its fragment. The Zoho Forms URL contains only the separate 43-character prefill handle under its dedicated field alias. Neither URL contains a CRM record ID, journey ID, email, phone, company name, configuration value, or other PII. `RevenueLeakTestRequestFormSessions` binds organization digest, module, record, journey, form, stage, actor digest, release, creation/expiry, one-time prefill, consumption, and submission fingerprint. Reissue preserves the canonical journey while invalidating or replacing unusable short-lived artifacts; consumed or in-progress submissions cannot be rebound.

The retained `Start Free-Test Request` containment control remains the immediate CRM fallback until the replacement `Open Free-Test Setup` path passes Development E2E. Historical containment evidence remains historical and does not prove the new source is installed.

Catalyst Development permits only two unique Var Char columns on this retained table; those physical constraints remain on `TOKEN_HASH` and `INTAKE_SUBMISSION_ID`. `PREFILL_HANDLE_HASH` and `PREFILL_ID` therefore remain nullable, non-unique, search-indexed private columns. Their values are still generated from high-entropy server-side material, and every application lookup requires exactly one matching row so any duplicate result fails closed. The retained table's physical `SOURCE_REVISION` width remains 80 while runtime validation still accepts only the exact lowercase 40-character immutable Git SHA. These provider accommodations do not expose a credential or relax the one-time binding.

The historical `288a93c` convergence evidence remains preserved in `free-revenue-leak-test-development-pr-head-convergence-2026-08-28-288a93c.json` for the predecessor release; it is not a current source stamp and does not prove this assisted controller is installed.

## Security contract

- Production accepts only `production`/`dark` and rejects before SDK, table, Connection, CRM, token, or form access.
- Development requires exact project/environment/source binding. Issue, Prefill, and Submission require independent server-caller secrets before body or SDK access; Access and Exchange expose only the narrow fragment-exchange boundary.
- Journey credentials and prefill handles are never stored or logged. Route secrets, peppers, Connection authorization, CRM payloads, form data, URLs, identifiers, and private variable values never enter logs.
- Assisted record identity is resolved server-side. Browser-supplied CRM identity is not part of the submission contract.
- The provider envelope contains only `submissionId`, `prefillId`, `configurationRevision`, and the exact Form field allowlist. It never accepts a CRM record ID, journey ID, prefill handle, bearer, or arbitrary nested identity.
- Session transitions use conditional readback, preserve harmless exact replay, reject changed-payload replay, and fail closed on expiry, tampering, stage drift, cross-record input, ambiguous state, or concurrent ownership.
- The public lane remains owned by the existing native Forms upsert and cannot manufacture an assisted binding with hidden record fields.

## Development setup

Install only from the final immutable release. The complete variable-name and classification registry is [`config/variables.json`](config/variables.json); values remain private Catalyst configuration.

- Deployment/source: `DEPLOYMENT_ENVIRONMENT`, `DEPLOYMENT_MODE`, `EXPECTED_CATALYST_PROJECT_ID_SHA256`, `CRM_ORGANIZATION_ID_SHA256`, `SOURCE_REVISION`.
- Routes/authentication: `ISSUE_PATH`, `ACCESS_PATH`, `EXCHANGE_PATH`, `PREFILL_PATH`, `SUBMISSION_PATH`, the three matching server-caller `*_HEADER_NAME` and `*_HEADER_SECRET` variables, `TOKEN_PEPPER`, `PREFILL_HANDLE_PEPPER`, and `ISSUING_ACTOR_HASH`.
- Forms/CRM: `FORM1_PUBLIC_URL`, `FORM1_ACCESS_PUBLIC_URL`, `FORM1_PREFILL_HANDLE_FIELD_ALIAS`, `CRM_READ_CONNECTION_LINK_NAME`, `CRM_WRITE_CONNECTION_LINK_NAME`, `SESSION_TABLE_NAME`, `CRM_API_BASE_URL`, and the five `FORM1_*` canonical value/version variables.
- Bounded operation defaults: `SESSION_TTL_SECONDS`, `PREFILL_HANDLE_TTL_SECONDS`, `MAX_BODY_BYTES`, `INBOUND_BODY_TIMEOUT_MS`, `OUTBOUND_TIMEOUT_MS`, `OUTBOUND_MAX_BYTES`, and `PLATFORM_OPERATION_TIMEOUT_MS`.

Install the five routes, session table, two CRM Connections, dedicated Forms prefill-handle alias and webhooks, and the `Open Free-Test Setup` caller together, then read each back immediately. Preserve the predecessor button and all historical session evidence. Rollback disables the replacement caller, webhooks, and five routes and returns operators to the retained contained control; it never restores unsafe pre-containment code.

## Verification

Run from `functions/revenue_leak_test_request_form` with Node.js 24:

```text
npm ci --ignore-scripts
npm run ci
```

The tests cover Development/source/project binding, exact variables, all five routes, fragment exchange, digest-only journey credentials and prefill handles, one-time Dynamic Prefill-Webhook access, conditional CRM journey initialization, immutable assisted submission binding, durable session ownership, exact CRM readback, public/assisted writer separation, Catalyst SDK packaging, and dark Production.

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
