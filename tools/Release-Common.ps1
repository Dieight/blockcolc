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

    Assert-DeviceNotBusy -Serial $Serial -Context $Context -AllowBusyDevice:$AllowBusyDevice
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
