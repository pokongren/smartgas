param(
    [string]$Root = "F:\smartgas-grid",
    [int]$IntervalSeconds = 7200
)

$ErrorActionPreference = "Stop"
$automationDir = Join-Path $Root "logs\automation"
$pidPath = Join-Path $automationDir "ai-query-iteration-loop.pid"
$stopPath = Join-Path $automationDir "ai-query-iteration-loop.stop"
$loopScript = Join-Path $Root "tools\ai_query_iteration_loop.ps1"

New-Item -ItemType Directory -Path $automationDir -Force | Out-Null

if (-not (Test-Path $loopScript)) {
    throw "Loop script not found: $loopScript"
}

if (Test-Path $pidPath) {
    $oldPid = (Get-Content -Path $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($oldPid -and (Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue)) {
        Write-Host "AI query iteration loop is already running. PID: $oldPid"
        exit 0
    }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

if (Test-Path $stopPath) {
    Remove-Item -LiteralPath $stopPath -Force
}

$process = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $loopScript,
        "-Root", $Root,
        "-IntervalSeconds", "$IntervalSeconds"
    ) `
    -WindowStyle Hidden `
    -PassThru

Write-Host "Started AI query iteration loop. PID: $($process.Id)"
Write-Host "IntervalSeconds: $IntervalSeconds"
Write-Host "Reports: $Root\docs\automation\ai-query-iteration"
Write-Host "Logs: $Root\logs\automation"
