[CmdletBinding()]
param()

# Audit-Release.ps1 — verifies that the committed version, the git tag, and the
# GitHub Release line up. Catches the v1.3.1 class of gap where a version was
# committed but never tagged/released. Exits 1 when the current version.json
# version is inconsistent; older-version gaps are reported as warnings only.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Release-Common.ps1')

$context = Get-ReleaseContext
$tag = "v$($context.VersionName)"
$problems = @()
$warnings = @()

Push-Location $context.Root
try {
    # gh release create only creates the tag on the remote; check origin directly.
    & git ls-remote --exit-code origin "refs/tags/$tag" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        $problems += "git tag $tag does not exist on origin."
    } else {
        Write-Host "OK git tag $tag exists on origin."
    }

    $release = (& gh release view $tag --repo $context.Repository --json tagName,isDraft,url 2>$null | Out-String | ConvertFrom-Json)
    if (-not $release) {
        $problems += "GitHub Release $tag does not exist."
    } else {
        Write-Host "OK GitHub Release $tag -> $($release.url) (draft=$($release.isDraft))"
        if ($release.isDraft) { $problems += "GitHub Release $tag is still a draft." }
    }

    # gh release view has no isLatest field; ask the releases/latest endpoint.
    $latestTag = (& gh api "repos/$($context.Repository)/releases/latest" --jq '.tag_name' 2>$null | Select-Object -First 1)
    if ($latestTag -and $latestTag.Trim() -ne $tag) {
        $problems += "GitHub Release $tag is not marked Latest (latest is $($latestTag.Trim()))."
    } elseif (-not $latestTag) {
        $problems += "Could not determine the Latest GitHub Release."
    } else {
        Write-Host "OK GitHub Release $tag is Latest."
    }

    $allTags = (Invoke-External -FilePath 'git' -Arguments @('tag', '-l', 'v*') -Capture | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $releasedTags = (Invoke-External -FilePath 'gh' -Arguments @('release', 'list', '--repo', $context.Repository, '--json', 'tagName', '--limit', '200') -Capture | Out-String | ConvertFrom-Json | ForEach-Object { $_.tagName })
    foreach ($oldTag in $allTags) {
        if ($oldTag -ne $tag -and $releasedTags -notcontains $oldTag) {
            $warnings += "git tag $oldTag has no GitHub Release (backfill or document it)."
        }
    }
}
finally {
    Pop-Location
}

foreach ($warning in $warnings) { Write-Warning $warning }
if ($problems.Count -gt 0) {
    foreach ($problem in $problems) { Write-Error $problem }
    exit 1
}
Write-Host "Release audit passed for $tag."
exit 0
