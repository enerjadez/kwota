@echo off
setlocal
cd /d "%~dp0"
title KWOTA
echo.
echo  Starting KWOTA...
echo  Leave this window open. Close it to stop.
echo  Phone on the same Wi-Fi: http://THIS-PC:7744
echo  If the phone cannot open it, run this once as admin:
echo    netsh advfirewall firewall add rule name="KWOTA" dir=in action=allow protocol=TCP localport=7744 profile=private
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is not installed. Install it from https://nodejs.org
  pause
  exit /b 1
)
if not exist "node_modules\express" (
  echo  First run — installing...
  call npm install
  if errorlevel 1 (
    echo  npm install failed.
    pause
    exit /b 1
  )
)
start "" "http://localhost:7744/?demo=1"
node server.js
if errorlevel 1 (
  echo.
  echo  KWOTA exited with an error.
  pause
)
endlocal
