@echo off
REM Double-click this on Windows to build installer\output\ACTIG-Setup.exe
REM (needs Node.js 20+ and Python 3.11 installed and on PATH).
REM
REM It self-elevates to Administrator: electron-builder unpacks a signing toolkit
REM (winCodeSign) that contains macOS symlinks, and creating symlinks on Windows needs
REM admin privilege (or Developer Mode). Without it the build fails with
REM "Cannot create symbolic link ... libcrypto.dylib".

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator privileges...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows.ps1"
echo.
pause
