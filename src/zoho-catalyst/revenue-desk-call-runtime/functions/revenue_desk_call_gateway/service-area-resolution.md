# City and ZIP evidence foundation

Status: offline prototype, reviewed against repository main on 2026-11-02. This module is not imported by the deployed runtime, exported as a Retell tool, or connected to onboarding. It changes no existing configuration schema, allowlist, caller route, or provider setting. Passing tests do not establish real-call behavior.

The owning system is the call gateway's deterministic qualification layer. The contractor owns approved service coverage; the postal index owns only candidate postal-locality relationships. Neither a language model nor a dataset refresh can approve coverage. Geographic qualification also does not establish service availability, job eligibility, booking, or dispatch authority.

## Integration contract

Import `resolveServiceArea` from `lib/service-area-resolution.js`. It is synchronous, deterministic, and performs no I/O, environment reads, provider calls, writes, or clock reads. Supply plain data and an already-built local index. No full address is required or transmitted.

```js
const result = resolveServiceArea({
  declaration: { cities: ['Kansas City, KS', 'Kansas City, MO'], zips: [] },
  approvedCoverage: {
    status: 'contractor_approved',
    cities: ['Kansas City, KS', 'Kansas City, MO'],
    zips: [],
  },
  policy: { cityMeaning: 'postal_locality' },
  caller: { zip: '66212', addressKind: 'physical' },
  postalIndex, // Optional local index handle; absence is unknown postal evidence.
  asOf: '2026-11-02',
});
// result.status === 'needs_clarification'
// result.clarification includes 'ask_city_and_state'
```

Keep these objects separate in the eventual authenticated integration:

| Input or output | Meaning |
| --- | --- |
| `declaration.cities`, `declaration.zips` | Contractor-declared entries, preserved as separate normalized lists. Either or both may be present. An empty list is not an exclusion rule. |
| `approvedCoverage` | An independently reviewed coverage snapshot. `status: 'contractor_approved'` is a precondition asserted by the integration, not an authentication mechanism. Never construct this from lookup results automatically. |
| `evidence.candidateRelations` | Potential city/ZIP relationships for review and caller clarification. These are never copied into approval or treated as caller-provided geography. |
| `policy` | Explicit client decisions about locality meaning, municipality evidence, and mixed-list semantics. |
| `caller` | Only `city`, `state`, `zip`, and `addressKind` are read. City/state identify the physical service location, not a mailing address or account location. |
| `postalIndex`, `asOf` | An immutable local snapshot handle and an explicit UTC date (`YYYY-MM-DD`). No automatic refresh or current-date default. |

Cities are `"City, ST"` strings or `{ city, state }` objects; states use US two-letter codes. Comparison normalizes case and whitespace without fuzzy matching. A city without state is unresolved. Declared or approved malformed entries require configuration review; caller omissions require clarification. Approved ZIP entries must be five-digit strings, preserving leading zeros. Caller ZIP input additionally accepts `12345-6789`, exactly five spoken digit names, or five space-separated digits. ZIP+4 is reduced to five digits and always reports `extensionValidated: false`. Numbers, ambiguous prose, abbreviated digit words, and malformed input are not guessed.

`addressKind` must explicitly be `physical` before eligibility is returned. `po_box`, missing, or unknown kinds request the physical service location. Postal data cannot establish deliverability, PO Box status, or a physical job site.

## Policy and decision rules

- `cityMeaning` must be `postal_locality` or `municipality` when an approved city rule exists. There is no global default.
- Municipality policy also needs `municipalityEvidence`: `caller_attestation` permits an exact caller-provided city/state to satisfy the city rule with that limited evidence scope; `boundary_required` routes that rule to manual review. The prototype has no authoritative municipal polygon/address adapter and always reports `municipalBoundaryVerified: false`.
- When both approved lists contain entries, `mixedLists` must be `union` or `intersection`. Union can qualify on one explicit approved match even when the other dimension is missing. Intersection requires both matches. Either policy requests missing evidence before rejecting an incomplete comparison. No missing list becomes “exclude all.”
- An explicit caller ZIP on the approved ZIP list can satisfy the ZIP rule without a postal lookup. A city-only caller does not acquire an inferred ZIP even if all visible candidates are approved; ask for the ZIP. A ZIP alone never proves the caller's city, even if the index lists only one place.
- An exact city/state match satisfies only the configured locality or attestation rule. Listed postal aliases and cross-boundary ZIPs cannot prove municipal coverage. Ask for city/state when only a ZIP is supplied against city coverage. When the caller's different place name shares a candidate ZIP with an approved city, clarify the locality instead of silently accepting the alias or rejecting it.
- A nonmatching city identity remains unresolved even when both names have index rows: candidate relationships and aliases are not exhaustive. Known shared ZIPs prompt clarification; unhealthy, missing, or non-overlapping evidence goes to manual review. This includes Kansas City, MO against KS-only approval. Losing one relationship cannot turn clarification into rejection. An exact approved locality or explicitly permitted municipality attestation can still satisfy its city rule without an index when no city/ZIP pair needs verification.
- When both city/state and ZIP are supplied, `postalConsistency` reports `consistent`, `conflict`, or `unknown` separately from coverage evidence. “Conflict” means the pair is absent from that snapshot, not that an address is invalid; missing aliases are possible. Confirm the pair rather than rejecting it. Unknown or stale paired evidence goes to manual review.
- A valid ZIP absent from the index, or a stale, unavailable, timed-out, corrupt, or future-dated snapshot, cannot establish an out-of-area rejection. Independent explicit approved ZIP evidence remains useful when no city/ZIP pair needs verification.

Outputs have four statuses: `eligible`, `ineligible`, `needs_clarification`, and `manual_review`. Fixed reason and clarification codes indicate whether to ask the caller, confirm contractor policy, or route to human review. `ineligible` requires sufficient evidence against explicit approved ZIP rules; this prototype cannot establish a city exclusion from a nonmatching name or missing postal relationship. This conservatively sends more city-only nonmatches to review. Missing caller ZIP evidence is requested before reviewing an unresolved mixed-list comparison. Do not translate `needs_clarification` or `manual_review` into “outside the service area.”

Outputs allowlist normalized geography, fixed codes, separate coverage evidence, and dataset provenance. Arbitrary input metadata, source text, identifiers, phone numbers, addresses, transcripts, and errors are not echoed. Geography is still caller data in live use: do not publish or indiscriminately log results. Keep any private approval record and audit identity outside this output.

## Offline postal adapter

`lib/offline-postal-index.js` provides:

- `createSyntheticPostalIndex({ records, snapshotDate, expiresOn })` for injected tests;
- `buildGeoNamesUsPostalIndex({ text, expectedSha256, snapshotDate, expiresOn })` for already-local US.txt UTF-8 bytes or text;
- `lookupPostalIndex(index, { zip5, cities, asOf })` for one-to-many and many-to-one candidate relationships; and
- `failedIndex('unavailable' | 'timeout' | 'corrupt')` for a loader's sanitized failure result.

The builder verifies the expected SHA-256 of the uncompressed US.txt bytes, date fields, US country rows, 12-column format, ZIPs, and city/state fields. It discards coordinates and unrelated columns. Duplicate relations are deduplicated. Private immutable maps prevent callers from mutating the snapshot through returned results; forged or serialized handles are corrupt and must be rebuilt locally. This integrity check proves reproducible bytes, not geographic accuracy or completeness.

The recommended optional source is the [GeoNames US postal download](https://download.geonames.org/export/zip/US.zip), documented by its [postal README](https://download.geonames.org/export/zip/readme.txt) (checked 2026-11-02). GeoNames permits commercial reuse under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); preserve attribution to [GeoNames](https://www.geonames.org/) in any distributed derivative and show that it has been transformed. The adapter's provenance includes attribution, source URL, snapshot date, expiry, checksum, and relation count. GeoNames disclaims accuracy, timeliness, and completeness. Aliases and delivery types are not guaranteed. It is not USPS-authoritative, and estimated coordinates are not municipal boundaries.

No real dataset was downloaded or committed for this prototype. Tests use synthetic records, including synthetic GeoNames-format rows. For a future local dataset, retain the exact downloaded archive and README privately with acquisition date and checksum; pin the uncompressed US.txt checksum supplied to this builder. Select an explicit freshness window with the operator. Test a candidate replacement before switching the local handle. Refresh never mutates contractor-approved coverage. This change adds no fetch script, remote lookup, paid provider, account, credential, or USPS integration.

## Verification and remaining integration

Run with the repository-pinned Node.js 24.19.0 from the repository root:

```text
node --test src/zoho-catalyst/revenue-desk-call-runtime/functions/revenue_desk_call_gateway/test/service-area-resolution.test.js
```

The gateway `test:unit` command also includes this file. It installs the existing offline guard before importing the new modules and asserts zero blocked network, provider SDK, credential-read, or subprocess attempts. The focused tests cover the city-only ZIP regression, state distinction, aliases, multi-ZIP cities, pair consistency, both mixed policies, missing evidence, municipal limits, normalization, physical-location confirmation, snapshot failure, corruption, privacy, and refresh/approval separation. These tests do not call a voice provider or verify conversation behavior.

Before live wiring, obtain each client's city meaning, municipality evidence rule, mixed-list semantics, and reviewed coverage; define snapshot freshness and the human fallback. A separately reviewed integration must authenticate those decisions, load the local dataset, collect caller clarification, and translate statuses faithfully. That future work must explicitly cover the onboarding/configuration schema and Retell/runtime tool contract with private acceptance evidence. None is changed here. Containment is to leave this module unreferenced; rollback removes the isolated foundation without changing deployed behavior.
