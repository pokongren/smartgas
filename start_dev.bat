@echo off
echo Starting SmartGas Grid Services...

:: Start Backend
echo Starting Backend...
start "SmartGas Backend" cmd /k "cd backend && python run.py"

:: Start Frontend
echo Starting Frontend...
start "SmartGas Frontend" cmd /k "npm run dev"

:: Wait for services to spin up
echo Waiting for services to initialize...
timeout /t 5 /nobreak >nul

:: Open Browser
echo Opening Browser...
start http://localhost:3000

echo Done.
