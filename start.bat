@echo off
chcp 65001 >nul 2>&1
title OptionsAI - Starting...

echo ============================================
echo    OptionsAI - One Click Start
echo ============================================
echo.

:: Kill any existing processes on ports 3000 and 8000
echo [1/4] Cleaning up old processes...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

:: Check Python
echo [2/4] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found! Please install Python first.
    pause
    exit /b 1
)

:: Check Node
echo [3/4] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found! Please install Node.js first.
    pause
    exit /b 1
)

:: Start Backend (FastAPI on port 8000)
echo [4/4] Starting servers...
echo.
echo   Starting Backend (FastAPI) on port 8000...
cd /d "%~dp0"
start "OptionsAI-Backend" cmd /k "title OptionsAI Backend (port 8000) && cd /d "%~dp0" && python -m uvicorn backend.main:app --reload --port 8000"

:: Wait for backend to be ready
echo   Waiting for backend to be ready...
timeout /t 4 /nobreak >nul

:: Start Frontend (Next.js on port 3000)
echo   Starting Frontend (Next.js) on port 3000...
start "OptionsAI-Frontend" cmd /k "title OptionsAI Frontend (port 3000) && cd /d "%~dp0\frontend" && npm run dev"

:: Wait for frontend to compile
echo   Waiting for frontend to compile...
timeout /t 8 /nobreak >nul

echo.
echo ============================================
echo    OptionsAI is ready!
echo.
echo    Website:  http://localhost:3000
echo    API:      http://localhost:8000
echo.
echo    To stop: close the two server windows
echo ============================================
echo.

:: Auto-open browser
echo Opening browser...
start http://localhost:3000

echo.
echo You can close this window now.
timeout /t 5 /nobreak >nul
