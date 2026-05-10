param(
    [string]$Root = "F:\smartgas-grid"
)

$automationDir = Join-Path $Root "logs\automation"
$pidPath = Join-Path $automationDir "ai-query-iteration-loop.pid"
$stopPath = Join-Path $automationDir "ai-query-iteration-loop.stop"
$latestReport = Join-Path $Root "docs\automation\ai-query-iteration\latest.md"
$loopLog = Join-Path $automationDir "ai-query-iteration-loop.log"

if (Test-Path $pidPath) {
    $pidText = (Get-Content -Path $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
    $process = if ($pidText) { Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue } else { $null }
    if ($process) {
        Write-Host "Status: running"
        Write-Host "PID: $pidText"
    } else {
        Write-Host "Status: pid file exists, but process is not running"
        Write-Host "PID: $pidText"
    }
} else {
    Write-Host "Status: not running"
}

Write-Host "StopFlag: $(Test-Path $stopPath)"
Write-Host "LatestReportExists: $(Test-Path $latestReport)"
Write-Host "LoopLogExists: $(Test-Path $loopLog)"
