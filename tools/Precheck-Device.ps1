[CmdletBinding()]
param(
    [string]$Serial
)

# Precheck-Device.ps1 — manual acceptance guard. Prints the device state and
# exits 1 when the device looks busy (a third-party app in the foreground) or
# the screen is landscape, so adb tap sweeps never land inside someone's game.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')

$devices = @()
if ($Serial) {
    $devices += $Serial
} else {
    $devices += Get-AuthorizedAndroidDevices
}
if ($devices.Count -eq 0) { Write-Warning 'No adb device connected.'; exit 1 }

$busy = $false
foreach ($device in $devices) {
    $adb = Get-AdbPath
    $model = (((Invoke-External -FilePath $adb -Arguments @('-s', $device, 'shell', 'getprop', 'ro.product.model') -Capture) -join '')).Trim()
    $android = (((Invoke-External -FilePath $adb -Arguments @('-s', $device, 'shell', 'getprop', 'ro.build.version.release') -Capture) -join '')).Trim()
    $size = (((Invoke-External -FilePath $adb -Arguments @('-s', $device, 'shell', 'wm', 'size') -Capture) -join '')).Trim()
    $density = (((Invoke-External -FilePath $adb -Arguments @('-s', $device, 'shell', 'wm', 'density') -Capture) -join '')).Trim()
    $displayDump = (Invoke-External -FilePath $adb -Arguments @('-s', $device, 'shell', 'dumpsys', 'display') -Capture) -join "`n"
    $orientationMatch = [regex]::Match($displayDump, 'mCurrentOrientation=(\d+)')
    $orientation = if ($orientationMatch.Success) { [int]$orientationMatch.Groups[1].Value } else { -1 }
    $power = (Invoke-External -FilePath $adb -Arguments @('-s', $device, 'shell', 'dumpsys', 'power') -Capture) -join "`n"
    $awake = if ($power -match 'mWakefulness=Awake') { 'Awake' } else { 'Asleep' }
    $foreground = Get-ForegroundPackage -Serial $device
    $launcher = Get-DefaultLauncherPackage -Serial $device

    Write-Host "Device $device ($model, Android $android): $size, $density, orientation=$orientation, $awake, foreground=$foreground, launcher=$launcher"
    if ($orientation -ne 0) { Write-Warning "$device is not portrait (orientation=$orientation); tap coordinates would be wrong."; $busy = $true }
    if ($awake -eq 'Awake' -and $foreground -and $foreground -ne 'com.blockcolc.app' -and $foreground -ne $launcher) {
        Write-Warning "$device is busy (foreground: $foreground). Do not run acceptance taps now."; $busy = $true
    }
}

if ($busy) { exit 1 }
Write-Host 'Devices are idle and portrait; acceptance taps are safe.'
exit 0
