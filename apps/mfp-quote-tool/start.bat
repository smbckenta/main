@echo off
rem Double-click launcher for the MFP quote tool (Windows).
rem It only calls start.ps1 so that Japanese messages render correctly.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
rem 起動に失敗した場合でも、原因が読めるように画面を閉じない
if errorlevel 1 (
  echo.
  echo 起動に失敗しました。このフォルダの start-log.txt を担当者にお送りください。
  pause
)
