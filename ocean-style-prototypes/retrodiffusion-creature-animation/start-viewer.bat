@echo off
cd /d "%~dp0"
start "" "http://127.0.0.1:8775/index.html"
python -m http.server 8775 --bind 127.0.0.1
pause
