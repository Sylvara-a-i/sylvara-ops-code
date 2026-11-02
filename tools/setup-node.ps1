[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$version = '24.19.0'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$onWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw 'This setup supports Windows x64 and Linux x64 only.'
}
if (-not $onWindows -and -not $IsLinux) { throw 'Use Windows x64 or Linux x64.' }
$platform = if ($onWindows) { 'win-x64' } else { 'linux-x64' }
$extension = if ($onWindows) { 'zip' } else { 'tar.xz' }
# Official release hashes: https://nodejs.org/download/release/v24.19.0/SHASUMS256.txt
$digest = if ($onWindows) {
    '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73'
} else {
    '14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647'
}
$cache = Join-Path $repoRoot '.codex-tmp'
$directory = Join-Path $cache "node-v$version-$platform"
$archive = "$directory.$extension"
foreach ($candidate in @($cache, $directory, $archive)) {
    if ((Test-Path -LiteralPath $candidate) -and
        ((Get-Item -LiteralPath $candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Refusing a linked setup path.'
    }
}
$binaryDir = if ($onWindows) { $directory } else { Join-Path $directory 'bin' }
$binary = Join-Path $binaryDir $(if ($onWindows) { 'node.exe' } else { 'node' })
if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $cache -Force | Out-Null
    if (-not (Test-Path -LiteralPath $archive)) {
        Invoke-WebRequest -Uri "https://nodejs.org/download/release/v$version/node-v$version-$platform.$extension" -OutFile $archive
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $digest) {
        throw 'Node archive hash mismatch. No archive was extracted; remove the exact archive after inspection.'
    }
    if ($onWindows) { Expand-Archive -LiteralPath $archive -DestinationPath $cache }
    else {
        & tar -xJf $archive -C $cache
        if ($LASTEXITCODE -ne 0) { throw 'Node archive extraction failed.' }
    }
}
if (-not (Test-Path -LiteralPath $binary)) { throw 'Incomplete local Node installation; inspect the setup directory.' }
if ((& $binary -p 'process.versions.node') -ne $version) { throw 'Unexpected local Node version.' }
# Session only: no profile, registry, global package, credential or machine change.
$env:PATH = "$binaryDir$([IO.Path]::PathSeparator)$env:PATH"
Write-Host "Node.js $version is ready for this PowerShell session."
