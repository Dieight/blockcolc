param(
    [Parameter(Mandatory=$true)][string]$Serial,
    [Parameter(Mandatory=$true)][string]$OutputDirectory,
    [string]$BaselineDirectory,
    [switch]$Pages,
    [switch]$WorldAssets,
    [switch]$ResourceAssets,
    [switch]$ResourceModels,
    [switch]$ResourceStack,
    [switch]$ResourceAtlas,
    [switch]$ResourceLibrary,
    [switch]$TerrainCache,
    [switch]$SceneryCache,
    [switch]$GeneratedPackets,
    [switch]$GeneratedWorld,
    [switch]$ColorOutput,
    [switch]$Audio,
    [switch]$Weather,
    [ValidateSet('none','contracts','glass','panel-weather','visibility','supplement','specials','layouts','capacity','all')][string]$Features='none',
    [string]$CapacityArchive,
    [ValidateSet('privacy','live','settings-live')][string]$WeatherCase='privacy',
    [ValidateSet('all','media','atmosphere')][string]$AudioCase='all',
    [switch]$SkipCore,
    [switch]$AllowMiuiBackgroundUi,
    [ValidateSet('all','notes','world','world-color','world-debug','world-decay','world-outlines','world-interaction','audio-picker','audio-picker-import','resource-picker-import','blueprint-library','settings-navigation','parity','feedback','feedback-modes','feedback-water','habit104','formal-ui','sliders','collections','loading','study','supplement','first-use','large-fonts','achievements','plan','flows','closing','imports','completion','large-workspace')][string]$PageCase='all',
    [ValidateSet('all','lifecycle','environment','clouds','precipitation','sky','fog','post','post-rollback','entities','animals','atlas','models','terrain-materials','terrain-materials-visible')][string]$GeneratedWorldCase='all'
)
$ErrorActionPreference='Stop'
if($SkipCore -and -not ($Pages -or $WorldAssets -or $ResourceAssets -or $ResourceModels -or $ResourceStack -or $ResourceAtlas -or $ResourceLibrary -or $TerrainCache -or $SceneryCache -or $GeneratedPackets -or $GeneratedWorld -or $ColorOutput -or $Audio -or $Weather -or $Features -ne 'none')){throw 'Select a specific scope when skipping unchanged core tests'}
$capacitySource=$null;$capacitySha=$null
if($Features -eq 'capacity'){
    if(-not $CapacityArchive){throw 'Large-world verification requires the privately supplied client archive'}
    $capacitySource=Get-Item -LiteralPath $CapacityArchive -ErrorAction Stop
    if($capacitySource.PSIsContainer -or $capacitySource.Length -lt 1 -or $capacitySource.Length -gt 64MB){throw 'Invalid capacity archive size'}
    $capacitySha=(Get-FileHash -LiteralPath $capacitySource.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}elseif($CapacityArchive){throw 'CapacityArchive is only used by the explicit capacity scope'}
if($Weather -and $WeatherCase -in @('live','settings-live') -and (-not $SkipCore -or $Pages -or $WorldAssets -or $ResourceAssets -or $ResourceModels -or $ResourceStack -or $ResourceAtlas -or $ResourceLibrary -or $TerrainCache -or $SceneryCache -or $GeneratedPackets -or $GeneratedWorld -or $ColorOutput -or $Audio -or $Features -ne 'none')){throw 'Live weather uses its own bounded scope so temporary permission grants cannot affect unrelated tests'}
$repository=(Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$output=[IO.Path]::GetFullPath($OutputDirectory)
$allowed=Join-Path $repository 'artifacts/experiments/v3.0.0'
$holdFile=Join-Path $allowed 'device-test-hold.json'
if(Test-Path -LiteralPath $holdFile){
    # PowerShell 7.5's ConvertFrom-Json converts ISO strings to DateTime by
    # default. Preserve the exact wire type before validating this guard.
    $document=[System.Text.Json.JsonDocument]::Parse((Get-Content -LiteralPath $holdFile -Raw))
    try{
        $schema=$document.RootElement.GetProperty('schema').GetInt32()
        $holdIso=$document.RootElement.GetProperty('notBeforeUtc').GetString()
        if($schema -ne 1 -or $holdIso -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'){throw 'Invalid local device-test hold; inspect it before any ADB operation'}
        $notBefore=[DateTimeOffset]::Parse($holdIso,[Globalization.CultureInfo]::InvariantCulture)
        if([DateTimeOffset]::UtcNow -lt $notBefore){throw "The user is using the phone. Continue local checks; device tests are held until $holdIso."}
    }finally{$document.Dispose()}
}
if(-not $output.StartsWith($allowed+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Evidence must stay in the native experiment directory'}
if(Test-Path -LiteralPath $output){throw 'Use a new evidence directory; previous device evidence is retained'}
& node (Join-Path $PSScriptRoot 'preview-apk-pair.mjs')
if($LASTEXITCODE -ne 0){throw 'Current APK pair is not verified. Run :app:assembleP3DebugPair with the required local inputs before any device test.'}
$adb=Join-Path $env:LOCALAPPDATA 'Android/Sdk/platform-tools/adb.exe'
$prior=if($BaselineDirectory){[IO.Path]::GetFullPath($BaselineDirectory)}else{Join-Path $allowed 'p2-submit-hotpath-20261024'}
if($BaselineDirectory){
    if(-not $prior.StartsWith($allowed+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'A device baseline must stay in the native experiment directory'}
    $baseline=Get-Content -LiteralPath (Join-Path $prior 'baseline.json') -Raw | ConvertFrom-Json
    if($baseline.schema -ne 1 -or $baseline.serial -ne $Serial){throw 'Baseline belongs to another device'}
}
if($Serial -notmatch '^[A-Za-z0-9_-]{1,80}$'){throw 'This device runner requires a USB or emulator serial'}
$pending=Join-Path $allowed "device-restoration-pending-$Serial.json"
if((Test-Path -LiteralPath $pending) -and (Get-Content -LiteralPath $pending -Raw | ConvertFrom-Json).status -ne 'verified'){throw 'Finish and verify this device restoration before another experiment'}
function Invoke-Adb([string[]]$Arguments){
    $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$adb;$start.UseShellExecute=$false;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true;$start.CreateNoWindow=$true
    foreach($arg in @('-s',$Serial)+$Arguments){$start.ArgumentList.Add($arg)}
    $process=[Diagnostics.Process]::Start($start)
    $stdout=[Text.StringBuilder]::new();$stderr=$process.StandardError.ReadToEndAsync()
    $timeout=if($Arguments -contains 'instrument'){900}else{90};$deadline=[DateTime]::UtcNow.AddSeconds($timeout)
    $quietSeconds=$timeout
    $timeoutAt=[Array]::IndexOf($Arguments,'timeout_msec')
    if($timeoutAt -ge 0){$quietSeconds=([int]$Arguments[$timeoutAt+1])/1000+60}
    elseif($Arguments -contains 'instrument'){$quietSeconds=90}
    $lastOutput=[DateTime]::UtcNow
    $transcript=$null
    if(($Arguments -contains 'instrument') -and (Test-Path -LiteralPath $output)){
        $transcript=[IO.StreamWriter]::new((Join-Path $output ('adb-instrument-'+[Guid]::NewGuid().ToString('N')+'.log')),$false,[Text.UTF8Encoding]::new($false));$transcript.AutoFlush=$true
    }
    try {
        $read=$process.StandardOutput.ReadLineAsync()
        while($null -ne $read){
            if($read.Wait(1000)){
                $line=$read.GetAwaiter().GetResult()
                if($null -eq $line){break}
                [void]$stdout.AppendLine($line);if($null -ne $transcript){$transcript.WriteLine($line)}
                $lastOutput=[DateTime]::UtcNow;$read=$process.StandardOutput.ReadLineAsync()
            }
            if([DateTime]::UtcNow -ge $deadline -or ([DateTime]::UtcNow-$lastOutput).TotalSeconds -ge $quietSeconds){
                if($Arguments -contains 'instrument'){
                    # End only the isolated preview runner so the outer finally
                    # can restore packages/pointers. No global adb/server kill.
                    & $adb -s $Serial shell am force-stop com.blockcolc.preview | Out-Null
                }
                if(-not $process.WaitForExit(5000)){$process.Kill();$process.WaitForExit()}
                $message=$stdout.ToString()+$stderr.GetAwaiter().GetResult()
                if(Test-Path -LiteralPath $output){$message | Out-File -LiteralPath (Join-Path $output 'adb-command-timeout.log') -Encoding utf8}
                throw "Isolated ADB operation timed out (total bound $timeout seconds; no-output bound $quietSeconds seconds)"
            }
        }
        if(-not $process.WaitForExit(5000)){$process.Kill();$process.WaitForExit();throw 'ADB closed its output without exiting'}
        $message=$stdout.ToString()+$stderr.GetAwaiter().GetResult()
        if($process.ExitCode -ne 0){throw $message}
        # PowerShell can bind an untyped array to the single-string overload,
        # leaving an entire ls result as one item. Select string[] explicitly.
        return $message.Split([string[]]@("`r`n","`n"),[StringSplitOptions]::RemoveEmptyEntries)
    }finally{if($null -ne $transcript){$transcript.Dispose()};$process.Dispose()}
}
function Package-Hash([string]$Name){
    $line=@(Invoke-Adb @('shell','pm','path',$Name))[0]
    $path=($line -replace '^package:','').Trim()
    if($path -notmatch '^/data/app/[a-zA-Z0-9_~/+=.\-]+/base\.apk$'){throw 'Unexpected installed APK path'}
    $digest=@(Invoke-Adb @('shell','sha256sum',$path))[0].Split(' ')[0]
    if($digest -notmatch '^[a-f0-9]{64}$'){throw 'Installed APK digest is missing'}
    return $digest
}
function Read-Facts([string]$Label){
    $lines=Invoke-Adb @('shell','am','instrument','-w','-r','-e','class','com.blockcolc.preview.P2BackgroundControlTest#inspectSavedStateWithoutResumingOrCompletingAnything','-e','case',$Label,'com.blockcolc.preview.test/androidx.test.runner.AndroidJUnitRunner')
    if(($lines -join "`n") -notmatch 'OK \(1 test\)'){throw ($lines -join "`n")}
    $raw=Invoke-Adb @('exec-out','run-as','com.blockcolc.preview','cat',"files/p2-inspected-$Label.json")
    return ($raw -join "`n") | ConvertFrom-Json
}
function Facts-Hash($Facts){
    $wire=$Facts | ConvertTo-Json -Depth 100 -Compress
    $hash=[Security.Cryptography.SHA256]::Create()
    try{return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($wire)))).Replace('-','').ToLowerInvariant()}
    finally{$hash.Dispose()}
}
function Read-Pointer {
    $names=@(Invoke-Adb @('shell','run-as','com.blockcolc.preview','ls','shared_prefs')) | ForEach-Object {$_.Trim()}
    if($names -notcontains 'p2-storage.xml'){return [pscustomobject]@{database='p2-state.db';beforeTest=$null;implicit=$true}}
    [xml]$xml=(Invoke-Adb @('exec-out','run-as','com.blockcolc.preview','cat','shared_prefs/p2-storage.xml')) -join "`n"
    $values=@{};foreach($entry in @($xml.map.string)){$values[$entry.GetAttribute('name')]=$entry.InnerText}
    return [pscustomobject]@{database=if($values['database']){$values['database']}else{'p2-state.db'};beforeTest=$values['beforeTest'];implicit=$false}
}
$weatherCacheNames=@('qweather-last-location-v1','qweather-last-location-v1.bak','qweather-last-location-v1.new')
function Read-WeatherIdentity {
    $roots=@(Invoke-Adb @('shell','run-as','com.blockcolc.preview','ls','.')) | ForEach-Object {$_.Trim()}
    $names=if($roots -contains 'no_backup'){@(Invoke-Adb @('shell','run-as','com.blockcolc.preview','ls','no_backup')) | ForEach-Object {$_.Trim()}}else{@()}
    $values=[ordered]@{}
    foreach($name in $weatherCacheNames){
        $values[$name]=if($names -contains $name){
            $digest=@(Invoke-Adb @('shell','run-as','com.blockcolc.preview','sha256sum',"no_backup/$name"))[0].Split(' ')[0]
            if($digest -notmatch '^[a-f0-9]{64}$'){throw 'Weather-cache identity is missing'}
            $digest
        }else{$null}
    }
    return $values
}
$locationPermissionNames=@('android.permission.ACCESS_COARSE_LOCATION','android.permission.ACCESS_FINE_LOCATION')
function Read-LocationPermissions {
    $dump=(Invoke-Adb @('shell','dumpsys','package','com.blockcolc.preview')) -join "`n"
    $values=[ordered]@{}
    foreach($name in $locationPermissionNames){
        $match=[regex]::Match($dump,'(?m)^\s*'+[regex]::Escape($name)+':\s*granted=(true|false),\s*flags=\[([^\]]*)\]')
        $values[$name]=[ordered]@{present=$match.Success;granted=($match.Success -and $match.Groups[1].Value -eq 'true');flags=$(if($match.Success){$match.Groups[2].Value.Trim()}else{$null})}
    }
    return $values
}
function Copy-Screen([string]$Name){
    if($Name -notmatch '^p3-(pages|world)-[a-z0-9-]+\.png$'){throw 'Unexpected test screenshot filename'}
    $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$adb;$start.UseShellExecute=$false;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true;$start.CreateNoWindow=$true
    foreach($arg in @('-s',$Serial,'exec-out','run-as','com.blockcolc.preview','cat',"files/$Name")){$start.ArgumentList.Add($arg)}
    $process=[Diagnostics.Process]::Start($start)
    $stream=[IO.File]::Create((Join-Path $output $Name))
    try{$process.StandardOutput.BaseStream.CopyTo($stream)}finally{$stream.Dispose()}
    $errorOutput=$process.StandardError.ReadToEnd();$process.WaitForExit()
    if($process.ExitCode -ne 0){throw $errorOutput};$process.Dispose()
}
$oldApk=Join-Path $prior 'final-hotpath.apk';$oldTestApk=Join-Path $prior 'final-hotpath-tests.apk'
$beforeApk=Package-Hash 'com.blockcolc.preview';$beforeTestApk=Package-Hash 'com.blockcolc.preview.test'
if($beforeApk -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $oldApk).Hash.ToLowerInvariant() -or
    $beforeTestApk -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $oldTestApk).Hash.ToLowerInvariant()){throw 'Current preview identity differs from the known restore point'}
$label='p3-core-'+[Guid]::NewGuid().ToString('N').Substring(0,12)
$capacityName="p3-capacity-$label.jar";$capacityCopied=$false;$capacityPushed=$false
$before=Read-Facts ($label+'-before')
$beforePointer=Read-Pointer
if($beforePointer.beforeTest){throw 'An unfinished preview test must be restored before another device run'}
if($null -ne $before.recovery.plan -or $null -ne $before.domain.activeFocusSession){throw 'An existing preview plan must not be interrupted'}
$beforeHash=Facts-Hash $before
New-Item -ItemType Directory -Path $output | Out-Null
[ordered]@{schema=1;serial=$Serial;caseLabel=$label;phase='before-install';database=$beforePointer.database;domainAndRecovery=$beforeHash;mainApk=$beforeApk;testApk=$beforeTestApk;baselineDirectory=$prior} |
    ConvertTo-Json -Depth 5 | Out-File -LiteralPath (Join-Path $output 'preflight.json') -Encoding utf8
$before | ConvertTo-Json -Depth 100 | Out-File -LiteralPath (Join-Path $output 'facts-before.json') -Encoding utf8
& (Join-Path $PSScriptRoot 'Save-ExperimentApk.ps1') -Source (Join-Path $repository 'apps/native-android/app/build/outputs/apk/debug/app-debug.apk') -Destination (Join-Path $output 'core.apk')
& (Join-Path $PSScriptRoot 'Save-ExperimentApk.ps1') -Source (Join-Path $repository 'apps/native-android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk') -Destination (Join-Path $output 'core-tests.apk')
$failure=$null;$passed=$false;$restored=$false
$weatherBefore=Read-WeatherIdentity;$weatherBackup="files/p3-weather-keep-$label";$weatherBackupPrepared=$false;$weatherBackupCreated=$false
$permissionsBefore=Read-LocationPermissions;$permissionsDuring=$null
$miuiBefore=$null;$miuiDuring=$null;$miuiAfter=$null;$miuiRestored=$true
if($AllowMiuiBackgroundUi){
    $vendor=(Invoke-Adb @('shell','getprop','ro.miui.ui.version.name')) -join ''
    if(-not $vendor.Trim()){throw 'Scoped MIUI background UI permission requires a MIUI device'}
    $mode=(Invoke-Adb @('shell','cmd','appops','get','com.blockcolc.preview','10021')) -join "`n"
    $match=[regex]::Match($mode,'MIUIOP\(10021\): (allow|ignore|default|foreground)')
    if(-not $match.Success){throw 'Read the original MIUI background UI mode before changing it'}
    $miuiBefore=$match.Groups[1].Value
}
if($Weather -and $WeatherCase -in @('live','settings-live') -and @($locationPermissionNames|Where-Object {$permissionsBefore[$_].present}).Count){throw 'Live permission experiment requires the known restore package with no location permission declaration'}
$previewTraceProcess=$null;$previewTraceStream=$null;$previewTraceCopy=$null;$previewTraceErrors=$null
[ordered]@{schema=1;serial=$Serial;caseLabel=$label;baselineDirectory=$prior;database=$beforePointer;domainAndRecovery=$beforeHash;mainApk=$beforeApk;testApk=$beforeTestApk;weatherBefore=$weatherBefore;weatherBackup=$weatherBackup;permissionsBefore=$permissionsBefore;miuiBackgroundUiBefore=$miuiBefore} |
    ConvertTo-Json -Depth 8 | Out-File -LiteralPath (Join-Path $output 'restoration-context.json') -Encoding utf8
function Write-RestorationGuard([string]$Status,[string]$Reason){
    [ordered]@{schema=1;serial=$Serial;status=$Status;evidence=(Join-Path $output 'restoration-context.json');reason=$Reason} |
        ConvertTo-Json -Depth 5 | Out-File -LiteralPath $pending -Encoding utf8
}
Write-RestorationGuard 'in-progress' 'Isolated test is running; finish restoration verification before another run.'
try{
    Invoke-Adb @('shell','run-as','com.blockcolc.preview','mkdir',$weatherBackup)
    $weatherBackupCreated=$true
    foreach($name in $weatherCacheNames){if($null -ne $weatherBefore[$name]){Invoke-Adb @('shell','run-as','com.blockcolc.preview','cp',"no_backup/$name","$weatherBackup/$name")}}
    $weatherBackupPrepared=$true
    Invoke-Adb @('install','-r',(Join-Path $output 'core.apk'))
    Invoke-Adb @('install','-r',(Join-Path $output 'core-tests.apk'))
    if($null -ne $miuiBefore){
        # Apply this one test-host grant to the actual installed APK, then
        # restore after the
        # original APKs. This does not grant overlays or alter battery policy.
        Invoke-Adb @('shell','cmd','appops','set','com.blockcolc.preview','10021','allow')
        $mode=(Invoke-Adb @('shell','cmd','appops','get','com.blockcolc.preview','10021')) -join "`n"
        if($mode -notmatch 'MIUIOP\(10021\): allow'){throw 'MIUI test-host UI permission was not adopted'}
        $miuiDuring='allow'
    }
    if($null -ne $capacitySource){
        $capacityPushed=$true
        Invoke-Adb @('push',$capacitySource.FullName,"/data/local/tmp/$capacityName")
        $capacityCopied=$true
        Invoke-Adb @('shell','run-as','com.blockcolc.preview','cp',"/data/local/tmp/$capacityName","files/$capacityName")
    }
    $filters=@();$expected=0
    if(-not $SkipCore){$filters+=@('com.blockcolc.preview.P3PreferencesStorageTest','com.blockcolc.preview.P3FocusIntentTest','com.blockcolc.preview.P2DeviceTest#androidJsonNullPlansSurviveTheActualSqliteRoundTrip');$expected=9}
    if($Pages){
        $pageFilter='com.blockcolc.preview.P3NativePagesTest'
        if($PageCase -eq 'resource-picker-import'){$pageFilter+='#resourcePickerImportAndSelectionWaitForTheVisibleWorldAndDeletionRestoresOriginals';$expected+=1}
        elseif($PageCase -eq 'blueprint-library'){$pageFilter+='#blueprintLibraryPreviewsCloseWithoutReopeningAndRewardMysteriesDoNotExposeTheirModel';$expected+=1}
        elseif($PageCase -eq 'parity'){$filters+=@('com.blockcolc.preview.P3NativePagesTest#formalWorkbenchPagesAndMinimalControlsMatchSourceGeometry','com.blockcolc.preview.P3NativePagesTest#disclosuresClipFirstFramesAndEmptyListsDoNotAddHeight','com.blockcolc.preview.P3NativePagesTest#studyUsesResidentWorldAndAutomaticallyPlacesEachEarnedItemOnce','com.blockcolc.preview.P3NativePagesTest#settingsSearchReachesControlsWithoutTreeOrChangingValuesOrFacts');$expected+=4;$pageFilter=$null}
        elseif($PageCase -eq 'formal-ui'){$pageFilter='com.blockcolc.preview.P3NativePagesTest#formalWorkbenchPagesAndMinimalControlsMatchSourceGeometry';$expected+=1}
        elseif($PageCase -eq 'sliders'){$pageFilter='com.blockcolc.preview.P3NativePagesTest#physicalSliderAimAndLandingKeepOneValueUntilTheSaveReceipt';$expected+=1}
        elseif($PageCase -eq 'collections'){$pageFilter='com.blockcolc.preview.P3NativePagesTest#formalCollectionsAndCreationUseTheOriginalPageLayouts';$expected+=1}
        elseif($PageCase -eq 'loading'){$pageFilter='com.blockcolc.preview.P3NativePagesTest#formalLoadingArtworkKeepsItsPhaseAcrossRealLoadingStages';$expected+=1}
        elseif($PageCase -eq 'settings-navigation'){$pageFilter+='#settingsSearchReachesControlsWithoutTreeOrChangingValuesOrFacts';$expected+=1}
        elseif($PageCase -eq 'study'){$pageFilter+='#studyUsesResidentWorldAndAutomaticallyPlacesEachEarnedItemOnce';$expected+=1}
        elseif($PageCase -eq 'first-use'){$pageFilter='com.blockcolc.preview.P3NativePagesTest#firstUseTeachesHiddenControlsThenRequiresOnlyOneOfTheThreeSetupChoices,com.blockcolc.preview.P3NativePagesTest#anExistingWorkspaceCanFinishTheTutorialWithoutBeingForcedToCreateAgain';$expected+=2}
        elseif($PageCase -eq 'large-fonts'){$pageFilter='com.blockcolc.preview.P3NativePagesTest#mixedChineseAtTwoHundredPercentKeepsAllFourPagesAndSettingsJumpUsable,com.blockcolc.preview.P3NativePagesTest#mixedEnglishAtTwoHundredPercentKeepsAllFourPagesAndSettingsJumpUsable';$expected+=2}
        elseif($PageCase -eq 'achievements'){$pageFilter+='#newlyEarnedAchievementWaitsForTheSavedReportAndDoesNotRepeatOnStatistics';$expected+=1}
        elseif($PageCase -eq 'plan'){$pageFilter+='#confirmedTwoRoundPlanStaysPreparedThenStartsWithTheSameDenominator';$expected+=1}
        elseif($PageCase -eq 'flows'){$pageFilter='com.blockcolc.preview.P3NativePagesTest#ordinaryTwoRoundUiRetainsReportsRestAndFinalRound,com.blockcolc.preview.P3NativePagesTest#habitTwoRoundUiRetainsAutomaticAttributionAndFinalRound,com.blockcolc.preview.P3NativePagesTest#minimalTwoRoundUiKeepsItsImmersiveReportAndSeparateAllocations,com.blockcolc.preview.P3NativePagesTest#marathonTwoRoundUiKeepsItsImmersiveReportAndSeparateAllocations';$expected+=4}
        elseif($PageCase -eq 'closing'){$pageFilter='com.blockcolc.preview.P3NativePagesTest#minimalProjectCompletionStaysImmersiveAndNeverOpensOtherTasks,com.blockcolc.preview.P3NativePagesTest#ordinaryProjectCompletionOffersScrollableOtherTasksWithAnInlineStart,com.blockcolc.preview.P3NativePagesTest#firstUseCanRestoreAnActualBackupThroughTheDocumentPickerWithoutCreatingAnything,com.blockcolc.preview.P3NativePagesTest#litematicPickerShowsTheRealPreviewAndSavedSignedAxesReopenCorrectly,com.blockcolc.preview.P3NativePagesTest#minimalHourlyPanelUsesOccupiedTimeAndItsPagerReturnsBothWays';$expected+=5}
        elseif($PageCase -eq 'imports'){$pageFilter='com.blockcolc.preview.P3NativePagesTest#firstUseCanRestoreAnActualBackupThroughTheDocumentPickerWithoutCreatingAnything,com.blockcolc.preview.P3NativePagesTest#litematicPickerShowsTheRealPreviewAndSavedSignedAxesReopenCorrectly';$expected+=2}
        elseif($PageCase -eq 'completion'){$pageFilter='com.blockcolc.preview.P3NativePagesTest#minimalProjectCompletionStaysImmersiveAndNeverOpensOtherTasks,com.blockcolc.preview.P3NativePagesTest#ordinaryProjectCompletionOffersScrollableOtherTasksWithAnInlineStart';$expected+=2}
        elseif($PageCase -eq 'large-workspace'){$pageFilter+='#twentyFiveSourceBuildingsUseTheActualWorkspaceAndKeepTheLastWorldDuringEnvironmentReplacement';$expected+=1}
        elseif($PageCase -eq 'supplement'){$pageFilter='com.blockcolc.preview.P3NativePagesTest#settingsSearchReachesControlsWithoutTreeOrChangingValuesOrFacts,com.blockcolc.preview.P3NativePagesTest#studyUsesTheSameResidentWorldAndEarnedFurnitureCanBeMovedWithoutRebuildingIt';$expected+=2}
        elseif($PageCase -eq 'audio-picker-import'){$pageFilter+='#realAudioPickerImportPlaysTheOwnedFileAndDeletionWaitsForSavedPreferences';$expected+=1}
        elseif($PageCase -eq 'audio-picker'){$pageFilter+='#cancellingTheRealAudioDocumentPickerKeepsTheLibrarySelectionAndSavedFacts';$expected+=1}
        elseif($PageCase -eq 'world-debug'){$pageFilter+='#debugWeatherAndClockRestoreNormalFactsWithoutReplacingStaticWorldOwners';$expected+=1}
        elseif($PageCase -eq 'world-decay'){$pageFilter+='#debugConditionRestoresBuildingPacketsWithoutChangingTheBusinessDocumentOrTerrain';$expected+=1}
        elseif($PageCase -eq 'world-outlines'){$pageFilter+='#outlinePreferencesWaitForTheWorldAndReplaceOnlyAffectedBuildingOwners';$expected+=1}
        elseif($PageCase -eq 'world-interaction'){$pageFilter+='#worldHitMemoryArchivesRewardsAndBothResetsShareTheResidentCamera';$expected+=1}
        elseif($PageCase -eq 'feedback-modes'){$pageFilter+='#endTimePlanHidesTaskPickerAndMinimalPreferenceOnlyAddsAnEntrance';$expected+=1}
        elseif($PageCase -eq 'habit104'){$pageFilter='com.blockcolc.preview.P3NativePagesTest#currentHabitHasOneProgressAndSelectingItNeverAddsASubtaskMarker,com.blockcolc.preview.P3NativePagesTest#completedHabitShowsTheFinishedCycleAndWaitsForTheNextBlueprint';$expected+=2}
        elseif($PageCase -eq 'feedback-water'){$pageFilter+='#waterAcrossAllFourSettlementsSurvivesRotationWithoutOverlappingTiles';$expected+=1}
        elseif($PageCase -eq 'feedback'){$pageFilter='com.blockcolc.preview.P3NativePagesTest#correctedSettingsRowsFitWeekdaysAndKeepInlineActionsAndAudioExitStable,com.blockcolc.preview.P3NativePagesTest#endTimePlanHidesTaskPickerAndMinimalPreferenceOnlyAddsAnEntrance,com.blockcolc.preview.P3NativePagesTest#waterAcrossAllFourSettlementsSurvivesRotationWithoutOverlappingTiles';$expected+=3}
        elseif($PageCase -eq 'notes'){$pageFilter+='#middleChineseInsertionCompletionAndFailedRenameKeepTheActualDraft';$expected+=1}
        elseif($PageCase -eq 'world'){$pageFilter+='#generatedWorldBecomesReadyAndSurvivesNavigationAndThemeWithoutGpuRebuild';$expected+=1}
        elseif($PageCase -eq 'world-color'){$pageFilter+='#worldColourPreferenceUpdatesTheStableHostWithoutWorldPreparation';$expected+=1}
        else{$pageMethods=Get-Content -LiteralPath (Join-Path $repository 'apps/native-android/app/src/androidTest/kotlin/com/blockcolc/preview/P3NativePagesTest.kt') -Raw;$expected+=[regex]::Matches($pageMethods,'(?s)@Test\b(?:(?!\bfun\b).)*\bfun\s+[A-Za-z_][A-Za-z0-9_]*\s*\(').Count}
        if($pageFilter){$filters+=$pageFilter}
    }
    if($WorldAssets){$filters+='com.blockcolc.preview.P3WorldInputsTest';$expected+=3}
    if($ResourceAssets){$filters+='com.blockcolc.preview.P3NativeResourcesTest';$expected+=2}
    if($ResourceModels){$filters+='com.blockcolc.preview.P3NativeResourceModelsTest';$expected+=1}
    if($ResourceStack){$filters+='com.blockcolc.preview.P3NativeResourceStackTest';$expected+=1}
    if($ResourceAtlas){$filters+='com.blockcolc.preview.P3NativeResourceAtlasTest';$expected+=1}
    if($ResourceLibrary){$filters+='com.blockcolc.preview.P3NativeResourceLibraryTest';$expected+=3}
    if($Features -in @('contracts','all')){
        $filters+=@('com.blockcolc.preview.P3SystemBoundariesTest','com.blockcolc.preview.P3NotificationContractTest','com.blockcolc.preview.P3NativeRewardsTest','com.blockcolc.preview.P3IsolationOutboxTest');$expected+=18
    }
    if($Features -in @('glass','all')){$filters+='com.blockcolc.preview.P3NativeGlassCaptureTest';$expected+=1}
    if($Features -in @('panel-weather','all')){$filters+='com.blockcolc.preview.P3PanelWeatherUiTest';$expected+=1}
    if($Features -in @('visibility','all')){$filters+='com.blockcolc.preview.P3PageVisibilityTest';$expected+=2}
    if($Features -in @('supplement','all')){$filters+='com.blockcolc.preview.P3SupplementUiTest';$expected+=4}
    if($Features -in @('layouts','all')){$filters+='com.blockcolc.preview.P3ComponentLayoutTest';$expected+=5}
    if($Features -in @('specials','all')){$filters+=@('com.blockcolc.preview.P3ExternalSpecialsTest','com.blockcolc.preview.P3ExternalSpecialsGpuTest');$expected+=2}
    if($Features -eq 'capacity'){$filters+=@('com.blockcolc.preview.P3NativePacketBuffersTest','com.blockcolc.preview.P3NativeResourceTerrainTest#twentyFiveSourceBuildingsRenderAcrossEnvironmentsAndTheRealClientPack');$expected+=4}
    if($TerrainCache){$filters+='com.blockcolc.preview.P3TerrainCacheTest';$expected+=2}
    if($SceneryCache){$filters+='com.blockcolc.preview.P3SceneryCacheTest';$expected+=3}
    if($GeneratedPackets){$filters+='com.blockcolc.preview.P3GeneratedPacketsTest';$expected+=4}
    if($ColorOutput){$filters+='com.blockcolc.preview.P3ColorOutputTest';$expected+=3}
    if($Weather){
        if($WeatherCase -eq 'live'){$filters+='com.blockcolc.preview.P3NativeWeatherLiveTest';$expected+=1}
        elseif($WeatherCase -eq 'settings-live'){$filters+='com.blockcolc.preview.P3NativeWeatherSettingsLiveTest';$expected+=1}
        else{$filters+='com.blockcolc.preview.P3NativeWeatherPrivacyTest';$filters+='com.blockcolc.preview.P3NativeWeatherUiTest';$expected+=2}
    }
    if($Audio){
        $audioFilter='com.blockcolc.preview.P3NativeAudioTest'
        if($AudioCase -eq 'media'){$audioFilter+='#builtinsDecodeFullyAndOwnMediaActionsPauseResumeAndStopThePlayer';$expected+=1}
        elseif($AudioCase -eq 'atmosphere'){$audioFilter+='#sharedWeatherOwnerSurvivesTheLastUiLeaseOnlyWhileMediaIsAlive';$expected+=1}
        else{$expected+=5}
        $filters+=$audioFilter
    }
    if($GeneratedWorld){
        $worldFilter='com.blockcolc.preview.P3GeneratedWorldTest'
        if($GeneratedWorldCase -eq 'entities'){$worldFilter='com.blockcolc.preview.P3StaticBlockEntitiesTest';$expected+=1}
        elseif($GeneratedWorldCase -eq 'animals'){$worldFilter='com.blockcolc.preview.P3NativeAnimalsTest';$expected+=2}
        elseif($GeneratedWorldCase -eq 'atlas'){$worldFilter='com.blockcolc.preview.P3NativeAtlasGpuTest';$expected+=3}
        elseif($GeneratedWorldCase -eq 'models'){$worldFilter='com.blockcolc.preview.P3NativeResourceGeometryTest';$expected+=2}
        elseif($GeneratedWorldCase -eq 'terrain-materials'){$worldFilter='com.blockcolc.preview.P3NativeResourceTerrainTest#androidCropsAndSamplingMatchAllSourceTerrainCases,com.blockcolc.preview.P3NativeResourceTerrainTest#fourGeneratedWorldsAdoptCroppedTilesAndRestoreTheirOriginalSurfaces';$expected+=2}
        elseif($GeneratedWorldCase -eq 'terrain-materials-visible'){$worldFilter='com.blockcolc.preview.P3NativeResourceTerrainTest#fourGeneratedWorldsAdoptCroppedTilesAndRestoreTheirOriginalSurfaces';$expected+=1}
        elseif($GeneratedWorldCase -eq 'lifecycle'){$worldFilter+='#stoppingAndResumingKeepsResourcesAndRetiresTheOldSurfaceBeforeItsCallbackReturns';$expected+=1}
        elseif($GeneratedWorldCase -eq 'environment'){$worldFilter+='#independentEnvironmentUpdatesKeepGpuOwnersAndRejectStaleSamples';$expected+=1}
        elseif($GeneratedWorldCase -eq 'clouds'){$worldFilter+='#nativeCloudMotionAndWeatherReplacementPreserveStaticOwnersAndRecognizeAnotherWorkersIdenticalSource';$expected+=1}
        elseif($GeneratedWorldCase -eq 'precipitation'){$worldFilter+='#nativePrecipitationContinuesDuringOrbitZoomAndPauseWithoutSeedUploads';$expected+=1}
        elseif($GeneratedWorldCase -eq 'sky'){$worldFilter+='#skyAndCelestialUniformsChangeWithTimeAndWeatherWithoutRebuildingAnyOwner';$expected+=1}
        elseif($GeneratedWorldCase -eq 'fog'){$worldFilter+='#cameraFogTracksZoomAndKeepsTheLatestWeatherWithoutRepackingOwners';$expected+=1}
        elseif($GeneratedWorldCase -eq 'post'){$worldFilter+='#qualityAndWorldColourChangeOnTheSameWorldWithoutReplacingOwners';$expected+=1}
        elseif($GeneratedWorldCase -eq 'post-rollback'){$worldFilter+='#rejectedWorldEnvironmentRollsBackTheAlreadyPublishedPostTargets';$expected+=1}
        else{$expected+=20;$filters+='com.blockcolc.preview.P3StaticBlockEntitiesTest';$filters+='com.blockcolc.preview.P3NativeAnimalsTest';$filters+='com.blockcolc.preview.P3NativeAtlasGpuTest';$filters+='com.blockcolc.preview.P3NativeResourceGeometryTest';$filters+='com.blockcolc.preview.P3NativeResourceTerrainTest#androidCropsAndSamplingMatchAllSourceTerrainCases';$filters+='com.blockcolc.preview.P3NativeResourceTerrainTest#fourGeneratedWorldsAdoptCroppedTilesAndRestoreTheirOriginalSurfaces'}
        $filters+=$worldFilter
    }
    $filter=$filters -join ','
    # The host case deliberately waits for its real 60-second refresh interval.
    $testTimeout=if($Features -eq 'capacity' -or ($Pages -and $PageCase -in @('large-workspace','feedback-water','feedback'))){'600000'}elseif($GeneratedWorld -and $GeneratedWorldCase -in @('all','terrain-materials','terrain-materials-visible')){'300000'}elseif(($Pages -and $PageCase -ne 'notes') -or ($Weather -and $WeatherCase -eq 'settings-live')){'180000'}else{'120000'}
    # Stream only this preview UID while the runner waits. A native crash can
    # rotate out of logcat during restoration; do not clear any device logs.
    $uidLines=Invoke-Adb @('shell','cmd','package','list','packages','-U','com.blockcolc.preview')
    $uidMatch=[regex]::Match(($uidLines -join "`n"),'(?m)^package:com\.blockcolc\.preview uid:(\d+)')
    if(-not $uidMatch.Success){throw 'Cannot scope preview runtime diagnostics to its UID'}
    $traceStart=[Diagnostics.ProcessStartInfo]::new();$traceStart.FileName=$adb;$traceStart.UseShellExecute=$false;$traceStart.RedirectStandardOutput=$true;$traceStart.RedirectStandardError=$true;$traceStart.CreateNoWindow=$true
    foreach($arg in @('-s',$Serial,'logcat','-v','threadtime','-b','main','-b','crash',('--uid='+$uidMatch.Groups[1].Value),'-T','1')){$traceStart.ArgumentList.Add($arg)}
    $previewTraceStream=[IO.File]::Create((Join-Path $output 'preview-runtime.log'))
    $previewTraceProcess=[Diagnostics.Process]::Start($traceStart)
    $previewTraceCopy=$previewTraceProcess.StandardOutput.BaseStream.CopyToAsync($previewTraceStream)
    $previewTraceErrors=$previewTraceProcess.StandardError.ReadToEndAsync()
    $instrumentArgs=@('shell','am','instrument','-w','-r','-e','class',$filter,'-e','timeout_msec',$testTimeout,'-e','p3Group',$label)
    if($null -ne $capacitySource){$instrumentArgs+=@('-e','p3CapacityArchive',$capacityName,'-e','p3CapacityArchiveSha',$capacitySha)}
    $instrumentArgs+='com.blockcolc.preview.test/androidx.test.runner.AndroidJUnitRunner'
    $lines=Invoke-Adb $instrumentArgs
    $lines | Out-File -LiteralPath (Join-Path $output 'instrumentation.log') -Encoding utf8
    $passed=($lines -join "`n") -match ("OK \("+$expected+" tests?\)")
    if(-not $passed){throw "P3 native instrumentation did not complete all $expected tests"}
}catch{$failure=$_}
finally{
    try{
        if($null -ne $previewTraceProcess){
            if(-not $previewTraceProcess.HasExited){$previewTraceProcess.Kill()};$previewTraceProcess.WaitForExit()
            if($null -ne $previewTraceCopy){$previewTraceCopy.GetAwaiter().GetResult()}
            if($null -ne $previewTraceErrors){$traceError=$previewTraceErrors.GetAwaiter().GetResult();if($traceError){$traceError|Out-File -LiteralPath (Join-Path $output 'preview-runtime-collector.log') -Encoding utf8}}
        }
    }catch{$_|Out-File -LiteralPath (Join-Path $output 'preview-runtime-collector-error.log') -Encoding utf8}
    finally{if($null -ne $previewTraceStream){$previewTraceStream.Dispose()};if($null -ne $previewTraceProcess){$previewTraceProcess.Dispose()}}
    # The live test uses the normal one-time permission dialog. The known
    # restore APK declares no location permissions; restoring it revokes the
    # temporary grants without a privileged shell grant/revoke operation.
    try{
    $permissionsDuring=Read-LocationPermissions
    if($capacityCopied){Invoke-Adb @('shell','run-as','com.blockcolc.preview','rm','-f',"files/$capacityName")}
    if($capacityPushed){Invoke-Adb @('shell','rm','-f',"/data/local/tmp/$capacityName")}
    Invoke-Adb @('install','-r',$oldApk)
    Invoke-Adb @('install','-r',$oldTestApk)
    if($null -ne $miuiBefore){
        Invoke-Adb @('shell','cmd','appops','set','com.blockcolc.preview','10021',$miuiBefore)
        $mode=(Invoke-Adb @('shell','cmd','appops','get','com.blockcolc.preview','10021')) -join "`n"
        $match=[regex]::Match($mode,'MIUIOP\(10021\): (allow|ignore|default|foreground)')
        $miuiAfter=if($match.Success){$match.Groups[1].Value}else{$null}
        $miuiRestored=$miuiAfter -eq $miuiBefore
    }
    $pendingPointer=Read-Pointer
    if($pendingPointer.beforeTest){
        if($pendingPointer.beforeTest -ne $beforePointer.database){throw 'Unexpected preview recovery pointer; do not overwrite it'}
        $recovery=Invoke-Adb @('shell','am','instrument','-w','-r','-e','class','com.blockcolc.preview.P2BackgroundControlTest#restoreOriginalPreviewDatabase','com.blockcolc.preview.test/androidx.test.runner.AndroidJUnitRunner')
        $recovery | Out-File -LiteralPath (Join-Path $output 'restore-after-test-failure.log') -Encoding utf8
        if(($recovery -join "`n") -notmatch 'OK \(1 test\)'){throw 'Preview test data pointer could not be restored'}
    }
    $after=Read-Facts ($label+'-after');$afterHash=Facts-Hash $after
    $screens=@(Invoke-Adb @('shell','run-as','com.blockcolc.preview','ls','files')) | ForEach-Object{$_.Trim()} | Where-Object{$_ -match ("^p3-(pages|world)-"+[regex]::Escape($label)+"-[a-z0-9-]+\.png$")}
    foreach($name in $screens){Copy-Screen $name.Trim()}
    if($GeneratedPackets -or $GeneratedWorld -or $ColorOutput -or $Audio -or $Weather -or $ResourceAssets -or $ResourceModels -or $ResourceStack -or $ResourceAtlas -or $ResourceLibrary -or $Features -in @('layouts','specials','capacity','all') -or ($Pages -and $PageCase -notin @('notes','blueprint-library','first-use','large-fonts','achievements'))){
        $worldFiles=@(Invoke-Adb @('shell','run-as','com.blockcolc.preview','ls','files')) | ForEach-Object{$_.Trim()}
        # Capture branch output as an array even for a single required file;
        # string + array would concatenate filenames and silently skip both.
        $requiredWorldFiles=@()
        if($Features -in @('layouts','all')){foreach($width in @(320,360,420,600,840)){$requiredWorldFiles+="p3-world-component-layout-$width.json"}}
        if($Features -in @('specials','all')){$requiredWorldFiles+='p3-world-resource-specials-visible.json'}
        if($Features -eq 'capacity'){$requiredWorldFiles+='p3-world-large-capacity.json'}
        if($ResourceAssets){$requiredWorldFiles+='p3-world-resource-archives.json';$requiredWorldFiles+='p3-world-resource-textures.json'}
        if($ResourceModels){$requiredWorldFiles+='p3-world-resource-models.json'}
        if($ResourceStack){$requiredWorldFiles+='p3-world-resource-stack.json'}
        if($ResourceAtlas){$requiredWorldFiles+='p3-world-resource-atlas.json'}
        if($ResourceLibrary){$requiredWorldFiles+='p3-world-resource-library-roundtrip.json';$requiredWorldFiles+='p3-world-resource-library-failure.json';$requiredWorldFiles+='p3-world-resource-library-controller.json'}
        if($GeneratedPackets){$requiredWorldFiles+='p3-world-color-targets.json'}
        if($ColorOutput){$requiredWorldFiles+='p3-world-output.json';$requiredWorldFiles+='p3-world-output-lit.json';$requiredWorldFiles+='p3-world-output-zero-sun.json'}
        if($Weather){if($WeatherCase -eq 'live'){$requiredWorldFiles+='p3-world-weather-live.json'}elseif($WeatherCase -eq 'settings-live'){$requiredWorldFiles+='p3-world-weather-settings-live.json'}else{$requiredWorldFiles+='p3-world-weather-privacy.json';$requiredWorldFiles+='p3-world-weather-ui.json'}}
        if($Audio){
            $requiredWorldFiles+='p3-world-audio-restored.json'
            if($AudioCase -ne 'atmosphere'){$requiredWorldFiles+='p3-world-audio-media.json'}
            if($AudioCase -ne 'media'){$requiredWorldFiles+='p3-world-audio-atmosphere.json'}
            if($AudioCase -eq 'all'){$requiredWorldFiles+='p3-world-audio-import.json';$requiredWorldFiles+='p3-world-audio-rain.json';$requiredWorldFiles+='p3-world-audio-gap.json'}
        }
        if($GeneratedWorld){
            $scopeFiles=@{lifecycle='p3-world-surface-lifecycle.json';environment='p3-world-environment.json';clouds='p3-world-clouds.json';precipitation='p3-world-precipitation.json';sky='p3-world-sky.json';fog='p3-world-fog.json';post='p3-world-post.json';'post-rollback'='p3-world-post-rollback.json';entities='p3-world-static-entities.json';animals='p3-world-animals.json';atlas='p3-world-atlas-gpu-visible.json';models='p3-world-resource-geometry-visible.json';'terrain-materials'='p3-world-resource-terrain-visible.json'}
            if($GeneratedWorldCase -eq 'terrain-materials-visible'){$scopeFiles[$GeneratedWorldCase]='p3-world-resource-terrain-visible.json'}
            if($GeneratedWorldCase -eq 'all'){$requiredWorldFiles+=@($scopeFiles.Values)+@('p3-world-scenes.json','p3-world-local-update.json')}
            else{$requiredWorldFiles+=$scopeFiles[$GeneratedWorldCase]}
            if($GeneratedWorldCase -in @('all','animals')){$requiredWorldFiles+='p3-world-animals-rollback.json'}
            if($GeneratedWorldCase -in @('all','atlas')){$requiredWorldFiles+='p3-world-atlas-gpu-rollback.json';$requiredWorldFiles+='p3-world-atlas-gpu-bitmaps.json'}
            if($GeneratedWorldCase -in @('all','models')){$requiredWorldFiles+='p3-world-resource-geometry.json'}
            if($GeneratedWorldCase -in @('all','terrain-materials')){$requiredWorldFiles+='p3-world-resource-terrain-cpu.json'}
        }
        if($Pages -and $PageCase -eq 'resource-picker-import'){$requiredWorldFiles+='p3-world-resource-picker-import.json'}
        elseif($Pages -and $PageCase -in @('study','supplement','parity')){$requiredWorldFiles+='p3-world-study.json'}
        elseif($Pages -and $PageCase -eq 'audio-picker-import'){$requiredWorldFiles+='p3-world-audio-picker-import.json'}
        elseif($Pages -and $PageCase -eq 'audio-picker'){$requiredWorldFiles+='p3-world-audio-picker.json'}
        elseif($Pages -and $PageCase -eq 'world-debug'){$requiredWorldFiles+='p3-world-host-debug.json'}
        elseif($Pages -and $PageCase -eq 'world-decay'){$requiredWorldFiles+='p3-world-host-decay-debug.json'}
        elseif($Pages -and $PageCase -eq 'world-outlines'){$requiredWorldFiles+='p3-world-host-outlines.json'}
        elseif($Pages -and $PageCase -eq 'world-interaction'){$requiredWorldFiles+='p3-world-host-interaction.json'}
        elseif($Pages -and $PageCase -eq 'flows'){$requiredWorldFiles+=@('p3-world-flow-rounds-task.json','p3-world-flow-rounds-habit.json','p3-world-flow-minimal-task.json','p3-world-flow-marathon-task.json')}
        elseif($Pages -and $PageCase -eq 'large-workspace'){$requiredWorldFiles+='p3-world-large-workspace.json'}
        elseif($Pages -and $PageCase -eq 'feedback-water'){$requiredWorldFiles+='p3-world-water-surfaces.json'}
        elseif($Pages -and $PageCase -eq 'feedback-modes'){$requiredWorldFiles+='p3-world-mode-transition.json'}
        elseif($Pages -and $PageCase -eq 'habit104'){$requiredWorldFiles+=@('p3-world-habit104-current.json','p3-world-habit104-awaiting.json')}
        elseif($Pages -and $PageCase -in @('feedback','feedback-water','plan','first-use','large-fonts','achievements','closing','imports','completion','formal-ui','sliders','collections','loading')){}
        elseif($Pages -and $PageCase -eq 'world-color'){$requiredWorldFiles+='p3-world-host-color.json'}elseif($Pages -and $PageCase -notin @('notes','blueprint-library','settings-navigation')){$requiredWorldFiles+='p3-world-host-environment.json';if($PageCase -eq 'all'){$requiredWorldFiles+='p3-world-host-color.json';$requiredWorldFiles+='p3-world-host-debug.json';$requiredWorldFiles+='p3-world-host-decay-debug.json';$requiredWorldFiles+='p3-world-host-outlines.json';$requiredWorldFiles+='p3-world-host-interaction.json';$requiredWorldFiles+='p3-world-audio-picker.json';$requiredWorldFiles+='p3-world-audio-picker-import.json'}}
        if($Pages -and $PageCase -eq 'all'){$requiredWorldFiles+='p3-world-resource-picker-import.json';$requiredWorldFiles+='p3-world-study.json';$requiredWorldFiles+='p3-world-large-workspace.json'}
        if($Pages -and $PageCase -eq 'all'){$requiredWorldFiles+=@('p3-world-flow-rounds-task.json','p3-world-flow-rounds-habit.json','p3-world-flow-minimal-task.json','p3-world-flow-marathon-task.json')}
        foreach($name in $requiredWorldFiles+@('p3-world-surface-failure.json','p3-world-audio-atmosphere-failure.json','p3-world-resource-terrain-failure.json','p3-world-large-capacity-stage.json','p3-world-large-workspace-failure.json','p3-world-ui-wait.json')){
            if($worldFiles -contains $name){
                try{
                    $text=Invoke-Adb @('exec-out','run-as','com.blockcolc.preview','cat',"files/$name")
                    $body=($text -join "`n") | ConvertFrom-Json
                    if($body.caseLabel -eq $label){$text -join "`n" | Out-File -LiteralPath (Join-Path $output $name) -Encoding utf8}
                    elseif($passed -and $name -in $requiredWorldFiles){throw "Generated-world evidence belongs to a different run: $name"}
                }
                catch{if($null -eq $failure){$failure=$_}}
            }elseif($passed -and $name -in $requiredWorldFiles -and $null -eq $failure){$failure=[System.Management.Automation.ErrorRecord]::new([InvalidOperationException]::new("Missing generated-world evidence: $name"),'MissingWorldEvidence',[System.Management.Automation.ErrorCategory]::InvalidResult,$name)}
        }
        if($passed){foreach($name in $requiredWorldFiles){if(-not (Test-Path -LiteralPath (Join-Path $output $name)) -and $null -eq $failure){$failure=[System.Management.Automation.ErrorRecord]::new([InvalidOperationException]::new("Generated-world evidence was not collected: $name"),'MissingWorldEvidence',[System.Management.Automation.ErrorCategory]::InvalidResult,$name)}}}
    }
    $afterPointer=Read-Pointer
    Invoke-Adb @('shell','am','force-stop','com.blockcolc.preview')
    # New weather settings may clear a cache under the temporary preferences.
    # Restore raw bytes only after the tested process is stopped. No coordinates
    # leave the preview's private storage or enter logs; compare bounded names
    # and SHA-256 identities. Keep the backup if restoration cannot be proven.
    if($weatherBackupPrepared){foreach($name in $weatherCacheNames){
        if($null -eq $weatherBefore[$name]){Invoke-Adb @('shell','run-as','com.blockcolc.preview','rm','-f',"no_backup/$name")}
        else{Invoke-Adb @('shell','run-as','com.blockcolc.preview','mkdir','-p','no_backup');Invoke-Adb @('shell','run-as','com.blockcolc.preview','cp',"$weatherBackup/$name","no_backup/$name")}
    }}
    $weatherAfter=Read-WeatherIdentity
    $weatherRestored=@($weatherCacheNames | Where-Object {$weatherBefore[$_] -ne $weatherAfter[$_]}).Count -eq 0
    $permissionsAfter=Read-LocationPermissions
    $permissionsRestored=($permissionsBefore|ConvertTo-Json -Depth 5 -Compress) -eq ($permissionsAfter|ConvertTo-Json -Depth 5 -Compress)
    $runtimePermissionsChanged=@($locationPermissionNames|Where-Object {
        $permissionsBefore[$_].granted -ne $permissionsDuring[$_].granted -or
        ([string]$permissionsBefore[$_].flags) -ne ([string]$permissionsDuring[$_].flags)
    }).Count -gt 0
    if($weatherRestored -and $weatherBackupCreated){
        foreach($name in $weatherCacheNames){Invoke-Adb @('shell','run-as','com.blockcolc.preview','rm','-f',"$weatherBackup/$name")}
        Invoke-Adb @('shell','run-as','com.blockcolc.preview','rmdir',$weatherBackup)
    }
    $restoredApk=Package-Hash 'com.blockcolc.preview';$restoredTestApk=Package-Hash 'com.blockcolc.preview.test'
    $restored=$beforeApk -eq $restoredApk -and $beforeTestApk -eq $restoredTestApk -and $beforeHash -eq $afterHash -and $afterPointer.database -eq $beforePointer.database -and -not $afterPointer.beforeTest -and $weatherRestored -and $permissionsRestored -and $miuiRestored
    [ordered]@{schema=1;caseLabel=$label;onlyPreview=$true;testsPassed=$passed;tests=$expected;coreIncluded=(-not $SkipCore);pagesIncluded=$Pages.IsPresent;worldAssetsIncluded=$WorldAssets.IsPresent;resourceAssetsIncluded=$ResourceAssets.IsPresent;resourceModelsIncluded=$ResourceModels.IsPresent;resourceStackIncluded=$ResourceStack.IsPresent;resourceAtlasIncluded=$ResourceAtlas.IsPresent;terrainCacheIncluded=$TerrainCache.IsPresent;sceneryCacheIncluded=$SceneryCache.IsPresent;generatedPacketsIncluded=$GeneratedPackets.IsPresent;generatedWorldIncluded=$GeneratedWorld.IsPresent;colorOutputIncluded=$ColorOutput.IsPresent;audioIncluded=$Audio.IsPresent;weatherIncluded=$Weather.IsPresent;weatherCase=$WeatherCase;audioCase=$AudioCase;pageCase=$PageCase;generatedWorldCase=$GeneratedWorldCase;domainAndRecoveryBefore=$beforeHash;domainAndRecoveryAfter=$afterHash;databaseBefore=$beforePointer.database;databaseAfter=$afterPointer.database;screenshots=@($screens);
        resourceLibraryIncluded=$ResourceLibrary.IsPresent;
        miuiBackgroundUiBefore=$miuiBefore;miuiBackgroundUiDuring=$miuiDuring;miuiBackgroundUiAfter=$miuiAfter;miuiBackgroundUiRestored=$miuiRestored;
        featureCase=$Features;
        capacityArchiveSha256=$capacitySha;
        testedApk=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $output 'core.apk')).Hash.ToLowerInvariant();
        testedTestApk=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $output 'core-tests.apk')).Hash.ToLowerInvariant();
        restoredApk=$restoredApk;restoredTestApk=$restoredTestApk;originalDataAndApksRestored=$restored;weatherCacheBefore=$weatherBefore;weatherCacheAfter=$weatherAfter;weatherCacheRestored=$weatherRestored;permissionsBefore=$permissionsBefore;permissionsDuring=$permissionsDuring;permissionsAfter=$permissionsAfter;permissionsChanged=$runtimePermissionsChanged;permissionsRestored=$permissionsRestored;formalAppTouched=$false} |
        ConvertTo-Json -Depth 8 | Out-File -LiteralPath (Join-Path $output 'report.json') -Encoding utf8
    Write-RestorationGuard $(if($restored){'verified'}else{'pending-verification'}) $(if($restored){'Original data, APKs, pointer, weather cache and permissions verified.'}else{'Restoration report does not match its preflight; inspect evidence before another run.'})
    }catch{
        Write-RestorationGuard 'pending-verification' 'Restoration could not complete; retain original files and verify this device before another run.'
        $_ | Out-File -LiteralPath (Join-Path $output 'restoration-incomplete.log') -Encoding utf8
        throw
    }
}
if(-not $restored){throw 'Preview restoration failed; inspect device evidence before continuing'}
if($null -ne $failure){throw $failure}
Get-Content -LiteralPath (Join-Path $output 'report.json')
