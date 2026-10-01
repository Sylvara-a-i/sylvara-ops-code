# Deal-bound test report delivery

Status: offline source wiring. The five optional Deal fields were independently
created/read back by the owner-side connector on2026-09-30. Buttons, protected
readers, sender/storage grants, terminal binding and live delivery are not installed.

The Free-Test Deal owns each report pair and send history. Existing Account_Name,
Contact_Name, Deployment_Record_ID and Configuration_Version remain authoritative
join fields. Lead conversion uses verified native lineage, not email matching or
the mutable Account lookup alone. Repeated tests retain separate deployment and
report histories; correcting an artifact does not repeat its initial send.

## Proposed CRM fields and buttons

Prior full metadata found no report PDF link or report-recipient field to reuse.
These API names are candidates, not observed fields. Before a live proposal,
re-read exact field collisions, layout/profile access, URL limits and dependencies.

| Deal candidate | Type | Purpose |
|---|---|---|
| Test_Report_PDF_URL | URL, optional | Authenticated private exact summary revision. Populate only after actual WorkDrive version-link semantics and permissions pass. Never public-share a report. |
| Test_Report_Revision | Text64, optional | Exact canonical manifest digest, never an HTML generation key or latest-file guess. |
| Test_Report_Recipient_Email | Email, sensitive, optional | Explicit selected report recipient bound to this test and verified native Contact relationship. No alert/signer/Account-email fallback. |
| Test_Report_Recipient_Verified_At | DateTime, optional | Display verification time; encrypted canonical evidence digest and recipient revision remain in ReportRuns. The timestamp alone confers no authority. |
| Test_Report_Delivery_Status | Picklist, optional | Held, Pending, Provider Accepted, Inbox Receipt Verified, Failed, Unknown. Never silently label acceptance as delivered or read. Exact live picklist values require metadata qualification. |

View Test Results opens this Deal's exact stored summary, after authorized scope,
immutable bytes and revision verification. The iPad handoff must prove readable
private access, exact revision, and safe failure for missing permission or stale
links. Account related Deals provide company context; Leads receive no report
ownership or automatic send action.

Send Test Results shows a confirmation containing the exact PDF revision and
verified recipient. It resends only after a provider-accepted initial send. The
UI retains the same confirmation ID while busy, disables the confirmation button
after submission, and does not create a fresh confirmation on double tap. Server
CAS still prevents duplicate dispatch when the same confirmation arrives twice.
The confirmation expires after15minutes; changed report or recipient requires a
new confirmation. No live button payload/endpoint is invented in this proposal.

## Protected construction and standing initial workflow

report-delivery-control.js accepts trusted adapters, never browser-supplied email,
PDF, sender or eligibility. Its default autoDeliveryEnabled=false contains the
workflow until installed acceptance. After acceptance, the existing terminal
report workflow calls initial using the authenticated system principal and
canonical Deal. Only the summary is attached; the supporting packet stays private.

readSnapshot must derive completed/fresh/validated from the complete canonical
report checkpoint and partitions, independent safe stop/restoration, immutable
accepted two-artifact manifest, exact Deal/test/configuration and verified native
Contact relationship. It must also verify explicit recipient selection, current
eligibility/suppression and nonexpired recipient attestation. Raw lookup/email
matching, completed forms and storage success are insufficient. A partial report
or uncertain recipient remains held. Owner review remains available separately;
the specific standing initial-summary authorization does not fabricate review.

Existing encrypted ReportRuns stores exact recipient/PDF snapshots, durable
initial/resend claims and accepted provider proof through report-run-store. No new
table, queue, cron, storage platform or folder restructure. Initial identity is
deployment-wide, excluding report revision and email so corrections cannot send
again. A conflicting client/Deal binding holds. Unknown or failed dispatch never
expires or automatically retries. Exact independently correlated provider
acceptance may reconcile a lost response without another send.

authorize must validate actual authenticated owner/system identity and per-Deal
view/initial/resend permission. readSummary must retrieve the immutable accepted
WorkDrive version privately. sender must be a fixed qualified sender/reply path,
single request with no implicit retries, bounded payload/response/deadline and
cancellable transport. lookupAcceptance must prove exact operation identity,
recipient attestation and PDF bytes; subject/date-only matching is insufficient.
No existing Mail send grant or provider idempotency contract is assumed.

Deadline cancellation bounds local admission, not the provider's remote outcome.
Claims consumed before dispatch preparation may require operator reconciliation
if a subsequent read fails; they never grant a retry. Disable auto admission for
containment; retain receipts and reconcile any in-flight send. Email cannot be
retracted by rolling back source. Inbox/read/follow-up remain Unknown until their
separate authenticated evidence contracts are qualified; no unsupported receipt
or read tracking is installed.

## Remaining installed acceptance

Verify actual schema/encryption/CAS, protected runtime construction, CRM button
authorization and native lineage, exact version link/iPad behavior, qualified
sender connection/scopes and no-cost allowance, suppression/recipient selection,
automatic terminal hook, provider correlation and separate inbox evidence.
Source tests use synthetic bytes and example.com mailboxes; no emails are sent.
Package/extracted and installed-state verification are separate from source.

## Qualified configuration handoff

Fresh read-only metadata confirms Sylvara.ai, one existing Deals Standard layout,
and independent creation/readback of these five exact API names. They are optional;
no required flag, default recipient, public URL or initial-delivery trigger.
URL uses website type with maximum450 characters, revision uses text length64,
recipient uses email length100, verification uses datetime, and delivery status
uses picklist with identical display/actual values listed above. Never truncate
an address or URL; an unsupported value holds configuration/delivery.
Use the existing Standard layout explicitly. Preserve existing protected-field
profile permissions: owner/admin read_write, ordinary profile read_only; do not
accept the API default granting every profile access. Verify supported field
creation/encryption and exact returned API names before attaching any reader.
No compliance setting, profile expansion or new access group is required here.

Configuration order: retain the verified optional fields; bind authenticated
Deal-scoped view and resend handlers; create View Test Results and Send Test
Results using actual verified handler function IDs; bind recipient selection to
native Contact lineage and private canonical attestation; wire terminal report
completion to initial delivery with auto admission disabled until installed
acceptance. No placeholder endpoint/function ID or generic CRM email action.

CRM projection maps canonical provider acceptance to Provider Accepted, uncertain
consumed dispatch to Unknown, pre-admission eligibility failure to Held, and
known rejection to Failed. Pending does not mean sent. Inbox Receipt Verified is
reserved for a separately qualified receipt contract and is never synthesized.
The canonical encrypted delivery ledger remains authoritative over these display
fields. CRM verification time alone cannot authorize delivery.

Ordinary optional schema/layout/button and existing configuration work is within
the authorized no-cost milestone. New persistent Mail, WorkDrive or PDF OAuth
Connections/scopes, runtime-principal permission expansions, provider conversion
quota uncertainty and actual recipient emails are separate gates. Read-only
metadata and injected transport tests do not dispatch mail or provider requests.

## Implemented runtime wiring checkpoint

The controller recognizes report_delivery_v1 on its existing authenticated
approval-control route, before CRM control writers or any Retell construction.
Only view, prepare_resend and confirm_resend commands are admitted. The actor is
the authenticated controller principal digest, never a JSON actor or recipient.
The protected reportDelivery factory remains unbound in the default entrypoint.

The reporting factory can attach the delivery factory to its existing terminal
pair hook. The runtime accepts the verified pair state and projects only safe
report/delivery statuses. Stopped reports remain held for initial delivery.
Corrections reuse the original initial-send claim and cannot inherit acceptance
for different PDF bytes or recipient verification; manual resend is separate.
The exact expected manifest is checked before the initial claim.

create-report-delivery-factory constructs the real encrypted ReportRuns adapter,
managed runtime-only Mail authorization, canonical scope-to-Deal resolution and
control/handlers. Its protected createReaders installation dependency must bind
actual complete canonical/Analytics selection, explicit private recipient
attestation, native conversion, immutable WorkDrive byte retrieval, qualified
private version link and per-Deal/action authorization. No request/environment
switch supplies these readers or makes them qualified. This dependency is still
unbound; factory/source tests are not operational acceptance.

The CRM reader selects only the exact installed report APIs and Contact Email,
with native cancellation across authorization, headers and body. The snapshot
join requires completed canonical report evidence, immutable native conversion,
matching deployment/configuration/manifest and exact explicit recipient evidence;
alert/signer/Account emails are not alternatives. CRM fields and timestamps alone
cannot synthesize the private attestation. Filling the revision/link index from
the accepted manifest still needs its qualified CRM projection binding.

The US Zoho Mail transport uses one raw-PDF attachment POST and at most one
message POST, both natively cancellable, bounded and without redirects/retries.
Only the summary is attached. It does not schedule mail, add CC/BCC or ask for
read receipts. A malformed/unknown response retains an ambiguous consumed claim.
The proposed messageId acceptance envelope must be qualified against the real
provider; the docs do not establish this installed response contract. Default
lookup returns Unknown, with no assumed broad mailbox read/search grant.

Minimum Mail grant for both documented POSTs is ZohoMail.messages.CREATE,
restricted to the verified sending account and approved From/reply path. No Mail
runtime Connection has been demonstrated. Existing Catalyst alert mail and the
read-only Mail Audit connector are not substitute grants for this adapter.
Existing CRM/Analytics Connections may be reused only where their observed
organization, module/scopes and runtime principal already cover the exact read.
Do not expand grants or repurpose Billing access. WorkDrive and PDF runtime
Connections, exact destinations/access/retention and remaining free allowance
remain unverified; no provider request has been made here.

Publication proposal: reviewed source/tests/docs, licensed embedded Inter and
approved logo derivative only; exclude private exports, PDF samples, identity
receipts, populated bindings, live IDs and acceptance evidence. Preserve prior
A2 packages. After a reviewed source commit, build/extract exact-revision artifacts
and verify isolated controller/worker imports and source/protected-auth parity;
installed-state readback and provider acceptance remain separate. Disable the
trusted delivery binding for containment; retain consumed claims and receipts.


### Bounded read/projection adapter source qualification

The default managed factory now composes the existing canonical complete-partition
reader, native Lead conversion reader, original intake lineage reader and encrypted
ReportRuns directly. Selection recomputes the existing source identity and requires
the accepted pair and current reviewed-source digest. It performs no imports,
checkpoint re-attestation, rendering or uploads. Stale evidence holds delivery.

Protected recipient/actor attestations are keyed by Deal and deployment, preserving
repeat-test history. Explicit recipient selection precedes operation; no final
call-derived dates are required to attest a recipient. Mandatory ledger period
columns record the attestation capture date; actual report dates come exclusively
from canonical terminal/report evidence. Attestation authoring still requires its
qualified setup/internal-approval binding; there is no public authoring endpoint.

The projection writer updates only Test_Report_PDF_URL, Test_Report_Revision,
Test_Report_Recipient_Email, Test_Report_Recipient_Verified_At and
Test_Report_Delivery_Status. One per-Deal/test durable CAS slot serializes corrections
and status updates. Unknown writes hold later updates until exact independent
readback; no PUT is replayed. Conditional CRM modification time, empty workflow
triggers and cadence suppression fence the sole PUT. Actor, recipient and link
freshness are checked again immediately before dispatch. Provider Accepted requires
the exact immutable delivery receipt; it does not mean inbox receipt or reading.

Deployment switches deliveryEnabled, autoDeliveryEnabled and projectionEnabled
default false. The existing narrow Deals UPDATE Connection can be reused only after
fixed runtime principal and field/schema qualification; its token is never used for
org.READ. Read Connections independently own cohort/lineage corroboration. Managed
Mail CREATE approval alone does not establish connected runtime authorization.
Private exact-version WorkDrive URL templates require independent qualification;
no share link or guessed version URL is a fallback. Keep all bindings disabled until
destination, permissions, retention, principal and provider contracts are accepted.
