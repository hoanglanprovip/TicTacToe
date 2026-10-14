@echo off
REM ============================================================
REM  STOP - closes the game server and the tunnel on this PC.
REM  (If you started the tunnel by hand in another terminal,
REM   just press Ctrl+C there.)
REM ============================================================
chcp 65001 >nul

echo   Stopping everything...

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4000" ^| findstr "LISTENING"') do (
  echo   - closing process %%p holding port 4000
  taskkill /PID %%p /F >nul 2>nul
)

taskkill /IM cloudflared.exe /F >nul 2>nul
if errorlevel 1 echo   - no cloudflared process found

echo.
echo   Done. Port 4000 is free.
timeout /t 3 /nobreak >nul