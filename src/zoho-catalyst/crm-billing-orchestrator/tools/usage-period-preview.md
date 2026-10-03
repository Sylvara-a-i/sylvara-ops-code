# Paid usage preview preparation

This is a separate version 1.0 readiness proposal, not part of the 0.5 free-test
runtime. Nothing imports the preview tool from an executable route. No Billing,
Books, CRM, Retell, storage, network or customer effect is available in this tool.
No deployment, acceptance migration or merge is authorized by this document.

## Existing source and smallest gap

The commercial source of truth is `docs/product/README.md`: $0.40 per connected
AI minute for Launch/Growth/Scale, with no bundled minutes. It explicitly requires
the exact minute definition, rounding, exclusions, corrections and dispute rules
before invoicing. Commercial approval is not provider/runtime acceptance.

The existing `lib/commercial-terms.js` terms-v1 digest binds currency, recurring
interval, connected-minute price, management prices and setup prices. The paid
operation fingerprint retains that acceptance identifier and meter/catalog
evidence. It does not bind an accepted usage-policy version. That existing digest,
paid request shape and paid-preparation route are unchanged by this proposal.

The call runtime validates provider `duration_ms` into canonical `durationMs`.
That is duration evidence, not a qualified commercial connected-time definition.
There is no qualified paid billing-period ledger or complete authoritative
subscription-to-call reader in this proposal. A caller supplying `complete=true`
or a snapshot digest does not prove completeness, identity, freshness or consent.

The smallest implemented addition is `preview-usage-period.js`: pure deterministic
arithmetic over an explicitly supplied projection and UTC [start,end) period.
It produces known start-in-period duration, exact-duplicate counts, Unknowns,
conflicts and boundary holds. This classification is descriptive only: it does
not select a commercial attribution rule. Conflicting versions never silently
select the highest version or first value. A corrected authoritative snapshot
must be supplied separately and receives a different preview identity.

The review-version digest binds every policy choice to the validated existing
commercial acceptance version. It is explicitly a REVIEW identity, not accepted
terms or authorization. Missing choices remain null and visible. Even complete
policy prose is not implemented, so billable minutes and charge remain null.
No rounding, exclusions, zero-charge conclusion, usage cap or billing acceptance
is inferred from an empty, partial or apparently complete sample.

## Business decisions required

| Choice | Decision Gabriel must approve |
| --- | --- |
| Connected time | Precisely which authoritative interval is chargeable; whether provider duration includes ringing, silence, holds or transferred time; handling disconnect/failure/zero duration |
| Rounding | Per-call versus period aggregation, precision/increment, rounding direction and monetary rounding; any minimum chargeable duration |
| Exclusions | Explicit treatment of free tests, internal QA, spam/wrong number, failed connections, provider/service faults, retries and duplicated legs; required evidence for each exclusion |
| Period attribution | Authoritative subscription cycle/time zone, half-open boundaries, calls crossing boundaries and plan/rate changes; no calendar-month default |
| Late events and corrections | Settlement cutoff, after-close amendments, missing/analyzed-late calls, approved corrections/credits and dispute-safe audit history |
| Usage limits | Explicit no-cap or approved thresholds/caps, notification/admission behavior, overage and contractual limits; no default limit |
| Disputes | Required evidence, dispute window, approval owner and correction process |

These choices belong in accepted customer contract/Billing terms after legal and
finance review. Synthetic policy text in tests is not a recommendation or consent.

## Next source-only work after scope/policy review

1. Implement only approved structured policy rules and exact integer/rational
   arithmetic, with explicit rounding boundary tests. Do not execute arbitrary prose.
2. Define a new acceptance contract binding price terms and the implemented policy
   version. Preserve old terms-v1 and historical fingerprints; determine an explicit
   future migration/admission rule. Do not silently reuse accepted price-only terms.
3. Qualify the authoritative paid subscription/period/call scope reader, complete
   partitions, immutable revision vector, late-event reconciliation and settlement.
4. Only then design a durable per-period ledger/preview. Posting, usage submission,
   invoices, subscriptions, catalog, payments and customer communications remain
   separate future gates with authoritative provider readback and rollback.

The current functions use only built-in Node crypto and the unchanged local
commercial-term validator. Isolated synthetic tests cover missing policy, digest
changes, permutations, deduplication, conflicts/corrections, period edges, unknown
duration, partial source, mixed scopes and malformed inputs. No live access,
dependencies, grants, environment variables or runtime switches are added.
