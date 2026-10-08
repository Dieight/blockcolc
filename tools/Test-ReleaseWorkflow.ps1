[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')
& (Join-Path $PSScriptRoot 'Test-FullGatePolicy.ps1')

Invoke-External -FilePath 'node' -Arguments @('--test', (Join-Path $PSScriptRoot 'check-ui-assets.test.mjs'), (Join-Path $PSScriptRoot 'web-release-report.test.mjs'), (Join-Path $PSScriptRoot 'full-run-policy.test.mjs'))

function Assert-True {
    param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-Throws {
    param([Parameter(Mandatory)][scriptblock]$Action, [Parameter(Mandatory)][string]$MessagePattern)
    try {
        & $Action
    }
    catch {
        if ($_.Exception.Message -notmatch $MessagePattern) {
            throw "Expected failure matching '$MessagePattern', found: $($_.Exception.Message)"
        }
        return
    }
    throw "Expected failure matching '$MessagePattern', but the action passed."
}

$rootPackage = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'package.json') -Raw | ConvertFrom-Json
Assert-True -Condition ($rootPackage.scripts.'test:web:release' -match '\s--\s*$') -Message 'Nested npm release scripts must forward runner flags after their own -- separator.'

$hashA = ('a' * 64) -join ''
Assert-True -Condition ((Get-ApkBuildChannel -ManifestTree 'E: application') -eq 'standard') -Message 'Legacy standard marker'
$privateManifest = "E: application`n  E: meta-data`n    A: android:name(0x01010003)=`"com.blockcolc.PRIVATE_RELAY`"`n    A: android:value(0x01010024)=(type 0x12)0xffffffff`n  E: activity"
Assert-True -Condition ((Get-ApkBuildChannel -ManifestTree $privateManifest) -eq 'private-relay') -Message 'Private relay marker'
Assert-True -Condition ((Get-ApkBuildChannel -ManifestTree ($privateManifest.Replace('0xffffffff', '0x0'))) -eq 'standard') -Message 'Explicit standard marker'
Assert-Throws -MessagePattern 'Unrecognized' -Action { Get-ApkBuildChannel -ManifestTree ($privateManifest.Replace('0xffffffff', '0x1')) }
$probeManifest = $privateManifest.Replace('PRIVATE_RELAY', 'PERFORMANCE_DIAGNOSTICS')
Assert-True -Condition (Get-ApkPerformanceDiagnostics -ManifestTree $probeManifest) -Message 'Explicit diagnostic marker'
Assert-True -Condition (-not (Get-ApkPerformanceDiagnostics -ManifestTree ($probeManifest.Replace('0xffffffff', '0x0')))) -Message 'Explicit inactive diagnostic marker'
Assert-True -Condition (-not (Get-ApkPerformanceDiagnostics -ManifestTree 'E: application')) -Message 'Legacy APK has no probes'
Assert-Throws -MessagePattern 'Unrecognized' -Action { Get-ApkPerformanceDiagnostics -ManifestTree ($probeManifest.Replace('0xffffffff', '0x1')) }
$hashB = ('b' * 64) -join ''
$evidence = [pscustomobject]@{
    phase = 'accepted'
    versionName = '1.11.0'
    versionCode = 26
    packageId = 'com.blockcolc.app'
    signerSha256 = $hashB
    stagedTree = 'tree-a'
    stagedDiffSha256 = $hashA
    testFingerprintSha256 = $hashA
    candidateSha256 = $hashB
    installations = @([pscustomobject]@{ Serial = 'device-a'; InstalledSha256 = $hashB })
    acceptance = [pscustomobject]@{ candidateSha256 = $hashB; stagedTree = 'tree-a'; stagedDiffSha256 = $hashA; testFingerprintSha256 = $hashA }
}
$context = [pscustomobject]@{
    VersionName = '1.11.0'
    VersionCode = 26
    PackageId = 'com.blockcolc.app'
    SignerSha256 = $hashB
}

Assert-ReleaseEvidenceVersion -Evidence $evidence -Context $context
Assert-AcceptedReleaseEvidence -Evidence $evidence
Assert-Throws -MessagePattern 'SHA-256 mismatch' -Action {
    $invalid = $evidence | ConvertTo-Json -Depth 6 | ConvertFrom-Json
    $invalid.acceptance.candidateSha256 = $hashA
    Assert-AcceptedReleaseEvidence -Evidence $invalid
}
Assert-Throws -MessagePattern 'version does not match' -Action {
    $wrongVersion = [pscustomobject]@{ VersionName = '1.11.1'; VersionCode = 26; PackageId = $context.PackageId; SignerSha256 = $context.SignerSha256 }
    Assert-ReleaseEvidenceVersion -Evidence $evidence -Context $wrongVersion
}

$pairedCandidate = $evidence | ConvertTo-Json -Depth 6 | ConvertFrom-Json
$pairedCandidate | Add-Member -NotePropertyName deliveryRoundId -NotePropertyValue 'synthetic-paired-round'
$pairedGates = [pscustomobject]@{}
foreach ($gate in @('version','releaseWorkflow','fixtures','uiAssets','typecheck','unit','extendedUnit','storageE2e','coreLoopE2e','webE2e','androidBuild')) {
    $pairedGates | Add-Member -NotePropertyName $gate -NotePropertyValue 'passed'
}
$pairedCandidate | Add-Member -NotePropertyName gates -NotePropertyValue $pairedGates
$assets = @([pscustomobject][ordered]@{ path='assets/public/index.html'; bytes=17; sha256=$hashA })
$syntheticAndroid = [pscustomobject]@{ tests=[pscustomobject]@{ tests=1; failures=0; errors=0; skipped=0 }; lintErrors=0 }
$pairedEvidence = [pscustomobject]@{
    versionName=$context.VersionName; versionCode=$context.VersionCode; packageId=$context.PackageId; signerSha256=$context.SignerSha256
    deliveryRoundId='synthetic-paired-round'; fullReleaseGate='passed'
    standard=[pscustomobject]@{ sha256=$hashB; isolation='passed'; android=$syntheticAndroid }
    private=[pscustomobject]@{ sha256=$hashA; isolation='passed'; android=$syntheticAndroid }
    sharedCore=[pscustomobject]@{ sameBytes=$true; entries=$assets }
}
Assert-PairedReleaseEvidence -Evidence $pairedCandidate -Pair $pairedEvidence -Context $context -StandardAssets $assets -PrivateAssets $assets
foreach ($field in @('deliveryRoundId','versionName','packageId','signerSha256')) {
    Assert-Throws -MessagePattern 'identity|DeliveryRoundId' -Action {
        $invalid = $pairedEvidence | ConvertTo-Json -Depth 8 | ConvertFrom-Json
        $invalid.$field = 'different'
        Assert-PairedReleaseEvidence -Evidence $pairedCandidate -Pair $invalid -Context $context -StandardAssets $assets -PrivateAssets $assets
    }
}
Assert-Throws -MessagePattern 'SHA-256 mismatch' -Action {
    $invalid = $pairedEvidence | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    $invalid.standard.sha256 = $hashA
    Assert-PairedReleaseEvidence -Evidence $pairedCandidate -Pair $invalid -Context $context -StandardAssets $assets -PrivateAssets $assets
}
Assert-Throws -MessagePattern 'Actual APK core' -Action {
    $differentAssets = @([pscustomobject][ordered]@{ path='assets/public/index.html'; bytes=17; sha256=$hashB })
    Assert-PairedReleaseEvidence -Evidence $pairedCandidate -Pair $pairedEvidence -Context $context -StandardAssets $assets -PrivateAssets $differentAssets
}
Assert-Throws -MessagePattern 'Actual APK core' -Action {
    $invalid = $pairedEvidence | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    $invalid.sharedCore.entries[0].bytes = 18
    Assert-PairedReleaseEvidence -Evidence $pairedCandidate -Pair $invalid -Context $context -StandardAssets $assets -PrivateAssets $assets
}
Assert-Throws -MessagePattern 'gate did not pass' -Action {
    $invalid = $pairedCandidate | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    $invalid.gates.webE2e = 'failed'
    Assert-PairedReleaseEvidence -Evidence $invalid -Pair $pairedEvidence -Context $context -StandardAssets $assets -PrivateAssets $assets
}
Assert-Throws -MessagePattern 'Android checks' -Action {
    $invalid = $pairedEvidence | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    $invalid.private.android.tests.skipped = 1
    Assert-PairedReleaseEvidence -Evidence $pairedCandidate -Pair $invalid -Context $context -StandardAssets $assets -PrivateAssets $assets
}

$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path $temporaryBase "blockcolc-release-workflow-$([guid]::NewGuid().ToString('N'))"))
if (-not $temporaryRoot.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe temporary test path: $temporaryRoot" }
try {
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    $archiveEvidencePath = Join-Path $temporaryRoot 'archive-guard.json'
    Assert-ReleaseArchiveWritable -EvidencePath $archiveEvidencePath
    Set-Content -LiteralPath $archiveEvidencePath -Encoding utf8 -Value '{"phase":"prepared"}'
    Assert-ReleaseArchiveWritable -EvidencePath $archiveEvidencePath
    foreach ($closedPhase in @('installed', 'accepted', 'published', 'unknown')) {
        @{ phase = $closedPhase } | ConvertTo-Json | Set-Content -LiteralPath $archiveEvidencePath -Encoding utf8
        Assert-Throws -MessagePattern 'immutable' -Action { Assert-ReleaseArchiveWritable -EvidencePath $archiveEvidencePath }
    }
    Set-Content -LiteralPath $archiveEvidencePath -Encoding utf8 -Value '{}'
    Assert-Throws -MessagePattern 'immutable' -Action { Assert-ReleaseArchiveWritable -EvidencePath $archiveEvidencePath }

    $packetDirectory = Join-Path $temporaryRoot 'docs\versions'
    New-Item -ItemType Directory -Path $packetDirectory -Force | Out-Null
    $packetPath = Join-Path $packetDirectory 'V26.md'
    Set-Content -LiteralPath $packetPath -Encoding utf8 -Value "| 需求 | 状态 | 证据 |`n| --- | --- | --- |`n| REL-26-01 | 待实施 | none |"
    $packetContext = [pscustomobject]@{ Root = $temporaryRoot; VersionCode = 26 }
    Assert-Throws -MessagePattern 'incomplete requirements' -Action { Assert-ReleaseWorkPacketComplete -Context $packetContext }
    Set-Content -LiteralPath $packetPath -Encoding utf8 -Value "| 需求 | 状态 | 证据 |`n| --- | --- | --- |`n| REL-26-01 | 完成 | verified |"
    Assert-Throws -MessagePattern 'locatable evidence' -Action { Assert-ReleaseWorkPacketComplete -Context $packetContext }
    $evidenceFile = Join-Path $temporaryRoot 'reports\REL-26-01.json'
    New-Item -ItemType Directory -Path (Split-Path -Parent $evidenceFile) -Force | Out-Null
    Set-Content -LiteralPath $evidenceFile -Encoding utf8 -Value '{"result":"passed"}'
    Set-Content -LiteralPath $packetPath -Encoding utf8 -Value "| 需求 | 状态 | 证据 |`n| --- | --- | --- |`n| REL-26-01 | 完成 | ``reports/REL-26-01.json`` |"
    Assert-ReleaseWorkPacketComplete -Context $packetContext
    $relativeEvidenceFile = Join-Path $packetDirectory 'reports\relative-evidence.json'
    New-Item -ItemType Directory -Path (Split-Path -Parent $relativeEvidenceFile) -Force | Out-Null
    Set-Content -LiteralPath $relativeEvidenceFile -Encoding utf8 -Value '{"relative":true}'
    Set-Content -LiteralPath $packetPath -Encoding utf8 -Value "| 需求 | 状态 | 证据 |`n| --- | --- | --- |`n| REL-26-01 | 完成 | [report](reports/relative-evidence.json) |"
    Assert-ReleaseWorkPacketComplete -Context $packetContext
    $directoryEvidence = Join-Path $packetDirectory 'reports\directory-evidence'
    New-Item -ItemType Directory -Path $directoryEvidence -Force | Out-Null
    Set-Content -LiteralPath $packetPath -Encoding utf8 -Value "| 需求 | 状态 | 证据 |`n| --- | --- | --- |`n| REL-26-01 | 完成 | [report](reports/directory-evidence) |"
    Assert-Throws -MessagePattern 'locatable evidence' -Action { Assert-ReleaseWorkPacketComplete -Context $packetContext }
    Set-Content -LiteralPath $packetPath -Encoding utf8 -Value "| 需求 | 状态 | 证据 |`n| --- | --- | --- |`n| REL-26-01 | 完成 | [report](../../outside.json) |"
    Assert-Throws -MessagePattern 'locatable evidence' -Action { Assert-ReleaseWorkPacketComplete -Context $packetContext }

    $historyContext = [pscustomobject]@{ Root = $temporaryRoot; PackageId = 'com.blockcolc.app'; SignerSha256 = $hashB }
    $standardEvidencePath = Join-Path $temporaryRoot 'artifacts\release\v2.0.0\release-evidence.json'
    New-Item -ItemType Directory -Path (Split-Path -Parent $standardEvidencePath) -Force | Out-Null
    [ordered]@{ schemaVersion = 3; phase = 'published'; versionName = '2.0.0'; versionCode = 41; packageId = 'com.blockcolc.app'; signerSha256 = $hashB; candidateSha256 = $hashA; deliveryRoundId = 'round-41' } |
        ConvertTo-Json | Set-Content -LiteralPath $standardEvidencePath -Encoding utf8
    $history = Get-DeliveredApkHistory -Context $historyContext -Channel standard
    Assert-True -Condition (@($history).Count -eq 1 -and $history[0].VersionCode -eq 41) -Message 'Published legacy evidence contributes delivery history.'
    Assert-NotOlderThanDeliveredVersion -VersionCode 41 -Context $historyContext -Channel standard -History $history
    Assert-Throws -MessagePattern 'older than last delivered' -Action { Assert-NotOlderThanDeliveredVersion -VersionCode 40 -Context $historyContext -Channel standard -History $history }
    $next = [pscustomobject]@{ PackageId = 'com.blockcolc.app'; SignerSha256 = $hashB; VersionCode = 41; VersionName = '2.0.0'; Sha256 = $hashA }
    Assert-NextDeliveredApkVersion -Metadata $next -Context $historyContext -Channel standard -History $history
    Assert-Throws -MessagePattern 'older than last delivered' -Action {
        Assert-NextDeliveredApkVersion -Metadata ([pscustomobject]@{ PackageId = $next.PackageId; SignerSha256 = $hashB; VersionCode = 40; VersionName = '2.0.0'; Sha256 = $hashA }) -Context $historyContext -Channel standard -History $history
    }
    Assert-Throws -MessagePattern 'different APK hash' -Action {
        Assert-NextDeliveredApkVersion -Metadata ([pscustomobject]@{ PackageId = $next.PackageId; SignerSha256 = $hashB; VersionCode = 41; VersionName = '2.0.0'; Sha256 = $hashB }) -Context $historyContext -Channel standard -History $history
    }
    $installedEvidencePath = Join-Path $temporaryRoot 'artifacts\release\v2.1.0\release-evidence.json'
    New-Item -ItemType Directory -Path (Split-Path -Parent $installedEvidencePath) -Force | Out-Null
    [ordered]@{ schemaVersion = 2; phase = 'accepted'; versionName = '2.1.0'; versionCode = 42; packageId = 'com.blockcolc.app'; signerSha256 = $hashB; candidateSha256 = $hashA; installations = @(@{ Serial = 'device-a'; InstalledSha256 = $hashA }) } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $installedEvidencePath -Encoding utf8
    $historyWithInstall = Get-DeliveredApkHistory -Context $historyContext -Channel standard
    Assert-True -Condition (@($historyWithInstall | Where-Object { $_.VersionCode -eq 42 -and $_.Kind -eq 'device-install' }).Count -eq 1) -Message 'Accepted candidates with verified device installation count as delivered.'
    $uninstalledPath = Join-Path $temporaryRoot 'artifacts\release\v2.2.0\release-evidence.json'
    New-Item -ItemType Directory -Path (Split-Path -Parent $uninstalledPath) -Force | Out-Null
    [ordered]@{ schemaVersion = 2; phase = 'prepared'; versionName = '2.2.0'; versionCode = 43; packageId = 'com.blockcolc.app'; signerSha256 = $hashB; candidateSha256 = $hashA; installations = @() } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $uninstalledPath -Encoding utf8
    $historyWithPrepared = Get-DeliveredApkHistory -Context $historyContext -Channel standard
    Assert-True -Condition (@($historyWithPrepared | Where-Object { $_.VersionCode -eq 43 }).Count -eq 0) -Message 'Prepared but uninstalled candidates do not count as delivery history.'
    $privateSameRound = [pscustomobject]@{ PackageId = 'com.blockcolc.app'; SignerSha256 = $hashB; VersionCode = 41; VersionName = '2.0.0'; Sha256 = $hashA; BuildChannel = 'private-relay' }
    $privateOlder = [pscustomobject]@{ PackageId = 'com.blockcolc.app'; SignerSha256 = $hashB; VersionCode = 40; VersionName = '1.9.0'; Sha256 = $hashA; BuildChannel = 'private-relay' }
    Assert-Throws -MessagePattern 'older than last delivered' -Action {
        Assert-NextDeliveredApkVersion -Metadata $privateOlder -Context $historyContext -Channel private-relay -History $history
    }
    Assert-Throws -MessagePattern 'matching DeliveryRoundId' -Action { Assert-NextDeliveredApkVersion -Metadata $privateSameRound -Context $historyContext -Channel private-relay -History $history }
    Assert-Throws -MessagePattern 'matching DeliveryRoundId' -Action { Assert-NextDeliveredApkVersion -Metadata $privateSameRound -Context $historyContext -Channel private-relay -History $history -DeliveryRoundId 'round-elsewhere' }
    Assert-NextDeliveredApkVersion -Metadata $privateSameRound -Context $historyContext -Channel private-relay -History $history -DeliveryRoundId 'round-41'
    $legacyPrivate = [pscustomobject]@{ PackageId = 'com.blockcolc.app'; SignerSha256 = $hashB; VersionCode = 41; VersionName = '2.0.0'; Sha256 = $hashA; Channel = 'private-relay'; DeliveryRoundId = ''; EvidencePath = 'synthetic:legacy-private' }
    Assert-NextDeliveredApkVersion -Metadata $privateSameRound -Context $historyContext -Channel private-relay -History (@($history) + @($legacyPrivate))
    $siblingPublicRoot = Join-Path $temporaryRoot 'sibling-public'
    $siblingPrivateRoot = Join-Path $temporaryRoot 'sibling-private'
    New-Item -ItemType Directory -Path (Join-Path $siblingPublicRoot 'artifacts') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $siblingPrivateRoot 'tools') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $siblingPrivateRoot 'tools\Install-PrivateVerification.ps1') -Encoding utf8 -Value '# synthetic private relay marker'
    $siblingPrivateEvidenceDirectory = Join-Path $siblingPrivateRoot 'artifacts\private'
    New-Item -ItemType Directory -Path $siblingPrivateEvidenceDirectory -Force | Out-Null
    [ordered]@{ schemaVersion = 2; repository = 'synthetic'; commit = 'synthetic'; sha256 = $hashA; deliveryRoundId = 'round-41'; metadata = @{ BuildChannel = 'private-relay'; PackageId = 'com.blockcolc.app'; VersionName = '2.0.0'; VersionCode = 41; SignerSha256 = $hashB } } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $siblingPrivateEvidenceDirectory 'upload-evidence.json') -Encoding utf8
    $siblingHistory = @(Get-DeliveredApkHistory -Context ([pscustomobject]@{ Root = $siblingPublicRoot; PackageId = $historyContext.PackageId }) -Channel all)
    Assert-True -Condition (@($siblingHistory | Where-Object { $_.Channel -eq 'private-relay' -and $_.VersionCode -eq 41 }).Count -eq 1) -Message 'Cross-channel history discovers the sibling private relay workspace.'

    $reportRoot = Join-Path $temporaryRoot 'artifacts\test-gates\web-release'
    New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null
    $playwrightArchive = Join-Path $reportRoot 'playwright'
    New-Item -ItemType Directory -Path $playwrightArchive -Force | Out-Null
    $corePlaywright = [ordered]@{ suites = @(@{ specs = @(@{ tests = @(@{ status = 'flaky'; results = @(@{ status = 'failed' }, @{ status = 'passed' }) }, @{ status = 'skipped'; results = @(@{ status = 'skipped' }) }) }) }) }
    $visualPlaywright = [ordered]@{ suites = @(@{ specs = @(@{ tests = @(@{ status = 'passed'; results = @(@{ status = 'passed' }) }, @{ status = 'skipped'; results = @(@{ status = 'skipped' }) }) }) }) }
    $corePath = Join-Path $playwrightArchive 'core.json'
    $visualPath = Join-Path $playwrightArchive 'visual.json'
    $corePlaywright | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $corePath -Encoding utf8
    $visualPlaywright | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $visualPath -Encoding utf8
    $reportPath = Join-Path $reportRoot 'run.json'
    $now = [DateTimeOffset]::UtcNow.ToString('o')
    [ordered]@{ schemaVersion = 1; status = 'passed'; exitCode = 0; attemptCount = 2; startedAt = $now; finishedAt = $now; retryCount = 1; flakyTestCount = 1; skippedTests = @(@{ title = 'skip1' }, @{ title = 'skip2' }); suites = @(@{ name = 'core'; status = 'passed'; exitCode = 0; attemptCount = 1; retryCount = 1; flakyTestCount = 1; skippedTestCount = 1; playwrightReport = 'artifacts/test-gates/web-release/playwright/core.json'; playwrightReportSha256 = (Get-Sha256 -Path $corePath) }, @{ name = 'visual'; status = 'passed'; exitCode = 0; attemptCount = 1; retryCount = 0; flakyTestCount = 0; skippedTestCount = 1; playwrightReport = 'artifacts/test-gates/web-release/playwright/visual.json'; playwrightReportSha256 = (Get-Sha256 -Path $visualPath) }) } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding utf8
    $reportFile = Get-Item -LiteralPath $reportPath
    $reportIndex = Get-WebReleaseReportIndex -RepositoryRoot $temporaryRoot -StartedAtUtc $reportFile.LastWriteTimeUtc.AddMinutes(-1)
    Assert-True -Condition ($reportIndex.ExitCode -eq 0 -and $reportIndex.SkipCount -eq 2 -and $reportIndex.AttemptCount -eq 2 -and $reportIndex.SuiteCount -eq 2 -and $reportIndex.RetryCount -eq 1 -and $reportIndex.FlakyCount -eq 1 -and @($reportIndex.SuiteReports).Count -eq 2) -Message 'Web release summary index includes actual runner outcome, skipped, retry and flaky counts.'
    $reportEvidence = [pscustomobject]@{ schemaVersion = 3; reportIndex = @([pscustomobject]@{ path = $reportIndex.Path; sha256 = $reportIndex.Sha256; status = 'passed'; exitCode = 0; suiteReports = $reportIndex.SuiteReports }) }
    Assert-ReleaseReportIndex -Evidence $reportEvidence -Context ([pscustomobject]@{ Root = $temporaryRoot })
    # Exercise UTC and both offset signs with a sub-second preparation
    # boundary. PowerShell's JSON date conversion must not shift the instant
    # to the local zone or round away its fractional seconds.
    $timestampReport = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    foreach ($offsetHours in @(0, 8, -5)) {
        $started = [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours($offsetHours))
        $finished = $started.AddMilliseconds(175)
        $timestampReport.startedAt = $started.ToString('o')
        $timestampReport.finishedAt = $finished.ToString('o')
        $timestampReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
        (Get-Item -LiteralPath $reportPath).LastWriteTimeUtc = $started.UtcDateTime.AddSeconds(1)
        $roundTrip = Get-WebReleaseReportIndex -RepositoryRoot $temporaryRoot -StartedAtUtc $started.UtcDateTime.AddMilliseconds(-1)
        Assert-True -Condition ([DateTimeOffset]::Parse($roundTrip.StartedAt).UtcTicks -eq $started.UtcTicks) -Message "Report start preserves offset $offsetHours and fractions."
        Assert-True -Condition ([DateTimeOffset]::Parse($roundTrip.FinishedAt).UtcTicks -eq $finished.UtcTicks) -Message "Report finish preserves offset $offsetHours and fractions."
        Assert-Throws -MessagePattern 'predates this preparation' -Action {
            Get-WebReleaseReportIndex -RepositoryRoot $temporaryRoot -StartedAtUtc $started.UtcDateTime.AddMilliseconds(1)
        }
    }
    $invalidReport = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    $invalidReport.suites[0].exitCode = $null
    $invalidReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
    Assert-Throws -MessagePattern 'missing a valid suite exit' -Action { Get-WebReleaseReportIndex -RepositoryRoot $temporaryRoot -StartedAtUtc $reportFile.LastWriteTimeUtc.AddMinutes(-1) }
    $invalidReport = [ordered]@{ schemaVersion = 1; status = 'passed'; exitCode = 0; attemptCount = 0; startedAt = $now; skippedTests = @(); retryCount = 0; flakyTestCount = 0; suites = @() }
    $invalidReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
    Assert-Throws -MessagePattern 'valid finish time' -Action { Get-WebReleaseReportIndex -RepositoryRoot $temporaryRoot -StartedAtUtc $reportFile.LastWriteTimeUtc.AddMinutes(-1) }
    [ordered]@{ schemaVersion = 1; status = 'passed'; exitCode = 0; attemptCount = 2; startedAt = $now; finishedAt = $now; retryCount = 1; flakyTestCount = 1; skippedTests = @(@{ title = 'skip1' }, @{ title = 'skip2' }); suites = @(@{ name = 'core'; status = 'passed'; exitCode = 0; attemptCount = 1; retryCount = 1; flakyTestCount = 1; skippedTestCount = 1; playwrightReport = 'artifacts/test-gates/web-release/playwright/core.json'; playwrightReportSha256 = (Get-Sha256 -Path $corePath) }, @{ name = 'visual'; status = 'passed'; exitCode = 0; attemptCount = 1; retryCount = 0; flakyTestCount = 0; skippedTestCount = 1; playwrightReport = 'artifacts/test-gates/web-release/playwright/visual.json'; playwrightReportSha256 = (Get-Sha256 -Path $visualPath) }) } |
        ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
    Set-Content -LiteralPath $reportPath -Encoding utf8 -Value '{"tampered":true}'
    Assert-Throws -MessagePattern 'SHA-256 mismatch' -Action { Assert-ReleaseReportIndex -Evidence $reportEvidence -Context ([pscustomobject]@{ Root = $temporaryRoot }) }
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}

$prepareSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Prepare-Release.ps1') -Raw
$installSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Install-ReleaseCandidate.ps1') -Raw
$publishSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Publish-Release.ps1') -Raw
$pairedPublishSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Publish-PairedRelease.ps1') -Raw
Assert-True -Condition ($pairedPublishSource -notmatch 'Install-AndVerifyApk|Get-AuthorizedAndroidDevices|Build-AndroidRelease|gradlew|vite\s+build') -Message 'Paired publication must not require devices or rebuild accepted APKs.'
Assert-True -Condition ($pairedPublishSource -match 'ConfirmUserAcceptance' -and $pairedPublishSource -match 'ConfirmPublish' -and $pairedPublishSource -match 'UserApproval') -Message 'Paired publication must require explicit human acceptance and publication authorization.'
Assert-True -Condition ($pairedPublishSource.IndexOf("'run','watch'", [StringComparison]::Ordinal) -lt $pairedPublishSource.IndexOf("'release','create'", [StringComparison]::Ordinal)) -Message 'Publication commit CI must finish before a public Release is created.'
$pairedTokens = $null
$pairedErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($pairedPublishSource, [ref]$pairedTokens, [ref]$pairedErrors)
Assert-True -Condition (@($pairedErrors).Count -eq 0) -Message 'Paired publication script must parse.'
$verificationSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Build-Verification-Apk.ps1') -Raw
$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$privateInstallPath = Join-Path $workspaceRoot 'blockcolc-relay-private\tools\Install-PrivateVerification.ps1'
Assert-True -Condition ($prepareSource -notmatch 'Install-AndVerifyApk') -Message 'Prepare-Release must not install or launch a connected device.'
Assert-True -Condition ($prepareSource -notmatch 'Accept-ReleaseCandidate') -Message 'Prepare-Release must not require manual acceptance before candidate preparation.'
Assert-True -Condition ($prepareSource.IndexOf('Assert-ReleaseArchiveWritable', [StringComparison]::Ordinal) -ge 0 -and $prepareSource.IndexOf('Assert-ReleaseArchiveWritable', [StringComparison]::Ordinal) -lt $prepareSource.IndexOf('Copy-Item', [StringComparison]::Ordinal)) -Message 'The formal archive guard must run before candidate files can be overwritten.'
Assert-True -Condition ($publishSource -notmatch 'Build-AndroidRelease|gradlew|vite\s+build') -Message 'Publish-Release must not rebuild the accepted candidate.'
Assert-True -Condition ($publishSource -match 'releaseUrl' -and $publishSource -match 'releaseAudit') -Message 'Published evidence must retain the URL and audit retry outcomes.'
Assert-True -Condition ($verificationSource -match 'Assert-NextDeliveredApkVersion' -and $verificationSource -match 'artifact-only-not-delivered') -Message 'Verification build must preflight only actual device deliveries and mark artifact-only results.'
Assert-True -Condition ($verificationSource -match '\[switch\]\$ArtifactOnly') -Message 'Verification build must expose the opt-in ArtifactOnly switch.'
Assert-True -Condition ($verificationSource -match "phase\s*=\s*if\s*\(\`$ArtifactOnly\)\s*\{\s*'artifact-only-verification'" -and $verificationSource -match "deliveryStatus\s*=\s*if\s*\(\`$ArtifactOnly") -Message 'ArtifactOnly evidence must identify the artifact-only phase and non-delivery status.'
$verificationTokens = $null
$verificationParseErrors = $null
$verificationAst = [System.Management.Automation.Language.Parser]::ParseInput($verificationSource, [ref]$verificationTokens, [ref]$verificationParseErrors)
Assert-True -Condition (@($verificationParseErrors).Count -eq 0) -Message 'Verification build script must parse before checking its ArtifactOnly branch.'
$artifactOnlyBranch = $verificationAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.IfStatementAst] -and
        $node.Clauses.Count -gt 0 -and $node.Clauses[0].Item1.Extent.Text.Trim() -eq '$ArtifactOnly'
}, $true) | Select-Object -First 1
Assert-True -Condition ($null -ne $artifactOnlyBranch -and $null -ne $artifactOnlyBranch.ElseClause) -Message 'ArtifactOnly must have an explicit branch paired with the existing device flow.'
$deviceCommandPredicate = {
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -in @('Get-AuthorizedAndroidDevices', 'Install-AndVerifyApk')
}
$artifactOnlyDeviceCalls = @($artifactOnlyBranch.Clauses[0].Item2.FindAll($deviceCommandPredicate, $true))
$normalDeviceCalls = @($artifactOnlyBranch.ElseClause.FindAll($deviceCommandPredicate, $true))
Assert-True -Condition ($artifactOnlyDeviceCalls.Count -eq 0) -Message 'ArtifactOnly branch must not query authorized devices or call installation.'
$authorizedDeviceCalls = @($normalDeviceCalls | Where-Object { $_.GetCommandName() -eq 'Get-AuthorizedAndroidDevices' })
Assert-True -Condition ($authorizedDeviceCalls.Count -eq 1 -and @($normalDeviceCalls | Where-Object { $_.GetCommandName() -eq 'Install-AndVerifyApk' }).Count -eq 0) -Message 'Default device discovery stays in the non-ArtifactOnly branch.'
$versionPreflightCalls = @($verificationAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Assert-NextDeliveredApkVersion' }, $true))
$installCalls = @($verificationAst.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Install-AndVerifyApk' }, $true))
$installGuard = $verificationAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.IfStatementAst] -and
        $node.Clauses.Count -gt 0 -and $node.Clauses[0].Item1.Extent.Text.Trim() -eq '-not $ArtifactOnly'
}, $true) | Select-Object -First 1
Assert-True -Condition ($versionPreflightCalls.Count -eq 1 -and $installCalls.Count -eq 1 -and $null -ne $installGuard) -Message 'Version preflight and install must each occur exactly once behind the expected control flow.'
$guardedInstallCalls = @($installGuard.Clauses[0].Item2.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Install-AndVerifyApk' }, $true))
Assert-True -Condition ($guardedInstallCalls.Count -eq 1 -and $versionPreflightCalls[0].Extent.StartOffset -gt $artifactOnlyBranch.Extent.EndOffset -and $versionPreflightCalls[0].Extent.StartOffset -lt $installCalls[0].Extent.StartOffset) -Message 'Exactly one delivery version/hash preflight must run outside ArtifactOnly and before installation.'
if (Test-Path -LiteralPath $privateInstallPath -PathType Leaf) {
    $privateInstallSource = Get-Content -LiteralPath $privateInstallPath -Raw
    Assert-True -Condition ($privateInstallSource.IndexOf('Assert-NextDeliveredApkVersion', [StringComparison]::Ordinal) -lt $privateInstallSource.IndexOf('Install-AndVerifyApk', [StringComparison]::Ordinal)) -Message 'Private delivery version preflight must precede installation.'
} else {
    Write-Host 'Private workspace absent; synthetic cross-channel contract tests remain required and verified.'
}
$busyIndex = $installSource.IndexOf('Assert-DeviceNotBusy', [StringComparison]::Ordinal)
$preflightIndex = $installSource.IndexOf('Assert-NextDeliveredApkVersion', [StringComparison]::Ordinal)
$installIndex = $installSource.IndexOf('Install-AndVerifyApk', [StringComparison]::Ordinal)
Assert-True -Condition ($preflightIndex -ge 0 -and $busyIndex -gt $preflightIndex -and $installIndex -gt $busyIndex) -Message 'Release candidate delivery preflight and device-busy checks must precede installation.'
$privateToolsPath = Join-Path $workspaceRoot 'blockcolc-relay-private\tools'
$toolFiles = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1' -File)
if (Test-Path -LiteralPath $privateToolsPath -PathType Container) {
    $toolFiles += @(Get-ChildItem -LiteralPath $privateToolsPath -Filter '*.ps1' -File)
}
$legacyWorkspacePrefix = '@' + 'tomato-clock/'
$legacyCommandPattern = '-w\s+[''"]' + [regex]::Escape($legacyWorkspacePrefix)
$legacyCommandUse = @($toolFiles | Where-Object { $_.FullName -ne $PSCommandPath -and (Get-Content -LiteralPath $_.FullName -Raw) -match $legacyCommandPattern })
Assert-True -Condition ($legacyCommandUse.Count -eq 0) -Message 'Tool commands must use @blockcolc workspace names.'

Write-Host 'Release workflow contract tests passed.'
