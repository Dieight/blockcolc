param(
    [Parameter(Mandatory=$true)][string]$Report,
    [Parameter(Mandatory=$true)][string]$Output,
    [switch]$Preflight
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
if(Test-Path -LiteralPath $Output){throw 'Review image already exists'}
$data=Get-Content -Raw -LiteralPath $Report | ConvertFrom-Json
$pairs=if($Preflight){1}else{5}
if(!$data.completed -or $data.repeats -ne $pairs -or $data.cases.Count -ne $pairs*4){throw 'Requires a completed two-fixture report with the explicit sampling scope'}
$directory=Split-Path -Parent (Resolve-Path -LiteralPath $Report)
$image=[System.Drawing.Bitmap]::new(960,$pairs*350)
$graphics=[System.Drawing.Graphics]::FromImage($image)
$font=[System.Drawing.Font]::new('Consolas',11)
try {
    $graphics.Clear([System.Drawing.Color]::White)
    for($pair=0;$pair -lt $pairs;$pair++){
        $column=0
        foreach($fixture in @('ocean','coast')){foreach($backend in @('native','web')){
            $case=@($data.cases | Where-Object {$_.pair -eq $pair -and $_.fixture -eq $fixture -and $_.backend -eq $backend})
            if($case.Count -ne 1 -or !$case[0].completed){throw 'Missing completed case'}
            $file=Join-Path $directory ($case[0].run+'.png')
            $source=[System.Drawing.Image]::FromFile($file)
            try {
                # Cost Activity: top Compose header, then the .75 world pane.
                # Crop only known screenshot pixels; never synthesize scene content.
                if($source.Width -ne 1264 -or $source.Height -ne 2780){throw 'Unexpected screenshot dimensions'}
                $target=[System.Drawing.Rectangle]::new($column*240,$pair*350+28,240,320)
                $crop=[System.Drawing.Rectangle]::new(0,350,1264,1685)
                $graphics.DrawImage($source,$target,$crop,[System.Drawing.GraphicsUnit]::Pixel)
                $graphics.DrawString("$pair $fixture $backend",$font,[System.Drawing.Brushes]::Black,$column*240+4,$pair*350+3)
            } finally {$source.Dispose()}
            $column++
        }}
    }
    $image.Save([System.IO.Path]::GetFullPath($Output),[System.Drawing.Imaging.ImageFormat]::Png)
} finally {$font.Dispose();$graphics.Dispose();$image.Dispose()}
