# Local storage binding paste comparison

`compare-storage-binding-paste.js` compares five owner-pasted values with one
independently reviewed transport artifact. It reports only fixed key labels,
expected/observed JavaScript code-unit lengths, UTF-8 byte lengths, and exact-match
booleans. It does not contact any service, inspect effective configuration, change
configuration, create authority, or prove a successful runtime qualification.
A mismatch does not establish where or why a value changed.

Use Node 24 in a trusted local terminal, from this Analytics project directory:

```text
node tools/compare-storage-binding-paste.js --transport <reviewed-transport-json-path> --transport-sha256 <reviewed-artifact-sha256> --binding-sha256 <reviewed-binding-sha256>
```

Use the independently reviewed hashes, not hashes generated from an unverified
replacement file. Only the artifact path and those hashes belong in command-line
arguments. The tool checks the artifact hash, its exact three-part structure,
the existing tuple decoder's reconstruction, and the reconstructed binding hash
before asking for input. It checks the artifact again after input to detect drift.
The supported existing structure is `tuple-v1`, part size 400, exactly three parts;
the final part's expected length comes from that artifact. No new environment
fields or transport encoding are introduced.

At the hidden prompt, the owner enters one JSON object containing **only** these
five keys, with string values copied from the five corresponding controlled
fields. Order does not matter:

- `REPORT_STORAGE_QUALIFICATION_PART_0`
- `REPORT_STORAGE_QUALIFICATION_PART_1`
- `REPORT_STORAGE_QUALIFICATION_PART_2`
- `REPORT_STORAGE_QUALIFICATION_JSON` (the marker is a string)
- `REPORT_STORAGE_QUALIFICATION_SHA256`

Paste the complete object, then press **Ctrl+D** separately to finish. **Ctrl+C**
cancels. There is no hidden line editing: cancel and restart to correct input.
JSON string escaping is required: a quote uses `\"`, a backslash uses `\\`, and a
literal newline in a value uses `\n`. Formatting whitespace outside strings is
ignored; whitespace and Unicode inside strings are preserved after JSON
unescaping. Values are never trimmed, normalized, or compared by length alone.
Missing, unknown, duplicate (including escaped duplicates), and nonstring keys or
values fail closed. Capture is bounded to 16 KiB of UTF-8 input. Invalid UTF-8,
unsupported terminal control sequences, and input after the finish control are
rejected. Bracketed-paste wrappers are not stripped or interpreted.

Do not export broad configuration, send values to chat, put them in shell
arguments or environment variables, save a pasted-input file, or redirect/pipeline
real input. The CLI requires a real, unshared TTY and has no non-TTY input fallback.
Programmatic test input must be synthetic. The existing transport artifact is
read only; the tool creates no output files or raw-value copies and never uses the
clipboard. It suppresses its own input echo and maintains no input history, and
attempts terminal restoration on success, cancellation, stream errors, and normal
termination signals. A forcibly killed process or terminal failure may require
reopening the terminal. It cannot prevent external host/session recording or
guarantee JavaScript memory erasure. Do not use a shared or recorded terminal.

Exit codes: `0` means all five local strings match, `1` means at least one differs,
and `2` means input, artifact, terminal, or output validation failed. Failures print
only `LOCAL_COMPARE_REJECTED`; exceptions and pasted values are never printed by
the CLI. A local match is not evidence of provider-side bytes, process environment,
runtime identity, or admission. A historical consumed binding may be compared only
as an offline fixture; it must never be staged, invoked, or reused as fresh
authority. Any future binding needs its own separately reviewed authorization.

Focused synthetic verification, from the repository root:

```text
node --test src/zoho-catalyst/revenue-desk-analytics/functions/analytics_sync/test/storage-binding-paste-compare.test.js
```

These tests cover the pure comparison and interactive adapter with synthetic TTY
streams. A real terminal smoke check is separately required to establish usable
hidden input in a particular terminal; automated stream tests alone do not prove
that terminal's behavior. No owner values are needed for that smoke check.
