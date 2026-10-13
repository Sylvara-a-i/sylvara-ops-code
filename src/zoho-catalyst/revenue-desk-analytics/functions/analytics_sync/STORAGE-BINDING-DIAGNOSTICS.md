# Storage binding failure diagnostics

The Controller may include `bindingFailure: {schemaVersion: 1, firstFailure: <enum>}`
on its existing authenticated storage failure application-log record when synchronous
factory construction fails at `storage_binding`. This is source preparation only;
it does not establish any installed configuration or authorize deployment, an
invocation, another admission attempt, or a configuration change.

The module-private error registry stores only this frozen projection. The reason
is a fixed allowlisted string identifying the first rejecting validation branch.
A grouped reason identifies that branch, not a unique term within its expression.
No environment values, part contents, hashes, lengths, identifiers, request data,
exception messages or physical-operation counters enter this projection. An
unissued error has no projection. Recorder or lookup failure keeps the original
generic held outcome. The HTTP status and response body remain unchanged.

| Validation phase | Reasons distinguish |
| --- | --- |
| Decoder | Missing/malformed marker, part count/existence/type/length/ASCII, Base64, bounded inflation, tuple shape/types/canonical form and reconstructed size |
| Common factory checks | Pin syntax/mismatch, binding shape, source/environment/project/host identity, scalar guards and callback types |
| Dormant construction | Dormant shape/times, strict scalar checks, capability field shape and evidence role/field/digest/time checks |

The complete finite vocabulary is in
[`lib/report-storage-binding-diagnostic.js`](lib/report-storage-binding-diagnostic.js).
Only the original rejecting path issues a reason; the logger does not reread
configuration or decode a second time. Existing short-circuit order, coercions,
regular expressions and bounds are preserved. In particular, the existing
non-multiline marker expression rejects terminal line terminators on the pinned
Node runtime; the diagnostic does not trim or normalize them.

Encoder and sizing failures, ordinary dormant validation, activation, legacy
context/capability failures and handler failures retain their previous diagnostic
behavior. The constructor-specific dormant wrapper has a fixed throwing failure
path; callers cannot inject an accepting validator. The Controller exposes binding
observations only at `storage_binding`, never at authentication, SDK identity or
handler stages. No handler tracker, store, transport, SDK initialization, timer or
provider request is created to obtain a binding observation.

The synthetic branch matrix is in
[`test/report-storage-binding-diagnostic.test.js`](test/report-storage-binding-diagnostic.test.js).
It distinguishes reachable failures from defensive checks masked by earlier
validation; it does not claim to reproduce an unobserved worker mismatch. Controller
boundary tests cover closed logging, existing HTTP behavior and other-stage
exclusion. Release-builder tests verify that the helper is packaged once in the
Controller and that its lazy bridge shares the same private registry.
Manual standalone copies of `report-storage-binding.js` must include
`report-storage-binding-diagnostic.js` from the same reviewed source revision.

Run the relevant Node test files during iteration and the repository's canonical
`tools/verify.cmd` before handoff. No new variable or manual configuration is
required by this source change. A future deployment needs its own exact source,
target, authority, rollback and readback review; restoring the previously approved
artifact is the code rollback. Existing consumed attempts remain consumed.
