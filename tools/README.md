# Repository Tools

Use the root verifier as the single local validation implementation. On Windows:

```powershell
.\tools\verify.cmd
```

`Quick` is the default. It is offline and runs the repository safety scan,
workflow policy validator, complete Python regression suite, and the Billing
gateway, Revenue Leak Test Request Form, and Revenue Leak Test Setup Form checks against dependencies
already installed in the checkout.

On a new checkout, bootstrap the hash-pinned Python and exact npm dependencies,
then run the same checks:

```powershell
.\tools\verify.cmd -Bootstrap
```

Use `All` before publication when registry access is available. It refreshes the
dependency installs, runs each production npm audit, and then runs every Quick
check:

```powershell
.\tools\verify.cmd -Mode All
```

The command wrapper applies a process-scoped PowerShell execution-policy bypass;
it does not change the user's or machine's policy. Both `-Bootstrap` and
`-Mode All` may contact the Python and npm registries.
Quick without `-Bootstrap` does not install or audit dependencies. The verifier
requires 64-bit CPython 3.12 and Node.js 24; use `-PythonPath` when the required
Python executable is not discoverable.

Bootstrap never recursively deletes a prior environment. If the preferred
ignored environment is stale or incompatible, it creates and marks a separate
versioned environment under `.codex-tmp/`, then reuses a valid managed candidate
on later runs. It refuses linked or reparse-point roots.

On Linux or macOS with PowerShell 7, invoke the same implementation directly:

```powershell
pwsh -NoProfile -File ./tools/verify.ps1
```

The scripts under [`safety/`](safety/) are implementation details of this entry
point and remain directly callable by CI. Do not treat a passing scan as proof
that a commit is safe; review the diff for private data and production
identifiers before publication.

## Codex Behavior Evaluations

[`codex-evals/`](codex-evals/) is a separate, opt-in synthetic harness for
testing instruction-following behavior. Its default dry run validates the
harness without a model call. Actual evaluations require `-Execute`, stay out
of CI, and retain raw evidence only under ignored `.codex-tmp/` paths. These
evaluations supplement the deterministic root verifier; they are not a merge
gate or evidence that future model behavior is guaranteed.
