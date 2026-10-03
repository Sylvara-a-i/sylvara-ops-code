# Protected report bootstrap short values

This transport closes a source configuration gap. It does not qualify installed state, provider capacity, recipient eligibility, storage or delivery.

Existing synthetic bindings measured 629 and 2700 UTF8 bytes. Base64 alone needs three and nine 400-character values. At a historical 2205-byte complete-map baseline, these would total3312 and6284serializedbytes. The original compactv1 fixture with repeated placeholder digests measures3480serializedbytes. Replacing eight digests with distinct synthetic values raisesv1 to3971bytes and correctly holds. Compactv2 uses additional fixed public vocabulary to bring that stress fixture to approximately3.4KB against a synthetic2205-byte baseline; fresh/provider capacity remains unqualified. Per-value success is not aggregate-capacity proof. The optional compact format addresses repeated JSON field/value overhead without omitting or deriving fields.

`REPORT_RUNTIME_BINDING_JSON` accepts original exact JSON, `runtime-parts-v1:size:count:encodedLength:rawLength`, or `runtime-deflate-v1:size:count:encodedLength:rawLength` / `runtime-deflate-v2:size:count:encodedLength:rawLength`. Numbered `REPORT_RUNTIME_BINDING_PART_` values contain canonical Base64 of exact UTF8 bytes or a native raw-deflate stream using an immutable dictionary: v1 has184bytesofpublicrootschema keys;v2 adds public nested schema keys, table names, enums and API origins already present in public source. Every field/value remains in the original byte stream; the dictionary omits or derives nothing. Each dictionary is part of its numbered wire contract and must not change in place. V1 remains readable and encodable. Supported sizes are100,200,400. `encodeReportBootstrap` retains the original uncompressed default; `prepareReportBootstrapBinding` defaults to compactv2. Raw bytes, whitespace, Unicode and the original raw SHA256 are preserved. There is no new dependency or compressed-byte determinism requirement.

Both formats bound raw bytes to65536. Compact input is bounded to66560compressedbytes before decoding, and inflation is bounded to65536bytes. Node24's consumed-byte count rejects trailing garbage and second streams. InvalidUTF8/Base64, unknown versions, inherited/missing/extra activation or parts, mixed representations, changed raw pins and stale protected bindings hold. Legacy JSON and uncompressed parts remain supported.

## Complete-map preparation preflight

`prepareReportBootstrapBinding({raw,bindingSha256,baseline,identityPins,now,partSize,format})` is pure offline preparation. It validates complete-map accounting, then uses the existing protected loader to verify identity, source, expiry and enabled-section claim qualification before returning stageable parts, marker, raw pin and frozen sizing result. It acquires no durable claim, changes no environment and invokes no service. No HTTP/job parameters may supply this protected configuration.

Use independently observed safe aggregate metadata for `baseline`: numeric millisecond `observedAt`, UTF8 `serializedBytes` of the complete compact `JSON.stringify(environmentMap)`, `entryCount`, and `controlledEntries`. Observations must be no more than15minutesold, with no future timestamp. Include every observed `SOURCE_REVISION`, `DEPLOYMENT_ENVIRONMENT` and bootstrap activation/hash/part key. Each entry is `{key,serializedEntryBytes}`, where the contribution counts `JSON.stringify(key)+":"+JSON.stringify(value)`, without a comma. Any observed bootstrap activation/hash/part key holds until the prior representation is safely contained. Only identity-key replacements are accepted. Do not export unrelated environment keys/values, tokens or populated environment maps.

`identityPins` contains only the expected `SOURCE_REVISION` and `DEPLOYMENT_ENVIRONMENT`. Full accounting adds identity replacements, every part, raw SHA and activation marker, including JSON punctuation. It must be at most3578serializedbytes. This is an engineering margin below a previously observed successful save, not a documented Zoho limit, guaranteed allowance, or authority to stage. Missing, contradictory, duplicate or nonsensical metrics hold. Recheck actual fresh accounting for every preparation; a historical sizing receipt is not reusable qualification.

## Finite configuration qualification

Use only the existing Development function and protected configuration surface. Confirm activation absent, all readiness/evidence gates and fresh complete-map preflight before any claim or staged write. Stage parts and raw SHA, independently read back and reconstruct/hash locally. Set the marker LAST. Do not replace the entire environment map, inspect credential values or automatically retry an ambiguous save. Stop on unconfirmed save, mismatch, stale evidence or background map drift. No live proof or new claim is produced by source tests.

Disarm by removing the JSON marker FIRST, then raw SHA and every matching numbered key, with independent own-key absence readback. Empty values count as present. Preserve immutable claims, receipts and installed baselines. Storage qualification uses a separate codec and binding; this update preserves the merged compact storage source. No active claim, real endpoint, destination, customer data or populated binding belongs in Git.

## Protected delivery execution, not activation

Legacy bindings and omitted `delivery.execution` default all effects false. An
explicit execution object has exactly `deliveryEnabled`, `autoDeliveryEnabled`,
`projectionEnabled` booleans and `qualification`. All-false configuration requires
`qualification:null`. Any true flag requires a separately accepted qualification
with exactly `status:"qualified"`, nonzero SHA256 `evidenceDigest`, numeric
`verifiedAt` and finite `expiresAt`. Its expiry may not exceed the enclosing
bootstrap or delivery claim qualification. The digest is only a reference to
independently accepted evidence, never self-certifying provider authorization.
Protected installation pins the whole object with the exact source, project,
function identities and raw SHA. No HTTP, Job or command flag supplies it.

True flags require the delivery section. Automatic delivery additionally requires
delivery and reporting enabled. Controller always forces automatic delivery false;
only Worker may select it. When reporting and an execution effect are enabled,
Controller delivery and Worker reporting destination maps must agree exactly,
with no duplicate scope. Projection alone permits no mail dispatch. Recipient-only
attestation remains independent of reporting, report completion and these effects.

Every effect uses the protected active clock. Expired qualification blocks new
reads, claims, uploads, sends and projection through existing boundary guards,
including after awaited authorization. Expiry after dispatch is ambiguous; retain
the claim and use reconciliation only. Never replay a completed or unknown effect.

Before live flag qualification, independently accept fixed principal, durable
claim/recovery, recipient native lineage and consent, PDF output, exact private
WorkDrive version/content/retention, and sender identity/transport. Projection
also requires exact five-field schema and effective narrow writer qualification.
Initial delivery requires a fresh complete two-artifact revision and Completed
test, sends summary only, and preserves the private supporting packet. Manual
resend requires exact revision/address confirmation. Provider acceptance is not
inbox receipt, read receipt or completed follow-up.

Count every execution and qualification byte in a fresh complete-map preflight.
The earlier 159-byte synthetic margin is not available by assumption. Oversized
bindings hold; never omit evidence to fit. The isolated package test includes all
new fields and a ninth distinct synthetic digest, and asserts exact accounting or
the engineering-budget hold. Receipt/value dictionaries remain immutable.

Warm Worker processes capture configuration at startup; removing environment
keys alone is not revocation and cannot recall an in-flight provider request.
Contain dispatch first, account for in-flight attempts and preserve ambiguous
claims. Remove the activation marker first, then hash/parts, and independently
verify absence. Install the prior disabled package only through the separately
accepted process, verify runtime replacement or wait for finite captured expiry,
and do not resume dispatch on a presumed refresh. This adds no remote kill-switch
or hot-revocation architecture. Immediate revocation beyond these controls remains
an operator/platform qualification boundary, not a source success claim.

Source tests and receipt shapes authorize no installation, staging, grant,
provider invocation or customer delivery. Routine bounded Zoho-to-Zoho calls
have no blanket zero-cost proof hold; actual new paid services, purchases,
upgrades, Retell charges and customer effects remain separate boundaries.
