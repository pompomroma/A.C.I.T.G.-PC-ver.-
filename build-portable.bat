@echo off
REM Antivirus-proof build: produces installer\output\ACTIG-portable.zip using electron-builder's
REM ZIP target, so it never touches NSIS's makensis.exe (which antivirus often quarantines).
REM Unzip the result anywhere and run ACTIG.exe — it registers autostart on first launch.
REM Needs Node.js 20+ and Python 3.11 on PATH. Self-elevates for admin like build.bat.

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator privileges...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0"
set ACTIG_PORTABLE=1
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows.ps1"
echo.
pause
