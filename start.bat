@echo off
setlocal
cd /d "%~dp0" || (echo Cannot open the project folder. & pause & exit /b 1)
where node >nul 2>nul || (echo Node.js is required. & pause & exit /b 1)
node tools\start-local-ocean.mjs
set "RESULT=%errorlevel%"
if not "%RESULT%"=="0" echo Ocean desktop could not start; see the error above.
pause
exit /b %RESULT%
