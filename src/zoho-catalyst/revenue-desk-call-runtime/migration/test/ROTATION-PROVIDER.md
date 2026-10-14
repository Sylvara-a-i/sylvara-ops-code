# Fixed-target synthetic rotation provider contract

`support/rotation-provider-rehearsal.js` extends the [journal rehearsal](ROTATION-JOURNAL.md)
with a sealed, fixed-target adapter contract. It follows the existing migration
boundary's separation of audit and changes planes, but accepts only handles from
an in-memory synthetic fixture. It is not a Catalyst transport or a provider SDK.
No runtime import, package export, deployed behavior or real credential changes.

The missing boundary was between the journal controller and its shared cell.
`rotation-journal-rehearsal.js` now routes read/CAS through either its original
fixture or this sealed adapter. Its rollout validator, intent ordering, failed
holds, exact readback, recovery and terminal-state rules remain the single
implementation used by both paths.

## Contract under rehearsal

- A journal is bound once to an exact synthetic organization, project,
  environment and journal identity. Binding data is copied and frozen; an
  operation cannot supply a replacement target or query.
- Audit and changes handles are distinct, module-issued objects backed by the
  same surviving authority. Identical target labels on two separate stores do
  not make their revision fences interchangeable. Plain capability claims,
  copied handles, getters and proxies cannot supply a transport.
- Every independent audit read returns its actual synthetic target plus one
  bounded revision/checkpoint envelope. The adapter validates the exact target
  and plain data shape before the controller decodes the plan-bound checkpoint.
  Missing, malformed, foreign-target and unavailable responses leave a hold.
- CAS checks the bound target and shared revision in the same synthetic atomic
  operation, then stores the exact candidate checkpoint and next revision.
  A target read performed only before the mutation would leave a retarget race.
  The fixture exposes that race without granting an operation a redirect option.
- A write response is never checkpoint evidence. Lost, malformed or
  success-shaped dropped-write responses require the same separate exact
  target/revision/bytes readback. A conflict stops the writer; no automatic
  rebase, retry, target repair or initialization occurs.
- A restart creates new handles, adapter and controller against the **same**
  provider fixture. The old writer can still exist. The controller receives only
  serialized journal data, and the provider retains the one shared CAS fence.
  Copying a snapshot into a second store would fork that fence and is not this
  restart test.

The fixture provides one-shot read/write faults and a trusted post-commit
scheduler, plus read/attempt/commit counters. These are test controls, not
serialized metadata or controller operations. Assertions on scheduled competing
operations must stay outside callbacks because a callback exception is itself
an ambiguous write response. Controller statuses expose fixed outcomes,
revision/phase and `liveAuthority: false`; they do not expose target labels,
checkpoints, transport responses or exception text.

## Verification and remaining provider proof

```powershell
node --test src/zoho-catalyst/revenue-desk-call-runtime/migration/test/rotation-provider.test.js
npm.cmd run ci --prefix src/zoho-catalyst/revenue-desk-call-runtime/migration
```

These tests establish behavior only for synchronous synthetic adapters. They do
not establish network timeout/cancellation semantics, parallel process safety,
host-loss durability, authenticated identity/readback, actual conditional-write
capability, non-exportable custody, grant separation or operational rotation.
WeakMap branding proves fixture provenance within this process, not provider
authentication. Real audit/write implementations must independently prove that
they address the same durable authority and enforce target plus revision at the
mutation boundary, including changes during delayed operations.

A coherent stale snapshot can still be accepted by a fresh controller that has
no external freshness anchor; an exact historical readback is not proof of
latestness. Subsequent writes remain fenced by the surviving synthetic authority.
Replacement or rollback of that authority itself is not covered.

No provider client, grants, secrets, live rotation, deployment, storage-v0.5 or
portal changes are included. Actual credential rotation remains a separate
workflow governed by the existing approval, containment and readback gates.
