@echo off
chcp 65001 >nul
cd /d "%~dp0"
title レストア原価管理 - 共有サーバー

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js が見つかりませんでした。
  echo   https://nodejs.org/ja から LTS 版を入れてから、もう一度このファイルを実行してください。
  echo.
  pause
  exit /b 1
)

start "" http://localhost:8787/
node server.js
echo.
echo   サーバーを終了しました。
pause
