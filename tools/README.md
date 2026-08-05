# Repository Tools

## Purpose

`tools/` contains repository-local utilities for validation, safety, and operator workflows. Product runtime code belongs under [`src/`](../src/), while reusable standards and operating guidance belong under [`docs/`](../docs/).

## Directory Map

| Area | Purpose |
|---|---|
| [`safety/`](safety/) | Public-repository scanning, workflow-policy validation, and regression tests |

Key safety entry points are:

- [`pre-commit-safety-check.py`](safety/pre-commit-safety-check.py) for secrets, private-data, unsafe-file, and publication-boundary checks;
- [`validate_workflows.py`](safety/validate_workflows.py) for GitHub Actions policy validation; and
- [`tests/`](safety/tests/) for the repository safety regression suite.

Use the commands in [Local Validation](../README.md#local-validation) rather than maintaining a second command list here.

## Placement Rules

- Give each tool category one clear responsibility and its own sibling directory under `tools/`.
- Put a script in `safety/` only when it enforces repository, publication, or workflow safety.
- Keep system-owned implementation code under the matching `src/<system>/` path.
- Keep generated output, caches, and local environments in ignored locations such as `.codex-tmp/`.
- Never store credentials, production data, private exports, or customer information in tooling or test fixtures.
