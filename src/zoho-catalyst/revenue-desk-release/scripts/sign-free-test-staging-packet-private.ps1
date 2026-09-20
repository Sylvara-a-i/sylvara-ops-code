#requires -Version 5.1
[CmdletBinding(DefaultParameterSetName = 'Sign')]
param(
    [Parameter(Mandatory)][string]$InputPath,
    [Parameter(Mandatory)][string]$OutputPath,
    [Parameter(Mandatory, ParameterSetName = 'Sign')][string]$NodePath,
    [Parameter(Mandatory, ParameterSetName = 'Sign')][ValidatePattern('^[a-f0-9]{40}$')][string]$UtilityRevision,
    [Parameter(Mandatory, ParameterSetName = 'Sign')][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedRevision,
    [Parameter(Mandatory, ParameterSetName = 'Sign')][ValidatePattern('^operator_[a-f0-9]{64}$')][string]$ExpectedOperatorHash,
    [Parameter(Mandatory, ParameterSetName = 'Sign')][ValidateRange(512, 16384)][int]$MaxBodyBytes,
    [Parameter(Mandatory, ParameterSetName = 'Check')][switch]$CheckPrivatePaths,
    [Parameter(ParameterSetName = 'Check')][switch]$OutputExists
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskProcess = $null
$taskInputLock = $null
$taskNodeLock = $null
$taskBytes = $null
$taskChars = $null
$taskBox = $null
$taskWindow = $null
$taskSecretPointer = [IntPtr]::Zero
$taskSecure = $null
$taskExit = 1

function Assert-LocalPathName([string]$Path) {
    # Require a normal absolute drive path, not UNC/device paths, alternate
    # streams or Win32 names that alias a different file.
    if ($Path -cnotmatch '^[A-Za-z]:[\\/]' -or $Path.Substring(2).Contains(':')) { throw 'Path rejected' }
    foreach ($taskPart in ($Path.Substring(3) -split '[\\/]')) {
        if ($taskPart -in @('.', '..') -or $taskPart -match '[. ]$' -or
            $taskPart -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'Path rejected' }
    }
}

function Assert-PrivatePath([string]$Path, [bool]$Directory) {
    Assert-LocalPathName $Path
    $taskItem = Get-Item -LiteralPath $Path -Force
    if ($taskItem.PSIsContainer -ne $Directory -or ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Path rejected'
    }
    $taskParent = if ($Directory) { $taskItem } else { $taskItem.Directory }
    while ($null -ne $taskParent) {
        if (($taskParent.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            (Test-Path -LiteralPath (Join-Path $taskParent.FullName '.git'))) { throw 'Path rejected' }
        $taskParent = $taskParent.Parent
    }
    # Node's POSIX mode argument does not restrict Windows ACLs. Require an
    # already-private owner-controlled location; never alter ACLs here.
    $taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $taskAllowed = @($taskSid, 'S-1-5-18', 'S-1-5-32-544')
    $taskAcl = Get-Acl -LiteralPath $taskItem.FullName
    if ($taskAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $taskSid) { throw 'Owner rejected' }
    $taskDescriptor = [Security.AccessControl.RawSecurityDescriptor]::new($taskAcl.GetSecurityDescriptorBinaryForm(), 0)
    if ($null -eq $taskDescriptor.DiscretionaryAcl -or -not
        ($taskDescriptor.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclPresent)) {
        throw 'ACL rejected'
    }
    foreach ($taskRule in $taskAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($taskRule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            $taskRule.IdentityReference.Value -notin $taskAllowed) { throw 'ACL rejected' }
    }
    return $taskItem.FullName
}

function Open-TrustedNode([string]$Path) {
    # A version string is not executable identity. Authenticate the reviewed
    # Windows Node artifact before executing it or accepting an owner key.
    Assert-LocalPathName $Path
    $taskRuntime = Get-Item -LiteralPath $Path -Force
    if ($taskRuntime.PSIsContainer -or $taskRuntime.Name -ine 'node.exe' -or
        ($taskRuntime.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Runtime rejected' }
    $taskAncestor = $taskRuntime.Directory
    while ($null -ne $taskAncestor) {
        if ($taskAncestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Runtime rejected' }
        $taskAncestor = $taskAncestor.Parent
    }
    $taskRuntimeLock = [IO.File]::Open($taskRuntime.FullName, [IO.FileMode]::Open,
        [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $taskDigest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($taskRuntimeLock)).ToLowerInvariant()
        if ($taskDigest -cne '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237') { throw 'Runtime rejected' }
        # Retain this read-only handle until signing exits so the checked bytes
        # cannot be replaced or modified during private owner review.
        return [pscustomobject]@{ Path = $taskRuntime.FullName; Stream = $taskRuntimeLock }
    } catch {
        $taskRuntimeLock.Dispose()
        throw
    }
}

# The Node CLI calls this fixed read-only branch before consuming owner stdin,
# and again after writing, so direct Windows CLI use cannot bypass ACL checks.
# It runs on Windows PowerShell 5.1 without loading WPF or executing a child.
if ($CheckPrivatePaths) {
    try {
        $null = Assert-PrivatePath $InputPath $false
        Assert-LocalPathName $OutputPath
        $null = Assert-PrivatePath ([IO.Path]::GetDirectoryName($OutputPath)) $true
        if ($OutputExists) { $null = Assert-PrivatePath $OutputPath $false }
        elseif (Test-Path -LiteralPath $OutputPath) { throw 'Output exists' }
        [Console]::Out.WriteLine('PRIVATE_PATHS_VERIFIED')
        exit 0
    } catch {
        [Console]::Out.WriteLine('PRIVATE_PATHS_REJECTED')
        exit 1
    }
}

function New-PrivateProcess([string]$Executable, [string[]]$Arguments) {
    $taskInfo = [Diagnostics.ProcessStartInfo]::new()
    $taskInfo.FileName = $Executable
    $taskInfo.UseShellExecute = $false
    $taskInfo.CreateNoWindow = $true
    $taskInfo.RedirectStandardInput = $true
    $taskInfo.RedirectStandardOutput = $true
    $taskInfo.RedirectStandardError = $true
    $taskInfo.Environment.Clear()
    $taskInfo.Environment['SystemRoot'] = [Environment]::GetFolderPath('Windows')
    foreach ($taskArgument in $Arguments) { $taskInfo.ArgumentList.Add($taskArgument) }
    $taskChild = [Diagnostics.Process]::new()
    $taskChild.StartInfo = $taskInfo
    return $taskChild
}

function Read-LocalCheck([string]$Executable, [string[]]$Arguments, [int]$TimeoutMs = 15000) {
    $taskChild = New-PrivateProcess $Executable $Arguments
    try {
        if (-not $taskChild.Start()) { throw 'Check stopped' }
        $taskChild.StandardInput.Close()
        $taskOutput = $taskChild.StandardOutput.ReadToEndAsync()
        $taskErrors = $taskChild.StandardError.ReadToEndAsync()
        if (-not $taskChild.WaitForExit($TimeoutMs)) { throw 'Check stopped' }
        if ($taskChild.ExitCode -ne 0 -or $taskErrors.GetAwaiter().GetResult().Length -ne 0) { throw 'Check stopped' }
        return $taskOutput.GetAwaiter().GetResult().Trim()
    } finally {
        if ($taskChild.Id -and -not $taskChild.HasExited) { $taskChild.Kill(); $taskChild.WaitForExit() }
        $taskChild.Dispose()
    }
}

try {
    if ($PSVersionTable.PSVersion.Major -lt 7 -or -not $IsWindows -or
        [Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { throw 'Private UI unavailable' }
    $taskInput = Assert-PrivatePath $InputPath $false
    Assert-LocalPathName $OutputPath
    if (Test-Path -LiteralPath $OutputPath) { throw 'Output rejected' }
    $taskOutputParent = Assert-PrivatePath ([IO.Path]::GetDirectoryName($OutputPath)) $true
    $taskOutputPath = Join-Path $taskOutputParent ([IO.Path]::GetFileName($OutputPath))
    $taskTrustedNode = Open-TrustedNode $NodePath
    $taskNode = $taskTrustedNode.Path
    $taskNodeLock = $taskTrustedNode.Stream
    if ((Read-LocalCheck $taskNode @('--version')) -cne 'v24.19.0') { throw 'Runtime rejected' }
    $taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
    $taskGit = (Get-Command git -CommandType Application -ErrorAction Stop).Source
    if ((Read-LocalCheck $taskGit @('-C', $taskRoot, 'rev-parse', 'HEAD')) -cne $UtilityRevision) { throw 'Source rejected' }
    $taskSourcePaths = @('src/zoho-catalyst/revenue-desk-release', 'src/zoho-catalyst/revenue-desk-call-runtime')
    $taskStatusArgs = @('--no-optional-locks', '-C', $taskRoot, '-c', 'core.fsmonitor=false', 'status', '--porcelain', '--untracked-files=all', '--') + $taskSourcePaths
    if ((Read-LocalCheck $taskGit $taskStatusArgs).Length -ne 0) { throw 'Source rejected' }
    # Hold the reviewed input open for reads only through owner consent and
    # signing. Another process cannot replace/edit it between review and use.
    $taskInputLock = [IO.File]::Open($taskInput, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    if ($taskInputLock.Length -gt 262144) { throw 'Input rejected' }
    $taskInputHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($taskInputLock)).ToLowerInvariant()
    $taskHelper = Join-Path $PSScriptRoot 'sign-free-test-staging-packet.js'
    $taskSignerArguments = @($taskHelper, '--input', $taskInput, '--output', $taskOutputPath,
        '--expected-revision', $ExpectedRevision, '--expected-operator-hash', $ExpectedOperatorHash,
        '--max-body-bytes', [string]$MaxBodyBytes, '--powershell-path', (Join-Path $PSHOME 'pwsh.exe'))
    # Validate this locked input and its actual route limit before asking for
    # protected entry. Allow the inner read-only ACL check its bounded 15s.
    $taskPreflight = (Read-LocalCheck $taskNode ($taskSignerArguments + @('--validate-only')) 20000) | ConvertFrom-Json
    if ($taskPreflight.status -cne 'VALIDATED_UNSIGNED_PACKET_NO_SIGNATURE' -or
        $taskPreflight.sourceRevision -cne $ExpectedRevision -or $taskPreflight.maxBodyBytes -ne $MaxBodyBytes -or
        $taskPreflight.signaturePresent -ne $false -or $taskPreflight.submitted -ne $false) { throw 'Preflight rejected' }
    Add-Type -AssemblyName PresentationFramework
    [xml]$taskXaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
 Title="Sylvara - private offline configuration signing" Width="640" SizeToContent="Height"
 WindowStartupLocation="CenterScreen" ResizeMode="NoResize">
 <StackPanel Margin="24">
  <TextBlock TextWrapping="Wrap" Margin="0,0,0,12">Offline only. No request, deployment, email, call or provider operation will run. This is not a login.</TextBlock>
  <TextBlock Name="ReviewDetails" TextWrapping="Wrap" Margin="0,0,0,12"/>
  <CheckBox Name="Reviewed" Margin="0,0,0,12"><TextBlock TextWrapping="Wrap">I privately reviewed this exact packet, its business rules, monitored recipient and intended Development target. I authorize signing these contents only.</TextBlock></CheckBox>
  <TextBlock TextWrapping="Wrap" Margin="0,0,0,6">Paste the existing ROUTE_CONTROL_OPERATOR_HMAC_SECRET from Catalyst Development, function revenue_desk_route_control, Configuration. Do not generate or rotate it here. Ctrl+V works in the masked field.</TextBlock>
  <PasswordBox Name="KeyBox" Height="32" MaxLength="4096"/>
  <TextBlock TextWrapping="Wrap" Margin="0,12,0,12">No secret enters command history or an environment variable. It passes to the local signer in memory. Do not record or screenshot private entry. Signing does not authenticate exported evidence or authorize submission.</TextBlock>
  <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
   <Button IsCancel="True" Width="85" Height="32" Margin="0,0,10,0">Cancel</Button>
   <Button Name="SignButton" IsDefault="True" Width="160" Height="32">Sign offline packet</Button>
  </StackPanel>
 </StackPanel>
</Window>
'@
    $taskReader = [Xml.XmlNodeReader]::new($taskXaml)
    try { $taskWindow = [Windows.Markup.XamlReader]::Load($taskReader) } finally { $taskReader.Dispose() }
    $taskBox = $taskWindow.FindName('KeyBox')
    $taskReviewed = $taskWindow.FindName('Reviewed')
    $taskWindow.FindName('ReviewDetails').Text = "Review file privately: $taskInput`nInput SHA-256: $taskInputHash`nTarget release: $ExpectedRevision`nVerified route body limit: $MaxBodyBytes bytes"
    $taskWindow.FindName('SignButton').Add_Click({
        if ($taskReviewed.IsChecked -eq $true -and $taskBox.SecurePassword.Length -ge 32) { $taskWindow.DialogResult = $true }
    })
    if ($taskWindow.ShowDialog() -ne $true) { throw 'Cancelled' }
    if ((Read-LocalCheck $taskGit @('-C', $taskRoot, 'rev-parse', 'HEAD')) -cne $UtilityRevision -or
        (Read-LocalCheck $taskGit $taskStatusArgs).Length -ne 0) { throw 'Source rejected' }
    $taskNodeRecheck = Open-TrustedNode $NodePath
    try {
        if ($taskNodeRecheck.Path -cne $taskNode) { throw 'Runtime rejected' }
    } finally { $taskNodeRecheck.Stream.Dispose() }
    $taskSecure = $taskBox.SecurePassword
    if ($taskSecure.Length -lt 32 -or $taskSecure.Length -gt 4096) { throw 'Secret format rejected' }
    $taskSecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecure)
    $taskChars = [char[]]::new($taskSecure.Length)
    try {
        for ($taskIndex = 0; $taskIndex -lt $taskChars.Length; $taskIndex++) {
            $taskCodeUnit = [Runtime.InteropServices.Marshal]::ReadInt16(
                $taskSecretPointer, $taskIndex * 2)
            $taskChars[$taskIndex] = [char]($taskCodeUnit -band 0xffff)
        }
        # Preserve exact runtime string content without trimming. Node encodes
        # valid surrogate pairs normally and replaces lone UTF-16 surrogates
        # with U+FFFD before HMAC; the replacement fallback matches that rule.
        $taskUtf8 = [Text.UTF8Encoding]::new($false, $false)
        $taskBytes = $taskUtf8.GetBytes($taskChars)
        if ($taskBytes.Length -gt 12288) { throw 'Secret format rejected' }
    } finally {
        if ($taskChars) { [Array]::Clear($taskChars, 0, $taskChars.Length) }
        $taskChars = $null
    }
    $taskBox.Clear()
    $taskProcess = New-PrivateProcess $taskNode $taskSignerArguments
    if (-not $taskProcess.Start()) { throw 'Signer stopped' }
    $taskOutput = $taskProcess.StandardOutput.ReadToEndAsync()
    $taskErrors = $taskProcess.StandardError.ReadToEndAsync()
    $taskProcess.StandardInput.BaseStream.Write($taskBytes, 0, $taskBytes.Length)
    $taskProcess.StandardInput.Close()
    [Array]::Clear($taskBytes, 0, $taskBytes.Length)
    if (-not $taskProcess.WaitForExit(30000)) { throw 'Signer stopped' }
    if ($taskProcess.ExitCode -ne 0 -or $taskErrors.GetAwaiter().GetResult().Length -ne 0) { throw 'Signer stopped' }
    $taskResult = $taskOutput.GetAwaiter().GetResult() | ConvertFrom-Json
    if ($taskResult.status -cne 'SIGNED_PACKET_READY_NO_SUBMISSION' -or $taskResult.submitted -ne $false -or
        $taskResult.retryAllowed -ne $false -or $taskResult.sourceRevision -cne $ExpectedRevision -or
        $taskResult.maxBodyBytes -ne $MaxBodyBytes -or
        $taskResult.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Result rejected' }
    $null = Assert-PrivatePath $taskOutputPath $false
    if ((Get-FileHash -LiteralPath $taskOutputPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $taskResult.sha256) { throw 'Readback rejected' }
    Write-Host 'SIGNED_PACKET_READY_NO_SUBMISSION. No cloud action occurred. Keep the packet private.'
    Write-Host ('Packet SHA-256: ' + $taskResult.sha256)
    $taskExit = 0
} catch {
    # Suppress exception/child text: it can contain private paths, contents or
    # OS diagnostics. Never retry or delete an ambiguous output automatically.
    Write-Host 'OFFLINE SIGNING STOPPED. Nothing was submitted. Preserve any output; do not retry or share secrets/screenshots.'
} finally {
    if ($taskBytes) { [Array]::Clear($taskBytes, 0, $taskBytes.Length) }
    if ($taskChars) { [Array]::Clear($taskChars, 0, $taskChars.Length) }
    if ($taskSecretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskSecretPointer) }
    if ($taskSecure) { $taskSecure.Dispose() }
    if ($taskBox) { $taskBox.Clear() }
    if ($taskInputLock) { $taskInputLock.Dispose() }
    if ($taskProcess) {
        try { if (-not $taskProcess.HasExited) { $taskProcess.Kill(); $taskProcess.WaitForExit() } } catch {}
        $taskProcess.Dispose()
    }
    if ($taskNodeLock) { $taskNodeLock.Dispose() }
}
exit $taskExit
