# RevenueLeakTestRequestForm

This Node.js 24 Advanced I/O function provides the bounded record-assisted lane for Form 1 while preserving the ordinary public Zoho Forms lane. Source is complete; Development installation and authoritative readback remain pending.

The exact authenticated Development routes are:

1. **Issue** accepts only CRM module and record ID from an Administrator-restricted CRM caller. It reads the record through a CRM Connection and, only when the canonical journey is blank, initializes it with an `If-Unmodified-Since` write and exact readback. A concurrent valid CRM journey wins without a second write. The controller then issues a 256-bit bearer and stores only its HMAC digest.
2. **Prefill** accepts only the opaque bearer, resolves the CRM binding server-side, and returns non-PII assisted constants.
3. **Submission** either acknowledges the tokenless public lane without a CRM binding or validates the assisted bearer, binds ownership to the full allowlisted form payload, writes the exact server-resolved CRM record, and consumes the session only after exact CRM readback.

The URL contains only the configured Form 1 permalink, one private field alias, and the 43-character opaque bearer. It never contains a CRM record ID, journey ID, email, phone, company name, or other PII. `RevenueLeakTestRequestFormSessions` binds organization digest, module, record, journey, stage, actor digest, release, creation/expiry, consumption, and submission fingerprint. Token reissue rotates the bearer for the same resumable journey; consumed or in-progress submissions cannot be reissued.

The retained `Start Free-Test Request` containment control remains the immediate CRM fallback until the replacement `Open Free-Test Setup` path passes Development E2E. Historical containment evidence remains historical and does not prove the new source is installed.

The historical `288a93c` convergence evidence remains preserved in `free-revenue-leak-test-development-pr-head-convergence-2026-08-28-288a93c.json` for the predecessor release; it is not a current source stamp and does not prove this assisted controller is installed.

## Security contract

- Production accepts only `production`/`dark` and rejects before SDK, table, Connection, CRM, token, or form access.
- Development requires exact project/environment/source binding and independent route secrets before body or SDK access.
- Bearer values are never stored or logged. Route secrets, token pepper, Connection authorization, CRM payloads, form data, URLs, identifiers, and private variable values never enter logs.
- Assisted record identity is resolved server-side. Browser-supplied CRM identity is not part of the submission contract.
- Session transitions use conditional readback, preserve harmless exact replay, reject changed-payload replay, and fail closed on expiry, tampering, stage drift, cross-record input, ambiguous state, or concurrent ownership.
- The public lane remains owned by the existing native Forms upsert and cannot manufacture an assisted binding with hidden record fields.

## Development setup

Install only from the final immutable release. The complete variable-name and classification registry is [`config/variables.json`](config/variables.json); values remain private Catalyst configuration.

- Deployment/source: `DEPLOYMENT_ENVIRONMENT`, `DEPLOYMENT_MODE`, `EXPECTED_CATALYST_PROJECT_ID_SHA256`, `CRM_ORGANIZATION_ID_SHA256`, `SOURCE_REVISION`.
- Routes/authentication: `ISSUE_PATH`, `PREFILL_PATH`, `SUBMISSION_PATH`, the three matching `*_HEADER_NAME` and `*_HEADER_SECRET` variables, `TOKEN_PEPPER`, and `ISSUING_ACTOR_HASH`.
- Forms/CRM: `FORM1_PUBLIC_URL`, `FORM1_TOKEN_FIELD_ALIAS`, `CRM_READ_CONNECTION_LINK_NAME`, `CRM_WRITE_CONNECTION_LINK_NAME`, `SESSION_TABLE_NAME`, `CRM_API_BASE_URL`, and the five `FORM1_*` canonical value/version variables.
- Bounded operation defaults: `SESSION_TTL_SECONDS`, `MAX_BODY_BYTES`, `INBOUND_BODY_TIMEOUT_MS`, `OUTBOUND_TIMEOUT_MS`, `OUTBOUND_MAX_BYTES`, and `PLATFORM_OPERATION_TIMEOUT_MS`.

Install the three routes, session table, two CRM Connections, Forms alias/webhooks, and the `Open Free-Test Setup` caller together, then read each back immediately. Preserve the predecessor button and all historical session evidence. Rollback disables the replacement caller/webhooks/routes and returns operators to the retained contained control; it never restores unsafe pre-containment code.

## Verification

Run from `functions/revenue_leak_test_request_form` with Node.js 24:

```text
npm ci --ignore-scripts
npm run ci
```

The tests cover Development/source/project binding, exact variables, three authenticated routes, conditional CRM journey initialization, digest-only bearer storage, durable session ownership, exact CRM readback, public/assisted writer separation, Catalyst SDK packaging, and dark Production.

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
