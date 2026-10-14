@echo off
REM ============================================================
REM  START PUBLIC - opens the game + a free Cloudflare tunnel.
REM  Friends just open the link that appears here (auto-copied).
REM  Double-click this file to run it.
REM ============================================================
chcp 65001 >nul
cd /d "%~dp0.."
setlocal enabledelayedexpansion

echo.
echo   ============================================
echo     TIC TAC TOE - public (Cloudflare Tunnel)
echo   ============================================
echo.

netstat -ano | findstr ":4000" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo   [1/2] Game server is already running on port 4000.
  goto :wait_ready
)

echo   [1/2] Starting the game server...
start "TicTacToe Server" cmd /k npm.cmd start
echo   Waiting for the server to boot...

:wait_ready
REM wait up to ~40s for the port to open (ping works even when input is redirected)
set /a WAITED=0
:wait_loop
netstat -ano | findstr ":4000" | findstr "LISTENING" >nul
if not errorlevel 1 goto :server_ok
ping -n 2 127.0.0.1 >nul
set /a WAITED+=1
if !WAITED! lss 20 goto :wait_loop
echo   [!] The server did not start. Look at the "TicTacToe Server" window.
pause
exit /b 1

:server_ok
echo   Server is up and listening on port 4000.
echo.

echo   [2/2] Opening the free Cloudflare tunnel...
echo   ------------------------------------------------------------
echo     Keep this window open while friends are playing.
echo     Close it or press Ctrl+C to take the site offline.
echo   ------------------------------------------------------------
echo.

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo   [!] cloudflared is not installed. Install it free with:
  echo         winget install cloudflare.cloudflared
  pause
  exit /b 1
)

cloudflared tunnel --url http://localhost:4000 2>&1 | powershell -NoProfile -ExecutionPolicy Bypass -Command "$input | ForEach-Object { $s = $_.ToString(); Write-Host $s; if ($s -match 'https://[a-zA-Z0-9-]+\.trycloudflare\.com') { Set-Clipboard -Value $Matches[0]; Write-Host ''; Write-Host ('   >>> LINK COPIED TO CLIPBOARD: ' + $Matches[0]) -ForegroundColor Green; Write-Host '   >>> Send this link to your friends.' -ForegroundColor Green; Write-Host '' } }"

echo.
echo   Tunnel closed - the site is offline now.
pause