[CmdletBinding()]
param([Parameter(Mandatory)][string]$ApkPath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')
$aapt = Get-AndroidBuildTool -Name 'aapt.exe'
$tree = (Invoke-External -FilePath $aapt -Arguments @('dump','xmltree',$ApkPath,'AndroidManifest.xml') -Capture) -join "`n"
$service = @(($tree -split '(?m)^\s*E: ') | Where-Object {
    $_ -match '^service\b' -and $_ -match '"(?:com\.blockcolc\.app\.)?\.?AutomaticTimerService"'
})
if ($service.Count -ne 1 -or $service[0] -notmatch 'android:foregroundServiceType[^\r\n]*0x400\b' -or
    $service[0] -notmatch 'android:exported[^\r\n]*0x0\b') {
    throw 'Packaged automatic timer must be non-exported and systemExempted (0x400).'
}
foreach ($permission in @('FOREGROUND_SERVICE','FOREGROUND_SERVICE_SYSTEM_EXEMPTED','USE_EXACT_ALARM')) {
    if ($tree -notmatch ('"android\.permission\.' + [regex]::Escape($permission) + '"')) {
        throw "Missing timer permission: $permission"
    }
}
Write-Host 'Verified finite automatic timer service declaration and exact-alarm integration permissions.'
