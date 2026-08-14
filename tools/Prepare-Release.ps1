[CmdletBinding()]
param(
    [switch]$AllowBusyDevice
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')

$context = Get-ReleaseContext
$artifactDirectory = Join-Path $context.Root "artifacts\release\v$($context.VersionName)"
$buildApk = Join-Path $context.Root 'apps\android\android\app\build\outputs\apk\release\app-release.apk'
$candidateApk = Join-Path $artifactDirectory $context.ApkName
$evidencePath = Join-Path $artifactDirectory 'release-evidence.json'
$gateDurations = [ordered]@{}

Push-Location $context.Root
try {
    Assert-StagedState
    Invoke-TimedReleaseStep -Name 'version' -Durations $gateDurations -Action {
        Invoke-External -FilePath 'node' -Arguments @('tools/sync-version.mjs', '--check')
    }
    Invoke-TimedReleaseStep -Name 'fixtures' -Durations $gateDurations -Action {
        & (Join-Path $PSScriptRoot 'Test-FixtureHashes.ps1')
    }
    Invoke-TimedReleaseStep -Name 'typecheck' -Durations $gateDurations -Action {
        Invoke-External -FilePath 'npm' -Arguments @('run', 'typecheck')
    }
    Invoke-TimedReleaseStep -Name 'unit' -Durations $gateDurations -Action {
        Invoke-External -FilePath 'npm' -Arguments @('test')
    }
    Invoke-TimedReleaseStep -Name 'storageE2e' -Durations $gateDurations -Action {
        Invoke-External -FilePath 'npm' -Arguments @('run', 'test:e2e', '-w', '@tomato-clock/storage-indexeddb', '--', '--workers=1')
    }
    Invoke-TimedReleaseStep -Name 'coreLoopE2e' -Durations $gateDurations -Action {
        Invoke-External -FilePath 'npm' -Arguments @('run', 'test:e2e', '-w', '@tomato-clock/core-loop-browser', '--', '--workers=1')
    }
    Invoke-TimedReleaseStep -Name 'webE2e' -Durations $gateDurations -Action {
        Invoke-External -FilePath 'npm' -Arguments @('run', 'test:web:release')
    }
    Invoke-TimedReleaseStep -Name 'androidBuild' -Durations $gateDurations -Action {
        & (Join-Path $PSScriptRoot 'Build-AndroidRelease.ps1') -QualityGateAlreadyPassed
    }

    $buildMetadata = Assert-ApkMetadata -Path $buildApk -Context $context
    New-Item -ItemType Directory -Path $artifactDirectory -Force | Out-Null
    Copy-Item -LiteralPath $buildApk -Destination $candidateApk -Force
    $candidateHash = Get-Sha256 -Path $candidateApk
    Assert-Sha256Equal -Expected $buildMetadata.Sha256 -Actual $candidateHash -Boundary 'build output to release candidate copy'
    $candidateMetadata = Assert-ApkMetadata -Path $candidateApk -Context $context

    $devices = @()
    foreach ($serial in (Get-AuthorizedAndroidDevices)) {
        $devices += Install-AndVerifyApk -ApkPath $candidateApk -Serial $serial -Context $context -ExpectedSha256 $candidateHash -AllowBusyDevice:$AllowBusyDevice
    }

    Assert-StagedState
    $stagedTree = (Invoke-External -FilePath 'git' -Arguments @('write-tree') -Capture | Select-Object -First 1).ToString().Trim()
    $evidence = [ordered]@{
        schemaVersion = 1
        phase = 'prepared'
        preparedAt = (Get-Date).ToUniversalTime().ToString('o')
        versionName = $context.VersionName
        versionCode = $context.VersionCode
        packageId = $context.PackageId
        signerSha256 = $context.SignerSha256
        stagedTree = $stagedTree
        stagedDiffSha256 = Get-StagedDiffSha256
        candidateApk = $candidateApk
        candidateSizeBytes = $candidateMetadata.SizeBytes
        candidateSha256 = $candidateHash
        gates = [ordered]@{ version = 'passed'; fixtures = 'passed'; typecheck = 'passed'; unit = 'passed'; e2e = 'passed'; webBuild = 'passed'; android = 'passed' }
        gateDurationsSeconds = $gateDurations
        devices = @($devices)
    }
    $evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidencePath -Encoding utf8
    Write-Host "Release preparation passed: $evidencePath"
}
finally {
    Pop-Location
}
