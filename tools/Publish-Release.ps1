[CmdletBinding()]
param(
    [Parameter(Mandatory)][switch]$ConfirmPublish,
    [Parameter(Mandatory)][string]$ReleaseNotesPath,
    [string]$CommitMessage
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

Push-Location $context.Root
try {
    Assert-StagedState
    Invoke-External -FilePath 'node' -Arguments @('tools/sync-version.mjs', '--check')
    $currentTree = (Invoke-External -FilePath 'git' -Arguments @('write-tree') -Capture | Select-Object -First 1).ToString().Trim()
    if ($currentTree -ne $evidence.stagedTree) { throw 'Staged tree changed after release preparation.' }
    $currentDiffHash = Get-StagedDiffSha256
    Assert-Sha256Equal -Expected $evidence.stagedDiffSha256 -Actual $currentDiffHash -Boundary 'prepared to publish staged diff'

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
        $devices += Install-AndVerifyApk -ApkPath $downloadedApk -Serial $serial -Context $context -ExpectedSha256 $downloadedHash
    }

    $evidence.phase = 'published'
    $evidence | Add-Member -NotePropertyName publishedAt -NotePropertyValue ((Get-Date).ToUniversalTime().ToString('o'))
    $evidence | Add-Member -NotePropertyName commit -NotePropertyValue $commit
    $evidence | Add-Member -NotePropertyName tag -NotePropertyValue $tag
    $evidence | Add-Member -NotePropertyName redownloadedApk -NotePropertyValue $downloadedApk
    $evidence | Add-Member -NotePropertyName redownloadedSha256 -NotePropertyValue $downloadedHash
    $evidence | Add-Member -NotePropertyName publishDevices -NotePropertyValue @($devices)
    $evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $evidencePath -Encoding utf8
    Write-Host "Published and verified $tag ($downloadedHash)."
}
finally {
    Pop-Location
}
