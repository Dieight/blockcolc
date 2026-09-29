Add-Type -AssemblyName System.Drawing
# Same-view pairs: voidscan (no fog, black sky) vs normal render.
# True sky color = median normal-render color over voidscan-black (background)
# pixels. "Fog-bleached" = terrain pixel (non-black in voidscan) whose normal
# color equals the true sky color within tolerance.
$voidDir = Get-ChildItem "C:\Codex\tomato-clock\apps\web\test-results" -Directory | Where-Object Name -like '*void-probe*void-scans-natural-valley-at-noon*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$normDir = Get-ChildItem "C:\Codex\tomato-clock\apps\web\test-results" -Directory | Where-Object Name -like '*normal-probe*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
function Median($list) { $sorted = $list | Sort-Object; if ($sorted.Count -eq 0) { return 0 }; return $sorted[[int]($sorted.Count / 2)] }
for ($n = 0; $n -le 6; $n++) {
    $v = [System.Drawing.Bitmap]::FromFile((Join-Path $voidDir.FullName "void-natural-noon-$n.png"))
    $m = [System.Drawing.Bitmap]::FromFile((Join-Path $normDir.FullName "normal-natural-noon-$n.png"))
    if ($v.Width -ne $m.Width -or $v.Height -ne $m.Height) { Write-Output "frame $n size mismatch"; continue }
    $rs = New-Object System.Collections.Generic.List[int]
    $gs = New-Object System.Collections.Generic.List[int]
    $bs = New-Object System.Collections.Generic.List[int]
    for ($y = 0; $y -lt $v.Height; $y += 4) {
        for ($x = 0; $x -lt $v.Width; $x += 4) {
            $vv = $v.GetPixel($x, $y)
            if ($vv.R -lt 24 -and $vv.G -lt 24 -and $vv.B -lt 24) {
                $mm = $m.GetPixel($x, $y)
                $rs.Add($mm.R); $gs.Add($mm.G); $bs.Add($mm.B)
            }
        }
    }
    if ($rs.Count -eq 0) { Write-Output ("frame {0}: no sky pixels" -f $n); continue }
    $sr = Median $rs; $sg = Median $gs; $sb = Median $bs
    $bleached = 0; $terrain = 0
    for ($y = 60; $y -lt $m.Height - 2; $y += 2) {
        for ($x = 2; $x -lt $m.Width - 2; $x += 2) {
            $vv = $v.GetPixel($x, $y)
            if ($vv.R -lt 24 -and $vv.G -lt 24 -and $vv.B -lt 24) { continue }
            $terrain += 1
            $mm = $m.GetPixel($x, $y)
            if ([math]::Abs($mm.R - $sr) -lt 16 -and [math]::Abs($mm.G - $sg) -lt 16 -and [math]::Abs($mm.B - $sb) -lt 16) { $bleached += 1 }
        }
    }
    Write-Output ("frame {0}: sky=({1},{2},{3}) terrain={4} fog-bleached={5}" -f $n, $sr, $sg, $sb, $terrain, $bleached)
    $v.Dispose(); $m.Dispose()
}
