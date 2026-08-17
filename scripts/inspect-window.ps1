Get-Process 'DeepSeek Harness' -ErrorAction SilentlyContinue |
  Select-Object Id, MainWindowHandle, MainWindowTitle, Responding |
  Format-Table -AutoSize
