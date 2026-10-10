# Fixed ROWID conditional-update candidate

Offline experiment only, based on `833defbc46fcc0e8cab38937a78773ad041b4c87` in an isolated detached worktree. Nothing imports it from a runtime factory. No installed/controller qualification code, shared branch, existing claim or deployed artifact changes. No SDK, HTTP, credentials, bootstrap write or external-effect executor exists here. Default construction is disabled; `experimentalModel: true` enables only an injected query model. Every successful result still says `externalEffectsAllowed: false`; mutation success is named `verified_in_model`, never provider acceptance.

Run with existing Node: `node --test candidate.test.cjs`. The 20 focused tests pass. They assume atomic conditional writes and authoritative readback where stated. A separate adversarial model intentionally breaks atomic predicate evaluation and demonstrates two verified contenders; this passing counterexample is evidence that readback alone cannot establish CAS, not proof that Catalyst exhibits that behavior.

## Minimal record and guard

A single pre-existing synthetic coordinator row is pinned by project, Development environment, exact table, immutable ROWID, client, test, immutable report revision and source revision. Their digest is `SeedIdentity`. The fixed SELECT retrieves only ROWID and the five coordinator projections, with LIMIT 2; missing, duplicate, wrong-identity, malformed and coerced numeric results hold. There is no runtime INSERT, upsert, lookup by allegedly unique logical key, fallback row, recycling or seed recreation. Provisioning and independently attesting an exact seed is a separate unimplemented step.

Each state change emits one UPDATE guarded by the current ROWID, SeedIdentity, version, owner token, generation fence and exact state JSON. The updated projections and payload are in the same statement. Version advances on every transition; fence advances on every new owner; overflow holds. Payloads are limited to 9500 UTF-8 bytes as a candidate budget, not a verified provider capacity. Committed results contain only an exact effect/content hash and private-version reference, never PDF bytes or customer content. Committed revisions are immutable and are never re-seeded.

Each execution issues one initial read, at most one conditional UPDATE and one readback; no write retry. A lost or malformed acknowledgment can be reconciled only by exact desired-state readback under the model's authoritative-read assumption. Empty-update response with matching desired state is contradictory and remains UNKNOWN. Contradictory returned records, different state, unreadable readback or missing seed after dispatch are never promoted to ownership. The current code's generic conditional update helper similarly performs readback; neither helper name nor a successful model establishes provider atomicity.

## External effects and fencing

States: seeded → owned → external_pending → external_unknown or committed. Lease expiry permits takeover only while owned, before any external intent. It never permits takeover from pending or UNKNOWN. Every non-claim transition verifies the current owner token, operation and fence, and the UPDATE additionally verifies version and full previous state. A delayed claim/intent readback cannot grant fresh authority after the lease expired. Late settlement remains possible only for the retained same owner/fence and exact effect/content evidence. The test-only `modelEvidence` assertion has no production evidentiary standing.

Persisting external intent is not permission to send or upload. There is no external call code. A production integration would require separately qualified ownership and proof adapters. Pending intent after process death stays held, even if an external request was never dispatched: availability is sacrificed rather than repeating an uncertain effect. Independent stored-content verification may settle the exact immutable result; timeout, provider acceptance, filename or latest version alone cannot settle it. WorkDrive filename override false may duplicate, and true may create a new version; neither supplies idempotency or receiver-side fencing.

## Comparison with the NoSQL prototype

| Concern | Fixed ROWID DataStore candidate | NoSQL prototype |
| --- | --- | --- |
| Change size | Reuses the existing ZCQL query family and known DataStore projections; still needs explicit seed/schema binding | New backend/transport, item encoding and identity mapping |
| Missing seed | Holds; only UPDATE-existing syntax is planned; no recreate path | Documented absent-item condition bypass is a specific counterexample requiring an existing-only/seed-preservation contract |
| Concurrency | Atomic predicate evaluation and all-column mutation remain unproven | Conditional atomicity, failover consistency and exact encoding remain unproven |
| Access/cost | Existing principal is a candidate only; effective table READ/UPDATE entitlement and cost still require qualification | Additional NoSQL service/scope/cost qualification |
| External ambiguity | Pending/UNKNOWN cannot be leased over; no upload/send implementation | Same external uncertainty remains beyond a storage lock |

Prefer this smaller candidate for contract qualification before migration. Do not adopt either yet. A global shared seed would serialize unrelated clients; this experiment instead requires an independently attested seed per immutable test/report revision. Corrections need another seed and capacity/provisioning policy. That prerequisite cannot be hidden behind a dynamic INSERT with the same unresolved uniqueness behavior. Routine provisioning, retention, exact private-reference retrieval and existing report-store/factory mapping remain unimplemented.

## Exact provider questions before any live proof

1. Does one UPDATE atomically evaluate all WHERE predicates against the same existing ROWID and mutate all SET columns, serializing concurrent writers and failover? Can two requests with the same old version/token both affect the row?
2. What is the exact zero-match result/error, matched-one-row response and rollback behavior? Are returned rows before or after mutation? Can an UPDATE acknowledgment precede durable visibility? Confirm response types rather than guessing an empty array contract.
3. Are exact ROWID reads authoritative/read-your-write after a lost acknowledgment and across failover? Can they return stale ownership? Is ROWID immutable and never reused after deletion, and does UPDATE on a deleted ROWID ever create a record?
4. Are nullable owner predicates, integer version/fence bounds, JSON string equality and all-field UPDATE supported with the proposed column types? What are column UTF-8, query-byte and response limits? Can SDK JSON decoding coerce these numbers or rows?
5. Does the existing managed runtime principal have exactly the required table SELECT/UPDATE capability? Can provisioning be separately restricted, with no runtime CREATE/DELETE or unguarded competing writer?
6. Can the existing SDK/native transport guarantee one dispatch, bounded body/deadline, cancellation and no implicit retry? This candidate has no real transport, deadline or cancellation guarantee.
7. What is current account-wide usage/pricing and the finite authorized diagnostic request/cost budget? Any live test requires its own exact scope and approval. The proposed new allowance for the earlier sequential diagnostic does not authorize this concurrent CAS experiment.

[Official ZCQL UPDATE documentation](https://docs.catalyst.zoho.com/en/cloud-scale/help/zcql/update/) supports updating existing records with WHERE conditions; it does not explicitly establish the concurrency guarantees above. The supplied REST execute-query page could not be retrieved by the browser tool; no additional response or atomicity claim is made from it. These are provider questions, not assumptions to silently enable.

## Acceptance and rollback boundary

No merge, deployment, schema change, grant, provider request, paid service or Retell action is authorized. No existing installed package is replaced. Stop any future proof on missing/wrong seed, competing successes, stale readback, ambiguous write, unexpected retry, unknown external effect or cost uncertainty. Preserve the row and evidence; disarm admission rather than delete/reset or retry. Passing the model suite or repository checks does not certify provider behavior or runtime integration. This off-path suite must be run explicitly: the existing canonical package test glob does not select it.
