# Synthetic rotation journal rehearsal

`support/rotation-journal-rehearsal.js` adds fresh-controller reconstruction to
the offline report-header rehearsal. It is confined to tests and is not exported
by the migration package or imported by a runtime function. The older
`rotation-recovery-rehearsal.js` retains its explicitly in-memory restart latch.

The synthetic journal stores a serialized, plan-bound checkpoint: the complete
accepted evidence prefix, an optional next-phase intent and its recovery hold,
and a shared revision. Every controller reconstructs from that serialization;
it receives no previous controller state. Reconstruction replays each accepted
entry through `rotation-rollout-model.js`, which remains the sole evidence
validator for containment, receiver-before-sender ordering, readiness,
disablement and separate retirement.

The controller sequence is:

1. `begin({ phase, epoch })` records the next intent using compare-and-swap.
2. `acknowledge(evidence)` accepts a complete synthetic acknowledgement only
   after that intent has been independently read back.
3. `observe({ phase, epoch, outcome })` records a failed or ambiguous attempt.
4. A fresh `createJournalController(plan, journal)` replays the prefix and holds
   every outstanding intent. Only `reconcile(evidence)` can complete a held
   intent, using the same exact rollout evidence rules.

Every write is followed by a separate journal read that must match both the
expected next shared revision and the exact candidate bytes. A success-shaped
write response is insufficient. A lost response can be resolved by that exact
readback; otherwise the controller stops with `readback_required`. `recover()`
reads the journal again without retrying the write. A stale writer never rebases
its supplied evidence or retries. Competing controllers share one revision
fence, distinct from the number of accepted rollout phases.

A crash before an intent commits leaves the accepted prefix unchanged. A crash
after an intent commits leaves a held next phase. A crash after an acknowledgement
commits reconstructs that exact accepted prefix without replaying the operation.
Confirmed failed holds survive new controllers. If a failure observation never
commits, a new controller can recover only the earlier outstanding intent as
ambiguous; the original controller retains its known failed hold. Neither case
allows ordinary acknowledgement. A fully accepted retirement remains terminal.

The fixture supports lost writes, lost responses and unavailable, stale or
corrupt readbacks. Malformed checkpoints, incomplete prefixes, mismatched plans,
epochs or configuration generations fail closed. Metadata inspection is bounded
and does not execute caller proxies, accessors or serialization hooks. Statuses
contain fixed enums, a numeric revision and `liveAuthority: false`, never source
labels, evidence, inputs or exception text. The fixture's `snapshot()` is test
data for reconstruction/corruption cases, not a status or runtime export.

Run from the repository root using its supported Node version:

```powershell
node --test src/zoho-catalyst/revenue-desk-call-runtime/migration/test/rotation-journal.test.js
npm.cmd run ci --prefix src/zoho-catalyst/revenue-desk-call-runtime/migration
```

This proves behavior of invented metadata and an in-memory atomic fixture only.
The journal is not durable across an actual process or host loss. Serialized
snapshot reconstruction does not establish tamper resistance, authenticated
readback, provider atomicity or protection against a coherently replaced journal.
No keys, credentials, provider adapters, operational rotation, rollback to old
material, activation, IAM, protected custody or live security guarantees are
implemented. No deployment or manual provider setup is authorized by these tests.
