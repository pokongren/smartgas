# 一键清�?Windows 代理设置并重新配�?Antigravity
# 目标：消除代理协议混乱，�?Codex/Antigravity 稳定联网

param(
    [switch]$DryRun,           # 只看不删
    [string]$ForceProxyUrl = "" # 强制指定代理地址，如 http://127.0.0.1:7897
)

$ErrorActionPreference = "Continue"
$regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$argvJsonPath = 'C:\Users\Administrator\AppData\Roaming\Antigravity\argv.json'
$backupDir = 'C:\Users\Administrator\AppData\Roaming\Antigravity\proxy-backups'

function Write-Step([string]$msg) {
    Write-Host "`n>>> $msg" -ForegroundColor Cyan
}

function Backup-IfExists([string]$path) {
    if (Test-Path $path) {
        if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }
        $name = [System.IO.Path]::GetFileName($path)
        $ts = Get-Date -Format "yyyyMMdd-HHmmss"
        Copy-Item $path "$backupDir\$name.$ts.bak" -Force
        Write-Host "  已备份到: $backupDir\$name.$ts.bak" -ForegroundColor DarkGray
    }
}

# ========== 1. 清理注册表代理设�?==========
Write-Step "1. 清理 Windows 注册表代理设�?
$currentProxy = (Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue).ProxyServer
$proxyEnabled = (Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue).ProxyEnable

Write-Host "  当前状�? ProxyEnable=$proxyEnabled, ProxyServer=$currentProxy"

if (-not $DryRun) {
    Set-ItemProperty -Path $regPath -Name ProxyEnable -Value 0 -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $regPath -Name ProxyServer -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $regPath -Name ProxyOverride -ErrorAction SilentlyContinue
    Write-Host "  已清空注册表代理" -ForegroundColor Green
} else {
    Write-Host "  [DRY-RUN] 将清�? ProxyEnable=0, 删除 ProxyServer/ProxyOverride" -ForegroundColor Yellow
}

# ========== 2. 清理用户环境变量中的代理 ==========
Write-Step "2. 清理用户级代理环境变�?
$envVars = @('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy')
foreach ($var in $envVars) {
    $val = [Environment]::GetEnvironmentVariable($var, 'User')
    if ($val) {
        Write-Host "  发现 `$env:$var = $val"
        if (-not $DryRun) {
            [Environment]::SetEnvironmentVariable($var, $null, 'User')
            Write-Host "  已删�?`$env:$var" -ForegroundColor Green
        }
    }
}

# ========== 3. 清理 Antigravity argv.json 中的代理 ==========
Write-Step "3. 清理 Antigravity argv.json 代理配置"
if (Test-Path $argvJsonPath) {
    Backup-IfExists $argvJsonPath
    $argvData = Get-Content $argvJsonPath -Raw | ConvertFrom-Json -AsHashtable
    if ($argvData) {
        $hasProxy = $argvData.ContainsKey('proxy-server') -or $argvData.ContainsKey('proxy-bypass-list')
        if ($hasProxy) {
            Write-Host "  发现代理配置: proxy-server=$($argvData['proxy-server'])"
            if (-not $DryRun) {
                $argvData.Remove('proxy-server')
                $argvData.Remove('proxy-bypass-list')
                $argvData | ConvertTo-Json -Depth 10 | Set-Content $argvJsonPath -Encoding ASCII
                Write-Host "  已移�?argv.json 中的代理字段" -ForegroundColor Green
            }
        } else {
            Write-Host "  argv.json 中无代理配置，无需清理" -ForegroundColor Green
        }
    }
} else {
    Write-Host "  argv.json 不存在，跳过" -ForegroundColor DarkGray
}

# ========== 4. 清理当前 PowerShell 会话的环境变�?==========
Write-Step "4. 清理当前会话环境变量"
foreach ($var in $envVars) {
    if (Test-Path "env:$var") {
        Remove-Item "env:$var" -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "  当前会话代理变量已清�? -ForegroundColor Green

# ========== 5. 检测本地是否有可用代理 ==========
Write-Step "5. 检测本地代理可用�?

function Test-ProxyPort([int]$port) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect('127.0.0.1', $port)
        $tcp.Close()
        return $true
    } catch { return $false }
}

function Test-ProxyHttp([string]$url) {
    try {
        $resp = Invoke-WebRequest -Uri 'https://www.googleapis.com' -Method Head -TimeoutSec 8 -Proxy $url -UseBasicParsing
        return $resp.StatusCode -eq 200
    } catch { return $false }
}

# 常见代理端口
$commonPorts = @(7897, 7890, 1080, 10808, 10809, 7070, 8080, 8118, 8888, 8889)
$workingProxy = $null

if ($ForceProxyUrl) {
    Write-Host "  使用强制指定代理: $ForceProxyUrl"
    if (Test-ProxyHttp $ForceProxyUrl) {
        $workingProxy = $ForceProxyUrl
        Write-Host "  强制代理可用!" -ForegroundColor Green
    } else {
        Write-Host "  强制代理测试失败，继续扫描本地端�?.." -ForegroundColor Yellow
    }
}

