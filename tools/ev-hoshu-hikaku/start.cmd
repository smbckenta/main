@echo off
rem EV保守 価格比較表 作成ツールを起動する
rem 日本語が化けないようコンソールを UTF-8 にする
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js が見つかりません。index.html を直接開きます。
  start "" "index.html"
  exit /b
)
node serve.js
