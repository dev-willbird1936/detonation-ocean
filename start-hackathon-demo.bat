@echo off
setlocal
cd /d "%~dp0"
rem Local hackathon demo with uploads ON: the real gVisor sandbox runs in the WSL distro detonation-ocean
rem (see deploy\local-wsl\README.md). Nothing reaches Vultr: cloud settings are cleared and the AI model stays off.
netstat -ano | findstr /r /c:"127.0.0.1:4173 .*LISTENING" >nul && (
  echo Port 4173 is already in use on Windows, probably an older demo window. Close it and run this again.
  pause
  exit /b 1
)
echo Starting the local sandbox: app http://127.0.0.1:4173/, shells http://127.0.0.1:4189/
echo Only upload files you are willing to run: they execute inside the local gVisor sandbox.
wsl -d detonation-ocean -u root -- bash -lc "cd \"$(wslpath '%~dp0.')\" && bash deploy/local-wsl/start-local.sh"
pause
