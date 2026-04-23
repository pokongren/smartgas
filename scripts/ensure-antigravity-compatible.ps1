param(
    [string]$Workspace = "F:\smartgas-grid",
    [switch]$ResetWorkspaceCache,
    [switch]$ForceRestart = $true,
    [switch]$DisableGpu = $true,
    [switch]$ResetProfile
)

$ErrorActionPreference = "Stop"

$StableProfileRoot = "C:\Users\Administrator\AppData\Local\AntigravityStableProfile"

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
        $gitConfigPath = Join-Path $Workspace ".git\config"
        if (Test-Path -LiteralPath $gitConfigPath) {
            $configContent = Get-Content -LiteralPath $gitConfigPath
            $filteredContent = $configContent | Where-Object { $_ -notmatch '^\s*worktreeConfig\s*=' }
            Set-Content -LiteralPath $gitConfigPath -Value $filteredContent -Encoding ASCII
        }

        $remaining = & git -C $Workspace config --get-all extensions.worktreeConfig 2>$null
        if ($LASTEXITCODE -eq 0 -and $remaining) {
            throw "Failed to remove extensions.worktreeConfig from $Workspace"
        }
    }
}

function Reset-AntigravityWorkspaceCache {
    $workspaceStorageRoots = @(
        "C:\Users\Administrator\AppData\Roaming\Antigravity\User\workspaceStorage",
        (Join-Path $StableProfileRoot "User\workspaceStorage")
    )

    foreach ($workspaceStorageRoot in $workspaceStorageRoots) {
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
}

function Reset-GpuCaches {
    $gpuPaths = @(
        "C:\Users\Administrator\AppData\Roaming\Antigravity\GPUCache",
        "C:\Users\Administrator\AppData\Roaming\Antigravity\DawnGraphiteCache",
        "C:\Users\Administrator\AppData\Roaming\Antigravity\DawnWebGPUCache",
        (Join-Path $StableProfileRoot "GPUCache"),
        (Join-Path $StableProfileRoot "DawnGraphiteCache"),
        (Join-Path $StableProfileRoot "DawnWebGPUCache")
    )

    foreach ($path in $gpuPaths) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-CurrentProxyUrl {
    $internetSettings = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
    if (-not $internetSettings) {
        return ""
    }

    if ($internetSettings.ProxyEnable -ne 1 -or [string]::IsNullOrWhiteSpace($internetSettings.ProxyServer)) {
        return ""
    }

    $proxyUrl = $internetSettings.ProxyServer
    if ($proxyUrl -notmatch '^\w+://') {
        $proxyUrl = "http://$proxyUrl"
    }

    return $proxyUrl
}

function Get-AntigravityProxyUrl {
    $proxyUrl = Get-CurrentProxyUrl
    if ([string]::IsNullOrWhiteSpace($proxyUrl)) {
        return ""
    }
    
    return $proxyUrl
}

function Set-ProxyEnvironmentForAntigravity {
    $proxyUrl = Get-AntigravityProxyUrl
    if ([string]::IsNullOrWhiteSpace($proxyUrl)) {
        return
    }

    $env:HTTP_PROXY = $proxyUrl
    $env:HTTPS_PROXY = $proxyUrl
    $env:ALL_PROXY = $proxyUrl
    $env:NO_PROXY = "localhost,127.0.0.1"
    $env:http_proxy = $proxyUrl
    $env:https_proxy = $proxyUrl
    $env:all_proxy = $proxyUrl
    $env:no_proxy = "localhost,127.0.0.1"
}

function Set-UserProxyEnvironmentForAntigravity {
    $proxyUrl = Get-AntigravityProxyUrl
    if ([string]::IsNullOrWhiteSpace($proxyUrl)) {
        return
    }

    [Environment]::SetEnvironmentVariable("HTTP_PROXY", $proxyUrl, "User")
    [Environment]::SetEnvironmentVariable("HTTPS_PROXY", $proxyUrl, "User")
    [Environment]::SetEnvironmentVariable("ALL_PROXY", $proxyUrl, "User")
    [Environment]::SetEnvironmentVariable("NO_PROXY", "localhost,127.0.0.1", "User")
    [Environment]::SetEnvironmentVariable("http_proxy", $proxyUrl, "User")
    [Environment]::SetEnvironmentVariable("https_proxy", $proxyUrl, "User")
    [Environment]::SetEnvironmentVariable("all_proxy", $proxyUrl, "User")
    [Environment]::SetEnvironmentVariable("no_proxy", "localhost,127.0.0.1", "User")
}

function Stop-AntigravityIfRunning {
    if (-not $ForceRestart) {
        return
    }

    Get-Process | Where-Object { $_.ProcessName -eq "Antigravity" } | Stop-Process -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 20; $i++) {
        $running = Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue
        if (-not $running) {
            break
        }

        Start-Sleep -Milliseconds 500
    }
}

function Restart-Antigravity {
    $launchScript = Join-Path $PSScriptRoot "launch-antigravity-clean.ps1"
    $launchArgs = @(
        "-ExecutionPolicy", "Bypass",
        "-File", "`"$launchScript`"",
        "-Workspace", "`"$Workspace`""
    )

    if ($DisableGpu) {
        $launchArgs += "-DisableGpu"
    }
    if ($ResetProfile) {
        $launchArgs += "-ResetProfile"
    }

    Start-Process -FilePath "powershell.exe" -ArgumentList $launchArgs
}

$antigravityExe = Get-AntigravityExe
Remove-WorktreeConfig
Set-ProxyEnvironmentForAntigravity
Set-UserProxyEnvironmentForAntigravity

Stop-AntigravityIfRunning

if ($ResetWorkspaceCache) {
    Reset-AntigravityWorkspaceCache
}

if ($DisableGpu) {
    Reset-GpuCaches
}

Restart-Antigravity

Start-Sleep -Seconds 3
Remove-WorktreeConfig

Write-Host "Antigravity compatibility repair completed for $Workspace (DisableGpu=$DisableGpu)"
