# Safety Tool Instructions

These rules apply to the repository safety scanner, workflow validator, and their tests.

## Enforcement Invariants

- Fail closed when Git metadata, index blobs, untracked candidates, file bytes, text decoding, workflow YAML, or subprocess results cannot be read or classified safely.
- The safety scan must cover the Git index plus untracked, non-ignored candidates. Working-tree edits to tracked files must not silently replace the staged snapshot being evaluated.
- Reject unsupported Git modes, unapproved binaries, oversized files, credential-bearing names, secret patterns, private paths, and protected-data patterns unless a narrowly reviewed rule explicitly permits a safe synthetic form.
- Workflow validation stays deterministic and read-only. Preserve unique-key YAML parsing, pinned full action SHAs, allowlisted action owners, explicit read-only permissions, bounded timeouts, fixed supported runner/runtime versions, and rejection of secret context or unsafe script behavior.
- A tool error is a failed check, never a skipped candidate or successful result.

## Change Standard

- Keep checks deterministic, offline, cross-platform where practical, and free of live credentials, production identifiers, private fixtures, and network dependencies.
- Do not improve speed by weakening coverage, changing staged-snapshot semantics, suppressing errors, or skipping ambiguous inputs.
- Add focused acceptance and rejection tests for every rule change. A false-positive exception must be narrower than the protected pattern and include a regression proving the dangerous neighboring case still fails.
- Preserve stable CLI exit behavior and actionable, sanitized diagnostics. Never echo the matched secret, payload, or other protected value.
- Use temporary repositories and synthetic data in tests. Resolve and validate any destructive test target before cleanup.

Run the focused safety test suite while iterating, then use the repository's canonical verifier before handoff.
