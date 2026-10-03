$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'Full-GatePolicy.ps1')
function Invoke-TimedReleaseStep {
    param($Name, $Durations, [scriptblock]$Action)
    try { & $Action } finally { $Durations[$Name] = 0 }
}
foreach ($collect in @($true, $false)) {
    $visited = [System.Collections.Generic.List[string]]::new()
    $failures = [System.Collections.Generic.List[object]]::new()
    $durations = [ordered]@{}
    $stopped = $false
    try {
        foreach ($name in @('first', 'broken', 'last')) {
            Invoke-FullGateStep -Name $name -Durations $durations -Failures $failures -CollectFailures:$collect -Action {
                $visited.Add($name)
                if ($name -eq 'broken') { throw 'synthetic failure' }
            }
        }
    } catch { $stopped = $true }
    $expected = if ($collect) { 'first,broken,last' } else { 'first,broken' }
    if (($visited -join ',') -ne $expected -or $stopped -eq $collect -or $failures.Count -ne 1) { throw 'Full-gate failure policy regression' }
}
# Exercise the real workspace iterator without launching npm or touching disk.
function Get-Content {
    param($LiteralPath, [switch]$Raw)
    if ($LiteralPath -eq 'C:\synthetic-gate\package.json') { return '{"workspaces":["packages/*"]}' }
    $name = Split-Path -Leaf (Split-Path -Parent $LiteralPath)
    if ($name -eq 'no-scripts') { return '{"name":"no-scripts"}' }
    if ($name -eq 'typecheck-only') { return '{"name":"typecheck-only","scripts":{"typecheck":"tsc --noEmit"}}' }
    return ('{"name":"' + $name + '","scripts":{"test":"vitest run","typecheck":"tsc --noEmit"}}')
}
function Get-ChildItem { param($Path,[switch]$Directory) foreach($name in @('first','broken','last','no-scripts','typecheck-only')) { [pscustomobject]@{Name=$name;FullName="C:\synthetic-gate\$name"} } }
function Test-Path { param($LiteralPath) return $true }
function Invoke-External {
    param($FilePath,$Arguments)
    $visited.Add($Arguments[3])
    if ($Arguments[1] -eq 'test' -and $Arguments[-1] -ne $(if($collect){'--bail=0'}else{'--bail=1'})) { throw 'Wrong unit failure limit' }
    if ($Arguments[3] -eq 'broken') { throw 'synthetic workspace failure' }
}
foreach($collect in @($true,$false)) {
    foreach($scriptName in @('test','typecheck')) {
        $visited=[System.Collections.Generic.List[string]]::new()
        try { Invoke-FullWorkspaceChecks -Root 'C:\synthetic-gate' -ScriptName $scriptName -CollectFailures:$collect } catch { }
        # The iterator sorts by name, so the broken workspace runs first.
        $expected=if(-not $collect){'broken'}elseif($scriptName -eq 'test'){'broken,first,last'}else{'broken,first,last,typecheck-only'}
        if(($visited -join ',') -ne $expected) { throw 'Workspace failure-policy regression' }
    }
}
Write-Host 'Full-gate policy: gate/workspace collection, fail-fast and absent scripts passed (synthetic checks only).'
