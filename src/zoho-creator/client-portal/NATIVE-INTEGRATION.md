# Native client portal integration gates

Status: **offline source contracts; native adapters remain unqualified**. This
guide records the remaining seams, not deployed state or permission to perform
live work. Reuse the existing projections and inspected native components; do
not add a duplicate business store, replacement shell or placeholder results.

## Existing source seams

| Workflow | Reuse | Boundary still missing |
| --- | --- | --- |
| Billing history | [`produceBillingCustomerHistoryWithPayments`](billing-customer/billing-customer-history-producer.js), [history/status views](billing-customer/README.md) | Authenticated company/customer binding and qualified customer-scoped provider transport. The original producer still omits payments. |
| Calls and released reports | [`prepareCompanyCallsPage` and `prepareReleasedReportsPage`](calls-reports/company-call-report-projection.js), [exact source/grant contract](calls-reports/README.md) | Complete scoped source receipts, current operation grants and protected report/artifact actions. |
| Saved report dates | [`preparePreferredReleasedReportsPage`](calls-reports/README.md#saved-report-date-preferences-offline-opt-in) | Authenticated save/load storage and current entitlement provenance. This stores no data and restores only a reporting-period range, not report-key selections. |
| Pending service-area requests | [Scoped provider read plan and status-list projection](company-settings-requests/README.md#pending-request-read-contract) over existing Company_Settings_Requests | Independent `company-settings-requests.read` authority, provider-side Account predicate, terminal complete snapshot and protected native pagination. Does not create or approve requests. |
| Identity concepts | [Protected identity contract](company-settings-requests/OFFLINE-IDENTITY.md), [Creator authorization proposal](company-settings-requests/native/CREATOR-AUTHORIZATION.md) | Qualified native subject/incarnation, protected current registry and canonical links. The existing resolver's operation remains `service-area-request`. |

## Protected adapter contract

Creator Custom APIs execute Deluge, not these CommonJS modules. A separately
qualified server-to-server bridge or parity-tested native implementation must
keep authentication, policy and source receipts on the server. Never send a
`trusted` object to a widget and accept its return as authority. SDK transport
success, a native profile label and the own-label diagnostic are insufficient.

The adapter must derive current subject/incarnation, principal/audit actor,
company/contact links and the exact operation permission independently of request
selectors. Require `billing.read`, `calls.read` or `reports.read` as applicable;
do not widen the service-area resolver or infer permissions from role names.
Pending request reads independently require `company-settings-requests.read`;
the existing submission scope is not read authority. Missing, duplicate,
inactive, stale or ambiguous facts deny. Re-created users and
changed membership must not inherit old authority. Registry ownership, uniqueness,
lifecycle handling and revocation availability require independent qualification.

Pin organization and environment at the protected composition root. The
service-area/Creator authorization contracts use `staging`; billing and
call/report projections use `stage`. Map that vocabulary explicitly on the
server without changing the strict public contracts or accepting a browser's
environment override. Account, report and provider identifiers are selectors,
never authentication or ownership evidence.

### Payment reads

Translate only the producer's fixed GET descriptor: resource, environment,
organization, bound customer, cursor and page size. Qualify the actual provider
route, customer predicate, status/mode normalization and terminal page semantics
before connecting it. Every page and row must retain the same customer/organization;
do not fetch a global payment list and filter it locally. Use the existing
lossless amount conversion and payment-specific currency provenance. Payment
history does not establish settlement, revenue, plan entitlement or a write action.

Only terminal successful collection evidence can establish empty or complete
history. Preserve unknown/error outcomes for missing, malformed, stale, duplicate,
partial or page-budget-exhausted reads. The offline producer freezes `trusted`
and `policy.asOf` before awaits: it is not a timed live revocation protocol. A live
composition needs bounded cancellation/deadlines, honest receipt timestamps and
fresh authorization/freshness checks after awaits and before delivery. Do not
backdate observations to satisfy the frozen snapshot contract.

### Calls, reports and saved preferences

Supply one complete bounded snapshot for the exact reviewed client, deployment,
configuration and source revision. The projection's 1,000-row ceiling and 100-row
page limit do not prove provider completeness. Establish terminal source evidence,
watermark and stable snapshot identity upstream; never use `complete: true` as
proof by itself. Every row validates before any selection, including hidden rows.

Report generation or email delivery is not release. The list requires current
release state, accepted immutable artifact identity and matching view/download
grants. Recheck those facts and exact artifact bytes at the actual protected
view/download action. `canDownload` and an opaque report key grant no access.
Do not expose raw records, canonical call JSON, recordings, transcripts or private
artifact locations through native reports.

Save/load preferences under a server-derived owner key covering organization,
environment, principal, Creator/CRM company and resource; validate the stored
schema version. Only owner-scoped presentation choices may be written. Define
atomic create/update and stale-write conflict handling before adding persistence;
do not repurpose a business form or existing storage publisher. Never persist
grants, entitlement receipts, result rows or cursors as preference authority.

On every restore/page, obtain the independent current report entitlement receipt
and protected policy revision required by the [preference contract](calls-reports/README.md#saved-report-date-preferences-offline-opt-in).
Its eligible decision, freshness, exclusive expiry and whole-report period bounds
remain separate from the saved date range and current report grants. Other plan
limits remain upstream requirements; plan labels, payments and active subscriptions
do not substitute. Never fall back to the original export after a preference-aware
denial.

Current cursors are process-local WeakMap objects, not browser tokens. Native
pagination needs a separately reviewed protected transport preserving identity,
source snapshot, grants, preference and entitlement bindings. Copying or JSON
serializing the current cursor rejects. Any change to the bound entitlement,
including its observation timestamp, requires restarting with fresh evidence.

## Native acceptance and execution boundary

Before any live change, confirm any prior writer is stopped with no pending write,
refresh the exact target and saved native inventory, and reconcile uncertain
outcomes before retrying. Current supported environment readback must establish
where real portal sessions are available. Development/Stage demo personas and
owner/view-as sessions do not prove authenticated external callers. Follow the
[bounded caller-qualification gates](company-settings-requests/native/CREATOR-AUTHORIZATION.md#smallest-specific-qualification-authorization);
this guide grants no publication, invitation, user, grant or invocation authority.

After separately authorized native integration, acceptance must cover two distinct
real portal principals with different approved synthetic tenant partitions:
own-tenant success, cross-tenant/direct-object denial, revoked/expired authority,
changed entitlement, unknown versus empty versus filtered results, nonempty
terminal pagination, and withdrawal/artifact replacement before access. Exercise
the actual protected entry point and saved preference store, not an owner preview
or mocks. Check native desktop/mobile rendering and navigation only after those
data boundaries pass; hidden controls are not backend permission checks.

Release only the reviewed native component/dependency scope and verify saved
configuration and target-specific bindings independently. Keep prior supported
client behavior until replacement acceptance succeeds. Containment must identify
the exact temporary binding/access to disable and its reviewed cleanup path;
do not assume version rollback. Retain sanitized decisions and test outcomes,
never session material, raw provider bodies or customer records. Offline unit
tests and repository integration do not satisfy these live gates.
