[CmdletBinding()]
param(
    [string]$ManifestPath = (Join-Path $PSScriptRoot 'test-fixtures.json')
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json

foreach ($fixture in $manifest.fixtures) {
    $path = Join-Path $repositoryRoot ([string]$fixture.path)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required local fixture is missing: $($fixture.path)"
    }

    $file = Get-Item -LiteralPath $path
    if ($file.Length -ne [long]$fixture.sizeBytes) {
        throw "Fixture size mismatch for $($fixture.path): expected $($fixture.sizeBytes), found $($file.Length)."
    }

    $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    $expected = ([string]$fixture.sha256).ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "Fixture SHA-256 mismatch for $($fixture.path): expected $expected, found $actual."
    }

    Write-Host "Verified fixture $($fixture.path) ($actual)"
}
