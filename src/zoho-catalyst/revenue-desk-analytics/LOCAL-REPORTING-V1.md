# Free-test client draft: local implementation

Status: local synthetic implementation; not deployed, not for customer delivery.
Owner: Revenue Desk reporting. Revision: 2026-09-29.

## Scope and reconciliation

The reporting paths at the reviewed release head and its preceding main revision
had the same three gaps: request descriptions existed in canonical calls but not
the client report, call-grain value evidence did not calculate distinct-job value,
and terminal CRM/outbox reconciliation did not generate a document. This change
extends the existing builder and renderer rather than replacing the accepted
summary, internal report, Journey, demo, or reporting platform.

| Layer | Implementation | What it does not prove |
|---|---|---|
| Canonical call detail | Runtime `queryClientCallDetails` uses the existing validated report query; immutable in-memory snapshot | A serialized file is not a trusted snapshot |
| Analytics | Existing minimized facts, source versions, three-type rowset digests and readback gate | No new caller descriptions, transcripts, identities or public links in Analytics |
| Report-input assembly | Canonical source, settled outbox history, checkpoints and independent complete-partition readback are validated together | The live complete-partition reader remains unbound |
| Client report | Existing builder plus private call ledger and reviewed opportunity estimate | No booking, revenue, delivery or completed-callback claim |
| Draft generation | `prepare-free-test-draft.js` renders the existing client layout and writes a deterministic private artifact plus receipt | Local storage is not accepted WorkDrive storage or a deployed job |
| Results review | Existing owner results-review step includes grouping and value applicability | Not a new per-call approval or mandatory CRM Note workflow |
| Delivery | Existing reviewed closeout/delivery procedure remains separate | A generated receipt is never permission to email |

## Private call ledger

`queryClientCallDetails(store, config, clientId, deploymentId, asOfMs)` returns a
branded snapshot only after the existing runtime ownership, source-version,
count, canonical-record and notification checks. `build-private-call-ledger.js`
requires this in-memory brand, a snapshot no older than five minutes, matching
scope/revision and exact equality with every attested minimized Analytics call.
It refuses partial or mismatched cohorts. This is an application trust boundary,
not authentication of an arbitrary adapter supplied by a caller.

Each client draft retains every underlying call, including unhandled attempts,
with document-local references, UTC time, supported route and observed trigger,
caller request, issue summary, outcome, urgency and known alert state. Trigger is
not inferred from approved route. Sensitive-content withholding is preserved.
Unknown inbox receipt, business acknowledgment and completed follow-up stay
Unknown; provider acceptance is not human completion.

Descriptions stay in canonical records and the authorized private draft. No new
database or Analytics text fields are introduced. Keep the existing readers and
retention; a new rendering does not authorize wider access or longer retention.
The old runtime JSON/CSV and default internal report remain unchanged. The new
detail path is explicit, not a silent expansion of existing exports.

## Estimated Opportunity Value

The existing results review supplies the strict packet consumed by
`tools/opportunity-value.js`. It binds to the exact client, deployment,
configuration, environment, engagement, source revision and attested call-rowset
digest. The review cannot predate corrected call facts. Scope and reference hashes
are private input and are not printed in the client document.

The reviewer explicitly groups related qualifying calls. Matching phone numbers
do not group calls; the module does not receive phone numbers. Every underlying
call stays in the ledger, and a call cannot belong to two valued groups. Calls not
yet grouped are counted separately without inventing a number of distinct jobs.

For each reviewed qualified group, prefer the documented contractor known-job
value, otherwise its documented applicable exact average job value. Attaching an
average to the group records applicability; there is no global fallback or
price-band midpoint. Each basis records integer minor units, currency, a private
evidence reference and effective date. Missing evidence is Unknown, not zero.
An explicitly documented zero is distinct from missing evidence.

Value each group once. Reusing one known-job reference for multiple groups,
conflicting evidence, duplicated membership and unsafe integer totals fail
closed. Applicable average evidence may be reused. Sum currencies separately,
using the currency's minor-unit scale; never invent an exchange rate. The client
document replaces opaque keys with local opportunity/call references, records
the selected basis and shows missing-value/incomplete-review and ungrouped-call
counts beside any incomplete subtotal.

The exact heading is **Estimated Opportunity Value**. The amount is not confirmed
lost revenue, recovered revenue, bookings, profit or collected revenue. No close
rate or generic contractor price is assumed. Owner-reviewed evidence is still
an input requirement; the pure calculation does not authenticate its supplier.

## Generation, review and live integration boundary

The actual runtime terminal path stops admission and reconciles CRM plus the
Analytics outbox. Its `REPORT_RECONCILIATION_STATUS=Completed` is insufficient for
document generation. Analytics separately imports, independently reads back and
commits checkpoints. All three scoped record types must be complete:
`deployment`, `call`, and `final_test_result`. A final-result batch can complete
before the other types, so no one batch success is a complete report trigger.

The local coordinator reruns the existing full gate before rendering. It requires
canonical call details and may initially prepare an unvalued draft when results
review is not yet available. A subsequent reviewed packet creates a revised
draft; it never sends either version. The generation key binds all rowset digests,
scope, final-result revision, renderer version and actual rendered content.
Refreshing readback timestamps alone does not duplicate output. Changed request
content or changed valuation produces a distinct revision even when aggregate
counts remain unchanged.

`read-reconciled-free-test-input.js` now assembles the report input from the
canonical runtime and Analytics stores. It requires the current completed
deployment and final-result facts, settled source history, exact checkpoints and
independent readback for all three record types. The private ledger remains a
branded canonical snapshot. The assembler re-reads source, checkpoints and
canonical details after asynchronous reads; moving, stale, conflicting or
cross-scope evidence fails closed. Empty tests require independent proof that the
call partition is empty, not an invented call checkpoint. The bounded source
reader refuses a full 100-row page for any record type instead of reporting a
truncated history as complete.

The existing checkpoint freshness gate is unchanged. A fresh partition readback
does not waive an expired checkpoint, and a completed-deployment scan does not
refresh checkpoints or resubmit imports. The current service creates checkpoints
after import and independent readback; `upsertCheckpoint` returns an existing
checkpoint unchanged for the same or an older source watermark. No accepted
re-attestation path currently refreshes an unchanged completed partition. Initial
Development acceptance can use genuinely fresh import/readback checkpoints within
their existing freshness window. A delayed retry or later results-review revision
needs a separately approved and implemented reconciliation procedure; editing
timestamps or reimporting completed rows solely to extend freshness is not one.

The provider client now implements `readCompleteScope(scope, recordType)` using
the official [synchronous Export Data API](https://www.zoho.com/analytics/api/v2/bulk-api/export-data.html)
(contract reviewed 2026-09-29). It first verifies the fixed view, table type,
workspace and organization through the existing metadata boundary, then requests
all matching environment/client/deployment rows and exactly six approved columns.
It never filters by known record keys, so unexpected rows remain visible to the
assembler; an explicit empty export proves zero calls. It rejects partial HTTP
responses, unrecognized or paginated JSON envelopes, extra/missing columns,
duplicate/cross-scope keys, invalid hashes/watermarks and 100 or more rows.
Streamed response bytes and the entire authorization/metadata/export operation
are bounded; timeout aborts the request and prevents late authorization from
starting a read. The coordinator forwards its worker cancellation signal through
the assembler to the adapter, releasing pending authorization/body waits and
preventing reads of later partitions after cancellation. Only the read
authorization provider is used. The established
asynchronous batch import/readback protocol is unchanged.
Canonical helper reads and source-history enumeration also check cancellation
before each subsequent store request. A Catalyst SDK query already in flight
retains its existing timeout; its late result cannot start another query.

This is local adapter code, still unbound. Official documentation establishes
the synchronous request contract, but does not show its exact JSON response
envelope. The three conservative envelopes already supported by batch readback
are locally tested; the actual authorized target's JSON envelope, content type,
all-column visibility, row-filter access and zero-row behavior remain independent
Development acceptance requirements. The synchronous API excludes live-connect
workspaces, query tables, dashboards and tables exceeding one million rows;
unsupported targets fail closed rather than falling back to an incomplete read.
Each complete source pass performs six read-only provider requests: one metadata
GET and one export GET for each of three types. Revalidation after an asynchronous
results-review lookup can perform a second pass, for twelve requests per attempt.
Before binding, approve the exact scheduling, request/cost limits and total worker
latency budget; the existing per-operation timeout is not a demonstrated budget
for that composition. This source change does not activate provider polling.

`createTerminalDraftReconciler` composes that assembler with the existing draft
writer. The runtime's existing completed-deployment scan invokes it through an
optional trusted `terminalDraftReconcilerFactory`. It returns
`awaiting_reconciled_evidence` until Analytics is ready. Failed generation remains
eligible for the next fair completed-deployment scan, without replaying completed
CRM operations or Analytics imports. The worker bounds the callback by its
existing platform timeout; the coordinator checks cancellation before writing so
a late read response cannot create a document after the scan times out.

The deployed factory remains `null`. Job parameters and environment variables
cannot enable it. The automatic source lane remains the existing `Completed`
deployment lane; this change adds no automatic stopped/rolled-back report lane.
The older optional Analytics `onReconciledScope` wakeup and
`createReconciledDraftTrigger` remain compatible, but an already-succeeded import
is not the durable retry mechanism for document generation.

Local integration tests compose the existing worker with the runtime and
Analytics memory fixtures: actual inbound/event classification, expiry and report
rebuild, actual CRM summary dispatch/readback, runtime-produced outbox, Analytics
import/readback/checkpoint transitions, and the generated client HTML. Incomplete
partitions wait; complete evidence generates the draft. No hand-built
final fact substitutes for the terminal runtime output in that integration test.
A callback failure surfaces a fixed reconciliation error while preserving the
completed writes. A later worker scan retries the draft. An asynchronous
opportunity-review lookup is followed by another source validation before render;
review corrections produce a distinct draft and preserve the original.

An exclusive intent and exact-byte readback protect the local HTML and hash-only
receipt. A complete document can recover a missing receipt. A missing, partial or
conflicting document requires reconciliation; no blind rewrite occurs. Receipt
status always requires owner review and explicitly denies delivery authority.
Files must be outside Git, without links, in an already approved private directory.
File mode 0600 does not establish Windows ACL privacy. The storage owner must
verify access and retention before any real input is used.

Remaining integration work is bounded. These are separate evidence layers:

| Requirement | Existing evidence and remaining gap | Next action and passing condition |
|---|---|---|
| Complete-partition Analytics read | Local provider adapter, assembler and rejection tests exist. Live target configuration, effective role visibility, exact response contract and runtime latency are unverified; factory stays unbound. | Under separately scoped Development read authority, verify fixed table/workspace/organization and read role, full and empty exports, unexpected-row detection and exact six-column digests. All three partitions must match canonical source and fresh checkpoints within the worker budget; no import or state mutation by the reader. |
| Durable private drafts | Existing local exclusive intent, deterministic generation key, exact-byte recovery and hash-only receipt are tested. An approved WorkDrive destination and durable adapter contract have not been established. | Owner selects one private Sylvara WorkDrive Team Folder and fixed parent, service principal, authorized readers and retention. Then verify the upload/version/readback contract and implement serialized generation-key state, immutable draft revisions and ambiguous-write recovery. Concurrent/repeated attempts must yield one matching document/receipt; conflicting or uncertain outcomes remain held. |
| Fresh checkpoints | The existing service checkpoints genuinely imported and independently reconciled batches. Same/older watermarks do not refresh; completed scans and report reads perform no checkpoint writes. | Initial acceptance runs inside the actual fresh-checkpoint window. Before later review/retry outside it, approve and implement authoritative re-attestation with exact source/rowset equality, concurrent-change rejection and independent durable readback. Expired or conflicting checkpoints must still block generation. |
| Installed composition and retry | Source worker hook/factory and local completed-scan recovery are tested. The shipped worker index still binds only its logger; report tools are outside the Analytics package's `files` allowlist. A deployable reporting composition and durable writer remain missing code, installation and runtime acceptance. | After the durable storage contract is approved, package the existing assembler/renderer/writer dependencies with the worker, inspect and verify the exact artifact/source revision, then separately authorize installation and binding. Verify bounded scheduling, cancellation, failure recovery and no replay of completed CRM/import writes against the approved destination. |

Recommended storage is that one private WorkDrive Team Folder, consistent with
the existing [document ownership standard](../../../docs/zoho/standards/document-lifecycle.md).
This recommendation does not claim an existing accepted folder or create one.
Approval must name the exact private destination, writer identity, readers,
retention, permitted operations and reconciliation/readback procedure. A filename
or upload success alone does not establish durable duplicate prevention. Preserve
the current drafts and receipt state; never substitute Catalyst temporary disk
for durable document storage. No new document platform is needed.

Results review and delivery remain separate: review the exact draft, opportunity
grouping and valuation evidence, then separately authorize the exact customer
document and recipient. Later bounded Development and genuine call-generated
acceptance remain necessary. Local fixtures are not provider, WorkDrive, delivery
or call receipts.

No live adapter, job activation, upload, deployment, provider call, credential
change or send is authorized by this source implementation. Rollback is to leave
the new hook unbound and retain existing holds; do not discard accepted evidence
or overwrite prior generated drafts.

## Local verification and reproduction

Use the repository-pinned Node runtime. From the repository root:

```powershell
node --test src/zoho-catalyst/revenue-desk-analytics/functions/analytics_sync/test/*.test.js
node --test src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_call_gateway/test/client-call-details.test.js src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_call_gateway/test/terminal-draft-retry.test.js
node --test src/zoho-catalyst/revenue-desk-release/test/offline-guard-paths.test.js
```

For a strictly offline run use the verifier's existing
`SYLVARA_OFFLINE_QUICK_VERIFY=1` mode, with `npm_execpath` set to the installed
`npm-cli.js` and `npm_config_offline=true`. The unchanged package/link tests need
that npm runner; artifact-building acceptance remains skipped in Quick mode.

Fixtures use the existing in-memory runtime and Analytics reconciliation tests.
New focused coverage includes rejected forged/stale/cross-client details, exact
rowset equality, escaping, withheld content, repeat-call grouping, missing values,
known-job precedence, currency scales, duplicate-safe generation and ambiguous
partial writes. Unchanged intake/configuration, provider-event classification,
alerts, the 2:55 cap and terminal controls retain their existing tests. No synthetic
success is inserted into cloud stores.

The gateway's existing `test:unit` verifier now includes the previously omitted
`client-call-details.test.js` plus the new held-retry tests; no existing check was
removed. End-to-end local cases cover zero calls, a full 25-call supported
ended/analyzed/notification lifecycle, and a three-call draft with two reviewed
opportunities, one documented value and one Unknown. Fixture table identities are
owned by the synthetic Analytics store so copied runtime row IDs cannot collide
with service-created daily metrics.

The supplied four-page synthetic PDF has user-reported visual status **PDF Review
Completed — Targeted Changes Required**. That review found all three call records,
two reviewed groups, one USD 425.00 valuation, one Unknown valuation and zero
ungrouped potential new-job calls; no missing columns or clipped page-edge text
were observed. It is review of that supplied PDF, not owner delivery approval,
interactive-browser QA or live-system acceptance.

The focused renderer correction preserves the calculation path and fixture
timestamps. The opening summary distinguishes potential new-job calls from
reviewed opportunity groups and keeps the estimated subtotal beside its partial
coverage warning. Call details label each follow-up evidence state separately;
only the actual dry-run state displays "Preview Only — Not Sent." Group
descriptions come from existing member-call issue summaries. Print rules keep
short records and headings together and request recurring draft/synthetic
identification with page counters. Existing Inter-first portable styling and
local fallbacks remain; no fonts are fetched.

The revised artifact is synthetic HTML. The reviewed original is preserved.
Revised pagination, page counters and PDF extraction require inspection of an
actual revised export; CSS/content checks do not establish those results. The
supplied PDF was reported to render legibly but produce corrupted text in two
extraction paths. This repository emits HTML and does not implement the PDF
export, so the original PDF bytes and export provenance are needed to diagnose
that defect. Browser visual inspection remains unverified: browser policy
blocked local-file navigation. No server, alternate browser, image flattening or
OCR was used to bypass that boundary. Customer delivery still requires owner
review of the exact final document.

### Prior local checks (2026-09-29)

The prior Analytics rerun after the 25-call fixture correction passed syntax
checks and 260 tests, with zero failures and six existing offline artifact-test
skips. The focused assembler/store/worker-to-draft review run passed 27 tests.
The revised three-call preview passed content assertions and repeated exact-byte
draft verification; the prior accepted preview was preserved byte-for-byte.

Before the complete-partition adapter and presentation corrections, the canonical
offline Quick verifier completed successfully, including the
existing Windows signing/ACL-fixture release tests. No checks were weakened or
removed. Its supporting suites passed as follows:

| Suite | Passed | Existing skips |
|---|---:|---:|
| Python safety regressions | 370 | 1 |
| CRM free-test contracts | 87 | 0 |
| Billing gateway | 58 | 4 |
| CRM-Billing orchestrator | 166 | 7 |
| Request form | 104 | 2 |
| Setup form | 411 | 11 |
| Form 2 prefill fixture | 20 | 0 |
| Call gateway, including unit/integration/acceptance | 216 | 0 |
| Route control | 257 | 0 |
| Call worker packaging | 3 | 0 |
| Canonical-table migration | 31 | 0 |
| Seven-function release, Journey and offline demo | 332 | 1 |

Repository safety, workflow policy and `git diff --check` passed for that prior
candidate. Its independent source review found no actionable defect. The final
combined candidate requires another canonical run; retain its exact results with
the local closeout record rather than treating the earlier totals as current.
Comments document the source-history completeness boundary, reconciliation-only
deployment cursor, asynchronous source revalidation, cancellation and sanitized
errors so future maintainers do not mistake a successful import for a ready or
deliverable report.

Already installed pinned Node, SDK packages and Python/PyYAML supplied the offline
run; no dependency download was needed. Gateway copies in the local worker and
route-control dependency directories were checked byte-for-byte against current
source. These are local checks, not GitHub CI or live installation acceptance.
