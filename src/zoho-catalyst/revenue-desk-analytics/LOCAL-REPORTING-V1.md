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
| Draft generation | Existing renderer, local draft writer and opt-in WorkDrive writer produce deterministic private revisions plus verified receipts | Local tests do not establish accepted WorkDrive bindings, installation or delivery authority |
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
canonical runtime and Analytics stores. It requires current terminal deployment
and final-result facts, settled source history, exact checkpoints and independent
readback for all three record types. Completed tests require completed terminal
reconciliation. A manually closed Stopped test retains Stopped/NotRequired and
must additionally re-prove the signed rollback, settled inbound/call/notification
history, and exact completed CRM summary/final-outbox artifacts on every source
pass. This does not add Stopped tests to the automatic completed-test scan. The private ledger remains a
branded canonical snapshot. The assembler re-reads source, checkpoints and
canonical details after asynchronous reads; moving, stale, conflicting or
cross-scope evidence fails closed. Empty tests require independent proof that the
call partition is empty, not an invented call checkpoint. The bounded source
reader refuses a full 100-row page for any record type instead of reporting a
truncated history as complete.

The freshness gate remains strict. A fresh export alone cannot waive expired
checkpoints. The optional local `createReportCheckpointReattestor` verifies the
exact six-field scope, complete independent agreement for all three partitions,
settled source history and fresh canonical facts before any verification write.
It conditionally updates the existing checkpoint rows and independently reads
back every result; the assembler then rechecks canonical/source/checkpoint state.
A conflict or partial write cannot return a ready draft. A new complete retry may
finish partial verification without reimporting facts or replaying CRM work.

The held [additive schema proposal](config/report-checkpoint-verification-schema.json)
adds nullable `REPORT_VERIFICATION_DIGEST` to AnalyticsSyncCheckpoints. The digest
binds the scope, source/canonical snapshots and all three rowsets. Re-attestation
records the actual verification time in `LAST_RECONCILED_AT`, a bounded freshness
window, and a new CAS version. It preserves `LAST_SYNC_AT`, provider import job,
accepted/rejected import counts, source watermarks and ownership. True empty-call
reports verify the empty partition and never manufacture a call checkpoint.
Legacy import-only checkpoints remain valid, and ordinary imports/readiness do
not depend on the proposed column. This code and proposal are not installed or
live-accepted; metadata change, binding and runtime verification require separate
scoped approval. The existing `upsertCheckpoint` behavior for same/older source
watermarks is unchanged.

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
One branded whole-attempt budget spans both source passes, verification writes,
WorkDrive and ReportRuns operations. The source composition defaults to 60 seconds
and accepts only a trusted bounded deadline up to 120 seconds. Hard request
ceilings are 12 Analytics reads, 240 source reads, 3 checkpoint writes, 24 WorkDrive
reads, 1 WorkDrive write, 16 ReportRuns reads and 12 ReportRuns writes. Reservations
count even after failed authorization and cannot reset between passes. The
existing retry invocation allows one reporting attempt across its completed-test
scan and CRM-summary settlement; a deferred ready draft retains its older fair
scan cursor. Ordinary callbacks retain their prior platform timeout unless an
immutable trusted callback declares its longer reporting deadline.

Local actual-runtime/service fixtures measured 137 source reads for an expired
Completed report plus review reread, and 222 for the equivalent verified Stopped
path (220 for empty Stopped). The outer composition adds its initial canonical
lookup. A 25-call late-settlement cohort and 26 already-admitted in-flight calls
fit the existing less-than-100 source-history limit per record type; older
unresolved versions still block. No history truncation or provider-row ceiling
increase was introduced. Before binding, approve scheduling and these bounded
request/cost limits, then measure total runtime against the exact installed
artifact. Local timing tests are not provider latency or quota evidence; this
source change does not activate provider polling.

`createTerminalDraftReconciler` composes that assembler with the existing draft
writer. The runtime's existing completed-deployment scan invokes it through an
optional trusted `terminalDraftReconcilerFactory`. It returns
`awaiting_reconciled_evidence` until Analytics is ready. Failed generation remains
eligible for the next fair completed-deployment scan, without replaying completed
CRM operations or Analytics imports. The worker bounds the callback by its
validated trusted reporting deadline when supplied, otherwise its existing
platform timeout. The coordinator checks cancellation before writing so a late
read response cannot create a document after the scan times out.

`create-reporting-factory.js` now constructs the trusted Analytics reader,
checkpoint verifier, ReportRuns store, WorkDrive client and durable composition
from accepted private configuration. It requires current acceptance evidence and
actual protected Connection references; neither source code nor test fixtures
invent live references. The worker's packaged composition export exposes this
factory, but `index.js` still leaves it `null`. Job parameters and environment
variables cannot enable it. The automatic source lane remains the existing
`Completed` deployment lane; this change adds no automatic stopped/rolled-back
report lane.
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

The durable path is implemented locally. `prepare-workdrive-draft.js` uses a
unique ReportRuns intent and conditional version fence to authorize one upload
for an immutable generation key. It verifies the exact resource version and
bytes before recording a receipt. An ambiguous upload is reconciled without
blindly dispatching another upload, overwriting, deleting or sharing a document.
`create-durable-report-composition.js` shares the attempt budget, cancellation,
source verification and durable retry state with that writer. Synthetic fixtures
exercise repeated/concurrent attempts, exact-byte recovery and failure holds;
these are not provider acceptance results.

`report-run-store.js` reuses the observed existing `ReportRuns` table. It preserves
its identity, period and status contract, including `ReportRunId`, `ClientId`,
`DeploymentId`, `ReportType`, `PeriodStart`, `PeriodEnd`, `ReportVersion`,
`GenerationStatus`, `ApprovalStatus`, `DeliveryStatus` and reconciliation/control
projections. Durable state uses the existing unique `IdempotencyKey` and encrypted
`ReportPayloadJson`. The held [ReportRuns schema proposal](config/report-run-schema.json)
adds only nullable, nonunique INT `RD_REPORT_VERSION`, bounded from 1 through
2147483647 for newly owned rows. Legacy rows remain unchanged with no backfill.
Namespaced records keep them outside the new reader/writer. Fresh schema,
encryption, uniqueness, conditional-update and
readback acceptance are required before binding; the proposal has not been
installed. Attempt records explicitly represent verification attempts, not
completed reports, and every draft remains owner-review-required and not sent.

First-import checkpoint insertion also preserves existing schema coexistence.
Some retained `AnalyticsSyncCheckpoints` tables require legacy identity and target
columns beside the nullable v2 columns. Before a new checkpoint insert, the SDK
reads complete column metadata within the existing platform timeout. A v2-only
table receives only v2 fields; a recognized legacy table receives its required
identity, source and destination fields from the same trusted import binding.
The original checkpoint digest also supplies the legacy unique key, and both
projections use the importer's exact matching-column order. `SyncEnabled=false`
keeps the legacy lane disabled. Partial, conflicting or unknown required schema
blocks insertion. Exact compatibility readback resolves duplicate or uncertain
insert outcomes. Existing rows, update paths and re-attestation remain unchanged.

This repair adds one metadata read per new checkpoint insert, with no new service,
environment switch, schema change or import replay. It requires qualification of
the changed standalone importer as well as any worker containing these modules;
unchanged prior archives remain evidence only for their original bytes. Provider
column-read permission, first genuine checkpoint creation and conditional update
semantics remain Development acceptance. Keep the importer disabled and reporting
factory unbound until their separate allocations pass; preserve legacy rows and
all checkpoint/import history on failure.

Remaining integration work is bounded. These are separate evidence layers:

| Requirement | Existing evidence and remaining gap | Next action and passing condition |
|---|---|---|
| Complete-partition Analytics read | Local provider adapter, assembler and rejection tests exist. Live target configuration, effective role visibility, exact response contract and runtime latency are unverified; factory stays unbound. | Under separately scoped Development read authority, verify fixed table/workspace/organization and read role, full and empty exports, unexpected-row detection and exact six-column digests. All three partitions must match canonical source and fresh checkpoints within the attempt budget. The export adapter performs reads only; the separately approved verifier below may update checkpoint verification state. |
| Durable private drafts | Owner-confirmed WorkDrive storage and an existing Sylvara company structure have been discovered through fresh metadata UI inspection. The WorkDrive client, durable writer and ReportRuns adapter are implemented and locally tested; the exact destination, effective access, retention, writer identity and tenant API contract are not accepted. | Reuse the discovered structure and resolve the exact existing destination/CRM mapping in the private binding packet. Approve its writer, readers, retention and bounded operations; verify upload/version/download response contracts and ReportRuns schema/CAS behavior. Concurrent/repeated attempts must produce one matching document/receipt; conflicting or uncertain outcomes remain held. |
| Fresh checkpoints | Local authoritative re-attestation, optimistic version guards, independent durable readback and partial-write recovery are implemented and synthetically tested. Import history is preserved; the nullable verification-digest column is a held schema proposal, not installed metadata. | Separately approve/install/read back the additive checkpoint column and bound verifier in Development. Verify expired and empty-call partitions against real complete Analytics exports, concurrent-change rejection and exact readback, with no import or CRM replay. A failed/partial/conflicting verification must hold generation; only a successful fresh complete retry may resume it. |
| Installed composition and retry | Trusted factory, durable composition and worker packaging are implemented. Isolated extracted-archive tests exercise the assembler/renderer/writer through one canonical runtime trust module. The worker index remains unbound; no installed reporting composition is accepted. | Build the final clean revision using the runtime packaging procedure, identify any separately reviewed auth-preserving composition, materialize reviewed dependencies and verify the final archive/digests. Separately authorize installation and exact private binding only after schema/storage acceptance. Verify bounded scheduling, cancellation, failure recovery and no replay of completed CRM/import writes against the approved destination. |

WorkDrive is the owner-confirmed storage system, consistent with the existing
[document ownership standard](../../../docs/zoho/standards/document-lifecycle.md).
Reuse the existing Sylvara structure; vendor selection and a new folder hierarchy
are not prerequisites. Discovery is not destination approval: a private-folder
label or an empty direct-external-member list does not prove effective inherited
access or that sharing is disabled. Full access review, retention, writer
identity, exact parent and CRM mapping remain private acceptance requirements.
Names, hierarchy, identifiers and live permission details stay out of Git.

The [runtime packaging procedure](../revenue-desk-call-runtime/README.md#release-artifact-and-migration-gates)
describes the explicit report-tool allowlist, single canonical runtime module,
clean-revision export, separate two-revision composition and final dependency/
archive digests. Packaging closes the source dependency gap without binding the
factory or authorizing replacement of an installed authentication change.
A filename or upload success alone does not establish durable duplicate
prevention. Preserve current drafts and receipt state; Catalyst temporary disk
is not durable document storage.

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

The revised artifact is synthetic HTML. The supplied original PDF bytes were
inspected read-only and preserved with unchanged size and SHA-256. Its four
custom Type 3 font resources lack `ToUnicode` mappings; two independent text
extractors did not recover reliable semantic text, while rendered pages retained
the visible content. This is confirmed PDF structure and extraction evidence,
not proof of the originating application's export settings or a complete root
cause. The original export provenance remains unconfirmed.

Revised pagination, page counters, selectable text and PDF extraction still
require inspection of an actual revised export; CSS/content checks do not
establish those results. This repository emits HTML and does not implement the
PDF export. Interactive visual QA of the revised HTML remains unverified after
the earlier local-file navigation block; no server, alternate browser, image
flattening or OCR was used to bypass it. Customer delivery still requires owner
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

## Paired-report request accounting and recovery limits

A pair reserves the complete finite attempt plan before any durable claim or
render dispatch: 120 seconds total, 240 canonical source reads, three checkpoint
writes, 48 WorkDrive reads/two uploads, and 40 physical immutable-ledger
reads/26 inserts. Analytics allows 24 HTTP reads: three fixed metadata/export
pairs per complete source pass; three passes without opportunity review (18),
or four with the existing review fence (24). Trusted pair configuration cannot
reduce the remaining plan or elapsed window. Legacy single-document limits are
unchanged. These are ceilings and admission prerequisites, not a promise that
remote latency will complete within the deadline.

Production-shaped offline regressions use the real Analytics HTTP adapter and
immutable successor store, including cold generation, accepted replay, corrected
review and 25 calls. Observed cold source reads are 151 without review/201 with
review, with 20 WorkDrive reads/two uploads and 26 ledger reads/14 inserts. The
accepted-summary reader separately reserves eight physical ledger reads (four
logical root/head lookups) and six WorkDrive reads, with zero writes. Both final
ledger and destination/content fences remain required after download. WorkDrive
bodies must contain non-empty chunks and no more than 128 chunks, in addition to
the existing byte, deadline and cancellation bounds; provider fragmentation
compatibility remains a live qualification requirement.

A lost upload response can be reconciled only from the exact immutable stored
version and actual content hash. A consumed render claim does not permit another
render when its bytes never reached storage; unchanged-input retries remain held.
The fixed six-failure ceiling still contains further ordinary source/provider
inspection, including late storage completion. Existing legacy attempt roots are
read-only and cannot be advanced by this composition. Neither condition silently
resets a claim, mutates an old draft or authorizes a new generation. A separately
qualified finite operator recovery/migration contract is still required for those
cases; no such live recovery is accepted by the offline tests. Preserve partial
rows, prior versions and truthful held states until that contract is established.

### Separate read-only inspection after exhausted attempts

The trusted reporting factory exposes `inspectExhausted(scope, { signal })` as a
distinct operation. Normal terminal reconciliation never selects it, and the
delivery wrapper never calls `afterPair` for it. It requires the exact canonical
client/deployment/configuration/source/period identity and an existing six-failure
attempt. The routine attempt, generation, draft and bundle claims remain unchanged.

One separately admitted inspection has a 120-second whole-operation deadline,
at most 240 canonical source reads, 24 Analytics reads, 40 physical ReportRuns
reads and 12 WorkDrive reads. The two exact-version readers each have an additional
10-second deadline, eight physical ReportRuns reads and six WorkDrive reads;
these are included in the stated aggregate bounds. All write budgets are zero.
There is no checkpoint re-attestation, import, CRM projection, render, upload or
send. A late result cannot admit subsequent operations after cancellation.

It rereads complete current source/review evidence and independently verifies
both immutable PDF byte hashes, exact private versions, current destination
authority and final unchanged claims. Late stored completion can produce
`exhausted_report_evidence_inspected_not_adopted` only when both verified private
receipts already exist. In-memory accepted views are used solely to reuse exact
byte verification; they never advance a durable record. Returned evidence sets
`persisted`, `qualificationAuthority` and `deliveryAuthority` to false.

Immutable legacy rows may be inspected only under these same current provenance
and authority checks. Missing receipts/bytes, stale source, tenant mismatch or
contradictory acceptance remain held. This does not reset the failure ceiling,
rerender consumed claims, relabel terminal states, migrate legacy ownership or
authorize delivery. Persistent adoption would require a separately designed
durable transition and exact-version authority; inspection alone is insufficient.
No live recovery acceptance is claimed by the offline checks.
