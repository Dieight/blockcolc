[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Serial,
    [Parameter(Mandatory)][string]$Apk,
    [ValidateRange(1, 5)][int]$Iterations = 3,
    [string]$OutputPath,
    [switch]$Zoom
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutputPath) { $OutputPath = Join-Path $root 'artifacts\performance\android-startup.json' }
# The explicit diagnostic APK and idle guard replace the former force-stop /
# fixed-delay sampler. No global logcat clear or screen-setting changes.
$arguments = @((Join-Path $PSScriptRoot 'measure-android-performance.mjs'), '--serial', $Serial,
    '--apk', $Apk, '--output', $OutputPath, '--iterations', [string]$Iterations)
if ($Zoom) { $arguments += '--zoom' }
& node @arguments
if ($LASTEXITCODE -ne 0) { throw "Android performance measurement failed ($LASTEXITCODE). See $OutputPath." }
