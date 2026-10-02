[CmdletBinding()]
param(
    [Parameter(Mandatory)][switch]$ConfirmPublish,
    [Parameter(Mandatory)][switch]$ConfirmUserAcceptance,
    [Parameter(Mandatory)][string]$UserApproval,
    [Parameter(Mandatory)][string]$PairedEvidencePath,
    [Parameter(Mandatory)][string]$ReleaseNotesPath,
    [string]$CommitMessage,
    [int]$WaitForCiMinutes = 15
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')
if (-not $ConfirmPublish -or -not $ConfirmUserAcceptance -or [string]::IsNullOrWhiteSpace($UserApproval)) {
    throw 'Paired publication requires explicit user acceptance and publication authorization.'
}
$context = Get-ReleaseContext
$tag = "v$($context.VersionName)"
$evidencePath = Get-ReleaseEvidencePath -Context $context
$evidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
$pairPath = (Resolve-Path -LiteralPath $PairedEvidencePath).Path
$pair = Get-Content -LiteralPath $pairPath -Raw | ConvertFrom-Json
$notesPath = (Resolve-Path -LiteralPath $ReleaseNotesPath).Path
if ($evidence.phase -notin @('prepared','accepted')) { throw "Cannot publish candidate in phase $($evidence.phase)." }
Push-Location $context.Root
try {
    $branch = (Invoke-External -FilePath git -Arguments @('branch','--show-current') -Capture | Select-Object -First 1).Trim()
    if ($branch -cne $context.Branch) { throw 'Publication must run on the configured release branch.' }
    Assert-ReleaseWorkPacketComplete -Context $context
    Assert-ReleaseReportIndex -Evidence $evidence -Context $context
    $standard = Assert-ApkMetadata -Path $evidence.candidateApk -Context $context
    $private = Assert-ApkMetadata -Path $pair.private.apk -Context $context -AllowPrivateRelay
    if ($standard.BuildChannel -ne 'standard' -or $private.BuildChannel -ne 'private-relay') { throw 'Unexpected paired APK channels.' }
    Assert-Sha256Equal -Expected $evidence.candidateSha256 -Actual $standard.Sha256 -Boundary 'immutable standard candidate'
    Assert-Sha256Equal -Expected $pair.private.sha256 -Actual $private.Sha256 -Boundary 'user-accepted private APK'
    Assert-PairedReleaseEvidence -Evidence $evidence -Pair $pair -Context $context -StandardAssets @(Get-ApkPublicAssets $evidence.candidateApk) -PrivateAssets @(Get-ApkPublicAssets $pair.private.apk)
    $isolationTool = Join-Path (Split-Path -Parent $context.Root) 'blockcolc-relay-private\tools\Test-ApkIsolation.ps1'
    & $isolationTool -ApkPath $evidence.candidateApk -Channel standard -RepositoryRoot $context.Root
    & $isolationTool -ApkPath $pair.private.apk -Channel private-relay -RepositoryRoot $context.Root
    $manifestPath = Join-Path $context.Root 'docs\assets\local-blueprints-manifest.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    foreach ($asset in $manifest.assets) {
        Assert-Sha256Equal -Expected $asset.assetSha256 -Actual (Get-Sha256 -Path (Join-Path $context.Root $asset.asset)) -Boundary "frozen local blueprint $($asset.id)"
    }
    $history = @(Get-DeliveredApkHistory -Context $context -Channel all)
    Assert-NextDeliveredApkVersion -Metadata $standard -Context $context -Channel standard -History $history -DeliveryRoundId $evidence.deliveryRoundId
    Invoke-External -FilePath node -Arguments @('tools/sync-version.mjs','--check')

    if ($evidence.phase -eq 'prepared') {
        Assert-StagedState
        $tree = (Invoke-External -FilePath git -Arguments @('write-tree') -Capture | Select-Object -First 1).Trim()
        # After user testing, only publication documents and release tooling may
        # change. App code, dependencies, configuration and assets remain frozen.
        $changed = @(Invoke-External -FilePath git -Arguments @('diff','--name-only',$evidence.stagedTree,$tree) -Capture | Where-Object { $_ })
        $allowed = @('tools/Publish-PairedRelease.ps1','tools/Release-Common.ps1','tools/Test-ReleaseWorkflow.ps1','docs/TESTING.md','docs/TODO.md','docs/versions/README.md',"docs/versions/V$($context.VersionCode).md","docs/versions/$($context.VersionName)-development.md","docs/releases/$tag.md")
        $unexpected = @($changed | Where-Object { $_ -notin $allowed })
        if ($unexpected.Count -gt 0) { throw "Application inputs changed after user testing: $($unexpected -join ', ')" }
        & (Join-Path $PSScriptRoot 'Test-ReleaseWorkflow.ps1')
        $oldInputs = [ordered]@{ stagedTree=$evidence.stagedTree; stagedDiffSha256=$evidence.stagedDiffSha256; testFingerprintSha256=$evidence.testFingerprintSha256 }
        Set-EvidenceProperty -Evidence $evidence -Name publicationPreparation -Value ([pscustomobject][ordered]@{
            previousInputs=$oldInputs; changedPaths=$changed; applicationInputsChanged=$false; toolRegression='passed'; candidateRebuilt=$false; fullApplicationGateRerun=$false
        })
        Set-EvidenceProperty -Evidence $evidence -Name stagedTree -Value $tree
        Set-EvidenceProperty -Evidence $evidence -Name stagedDiffSha256 -Value (Get-StagedDiffSha256)
        Set-EvidenceProperty -Evidence $evidence -Name testFingerprintSha256 -Value (Get-StagedTestFingerprintSha256)
        $acceptance = [pscustomobject][ordered]@{
            kind='same-round-private-package-acceptance-for-public-standard-release'; acceptedAt=[datetime]::UtcNow.ToString('o'); userQuote=$UserApproval.Trim()
            deliveryRoundId=$evidence.deliveryRoundId; candidateSha256=$standard.Sha256; privateApkSha256=$private.Sha256
            pairedEvidencePath=$pairPath; pairedEvidenceSha256=(Get-Sha256 -Path $pairPath)
            stagedTree=$tree; stagedDiffSha256=$evidence.stagedDiffSha256; testFingerprintSha256=$evidence.testFingerprintSha256
            additionalDeviceAcceptanceRequired=$false; installations=@()
        }
        Set-EvidenceProperty -Evidence $evidence -Name acceptance -Value $acceptance
        Set-EvidenceProperty -Evidence $evidence -Name phase -Value 'accepted'
        Write-ReleaseEvidence -Evidence $evidence -Path $evidencePath
    }
    $approval = $evidence.acceptance
    if ($approval.kind -ne 'same-round-private-package-acceptance-for-public-standard-release') { throw 'Not a paired private acceptance record.' }
    Assert-Sha256Equal -Expected $approval.candidateSha256 -Actual $standard.Sha256 -Boundary 'user approval to standard candidate'
    Assert-Sha256Equal -Expected $approval.privateApkSha256 -Actual $private.Sha256 -Boundary 'user approval to private APK'
    Assert-Sha256Equal -Expected $approval.pairedEvidenceSha256 -Actual (Get-Sha256 -Path $pairPath) -Boundary 'user approval to pair evidence'

    $commit = [string](Get-OptionalEvidenceProperty -Object $evidence -Name 'publicationCommit')
    if (-not $commit) {
        Assert-ReleaseEvidenceMatchesStagedState -Evidence $evidence
        if (-not $CommitMessage) { $CommitMessage = "Release $tag" }
        Invoke-External -FilePath git -Arguments @('commit','-m',$CommitMessage)
        $commit = (Invoke-External -FilePath git -Arguments @('rev-parse','HEAD') -Capture | Select-Object -First 1).Trim()
        Set-EvidenceProperty -Evidence $evidence -Name publicationCommit -Value $commit
        Write-ReleaseEvidence -Evidence $evidence -Path $evidencePath
    }
    Invoke-External -FilePath git -Arguments @('diff','--quiet')
    Invoke-External -FilePath git -Arguments @('diff','--cached','--quiet')
    $head = (Invoke-External -FilePath git -Arguments @('rev-parse','HEAD') -Capture | Select-Object -First 1).Trim()
    $commitTree = (Invoke-External -FilePath git -Arguments @('rev-parse',"$commit`^{tree}") -Capture | Select-Object -First 1).Trim()
    if ($head -cne $commit -or $commitTree -cne $evidence.stagedTree) { throw 'Publication commit differs from the frozen accepted tree.' }
    Invoke-External -FilePath git -Arguments @('push','origin',$context.Branch)

    # Wait for the exact committed source before creating a public Release.
    $deadline = [datetime]::UtcNow.AddMinutes($WaitForCiMinutes)
    $run = $null
    while ([datetime]::UtcNow -lt $deadline) {
        $runs = (Invoke-External -FilePath gh -Arguments @('run','list','--repo',$context.Repository,'--commit',$commit,'--json','databaseId,workflowName,status,conclusion','--limit','10') -Capture) -join "`n" | ConvertFrom-Json
        $run = @($runs | Where-Object workflowName -eq 'Android CI' | Select-Object -First 1)
        if ($run.Count -gt 0) { break }
        Start-Sleep -Seconds 15
    }
    if (@($run).Count -eq 0) { throw 'No CI run appeared for the publication commit; Release was not created.' }
    $run = $run[0]
    Invoke-External -FilePath gh -Arguments @('run','watch',[string]$run.databaseId,'--repo',$context.Repository,'--exit-status','--interval','30')
    $completed = (Invoke-External -FilePath gh -Arguments @('run','view',[string]$run.databaseId,'--repo',$context.Repository,'--json','headSha,status,conclusion') -Capture) -join "`n" | ConvertFrom-Json
    if ($completed.headSha -cne $commit -or $completed.status -ne 'completed' -or $completed.conclusion -ne 'success') { throw 'Publication commit CI did not pass; Release was not created.' }
    Set-EvidenceProperty -Evidence $evidence -Name releaseCiRunId -Value ([long]$run.databaseId)
    Set-EvidenceProperty -Evidence $evidence -Name releaseCiConclusion -Value 'success'
    Write-ReleaseEvidence -Evidence $evidence -Path $evidencePath

    Assert-ReleaseCandidateEvidence -Evidence $evidence -Context $context -Boundary 'accepted standard immediately before upload' | Out-Null
    $view = @(& gh release view $tag --repo $context.Repository --json tagName,url,isDraft,assets 2>&1)
    if ($LASTEXITCODE -eq 0) {
        $release = ($view -join "`n") | ConvertFrom-Json
        $existingCommit = (Invoke-External -FilePath gh -Arguments @('api',"repos/$($context.Repository)/commits/$tag",'--jq','.sha') -Capture | Select-Object -First 1).Trim()
        if ($existingCommit -cne $commit -or $release.isDraft) { throw 'Existing Release belongs to another commit or is a draft; do not overwrite it.' }
    } elseif (($view -join "`n") -match 'release not found|Not Found|HTTP 404') {
        Invoke-External -FilePath gh -Arguments @('release','create',$tag,[string]$evidence.candidateApk,'--repo',$context.Repository,'--target',$commit,'--title',$tag,'--notes-file',$notesPath,'--latest')
    } else { throw "Cannot determine Release existence: $($view -join ' ')" }
    $release = (Invoke-External -FilePath gh -Arguments @('release','view',$tag,'--repo',$context.Repository,'--json','tagName,url,isDraft,assets') -Capture) -join "`n" | ConvertFrom-Json
    if ($release.isDraft -or @($release.assets).Count -ne 1 -or $release.assets[0].name -cne $context.ApkName) { throw 'Public Release must contain only the authorized standard APK.' }
    $downloadDirectory = Join-Path (Split-Path -Parent $evidencePath) 'redownloaded'
    New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
    Invoke-External -FilePath gh -Arguments @('release','download',$tag,'--repo',$context.Repository,'--pattern',$context.ApkName,'--dir',$downloadDirectory,'--clobber')
    $downloaded = Join-Path $downloadDirectory $context.ApkName
    $downloadedMetadata = Assert-ApkMetadata -Path $downloaded -Context $context
    Assert-Sha256Equal -Expected $standard.Sha256 -Actual $downloadedMetadata.Sha256 -Boundary 'public standard APK redownload'
    & $isolationTool -ApkPath $downloaded -Channel standard -RepositoryRoot $context.Root
    Invoke-External -FilePath pwsh -Arguments @('-NoProfile','-File',(Join-Path $PSScriptRoot 'Audit-Release.ps1'))
    Set-EvidenceProperty -Evidence $evidence -Name phase -Value 'published'
    Set-EvidenceProperty -Evidence $evidence -Name publishedAt -Value ([datetime]::UtcNow.ToString('o'))
    Set-EvidenceProperty -Evidence $evidence -Name commit -Value $commit
    Set-EvidenceProperty -Evidence $evidence -Name tag -Value $tag
    Set-EvidenceProperty -Evidence $evidence -Name releaseUrl -Value $release.url
    Set-EvidenceProperty -Evidence $evidence -Name redownloadedApk -Value $downloaded
    Set-EvidenceProperty -Evidence $evidence -Name redownloadedSha256 -Value $downloadedMetadata.Sha256
    Set-EvidenceProperty -Evidence $evidence -Name publishDevices -Value @()
    Set-EvidenceProperty -Evidence $evidence -Name releaseAudit -Value ([pscustomobject]@{ tool='tools/Audit-Release.ps1'; exitCode=0 })
    Write-ReleaseEvidence -Evidence $evidence -Path $evidencePath
    Write-Host "Published and verified paired release ${tag}: $($release.url) ($($standard.Sha256))."
} finally { Pop-Location }
