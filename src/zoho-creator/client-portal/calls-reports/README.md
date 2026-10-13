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
the projection. An empty visible list does not disclose hidden reports' existence.
The resolver must reauthorize current release/grants and immutable bytes at the
actual view/download action; this Boolean is not an execution capability.

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
