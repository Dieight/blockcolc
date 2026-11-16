[CmdletBinding()]
param([Parameter(Mandatory)][string]$ApkPath)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')
$resolved=(Resolve-Path -LiteralPath $ApkPath).Path
$aapt=Get-AndroidBuildTool -Name 'aapt.exe'
$aapt2=Get-AndroidBuildTool -Name 'aapt2.exe'
$archive=[IO.Compression.ZipFile]::OpenRead($resolved)
try {
    $retired=@($archive.Entries | Where-Object { $_.FullName -match '^res/drawable[^/]*/splash\.png$|^res/drawable-v24/ic_launcher_foreground\.xml$|^res/drawable/ic_launcher_background\.xml$' })
    if($retired.Count){throw 'A retired launch placeholder remains inside the APK.'}
} finally { $archive.Dispose() }
$resourceLines=@(Invoke-External -FilePath $aapt2 -Arguments @('dump','resources',$resolved) -Capture)
$resources=$resourceLines -join "`n"
$foreground=[regex]::Match($resources,'resource (0x[0-9a-fA-F]+) mipmap/ic_launcher_foreground\b')
if(-not $foreground.Success){throw 'Missing approved launch icon resource ID.'}
$collect=$false;$configs=@()
foreach($line in $resourceLines){
    if($line -match '^\s*resource 0x[0-9a-fA-F]+ (\S+)'){$collect=$Matches[1] -ceq 'drawable/splash';continue}
    if($collect -and $line -match '^\s*\([^)]*\) \(file\) (\S+) type=(\S+)'){$configs+=@{path=$Matches[1];type=$Matches[2]}}
}
# Resource shrinking renames files. Resolve the resource table, not source ZIP paths.
if($configs.Count -ne 1 -or $configs[0].type -cne 'XML'){throw 'Launch resource must be one shared XML, with no legacy orientation/density override.'}
if($resources -match 'resource 0x[0-9a-fA-F]+ drawable/ic_launcher_(foreground|background)\b'){throw 'Unused legacy launcher vectors remain packaged.'}
$splash=(Invoke-External -FilePath $aapt -Arguments @('dump','xmltree',$resolved,$configs[0].path) -Capture) -join "`n"
if($splash -notmatch ('android:src[^\r\n]*=@'+[regex]::Escape($foreground.Groups[1].Value))){throw 'Compiled launch drawable does not reference the approved foreground icon.'}
Write-Host 'Verified compiled native launch icon; all qualified placeholder resources absent.'
