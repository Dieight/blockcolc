[CmdletBinding()]
param()

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
    Assert-ReleaseWorkPacketComplete -Context $context
    Invoke-TimedReleaseStep -Name 'version' -Durations $gateDurations -Action {
        Invoke-External -FilePath 'node' -Arguments @('tools/sync-version.mjs', '--check')
    }
    Invoke-TimedReleaseStep -Name 'releaseWorkflow' -Durations $gateDurations -Action {
        & (Join-Path $PSScriptRoot 'Test-ReleaseWorkflow.ps1')
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
    Invoke-TimedReleaseStep -Name 'extendedUnit' -Durations $gateDurations -Action {
        Invoke-External -FilePath 'npm' -Arguments @('run', 'test:extended')
    }
    Invoke-TimedReleaseStep -Name 'storageE2e' -Durations $gateDurations -Action {
        Invoke-External -FilePath 'npm' -Arguments @('run', 'test:e2e', '-w', '@tomato-clock/storage-indexeddb', '--', '--workers=1')
    }
    Invoke-TimedReleaseStep -Name 'coreLoopE2e' -Durations $gateDurations -Action {
        Invoke-External -FilePath 'npm' -Arguments @('run', 'test:e2e', '-w', '@tomato-clock/core-loop-browser', '--', '--workers=1')
    }
    Invoke-TimedReleaseStep -Name 'webE2e' -Durations $gateDurations -Action {
        $previousDeadline = [Environment]::GetEnvironmentVariable('E2E_COMPLETION_DEADLINE_MS', 'Process')
        try {
            # A single-worker release run currently takes about 25 minutes on
            # the local software-WebGL gate. The explicit release deadline also
            # activates the documented physical-device ownership of the one
            # synchronous 3D drag probe.
            $env:E2E_COMPLETION_DEADLINE_MS = '2400000'
            Invoke-External -FilePath 'npm' -Arguments @('run', 'test:web:release')
        }
        finally {
            if ($null -eq $previousDeadline) { Remove-Item Env:E2E_COMPLETION_DEADLINE_MS -ErrorAction SilentlyContinue }
            else { $env:E2E_COMPLETION_DEADLINE_MS = $previousDeadline }
        }
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

    Assert-StagedState
    $stagedTree = (Invoke-External -FilePath 'git' -Arguments @('write-tree') -Capture | Select-Object -First 1).ToString().Trim()
    $stagedDiffSha256 = Get-StagedDiffSha256
    $testFingerprintSha256 = Get-StagedTestFingerprintSha256
    $evidence = [ordered]@{
        schemaVersion = 2
        phase = 'prepared'
        preparedAt = (Get-Date).ToUniversalTime().ToString('o')
        versionName = $context.VersionName
        versionCode = $context.VersionCode
        packageId = $context.PackageId
        signerSha256 = $context.SignerSha256
        stagedTree = $stagedTree
        stagedDiffSha256 = $stagedDiffSha256
        testFingerprintSha256 = $testFingerprintSha256
        candidateApk = $candidateApk
        candidateSizeBytes = $candidateMetadata.SizeBytes
        candidateSha256 = $candidateHash
        gates = [ordered]@{
            version = 'passed'
            releaseWorkflow = 'passed'
            fixtures = 'passed'
            typecheck = 'passed'
            unit = 'passed'
            extendedUnit = 'passed'
            storageE2e = 'passed'
            coreLoopE2e = 'passed'
            webE2e = 'passed'
            androidBuild = 'passed'
        }
        gateDurationsSeconds = $gateDurations
        installations = @()
        acceptance = $null
    }
    Write-ReleaseEvidence -Evidence $evidence -Path $evidencePath
    Write-Host "Release preparation passed: $evidencePath"
    Write-Host 'The immutable candidate is ready. Install it with tools/Install-ReleaseCandidate.ps1; preparation no longer mutates a connected device.'
}
finally {
    Pop-Location
}
