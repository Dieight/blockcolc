[CmdletBinding()]
param([Parameter(Mandatory)][string]$ApkPath)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')
$aapt=Get-AndroidBuildTool -Name 'aapt.exe'
$tree=(Invoke-External -FilePath $aapt -Arguments @('dump','xmltree',$ApkPath,'AndroidManifest.xml') -Capture) -join "`n"
$service=@(($tree -split '(?m)^\s*E: ') | Where-Object {$_ -match '^service\b' -and $_ -match '"com\.blockcolc\.app\.AmbientAudioService"'})
if($service.Count -ne 1 -or $service[0] -notmatch 'android:foregroundServiceType[^\r\n]*0x2\b' -or $service[0] -notmatch 'android:exported[^\r\n]*0x0\b') {throw 'Packaged ambient service must be non-exported and mediaPlayback (0x2).'}
foreach($permission in @('FOREGROUND_SERVICE','FOREGROUND_SERVICE_MEDIA_PLAYBACK','WAKE_LOCK')) {
    if($tree -notmatch ('"android\.permission\.'+[regex]::Escape($permission)+'"')){throw "Missing ambient permission: $permission"}
}
$archive=[IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ApkPath).Path)
try {
    foreach($name in @('morning-birdsong','rain')){if(-not $archive.GetEntry("assets/public/audio/$name.wav")){throw "Missing ambience: $name"}}
    foreach($name in @('island','valley','ocean','coast','evening-lakeside')){if($archive.GetEntry("assets/public/audio/$name.wav")){throw "Obsolete ambience still packaged: $name"}}
}finally{$archive.Dispose()}
Write-Host 'Verified packaged mediaPlayback service, permissions and two field recordings; obsolete beds absent.'
