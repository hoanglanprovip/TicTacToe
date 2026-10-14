@echo off
REM ============================================================
REM  START GAME ONLY - no tunnel.
REM  Use this for people on the same Wi-Fi or on your Tailscale.
REM  Links:
REM    LAN       : http://192.168.1.4:4000
REM    Tailscale : http://100.99.214.97:4000
REM    Tailscale : http://hoanglan-1.tail830799.ts.net:4000
REM ============================================================
chcp 65001 >nul
cd /d "%~dp0.."

echo.
echo   ============================================
echo     TIC TAC TOE - LAN / Tailscale mode
echo   ============================================
echo.

netstat -ano | findstr ":4000" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo   Server is already running on port 4000.
  echo   Opening the browser...
  start "" "http://localhost:4000"
  pause
  exit /b 0
)

echo   Starting the game server...
echo   Keep this window open. Press Ctrl+C to stop.
echo.
start "" "http://localhost:4000"
call npm.cmd start
echo.
echo   Server stopped.
pause