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

## Unimplemented live gates

Before enabling acceptance, a separately approved adapter must authenticate the stable principal, independently verify human attribution and current operation grant, resolve complete explicit links and authoritative CRM relationships, and deny stale or revoked evidence. Producer revisions must identify real reviewed grant/link versions; caller-generated version labels are not authority. For an exact replay, authoritative readback must retain the original bound issuance/request snapshot, while current authentication and revocation are independently enforced; reconstructing from a changed fresh baseline must conflict, not silently overwrite the original claim.

Persistence must atomically claim `claimKey` under a durable UNIQUE constraint, bind `bindingDigest` and the complete attributed envelope, and keep the claim through success, failure or ambiguous timeout. An exact replay returns only the known durable outcome; a different digest must fail without a second side effect. Concurrent losers must read authoritative claim state. Append-only attribution/request persistence and the four-field Creator outcome must be atomic or governed by a reviewed outbox/reconciliation contract that never reports acceptance before the durable outcome is known. Do not release a claim and retry after an unknown result. Retention, least-privilege visibility, correction by a new audit event, independent readback and failure containment require separate decisions. The approved form is unchanged by this proposal.

## Validation and containment

The offline identity test modules are imported by the existing canonical/CI test entrypoint, so no reporting, Retell, storage, workflow-permission or security-policy file is touched:

```sh
node --check src/zoho-creator/client-portal/company-settings-requests/offline-identity-contract.js
node --test src/zoho-creator/client-portal/company-settings-requests/test/service-area-request-contract.test.js
```

Tests exercise every identity join's zero/multiple matches, reverse ambiguity, inactive/cross-company grants, duplicate grants, independent two-company selection and forged cross-company selectors, Billing/portal-user/role shortcuts, incomplete/hostile evidence, attributed copies, fixed serialization vectors, deterministic normalization-equivalent replay, immutable binding and conflicts for each consequential value, invalid issuance/readback and zero transport/clock calls. The existing planner tests continue to own text boundaries and four-field behavior. Durable concurrency, live authentication, schema visibility and append-only acceptance remain untested/unimplemented. Errors do not print principal, record IDs or payloads. All examples are synthetic. Revert the source commit for offline containment; no live rollback is needed.
