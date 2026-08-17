param(
  [Parameter(Mandatory=$true)][string]$ProfileDir,
  [Parameter(Mandatory=$true)][string]$RuntimeDir
)
$ErrorActionPreference = 'Stop'
$target = Join-Path $ProfileDir 'node_modules\@anoslide'
New-Item -ItemType Directory -Path $target -Force | Out-Null
foreach ($name in @('dsh-host-files', 'dsh-client-vscode-layout')) {
  $link = Join-Path $target $name
  $real = Join-Path $RuntimeDir "node_modules\@anoslide\$name"
  if (Test-Path $link) { Remove-Item $link -Force -Recurse }
  New-Item -ItemType Junction -Path $link -Target $real | Out-Null
  Write-Output "JUNCTION $link -> $real"
}
Write-Output 'PROFILE_LINKS_DONE'
