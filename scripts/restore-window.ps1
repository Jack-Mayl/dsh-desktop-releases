Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
'@
$p = Get-Process 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($null -eq $p) { throw 'DeepSeek Harness window not found' }
$h = [IntPtr]$p.MainWindowHandle
[pscustomobject]@{Pid=$p.Id;Handle=$p.MainWindowHandle;Visible=[Win32]::IsWindowVisible($h);Minimized=[Win32]::IsIconic($h)} | Format-List
[Win32]::ShowWindow($h, 9) | Out-Null
[Win32]::SetForegroundWindow($h) | Out-Null
Write-Output 'WINDOW_RESTORED'
