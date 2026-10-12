# Dormant Development storage staging and fresh activation

Schema 6 separates an untimed, non-executable staging descriptor from a fresh
activation sent with the existing authenticated `qualify_storage` command. It
does not extend or reinterpret schemas 3–5, renew an old attempt, change SDK
authentication or enable a customer workflow. Dormant zero times are explicit
sentinels, not an expired schema-4 binding made valid by changing its clock.

## Pure local preparation

`tools/storage-dormant-activation.js` exposes preparation/rendering functions and a
fixed `LIMITS` object. It reads no environment, files, credentials or provider
state; creates no nonce, claim, allocation or ledger record; and performs no
upload, activation or invocation. Callers supply all inputs and the actual
observation time explicitly. Outputs remain private artifacts. Do not log their
binding values, endpoint, normalized evidence or complete request body.

`stageDormant({binding})` validates the reviewed schema-6 descriptor with
`enabled:false`, zero binding/evidence times, fixed evidence-state hashes, a
caller-supplied distinct nonce and a 25-second operation limit. It returns the
exact binding JSON, its SHA256, tuple-v1 transport parts and stable operation
digest. This step does not assert that configuration has been installed. Source,
target, table/projection, runtime, authentication, restoration and authorization
review remain the responsibility of the enclosing scoped procedure.

`evidenceDigest(value)` hashes recursively sorted JSON object keys, preserving
array order and JSON types. Use it for normalized facts and complete receipts;
binding wire bytes instead retain the codec's exact field order. Unsupported
values, accessors, proxies, cycles and excessive nesting are rejected.

`prepareActivation(input,{now})` accepts exactly:

```text
{binding,bindingSha256,expiresAt,receipts,readiness}
receipts = {ownerAuthorization,ownership,access}
receipt = {schemaVersion:1,role,method:"independent_current_read",reference,
           observedAt,observationKind,normalizedFacts}
readiness = {stagedAndReadBack:true,sourceAndTargetUnchanged:true,
             scopeAndCostAuthorized:true,durableConsumptionReady:true}
```

The observation kinds are `owner_readiness_continuity`, `ownership_readback`
and `access_readback`, respectively. Each facts hash must match that role's
fixed dormant evidence digest. Each fresh evidence digest covers the complete
receipt, including its actual observation time and reference. Owner facts must
include the standing approval's `standingApprovalSha256`; the fresh observation
records readiness/continuity, not a newly manufactured approval or a new expiry
on the human's approval. Never replace an observation time without an actual
independent read and retained receipt.

These receipt and readiness fields are operator assertions. Hashing proves
consistency, not authentic provider provenance, current access, successful
staging, durable consumption or financial capacity. The enclosing procedure
must verify their substantive evidence. The helper does not infer that a
reference string proves a read or that a Boolean proves authorization.

Activation must leave at least 27 seconds at preparation and fit within every
actual evidence observation's one-hour horizon. The returned exact body contains
`{profile:"report_storage_qualification_v1",action:"qualify_storage",activation}`,
with the stable operation digest, activation digest and caller guard times.
Fresh receipts or times cannot change the dormant descriptor's durable replay
identity. An expired, failed, consumed or ambiguous activation never grants a
replacement attempt.

`renderActivationCaller({templateText,templateSha256,preparedActivation})` renders
the existing reviewed private caller with the prepared constant request body and
its guards. The prepared object must be the frozen result issued by
`prepareActivation` in the same process; for retained input files, rerun that
pure preparation using the same explicit inputs/time. Do not deserialize an
unchecked body and treat it as a reviewed activation.

The renderer requires exact pinned ASCII/LF template bytes, one `invokeurl`, one
`__ACTIVATION_COMMAND_JSON__` in `body = __ACTIVATION_COMMAND_JSON__.toMap();`,
two quoted `__OPERATION_DIGEST__` placeholders, three `__VERIFIED_AT__`, three
`__EXPIRES_AT__`, and either two `__TIMEOUT_MS__` placeholders or the already
reviewed literal timeout. It replaces the command with a quoted escaped JSON
string, then preserves every other template byte. It returns text, bytes and
SHA256 for exact source review/readback. It never alters the route, Connection,
18-field acceptance projection, native formatting or number of calls. The
supplied template review remains responsible for those native semantics; a hash
alone does not prove them.

## Owner handoff and machine execution

1. Review and stage the disabled candidate, untimed descriptor and managed caller;
   read back the exact bytes and preserve the restoration package. The owner can
   finish this setup without a countdown or a final timed packet to copy.
2. Once setup is confirmed, obtain genuine current continuity, ownership and
   access observations. Compare normalized facts to the fixed descriptor and
   check unchanged source/target plus actual aggregate cost capacity.
3. Prepare the activation locally. Review the exact command, caller guards and
   immutable evidence links, then durably consume that exact activation before
   dispatch. Preserve all earlier attempts, liabilities and ambiguous outcomes.
4. Supply this constant body and guard values through the existing reviewed
   managed caller, using its existing authenticated Connection and exact route.
   Perform one Execute; no automatic retry or separate activation probe follows.
5. Restore, independently read back and reconcile the bounded result/rows. A
   missing, malformed, late or unknown result remains consumed and unresolved.

The canonical local runner remains a file packager. The managed-caller template
lives in the private kit; the existing authenticated launcher and its source
update/readback surface supply the machine-controlled execution path. After the
owner's untimed setup, the operator renders the exact constant body into that
same caller and uses its supported source update/readback tool. The owner is not
asked to copy another timed packet. This renderer does not execute that tool or
establish native Deluge compilation; native compilation/readback is part of the
exact deployment procedure. Do not remove the old caller's absolute checks
while retaining its stale operation digest, and do not revive an expired
historical caller.

## Limits and retained guarantees

The scope remains 13 DataStore starts, including five insert attempts and eight
reads, at most two active requests and at most five new synthetic rows across
failure outcomes. Three rows are the expected successful retained result, not
the worst-case row ceiling. Runtime bounds remain 25 seconds for the operation,
three seconds per request/authentication and one second for owned drain.
Authentication, exact target/source/SDK/method checks, TLS controls, durable
single-use admission and replay refusal remain mandatory.

The owner-approved aggregate actual spending cap belongs to the private scoped
procedure, not a public source default. `LIMITS` documents technical bounds; it
is neither a pricing calculation nor enforcement of remaining capacity.
`scopeAndCostAuthorized` is mandatory and must be supported by the external
financial reconciliation. Preserve historical holds, liabilities and billing
lag. Preparation creates no new flat reserve and assumes no refund or zero
charge for failed work.

The focused source tests use synthetic facts and a fixed synthetic nonce. They
establish offline preparation/codec/activation consistency, not provider state,
native managed-caller behavior, financial readiness or execution authority.
