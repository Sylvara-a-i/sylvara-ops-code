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

Still unproven: each exact provider/account/calendar object, its owner, sharing
membership and effective read permission of the proposed collector. The Apple
allowlist and the separately authorized Google Family Free requirement are
different source sets. An Apple family calendar is not the Google Family object.
Keep the exact approved labels and object mapping in the private execution packet;
never infer identity, authorization or provider from a display name. Inventory
hidden, shared and subscribed calendars to establish identity, but include only
explicitly authorized objects in the blocking plan. Apple displaying calendars
together does not prove that Google or the collector can read them.

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

## First isolated Bookings availability test

This is a prepared native procedure, **not an executed test or write approval**.
The planner has no provider adapter. Do not improvise one from a browser session,
public feed, inferred API payload or successful offline result. Source collection,
owned projection writes/readback and Bookings availability reads must first have
qualified contracts. An unavailable source remains held; never substitute an
empty successful snapshot or clear its checkpoint to get a baseline.

### Scope and admission

1. Bind the private packet to the source revision, actual integration identity,
   exact source objects, private Google destination, Bookings staff/service and
   saved conflict selections. Four approved Apple sources and the separate Google
   Family source require independent results. Other visible calendars are not
   implicitly authorized. Keep personal Google visibility evidence separate from
   permission to use it as an additional blocking source.
2. Prove metadata enumeration and an authorized minimal event read as the
   **collector**, separately from owner/client visibility. For Free/private
   intervals, read only identity, status, availability, interval and recurrence
   fields needed for normalization. A free/busy response is insufficient to prove
   that a Free event was collected. Missing fields or masked intervals hold.
3. Obtain separate authorization for exactly one attendee-free, private synthetic
   fixture per unproved source, processed serially. The approval must bind actual
   source/destination IDs, test window, write operations, expiry, cleanup and
   notification suppression. Do not modify an existing source event. If private
   visibility or suppression cannot be guaranteed, do not create the fixture.
4. Confirm the test cannot affect prospect/customer availability: use an already
   isolated staff/service or an explicitly approved contained window. Read both
   the staff and public booking surfaces without submitting a booking. If the
   chosen service is live and no isolation boundary exists, hold; do not change
   Bookings or create another service to make the test possible.
5. Capture current duration, buffers, timezone, scheduling increments, lead-time
   rules and complete offered slots for the same fixed UTC window on both
   surfaces. Keep that window sufficiently in the future that notice thresholds
   cannot cross it during the approved test. Approve the maximum propagation
   wait and freshness limits in advance; elapsed time is never success.

### Baseline -> block -> restore, once per source

Let `B_staff` and `B_public` be each surface's baseline offered UTC starts. They
must agree for the same staff/service and window; otherwise hold. Choose a shared
offered start `s`, observed duration `d`, buffers `b_before`/`b_after`, and fixture
interval `F = [s, s + d)`. For each surface calculate:

```text
affected(B) = { t in B : t - b_before < F.end
                        and F.start < t + d + b_after }
expected_blocked(B) = B minus affected(B)
expected_restored(B) = B
```

The affected set must be nonempty. Include neighboring starts in the readback
window to detect excess blocking and buffer errors. Compute the entire expected
set from observed rules; do not accept a single vanished slot as proof.

| Phase | Exact action and readback | Acceptance |
| --- | --- | --- |
| Baseline | Fresh complete source, destination and checkpoint reads; then staff and public slot reads. Save the destination's existing IDs/version digests privately, including unrelated overlapping events. Run the planner without dispatching writes. | Baseline plan is `ready` with zero operations; no prior fixture/projection for this run; the chosen interval is offered on both surfaces. Existing source holds, repairs or unrelated conflicts stop admission. |
| Block | After scoped approval, create one new private source fixture with zero attendees, no reminders/invitations and suppressed notifications. Use Free for the separate Google Family case and for a source whose Free visibility is unproved. Record the returned exact fixture identity privately. Read the direct source, collector snapshot, planned operation, destination projection, then both slot surfaces. | Before dispatch, the entire plan contains only one upsert for this fixture's derived owned projection, and its ID is absent from baseline. After dispatch, exactly that private Busy projection exists with zero attendees and no copied source details; each surface equals its own `expected_blocked(B)`. Every pre-existing source and unrelated destination event remains unchanged. |
| Restore | Remove only the fixture whose returned identity, version and ownership match the private receipt. Obtain a fresh complete source snapshot and plan without writes. Dispatch only after the entire plan is exactly one deletion of the recorded fixture-owned projection. Read the exact projection and both slot surfaces again. | Fixture and its projection are absent; each surface equals its own baseline. Every unrelated event and booking survives unchanged. A second reconciliation proposes zero operations. |

Keep the plan binding and complete source set unchanged across all three phases.
Revalidate freshness and the exact source/destination versions immediately before
dispatch. Hold the whole test if the planner proposes any unrelated repair,
deletion or additional projection, or if readback differs outside the fixture.
Never filter a broader plan into a supposedly safe subset. The provider adapter
must enforce version/ownership preconditions; a post-write preservation check
does not make an unguarded write safe.

Record actual source-change, upstream-read, collector-read, projection-readback
and staff/public observation times for both block and restore. Stop at the
approved deadline on disagreement or incomplete evidence. Treat a write timeout
as unknown: inspect the exact recorded identity before any retry. Never delete
by title, date range or whole-calendar selection, and never remove a projection
solely because a source failed to read. If the fixture is gone but cleanup cannot
be proven, retain the block and checkpoint, stop the isolated test, and reconcile
under the same ownership boundary. Do not hide the uncertainty by restoring an
old whole-calendar snapshot.

Run the next source only after exact restoration and a fresh baseline. A source
that passes Busy but not Free/private visibility remains held for strict blocking.
Retain only aliases, observation times, counts, availability-set comparisons and
preservation verdicts in the sanitized receipt. Keep IDs, version digests and
minimal interval evidence private; omit titles, notes, attendees and event bodies.

### Appointment lifecycle remains separate

For this availability test the notification owner is **none**: no booking,
appointment move/cancel or message is admitted. For a later appointment lifecycle
test, the single proposed notification owner is **native Zoho Bookings**; the
adapter must never send an additional email, invitation or cancellation.

The required order is: observe conflict -> keep the confirmed appointment and
ordinary source event unchanged -> record an explicit host change proposal ->
obtain customer acceptance of an exact replacement -> re-read current appointment
version and offered availability -> perform one separately authorized native
Bookings transition -> independently read back that appointment and verify one
attributable native notice. Host cancellation has its own explicit authorization
and must not be inferred from a missing source event. An ambiguous transition or
notice is reconciled before any retry. If native Bookings cannot prove pending
proposal state, acceptance-before-confirmation and one notice owner, lifecycle
automation remains held and host actions stay in native Bookings. This order is
a qualification requirement, not a claim that those provider semantics passed.

The existing recurrence, cancellation, stale/incomplete snapshot and durable
checkpoint tests remain the offline evidence. The overlap lifecycle regression
additionally removes one of two independently owned overlapping projections,
proves the other and unrelated destination records remain unchanged, then removes
the last owned projection and proves exact baseline restoration plus no-op replay.

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
