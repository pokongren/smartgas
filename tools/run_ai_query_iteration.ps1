param(
    [string]$Root = "F:\smartgas-grid"
)

$ErrorActionPreference = "Stop"
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$logDir = Join-Path $Root "logs\automation"
$logPath = Join-Path $logDir "ai-query-iteration-$timestamp.log"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Set-Location $Root

$env:PYTHONPATH = Join-Path $Root "backend"
$python = "python"
$script = Join-Path $Root "tools\ai_query_iteration_audit.py"

try {
    "[$(Get-Date -Format s)] AI query iteration audit started" | Tee-Object -FilePath $logPath
    & $python $script 2>&1 | Tee-Object -FilePath $logPath -Append
    $exitCode = $LASTEXITCODE
    "[$(Get-Date -Format s)] AI query iteration audit finished with exit code $exitCode" | Tee-Object -FilePath $logPath -Append
    exit $exitCode
}
catch {
    "[$(Get-Date -Format s)] AI query iteration audit failed: $($_.Exception.Message)" | Tee-Object -FilePath $logPath -Append
    exit 1
}
