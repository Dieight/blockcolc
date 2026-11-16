[CmdletBinding()]
param([ValidateSet('notifications','alarms')][string]$Kind,[ValidateSet('read','enabled','disabled')][string]$Mode='read',[string]$Serial='a50247d1')
$ErrorActionPreference='Stop'
$adb='C:\Users\james\AppData\Local\Android\Sdk\platform-tools\adb.exe'
$package='com.blockcolc.preview'
function Adb([string[]]$Arguments){$r=@(& $adb -s $Serial @Arguments 2>&1);if($LASTEXITCODE -ne 0){throw ($r -join "`n")};return $r}
function OwnSwitch {
    if(((Adb @('shell','dumpsys','window','policy')) -join "`n") -match 'showing=true|isStatusBarKeyguard=true'){throw 'Manual unlock required; no permission changed'}
    Adb @('shell','uiautomator','dump','/data/local/tmp/blockcolc-p2-permission.xml')|Out-Null
    [xml]$xml=(Adb @('shell','cat','/data/local/tmp/blockcolc-p2-permission.xml')) -join ''
    if(!$xml.SelectSingleNode("//*[@text='blockcolc · native preview']")){throw 'Not the independent preview settings; no switch touched'}
    $title=if($Kind -eq 'alarms'){'允许设置闹钟和提醒'}else{'允许通知'}
    if(!$xml.SelectSingleNode("//*[@text='$title']")){throw 'Expected own permission option not found'}
    $switches=$xml.SelectNodes("//*[@resource-id='android:id/switch_widget' and @checkable='true']")
    if($Kind -eq 'alarms'){
        if($switches.Count -ne 1){throw 'Exact alarm switch is not unique'}
        return $switches[0]
    }
    $label=$xml.SelectSingleNode("//*[@text='$title']")
    $switch=$label.ParentNode.ParentNode.SelectSingleNode(".//*[@resource-id='android:id/switch_widget' and @checkable='true']")
    if(!$switch){throw 'App-level notification switch not identified; channel settings untouched'}
    return $switch
}
if($Kind -eq 'alarms'){Adb @('shell','am','start','-W','-a','android.settings.REQUEST_SCHEDULE_EXACT_ALARM','-d',"package:$package")|Out-Null}
else{Adb @('shell','am','start','-W','-a','android.settings.APP_NOTIFICATION_SETTINGS','--es','android.provider.extra.APP_PACKAGE',$package)|Out-Null}
$switch=OwnSwitch;$previous=$switch.checked -eq 'true'
if($Mode -ne 'read' -and $previous -ne ($Mode -eq 'enabled')){
    if($switch.bounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$'){throw 'Observed switch bounds unavailable'}
    Adb @('shell','input','tap',"$([int](([int]$Matches[1]+[int]$Matches[3])/2))","$([int](([int]$Matches[2]+[int]$Matches[4])/2))")|Out-Null
    $switch=OwnSwitch
    if(($switch.checked -eq 'true') -ne ($Mode -eq 'enabled')){throw 'Permission did not reach requested state'}
}
$current=$switch.checked -eq 'true'
Adb @('shell','input','keyevent','KEYCODE_HOME')|Out-Null
[pscustomobject]@{package=$package;kind=$Kind;previous=$previous;current=$current;scope='Normal Settings UI; exact preview label only'}|ConvertTo-Json -Compress
