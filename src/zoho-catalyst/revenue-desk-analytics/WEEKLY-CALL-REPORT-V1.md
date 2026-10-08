# Weekly Call Report Reducer v1

Status: source-only operator-review data; not deployed or wired to a report, export,
scheduler, portal, or delivery path. Catalyst reconciled call facts remain the
source; Analytics is derived reporting. No plan entitlement is inferred.

`tools/build-weekly-call-report.js` exports two synchronous pure functions:
`weekBounds(weekContaining, timeZone, weekStartsOn)` and
`buildWeeklyCallReport(options)`. Neither performs I/O, changes inputs, joins
tenants, reads credentials, nor calls a provider. The existing
[daily reducer](functions/analytics_sync/lib/daily-rollup.js) and
[metric contract](../../../docs/zoho/standards/call-reporting-metric-contract.md)
retain ownership of metric definitions. The value-evidence calculator is unchanged.

## Input contract

All option fields below are explicit except `completeness`, which may be omitted
or null to mean unknown. Unknown object keys fail closed. Use synthetic values in
Git; actual scope keys and facts belong only in approved private systems.

| Field | Meaning |
| --- | --- |
| `calls` | Array of canonical minimized call facts, including latest corrections; never daily totals or a delta-only feed |
| `scope` | Exactly `ENVIRONMENT`, `CLIENT_KEY`, `DEPLOYMENT_KEY`, `CONFIGURATION_VERSION`, `ENGAGEMENT_TYPE`, `METRIC_VERSION`; same validators as canonical facts |
| `weekContaining` | A UTC instant identifying the desired local calendar week, including a week with no calls |
| `timeZone` | Explicit supported IANA zone, for example `America/Chicago` or `Etc/UTC`; no implicit timezone or numeric offset |
| `weekStartsOn` | Explicit integer: 0 Sunday through 6 Saturday |
| `sourceWatermark` | Reconciled source snapshot cutoff; at least every supplied fact's modified time |
| `sourceRevision` | Reviewed reducer source Git revision using the canonical fact validator |
| `completeness` | Optional trusted-producer evidence described below |

Report timestamps require canonical UTC `YYYY-MM-DDTHH:mm:ss.sssZ`. Call facts
use the existing minimizer, which also accepts UTC timestamps without milliseconds
and normalizes them. Environment is `development` or `production`; engagement
is `free_test` or `paid_service`. Only `revenue_desk_metrics_v1` is supported.
Every candidate, even a stale correction or a row outside the selected week, must
match all six scope fields. Scope cannot span configurations or deployments.

The period is local midnight on the chosen starting weekday, inclusive, through
local midnight seven calendar dates later, exclusive. Calls belong by their
latest `STARTED_AT`, not completion time, correction time, or UTC date label.
The returned UTC duration may therefore be 167, 168, 169 hours, or another duration
for a non-hour DST transition. Year rollover is calendar arithmetic.

Supported local boundary dates are 2000-01-01 through 2099-12-31 using the runtime's
IANA timezone database and minute-aligned modern offsets. The bounded midnight
search rejects missing or repeated midnight instants and unsupported dates/zones;
it never silently picks a DST disambiguation policy. Pin the repository's Node/ICU
runtime for reproducibility. Future timezone-law changes can require recomputation
under a separately reviewed runtime. No live timezone configuration is read.

## Completeness and trust boundary

Evidence has exactly these fields:

```js
{
  scope,                         // exact six-field report scope
  periodStartAt, periodEndAt,     // exact weekBounds startAt/endAt
  sourceWatermark,                // exact options cutoff
  coveredStartAt, completeThroughAt, // start inclusive, end exclusive
  inventoryComplete,             // explicit Boolean
  correctionsComplete            // explicit Boolean
}
```

Coverage must lie within the requested week, be ordered, and end at or before the
source watermark. Both flags true and full-period coverage give `complete`.
Both flags true and a nonempty shorter interval give `partial`. Missing evidence,
either false flag, or an empty interval gives `unknown`. Partial coverage can
represent an ongoing week or a deployment beginning partway through it; it never
certifies the uncovered time as zero.

These flags are assertions from an already trusted, authorized producer. This
pure function checks shape, scope, timestamp consistency, and supplied facts.
**It does not authenticate evidence or prove live producer completeness.**
Before setting either flag, a future producer must independently establish:

- exact environment/client/deployment/configuration/engagement/version predicates,
  authorized access, complete pagination, and no unexpected or truncated rows;
- a stable source snapshot through the cutoff, reconciled source keys/counts and
  canonical fact readback, and no unresolved processing or source omissions;
- the latest version of every potentially affected call, including a successor
  moved outside the week, late arrivals, and corrections through the watermark;
- an authoritative withdrawal/deletion policy. This call contract has no tombstone
  type; unsupported deletion evidence must withhold completeness, not remove a
  row silently or substitute `HANDLED_RECORDED=false` as an invented tombstone;
- approved freshness and historical coverage evidence, with source query,
  reconciliation, and immutable prior-report/correction records retained privately.

A timestamp at the end of a week, successful query, empty fact table, matching
rowset digest, or caller-supplied flags alone cannot establish those claims.
No trusted producer or live-source adapter is added here. The reducer cannot
detect an omitted successor or omitted call. A future consumer must refuse
publication when producer identity, freshness, completeness, or access is unknown.

## Reduction and output contract

All supplied versions are minimized and checked for same-watermark conflicts,
including conflicting stale versions hidden by a newer row. Canonical
`deduplicateCalls` then keeps the latest source watermark per opaque call key.
Identical replays do not change output. Only afterward are call timestamps
filtered into the week. A moved-out correction removes the old contribution.

Selected raw calls are grouped by UTC date solely to invoke
`buildDailyMetricFact` for the existing calculations. No stored UTC daily totals
are consumed, relabeled, or used to infer local-week membership.

The result contains `contractVersion: 'weekly_call_report_v1'`, scope,
source revision/watermark, and:

- `period`: `timeZone`, `weekStartsOn`, local `startDate`/`endDate`, and UTC
  `startAt`/`endAt` with the inclusive/exclusive interpretation above.
- `coverage`: `state`, `startAt`, `completeThroughAt`, and both evidence flags.
- `metrics`: each canonical count has `{ observed, total, state }`.
  `observed` describes the supplied latest in-week facts. `total` is a number
  only with complete full-week coverage and available required fields;
  otherwise it is null and state is `unknown`. Never display null as zero.
- `corrections`: `state` is `reconciled_through_watermark` only when the
  producer asserts corrections complete for the coverage interval, otherwise
  `unknown`; it does not assert an entire partial week is final.
  `observedSupersededVersions` counts distinct superseded input versions across
  the supplied cohort. `latestCallWatermark` is the maximum supplied call
  watermark, or null. `modifiedAfterWeekEnd` counts latest selected facts
  modified at/after the exclusive week end. It may include late initial arrivals;
  it is not proof that a previously delivered report changed.

Only `HANDLED_RECORDED=true` calls count. Qualified opportunities, existing
customers, wrong fit, spam, unresolved, general inquiry, and privacy stop remain
the exhaustive exclusive call mix. Urgency overlaps that mix and is not additive.
Bookable opportunities and office follow-up retain independent Boolean evidence
requirements: one missing flag on any handled call makes that observed metric
and weekly total null. Unhandled calls do not create missing-flag uncertainty.

An empty array has observed zero counts, but complete weekly zero totals require
full-week evidence. Missing weeks are unknown. Observed counts are neither a
complete-period total nor a guaranteed lower bound after future corrections.
Counts are calls, not deduplicated opportunity groups, bookings, revenue, or ROI.

## Verification and operational boundary

From the repository root:

```powershell
node --check src/zoho-catalyst/revenue-desk-analytics/tools/build-weekly-call-report.js
node --test src/zoho-catalyst/revenue-desk-analytics/functions/analytics_sync/test/weekly-call-report.test.js src/zoho-catalyst/revenue-desk-analytics/functions/analytics_sync/test/daily-rollup.test.js
npm run ci --prefix src/zoho-catalyst/revenue-desk-analytics/functions/analytics_sync
.\tools\verify.cmd
```

Tests use synthetic facts and cover replay/conflict/correction behavior, scope,
mixed outcomes, local boundaries/DST/year rollover, partial and missing coverage,
and verified empty weeks. Passing them proves only the tested pure behavior.

No schema, dashboard, runtime wiring, scheduled export, embed, customer send,
storage, entitlement, annual comparison, or financial action is included.
Manual Zoho setup required for this source-only change: none. Live integration
needs its own producer qualification, acceptance, authorization, and readback.
Containment is to leave this unreferenced helper unwired; source rollback removes
these additions and cannot alter a live system. Preserve prior report versions
when future authorized consumers recompute corrected periods.
