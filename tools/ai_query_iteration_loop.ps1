param(
    [string]$Root = "F:\smartgas-grid",
    [int]$IntervalSeconds = 7200
)

$ErrorActionPreference = "Continue"
$automationDir = Join-Path $Root "logs\automation"
$pidPath = Join-Path $automationDir "ai-query-iteration-loop.pid"
$stopPath = Join-Path $automationDir "ai-query-iteration-loop.stop"
$loopLog = Join-Path $automationDir "ai-query-iteration-loop.log"
$runner = Join-Path $Root "tools\run_ai_query_iteration.ps1"

New-Item -ItemType Directory -Path $automationDir -Force | Out-Null
if (Test-Path $stopPath) {
    Remove-Item -LiteralPath $stopPath -Force
}

$PID | Set-Content -Path $pidPath -Encoding UTF8
"[$(Get-Date -Format s)] loop started, pid=$PID, interval=${IntervalSeconds}s" | Add-Content -Path $loopLog -Encoding UTF8

try {
    while (-not (Test-Path $stopPath)) {
        if (-not (Test-Path $runner)) {
            "[$(Get-Date -Format s)] runner not found: $runner" | Add-Content -Path $loopLog -Encoding UTF8
            break
        }

        "[$(Get-Date -Format s)] run audit" | Add-Content -Path $loopLog -Encoding UTF8
        powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner -Root $Root
        $exitCode = $LASTEXITCODE
        "[$(Get-Date -Format s)] audit finished, exit=$exitCode" | Add-Content -Path $loopLog -Encoding UTF8

        $slept = 0
        while ($slept -lt $IntervalSeconds -and -not (Test-Path $stopPath)) {
            $chunk = [Math]::Min(30, $IntervalSeconds - $slept)
            Start-Sleep -Seconds $chunk
            $slept += $chunk
        }
    }
}
finally {
    "[$(Get-Date -Format s)] loop stopped" | Add-Content -Path $loopLog -Encoding UTF8
    if (Test-Path $pidPath) {
        Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    }
}
