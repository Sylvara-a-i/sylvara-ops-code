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
$script:VerifiedNodeExecutable = $null
$script:NpmCliPath = $null

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
$CrmBillingOrchestratorRoot = Join-PathSegments $RepoRoot @(
    "src", "zoho-catalyst", "crm-billing-orchestrator", "functions", "crm_billing_orchestrator"
)
$RequestFormRoot = Join-PathSegments $RepoRoot @(
    "src", "zoho-catalyst", "revenue-leak-test-request-form", "functions", "revenue_leak_test_request_form"
)
$SetupFormRoot = Join-PathSegments $RepoRoot @(
    "src", "zoho-catalyst", "revenue-leak-test-setup-form", "functions", "revenue_leak_test_setup_form"
)
$RevenueDeskCallGatewayRoot = Join-PathSegments $RepoRoot @(
    "src", "zoho-catalyst", "revenue-desk-call-runtime", "functions", "revenue_desk_call_gateway"
)
$RevenueDeskCallWorkerRoot = Join-PathSegments $RepoRoot @(
    "src", "zoho-catalyst", "revenue-desk-call-runtime", "functions", "revenue_desk_call_worker"
)
$RevenueDeskMigrationRoot = Join-PathSegments $RepoRoot @(
    "src", "zoho-catalyst", "revenue-desk-call-runtime", "migration"
)
$RevenueDeskAnalyticsRoot = Join-PathSegments $RepoRoot @(
    "src", "zoho-catalyst", "revenue-desk-analytics", "functions", "analytics_sync"
)
$RevenueDeskReleaseRoot = Join-PathSegments $RepoRoot @(
    "src", "zoho-catalyst", "revenue-desk-release"
)
$RevenueDeskInventoryPath = Join-PathSegments $RepoRoot @(
    "src", "zoho-catalyst", "development-function-inventory.json"
)
$RequirementsPath = Join-PathSegments $RepoRoot @("tools", "safety", "requirements.txt")
$VenvParent = Join-PathSegments $RepoRoot @(".codex-tmp")
$VenvRoot = Join-PathSegments $VenvParent @("safety-venv")
$NpmCacheRoot = Join-PathSegments $VenvParent @("npm-cache-node-24.19.0")
$ManagedVenvMarker = ".sylvara-verify-venv"
$ExpectedNodeVersion = "24.19.0"
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

function Assert-ExactStringSequence {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][object[]]$Actual,
        [Parameter(Mandatory = $true)][string[]]$Expected
    )

    $actualStrings = @($Actual | ForEach-Object { [string]$_ })
    if ($actualStrings.Count -ne $Expected.Count) {
        throw "$Label must contain exactly $($Expected.Count) entries."
    }
    for ($index = 0; $index -lt $Expected.Count; $index++) {
        if ($actualStrings[$index] -cne $Expected[$index]) {
            throw "$Label entry $($index + 1) must be $($Expected[$index])."
        }
    }
}

function Assert-RevenueDeskTopology {
    if (-not (Test-Path -LiteralPath $RevenueDeskInventoryPath -PathType Leaf)) {
        throw "Revenue Desk function inventory is missing."
    }
    try {
        $inventory = Get-Content -LiteralPath $RevenueDeskInventoryPath -Raw |
            ConvertFrom-Json
    } catch {
        throw "Revenue Desk function inventory is not valid JSON."
    }

    $expectedFunctions = @(
        "revenue_leak_test_request_form|Advanced I/O",
        "revenue_leak_test_setup_form|Advanced I/O",
        "revenue_desk_call_gateway|Advanced I/O",
        "revenue_desk_call_worker|Job",
        "crm_billing_orchestrator|Advanced I/O",
        "analytics_sync|Job"
    )
    $topology = $inventory.topology_decision
    if ($topology.canonical_project_count -ne 1) {
        throw "Revenue Desk topology must declare exactly one canonical Catalyst project."
    }
    if ($topology.final_active_function_count -ne 6) {
        throw "Revenue Desk topology must declare exactly six active functions."
    }
    if ($topology.separate_free_and_paid_call_stacks_allowed -ne $false) {
        throw "Revenue Desk topology must use one shared free/paid call stack."
    }
    Assert-ExactStringSequence -Label "Revenue Desk active-function list" `
        -Actual @($topology.final_active_functions) `
        -Expected @($expectedFunctions | ForEach-Object { ($_ -split '\|', 2)[0] })
    Assert-ExactStringSequence -Label "Revenue Desk function inventory" `
        -Actual @($inventory.functions | ForEach-Object { "$($_.api_name)|$($_.type)" }) `
        -Expected $expectedFunctions

    Assert-ExactStringSequence -Label "Revenue Desk Function Job pools" `
        -Actual @(
            $inventory.function_job_pools |
                ForEach-Object { "$($_.name)|$($_.target)" }
        ) `
        -Expected @(
            "RevenueDeskCallJobs|revenue_desk_call_worker",
            "RevenueDeskAnalyticsJobs|analytics_sync"
        )
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
        if (
            $null -ne $script:NpmCliPath -and
            $null -ne $script:VerifiedNodeExecutable -and
            [System.IO.Path]::GetFullPath($Executable) -eq
                [System.IO.Path]::GetFullPath($script:NpmCliPath)
        ) {
            # npm.cmd prefers a sibling node.exe on Windows. Invoke npm's CLI with the
            # already verified Node binary so dependency work cannot drift runtimes.
            & $script:VerifiedNodeExecutable $script:NpmCliPath @Arguments
        } else {
            & $Executable @Arguments
        }
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
        throw "Node.js $ExpectedNodeVersion was not found on PATH. Install the exact verified runtime and retry."
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
    $reportedVersion = ($version | Select-Object -Last 1).Trim()
    if ($reportedVersion -ne $ExpectedNodeVersion) {
        throw "Expected Node.js $ExpectedNodeVersion, but $node reported $reportedVersion."
    }
    return $node
}

function Resolve-Npm {
    if (-not $OnWindows) {
        $npm = Resolve-Application -Name "npm"
        if ($null -eq $npm) {
            throw "npm was not found on PATH. Install npm for Node.js $ExpectedNodeVersion and retry."
        }
        return $npm
    }

    $commands = @(Get-Command -Name "npm.cmd" -CommandType Application `
        -All -ErrorAction SilentlyContinue)
    foreach ($command in $commands) {
        $candidate = Join-PathSegments (Split-Path -Parent $command.Source) @(
            "node_modules", "npm", "bin", "npm-cli.js"
        )
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw "npm-cli.js was not found. Install npm for Node.js $ExpectedNodeVersion and retry."
}

try {
    Push-Location -LiteralPath $RepoRoot
    try {
        $requirements = Get-Content -LiteralPath $RequirementsPath -Raw
        if ($requirements -notmatch "(?m)^PyYAML==([0-9.]+)") {
            throw "Could not determine the pinned PyYAML version from tools/safety/requirements.txt."
        }
        $expectedPyYaml = $Matches[1]

        Assert-RevenueDeskTopology
        $python = Find-PythonRuntime
        $pythonInfo = Assert-PythonBaseline -Executable $python
        $node = Assert-NodeBaseline
        $npm = Resolve-Npm
        $script:VerifiedNodeExecutable = $node
        if ($OnWindows) {
            $script:NpmCliPath = $npm
        }
        $useRegistry = $Bootstrap -or $Mode -eq "All"

        if ($useRegistry) {
            Write-Host "Registry access is enabled for hash-pinned dependency installation."
            Ensure-LocalPythonEnvironment -BasePython $python
            $python = (Resolve-Path -LiteralPath $VenvPython).Path
            $pythonInfo = Assert-PythonBaseline -Executable $python
            if (Test-ReparsePoint -Path $NpmCacheRoot) {
                throw "Refusing to use a linked or reparse-point npm verification cache."
            }
            if (-not (Test-Path -LiteralPath $NpmCacheRoot -PathType Container)) {
                New-Item -ItemType Directory -Path $NpmCacheRoot | Out-Null
            }
            $env:npm_config_cache = $NpmCacheRoot

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
            Invoke-Native -Label "Install exact CRM-Billing orchestrator dependencies" `
                -Executable $npm -Arguments @(
                    "ci", "--ignore-scripts", "--no-audit", "--no-fund",
                    "--prefix", $CrmBillingOrchestratorRoot
                )
            Invoke-Native -Label "Install exact Revenue Leak Test Request Form dependencies" `
                -Executable $npm -Arguments @(
                    "ci", "--ignore-scripts", "--no-audit", "--no-fund",
                    "--prefix", $RequestFormRoot
                )
            Invoke-Native -Label "Install exact Revenue Leak Test Setup Form dependencies" `
                -Executable $npm -Arguments @(
                    "ci", "--ignore-scripts", "--no-audit", "--no-fund",
                    "--prefix", $SetupFormRoot
                )
            Invoke-Native -Label "Install exact Revenue Desk call-gateway dependencies" `
                -Executable $npm -Arguments @(
                    "ci", "--ignore-scripts", "--no-audit", "--no-fund",
                    "--prefix", $RevenueDeskCallGatewayRoot
                )
            Invoke-Native -Label "Install exact Revenue Desk call-worker dependencies" `
                -Executable $npm -Arguments @(
                    "ci", "--ignore-scripts", "--no-audit", "--no-fund",
                    "--install-links",
                    "--prefix", $RevenueDeskCallWorkerRoot
                )
            Invoke-Native -Label "Install exact Revenue Desk Analytics dependencies" `
                -Executable $npm -Arguments @(
                    "ci", "--ignore-scripts", "--no-audit", "--no-fund",
                    "--prefix", $RevenueDeskAnalyticsRoot
                )
        } else {
            $env:npm_config_offline = "true"
            $env:npm_config_update_notifier = "false"
            Write-Host "Quick mode disables npm registry access and uses existing local dependencies."
        }

        Assert-PythonDependencies -Executable $python -ExpectedVersion $expectedPyYaml
        $nodePackages = @(
            @{ Label = "Gateway"; Root = $GatewayRoot },
            @{ Label = "CRM-Billing orchestrator"; Root = $CrmBillingOrchestratorRoot },
            @{ Label = "Revenue Leak Test Request Form"; Root = $RequestFormRoot },
            @{ Label = "Revenue Leak Test Setup Form"; Root = $SetupFormRoot },
            @{ Label = "Revenue Desk call gateway"; Root = $RevenueDeskCallGatewayRoot },
            @{ Label = "Revenue Desk Analytics"; Root = $RevenueDeskAnalyticsRoot }
        )
        foreach ($package in $nodePackages) {
            $dependency = Join-PathSegments -BasePath $package.Root -Segments @(
                "node_modules", "zcatalyst-sdk-node", "package.json"
            )
            if (-not (Test-Path -LiteralPath $dependency -PathType Leaf)) {
                throw "$($package.Label) dependencies are missing. Run .\tools\verify.cmd -Bootstrap once before offline Quick verification."
            }
        }
        $callWorkerGatewayDependency = Join-PathSegments $RevenueDeskCallWorkerRoot @(
            "node_modules", "revenue_desk_call_gateway", "package.json"
        )
        $callWorkerCatalystSdk = Join-PathSegments $RevenueDeskCallWorkerRoot @(
            "node_modules", "zcatalyst-sdk-node", "package.json"
        )
        if (
            (-not (Test-Path -LiteralPath $callWorkerGatewayDependency -PathType Leaf)) -or
            (-not (Test-Path -LiteralPath $callWorkerCatalystSdk -PathType Leaf))
        ) {
            throw "Revenue Desk call-worker dependencies are missing. Run .\tools\verify.cmd -Bootstrap once before offline Quick verification."
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
            Invoke-Native -Label "Gateway production dependency audit" -Executable $npm `
                -Arguments @(
                    "audit", "--omit=dev", "--audit-level=moderate",
                    "--prefix", $GatewayRoot
                )
            Invoke-Native -Label "CRM-Billing orchestrator production dependency audit" `
                -Executable $npm -Arguments @(
                    "audit", "--omit=dev", "--audit-level=moderate",
                    "--prefix", $CrmBillingOrchestratorRoot
                )
            Invoke-Native -Label "Revenue Leak Test Request Form production dependency audit" `
                -Executable $npm -Arguments @(
                    "audit", "--omit=dev", "--audit-level=moderate",
                    "--prefix", $RequestFormRoot
                )
            Invoke-Native -Label "Revenue Leak Test Setup Form production dependency audit" `
                -Executable $npm -Arguments @(
                    "audit", "--omit=dev", "--audit-level=moderate",
                    "--prefix", $SetupFormRoot
                )
            Invoke-Native -Label "Revenue Desk call-gateway production dependency audit" -Executable $npm `
                -Arguments @(
                    "audit", "--omit=dev", "--audit-level=moderate",
                    "--prefix", $RevenueDeskCallGatewayRoot
                )
            Invoke-Native -Label "Revenue Desk call-worker production dependency audit" -Executable $npm `
                -Arguments @(
                    "audit", "--omit=dev", "--audit-level=moderate",
                    "--prefix", $RevenueDeskCallWorkerRoot
                )
            Invoke-Native -Label "Revenue Desk Analytics production dependency audit" -Executable $npm `
                -Arguments @(
                    "audit", "--omit=dev", "--audit-level=moderate",
                    "--prefix", $RevenueDeskAnalyticsRoot
                )
        }
        Invoke-Native -Label "Billing gateway checks and tests" -Executable $npm `
            -Arguments @("run", "ci", "--prefix", $GatewayRoot)
        Invoke-Native -Label "CRM-Billing orchestrator checks and tests" -Executable $npm `
            -Arguments @("run", "ci", "--prefix", $CrmBillingOrchestratorRoot)
        Invoke-Native -Label "Revenue Leak Test Request Form checks and tests" -Executable $npm `
            -Arguments @("run", "ci", "--prefix", $RequestFormRoot)
        Invoke-Native -Label "Revenue Leak Test Setup Form checks and tests" -Executable $npm `
            -Arguments @("run", "ci", "--prefix", $SetupFormRoot)
        Invoke-Native -Label "Revenue Desk call-gateway checks and tests" -Executable $npm `
            -Arguments @("run", "ci", "--prefix", $RevenueDeskCallGatewayRoot)
        Invoke-Native -Label "Revenue Desk call-worker checks and tests" -Executable $npm `
            -Arguments @("run", "ci", "--prefix", $RevenueDeskCallWorkerRoot)
        Invoke-Native -Label "Revenue Desk canonical-table migration checks and tests" `
            -Executable $npm -Arguments @("run", "ci", "--prefix", $RevenueDeskMigrationRoot)
        Invoke-Native -Label "Revenue Desk Analytics checks and tests" -Executable $npm `
            -Arguments @("run", "ci", "--prefix", $RevenueDeskAnalyticsRoot)
        Invoke-Native -Label "Revenue Desk six-function release checks" -Executable $npm `
            -Arguments @("test", "--prefix", $RevenueDeskReleaseRoot)

        Write-Host "Verification passed ($Mode mode)."
    } finally {
        Pop-Location
    }
} catch {
    Write-Error "Verification failed: $($_.Exception.Message)" -ErrorAction Continue
    exit $script:FailureExitCode
}

exit 0
