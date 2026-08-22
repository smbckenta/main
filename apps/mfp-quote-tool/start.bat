@echo off
rem Double-click launcher for the MFP quote tool (Windows).
rem It only calls start.ps1 so that Japanese messages render correctly.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 pause
