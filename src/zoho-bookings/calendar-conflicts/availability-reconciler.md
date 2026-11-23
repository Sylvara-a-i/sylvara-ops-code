# Offline calendar availability reconciler v1.0

Implemented and tested with synthetic fixtures only, November 23, 2026.
Apple remains the daily interface; Google is the **proposed** Busy transport;
Bookings remains the appointment and offered-availability authority. This is
offline source preparation, not an adopted bridge, provider adapter or deployment.

`availability_reconciler.py` adds a deterministic planner and a local SQLite
destination simulator beside the existing conflict checker. It never reads or
writes a provider, changes an original event, moves/cancels an appointment,
sends invitations, selects calendars, changes Bookings or buys a bridge.

## Behavior

- The separately supplied plan authorizes exact account/calendar aliases and
  one destination over a fixed UTC horizon of at most 31 days. Every authorized
  source must be present exactly once; extra sources hold the whole run. The
  destination must not also be a source. Aliases must identify exact provider
  objects, not display names; their mapping remains a native qualification task.
- Every confirmed source interval blocks, **including events marked Free**.
  Intervals use `[start,end)` and are clipped to the authorized horizon. Each
  projection contains only `summary: Busy`, `visibility: private`,
  `transparency: opaque`, empty `attendees`, and UTC start/end. The internal
  envelope adds a deterministic ID and an ownership marker with hashed lineage.
  Original titles, attendees, organizer, locations and notes never enter the
  projection or checkpoint. Hashes are correlation keys, not anonymization.
- Source identities include account, calendar, event and original recurrence
  occurrence time. A moved exception keeps its identity. Exact duplicates
  collapse; conflicting duplicates hold. Different real events sharing an
  interval remain independently tracked so deleting one cannot release another.
- Confirmed events, moved exceptions and cancellation tombstones must already be
  normalized into explicit instances. Complete recurrence expansion is required.
  Raw RRULE/ICS masters, mixed master/instance records, floating times and local
  dates are unsupported and held. All-day/DST fixtures use actual UTC boundaries,
  including 23/25-hour days; this module does not invent those boundaries.
- Cancellation or absence from a complete authoritative snapshot removes only
  this reconciler's owned projections. A moved-out exception can release its
  former in-horizon blocker. No appointment is changed. Create/repair operations
  precede duplicate/obsolete projection removal. Foreign destination events are
  preserved; ID collisions and ownership ambiguity hold.
- All source reads must prove full pagination, complete recurrence expansion and
  full window coverage. Both the direct upstream observation and collector read
  must be fresh and correctly ordered; the destination read follows them.
  Incomplete, failed, stale, future, regressed or inconsistent evidence returns
  `held`, no operations and no replacement checkpoint. Existing blockers remain.
  This contains deletion risk but cannot block newly unseen source events.
- Durable watermarks reject older snapshots and changed content with an unchanged
  upstream observation. Replays and reordered equivalent records do not churn.
  The plan's source set, owner, destination, freshness budget and normalized
  horizon cannot change underneath a checkpoint. Owned destination intervals
  outside that horizon hold even without a checkpoint. A rolling horizon or
  scope migration needs a separate reviewed design; clearing state is not a
  supported way to change scope.

## Interfaces and synthetic run

Python 3.12+, standard library only. The complete executable input examples live
in `tests/test_availability_reconciler.py`. All test values are synthetic.

```sh
python3 -m unittest discover -s src/zoho-bookings/calendar-conflicts/tests -v
```

The existing canonical verifier already discovers this directory:

```powershell
pwsh -NoProfile -File ./tools/verify.ps1
```

`reconcile(plan, snapshot, target, state=None, now=...)` returns `ready` or `held`,
a fixed diagnostic, ordered `operations`, and `next_state`. It mutates none of
its arguments. `ready` describes only an offline plan; provider changes,
live coverage qualification and booking authorization flags always remain false.

`run_offline(plan, snapshot, database_path, now=...)` applies the plan to a local
SQLite simulation. It serializes runners with `BEGIN IMMEDIATE` and commits
simulated target events plus checkpoint in one transaction. Interruption commits
both or neither; restarting rereads the stored target instead of blindly replaying
writes. Invalid JSON, schema, checkpoint, database version or binding holds;
an initialized database missing its checkpoint table/row also holds. Deleting,
replacing or restoring the whole database is outside this durability guarantee.
This local transaction does not
solve remote calendar write ambiguity or multi-host coordination.

The CLI accepts a plan JSON file, snapshot JSON file, `--database` and explicit
`--now`. It prints only fixed status/flags and an operation count (exit 0 for
ready, 2 for held). It does not print event times, identifiers, input paths,
projections or exception details. Use a temporary database outside the repository
for synthetic runs. A newly supplied database represents an empty simulated
destination; it is never a way to reset or discover a real destination.

Normalized JSON shapes (unknown fields are rejected):

| Object | Required fields |
| --- | --- |
| Plan | `schema_version: 1`, `reconciler_ref`, `destination_ref`, `sources`, `window`, `freshness_seconds` |
| Plan source | `account_ref`, `calendar_ref` |
| Snapshot | `schema_version: 1`, `sources` |
| Source read | `account_ref`, `calendar_ref`, `status: ok`, `complete: true`, `observed_at`, `upstream_observed_at`, `recurrence_expanded: true`, `window`, `events` |
| Event | `event_ref`, `recurrence_id` (original UTC occurrence start or null for nonrecurring), `status` (confirmed/cancelled), `start`, `end`, `availability` (free/busy); optional `metadata` object ignored after bounds validation |
| Target read | `schema_version: 1`, `destination_ref`, `status: ok`, `complete: true`, `observed_at`, `events` |
| Target event | `id`, `projection` (null for foreign events or the marker below), `body` |
| Ownership marker | `owner_ref`, `source_key`, `event_key` |
| Checkpoint | `schema_version: 1`, `binding`, `window`, `sources`, `reconciled_at` |
| Checkpoint source | `source_key`, `observed_at`, `upstream_observed_at`, `digest` |

Windows contain exactly `start`/`end`. All times are UTC strings ending in `Z`;
equivalent fractional-second spellings normalize to the same instant. Cancelled
events have null `start`/`end`. A moved-out recurring record may fall outside
source coverage only when its original occurrence start is inside that coverage.
An entire cancelled series is represented by per-instance tombstones or absence
of all its instances from a complete fresh snapshot. Conflicting active and
cancelled records for one identity hold; this is not a delta-stream merger.
Collector snapshot resolution must precede reconciliation.

Bounds: 256 sources, 4,096 source records total, 4,096 destination records,
1 MiB/50,000 nodes per input, depth 16, strings up to 4,096 characters. Resulting
target state must fit those bounds too. Exceeding any bound holds, never truncates.
Duplicate JSON keys, non-JSON values and malformed CLI arguments fail closed.
`freshness_seconds` is an explicit synthetic parameter (1–86,400), not a chosen
operating threshold or permission for a day of stale availability.

## Short native proof note: Family, iCloud and freshness

Still unproven: the **exact Family calendar object**, owning iCloud account,
sharing membership and effective read permission of the proposed collector;
complete enumeration/read access for every designated personal, shared,
subscribed and hidden iCloud calendar. Apple displaying these calendars together
does not prove Google can see them. Neither a provider capability nor the word
“Family” establishes the account, object or access path.

With separately authorized synthetic native probes, prove Free events, moved
and cancelled recurrence instances, deletion and all-day/DST intervals reach the
exact proposed private Google Busy destination without attendees or source
metadata, then block/release the exact Bookings staff/service availability,
including duration/buffers. Verify the destination's sharing/ACL and actual
Bookings conflict selection independently of Apple display selection.

Measure **source change → direct upstream observation → collector read → Google
readback → Bookings block/release**, recording each timestamp and worst observed
delay. Repeat with Apple devices offline, revoked source access, interrupted
collection and restarted reconciliation. Establish and approve an operating
freshness threshold, detection interval and failure response for every Family/
iCloud source. A fresh Google read does not establish fresh upstream coverage.
No native visibility, latency or end-to-end availability claim is made here.

## Boundary and containment

The supplied completion flags, timestamps and ownership markers are assertions;
this offline implementation cannot authenticate them. Effective provider access,
recurrence expansion, target-ID/marker round-tripping, least privilege, remote
write concurrency/readback, booking-create races and failure response remain
unqualified. No connection, OAuth grant, password, calendar sharing, public feed,
bridge purchase, appointment lifecycle automation or deployment is included.
Keep real evidence outside Git and public logs. To revert this preparation,
remove the new module, its tests/documentation and the local synthetic database;
no provider rollback is required.
