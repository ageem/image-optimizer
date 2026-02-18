@echo off
title Image Optimizer

echo.
echo  =========================================
echo   Image Optimizer — Starting...
echo  =========================================
echo.

:: Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Python not found. Please install Python 3.8+ from python.org
    pause
    exit /b 1
)

:: Install dependencies if not already installed
echo  Checking dependencies...
pip show flask >nul 2>&1
if errorlevel 1 (
    echo  Installing Flask...
    pip install -r requirements.txt
)
pip show pillow >nul 2>&1
if errorlevel 1 (
    echo  Installing Pillow...
    pip install -r requirements.txt
)

echo.
echo  Starting server at http://localhost:5050
echo  Browser will open automatically.
echo  Close this window to stop the server.
echo.

python app.py

pause
