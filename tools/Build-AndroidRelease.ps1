[CmdletBinding()]
param(
    [string]$SigningDirectory = (Join-Path $env:USERPROFILE '.blockcolc\signing'),
    [switch]$QualityGateAlreadyPassed
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$keyStorePath = Join-Path $SigningDirectory 'blockcolc-release.jks'
$passwordPath = Join-Path $SigningDirectory 'blockcolc-release-password.clixml'

if (-not (Test-Path -LiteralPath $keyStorePath -PathType Leaf)) {
    throw "Release keystore not found: $keyStorePath"
}

if (-not (Test-Path -LiteralPath $passwordPath -PathType Leaf)) {
    throw "Encrypted signing password not found: $passwordPath"
}

$securePassword = Import-Clixml -LiteralPath $passwordPath
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $env:BLOCKCOLC_STORE_FILE = $keyStorePath
    $env:BLOCKCOLC_STORE_PASSWORD = $plainPassword
    $env:BLOCKCOLC_KEY_ALIAS = 'blockcolc-release'
    $env:BLOCKCOLC_KEY_PASSWORD = $plainPassword
    $env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
    $env:Path = "$env:JAVA_HOME\bin;$env:Path"

    Push-Location $repositoryRoot
    try {
        if (-not $QualityGateAlreadyPassed) {
            node tools/sync-version.mjs --check
            if ($LASTEXITCODE -ne 0) { throw 'Version consistency check failed.' }

            & (Join-Path $PSScriptRoot 'Test-FixtureHashes.ps1')
        }
        else {
            Write-Host 'Reusing version, fixture, and TypeScript checks from the enclosing release gate.'
        }

        $syncScript = if ($QualityGateAlreadyPassed) { 'android:sync:prechecked' } else { 'android:sync' }
        npm run $syncScript -w '@tomato-clock/android'
        if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }

        Push-Location (Join-Path $repositoryRoot 'apps\android\android')
        try {
            & .\gradlew.bat --no-daemon --console=plain testDebugUnitTest lintRelease assembleRelease
            if ($LASTEXITCODE -ne 0) { throw 'Android release build failed.' }
        }
        finally {
            Pop-Location
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }

    Remove-Item Env:BLOCKCOLC_STORE_FILE -ErrorAction SilentlyContinue
    Remove-Item Env:BLOCKCOLC_STORE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:BLOCKCOLC_KEY_ALIAS -ErrorAction SilentlyContinue
    Remove-Item Env:BLOCKCOLC_KEY_PASSWORD -ErrorAction SilentlyContinue
    $plainPassword = $null
}
