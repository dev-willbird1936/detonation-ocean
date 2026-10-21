@echo off
rem Demo sample for Detonation Ocean. Refuses to run outside the sandbox.
rem Guard: needs DETONATION_SANDBOX=1 and the seeded Documents folder (/home/dana/Documents, C:\Users\Dana\Documents under Wine).
if not "%DETONATION_SANDBOX%"=="1" exit /b 0
if not exist "%USERPROFILE%\Documents\" exit /b 0

echo hello from hello.bat> "%USERPROFILE%\Documents\hello-bat.txt"
