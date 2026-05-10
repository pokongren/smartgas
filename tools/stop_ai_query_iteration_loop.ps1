param(
    [string]$Root = "F:\smartgas-grid"
)

$ErrorActionPreference = "Continue"
$automationDir = Join-Path $Root "logs\automation"
$pidPath = Join-Path $automationDir "ai-query-iteration-loop.pid"
$stopPath = Join-Path $automationDir "ai-query-iteration-loop.stop"

New-Item -ItemType Directory -Path $automationDir -Force | Out-Null
"stop requested at $(Get-Date -Format s)" | Set-Content -Path $stopPath -Encoding UTF8

if (-not (Test-Path $pidPath)) {
    Write-Host "Stop flag written. No PID file found."
    exit 0
}

$pidText = (Get-Content -Path $pidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $pidText) {
    Write-Host "Stop flag written. PID file is empty."
    exit 0
}

$process = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
if (-not $process) {
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    Write-Host "Stop flag written. Process is not running."
    exit 0
}

Wait-Process -Id $process.Id -Timeout 5 -ErrorAction SilentlyContinue
if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    Write-Host "Loop process stopped. PID: $($process.Id)"
} else {
    Write-Host "Loop process stopped gracefully. PID: $($process.Id)"
}
