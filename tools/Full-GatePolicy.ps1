# First explicitly requested full run collects failures; repair runs stop early.
function Invoke-FullGateStep {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][System.Collections.IDictionary]$Durations,
        [Parameter(Mandatory)][AllowEmptyCollection()][System.Collections.Generic.List[object]]$Failures,
        [Parameter(Mandatory)][scriptblock]$Action,
        [switch]$CollectFailures
    )
    try {
        Invoke-TimedReleaseStep -Name $Name -Durations $Durations -Action $Action
    }
    catch {
        $Failures.Add([pscustomobject]@{ name = $Name; status = 'failed'; message = $_.Exception.Message })
        if (-not $CollectFailures) { throw }
        Write-Warning "Gate '$Name' failed; collecting the rest of this first full run."
    }
}

function Invoke-FullWorkspaceChecks {
    param([string]$Root, [string]$ScriptName, [switch]$CollectFailures)
    $workspaceFailures = [System.Collections.Generic.List[string]]::new()
    $manifest = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
    foreach ($pattern in $manifest.workspaces) {
        foreach ($directory in (Get-ChildItem -Path (Join-Path $Root $pattern) -Directory | Sort-Object Name)) {
            $packagePath = Join-Path $directory.FullName 'package.json'
            if (-not (Test-Path -LiteralPath $packagePath)) { continue }
            $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
            $scriptsProperty = $package.PSObject.Properties['scripts']
            $scriptProperty = if ($scriptsProperty) { $scriptsProperty.Value.PSObject.Properties[$ScriptName] } else { $null }
            if (-not $scriptProperty -or -not $scriptProperty.Value) { continue }
            $arguments = @('run', $ScriptName, '-w', $package.name)
            try {
                if ($ScriptName -eq 'test') {
                    # Current workspace unit scripts are Vitest. Fail explicitly if
                    # that changes instead of silently passing a Vitest-only flag.
                    if ($scriptProperty.Value -notmatch '^vitest run\b') { throw "Unsupported unit runner: $($package.name)" }
                    $limit = if ($CollectFailures) { '--bail=0' } else { '--bail=1' }
                    $arguments += @('--', $limit)
                }
                Invoke-External -FilePath 'npm' -Arguments $arguments
            }
            catch {
                if (-not $CollectFailures) { throw }
                $workspaceFailures.Add("$($package.name): $($_.Exception.Message)")
            }
        }
    }
    if ($workspaceFailures.Count -gt 0) { throw ($workspaceFailures -join "`n") }
}
