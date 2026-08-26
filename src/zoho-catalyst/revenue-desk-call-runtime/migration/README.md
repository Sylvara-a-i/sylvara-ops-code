# Canonical-table migration utility

Status: **offline-first migration utility with a fixed-target adapter boundary; no provider client, private binding, live migration, cleanup, or deletion is included or authorized**.

This package plans and executes a one-way copy from reviewed legacy snapshots into canonical Revenue Desk tables. It exists to make a future private Development migration deterministic, resumable, idempotent, conflict-preserving, and independently reconcilable. It never renames, updates, truncates, or deletes a legacy resource.

## Safety boundary

- The public repository contains code and synthetic tests only. Never add a live row, platform ID, populated endpoint, secret, private table export, or generated private plan.
- `executeFixedTargetMigration` defaults to `dry-run` and cannot inspect a private binding, transport, or logger in that mode.
- The public package root does not export the arbitrary-adapter executor, and its package export map blocks executor subpath imports. Public `apply` and `reconcile` therefore pass only through the fixed-target composition; the raw seam remains relative-path internal test code.
- `apply` requires a serialized private binding parsed by `parsePrivateTargetBinding`, plus distinct audit and changes planes. This package deliberately ships no Catalyst credentials, target values, REST client, browser automation, connector implementation, or network bootstrap.
- `apply` and `reconcile` require the exact `sha256:` digest approved for the normalized immutable contract and private source/target snapshot. Any snapshot, mapping, metadata, or row change produces a different approval boundary.
- The private binding repeats the exact migration ID, capture ID, canonical UTC capture and expiry timestamps, digest, execution mode, Development organization/project identity, target tables, key columns, projected columns, separately captured unique-constraint metadata digests, quarantine schema, ZCQL parser, pagination ceiling, and operation timeout. Its approval window must be positive and no longer than 15 minutes. Execution rejects a future capture or expired approval before constructing the adapter or inspecting a transport. It is accepted only as bounded JSON and becomes a deeply frozen module-sealed object.
- Every audit or changes operation independently reads its plane's current identity and fails closed unless both private identifiers and the exact `Development` environment match. `reconcile` never inspects or retains a changes plane.
- ZCQL is generated internally from the contracted table, key, and projection allowlists. Keyed readback is limited to one two-row page, which is sufficient to distinguish missing, unique, and duplicate ownership; callers cannot submit a statement or request a wider page. Snapshot capture and bulk scans remain outside this adapter and require a separately reviewed bounded exporter.
- Target and quarantine writes use the changes plane only. Every authoritative post-write query uses the distinct read-only audit plane. A failed or timed-out insert is ambiguous, receives no automatic retry, and is resolved only through that independent readback.
- Optional structured logging emits only mode, operation class, outcome, and ambiguity. It never includes identities, tables, ZCQL, keys, rows, digests, provider responses, or original exception messages.
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
  capturedAt: '2026-01-01T00:00:00.000Z',
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
  executeFixedTargetMigration,
  parsePrivateTargetBinding,
} = require('./');

const approvedInputDigest = computeApprovedInputDigest({ contract, privateInput });

const preview = await executeFixedTargetMigration({
  mode: 'dry-run',
  contract,
  privateInput,
  digestKey,
  batchSize: 100
});

const applyPrivateTargetBinding = parsePrivateTargetBinding(
  privateApplyBindingJsonLoadedFromAnApprovedPrivateRuntime,
);
// This value comes from the separate approval envelope. Do not derive or approve
// it inside the execution process.
const approvedApplyTargetBindingDigest = approvedApplyEnvelope.targetBindingSha256;

const applied = await executeFixedTargetMigration({
  mode: 'apply',
  contract,
  privateInput,
  digestKey,
  approvedInputDigest,
  approvedTargetBindingDigest: approvedApplyTargetBindingDigest,
  privateTargetBinding: applyPrivateTargetBinding,
  transport: reviewedPrivateTransport,
  cursor: null
});

const reconcilePrivateTargetBinding = parsePrivateTargetBinding(
  privateReconcileBindingJsonLoadedFromAnApprovedPrivateRuntime,
);
const approvedReconcileTargetBindingDigest = approvedReconcileEnvelope.targetBindingSha256;

const reconciled = await executeFixedTargetMigration({
  mode: 'reconcile',
  contract,
  privateInput,
  digestKey,
  approvedInputDigest,
  approvedTargetBindingDigest: approvedReconcileTargetBindingDigest,
  privateTargetBinding: reconcilePrivateTargetBinding,
  transport: { audit: reviewedPrivateTransport.audit }
});
```

Start apply at `cursor: null`; do not reuse a dry-run terminal cursor as the first apply cursor. Pass each apply result's opaque `batch.nextCursor` to the next apply call. Reusing a completed or earlier apply cursor is safe because every target mutation is preceded by a fresh read and every conflict quarantine is idempotency-keyed. A cursor is signed and bound to the approved input digest; edited, stale, cross-snapshot, or out-of-range cursors fail before adapter access.

The mode result is minimized relative to the source rows: it contains counts, opaque partition evidence, cursor state, operation evidence, and rollback metadata, but no projected rows, raw keys, or private partition values. Counts and resource history can still be sensitive operational evidence, so keep results private and out of Git. `createMigrationPlan` is intentionally lower-level and returns private in-memory rows for an executor; avoid it unless building a reviewed private operator wrapper.

## Fixed-target runtime boundary

`parsePrivateTargetBinding` accepts only a JSON string with this shape. Values shown in angle brackets are private runtime inputs and must never be committed, printed, attached to a pull request, or placed in a generated plan:

```json
{
  "schemaVersion": 1,
  "target": {
    "organizationId": "<private organization binding>",
    "projectId": "<private project binding>",
    "environment": "Development"
  },
  "approval": {
    "migrationId": "<exact approved migration ID>",
    "captureId": "<exact private capture ID>",
    "capturedAt": "<canonical UTC capture timestamp with milliseconds>",
    "expiresAt": "<canonical UTC expiry no more than 15 minutes after capture>",
    "inputDigest": "sha256:<exact approved digest>",
    "mode": "<apply or reconcile>"
  },
  "resources": [{
    "resourceId": "<contract resource ID>",
    "targetTable": "<exact target API name>",
    "keyColumn": "<exact unique key API name>",
    "columns": ["<every and only projected target column>"],
    "uniqueConstraintEvidence": {
      "capturedAt": "<same exact UTC capture timestamp>",
      "metadataSha256": "sha256:<digest of independently captured unique-constraint metadata>"
    }
  }],
  "quarantine": {
    "table": "<separate private quarantine table API name>",
    "conflictIdColumn": "<unique conflict key column>",
    "inputDigestColumn": "<input digest column>",
    "reasonColumn": "<reason column>",
    "evidenceColumn": "<sanitized evidence JSON column>",
    "idempotencyColumn": "<operation digest column>",
    "uniqueConstraintEvidence": {
      "capturedAt": "<same exact UTC capture timestamp>",
      "metadataSha256": "sha256:<digest of independently captured unique-constraint metadata>"
    }
  },
  "zcql": { "parser": "V2", "pageSize": 2, "maxPages": 1 },
  "operationTimeoutMs": 5000
}
```

The private transport is an injected implementation boundary, not a caller-selectable target:

```js
{
  audit: {
    capabilities: {
      fixedTarget: true,
      identityReadback: true,
      independentReadback: true,
      constraintReadback: true,
      readOnly: true,
      zcqlV2: true
    },
    async readIdentity() {},
    async readUniqueConstraint({ target, table, keyColumn }) {},
    async executeZcql({ target, parser, statement, pagination }) {}
  },
  changes: {
    capabilities: {
      fixedTarget: true,
      identityReadback: true,
      datastoreInsert: true
    },
    async readIdentity() {},
    async insertRow({ target, table, row, approval }) {}
  }
}
```

`readIdentity` must read the plane's actual authenticated target; it must not echo caller input. `readUniqueConstraint` must independently return the exact current table, key column, uniqueness state, and metadata digest before the changes plane is touched. The audit and changes objects must be distinct. The changes plane is required only for explicit `apply`; `reconcile` accepts only the audit plane. The adapter generates all reads, validates all inserted columns and values against the approved projection, and ignores write responses as evidence. Production, browser automation, direct cleanup, caller-provided ZCQL, unbounded pagination, and automatic write retries remain outside this package.

The supported public composition path is `executeFixedTargetMigration`. `createFixedTargetMigrationAdapter` and the lower-level arbitrary-adapter executor are not exported from the package root, package subpath imports are blocked, and only relative-path internal tests exercise those seams. `computePrivateTargetBindingDigest` exists only so a separate private approval process can record the exact digest; execution must receive that independently approved value rather than treating an execution-time digest as approval.

## Required private run evidence

Before any future apply, privately preserve fresh metadata, permissions, source and target counts, the exact contract, approved input digest, partition digests, dry-run summary, every conflict, fixed-target binding digest, transport revision, mutation approval, rollback owner, and recovery window. Independently capture the exact unique-constraint metadata for every target key and the quarantine conflict key, bind each metadata digest to the approved capture timestamp, and require the audit plane to read back the same current metadata before any write. Create separate mode-bound target bindings and approval digests for `apply` and `reconcile`; neither approval can be replayed across modes or redirected to a different target. Each invocation must begin inside its binding's maximum 15-minute approval window. If that window expires between batches, stop, recapture source and target prestate, recompute and separately approve both digests, and restart from `cursor: null`; the fresh target snapshot makes previously converged rows `already_present`. Implement and test the two private transport planes against the exact authorized Catalyst tools or SDK contracts; this repository does not provide them. After apply, run reconciliation from the beginning with the same immutable input. Preserve every legacy table, row, route, function, Job Pool, and binding until all batches independently match and a separate retirement packet is reviewed. Repository tests are not live migration evidence.

## Verification

```powershell
cd src/zoho-catalyst/revenue-desk-call-runtime/migration
npm run ci
```
