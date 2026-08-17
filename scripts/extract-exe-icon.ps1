param(
  [Parameter(Mandatory=$true)][string]$InputExe,
  [Parameter(Mandatory=$true)][string]$OutputPng
)
Add-Type -AssemblyName System.Drawing
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($InputExe)
if ($null -eq $icon) { throw "No icon in $InputExe" }
$bitmap = $icon.ToBitmap()
$bitmap.Save($OutputPng, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
$icon.Dispose()
