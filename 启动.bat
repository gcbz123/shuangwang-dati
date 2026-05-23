@echo off
cd /d "%~dp0"

if exist "env.conf" (
    set /p saved_env=<env.conf
    echo Env: %saved_env%
) else (
    echo development > env.conf
    echo Default: development
)

REM Kill old process on port 3500
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r ":3500.*LISTENING"') do (
    echo Killing old process on port 3500, PID: %%a
    taskkill /f /pid %%a >nul 2>&1
    timeout /t 1 /nobreak >nul
)

node index.js
pause
