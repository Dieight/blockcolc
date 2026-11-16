param(
    [Parameter(Mandatory=$true)][string]$Adb,
    [Parameter(Mandatory=$true)][string]$Serial,
    [Parameter(Mandatory=$true)][string]$Evidence,
    [Parameter(Mandatory=$true)][string]$Output,
    [string]$Capabilities
)
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $Output){throw 'Restoration evidence already exists'}
function Read-Adb([string[]]$DeviceArgs){
    $value=(& $Adb -s $Serial @DeviceArgs | Out-String).Trim()
    if($LASTEXITCODE -ne 0){throw 'Read-only ADB check failed'}
    return $value
}
function Checked-Policy([string]$Name){
    [xml]$xml=Get-Content -Raw -LiteralPath (Join-Path $Evidence $Name)
    if(!$xml.SelectSingleNode('//node[@text="blockcolc · native preview"]')){throw 'Wrong battery settings app'}
    $nodes=$xml.SelectNodes('//node[@checkable="true" and @checked="true"]')
    if($nodes.Count -ne 1){throw 'Missing unique checked battery policy'}
    $row=$nodes[0].ParentNode.ParentNode
    return @($row.SelectNodes('.//node[@text!=""]') | ForEach-Object {$_.text})[0]
}
$original=Checked-Policy 'battery-before.xml'
$restored=Checked-Policy 'restore-battery-after.xml'
if($original -ne '智能优化后台运行（推荐）' -or $restored -ne $original){throw 'Battery policy did not return to original'}
$package=Read-Adb @('shell','dumpsys','package','com.blockcolc.preview')
$notification=($package -split '\r?\n' | Where-Object {$_ -match 'android.permission.POST_NOTIFICATIONS: granted='}).Trim()
if($notification -notmatch 'granted=false'){throw 'Notification permission remains enabled'}
$exact=Read-Adb @('shell','appops','get','com.blockcolc.preview','SCHEDULE_EXACT_ALARM')
if($exact -notmatch 'SCHEDULE_EXACT_ALARM: deny'){throw 'Exact alarm still enabled'}
$prefs=Read-Adb @('shell','run-as','com.blockcolc.preview','cat','shared_prefs/p2-storage.xml')
if($prefs -notmatch '<string name="database">p2-state.db</string>' -or $prefs -match 'name="beforeTest"'){throw 'Preview DB not restored'}
$idle=Read-Adb @('shell','dumpsys','deviceidle')
if($idle -notmatch 'mForceIdle=false' -or $idle -notmatch 'mState=ACTIVE'){throw 'Forced idle not restored'}
$foreground=Read-Adb @('shell','dumpsys','window')
$focus=($foreground -split '\r?\n' | Where-Object {$_ -match 'mCurrentFocus='}).Trim()
if($focus -notmatch 'com.android.launcher'){throw 'Device not returned to Launcher'}
try {$pidValue=Read-Adb @('shell','pidof','com.blockcolc.preview')} catch {$pidValue=''}
if($pidValue){throw 'Preview still running'}
$platform=$null
if($Capabilities){
    $platform=Get-Content -Raw -LiteralPath $Capabilities | ConvertFrom-Json
    if(!$platform.pureRead -or $platform.notify -or $platform.exact -or $platform.ignoringBatteryOptimizations){throw 'Actual platform APIs did not return to the original denied/non-exempt condition'}
}
$result=[ordered]@{completed=$true;capturedAt=[DateTime]::UtcNow.ToString('o');package='com.blockcolc.preview';serial=$Serial;
    batteryOriginal=$original;batteryRestored=$restored;notifications=$notification;exactAlarm=$exact;preferences=$prefs;
    globalIdleForced=$false;globalIdleState='ACTIVE';foreground=$focus;previewStopped=$true;platformCapabilities=$platform;
    scope='Read-only verification after system-UI restoration. No formal App or global battery settings changed. Battery policy is bound to the saved actual system-page XML, not a successful tap alone.'}
$result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $Output -Encoding utf8
$result | ConvertTo-Json -Depth 4
