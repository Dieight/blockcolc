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
if ($evidence.phase -ne 'prepared') { throw "Evidence is not in prepared phase: $($evidence.phase)" }
if ($evidence.versionName -ne $context.VersionName -or [int]$evidence.versionCode -ne $context.VersionCode) { throw 'Prepared version does not match version.json.' }

function Get-CiRunForCommit {
    param([Parameter(Mandatory)][string]$CommitSha)
    $runs = (Invoke-External -FilePath 'gh' -Arguments @('run', 'list', '--repo', $context.Repository, '--commit', $CommitSha, '--json', 'databaseId,status,conclusion', '--limit', '1') -Capture) -join "`n" | ConvertFrom-Json
    if (-not $runs) { return $null }
    return $runs | Select-Object -First 1
}

Push-Location $context.Root
try {
    Assert-StagedState
    Invoke-External -FilePath 'node' -Arguments @('tools/sync-version.mjs', '--check')
    $currentTree = (Invoke-External -FilePath 'git' -Arguments @('write-tree') -Capture | Select-Object -First 1).ToString().Trim()
    if ($currentTree -ne $evidence.stagedTree) { throw 'Staged tree changed after release preparation.' }
    $currentDiffHash = Get-StagedDiffSha256
    Assert-Sha256Equal -Expected $evidence.stagedDiffSha256 -Actual $currentDiffHash -Boundary 'prepared to publish staged diff'

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

    $candidateApk = [string]$evidence.candidateApk
    $candidateHash = Get-Sha256 -Path $candidateApk
    Assert-Sha256Equal -Expected $evidence.candidateSha256 -Actual $candidateHash -Boundary 'prepared to publish candidate APK'
    Assert-ApkMetadata -Path $candidateApk -Context $context | Out-Null

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
    foreach ($serial in (Get-AuthorizedAndroidDevices)) {
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

    $evidence.phase = 'published'
    $evidence | Add-Member -NotePropertyName publishedAt -NotePropertyValue ((Get-Date).ToUniversalTime().ToString('o'))
    $evidence | Add-Member -NotePropertyName commit -NotePropertyValue $commit
    $evidence | Add-Member -NotePropertyName tag -NotePropertyValue $tag
    $evidence | Add-Member -NotePropertyName redownloadedApk -NotePropertyValue $downloadedApk
    $evidence | Add-Member -NotePropertyName redownloadedSha256 -NotePropertyValue $downloadedHash
    $evidence | Add-Member -NotePropertyName publishDevices -NotePropertyValue @($devices)
    $evidence | Add-Member -NotePropertyName releaseCiRunId -NotePropertyValue $releaseCiRunId
    $evidence | Add-Member -NotePropertyName releaseCiConclusion -NotePropertyValue $releaseCiConclusion
    $evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidencePath -Encoding utf8
    Write-Host "Published and verified $tag ($downloadedHash)."
}
finally {
    Pop-Location
}
