@echo off
title Smart Attendance System - One-Click Start

echo.
echo ==================================================
echo   STUST Smart Attendance System v2.0
echo   One-Click Startup Script
echo ==================================================
echo.

:: Step 1: Start FastAPI Backend
echo [1/3] Starting FastAPI Backend (Uvicorn)...
echo       Please wait 10-15 seconds for models to load...
start "Smart-Attendance-Backend" cmd /k "title Backend Server && python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000"
timeout /t 12 /nobreak > nul
echo       [OK] Backend server started (http://127.0.0.1:8000)
echo.

:: Step 2: Start ngrok
echo [2/3] Starting ngrok tunnel...
echo       Make sure ngrok is installed and configured.
start "Smart-Attendance-ngrok" cmd /k "title ngrok Tunnel && ngrok http 8000"
timeout /t 6 /nobreak > nul
echo       [OK] ngrok tunnel started
echo.

:: Step 3: Update Supabase Configuration
echo [3/3] Fetching ngrok URL and updating Supabase...
python update_ngrok_url.py
echo.

echo ==================================================
echo   System Startup Completed!
echo.
echo   Frontend URL:
echo   https://kiki030.github.io/smart-attendance/
echo.
echo   Local API Docs:
echo   http://127.0.0.1:8000/docs
echo ==================================================
echo.
echo Press any key to close this window (Backend and ngrok will continue in the background).
pause > nul
