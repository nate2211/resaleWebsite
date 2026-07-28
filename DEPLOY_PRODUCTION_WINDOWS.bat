@echo off
setlocal
cd /d "%~dp0"

echo [1/5] Installing exact dependencies...
call npm ci
if errorlevel 1 goto :fail

echo [2/5] Running browser-marketplace regression tests...
call npm test
if errorlevel 1 goto :fail

echo [3/5] Validating SEO and production configuration...
call npm run seo:validate
if errorlevel 1 goto :fail

echo [4/5] Deploying the lightweight Vinext application...
call npm run deploy
if errorlevel 1 goto :fail

set "RML_BASE_URL=https://resalewebsite.unusualsuspectsclothing.workers.dev"

echo [5/5] Verifying browser-side marketplace mode...
call npm run check:production
if errorlevel 1 goto :fail

echo.
echo Deployment verified. Marketplace requests now run in the browser, not in Cloudflare.
echo Install browser-extension as an unpacked extension when a marketplace blocks CORS.
exit /b 0

:fail
echo.
echo Deployment or verification failed. Review the error above.
exit /b 1
