# Offline Bookings calendar conflict comparison

## Status and ownership

Implemented as a dependency-free offline qualification aid on November 10, 2026.
No provider adapter, authentication, runtime integration, deployment, or live
calendar verification is included. Bookings remains the appointment and offered
availability owner. Source providers remain the owners of personal busy time.
This tool neither copies nor changes those records.

The practical question is whether every calendar in the supplied complete source
inventory contributes to a selected conflict calendar and whether any offered
Bookings slot overlaps source busy time, including service duration and buffers.
Seeing calendars together in an app is not evidence of that path.

`calendar_conflicts.py` accepts a separately defined expected plan plus normalized
readbacks. It checks account and calendar completeness, selected destinations,
freshness and observation order, windows, service duration and buffers. It merges
busy intervals and compares the entire protected appointment interval with them.
Overlapping source events count as one conflict per offered slot.

This is a snapshot comparison, not a live safety gate. `consistent_snapshot` is
deliberately weaker than verified availability or permission to create a booking.
Every result retains `provider_access_verified`, `live_coverage_qualified`,
`booking_authorized`, and `provider_changes_made` as false. An empty slot list or a
source with no observed busy interval is inconclusive rather than a pass. That
prevents an empty dataset from appearing to prove all-calendar coverage.

## Current integration requirements (2026-11-10)

Native integration is preferred when it meets the complete requirement. No
operational calendar bridge has been selected. Apple Calendar may remain the
primary operator client, but displaying accounts together is not synchronization
or proof that Bookings checks every designated conflict source.

Every designated source must be covered. A designated strict-blocking calendar
must block appointments even for events marked Free. This policy requires a
qualified collector/normalizer; this checker only sees supplied intervals and
cannot infer or enforce the provider's Free/Busy policy.

Host-initiated movement or cancellation must produce a neutral host-side apology
and ask the prospect to choose or accept a replacement time before a new time is
confirmed. Do not automatically confirm the host's proposed time, misattribute the
change to the customer, or disclose private conflict details. Qualify pending
change state, original-slot treatment, prospect acceptance, duplicate notice
prevention, template fields, sender identity, and time zones separately.

A bounded self-only native test observed Bookings-originated updates reaching a
connected calendar and email. External calendar movement/deletion did not update
the authoritative appointment within the observed windows; Apple-client behavior
remains untested. This does not establish universal provider behavior. Qualify
both directions and each lifecycle transition before selecting an integration.
Native notice behavior still needs host attribution, acceptance, time-zone, and
template-field corrections. See the [current delivery checkpoint](../../../docs/runbooks/revenue-desk-current-state.md#calendar-decisions-and-acceptance-gates).

## Run

Python 3.12 or newer; standard library only. No installation is needed.

```sh
python3 -m unittest discover -s src/zoho-bookings/calendar-conflicts/tests -v
python3 src/zoho-bookings/calendar-conflicts/calendar_conflicts.py \
  /private/expected-plan.json /private/normalized-readbacks.json \
  --now 2026-11-10T12:00:00Z
```

The command writes one sanitized JSON result to stdout. Exit 0 means only
`consistent_snapshot`; exit 2 means incomplete/invalid evidence or an observed
conflict. Input file paths, identifiers, event times and source values are not
echoed. Missing/unreadable files and malformed JSON produce fixed diagnostics.
Invalid command-line arguments produce only a fixed `invalid_arguments` JSON
result with exit 2, without usage output or argument values. `--help` uses a fixed
program name rather than a local script path.
Keep real inputs outside Git, CI, public artifacts, and shared logs. All account
and calendar references below are opaque private aliases, not email addresses,
event titles, credential-bearing URLs, or provider secrets.

The canonical repository verifier includes this suite:

```powershell
pwsh -NoProfile -File ./tools/verify.ps1
```

## Exact normalized input contract

Unknown fields and non-JSON values are rejected. JSON duplicate keys are rejected
by the CLI. The complete executable synthetic example is `fixture()` in
`tests/test_calendar_conflicts.py`; it includes one iCloud source mapped to a
Google conflict destination and a separate Google source. It is not provider
configuration or evidence of an adopted bridge.

Expected plan fields:

- `schema_version`: integer 1.
- `scope`: exactly `environment`, `organization_ref`, `workspace_ref`,
  `service_ref`, `staff_ref`.
- `account_refs`: unique nonempty list of all accounts required for this check.
- `freshness_seconds`: explicit integer from 1 to 86,400. This is an input
  validation bound, not a chosen operating policy or permission to tolerate a
  day of stale availability. Agree on the real threshold separately.
- `window`: exactly `start` and `end`, defining the whole interval in which
  appointments must fit. It must be positive and at most 31 days.
- `duration_seconds`: positive integer up to 86,400.
- `buffers`: exactly `before_seconds` and `after_seconds`, nonnegative integers
  up to 86,400. Values must come from the observed service contract.

Evidence fields:

- `schema_version`: integer 1.
- `scope`: the same exact scope as the plan.
- `inventory`: exactly `status`, `observed_at`, `complete`, `accounts`.
  Each account has exactly `account_ref`, `complete`, `calendar_refs`.
  Account coverage must match the plan, each account must contain at least one
  calendar, and all completion flags must be the boolean true.
- `calendar_reads`: one entry for each `(account_ref, calendar_ref)` in the
  inventory, with no missing or duplicate entries. Each has exactly
  `account_ref`, `calendar_ref`, `conflict_target_ref`, `status`, `observed_at`,
  `complete`, `window`, `busy`. The window must cover the plan window expanded
  by the before/after buffers. Each busy interval has exactly `start` and `end`.
  It may cross a window boundary but must intersect the expanded window.
- `bookings`: exactly `status`, `observed_at`, `complete`, `window`,
  `duration_seconds`, `buffers`, `selected_calendar_refs`, `slots`.
  Window, duration and buffers must match the plan. Every source's verified
  conflict target must appear in `selected_calendar_refs`. Several sources may
  map to the same destination. `slots` contains unique normalized UTC start
  timestamps; the entire appointment must fit inside the plan window.

Every status must be `ok`. `complete` means successful full pagination and full
range coverage, not merely a successful first page. Inventory must be observed
no later than the source reads, which must precede or equal the Bookings read.
All observation timestamps must fall between `now - freshness_seconds` and
`now`. Equivalent UTC timestamp spellings compare as instants. Timestamp strings
must end in `Z`; local/naive/offset timestamps must first be normalized correctly.

Intervals use `[start,end)` semantics. A slot starting at an event's end is not
blocked by that event unless the before-buffer overlaps it. All-day events and
recurrence instances must already be expanded to real UTC intervals. A local
all-day event spanning a DST change can last 23 or 25 hours; never manufacture
UTC intervals by assuming every local day is 24 hours.

Limits: 256 total calendars, 4,096 total busy intervals, 4,096 offered slots,
1 MiB per input, 50,000 JSON nodes, depth 16, and 4,096 characters per string.
Inputs over a bound are held, never truncated. Duplicate event intervals are
harmless and merged; duplicate calendar identities or slot starts are rejected.

## Collection and acceptance still required

These inputs are assertions, not authenticated evidence. The checker cannot
detect a collector falsely claiming completeness, mapping the wrong account,
omitting a calendar, or fabricating source values. Provider collection must be
qualified independently before this tool is used to review live observations.

1. Identify the required iCloud and Gmail accounts and inventory every calendar,
   including hidden, shared and subscribed calendars. Do not confuse UI display
   selection, a provider's free/busy selection, Bookings conflict selection and
   the appointment destination.
2. Verify the complete source-to-conflict-destination mapping and effective
   access. A fresh destination or a healthy Google connection does not prove a
   fresh upstream iCloud feed. Read source busy time from the source itself.
3. Normalize provider-confirmed intervals under the approved per-source blocking
   policy, including Free events on designated strict-blocking sources. Qualify
   recurring exceptions, deleted/moved events, RSVP behavior, and all-day/DST
   semantics rather than inferring them. Expand recurrence over the complete
   covered window. Never silently treat a read failure as an empty calendar.
4. Obtain Bookings slots for the exact staff/service/window, retaining private
   raw evidence separately. Its documented API response depends on the chosen
   time format and supplies a timezone; bare clock strings are not UTC.
5. With separately authorized test events, compare positive busy probes and
   release behavior on every source after creation, move and deletion. A finite
   snapshot does not prove ongoing freshness or all lifecycle transitions.
6. Qualify upstream revocation, staleness detection, the chosen failure response,
   and appointment-create races. This tool does not pause booking pages, enforce
   a fail-closed runtime, reserve slots, prevent concurrent writes, reschedule or
   cancel appointments, or control invitations.

No new connection, OAuth grant, app-specific password, public feed, calendar
sharing, provider migration, subscription, test invitation, or publication is
authorized by this code. Do not wire it into a live booking decision as-is.

## Sources and current access boundary

Official product documentation was checked November 10, 2026. It describes
capability, not effective account access:

- [Zoho calendar selection and event sync](https://help.zoho.com/portal/en/kb/bookings-2-0/integrations/calendars/articles/connect-your-calendars)
- [Bookings availability API](https://www.zoho.com/bookings/help/api/v1/fetch-availability.html)
- [Bookings authentication and scopes](https://www.zoho.com/bookings/help/api/v1/oauthauthentication.html)
- [Zoho Calendar inventory](https://www.zoho.com/calendar/help/api/get-calendar-list.html)

Bookings documents event-name collection, so connecting a personal calendar is
not inherently a busy-only disclosure. Its published OAuth scope is broad even
for read APIs. Neither a new grant nor a provider bridge has been established by
this work. Selecting an operational route remains a separate decision.

## Containment and rollback

The module has no network, provider-write, scheduling, or credential capability.
Remove the module and its verifier invocation to revert this private preparation.
Nothing in this change alters the existing booking-lineage checker or any
deployed source. A successful test run is not a deployment, sync, or launch claim.
