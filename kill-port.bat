@echo off
cd /d "%~dp0"

echo Searching for process on port 3500...
set found=0

for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r ":3500.*LISTENING"') do (
    echo Killing process PID: %%a
    taskkill /f /pid %%a >nul 2>&1 && (
        echo Process %%a killed.
        set found=1
    )
)

if %found%==0 (
    echo No process found on port 3500.
)

echo Done.
pause
