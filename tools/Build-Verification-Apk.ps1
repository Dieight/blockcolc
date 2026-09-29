[CmdletBinding()]
param(
    [string[]]$Serial,
    [switch]$AllowBusyDevice,
    [switch]$ArtifactOnly,
    [string]$DeliveryRoundId
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')

$context = Get-ReleaseContext
$artifactDirectory = Join-Path $context.Root "artifacts\verification\v$($context.VersionName)\build-$($context.VersionCode)-$([guid]::NewGuid().ToString('N'))"
$buildApk = Join-Path $context.Root 'apps\android\android\app\build\outputs\apk\release\app-release.apk'
$verificationName = $context.ApkName -replace '\.apk$', '-verification.apk'
$verificationApk = Join-Path $artifactDirectory $verificationName
$evidencePath = Join-Path $artifactDirectory 'verification-evidence.json'
$deliveredHistory = @(Get-DeliveredApkHistory -Context $context -Channel all)
Assert-NotOlderThanDeliveredVersion -VersionCode $context.VersionCode -Context $context -Channel all -History $deliveredHistory

function Get-WorkingTreeEvidence {
    param([Parameter(Mandatory)][string]$Root)

    $trackedDiff = [IO.Path]::GetTempFileName()
    $fingerprintInput = [IO.Path]::GetTempFileName()
    try {
        Invoke-External -FilePath 'git' -Arguments @('diff', 'HEAD', '--binary', "--output=$trackedDiff")
        $untracked = @()
        foreach ($relativePath in (Invoke-External -FilePath 'git' -Arguments @('ls-files', '--others', '--exclude-standard') -Capture | Sort-Object)) {
            if (-not $relativePath) { continue }
            $absolutePath = Join-Path $Root $relativePath
            $untracked += [ordered]@{ path = $relativePath; sha256 = Get-Sha256 -Path $absolutePath }
        }
        $source = [ordered]@{
            head = ((Invoke-External -FilePath 'git' -Arguments @('rev-parse', 'HEAD') -Capture | Select-Object -First 1).ToString().Trim())
            trackedDiffSha256 = Get-Sha256 -Path $trackedDiff
            untracked = @($untracked)
        }
        $source | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $fingerprintInput -Encoding utf8
        return [pscustomobject]@{
            Head = $source.head
            TrackedDiffSha256 = $source.trackedDiffSha256
            Untracked = @($untracked)
            FingerprintSha256 = Get-Sha256 -Path $fingerprintInput
            Status = @((Invoke-External -FilePath 'git' -Arguments @('status', '--short') -Capture))
        }
    }
    finally {
        Remove-Item -LiteralPath $trackedDiff -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $fingerprintInput -Force -ErrorAction SilentlyContinue
    }
}

Push-Location $context.Root
try {
    Write-Host 'Building a signed device-verification APK. This does not run or replace the full release gate.'
    Invoke-External -FilePath 'node' -Arguments @('tools/check-ui-assets.mjs', '--check')
    $sourceEvidence = Get-WorkingTreeEvidence -Root $context.Root

    & (Join-Path $PSScriptRoot 'Build-AndroidRelease.ps1')

    $buildMetadata = Assert-ApkMetadata -Path $buildApk -Context $context
    New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
    Copy-Item -LiteralPath $buildApk -Destination $verificationApk -Force
    $verificationHash = Get-Sha256 -Path $verificationApk
    Assert-Sha256Equal -Expected $buildMetadata.Sha256 -Actual $verificationHash -Boundary 'build output to verification copy'
    $verificationMetadata = Assert-ApkMetadata -Path $verificationApk -Context $context

    $devices = @()
    $targets = @()
    if ($ArtifactOnly) {
        Write-Host 'Artifact-only verification requested; skipping Android device discovery and installation.'
    } else {
        $authorized = @(Get-AuthorizedAndroidDevices)
        $targets = if (@($Serial).Count -gt 0) { @($Serial) } else { $authorized }
        foreach ($target in $targets) {
            if ($authorized -notcontains $target) { throw "Android device is not connected and authorized: $target" }
        }

        if (@($targets).Count -gt 0) {
            foreach ($target in $targets) {
                $installedMetadata = Get-InstalledApkMetadata -Serial $target -PackageId $context.PackageId
                if (-not $installedMetadata) { continue }
                if ($installedMetadata.SignerSha256 -ne $context.SignerSha256) { throw "Installed app signer identity does not match release config on $target." }
                $knownDelivery = @($deliveredHistory | Where-Object { $_.PackageId -eq $installedMetadata.PackageId -and $_.VersionCode -eq $installedMetadata.VersionCode -and $_.Sha256 -eq $installedMetadata.Sha256 })
                if ($knownDelivery.Count -gt 0) { continue }
                $deliveredHistory += [pscustomobject]@{
                    Channel = $installedMetadata.BuildChannel; PackageId = $installedMetadata.PackageId
                    VersionName = $installedMetadata.VersionName; VersionCode = $installedMetadata.VersionCode
                    SignerSha256 = $installedMetadata.SignerSha256; Sha256 = $installedMetadata.Sha256
                    EvidencePath = "device:$target"; Kind = 'installed-device'
                    DeliveryRoundId = $null
                }
            }
        }
    }

    Assert-NextDeliveredApkVersion -Metadata $verificationMetadata -Context $context -Channel standard -History $deliveredHistory -DeliveryRoundId $DeliveryRoundId

    if (-not $ArtifactOnly) {
        foreach ($target in $targets) {
            $devices += Install-AndVerifyApk -ApkPath $verificationApk -Serial $target -Context $context -ExpectedSha256 $verificationHash -AllowBusyDevice:$AllowBusyDevice
        }
    }

    $evidence = [ordered]@{
        schemaVersion = 2
        phase = if ($ArtifactOnly) { 'artifact-only-verification' } else { 'device-verification' }
        releasable = $false
        deliveryStatus = if ($ArtifactOnly -or @($devices).Count -eq 0) { 'artifact-only-not-delivered' } else { 'delivered-to-device' }
        builtAt = (Get-Date).ToUniversalTime().ToString('o')
        versionName = $context.VersionName
        versionCode = $context.VersionCode
        packageId = $context.PackageId
        signerSha256 = $context.SignerSha256
        deliveryRoundId = if ([string]::IsNullOrWhiteSpace($DeliveryRoundId)) { $null } else { $DeliveryRoundId.Trim() }
        source = [ordered]@{
            head = $sourceEvidence.Head
            fingerprintSha256 = $sourceEvidence.FingerprintSha256
            trackedDiffSha256 = $sourceEvidence.TrackedDiffSha256
            untracked = @($sourceEvidence.Untracked)
            status = @($sourceEvidence.Status)
        }
        apk = $verificationApk
        apkSizeBytes = $verificationMetadata.SizeBytes
        apkSha256 = $verificationHash
        gates = [ordered]@{
            scope = 'incremental-device-verification'
            version = 'passed'
            fixtures = 'passed'
            webBuild = 'passed'
            androidJvm = 'passed'
            androidLint = 'passed'
            androidReleaseAssembly = 'passed'
            fullReleaseGate = 'not-run'
        }
        devices = @($devices)
    }
    $evidence | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $evidencePath -Encoding utf8
    Write-Host "Verification APK ready: $verificationApk"
    Write-Host "Verification evidence: $evidencePath"
    Write-Warning 'This signed APK is for iterative device verification only. After scope freeze, run Prepare-Release.ps1, install its immutable candidate, and obtain acceptance for that exact hash before publishing.'
}
finally {
    Pop-Location
}
