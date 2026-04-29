@echo off
chcp 65001 >nul
echo 正在检查管理员权限...
net session >nul 2>&1
if %errorLevel% == 0 (
    goto :admin
) else (
    echo 正在请求管理员权限，请在弹出的窗口中点击“是”...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:admin
echo.
echo ========================================
echo 正在尝试为您修复/安装 Windows 沙盒...
echo ========================================
echo.

:: 针对家庭版等没有默认沙盒功能的情况，强制安装沙盒包
cd /d "%~dp0"
dir /b %SystemRoot%\servicing\Packages\*Containers*.mum >sandbox.txt
for /f %%i in ('findstr /i . sandbox.txt 2^>nul') do dism /online /norestart /add-package:"%SystemRoot%\servicing\Packages\%%i"
del sandbox.txt

:: 启用沙盒功能
dism /online /enable-feature /featurename:Containers-DisposableClientVM /LimitAccess /ALL /norestart

echo.
echo ========================================
echo 修复完成！
echo 注意：您必须【重启电脑】后，Codex 才能正常使用管理员沙盒！
echo ========================================
pause
