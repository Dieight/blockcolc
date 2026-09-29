Add-Type -AssemblyName System.Drawing
$voidDir = Get-ChildItem "C:\Codex\tomato-clock\apps\web\test-results" -Directory | Where-Object Name -like '*void-probe*void-scans-natural-valley-at-noon*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$normDir = Get-ChildItem "C:\Codex\tomato-clock\apps\web\test-results" -Directory | Where-Object Name -like '*normal-probe*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
foreach ($label in @(@('void', $voidDir.FullName, 'void-natural-noon-'), @('normal', $normDir.FullName, 'normal-natural-noon-'))) {
    $tag = $label[0]; $dir = $label[1]; $prefix = $label[2]
    foreach ($n in 0..6) {
        $bmp = [System.Drawing.Bitmap]::FromFile((Join-Path $dir "$prefix$n.png"))
        $sum = 0.0; $cnt = 0
        for ($y = 0; $y -lt $bmp.Height; $y += 8) {
            for ($x = 0; $x -lt $bmp.Width; $x += 8) {
                $c = $bmp.GetPixel($x, $y)
                $sum += ($c.R + $c.G + $c.B) / 3.0; $cnt += 1
            }
        }
        $corner = $bmp.GetPixel(4, 4)
        $center = $bmp.GetPixel([int]($bmp.Width / 2), [int]($bmp.Height * 0.45))
        $low = $bmp.GetPixel([int]($bmp.Width * 0.5), [int]($bmp.Height * 0.85))
        Write-Output ("{0} {1}: mean={2:F1} corner=({3},{4},{5}) center=({6},{7},{8}) low=({9},{10},{11})" -f $tag, $n, ($sum / $cnt), $corner.R, $corner.G, $corner.B, $center.R, $center.G, $center.B, $low.R, $low.G, $low.B)
        $bmp.Dispose()
    }
}
