Add-Type -AssemblyName System.Drawing
# Compares same-view pairs: voidscan (no fog, black sky) vs normal render.
# A pixel is "fog-bleached" when it is terrain in the voidscan frame (non-black)
# but reads as the void/sky color in the normal frame.
$voidDir = Get-ChildItem "C:\Codex\tomato-clock\apps\web\test-results" -Directory | Where-Object Name -like '*void-probe*void-scans-natural-valley-at-noon*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$normDir = Get-ChildItem "C:\Codex\tomato-clock\apps\web\test-results" -Directory | Where-Object Name -like '*normal-probe*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Output ("void dir: {0}" -f $voidDir.Name)
Write-Output ("norm dir: {0}" -f $normDir.Name)
for ($n = 0; $n -le 6; $n++) {
    $v = [System.Drawing.Bitmap]::FromFile((Join-Path $voidDir.FullName "void-natural-noon-$n.png"))
    $m = [System.Drawing.Bitmap]::FromFile((Join-Path $normDir.FullName "normal-natural-noon-$n.png"))
    if ($v.Width -ne $m.Width -or $v.Height -ne $m.Height) { Write-Output "frame $n size mismatch v=$($v.Width)x$($v.Height) m=$($m.Width)x$($m.Height)"; continue }
    $sky = $m.GetPixel(4, 4)
    $bleached = 0
    $samples = New-Object System.Collections.Generic.List[string]
    for ($y = 60; $y -lt $m.Height - 2; $y += 2) {
        for ($x = 2; $x -lt $m.Width - 2; $x += 2) {
            $vv = $v.GetPixel($x, $y)
            if ($vv.R -lt 24 -and $vv.G -lt 24 -and $vv.B -lt 24) { continue }
            $mm = $m.GetPixel($x, $y)
            if ([math]::Abs($mm.R - $sky.R) -lt 20 -and [math]::Abs($mm.G - $sky.G) -lt 20 -and [math]::Abs($mm.B - $sky.B) -lt 20) {
                $bleached += 1
                if ($samples.Count -lt 12) { $samples.Add("($x,$y) v=$($vv.R),$($vv.G),$($vv.B) m=$($mm.R),$($mm.G),$($mm.B)") }
            }
        }
    }
    Write-Output ("frame {0}: sky={1},{2},{3} fog-bleached={4}" -f $n, $sky.R, $sky.G, $sky.B, $bleached)
    $samples | ForEach-Object { "  $_" }
    $v.Dispose(); $m.Dispose()
}
