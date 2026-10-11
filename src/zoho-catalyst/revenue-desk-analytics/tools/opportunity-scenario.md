# Opportunity scenario calculator

Status: source-only, synthetic verification; no producer adapter, portal binding,
deployment or delivery authority. Owner: Analytics/private reporting.

`opportunity-scenario.js` exposes `buildOpportunityScenario({ cohort, evidence,
assumptions })` and `scenarioCohortDigest(cohort)`. It performs no I/O, reads no
clock, persists no assumptions and changes no facts. The existing
`opportunity-value.js` contractor-evidence estimate is unchanged. This helper does
not consume its monetary totals or introduce a close rate into that estimate.

## Minimum trustworthy producer contract

The caller must be an authorized, verified in-process producer. Arbitrary client
JSON, a digest, review metadata or a field named "verified" is not authentication.
The calculator validates consistency, not the authenticity or completeness of the
underlying source. A future producer must:

1. Verify the full source cohort, reconciliation, source versions and current
   complete call-rowset digest for exactly one client, deployment, configuration,
   environment, engagement type and source revision. Obtain the explicit reporting
   period from authoritative reconciled records, not browser slider state.
2. Supply the complete already-qualified call projection using the existing
   handled `potential_job` / `urgent_potential_job` contract. Do not select calls
   by customer type, raw qualified-call totals, text, transcript or assumed
   conversion. Each entry contains exactly the six `SCOPE_FIELDS` exported by
   `opportunity-value.js`, `CALL_KEY`, `STARTED_AT`, `SOURCE_MODIFIED_AT`,
   `HANDLED_RECORDED`, `OUTCOME`, canonical `requestKind`, and `sourceVersion`.
   The source version is a positive safe integer. Missing canonical intent must
   be represented explicitly as `unknown`, never guessed.
3. Bind each request kind to its exact canonical call key and source version.
   Current `queryClientCallDetails` exposes keyed facts and source versions but
   omits request kind. The ordinary report exposes request kind under correlation
   IDs; no verified key mapping between these projections is available here.
   The existing `opportunityValue` output is therefore insufficient input.
   **The trusted keyed-intent producer remains unimplemented.** Do not join by
   array position, descriptions, phone number or an invented identifier mapping.
4. Verify an explicit single reporting currency and its minor-unit scale. This is
   a cohort reporting denomination, not measured revenue currency. Neither the
   CRM baseline nor existing valuation subtotals establishes it. There is no
   currency inference, currency conversion or exchange rate.
5. Obtain a distinct-opportunity grouping review over that entire qualified
   projection. Reuse the existing reviewed `groupKey`, `callKeys` and
   `reviewStatus` (`qualified` or `incomplete`) fields; omit existing monetary
   bases from this separate projection. Reject duplicate group keys, duplicate
   members and keys outside the cohort. Reviewers establish distinctness; the
   helper cannot detect two different keys assigned to the same real request.
   Grouping must be complete even when a group's qualification reviewStatus is
   incomplete.
6. Bind that review to `scenarioCohortDigest(cohort)`, which hashes canonical
   JSON with calls sorted by call key. It binds scope, period, currency, the
   Analytics rowset digest, keyed request kinds and canonical source versions.
   Recompute and review after any source correction. The Analytics digest alone
   does not attest request kind. Verify review provenance and timeliness upstream;
   this helper only requires review at/after the period end and every source
   modification. It introduces no freshness timeout.

Cohort shape:

```js
{
  scope: { CLIENT_KEY, DEPLOYMENT_KEY, CONFIGURATION_VERSION,
    ENVIRONMENT, ENGAGEMENT_TYPE, SOURCE_REVISION },
  period: { startAtUtc, endAtUtc },
  currency: { code, minorUnitDigits },
  callRowsetDigest,
  qualifiedCalls: [/* exact keyed projection described above */]
}
```

Scope hashes and revision use existing formats. Environment may be development or
production; engagement may be free_test or paid_service. Acceptance of those
dimensions grants no plan entitlement, audience access or runtime authority.
Period timestamps are exact UTC ISO strings with milliseconds. Call-start bounds
are inclusive, matching the current free-test builder. This is a bounded cohort,
not an aggregation of adjacent weekly periods. Currency codes/scales must match
the Node runtime's Intl currency metadata (for example USD/2, JPY/0, KWD/3).

Evidence is either explicit `null` (unavailable) or exactly:

```js
{
  schemaVersion: 1,
  cohortDigest,
  review: { status: 'reviewed', reviewedAt, reviewerReference },
  groups: [{ groupKey, callKeys, reviewStatus }]
}
```

All reference hashes are opaque private inputs. The output omits call/group keys
and reviewer references but retains private scope metadata, so it is still a
private analytical object, not an export or a ready-to-publish client document.

## Eligibility and unknowns

The denominator is the number of distinct reviewed eligible groups, never calls.
A qualified group needs at least one explicit `new_service_request` member and
no unknown member intent. An existing customer's new work can qualify; customer
type does not participate in this calculation. Known existing-job follow-up
members in that same group add no count. A follow-up-only group is excluded.
Incomplete review or any unknown intent excludes the whole group as unknown.

The result exposes qualified-call, reviewed-group, eligible-group, unknown-group,
follow-up-only-group and ungrouped-qualified-call counts. Ungrouped calls remain
calls; no distinct-group count is invented for them. Any ungrouped call suppresses
both numbers and formula, because deduplication is not complete. Missing review
also suppresses them, including for an empty cohort. Completely reviewed known
empty/ineligible cohorts yield explicit zero. A wholly unknown cohort remains
unavailable. When known eligible groups coexist with unknown groups, the status
is `partial` and the scenario covers only the eligible subset.

## Assumptions and math

Both inputs are mandatory; there is no default ticket or booking rate:

```js
assumptions: {
  bookingRateBasisPoints: 2500,     // illustrative caller assumption: 25%
  averageJobValueMinorUnits: 40000, // illustrative caller assumption: USD 400
  currency: 'USD'
}
```

- Expected bookings = eligible groups × booking-rate basis points / 10,000.
- Scenario gross value = expected bookings × assumed average job value.
- With 3 eligible groups, the example yields 0.75 expected bookings and USD 300.
- Booking rate is an integer from 0 through 10,000 inclusive. Job value is a
  nonnegative safe integer in the verified currency's minor units. Explicit zero
  is valid and distinct from missing evidence.
- BigInt intermediates preserve exact products. Gross value is rounded once on
  the aggregate, half up to the nearest minor unit. There is no per-group rounding
  or rounding expected bookings to whole jobs.
- Final minor units and the expected-booking numerator must fit safe integers;
  otherwise the function throws `SCENARIO_TOTAL_OVERFLOW`. The returned formula
  also carries exact numerator strings and denominators. The numeric fractional
  booking expectation is a display convenience; retain the rational components
  for exact reuse. Results contain no BigInt and are JSON serializable.

Changing job value changes only money and its formula component. Changing the
assumed rate changes expected bookings and scenario value. Neither changes the
cohort or any measured calls, confirmed bookings, completed jobs or paid revenue.
Use the label **Opportunity scenario** and the returned limitation beside results.
Do not present this as jobs saved, recovered revenue, ROI or proven profit.
Service-cost ROI is excluded because attributable profit evidence is absent.

## Verification and future integration

The synthetic suite is picked up by the existing Analytics `test/*.test.js`
command. Focused check from the repository root:

```powershell
node --test src/zoho-catalyst/revenue-desk-analytics/functions/analytics_sync/test/opportunity-scenario.test.js
```

No live read/write, widget, native portal copy, weekly reducer, storage, Billing,
export, provider or deployment behavior is wired here. Future integration must
implement and verify the producer contract above and separately enforce existing
entitlement, audience, delivery and publication gates. Client assumptions stay
ephemeral. Containment is simply to leave this unbound module unused; rollback
requires no data migration or fact repair.
