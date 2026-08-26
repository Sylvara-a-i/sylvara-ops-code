# Canonical-table migration utility

Status: **offline source utility; no live adapter, migration, cleanup, or deletion is included or authorized**.

This package plans and executes a one-way copy from reviewed legacy snapshots into canonical Revenue Desk tables. It exists to make a future private Development migration deterministic, resumable, idempotent, conflict-preserving, and independently reconcilable. It never renames, updates, truncates, or deletes a legacy resource.

## Safety boundary

- The public repository contains code and synthetic tests only. Never add a live row, platform ID, populated endpoint, secret, private table export, or generated private plan.
- `dry-run` is the default safe mode and cannot call an adapter.
- `apply` requires an injected adapter with explicit private-migration and independent-readback capabilities. This package deliberately ships no Catalyst, REST, browser, or network adapter.
- `apply` and `reconcile` require the exact `sha256:` digest approved for the normalized immutable contract and private source/target snapshot. Any snapshot, mapping, metadata, or row change produces a different approval boundary.
- The HMAC key is supplied out of band, must contain at least 32 bytes, and is never returned. It creates opaque row-key, row, partition, conflict, cursor, operation, and rollback evidence.
- Only allowlisted target columns in the reviewed projection are copied or compared. Source-only fields and provider readback metadata are ignored.
- Required values cannot be `null`. Set `nonBlank: true` when a required text field must also contain a non-whitespace character; incomplete source rows are quarantined and invalid constants reject the contract.
- Source and target table identities are globally disjoint under case-insensitive comparison. The planner cannot express an in-place rewrite or route one resource's target back into another resource's source.
- A duplicate key, missing required field, mismatched destination row, or state drift becomes a sanitized quarantine record. Conflicting rows are not overwritten.
- An insert response is never proof. The executor performs a separate keyed target read and compares the allowlisted row digest.
- Rollback metadata is produced only for a target row whose prestate was absent and whose poststate independently matched. It explicitly leaves mutation ownership for private adapter-receipt review, does not contain a delete implementation, and reports `rollbackAuthorized: false`.
- Legacy retention remains mandatory. A complete single-pass reconcile can mark evidence eligible for a separate retirement review, but the utility still reports `deletionAuthorized: false` and exposes no legacy-delete method.

## Private input contract

Keep the contract and snapshots in an approved private system. The object passed to the library has two parts:

```js
const contract = {
  schemaVersion: 1,
  migrationId: 'reviewed-development-copy-v1',
  resources: [{
    id: 'deployments',
    sourceTable: 'LegacyDeployments',
    targetTable: 'RevenueDeskDeployments',
    sourceKeyColumn: 'LEGACY_KEY',
    targetKeyColumn: 'DEPLOYMENT_KEY',
    partitionColumns: ['SOURCE_ENVIRONMENT', 'ENGAGEMENT_TYPE'],
    projection: {
      DEPLOYMENT_KEY: { source: 'LEGACY_KEY', required: true },
      SOURCE_ENVIRONMENT: { source: 'SOURCE_ENVIRONMENT', required: true, nonBlank: true },
      ENGAGEMENT_TYPE: { constant: 'free_test', required: true, nonBlank: true }
    }
  }]
};

const privateInput = {
  schemaVersion: 1,
  captureId: 'private-reviewed-capture',
  capturedAt: '2026-01-01T00:00:00Z',
  sources: [{ table: 'LegacyDeployments', rowCount: 0, rows: [/* private export */] }],
  targets: [{ table: 'RevenueDeskDeployments', rowCount: 0, rows: [/* fresh prestate */] }]
};
```

Projection descriptors support exactly one `source` or `constant`, an optional Boolean `required`, and optional `nonBlank`. `nonBlank: true` requires `required: true` and means the value must be text containing at least one non-whitespace character. All required values reject `null`; source violations become conflicts while invalid constant definitions fail contract validation. The target key must be a required direct mapping from the source key and cannot be blank. Partition fields must be required. Each snapshot's explicit `rowCount` must equal its supplied row array; compare that bound count with an independently captured private inventory before approval. Source and target table sets must be globally disjoint after case normalization. Table and column API names are validated before planning. Unknown projection options fail closed.

Snapshot table order and row order do not affect the approved digest. Capture metadata, mappings, allowlisted values, and row membership do. Private plans contain projected rows and keys in memory and must never be logged, committed, attached to a public pull request, or treated as sanitized evidence.

## Modes

```js
const {
  computeApprovedInputDigest,
  executeMigration,
} = require('./');

const approvedInputDigest = computeApprovedInputDigest({ contract, privateInput });

const preview = await executeMigration({
  mode: 'dry-run',
  contract,
  privateInput,
  digestKey,
  batchSize: 100
});

const applied = await executeMigration({
  mode: 'apply',
  contract,
  privateInput,
  digestKey,
  approvedInputDigest,
  adapter: reviewedPrivateAdapter,
  cursor: null
});

const reconciled = await executeMigration({
  mode: 'reconcile',
  contract,
  privateInput,
  digestKey,
  approvedInputDigest,
  adapter: reviewedPrivateAdapter
});
```

Start apply at `cursor: null`; do not reuse a dry-run terminal cursor as the first apply cursor. Pass each apply result's opaque `batch.nextCursor` to the next apply call. Reusing a completed or earlier apply cursor is safe because every target mutation is preceded by a fresh read and every conflict quarantine is idempotency-keyed. A cursor is signed and bound to the approved input digest; edited, stale, cross-snapshot, or out-of-range cursors fail before adapter access.

The mode result is minimized relative to the source rows: it contains counts, opaque partition evidence, cursor state, operation evidence, and rollback metadata, but no projected rows, raw keys, or private partition values. Counts and resource history can still be sensitive operational evidence, so keep results private and out of Git. `createMigrationPlan` is intentionally lower-level and returns private in-memory rows for an executor; avoid it unless building a reviewed private operator wrapper.

## Injected adapter

No implementation is included. A reviewed private adapter must expose:

```js
{
  capabilities: {
    privateMigration: true,
    independentReadback: true
  },
  async readTarget({ targetTable, keyColumn, keyValue }) {},
  async insertTarget({
    targetTable, keyColumn, keyValue, row, idempotencyKey, approvedInputDigest
  }) {},
  async quarantineConflict({ conflict, idempotencyKey }) {},
  async readQuarantine({ conflictId }) {}
}
```

`readTarget` returns zero or one rows; multiple ownership is a conflict. `readQuarantine` must independently return the exact `conflictId`, `inputDigest`, and `reason`. The adapter must bind a fixed Development project and reviewed table allowlist, use bounded timeouts, preserve ambiguous outcomes, and avoid logging arguments. Production, browser automation, direct cleanup, and automatic retry loops remain outside this package.

## Required private run evidence

Before any future apply, privately preserve fresh metadata, permissions, source and target counts, the exact contract, approved input digest, partition digests, dry-run summary, every conflict, adapter revision, mutation approval, rollback owner, and recovery window. After apply, run reconciliation from the beginning with the same immutable input. Preserve every legacy table, row, route, function, Job Pool, and binding until all batches independently match and a separate retirement packet is reviewed. Repository tests are not live migration evidence.

## Verification

```powershell
cd src/zoho-catalyst/revenue-desk-call-runtime/migration
npm run ci
```
