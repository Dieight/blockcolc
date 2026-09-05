[CmdletBinding()]
param(
    [string]$Serial,
    [ValidateRange(1, 10)][int]$Iterations = 3,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$packageId = 'com.blockcolc.app'
$activity = "$packageId/.MainActivity"
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $adb -PathType Leaf)) { $adb = 'adb' }

function Invoke-Adb {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $output = & $adb @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "adb failed ($LASTEXITCODE): adb $($Arguments -join ' ')`n$($output -join "`n")" }
    return @($output)
}

$devices = @(Invoke-Adb -Arguments @('devices')) | Where-Object { $_ -match '^([^\s]+)\s+device$' } | ForEach-Object { $Matches[1] }
if (-not $Serial) {
    if ($devices.Count -ne 1) { throw "Specify -Serial when the authorized-device count is not one. Found: $($devices -join ', ')" }
    $Serial = $devices[0]
}
if ($devices -notcontains $Serial) { throw "Authorized device not found: $Serial" }

function Parse-Launch {
    param([string[]]$Lines, [string]$Kind, [int]$Iteration)
    $joined = $Lines -join "`n"
    $read = {
        param([string]$Name)
        $match = [regex]::Match($joined, "(?m)^${Name}:\s*(\d+)\s*$")
        if ($match.Success) { return [int]$match.Groups[1].Value }
        return $null
    }
    return [ordered]@{
        kind = $Kind
        iteration = $Iteration
        launchState = if ($joined -match '(?m)^LaunchState:\s*(\S+)') { $Matches[1] } else { $null }
        thisTimeMs = & $read 'ThisTime'
        totalTimeMs = & $read 'TotalTime'
        waitTimeMs = & $read 'WaitTime'
    }
}

function Read-PssKb {
    $lines = Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'dumpsys', 'meminfo', $packageId)
    $match = [regex]::Match(($lines -join "`n"), '(?m)^\s*TOTAL\s+(\d+)')
    if ($match.Success) { return [int]$match.Groups[1].Value }
    return $null
}

function Assert-DeviceReady {
    $policy = (Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'dumpsys', 'window', 'policy')) -join "`n"
    $keyguard = [regex]::Match($policy, '(?m)^\s*mIsShowing=(true|false)\s*$')
    if ($keyguard.Success -and $keyguard.Groups[1].Value -eq 'true') {
        throw "Device $Serial is securely locked. Unlock it before measuring; hidden WebGL work does not produce a comparable first frame."
    }
    if ($policy -match '(?m)^\s*interactiveState=(?!INTERACTIVE_STATE_AWAKE)') {
        throw "Device $Serial is not awake. Wake and unlock it before measuring."
    }
}

$packageDump = Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'dumpsys', 'package', $packageId)
$packageText = $packageDump -join "`n"
$versionName = if ($packageText -match '(?m)^\s*versionName=(\S+)') { $Matches[1] } else { $null }
$versionCode = if ($packageText -match '(?m)^\s*versionCode=(\d+)') { [int]$Matches[1] } else { $null }
$results = @()
$diagnosticRuns = @()
Assert-DeviceReady

for ($iteration = 1; $iteration -le $Iterations; $iteration += 1) {
    Assert-DeviceReady
    Invoke-Adb -Arguments @('-s', $Serial, 'logcat', '-c') | Out-Null
    Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'am', 'force-stop', $packageId) | Out-Null
    $cold = Parse-Launch -Lines (Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'am', 'start', '-W', '-n', $activity)) -Kind 'cold' -Iteration $iteration
    Start-Sleep -Seconds 3
    $cold.pssKb = Read-PssKb
    $results += [pscustomobject]$cold

    Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'input', 'keyevent', 'KEYCODE_HOME') | Out-Null
    Start-Sleep -Milliseconds 800
    $warm = Parse-Launch -Lines (Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'am', 'start', '-W', '-n', $activity)) -Kind 'warm' -Iteration $iteration
    Start-Sleep -Seconds 2
    $warm.pssKb = Read-PssKb
    $results += [pscustomobject]$warm
    $runLogLines = Invoke-Adb -Arguments @('-s', $Serial, 'logcat', '-d', '-s', 'BlockcolcStartup:I', 'BlockcolcRender:I', '*:S')
    $diagnosticRuns += [pscustomobject][ordered]@{
        iteration = $iteration
        lines = @($runLogLines | Where-Object { $_ -match 'Blockcolc(Start|Render)' })
    }
}

$batteryDump = (Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'dumpsys', 'battery')) -join "`n"
$temperatureTenthsC = if ($batteryDump -match '(?m)^\s*temperature:\s*(\d+)') { [int]$Matches[1] } else { $null }
$evidence = [ordered]@{
    schemaVersion = 2
    measuredAt = (Get-Date).ToUniversalTime().ToString('o')
    serial = $Serial
    model = ((Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'getprop', 'ro.product.model')) -join '').Trim()
    androidRelease = ((Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'getprop', 'ro.build.version.release')) -join '').Trim()
    sdk = [int](((Invoke-Adb -Arguments @('-s', $Serial, 'shell', 'getprop', 'ro.build.version.sdk')) -join '').Trim())
    versionName = $versionName
    versionCode = $versionCode
    batteryTemperatureC = if ($null -eq $temperatureTenthsC) { $null } else { $temperatureTenthsC / 10 }
    samples = $results
    diagnosticRuns = $diagnosticRuns
    diagnosticLog = @($diagnosticRuns | ForEach-Object { $_.lines })
}

if (-not $OutputPath) {
    $OutputPath = Join-Path $root "artifacts\performance\android-v$versionName-startup.json"
}
$absoluteOutput = [System.IO.Path]::GetFullPath($OutputPath)
$directory = Split-Path -Parent $absoluteOutput
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $absoluteOutput -Encoding utf8
Write-Host "Android startup evidence: $absoluteOutput"
$results | Format-Table kind, iteration, launchState, totalTimeMs, waitTimeMs, pssKb -AutoSize
