[CmdletBinding()]
param(
    [Parameter(Mandatory)][switch]$ConfirmPublish,
    [Parameter(Mandatory)][string]$ReleaseNotesPath,
    [string]$CommitMessage,
    [switch]$AllowRedCi,
    [switch]$AllowBusyDevice,
    [int]$WaitForReleaseCiMinutes = 15
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')

if (-not $ConfirmPublish) { throw 'Publishing requires -ConfirmPublish.' }
$context = Get-ReleaseContext
$tag = "v$($context.VersionName)"
$artifactDirectory = Join-Path $context.Root "artifacts\release\$tag"
$evidencePath = Join-Path $artifactDirectory 'release-evidence.json'
if (-not (Test-Path -LiteralPath $ReleaseNotesPath -PathType Leaf)) { throw "Release notes not found: $ReleaseNotesPath" }
if (-not (Test-Path -LiteralPath $evidencePath -PathType Leaf)) { throw "Prepared evidence not found: $evidencePath" }
$evidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
if ($evidence.phase -ne 'accepted') { throw "Evidence is not in accepted phase: $($evidence.phase). Install and obtain explicit user acceptance for the immutable candidate first." }

function Get-CiRunForCommit {
    param([Parameter(Mandatory)][string]$CommitSha)
    $runs = (Invoke-External -FilePath 'gh' -Arguments @('run', 'list', '--repo', $context.Repository, '--commit', $CommitSha, '--json', 'databaseId,status,conclusion', '--limit', '1') -Capture) -join "`n" | ConvertFrom-Json
    if (-not $runs) { return $null }
    return $runs | Select-Object -First 1
}

Push-Location $context.Root
try {
    Assert-ReleaseEvidenceVersion -Evidence $evidence -Context $context
    Assert-AcceptedReleaseEvidence -Evidence $evidence
    Assert-ReleaseWorkPacketComplete -Context $context
    Assert-ReleaseEvidenceMatchesStagedState -Evidence $evidence
    Invoke-External -FilePath 'node' -Arguments @('tools/sync-version.mjs', '--check')

    # Release gate: the branch being released must already be green on CI. A red
    # branch is never published; known environment-only flakes require -AllowRedCi
    # with a recorded reason instead of shipping on top of them.
    if (-not $AllowRedCi) {
        $headSha = (Invoke-External -FilePath 'git' -Arguments @('rev-parse', 'HEAD') -Capture | Select-Object -First 1).ToString().Trim()
        $headRun = Get-CiRunForCommit -CommitSha $headSha
        if (-not $headRun) { throw "No CI run found for HEAD $headSha. Push and wait for a green run before publishing (or pass -AllowRedCi with a documented reason)." }
        if ($headRun.status -ne 'completed' -or $headRun.conclusion -ne 'success') {
            throw "HEAD CI is not green (run $($headRun.databaseId): $($headRun.status)/$($headRun.conclusion)). Fix CI before publishing, or pass -AllowRedCi with a documented reason."
        }
        Write-Host "Verified HEAD CI is green (run $($headRun.databaseId))."
    }

    $candidate = Assert-ReleaseCandidateEvidence -Evidence $evidence -Context $context -Boundary 'accepted candidate before publish'
    $candidateApk = $candidate.Path
    $candidateHash = $candidate.Sha256
    Assert-Sha256Equal -Expected ([string]$evidence.acceptance.candidateSha256) -Actual $candidateHash -Boundary 'user acceptance to publish candidate'

    $authorized = @(Get-AuthorizedAndroidDevices)
    $targetSerials = @($evidence.installations | ForEach-Object { [string]$_.Serial } | Where-Object { $_ } | Sort-Object -Unique)
    if (@($targetSerials).Count -eq 0) { throw 'Accepted evidence has no verified device installation.' }
    foreach ($serial in $targetSerials) {
        if ($authorized -notcontains $serial) { throw "Accepted Android device is not connected for final release verification: $serial" }
        $acceptedInstallation = @($evidence.installations | Where-Object { [string]$_.Serial -eq $serial } | Select-Object -First 1)
        Assert-Sha256Equal -Expected $candidateHash -Actual ([string]$acceptedInstallation[0].InstalledSha256) -Boundary "accepted device $serial installation"
        # Finish all device availability checks before commit/push/release so a
        # busy phone cannot turn a safe local pause into a partially published release.
        Assert-DeviceNotBusy -Serial $serial -Context $context -AllowBusyDevice:$AllowBusyDevice
    }

    if (-not $CommitMessage) { $CommitMessage = "Release $tag" }
    Invoke-External -FilePath 'git' -Arguments @('commit', '-m', $CommitMessage)
    $commit = (Invoke-External -FilePath 'git' -Arguments @('rev-parse', 'HEAD') -Capture | Select-Object -First 1).ToString().Trim()
    Invoke-External -FilePath 'git' -Arguments @('push', 'origin', $context.Branch)
    Invoke-External -FilePath 'gh' -Arguments @('release', 'create', $tag, $candidateApk, '--repo', $context.Repository, '--target', $commit, '--title', $tag, '--notes-file', $ReleaseNotesPath)

    $downloadDirectory = Join-Path $artifactDirectory 'redownloaded'
    New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
    Invoke-External -FilePath 'gh' -Arguments @('release', 'download', $tag, '--repo', $context.Repository, '--pattern', $context.ApkName, '--dir', $downloadDirectory, '--clobber')
    $downloadedApk = Join-Path $downloadDirectory $context.ApkName
    $downloadedHash = Get-Sha256 -Path $downloadedApk
    Assert-Sha256Equal -Expected $candidateHash -Actual $downloadedHash -Boundary 'GitHub upload to redownload'
    Assert-ApkMetadata -Path $downloadedApk -Context $context | Out-Null

    $devices = @()
    foreach ($serial in $targetSerials) {
        $devices += Install-AndVerifyApk -ApkPath $downloadedApk -Serial $serial -Context $context -ExpectedSha256 $downloadedHash -AllowBusyDevice:$AllowBusyDevice
    }

    # Post-publish CI watch: the release commit triggers its own CI run. Wait for it
    # and record the conclusion; a red release run is reported loudly (the release
    # is already out, so fix forward) but the evidence always records the truth.
    $releaseCiRunId = $null
    $releaseCiConclusion = 'unknown'
    if ($WaitForReleaseCiMinutes -gt 0) {
        $deadline = (Get-Date).AddMinutes($WaitForReleaseCiMinutes)
        while ((Get-Date) -lt $deadline) {
            $releaseRun = Get-CiRunForCommit -CommitSha $commit
            if ($releaseRun -and $releaseRun.status -eq 'completed') {
                $releaseCiRunId = [long]$releaseRun.databaseId
                $releaseCiConclusion = [string]$releaseRun.conclusion
                break
            }
            Start-Sleep -Seconds 30
        }
        if (-not $releaseCiRunId) {
            Write-Warning "Release CI run did not finish within $WaitForReleaseCiMinutes minutes; conclusion remains pending."
        } elseif ($releaseCiConclusion -ne 'success') {
            Write-Warning "Release CI run $releaseCiRunId concluded '$releaseCiConclusion'. The release is already published; fix forward and keep this in the log."
        } else {
            Write-Host "Release CI run $releaseCiRunId concluded success."
        }
    }

    # Release completeness audit: tag, GitHub Release, and Latest marker must line up.
    for ($attempt = 1; $attempt -le 3; $attempt += 1) {
        & (Join-Path $PSScriptRoot 'Audit-Release.ps1')
        if ($LASTEXITCODE -eq 0) { break }
        if ($attempt -eq 3) { throw "Release audit failed for $tag after retries." }
        Start-Sleep -Seconds 10
    }

    Set-EvidenceProperty -Evidence $evidence -Name phase -Value 'published'
    Set-EvidenceProperty -Evidence $evidence -Name publishedAt -Value ((Get-Date).ToUniversalTime().ToString('o'))
    Set-EvidenceProperty -Evidence $evidence -Name commit -Value $commit
    Set-EvidenceProperty -Evidence $evidence -Name tag -Value $tag
    Set-EvidenceProperty -Evidence $evidence -Name redownloadedApk -Value $downloadedApk
    Set-EvidenceProperty -Evidence $evidence -Name redownloadedSha256 -Value $downloadedHash
    Set-EvidenceProperty -Evidence $evidence -Name publishDevices -Value @($devices)
    Set-EvidenceProperty -Evidence $evidence -Name releaseCiRunId -Value $releaseCiRunId
    Set-EvidenceProperty -Evidence $evidence -Name releaseCiConclusion -Value $releaseCiConclusion
    Write-ReleaseEvidence -Evidence $evidence -Path $evidencePath
    Write-Host "Published and verified $tag ($downloadedHash)."
}
finally {
    Pop-Location
}
