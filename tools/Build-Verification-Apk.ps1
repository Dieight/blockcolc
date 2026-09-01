[CmdletBinding()]
param(
    [string[]]$Serial,
    [switch]$AllowBusyDevice
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')

$context = Get-ReleaseContext
$artifactDirectory = Join-Path $context.Root "artifacts\verification\v$($context.VersionName)"
$buildApk = Join-Path $context.Root 'apps\android\android\app\build\outputs\apk\release\app-release.apk'
$verificationName = $context.ApkName -replace '\.apk$', '-verification.apk'
$verificationApk = Join-Path $artifactDirectory $verificationName
$evidencePath = Join-Path $artifactDirectory 'verification-evidence.json'

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
    $sourceEvidence = Get-WorkingTreeEvidence -Root $context.Root

    & (Join-Path $PSScriptRoot 'Build-AndroidRelease.ps1')

    $buildMetadata = Assert-ApkMetadata -Path $buildApk -Context $context
    New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
    Copy-Item -LiteralPath $buildApk -Destination $verificationApk -Force
    $verificationHash = Get-Sha256 -Path $verificationApk
    Assert-Sha256Equal -Expected $buildMetadata.Sha256 -Actual $verificationHash -Boundary 'build output to verification copy'
    $verificationMetadata = Assert-ApkMetadata -Path $verificationApk -Context $context

    $authorized = @(Get-AuthorizedAndroidDevices)
    $targets = if (@($Serial).Count -gt 0) { @($Serial) } else { $authorized }
    foreach ($target in $targets) {
        if ($authorized -notcontains $target) { throw "Android device is not connected and authorized: $target" }
    }

    $devices = @()
    foreach ($target in $targets) {
        $devices += Install-AndVerifyApk -ApkPath $verificationApk -Serial $target -Context $context -ExpectedSha256 $verificationHash -AllowBusyDevice:$AllowBusyDevice
    }

    $evidence = [ordered]@{
        schemaVersion = 1
        phase = 'device-verification'
        releasable = $false
        builtAt = (Get-Date).ToUniversalTime().ToString('o')
        versionName = $context.VersionName
        versionCode = $context.VersionCode
        packageId = $context.PackageId
        signerSha256 = $context.SignerSha256
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
    Write-Warning 'This signed APK is for device verification only. Run Prepare-Release.ps1 after user acceptance to create a releasable candidate.'
}
finally {
    Pop-Location
}
