@echo off
REM Double-click this on Windows to build installer\output\ACTIG-Setup.exe
REM (needs Node.js 20+ and Python 3.11 installed and on PATH).
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows.ps1"
echo.
pause
