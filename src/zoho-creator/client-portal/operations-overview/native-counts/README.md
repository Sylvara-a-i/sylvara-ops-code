# Operations native Count replacement packet

Status, 2026-10-12: **prepared source only**. No native component was installed, no record was read for this packet, and no permission or data changed. This replaces the existing functional HTML counters with six real native aggregate panels; it does not turn client call/report placeholders into live data. The client identity gate remains open. The packet targets only the internal Sylvara.ai space's Development Operations_Dashboard.

[`packet.json`](packet.json) fixes the six source forms, ID counts and exact current criteria. Each linked `.zml` file is a concrete native panel using `type='Form Data'`, not a hardcoded number or page-variable fixture. The sources reproduce the six count queries in the immutable [Development baseline](../../development-baseline/Operations_Dashboard.html). Fresh live prestate must still be captured before installation. Source names are proposed local element names; no native import/save or Count/permission behavior has been qualified.

The six existing HTML metrics share one snippet with the page header, empty-inventory message, latest sync and bounded queue tables. A coherent replacement must migrate the count group together; a separate single native card would leave duplicate metrics and disjoint spacing. Use native two-row/three-column cards in their original order. Move the two existing heading/intro strings to [`operations-header.zml`](operations-header.zml), then place the six native panels before the remaining HTML sync/queue snippet. Preserve that snippet's complete Deluge and empty-inventory condition, which still needs the six count variables. Preserve existing copy and theme. Do not introduce filler panels or explanatory placeholder text. Do not overwrite the baseline.

## Exact installation sequence after prerequisites pass

1. Read back current Development page components and source; capture the HTML snippet and panel/report/chart positions privately. Verify existing internal roles and client denial without modifying them. Confirm no matching native count panels/presets already exist. Verify field/picklist and Count semantics; neither an owner preview nor a hidden navigation entry proves staff/client isolation.
2. Add/configure six separate native panels with these exact sources, or use the native Display tab: Zoho Creator -> the fixed form -> Count -> Selected records -> the exact criterion -> Actual -> no units. Use the component's Code readback to verify `ID.count` and all filters. No panel action is configured. Do not create a preset shared with another page.
3. Verify each native aggregate against the current authorized staff projection. Counts describe records, not active subscriptions, service availability, revenue or paid entitlement. Unknown, denied or failed reads must not be presented as valid zero counts. A known empty dataset qualifies zero only; nonempty/filter boundaries need separately authorized synthetic records or already authorized evidence.
4. Once parity is proven, remove the six `<div class="sv-card">` counters and their enclosing `sv-counts` block from the saved HTML candidate. Remove exactly the existing `<h1>Operations Overview</h1>` and `<p>Record inventory and review queues.</p>` after the native header is present. Keep the complete Deluge block, empty-inventory logic, sync/queue sections and their encoding unchanged. Native report `All_Company_Settings_Requests` and the provisioning chart remain in place. Verify no duplicate heading/metric, duplicate count panel, report or chart remains.
5. Render desktop at 1534px, tablet web at 768px and narrow web at 390px; inspect screenshots, text/number clipping, whitespace and original desktop compactness. Inspect native Phone and Tablet Stacked previews separately. Native Count syntax has no verified web breakpoint: if narrow web quality fails, restore the captured prestate and report the failure. Do not call all-size quality achieved from width measurements or native device previews alone.
6. Re-read saved sources/configuration, compare all six count/filter bindings and component IDs, and verify unchanged existing role visibility and disabled business actions. Any missing staff or client-negative session blocks access qualification; do not create users, select demo personas, grant access or infer a result. No Stage/Production publish follows this packet.

## Verification matrix

| Check | Required result |
| --- | --- |
| Five source forms and six Count/criteria bindings | Exact match; Billing event filter retains Environment == Development and Processing_Status == Failed |
| Empty valid data | Actual native count 0; source is available and authorized |
| Nonempty/filter boundaries | Matches authorized legacy aggregate; unrelated status/environment does not count; otherwise unqualified |
| Existing staff role | Intended internal aggregates only; no role change |
| Client/anonymous role | Denied page/aggregate; no staff counts or source errors disclosed; otherwise unqualified |
| Unavailable/denied source | Explicit failure/blocked rendering; no fabricated 0; provider behavior needs empirical qualification |
| Duplicate/preset inventory | No extra metric, shared preset mutation, duplicate report or chart |
| Three web widths and native devices | Screenshots prove readable labels/counts, acceptable spacing and preserved compact desktop; otherwise restore |
| Existing native report/chart/actions | Same component targets and behavior; no record mutation |

Rollback restores only the captured count display and unbinds new panels. It does not delete data, change permissions or attempt to undo native record writes. No live rollback is needed for the current prepared-only files.

Reproduce the offline packet check with `python src/zoho-creator/client-portal/operations-overview/native-counts/verify-packet.py`. It parses all seven XML sources, verifies each aggregate/criterion against the existing independent baseline query, checks the exact header strings, and rejects actions or source-set drift. This is source validation, not native runtime or access qualification.

## Supported capability and layout boundary

Official sources checked 2026-10-12: [native panel display](https://help.zoho.com/portal/en/kb/creator/developer-guide/pages/panel/articles/configure-panel-display-element) documents Count/selected records/Actual; [ZML text](https://help.zoho.com/portal/en/kb/creator/developer-guide/zml-guide/articles/text-tag) documents `Form Data`, `appLinkName.formLinkName.ID.count` and criteria. These establish source capability, not Sylvara runtime permissions or import success.

The [native layout controls](https://help.zoho.com/portal/en/kb/creator/developer-guide/pages/create-and-manage-pages/articles/customize-layout-for-web) offer Web Card/Plain plus margins, and Phone/Tablet Stacked/Actual. Fresh Overview screenshots retain three compact columns at 1534px and readable three columns at 768px; 390px remains squeezed/clipped. Native Phone/Tablet previews stack. No supported web breakpoint was found among the inspected controls; no current page layout was changed. This packet does not solve that provider-rendering gap or authorize native portal authentication testing.
