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
    }

    $deliveryHistory = @(Get-DeliveredApkHistory -Context $context -Channel all)
    $candidateMetadata = Assert-ApkMetadata -Path $candidate.Path -Context $context
    foreach ($target in $(if (@($Serial).Count -gt 0) { @($Serial) } else { @(Get-AuthorizedAndroidDevices) })) {
        $installedMetadata = Get-InstalledApkMetadata -Serial $target -PackageId $context.PackageId
        if (-not $installedMetadata) { continue }
        if ($installedMetadata.SignerSha256 -ne $context.SignerSha256) { throw "Installed app signer identity does not match release config on $target." }
        $knownDelivery = @($deliveryHistory | Where-Object { $_.PackageId -eq $installedMetadata.PackageId -and $_.VersionCode -eq $installedMetadata.VersionCode -and $_.Sha256 -eq $installedMetadata.Sha256 })
        if ($knownDelivery.Count -eq 0) {
            $deliveryHistory += [pscustomobject]@{
                Channel = $installedMetadata.BuildChannel; PackageId = $installedMetadata.PackageId
                VersionName = $installedMetadata.VersionName; VersionCode = $installedMetadata.VersionCode
                SignerSha256 = $installedMetadata.SignerSha256; Sha256 = $installedMetadata.Sha256
                EvidencePath = "device:$target"; Kind = 'installed-device'
            }
        }
    }
    Assert-NextDeliveredApkVersion -Metadata $candidateMetadata -Context $context -Channel standard -History $deliveryHistory -DeliveryRoundId ([string](Get-OptionalEvidenceProperty -Object $evidence -Name 'deliveryRoundId'))

    foreach ($target in $targets) {
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
