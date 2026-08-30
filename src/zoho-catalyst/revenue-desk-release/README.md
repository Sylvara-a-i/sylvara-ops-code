# Revenue Desk Release Boundary

This package creates and verifies immutable release manifests for two closed profiles. The default `canonical-seven` profile preserves the seven canonical Catalyst functions, thirteen tables, and both Function Job pools. The Development-only `setup-journey` profile binds the five setup-critical functions, twelve tables, one Function Job pool, CRM and Forms contracts, Retell's provider-neutral contract, and the intended source installation scope to one Git commit. The scope is desired-state provenance, not provider-observed state. The builder does not trust the caller's `function=path` label: it inspects the artifact's Catalyst target, package and lock identity, and immutable source-revision stamp, then produces a provenance digest that also binds the artifact hash to the exact Git-derived source-tree digest.

The manifest is evidence, not a deployer. It contains no project, organization, route value, Connection, credential, or production record identifier. Build the seven function artifacts with their owning package builders, then run the default profile:

```text
node scripts/build-release-manifest.js --source-revision <exact-head-sha> --environment Development --artifact revenue_leak_test_request_form=<path> --artifact revenue_leak_test_setup_form=<path> --artifact revenue_desk_call_gateway=<path> --artifact revenue_desk_call_worker=<path> --artifact revenue_desk_route_control=<path> --artifact crm_billing_orchestrator=<path> --artifact analytics_sync=<path> --output <outside-repository-path>
```

For the bounded setup journey, build only the five selected artifacts and use the closed profile:

```text
node scripts/build-release-manifest.js --profile setup-journey --source-revision <exact-head-sha> --environment Development --artifact revenue_leak_test_request_form=<path> --artifact revenue_leak_test_setup_form=<path> --artifact revenue_desk_call_gateway=<path> --artifact revenue_desk_call_worker=<path> --artifact revenue_desk_route_control=<path> --output <outside-repository-path>
```

The setup profile selects the exact seventeen-route `setup-journey` API Gateway profile and explicitly defers `CRM_BILLING`. Create those routes while the Development gateway is disabled, read back every exact route and target binding, then enable only the Development API Gateway and verify availability. The private route-creation packet itself never authorizes that enablement. `RETELL_ROUTE_MODE` remains `disabled`; no Retell number, webhook/provider binding, publish, call, or Production gateway activation is authorized. In this state the activation control fails closed with `ISOLATED_RETELL_TEST_NUMBER_REQUIRED`. Verify all five Catalyst artifacts and resource inventory with `verify-release-readback.js --profile setup-journey`; CRM, Forms, Retell, gateway availability, and traffic state still require separate provider-observed evidence. Unknown profiles, arbitrary contract paths, and Production setup-journey manifests fail closed.

Each artifact path must be its Catalyst project root and contain `catalyst.json` plus `functions/<canonical-name>/package.json` and its lockfile. The checkout must be clean and the output must be outside Git. After deployment, create an allowlisted sanitized readback containing only the fields accepted by `verify-release-readback.js`. Exact function, source, artifact, table, Job-pool, contract, and environment parity is mandatory. Production additionally fails unless traffic, routes, and schedules are all dark.

Never use a passing manifest check as proof of provider behavior, credentials, live call routing, Forms/CRM/Billing behavior, or Retell voice quality. Those require their separate synthetic readback gates.

Private API Gateway route values are governed by
`private-route-packet-contract.json`. The validator deeply freezes that public
contract and requires its canonical `routeContractSha256` in both the packet and
approval envelope, so a method, authentication, throttling, function, or other
contract-file drift invalidates the approval. Keep the populated packet outside Git and
validate it before and after binding the selected Advanced I/O function IDs:

```text
node scripts/validate-private-route-packet.js <absolute-private-packet-path>
node scripts/validate-private-route-packet.js <absolute-private-bound-packet-path> <absolute-private-approval-path>
node scripts/validate-private-route-packet.js <absolute-private-continuation-packet-path> <absolute-private-continuation-approval-path> <absolute-private-original-bound-packet-path>
node scripts/validate-private-route-packet.js <absolute-private-additive-reconciliation-packet-path> <absolute-private-additive-reconciliation-approval-path>
node scripts/verify-private-route-additive-readback.js <absolute-private-additive-reconciliation-packet-path> <absolute-private-final-route-readback-path>
```

Schema v1 fixes either the exact 18-route `canonical-all` profile or the exact
17-route `setup-journey` profile, including authentication modes, one-minute
overall/IP throttles, target functions, disabled zero-route prestate, and
rollback order. Schemas v2 and v3 preserve those same immutable route-profile
bindings while validating an observed nonzero Development inventory. The private
packet must contain one ordered runtime-path binding
for every contract route. Each binding repeats the canonical route ID, function,
and path-reference name, supplies the exact private value configured on that
function, and carries the independently approved digest of the complete mapping.
Never add those populated path values to Git or logs. Packet and approval paths
are rejected when they resolve beneath any checkout registered to the same Git
repository, not only the checkout running the validator.

Schema v1 remains the initial-execution contract and accepts only a disabled
gateway with zero routes. It must not be edited into a retry packet after a
partial or ambiguous execution. Once authoritative readback confirms that one
or more routes exist, keep the gateway disabled and create a schema-v2
`continuation` packet outside every worktree. Schema v2 is accepted only when the
existing routes are a non-empty, incomplete, exact ordered prefix of the same
closed route profile. It carries every original endpoint and target binding, every
runtime-path binding, the original zero-route prestate evidence digest, and
the exact initial bound-packet digest. The separately preserved original
schema-v1 bound packet is a required validation input. The validator validates
that packet independently, requires its digest to match, reconstructs the
schema-v1 packet from the continuation, and then compares both complete packets.
The continuation therefore cannot silently replace an endpoint, target ID,
runtime path, project, organization, source revision, rollback rule, or
route-contract digest by recomputing its own hashes. Never reconstruct or
replace the preserved original file from continuation-controlled fields. Its
path is subject to the same outside-every-worktree guard as the continuation and
approval files.

The schema-v2 `gatewayPrestate` must record `enabled: false` and the current exact
route count. `existingRoutePrefix` contains only this normalized allowlist from
independent provider readback for each existing route, in canonical order:
`name`, `source_endpoint`, `target_endpoint`, `target` (`advancedio`), `method`,
`target_id`, `authentication`, and `throttling`. Both throttle scopes must carry
an exact `limit` and a `duration` with only `days`, `hours`, `minutes`, and
`seconds`. Authentication comes from the independent UI readback when it is not
present in the audit listing. Exclude provider route IDs, actor identity,
timestamps, and all other metadata. `existingRoutePrefixSha256` binds that full
allowlisted prefix; `prestateEvidenceSha256` binds the fresh disabled-state
readback. `remainingRoutes` must exactly equal the untouched suffix of the
original full `routes` array. Gaps, reordered routes, extra metadata, readback
drift, zero-route continuations, and already-complete continuations fail closed.

Build that allowlist from the API-route list response using
`normalizeRouteListReadback`. The provider's enhanced route-detail response may
substitute the function display name for `target_id`; it is not authoritative
for the packet's numeric target binding and must fail normalization. Supply
authentication separately from the independent UI readback. Never merge raw
provider metadata into the normalized route or compare the enhanced display
value with the approved numeric target ID.

`buildRouteRequests` accepts only a bound packet plus a separate approval envelope
whose `packetSha256` binds the complete packet. The envelope must contain canonical
UTC `capturedAt` and `expiresAt` timestamps no more than 15 minutes apart and
`singleUse: true`; it is valid only at or after capture and before expiry. The
schema-v1 and schema-v2 validator checks that declaration and time window but does
not maintain a replay database. Use either envelope for exactly one route-creation
execution, discard it, and independently read back every route in the selected
profile immediately. Never reuse it for a retry.
After a partial, timed-out, or ambiguous result, read back first and obtain a new
packet/evidence/approval for any still-required write.

A schema-v2 approval is also schema version 2 and must explicitly set
`continuationAuthorized: true`; it repeats the exact
`initialBoundPacketSha256` and `existingRoutePrefixSha256`. It is a new
single-use approval for that exact continuation packet, not a reuse or extension
of the initial approval. `buildRouteRequests` returns only the canonical suffix
after the verified prefix, making recreation of an existing route impossible
through this contract. If the readback is not an exact prefix, do not construct a
continuation packet and do not guess which write succeeded.

Schema v3 is the only authorized reconciliation shape when a disabled shared
Development Gateway already has a nonzero complete provider inventory that is
not the exact schema-v2 canonical prefix. It is restricted to `setup-journey`.
Capture a fresh authoritative disabled-Gateway readback and the complete API-route
inventory before constructing the packet. Set `providerInventoryComplete: true`,
bind the observed timestamp and prestate-evidence digest, and require
`gatewayPrestate.routeCount` to equal the complete normalized inventory length.
`existingRouteInventory` uses the same normalized allowlist as schema v2 but may
remain in provider-returned order. Every route identity must be unique and must
match either one of the seventeen setup routes exactly or the one already-existing
deferred `CRM_BILLING` route. Unknown routes, duplicate identities or endpoints,
attribute drift, an empty or omitted inventory, a route-count mismatch, Production,
an enabled Gateway, and an already-complete setup inventory fail closed.

The schema-v3 packet and approval both bind the full provider-inventory digest,
the exact canonical `missingRoutes` digest, the immutable source revision and
route-contract digest, the observed-at timestamp, and whether the deferred Billing
route was present. Both must set `existingRouteMutationAuthorized: false` and
`billingMutationAuthorized: false`; the packet still sets
`gatewayActivationAuthorized: false` and `retryAuthorized: false`. The packet's
lowercase UUIDv4 `operationAuthorizationId` is the stable one-execution authority.
The approval additionally sets
`additiveReconciliationAuthorized: true`, repeats the complete-inventory assertion,
sets `durableConsumptionRequired: true`, binds the same authority ID and the
domain-separated exact-packet `consumptionSha256`, and uses the same maximum
15-minute, `singleUse: true` window as schema v2. Approval timestamp reissuance
cannot rotate either the stable authority or consumption digest. The
disabled-Gateway prestate itself must be no more than 15 minutes old at request
generation.

`validate-private-route-packet.js` is validation-only and never consumes an
approval or authorizes a provider write. Immediately before the first schema-v3
route create, the authorized executor must run the shared local consumption
boundary using its fixed private ledger and pinned Node executable:

```text
python tools/safety/claim_approval_consumption.py catalyst-route-additive-reconciliation-v3 <absolute-private-additive-reconciliation-packet-path> <absolute-private-additive-reconciliation-approval-path>
```

Continue only when that command returns `claimed`. It atomically stores the stable
authority as a UNIQUE key with the validator-returned consumption digest before
the first create. `already-consumed` and `error` are hard stops. The record is
never cleared after success, partial success, timeout, ambiguity, or local output
failure. Do not run the claimant merely to validate: a successful claim consumes
the approval even when no provider call follows. A new authoritative readback,
packet with a new operation authority, and approval are mandatory after any
partial, ambiguous, or failed attempt.

`buildRouteRequests` derives the missing setup identities from the complete
inventory and emits only those routes in canonical setup-profile order. It never
emits a request for an existing route or for `CRM_BILLING`; it has no update,
delete, reorder, activation, or Billing mutation path. Existing provider order is
preserved rather than normalized into a desired order.

After the additive creations, keep the Development Gateway disabled and capture a
fresh complete normalized readback outside every worktree. The final-readback
envelope binds the exact schema-v3 packet digest and Development organization,
project, and environment. `verify-private-route-additive-readback.js` requires all
seventeen setup routes with exact canonical attributes, requires every pre-existing
route to be unchanged, requires `CRM_BILLING` exactly when it existed in prestate,
and rejects every additional route. The readback must be no more than 15 minutes
old and still report `gatewayEnabled: false`. Development Gateway enablement remains
a separate action with separate fresh approval and independent readback; neither
the reconciliation packet nor the final-readback verifier authorizes it.

For the authenticated-browser fallback, the Catalyst console may open the custom
route form directly after the first custom route instead of showing the initial
creation-mode chooser. Treat that only as a navigation-state change. Populate
the next request returned by `buildRouteRequests`; never replay the first item
from the original selected-profile request list.

Each Advanced I/O target is derived as
`/server/<canonical-function><approved-runtime-path>`; a caller cannot supply or
override a target endpoint. Every returned Catalyst connector argument also
contains the packet's exact Development organization header, environment header,
and project path parameter, so a route cannot be silently applied to a different
target. The validator emits only the runtime-binding digest and canonical packet
digest and never authorizes gateway activation. Global gateway activation remains
a separate live action requiring fresh prestate, scoped approval, and independent
readback.

For the Catalyst browser form, derive the function selection and suffix input
with `advancedIoFormBinding`. The console contributes the separator after the
selected function, so `pathInput` intentionally omits the runtime path's leading
slash. Supplying that slash creates a persisted double-slash target that fails
canonical readback and requires a separately approved repair; never normalize it
silently or continue creating later routes.

Construct that repair candidate only with `buildAdvancedIoTargetRemediation`.
Its trusted inputs are the preserved canonical bound or continuation packet, the
SHA-256 copied from that packet's already-consumed approval record, the separately
preserved original bound packet when the source is a continuation, the canonical
route index, the API-route-list readback, and an independent UI authentication
readback. The helper treats the prior digest as provenance only, derives the
proposal from the immutable route contract, and permits exactly the duplicate
separator in `target_endpoint`; it does not authorize a write or reactivate the
consumed route-creation approval.

Keep the helper's output private. Never log or commit its `current`, `proposed`,
`formBinding`, or target identity. Before a repair, independently prove the
Development Gateway is disabled and build a fresh remediation packet whose
short-lived, single-use approval binds the canonical packet SHA-256 and index,
the normalized defective prestate, the canonical proposed endpoint, exact
Development organization/project/environment, fresh disabled-gateway evidence,
rollback, and exclusions. Temporarily enable only inside that approval, update
only `target_endpoint`, read back the full canonical route and authentication
independently, restore the Gateway to disabled even on failure, and discard the
approval. Any additional drift, ambiguous save, or failed readback remains
contained and requires another fresh packet; it is never repaired in place.

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
