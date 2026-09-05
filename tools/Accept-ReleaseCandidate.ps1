[CmdletBinding()]
param(
    [Parameter(Mandatory)][switch]$ConfirmUserAcceptance
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')

if (-not $ConfirmUserAcceptance) { throw 'Candidate acceptance requires -ConfirmUserAcceptance after explicit user approval.' }
$context = Get-ReleaseContext
$evidencePath = Get-ReleaseEvidencePath -Context $context
if (-not (Test-Path -LiteralPath $evidencePath -PathType Leaf)) { throw "Installed release evidence not found: $evidencePath" }
$evidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
if ([string]$evidence.phase -ne 'installed') { throw "Evidence is not in installed phase: $($evidence.phase)" }
if (@($evidence.installations).Count -eq 0) { throw 'No verified device installation is recorded for this candidate.' }

Push-Location $context.Root
try {
    Assert-ReleaseEvidenceVersion -Evidence $evidence -Context $context
    Assert-ReleaseEvidenceMatchesStagedState -Evidence $evidence
    $candidate = Assert-ReleaseCandidateEvidence -Evidence $evidence -Context $context -Boundary 'installed candidate at user acceptance'

    $acceptance = [ordered]@{
        acceptedAt = (Get-Date).ToUniversalTime().ToString('o')
        candidateSha256 = $candidate.Sha256
        stagedTree = [string]$evidence.stagedTree
        stagedDiffSha256 = [string]$evidence.stagedDiffSha256
        testFingerprintSha256 = [string]$evidence.testFingerprintSha256
        installations = @($evidence.installations)
    }
    Set-EvidenceProperty -Evidence $evidence -Name acceptance -Value $acceptance
    Set-EvidenceProperty -Evidence $evidence -Name phase -Value 'accepted'
    Write-ReleaseEvidence -Evidence $evidence -Path $evidencePath
    Write-Host "Recorded user acceptance for immutable candidate $($candidate.Sha256)."
    Write-Warning 'Acceptance does not publish. Publishing still requires the user to explicitly authorize tools/Publish-Release.ps1.'
}
finally {
    Pop-Location
}
