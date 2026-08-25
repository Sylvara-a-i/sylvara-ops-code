# Free Revenue Leak Test Key And Credential Rotation

The safe finish is a quiesced rekey, not a blind variable replacement. Several values named as secrets are durable key-derivation material: changing them changes row identities, Billing references, route lookup hashes, Analytics partitions, proof lookups, or replay fingerprints. This runbook also covers the retained Client Portal Billing webhook gateway as a separate `required_hardening_pending` trust boundary; it does not add that gateway to the exact six Revenue Desk functions. The machine-readable authority is [`../product/free-revenue-leak-test-key-rotation-contract.json`](../product/free-revenue-leak-test-key-rotation-contract.json).

## Stop conditions

Keep all Development ingress and mutations disabled and stop if any of these is true:

- a Function Job remains queued or running;
- a Form 1 or Form 2 bearer is live, a proof is in flight, or a session needs reconciliation;
- a provider call is live/in flight, or a call receipt, canonical call, notification, counted-call key, or event-secret-derived Analytics call fact remains in the new Revenue Desk tables;
- an additive-v2 Analytics row or checkpoint cannot be reconciled by exact key, hash, count, environment, and watermark;
- a CRM/Billing operation is processing or unresolved, a synthetic subscription/customer remains, or an old scope may be invoked again;
- a number hash cannot be regenerated from the authoritative private number mapping and re-approved;
- the Client Portal Creator Custom API inventory/auth contract, immutable Development artifact, Billing route ownership, or rollback cannot be proven;
- a Client Portal inbox row is nonterminal or cannot be rekeyed and reconciled by exact key set, status set, count, digest, conflict report, and authoritative Billing event readback;
- the historical raw OAuth grant or a superseded Creator Connection grant cannot be revoked and independently read back as revoked;
- an old credential or grant cannot be independently proven revoked.

An exposed old value may exist only inside the contained migration window. It must not remain as a previous-key overlap in the final state.

## Execution order

1. Disable API Gateway ingress, provider delivery, Forms/CRM callers, paid mutations, Analytics production and consumption, new job submissions, the Client Portal Billing webhook, and Client Portal Creator delivery. Keep Production dark.
2. Drain both exact pools: `RevenueDeskCallJobs` and `RevenueDeskAnalyticsJobs`. Read back zero queued/running work and reconcile every Client Portal inbox row.
3. Reconcile and clean all synthetic Development effects while the old derivation keys can still resolve them. Preserve only sanitized counts, statuses, domain versions, source SHA, and digests. Do not export raw Client Portal source, OAuth material, webhook values, event IDs, or fingerprints.
4. Apply every gate in the machine-readable contract. Session tombstones stay preserved; no unresolved row is treated as terminal.
5. Rotate durable derivation keys. Recompute every retained number lookup from its authoritative private number, then regenerate and read back route approval and activation evidence. Never partially rekey a call graph, Analytics partition, or `sylvara.crm-report-summary.v1` operation namespace; retained report rows require exact old-to-new key, fingerprint, encrypted payload, call-set digest, full report-revision digest, CRM summary, and deployment-marker reconciliation.
6. Rebuild any artifact bound to a rotated private proof and deploy only the exact reviewed source revision. The separate Client Portal Development artifact remains blocked until its Creator Custom API inventory and exact authentication path are proven. Read back function name, environment, mode, source revision, and disabled gates.
7. Rotate route, webhook, readiness, and caller credentials while ingress is still disabled. Pair the worker's `CRM_BILLING_SHARED_HEADER_VALUE` with orchestrator `REPORT_SUMMARY_HEADER_VALUE` and prove cross-action rejection against paid credentials. Catalyst's Development `ZCFKEY` may be common across Development projects and is never sole authorization: regenerate/replace it only if the control plane exposes that operation and old-key rejection can be proven; otherwise record it non-rotatable and rotate the report-only second factor. Production uses a separately generated API Gateway key. Rotate the paid CRM caller's API Gateway key when supported and its `SHARED_HEADER_VALUE` separately. For the Client Portal gateway, rotate `BILLING_WEBHOOK_SECRET`, remove the previous-secret variables after old-key rejection, rotate its `SHARED_HEADER_VALUE` only if that optional defense remains, and rotate `BILLING_EVENT_FINGERPRINT_SECRET` only after its zero-row or full offline-rekey gate passes. Replace and test each underlying least-privilege read/write OAuth grant independently; Connection link names themselves are not credentials.
8. Verify each new authentication credential succeeds and each old credential fails without logging values. Verify durable namespaces by exact counts and digests, without generating a call, message, subscription, invoice, charge, or Production write.
9. Revoke all old keys and grants, including the historical Client Portal raw OAuth refresh grant and every superseded Creator Connection grant. Independently read back that no previous-key variable, retired raw OAuth variable, or old grant remains.
10. Recreate only the clean Development state needed for later Retell agent testing under the new key versions. Production and real traffic remain dark.

## Special cases

- `PAID_COMMERCIAL_TERMS_JSON` is confidential business configuration, not a cryptographic credential. Rebind the exact approved terms and compare a private digest; do not change price or commercial semantics as “rotation.”
- Form 2 uses `TOKEN_PEPPER` only for bearer derivation/hash and the independent `WORKFLOW_HMAC_SECRET` for prefill/submission durable identities. Rotating the bearer must not change workflow keys.
- `FORM2_PROOF_HMAC_SECRET` rotation also requires recomputing `FORM2_PROOF_ALLOWED_RECIPIENT_DIGESTS`.
- `EVENT_HMAC_SECRET` covers inbound/event receipt keys, payload fingerprints, in-flight Retell ownership tokens, call/correlation keys, notification and recipient identities, mail evidence references, counted-call keys, and downstream Analytics call facts. It cannot be rekeyed one table at a time.
- `NUMBER_LOOKUP_HMAC_SECRET` changes the reviewed route. The new route needs fresh approval and activation evidence after exact hash readback.
- `ANALYTICS_PARTITION_HMAC_SECRET` changes client/deployment partitions, the CRM conversion record key under `revenue-desk-analytics-conversion-v2`, and every `sylvara.crm-report-summary.v1` operation key, fingerprint, call-set digest, and full report-revision digest stored in `CRMBillingOperations`. The conversion fact keeps `free_test` as its origin partition and `paid_service` as its separate target; rotation must not rewrite that classification. Both call-runtime and CRM/Billing producers, the report dispatcher/consumer, and the Analytics consumer must never run with mixed versions.
- `IDEMPOTENCY_PEPPER` changes Catalyst operation keys, Billing references, and direct TEST-customer identity. If an old CRM scope remains callable or reconcilable, rotation is blocked.

## Retained Client Portal gateway

The Client Portal gateway remains outside the Revenue Desk topology and stays `required_hardening_pending`. Retention evidence is not hardening evidence, and repository tests are not deployment or route proof.

Use this sequence only after exact scoped approval for each live action:

1. Prove the Creator Custom API inventory, owner, Development target, OAuth2 `Zohocreator.customapi.EXECUTE` contract, authoritative Billing-event readback, idempotent outcome, and rollback. Keep Creator delivery disabled.
2. Build the one-target artifact from a clean exact reviewed revision, deploy only to Development, and independently read back the immutable source revision, target name, environment, route state, disabled mode, and retained Production code block.
3. With the Billing webhook disabled, rotate the webhook HMAC on both sides. Use only the approved synthetic test path to prove the new signature succeeds and the exposed old signature fails. Remove `BILLING_WEBHOOK_SECRET_PREVIOUS` and its expiry before cutover.
4. Require a zero-row clean inbox or complete the offline all-row fingerprint rekey. Read back source and destination counts, exact event-key and status sets, deterministic keyed digest, duplicate/conflict report, and authoritative Billing event state before removing the exposed fingerprint key.
5. Rotate the least-privilege Creator Connection grant, prove the exact Development Custom API acknowledgment and readback boundary, switch the immutable artifact, then revoke the superseded grant. Do not treat the private Connection link name as the credential.
6. Revoke every historical raw OAuth refresh grant and prove `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ACCOUNTS_URL`, and `ACCOUNTS_ALLOWED_HOSTS` absent from every retained revision and configuration surface.
7. Remove the Production camel-case duplicate only after a separate approved rollback rehearsal and independent absence readback. Repeat final Billing webhook, Catalyst function, route, inbox, Creator, Connection, source-revision, credential-revocation, duplicate-absence, and Production-block readback.

Until all seven steps pass, Development deployment, credential rotation, Production activation, and duplicate removal remain unauthorized, and the classification does not advance.

## Rollback and containment

Before old-key revocation, rollback is allowed only while every route and mutation remains disabled, and only to reconcile or export evidence. Never reactivate traffic on an exposed value.

After revocation, do not restore an exposed value. Keep the system dark and roll forward with a new key and repeated migration/readback. Preserve durable rows, do not retry ambiguous side effects, and report the rotation as blocked until the new state is proven.
