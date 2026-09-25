[CmdletBinding()]
param(
    [string[]]$Serial,
    [switch]$AllowBusyDevice
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')

$context = Get-ReleaseContext
$evidencePath = Get-ReleaseEvidencePath -Context $context
if (-not (Test-Path -LiteralPath $evidencePath -PathType Leaf)) { throw "Prepared evidence not found: $evidencePath" }
$evidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
if (@('prepared', 'installed', 'accepted') -notcontains [string]$evidence.phase) {
    throw "Release candidate cannot be installed from phase '$($evidence.phase)'."
}

Push-Location $context.Root
try {
    Assert-ReleaseEvidenceVersion -Evidence $evidence -Context $context
    Assert-ReleaseEvidenceMatchesStagedState -Evidence $evidence
    $candidate = Assert-ReleaseCandidateEvidence -Evidence $evidence -Context $context -Boundary 'prepared candidate before device install'

    $authorized = @(Get-AuthorizedAndroidDevices)
    $targets = if (@($Serial).Count -gt 0) { @($Serial) } else { $authorized }
    if (@($targets).Count -eq 0) { throw 'No connected authorized Android device is available for release-candidate installation.' }
    foreach ($target in $targets) {
        if ($authorized -notcontains $target) { throw "Android device is not connected and authorized: $target" }
        # Check every target before mutating any of them so a busy device leaves
        # the prepared candidate and its full-gate evidence safely resumable.
        Assert-DeviceNotBusy -Serial $target -Context $context -AllowBusyDevice:$AllowBusyDevice
    }

    $newInstallations = @()
    foreach ($target in $targets) {
        $newInstallations += Install-AndVerifyApk -ApkPath $candidate.Path -Serial $target -Context $context -ExpectedSha256 $candidate.Sha256 -AllowBusyDevice:$AllowBusyDevice
    }

    $bySerial = @{}
    foreach ($installation in @($evidence.installations)) {
        if ($installation -and $installation.Serial) { $bySerial[[string]$installation.Serial] = $installation }
    }
    foreach ($installation in $newInstallations) { $bySerial[[string]$installation.Serial] = $installation }
    $installations = @($bySerial.Values | Sort-Object Serial)

    Set-EvidenceProperty -Evidence $evidence -Name installations -Value $installations
    Set-EvidenceProperty -Evidence $evidence -Name installedAt -Value ((Get-Date).ToUniversalTime().ToString('o'))
    if ([string]$evidence.phase -ne 'accepted') { Set-EvidenceProperty -Evidence $evidence -Name phase -Value 'installed' }
    Write-ReleaseEvidence -Evidence $evidence -Path $evidencePath
    Write-Host "Release candidate installed and verified on $(@($targets).Count) device(s): $evidencePath"
    Write-Host 'After the user has tested this exact candidate, record acceptance with tools/Accept-ReleaseCandidate.ps1.'
}
finally {
    Pop-Location
}
