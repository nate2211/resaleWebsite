@echo off
setlocal
cd /d "%~dp0"

set "RML_BASE_URL=https://resalemasterlab.cloud-cord.com"

echo [1/6] Installing exact dependencies...
call npm ci
if errorlevel 1 goto :fail

echo [2/6] Running regression tests...
call npm test
if errorlevel 1 goto :fail

echo [3/6] Validating SEO, sitemap, manifest, icons, and production configuration...
call npm run seo:validate
if errorlevel 1 goto :fail

echo [4/6] Building the Vinext application...
call npm run build:windows
if errorlevel 1 goto :fail

echo [5/6] Deploying to Cloudflare Workers and the custom domain...
call npm run deploy
if errorlevel 1 goto :fail

echo [6/6] Verifying the deployed production pages and API health...
call npm run check:production
if errorlevel 1 goto :fail

echo.
echo Production deployment verified at %RML_BASE_URL%.
echo Thrift Check and Listing Template are available from the sticky navigation.
exit /b 0

:fail
echo.
echo Deployment or verification failed. Review the command output above.
exit /b 1
