param(
    [string]$Workspace = "F:\smartgas-grid",
    [string]$CleanProfileRoot = "C:\Users\Administrator\AppData\Local\AntigravityStableProfile",
    [switch]$DisableGpu = $true,
    [switch]$DisableExtensions = $false,
    [switch]$DisableAntigravityTools = $true,
    [int]$CdpPort = 9222,
    [switch]$ResetProfile
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

function Update-ArgvJsonProxySettings {
    param(
        [string]$ArgvJsonPath
    )

    $proxyUrl = Get-AntigravityProxyUrl
    if ([string]::IsNullOrWhiteSpace($proxyUrl)) {
        return
    }

    $argvData = @{}
    if (Test-Path -LiteralPath $ArgvJsonPath) {
        try {
            $existing = Get-Content -LiteralPath $ArgvJsonPath -Raw | ConvertFrom-Json -AsHashtable
            if ($existing) {
                $argvData = $existing
            }
        } catch {
            $argvData = @{}
        }
    }

    $argvData["proxy-server"] = $proxyUrl
    $argvData["proxy-bypass-list"] = "localhost;127.0.0.1"
    $argvData["remote-debugging-port"] = $CdpPort

    $json = $argvData | ConvertTo-Json -Depth 10
    Set-Content -LiteralPath $ArgvJsonPath -Value $json -Encoding ASCII
}

function Get-ProxyArguments {
    $proxyUrl = Get-AntigravityProxyUrl
    if ([string]::IsNullOrWhiteSpace($proxyUrl)) {
        return @()
    }

    return @(
        "--proxy-server=$proxyUrl",
        "--proxy-bypass-list=localhost;127.0.0.1"
    )
}

function Get-StorageJsonMachineId {
    param(
        [string]$StorageJsonPath
    )

    if (-not (Test-Path -LiteralPath $StorageJsonPath)) {
        return ""
    }

    try {
        $storage = Get-Content -LiteralPath $StorageJsonPath -Raw | ConvertFrom-Json
        return [string]$storage.'telemetry.machineId'
    } catch {
        return ""
    }
}

function Get-StateDbValueLength {
    param(
        [string]$StateDbPath,
        [string]$Key
    )

    if (-not (Test-Path -LiteralPath $StateDbPath)) {
        return -1
    }

    try {
        $script = @"
import sqlite3
path = r'''$StateDbPath'''
key = r'''$Key'''
conn = sqlite3.connect(path)
cur = conn.cursor()
row = cur.execute("SELECT length(value) FROM ItemTable WHERE key=?", (key,)).fetchone()
print(row[0] if row and row[0] is not None else -1)
"@
        $value = $script | python -
        return [int]($value | Select-Object -First 1)
    } catch {
        return -1
    }
}

function Initialize-StableProfileAuthState {
    param(
        [string]$TargetProfileRoot
    )

    return
}

Get-Process | Where-Object { $_.ProcessName -match 'Antigravity|antigravity_tools|kilo' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

if ($DisableAntigravityTools) {
    $toolsExe = "F:\Users\Administrator\AppData\Local\Antigravity Tools\antigravity_tools.exe"
    if (Test-Path -LiteralPath $toolsExe) {
        Rename-Item -LiteralPath $toolsExe -NewName "antigravity_tools.exe.disabled" -Force -ErrorAction SilentlyContinue
    }
}

Set-ProxyEnvironmentForAntigravity
Set-UserProxyEnvironmentForAntigravity
Update-ArgvJsonProxySettings -ArgvJsonPath "C:\Users\Administrator\AppData\Roaming\Antigravity\argv.json"

if ([string]::IsNullOrWhiteSpace($CleanProfileRoot)) {
    throw "CleanProfileRoot cannot be empty."
}

if ($ResetProfile -and (Test-Path -LiteralPath $CleanProfileRoot)) {
    $backupRoot = "$CleanProfileRoot.bak-" + (Get-Date -Format "yyyyMMdd-HHmmss")
    Move-Item -LiteralPath $CleanProfileRoot -Destination $backupRoot -Force
}

$tempProfileRoot = "C:\Users\Administrator\AppData\Local\Temp"
if (Test-Path -LiteralPath $tempProfileRoot) {
    Get-ChildItem $tempProfileRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "AntigravityClean-*" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 2 |
        ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
}

if (-not (Test-Path -LiteralPath $CleanProfileRoot)) {
    New-Item -ItemType Directory -Path $CleanProfileRoot | Out-Null
}

Initialize-StableProfileAuthState -TargetProfileRoot $CleanProfileRoot

$exe = Get-AntigravityExe
$args = @("--user-data-dir=`"$CleanProfileRoot`"")
if ($DisableGpu) {
    $args += "--disable-gpu"
}
if ($DisableExtensions) {
    $args += "--disable-extensions"
}
$args += "--remote-debugging-port=$CdpPort"
$args += Get-ProxyArguments
$args += "`"$Workspace`""

Start-Process -FilePath $exe -ArgumentList $args
