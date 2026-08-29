# Repository Safety Utilities

The safety tools are deterministic, offline controls for repository and approved
operator workflows. They do not connect to Zoho, Catalyst, Analytics, Retell, or
another live system.

## Local approval-consumption ledger

`claim_approval_consumption.py` validates one private packet and approval through
a fixed repository validator, then atomically consumes that validator-issued
approval immediately before its first live mutation. Callers never pass a
ledger path, authority ID, or digest. The fixed validator returns these two
canonical values only inside the validate-and-claim call:

- `consumptionDigest`: the validator's one lowercase 64-hex, domain-separated
  consumption digest. An approval digest, packet digest, file digest, or a digest
  recomputed by the executor is not an alternative.
- `authorityId`: the mandatory stable identifier that the validator validated
  and bound to the approval record. It must be either a lowercase UUIDv4 or a
  lowercase 64-hex identifier. A mutable packet ID, filename, actor label, or
  optional metadata field is not an authority ID.

The dedicated ledger directory must already exist and be empty on first use. It
must be an absolute path on fixed local storage, outside the ancestry of **every**
Git repository or worktree, and contain no symlink, junction, mount alias, or
other reparse component. UNC, network, and device paths fail closed. Never place
it in Git, a synchronized folder, a packet directory, removable storage, or a
customer-data directory.

The directory is also a security boundary. On POSIX it must be owned by the
effective user with exact mode `0700`; the SQLite database is verified as the
same owner, one hard link, and exact mode `0600`. On Windows the directory must
be owned by the current user and have a protected, non-inherited,
current-user-only full-control DACL. The inherited database DACL must still grant
only the current user, and reparse files are rejected. ACL or native identity
verification being unavailable is an error, not a permissive fallback.

The executor must privately configure `SYLVARA_APPROVAL_LEDGER_DIRECTORY` once to
the one canonical ledger directory for this host/account. The CLI has no ledger
argument. Analytics additionally requires an absolute
`SYLVARA_APPROVAL_NODE_EXECUTABLE` and the exact lowercase file digest in
`SYLVARA_APPROVAL_NODE_EXECUTABLE_SHA256`. The executable must be a regular
single-link file on fixed local storage, contain no link/reparse component, stay
outside Git, and match the configured digest before and after validation. Node
preload and module-path environment overrides are removed from the child.

Supported invocation shapes after that private executor configuration:

```text
python tools/safety/claim_approval_consumption.py crm-workflow-repair-v1 <private-packet-json> <private-approval-json>
python tools/safety/claim_approval_consumption.py analytics-mutation-v3 <private-packet-json> <private-approval-json>
```

The packet and approval paths remain subject to their owning validator's private
file, duplicate-key, source-revision, clean-package, freshness, and exact-binding
checks. Every Git child removes inherited `GIT_*` repository, index, object,
worktree, and config overrides, restores only `GIT_OPTIONAL_LOCKS=0`, and passes
the resolved intended repository as an explicit `safe.directory`. The pair
remains internal until the raw SQLite primitive claims it; the
public function returns only a coarse `claimed=true` receipt and the CLI returns
only a coarse status. The raw pair primitive is underscore-private and has no
supported CLI or public function. This prevents ordinary executor misuse, not a
malicious Python process with authority to introspect or modify this module.
Supplying independently chosen, valid-looking authority/digest strings cannot
create a claim through the supported boundary.

The command emits exactly one coarse status and never prints the digest, ledger
path, authority ID, or an exception detail:

- `claimed`, exit `0`: the unique authority/digest pair was committed durably.
- `already-consumed`, exit `2`: that exact pair is already committed; do not mutate or retry.
- `error`, exit `1`: input, binding conflict, path, ACL, identity, database,
  Git discovery, schema, integrity, or durability validation
  failed; do not mutate or retry.

The fixed `approval-consumption.sqlite3` database uses full-synchronous rollback-
journal transactions. `authority_id` and `digest` each have an independent
`UNIQUE` constraint. The same authority with another digest and the same digest
with another authority are binding conflicts, not retries. Exact-pair replays are
reported only after schema, row, integrity, file-protection, and directory-
identity checks pass. The utility never deletes, replaces, migrates, or repairs
the ledger; malformed, partial, unexpected, or tampered state remains a hard stop
for private operator investigation.

This is only a **single local host and operating-system account** durability
boundary. Another host, another account, or a restored/copied ledger is not
coordinated by it. It does not independently authenticate the approver,
authorize a mutation, provide distributed consensus, or prove that a downstream
mutation succeeded. The selected packet validator validates the approval record
and derives the stable `authorityId` plus one `consumptionDigest`; callers cannot
override either value. An executor must invoke this exact validate-and-claim
boundary in-process or as its immediate pre-write wrapper, continue only on
`claimed`, and stop on every nonzero status. A validation-only CLI result is not
an execution capability. The trusted executor configuration must keep the
canonical ledger binding immutable; changing that private binding in a new
process is outside this control and could create an independent ledger. This
local tool therefore remains a deployment blocker until the real executor pins,
protects, and audits that configuration. Cross-host execution requires a
separately reviewed shared transactional claim service.
