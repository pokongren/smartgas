param(
    [string]$Workspace = "F:\smartgas-grid",
    [switch]$ResetWorkspaceCache,
    [switch]$ForceRestart = $true,
    [switch]$DisableGpu = $true
)

$ErrorActionPreference = "Stop"

function Get-AntigravityExe {
    $candidates = @(
        "C:\Users\Administrator\AppData\Local\Programs\Antigravity\Antigravity.exe",
        "C:\Users\Administrator\AppData\Local\Programs\antigravity\Antigravity.exe",
        "C:\Program Files\Antigravity\Antigravity.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw "Antigravity.exe not found."
}

function Remove-WorktreeConfig {
    try {
        & git -C $Workspace config --unset-all extensions.worktreeConfig 2>$null
    } catch {
        # Keep going; we verify below.
    }

    $remaining = & git -C $Workspace config --get-all extensions.worktreeConfig 2>$null
    if ($LASTEXITCODE -eq 0 -and $remaining) {
        throw "Failed to remove extensions.worktreeConfig from $Workspace"
    }
}

function Reset-AntigravityWorkspaceCache {
    $workspaceStorageRoot = "C:\Users\Administrator\AppData\Roaming\Antigravity\User\workspaceStorage"
    $target = Join-Path $workspaceStorageRoot "4e67d3ecddabf1eddf78c205ac4a57f9"

    if (Test-Path -LiteralPath $target) {
        $backupName = "4e67d3ecddabf1eddf78c205ac4a57f9.bak-" + (Get-Date -Format "yyyyMMdd-HHmmss")
        try {
            Rename-Item -LiteralPath $target -NewName $backupName -Force
        } catch {
            Write-Warning "Workspace cache is still locked. Continuing without cache reset."
        }
    }
}

function Reset-GpuCaches {
    $gpuPaths = @(
        "C:\Users\Administrator\AppData\Roaming\Antigravity\GPUCache",
        "C:\Users\Administrator\AppData\Roaming\Antigravity\DawnGraphiteCache",
        "C:\Users\Administrator\AppData\Roaming\Antigravity\DawnWebGPUCache"
    )

    foreach ($path in $gpuPaths) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Restart-Antigravity {
    param(
        [string]$ExePath
    )

    if ($ForceRestart) {
        Get-Process | Where-Object { $_.ProcessName -eq "Antigravity" } | Stop-Process -Force -ErrorAction SilentlyContinue
        for ($i = 0; $i -lt 10; $i++) {
            $running = Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue
            if (-not $running) {
                break
            }

            Start-Sleep -Milliseconds 500
        }
    }

    $arguments = @()
    if ($DisableGpu) {
        $arguments += "--disable-gpu"
    }
    $arguments += "`"$Workspace`""

    Start-Process -FilePath $ExePath -ArgumentList $arguments
}

$antigravityExe = Get-AntigravityExe
Remove-WorktreeConfig

if ($ResetWorkspaceCache) {
    Reset-AntigravityWorkspaceCache
}

if ($DisableGpu) {
    Reset-GpuCaches
}

Restart-Antigravity -ExePath $antigravityExe

Start-Sleep -Seconds 3
Remove-WorktreeConfig

Write-Host "Antigravity compatibility repair completed for $Workspace (DisableGpu=$DisableGpu)"
