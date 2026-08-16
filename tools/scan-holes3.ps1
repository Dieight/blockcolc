Add-Type -AssemblyName System.Drawing
# Diagnostics scan against the pure-black debug background: any near-black pixel
# fully surrounded by terrain colors is a real hole (sky is hidden in ?flat mode).
$d = Get-ChildItem "C:\Codex\tomato-clock\apps\web\test-results" -Directory | Where-Object Name -like '*flat-probe*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
foreach ($f in (Get-ChildItem $d.FullName -Filter '*.png' | Sort-Object Name)) {
    $bmp = [System.Drawing.Bitmap]::FromFile($f.FullName)
    $w = $bmp.Width
    $h = $bmp.Height
    $isVoid = { param($c) $c.R -lt 24 -and $c.G -lt 24 -and $c.B -lt 24 }
    $holes = New-Object System.Collections.Generic.List[object]
    for ($y = 60; $y -lt $h - 2; $y += 1) {
        for ($x = 2; $x -lt $w - 2; $x += 1) {
            $c = $bmp.GetPixel($x, $y)
            if (-not (& $isVoid $c)) { continue }
            $surrounded = $true
            foreach ($dy in @(-1,0,1)) {
                foreach ($dx in @(-1,0,1)) {
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
