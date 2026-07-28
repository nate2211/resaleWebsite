@echo off
setlocal
cd /d "%~dp0"

echo [1/5] Installing exact dependencies...
call npm ci
if errorlevel 1 goto :fail

echo [2/5] Running regression tests...
call npm test
if errorlevel 1 goto :fail

echo [3/5] Validating SEO and production configuration...
call npm run seo:validate
if errorlevel 1 goto :fail

echo [4/5] Deploying the full-stack Vinext Worker with Browser Run...
call npm run deploy
if errorlevel 1 goto :fail

set "RML_BASE_URL=https://resalewebsite.unusualsuspectsclothing.workers.dev"

echo [5/5] Checking the workers.dev deployment, Worker revision, Browser binding, and Depop listings...
call npm run check:production
if errorlevel 1 goto :fail

echo.
echo Production deployment verified successfully at https://resalewebsite.unusualsuspectsclothing.workers.dev.
exit /b 0

:fail
echo.
echo Deployment or verification failed. Review the error above.
exit /b 1
