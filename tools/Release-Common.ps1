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

function Get-ApkBuildChannel {
    param([Parameter(Mandatory)][string]$ManifestTree)
    foreach ($element in ($ManifestTree -split '(?m)^\s*E: ')) {
        if ($element -notmatch '^meta-data\b' -or $element -notmatch '"com\.blockcolc\.PRIVATE_RELAY"') { continue }
        if ($element -match 'android:value[^\r\n]*\(type 0x12\)0x0\b') { return 'standard' }
        if ($element -match 'android:value[^\r\n]*\(type 0x12\)0xffffffff\b') { return 'private-relay' }
        throw 'Unrecognized private relay build marker.'
    }
    return 'standard' # Older standard APKs predate the marker.
}

function Get-ApkPerformanceDiagnostics {
    param([Parameter(Mandatory)][string]$ManifestTree)
    foreach ($element in ($ManifestTree -split '(?m)^\s*E: ')) {
        if ($element -notmatch '^meta-data\b' -or $element -notmatch '"com\.blockcolc\.PERFORMANCE_DIAGNOSTICS"') { continue }
        if ($element -match 'android:value[^\r\n]*\(type 0x12\)0x0\b') { return $false }
        if ($element -match 'android:value[^\r\n]*\(type 0x12\)0xffffffff\b') { return $true }
        throw 'Unrecognized performance diagnostic build marker.'
    }
    return $false
}

function Get-ApkMetadata {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "APK not found: $Path" }

    $aapt = Get-AndroidBuildTool -Name 'aapt.exe'
    $badging = (Invoke-External -FilePath $aapt -Arguments @('dump', 'badging', $Path) -Capture) -join "`n"
    $package = [regex]::Match($badging, "package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'")
    if (-not $package.Success) { throw "Unable to parse APK package metadata: $Path" }
    $manifestTree = (Invoke-External -FilePath $aapt -Arguments @('dump', 'xmltree', $Path, 'AndroidManifest.xml') -Capture) -join "`n"
    $buildChannel = Get-ApkBuildChannel -ManifestTree $manifestTree

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
        BuildChannel = $buildChannel
        PerformanceDiagnostics = Get-ApkPerformanceDiagnostics -ManifestTree $manifestTree
    }
}

function Assert-ApkMetadata {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Context,
        [switch]$AllowPrivateRelay,
        [switch]$AllowPerformanceDiagnostics
    )
    $metadata = Get-ApkMetadata -Path $Path
    if ($metadata.PerformanceDiagnostics -and -not $AllowPerformanceDiagnostics) { throw 'Performance diagnostic APK is not a final verification/publication candidate.' }
    if ($metadata.BuildChannel -eq 'private-relay' -and -not $AllowPrivateRelay) {
        throw 'Private relay APK cannot enter the standard verification or publication workflow.'
    }
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

function Get-InstalledApkMetadata {
    param(
        [Parameter(Mandatory)][string]$Serial,
        [Parameter(Mandatory)][string]$PackageId
    )

    $adb = Get-AdbPath
    $packageDump = (Invoke-External -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'dumpsys', 'package', $PackageId) -Capture) -join "`n"
    if ($packageDump -notmatch '(?m)versionCode=(\d+)') { return $null }
    $reportedCode = [int]$Matches[1]
    $pathOutput = Invoke-External -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'pm', 'path', $PackageId) -Capture
    $baseApk = ($pathOutput | Where-Object { $_ -match '^package:.*base\.apk\s*$' } | Select-Object -First 1) -replace '^package:', ''
    if (-not $baseApk) { throw "Installed package $PackageId has no base.apk on $Serial." }
    $remoteHashOutput = (Invoke-External -FilePath $adb -Arguments @('-s', $Serial, 'shell', 'sha256sum', $baseApk) -Capture) -join ' '
    $remoteHash = [regex]::Match($remoteHashOutput, '^[0-9a-fA-F]{64}').Value.ToLowerInvariant()
    if (-not $remoteHash) { throw "Unable to calculate installed APK SHA-256 on $Serial." }

    $temporaryApk = Join-Path ([IO.Path]::GetTempPath()) "blockcolc-installed-$([guid]::NewGuid().ToString('N')).apk"
    try {
        $null = Invoke-External -FilePath $adb -Arguments @('-s', $Serial, 'pull', $baseApk, $temporaryApk) -Capture
        $metadata = Get-ApkMetadata -Path $temporaryApk
        Assert-Sha256Equal -Expected $remoteHash -Actual $metadata.Sha256 -Boundary "device $Serial metadata readback"
        if ($metadata.PackageId -ne $PackageId -or $metadata.VersionCode -ne $reportedCode) {
            throw "Installed package metadata changed during readback on $Serial."
        }
        return $metadata
    } finally {
        Remove-Item -LiteralPath $temporaryApk -Force -ErrorAction SilentlyContinue
    }
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

function Get-ApkPublicAssets {
    param([Parameter(Mandatory)][string]$Path)
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $entries = foreach ($entry in ($archive.Entries | Sort-Object FullName)) {
            if ($entry.FullName -notlike 'assets/public/*' -or $entry.FullName.EndsWith('/')) { continue }
            $stream = $entry.Open()
            try { $hash = (Get-FileHash -InputStream $stream -Algorithm SHA256).Hash.ToLowerInvariant() }
            finally { $stream.Dispose() }
            [pscustomobject][ordered]@{ path = $entry.FullName; bytes = $entry.Length; sha256 = $hash }
        }
        if (@($entries).Count -eq 0) { throw 'APK has no public core assets.' }
        return @($entries)
    } finally { $archive.Dispose() }
}

function Assert-PairedReleaseEvidence {
    param(
        [Parameter(Mandatory)]$Evidence,
        [Parameter(Mandatory)]$Pair,
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)][object[]]$StandardAssets,
        [Parameter(Mandatory)][object[]]$PrivateAssets
    )
    Assert-ReleaseEvidenceVersion -Evidence $Evidence -Context $Context
    if ($Pair.versionName -cne $Context.VersionName -or $Pair.versionCode -ne $Context.VersionCode -or
        $Pair.packageId -cne $Context.PackageId -or $Pair.signerSha256 -cne $Context.SignerSha256) {
        throw 'Paired evidence application identity differs from the candidate.'
    }
    if ([string]::IsNullOrWhiteSpace([string]$Evidence.deliveryRoundId) -or $Pair.deliveryRoundId -cne $Evidence.deliveryRoundId) {
        throw 'Paired evidence must use the candidate DeliveryRoundId.'
    }
    Assert-Sha256Equal -Expected $Evidence.candidateSha256 -Actual $Pair.standard.sha256 -Boundary 'paired standard candidate'
    if ($Pair.private.sha256 -notmatch '^[0-9a-f]{64}$' -or $Pair.standard.isolation -ne 'passed' -or $Pair.private.isolation -ne 'passed') {
        throw 'Paired evidence lacks valid private digest or isolation checks.'
    }
    $requiredGates = @('version','releaseWorkflow','fixtures','uiAssets','typecheck','unit','extendedUnit','storageE2e','coreLoopE2e','webE2e','androidBuild')
    foreach ($gate in $requiredGates) {
        if ((Get-OptionalEvidenceProperty -Object $Evidence.gates -Name $gate) -ne 'passed') { throw "Candidate gate did not pass: $gate" }
    }
    if ($Pair.fullReleaseGate -ne 'passed' -or $Pair.sharedCore.sameBytes -ne $true -or $StandardAssets.Count -eq 0) {
        throw 'Paired evidence is not complete and passing.'
    }
    $standardManifest = $StandardAssets | ConvertTo-Json -Depth 4 -Compress
    $privateManifest = $PrivateAssets | ConvertTo-Json -Depth 4 -Compress
    $recordedManifest = @($Pair.sharedCore.entries) | ConvertTo-Json -Depth 4 -Compress
    if ($standardManifest -cne $privateManifest -or $standardManifest -cne $recordedManifest) {
        throw 'Actual APK core assets do not match each other and the paired evidence.'
    }
    foreach ($channel in @($Pair.standard, $Pair.private)) {
        $tests = $channel.android.tests
        if ($tests.tests -lt 1 -or $tests.failures -ne 0 -or $tests.errors -ne 0 -or $tests.skipped -ne 0 -or $channel.android.lintErrors -ne 0) {
            throw 'Paired Android checks are not complete and passing.'
        }
    }
}

function Assert-ReleaseWorkPacketComplete {
    param([Parameter(Mandatory)]$Context)
    $packet = Join-Path $Context.Root "docs\versions\V$($Context.VersionCode).md"
    if (-not (Test-Path -LiteralPath $packet -PathType Leaf)) { throw "Version work packet not found: $packet" }
    $content = Get-Content -LiteralPath $packet -Raw
    $rows = [regex]::Matches($content, '(?m)^\|\s*([A-Z]+-\d+-\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|')
    if ($rows.Count -eq 0) { throw "No requirement status rows found in version work packet: $packet" }
    $incomplete = @($rows | Where-Object { $_.Groups[2].Value.Trim() -ne '完成' } | ForEach-Object { "$($_.Groups[1].Value)=$($_.Groups[2].Value.Trim())" })
    if ($incomplete.Count -gt 0) { throw "Version work packet has incomplete requirements: $($incomplete -join ', ')" }
    $missingEvidence = @()
    $root = [IO.Path]::GetFullPath($Context.Root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $packetDirectory = Split-Path -Parent $packet
    foreach ($row in $rows) {
        if ($row.Groups[2].Value.Trim() -ne '完成') { continue }
        $evidence = $row.Groups[3].Value.Trim()
        $localPath = $null
        $linkMatch = [regex]::Match($evidence, '\[[^\]]+\]\(([^)#]+)')
        $linkPath = $null
        if ($linkMatch.Success -and $linkMatch.Groups[1].Value -notmatch '^https?://') {
            $linkPath = [Uri]::UnescapeDataString(($linkMatch.Groups[1].Value -split '[?#]', 2)[0])
        } elseif ($evidence -match '(?i)https?://\S+') {
            continue
        } elseif ($evidence -match '(?:^|\s|`)\.?(?:[/\\])?((?:[\w.-]+[/\\])+[\w./\\-]+|[\w.-]+\.(?:md|json|txt|html|png|log))(?:`|[\s,，;；）)]|$)') {
            $localPath = $Matches[1]
        }
        if ($linkPath) {
            if ([IO.Path]::IsPathRooted($linkPath)) { $missingEvidence += $row.Groups[1].Value; continue }
            $candidate = [IO.Path]::GetFullPath((Join-Path $packetDirectory $linkPath))
        } elseif ($localPath) {
            $candidate = [IO.Path]::GetFullPath((Join-Path $Context.Root $localPath))
        } else {
            $missingEvidence += $row.Groups[1].Value
            continue
        }
        if (-not $candidate.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            $missingEvidence += $row.Groups[1].Value
        }
    }
    if ($missingEvidence.Count -gt 0) { throw "Completed work packet rows need a locatable evidence path, URL, or report reference: $($missingEvidence -join ', ')" }
    Write-Host "Verified version work packet is complete: $packet"
}

function Get-DeliveredApkHistory {
    param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)][ValidateSet('standard', 'private-relay', 'all')][string]$Channel,
        [string[]]$AdditionalEvidenceRoots = @()
    )

    $roots = @($Context.Root) + @($AdditionalEvidenceRoots | Where-Object { $_ })
    if ($Channel -eq 'all') {
        $workspaceParent = Split-Path -Parent ([IO.Path]::GetFullPath($Context.Root))
        if (Test-Path -LiteralPath $workspaceParent -PathType Container) {
            $roots += @(Get-ChildItem -LiteralPath $workspaceParent -Directory -ErrorAction SilentlyContinue |
                Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'tools\Install-PrivateVerification.ps1') } |
                ForEach-Object { $_.FullName })
        }
    }
    $history = @()
    foreach ($root in $roots | Select-Object -Unique) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        $releaseRoot = Join-Path $root 'artifacts\release'
        $verificationRoot = Join-Path $root 'artifacts\verification'
        $artifactsRoot = Join-Path $root 'artifacts'
        $evidenceFiles = @()
        if (Test-Path -LiteralPath $releaseRoot -PathType Container) {
            $evidenceFiles += Get-ChildItem -LiteralPath $releaseRoot -Filter 'release-evidence.json' -File -Recurse -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $verificationRoot -PathType Container) {
            $evidenceFiles += Get-ChildItem -LiteralPath $verificationRoot -Filter 'verification-evidence.json' -File -Recurse -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $artifactsRoot -PathType Container) {
            $evidenceFiles += Get-ChildItem -LiteralPath $artifactsRoot -Filter 'installation-evidence.json' -File -Recurse -ErrorAction SilentlyContinue
            $evidenceFiles += Get-ChildItem -LiteralPath $artifactsRoot -Filter 'upload-evidence.json' -File -Recurse -ErrorAction SilentlyContinue
        }
        $seenEvidence = @{}
        foreach ($file in $evidenceFiles) {
            if ($seenEvidence.ContainsKey($file.FullName)) { continue }
            $seenEvidence[$file.FullName] = $true
            try { $evidence = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json -ErrorAction Stop }
            catch { continue }

            $packageId = [string](Get-OptionalEvidenceProperty -Object $evidence -Name 'packageId')
            $phase = [string](Get-OptionalEvidenceProperty -Object $evidence -Name 'phase')
            $candidateSha256 = [string](Get-OptionalEvidenceProperty -Object $evidence -Name 'candidateSha256')
            $deliveryRoundId = [string](Get-OptionalEvidenceProperty -Object $evidence -Name 'deliveryRoundId')
            $installations = @(Get-OptionalEvidenceProperty -Object $evidence -Name 'installations')
            $evidenceMetadata = Get-OptionalEvidenceProperty -Object $evidence -Name 'metadata'

            $record = $null
            if ($packageId -eq $Context.PackageId -and $phase -eq 'published' -and $candidateSha256) {
                $record = [pscustomobject]@{
                    Channel = 'standard'; PackageId = $packageId; VersionName = [string](Get-OptionalEvidenceProperty -Object $evidence -Name 'versionName')
                    VersionCode = [int](Get-OptionalEvidenceProperty -Object $evidence -Name 'versionCode'); SignerSha256 = ([string](Get-OptionalEvidenceProperty -Object $evidence -Name 'signerSha256')).ToLowerInvariant()
                    Sha256 = $candidateSha256.ToLowerInvariant(); DeliveryRoundId = $deliveryRoundId; EvidencePath = $file.FullName; Kind = 'published'
                }
            } elseif ($packageId -eq $Context.PackageId -and $phase -in @('installed', 'accepted') -and $candidateSha256 -and $installations.Count -gt 0) {
                $installedCandidate = @($installations | Where-Object { ([string](Get-OptionalEvidenceProperty -Object $_ -Name 'InstalledSha256')).ToLowerInvariant() -eq $candidateSha256.ToLowerInvariant() })
                if ($installedCandidate.Count -gt 0) {
                    $record = [pscustomobject]@{
                        Channel = 'standard'; PackageId = $packageId; VersionName = [string](Get-OptionalEvidenceProperty -Object $evidence -Name 'versionName')
                        VersionCode = [int](Get-OptionalEvidenceProperty -Object $evidence -Name 'versionCode'); SignerSha256 = ([string](Get-OptionalEvidenceProperty -Object $evidence -Name 'signerSha256')).ToLowerInvariant()
                        Sha256 = $candidateSha256.ToLowerInvariant(); DeliveryRoundId = $deliveryRoundId; EvidencePath = $file.FullName; Kind = 'device-install'
                    }
                }
            } elseif ($evidenceMetadata -and (Get-OptionalEvidenceProperty -Object $evidenceMetadata -Name 'BuildChannel') -and (Get-OptionalEvidenceProperty -Object $evidence -Name 'repository') -and (Get-OptionalEvidenceProperty -Object $evidence -Name 'commit') -and (Get-OptionalEvidenceProperty -Object $evidence -Name 'sha256')) {
                $channelName = [string](Get-OptionalEvidenceProperty -Object $evidenceMetadata -Name 'BuildChannel')
                if ($channelName -in @('standard', 'private-relay')) {
                    $record = [pscustomobject]@{
                        Channel = $channelName; PackageId = [string](Get-OptionalEvidenceProperty -Object $evidenceMetadata -Name 'PackageId'); VersionName = [string](Get-OptionalEvidenceProperty -Object $evidenceMetadata -Name 'VersionName')
                        VersionCode = [int](Get-OptionalEvidenceProperty -Object $evidenceMetadata -Name 'VersionCode'); SignerSha256 = ([string](Get-OptionalEvidenceProperty -Object $evidenceMetadata -Name 'SignerSha256')).ToLowerInvariant()
                        Sha256 = ([string](Get-OptionalEvidenceProperty -Object $evidence -Name 'sha256')).ToLowerInvariant(); DeliveryRoundId = [string](Get-OptionalEvidenceProperty -Object $evidence -Name 'deliveryRoundId'); EvidencePath = $file.FullName; Kind = 'private-repository-delivery'
                    }
                }
            } elseif ($evidenceMetadata -and (Get-OptionalEvidenceProperty -Object $evidenceMetadata -Name 'BuildChannel') -and (Get-OptionalEvidenceProperty -Object $evidence -Name 'installedAt') -and (Get-OptionalEvidenceProperty -Object $evidenceMetadata -Name 'Sha256')) {
                $channelName = [string](Get-OptionalEvidenceProperty -Object $evidenceMetadata -Name 'BuildChannel')
                if ($channelName -in @('standard', 'private-relay')) {
                    $record = [pscustomobject]@{
                        Channel = $channelName; PackageId = [string](Get-OptionalEvidenceProperty -Object $evidenceMetadata -Name 'PackageId'); VersionName = [string](Get-OptionalEvidenceProperty -Object $evidenceMetadata -Name 'VersionName')
                        VersionCode = [int](Get-OptionalEvidenceProperty -Object $evidenceMetadata -Name 'VersionCode'); SignerSha256 = ([string](Get-OptionalEvidenceProperty -Object $evidenceMetadata -Name 'SignerSha256')).ToLowerInvariant()
                        Sha256 = ([string](Get-OptionalEvidenceProperty -Object $evidenceMetadata -Name 'Sha256')).ToLowerInvariant(); DeliveryRoundId = [string](Get-OptionalEvidenceProperty -Object $evidence -Name 'deliveryRoundId'); EvidencePath = $file.FullName; Kind = 'device-install'
                    }
                }
            } elseif ((Get-OptionalEvidenceProperty -Object $evidence -Name 'apkSha256') -and @(Get-OptionalEvidenceProperty -Object $evidence -Name 'devices').Count -gt 0) {
                $channelName = if (Get-OptionalEvidenceProperty -Object $evidence -Name 'buildChannel') { [string](Get-OptionalEvidenceProperty -Object $evidence -Name 'buildChannel') } else { 'standard' }
                if ($channelName -in @('standard', 'private-relay') -and $packageId -eq $Context.PackageId) {
                    $record = [pscustomobject]@{
                        Channel = $channelName; PackageId = $packageId; VersionName = [string](Get-OptionalEvidenceProperty -Object $evidence -Name 'versionName')
                        VersionCode = [int](Get-OptionalEvidenceProperty -Object $evidence -Name 'versionCode'); SignerSha256 = ([string](Get-OptionalEvidenceProperty -Object $evidence -Name 'signerSha256')).ToLowerInvariant()
                        Sha256 = ([string](Get-OptionalEvidenceProperty -Object $evidence -Name 'apkSha256')).ToLowerInvariant(); DeliveryRoundId = $deliveryRoundId; EvidencePath = $file.FullName; Kind = 'device-install'
                    }
                }
            }

            if ($record -and $record.PackageId -eq $Context.PackageId -and ($Channel -eq 'all' -or $record.Channel -eq $Channel) -and $record.VersionCode -gt 0 -and $record.SignerSha256) {
                $history += $record
            }
        }
    }
    if ($Channel -ne 'all') { $history = @($history | Where-Object { $_.Channel -eq $Channel }) }
    return @($history | Sort-Object VersionCode, EvidencePath -Unique)
}

function Get-OptionalEvidenceProperty {
    param([Parameter(Mandatory)]$Object, [Parameter(Mandatory)][string]$Name)
    $property = $Object.PSObject.Properties[$Name]
    if ($property) { return $property.Value }
    return $null
}

function Assert-NextDeliveredApkVersion {
    param(
        [Parameter(Mandatory)]$Metadata,
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)][ValidateSet('standard', 'private-relay')][string]$Channel,
        [Parameter(Mandatory)]$History,
        [string]$DeliveryRoundId
    )

    if ($Metadata.PackageId -ne $Context.PackageId -or $Metadata.SignerSha256 -ne $Context.SignerSha256) {
        throw 'APK package or signer identity does not match the configured application identity.'
    }
    $relevant = @($History | Where-Object { $_.PackageId -eq $Metadata.PackageId })
    foreach ($prior in $relevant) {
        if ($prior.SignerSha256 -ne $Metadata.SignerSha256) { throw "Delivered $Channel APK signer identity changed for package $($Metadata.PackageId). Evidence: $($prior.EvidencePath)" }
    }
    if ($relevant.Count -eq 0) { return }
    $latestCode = ($relevant | Measure-Object -Property VersionCode -Maximum).Maximum
    $latestRecords = @($relevant | Where-Object { [int]$_.VersionCode -eq [int]$latestCode })
    if ([int]$Metadata.VersionCode -lt [int]$latestCode) {
        $latest = $latestRecords | Select-Object -First 1
        throw "APK versionCode $($Metadata.VersionCode) is older than last delivered $Channel versionCode $($latestCode) ($($latest.VersionName))."
    }
    if ([int]$Metadata.VersionCode -eq [int]$latestCode) {
        $sameChannel = @($latestRecords | Where-Object { $_.Channel -eq $Channel })
        $differentHashes = @($sameChannel | Where-Object { ([string]$Metadata.Sha256).ToLowerInvariant() -ne [string]$_.Sha256 })
        if ($differentHashes.Count -gt 0) {
            throw "VersionCode $($Metadata.VersionCode) was already delivered with a different APK hash for channel '$Channel'. Identical-hash redelivery is allowed; create a new code for changed bytes."
        }
        if ($sameChannel.Count -gt 0) { return } # Exact bytes already delivered, including legacy evidence without round IDs.
        $otherChannels = @($latestRecords | Where-Object { $_.Channel -ne $Channel })
        foreach ($other in $otherChannels) {
            $otherRoundId = [string](Get-OptionalEvidenceProperty -Object $other -Name 'DeliveryRoundId')
            if (-not $DeliveryRoundId -or -not $otherRoundId -or $DeliveryRoundId -cne $otherRoundId -or [string]$Metadata.VersionName -cne [string]$other.VersionName) {
                throw "VersionCode $($Metadata.VersionCode) already belongs to another delivery channel. A matching DeliveryRoundId recorded in both channels is required to declare a same-round delivery."
            }
        }
    }
}

function Assert-NotOlderThanDeliveredVersion {
    param(
        [Parameter(Mandatory)][int]$VersionCode,
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)][ValidateSet('standard', 'private-relay', 'all')][string]$Channel,
        [Parameter(Mandatory)]$History
    )

    $relevant = @($History | Where-Object { $_.PackageId -eq $Context.PackageId -and ($Channel -eq 'all' -or $_.Channel -eq $Channel) })
    if ($relevant.Count -eq 0) { return }
    $latestCode = ($relevant | Measure-Object -Property VersionCode -Maximum).Maximum
    if ($VersionCode -lt [int]$latestCode) {
        $latest = $relevant | Where-Object { [int]$_.VersionCode -eq [int]$latestCode } | Select-Object -First 1
        throw "Configured versionCode $VersionCode is older than last delivered $Channel versionCode $latestCode ($($latest.VersionName))."
    }
}

function Get-WebReleaseReportIndex {
    param(
        [Parameter(Mandatory)][string]$RepositoryRoot,
        [Parameter(Mandatory)][datetime]$StartedAtUtc
    )

    $reportRoot = Join-Path $RepositoryRoot 'artifacts\test-gates\web-release'
    if (-not (Test-Path -LiteralPath $reportRoot -PathType Container)) { throw "Web release runner archive is missing: $reportRoot" }
    $reportFile = Get-ChildItem -LiteralPath $reportRoot -Filter '*.json' -File |
        Where-Object { $_.LastWriteTimeUtc -ge $StartedAtUtc } |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if (-not $reportFile) { throw 'The Web release gate did not archive a runner report during this preparation.' }
    $report = Get-Content -LiteralPath $reportFile.FullName -Raw | ConvertFrom-Json
    $reportStartedAt = [DateTimeOffset]::MinValue
    # ConvertFrom-Json can return DateTime rather than text. A plain string
    # cast loses its UTC/offset and fractional seconds; keep round-trip form.
    $startedAtValue = Get-OptionalEvidenceProperty -Object $report -Name 'startedAt'
    $startedAtText = if ($startedAtValue -is [datetime] -or $startedAtValue -is [DateTimeOffset]) {
        $startedAtValue.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
    } else { [string]$startedAtValue }
    if (-not [DateTimeOffset]::TryParse($startedAtText, [ref]$reportStartedAt) -or $reportStartedAt.UtcDateTime -lt $StartedAtUtc) {
        throw "Web release runner report predates this preparation: $($reportFile.FullName)"
    }
    $reportFinishedAt = [DateTimeOffset]::MinValue
    $finishedAtValue = Get-OptionalEvidenceProperty -Object $report -Name 'finishedAt'
    $finishedAtText = if ($finishedAtValue -is [datetime] -or $finishedAtValue -is [DateTimeOffset]) {
        $finishedAtValue.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
    } else { [string]$finishedAtValue }
    if (-not [DateTimeOffset]::TryParse($finishedAtText, [ref]$reportFinishedAt) -or $reportFinishedAt -lt $reportStartedAt) {
        throw "Web release runner report has no valid finish time: $($reportFile.FullName)"
    }
    if ($report.status -ne 'passed' -or @($report.suites).Count -eq 0) { throw "Web release runner report is not complete and passing: $($reportFile.FullName)" }
    $runnerExitCode = 0
    $runnerExitProperty = $report.PSObject.Properties['exitCode']
    if (-not $runnerExitProperty -or $null -eq $runnerExitProperty.Value -or -not [int]::TryParse([string]$runnerExitProperty.Value, [ref]$runnerExitCode) -or $runnerExitCode -ne 0) {
        throw "Web release runner report has no successful process exit code: $($reportFile.FullName)"
    }
    $retryCount = 0
    $flakyCount = 0
    $skipCount = 0
    $attemptCount = 0
    $suiteFailures = @()
    $suiteReportReferences = @()
    foreach ($suite in @($report.suites)) {
        $exitCode = 0
        $suiteRetries = 0
        $suiteFlaky = 0
        $suiteSkipped = 0
        $suiteAttempts = 0
        $exitProperty = $suite.PSObject.Properties['exitCode']
        if (-not $exitProperty -or $null -eq $exitProperty.Value -or [string]::IsNullOrWhiteSpace([string]$exitProperty.Value) -or
            -not [int]::TryParse([string](Get-OptionalEvidenceProperty -Object $suite -Name 'exitCode'), [ref]$exitCode) -or
            -not [int]::TryParse([string](Get-OptionalEvidenceProperty -Object $suite -Name 'retryCount'), [ref]$suiteRetries) -or
            -not [int]::TryParse([string](Get-OptionalEvidenceProperty -Object $suite -Name 'flakyTestCount'), [ref]$suiteFlaky) -or
            -not [int]::TryParse([string](Get-OptionalEvidenceProperty -Object $suite -Name 'skippedTestCount'), [ref]$suiteSkipped) -or
            -not [int]::TryParse([string](Get-OptionalEvidenceProperty -Object $suite -Name 'attemptCount'), [ref]$suiteAttempts) -or $suiteAttempts -lt 1) {
            throw "Web release runner report is missing a valid suite exit/retry/skip summary: $($reportFile.FullName)"
        }
        if ($exitCode -ne 0 -or $suite.status -ne 'passed') { $suiteFailures += $suite }
        $suiteReportPath = [string](Get-OptionalEvidenceProperty -Object $suite -Name 'playwrightReport')
        $suiteReportHash = [string](Get-OptionalEvidenceProperty -Object $suite -Name 'playwrightReportSha256')
        if (-not $suiteReportPath -or [IO.Path]::IsPathRooted($suiteReportPath)) { throw "Web release suite has no repository-relative Playwright report reference: $($suite.name)" }
        $suiteReportAbsolutePath = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot $suiteReportPath))
        $repositoryPrefix = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if (-not $suiteReportAbsolutePath.StartsWith($repositoryPrefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $suiteReportAbsolutePath -PathType Leaf)) {
            throw "Web release suite Playwright report is missing or escapes the repository: $suiteReportPath"
        }
        Assert-Sha256Equal -Expected $suiteReportHash -Actual (Get-Sha256 -Path $suiteReportAbsolutePath) -Boundary "Playwright suite report $($suite.name)"
        $playwrightReport = Get-Content -LiteralPath $suiteReportAbsolutePath -Raw | ConvertFrom-Json
        $playwrightTests = New-Object 'System.Collections.Generic.List[object]'
        $collect = {
            param($node)
            $specProperty = $node.PSObject.Properties['specs']
            if ($specProperty) {
                foreach ($spec in @($specProperty.Value)) {
                    $testProperty = $spec.PSObject.Properties['tests']
                    if ($testProperty) { foreach ($test in @($testProperty.Value)) { $playwrightTests.Add($test) } }
                }
            }
            $childProperty = $node.PSObject.Properties['suites']
            if ($childProperty) { foreach ($child in @($childProperty.Value)) { & $collect $child } }
        }
        $rootSuitesProperty = $playwrightReport.PSObject.Properties['suites']
        if (-not $rootSuitesProperty) { throw "Playwright suite report has no suites array: $suiteReportPath" }
        foreach ($suiteNode in @($rootSuitesProperty.Value)) { & $collect $suiteNode }
        $actualRetryCount = 0
        $actualFlakyCount = 0
        foreach ($test in $playwrightTests) {
            $results = @($test.results)
            $actualRetryCount += [Math]::Max(0, $results.Count - 1)
            if ([string]$test.status -eq 'flaky' -or ($results.Count -gt 1 -and [string]$results[-1].status -eq 'passed' -and @($results | Select-Object -First ($results.Count - 1) | Where-Object { $_.status -ne 'passed' }).Count -gt 0)) { $actualFlakyCount++ }
        }
        $actualSkippedCount = @($playwrightTests | Where-Object { [string]$_.status -eq 'skipped' }).Count
        if ($actualRetryCount -ne $suiteRetries -or $actualFlakyCount -ne $suiteFlaky -or $actualSkippedCount -ne $suiteSkipped) {
            throw "Web release suite summary does not match its Playwright report: $($suite.name)"
        }
        $suiteReportReferences += [pscustomobject]@{ Name = [string]$suite.name; Path = $suiteReportPath; Sha256 = $suiteReportHash; RetryCount = $suiteRetries; FlakyCount = $suiteFlaky; SkipCount = $suiteSkipped; ExitCode = $exitCode }
        $retryCount += $suiteRetries
        $flakyCount += $suiteFlaky
        $skipCount += $suiteSkipped
        $attemptCount += $suiteAttempts
    }
    if ($suiteFailures.Count -gt 0) { throw "Web release runner report has failed suites: $($suiteFailures.name -join ', ')" }
    $summaryRetries = 0
    $summaryFlaky = 0
    $summaryAttempts = 0
    if (-not [int]::TryParse([string]$report.retryCount, [ref]$summaryRetries) -or $summaryRetries -ne $retryCount -or
        -not [int]::TryParse([string]$report.flakyTestCount, [ref]$summaryFlaky) -or $summaryFlaky -ne $flakyCount -or
        -not [int]::TryParse([string]$report.attemptCount, [ref]$summaryAttempts) -or $summaryAttempts -ne $attemptCount -or
        $skipCount -ne @($report.skippedTests).Count) {
        throw "Web release runner aggregate retry/flaky/skip counts do not match its suites: $($reportFile.FullName)"
    }
    $repositoryRootFullPath = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $reportFile.FullName.StartsWith($repositoryRootFullPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Web release runner report is outside the repository root.' }
    $relativePath = $reportFile.FullName.Substring($repositoryRootFullPath.Length).Replace('\', '/')
    return [pscustomobject]@{
        Name = 'webE2e'
        Path = $relativePath
        Sha256 = Get-Sha256 -Path $reportFile.FullName
        Status = [string]$report.status
        ExitCode = $runnerExitCode
        SkipCount = $skipCount
        RetryCount = $retryCount
        FlakyCount = $flakyCount
        FinishedAt = $finishedAtText
        StartedAt = $startedAtText
        SuiteCount = @($report.suites).Count
        AttemptCount = $attemptCount
        SuiteReports = @($suiteReportReferences)
    }
}

function Assert-ReleaseReportIndex {
    param([Parameter(Mandatory)]$Evidence, [Parameter(Mandatory)]$Context)
    $reports = @(Get-OptionalEvidenceProperty -Object $Evidence -Name 'reportIndex')
    if ([int](Get-OptionalEvidenceProperty -Object $Evidence -Name 'schemaVersion') -ge 3 -and $reports.Count -eq 0) {
        throw 'Schema 3 release evidence is missing its runner report index.'
    }
    foreach ($report in $reports) {
        $relativePath = [string](Get-OptionalEvidenceProperty -Object $report -Name 'path')
        if (-not $relativePath -or [IO.Path]::IsPathRooted($relativePath)) { throw 'Release report index path must be repository-relative.' }
        $path = [IO.Path]::GetFullPath((Join-Path $Context.Root $relativePath))
        $rootPrefix = [IO.Path]::GetFullPath($Context.Root).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        if (-not $path.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Release report index escapes the repository root.' }
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Indexed release report is missing: $relativePath" }
        Assert-Sha256Equal -Expected ([string](Get-OptionalEvidenceProperty -Object $report -Name 'sha256')) -Actual (Get-Sha256 -Path $path) -Boundary "indexed release report $relativePath"
        $reportExitCode = -1
        $reportExitProperty = $report.PSObject.Properties['exitCode']
        if ((Get-OptionalEvidenceProperty -Object $report -Name 'status') -ne 'passed' -or -not $reportExitProperty -or $null -eq $reportExitProperty.Value -or -not [int]::TryParse([string]$reportExitProperty.Value, [ref]$reportExitCode) -or $reportExitCode -ne 0) {
            throw "Indexed release report is not passing: $relativePath"
        }
        $suiteReports = @(Get-OptionalEvidenceProperty -Object $report -Name 'suiteReports')
        if ([int](Get-OptionalEvidenceProperty -Object $Evidence -Name 'schemaVersion') -ge 4 -and $suiteReports.Count -eq 0) {
            throw "Schema 4 release report index is missing suite-level Playwright reports: $relativePath"
        }
        foreach ($suiteReport in $suiteReports) {
            $suitePath = [string](Get-OptionalEvidenceProperty -Object $suiteReport -Name 'Path')
            if (-not $suitePath -or [IO.Path]::IsPathRooted($suitePath)) { throw 'Playwright suite report path must be repository-relative.' }
            $suiteAbsolute = [IO.Path]::GetFullPath((Join-Path $Context.Root $suitePath))
            if (-not $suiteAbsolute.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $suiteAbsolute -PathType Leaf)) {
                throw "Indexed Playwright suite report is missing or escapes repository root: $suitePath"
            }
            Assert-Sha256Equal -Expected ([string](Get-OptionalEvidenceProperty -Object $suiteReport -Name 'Sha256')) -Actual (Get-Sha256 -Path $suiteAbsolute) -Boundary "indexed Playwright report $suitePath"
            $suiteExitCode = -1
            $suiteExitProperty = $suiteReport.PSObject.Properties['ExitCode']
            if (-not $suiteExitProperty -or $null -eq $suiteExitProperty.Value -or -not [int]::TryParse([string]$suiteExitProperty.Value, [ref]$suiteExitCode) -or $suiteExitCode -ne 0) { throw "Indexed Playwright suite did not pass: $suitePath" }
        }
    }
}

function Assert-ReleaseArchiveWritable {
    param([Parameter(Mandatory)][string]$EvidencePath)
    if (-not (Test-Path -LiteralPath $EvidencePath -PathType Leaf)) { return }
    $existing = Get-Content -LiteralPath $EvidencePath -Raw | ConvertFrom-Json
    $phase = [string](Get-OptionalEvidenceProperty -Object $existing -Name 'phase')
    if ($phase -ne 'prepared') {
        throw "Release archive is immutable after delivery or acceptance ($phase). Choose a new release version; do not overwrite $EvidencePath."
    }
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
