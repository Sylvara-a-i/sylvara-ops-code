# ADR 0008: Single-Key Analytics Outbox Fence

- Status: Accepted for the Development candidate
- Date: 2026-08-26
- Environment: Development only
- Live activation: Not authorized by this decision
- Retell agent scope: Excluded

## Context

The Revenue Desk Analytics candidate originally required two provider-enforced unique columns on `AnalyticsSyncOutbox`:

- `OUTBOX_KEY`, derived from the canonical payload; and
- `PROVIDER_VERSION_KEY`, derived from the provider identity and source watermark.

The existing Development outbox contains 307 legacy rows. Independent readback proved that all 307 rows have null `OUTBOX_KEY`, none has `ROW_SCHEMA_VERSION=2`, and the existing nullable `OUTBOX_KEY` constraint is unique. The proposed `PROVIDER_VERSION_KEY` column could be created with its exact nullable-unique contract on a nonempty disposable table, but the same full contract and a provider-supported split sequence were both rejected on the retained outbox without creating a column or changing any row. Repeated mutation attempts would add risk without improving the concurrency boundary.

The payload-derived key duplicated the payload-binding role already performed by `PAYLOAD_HASH`. The provider-version key was the actual atomic identity fence for exact replay and same-watermark conflict handling.

## Decision

Use the existing unique nullable `OUTBOX_KEY` as the sole physical provider-version fence for additive version-2 rows:

```text
OUTBOX_KEY = SHA256(
  "analytics-provider-version-v1" + NUL +
  RECORD_TYPE + NUL +
  ENVIRONMENT + NUL +
  CLIENT_KEY + NUL +
  DEPLOYMENT_KEY + NUL +
  RECORD_KEY + NUL +
  normalized SOURCE_MODIFIED_AT
)
```

`PAYLOAD_HASH` remains `SHA256(canonical PAYLOAD_JSON)`. Every producer and consumer must normalize accepted UTC timestamps with `Date.toISOString()` before payload encoding, comparison, ordering, or key derivation.

The durable write protocol is:

1. construct the minimized canonical payload and provider-version-derived `OUTBOX_KEY`;
2. attempt one insert against the provider-enforced unique constraint;
3. read back by exact `OUTBOX_KEY` after success, duplicate rejection, timeout, or ambiguous response;
4. compare canonical `PAYLOAD_JSON`, `PAYLOAD_HASH`, and every immutable ownership field; and
5. converge only on an exact match and fail closed on any mismatch or duplicate owner.

A later authoritative correction has a later normalized `SOURCE_MODIFIED_AT` and therefore a different key. A changed payload at the same provider version has the same key and a different payload hash, so it fails closed.

## Repair And Reconciliation Boundary

The unique key is the concurrency boundary. An application preflight query is not.

Final-test reconciliation may use the complete provider identity tuple as a bounded fallback only when the expected key is missing. It must fail when more than one fallback row exists. It may repair a derived key or hash only when canonical payload and every authoritative ownership field already match; it must never overwrite a divergent payload or ownership value. Any allowed repair must increment the fence version, clear leases and provider-job state, and pass independent readback.

The Analytics consumer must block:

- more than one version-2 row with the same `OUTBOX_KEY`;
- one provider identity associated with different keys;
- one key or provider identity associated with different canonical payload, hash, or ownership; and
- any row that crosses the configured environment or schema version.

## Live-State Preconditions

This decision applies only while fresh Development readback continues to prove:

- exactly 307 retained legacy outbox rows;
- zero `ROW_SCHEMA_VERSION=2` rows;
- null `OUTBOX_KEY` on every retained row;
- the existing `OUTBOX_KEY` is nullable, 64-character, and provider-unique; and
- no active producer or consumer uses the former payload-derived meaning.

If any version-2 row exists before coherent cutover, stop. Use an explicit new schema version or a successor table rather than silently changing that row's identity contract.

## Consequences

The selected design avoids another live schema mutation, rewrites no retained row, and keeps one atomic key plus one independently recomputed content binding. All producer and consumer packages must change together before activation. The obsolete `PROVIDER_VERSION_KEY` is removed from active source, schemas, and configuration, while historical Packet A evidence remains unchanged.

A separate fence table was rejected because Catalyst provides no proven atomic transaction across a fence insert and an outbox insert. A successor outbox remains the fallback if the existing unique constraint, lineage, or zero-version-2 precondition cannot be proven.

## Authorization Boundary

This ADR authorizes repository architecture work and synthetic Development verification around the Retell boundary. It does not authorize a Retell agent change or test, Production deployment, real call, customer record, payment, message, live route, or destructive cleanup of retained legacy data.
