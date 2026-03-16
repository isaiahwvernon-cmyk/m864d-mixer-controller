@echo off
echo ==========================================
echo   M-864D Mixer Controller
echo ==========================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Please download and install it from https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f %%v in ('node --version') do set NODEVER=%%v
echo Node.js version: %NODEVER%
echo.

if not exist node_modules (
    echo Installing dependencies... this may take a minute.
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo ERROR: npm install failed. See above for details.
        pause
        exit /b 1
    )
    echo.
)

if not exist dist\.m864d-build (
    echo Building app for the first time... this takes about 30 seconds.
    echo (If you had an older version installed, this will replace it.)
    echo.
    call npx tsx script/build.ts
    if %errorlevel% neq 0 (
        echo.
        echo ERROR: Build failed. See above for details.
        echo Try deleting the "dist" folder and running again.
        pause
        exit /b 1
    )
    echo.
    echo Build complete!
    echo.
)

echo Starting server...
echo.
echo The mixer control panel will open automatically in a few seconds.
echo Tablets and phones on the same network can connect at the address shown.
echo.
echo Press Ctrl+C to stop the server.
echo ==========================================
echo.

start "" /B cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:5000 && start http://localhost:5000/connect"

node dist\index.cjs

echo.
echo ==========================================
echo   Server stopped. Press any key to close.
echo ==========================================
echo.
pause
