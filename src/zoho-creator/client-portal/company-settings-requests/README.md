# Service-area change-request planner

Status: proposed source-only contract, synthetic validation. This is not a functional deployed portal. No endpoint, database writer, permissions, deployment, live call or tenant data is included. Creator may own the pending human request; CRM remains authoritative for the company relationship and current service area. Planning never changes CRM or Creator.

The adjacent [offline identity prototype](OFFLINE-IDENTITY.md) composes this planner with explicit canonical joins, separate request attribution and deterministic replay-binding fingerprints. It establishes no live mapping, authentication or durable persistence. The [pending-request read contract](#pending-request-read-contract) prepares the separate company-scoped status list; submission permission does not grant read access.

`preparePendingServiceAreaRequest(input, verifiedContext)` accepts exactly `Account` and `Requested_Service_Area` in a plain data object. `Account` is an untrusted Creator Account selector, never an identity or grant. Unknown, inherited, symbol and accessor keys are rejected, including client before/status/actor overrides. The result contains exactly `Account`, `Previous_Service_Area`, `Requested_Service_Area`, and `Status` (always `Pending review`). No extra schema field or duplicate audit form is introduced.

The separately verified server context has exactly:

- `principalId`: stable authenticated portal principal identifier.
- `contact`: `{ id, accountId }`, the exact CRM Contact and its `Contact.Account_Name` Account identifier.
- `companyMappings`: a dense ordinary data array (no sparse indices, accessors, custom prototype/iterator, extra string keys or symbol keys) of `{ creatorAccountId, crmAccountId, active }` grants verified for that principal. Complete lookup results are required: exactly one matching selector, active grant and exact CRM Account equality. Missing, ambiguous, inactive or cross-company matches fail closed.
- `previousServiceArea`: authoritative current CRM baseline, required and copied exactly without trimming or newline conversion.
- `auditActorId`: verified human attribution, retained by the adapter's audit mechanism rather than added to the four-field form.

A passed object is **not authentication**. These assertions only reject structurally inconsistent facts. A future server adapter must authenticate the stable portal principal, verify its active company grant and complete exact Creator-to-CRM Account link, verify `Contact.Account_Name`, fetch a fresh authoritative previous area, and bind human audit attribution independently. Never deserialize this context from the client or infer it from an email/display-name match. Authorized secondary contacts require no Deal or `Primary_Contact` relationship. Those fields are intentionally absent.

Requested text uses the existing Form2 `normalizeText` semantics from `src/zoho-catalyst/revenue-leak-test-setup-form/functions/revenue_leak_test_setup_form/lib/form-contract.js`: CRLF/CR become LF, then trim, reject blank/prohibited controls, allow tab/LF, count at most 2000 Unicode code points, reject 2001 without truncation. Source parity tests extract only that pure function; runtime imports no Form2 code or writer. Baseline availability is validated with the same predicate but the original string is preserved. Historical fixtures rejecting CRLF/tab are not authority.

The returned object is frozen only to prevent accidental in-process edits. This is not immutable storage, durable acceptance, retry safety, or a success receipt. Live adapter attribution, a durable UNIQUE replay key with atomic concurrency handling, append-only persistence, independent readback/reconciliation and truthful acceptance remain explicit unimplemented gates. A future adapter must preserve attribution with the request durably without changing this approved form schema. Do not enable a portal save flow until those gates and separately approved permission/deployment acceptance are complete.

Run the focused checks from the repository root:

```sh
node --check src/zoho-creator/client-portal/company-settings-requests/service-area-request-contract.js
node --test src/zoho-creator/client-portal/company-settings-requests/test/service-area-request-contract.test.js
```

Tests cover exact projection/status, exact baseline/nonmutation, missing/ambiguous/inactive/cross-company links, secondary contacts, ordinary/frozen JSON mapping arrays, rejected mapping-array descriptors with zero accessor/iterator execution, unsupported values, unknown/prototype/accessor keys, attribution availability, 2000/2001 ASCII/emoji/mixed text, newline/tab/control parity and zero transport capabilities. The canonical verifier runs syntax and focused tests in both Quick and All modes; Repo Checks CI also runs them explicitly. The verifier registration has a regression test in `tools/safety/tests/test_verify_entrypoint.py`. Keep fixtures synthetic and logs free of customer data. No live setup or rollback is needed for this source-only planner; revert its source commit for containment. Adapter, storage and live permission/acceptance tests remain outside this slice.

## Pending-request read contract

[`pending-service-area-requests.js`](pending-service-area-requests.js) supplies the
missing read plan and list projection for the existing Company Settings request
workflow. It adds no store, transport, writer, approval action, schema, page or
permission. Creator owns the existing request records; CRM remains authoritative
for the current company service area. A recorded request with `Pending review`
means neither approval nor a completed CRM update. This is the only supported
status; unknown future lifecycle values reject instead of being silently omitted.

Both exports require independent protected server authority:

- `policy`: exactly `{ expectedEnvironment, expectedOrganizationId, asOf,
  maxAgeMs }`. Environment is `development`, `staging` or `production`, matching
  this directory's request contracts. Time is canonical UTC with milliseconds;
  the protected server supplies a positive safe-integer freshness bound.
- `trusted`: exactly `{ environment, organizationId, observedAt, complete,
  company, readGrant }`. The receipt must be complete, fresh and nonfuture.
- `company`: the existing `assertCompanyIdentity` shape with current principal,
  actor, CRM contact and complete Creator/CRM company mappings. One active mapping
  must match the selector and contact; aliases of its CRM company also reject.
- `readGrant`: exactly `{ principalId, creatorAccountId, operation, active,
  revision }`. Require the current matching active
  `company-settings-requests.read` grant. The submission scope
  `service-area-request`, a profile name, saved company selection or report ID
  cannot substitute. The existing identity resolver's submission scope is unchanged.

`preparePendingServiceAreaRequestRead({ Account }, trusted, policy)` returns an
immutable internal provider plan: `GET`, resource `Company_Settings_Requests`,
the pinned organization/environment, exact `{ Account }` criteria and fields
`ID`, `Account`, `Previous_Service_Area`, `Requested_Service_Area`, `Status`.
This is a normalized adapter contract, **not a native Creator endpoint or an
executable criteria string**. Only the server may compose/consume it. The adapter
must qualify a report over this existing form and enforce the exact Account-ID
predicate on every provider page; never retrieve the global staff queue and
filter it for a client. Native lookup objects/display labels must be normalized
to verified IDs without coercing numeric IDs through JavaScript numbers.

`preparePendingServiceAreaRequests(input, trusted, evidence, policy)` accepts
exactly `{ Account, limit, cursor }`, with limit 1-100 and initial cursor null.
Evidence is null for unavailable data, or exactly `{ environment, organizationId,
observedAt, complete, resource, accountId, snapshotId, items }`. The complete,
fresh receipt must match the plan's resource and company. The provider adapter
must independently establish terminal pagination and a stable complete snapshot;
an object containing `complete: true` cannot prove those facts. Partial reads,
rate limits, timeouts or exhausted collection budgets must not become an empty
receipt. At most 1,000 rows are accepted; larger histories need a separately
qualified bounded source strategy rather than truncation.

Each item has exactly the five selected native field names. Every row's Account
must match, ID must be unique, and status must be `Pending review`. Requested
text uses the existing required service-area validation. The native before-image
field is optional: null and empty string remain explicitly absent; nonempty
values use the same text validity rule. Persisted text is preserved exactly,
including line endings; no fresh CRM baseline is invented. Missing fields or
unrecognized native payload shapes require explicit adapter normalization and
are not guessed by the projector. Validate all rows before pagination, including
rows that will not appear on the selected page.

The output is `{ state, observedAt, items, totalCount, hasMore, nextCursor }`.
Items contain only ID, Previous_Service_Area, Requested_Service_Area and Status;
no Account, principal, grant, private link or provider envelope is returned.
Render these strings as text, never HTML. IDs are references, not capabilities:
this module exposes no detail, edit, cancel, approval or direct-record action.
The oldest authority/source observation is returned. Unavailable source yields
`unknown`, null items/count; certified empty yields `empty`, empty items and zero
count. Available history is ordered by ID using code-point comparison, **not**
claimed submission chronology, since this contract has no timestamp field.

Continuations are immutable process-local WeakMap objects, as in the existing
call/report projection. They bind principal, actor, contact/company, read-grant
revision, organization/environment, limit, freshness bound and exact source
snapshot/content. Input reordering does not change pages; changed content,
revocation, scope/revision changes and copied/serialized/forged cursors reject.
Each page rechecks current authority and source freshness. This is not durable
browser pagination; native wiring still needs protected cursor transport.

The server must obtain current authorization after provider awaits and before
delivery; this pure synchronous module supplies no live revocation protocol.
Do not echo trusted objects into a widget or reuse the read plan as an access
token. Qualified caller identity, provenance, complete source collection and
native component permissions remain unproven. Reuse the existing request-status
report seam in [the native plan](native/CREATOR-AUTHORIZATION.md#exact-next-native-components-in-both-spaces)
only after those gates and separately approved native acceptance; do not expose
the unfiltered staff report or widen a portal profile to exercise this source.

Run `node --test src/zoho-creator/client-portal/company-settings-requests/test/pending-service-area-requests.test.js`.
It is also imported by the canonical portal test entrypoint. Synthetic coverage
includes two tenants, foreign rows beyond the first page, separate read scope,
revocation, stale/incomplete receipts, optional before-images, duplicates,
unsupported statuses, stable continuation and hostile data descriptors. Revert
this module, its test/import and documentation to contain the source increment;
no live resource or data rollback is needed.
