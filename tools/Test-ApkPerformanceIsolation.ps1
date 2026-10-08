[CmdletBinding()]
param([Parameter(Mandatory)][string]$ApkPath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')
$metadata = Get-ApkMetadata -Path $ApkPath
if ($metadata.PerformanceDiagnostics) { throw 'Final APK has performance diagnostics enabled.' }
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ApkPath).Path)
try {
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName -notmatch '^classes\d*\.dex$|^assets/public/.*\.(js|html)$') { continue }
        $reader = [IO.StreamReader]::new($entry.Open(), [Text.Encoding]::UTF8)
        try {
            $content = $reader.ReadToEnd()
            foreach ($marker in @('__blockcolcPerformanceProbe', 'BlockcolcPerformance', 'Lcom/blockcolc/app/PerformanceProbePolicy;')) {
                if ($content.Contains($marker)) { throw "Diagnostic implementation in final APK entry: $($entry.FullName)" }
            }
        } finally { $reader.Dispose(); $content = $null }
    }
} finally { $archive.Dispose() }
Write-Host 'Verified final APK has no native performance bridge/policy or Web collector.'
