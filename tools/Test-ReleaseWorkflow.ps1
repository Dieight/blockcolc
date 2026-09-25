[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')

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

$hashA = ('a' * 64) -join ''
Assert-True -Condition ((Get-ApkBuildChannel -ManifestTree 'E: application') -eq 'standard') -Message 'Legacy standard marker'
$privateManifest = "E: application`n  E: meta-data`n    A: android:name(0x01010003)=`"com.blockcolc.PRIVATE_RELAY`"`n    A: android:value(0x01010024)=(type 0x12)0xffffffff`n  E: activity"
Assert-True -Condition ((Get-ApkBuildChannel -ManifestTree $privateManifest) -eq 'private-relay') -Message 'Private relay marker'
Assert-True -Condition ((Get-ApkBuildChannel -ManifestTree ($privateManifest.Replace('0xffffffff', '0x0'))) -eq 'standard') -Message 'Explicit standard marker'
Assert-Throws -MessagePattern 'Unrecognized' -Action { Get-ApkBuildChannel -ManifestTree ($privateManifest.Replace('0xffffffff', '0x1')) }
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

$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temporaryRoot = [IO.Path]::GetFullPath((Join-Path $temporaryBase "blockcolc-release-workflow-$([guid]::NewGuid().ToString('N'))"))
if (-not $temporaryRoot.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe temporary test path: $temporaryRoot" }
try {
    $packetDirectory = Join-Path $temporaryRoot 'docs\versions'
    New-Item -ItemType Directory -Path $packetDirectory -Force | Out-Null
    $packetPath = Join-Path $packetDirectory 'V26.md'
    Set-Content -LiteralPath $packetPath -Encoding utf8 -Value "| 需求 | 状态 | 证据 |`n| --- | --- | --- |`n| REL-26-01 | 待实施 | none |"
    $packetContext = [pscustomobject]@{ Root = $temporaryRoot; VersionCode = 26 }
    Assert-Throws -MessagePattern 'incomplete requirements' -Action { Assert-ReleaseWorkPacketComplete -Context $packetContext }
    Set-Content -LiteralPath $packetPath -Encoding utf8 -Value "| 需求 | 状态 | 证据 |`n| --- | --- | --- |`n| REL-26-01 | 完成 | verified |"
    Assert-ReleaseWorkPacketComplete -Context $packetContext
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}

$prepareSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Prepare-Release.ps1') -Raw
$installSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Install-ReleaseCandidate.ps1') -Raw
$publishSource = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Publish-Release.ps1') -Raw
Assert-True -Condition ($prepareSource -notmatch 'Install-AndVerifyApk') -Message 'Prepare-Release must not install or launch a connected device.'
Assert-True -Condition ($publishSource -notmatch 'Build-AndroidRelease|gradlew|vite\s+build') -Message 'Publish-Release must not rebuild the accepted candidate.'
$busyIndex = $installSource.IndexOf('Assert-DeviceNotBusy', [StringComparison]::Ordinal)
$installIndex = $installSource.IndexOf('Install-AndVerifyApk', [StringComparison]::Ordinal)
Assert-True -Condition ($busyIndex -ge 0 -and $installIndex -gt $busyIndex) -Message 'Release candidate installation must check every device before invoking installation.'

Write-Host 'Release workflow contract tests passed.'
