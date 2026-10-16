# Route B booking lineage consistency contract

Status: **Offline implementation only; provider wiring and live acceptance remain unresolved.**

[`validators/booking_lineage.py`](validators/booking_lineage.py) compares normalized
private evidence for the website intake and its setup appointment. CRM remains
the relationship owner, Forms remains the sole public intake writer, and the
conditional design retains native Bookings creation of the CRM Event. This pure
validator performs no I/O or mutation and is not connected to a route, function,
form, booking link, or shared Form 2. It is not a provider adapter.

The existing [entry-route holds](entry-routes.md) remain in force. Native email,
phone or name matching cannot establish original-intake ownership. A custom
value copied onto an Event cannot repair an unsafe earlier customer write.
The current Form 1 `public_unbound` acknowledgment does not resolve the original
Lead. Its callback `submissionId` must not be assumed to equal the native Forms
`RandomId` mapped into CRM `Intake_Submission_ID`.

## Calling boundary

`evaluate_booking_lineage(evidence, expected, *, now)` checks consistency only.
A future qualified server-side caller must supply `expected` separately from
the readbacks. Neither argument is a public request contract. The function does
not authenticate a caller, signature, webhook, response, evidence reference or
digest. Matching values are not proof that a source is trustworthy.

These are normalized internal records, not Zoho API payloads or verified tenant
field names. A future adapter must independently authenticate and qualify each
source before normalizing it. Preserve exact IDs in private memory and evidence
only; never log the inputs or candidate.

| Input | Required meaning |
| --- | --- |
| Expected scope and original chain | Development organization, workspace, service and staff; original Forms entry, intake, Lead and journey |
| Expected booking binding | Same scope and original chain already bound to one exact booking by an independently established requester/delivery mechanism; original carrier digest and retained evidence references |
| Expected Event join and calendar | Qualified normalized relationship targets, booking-identity metadata reference, exact calendar destination and reader provenance references |
| Intake readback | Independently resolved entry/intake/Lead/journey; public acknowledgment and customer similarity cannot substitute |
| Delivery and appointment | Lifecycle delivery identity/revision plus current authoritative booking identity, scope, carrier, lifecycle and chronology |
| Event search and exact Event | Complete exact-booking search with exactly one Event, followed by an independent read of that exact Event and its relationships |
| Original Lead and conversion | Exact original Lead/intake; if converted, native conversion targets plus exact current Account/Contact/Deal edges and journey |
| Calendar readback | Exact destination/event identity and lifecycle consistent with the booking and native Event |
| Optional previous association | Previously retained immutable association, supplied only for drift and lifecycle comparison |

Normalized reads include their outcome, observation time and provenance reference.
Missing, incomplete, stale, future, inaccessible or inconsistent evidence is
held. Unknown fields and malformed shapes are rejected; raw customer payloads
and contact details are outside the contract.

The combined inputs are bounded before schema comparison: 128 KiB encoded data,
depth 16, 4,096 values, 64 entries per container and 4 KiB per string. Freshness
must be explicitly selected between 1 and 900 seconds. These are local contract
limits, not provider limits. Caller transport and parsing must be bounded before
constructing the input objects.

A carrier digest is only a consistency check. Even a signed or copied carrier
cannot establish which requester owns the booking. The independent binding must
agree on the exact booking and original chain; an editable booking field cannot
supply that binding.

## Results and lifecycle

Results are `held` with a constant reason code, or `consistent_candidate` with a
bounded association candidate. Every result reports `persisted: false` and
denies downstream, live, storage, setup and activation authority. Every candidate
retains unresolved live prerequisites. It is neither an accepted association nor
permission to write.

The original Lead remains the identity anchor after native conversion. Current
mutable Deal links cannot replace its native conversion targets. An unconverted
Lead may produce a candidate with conversion pending, without setup eligibility.
Shared Form 2 retains its independent eligibility, verification and lineage checks.

Current authoritative readback controls duplicate or out-of-order signals.
The normalized delivery `occurred_at` means the lifecycle change time, not the
notification receipt or emission time, and cannot postdate the authoritative
booking update. A future adapter must qualify that meaning before using the
contract. Equivalent accepted UTC timestamp spellings describe the same instant.
Replay comparison preserves booking, original intake, carrier, Event,
relationship and calendar identities. Reschedule or cancellation does not create
a new association. A prior canceled booking cannot return to an active state;
identity drift, conflicting revisions and regressed evidence are held. Even
conversion-related Event reparenting requires a separately qualified explicit
lineage transition rather than overwriting prior evidence.

This module does not enforce durable uniqueness, reserve an operation, consume an
approval, fence concurrent writers or implement a store. The storage owner must
separately specify atomic booking association, conflict rejection and retention
after ambiguous outcomes. Passing this function cannot bypass that boundary.

## Wiring choices still required

1. Prove a supported way to contain **both** native Bookings customer creation
   and updates while retaining native Events. Otherwise return an architecture
   decision; do not toggle global settings or add a replacement CRM writer.
2. Qualify the Forms entry-to-intake-to-Lead join before issuing a scheduling
   carrier. Select trusted delivery, requester-to-exact-booking anti-substitution,
   lifetime, revocation and replay rules. Existing assisted handles are
   purpose-bound and cannot become booking credentials.
3. Specify authenticated lifecycle delivery and independent appointment reads,
   actual provider status/revision/time semantics, least-privilege access and
   bounded reconciliation. No endpoint or credential is configured here.
4. Qualify actual Event metadata: native booking-identity field, complete search,
   exact-ID readback, relationships and conversion behavior. No `BookingId`,
   `Who_Id` or `What_Id` mapping is guessed.
5. Establish exact calendar identity, lifecycle mapping and one invitation owner;
   preserve unrelated services and existing connections.
6. Have the storage owner specify atomic uniqueness, concurrency, retained
   evidence and permitted replacement transitions. This work neither accesses
   nor changes an operational storage workspace or ledger.
7. Separately authorize provider acceptance with bounded effects after these
   gates are evidenced. Route A remains independent of scheduling; public intake
   and existing release holds remain unchanged.

## Validation and rollback

Synthetic regressions are in
[`tests/test_booking_lineage.py`](tests/test_booking_lineage.py). Existing CRM
unittest discovery includes them in the canonical verifier without a function,
package, dependency, schema field or CI change:

```text
python -m unittest discover -s src/zoho-crm/free-revenue-leak-test/tests -p test_booking_lineage.py -v
```

Tests cover comparison rules, collisions, transplantation, ambiguous joins,
lifecycle replay and drift. They cannot prove tenant behavior, authentication,
native customer-write containment or durable idempotence. Source rollback removes
this unused offline validator and its tests/documentation; no deployed behavior
changes.
