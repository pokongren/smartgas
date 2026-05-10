param(
    [string]$Root = "F:\smartgas-grid",
    [string]$TaskName = "SmartGas_AI_Query_Iteration_Every_2h"
)

$ErrorActionPreference = "Stop"
$runner = Join-Path $Root "tools\run_ai_query_iteration.ps1"

if (-not (Test-Path $runner)) {
    throw "Runner script not found: $runner"
}

$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Root `"$Root`""

schtasks.exe /Create `
    /TN $TaskName `
    /SC HOURLY `
    /MO 2 `
    /TR $taskCommand `
    /F | Out-Host

if ($LASTEXITCODE -ne 0) {
    throw "schtasks register failed with exit code $LASTEXITCODE. If this machine blocks Task Scheduler creation, use tools\start_ai_query_iteration_loop.ps1 instead."
}

Write-Host "Registered task: $TaskName"
Write-Host "Runner: $runner"
Write-Host "Reports: $Root\docs\automation\ai-query-iteration"
Write-Host "Logs: $Root\logs\automation"
