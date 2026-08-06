[CmdletBinding()]
param(
    [ValidateSet("Quick", "All")]
    [string]$Mode = "Quick",

    [switch]$Bootstrap,

    [string]$PythonPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$script:FailureExitCode = 1

function Join-PathSegments {
    param(
        [Parameter(Mandatory = $true)][string]$BasePath,
        [Parameter(Mandatory = $true)][string[]]$Segments
    )

    $result = $BasePath
    foreach ($segment in $Segments) {
        $result = Join-Path $result $segment
    }
    return $result
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$GatewayRoot = Join-PathSegments $RepoRoot @("src", "zoho-catalyst", "billing-webhook-gateway")
$RequirementsPath = Join-PathSegments $RepoRoot @("tools", "safety", "requirements.txt")
$VenvParent = Join-PathSegments $RepoRoot @(".codex-tmp")
$VenvRoot = Join-PathSegments $VenvParent @("safety-venv")
$ManagedVenvMarker = ".sylvara-verify-venv"
$OnWindows = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
$VenvPython = if ($OnWindows) {
    Join-PathSegments $VenvRoot @("Scripts", "python.exe")
} else {
    Join-PathSegments $VenvRoot @("bin", "python")
}

function Resolve-Application {
    param([Parameter(Mandatory = $true)][string]$Name)

    $command = Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $command) {
        return $null
    }
    return $command.Source
}

function Resolve-ExecutableValue {
    param([Parameter(Mandatory = $true)][string]$Value)

    if (Test-Path -LiteralPath $Value -PathType Leaf) {
        return (Resolve-Path -LiteralPath $Value).Path
    }
    $resolved = Resolve-Application -Name $Value
    if ($null -eq $resolved) {
        throw "Executable was not found: $Value"
    }
    return $resolved
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$WorkingDirectory = $RepoRoot
    )

    Write-Host "==> $Label"
    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $Executable @Arguments
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($exitCode -ne 0) {
        $script:FailureExitCode = $exitCode
        throw "$Label failed with exit code $exitCode."
    }
}

function Get-PythonInfo {
    param([Parameter(Mandatory = $true)][string]$Executable)

    $probe = "import json, platform, struct, sys; print(json.dumps({'implementation': platform.python_implementation(), 'major': sys.version_info.major, 'minor': sys.version_info.minor, 'bits': struct.calcsize('P') * 8, 'is_venv': sys.prefix != sys.base_prefix}))"
    try {
        $output = & $Executable -c $probe 2>$null
        if ($LASTEXITCODE -ne 0) {
            return $null
        }
        return (($output -join "`n") | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Assert-PythonBaseline {
    param([Parameter(Mandatory = $true)][string]$Executable)

    $info = Get-PythonInfo -Executable $Executable
    if ($null -eq $info) {
        throw "Could not execute the selected Python runtime: $Executable"
    }
    if (-not (Test-PythonBaselineInfo -Info $info)) {
        throw "Expected 64-bit CPython 3.12, but $Executable reported $($info.implementation) $($info.major).$($info.minor) ($($info.bits)-bit). Use -PythonPath with a compliant runtime."
    }
    return $info
}

function Test-PythonBaselineInfo {
    param($Info)

    return (
        $null -ne $Info -and
        $Info.implementation -eq "CPython" -and
        $Info.major -eq 3 -and
        $Info.minor -eq 12 -and
        $Info.bits -eq 64
    )
}

function Test-ReparsePoint {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return $false
    }
    $item = Get-Item -LiteralPath $Path -Force
    return (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Set-ManagedVenvRoot {
    param([Parameter(Mandatory = $true)][string]$Root)

    $script:VenvRoot = $Root
    $script:VenvPython = if ($OnWindows) {
        Join-PathSegments $Root @("Scripts", "python.exe")
    } else {
        Join-PathSegments $Root @("bin", "python")
    }
}

function Get-ManagedVenvPythonCandidates {
    if (-not (Test-Path -LiteralPath $VenvParent -PathType Container)) {
        return @()
    }
    if (Test-ReparsePoint -Path $VenvParent) {
        throw "Refusing to use a reparse-point .codex-tmp directory for managed verification environments."
    }

    $candidates = [System.Collections.Generic.List[string]]::new()
    foreach ($directory in Get-ChildItem -LiteralPath $VenvParent -Directory -Force) {
        $isPreferred = $directory.Name -eq "safety-venv"
        $isVersioned = $directory.Name -like "safety-venv-cpython-3.12-x64-*"
        if (-not $isPreferred -and -not $isVersioned) {
            continue
        }
        if (($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing to use a linked or reparse-point verification environment: $($directory.FullName)"
        }
        if ($isVersioned) {
            $marker = Join-Path $directory.FullName $ManagedVenvMarker
            if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
                continue
            }
            if ((Get-Content -LiteralPath $marker -Raw) -ne "SYLVARA_VERIFY_VENV_V1") {
                continue
            }
        }
        $candidatePython = if ($OnWindows) {
            Join-PathSegments $directory.FullName @("Scripts", "python.exe")
        } else {
            Join-PathSegments $directory.FullName @("bin", "python")
        }
        if (Test-Path -LiteralPath $candidatePython -PathType Leaf) {
            $candidates.Add($candidatePython)
        }
    }
    return $candidates
}

function Ensure-LocalPythonEnvironment {
    param([Parameter(Mandatory = $true)][string]$BasePython)

    foreach ($candidate in Get-ManagedVenvPythonCandidates) {
        $candidateInfo = Get-PythonInfo -Executable $candidate
        if ((Test-PythonBaselineInfo -Info $candidateInfo) -and $candidateInfo.is_venv) {
            Set-ManagedVenvRoot -Root (Split-Path -Parent (Split-Path -Parent $candidate))
            return
        }
    }

    if (Test-ReparsePoint -Path $RepoRoot) {
        throw "Refusing to create a managed verification environment through a reparse-point repository root."
    }
    if (Test-Path -LiteralPath $VenvParent) {
        if (Test-ReparsePoint -Path $VenvParent) {
            throw "Refusing to create a managed verification environment through a reparse-point .codex-tmp directory."
        }
    } else {
        New-Item -ItemType Directory -Path $VenvParent | Out-Null
    }

    $preferredRoot = Join-PathSegments $VenvParent @("safety-venv")
    $newRoot = if (-not (Test-Path -LiteralPath $preferredRoot)) {
        $preferredRoot
    } else {
        $suffix = "safety-venv-cpython-3.12-x64-{0}-{1}" -f `
            [DateTime]::UtcNow.ToString("yyyyMMddHHmmssfff"), $PID
        Join-PathSegments $VenvParent @($suffix)
    }
    if (Test-Path -LiteralPath $newRoot) {
        throw "Refusing to overwrite an existing managed verification environment path."
    }

    $baseFull = [System.IO.Path]::GetFullPath($BasePython)
    $newRootFull = [System.IO.Path]::GetFullPath($newRoot)
    $comparison = if ($OnWindows) {
        [System.StringComparison]::OrdinalIgnoreCase
    } else {
        [System.StringComparison]::Ordinal
    }
    $rootPrefix = $newRootFull.TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    ) + [System.IO.Path]::DirectorySeparatorChar
    if ($baseFull.StartsWith($rootPrefix, $comparison)) {
        throw "Refusing to create a verification environment from an interpreter inside its target."
    }

    Set-ManagedVenvRoot -Root $newRootFull
    $null = Invoke-Native -Label "Create the local Python environment" `
        -Executable $BasePython -Arguments @("-m", "venv", $VenvRoot)
    $localPython = (Resolve-Path -LiteralPath $VenvPython).Path
    $localInfo = Assert-PythonBaseline -Executable $localPython
    if (-not $localInfo.is_venv) {
        throw "The local Python environment did not report itself as a virtual environment."
    }
    [System.IO.File]::WriteAllText(
        (Join-Path $VenvRoot $ManagedVenvMarker),
        "SYLVARA_VERIFY_VENV_V1"
    )
}

function Find-PythonRuntime {
    if ($PythonPath) {
        $explicit = Resolve-ExecutableValue -Value $PythonPath
        $null = Assert-PythonBaseline -Executable $explicit
        return $explicit
    }

    $candidates = [System.Collections.Generic.List[string]]::new()
    foreach ($managedPython in Get-ManagedVenvPythonCandidates) {
        $resolvedManagedPython = (Resolve-Path -LiteralPath $managedPython).Path
        if (-not $candidates.Contains($resolvedManagedPython)) {
            $candidates.Add($resolvedManagedPython)
        }
    }
    if ($OnWindows) {
        $userProfile = $env:USERPROFILE
        if (-not [string]::IsNullOrWhiteSpace($userProfile)) {
            $bundledPython = Join-Path $userProfile ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
            if (Test-Path -LiteralPath $bundledPython -PathType Leaf) {
                $candidates.Add((Resolve-Path -LiteralPath $bundledPython).Path)
            }
        }
    }
    foreach ($name in @("python3.12", "python")) {
        $candidate = Resolve-Application -Name $name
        if ($null -ne $candidate -and -not $candidates.Contains($candidate)) {
            $candidates.Add($candidate)
        }
    }
    if ($OnWindows) {
        $launcher = Resolve-Application -Name "py"
        if ($null -ne $launcher) {
            try {
                $launcherOutput = & $launcher -3.12-64 -c "import sys; print(sys.executable)" 2>$null
                $launcherExitCode = $LASTEXITCODE
            } catch {
                $launcherOutput = $null
                $launcherExitCode = 1
            }
            if ($launcherExitCode -eq 0 -and $launcherOutput) {
                $candidate = ($launcherOutput | Select-Object -Last 1).Trim()
                if (-not $candidates.Contains($candidate)) {
                    $candidates.Add($candidate)
                }
            }
        }
    }

    foreach ($candidate in $candidates) {
        $info = Get-PythonInfo -Executable $candidate
        if (Test-PythonBaselineInfo -Info $info) {
            return $candidate
        }
    }

    throw "64-bit CPython 3.12 was not found. Install it or pass its executable with -PythonPath."
}

function Assert-PythonDependencies {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [Parameter(Mandatory = $true)][string]$ExpectedVersion
    )

    $probe = "import importlib.metadata; print(importlib.metadata.version('PyYAML'))"
    try {
        $output = & $Executable -c $probe 2>$null
        $probeExitCode = $LASTEXITCODE
    } catch {
        $output = $null
        $probeExitCode = 1
    }
    if ($probeExitCode -ne 0 -or ($output -join "").Trim() -ne $ExpectedVersion) {
        throw "The selected Python runtime does not contain the hash-pinned PyYAML $ExpectedVersion dependency. Run .\tools\verify.cmd -Bootstrap, optionally with -PythonPath."
    }
}

function Assert-NodeBaseline {
    $node = Resolve-Application -Name "node"
    if ($null -eq $node) {
        throw "Node.js 24 was not found on PATH. Install Node.js 24 and retry."
    }
    try {
        $version = & $node -p "process.versions.node" 2>$null
        $probeExitCode = $LASTEXITCODE
    } catch {
        $version = $null
        $probeExitCode = 1
    }
    if ($probeExitCode -ne 0 -or -not $version) {
        throw "Could not query the Node.js runtime."
    }
    $major = [int](($version | Select-Object -Last 1).Split(".")[0])
    if ($major -ne 24) {
        throw "Expected Node.js 24, but $node reported $version."
    }
    return $node
}

function Resolve-Npm {
    $name = if ($OnWindows) { "npm.cmd" } else { "npm" }
    $npm = Resolve-Application -Name $name
    if ($null -eq $npm) {
        throw "$name was not found on PATH. Install npm for Node.js 24 and retry."
    }
    return $npm
}

try {
    Push-Location -LiteralPath $RepoRoot
    try {
        $requirements = Get-Content -LiteralPath $RequirementsPath -Raw
        if ($requirements -notmatch "(?m)^PyYAML==([0-9.]+)") {
            throw "Could not determine the pinned PyYAML version from tools/safety/requirements.txt."
        }
        $expectedPyYaml = $Matches[1]

        $python = Find-PythonRuntime
        $pythonInfo = Assert-PythonBaseline -Executable $python
        $node = Assert-NodeBaseline
        $npm = Resolve-Npm
        $useRegistry = $Bootstrap -or $Mode -eq "All"

        if ($useRegistry) {
            Write-Host "Registry access is enabled for hash-pinned dependency installation."
            Ensure-LocalPythonEnvironment -BasePython $python
            $python = (Resolve-Path -LiteralPath $VenvPython).Path
            $pythonInfo = Assert-PythonBaseline -Executable $python

            Invoke-Native -Label "Install hash-pinned Python dependencies" `
                -Executable $python -Arguments @(
                    "-m", "pip", "install",
                    "--disable-pip-version-check",
                    "--only-binary=:all:",
                    "--require-hashes",
                    "-r", $RequirementsPath
                )
            Invoke-Native -Label "Install exact gateway dependencies" `
                -Executable $npm -Arguments @(
                    "ci", "--ignore-scripts", "--no-audit", "--no-fund",
                    "--prefix", $GatewayRoot
                )
        } else {
            $env:npm_config_offline = "true"
            $env:npm_config_update_notifier = "false"
            Write-Host "Quick mode disables npm registry access and uses existing local dependencies."
        }

        Assert-PythonDependencies -Executable $python -ExpectedVersion $expectedPyYaml
        $gatewayDependency = Join-PathSegments $GatewayRoot @(
            "node_modules", "zcatalyst-sdk-node", "package.json"
        )
        if (-not (Test-Path -LiteralPath $gatewayDependency -PathType Leaf)) {
            throw "Gateway dependencies are missing. Run .\tools\verify.cmd -Bootstrap once before offline Quick verification."
        }

        Invoke-Native -Label "Public repository safety scan" -Executable $python `
            -Arguments @("tools/safety/pre-commit-safety-check.py")
        Invoke-Native -Label "Workflow security policy" -Executable $python `
            -Arguments @("tools/safety/validate_workflows.py")
        Invoke-Native -Label "Python regression tests" -Executable $python `
            -Arguments @(
                "-m", "unittest", "discover", "-s", "tools/safety/tests",
                "-p", "test_*.py", "-v"
            )

        if ($Mode -eq "All") {
            Invoke-Native -Label "Production dependency audit" -Executable $npm `
                -Arguments @(
                    "audit", "--omit=dev", "--audit-level=high",
                    "--prefix", $GatewayRoot
                )
        }
        Invoke-Native -Label "Billing gateway checks and tests" -Executable $npm `
            -Arguments @("run", "ci", "--prefix", $GatewayRoot)

        Write-Host "Verification passed ($Mode mode)."
    } finally {
        Pop-Location
    }
} catch {
    Write-Error "Verification failed: $($_.Exception.Message)" -ErrorAction Continue
    exit $script:FailureExitCode
}

exit 0
