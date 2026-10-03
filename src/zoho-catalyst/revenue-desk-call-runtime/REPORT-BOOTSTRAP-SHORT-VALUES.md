# Protected report bootstrap short values

This transport closes a source configuration gap. It does not qualify installed state, provider capacity, recipient eligibility, storage or delivery.

Existing synthetic recipient and reporting bindings measured 629 and 2700 UTF8 bytes. Their Base64 representations require three and nine 400-character values respectively. The empirically accepted 400-character environment value is evidence of one working size, not a documented maximum or a key-count allowance.

`REPORT_RUNTIME_BINDING_JSON` accepts the original exact JSON or a `runtime-parts-v1:size:count:encodedLength:rawLength` marker. `REPORT_RUNTIME_BINDING_PART_0` and subsequent numbered keys contain canonical Base64 of exact UTF8 JSON. Supported sizes are 100, 200 and 400; default is 400. The existing 65536-byte raw bound and SHA256 of original bytes remain unchanged. No compression, dependencies, credential extraction or authority changes are introduced. Noncanonical Base64, invalid UTF8, missing/extra parts, stale pins, wrong source/environment and unqualified enabled sections hold before composition.

## Finite configuration qualification

Use only the existing Development function and protected configuration surface. First independently confirm the JSON activation marker absent. Stage numbered parts and raw SHA, read each value back and reconstruct/hash locally. Set the marker last only after exact comparison and qualified binding prerequisites. A partial or orphan staging state holds. Do not replace the whole environment map, inspect credential values or automatically retry an ambiguous save. Actual total key capacity remains unqualified; use the exact candidate's required count, not the maximum codec bound.

Disarm by removing the JSON marker first, then raw SHA and every matching numbered key, and independently verify own-key absence. Empty values count as present. Preserve immutable claims and receipts. Keep the installed storage qualification package and its separate binding unchanged. No active claim, real endpoint, destination, customer data or populated binding belongs in Git.

## Delivery wiring plan, not activation

Controller and Worker currently pass `deliveryEnabled:false`, `autoDeliveryEnabled:false` and `projectionEnabled:false` explicitly. This change retains those switches. A delivery section in a valid binding alone cannot enable sending or CRM projection.

The later source change must derive those three switches only from separately qualified, protected server configuration, default each to false, reject unknown flags and forbid HTTP/job overrides. Recipient-only setup must continue to work with all delivery effects off. Initial delivery requires the exact fresh complete two-artifact revision, verified test-bound recipient and native lineage, current consent, safe suppression status, durable initial-send claim and summary-only attachment. Manual resend requires confirmation of that exact revision/address and double-tap protection. Provider acceptance, inbox receipt and completed follow-up remain separate states.

Before any switch change, separately qualify effective runtime principal, durable store claims/recovery, exact private WorkDrive destination/version/readback and retention, PDF access/cost, CRM bounded projection and sender authorization/eligibility. Require an explicitly bounded synthetic proof with no customer recipients. Stop on identity mismatch, stale evidence, ambiguous writes or unexpected effects; disable switches and remove activation marker without replaying uncertain work. No sends, provider invocation, grant creation, deployment or merge is authorized by this document.
