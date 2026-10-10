# Revenue Desk rotation foundation (proposed)

Status: private preparation on source revision `55b991b506028d1cdb39755d070557eae18918ed`. This document and the [machine contract](../product/revenue-desk-rotation-foundation-contract.json) describe a synthetic design slice, not implemented or live rotation. Publication, provider selection, spending, new grants, migrations and cutover remain separately gated. A later read-only refresh observed main `faef2d9b9eba1770e60b178d674c71bf9c048437`; its delta touches only three unrelated service-area files. This checkout remains pinned to the reviewed source and does not edit that work.

The existing [rotation contract](../product/free-revenue-leak-test-key-rotation-contract.json) and [rotation runbook](free-revenue-leak-test-key-rotation.md) remain controlling for all current adapters. This proposal does not weaken their quiescence, reconciliation, old-key retirement or exact readback gates. No current identity derivation, deployed adapter, active deployment package, report-storage ledger or v0.5 storage workflow changes.

## Decision and smallest slice

Persist business identity separately from lookup and authentication. Retain existing HMAC-shaped call, receipt, notification and operation IDs as historical opaque IDs where their ownership can be proven; do not discard rows or wholesale rekey downstream state. For future new entities, allocate an opaque ID once at durable admission within tenant/environment/entity-kind scope. A retry reads the admitted ID rather than allocating another.

The smallest executable slice is a **test-only pure reference model** in the call-runtime migration test package. It models one canonical operation claim, immutable semantic binding, versioned keyed aliases and an atomic revision fence. It contains no database, deployed import, credentials, HTTP, random ID generator, migration executor or provider side effect. Existing package test discovery includes it without changing an active package manifest.

The first future integration candidate is shadow-only canonical admission/readback at the report-guard boundary, with no second guard or CRM mutation. A later writing slice must include the retained report operation together with its per-Deal writer fence. This is conditional: stable Deal/operation anchors, legacy integrity verification and all-reference reconciliation must be proven first. The generic model does not implement the report guard, revision-ordering rules or paid-operation recovery. Splitting guard and report migration is unsafe.

Proposed test interface:

```text
initialState(indexKeys) -> synthetic state
apply(state, expectedRevision, command) -> { state, outcome, canonicalId? }

claim: scope {tenant, environment}, anchor, canonicalId (initial admission only),
       binding, aliases [{domain, kid, digest}],
       sourceVerified, normalizedInputAvailable
finish: scope, anchor, terminal/ambiguous status, sourceVerified
set_index_status: domain, kid, status, sourceVerified
```

The stable anchor includes entity/operation kind and the existing business operation scope. For a writer guard it is the stable Deal identity alone; for paid work it is Deal plus action, excluding mutable commercial/acceptance evidence. A report revision uses a persisted revision identity admitted under the existing source-vector ordering rules, not a new ID on each dispatch. In the model, the lookup domain carries the entity/normalization-version distinction. It must come from an authoritative resolver independent of the rotating key. The test model uses synthetic strings and trust flags to expose assumptions; those flags are **not an authorization API**. Its `binding` is a synthetic immutable equality marker, not a production fingerprint format or safe storage recommendation. Actual authentication, normalization, integrity verification and stable-anchor resolution are separate unimplemented gates.

## Lifecycles

| Object | Chosen lifecycle |
| --- | --- |
| Canonical tenant/entity/operation identity | Nonsecret opaque durable identity. Keep legacy IDs and references; scope every resolver and authorization check. Never derive it from the current authentication/index key. |
| Privacy lookup index | Versioned, keyed HMAC-SHA-256. Frame tenant, environment, entity kind, domain, normalization version and normalized value unambiguously. Key ID identifies the protection version, not a new business entity. Never substitute an unkeyed hash for low-entropy private inputs. |
| Immutable content equality and integrity | Separate purpose and version. Protect scope, canonical identity, schema and immutable payload. Rotate protection only after recovery of the domain's required preimage (exact original bytes or canonical normalized fields) and exact equivalence readback. Keep historical evidence; do not compare digests from different keys as though they were equivalent. |
| Ownership-token signing and request authentication | Independent purpose-scoped keys/credentials. Future token format needs an authenticated `kid`, scope, issued/expiry bounds and immutable ownership binding. Ordinary signing rotation does not change any durable ID. |
| Native Connections | Keep product-specific least-privilege read/write grants. Rotate grants independently. A Connection alias is durable configuration, not a credential. |

Normalization and domain versions must be explicit and immutable for each index generation. New keys must be generated and held by the approved custody system; the model never generates or stores keys. Cryptoperiods require a risk-based decision, not a universal interval inferred from this proposal.

## Complete relevant source graph

This graph covers the two target secrets and their transitive identity/reference consumers at the pinned source revision. It is a source review, not an inventory of deployed rows. Paths below are repository-relative; line numbers describe that revision.

Abbreviations:

- **G** = `src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_call_gateway`
- **C** = `src/zoho-catalyst/crm-billing-orchestrator/functions/crm_billing_orchestrator`
- **A** = `src/zoho-catalyst/revenue-desk-analytics`

| Producer / reader edge | Source and preserved behavior |
| --- | --- |
| Event key configuration and shared core | G `lib/config.js:172-190`; worker `index.js:3` imports gateway core. Event, route-authorization and Analytics secrets remain distinct. |
| Event/call/body/correlation derivation | G `lib/security.js:35-63`: event+provider call ID; call ID; exact raw UTF-8 body; correlation parts. |
| Inbound verification and receipt | G `lib/runtime-boundary.js:218-237`, `lib/runtime-service.js:1069-1121`: separate provider authentication precedes event fingerprinting; inbound receipt binds request fingerprint and signature timestamp. |
| Ownership token | G `lib/runtime-service.js:583-607,664-682`: binds client, deployment, immutable configuration, capability, number, correlation and resolved time. Current format lacks signing-key version. |
| Events, jobs, retries and quarantine | G `lib/runtime-service.js:1802-1906`, `lib/catalyst-jobs.js:88-97`, `lib/job-handler.js:61-64,132-133`: receipt admission, exact event key dispatch and retained replay status. Quarantine has separate event/call domains. |
| Canonical call and counted list | G `lib/runtime-service.js:685-775,1175-1259,1372-1387`: call identity and immutable binding, unique counted keys. |
| Notifications/mail | G `lib/runtime-service.js:1263-1295,1506-1548`; `lib/catalyst-mail.js:90,140-142`: call+template+recipient notification identity; recipient and provider-result HMAC references; send/reconciliation state. |
| Call to Analytics row identity | G `lib/analytics-outbox.js:93-97,134-139,328-355,395-438`: call digest becomes both CALL_KEY and RECORD_KEY; provider-version OUTBOX_KEY and payload hash bind it; exact ownership readback. |
| Call to report revision | G `lib/reporting.js:208-223,250-343`; `lib/crm-report-outbox.js:103-126,166-191`: counted call set and CALL_VERSION source vector feed call-set/revision/operation identities. Event key changes transitively change report IDs. |
| Analytics deduplication/report evidence | A `functions/analytics_sync/lib/facts.js:189`, `lib/daily-rollup.js:30-42`; A `tools/build-private-call-ledger.js:26-37`, `tools/opportunity-value.js:76-127`, `tools/build-free-test-report.js:217-222`: exact call references and deduplication. |
| Shared receipt table, separate domains | G `lib/route-control-service.js:417`, `lib/configuration-reconciliation.js:33-35`; A `functions/analytics_sync/lib/report-run-transport.js:148-171`: authorization receipts and report-storage admission are separate authorities, not all event-key-derived. |
| Analytics partitions | G `lib/analytics-outbox.js:109-132`: keyed client/deployment partitions (current HMAC inputs omit environment; enclosing identities include it); used in every v2 fact, physical outbox identity and immutable hash. |
| Report summaries v1/v2/v3 | G `lib/crm-report-outbox.js:10-32,48-70,166-224`; C `lib/report-summary.js`: producers and consumer verify schema-specific operation key/fingerprint, call-set and full revision binding; v3 preserves sourceVersions. |
| Per-Deal writer guard | C `lib/report-guard.js:70-75,82-176`, `lib/versioned-report.js:78-83,135-148`: Deal-only unique key, binding fingerprint, confirmed/inflight operation pointers, version CAS and exact readback. Separate namespaces could create two writers. |
| Report generation and v0.5 storage | A `tools/read-reconciled-free-test-input.js:134-139`, `tools/prepare-free-test-draft.js:116-127,155-160`: keyed partitions and rowset digests affect generationKey/PDF identity. A `tools/create-durable-report-composition.js:123,202-207,277-303`, `tools/prepare-workdrive-draft.js:60-73`, `functions/analytics_sync/lib/report-run-store.js:36-58`, `lib/report-delivery-storage.js:27-40`: bundle, manifest, receipt, filename and delivery references. Preserve this graph and active storage verification. |

The remaining transitive Analytics graph is equally required for a later migration:

| Producer / reader edge | Source and preserved behavior |
| --- | --- |
| Analytics configuration | G `lib/config.js:181-190`; C `lib/config.js:305-326`: shared analytics key bounds and separation from paid/caller keys. Report-only mode omits paid identity material. |
| CRM conversion | C `lib/analytics-outbox.js:87-126`, `lib/lifecycle-handler.js:371`: Account/Deal/deployment keyed identities; preserve free_test origin and paid_service target. |
| Outbox/import identity | C `lib/analytics-outbox.js:138-145,284-318`; A `functions/analytics_sync/lib/facts.js:232-240`, `lib/config.js:10`, `lib/analytics-client.js:338-343,380-386`: deterministic provider-version key plus exact immutable readback and record/client/deployment/environment import matching. |
| Batches, checkpoints, rollups | A `functions/analytics_sync/lib/service.js:24-36,326-361`, `lib/facts.js:405-440`, `lib/catalyst-store.js:405-419,476-513`, `lib/report-checkpoint-verification.js:26-41`, `lib/daily-rollup.js:25-42,83-86`: partitions transitively define batches, checkpoints and daily records; cross-partition corrections reject. |
| Immutable baseline | G `lib/report-baseline.js:9,63-72`, `lib/free-test-preparation.js:204-223`, `lib/analytics-outbox.js:182-193`, `lib/configuration-reconciliation.js:114-117,233-236`: baseline binds keyed partitions and physical configuration ID; successor rebinding preserves predecessor history. |
| Report dispatch and consumer | G `lib/runtime-service.js:2142-2172,2348-2418`; C `lib/report-summary.js:174-219`: recompute exact identity, dispatch existing operation, require exact completion and CAS cursor readback. |
| Revision ordering and uncertain writes | C `lib/report-summary.js:47-60`, `lib/versioned-report.js:78-121,135-164`: strict component-wise source-vector advance, readback-only uncertain-write reconciliation, guard before write fence; no timestamp/hash ordering. |
| Paid operation invariant | C `lib/idempotency.js:103-121,359-365`: Deal/action identity and Billing reference remain stable while changed commercial/acceptance evidence conflicts in immutable fingerprint. |
| Native Connection boundaries | C `lib/connection-boundary.js:18-23`; A `functions/analytics_sync/lib/connection-boundary.js:19-25`: product-specific native grant acquisition and separate read/write privileges. |

## Admission, conflicts and storage proof

All aliases for the same business operation resolve to **one canonical claim and one side-effect fence**. The UNIQUE key includes tenant/environment and the stable operation anchor, independent of index `kid`. Aliases are unique within scope/domain/version and target that canonical claim. Old-only and new-only producers must converge even if their submitted alias sets do not overlap.

The synthetic model performs a whole snapshot transition with a revision compare-and-set. This is a specification of the required invariant, **not proof that Catalyst offers cross-row transactions**. A future adapter must prove atomic claim/alias publication, or a durable common arbiter that blocks side effects until all links and exact readback agree. A crash after any partial write must stay fenced. Ambiguous insert or CAS outcomes require authoritative readback before retry; failed readback is unresolved.

If aliases target different canonical IDs, a historical duplicate is found, immutable binding differs, or scope is inconsistent, reject the entire transition. Do not pick a winner by timestamp, reassign an alias, merge financial state automatically, or return the first query match. A duplicate paid Deal/action remains a conflict against its original operation and Billing reference when commercial or acceptance state changes.

Processing, reconciliation_required and terminal/tombstone records remain replay boundaries. A retry cannot acquire new write authority from an alias or a timeout. Existing report-guard semantics remain separate: permanent STATUS=processing may be idle only with exact LAST_OUTCOME=report_writer_idle, null inflight pointer and verified confirmed pointer/binding/version. The generic model does not label a live guard terminal.

## Missing source, delayed events and retirement

The current minimized event rows do not contain every original HMAC input. G `lib/runtime-service.js:778-809,1833` separates the provider call ID from persisted eventData; canonical calls also omit it. Raw-body bytes, some correlation inputs and complete mail responses are not retained. Legacy report v1/v2 call-set digests cannot reconstruct their original counted-call list. Retaining an old digest does not solve this.

Classify each derivation by its required preimage. Provider call/event lookup inputs use their explicitly defined normalized fields; the legacy payload fingerprint in G `lib/security.js:58-59` covers exact raw UTF-8 request bytes. Reserialized JSON with identical fields but different whitespace or ordering is not equivalent evidence for that fingerprint. If only normalized reconstruction remains, hold exact-byte fingerprint rebinding unresolved, preserve the original historical digest and use independently approved canonical mapping where possible. The synthetic test demonstrates this distinction without implementing integrity migration.

Inventory each entity as required source recoverable, trusted canonical mapping available, or unresolved. Reindex only from the authoritative preimage specified by that domain, or resolve a previously verified canonical mapping without claiming a new equivalent index. A source-unavailable entity remains held; do not silently allocate another ID or retain extra raw customer data solely for convenience. Source recovery, minimization and retention need independent review.

Delayed events must first pass independent authentication, authorization and replay/time checks. Routine signing verification overlap may be considered only with an approved bounded recipient period and trustworthy time evidence; client-supplied historical timestamps alone are insufficient. A compromised signing key cannot authorize fresh traffic, including apparently delayed events. The contained recovery path can use independent evidence; old MAC validity is not that evidence.

Index states are active, lookup-only, retired and compromised. The synthetic model permits lookup-only keys only to resolve already-published aliases, never allocate or attach aliases. Retirement blocks fresh lookup through that key; preserve inaccessible historical mappings and tombstones without needing old secret material. A trusted source can attach a fresh active alias to the same canonical anchor. Retiring a lookup key cannot undo information already exposed by compromise.

## Reconciliation and rollback

Before future migration, snapshot private exact reference sets, counts, statuses, versions, bindings and approved configuration provenance. Stage the canonical mapping and versioned indexes while affected producers/consumers remain disabled under the existing runbook. Reconcile all edges, including notification outcomes, counted calls, outbox/provider identities, checkpoints, report v1/v2/v3 operations, guard pointers and report-storage artifacts. Exact independent target readback is mandatory; aggregate counts alone are insufficient.

Immutable configuration baselines and historical analytics facts stay intact. If a new execution configuration is needed, create an explicitly approved successor with preserved predecessor provenance; do not rewrite historical baselines. The conversion fact remains free_test origin and paid_service target. Current v3 inventory still does not authorize the deferred Complete Free Test transition, whose existing acceptance handoff is v2 with v1 compatibility.

Rollback preserves canonical IDs, aliases, side-effect claims and replay tombstones. Before use, old code must prove it resolves the same canonical namespace; otherwise keep traffic dark and roll forward. Never restore a compromised credential, an exposed previous key, an obsolete mutable configuration, or a completed/ambiguous operation to an executable state. Retention/deletion and historical verification deadlines require explicit policy and must not erase replay protection prematurely.

## Protected metadata-only rotation boundary

A future rotation service should expose only narrowly authorized key/version/status operations and sanitized evidence. Its runtime identity, code deployment and IAM administration must be separately controlled from the assistant/operator role. If that role can deploy arbitrary secret-reading code, impersonate the service or grant itself secret access, redaction alone cannot guarantee assistant-blindness.

Require independently reviewed immutable releases, restricted deployment/IAM changes, non-exportable or narrowly scoped key access where supported, bounded egress, revocation and metadata audit. Acceptance includes denied arbitrary deployment, role-passing/impersonation, secret reads and log/artifact exfiltration. Do not add a homemade vault, broad master credential or a remote KMS request to every hot-path call by default. Provider choice, service cost, custody, availability and necessary grants remain open.

## Official guidance mapping and limits

| Control | Primary guidance | Application here |
| --- | --- | --- |
| Separate key purposes | [NIST SP 800-57 Part 1 Rev. 5](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-57pt1r5.pdf), section 5.2; [OWASP Key Usage](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html#key-usage) | Independent lookup, integrity and signing lifecycles; durable IDs are not key material. |
| Define usage periods | NIST sections 5.3-5.3.6 | Risk-based originator and recipient periods; explicit bounded overlap and delayed-event policy. |
| Handle compromise separately | NIST sections 5.5, 7.5 and 8.3.5; [OWASP Key Compromise and Recovery](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html#key-compromise-and-recovery) | Stop fresh compromised-key authority; revoke, preserve evidence, independently reconcile and roll forward. |
| Inventory and authorize metadata | NIST sections 9.1-9.4; [OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html), sections 2.3, 2.4, 2.6, 2.7 | Map every consumer, control rotation/revocation, retain sanitized accountability and readback. |
| Separate service/deployment authority | OWASP Secrets Management sections 3.1-3.3 and 4.3; [OWASP CI/CD Security](https://cheatsheetseries.owasp.org/cheatsheets/CI_CD_Security_Cheat_Sheet.html) | Deployment/IAM isolation and protected reviewed releases; redaction does not establish the boundary. |

Verified 2026-10-08: [Revision 5 remains final](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final); [Revision 6 remains an initial public draft](https://csrc.nist.gov/pubs/sp/800/57/pt1/r6/ipd). Guidance supports key-management controls; the canonical-claim design is an application-specific interpretation and requires review. It is not NIST approval, legal clearance, HIPAA/SOC 2 certification or a zero-risk guarantee. FCC/FTC/state-law applicability is a separate review.

## Verification and next gate

Run the synthetic test through `node --test src/zoho-catalyst/revenue-desk-call-runtime/migration/test/rotation-identity.test.js`, the migration package `npm run ci`, and the canonical `tools/verify.cmd`. Passing them proves only the tested local contract. Actual signed requests, provider concurrency/crash behavior, migration completeness, deployment isolation and live rotation remain unproven.

Before production-code edits: independently review this contract, approve the exact stable-anchor and integrity strategy, inventory missing normalized inputs, prove the storage fence with fault/concurrency tests, define delayed-event/compromise policy and resolve service/deployment/IAM/cost choices. Publication requires its own source/privacy review. Before live work: obtain an exact scoped migration/cutover packet with disabled prestate, private all-reference reconciliation, independent readback and rollback proof.
