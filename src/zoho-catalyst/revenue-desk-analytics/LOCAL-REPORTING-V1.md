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

The existing Analytics service now exposes an optional `onReconciledScope`
callback after checkpoint success for each of the three record types. It is
`null` by default; the deployed job handler does not inject it. The callback
event contains only immutable opaque scope/version metadata. The source helper
`createReconciledDraftTrigger` asks its trusted `readReconciledInput` adapter for
all reconciled evidence and returns `awaiting_reconciled_evidence` when it is not
complete. It cannot use the wakeup event as proof of report readiness.

A local integration test composes this hook with the existing runtime and
Analytics memory fixtures: actual inbound/event classification, expiry and report
rebuild, actual CRM summary dispatch/readback, runtime-produced outbox, Analytics
import/readback/checkpoint transitions, and the generated client HTML. The first
two partitions wait; completion of the third generates the draft. No hand-built
final fact substitutes for the terminal runtime output in that integration test.
A hook failure surfaces `ReconciliationRequired` while preserving the completed
Analytics writes; another import scan does not replay them to retry the document.

An exclusive intent and exact-byte readback protect the local HTML and hash-only
receipt. A complete document can recover a missing receipt. A missing, partial or
conflicting document requires reconciliation; no blind rewrite occurs. Receipt
status always requires owner review and explicitly denies delivery authority.
Files must be outside Git, without links, in an already approved private directory.
File mode 0600 does not establish Windows ACL privacy. The storage owner must
verify access and retention before any real input is used.

Remaining live integration work is bounded:

1. Bind the existing Analytics completion mechanism to authoritative full-scope
   evidence assembly and the canonical detail reader, not client-provided JSON.
   Reconcile all three partitions and late source changes before generation.
2. Connect the current private WorkDrive closeout destination and durable
   idempotency/readback semantics. Preserve its readers and retention; do not use
   Catalyst temporary disk as durable document storage or create a new platform.
3. Establish durable recovery for a generation failure after a checkpoint has
   succeeded. Such a row is no longer due in the import queue. Surface the failure
   for reconciliation; do not claim that ordinary import retries will regenerate.
4. Review the exact draft and opportunity grouping in the existing results-review
   step, then separately authorize the exact customer document and recipient.
5. Run the later bounded Development integration acceptance and Retell-dependent
   acceptance. Local fixtures are not provider, WorkDrive, delivery or call receipts.

No live adapter, job activation, upload, deployment, provider call, credential
change or send is authorized by this source implementation. Rollback is to leave
the new hook unbound and retain existing holds; do not discard accepted evidence
or overwrite prior generated drafts.

## Local verification and reproduction

Use the repository-pinned Node runtime. From the repository root:

```powershell
node --test src/zoho-catalyst/revenue-desk-analytics/functions/analytics_sync/test/*.test.js
node --test src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_call_gateway/test/client-call-details.test.js
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

The revised preview is synthetic HTML, not a customer PDF. Existing Inter-first
portable styling is preserved with explicit local fallback; no fonts are fetched.
Any final PDF still needs every-page pagination/font inspection and owner review.
Browser visual inspection of the generated HTML remains unverified: the browser
policy blocked local-file navigation. The HTML and its content were generated and
tested locally; no server or alternate browser was used to bypass that boundary.

### Observed local checks

- Analytics offline suite: 238 passed, zero failed, six artifact tests skipped.
- Canonical reader/source-version and offline-guard regression suites: 20 passed.
- Focused runtime acceptance, alerts, limits and terminal reconciliation: 19 passed.
- Existing connected offline demo and Journey route-coexistence: 108 passed.
- Existing Journey-core release profile: 13 passed, using the checked-in function
  directory as `NODE_PATH` because this isolated checkout has no installed local
  package link.
- Analytics syntax checks, repository safety scan, workflow security policy and
  `git diff --check`: passed.

Initial direct test invocations lacked the npm runner/local function link, and
the first workflow-policy invocation lacked PyYAML. Reruns used already installed
tooling and the existing offline mode; no dependency download was needed. These
are local checks, not GitHub CI or live installation acceptance.
