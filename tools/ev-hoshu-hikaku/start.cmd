@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==========================================
echo   EV Hoshu Hikaku  -  EV price comparison
echo ==========================================
echo.
echo Folder : %CD%

where node >nul 2>nul
if errorlevel 1 goto NONODE

for /f "delims=" %%v in ('node -v') do set "NODEVER=%%v"
echo Node.js: %NODEVER%
echo.
echo Starting the local server. A browser window will open.
echo Keep this window open while you use the tool  (Ctrl+C to stop).
echo.

node serve.js
set "RC=%ERRORLEVEL%"
echo.
echo --- server stopped  (exit code %RC%) ---
pause
exit /b %RC%

:NONODE
echo Node.js: NOT FOUND
echo.
echo Node.js for Windows is required to run this tool.
echo   - If you run Claude Code inside WSL, Node lives in WSL, not in
echo     Windows. Install the Windows build from https://nodejs.org/
echo.
echo Falling back to opening index.html directly.
echo (The Excel template then has to be picked by hand once.)
echo.
start "" "index.html"
pause
exit /b 1
