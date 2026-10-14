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

## Provider-facing size and predicate budgets

The adapter and provider fixture accept at most 10,000 UTF-16 code units in a
serialized checkpoint, matching a conservative interpretation of Catalyst's
documented [10,000-character TEXT limit](https://docs.catalyst.zoho.com/en/cloud-scale/help/data-store/columns/).
The adapter checks primitive string type, size and revision **before write
dispatch**. It never truncates, normalizes or coerces a checkpoint. Seed and audit
response validation use the same limit. The generic journal's 32,768-code-unit
limit remains unchanged. An adapter rejection can still cause the controller's
existing independent readback, but cannot increment the fixture's write counter.

Each write derives five closed logical equality conditions: the four fixed
target fields plus the expected shared revision. Additional target fields are
rejected; a caller cannot provide queries, predicate counts or substitute a
condition for the revision fence. The derived write request enforces Catalyst's
documented [five-condition budget](https://docs.catalyst.zoho.com/en/cloud-scale/help/zcql/where/).
This is a synthetic budget, not a Catalyst query implementation: a future adapter
must distinguish authenticated routing from stored predicates and count any
physical `ROWID` condition too. Neither budget proves query-byte limits, provider
Unicode handling, conditional-write atomicity or durability. Sources reviewed
2026-10-14; no provider access or schema change was performed.

## Verification and remaining provider proof

The SDK regression requires the gateway's existing locked dependencies. CI
installs them before migration tests; the canonical offline Quick verifier uses
the existing installation. For a standalone run, install them first:

```powershell
npm ci --ignore-scripts --no-audit --no-fund --prefix src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_call_gateway
```

```powershell
node --test src/zoho-catalyst/revenue-desk-call-runtime/migration/test/rotation-provider.test.js src/zoho-catalyst/revenue-desk-call-runtime/migration/test/rotation-sdk-transport.test.js
npm.cmd run ci --prefix src/zoho-catalyst/revenue-desk-call-runtime/migration
```

`rotation-sdk-transport.test.js` evaluates the installed, pinned
`zcatalyst-sdk-node@3.4.0` source and existing gateway timeout wrapper with inert
HTTP transports, synthetic environment values and a manually fired deadline.
Unknown imports fail closed; there are no sockets, provider calls or credential
acquisition. It demonstrates three default JSON insert attempts, an SDK retry
and late completion after the outer caller has timed out, and a string `"0"`
retry override exceeding the default attempt limit. It characterizes an existing
hazard, not a fix or proof of a provider commit. Dependency upgrades must revisit
these assertions. A future adapter must control dispatch/retry behavior and
reconcile late outcomes; a caller timeout cannot prove cancellation.

The journal tests establish behavior only for synchronous synthetic adapters.
Neither suite establishes real network cancellation semantics, parallel process safety,
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
