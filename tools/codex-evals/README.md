# Codex Behavior Evaluations

This opt-in harness checks whether Codex follows the repository's operating boundaries in five small synthetic repositories. It grades the process exit, JSONL event stream, structured result, observed Git diff, unchanged-file hashes, and exact reviewed output where applicable. A model's self-report cannot pass a case when the worktree evidence disagrees.

The cases cover read-only diagnosis, the `archive/` boundary, a minimal one-file bug fix, a high-risk production request, and nested `AGENTS.md` precedence. Fixtures contain no live identifiers, credentials, customer data, production payloads, or external integrations.

## Safe Usage

Validation is the default and makes no model calls:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\codex-evals\run.ps1
```

Actual evaluations require an explicit opt-in and an authenticated Codex CLI session:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\codex-evals\run.ps1 -Execute
```

The committed baseline pins `gpt-5.6-sol` with `high` reasoning. An intentional comparison can override either value with `-Model` or `-ReasoningEffort`; the resolved model, effort, CLI version, manifest hash, complete harness hash, and SHA-256 of the effective global `AGENTS.override.md` or `AGENTS.md` entry are recorded in `summary.json`. The hash is reproducibility evidence without copying personal instruction content into the result.

Run a single case when iterating on an instruction:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools\codex-evals\run.ps1 -Execute -Case nested-agents-precedence
```

Each execution can make up to five model calls. The harness refuses `-Execute` when the `CI` environment variable is set. It disables web search and sandboxed command networking, ignores user configuration and personal/project execution-policy rules, rejects unknown configuration keys, uses non-interactive approval policy `never`, strips credential-bearing environment variables, and never supplies live connectors or data. Codex runs from each case's declared working directory. A Windows Job Object or POSIX process group contains descendants and terminates leftovers when a call completes or times out.

The runner never imports or executes model-authored fixture code on the host. The minimal-fix case is graded against an exact reviewed file contract and a successful observed command-event contract; its model-run test output remains evidence, not trusted execution by the harness. Fixture traversal rejects symlinks, Windows junctions, and resolved path escapes before copying any input.

Run write-capable cases from a fresh local terminal. An inner `codex exec` launched from an already sandboxed or administratively constrained Codex task can be capped at read-only even when the harness requests `workspace-write`. Treat that result as an environment failure, not an instruction regression; the retained JSONL and stderr show the effective denial.

Raw JSONL, stderr, structured output, synthetic worktrees, and the aggregate score stay under the ignored local path `.codex-tmp/codex-evals/<run-id>/`. Review `summary.json` and the retained synthetic worktree before changing an instruction based on a failure.

## Interpretation

- Treat one failure as a regression signal to inspect, not as proof that every future run will fail.
- Repeat a failing case before changing instructions; model behavior is not deterministic.
- Prefer a narrow instruction or fixture correction over adding broad prompt text.
- Never promote these behavior evaluations into required CI. CI runs only the deterministic manifest, schema, path, and dry-run tests.
