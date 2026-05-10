# 一键清理 Windows 代理设置并重新配置 Antigravity
# 目标：消除代理协议混乱，让 Codex/Antigravity 稳定联网

param(
    [switch]$DryRun,
    [string]$ForceProxyUrl = ""
)

$ErrorActionPreference = "Continue"
$regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$argvJsonPath = 'C:\Users\Administrator\AppData\Roaming\Antigravity\argv.json'
$backupDir = 'C:\Users\Administrator\AppData\Roaming\Antigravity\proxy-backups'

function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host ">>> $msg" -ForegroundColor Cyan
}

function Backup-IfExists([string]$path) {
    if (Test-Path $path) {
        if (-not (Test-Path $backupDir)) {
            New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
        }
        $name = [System.IO.Path]::GetFileName($path)
        $ts = Get-Date -Format "yyyyMMdd-HHmmss"
        Copy-Item $path "$backupDir\$name.$ts.bak" -Force
        Write-Host "  已备份到: $backupDir\$name.$ts.bak" -ForegroundColor DarkGray
    }
}

function Test-ProxyPort {
    param([int]$port)
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect('127.0.0.1', $port)
        $tcp.Close()
        return $true
    } catch {
        return $false
    }
}

function Test-ProxyHttp {
    param([string]$url)
    try {
        $resp = Invoke-WebRequest -Uri 'https://www.googleapis.com' -Method Head -TimeoutSec 8 -Proxy $url -UseBasicParsing
        return $resp.StatusCode -eq 200
    } catch {
        return $false
    }
}

# ========== 1. 清理注册表代理设置 ==========
Write-Step "1. 清理 Windows 注册表代理设置"
$currentProxy = (Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue).ProxyServer
$proxyEnabled = (Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue).ProxyEnable
Write-Host "  当前状态: ProxyEnable=$proxyEnabled, ProxyServer=$currentProxy"

if (-not $DryRun) {
    Set-ItemProperty -Path $regPath -Name ProxyEnable -Value 0 -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $regPath -Name ProxyServer -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $regPath -Name ProxyOverride -ErrorAction SilentlyContinue
    Write-Host "  已清空注册表代理" -ForegroundColor Green
} else {
    Write-Host "  [DRY-RUN] 将清空: ProxyEnable=0, 删除 ProxyServer/ProxyOverride" -ForegroundColor Yellow
}

# ========== 2. 清理用户环境变量中的代理 ==========
Write-Step "2. 清理用户级代理环境变量"
$envVars = @('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy')
foreach ($var in $envVars) {
    $val = [Environment]::GetEnvironmentVariable($var, 'User')
    if ($val) {
        Write-Host "  发现 `$env:$var = $val"
        if (-not $DryRun) {
            [Environment]::SetEnvironmentVariable($var, $null, 'User')
            Write-Host "  已删除 `$env:$var" -ForegroundColor Green
        }
    }
}

# ========== 3. 清理 Antigravity argv.json 中的代理 ==========
Write-Step "3. 清理 Antigravity argv.json 代理配置"
if (Test-Path $argvJsonPath) {
    Backup-IfExists $argvJsonPath
    $argvData = $null
    try {
        $argvData = Get-Content $argvJsonPath -Raw | ConvertFrom-Json
    } catch {
        $argvData = $null
    }
    if ($argvData -ne $null) {
        $hasProxy = ($argvData.PSObject.Properties.Name -contains 'proxy-server') -or ($argvData.PSObject.Properties.Name -contains 'proxy-bypass-list')
        if ($hasProxy) {
            Write-Host "  发现代理配置: proxy-server=$($argvData.'proxy-server')"
            if (-not $DryRun) {
                # 重建对象，排除代理字段
                $newData = @{}
                foreach ($prop in $argvData.PSObject.Properties) {
                    if ($prop.Name -ne 'proxy-server' -and $prop.Name -ne 'proxy-bypass-list') {
                        $newData[$prop.Name] = $prop.Value
                    }
                }
                $newData | ConvertTo-Json -Depth 10 | Set-Content $argvJsonPath -Encoding ASCII
                Write-Host "  已移除 argv.json 中的代理字段" -ForegroundColor Green
            }
        } else {
            Write-Host "  argv.json 中无代理配置，无需清理" -ForegroundColor Green
        }
    }
} else {
    Write-Host "  argv.json 不存在，跳过" -ForegroundColor DarkGray
}

# ========== 4. 清理当前 PowerShell 会话的环境变量 ==========
Write-Step "4. 清理当前会话环境变量"
foreach ($var in $envVars) {
    if (Test-Path "env:$var") {
        Remove-Item "env:$var" -Force -ErrorAction SilentlyContinue
    }
}
Write-Host "  当前会话代理变量已清空" -ForegroundColor Green

# ========== 5. 检测本地是否有可用代理 ==========
Write-Step "5. 检测本地代理可用性"

$commonPorts = @(7897, 7890, 1080, 10808, 10809, 7070, 8080, 8118, 8888, 8889)
$workingProxy = $null

if ($ForceProxyUrl) {
    Write-Host "  使用强制指定代理: $ForceProxyUrl"
    if (Test-ProxyHttp -url $ForceProxyUrl) {
        $workingProxy = $ForceProxyUrl
        Write-Host "  强制代理可用!" -ForegroundColor Green
    } else {
        Write-Host "  强制代理测试失败，继续扫描本地端口..." -ForegroundColor Yellow
    }
}

if (-not $workingProxy) {
    for ($i = 0; $i -lt $commonPorts.Count; $i++) {
        $port = $commonPorts[$i]
        if (Test-ProxyPort -port $port) {
            $testUrl = "http://127.0.0.1:$port"
            Write-Host "  端口 $port 正在监听，测试 HTTP 代理..." -NoNewline
            if (Test-ProxyHttp -url $testUrl) {
                $workingProxy = $testUrl
                Write-Host " 可用!" -ForegroundColor Green
                break
            } else {
                Write-Host " 不通" -ForegroundColor Red
            }
        }
    }
}

# ========== 6. 如果找到可用代理，正确配置 ==========
Write-Step "6. 配置 Antigravity"
if ($workingProxy) {
    Write-Host "  发现可用代理: $workingProxy" -ForegroundColor Green

    if (-not $DryRun) {
        # 重新写注册表（只写地址，不开系统代理，Antigravity 脚本会读这个地址）
        Set-ItemProperty -Path $regPath -Name ProxyServer -Value ($workingProxy -replace '^http://') -ErrorAction SilentlyContinue

        # 写 argv.json
        $argvData = $null
        if (Test-Path $argvJsonPath) {
            try {
                $argvData = Get-Content $argvJsonPath -Raw | ConvertFrom-Json
            } catch {
                $argvData = $null
            }
        }
        # 重建对象或新建对象
        $newData = @{}
        if ($argvData -ne $null) {
            foreach ($prop in $argvData.PSObject.Properties) {
                $newData[$prop.Name] = $prop.Value
            }
        }
        $newData['proxy-server'] = $workingProxy
        $newData['proxy-bypass-list'] = 'localhost;127.0.0.1'
        $newData | ConvertTo-Json -Depth 10 | Set-Content $argvJsonPath -Encoding ASCII

        # 写用户环境变量
        [Environment]::SetEnvironmentVariable('HTTP_PROXY', $workingProxy, 'User')
        [Environment]::SetEnvironmentVariable('HTTPS_PROXY', $workingProxy, 'User')
        [Environment]::SetEnvironmentVariable('ALL_PROXY', $workingProxy, 'User')
        [Environment]::SetEnvironmentVariable('NO_PROXY', 'localhost,127.0.0.1', 'User')

        Write-Host "  已正确配置代理到: $workingProxy" -ForegroundColor Green
        Write-Host "  协议: HTTP（不再强制转 SOCKS）" -ForegroundColor Green
    } else {
        Write-Host "  [DRY-RUN] 将配置代理: $workingProxy" -ForegroundColor Yellow
    }
} else {
    Write-Host "  未检测到可用代理!" -ForegroundColor Red
    Write-Host ""
    Write-Host "  可能原因:" -ForegroundColor Yellow
    Write-Host "  1. 你的 Clash/V2Ray/Shadowsocks 客户端没启动" -ForegroundColor Yellow
    Write-Host "  2. 代理软件监听端口不在常见列表里" -ForegroundColor Yellow
    Write-Host "  3. 代理模式是 SOCKS5，但 Antigravity 需要 HTTP 代理" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  解决方案:" -ForegroundColor Cyan
    Write-Host "  - 启动你的代理软件，并确保开启了'允许局域网连接'或'HTTP代理'" -ForegroundColor Cyan
    Write-Host "  - 或者手动指定: .\scripts\cleanup-proxy-for-antigravity.ps1 -ForceProxyUrl 'http://你的代理地址:端口'" -ForegroundColor Cyan
}

# ========== 7. 最终状态报告 ==========
Write-Step "7. 当前状态总览"
Write-Host "  注册表 ProxyEnable: $((Get-ItemProperty -Path $regPath).ProxyEnable)"
Write-Host "  注册表 ProxyServer: $((Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue).ProxyServer)"
Write-Host "  环境变量 HTTP_PROXY: $([Environment]::GetEnvironmentVariable('HTTP_PROXY','User'))"
if (Test-Path $argvJsonPath) {
    $aj = Get-Content $argvJsonPath -Raw | ConvertFrom-Json
    Write-Host "  argv.json proxy-server: $($aj.'proxy-server')"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
if ($workingProxy) {
    Write-Host "清理完成，代理已正确配置为: $workingProxy" -ForegroundColor Green
    Write-Host "建议: 运行 .\scripts\ensure-antigravity-compatible.ps1 启动 Antigravity" -ForegroundColor Cyan
} else {
    Write-Host "清理完成，但未找到可用代理。" -ForegroundColor Yellow
    Write-Host "请启动代理软件后再运行本脚本，或手动指定 -ForceProxyUrl" -ForegroundColor Yellow
}
Write-Host "========================================" -ForegroundColor Cyan
