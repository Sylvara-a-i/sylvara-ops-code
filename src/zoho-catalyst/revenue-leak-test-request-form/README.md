# RevenueLeakTestRequestForm

This Node.js 24 Advanced I/O function provides the bounded record-assisted lane for Form 1 while preserving the ordinary public Zoho Forms lane. Source is complete; Development installation and authoritative readback remain pending.

The exact Development routes are:

1. **Issue** accepts only CRM module and record ID from an Administrator-restricted CRM caller. It reads the record through a CRM Connection and, only when the canonical journey is blank, initializes it with an `If-Unmodified-Since` write and exact readback. A concurrent valid CRM journey wins without a second write. The controller then issues a 256-bit bearer and stores only its HMAC digest.
2. **Access** serves a no-store Catalyst client page. The real journey credential arrives only in the URL fragment, so it is not sent with the `GET` request.
3. **Exchange** accepts that credential once through a same-origin `POST`, removes the fragment immediately, and issues a separate 256-bit Form prefill handle with a default ten-minute lifetime.
4. **Prefill** accepts only the Form prefill handle from Zoho Forms' authenticated Dynamic Prefill-Webhook, consumes it once, resolves the CRM binding server-side, and returns the minimum non-PII assisted constants plus a non-secret `prefillId` and immutable configuration revision.
5. **Submission** accepts Zoho Forms' fixed flat parameter map, derives the public lane only when both server-issued binding fields are blank, or nests the exact allowlisted Form data when both bindings are present. Partial bindings and extra fields fail closed. The canonical public lane is acknowledged without a write; the assisted lane validates `prefillId`, configuration revision, and submission identity server-side, writes only the exact server-resolved CRM record, and consumes the session only after exact CRM readback.

The Catalyst client URL contains the real journey credential only in its fragment. The Zoho Forms URL contains only the separate 43-character prefill handle under its dedicated field alias. Neither URL contains a CRM record ID, journey ID, email, phone, company name, configuration value, or other PII. `RevenueLeakTestRequestFormSessions` binds organization digest, module, record, journey, form, stage, actor digest, release, creation/expiry, one-time prefill, consumption, and submission fingerprint. Reissue preserves the canonical journey while invalidating or replacing unusable short-lived artifacts. Only a structurally clean `issued` row may atomically adopt the current release and assisted-form identity; organization, module, record, journey, stage, environment, and issuing actor remain immutable. Any downstream prefill binding, expired or revoked row, consumed journey, or in-progress submission cannot cross that boundary.

The retained `Start Free-Test Request` containment control remains the immediate CRM fallback until the replacement `Open Free-Test Setup` path passes Development E2E. Historical containment evidence remains historical and does not prove the new source is installed.

Catalyst Development permits only two unique Var Char columns on this retained table; those physical constraints remain on `TOKEN_HASH` and `INTAKE_SUBMISSION_ID`. `PREFILL_HANDLE_HASH` and `PREFILL_ID` therefore remain nullable, non-unique, search-indexed private columns. Their values are still generated from high-entropy server-side material, and every application lookup requires exactly one matching row so any duplicate result fails closed. The retained table's physical `SOURCE_REVISION` width remains 80 while runtime validation still accepts only the exact lowercase 40-character immutable Git SHA. These provider accommodations do not expose a credential or relax the one-time binding.

The historical `288a93c` convergence evidence remains preserved in `free-revenue-leak-test-development-pr-head-convergence-2026-08-28-288a93c.json` for the predecessor release; it is not a current source stamp and does not prove this assisted controller is installed.

## Security contract

- Production accepts only `production`/`dark` and rejects before SDK, table, Connection, CRM, token, or form access.
- Development requires exact project/environment/source binding. Issue, Prefill, and Submission require independent server-caller secrets before body or SDK access; Access and Exchange expose only the narrow fragment-exchange boundary.
- Journey credentials and prefill handles are never stored or logged. Route secrets, peppers, Connection authorization, CRM payloads, form data, URLs, identifiers, and private variable values never enter logs.
- Assisted record identity is resolved server-side. Browser-supplied CRM identity is not part of the submission contract.
- The provider envelope contains only `submissionId`, `prefillId`, `configurationRevision`, and the exact Form field allowlist. It never accepts a CRM record ID, journey ID, prefill handle, bearer, or arbitrary nested identity.
- Zoho Forms serializes its Decision Box value as JSON text in the flat webhook map. Only the exact string `"true"` is normalized to boolean `true` at that authenticated transport boundary. The internal form contract still requires boolean consent; labels, arrays, case variants, whitespace, and other truthy values are rejected. Normalization precedes the submission fingerprint so a harmless transport replay cannot create a second CRM write.
- Session transitions use conditional readback, preserve harmless exact replay, reject changed-payload replay, and fail closed on expiry, tampering, stage drift, cross-record input, ambiguous state, or concurrent ownership.
- The two CRM receipt datetime fields use whole-second `+00:00` values, following the [Zoho CRM v8 field contract](https://www.zoho.com/crm/developer/docs/api/v8/insert-records.html) verified on 2026-09-04. Readback compares only these two typed fields as valid timestamps for the same instant; malformed dates fail closed. The stored claim timestamp and fingerprint retain their original values, and the raw CRM `Modified_Time` concurrency fence remains exact.
- The public lane remains owned by the existing native Forms upsert and cannot manufacture an assisted binding with hidden record fields.

## Development setup

Install only from the final immutable release. The complete variable-name and classification registry is [`config/variables.json`](config/variables.json); values remain private Catalyst configuration.

- Deployment/source: `DEPLOYMENT_ENVIRONMENT`, `DEPLOYMENT_MODE`, `EXPECTED_CATALYST_PROJECT_ID_SHA256`, `CRM_ORGANIZATION_ID_SHA256`, `SOURCE_REVISION`, and the exact `ZOHO_CATALYST_ZCQL_PARSER=V2` provider binding required for conditional ZCQL transitions.
- Routes/authentication: `ISSUE_PATH`, `ACCESS_PATH`, `EXCHANGE_PATH`, `PREFILL_PATH`, `SUBMISSION_PATH`, the three matching server-caller `*_HEADER_NAME` and `*_HEADER_SECRET` variables, `TOKEN_PEPPER`, `PREFILL_HANDLE_PEPPER`, and `ISSUING_ACTOR_HASH`. `ACCESS_PATH` is the private Advanced I/O runtime path, not a browser URL.
- Forms/CRM: `FORM1_PUBLIC_URL`, `FORM1_ACCESS_PUBLIC_URL`, `FORM1_PREFILL_HANDLE_FIELD_ALIAS`, `CRM_READ_CONNECTION_LINK_NAME`, `CRM_WRITE_CONNECTION_LINK_NAME`, `SESSION_TABLE_NAME`, `CRM_API_BASE_URL`, and the five `FORM1_*` canonical value/version variables. `FORM1_ACCESS_PUBLIC_URL` is the exact Development API Gateway source URL and is intentionally distinct from `ACCESS_PATH`.
- Bounded operation defaults: `SESSION_TTL_SECONDS`, `PREFILL_HANDLE_TTL_SECONDS`, `MAX_BODY_BYTES`, `INBOUND_BODY_TIMEOUT_MS`, `OUTBOUND_TIMEOUT_MS`, `OUTBOUND_MAX_BYTES`, and `PLATFORM_OPERATION_TIMEOUT_MS`.

Install the five routes, session table, two CRM Connections, dedicated Forms prefill-handle alias and webhooks, and the `Open Free-Test Setup` caller together, then read each back immediately. Preserve the predecessor button and all historical session evidence. Rollback disables the replacement caller, webhooks, and five routes and returns operators to the retained contained control; it never restores unsafe pre-containment code.

A Forms thank-you page or redirect proves only that Forms captured the entry. After a failed webhook, reconcile the exact entry, Catalyst session, and CRM record before any re-push. A new release does not authorize replaying an older entry against a changed immutable revision or migrating a downstream session; preserve that entry as failed evidence until an approved recovery path exists.

Dependency diagnostics retain only fixed writer-credential, writer-organization, CRM-write, and CRM-readback stages, allowlisted provider codes, and actual HTTP status. Provider messages, arguments, bodies, credentials, and stacks never enter logs. Logging cannot change write/retry behavior. The CRM client's read-only writer preflight performs only credential validation and the existing organization GET; it adds no route or recovery authority, and local CLI behavior does not prove deployed runtime behavior.

### Separately approved one-claim recovery

`FORM1_RECOVERY_MANIFEST_JSON` is absent or empty during ordinary operation. A separately approved Development recovery may set one compact, exact JSON object with eight fields: `schemaVersion` (1), `mode` (`inspect` or `complete`), `originalSourceRevision`, `claimBindingSha256`, `assistedConstantsSha256`, `originalSessionVersion`, `originalUpdatedAt`, and `originalLastOutcome`. The initial outcome is `submission_started`; a separately authorized follow-on may instead pin an exact valid reservation marker from a different predecessor artifact. Generate the digests with the recovery module's hash helpers over the complete normalized approved prestate and the five original server-owned constants. Keep the packet and all values outside Git and logs; preserve the original pepper until reconciliation. The deployed artifact retains its honest new source stamp.

Recovery uses only the existing authenticated Submission endpoint. Other assisted access and launch paths temporarily fail before SDK access. Public unbound acknowledgments remain non-writing; the public form, its native CRM integration, and its URL are unchanged. Any other claim, changed payload or consent, changed form/organization/actor, or changed original fingerprint fails closed.

1. Preserve the original failed entry, complete session packet, CRM prestate, original artifact, and private configuration. Confirm the exact one-claim approval, current metadata, and absence of concurrent operator replay.
2. Install the reviewed immutable Development artifact and exact private `inspect` manifest. Independently read back source and configuration before re-pushing only the original Forms entry. Inspection performs only reads, checks the original fingerprint and writer organization, and deliberately returns HTTP 503 with `recoveryReady` so Forms cannot mark an unfinished entry delivered.
3. Only after successful inspection and fresh exact readback may the operator select `complete` and re-push that same entry once. Full intended CRM poststate is checked before the original record-version fence. An already exact poststate needs no CRM write. Otherwise a conditional session reservation changes only operational outcome/version/update time before the sole conditional CRM write attempt.
4. The reservation stores a unique owner and the full recovery artifact revision in the existing bounded outcome column. Only its unambiguous owner may attempt the CRM update. Competing requests, process restarts, or ambiguous reservations are read/reconcile-only, even when the CRM version is unchanged. No retry can restore write authority. Consume uses the original claim only after exact CRM readback and preserves the recovery marker as provenance.
5. Independently verify CRM fields and the original session's terminal status, claim identity, fingerprint, timestamps, original revision, and recovery provenance. Remove or empty the manifest to restore ordinary assisted launching. A terminal replay is not a new recovery authorization; reconcile a lost completion response from authoritative readback.

Before reservation, rollback may restore the exact predecessor only after proving the original claim unchanged and no new write. After reservation, do not restore code that ignores its one-shot lock, reset the session, replace the claim, or rotate its pepper. Keep the reviewed recovery artifact in read-only `inspect` containment until the exact outcome is reconciled; an uncertain attempt never authorizes another CRM write. Recovery does not authorize another record, Production, messaging, routing, or any Retell operation.

A rejected attempt also spends its reservation. A new explicitly approved attempt requires independent reconciliation of the prior CRM outcome, preservation of the prior private packet, and a distinct reviewed artifact whose source revision differs from both the original claim and the spent reservation. Bind the new manifest to the complete unchanged reserved row itself, including its exact marker, version, and update time; never reconstruct the earlier unreserved state. Repeat inspection and fresh readback before completion. Only the new reservation's unambiguous CAS owner may attempt one conditional update. If CRM already matches, consume without a new update and retain the predecessor marker. A further failure is not permission to reinterpret a manifest, clear a lock, or retry.

For a failed, unclaimed submission that needs a new release, the existing issuer can prepare a safe cutover without deleting the session or changing its canonical journey:

1. While the old release remains installed, preserve the exact failed Forms entry and verify one matching `prefilled` session with no submission claim, consumption, fingerprint, or CRM write.
2. Invoke only the existing server-side Issue function once for that record. Do not open or exchange the returned access credential. Read back the same row and journey in `issued` state, with all prior prefill/submission bindings cleared and the session version incremented once.
3. Deploy the reviewed immutable release, then use the ordinary CRM launcher. Its existing clean-`issued` migration adopts the new release using a conditional write and preserves the canonical row and journey.
4. Complete a fresh form entry against the new binding. Retain the old entry as failed evidence; never re-push it or rewrite its revision. Stop on a concurrent submission, changed identity, incomplete clearing, or ambiguous readback.

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
