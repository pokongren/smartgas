@echo off
chcp 65001 >nul
echo ==========================================
echo    SmartGas 拓扑计算系统 - 快速启动
echo ==========================================
echo.

:: 检查端口占用
echo [1/4] 检查端口状态...
netstat -ano | findstr :8000 >nul && (
    echo [!] 端口 8000 被占用，尝试释放...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000') do taskkill /F /PID %%a 2>nul
)
netstat -ano | findstr :5173 >nul && (
    echo [!] 端口 5173 被占用，尝试释放...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173') do taskkill /F /PID %%a 2>nul
)

:: 启动后端
echo [2/4] 启动后端服务...
start "后端服务" cmd /k "cd /d %~dp0backend && .venv\Scripts\activate && python -m uvicorn app.main:app --reload --port 8000"

:: 等待后端启动
timeout /t 3 /nobreak >nul

:: 启动前端
echo [3/4] 启动前端服务...
start "前端服务" cmd /k "cd /d %~dp0 && npm run dev"

:: 等待前端启动
timeout /t 3 /nobreak >nul

:: 打开浏览器
echo [4/4] 打开浏览器...
start http://localhost:5173/

echo.
echo ==========================================
echo    服务启动完成！
echo    前端: http://localhost:5173/
echo    后端: http://localhost:8000/
echo    API文档: http://localhost:8000/docs
echo ==========================================
echo.
echo 按任意键关闭所有服务...
pause >nul

:: 关闭服务
taskkill /FI "WINDOWTITLE eq 后端服务*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq 前端服务*" /F >nul 2>&1
echo 服务已关闭。
