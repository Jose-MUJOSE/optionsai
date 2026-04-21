@echo off
chcp 65001 >nul 2>&1
echo Stopping OptionsAI servers...

:: Kill processes on port 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo   Killing frontend (PID %%a)...
    taskkill /PID %%a /F >nul 2>&1
)

:: Kill processes on port 8000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    echo   Killing backend (PID %%a)...
    taskkill /PID %%a /F >nul 2>&1
)

:: Also kill by window title
taskkill /FI "WINDOWTITLE eq OptionsAI Backend*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq OptionsAI Frontend*" /F >nul 2>&1

echo.
echo OptionsAI servers stopped.
timeout /t 3 /nobreak >nul
