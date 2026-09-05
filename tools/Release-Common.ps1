Set-StrictMode -Version Latest

function Invoke-External {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter()][string[]]$Arguments = @(),
        [switch]$Capture
    )

    if ($Capture) {
        $output = & $FilePath @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "$FilePath failed with exit code $LASTEXITCODE.`n$($output -join "`n")"
        }
        return $output
    }

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE."
    }
}

function Invoke-TimedReleaseStep {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$Action,
        [Parameter(Mandatory)][System.Collections.IDictionary]$Durations
    )

    Write-Host "==> $Name"
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $passed = $false
    try {
        & $Action
        $passed = $true
    }
    finally {
        $stopwatch.Stop()
        $seconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 1)
        $Durations[$Name] = $seconds
        $status = if ($passed) { 'passed' } else { 'failed' }
        Write-Host "<== $Name $status in $seconds s"
    }
}

function Get-RepositoryRoot {
    return Split-Path -Parent $PSScriptRoot
}

function Get-ReleaseContext {
    $root = Get-RepositoryRoot
    $version = Get-Content -LiteralPath (Join-Path $root 'version.json') -Raw | ConvertFrom-Json
    $config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-config.json') -Raw | ConvertFrom-Json
    [pscustomobject]@{
        Root = $root
        VersionName = [string]$version.versionName
        VersionCode = [int]$version.versionCode
        PackageId = [string]$config.packageId
        SignerSha256 = ([string]$config.signerSha256).ToLowerInvariant()
        Repository = [string]$config.repository
        Branch = [string]$config.branch
        ApkName = ([string]$config.apkNameTemplate).Replace('{version}', [string]$version.versionName)
    }
}

function Get-ReleaseEvidencePath {
    param([Parameter(Mandatory)]$Context)
    return Join-Path $Context.Root "artifacts\release\v$($Context.VersionName)\release-evidence.json"
}

function Get-Sha256 {
    param([Parameter(Mandatory)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-Sha256Equal {
    param(
        [Parameter(Mandatory)][string]$Expected,
        [Parameter(Mandatory)][string]$Actual,
        [Parameter(Mandatory)][string]$Boundary
    )

    if ($Expected.ToLowerInvariant() -ne $Actual.ToLowerInvariant()) {
        throw "SHA-256 mismatch at $Boundary. Expected $Expected, found $Actual."
    }
    Write-Host "Verified SHA-256 at $Boundary ($($Actual.ToLowerInvariant()))"
}

function Get-AndroidBuildTool {
    param([Parameter(Mandatory)][string]$Name)
    $buildToolsRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk\build-tools'
    $candidate = Get-ChildItem -LiteralPath $buildToolsRoot -Directory |
        Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending |
        ForEach-Object { Join-Path $_.FullName $Name } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
    if (-not $candidate) { throw "Android build tool not found: $Name" }
    return $candidate
}

function Get-AdbPath {
    $adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
    if (-not (Test-Path -LiteralPath $adb -PathType Leaf)) { throw "ADB not found: $adb" }
    return $adb
}

function Get-ApkMetadata {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "APK not found: $Path" }

    $aapt = Get-AndroidBuildTool -Name 'aapt.exe'
    $badging = (Invoke-External -FilePath $aapt -Arguments @('dump', 'badging', $Path) -Capture) -join "`n"
    $package = [regex]::Match($badging, "package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'")
    if (-not $package.Success) { throw "Unable to parse APK package metadata: $Path" }

    $apksigner = Get-AndroidBuildTool -Name 'apksigner.bat'
    $signature = (Invoke-External -FilePath $apksigner -Arguments @('verify', '--verbose', '--print-certs', $Path) -Capture) -join "`n"
    $digest = [regex]::Match($signature, '(?im)certificate SHA-256 digest:\s*([0-9a-f]+)')
    if (-not $digest.Success) { throw "Unable to parse APK signing certificate: $Path" }

    [pscustomobject]@{
        PackageId = $package.Groups[1].Value
        VersionCode = [int]$package.Groups[2].Value
        VersionName = $package.Groups[3].Value
        SignerSha256 = $digest.Groups[1].Value.ToLowerInvariant()
        Sha256 = Get-Sha256 -Path $Path
        SizeBytes = (Get-Item -LiteralPath $Path).Length
    }
}

function Assert-ApkMetadata {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Context
    )
    $metadata = Get-ApkMetadata -Path $Path
    if ($metadata.PackageId -ne $Context.PackageId) { throw "Unexpected package id: $($metadata.PackageId)" }
    if ($metadata.VersionName -ne $Context.VersionName) { throw "Unexpected versionName: $($metadata.VersionName)" }
    if ($metadata.VersionCode -ne $Context.VersionCode) { throw "Unexpected versionCode: $($metadata.VersionCode)" }
    if ($metadata.SignerSha256 -ne $Context.SignerSha256) { throw "Unexpected signer SHA-256: $($metadata.SignerSha256)" }
    Write-Host "Verified APK metadata $($metadata.PackageId) $($metadata.VersionName) ($($metadata.VersionCode))."
    return $metadata
}

function Get-ForegroundPackage {
    param([Parameter(Mandatory)][string]$Serial)
    try {
        $adb = Get-AdbPath
        $dump = (Invoke-External -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'dumpsys', 'activity', 'activities') -Capture) -join "`n"
        $match = [regex]::Match($dump, '(?im)ResumedActivity[^\r\n]*?([a-z][a-z0-9_.]+)/')
        if ($match.Success) { return $match.Groups[1].Value }
    } catch { }
    return $null
}

function Get-DefaultLauncherPackage {
    param([Parameter(Mandatory)][string]$Serial)
    try {
        $adb = Get-AdbPath
        $dump = (Invoke-External -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'cmd', 'shortcut', 'get-default-launcher') -Capture) -join ' '
        $match = [regex]::Match($dump, '(?i)ComponentInfo\{([a-z][a-z0-9_.]+)/')
        if (-not $match.Success) { $match = [regex]::Match($dump, '(?i)launcher:\s*([a-z][a-z0-9_.]+)') }
        if ($match.Success) { return $match.Groups[1].Value }
    } catch { }
    return $null
}

function Assert-DeviceNotBusy {
    param(
        [Parameter(Mandatory)][string]$Serial,
        [Parameter(Mandatory)]$Context,
        [switch]$AllowBusyDevice
    )
    if ($AllowBusyDevice) { return }
    try {
        $adb = Get-AdbPath
        $power = (Invoke-External -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'dumpsys', 'power') -Capture) -join "`n"
        if ($power -notmatch 'mWakefulness=Awake') { return }
        $foreground = Get-ForegroundPackage -Serial $Serial
        if (-not $foreground -or $foreground -eq $Context.PackageId) { return }
        $launcher = Get-DefaultLauncherPackage -Serial $Serial
        if ($launcher -and $foreground -eq $launcher) { return }
        throw "Device $Serial is busy (foreground: $foreground). Release verification must not interrupt active use; disconnect the device or pass -AllowBusyDevice."
    } catch {
        if ($_.Exception.Message -like 'Device * is busy*') { throw }
        Write-Warning "Could not verify device $Serial is idle ($($_.Exception.Message)); proceeding."
    }
}

function Get-AuthorizedAndroidDevices {
    $adb = Get-AdbPath
    $lines = Invoke-External -FilePath $adb -Arguments @('devices', '-l') -Capture
    $devices = @()
    foreach ($line in $lines) {
        if ($line -match '^([^\s]+)\s+device(?:\s|$)') { $devices += $Matches[1] }
    }
    return $devices
}

function Install-AndVerifyApk {
    param(
        [Parameter(Mandatory)][string]$ApkPath,
        [Parameter(Mandatory)][string]$Serial,
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)][string]$ExpectedSha256,
        [switch]$AllowBusyDevice
    )

    # Refuse before `adb install`: replacing an APK is already a device
    # mutation, so a late busy check cannot make this stage safely resumable.
    Assert-DeviceNotBusy -Serial $Serial -Context $Context -AllowBusyDevice:$AllowBusyDevice
    $adb = Get-AdbPath
    $installOutput = (Invoke-External -FilePath $adb -Arguments @('-s', $Serial, 'install', '-r', $ApkPath) -Capture) -join "`n"
    if ($installOutput -notmatch '(?im)^Success\s*$') { throw "ADB install did not report success for $Serial.`n$installOutput" }

    $packageDump = (Invoke-External -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'dumpsys', 'package', $Context.PackageId) -Capture) -join "`n"
    if ($packageDump -notmatch "versionName=$([regex]::Escape($Context.VersionName))(?:\s|$)") { throw "Installed versionName does not match on $Serial." }
    if ($packageDump -notmatch "versionCode=$($Context.VersionCode)(?:\s|$)") { throw "Installed versionCode does not match on $Serial." }

    $pathOutput = Invoke-External -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'pm', 'path', $Context.PackageId) -Capture
    $baseApk = ($pathOutput | Where-Object { $_ -match '^package:.*base\.apk\s*$' } | Select-Object -First 1) -replace '^package:', ''
    if (-not $baseApk) { throw "Unable to locate installed base.apk on $Serial." }
    $deviceHashOutput = (Invoke-External -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'sha256sum', $baseApk) -Capture) -join ' '
    $deviceHash = [regex]::Match($deviceHashOutput, '^[0-9a-fA-F]{64}').Value.ToLowerInvariant()
    if (-not $deviceHash) { throw "Unable to calculate installed APK SHA-256 on $Serial." }
    Assert-Sha256Equal -Expected $ExpectedSha256 -Actual $deviceHash -Boundary "device $Serial installed base.apk"

    $null = Invoke-External -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'am', 'start', '-n', "$($Context.PackageId)/.MainActivity") -Capture
    [pscustomobject]@{ Serial = $Serial; InstalledSha256 = $deviceHash; VersionName = $Context.VersionName; VersionCode = $Context.VersionCode }
}

function Get-StagedDiffSha256 {
    $temporary = [IO.Path]::GetTempFileName()
    try {
        Invoke-External -FilePath 'git' -Arguments @('diff', '--cached', '--binary', "--output=$temporary")
        return Get-Sha256 -Path $temporary
    }
    finally {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    }
}

function Get-StagedTestFingerprintSha256 {
    $manifest = [IO.Path]::GetTempFileName()
    try {
        $paths = @(Invoke-External -FilePath 'git' -Arguments @('ls-files') -Capture | Where-Object {
            $_ -match '(^|/)(test|tests|e2e)/' -or
            $_ -match '(^|/)(playwright|vitest)[^/]*\.(?:ts|js|mjs|json)$' -or
            $_ -match '(^|/)package(?:-lock)?\.json$' -or
            $_ -match '^tools/(?:run-web-e2e|Prepare-Release|Test-).+\.(?:mjs|ps1)$'
        } | Sort-Object -Unique)
        if ($paths.Count -eq 0) { throw 'No staged test inputs were found for the release fingerprint.' }
        $entries = foreach ($path in $paths) {
            $blob = (Invoke-External -FilePath 'git' -Arguments @('rev-parse', ":$path") -Capture | Select-Object -First 1).ToString().Trim()
            "$path`t$blob"
        }
        Set-Content -LiteralPath $manifest -Value $entries -Encoding utf8
        return Get-Sha256 -Path $manifest
    }
    finally {
        Remove-Item -LiteralPath $manifest -Force -ErrorAction SilentlyContinue
    }
}

function Set-EvidenceProperty {
    param(
        [Parameter(Mandatory)]$Evidence,
        [Parameter(Mandatory)][string]$Name,
        [Parameter()]$Value
    )
    $Evidence | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Write-ReleaseEvidence {
    param(
        [Parameter(Mandatory)]$Evidence,
        [Parameter(Mandatory)][string]$Path
    )
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $Evidence | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Assert-ReleaseEvidenceVersion {
    param(
        [Parameter(Mandatory)]$Evidence,
        [Parameter(Mandatory)]$Context
    )
    if ([string]$Evidence.versionName -ne $Context.VersionName -or [int]$Evidence.versionCode -ne $Context.VersionCode) {
        throw 'Release evidence version does not match version.json.'
    }
    if ([string]$Evidence.packageId -ne $Context.PackageId) { throw 'Release evidence package id does not match release config.' }
    if ([string]$Evidence.signerSha256 -ne $Context.SignerSha256) { throw 'Release evidence signer does not match release config.' }
}

function Assert-ReleaseEvidenceMatchesStagedState {
    param([Parameter(Mandatory)]$Evidence)
    Assert-StagedState
    $currentTree = (Invoke-External -FilePath 'git' -Arguments @('write-tree') -Capture | Select-Object -First 1).ToString().Trim()
    if ($currentTree -ne [string]$Evidence.stagedTree) { throw 'Staged tree changed after release preparation.' }
    $currentDiffHash = Get-StagedDiffSha256
    Assert-Sha256Equal -Expected ([string]$Evidence.stagedDiffSha256) -Actual $currentDiffHash -Boundary 'prepared release staged diff'
    $currentTestFingerprint = Get-StagedTestFingerprintSha256
    Assert-Sha256Equal -Expected ([string]$Evidence.testFingerprintSha256) -Actual $currentTestFingerprint -Boundary 'prepared release test inputs'
}

function Assert-ReleaseCandidateEvidence {
    param(
        [Parameter(Mandatory)]$Evidence,
        [Parameter(Mandatory)]$Context,
        [string]$Boundary = 'release candidate evidence'
    )
    $candidateApk = [string]$Evidence.candidateApk
    $candidateHash = Get-Sha256 -Path $candidateApk
    Assert-Sha256Equal -Expected ([string]$Evidence.candidateSha256) -Actual $candidateHash -Boundary $Boundary
    Assert-ApkMetadata -Path $candidateApk -Context $Context | Out-Null
    return [pscustomobject]@{ Path = $candidateApk; Sha256 = $candidateHash }
}

function Assert-AcceptedReleaseEvidence {
    param([Parameter(Mandatory)]$Evidence)
    if ([string]$Evidence.phase -ne 'accepted') { throw "Release evidence is not accepted: $($Evidence.phase)" }
    if (-not $Evidence.acceptance) { throw 'Accepted release evidence is missing its acceptance record.' }
    if (@($Evidence.installations).Count -eq 0) { throw 'Accepted release evidence has no verified device installation.' }
    Assert-Sha256Equal -Expected ([string]$Evidence.candidateSha256) -Actual ([string]$Evidence.acceptance.candidateSha256) -Boundary 'prepared candidate to user acceptance'
    if ([string]$Evidence.stagedTree -ne [string]$Evidence.acceptance.stagedTree) { throw 'Accepted staged tree does not match prepared staged tree.' }
    Assert-Sha256Equal -Expected ([string]$Evidence.stagedDiffSha256) -Actual ([string]$Evidence.acceptance.stagedDiffSha256) -Boundary 'prepared staged diff to user acceptance'
    Assert-Sha256Equal -Expected ([string]$Evidence.testFingerprintSha256) -Actual ([string]$Evidence.acceptance.testFingerprintSha256) -Boundary 'prepared test inputs to user acceptance'
    foreach ($installation in @($Evidence.installations)) {
        Assert-Sha256Equal -Expected ([string]$Evidence.candidateSha256) -Actual ([string]$installation.InstalledSha256) -Boundary "candidate to accepted device $($installation.Serial)"
    }
}

function Assert-ReleaseWorkPacketComplete {
    param([Parameter(Mandatory)]$Context)
    $packet = Join-Path $Context.Root "docs\versions\V$($Context.VersionCode).md"
    if (-not (Test-Path -LiteralPath $packet -PathType Leaf)) { throw "Version work packet not found: $packet" }
    $content = Get-Content -LiteralPath $packet -Raw
    $rows = [regex]::Matches($content, '(?m)^\|\s*([A-Z]+-\d+-\d+)\s*\|\s*([^|]+?)\s*\|')
    if ($rows.Count -eq 0) { throw "No requirement status rows found in version work packet: $packet" }
    $incomplete = @($rows | Where-Object { $_.Groups[2].Value.Trim() -ne '完成' } | ForEach-Object { "$($_.Groups[1].Value)=$($_.Groups[2].Value.Trim())" })
    if ($incomplete.Count -gt 0) { throw "Version work packet has incomplete requirements: $($incomplete -join ', ')" }
    Write-Host "Verified version work packet is complete: $packet"
}

function Assert-StagedState {
    Invoke-External -FilePath 'git' -Arguments @('diff', '--quiet')
    & git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) { throw 'No staged changes. Stage the coherent release contents before preparation.' }
    if ($LASTEXITCODE -ne 1) { throw "Unable to inspect staged changes (exit $LASTEXITCODE)." }

    $stagedFiles = Invoke-External -FilePath 'git' -Arguments @('diff', '--cached', '--name-only', '--diff-filter=ACMR') -Capture
    $forbidden = '(?i)(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|C:\\Users\\[^\\\s]+)'
    foreach ($relativePath in $stagedFiles) {
        if (-not $relativePath) { continue }
        $path = Join-Path (Get-RepositoryRoot) $relativePath
        if ((Test-Path -LiteralPath $path -PathType Leaf) -and (Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue) -match $forbidden) {
            throw "Potential credential or personal absolute path found in staged file: $relativePath"
        }
    }
}
