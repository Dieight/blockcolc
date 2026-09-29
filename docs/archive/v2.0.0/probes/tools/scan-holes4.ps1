Add-Type -AssemblyName System.Drawing
# Diagnostics scan for the voidscan mode: real materials, pure-black backdrop,
# no fog. A near-black pixel fully surrounded by brighter terrain colors is a
# geometric hole; fog-faded faces keep their material color and do not trip it.
$dirs = Get-ChildItem "C:\Codex\tomato-clock\apps\web\test-results" -Directory | Where-Object Name -like '*void-probe*' | Sort-Object LastWriteTime -Descending | Select-Object -First 3
foreach ($d in $dirs) {
Write-Output ("scanning: {0}" -f $d.Name)
foreach ($f in (Get-ChildItem $d.FullName -Filter '*.png' | Sort-Object Name)) {
    $bmp = [System.Drawing.Bitmap]::FromFile($f.FullName)
    $w = $bmp.Width
    $h = $bmp.Height
    $isVoid = { param($c) $c.R -lt 24 -and $c.G -lt 24 -and $c.B -lt 24 }
    $holes = New-Object System.Collections.Generic.List[object]
    for ($y = 60; $y -lt $h - 2; $y += 2) {
        for ($x = 2; $x -lt $w - 2; $x += 2) {
            $c = $bmp.GetPixel($x, $y)
            if (-not (& $isVoid $c)) { continue }
            $surrounded = $true
            foreach ($dy in @(-2,0,2)) {
                foreach ($dx in @(-2,0,2)) {
                    if ($dx -eq 0 -and $dy -eq 0) { continue }
                    $n = $bmp.GetPixel($x + $dx, $y + $dy)
                    if (& $isVoid $n) { $surrounded = $false; break }
                }
                if (-not $surrounded) { break }
            }
            if ($surrounded) { $holes.Add([pscustomobject]@{X=$x; Y=$y}) }
        }
    }
    Write-Output ("{0}: interior holes={1}" -f $f.Name, $holes.Count)
    if ($holes.Count -gt 0 -and $holes.Count -lt 60) {
        $holes | ForEach-Object { "  ({0},{1})" -f $_.X, $_.Y }
    }
    $bmp.Dispose()
}
}
