[CmdletBinding()]
param([string]$DeliveryRoundId, [switch]$CollectFailures)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')
. (Join-Path $PSScriptRoot 'Full-GatePolicy.ps1')

$context = Get-ReleaseContext
$artifactDirectory = Join-Path $context.Root "artifacts\release\v$($context.VersionName)"
$buildApk = Join-Path $context.Root 'apps\android\android\app\build\outputs\apk\release\app-release.apk'
$candidateApk = Join-Path $artifactDirectory $context.ApkName
$evidencePath = Join-Path $artifactDirectory 'release-evidence.json'
Assert-ReleaseArchiveWritable -EvidencePath $evidencePath
$gateDurations = [ordered]@{}
$gateFailures = [System.Collections.Generic.List[object]]::new()
# Keep the existing sequential gates and timings; only the failure policy varies.
function Invoke-RequestedGate {
    param([string]$Name, [System.Collections.IDictionary]$Durations, [scriptblock]$Action)
    Invoke-FullGateStep -Name $Name -Durations $Durations -Failures $gateFailures -Action $Action -CollectFailures:$CollectFailures
}
$webGateStartedAt = $null

Push-Location $context.Root
try {
    Assert-StagedState
    Assert-ReleaseWorkPacketComplete -Context $context
    Invoke-RequestedGate -Name 'version' -Durations $gateDurations -Action {
        Invoke-External -FilePath 'node' -Arguments @('tools/sync-version.mjs', '--check')
    }
    Invoke-RequestedGate -Name 'releaseWorkflow' -Durations $gateDurations -Action {
        & (Join-Path $PSScriptRoot 'Test-ReleaseWorkflow.ps1')
    }
    Invoke-RequestedGate -Name 'fixtures' -Durations $gateDurations -Action {
        & (Join-Path $PSScriptRoot 'Test-FixtureHashes.ps1')
    }
    Invoke-RequestedGate -Name 'uiAssets' -Durations $gateDurations -Action {
        Invoke-External -FilePath 'node' -Arguments @('tools/check-ui-assets.mjs', '--check')
    }
    Invoke-RequestedGate -Name 'typecheck' -Durations $gateDurations -Action {
        Invoke-FullWorkspaceChecks -Root $context.Root -ScriptName 'typecheck' -CollectFailures:$CollectFailures
    }
    Invoke-RequestedGate -Name 'unit' -Durations $gateDurations -Action {
        Invoke-FullWorkspaceChecks -Root $context.Root -ScriptName 'test' -CollectFailures:$CollectFailures
    }
    Invoke-RequestedGate -Name 'extendedUnit' -Durations $gateDurations -Action {
        $limit = if ($CollectFailures) { '--bail=0' } else { '--bail=1' }
        Invoke-External -FilePath 'npm' -Arguments @('run', 'test:extended', '-w', '@blockcolc/voxel', '--', $limit)
    }
    Invoke-RequestedGate -Name 'storageE2e' -Durations $gateDurations -Action {
        $failureLimit = if ($CollectFailures) { '--max-failures=0' } else { '--max-failures=1' }
        Invoke-External -FilePath 'npm' -Arguments @('run', 'test:e2e', '-w', '@blockcolc/storage-indexeddb', '--', '--workers=1', $failureLimit)
    }
    Invoke-RequestedGate -Name 'coreLoopE2e' -Durations $gateDurations -Action {
        $failureLimit = if ($CollectFailures) { '--max-failures=0' } else { '--max-failures=1' }
        Invoke-External -FilePath 'npm' -Arguments @('run', 'test:e2e', '-w', '@blockcolc/core-loop-browser', '--', '--workers=1', $failureLimit)
    }
    Invoke-RequestedGate -Name 'webE2e' -Durations $gateDurations -Action {
        $script:webGateStartedAt = [DateTime]::UtcNow
        $previousDeadline = [Environment]::GetEnvironmentVariable('E2E_COMPLETION_DEADLINE_MS', 'Process')
        try {
            # A single-worker release run currently takes about 25 minutes on
            # the local software-WebGL gate. The explicit release deadline also
            # activates the documented physical-device ownership of the one
            # synchronous 3D drag probe.
            $env:E2E_COMPLETION_DEADLINE_MS = '2400000'
            $webArguments = @('run', 'test:web:release')
            if ($CollectFailures) { $webArguments += @('--', '--collect-all-failures') }
            Invoke-External -FilePath 'npm' -Arguments $webArguments
        }
        finally {
            if ($null -eq $previousDeadline) { Remove-Item Env:E2E_COMPLETION_DEADLINE_MS -ErrorAction SilentlyContinue }
            else { $env:E2E_COMPLETION_DEADLINE_MS = $previousDeadline }
        }
    }
    Invoke-RequestedGate -Name 'androidBuild' -Durations $gateDurations -Action {
        & (Join-Path $PSScriptRoot 'Build-AndroidRelease.ps1') -QualityGateAlreadyPassed
    }

    if ($gateFailures.Count -gt 0) {
        $failedDirectory = Join-Path $context.Root 'artifacts\test-gates\full-release'
        New-Item -ItemType Directory -Path $failedDirectory -Force | Out-Null
        $failedReport = Join-Path $failedDirectory ((Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss-fff') + '-failed.json')
        Write-ReleaseEvidence -Path $failedReport -Evidence ([ordered]@{
            status = 'failed'; failurePolicy = 'collect-all'; failures = @($gateFailures.ToArray())
            versionName = $context.VersionName; versionCode = $context.VersionCode
            stagedTree = (Invoke-External -FilePath 'git' -Arguments @('write-tree') -Capture | Select-Object -First 1).ToString().Trim()
            stagedDiffSha256 = Get-StagedDiffSha256
            testFingerprintSha256 = Get-StagedTestFingerprintSha256
            gateDurationsSeconds = $gateDurations
            gateResults = @($gateDurations.Keys | ForEach-Object {
                [ordered]@{ name = $_; status = if ($gateFailures.name -contains $_) { 'failed' } else { 'passed' } }
            })
        })
        throw "Full run found $($gateFailures.Count) failed gates. No release candidate prepared. Report: $failedReport"
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
    $webReport = Get-WebReleaseReportIndex -RepositoryRoot $context.Root -StartedAtUtc $webGateStartedAt
    $gateResults = foreach ($gateName in $gateDurations.Keys) {
        $gateResult = [ordered]@{
            name = [string]$gateName
            status = 'passed'
            exitCode = 0
            attempts = 1
            retries = 0
        }
        if ($gateName -eq 'webE2e') {
            $gateResult.suites = $webReport.SuiteCount
            $gateResult.retries = $webReport.RetryCount
            $gateResult.skippedTests = $webReport.SkipCount
            $gateResult.flakyTests = $webReport.FlakyCount
            $gateResult.attempts = $webReport.AttemptCount
            $gateResult.report = $webReport.Path
            $gateResult.reportSha256 = $webReport.Sha256
        }
        [pscustomobject]$gateResult
    }
    $evidence = [ordered]@{
        schemaVersion = 4
        phase = 'prepared'
        failurePolicy = if ($CollectFailures) { 'collect-all' } else { 'fail-fast' }
        preparedAt = (Get-Date).ToUniversalTime().ToString('o')
        versionName = $context.VersionName
        versionCode = $context.VersionCode
        packageId = $context.PackageId
        signerSha256 = $context.SignerSha256
        deliveryRoundId = if ([string]::IsNullOrWhiteSpace($DeliveryRoundId)) { $null } else { $DeliveryRoundId.Trim() }
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
            uiAssets = 'passed'
            typecheck = 'passed'
            unit = 'passed'
            extendedUnit = 'passed'
            storageE2e = 'passed'
            coreLoopE2e = 'passed'
            webE2e = 'passed'
            androidBuild = 'passed'
        }
        gateDurationsSeconds = $gateDurations
        gateResults = @($gateResults)
        reportIndex = @([ordered]@{
            name = $webReport.Name
            path = $webReport.Path
            sha256 = $webReport.Sha256
            status = $webReport.Status
            exitCode = $webReport.ExitCode
            skippedTests = $webReport.SkipCount
            retries = $webReport.RetryCount
            flakyTests = $webReport.FlakyCount
            attempts = $webReport.AttemptCount
            suites = $webReport.SuiteCount
            suiteReports = @($webReport.SuiteReports)
            startedAt = $webReport.StartedAt
            finishedAt = $webReport.FinishedAt
        })
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
