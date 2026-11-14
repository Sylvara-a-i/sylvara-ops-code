# Company calls and released-report projection

Status: **offline source contract with synthetic tests**. No live source adapter,
authenticated endpoint, native Creator component, user, grant, schema or provider
operation is installed. This pure server module checks consistency of facts that
a protected composition must independently authenticate and obtain. Ordinary
objects and `complete: true` do not prove identity, provenance or completeness.

## Ownership and reuse

The module reuses `assertCompanyIdentity` from the existing company-settings
contract, as the Billing projection does. It does not change that API or widen
the service-area-specific `resolveProtectedCompanyLinks` or
`projectCreatorAuthorization` grant scopes. Separate proposed `calls.read` and
`reports.read` permissions are required; no role-to-permission policy is created.

CRM owns company/contact relationships. The protected current principal,
operation grants and reviewed Creator/CRM links must be established upstream.
Catalyst's canonical reporting helpers own call normalization, classification,
ownership reconciliation and source completeness. This module accepts only their
bounded, sanitized projection, never raw canonical JSON, transcripts, recordings,
provider IDs or private descriptions. It does not combine legacy and current
call stores or infer a source population from table names.

Release eligibility is an explicit proposed portal contract. Report generation,
accepted private drafts and email delivery status are not portal release grants.
The Controller's artifact storage/delivery behavior is not changed or imported.

## API and evidence

`prepareCompanyCallsPage(input, trusted, evidence, policy)` and
`prepareReleasedReportsPage(input, trusted, evidence, policy)` have the same
envelopes. All shapes are exact plain data: unknown/symbol/accessor fields,
inherited properties, sparse arrays and custom iterators are rejected. Errors
never include selector, principal, source or content values.

- `input`: `{ Account, limit, cursor }`. Account is a selector, not authority.
  Limit is an integer from 1 to 100; the initial cursor is null.
- `policy`: `{ expectedEnvironment, expectedOrganizationId, asOf, maxAgeMs }`.
  Environment is development, stage or production; the protected server supplies
  the current canonical UTC timestamp and a positive freshness bound.
- `trusted`: `{ environment, organizationId, observedAt, complete, company,
  readGrant, sourceBinding, reportGrants }`. Fresh complete authority must be
  obtained on every call, including pagination. Authentication/lifecycle,
  revocation, expiry and provenance remain upstream responsibilities.
- `company` is the existing `{ principalId, auditActorId, contact: { id,
  accountId }, companyMappings: [{ creatorAccountId, crmAccountId, active }] }`
  contract. Exactly one active mapping must match the selector and CRM contact;
  aliases of that canonical CRM account in the complete mapping also reject.
- `readGrant`: `{ principalId, creatorAccountId, operation, active, revision }`.
  Operation must equal calls.read or reports.read for the chosen function.
- `sourceBinding`: null, or `{ creatorAccountId, crmAccountId, clientId,
  deploymentId, configurationVersion, sourceRevision, active, revision }`.
  This increment covers one independently authorized deployment/configuration
  partition. No browser-selected source partition or union is accepted.
- `evidence`: null, or `{ environment, organizationId, observedAt, complete,
  snapshotId, watermark, sourceRevision, clientId, deploymentId,
  configurationVersion, items }`. At most 1,000 rows are accepted. The upstream
  producer must establish a complete bounded snapshot with terminal source-read
  evidence; this module does not fetch, accumulate or certify provider pages.
  Observation must be fresh and nonfuture. Watermark is the latest canonical
  change and may be old for unchanged history, but cannot exceed observation. Source
  revision, partition and every row must match the independent binding.

Missing source/binding yields `state: unknown, items: null`; contradictory data
or incomplete/stale receipts reject. A complete empty visible projection yields
`state: empty, items: []`. No transport failure is converted into an empty list.
Returned observation time is the oldest source/authorization observation.

Call rows are `{ callKey, clientId, deploymentId, configurationVersion, startedAt,
endedAt, outcome }`. Call keys are opaque 64-character lowercase hex values.
Start/end timestamps are canonical UTC; a missing end remains null. Outcomes use
the existing free-test metric-contract taxonomy without reclassification.
Output contains only callKey, startedAt, endedAt and outcome. A call key is not
permission to retrieve details; no detail/recording action is implemented.

### Read-only call filters (offline opt-in)

`prepareFilteredCompanyCallsPage(input, trusted, evidence, policy)` uses the same
authority, source and output contracts, with an additional required input field:
`filters: { outcome, dateRange }`. Outcome is `all` or one existing canonical call
outcome. Date range is null or `{ start, end }` with canonical `YYYY-MM-DD` dates
and start no later than end. Both bounds include the whole **UTC call-start date**;
they are not client-local dates, call-end dates or reporting periods. The two
filters intersect. `all` with a null range returns the unfiltered selection.

Every source row validates before filtering, including rows outside the selected
dates or outcome. Selection precedes pagination, so a page cannot hide later
matching calls. Stable ordering and terminal-page behavior remain unchanged. A
complete nonempty source with no matching calls returns `state: no_matches`,
`sourceState: available`, `items: []` and no continuation. This is distinct from
certified empty and unknown source states. Filters never turn an unknown source
into an empty result or relax current company, grant, partition or freshness
checks.

The continuation binds the exact validated filter values. Changing either filter
requires a fresh request with cursor null, even if the new filter happens to
select the same rows. Filtered and original API cursors cannot be interchanged.
The existing `prepareCompanyCallsPage` envelope is unchanged and rejects a
filters field. Filters are presentation choices only: no saved preferences,
provider queries, native UI, transcript access, booking confirmation, metering,
financial outcome or additional permission is introduced. In particular,
`potential_job` and `urgent_potential_job` are not confirmed bookings or revenue.

Run the complete offline calls/reports suite with:

```sh
node --test "src/zoho-creator/client-portal/calls-reports/test/*.test.js"
```

The existing service-area portal test entrypoint imports both calls/reports test
files. The repository verifier and Repo Checks workflow run that entrypoint; no
second dedicated suite invocation is needed. Outcome-filter coverage reads the
owning gateway's canonical outcome contract instead of duplicating its values, so
an added canonical outcome cannot silently become unsupported by the portal. Passing these source checks does
not close the native integration gates below.

### Released reports

Report rows are `{ reportKey, clientId, deploymentId, configurationVersion,
periodStart, periodEnd, releaseState, releaseRevision, releasedAt, artifact }`.
Periods are canonical calendar dates. Release state is draft, released or
withdrawn. Artifact is null or `{ version, sha256, accepted }`; it identifies
independently verified immutable bytes, not a URL. All rows, including hidden
ones, undergo ownership, shape, chronology and duplicate validation.

For reports, `reportGrants` is a complete array of `{ principalId,
creatorAccountId, reportKey, operation, active, releaseRevision, artifactVersion,
artifactSha256, revision }`. Each principal/company must match current identity.
Only reports.view and reports.download operations are accepted. Duplicate
report/operation grants reject even if one is inactive. Calls require this field
to be null. An unknown binding also requires null.

A visible report requires released state, a release revision/time, an accepted
artifact and an active reports.view grant matching the exact report, release
revision, artifact version and SHA-256. Missing, revoked or mismatching grants
hide that report. `canDownload` separately requires the matching active
reports.download grant. Download permission cannot substitute for view permission.
Output contains only reportKey, periodStart, periodEnd, releasedAt and canDownload.
No raw artifact path, version, hash, URL, grant or private report content leaves
the client-visible list projection. An empty visible list does not disclose hidden reports' existence.
The resolver must reauthorize current release/grants and immutable bytes at the
actual view/download action; this Boolean is not an execution capability.

### Released-report read plan (offline, server-only)

`prepareReleasedReportRead(input, trusted, evidence, policy)` prepares a logical
GET descriptor for one current released report. It does not retrieve bytes, invoke
a provider, authenticate a caller or authorize delivery. Its input is exactly
`{ Account, reportKey, operation }`, with operation `reports.view` or
`reports.download`. Account and reportKey are selectors, not authority. List
results, `canDownload`, copied read plans, cursors, preference envelopes and
browser-supplied artifact identity are not accepted inputs.

The trusted and policy envelopes use the **mandatory current entitlement** fields
from the preference-aware report contract below, even though no preference is
accepted. The full reporting period must fit inside that current entitlement.
The action independently validates current reports.read permission, company and
source binding, every source row, release state, accepted artifact identity and
the exact current reports.view grant. Download also needs its own matching
reports.download grant. A download grant cannot substitute for view permission.
A saved display range has no effect on action authority. Missing, unaccepted,
unreleased, withdrawn, ungranted, unentitled, absent and unknown targets all reject
with the same value-free error. No failure falls back to a legacy list export.

Unlike client-visible list output, the frozen descriptor contains server-only
resolution fields: logical method/resource/operation; pinned environment and
organization; current principal, Creator/CRM company and canonical source
partition; source revision/snapshot; report key, release revision and immutable
artifact version/SHA-256. `checkedAt` records the supplied policy time and
`observedAt` the oldest source/authority/entitlement observation. It includes no
URL, storage path, report bytes or signed access token. The logical resource
`released-report-artifact` is not a qualified native provider route. Do not return
or log this descriptor in a client widget, public response or public CI evidence.

The plan is not a bearer capability, durable grant or proof of provenance. A
protected adapter must independently authenticate the current caller, collect
fresh complete authority and source facts, and run this preparation at the actual
action. After asynchronous resolution, recheck current authority/release/artifact
identity, freshness and expiry before any delivery, and verify the exact fetched
bytes against the accepted immutable identity. A cached plan, prior list hint or
old successful read cannot establish those facts. Deadline/cancellation handling,
live revocation, immutable storage resolution, client-safe response headers,
audit policy and real-session acceptance remain unimplemented native gates. The
offline completion check below covers supplied bytes and evidence only. No download, grant, invitation, customer delivery or native access
is enabled by this source increment.

### Released-report byte completion (offline, server-only)

`verifyReleasedReportReadBytes(plan, bytes, input, trusted, evidence, policy)`
checks an already-read artifact against freshly supplied current authorization.
It returns a private copy of the verified Buffer, not an HTTP response or delivery
authorization. It performs no provider read, lookup, write, clock acquisition,
logging or customer action. Existing preparation and list output shapes do not
change.

The initial `plan` must be the exact frozen object issued by
`prepareReleasedReportRead` in this process. A private WeakMap binds it to the
validated identity, actor/contact, source configuration, selected report and
release, artifact, relevant action-grant revisions, entitlement and policy.
Copied, serialized, forged or cross-process plans reject. This process-local
brand prevents accidental substitution; it does not authenticate the facts used
to issue a plan and is not a bearer capability.

Completion reruns full read preparation with all four current envelopes. The
current operation and private binding must match the original. A new source
snapshot ID, watermark or observation time may advance when the selected target
is unchanged and every row remains valid. Unrelated report grants may change;
view completion does not depend on download permission. Changes to the selected
report, release, artifact, actor/contact, company, source binding, relevant grants,
entitlement revision/bounds or freshness policy require restarting preparation.
Revoked, withdrawn, unaccepted, incomplete, stale, expired or hidden malformed
facts reject with the same value-free error as other projection failures.

The supplied completion time cannot precede preparation. The oldest current
source/authority/entitlement observation must be no earlier than preparation time,
and all normal current freshness and exclusive entitlement-expiry checks still
apply. **These timestamp checks do not prove post-read collection.** A protected
adapter must perform the actual read first, then independently collect new
current authority and source facts, and use an honest current clock. Relabeling
cached evidence is never sufficient. No timer, deadline, cancellation, live
revocation protocol or atomic delivery fence is implemented by this synchronous
function. A further await or delay before delivery needs another current check.

`bytes` must be a nonempty Buffer of at most 2 MiB, matching the existing
immutable report-delivery reader's maximum. SharedArrayBuffer-backed values,
strings, arrays, other typed arrays and implicit conversions reject. Native byte
accessors ignore caller-owned `length`, `buffer` and offset properties. The
function copies the exact byte range into independent, non-shared storage and
hashes that copy against the accepted SHA-256 before returning it. It never
returns the provider's original mutable buffer. The returned Buffer itself is
mutable; downstream code must not change it or substitute other bytes after
verification. A protected reader must separately bound bytes while fetching,
rather than relying on this post-read size check to bound transport memory.

This does not qualify a portal-to-ReportRuns mapping or replace the existing
immutable WorkDrive reader. Provider identity, immutable version resolution,
complete source provenance, native sessions, response headers, content-type
handling and customer-delivery authority remain separate integration gates. The
synthetic completion tests do not establish native access or TOCTOU closure.

## Stable pagination

Complete snapshots are ordered by timestamp descending, then unique stable key
ascending, using code-point comparison. Every row is validated before selection.
Reordering the input has no effect. The next page starts after the prior stable
key; it never applies a live offset to a changing provider collection.

`nextCursor` is an opaque frozen **process-local** object held in a WeakMap.
It is not a browser token or durable session store. Use that exact object for an
offline continuation; copying, forging or serializing it rejects. Each request
must still provide fresh current authority. The cursor pins principal/actor,
company/contact, source binding and revision, grant revisions, resource, page
size, environment/organization, freshness policy, exact source snapshot and report
grants. A changed snapshot, grant, release, artifact or scope rejects continuation;
restart with null after obtaining a new complete authorized snapshot.

Each page returns `{ state, sourceState, observedAt, watermark, items, hasMore,
nextCursor }`. Terminal pages have hasMore=false and nextCursor=null. A missing
source is unknown rather than a certified terminal collection. Cross-process or
browser pagination requires a separately reviewed protected cursor transport;
none is claimed here. No network, writer, logging or implicit clock is used.

## Saved report date preferences (offline, opt-in)

`preparePreferredReleasedReportsPage(input, trusted, evidence, policy)` restores
one saved reporting-period range. It reuses the full report projection above;
the two original exports keep their exact envelopes and behavior. The new export
requires the following additions, even when no preference is saved:

- `input.preference`: null, or the exact versioned envelope
  `{ version: 1, environment, organizationId, principalId, creatorAccountId,
  crmAccountId, resource: "reports", dateRange }`.
- `dateRange`: null to clear the date filter, or `{ start, end }`, both canonical
  `YYYY-MM-DD` calendar dates with start <= end. A report's entire reporting period
  must fit inside these inclusive bounds. This filters reporting periods, not
  release timestamps, and performs no timezone conversion. Reports that only
  overlap the range are excluded; no partial artifact is produced.
- `policy.reportEntitlementPolicyRevision`: a nonempty identifier naming the
  protected server's current report entitlement policy.
- `trusted.reportEntitlement`: a separate current complete receipt
  `{ environment, organizationId, observedAt, complete, principalId,
  creatorAccountId, crmAccountId, resource: "reports", decision: "eligible",
  revision, policyRevision, validUntil, periodStart, periodEnd }`.
  Owner/environment/organization must match current independently established
  authority. Policy revision must match the protected policy; revision is a
  nonempty identifier. Observation must satisfy the same freshness bound and
  must not be newer than the enclosing trusted observation. `validUntil` is a
  canonical UTC instant strictly after `asOf`. Entitled period bounds are
  canonical inclusive calendar dates, start <= end. Every returned report's
  whole period must fit inside them, independently of the saved range.

The saved owner scope is compared with current server-derived identity; it does
not establish identity or grants. Cross-company, cross-user, cross-environment,
cross-organization and cross-resource restoration rejects. Grant, entitlement,
source partition, cursor, URL and other unknown fields cannot be stored in this
preference envelope. Only plain data is accepted, including after JSON parsing.

Current entitlement, reports.read and exact release/artifact view/download grants
are rechecked on every page. A stored range cannot make an ineligible plan eligible
or restore a withdrawn, ungranted or replaced report. An eligible decision is
supplied by a qualified upstream resolver, never inferred from plan names, catalog
rows, payment history or an active subscription. The period window is only one
access constraint; upstream grants must also implement any other current plan
limits. Saved preferences never replace those controls.

All source rows validate before entitlement/preference filtering and pagination.
The cursor additionally binds the normalized preference and current entitlement,
including revision, period, policy and expiry. Any change rejects continuation;
restart with null using fresh evidence. Cursors cannot cross between the original
and preference-aware exports. Do not catch a denial and fall back to the original
export, which does not accept this entitlement/preference contract.

Output keeps the same fields and excludes saved owner/entitlement metadata.
`sourceState` describes the current entitled, released, view-authorized set before
the user's filter. `state: "no_matches"` with an empty array means that set is
available but the saved range excludes every item. Unknown and certified empty
remain distinct; hidden or unentitled rows do not make sourceState available.
Observation is the oldest source/authority/entitlement observation.

This is a restoration/application contract, not a persistence service. Native
save/load wiring still needs an authenticated per-user/per-company store keyed
by the server's independently resolved scope, versioned preference validation,
and current entitlement provenance. The server must derive owner fields on save
and never reuse saved identity as authority on restore. Do not store grants,
entitlement receipts, result rows or cursors as preferences. No browser storage,
schema, record writer, existing storage publisher or new UI is added here.

## Validation and remaining integration

Run the focused suite:

```text
node --test src/zoho-creator/client-portal/calls-reports/test/company-call-report-projection.test.js
node --test src/zoho-creator/client-portal/calls-reports/test/saved-report-preferences.test.js
```

It is also imported by the existing canonical portal test entrypoint. Synthetic
coverage includes two companies, wrong operation/partition, inactive/duplicate
bindings, hidden foreign rows, malformed receipts, stale/future evidence,
snapshot changes, tied timestamps, reordered inputs, forged/cross-company
cursors, report withdrawal and artifact/grant mismatch, privacy and immutability.
Saved-preference coverage adds serialized restoration, ownership boundaries,
invalid dates/shapes, inclusive full-period containment, current entitlement
revocation/expiry/downgrade, filtered hidden foreign rows, no-match states, and
preference/entitlement-bound pagination. Both suites use the canonical entrypoint.
Read-plan coverage adds current action grants/entitlement, withdrawal or artifact
replacement after listing, uniform denial, exact server-only resolution scope,
hidden invalid rows, the complete 1,000-row bound and immutable output.
The retained 768-case read-permission matrix crosses release state, accepted
artifact, current/revoked/absent/stale-artifact view and download grants, action
and entitlement. Only five combinations permit a descriptor; the remaining 763
must fail closed. This is synthetic source coverage, not native access evidence.

Before native wiring, qualify real caller identity and lifecycle, current
operation grants, exact CRM-to-canonical source binding, a complete sanitized
source producer, release/view/download authority, immutable artifact resolution
and protected pagination transport. Then run separate nonempty, revoked and
cross-client acceptance. No current live access or provider predicate is inferred
from these tests. Reuse the existing Calls & Reports result components once that
contract is established; no duplicate call store or placeholder UI is created.

Rollback of the saved-preference increment removes the opt-in export, preference
validation/filtering, its test and its canonical-entrypoint import. The original
calls/released-reports API remains. Rollback of the entire projection removes
the module, original test and its canonical-entrypoint import.
There are no live resources or records to undo.
Rollback of the read-plan increment removes its opt-in export and tests; the
original listing, saved preferences and call filters remain unchanged.
