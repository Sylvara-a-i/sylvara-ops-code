# Explicit identity and replay-binding prototype

Status: offline executable proposal; test evidence is synthetic only. No live identity mapping is established by this source. The existing Development field-protection observations do not prove actor authentication, company authorization, canonical CRM links, audit durability or replay protection. No production routing, endpoint, live provider, Creator schema change, user, record or grant is included.

`offline-identity-contract.js` composes the existing four-field planner. It checks explicit canonical joins, returns a separate attributed envelope and computes a deterministic replay binding. It does not infer or discover links. Object validation and `complete: true` are producer assertions, not authentication, verification evidence or proof of pagination completeness. Pass these facts only from a separately authenticated, reviewed server producer; never from client JSON.

## Minimum producer contract

`resolveExplicitCompanyIdentity(Account, evidence)` takes an untrusted Creator Account selector and this exact server-only projection:

| Projection | Required facts |
| --- | --- |
| `principal` | `{ id, auditActorId }`: stable authenticated principal and independently bound human audit actor |
| `complete` | `true` only after all required lookup pages and joins have been verified; partial, stale, malformed or unavailable evidence must not be emitted |
| `grants` | `{ principalId, creatorAccountId, creatorContactId, scope, active, revision }`; exact operation scope `service-area-request`, active Boolean and stable authorization revision |
| `accountLinks` | `{ creatorAccountId, crmAccountId, revision }`; explicit reviewed canonical Account link, unique in both directions |
| `contactLinks` | `{ creatorContactId, creatorAccountId, crmContactId, revision }`; explicit reviewed canonical Contact link, unique in both directions, bound to the selected Creator company |
| `crmContacts` | `{ id, accountId }`; fresh authoritative CRM Contact identity and `Contact.Account_Name` identifier |
| `crmAccounts` | `{ id, previousServiceArea }`; fresh authoritative canonical CRM Account and exact current service-area before-image |

Exactly one grant must match principal plus selected company, exactly one Account and Contact link must match, and exactly one authoritative CRM record must match each canonical identifier. A duplicate remains ambiguous even if values agree or only one duplicate is active. The Contact's CRM Account must equal the linked Account. Authorized secondary contacts do not require a Deal, `Primary_Contact`, Billing subscription or Billing customer identifier. Unknown fields, Billing-only projections, optional portal-user fields and role substitutions are rejected.

Provenance supplied in the 2026-10-09 user handoff of verified live Creator Development source, not freshly re-read for this repository change: `BillingWebhook_Ingest` looks up `Accounts.Customer_ID` using the Billing payload's `customer_id`. This proves Billing usage, not a canonical CRM link, authenticated principal identity or company authorization. `Onboarding_Prefill` is a failure stub; `Sync Billing Subscriptions` contains comments only. Neither establishes an implemented identity or provisioning path.

Billing customer identity remains optional for valid free-test CRM Accounts. The recorded Creator metadata has optional/nonunique `Account_Contacts.Portal_User_ID`, Creator roles that differ from CRM roles, and no explicit `CRM_Account_ID` or `CRM_Contact_ID` field. None of these existing values can produce this contract by assumption. Even objects named after hypothetical CRM fields are not the reviewed producer projection.

The missing minimum logical schema is a stable authenticated-principal-to-Creator-company/contact operation grant, explicit canonical Account/Contact links with uniqueness and revision evidence, and durable request/audit/replay metadata. These are logical requirements, **not approved Creator field names or additions**. Before live implementation, decide whether reviewed links/grants live in a separate authoritative server registry or separately approved Creator fields, establish the authenticated principal source, and define controlled link provisioning/revocation. Do not add a duplicate CRM or reuse Billing identity as the join. An operator must verify each canonical relationship before provisioning it. This prototype assumes one canonical Creator Account per CRM Account and one Creator Contact per CRM Contact; a legitimate many-to-one case requires a separately reviewed resolution rule rather than relaxed duplicate checks.

## Attributed request and immutable binding

`prepareOfflineRequestBinding(input, evidence, issuance)` accepts the existing exact `{ Account, Requested_Service_Area }` input. Server-only issuance is `{ requestId, issuedAt }`: a durably assigned stable request identifier and exact canonical UTC timestamp (`YYYY-MM-DDTHH:mm:ss.sssZ`). They must come from an authenticated producer, remain unchanged on retry and never be regenerated to evade a conflict. The function reads no clock and invokes no transport.

The output is `{ request, attribution, requestId, issuedAt, binding }`. `request` retains exactly the four approved form fields. `attribution` snapshots principal, human audit actor, Creator Account/Contact, canonical CRM Account/Contact and grant/link revisions. Attribution is outside the form; no fifth field or duplicate audit form is added.

`binding.claimKey` is SHA-256 of a versioned ordered tuple containing principal plus stable request ID. Company is deliberately omitted from that key so changing the company while reusing the same principal/request ID conflicts. `binding.bindingDigest` hashes a versioned ordered tuple containing the claim key, issuance, every attribution value and all four planned form values, including the exact previous area. Normalization-equivalent requested text produces the same digest; changed baseline, text, actor, company, canonical IDs, grant/link revisions or issuance produces a different binding. JSON tuple encoding avoids delimiter and property-order ambiguity. Hashes are fingerprints, not signatures or authentication, and must remain private with the request metadata.

`assertSameReplayBinding(storedBinding, candidateBinding)` accepts only exact valid binding shapes and rejects different keys/digests. Use trusted producer output and authoritative durable readback only. It neither claims a key nor authorizes a write. Freeze protects copied string projections against accidental in-process modification; it is not immutable storage. No in-memory replay registry masquerades as persistence.

### Fixed v1 serialization vectors

[`test/offline-identity-vectors.test.js`](test/offline-identity-vectors.test.js) pins literal expected `claimKey` and `bindingDigest` values for synthetic fixtures. The existing algorithm hashes the UTF-8 bytes of `JSON.stringify(tuple)` with SHA-256 and emits lowercase hexadecimal. The ordered v1 tuples are:

```text
claimKey:
["portal-service-area-claim-v1", principalId, requestId]

bindingDigest:
["portal-service-area-binding-v1", claimKey, requestId, issuedAt,
 principalId, auditActorId, creatorAccountId, creatorContactId,
 crmAccountId, crmContactId, grantRevision, accountLinkRevision,
 contactLinkRevision, Account, Previous_Service_Area,
 Requested_Service_Area, Status]
```

The vectors lock normalization-equivalent requested text to the same digest, preserve exact before-image whitespace in the digest, and show that a changed authorized company with the same principal/request ID keeps the claim key but changes the digest. Independently defined company fixtures ensure that this last case binds each company's own Account, Contact and grant/link revisions. Forging another company's selector and supplying duplicate grants remain rejection cases, not alternate serializations.

Do not silently rebaseline these vectors. Changes to tuple order, version labels, encoding, normalization or bound values require an explicit compatibility review and deliberate version/migration decisions **before durable adoption**. That decision must define how stored claims and exact retries remain interpretable without permitting a second side effect under a new key or digest. Passing these vectors preserves the existing offline v1 algorithm; it does not approve that algorithm or its metadata for durable or live use.

## Offline exact-ID CRM read producer

[`service-area-request-producer.js`](service-area-request-producer.js) exports `produceServiceAreaRequest(input, trusted, issuance, policy, get)`, a synthetic GET composition seam for the existing identity contract and planner. Evidence status: offline synthetic behavior, 2026-10-11. It implements no HTTP transport, credential handling, SDK client, writer, durable acceptance or native form save. Its successful return is the unchanged `{ request, attribution, requestId, issuedAt, binding }` result from `prepareOfflineRequestBinding`.

`input` remains exactly `{ Account, Requested_Service_Area }`. `Account` is an untrusted Creator company selector checked against protected grants and links; it never establishes identity or authority. Reject all client overrides of CRM IDs, baseline, status, actor, issuance, environment, organization or policy. `issuance` retains the server-only contract above.

`trusted` is exactly `{ environment, organizationId, observedAt, complete, principal, grants, accountLinks, contactLinks }`. The principal, grant and link shapes and uniqueness rules are the same as the minimum producer contract above. `complete` must be `true`. These facts must come from an independently protected server source; neither client JSON nor a CRM record can create or amend them. The producer reuses the existing grant/link resolver to derive the exact CRM Contact and Account IDs before any GET. It does not invent records or a placeholder baseline to satisfy the planner.

`policy` is exactly `{ expectedEnvironment, expectedOrganizationId, asOf, maxAgeMs }`, supplied independently by the server composition root. Environments are `development`, `staging` or `production`; `maxAgeMs` is an explicit positive safe integer with no default. `asOf` and every `observedAt` must be exact canonical UTC timestamps (`YYYY-MM-DDTHH:mm:ss.sssZ`). Trusted evidence and both GET receipts must match the independently pinned organization/environment, must not be observed after `asOf`, and must be no older than `maxAgeMs`. The CRM response body cannot assert the tenant, environment, freshness or authenticity of its own receipt. No implicit clock is read.

The injected `get` receives a frozen descriptor, including its fixed field array:

```js
{
  method: "GET", module: "Contacts", recordId: "synthetic-crm-contact",
  fields: ["id", "Account_Name"], environment: "development",
  organizationId: "synthetic-org"
}
```

The first read is the exact linked Contact. Only after its `id` matches the requested ID and `Account_Name.id` matches the independently linked CRM Account does the producer issue the second descriptor: module `Accounts`, that linked Account's `recordId`, and fields `["id", "Primary_Service_Area"]`. It never follows a different lookup target, lists or searches records, falls back to names, or accepts caller-selected modules, fields, URLs or filters. The callback itself must be installed by the protected server composition root; a descriptor does not constrain arbitrary callback internals.

Each successful synthetic receipt is exactly:

```js
{
  state: "available", environment: "development", organizationId: "synthetic-org",
  observedAt: "2026-10-11T00:00:00.000Z", module: "Contacts",
  recordId: "synthetic-crm-contact", complete: true,
  response: { data: [
    { id: "synthetic-crm-contact", Account_Name: { id: "synthetic-crm-account" } }
  ] }
}
```

The receipt's module and record ID must match the request. `response` contains only `data`, a dense ordinary array with exactly one record; empty, duplicate, partial and paginated results fail closed. No `info` or pagination metadata is accepted by this seam. The Contact record is exactly `{ id, Account_Name }`, with a lookup `{ id, name? }`; the optional display name has no authority and is not used for the join. A null lookup cannot establish a company relationship. The Account record is exactly `{ id, Primary_Service_Area }`. Its exact nonblank service-area text becomes `previousServiceArea` without trimming or newline normalization. Malformed, unavailable, mismatched, stale or incomplete receipts and transport failures produce no prepared request; there is no partial result, fallback baseline or acceptance claim.

Inputs are validated and copied before the first asynchronous read. Each response is validated and detached before another asynchronous continuation can mutate its facts; accessors, unexpected keys and nonordinary arrays are rejected. These snapshots prevent in-flight object mutation from changing the selected company, provenance or bound values. They do **not** enforce current authorization or revocation. The identity resolver, planner, v1 tuple serialization and fixed golden vectors remain the existing contracts; no additional runtime dependency is needed.

Field provenance supplied in the 2026-10-11 user audit: `Contacts.Account_Name` is an Accounts lookup; CRM `Accounts.Primary_Service_Area` is the candidate canonical textarea. Creator `Accounts.Service_Area` remains an unverified mirror and is not a baseline source. This handoff is not a fresh live read by the offline producer. The native form remains gated until the protected identity, read, permission, attribution and acceptance boundaries are verified.

The official [Zoho CRM V8 Get Records documentation](https://www.zoho.com/crm/developer/docs/api/v8/get-records.html), reviewed 2026-10-11, documents exact-ID GETs, response `data` arrays and lookup objects containing an ID/name or null. It establishes generic provider capability only. The pinned GET descriptors, receipt provenance fields, single-record shape and completeness assertion above are this repository's **synthetic adapter protocol**, not a claim that Zoho emits that envelope or that a live connector is qualified. A future adapter must separately establish exact response/error semantics, field completeness, transport bounds and server-owned tenant provenance before translating provider evidence into this receipt.

## Native CRM body projection

[`crm-service-area-response.js`](crm-service-area-response.js) supplies the missing native-body projection before the existing GET producer: `projectCrmServiceAreaResponse(module, recordId, response)`. It accepts only the fixed `Contacts` and `Accounts` exact-record targets and a native `{ data: [record] }` body with one matching string ID. It rejects error, partial, multiple-record and pagination envelopes. Unrelated own data fields in the native record are discarded; accessors and symbol keys are rejected without execution. The Contact output retains only `id` and `Account_Name.id`, omitting the display name; the Account output retains only `id` and the exact `Primary_Service_Area`. Output is copied and frozen. The published producer's strict receipt protocol and v1 binding remain unchanged.

The protected reader may use this projected body as its receipt's `response`. This helper does not create `state`, `complete`, organization, environment, observation time, authentication or authorization evidence. Those assertions still belong to the independently qualified server reader and are checked against the existing policy. Never derive them from a CRM field or `Modified_Time`. The function has no transport, credential, clock, writer, SDK or receipt-wrapper capability. Provider/MCP success wrappers must be separately qualified before extracting their native body; this helper does not interpret an arbitrary connector result as success.

Read-only connector observations, 2026-10-11: CRM field metadata confirms `Contacts.Account_Name` is an Accounts lookup and `Accounts.Primary_Service_Area` is a string textarea with maximum 2,000. Creator Development metadata confirms the existing request form fields, its required selectable `Account`, and a required multiline `Requested_Service_Area` with native maximum 65,535. Creator `Accounts` and `Account_Contacts` expose no explicit `CRM_Account_ID` or `CRM_Contact_ID`; `Portal_User_ID` remains optional and nonunique. The advertised exact-record CRM GET accepts only module/record ID, without a field-selection parameter. These observations justify a minimal body projection, but do not qualify a record read, authenticated client session, tenant provenance or native acceptance. No client records were read, and no metadata, identity or permission was changed.

The narrow next live prerequisites are:

- A specified protected server source for authenticated principal and human audit actor, current operation grants/revocation, and reviewed unique Account/Contact links with revisions. Existing Creator metadata cannot supply these by inference; choosing or provisioning that source remains separate work.
- A qualified exact-record reader whose connection identity establishes the pinned CRM organization/environment, whose server observation time and explicit bounds establish freshness, and whose full success/error/partial/permission semantics are verified with separately approved synthetic records. Current connector field metadata and typed GET inputs do not establish that qualification.

Until those prerequisites exist, composition tests remain synthetic and native request acceptance remains gated. No acceptance wrapper, placeholder UI or identity schema is introduced. `test/crm-service-area-response.test.js` verifies that synthetic native response bodies compose with the published producer and still stop cross-company, wrong-organization and stale receipts before the Account read.

## Versioned timed read composition (offline)

`produceTimedServiceAreaRequest(input, requestId, policy, services)` is an explicitly separate `timed-read-v2` protocol. The existing `produceServiceAreaRequest` fixed-`asOf` API remains unchanged for snapshot fixtures and existing callers; it must not silently be adapted to fresh completed reads. The new policy is exactly `{ protocol: "timed-read-v2", expectedEnvironment, expectedOrganizationId, maxAgeMs, maxDurationMs }`. Both positive safe-integer bounds are required; duration is limited to the platform timer range. Services are exactly `{ now, readAuthorization, get }`, installed by a protected server composition root. Client input still contains only the two existing fields. Neither client timestamps nor a client-selected callback is permitted.

`now()` synchronously returns canonical UTC from the trusted server clock. Request start and deadline are derived there, and request `issuedAt` is the actual start, never backdated to accommodate evidence. Sampled wall-clock regression, observations in the future, and the exclusive deadline (`now >= deadline`) fail closed. A separate monotonic elapsed deadline and real timer bound total caller waiting across authorization and both reads, even if a dependency never settles or the wall clock stalls. They do not prove cancellation of an underlying SDK/network operation. After timeout, late results cannot trigger another read or return a prepared request; a qualified runtime must additionally establish transport cancellation/resource bounds.

`readAuthorization()` obtains a fresh complete protected snapshot using the existing evidence shape. It runs before Contact, between Contact and Account, and after Account. Its observation must fall within that invocation's server-clock interval; cached observations predating the invocation are rejected. Every invocation independently resolves the operation grant and unique explicit links. Principal, human actor, selected company, CRM Contact/Account IDs, and grant/link revisions must equal the initial resolution. Revocation, ambiguity, tenant mismatch or changed identity/revisions abort the request. No lookup fallback or callback is inferred from Creator or Billing metadata.

GET descriptors add exactly `protocol`, `requestStartedAt`, and `deadlineAt` to the existing fixed descriptor. Successful receipts retain the existing shape and must carry genuine reader-owned observation times within each individual read's start/completion interval. Contact relationship and Account baseline are detached before another asynchronous callback. The final fresh authorization is followed by synchronous binding preparation and a final trusted-clock/deadline/freshness recheck of both receipts and that authorization. After awaiting the bounded race, the exported function repeats the clock/deadline/freshness check immediately before returning, covering promise continuations after internal preparation. No further await follows that exported-function check. This is preparation-time authorization, not an atomic durable acceptance or protection from a revocation occurring after return. The future acceptance boundary must independently recheck current authorization and atomically govern persistence.

The request/binding output, exact before-image, normalization, v1 hash tuple serialization, and fixed golden vectors are unchanged. Identical request, attribution and server-derived issuance produce the same v1 digest; choosing actual request-start issuance instead of an old supplied timestamp intentionally changes the digest input. Adopting v2 requires explicit server composition and protocol migration decisions; existing durable claims must retain their original issuance, attributed snapshot and digest, and must not be recomputed on replay using a new start time. This source does not adopt a durable protocol, install clocks/credentials/grant authorities, upgrade an SDK, activate a form or qualify runtime provenance.

Synthetic regressions cover genuine delayed completion for two companies, exact baseline/digest compatibility, revocation between reads and before response, changed actor/links/revisions, stale earlier reads at final time, clock regression, future/backdated observations, exact deadline expiry, hung callbacks and late completion. Live connection organization/environment/scopes, native success/error wrappers, observation-time authority, transport cancellation and the current grant resolver remain explicit qualification gates.

## Unimplemented live gates

Before enabling acceptance, a separately approved adapter must authenticate the stable principal, independently verify human attribution and current operation grant, resolve complete explicit links and authoritative CRM relationships, and deny stale or revoked evidence. Producer revisions must identify real reviewed grant/link versions; caller-generated version labels are not authority. For an exact replay, authoritative readback must retain the original bound issuance/request snapshot, while current authentication and revocation are independently enforced; reconstructing from a changed fresh baseline must conflict, not silently overwrite the original claim.

The GET producer does not supply the protected provisioner, authenticated principal resolver, current grant/revocation authority or durable attribution. Before any future acceptance, the composition root must freshly recheck authentication, current operation authorization and revocation, including changes during an in-flight read. A frozen prior snapshot is insufficient. Native form field visibility or validation alone does not establish these server boundaries, and no save flow is enabled by this source increment.

Persistence must atomically claim `claimKey` under a durable UNIQUE constraint, bind `bindingDigest` and the complete attributed envelope, and keep the claim through success, failure or ambiguous timeout. An exact replay returns only the known durable outcome; a different digest must fail without a second side effect. Concurrent losers must read authoritative claim state. Append-only attribution/request persistence and the four-field Creator outcome must be atomic or governed by a reviewed outbox/reconciliation contract that never reports acceptance before the durable outcome is known. Do not release a claim and retry after an unknown result. Retention, least-privilege visibility, correction by a new audit event, independent readback and failure containment require separate decisions. The approved form is unchanged by this proposal.

## Validation and containment

The offline identity test modules are imported by the existing canonical/CI test entrypoint, so no reporting, Retell, storage, workflow-permission or security-policy file is touched:

```sh
node --check src/zoho-creator/client-portal/company-settings-requests/offline-identity-contract.js
node --check src/zoho-creator/client-portal/company-settings-requests/service-area-request-producer.js
node --test src/zoho-creator/client-portal/company-settings-requests/test/service-area-request-contract.test.js
```

Tests exercise every identity join's zero/multiple matches, reverse ambiguity, inactive/cross-company grants, duplicate grants, independent two-company selection and forged cross-company selectors, Billing/portal-user/role shortcuts, incomplete/hostile evidence, attributed copies, fixed serialization vectors, deterministic normalization-equivalent replay, immutable binding and conflicts for each consequential value, invalid issuance/readback and zero transport/clock calls. The existing planner tests continue to own text boundaries and four-field behavior. Durable concurrency, live authentication, schema visibility and append-only acceptance remain untested/unimplemented. Errors do not print principal, record IDs or payloads. All examples are synthetic. Revert the source commit for offline containment; no live rollback is needed.

Producer regressions cover zero GETs for invalid input/protected evidence/issuance/policy, exact Contact-then-Account descriptors, company/tenant/environment/record mismatches, stale and future observations, missing or multiple rows, null or forged lookups, blank and whitespace-sensitive baselines, hostile descriptors and in-flight mutation. They also pin exact 19-digit string IDs, reject rounded numeric IDs, and preserve the requested-text 2000/2001 emoji boundary. Successful preparation equals the existing planner/binding result and all fixed vectors remain unchanged. Offline receipts do not test provider permissions, current revocation, native form acceptance or durable side effects.
