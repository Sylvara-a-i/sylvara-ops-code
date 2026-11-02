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
requires 64-bit CPython 3.12 and Node.js 24.19.0; use `-PythonPath` when the required
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

## Fast offline workflow regressions

For webhook/retry work, start with this focused subset of the existing Node test
harness. It needs no npm packages, Python, tenant configuration, or credentials:

```powershell
# Windows x64 or Linux x64, in PowerShell 7. First setup downloads Node only.
./tools/setup-node.ps1
node tools/run-offline-regressions.cjs
```

Setup verifies the official Node 24.19.0 archive's pinned SHA-256 and extracts it
under ignored `.codex-tmp/`. It changes PATH only in the current PowerShell
session. Re-run setup to select the cached runtime in a new session. It does not
install global packages or change profiles. The runner rejects another Node
version and forwards no ambient service credentials to its child tests.

The selected suites use the existing offline guard, injected in-memory stores,
fake Billing/CRM adapters, and dry-run Mail. Network, SDK/package loading,
subprocess creation, and credential-file reads are denied inside these suites.
This guard protects reviewed tests; it is not an OS sandbox for arbitrary code.
Evidence is **mocked/offline**, never a provider acceptance test or permission to
place calls, send messages, provision subscriptions, or charge money.

Coverage includes duplicate/reversed Retell delivery and worker order, safe
pre-write retries, ambiguous partial-write containment, exact outbox readback,
fake paid-subscription concurrency/reconciliation, and the actual production
validator's separately authenticated completion chain. The two legacy
`Processing` claims must remain unchanged when the new completion succeeds.
Hand-authored webhook fixtures preserve their synthetic transcript input, while
the current runtime retains approved structured analysis and discards raw
transcripts/recording URLs. This does **not** add production transcript retention.

The new webhook tests also run in Repo Checks and the canonical verifier. The
existing completion and Billing suites remain in their original full CI suites;
the focused runner selects them locally without copying their implementations.
Run the canonical verifier once before handoff, after installing 64-bit CPython
3.12 and bootstrapping dependencies with the commands above. Existing npm lockfiles
and the hash-pinned Python requirements remain the dependency authority.

Windows full verification has an additional existing prerequisite: the private
staging-packet CLI tests expect their hash-approved PowerShell helper at
`../../native/powershell/pwsh.exe` relative to the Node executable directory.
The portable Node setup above does not supply that signing-toolchain layout.
Without it, those existing tests fail during synthetic ACL setup; the focused
58-test runner still works. Use the approved signing toolchain for those Windows
tests, or the canonical Linux CI result. The production helper/hash checks are
unchanged.

## Future saved Sylvara coding environment

This repository provides setup commands, not a saved cloud environment. Create a
**new** private environment for `Sylvara-a-i/sylvara-ops-code`; do not reuse an
unrelated environment. Select Linux x64 with Git, PowerShell 7, CPython 3.12
(64-bit, including venv/pip), curl, tar and xz. Use this setup command from the repo:

```sh
pwsh -NoProfile -Command './tools/setup-node.ps1; ./tools/verify.ps1 -Bootstrap -PythonPath (Get-Command python3.12).Source'
```

Dependency setup needs HTTPS access to `nodejs.org`, `pypi.org`,
`files.pythonhosted.org`, and `registry.npmjs.org`; repository checkout needs
GitHub. Disable runtime network after setup if the environment supports it.
Add **no secrets** or provider connections. Retain `permissions: {}` in CI and
keep this environment limited to source/test work. No paid service is required.

The owner step is **Work in > Cloud > Select environment > Create environment**
on the web or desktop app. Choose this repository, select **Get started**, provide
the install command above, review the tested setup/access/network choices, and
select **Publish**. Wait for **Environment published** before starting a task.
See the [official cloud setup guide](https://learn.chatgpt.com/docs/cloud).
If a required runtime is unavailable or creation requests a new grant, stop there
and resolve that prerequisite explicitly. A simulated environment catalog entry
is not evidence of a runnable environment.

After setup, use `./tools/setup-node.ps1` to select the cached Node runtime, then
`node tools/run-offline-regressions.cjs` for iteration or `./tools/verify.ps1`
for the canonical offline checks. Keep separate task branches/checkouts; backend
runtime or deployment work belongs to its owning task.

## Codex Behavior Evaluations

[`codex-evals/`](codex-evals/) is a separate, opt-in synthetic harness for
testing instruction-following behavior. Its default dry run validates the
harness without a model call. Actual evaluations require `-Execute`, stay out
of CI, and retain raw evidence only under ignored `.codex-tmp/` paths. These
evaluations supplement the deterministic root verifier; they are not a merge
gate or evidence that future model behavior is guaranteed.
