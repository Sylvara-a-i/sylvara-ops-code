# Revenue Desk Release Boundary

This package creates and verifies one immutable release manifest for the six canonical Catalyst functions. It binds every function artifact, its tracked source tree, the thirteen canonical tables, both Function Job pools, and the governing contracts to one Git commit and one environment mode. The builder does not trust the caller's `function=path` label: it inspects the artifact's Catalyst target, package and lock identity, and immutable source-revision stamp, then produces a provenance digest that also binds the artifact hash to the exact Git-derived source-tree digest.

The manifest is evidence, not a deployer. It contains no project, organization, route, Connection, credential, or production record identifier. Build the six function artifacts with their owning package builders, then run:

```text
node scripts/build-release-manifest.js --source-revision <exact-head-sha> --environment Development --artifact revenue_leak_test_request_form=<path> --artifact revenue_leak_test_setup_form=<path> --artifact revenue_desk_call_gateway=<path> --artifact revenue_desk_call_worker=<path> --artifact crm_billing_orchestrator=<path> --artifact analytics_sync=<path> --output <outside-repository-path>
```

Each artifact path must be its Catalyst project root and contain `catalyst.json` plus `functions/<canonical-name>/package.json` and its lockfile. The checkout must be clean and the output must be outside Git. After deployment, create an allowlisted sanitized readback containing only the fields accepted by `verify-release-readback.js`. Exact function, source, artifact, table, Job-pool, contract, and environment parity is mandatory. Production additionally fails unless traffic, routes, and schedules are all dark.

Never use a passing manifest check as proof of provider behavior, credentials, live call routing, Forms/CRM/Billing behavior, or Retell voice quality. Those require their separate synthetic readback gates.

Private API Gateway route values are governed by
`private-route-packet-contract.json`. The validator deeply freezes that public
contract and requires its canonical `routeContractSha256` in both the packet and
approval envelope, so a method, authentication, throttling, function, or other
contract-file drift invalidates the approval. Keep the populated packet outside Git and
validate it before and after binding the four Advanced I/O function IDs:

```text
node scripts/validate-private-route-packet.js <absolute-private-packet-path>
node scripts/validate-private-route-packet.js <absolute-private-bound-packet-path> <absolute-private-approval-path>
```

The validator fixes the 12 physical routes, authentication modes, one-minute
overall/IP throttles, target functions, disabled zero-route prestate, and
rollback order. The private packet must contain one ordered runtime-path binding
for every contract route. Each binding repeats the canonical route ID, function,
and path-reference name, supplies the exact private value configured on that
function, and carries the independently approved digest of the complete mapping.
Never add those populated path values to Git or logs. Packet and approval paths
are rejected when they resolve beneath any checkout registered to the same Git
repository, not only the checkout running the validator.

`buildRouteRequests` accepts only a bound packet plus a separate approval envelope
whose `packetSha256` binds the complete packet. The envelope must contain canonical
UTC `capturedAt` and `expiresAt` timestamps no more than 15 minutes apart and
`singleUse: true`; it is valid only at or after capture and before expiry. The
validator checks that declaration and time window but does not maintain a replay
database. Use the envelope for exactly one route-creation execution, discard it,
and independently read back all 12 routes immediately. Never reuse it for a retry.
After a partial, timed-out, or ambiguous result, read back first and obtain a new
packet/evidence/approval for any still-required write.

Each Advanced I/O target is derived as
`/server/<canonical-function><approved-runtime-path>`; a caller cannot supply or
override a target endpoint. Every returned Catalyst connector argument also
contains the packet's exact Development organization header, environment header,
and project path parameter, so a route cannot be silently applied to a different
target. The validator emits only the runtime-binding digest and canonical packet
digest and never authorizes gateway activation. Global gateway activation remains
a separate live action requiring fresh prestate, scoped approval, and independent
readback.

These arguments are a repository-side request contract, not proof that the
advertised Catalyst Changes connector accepts the exact body keys, target enum,
headers, or path-variable shape. Before the first route mutation, preserve a
sanitized copy of the currently advertised connector schema and prefer one
harmless Development acceptance call with independent Catalyst Audit readback.
If current discovery proves that connector unavailable, inaccessible, failed for
the operation, or contract-incomplete, record the gap and use only the governed
authenticated-browser fallback in [Zoho instructions](../../../docs/zoho/AGENTS.md). The browser
action must reproduce the exact approved route contract, remain inside the same
single-use approval window, and receive immediate authoritative readback separate
from the save response. Use Catalyst Audit for independent verification when
available; a fresh provider-UI route read does not satisfy any separately required
independent-credential gate. Stop
on any target, schema, validation, save, or readback ambiguity. Direct REST,
shell automation, and a different connector remain prohibited for route creation.
