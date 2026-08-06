[CmdletBinding()]
param(
    [switch]$Execute,
    [string[]]$Case,
    [string]$Model,
    [ValidateSet("low", "medium", "high", "xhigh", "max", "ultra")]
    [string]$ReasoningEffort,
    [string]$PythonPath,
    [ValidateRange(30, 3600)]
    [int]$TimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"
$HarnessRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepositoryRoot = (Resolve-Path (Join-Path $HarnessRoot "..\..")).Path

if (-not $PythonPath) {
    $BundledPython = Join-Path $RepositoryRoot ".codex-tmp\safety-venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $BundledPython -PathType Leaf) {
        $PythonPath = $BundledPython
    }
    else {
        $PythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if ($PythonCommand) {
            $PythonPath = $PythonCommand.Source
        }
    }
}

if (-not $PythonPath -or -not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) {
    throw "Python was not found. Pass -PythonPath with an explicit Python executable."
}

$RunnerArguments = @(
    (Join-Path $HarnessRoot "run.py")
    "--timeout-seconds"
    $TimeoutSeconds.ToString()
)

if ($Execute) {
    $RunnerArguments += "--execute"
}
else {
    $RunnerArguments += "--dry-run"
}

foreach ($CaseId in $Case) {
    $RunnerArguments += @("--case", $CaseId)
}

if ($Model) {
    $RunnerArguments += @("--model", $Model)
}

if ($ReasoningEffort) {
    $RunnerArguments += @("--reasoning-effort", $ReasoningEffort)
}

& $PythonPath @RunnerArguments
exit $LASTEXITCODE
