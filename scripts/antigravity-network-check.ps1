param(
    [string]$Proxy = "",
    [int]$TimeoutSec = 20
)

$ErrorActionPreference = "Continue"

$targets = @(
    "https://oauth2.googleapis.com/token",
    "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    "https://cloudcode-pa.googleapis.com/v1internal:fetchUserInfo",
    "https://www.googleapis.com/oauth2/v2/userinfo",
    "https://play.googleapis.com/log",
    "https://antigravity-auto-updater-974169037036.us-central1.run.app/api/update/win32-x64-user/stable/ping"
)

function Test-Url {
    param(
        [string]$Url
    )

    try {
        if ([string]::IsNullOrWhiteSpace($Proxy)) {
            $resp = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method Head -TimeoutSec $TimeoutSec
        } else {
            $resp = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method Head -TimeoutSec $TimeoutSec -Proxy $Proxy
        }
        return "OK $($resp.StatusCode) $Url"
    } catch {
        return "FAIL $Url -> $($_.Exception.Message)"
    }
}

Write-Host "Antigravity network check (Proxy=$Proxy)"
foreach ($t in $targets) {
    Write-Host (Test-Url -Url $t)
}
