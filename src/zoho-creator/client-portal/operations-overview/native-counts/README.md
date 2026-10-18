# Operations native Development checkpoint

Status, 2026-10-18: **installed and retained in Development under the existing
owner/admin context**. This checkpoint reconciles the saved native header, six
Count cards, HTML remainder, and page-local pending-request navigation. It
supersedes the prepared-only packet dated 2026-10-12. It is not a client portal
integration, broader staff rollout, Stage/Production publication, or launch.

Creator owns this bounded operational record inventory and human review view.
CRM, Billing and Books retain their business/accounting authority. Counts do not
establish active paid plans, entitlement, revenue, service availability, approval,
or an applied company-settings change.

## Exact saved sources and preservation

- The seven header/count `.zml` files are exact saved Code readbacks, including
  Creator's `thisapp` normalization and generated element names. The pending
  company-change Count omits `displayType` in its saved source; the native UI
  showed Actual/default and the observed empty result was zero. Nonzero number
  formatting remains unqualified.
- [`all-company-requests.zml`](all-company-requests.zml) is the exact saved native
  OpenReport button source. It targets the existing `All_Company_Settings_Requests`
  in the same window, without parameters, selectors, or a custom URL. Native
  new-window navigation was blocked by the browser; same-window navigation and
  return to Operations were tested without changing browser permissions.
- [`Operations_Dashboard.preimage.html`](Operations_Dashboard.preimage.html) is
  the complete safe source preimage captured before replacement. The historical
  [baseline](../../development-baseline/Operations_Dashboard.html) stays unchanged.
  Their only differences are an already-absent `Failed` note under the old billing
  count and the preimage's final newline. No query or other logic differs.
- [`Operations_Dashboard.saved-readback.html`](Operations_Dashboard.saved-readback.html)
  is the exact persisted remainder. Removal of preimage bytes `[8204, 9389)`
  removes only the complete original heading, intro and six-card group. Creator
  then removes one final LF: 11,000 → 9,815 → 9,814 bytes. All Deluge, CSS, sync,
  empty-inventory condition and bounded HTML queues are preserved. The six old
  count queries remain because the retained Deluge condition uses them.
- [`packet.json`](packet.json) records source digests, six exact mappings,
  page-local queue controls, component order, observed qualification and rollback.
  It is a sanitized dated checkpoint, not an automated live-state attestation.

Final page order is:

1. Native heading `panel_1`
2. Company and subscription Counts `panel_2`, `panel_3`
3. Pending and failed provisioning Counts `panel_4`, `panel_5`
4. Failed billing and pending company-change Counts `panel_6`, `panel_7`
5. Preserved HTML `html_snippet5`
6. Existing settings-request report `report_1`, titled **Pending company changes**
7. Native **View all company requests** button `panel_8`
8. Existing subscription-attention report `report_4`
9. Existing provisioning-status bar chart `chart_1`
10. Existing provisioning-attention report `report_3`
11. Existing Development billing-failure report `report_2`

All **four** reports and the chart were retained in their prior relative order.
Do not replace this inventory with the old packet's one-report assumption.

## Pending queue and full history

The settings-request embed already had `Status == "Pending review"`; its filter
was inspected and left unchanged. The exact current Status choice was verified.
The only changes were an enabled page-local title and the separate native
navigation panel. Search and record count remain enabled; all mutation, bulk,
print/export, retain-changes and public-access controls remain disabled.

The full existing report has no configured report-level criteria. Its metadata
was identical before and after this change. Owner click-through opened its empty
state without a page-local filter, and both Operations navigation and browser
Back returned correctly. The button inherits existing destination permissions;
it grants no access. The shared report, records and original HTML queue were
not changed. Only the current empty data state was exercised, so exclusion of
non-pending records and real historical-row behavior remain unqualified.

## What was and was not qualified

Observed and independently reviewed private evidence established:

- Saved native sources and all six form/Count/criterion bindings
- Empty owner-data parity between the original six counters and native Counts
- Preserved HTML bytes, existing components and page-local report controls
- Native-card desktop 1179px, tablet-web 770px and narrow-web 390–391px readability
- A readable pending queue title and usable full-report button at 391px
- Native Phone/Tablet Stacked **layout previews**, with `Ct()` placeholders

The retained layout is **three rows of two** Count cards. The initial three-column
layout clipped labels at narrow width and was replaced before final acceptance.
Native preview stacking does not prove native-device data execution. The dense
embedded table and Creator owner shell still horizontally scroll at narrow
widths; do not describe the entire dashboard as mobile-optimized.

Access remains **owner/admin-only Development**. Other internal profiles remain
denied, and inspected client profiles remain denied. No grant, identity, account,
provider transport, record or billing change was made. Owner rendering and
configured denials do not establish real client-negative/session isolation.
Nonempty/filter-boundary counts, denied/error-versus-zero behavior, actual native
mobile-device execution and broader staff access remain unqualified. A future
broader rollout requires fresh authorized acceptance, not this packet alone.

Client-facing Calls, Settings and Billing still require the independent
[identity, tenant binding, operation grants and provider transport gates](../../NATIVE-INTEGRATION.md).
This staff Operations checkpoint does not close any of those gates.

## Reproduce offline checks

From the repository root:

```sh
python3 src/zoho-creator/client-portal/operations-overview/native-counts/verify-packet.py
python3 -m unittest discover -s src/zoho-creator/client-portal/operations-overview/native-counts -p 'test_*.py' -v
```

The verifier checks exact HTML preservation/rollback, legacy/native predicate
parity, eight native source files, one bounded navigation action, all four
reports/chart, component order and unchanged queue controls. Mutation tests cover
wrong counts, missing environment predicates, actions, static zeros, query
selectors, target changes, source drift, dropped components and inflated
qualification. It performs no Creator IO or record mutation and cannot refresh
live qualification. The canonical `tools/verify.ps1` invokes these checks, including
through the existing Linux CI verifier job.

Before any future native edit, capture fresh source/configuration, verify the
current Development target and grants, reconcile prior writers, independently
review the bounded patch, and re-read the saved result. Do not replay this
installation blindly or create duplicate panels/presets.

## Reversible rollback

### Queue-only rollback

1. On `report_1`, restore the previously blank title and disabled title visibility.
   The native title icon toggles visibility; enabling it opens the stored title.
2. Remove only `panel_8` and its now-empty row. Its saved source display name is
   `Panel 7`; use the component ID/location, not that display name alone.
3. Keep the Pending review filter, shared report, all controls, HTML remainder,
   header/Count panels, other three reports and chart unchanged. Reload and verify.

### Full header/Count replacement rollback

1. Undo the queue-only additions above if returning to the complete pre-change page.
2. Restore the **entire** captured preimage HTML, including the original heading,
   intro and all six count cards. The verifier's `restore_preimage` function proves
   the byte-exact reconstruction but does not write to Creator.
3. Remove only `panel_1` through `panel_7`, **including the native header**. Restoring
   count markup alone or leaving the native header would be an incomplete rollback.
4. Retain `html_snippet5`, all four reports, chart and prior relative order; keep all
   data, filters, grants and external bindings unchanged. Verify saved source and
   empty-state rendering after restoration. No irreversible deletion is required.

Source rollback does not undo business data because this change wrote none. Any
future changed preimage, unknown save result or unavailable recovery control
requires reconciliation before retry or rollback.

## Evidence retention and public boundary

Private Library packages retain screenshots, account/profile metadata and exact
UI/connector readbacks. Those materials, identifiers and storage locations are
intentionally absent from Git and CI. This repository contains only safe source,
portable component names, preservation tests and bounded outcome statements.
Merging source reconciliation does not publish or redeploy the Creator page.
