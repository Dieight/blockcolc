[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$A,
    [Parameter(Mandatory)][string]$B,
    [int]$Step = 7
)

# compare-shot.ps1 — pixel-level screenshot comparison for the visual-verification
# ladder (DOM measurement > pixel diff > vision model). Prints image sizes and the
# mean per-channel RGB difference over a sampled grid; 0 means byte-identical frames.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

foreach ($path in @($A, $B)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Image not found: $path" }
}

$imageA = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $A))
$imageB = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $B))
try {
    Write-Host "A: $($imageA.Width)x$($imageA.Height)  B: $($imageB.Width)x$($imageB.Height)"
    if ($imageA.Width -ne $imageB.Width -or $imageA.Height -ne $imageB.Height) {
        Write-Warning 'Image sizes differ; compare aborted.'
        exit 1
    }
    $diff = [long]0
    $samples = [long]0
    for ($y = 0; $y -lt $imageA.Height; $y += $Step) {
        for ($x = 0; $x -lt $imageA.Width; $x += $Step) {
            $pixelA = $imageA.GetPixel($x, $y)
            $pixelB = $imageB.GetPixel($x, $y)
            $diff += [math]::Abs([int]$pixelA.R - [int]$pixelB.R) + [math]::Abs([int]$pixelA.G - [int]$pixelB.G) + [math]::Abs([int]$pixelA.B - [int]$pixelB.B)
            $samples += 1
        }
    }
    $mean = [math]::Round($diff / ($samples * 3), 2)
    Write-Host "Sampled $samples pixels at step $Step; mean per-channel diff = $mean / 255"
    if ($mean -eq 0) { exit 0 }
    exit 2
}
finally {
    $imageA.Dispose()
    $imageB.Dispose()
}
