@echo off
echo ==========================================
echo      Deploying macOS Web Experience
echo ==========================================

REM Ensure we are in the project root (assuming script is run from scripts/ or root)
cd /d "%~dp0\.."

echo.
echo [1/2] Pushing changes to remote develop branch...
git push origin develop
IF %ERRORLEVEL% NEQ 0 (
    echo Error pushing to develop. Exiting.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/2] Deploying 'site' folder to gh-pages...
git subtree push --prefix site origin gh-pages
IF %ERRORLEVEL% NEQ 0 (
    echo Error deploying to gh-pages. Exiting.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ==========================================
echo      Deployment Successful!
echo ==========================================
pause
