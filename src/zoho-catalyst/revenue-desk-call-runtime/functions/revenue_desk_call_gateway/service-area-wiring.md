# Disabled city and ZIP lookup adapter

This is offline-tested implementation, not an active voice feature. `contracts/service-area-tool-contract.json`
ships with `enabled: false`. The exported gateway has no environment switch to activate it. The proposed
`POST /retell/service-area/resolve` returns 404 before SDK initialization while disabled. No API Gateway
route, Retell tool, deployed configuration, approved coverage, credential, or agent version is changed.

## Trusted call context

The proposed custom function is named `resolve_service_area`. It requires Retell's full JSON envelope
`{ name, call, args }`; Payload: args only must stay off. Existing raw-body HMAC verification, the
five-minute timestamp window, duplicate-header rejection, host/project/environment checks, body bounds,
and eight-second response budget apply. It reuses `RETELL_WEBHOOK_API_KEY`, `EVENT_HMAC_SECRET`, and the
number lookup HMAC; there is no new key or provider API request.

The model may supply only optional `city`, `state`, `zip` strings and `addressKind` (`physical`, `po_box`,
or `unknown`). It cannot supply tenant identity, configuration, policy, approval, snapshot, or a URL.
Only the signed provider call supplies the call ID, agent/version, called number, start time, and ownership
metadata. The gateway validates the existing ownership token, exact active configuration, approval and
activation receipts, number binding, ongoing inbound phone-call status, activation interval, stop state,
and rollback claims. The metadata resolution time must be within five minutes of the call start. Wrong,
missing, or changed context fails neutrally. There is no number-only or dynamic-variable fallback.

The existing ownership token does not include the call ID; it remains an ownership/configuration proof
inside the signed provider call envelope. This adapter does not claim independent call-ID authentication.
No `call_started` subscription or additional call-admission state is introduced. The lookup does not count
calls, reserve capacity, change rows, queue jobs, send notifications, or invoke a provider. It performs
bounded existing Data Store reads and synchronous local geography resolution only.

Retell's full envelope includes the conversation transcript. Projection prevents persistence, logging,
response echo, and onward geography-provider sharing; it does not prevent Catalyst from receiving those
bytes. This new mid-call ingress requires an explicit data-handling and deployment review before activation.
No transcript, phone number, call identity, ownership token, configuration list, or candidate relation is
included in the response or logs. Existing sanitized operational logging remains in use.

## Operator confirmation using existing onboarding

Form 2's existing `primaryServiceArea` text continues to accept cities, ZIPs, or both. The operator keeps
that source text unchanged, supplies declared `serviceArea.cities` and `serviceArea.zips`, and reviews
postal candidates separately. Every declared city needs a state for a new confirmation. Approved ZIPs
must be five-digit strings; a ZIP+4 or a candidate relation is not silently promoted into approval.

The optional `serviceAreaResolution` configuration object contains:

- `schemaVersion: 1` and `snapshotSha256`, the exact local asset checksum.
- `approvedCoverage: { status: "contractor_approved", cities, zips }`, separately confirmed coverage.
- `policy.cityMeaning`: `postal_locality` or `municipality` when city rules apply.
- `policy.municipalityEvidence`: `caller_attestation` or `boundary_required` for municipality policy.
- `policy.mixedLists`: `union` or `intersection` when both approved lists are populated.
- `confirmation`: canonical UTC `confirmedAt`, private opaque `reference`, and `declarationSha256`,
  produced by `declarationFingerprint` over the declared lists.

The shape validator is not identity proof. Local preparation remains unapproved and unauthenticated.
The existing private configuration approval must authenticate the operator evidence; its existing snapshot
fingerprint covers all these bytes. Changes require a new reviewed configuration rather than editing an
approved snapshot. Confirmation must precede call admission. The source-text comparison now accepts
the same 2000-character maximum as Form 2; the complete candidate still must fit the existing 10000-byte bound.

Legacy configurations remain parseable without invented policy or approval. City-only coverage plus ZIP
66212 asks for city/state. Further decisions needing missing contractor policy go to manual review.
No new UI, CRM field, or conversion of missing ZIPs to exclusion is introduced.

## Local snapshot and release packaging

`postal-index-loader.js` reads only a package-relative manifest and a fixed allowlisted data file. It bounds
file sizes, rejects symbolic links, verifies SHA-256 before parsing, and caches one immutable packaged
snapshot. A caller cannot select a path or refresh it. The manifest dates govern lookup freshness.

The committed `data/us-postal-fixture.json` is a small synthetic fixture, not real geographic evidence.
The default runtime loader refuses it. Explicit offline test injection exercises it. The release builder
includes the fixture and validates its checksum, and the release manifest covers its exact bytes.

The clean-HEAD release builder still accepts only tracked assets. Two separate offline scripts prepare
an external candidate and compose it into a held release without changing the base or enabling the route.
Both require absolute paths, reject symlink paths and existing/in-repository output, and publish only a
complete new output directory. Create the output parent directory first. Neither script downloads data,
authenticates operator approval, deploys, reads credentials, changes coverage, or refreshes at runtime.

Run `scripts/build-postal-snapshot.js --raw <US.txt> --readme <readme.txt> --metadata <metadata.json>
--output <new-private-directory>`. Metadata contains exactly `schemaVersion: 1`, `rawSha256`,
`archiveSha256`, `readmeSha256`, the official `sourceUrl` and `sourceReadmeUrl`, canonical UTC
`retrievedAt`, `snapshotDate` (the retrieval date), and explicit `expiresOn`. There is no default renewal
period. The archive checksum is acquisition evidence supplied by the operator; the script validates the
already-extracted input and README checksums, not the archive or source authenticity. Acquisition remains
a separate controlled step. The maximum raw file is 16 MiB.

Structural corruption fails the whole preparation. Unsupported city/state rows quarantine **every row
for that ZIP**, including otherwise valid aliases, so incomplete source evidence cannot appear settled.
The resulting manifest, candidate data, exclusion ledger, README and `snapshot-artifact.json` are private
outputs. Valid TSV fields and leading-zero ZIPs are preserved, with deterministic LF endings. Coordinates
remain source data only and are ignored by the index. No candidate is converted into approved coverage.

Build the base with the existing `build-release.js --revision <exact-clean-HEAD> --output <base>`.
Then run `scripts/compose-postal-snapshot.js` with `--source-revision`, `--runtime-artifact`,
`--base-manifest-sha256`, `--snapshot-artifact`, `--snapshot-sha256`, `--snapshot-manifest-sha256`, and
`--output`. The source must remain the exact clean HEAD. Pin both the data and loader-manifest hashes;
changing dates or provenance is a new review even when data bytes are identical. Stale or future
qualification windows cannot be composed. Those dates still do not establish geographic currency.

The composer reconstructs expected source from Git and verifies every base file before applying only
`contracts/postal-snapshot.json`, `data/us-postal.txt` and `contracts/postal-attribution.json` within the
gateway. It executes the selected checkout's loader, never code from an input artifact. The original
release manifest and candidate provenance are preserved under `provenance/`; the new
`composition-manifest.json` records all payload hashes and has `installationAuthorized: false` and
`routeEnabled: false`. Its own hash is returned separately. There is no misleading single-revision release
manifest in `runtime/`. Source stamps identify the base code, while composition parity covers external data.
Materialize existing dependencies only in the composed runtime after review so linked worker/control
packages receive the same asset. This is not an overlay onto an arbitrary live or privately patched release.

Synthetic packaging tests cover preparation, unresolved aliases, pins, stale/corrupt inputs, verified
source, unchanged base files, output interruption and disabled routing. Private real-data or isolated
hosted loader evidence must remain outside Git and CI; it does not qualify the complete signed gateway,
its Data Store reads, or the Retell conversation. Restore the exact prior artifact if a separately approved
installation fails; neither script mutates a deployment or extends a QA window.

GeoNames postal data requires attribution: **GeoNames, CC BY 4.0, https://www.geonames.org/**; disclose the
transformation into postal relations. It is not USPS authority and does not prove municipal boundaries,
delivery type, exhaustive aliases, or geographic completeness. Source and license references remain in
[the foundation documentation](service-area-resolution.md#offline-postal-adapter). A refresh never changes
approved coverage. Missing, corrupt, stale, or mismatched data cannot establish an out-of-area rejection;
an independent explicit approved ZIP rule can still match without postal evidence.

## Conversation and activation acceptance

Responses contain `status`, fixed `reason` and `nextAction`, `postalConsistency`, `scope`,
`municipalBoundaryVerified: false`, and normalized `evaluatedLocation` when a decision was computed.
Statuses are `eligible`, `ineligible`, `needs_clarification`, and `manual_review`. Only caller questions are
returned as clarification; contractor-policy questions become manual review. Transport/authentication
errors return a neutral unavailable body with non-2xx status. Neither unknown nor failure means out of area.

Future Retell wiring must wait for completion, clear earlier results before each lookup, compare evaluated
geography with the latest caller-provided location, and repeat after corrections. Interrupted or failed
lookups cannot reuse an earlier eligible result. Start with zero automatic retries. Collect the physical
service location, not a PO Box; do not infer municipality or approve coverage from postal candidates.
The result supports service-area conversation only, not booking, dispatch, address validity, or authoritative
post-call reporting. Provider analysis remains separate; no durable tool-decision reporting claim is added.

Before activation, review the new route and transcript-bearing ingress, acquire and qualify real data,
confirm client policy and human fallback, build from the reviewed exact commit, inspect the complete release
artifact, and separately approve Development deployment and Retell tool configuration. Controlled native
acceptance must verify the actual signature/envelope, metadata timing, input corrections, neutral failures,
latency, no writes, and unchanged count/notification behavior. No live or paid calls were used here.

Official contracts checked 2026-11-03: [custom function envelope and retries](https://docs.retellai.com/build/conversation-flow/custom-function),
[raw-body signature verification](https://docs.retellai.com/features/secure-webhook), and
[inbound metadata](https://docs.retellai.com/features/inbound-call-webhook). Documentation is not deployed readback.
