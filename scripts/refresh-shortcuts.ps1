$ErrorActionPreference = 'Stop'
$exe = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'
if (-not (Test-Path $exe)) { throw "Installed executable not found: $exe" }
$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'DeepSeek Harness.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'DeepSeek Harness.lnk')
)
foreach ($path in $targets) {
  $parent = Split-Path $path -Parent
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $exe
  $shortcut.WorkingDirectory = Split-Path $exe -Parent
  $shortcut.IconLocation = "$exe,0"
  $shortcut.Description = 'DeepSeek Harness'
  $shortcut.Save()
  Write-Output "SHORTCUT=$path"
  Write-Output "TARGET=$($shortcut.TargetPath)"
  Write-Output "ICON=$($shortcut.IconLocation)"
}
Start-Process -FilePath "$env:SystemRoot\System32\ie4uinit.exe" -ArgumentList '-show' -Wait
Write-Output 'ICON_CACHE_REFRESHED'
