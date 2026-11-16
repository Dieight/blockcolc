param(
    [Parameter(Mandatory=$true)][string]$Source,
    [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$root = [IO.Path]::GetFullPath((Join-Path $repository 'artifacts/experiments/v3.0.0'))
$destinationPath = [IO.Path]::GetFullPath($Destination)
if (-not $destinationPath.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetExtension($destinationPath) -ne '.apk') { throw 'APK evidence must stay inside the native experiment directory' }
if (Test-Path -LiteralPath $destinationPath) { throw 'APK evidence is immutable; use a new destination' }
$sourceFile = Get-Item -LiteralPath $Source
if ($sourceFile.PSIsContainer -or $sourceFile.Length -le 0) { throw 'Missing APK input' }
$digest = (Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$objects = Join-Path $root 'apk-objects'
New-Item -ItemType Directory -Path $objects -Force | Out-Null
$object = Join-Path $objects ($digest + '.apk')
if (-not (Test-Path -LiteralPath $object)) {
    $staged = $object + '.new-' + [Guid]::NewGuid().ToString('N')
    try {
        # Never hard-link a Gradle output: a later build can overwrite it.
        Copy-Item -LiteralPath $sourceFile.FullName -Destination $staged
        if ((Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash.ToLowerInvariant() -ne $digest) { throw 'APK changed while retaining evidence' }
        Move-Item -LiteralPath $staged -Destination $object
    } finally {
        if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged }
    }
}
if ((Get-Item -LiteralPath $object).Length -ne $sourceFile.Length -or
    (Get-FileHash -LiteralPath $object -Algorithm SHA256).Hash.ToLowerInvariant() -ne $digest) { throw 'Stored APK identity mismatch' }
New-Item -ItemType HardLink -Path $destinationPath -Value $object | Out-Null
[ordered]@{schema=1;path=$destinationPath;object=$object;sha256=$digest;bytes=$sourceFile.Length} |
    ConvertTo-Json | Set-Content -LiteralPath ($destinationPath + '.receipt.json') -Encoding utf8
