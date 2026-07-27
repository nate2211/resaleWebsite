@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js 22.13 or later, then run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing ResaleMasterLab packages...
  call npm install
  if errorlevel 1 (
    echo Installation failed. Review the npm error above.
    pause
    exit /b 1
  )
)

echo Starting ResaleMasterLab...
call npm run dev:windows
pause
