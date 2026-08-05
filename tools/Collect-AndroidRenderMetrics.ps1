[CmdletBinding()]
param(
  [string]$Package = 'com.blockcolc.app',
  [string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts\v9-device-metrics.txt')
)

$ErrorActionPreference = 'Stop'
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $adb -PathType Leaf)) { throw "ADB not found: $adb" }
$devices = & $adb devices
$authorized = @($devices | Select-String '\tdevice$')
if ($authorized.Count -eq 0) { throw 'No authorized Android device is connected.' }

$parent = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
$timestamp = (Get-Date).ToString('o')
$gfx = (& $adb shell dumpsys gfxinfo $Package framestats) -join "`n"
$mem = (& $adb shell dumpsys meminfo $Package) -join "`n"
$thermal = (& $adb shell dumpsys thermalservice) -join "`n"
$battery = (& $adb shell dumpsys battery) -join "`n"
$renderProcess = (& $adb shell pidof $Package) -join ' '

@"
Tomato Clock V9 device metrics
capturedAt=$timestamp
package=$Package
pid=$renderProcess

=== gfxinfo framestats ===
$gfx

=== meminfo ===
$mem

=== thermalservice ===
$thermal

=== battery ===
$battery
"@ | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Output $OutputPath
